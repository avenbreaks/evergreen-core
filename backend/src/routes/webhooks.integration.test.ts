import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import Fastify from "fastify";

import { HttpError } from "../lib/http-error";

const WEBHOOK_SECRET = "test-webhook-secret";
const INTENT_ID = "11111111-1111-4111-8111-111111111111";
const TX_HASH_ONE = `0x${"1".repeat(64)}`;
const TX_HASH_TWO = `0x${"2".repeat(64)}`;

process.env.WEBHOOK_ACTIVE_SECRET = WEBHOOK_SECRET;
process.env.WEBHOOK_IP_ALLOWLIST = "";
process.env.WEBHOOK_SIGNATURE_TTL_SECONDS = "300";

const buildSignedWebhookHeaders = (payload: unknown, timestamp = Math.floor(Date.now() / 1000)): Record<string, string> => {
  const signature = createHmac("sha256", WEBHOOK_SECRET)
    .update(`${timestamp}.${JSON.stringify(payload)}`)
    .digest("hex");

  return {
    "x-webhook-timestamp": String(timestamp),
    "x-webhook-signature": `sha256=${signature}`,
  };
};

test("webhook rejects expired timestamp signature", async (t) => {
  const app = await buildWebhookTestApp();

  t.after(async () => {
    await app.close();
  });

  const payload = {
    event: "ens.commit.confirmed",
    data: {
      intentId: INTENT_ID,
      txHash: TX_HASH_ONE,
    },
  };

  const response = await app.inject({
    method: "POST",
    url: "/api/webhooks/ens/tx",
    headers: buildSignedWebhookHeaders(payload, Math.floor(Date.now() / 1000) - 3600),
    payload,
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().code, "WEBHOOK_SIGNATURE_EXPIRED");
});

const buildDeps = (overrides: Record<string, unknown>) => {
  const unexpected = (name: string) => {
    throw new Error(`Unexpected dependency call: ${name}`);
  };

  return {
    reserveWebhookEvent: async () => unexpected("reserveWebhookEvent"),
    markWebhookEventProcessed: async () => unexpected("markWebhookEventProcessed"),
    markWebhookEventFailed: async () => unexpected("markWebhookEventFailed"),
    confirmCommitmentIntentByIntentId: async () => unexpected("confirmCommitmentIntentByIntentId"),
    confirmRegisterTransactionByIntentId: async () => unexpected("confirmRegisterTransactionByIntentId"),
    markPurchaseIntentFailed: async () => unexpected("markPurchaseIntentFailed"),
    ...overrides,
  };
};

const buildWebhookTestApp = async (depsOverrides: Record<string, unknown> = {}) => {
  const { webhookRoutes } = await import("./webhooks");
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

  await app.register(webhookRoutes, {
    disableDebounce: true,
    deps: buildDeps(depsOverrides),
  });

  return app;
};

test("webhook duplicate processed returns cached outcome", async (t) => {
  let reserveCalls = 0;
  let commitCalls = 0;
  let processedCalls = 0;

  const app = await buildWebhookTestApp({
    reserveWebhookEvent: async () => {
      reserveCalls += 1;

      if (reserveCalls === 1) {
        return {
          state: "reserved",
          event: { id: "evt-1" },
        };
      }

      return {
        state: "duplicate_processed",
        event: {
          id: "evt-1",
          result: {
            acknowledged: true,
            event: "ens.commit.confirmed",
            intent: { id: INTENT_ID, status: "committed" },
          },
        },
      };
    },
    confirmCommitmentIntentByIntentId: async () => {
      commitCalls += 1;
      return {
        intent: {
          id: INTENT_ID,
          status: "committed",
        },
      };
    },
    markWebhookEventProcessed: async () => {
      processedCalls += 1;
    },
  });

  t.after(async () => {
    await app.close();
  });

  const payload = {
    event: "ens.commit.confirmed",
    data: {
      intentId: INTENT_ID,
      txHash: TX_HASH_ONE,
    },
  };

  const first = await app.inject({
    method: "POST",
    url: "/api/webhooks/ens/tx",
    headers: buildSignedWebhookHeaders(payload),
    payload,
  });

  assert.equal(first.statusCode, 200);
  assert.equal(first.json().acknowledged, true);

  const second = await app.inject({
    method: "POST",
    url: "/api/webhooks/ens/tx",
    headers: buildSignedWebhookHeaders(payload),
    payload,
  });

  assert.equal(second.statusCode, 200);
  assert.equal(second.json().deduplicated, true);
  assert.equal(second.json().event, "ens.commit.confirmed");
  assert.equal(second.json().intentId, INTENT_ID);
  assert.equal(commitCalls, 1);
  assert.equal(processedCalls, 1);
});

test("webhook retry after previous failure is processed successfully", async (t) => {
  let reserveCalls = 0;
  let commitCalls = 0;
  const failedCodes: string[] = [];
  let processedCalls = 0;

  const app = await buildWebhookTestApp({
    reserveWebhookEvent: async () => {
      reserveCalls += 1;
      return {
        state: "reserved",
        event: { id: `evt-${reserveCalls}` },
      };
    },
    confirmCommitmentIntentByIntentId: async () => {
      commitCalls += 1;

      if (commitCalls === 1) {
        throw new HttpError(409, "COMMIT_TX_FAILED", "Commit transaction failed on-chain");
      }

      return {
        intent: {
          id: INTENT_ID,
          status: "committed",
        },
      };
    },
    markWebhookEventFailed: async (input: { code: string }) => {
      failedCodes.push(input.code);
    },
    markWebhookEventProcessed: async () => {
      processedCalls += 1;
    },
  });

  t.after(async () => {
    await app.close();
  });

  const payload = {
    event: "ens.commit.confirmed",
    data: {
      intentId: INTENT_ID,
      txHash: TX_HASH_ONE,
    },
  };

  const failedAttempt = await app.inject({
    method: "POST",
    url: "/api/webhooks/ens/tx",
    headers: buildSignedWebhookHeaders(payload),
    payload,
  });

  assert.equal(failedAttempt.statusCode, 409);
  assert.equal(failedAttempt.json().code, "COMMIT_TX_FAILED");

  const retryAttempt = await app.inject({
    method: "POST",
    url: "/api/webhooks/ens/tx",
    headers: buildSignedWebhookHeaders(payload),
    payload,
  });

  assert.equal(retryAttempt.statusCode, 200);
  assert.equal(retryAttempt.json().acknowledged, true);
  assert.equal(commitCalls, 2);
  assert.deepEqual(failedCodes, ["COMMIT_TX_FAILED"]);
  assert.equal(processedCalls, 1);
});

test("webhook register confirmed persists processed transition", async (t) => {
  let processedResult: unknown = null;

  const app = await buildWebhookTestApp({
    reserveWebhookEvent: async () => ({
      state: "reserved",
      event: { id: "evt-register" },
    }),
    confirmRegisterTransactionByIntentId: async () => ({
      domain: {
        id: "domain-1",
        name: "alice.dev",
        status: "active",
      },
      registerTxHash: TX_HASH_TWO,
    }),
    markWebhookEventProcessed: async (input: { result: unknown }) => {
      processedResult = input.result;
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/webhooks/ens/tx",
    headers: buildSignedWebhookHeaders({
      event: "ens.register.confirmed",
      data: {
        intentId: INTENT_ID,
        txHash: TX_HASH_TWO,
        setPrimary: true,
      },
    }),
    payload: {
      event: "ens.register.confirmed",
      data: {
        intentId: INTENT_ID,
        txHash: TX_HASH_TWO,
        setPrimary: true,
      },
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().event, "ens.register.confirmed");
  assert.equal(response.json().registerTxHash, TX_HASH_TWO);
  assert.deepEqual(processedResult, response.json());
});
