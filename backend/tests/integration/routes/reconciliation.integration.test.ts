import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import { HttpError } from "../../../src/lib/http-error";

const INTERNAL_SECRET = "test-internal-secret";

process.env.INTERNAL_OPS_ACTIVE_SECRET = INTERNAL_SECRET;
process.env.WEBHOOK_IP_ALLOWLIST = "";

type ReconcileInput = {
  limit?: number;
  staleMinutes?: number;
  dryRun?: boolean;
};

type ReconcileResult = {
  scanned: number;
  updated: number;
  expired: number;
  promotedToRegisterable: number;
  unchanged: number;
  dryRun: boolean;
  staleMinutes: number;
  intents: Array<{
    intentId: string;
    domainName: string;
    previousStatus: string;
    nextStatus: string;
    reason: string;
  }>;
  startedAt: Date;
  finishedAt: Date;
};

type ReconciliationDependencies = {
  reconcileStalePurchaseIntents: (input: ReconcileInput) => Promise<ReconcileResult>;
};

const buildDeps = (overrides: Partial<ReconciliationDependencies> = {}): ReconciliationDependencies => {
  const unexpected = async () => {
    throw new Error("Unexpected dependency call: reconcileStalePurchaseIntents");
  };

  return {
    reconcileStalePurchaseIntents: unexpected,
    ...overrides,
  };
};

const buildReconciliationTestApp = async (depsOverrides: Partial<ReconciliationDependencies> = {}) => {
  const { reconciliationRoutes } = await import("../../../src/routes/reconciliation");
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

  await app.register(reconciliationRoutes, {
    deps: buildDeps(depsOverrides),
  });

  return app;
};

test("reconciliation route rejects invalid webhook secret", async (t) => {
  const app = await buildReconciliationTestApp();

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/internal/ens/reconcile",
    headers: {
      "x-internal-secret": "invalid-secret",
    },
    payload: {},
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().code, "INTERNAL_OPS_UNAUTHORIZED");
});

test("reconciliation route forwards dry-run parameters", async (t) => {
  let receivedInput: ReconcileInput | null = null;

  const app = await buildReconciliationTestApp({
    reconcileStalePurchaseIntents: async (input) => {
      receivedInput = input;

      const now = new Date();
      return {
        scanned: 0,
        updated: 0,
        expired: 0,
        promotedToRegisterable: 0,
        unchanged: 0,
        dryRun: true,
        staleMinutes: input.staleMinutes ?? 15,
        intents: [],
        startedAt: now,
        finishedAt: now,
      };
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/internal/ens/reconcile",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
    payload: {
      limit: 12,
      staleMinutes: 45,
      dryRun: true,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().acknowledged, true);
  assert.equal(response.json().dryRun, true);
  assert.equal(response.json().updated, 0);
  assert.deepEqual(receivedInput, {
    limit: 12,
    staleMinutes: 45,
    dryRun: true,
  });
});

test("reconciliation route returns committed to registerable transition", async (t) => {
  const app = await buildReconciliationTestApp({
    reconcileStalePurchaseIntents: async () => {
      const now = new Date();
      return {
        scanned: 1,
        updated: 1,
        expired: 0,
        promotedToRegisterable: 1,
        unchanged: 0,
        dryRun: false,
        staleMinutes: 15,
        intents: [
          {
            intentId: "intent-promote-1",
            domainName: "alice.dev",
            previousStatus: "committed",
            nextStatus: "registerable",
            reason: "Intent promoted to registerable by reconciliation",
          },
        ],
        startedAt: now,
        finishedAt: now,
      };
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/internal/ens/reconcile",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
    payload: {},
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().promotedToRegisterable, 1);
  assert.equal(response.json().intents[0].nextStatus, "registerable");
});

test("reconciliation route returns expired transition", async (t) => {
  const app = await buildReconciliationTestApp({
    reconcileStalePurchaseIntents: async () => {
      const now = new Date();
      return {
        scanned: 1,
        updated: 1,
        expired: 1,
        promotedToRegisterable: 0,
        unchanged: 0,
        dryRun: false,
        staleMinutes: 15,
        intents: [
          {
            intentId: "intent-expired-1",
            domainName: "expired.dev",
            previousStatus: "registerable",
            nextStatus: "expired",
            reason: "Commitment window expired during reconciliation",
          },
        ],
        startedAt: now,
        finishedAt: now,
      };
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/internal/ens/reconcile",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
    payload: {},
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().expired, 1);
  assert.equal(response.json().intents[0].nextStatus, "expired");
});
