import assert from "node:assert/strict";
import test from "node:test";

import { sql } from "drizzle-orm";

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

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

test("advisory lock allows only one concurrent worker run", async (t) => {
  if (!(await canConnectToDatabase())) {
    t.skip("integration database is not available");
    return;
  }

  const { runWithEnsAdvisoryLock } = await import("./ens-reconciliation-lock");
  const testResource = 29000000 + Math.floor(Math.random() * 100000);
  const executionOrder: string[] = [];

  const firstRun = runWithEnsAdvisoryLock({
    resource: testResource,
    task: async () => {
      executionOrder.push("first-start");
      await sleep(200);
      executionOrder.push("first-end");
      return "first";
    },
  });

  await sleep(30);

  const secondRun = runWithEnsAdvisoryLock({
    resource: testResource,
    task: async () => {
      executionOrder.push("second-start");
      return "second";
    },
  });

  const [firstResult, secondResult] = await Promise.all([firstRun, secondRun]);

  assert.equal(firstResult.acquired, true);
  assert.equal(secondResult.acquired, false);
  assert.equal(executionOrder.includes("second-start"), false);

  const thirdResult = await runWithEnsAdvisoryLock({
    resource: testResource,
    task: async () => "third",
  });

  assert.equal(thirdResult.acquired, true);
  if (!thirdResult.acquired) {
    throw new Error("Expected third lock attempt to acquire lock");
  }
  assert.equal(thirdResult.result, "third");
});
