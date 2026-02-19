import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { backendEnv } from "../config/env";
import { runWithEnsTxWatcherLock } from "../services/ens-reconciliation-lock";
import { recordWorkerRunMetric } from "../services/ops-metrics";
import { watchPendingEnsTransactions } from "../services/ens-tx-watcher";

type RunEnsTxWatcherOnceInput = {
  limit?: number;
};

export const runEnsTxWatcherOnce = async (app: FastifyInstance, input: RunEnsTxWatcherOnceInput = {}) => {
  const watcherRunId = randomUUID();
  try {
    const lockResult = await runWithEnsTxWatcherLock(async () => {
      app.log.info({ watcherRunId }, "ENS tx watcher run started");

      const result = await watchPendingEnsTransactions({
        limit: input.limit ?? backendEnv.ensTxWatcherLimit,
      });

      return result;
    });

    if (!lockResult.acquired) {
      app.log.info({ watcherRunId }, "ENS tx watcher run skipped: advisory lock held by another instance");
      recordWorkerRunMetric({
        worker: "tx-watcher",
        outcome: "skipped",
        runId: watcherRunId,
      });
      return {
        watcherRunId,
        skipped: true,
      } as const;
    }

    const result = lockResult.result;
    app.log.info(
      {
        watcherRunId,
        scanned: result.scanned,
        checkedCommitTx: result.checkedCommitTx,
        checkedRegisterTx: result.checkedRegisterTx,
        syncedCommitments: result.syncedCommitments,
        syncedRegistrations: result.syncedRegistrations,
        expired: result.expired,
        unchanged: result.unchanged,
        failed: result.failed,
        errors: result.errors,
      },
      "ENS tx watcher run completed"
    );
    recordWorkerRunMetric({
      worker: "tx-watcher",
      outcome: "completed",
      runId: watcherRunId,
    });

    return {
      watcherRunId,
      skipped: false,
      result,
    } as const;
  } catch (error) {
    recordWorkerRunMetric({
      worker: "tx-watcher",
      outcome: "failed",
      runId: watcherRunId,
    });
    throw error;
  }
};

export const registerEnsTxWatcherJob = (app: FastifyInstance): void => {
  const intervalMs = backendEnv.ensTxWatcherIntervalMs;

  if (intervalMs <= 0) {
    app.log.info({ intervalMs }, "ENS tx watcher job disabled");
    return;
  }

  let timer: NodeJS.Timeout | null = null;

  app.addHook("onReady", async () => {
    timer = setInterval(() => {
      void runEnsTxWatcherOnce(app).catch((error) => {
        app.log.error({ err: error }, "ENS tx watcher run failed");
      });
    }, intervalMs);

    app.log.info(
      {
        intervalMs,
        limit: backendEnv.ensTxWatcherLimit,
      },
      "ENS tx watcher job started"
    );

    void runEnsTxWatcherOnce(app).catch((error) => {
      app.log.error({ err: error }, "Initial ENS tx watcher run failed");
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
