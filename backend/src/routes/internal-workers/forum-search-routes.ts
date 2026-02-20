import type { FastifyInstance, preHandlerHookHandler } from "fastify";

import { HttpError } from "../../lib/http-error";
import { requireSecureTransportMiddleware } from "../../middleware/require-secure-transport";
import { verifyInternalOpsSecretMiddleware } from "../../middleware/webhook-auth";

import {
  cancelForumSearchQueueBodySchema,
  forumSearchAuditQuerySchema,
  pauseForumSearchBodySchema,
  requeueForumSearchDeadLetterBodySchema,
  runForumSearchBackfillBodySchema,
  runForumSearchReindexBodySchema,
  runLimitBodySchema,
} from "./schemas";
import type { InternalWorkersRouteDependencies, InternalWorkersRouteHelpers } from "./types";

type RegisterInternalForumSearchRoutesInput = {
  app: FastifyInstance;
  deps: InternalWorkersRouteDependencies;
  helpers: InternalWorkersRouteHelpers;
  throttles: {
    reindex: preHandlerHookHandler;
    requeue: preHandlerHookHandler;
    cancel: preHandlerHookHandler;
  };
};

export const registerInternalForumSearchRoutes = (input: RegisterInternalForumSearchRoutesInput): void => {
  const { app, deps, helpers, throttles } = input;

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
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware, throttles.reindex],
    },
    async (request) => {
      const body = runForumSearchReindexBodySchema.parse(request.body ?? {});
      const operation = "forum-search-reindex";
      const actor = helpers.getInternalActor(request);
      const requestPath = request.routeOptions.url ?? request.url;
      const payload = {
        batchSize: body.batchSize,
        includePosts: body.includePosts,
        includeComments: body.includeComments,
        syncLimit: body.syncLimit,
      } satisfies Record<string, unknown>;

      try {
        const control = await deps.getForumSearchControlState();
        if (control.paused) {
          throw new HttpError(409, "FORUM_SEARCH_PAUSED", "Forum search queue is paused", {
            pausedAt: control.pausedAt,
            pauseReason: control.pauseReason,
            pausedBy: control.pausedBy,
          });
        }

        const backfill = await deps.runForumSearchBackfillOnce(app, {
          batchSize: body.batchSize,
          includePosts: body.includePosts,
          includeComments: body.includeComments,
        });

        const sync = await deps.runForumSearchSyncOnce(app, {
          limit: body.syncLimit,
        });

        const queue = await deps.getForumSearchSyncQueueStatusSummary();

        const run = {
          backfill,
          sync,
          queue,
        };

        await helpers.persistInternalAudit({
          operation,
          actor,
          requestMethod: request.method,
          requestPath,
          payload,
          result: {
            skipped: Boolean((sync as { skipped?: boolean }).skipped),
            queueActiveTotal: queue.activeTotal,
            queueDeadLetter: queue.deadLetter,
          },
        });

        return {
          acknowledged: true,
          worker: "forum-search-reindex",
          run,
        };
      } catch (error) {
        await helpers.persistInternalAudit({
          operation,
          actor,
          requestMethod: request.method,
          requestPath,
          payload,
          error: helpers.toAuditError(error),
        });
        throw error;
      }
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
          control: await deps.getForumSearchControlState(),
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
    "/api/internal/workers/forum-search/pause",
    {
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware],
    },
    async (request) => {
      const body = pauseForumSearchBodySchema.parse(request.body ?? {});
      const operation = "forum-search-pause";
      const actor = helpers.getInternalActor(request, body.pausedBy ?? null);
      const requestPath = request.routeOptions.url ?? request.url;
      const payload = {
        paused: body.paused,
        reason: body.reason,
        pausedBy: body.pausedBy,
      } satisfies Record<string, unknown>;

      try {
        const state = await deps.setForumSearchPauseState({
          paused: body.paused,
          reason: body.reason,
          pausedBy: body.pausedBy,
        });

        await helpers.persistInternalAudit({
          operation,
          actor,
          requestMethod: request.method,
          requestPath,
          payload,
          result: {
            paused: state.paused,
            pausedAt: state.pausedAt,
            pauseReason: state.pauseReason,
          },
        });

        return {
          acknowledged: true,
          worker: "forum-search-pause",
          state,
        };
      } catch (error) {
        await helpers.persistInternalAudit({
          operation,
          actor,
          requestMethod: request.method,
          requestPath,
          payload,
          error: helpers.toAuditError(error),
        });
        throw error;
      }
    }
  );

  app.post(
    "/api/internal/workers/forum-search/cancel-queue",
    {
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware, throttles.cancel],
    },
    async (request) => {
      const body = cancelForumSearchQueueBodySchema.parse(request.body ?? {});
      const operation = "forum-search-cancel-queue";
      const actor = helpers.getInternalActor(request);
      const requestPath = request.routeOptions.url ?? request.url;

      const queueInput: Parameters<InternalWorkersRouteDependencies["cancelForumSearchQueueEntries"]>[0] = {};
      if (body.limit !== undefined) {
        queueInput.limit = body.limit;
      }
      if (body.statuses !== undefined) {
        queueInput.statuses = body.statuses;
      }
      if (body.dryRun !== undefined) {
        queueInput.dryRun = body.dryRun;
      }

      try {
        const run = await deps.cancelForumSearchQueueEntries(queueInput);

        await helpers.persistInternalAudit({
          operation,
          actor,
          requestMethod: request.method,
          requestPath,
          payload: queueInput as Record<string, unknown>,
          result: {
            selected: run.selected,
            cancelled: run.cancelled,
            wouldCancel: run.wouldCancel,
            dryRun: run.dryRun,
          },
        });

        return {
          acknowledged: true,
          worker: "forum-search-cancel-queue",
          run,
        };
      } catch (error) {
        await helpers.persistInternalAudit({
          operation,
          actor,
          requestMethod: request.method,
          requestPath,
          payload: queueInput as Record<string, unknown>,
          error: helpers.toAuditError(error),
        });
        throw error;
      }
    }
  );

  app.post(
    "/api/internal/workers/forum-search/requeue-dead-letter",
    {
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware, throttles.requeue],
    },
    async (request) => {
      const body = requeueForumSearchDeadLetterBodySchema.parse(request.body ?? {});
      const operation = "forum-search-requeue-dead-letter";
      const actor = helpers.getInternalActor(request);
      const requestPath = request.routeOptions.url ?? request.url;

      const requeueInput: Parameters<InternalWorkersRouteDependencies["requeueForumSearchDeadLetterEntries"]>[0] = {};
      if (body.limit !== undefined) {
        requeueInput.limit = body.limit;
      }
      if (body.targetType !== undefined) {
        requeueInput.targetType = body.targetType;
      }
      if (body.targetIds !== undefined) {
        requeueInput.targetIds = body.targetIds;
      }
      if (body.dryRun !== undefined) {
        requeueInput.dryRun = body.dryRun;
      }

      try {
        const run = await deps.requeueForumSearchDeadLetterEntries(requeueInput);

        await helpers.persistInternalAudit({
          operation,
          actor,
          requestMethod: request.method,
          requestPath,
          payload: requeueInput as Record<string, unknown>,
          result: {
            selected: run.selected,
            requeued: run.requeued,
            wouldRequeue: run.wouldRequeue,
            dryRun: run.dryRun,
          },
        });

        return {
          acknowledged: true,
          worker: "forum-search-dead-letter-requeue",
          run,
        };
      } catch (error) {
        await helpers.persistInternalAudit({
          operation,
          actor,
          requestMethod: request.method,
          requestPath,
          payload: requeueInput as Record<string, unknown>,
          error: helpers.toAuditError(error),
        });
        throw error;
      }
    }
  );

  app.get(
    "/api/internal/workers/forum-search/audit",
    {
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware],
    },
    async (request) => {
      const query = forumSearchAuditQuerySchema.parse(request.query ?? {});
      const events = await deps.listInternalOpsAuditEvents({
        limit: query.limit,
        outcomes: query.outcome ? [query.outcome] : undefined,
        actor: query.actor,
        createdAfter: query.createdAfter,
        createdBefore: query.createdBefore,
        operations: [
          "forum-search-reindex",
          "forum-search-pause",
          "forum-search-cancel-queue",
          "forum-search-requeue-dead-letter",
        ],
      });

      return {
        acknowledged: true,
        worker: "forum-search-audit",
        events,
      };
    }
  );
};
