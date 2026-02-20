import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import { HttpError } from "../lib/http-error";
import type { OpsMetricsSnapshot } from "../services/ops-metrics";
import type {
  CancelForumSearchQueueResult,
  ForumSearchSyncQueueStatusSummary,
  RequeueForumSearchDeadLetterResult,
} from "../services/forum-search-sync-queue";
import type { ClaimInternalOpsCooldownResult } from "../services/internal-ops-throttle-store";
import type { ForumSearchControlState } from "../services/forum-search-control";
import type { ForumMvpStatusSummary } from "../services/forum-mvp-status";
import type { InternalOpsAuditEvent } from "../services/internal-ops-audit";

const INTERNAL_SECRET = "test-internal-worker-secret";

process.env.INTERNAL_OPS_ACTIVE_SECRET = INTERNAL_SECRET;
process.env.WEBHOOK_IP_ALLOWLIST = "";

type ReconciliationInput = {
  limit?: number;
  staleMinutes?: number;
  dryRun?: boolean;
};

type LimitInput = {
  limit?: number;
};

type InternalWorkersDeps = {
  runEnsReconciliationOnce: (_app: unknown, input?: ReconciliationInput) => Promise<unknown>;
  runEnsTxWatcherOnce: (_app: unknown, input?: LimitInput) => Promise<unknown>;
  runEnsIdentitySyncOnce: (_app: unknown, input?: { limit?: number; staleMinutes?: number }) => Promise<unknown>;
  runEnsWebhookRetryOnce: (_app: unknown, input?: LimitInput) => Promise<unknown>;
  runForumSearchSyncOnce: (_app: unknown, input?: LimitInput) => Promise<unknown>;
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
    _app: unknown,
    input?: { batchSize?: number; includePosts?: boolean; includeComments?: boolean }
  ) => Promise<unknown>;
  runOpsRetentionOnce: (
    _app: unknown,
    input?: { batchLimit?: number; processedRetentionDays?: number; deadLetterRetentionDays?: number }
  ) => Promise<unknown>;
  getInternalWorkerStatusSummary: () => Promise<unknown>;
  getForumMvpStatusSummary: () => Promise<ForumMvpStatusSummary>;
  recordInternalOpsAuditEvent: (input: {
    operation: string;
    outcome: "completed" | "failed";
    actor?: string | null;
    requestMethod?: string | null;
    requestPath?: string | null;
    payload?: Record<string, unknown> | null;
    result?: Record<string, unknown> | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  }) => Promise<string>;
  listInternalOpsAuditEvents: (input?: { operations?: string[]; limit?: number }) => Promise<InternalOpsAuditEvent[]>;
  getOpsMetricsSnapshot: () => OpsMetricsSnapshot;
  claimInternalOpsCooldown: (input: { operation: string; cooldownMs: number; now?: Date }) => Promise<ClaimInternalOpsCooldownResult>;
};

const buildDeps = (overrides: Partial<InternalWorkersDeps> = {}): InternalWorkersDeps => {
  const unexpected = (name: string) => async () => {
    throw new Error(`Unexpected dependency call: ${name}`);
  };

  return {
    runEnsReconciliationOnce: unexpected("runEnsReconciliationOnce"),
    runEnsTxWatcherOnce: unexpected("runEnsTxWatcherOnce"),
    runEnsIdentitySyncOnce: unexpected("runEnsIdentitySyncOnce"),
    runEnsWebhookRetryOnce: unexpected("runEnsWebhookRetryOnce"),
    runForumSearchSyncOnce: unexpected("runForumSearchSyncOnce"),
    getForumSearchSyncQueueStatusSummary: unexpected("getForumSearchSyncQueueStatusSummary"),
    cancelForumSearchQueueEntries: unexpected("cancelForumSearchQueueEntries"),
    requeueForumSearchDeadLetterEntries: unexpected("requeueForumSearchDeadLetterEntries"),
    getForumSearchControlState: async () => ({
      worker: "forum-search",
      paused: false,
      pauseReason: null,
      pausedBy: null,
      pausedAt: null,
      updatedAt: null,
    }),
    setForumSearchPauseState: unexpected("setForumSearchPauseState"),
    runForumSearchBackfillOnce: unexpected("runForumSearchBackfillOnce"),
    runOpsRetentionOnce: unexpected("runOpsRetentionOnce"),
    getInternalWorkerStatusSummary: unexpected("getInternalWorkerStatusSummary"),
    getForumMvpStatusSummary: unexpected("getForumMvpStatusSummary"),
    recordInternalOpsAuditEvent: async () => "audit-event-id",
    listInternalOpsAuditEvents: async () => [],
    getOpsMetricsSnapshot: () => {
      throw new Error("Unexpected dependency call: getOpsMetricsSnapshot");
    },
    claimInternalOpsCooldown: async (input) => ({
      allowed: true,
      retryAfterMs: 0,
      nextAllowedAt: new Date(Date.now() + input.cooldownMs),
    }),
    ...overrides,
  };
};

const buildInternalWorkersTestApp = async (depsOverrides: Partial<InternalWorkersDeps> = {}) => {
  const { internalWorkersRoutes } = await import("./internal-workers");
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }

    return reply.status(500).send({
      code: "INTERNAL_SERVER_ERROR",
      message: "Unexpected error",
    });
  });

  await app.register(internalWorkersRoutes, {
    deps: buildDeps(depsOverrides),
  });

  return app;
};

const createOpsMetricsSnapshot = (): OpsMetricsSnapshot => ({
  webhookProcessedTotal: 0,
  webhookFailedTotal: 0,
  webhookDeadLetterTotal: 0,
  webhookRetryDepthMax: 0,
  workerRunTotals: {
    reconciliation: { completed: 0, skipped: 0, failed: 0 },
    "tx-watcher": { completed: 0, skipped: 0, failed: 0 },
    "webhook-retry": { completed: 0, skipped: 0, failed: 0 },
    "ops-retention": { completed: 0, skipped: 0, failed: 0 },
    "identity-sync": { completed: 0, skipped: 0, failed: 0 },
    "forum-search-sync": { completed: 0, skipped: 0, failed: 0 },
    "forum-search-backfill": { completed: 0, skipped: 0, failed: 0 },
  },
  workerSkipStreak: {
    reconciliation: 0,
    "tx-watcher": 0,
    "webhook-retry": 0,
    "ops-retention": 0,
    "identity-sync": 0,
    "forum-search-sync": 0,
    "forum-search-backfill": 0,
  },
});

const createForumMvpStatusSummary = (): ForumMvpStatusSummary => ({
  completed: 0,
  partial: 0,
  missing: 0,
  total: 0,
  readinessPercent: 0,
  checklist: [],
  signals: {
    publishedPosts: 0,
    publishedComments: 0,
    openReports: 0,
    queuedSearchJobs: 0,
    notificationRows: 0,
  },
  generatedAt: new Date(),
});

test("internal workers route rejects invalid secret", async (t) => {
  const app = await buildInternalWorkersTestApp();

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/internal/workers/reconciliation/run",
    headers: {
      "x-internal-secret": "invalid-secret",
    },
    payload: {},
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().code, "INTERNAL_OPS_UNAUTHORIZED");
});

test("internal workers route triggers reconciliation with request input", async (t) => {
  let receivedInput: ReconciliationInput | null = null;

  const app = await buildInternalWorkersTestApp({
    runEnsReconciliationOnce: async (_app, input) => {
      receivedInput = input ?? null;
      return {
        reconcileRunId: "reconcile-run-1",
        skipped: false,
      };
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/internal/workers/reconciliation/run",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
    payload: {
      limit: 12,
      staleMinutes: 30,
      dryRun: true,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().worker, "reconciliation");
  assert.deepEqual(receivedInput, {
    limit: 12,
    staleMinutes: 30,
    dryRun: true,
  });
});

test("internal workers route triggers tx watcher, identity sync, webhook retry, forum search sync, backfill, and ops retention", async (t) => {
  let txWatcherCalls = 0;
  let identitySyncCalls = 0;
  let webhookRetryCalls = 0;
  let forumSearchSyncCalls = 0;
  let forumSearchBackfillCalls = 0;
  let opsRetentionCalls = 0;

  const app = await buildInternalWorkersTestApp({
    runEnsTxWatcherOnce: async () => {
      txWatcherCalls += 1;
      return {
        watcherRunId: "watcher-run-1",
        skipped: false,
      };
    },
    runEnsWebhookRetryOnce: async () => {
      webhookRetryCalls += 1;
      return {
        retryRunId: "retry-run-1",
        skipped: false,
      };
    },
    runForumSearchSyncOnce: async () => {
      forumSearchSyncCalls += 1;
      return {
        syncRunId: "forum-search-sync-run-1",
        skipped: false,
      };
    },
    runForumSearchBackfillOnce: async () => {
      forumSearchBackfillCalls += 1;
      return {
        backfillRunId: "forum-search-backfill-run-1",
        skipped: false,
      };
    },
    runEnsIdentitySyncOnce: async () => {
      identitySyncCalls += 1;
      return {
        syncRunId: "identity-sync-run-1",
        skipped: false,
      };
    },
    runOpsRetentionOnce: async () => {
      opsRetentionCalls += 1;
      return {
        retentionRunId: "retention-run-1",
        skipped: false,
      };
    },
  });

  t.after(async () => {
    await app.close();
  });

  const txWatcherResponse = await app.inject({
    method: "POST",
    url: "/api/internal/workers/tx-watcher/run",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
    payload: {
      limit: 5,
    },
  });

  const webhookRetryResponse = await app.inject({
    method: "POST",
    url: "/api/internal/workers/webhook-retry/run",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
    payload: {
      limit: 5,
    },
  });

  const identitySyncResponse = await app.inject({
    method: "POST",
    url: "/api/internal/workers/identity-sync/run",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
    payload: {
      limit: 5,
      staleMinutes: 60,
    },
  });

  const retentionResponse = await app.inject({
    method: "POST",
    url: "/api/internal/workers/ops-retention/run",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
    payload: {
      batchLimit: 25,
      processedRetentionDays: 7,
      deadLetterRetentionDays: 30,
    },
  });

  const forumSearchSyncResponse = await app.inject({
    method: "POST",
    url: "/api/internal/workers/forum-search-sync/run",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
    payload: {
      limit: 5,
    },
  });

  const forumSearchBackfillResponse = await app.inject({
    method: "POST",
    url: "/api/internal/workers/forum-search-backfill/run",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
    payload: {
      batchSize: 10,
      includePosts: true,
      includeComments: true,
    },
  });

  assert.equal(txWatcherResponse.statusCode, 200);
  assert.equal(identitySyncResponse.statusCode, 200);
  assert.equal(webhookRetryResponse.statusCode, 200);
  assert.equal(forumSearchSyncResponse.statusCode, 200);
  assert.equal(forumSearchBackfillResponse.statusCode, 200);
  assert.equal(retentionResponse.statusCode, 200);
  assert.equal(txWatcherCalls, 1);
  assert.equal(identitySyncCalls, 1);
  assert.equal(webhookRetryCalls, 1);
  assert.equal(forumSearchSyncCalls, 1);
  assert.equal(forumSearchBackfillCalls, 1);
  assert.equal(opsRetentionCalls, 1);
});

test("internal workers forum search status endpoint returns queue and runtime summary", async (t) => {
  const app = await buildInternalWorkersTestApp({
    getForumSearchSyncQueueStatusSummary: async () => ({
      pending: 10,
      processing: 2,
      failed: 3,
      deadLetter: 4,
      queueTotal: 19,
      activeTotal: 15,
      retryReady: 2,
      oldestActiveCreatedAt: new Date(Date.now() - 120_000),
      oldestDeadLetterCreatedAt: new Date(Date.now() - 240_000),
      generatedAt: new Date(),
    }),
    getOpsMetricsSnapshot: () => {
      const snapshot = createOpsMetricsSnapshot();
      snapshot.workerRunTotals["forum-search-sync"] = { completed: 7, skipped: 1, failed: 2 };
      snapshot.workerRunTotals["forum-search-backfill"] = { completed: 3, skipped: 0, failed: 1 };
      snapshot.workerSkipStreak["forum-search-sync"] = 1;
      snapshot.workerSkipStreak["forum-search-backfill"] = 0;
      return snapshot;
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/internal/workers/forum-search/status",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().worker, "forum-search");
  assert.equal(response.json().status.queue.retryReady, 2);
  assert.equal(response.json().status.runtime.runTotals.sync.completed, 7);
  assert.equal(response.json().status.runtime.runTotals.backfill.failed, 1);
});

test("internal workers forum search requeue endpoint forwards filters", async (t) => {
  let receivedInput: { limit?: number; targetType?: "post" | "comment"; targetIds?: string[]; dryRun?: boolean } | null = null;

  const app = await buildInternalWorkersTestApp({
    requeueForumSearchDeadLetterEntries: async (input) => {
      receivedInput = input ?? null;
      return {
        selected: 2,
        requeued: 2,
        wouldRequeue: 2,
        limit: input?.limit ?? 0,
        targetType: input?.targetType ?? null,
        dryRun: Boolean(input?.dryRun),
      };
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/internal/workers/forum-search/requeue-dead-letter",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
    payload: {
      limit: 25,
      targetType: "comment",
      targetIds: [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ],
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().worker, "forum-search-dead-letter-requeue");
  assert.deepEqual(receivedInput, {
    limit: 25,
    targetType: "comment",
    targetIds: [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ],
  });
});

test("internal workers forum search requeue endpoint supports dry-run mode", async (t) => {
  let receivedInput: { limit?: number; targetType?: "post" | "comment"; targetIds?: string[]; dryRun?: boolean } | null = null;

  const app = await buildInternalWorkersTestApp({
    requeueForumSearchDeadLetterEntries: async (input) => {
      receivedInput = input ?? null;
      return {
        selected: 4,
        requeued: 0,
        wouldRequeue: 4,
        limit: input?.limit ?? 0,
        targetType: input?.targetType ?? null,
        dryRun: Boolean(input?.dryRun),
      };
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/internal/workers/forum-search/requeue-dead-letter",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
    payload: {
      limit: 10,
      dryRun: true,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().run.dryRun, true);
  assert.equal(response.json().run.requeued, 0);
  assert.equal(response.json().run.wouldRequeue, 4);
  assert.deepEqual(receivedInput, {
    limit: 10,
    dryRun: true,
  });
});

test("internal workers forum search requeue endpoint writes completed audit event", async (t) => {
  let auditCall: {
    operation: string;
    outcome: "completed" | "failed";
    actor?: string | null;
    payload?: Record<string, unknown> | null;
    result?: Record<string, unknown> | null;
  } | null = null;

  const app = await buildInternalWorkersTestApp({
    requeueForumSearchDeadLetterEntries: async () => ({
      selected: 1,
      requeued: 1,
      wouldRequeue: 1,
      limit: 1,
      targetType: null,
      dryRun: false,
    }),
    recordInternalOpsAuditEvent: async (input) => {
      auditCall = input;
      return "audit-event-2";
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/internal/workers/forum-search/requeue-dead-letter",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
      "x-internal-actor": "release-bot",
    },
    payload: {
      limit: 1,
    },
  });

  assert.equal(response.statusCode, 200);
  if (!auditCall) {
    throw new Error("Expected audit call to be recorded");
  }
  const recordedAudit = auditCall as {
    operation: string;
    outcome: "completed" | "failed";
    actor?: string | null;
  };
  assert.equal(recordedAudit.operation, "forum-search-requeue-dead-letter");
  assert.equal(recordedAudit.outcome, "completed");
  assert.equal(recordedAudit.actor, "release-bot");
});

test("internal workers forum search pause endpoint updates control state", async (t) => {
  let receivedInput: { paused: boolean; reason?: string; pausedBy?: string } | null = null;

  const app = await buildInternalWorkersTestApp({
    setForumSearchPauseState: async (input) => {
      receivedInput = input;
      return {
        worker: "forum-search",
        paused: input.paused,
        pauseReason: input.reason ?? null,
        pausedBy: input.pausedBy ?? null,
        pausedAt: input.paused ? new Date() : null,
        updatedAt: new Date(),
      };
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/internal/workers/forum-search/pause",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
    payload: {
      paused: true,
      reason: "incident ongoing",
      pausedBy: "oncall",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().worker, "forum-search-pause");
  assert.equal(response.json().state.paused, true);
  assert.deepEqual(receivedInput, {
    paused: true,
    reason: "incident ongoing",
    pausedBy: "oncall",
  });
});

test("internal workers forum search cancel queue endpoint forwards filters", async (t) => {
  let receivedInput: {
    limit?: number;
    statuses?: Array<"pending" | "processing" | "failed" | "dead_letter">;
    dryRun?: boolean;
  } | null = null;

  const app = await buildInternalWorkersTestApp({
    cancelForumSearchQueueEntries: async (input) => {
      receivedInput = input ?? null;
      return {
        selected: 3,
        cancelled: 3,
        wouldCancel: 3,
        limit: input?.limit ?? 0,
        statuses: input?.statuses ?? ["pending", "processing", "failed"],
        dryRun: Boolean(input?.dryRun),
      };
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/internal/workers/forum-search/cancel-queue",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
    payload: {
      limit: 100,
      statuses: ["pending", "failed"],
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().worker, "forum-search-cancel-queue");
  assert.deepEqual(receivedInput, {
    limit: 100,
    statuses: ["pending", "failed"],
  });
});

test("internal workers forum search cancel queue endpoint supports dry-run mode", async (t) => {
  let receivedInput: {
    limit?: number;
    statuses?: Array<"pending" | "processing" | "failed" | "dead_letter">;
    dryRun?: boolean;
  } | null = null;

  const app = await buildInternalWorkersTestApp({
    cancelForumSearchQueueEntries: async (input) => {
      receivedInput = input ?? null;
      return {
        selected: 7,
        cancelled: 0,
        wouldCancel: 7,
        limit: input?.limit ?? 0,
        statuses: input?.statuses ?? ["pending", "processing", "failed"],
        dryRun: Boolean(input?.dryRun),
      };
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/internal/workers/forum-search/cancel-queue",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
    payload: {
      limit: 5,
      statuses: ["failed"],
      dryRun: true,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().run.dryRun, true);
  assert.equal(response.json().run.cancelled, 0);
  assert.equal(response.json().run.wouldCancel, 7);
  assert.deepEqual(receivedInput, {
    limit: 5,
    statuses: ["failed"],
    dryRun: true,
  });
});

test("internal workers forum search audit endpoint lists audit events", async (t) => {
  const app = await buildInternalWorkersTestApp({
    listInternalOpsAuditEvents: async () => [
      {
        id: "audit-event-1",
        operation: "forum-search-requeue-dead-letter",
        outcome: "completed",
        actor: "oncall",
        requestMethod: "POST",
        requestPath: "/api/internal/workers/forum-search/requeue-dead-letter",
        payload: { dryRun: true },
        result: { wouldRequeue: 10 },
        errorCode: null,
        errorMessage: null,
        createdAt: new Date(),
      },
    ],
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/internal/workers/forum-search/audit?limit=20",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().worker, "forum-search-audit");
  assert.equal(response.json().events.length, 1);
  assert.equal(response.json().events[0].operation, "forum-search-requeue-dead-letter");
});

test("internal workers forum search reindex endpoint orchestrates backfill and sync", async (t) => {
  let receivedBackfillInput: { batchSize?: number; includePosts?: boolean; includeComments?: boolean } | null = null;
  let receivedSyncInput: { limit?: number } | null = null;

  const app = await buildInternalWorkersTestApp({
    runForumSearchBackfillOnce: async (_app, input) => {
      receivedBackfillInput = input ?? null;
      return {
        backfillRunId: "forum-search-backfill-run-2",
        skipped: false,
      };
    },
    runForumSearchSyncOnce: async (_app, input) => {
      receivedSyncInput = input ?? null;
      return {
        syncRunId: "forum-search-sync-run-2",
        skipped: false,
      };
    },
    getForumSearchSyncQueueStatusSummary: async () => ({
      pending: 1,
      processing: 0,
      failed: 0,
      deadLetter: 0,
      queueTotal: 1,
      activeTotal: 1,
      retryReady: 0,
      oldestActiveCreatedAt: new Date(),
      oldestDeadLetterCreatedAt: null,
      generatedAt: new Date(),
    }),
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/internal/workers/forum-search/reindex",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
    payload: {
      batchSize: 20,
      includePosts: true,
      includeComments: false,
      syncLimit: 10,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().worker, "forum-search-reindex");
  assert.deepEqual(receivedBackfillInput, {
    batchSize: 20,
    includePosts: true,
    includeComments: false,
  });
  assert.deepEqual(receivedSyncInput, {
    limit: 10,
  });
});

test("internal workers forum search reindex endpoint rejects while paused", async (t) => {
  const app = await buildInternalWorkersTestApp({
    getForumSearchControlState: async () => ({
      worker: "forum-search",
      paused: true,
      pauseReason: "incident",
      pausedBy: "oncall",
      pausedAt: new Date(),
      updatedAt: new Date(),
    }),
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/internal/workers/forum-search/reindex",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
    payload: {},
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, "FORUM_SEARCH_PAUSED");
});

test("internal workers forum search requeue endpoint is rate limited", async (t) => {
  let calls = 0;
  const claimCounts = new Map<string, number>();

  const app = await buildInternalWorkersTestApp({
    claimInternalOpsCooldown: async ({ operation, cooldownMs }) => {
      const nextCount = (claimCounts.get(operation) ?? 0) + 1;
      claimCounts.set(operation, nextCount);

      if (nextCount > 1) {
        return {
          allowed: false,
          retryAfterMs: cooldownMs,
          nextAllowedAt: new Date(Date.now() + cooldownMs),
        };
      }

      return {
        allowed: true,
        retryAfterMs: 0,
        nextAllowedAt: new Date(Date.now() + cooldownMs),
      };
    },
    requeueForumSearchDeadLetterEntries: async () => {
      calls += 1;
      return {
        selected: 0,
        requeued: 0,
        wouldRequeue: 0,
        limit: 1,
        targetType: null,
        dryRun: false,
      };
    },
  });

  t.after(async () => {
    await app.close();
  });

  const first = await app.inject({
    method: "POST",
    url: "/api/internal/workers/forum-search/requeue-dead-letter",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
    payload: {},
  });

  const second = await app.inject({
    method: "POST",
    url: "/api/internal/workers/forum-search/requeue-dead-letter",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
    payload: {},
  });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 429);
  assert.equal(second.json().code, "INTERNAL_OPS_RATE_LIMITED");
  assert.equal(calls, 1);
});

test("internal workers forum search reindex endpoint is rate limited", async (t) => {
  let backfillCalls = 0;
  const claimCounts = new Map<string, number>();

  const app = await buildInternalWorkersTestApp({
    claimInternalOpsCooldown: async ({ operation, cooldownMs }) => {
      const nextCount = (claimCounts.get(operation) ?? 0) + 1;
      claimCounts.set(operation, nextCount);

      if (nextCount > 1) {
        return {
          allowed: false,
          retryAfterMs: cooldownMs,
          nextAllowedAt: new Date(Date.now() + cooldownMs),
        };
      }

      return {
        allowed: true,
        retryAfterMs: 0,
        nextAllowedAt: new Date(Date.now() + cooldownMs),
      };
    },
    runForumSearchBackfillOnce: async () => {
      backfillCalls += 1;
      return {
        backfillRunId: "forum-search-backfill-run-3",
        skipped: false,
      };
    },
    runForumSearchSyncOnce: async () => ({
      syncRunId: "forum-search-sync-run-3",
      skipped: false,
    }),
    getForumSearchSyncQueueStatusSummary: async () => ({
      pending: 0,
      processing: 0,
      failed: 0,
      deadLetter: 0,
      queueTotal: 0,
      activeTotal: 0,
      retryReady: 0,
      oldestActiveCreatedAt: null,
      oldestDeadLetterCreatedAt: null,
      generatedAt: new Date(),
    }),
  });

  t.after(async () => {
    await app.close();
  });

  const first = await app.inject({
    method: "POST",
    url: "/api/internal/workers/forum-search/reindex",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
    payload: {},
  });

  const second = await app.inject({
    method: "POST",
    url: "/api/internal/workers/forum-search/reindex",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
    payload: {},
  });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 429);
  assert.equal(second.json().code, "INTERNAL_OPS_RATE_LIMITED");
  assert.equal(backfillCalls, 1);
});

test("internal workers forum search cancel queue endpoint is rate limited", async (t) => {
  const claimCounts = new Map<string, number>();
  let cancelCalls = 0;

  const app = await buildInternalWorkersTestApp({
    claimInternalOpsCooldown: async ({ operation, cooldownMs }) => {
      const nextCount = (claimCounts.get(operation) ?? 0) + 1;
      claimCounts.set(operation, nextCount);

      if (nextCount > 1) {
        return {
          allowed: false,
          retryAfterMs: cooldownMs,
          nextAllowedAt: new Date(Date.now() + cooldownMs),
        };
      }

      return {
        allowed: true,
        retryAfterMs: 0,
        nextAllowedAt: new Date(Date.now() + cooldownMs),
      };
    },
    cancelForumSearchQueueEntries: async () => {
      cancelCalls += 1;
      return {
        selected: 1,
        cancelled: 1,
        wouldCancel: 1,
        limit: 1,
        statuses: ["pending"],
        dryRun: false,
      };
    },
  });

  t.after(async () => {
    await app.close();
  });

  const first = await app.inject({
    method: "POST",
    url: "/api/internal/workers/forum-search/cancel-queue",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
    payload: {},
  });

  const second = await app.inject({
    method: "POST",
    url: "/api/internal/workers/forum-search/cancel-queue",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
    payload: {},
  });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 429);
  assert.equal(second.json().code, "INTERNAL_OPS_RATE_LIMITED");
  assert.equal(cancelCalls, 1);
});

test("internal forum MVP status endpoint returns checklist summary", async (t) => {
  const app = await buildInternalWorkersTestApp({
    getForumMvpStatusSummary: async () => {
      const summary = createForumMvpStatusSummary();
      summary.completed = 16;
      summary.partial = 2;
      summary.total = 18;
      summary.readinessPercent = 94;
      summary.checklist = [
        {
          key: "post_crud",
          label: "Create/update/delete post",
          status: "complete",
          note: "ready",
        },
      ];
      return summary;
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/internal/forum/mvp/status",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().scope, "forum-mvp");
  assert.equal(response.json().status.completed, 16);
  assert.equal(response.json().status.readinessPercent, 94);
  assert.equal(response.json().status.checklist[0].key, "post_crud");
});

test("internal workers route returns worker status summary", async (t) => {
  const app = await buildInternalWorkersTestApp({
    getInternalWorkerStatusSummary: async () => ({
      intents: {
        prepared: 1,
        committed: 2,
        registerable: 3,
        registered: 4,
        expired: 5,
        failed: 6,
        stuckTotal: 6,
      },
      webhooks: {
        processing: 1,
        processed: 2,
        failed: 3,
        deadLetter: 4,
        retryReady: 3,
      },
      forumSearchSync: {
        pending: 5,
        processing: 4,
        failed: 3,
        deadLetter: 2,
      },
      generatedAt: new Date(),
    }),
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/internal/workers/status",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().acknowledged, true);
  assert.equal(response.json().status.intents.stuckTotal, 6);
  assert.equal(response.json().status.webhooks.deadLetter, 4);
  assert.equal(response.json().status.forumSearchSync.deadLetter, 2);
});
