import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { backendEnv } from "../config/env";
import { runWithEnsIdentitySyncLock } from "../services/ens-reconciliation-lock";
import { syncEnsIdentitiesFromChain } from "../services/ens-identity-sync";
import { recordWorkerRunMetric } from "../services/ops-metrics";

type RunEnsIdentitySyncOnceInput = {
  limit?: number;
  staleMinutes?: number;
};

export const runEnsIdentitySyncOnce = async (app: FastifyInstance, input: RunEnsIdentitySyncOnceInput = {}) => {
  const syncRunId = randomUUID();

  try {
    const lockResult = await runWithEnsIdentitySyncLock(async () => {
      app.log.info({ syncRunId }, "ENS identity sync run started");

      const result = await syncEnsIdentitiesFromChain({
        limit: input.limit ?? backendEnv.ensIdentitySyncLimit,
        staleMinutes: input.staleMinutes ?? backendEnv.ensIdentitySyncStaleMinutes,
      });

      return result;
    });

    if (!lockResult.acquired) {
      app.log.info({ syncRunId }, "ENS identity sync run skipped: advisory lock held by another instance");
      recordWorkerRunMetric({
        worker: "identity-sync",
        outcome: "skipped",
        runId: syncRunId,
      });
      return {
        syncRunId,
        skipped: true,
      } as const;
    }

    const result = lockResult.result;
    app.log.info(
      {
        syncRunId,
        scanned: result.scanned,
        updated: result.updated,
        activated: result.activated,
        revoked: result.revoked,
        unchanged: result.unchanged,
        failed: result.failed,
        errors: result.errors,
      },
      "ENS identity sync run completed"
    );
    recordWorkerRunMetric({
      worker: "identity-sync",
      outcome: "completed",
      runId: syncRunId,
    });

    return {
      syncRunId,
      skipped: false,
      result,
    } as const;
  } catch (error) {
    recordWorkerRunMetric({
      worker: "identity-sync",
      outcome: "failed",
      runId: syncRunId,
    });
    throw error;
  }
};

export const registerEnsIdentitySyncJob = (app: FastifyInstance): void => {
  const intervalMs = backendEnv.ensIdentitySyncIntervalMs;

  if (intervalMs <= 0) {
    app.log.info({ intervalMs }, "ENS identity sync job disabled");
    return;
  }

  let timer: NodeJS.Timeout | null = null;

  app.addHook("onReady", async () => {
    timer = setInterval(() => {
      void runEnsIdentitySyncOnce(app).catch((error) => {
        app.log.error({ err: error }, "ENS identity sync run failed");
      });
    }, intervalMs);

    app.log.info(
      {
        intervalMs,
        limit: backendEnv.ensIdentitySyncLimit,
        staleMinutes: backendEnv.ensIdentitySyncStaleMinutes,
      },
      "ENS identity sync job started"
    );

    void runEnsIdentitySyncOnce(app).catch((error) => {
      app.log.error({ err: error }, "Initial ENS identity sync run failed");
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
