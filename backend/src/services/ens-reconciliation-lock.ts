import { sql } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";

const ENS_RECONCILIATION_LOCK_NAMESPACE = 131;
const ENS_RECONCILIATION_LOCK_RESOURCE = 20260220;

type AdvisoryLockRow = {
  locked: boolean | null;
};

export const tryAcquireEnsReconciliationLock = async (): Promise<boolean> => {
  const result = await authDb.execute(sql<AdvisoryLockRow>`
    select pg_try_advisory_lock(${ENS_RECONCILIATION_LOCK_NAMESPACE}, ${ENS_RECONCILIATION_LOCK_RESOURCE}) as locked
  `);

  return result.rows[0]?.locked === true;
};

export const releaseEnsReconciliationLock = async (): Promise<void> => {
  await authDb.execute(sql`
    select pg_advisory_unlock(${ENS_RECONCILIATION_LOCK_NAMESPACE}, ${ENS_RECONCILIATION_LOCK_RESOURCE})
  `);
};
