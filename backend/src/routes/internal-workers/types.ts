import type { FastifyRequest } from "fastify";

import type { ForumMvpStatusSummary } from "../../services/forum-mvp-status";
import type { ForumSearchControlState } from "../../services/forum-search-control";
import type {
  CancelForumSearchQueueResult,
  ForumSearchSyncQueueStatusSummary,
  RequeueForumSearchDeadLetterResult,
} from "../../services/forum-search-sync-queue";
import type { ClaimInternalOpsCooldownInput, ClaimInternalOpsCooldownResult } from "../../services/internal-ops-throttle-store";
import type { OpsMetricsSnapshot } from "../../services/ops-metrics";

type RecordInternalOpsAuditEventInput = {
  operation: string;
  outcome: "completed" | "failed";
  actor?: string | null;
  requestMethod?: string | null;
  requestPath?: string | null;
  payload?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

type ListInternalOpsAuditEventsInput = {
  operations?: string[];
  outcomes?: Array<"completed" | "failed">;
  actor?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  limit?: number;
};

type InternalOpsAuditEvent = {
  id: string;
  operation: string;
  outcome: string;
  actor: string | null;
  requestMethod: string | null;
  requestPath: string | null;
  payload: unknown;
  result: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
};

export type InternalWorkersRouteDependencies = {
  runEnsReconciliationOnce: (app: unknown, input?: { limit?: number; staleMinutes?: number; dryRun?: boolean }) => Promise<unknown>;
  runEnsTxWatcherOnce: (app: unknown, input?: { limit?: number }) => Promise<unknown>;
  runEnsIdentitySyncOnce: (app: unknown, input?: { limit?: number; staleMinutes?: number }) => Promise<unknown>;
  runEnsWebhookRetryOnce: (app: unknown, input?: { limit?: number }) => Promise<unknown>;
  runForumSearchSyncOnce: (app: unknown, input?: { limit?: number }) => Promise<unknown>;
  getForumSearchSyncQueueStatusSummary: () => Promise<ForumSearchSyncQueueStatusSummary>;
  cancelForumSearchQueueEntries: (input?: {
    limit?: number;
    statuses?: Array<"pending" | "processing" | "failed" | "dead_letter">;
    dryRun?: boolean;
  }) => Promise<CancelForumSearchQueueResult>;
  requeueForumSearchDeadLetterEntries: (input?: {
    limit?: number;
    targetType?: "post" | "comment";
    targetIds?: string[];
    dryRun?: boolean;
  }) => Promise<RequeueForumSearchDeadLetterResult>;
  getForumSearchControlState: () => Promise<ForumSearchControlState>;
  setForumSearchPauseState: (input: { paused: boolean; reason?: string; pausedBy?: string }) => Promise<ForumSearchControlState>;
  runForumSearchBackfillOnce: (
    app: unknown,
    input?: { batchSize?: number; includePosts?: boolean; includeComments?: boolean }
  ) => Promise<unknown>;
  runOpsRetentionOnce: (app: unknown, input?: {
    batchLimit?: number;
    processedRetentionDays?: number;
    deadLetterRetentionDays?: number;
    internalAuditRetentionDays?: number;
  }) => Promise<unknown>;
  getInternalWorkerStatusSummary: () => Promise<unknown>;
  getForumMvpStatusSummary: () => Promise<ForumMvpStatusSummary>;
  recordInternalOpsAuditEvent: (input: RecordInternalOpsAuditEventInput) => Promise<string>;
  listInternalOpsAuditEvents: (input?: ListInternalOpsAuditEventsInput) => Promise<InternalOpsAuditEvent[]>;
  getOpsMetricsSnapshot: () => OpsMetricsSnapshot;
  claimInternalOpsCooldown: (input: ClaimInternalOpsCooldownInput) => Promise<ClaimInternalOpsCooldownResult>;
};

export type InternalWorkersRoutesOptions = {
  deps?: Partial<InternalWorkersRouteDependencies>;
};

export type InternalAuditError = {
  code: string;
  message: string;
};

export type InternalAuditRecordInput = {
  operation: string;
  actor?: string | null;
  requestMethod?: string | null;
  requestPath?: string | null;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: InternalAuditError;
};

export type InternalWorkersRouteHelpers = {
  getInternalActor: (request: FastifyRequest, fallback?: string | null) => string | null;
  toAuditError: (error: unknown) => InternalAuditError;
  persistInternalAudit: (input: InternalAuditRecordInput) => Promise<void>;
};
