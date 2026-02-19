import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { backendEnv } from "../config/env";
import { runWithEnsAdvisoryLock } from "../services/ens-reconciliation-lock";
import { recordWorkerRunMetric } from "../services/ops-metrics";
import { enqueueForumSearchBackfill } from "../services/forum-search-backfill";

const FORUM_SEARCH_BACKFILL_LOCK_RESOURCE = 20260226;

type RunForumSearchBackfillInput = {
  batchSize?: number;
  includePosts?: boolean;
  includeComments?: boolean;
};

export const runForumSearchBackfillOnce = async (app: FastifyInstance, input: RunForumSearchBackfillInput = {}) => {
  const backfillRunId = randomUUID();

  try {
    const lockResult = await runWithEnsAdvisoryLock({
      resource: FORUM_SEARCH_BACKFILL_LOCK_RESOURCE,
      task: async () => {
        app.log.info({ backfillRunId }, "Forum search backfill run started");

        const result = await enqueueForumSearchBackfill({
          batchSize: input.batchSize ?? backendEnv.forumSearchSyncBatchLimit,
          includePosts: input.includePosts,
          includeComments: input.includeComments,
        });

        return result;
      },
    });

    if (!lockResult.acquired) {
      app.log.info({ backfillRunId }, "Forum search backfill run skipped: advisory lock held by another instance");
      recordWorkerRunMetric({
        worker: "forum-search-backfill",
        outcome: "skipped",
        runId: backfillRunId,
      });

      return {
        backfillRunId,
        skipped: true,
      } as const;
    }

    const result = lockResult.result;
    app.log.info(
      {
        backfillRunId,
        scannedPosts: result.scannedPosts,
        scannedComments: result.scannedComments,
        queuedUpserts: result.queuedUpserts,
        queuedDeletes: result.queuedDeletes,
        batchesEnqueued: result.batchesEnqueued,
      },
      "Forum search backfill run completed"
    );

    recordWorkerRunMetric({
      worker: "forum-search-backfill",
      outcome: "completed",
      runId: backfillRunId,
    });

    return {
      backfillRunId,
      skipped: false,
      result,
    } as const;
  } catch (error) {
    recordWorkerRunMetric({
      worker: "forum-search-backfill",
      outcome: "failed",
      runId: backfillRunId,
    });
    throw error;
  }
};
