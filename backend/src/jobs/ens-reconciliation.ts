import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { backendEnv } from "../config/env";
import { runWithEnsReconciliationLock } from "../services/ens-reconciliation-lock";
import { recordWorkerRunMetric } from "../services/ops-metrics";
import { reconcileStalePurchaseIntents } from "../services/ens-reconciliation";

type RunEnsReconciliationOnceInput = {
  limit?: number;
  staleMinutes?: number;
  dryRun?: boolean;
};

export const runEnsReconciliationOnce = async (
  app: FastifyInstance,
  input: RunEnsReconciliationOnceInput = {}
) => {
  const reconcileRunId = randomUUID();
  try {
    const lockResult = await runWithEnsReconciliationLock(async () => {
      app.log.info({ reconcileRunId }, "ENS reconciliation run started");

      const result = await reconcileStalePurchaseIntents({
        limit: input.limit ?? backendEnv.ensReconciliationLimit,
        staleMinutes: input.staleMinutes ?? backendEnv.ensReconciliationStaleMinutes,
        dryRun: input.dryRun,
      });

      return result;
    });

    if (!lockResult.acquired) {
      app.log.info(
        { reconcileRunId },
        "ENS reconciliation run skipped: advisory lock held by another instance"
      );
      recordWorkerRunMetric({
        worker: "reconciliation",
        outcome: "skipped",
        runId: reconcileRunId,
      });
      return {
        reconcileRunId,
        skipped: true,
      } as const;
    }

    const result = lockResult.result;
    app.log.info(
      {
        reconcileRunId,
        scanned: result.scanned,
        updated: result.updated,
        expired: result.expired,
        promotedToRegisterable: result.promotedToRegisterable,
        staleMinutes: result.staleMinutes,
        dryRun: result.dryRun,
      },
      "ENS reconciliation run completed"
    );
    recordWorkerRunMetric({
      worker: "reconciliation",
      outcome: "completed",
      runId: reconcileRunId,
    });

    return {
      reconcileRunId,
      skipped: false,
      result,
    } as const;
  } catch (error) {
    recordWorkerRunMetric({
      worker: "reconciliation",
      outcome: "failed",
      runId: reconcileRunId,
    });
    throw error;
  }
};

export const registerEnsReconciliationJob = (app: FastifyInstance): void => {
  const intervalMs = backendEnv.ensReconciliationIntervalMs;

  if (intervalMs <= 0) {
    app.log.info({ intervalMs }, "ENS reconciliation job disabled");
    return;
  }

  let timer: NodeJS.Timeout | null = null;

  app.addHook("onReady", async () => {
    timer = setInterval(() => {
      void runEnsReconciliationOnce(app).catch((error) => {
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

    void runEnsReconciliationOnce(app).catch((error) => {
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
