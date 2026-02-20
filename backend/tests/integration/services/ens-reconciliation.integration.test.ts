import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { eq, inArray, sql } from "drizzle-orm";

const DEFAULT_DATABASE_URL = "postgresql://devparty:devparty@localhost:5436/devpartydb";

const ensureIntegrationEnv = (): void => {
  process.env.DATABASE_URL ??= DEFAULT_DATABASE_URL;
  process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-0123456789abcdef";
  process.env.BETTER_AUTH_URL ??= "http://localhost:3001";
  process.env.BETTER_AUTH_TRUSTED_ORIGINS ??= "http://localhost:3000,http://localhost:3001";
  process.env.WEBHOOK_SECRET ??= "integration-webhook-secret";
  process.env.WEBHOOK_IP_ALLOWLIST ??= "";
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

test("reconcileStalePurchaseIntents promotes and expires stale intents in DB", async (t) => {
  if (!(await canConnectToDatabase())) {
    t.skip("integration database is not available");
    return;
  }

  const [{ authDb }, { schema }, { reconcileStalePurchaseIntents }] = await Promise.all([
    import("@evergreen-devparty/auth"),
    import("@evergreen-devparty/db"),
    import("../../../src/services/ens-reconciliation"),
  ]);

  const userId = randomUUID();
  const promoteIntentId = randomUUID();
  const expireIntentId = randomUUID();
  const now = new Date();
  const staleUpdatedAt = new Date(now.getTime() - 30 * 60 * 1000);

  t.after(async () => {
    await authDb
      .delete(schema.ensPurchaseIntents)
      .where(inArray(schema.ensPurchaseIntents.id, [promoteIntentId, expireIntentId]));
    await authDb.delete(schema.users).where(eq(schema.users.id, userId));
  });

  await authDb.insert(schema.users).values({
    id: userId,
    email: `integration-${userId}@example.com`,
    name: "Integration Test User",
  });

  await authDb.insert(schema.ensPurchaseIntents).values([
    {
      id: promoteIntentId,
      userId,
      chainId: 131,
      walletAddress: "0x1111111111111111111111111111111111111111",
      tld: "dev",
      label: `promote-${promoteIntentId.slice(0, 8)}`,
      domainName: `promote-${promoteIntentId.slice(0, 8)}.dev`,
      durationSeconds: 31536000,
      resolverAddress: "0x47e9cbbd0ee572d996ffd0d7aa17796c5a247590",
      controllerAddress: "0x00a4c7ff46ab778d8333421d42715db2aa6b1b4d",
      baseRegistrarAddress: "0xe077dc5c0a336f76662f024d98c0f20be0ad9d1c",
      secretHash: buildHex("a"),
      commitment: buildHex("b"),
      minCommitmentAgeSeconds: 60,
      maxCommitmentAgeSeconds: 86400,
      committedAt: new Date(now.getTime() - 40 * 60 * 1000),
      registerableAt: new Date(now.getTime() - 5 * 60 * 1000),
      registerBy: new Date(now.getTime() + 30 * 60 * 1000),
      status: "committed",
      createdAt: staleUpdatedAt,
      updatedAt: staleUpdatedAt,
    },
    {
      id: expireIntentId,
      userId,
      chainId: 131,
      walletAddress: "0x2222222222222222222222222222222222222222",
      tld: "dev",
      label: `expire-${expireIntentId.slice(0, 8)}`,
      domainName: `expire-${expireIntentId.slice(0, 8)}.dev`,
      durationSeconds: 31536000,
      resolverAddress: "0x47e9cbbd0ee572d996ffd0d7aa17796c5a247590",
      controllerAddress: "0x00a4c7ff46ab778d8333421d42715db2aa6b1b4d",
      baseRegistrarAddress: "0xe077dc5c0a336f76662f024d98c0f20be0ad9d1c",
      secretHash: buildHex("c"),
      commitment: buildHex("d"),
      minCommitmentAgeSeconds: 60,
      maxCommitmentAgeSeconds: 86400,
      committedAt: new Date(now.getTime() - 60 * 60 * 1000),
      registerableAt: new Date(now.getTime() - 45 * 60 * 1000),
      registerBy: new Date(now.getTime() - 5 * 60 * 1000),
      status: "registerable",
      createdAt: staleUpdatedAt,
      updatedAt: staleUpdatedAt,
    },
  ]);

  const result = await reconcileStalePurchaseIntents({
    staleMinutes: 15,
    limit: 100,
    dryRun: false,
  });

  assert.ok(result.updated >= 2);
  assert.ok(result.promotedToRegisterable >= 1);
  assert.ok(result.expired >= 1);

  const [promoteIntent] = await authDb
    .select()
    .from(schema.ensPurchaseIntents)
    .where(eq(schema.ensPurchaseIntents.id, promoteIntentId))
    .limit(1);

  const [expiredIntent] = await authDb
    .select()
    .from(schema.ensPurchaseIntents)
    .where(eq(schema.ensPurchaseIntents.id, expireIntentId))
    .limit(1);

  assert.equal(promoteIntent?.status, "registerable");
  assert.equal(expiredIntent?.status, "expired");
});

test("reconcileStalePurchaseIntents dry-run does not persist status updates", async (t) => {
  if (!(await canConnectToDatabase())) {
    t.skip("integration database is not available");
    return;
  }

  const [{ authDb }, { schema }, { reconcileStalePurchaseIntents }] = await Promise.all([
    import("@evergreen-devparty/auth"),
    import("@evergreen-devparty/db"),
    import("../../../src/services/ens-reconciliation"),
  ]);

  const userId = randomUUID();
  const intentId = randomUUID();
  const now = new Date();
  const staleUpdatedAt = new Date(now.getTime() - 30 * 60 * 1000);

  t.after(async () => {
    await authDb.delete(schema.ensPurchaseIntents).where(eq(schema.ensPurchaseIntents.id, intentId));
    await authDb.delete(schema.users).where(eq(schema.users.id, userId));
  });

  await authDb.insert(schema.users).values({
    id: userId,
    email: `integration-${userId}@example.com`,
    name: "Integration Test User",
  });

  await authDb.insert(schema.ensPurchaseIntents).values({
    id: intentId,
    userId,
    chainId: 131,
    walletAddress: "0x3333333333333333333333333333333333333333",
    tld: "dev",
    label: `dryrun-${intentId.slice(0, 8)}`,
    domainName: `dryrun-${intentId.slice(0, 8)}.dev`,
    durationSeconds: 31536000,
    resolverAddress: "0x47e9cbbd0ee572d996ffd0d7aa17796c5a247590",
    controllerAddress: "0x00a4c7ff46ab778d8333421d42715db2aa6b1b4d",
    baseRegistrarAddress: "0xe077dc5c0a336f76662f024d98c0f20be0ad9d1c",
    secretHash: buildHex("e"),
    commitment: buildHex("f"),
    minCommitmentAgeSeconds: 60,
    maxCommitmentAgeSeconds: 86400,
    committedAt: new Date(now.getTime() - 40 * 60 * 1000),
    registerableAt: new Date(now.getTime() - 5 * 60 * 1000),
    registerBy: new Date(now.getTime() + 30 * 60 * 1000),
    status: "committed",
    createdAt: staleUpdatedAt,
    updatedAt: staleUpdatedAt,
  });

  const result = await reconcileStalePurchaseIntents({
    staleMinutes: 15,
    limit: 100,
    dryRun: true,
  });

  assert.ok(result.updated >= 1);

  const [intent] = await authDb
    .select()
    .from(schema.ensPurchaseIntents)
    .where(eq(schema.ensPurchaseIntents.id, intentId))
    .limit(1);

  assert.equal(intent?.status, "committed");
});
