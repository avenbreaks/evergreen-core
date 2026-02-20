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

const buildHex = (seed: string): string => `0x${createHash("sha256").update(seed).digest("hex")}`;

const createBaseIntent = (input: { intentId: string; userId: string; now: Date }) => ({
  id: input.intentId,
  userId: input.userId,
  chainId: 131,
  walletAddress: "0x1111111111111111111111111111111111111111",
  tld: "dev",
  label: `retention-${input.intentId.slice(0, 8)}`,
  domainName: `retention-${input.intentId.slice(0, 8)}.dev`,
  durationSeconds: 31536000,
  resolverAddress: "0x47e9cbbd0ee572d996ffd0d7aa17796c5a247590",
  controllerAddress: "0x00a4c7ff46ab778d8333421d42715db2aa6b1b4d",
  baseRegistrarAddress: "0xe077dc5c0a336f76662f024d98c0f20be0ad9d1c",
  secretHash: buildHex(`${input.intentId}:secret`),
  commitment: buildHex(`${input.intentId}:commit`),
  minCommitmentAgeSeconds: 60,
  maxCommitmentAgeSeconds: 86400,
  status: "prepared" as const,
  createdAt: input.now,
  updatedAt: input.now,
});

test("runOpsRetention deletes old processed and dead letter webhook events", async (t) => {
  if (!(await canConnectToDatabase())) {
    t.skip("integration database is not available");
    return;
  }

  const [{ authDb }, { schema }, { runOpsRetention }] = await Promise.all([
    import("@evergreen-devparty/auth"),
    import("@evergreen-devparty/db"),
    import("../../../src/services/ops-retention"),
  ]);

  const userId = randomUUID();
  const intentId = randomUUID();
  const oldProcessedId = randomUUID();
  const recentProcessedId = randomUUID();
  const oldDeadLetterId = randomUUID();
  const recentDeadLetterId = randomUUID();
  const oldAuditEventId = randomUUID();
  const recentAuditEventId = randomUUID();
  const now = new Date();
  const oldTimestamp = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
  const recentTimestamp = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  t.after(async () => {
    await authDb
      .delete(schema.ensWebhookEvents)
      .where(inArray(schema.ensWebhookEvents.id, [oldProcessedId, recentProcessedId, oldDeadLetterId, recentDeadLetterId]));
    await authDb
      .delete(schema.internalOpsAuditEvents)
      .where(inArray(schema.internalOpsAuditEvents.id, [oldAuditEventId, recentAuditEventId]));
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
    now,
  }));

  await authDb.insert(schema.ensWebhookEvents).values([
    {
      id: oldProcessedId,
      intentId,
      eventType: "ens.commit.confirmed",
      dedupeKey: `old-processed:${oldProcessedId}`,
      payload: {},
      status: "processed",
      attemptCount: 1,
      processedAt: oldTimestamp,
      createdAt: oldTimestamp,
      updatedAt: oldTimestamp,
    },
    {
      id: recentProcessedId,
      intentId,
      eventType: "ens.commit.confirmed",
      dedupeKey: `recent-processed:${recentProcessedId}`,
      payload: {},
      status: "processed",
      attemptCount: 1,
      processedAt: recentTimestamp,
      createdAt: recentTimestamp,
      updatedAt: recentTimestamp,
    },
    {
      id: oldDeadLetterId,
      intentId,
      eventType: "ens.commit.confirmed",
      dedupeKey: `old-dead:${oldDeadLetterId}`,
      payload: {},
      status: "dead_letter",
      attemptCount: 5,
      deadLetteredAt: oldTimestamp,
      createdAt: oldTimestamp,
      updatedAt: oldTimestamp,
    },
    {
      id: recentDeadLetterId,
      intentId,
      eventType: "ens.commit.confirmed",
      dedupeKey: `recent-dead:${recentDeadLetterId}`,
      payload: {},
      status: "dead_letter",
      attemptCount: 5,
      deadLetteredAt: recentTimestamp,
      createdAt: recentTimestamp,
      updatedAt: recentTimestamp,
    },
  ]);

  await authDb.insert(schema.internalOpsAuditEvents).values([
    {
      id: oldAuditEventId,
      operation: "forum-search-requeue-dead-letter",
      outcome: "completed",
      actor: "integration-test",
      requestMethod: "POST",
      requestPath: "/api/internal/workers/forum-search/requeue-dead-letter",
      payload: { dryRun: false },
      result: { requeued: 1 },
      createdAt: oldTimestamp,
    },
    {
      id: recentAuditEventId,
      operation: "forum-search-cancel-queue",
      outcome: "completed",
      actor: "integration-test",
      requestMethod: "POST",
      requestPath: "/api/internal/workers/forum-search/cancel-queue",
      payload: { dryRun: true },
      result: { wouldCancel: 1 },
      createdAt: recentTimestamp,
    },
  ]);

  const result = await runOpsRetention({
    batchLimit: 100,
    processedRetentionDays: 7,
    deadLetterRetentionDays: 7,
    internalAuditRetentionDays: 7,
  });

  assert.equal(result.deletedProcessed, 1);
  assert.equal(result.deletedDeadLetter, 1);
  assert.equal(result.deletedAuditEvents, 1);

  const remainingRows = await authDb
    .select({ id: schema.ensWebhookEvents.id })
    .from(schema.ensWebhookEvents)
    .where(inArray(schema.ensWebhookEvents.id, [oldProcessedId, recentProcessedId, oldDeadLetterId, recentDeadLetterId]));

  const remainingIds = new Set(remainingRows.map((row) => row.id));
  assert.equal(remainingIds.has(oldProcessedId), false);
  assert.equal(remainingIds.has(oldDeadLetterId), false);
  assert.equal(remainingIds.has(recentProcessedId), true);
  assert.equal(remainingIds.has(recentDeadLetterId), true);

  const remainingAuditRows = await authDb
    .select({ id: schema.internalOpsAuditEvents.id })
    .from(schema.internalOpsAuditEvents)
    .where(inArray(schema.internalOpsAuditEvents.id, [oldAuditEventId, recentAuditEventId]));

  const remainingAuditIds = new Set(remainingAuditRows.map((row) => row.id));
  assert.equal(remainingAuditIds.has(oldAuditEventId), false);
  assert.equal(remainingAuditIds.has(recentAuditEventId), true);
});
