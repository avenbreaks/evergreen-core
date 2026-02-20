import type { FastifyPluginAsync, FastifyRequest } from "fastify";

import { HttpError } from "../lib/http-error";
import { createInternalOpsThrottleMiddleware } from "../middleware/internal-ops-throttle";
import { getOpsMetricsSnapshot } from "../services/ops-metrics";
import { registerInternalCoreWorkerRoutes } from "./internal-workers/core-routes";
import {
  FORUM_SEARCH_CANCEL_COOLDOWN_MS,
  FORUM_SEARCH_REINDEX_COOLDOWN_MS,
  FORUM_SEARCH_REQUEUE_COOLDOWN_MS,
} from "./internal-workers/schemas";
import { registerInternalForumSearchRoutes } from "./internal-workers/forum-search-routes";
import type {
  InternalWorkersRouteDependencies,
  InternalWorkersRouteHelpers,
  InternalWorkersRoutesOptions,
} from "./internal-workers/types";

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
    typeof deps.cancelForumSearchQueueEntries === "function" &&
    typeof deps.requeueForumSearchDeadLetterEntries === "function" &&
    typeof deps.getForumSearchControlState === "function" &&
    typeof deps.setForumSearchPauseState === "function" &&
    typeof deps.runForumSearchBackfillOnce === "function" &&
    typeof deps.runOpsRetentionOnce === "function" &&
    typeof deps.getInternalWorkerStatusSummary === "function" &&
    typeof deps.getForumMvpStatusSummary === "function" &&
    typeof deps.recordInternalOpsAuditEvent === "function" &&
    typeof deps.listInternalOpsAuditEvents === "function" &&
    typeof deps.getOpsMetricsSnapshot === "function" &&
    typeof deps.claimInternalOpsCooldown === "function"
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
    forumSearchControlService,
    internalOpsThrottleService,
    internalOpsAuditService,
    forumSearchBackfillJob,
    opsRetentionJob,
    forumMvpStatusService,
    workerStatusService,
  ] = await Promise.all([
    import("../jobs/ens-reconciliation"),
    import("../jobs/ens-tx-watcher"),
    import("../jobs/ens-identity-sync"),
    import("../jobs/ens-webhook-retry"),
    import("../jobs/forum-search-sync"),
    import("../services/forum-search-sync-queue"),
    import("../services/forum-search-control"),
    import("../services/internal-ops-throttle-store"),
    import("../services/internal-ops-audit"),
    import("../jobs/forum-search-backfill"),
    import("../jobs/ops-retention"),
    import("../services/forum-mvp-status"),
    import("../services/internal-worker-status"),
  ]);

  return {
    runEnsReconciliationOnce:
      reconciliationJob.runEnsReconciliationOnce as InternalWorkersRouteDependencies["runEnsReconciliationOnce"],
    runEnsTxWatcherOnce: txWatcherJob.runEnsTxWatcherOnce as InternalWorkersRouteDependencies["runEnsTxWatcherOnce"],
    runEnsIdentitySyncOnce:
      identitySyncJob.runEnsIdentitySyncOnce as InternalWorkersRouteDependencies["runEnsIdentitySyncOnce"],
    runEnsWebhookRetryOnce:
      webhookRetryJob.runEnsWebhookRetryOnce as InternalWorkersRouteDependencies["runEnsWebhookRetryOnce"],
    runForumSearchSyncOnce:
      forumSearchSyncJob.runForumSearchSyncOnce as InternalWorkersRouteDependencies["runForumSearchSyncOnce"],
    getForumSearchSyncQueueStatusSummary: forumSearchSyncQueueService.getForumSearchSyncQueueStatusSummary,
    cancelForumSearchQueueEntries: forumSearchSyncQueueService.cancelForumSearchQueueEntries,
    requeueForumSearchDeadLetterEntries: forumSearchSyncQueueService.requeueForumSearchDeadLetterEntries,
    getForumSearchControlState: forumSearchControlService.getForumSearchControlState,
    setForumSearchPauseState: forumSearchControlService.setForumSearchPauseState,
    runForumSearchBackfillOnce:
      forumSearchBackfillJob.runForumSearchBackfillOnce as InternalWorkersRouteDependencies["runForumSearchBackfillOnce"],
    runOpsRetentionOnce: opsRetentionJob.runOpsRetentionOnce as InternalWorkersRouteDependencies["runOpsRetentionOnce"],
    getInternalWorkerStatusSummary: workerStatusService.getInternalWorkerStatusSummary,
    getForumMvpStatusSummary: forumMvpStatusService.getForumMvpStatusSummary,
    recordInternalOpsAuditEvent: internalOpsAuditService.recordInternalOpsAuditEvent,
    listInternalOpsAuditEvents: internalOpsAuditService.listInternalOpsAuditEvents,
    getOpsMetricsSnapshot,
    claimInternalOpsCooldown: internalOpsThrottleService.claimInternalOpsCooldown,
  };
};

export const internalWorkersRoutes: FastifyPluginAsync<InternalWorkersRoutesOptions> = async (app, options) => {
  const deps = hasCompleteDependencies(options.deps)
    ? options.deps
    : {
        ...(await loadDefaultDependencies()),
        ...(options.deps ?? {}),
      };

  const getInternalActor = (request: FastifyRequest, fallback?: string | null): string | null => {
    const raw = request.headers["x-internal-actor"];
    const fromHeader = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (fromHeader) {
      return fromHeader.slice(0, 120);
    }

    const fromFallback = fallback?.trim();
    return fromFallback ? fromFallback.slice(0, 120) : null;
  };

  const toAuditError = (error: unknown): { code: string; message: string } => {
    if (error instanceof HttpError) {
      return {
        code: error.code,
        message: error.message,
      };
    }

    if (error instanceof Error) {
      return {
        code: "INTERNAL_SERVER_ERROR",
        message: error.message,
      };
    }

    return {
      code: "INTERNAL_SERVER_ERROR",
      message: "Unknown internal operation error",
    };
  };

  const persistInternalAudit: InternalWorkersRouteHelpers["persistInternalAudit"] = async (input) => {
    try {
      await deps.recordInternalOpsAuditEvent({
        operation: input.operation,
        outcome: input.error ? "failed" : "completed",
        actor: input.actor ?? null,
        requestMethod: input.requestMethod,
        requestPath: input.requestPath,
        payload: input.payload ?? {},
        result: input.result ?? null,
        errorCode: input.error?.code ?? null,
        errorMessage: input.error?.message ?? null,
      });
    } catch (auditError) {
      app.log.error({ err: auditError, operation: input.operation }, "Failed to persist internal ops audit event");
    }
  };

  const helpers: InternalWorkersRouteHelpers = {
    getInternalActor,
    toAuditError,
    persistInternalAudit,
  };

  const forumSearchReindexThrottle = createInternalOpsThrottleMiddleware({
    operation: "forum-search-reindex",
    cooldownMs: FORUM_SEARCH_REINDEX_COOLDOWN_MS,
    claim: deps.claimInternalOpsCooldown,
  });

  const forumSearchRequeueThrottle = createInternalOpsThrottleMiddleware({
    operation: "forum-search-requeue-dead-letter",
    cooldownMs: FORUM_SEARCH_REQUEUE_COOLDOWN_MS,
    claim: deps.claimInternalOpsCooldown,
  });

  const forumSearchCancelThrottle = createInternalOpsThrottleMiddleware({
    operation: "forum-search-cancel-queue",
    cooldownMs: FORUM_SEARCH_CANCEL_COOLDOWN_MS,
    claim: deps.claimInternalOpsCooldown,
  });

  registerInternalCoreWorkerRoutes(app, deps);
  registerInternalForumSearchRoutes({
    app,
    deps,
    helpers,
    throttles: {
      reindex: forumSearchReindexThrottle,
      requeue: forumSearchRequeueThrottle,
      cancel: forumSearchCancelThrottle,
    },
  });
};
