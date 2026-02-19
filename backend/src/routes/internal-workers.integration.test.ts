import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import { HttpError } from "../lib/http-error";

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
  runOpsRetentionOnce: (
    _app: unknown,
    input?: { batchLimit?: number; processedRetentionDays?: number; deadLetterRetentionDays?: number }
  ) => Promise<unknown>;
  getInternalWorkerStatusSummary: () => Promise<unknown>;
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
    runOpsRetentionOnce: unexpected("runOpsRetentionOnce"),
    getInternalWorkerStatusSummary: unexpected("getInternalWorkerStatusSummary"),
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

test("internal workers route triggers tx watcher, identity sync, webhook retry, forum search sync, and ops retention", async (t) => {
  let txWatcherCalls = 0;
  let identitySyncCalls = 0;
  let webhookRetryCalls = 0;
  let forumSearchSyncCalls = 0;
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

  assert.equal(txWatcherResponse.statusCode, 200);
  assert.equal(identitySyncResponse.statusCode, 200);
  assert.equal(webhookRetryResponse.statusCode, 200);
  assert.equal(forumSearchSyncResponse.statusCode, 200);
  assert.equal(retentionResponse.statusCode, 200);
  assert.equal(txWatcherCalls, 1);
  assert.equal(identitySyncCalls, 1);
  assert.equal(webhookRetryCalls, 1);
  assert.equal(forumSearchSyncCalls, 1);
  assert.equal(opsRetentionCalls, 1);
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
