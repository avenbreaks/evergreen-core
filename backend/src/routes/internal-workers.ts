import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createInternalOpsThrottleMiddleware } from "../middleware/internal-ops-throttle";
import { requireSecureTransportMiddleware } from "../middleware/require-secure-transport";
import type {
  ForumSearchSyncQueueStatusSummary,
  RequeueForumSearchDeadLetterResult,
} from "../services/forum-search-sync-queue";
import { verifyInternalOpsSecretMiddleware } from "../middleware/webhook-auth";
import { getOpsMetricsSnapshot } from "../services/ops-metrics";

type InternalWorkersRouteDependencies = {
  runEnsReconciliationOnce: (app: unknown, input?: { limit?: number; staleMinutes?: number; dryRun?: boolean }) => Promise<unknown>;
  runEnsTxWatcherOnce: (app: unknown, input?: { limit?: number }) => Promise<unknown>;
  runEnsIdentitySyncOnce: (app: unknown, input?: { limit?: number; staleMinutes?: number }) => Promise<unknown>;
  runEnsWebhookRetryOnce: (app: unknown, input?: { limit?: number }) => Promise<unknown>;
  runForumSearchSyncOnce: (app: unknown, input?: { limit?: number }) => Promise<unknown>;
  getForumSearchSyncQueueStatusSummary: () => Promise<ForumSearchSyncQueueStatusSummary>;
  requeueForumSearchDeadLetterEntries: (input?: {
    limit?: number;
    targetType?: "post" | "comment";
    targetIds?: string[];
  }) => Promise<RequeueForumSearchDeadLetterResult>;
  runForumSearchBackfillOnce: (
    app: unknown,
    input?: { batchSize?: number; includePosts?: boolean; includeComments?: boolean }
  ) => Promise<unknown>;
  runOpsRetentionOnce: (app: unknown, input?: {
    batchLimit?: number;
    processedRetentionDays?: number;
    deadLetterRetentionDays?: number;
  }) => Promise<unknown>;
  getInternalWorkerStatusSummary: () => Promise<unknown>;
  getOpsMetricsSnapshot: typeof getOpsMetricsSnapshot;
};

type InternalWorkersRoutesOptions = {
  deps?: Partial<InternalWorkersRouteDependencies>;
};

const runReconciliationBodySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  staleMinutes: z.coerce.number().int().positive().max(7 * 24 * 60).optional(),
  dryRun: z.boolean().optional(),
});

const runLimitBodySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
});

const runIdentitySyncBodySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  staleMinutes: z.coerce.number().int().positive().max(7 * 24 * 60).optional(),
});

const runOpsRetentionBodySchema = z.object({
  batchLimit: z.coerce.number().int().positive().max(5000).optional(),
  processedRetentionDays: z.coerce.number().int().positive().max(365).optional(),
  deadLetterRetentionDays: z.coerce.number().int().positive().max(365).optional(),
});

const runForumSearchBackfillBodySchema = z.object({
  batchSize: z.coerce.number().int().positive().max(1000).optional(),
  includePosts: z.boolean().optional(),
  includeComments: z.boolean().optional(),
});

const runForumSearchReindexBodySchema = z.object({
  batchSize: z.coerce.number().int().positive().max(1000).optional(),
  includePosts: z.boolean().optional(),
  includeComments: z.boolean().optional(),
  syncLimit: z.coerce.number().int().positive().max(500).optional(),
});

const requeueForumSearchDeadLetterBodySchema = z.object({
  limit: z.coerce.number().int().positive().max(1000).optional(),
  targetType: z.enum(["post", "comment"]).optional(),
  targetIds: z.array(z.string().uuid()).max(1000).optional(),
});

const FORUM_SEARCH_REINDEX_COOLDOWN_MS = 30_000;
const FORUM_SEARCH_REQUEUE_COOLDOWN_MS = 5_000;

const hasCompleteDependencies = (
  deps: Partial<InternalWorkersRouteDependencies> | undefined
): deps is InternalWorkersRouteDependencies => {
  if (!deps) {
    return false;
  }

  return (
    typeof deps.runEnsReconciliationOnce === "function" &&
    typeof deps.runEnsTxWatcherOnce === "function" &&
    typeof deps.runEnsIdentitySyncOnce === "function" &&
    typeof deps.runEnsWebhookRetryOnce === "function" &&
    typeof deps.runForumSearchSyncOnce === "function" &&
    typeof deps.getForumSearchSyncQueueStatusSummary === "function" &&
    typeof deps.requeueForumSearchDeadLetterEntries === "function" &&
    typeof deps.runForumSearchBackfillOnce === "function" &&
    typeof deps.runOpsRetentionOnce === "function" &&
    typeof deps.getInternalWorkerStatusSummary === "function" &&
    typeof deps.getOpsMetricsSnapshot === "function"
  );
};

const loadDefaultDependencies = async (): Promise<InternalWorkersRouteDependencies> => {
  const [
    reconciliationJob,
    txWatcherJob,
    identitySyncJob,
    webhookRetryJob,
    forumSearchSyncJob,
    forumSearchSyncQueueService,
    forumSearchBackfillJob,
    opsRetentionJob,
    workerStatusService,
  ] = await Promise.all([
    import("../jobs/ens-reconciliation"),
    import("../jobs/ens-tx-watcher"),
    import("../jobs/ens-identity-sync"),
    import("../jobs/ens-webhook-retry"),
    import("../jobs/forum-search-sync"),
    import("../services/forum-search-sync-queue"),
    import("../jobs/forum-search-backfill"),
    import("../jobs/ops-retention"),
    import("../services/internal-worker-status"),
  ]);

  return {
    runEnsReconciliationOnce: reconciliationJob.runEnsReconciliationOnce as InternalWorkersRouteDependencies["runEnsReconciliationOnce"],
    runEnsTxWatcherOnce: txWatcherJob.runEnsTxWatcherOnce as InternalWorkersRouteDependencies["runEnsTxWatcherOnce"],
    runEnsIdentitySyncOnce: identitySyncJob.runEnsIdentitySyncOnce as InternalWorkersRouteDependencies["runEnsIdentitySyncOnce"],
    runEnsWebhookRetryOnce: webhookRetryJob.runEnsWebhookRetryOnce as InternalWorkersRouteDependencies["runEnsWebhookRetryOnce"],
    runForumSearchSyncOnce: forumSearchSyncJob.runForumSearchSyncOnce as InternalWorkersRouteDependencies["runForumSearchSyncOnce"],
    getForumSearchSyncQueueStatusSummary: forumSearchSyncQueueService.getForumSearchSyncQueueStatusSummary,
    requeueForumSearchDeadLetterEntries: forumSearchSyncQueueService.requeueForumSearchDeadLetterEntries,
    runForumSearchBackfillOnce:
      forumSearchBackfillJob.runForumSearchBackfillOnce as InternalWorkersRouteDependencies["runForumSearchBackfillOnce"],
    runOpsRetentionOnce: opsRetentionJob.runOpsRetentionOnce as InternalWorkersRouteDependencies["runOpsRetentionOnce"],
    getInternalWorkerStatusSummary: workerStatusService.getInternalWorkerStatusSummary,
    getOpsMetricsSnapshot,
  };
};

export const internalWorkersRoutes: FastifyPluginAsync<InternalWorkersRoutesOptions> = async (app, options) => {
  const deps = hasCompleteDependencies(options.deps)
    ? options.deps
    : {
        ...(await loadDefaultDependencies()),
        ...(options.deps ?? {}),
      };

  const forumSearchReindexThrottle = createInternalOpsThrottleMiddleware({
    operation: "forum-search-reindex",
    cooldownMs: FORUM_SEARCH_REINDEX_COOLDOWN_MS,
  });

  const forumSearchRequeueThrottle = createInternalOpsThrottleMiddleware({
    operation: "forum-search-requeue-dead-letter",
    cooldownMs: FORUM_SEARCH_REQUEUE_COOLDOWN_MS,
  });

  app.post(
    "/api/internal/workers/reconciliation/run",
    {
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware],
    },
    async (request) => {
      const body = runReconciliationBodySchema.parse(request.body ?? {});
      const run = await deps.runEnsReconciliationOnce(app, {
        limit: body.limit,
        staleMinutes: body.staleMinutes,
        dryRun: body.dryRun,
      });

      return {
        acknowledged: true,
        worker: "reconciliation",
        run,
      };
    }
  );

  app.post(
    "/api/internal/workers/tx-watcher/run",
    {
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware],
    },
    async (request) => {
      const body = runLimitBodySchema.parse(request.body ?? {});
      const run = await deps.runEnsTxWatcherOnce(app, {
        limit: body.limit,
      });

      return {
        acknowledged: true,
        worker: "tx-watcher",
        run,
      };
    }
  );

  app.post(
    "/api/internal/workers/webhook-retry/run",
    {
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware],
    },
    async (request) => {
      const body = runLimitBodySchema.parse(request.body ?? {});
      const run = await deps.runEnsWebhookRetryOnce(app, {
        limit: body.limit,
      });

      return {
        acknowledged: true,
        worker: "webhook-retry",
        run,
      };
    }
  );

  app.post(
    "/api/internal/workers/identity-sync/run",
    {
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware],
    },
    async (request) => {
      const body = runIdentitySyncBodySchema.parse(request.body ?? {});
      const run = await deps.runEnsIdentitySyncOnce(app, {
        limit: body.limit,
        staleMinutes: body.staleMinutes,
      });

      return {
        acknowledged: true,
        worker: "identity-sync",
        run,
      };
    }
  );

  app.post(
    "/api/internal/workers/ops-retention/run",
    {
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware],
    },
    async (request) => {
      const body = runOpsRetentionBodySchema.parse(request.body ?? {});
      const run = await deps.runOpsRetentionOnce(app, {
        batchLimit: body.batchLimit,
        processedRetentionDays: body.processedRetentionDays,
        deadLetterRetentionDays: body.deadLetterRetentionDays,
      });

      return {
        acknowledged: true,
        worker: "ops-retention",
        run,
      };
    }
  );

  app.post(
    "/api/internal/workers/forum-search-sync/run",
    {
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware],
    },
    async (request) => {
      const body = runLimitBodySchema.parse(request.body ?? {});
      const run = await deps.runForumSearchSyncOnce(app, {
        limit: body.limit,
      });

      return {
        acknowledged: true,
        worker: "forum-search-sync",
        run,
      };
    }
  );

  app.post(
    "/api/internal/workers/forum-search-backfill/run",
    {
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware],
    },
    async (request) => {
      const body = runForumSearchBackfillBodySchema.parse(request.body ?? {});
      const run = await deps.runForumSearchBackfillOnce(app, {
        batchSize: body.batchSize,
        includePosts: body.includePosts,
        includeComments: body.includeComments,
      });

      return {
        acknowledged: true,
        worker: "forum-search-backfill",
        run,
      };
    }
  );

  app.post(
    "/api/internal/workers/forum-search/reindex",
    {
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware, forumSearchReindexThrottle],
    },
    async (request) => {
      const body = runForumSearchReindexBodySchema.parse(request.body ?? {});

      const backfill = await deps.runForumSearchBackfillOnce(app, {
        batchSize: body.batchSize,
        includePosts: body.includePosts,
        includeComments: body.includeComments,
      });

      const sync = await deps.runForumSearchSyncOnce(app, {
        limit: body.syncLimit,
      });

      const queue = await deps.getForumSearchSyncQueueStatusSummary();

      return {
        acknowledged: true,
        worker: "forum-search-reindex",
        run: {
          backfill,
          sync,
          queue,
        },
      };
    }
  );

  app.get(
    "/api/internal/workers/forum-search/status",
    {
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware],
    },
    async () => {
      const queue = await deps.getForumSearchSyncQueueStatusSummary();
      const runtimeMetrics = deps.getOpsMetricsSnapshot();

      const nowMs = Date.now();
      const oldestActiveAgeSeconds = queue.oldestActiveCreatedAt
        ? Math.max(0, Math.floor((nowMs - queue.oldestActiveCreatedAt.getTime()) / 1000))
        : null;
      const oldestDeadLetterAgeSeconds = queue.oldestDeadLetterCreatedAt
        ? Math.max(0, Math.floor((nowMs - queue.oldestDeadLetterCreatedAt.getTime()) / 1000))
        : null;

      return {
        acknowledged: true,
        worker: "forum-search",
        status: {
          queue: {
            ...queue,
            oldestActiveAgeSeconds,
            oldestDeadLetterAgeSeconds,
          },
          runtime: {
            runTotals: {
              sync: runtimeMetrics.workerRunTotals["forum-search-sync"],
              backfill: runtimeMetrics.workerRunTotals["forum-search-backfill"],
            },
            skipStreak: {
              sync: runtimeMetrics.workerSkipStreak["forum-search-sync"],
              backfill: runtimeMetrics.workerSkipStreak["forum-search-backfill"],
            },
          },
        },
      };
    }
  );

  app.post(
    "/api/internal/workers/forum-search/requeue-dead-letter",
    {
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware, forumSearchRequeueThrottle],
    },
    async (request) => {
      const body = requeueForumSearchDeadLetterBodySchema.parse(request.body ?? {});
      const run = await deps.requeueForumSearchDeadLetterEntries({
        limit: body.limit,
        targetType: body.targetType,
        targetIds: body.targetIds,
      });

      return {
        acknowledged: true,
        worker: "forum-search-dead-letter-requeue",
        run,
      };
    }
  );

  app.get(
    "/api/internal/workers/status",
    {
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware],
    },
    async () => {
      const status = await deps.getInternalWorkerStatusSummary();

      return {
        acknowledged: true,
        status,
      };
    }
  );
};
