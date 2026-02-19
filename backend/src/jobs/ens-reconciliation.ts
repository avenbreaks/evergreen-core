import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { backendEnv } from "../config/env";
import { releaseEnsReconciliationLock, tryAcquireEnsReconciliationLock } from "../services/ens-reconciliation-lock";
import { reconcileStalePurchaseIntents } from "../services/ens-reconciliation";

export const registerEnsReconciliationJob = (app: FastifyInstance): void => {
  const intervalMs = backendEnv.ensReconciliationIntervalMs;

  if (intervalMs <= 0) {
    app.log.info({ intervalMs }, "ENS reconciliation job disabled");
    return;
  }

  const runReconciliation = async () => {
    const reconcileRunId = randomUUID();
    const lockAcquired = await tryAcquireEnsReconciliationLock();
    if (!lockAcquired) {
      app.log.info(
        { reconcileRunId },
        "ENS reconciliation run skipped: advisory lock held by another instance"
      );
      return;
    }

    try {
      app.log.info({ reconcileRunId }, "ENS reconciliation run started");

      const result = await reconcileStalePurchaseIntents({
        limit: backendEnv.ensReconciliationLimit,
        staleMinutes: backendEnv.ensReconciliationStaleMinutes,
      });

      app.log.info(
        {
          reconcileRunId,
          scanned: result.scanned,
          updated: result.updated,
          expired: result.expired,
          promotedToRegisterable: result.promotedToRegisterable,
          staleMinutes: result.staleMinutes,
        },
        "ENS reconciliation run completed"
      );
    } finally {
      try {
        await releaseEnsReconciliationLock();
      } catch (error) {
        app.log.error(
          {
            err: error,
            reconcileRunId,
          },
          "Failed to release ENS reconciliation advisory lock"
        );
      }
    }
  };

  let timer: NodeJS.Timeout | null = null;

  app.addHook("onReady", async () => {
    timer = setInterval(() => {
      void runReconciliation().catch((error) => {
        app.log.error({ err: error }, "ENS reconciliation run failed");
      });
    }, intervalMs);

    app.log.info(
      {
        intervalMs,
        limit: backendEnv.ensReconciliationLimit,
        staleMinutes: backendEnv.ensReconciliationStaleMinutes,
      },
      "ENS reconciliation job started"
    );

    void runReconciliation().catch((error) => {
      app.log.error({ err: error }, "Initial ENS reconciliation run failed");
    });
  });

  app.addHook("onClose", async () => {
    if (!timer) {
      return;
    }

    clearInterval(timer);
    timer = null;
  });
};
