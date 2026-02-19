import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { backendEnv } from "../config/env";
import { watchPendingEnsTransactions } from "../services/ens-tx-watcher";

export const registerEnsTxWatcherJob = (app: FastifyInstance): void => {
  const intervalMs = backendEnv.ensTxWatcherIntervalMs;

  if (intervalMs <= 0) {
    app.log.info({ intervalMs }, "ENS tx watcher job disabled");
    return;
  }

  const runWatcher = async () => {
    const watcherRunId = randomUUID();
    app.log.info({ watcherRunId }, "ENS tx watcher run started");

    const result = await watchPendingEnsTransactions({
      limit: backendEnv.ensTxWatcherLimit,
    });

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
  };

  let timer: NodeJS.Timeout | null = null;

  app.addHook("onReady", async () => {
    timer = setInterval(() => {
      void runWatcher().catch((error) => {
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

    void runWatcher().catch((error) => {
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
