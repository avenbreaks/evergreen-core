import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import { eq, inArray, sql } from "drizzle-orm";

const DEFAULT_DATABASE_URL = "postgresql://devparty:devparty@localhost:5436/devpartydb";

const ensureIntegrationEnv = (): void => {
  process.env.DATABASE_URL ??= DEFAULT_DATABASE_URL;
  process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-0123456789abcdef";
  process.env.BETTER_AUTH_URL ??= "http://localhost:3001";
  process.env.BETTER_AUTH_TRUSTED_ORIGINS ??= "http://localhost:3000,http://localhost:3001";
  process.env.WEBHOOK_RETRY_MAX_ATTEMPTS ??= "2";
  process.env.WEBHOOK_RETRY_BASE_DELAY_MS ??= "10";
  process.env.WEBHOOK_RETRY_MAX_DELAY_MS ??= "100";
};

const canConnectToDatabase = async (): Promise<boolean> => {
  ensureIntegrationEnv();

  try {
    const { authDb } = await import("@evergreen-devparty/auth");
    await authDb.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
};

const buildHex = (seed: string): string => `0x${seed.repeat(64).slice(0, 64)}`;

const buildIntentHex = (intentId: string): string => {
  const hashed = createHash("sha256").update(intentId).digest("hex");
  return `0x${hashed}`;
};

const createBaseIntent = (input: { intentId: string; userId: string; labelSuffix: string; now: Date }) => ({
  id: input.intentId,
  userId: input.userId,
  chainId: 131,
  walletAddress: "0x1111111111111111111111111111111111111111",
  tld: "dev",
  label: `webhook-${input.labelSuffix}`,
  domainName: `webhook-${input.labelSuffix}.dev`,
  durationSeconds: 31536000,
  resolverAddress: "0x47e9cbbd0ee572d996ffd0d7aa17796c5a247590",
  controllerAddress: "0x00a4c7ff46ab778d8333421d42715db2aa6b1b4d",
  baseRegistrarAddress: "0xe077dc5c0a336f76662f024d98c0f20be0ad9d1c",
  secretHash: buildIntentHex(input.intentId),
  commitment: buildIntentHex(`${input.intentId}-commit`),
  minCommitmentAgeSeconds: 60,
  maxCommitmentAgeSeconds: 86400,
  status: "prepared" as const,
  createdAt: input.now,
  updatedAt: input.now,
});

test("reserveRetryableWebhookEvents claims due failed webhook events", async (t) => {
  if (!(await canConnectToDatabase())) {
    t.skip("integration database is not available");
    return;
  }

  const [{ authDb }, { schema }, { reserveRetryableWebhookEvents }] = await Promise.all([
    import("@evergreen-devparty/auth"),
    import("@evergreen-devparty/db"),
    import("../../../src/services/ens-webhook-events"),
  ]);

  const userId = randomUUID();
  const intentId = randomUUID();
  const eventId = randomUUID();
  const now = new Date();

  t.after(async () => {
    await authDb.delete(schema.ensWebhookEvents).where(eq(schema.ensWebhookEvents.id, eventId));
    await authDb.delete(schema.ensPurchaseIntents).where(eq(schema.ensPurchaseIntents.id, intentId));
    await authDb.delete(schema.users).where(eq(schema.users.id, userId));
  });

  await authDb.insert(schema.users).values({
    id: userId,
    email: `integration-${userId}@example.com`,
    name: "Integration Test User",
  });

  await authDb.insert(schema.ensPurchaseIntents).values(createBaseIntent({
    intentId,
    userId,
    labelSuffix: intentId.slice(0, 8),
    now,
  }));

  await authDb.insert(schema.ensWebhookEvents).values({
    id: eventId,
    intentId,
    eventType: "ens.commit.confirmed",
    dedupeKey: `retryable:${eventId}`,
    payload: {
      event: "ens.commit.confirmed",
      data: {
        intentId,
        txHash: buildHex("1"),
      },
    },
    status: "failed",
    attemptCount: 1,
    nextRetryAt: new Date(Date.now() - 60_000),
    createdAt: now,
    updatedAt: now,
  });

  const reserved = await reserveRetryableWebhookEvents({
    limit: 10,
  });

  assert.equal(reserved.length, 1);
  assert.equal(reserved[0]?.id, eventId);
  assert.equal(reserved[0]?.status, "processing");
  assert.equal(reserved[0]?.attemptCount, 2);
  assert.equal(reserved[0]?.nextRetryAt, null);
});

test("markWebhookEventFailed sends event to dead letter after max attempts", async (t) => {
  if (!(await canConnectToDatabase())) {
    t.skip("integration database is not available");
    return;
  }

  const [{ authDb }, { schema }, { markWebhookEventFailed }] = await Promise.all([
    import("@evergreen-devparty/auth"),
    import("@evergreen-devparty/db"),
    import("../../../src/services/ens-webhook-events"),
  ]);

  const userId = randomUUID();
  const intentId = randomUUID();
  const firstEventId = randomUUID();
  const secondEventId = randomUUID();
  const now = new Date();

  t.after(async () => {
    await authDb
      .delete(schema.ensWebhookEvents)
      .where(inArray(schema.ensWebhookEvents.id, [firstEventId, secondEventId]));
    await authDb.delete(schema.ensPurchaseIntents).where(eq(schema.ensPurchaseIntents.id, intentId));
    await authDb.delete(schema.users).where(eq(schema.users.id, userId));
  });

  await authDb.insert(schema.users).values({
    id: userId,
    email: `integration-${userId}@example.com`,
    name: "Integration Test User",
  });

  await authDb.insert(schema.ensPurchaseIntents).values(createBaseIntent({
    intentId,
    userId,
    labelSuffix: intentId.slice(0, 8),
    now,
  }));

  await authDb.insert(schema.ensWebhookEvents).values([
    {
      id: firstEventId,
      intentId,
      eventType: "ens.commit.confirmed",
      dedupeKey: `failed:${firstEventId}`,
      payload: {
        event: "ens.commit.confirmed",
        data: {
          intentId,
          txHash: buildHex("2"),
        },
      },
      status: "processing",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: secondEventId,
      intentId,
      eventType: "ens.commit.confirmed",
      dedupeKey: `dead:${secondEventId}`,
      payload: {
        event: "ens.commit.confirmed",
        data: {
          intentId,
          txHash: buildHex("3"),
        },
      },
      status: "processing",
      attemptCount: 2,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  const retriable = await markWebhookEventFailed({
    webhookEventId: firstEventId,
    code: "TEST_RETRY",
    message: "first failure",
  });

  assert.equal(retriable.status, "failed");
  assert.ok(retriable.nextRetryAt);
  assert.equal(retriable.deadLetteredAt, null);

  const deadLettered = await markWebhookEventFailed({
    webhookEventId: secondEventId,
    code: "TEST_DLQ",
    message: "final failure",
  });

  assert.equal(deadLettered.status, "dead_letter");
  assert.equal(deadLettered.nextRetryAt, null);
  assert.ok(deadLettered.deadLetteredAt);
});
