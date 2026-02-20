import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import { HttpError } from "../lib/http-error";
import type { OpsMetricsSnapshot } from "../services/ops-metrics";
import type {
  ForumSearchSyncQueueStatusSummary,
  RequeueForumSearchDeadLetterResult,
} from "../services/forum-search-sync-queue";

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
  requeueForumSearchDeadLetterEntries: (input?: {
    limit?: number;
    targetType?: "post" | "comment";
    targetIds?: string[];
  }) => Promise<RequeueForumSearchDeadLetterResult>;
  runForumSearchBackfillOnce: (
    _app: unknown,
    input?: { batchSize?: number; includePosts?: boolean; includeComments?: boolean }
  ) => Promise<unknown>;
  runOpsRetentionOnce: (
    _app: unknown,
    input?: { batchLimit?: number; processedRetentionDays?: number; deadLetterRetentionDays?: number }
  ) => Promise<unknown>;
  getInternalWorkerStatusSummary: () => Promise<unknown>;
  getOpsMetricsSnapshot: () => OpsMetricsSnapshot;
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
    requeueForumSearchDeadLetterEntries: unexpected("requeueForumSearchDeadLetterEntries"),
    runForumSearchBackfillOnce: unexpected("runForumSearchBackfillOnce"),
    runOpsRetentionOnce: unexpected("runOpsRetentionOnce"),
    getInternalWorkerStatusSummary: unexpected("getInternalWorkerStatusSummary"),
    getOpsMetricsSnapshot: () => {
      throw new Error("Unexpected dependency call: getOpsMetricsSnapshot");
    },
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
  let receivedInput: { limit?: number; targetType?: "post" | "comment"; targetIds?: string[] } | null = null;

  const app = await buildInternalWorkersTestApp({
    requeueForumSearchDeadLetterEntries: async (input) => {
      receivedInput = input ?? null;
      return {
        selected: 2,
        requeued: 2,
        limit: input?.limit ?? 0,
        targetType: input?.targetType ?? null,
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
