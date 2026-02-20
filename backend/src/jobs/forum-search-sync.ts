import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { backendEnv } from "../config/env";
import { runWithEnsAdvisoryLock } from "../services/ens-reconciliation-lock";
import { recordWorkerRunMetric } from "../services/ops-metrics";
import { getForumSearchControlState } from "../services/forum-search-control";
import { syncForumSearchQueue } from "../services/forum-search-sync";

const FORUM_SEARCH_SYNC_LOCK_RESOURCE = 20260225;

type RunForumSearchSyncOnceInput = {
  limit?: number;
};

export const runForumSearchSyncOnce = async (app: FastifyInstance, input: RunForumSearchSyncOnceInput = {}) => {
  const syncRunId = randomUUID();

  try {
    const control = await getForumSearchControlState();
    if (control.paused) {
      app.log.info(
        {
          syncRunId,
          pausedAt: control.pausedAt,
          pauseReason: control.pauseReason,
          pausedBy: control.pausedBy,
        },
        "Forum search sync run skipped: worker is paused"
      );
      recordWorkerRunMetric({
        worker: "forum-search-sync",
        outcome: "skipped",
        runId: syncRunId,
      });

      return {
        syncRunId,
        skipped: true,
        paused: true,
      } as const;
    }

    const lockResult = await runWithEnsAdvisoryLock({
      resource: FORUM_SEARCH_SYNC_LOCK_RESOURCE,
      task: async () => {
        app.log.info({ syncRunId }, "Forum search sync run started");

        const result = await syncForumSearchQueue({
          limit: input.limit ?? backendEnv.forumSearchSyncBatchLimit,
        });

        return result;
      },
    });

    if (!lockResult.acquired) {
      app.log.info({ syncRunId }, "Forum search sync run skipped: advisory lock held by another instance");
      recordWorkerRunMetric({
        worker: "forum-search-sync",
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
        processed: result.processed,
        failed: result.failed,
        deadLettered: result.deadLettered,
        skipped: result.skipped,
        errors: result.errors,
      },
      "Forum search sync run completed"
    );

    recordWorkerRunMetric({
      worker: "forum-search-sync",
      outcome: result.skipped ? "skipped" : "completed",
      runId: syncRunId,
    });

    return {
      syncRunId,
      skipped: result.skipped,
      result,
    } as const;
  } catch (error) {
    recordWorkerRunMetric({
      worker: "forum-search-sync",
      outcome: "failed",
      runId: syncRunId,
    });
    throw error;
  }
};

export const registerForumSearchSyncJob = (app: FastifyInstance): void => {
  const intervalMs = backendEnv.forumSearchSyncIntervalMs;

  if (intervalMs <= 0) {
    app.log.info({ intervalMs }, "Forum search sync job disabled");
    return;
  }

  let timer: NodeJS.Timeout | null = null;

  app.addHook("onReady", async () => {
    timer = setInterval(() => {
      void runForumSearchSyncOnce(app).catch((error) => {
        app.log.error({ err: error }, "Forum search sync run failed");
      });
    }, intervalMs);

    app.log.info(
      {
        intervalMs,
        limit: backendEnv.forumSearchSyncBatchLimit,
      },
      "Forum search sync job started"
    );

    void runForumSearchSyncOnce(app).catch((error) => {
      app.log.error({ err: error }, "Initial forum search sync run failed");
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
