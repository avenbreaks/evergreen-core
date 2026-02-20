import { eq, sql } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

export type ClaimInternalOpsCooldownInput = {
  operation: string;
  cooldownMs: number;
  now?: Date;
};

export type ClaimInternalOpsCooldownResult = {
  allowed: boolean;
  retryAfterMs: number;
  nextAllowedAt: Date;
};

type UpsertClaimRow = {
  next_allowed_at: Date | string | null;
};

const toDate = (value: Date | string | null | undefined, fallback: Date): Date => {
  if (!value) {
    return fallback;
  }

  if (value instanceof Date) {
    return value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};

export const claimInternalOpsCooldown = async (
  input: ClaimInternalOpsCooldownInput
): Promise<ClaimInternalOpsCooldownResult> => {
  const operation = input.operation.trim().toLowerCase();
  const cooldownMs = Math.max(1, Math.floor(input.cooldownMs));
  const now = input.now ?? new Date();
  const nextAllowedAt = new Date(now.getTime() + cooldownMs);

  const claimed = await authDb.execute(sql<UpsertClaimRow>`
    insert into internal_ops_throttle (operation, next_allowed_at, updated_at)
    values (${operation}, ${nextAllowedAt}, ${now})
    on conflict (operation) do update
    set next_allowed_at = excluded.next_allowed_at,
        updated_at = excluded.updated_at
    where internal_ops_throttle.next_allowed_at <= ${now}
    returning next_allowed_at
  `);

  if (claimed.rows.length > 0) {
    return {
      allowed: true,
      retryAfterMs: 0,
      nextAllowedAt,
    };
  }

  const [current] = await authDb
    .select({ nextAllowedAt: schema.internalOpsThrottle.nextAllowedAt })
    .from(schema.internalOpsThrottle)
    .where(eq(schema.internalOpsThrottle.operation, operation))
    .limit(1);

  const currentNextAllowedAt = toDate(current?.nextAllowedAt, nextAllowedAt);
  return {
    allowed: false,
    retryAfterMs: Math.max(0, currentNextAllowedAt.getTime() - now.getTime()),
    nextAllowedAt: currentNextAllowedAt,
  };
};
