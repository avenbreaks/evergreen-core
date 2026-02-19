import { sql } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";

const ENS_LOCK_NAMESPACE = 131;
const ENS_RECONCILIATION_LOCK_RESOURCE = 20260220;
const ENS_TX_WATCHER_LOCK_RESOURCE = 20260221;
const ENS_WEBHOOK_RETRY_LOCK_RESOURCE = 20260222;
const OPS_RETENTION_LOCK_RESOURCE = 20260223;

type AdvisoryLockRow = {
  locked: boolean | null;
};

type LockKey = {
  namespace: number;
  resource: number;
};

type LockResult<T> =
  | {
      acquired: false;
    }
  | {
      acquired: true;
      result: T;
    };

type RunEnsAdvisoryLockInput<T> = {
  resource: number;
  task: () => Promise<T>;
};

const runWithTransactionAdvisoryLock = async <T>(key: LockKey, task: () => Promise<T>): Promise<LockResult<T>> =>
  authDb.transaction(async (tx) => {
    const result = await tx.execute(sql<AdvisoryLockRow>`
      select pg_try_advisory_xact_lock(${key.namespace}, ${key.resource}) as locked
    `);

    if (result.rows[0]?.locked !== true) {
      return {
        acquired: false,
      };
    }

    return {
      acquired: true,
      result: await task(),
    };
  });

export const runWithEnsReconciliationLock = async <T>(task: () => Promise<T>): Promise<LockResult<T>> =>
  runWithTransactionAdvisoryLock(
    {
      namespace: ENS_LOCK_NAMESPACE,
      resource: ENS_RECONCILIATION_LOCK_RESOURCE,
    },
    task
  );

export const runWithEnsTxWatcherLock = async <T>(task: () => Promise<T>): Promise<LockResult<T>> =>
  runWithTransactionAdvisoryLock(
    {
      namespace: ENS_LOCK_NAMESPACE,
      resource: ENS_TX_WATCHER_LOCK_RESOURCE,
    },
    task
  );

export const runWithEnsWebhookRetryLock = async <T>(task: () => Promise<T>): Promise<LockResult<T>> =>
  runWithTransactionAdvisoryLock(
    {
      namespace: ENS_LOCK_NAMESPACE,
      resource: ENS_WEBHOOK_RETRY_LOCK_RESOURCE,
    },
    task
  );

export const runWithOpsRetentionLock = async <T>(task: () => Promise<T>): Promise<LockResult<T>> =>
  runWithTransactionAdvisoryLock(
    {
      namespace: ENS_LOCK_NAMESPACE,
      resource: OPS_RETENTION_LOCK_RESOURCE,
    },
    task
  );

export const runWithEnsAdvisoryLock = async <T>(input: RunEnsAdvisoryLockInput<T>): Promise<LockResult<T>> =>
  runWithTransactionAdvisoryLock(
    {
      namespace: ENS_LOCK_NAMESPACE,
      resource: input.resource,
    },
    input.task
  );
