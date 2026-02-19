import { and, asc, eq, inArray, lte, or } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { backendEnv } from "../config/env";

const STUCK_INTENT_STATUSES = ["committed", "registerable"] as const;

const clampLimit = (value: number | undefined): number => {
  const fallback = backendEnv.ensReconciliationLimit;
  if (!value || !Number.isInteger(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(value, 500));
};

const clampStaleMinutes = (value: number | undefined): number => {
  const fallback = backendEnv.ensReconciliationStaleMinutes;
  if (!value || !Number.isInteger(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(value, 7 * 24 * 60));
};

type ReconcileInput = {
  limit?: number;
  staleMinutes?: number;
  dryRun?: boolean;
};

type ReconciledIntent = {
  intentId: string;
  domainName: string;
  previousStatus: string;
  nextStatus: string;
  reason: string;
};

export type ReconcileStalePurchaseIntentsResult = {
  scanned: number;
  updated: number;
  expired: number;
  promotedToRegisterable: number;
  unchanged: number;
  dryRun: boolean;
  staleMinutes: number;
  intents: ReconciledIntent[];
  startedAt: Date;
  finishedAt: Date;
};

export const reconcileStalePurchaseIntents = async (
  input: ReconcileInput = {}
): Promise<ReconcileStalePurchaseIntentsResult> => {
  const startedAt = new Date();
  const dryRun = Boolean(input.dryRun);
  const limit = clampLimit(input.limit);
  const staleMinutes = clampStaleMinutes(input.staleMinutes);
  const staleThreshold = new Date(Date.now() - staleMinutes * 60 * 1000);
  const now = new Date();

  const intents = await authDb
    .select()
    .from(schema.ensPurchaseIntents)
    .where(
      and(
        inArray(schema.ensPurchaseIntents.status, STUCK_INTENT_STATUSES),
        or(
          lte(schema.ensPurchaseIntents.updatedAt, staleThreshold),
          lte(schema.ensPurchaseIntents.registerBy, now)
        )
      )
    )
    .orderBy(asc(schema.ensPurchaseIntents.updatedAt))
    .limit(limit);

  const transitions: ReconciledIntent[] = [];
  let expired = 0;
  let promotedToRegisterable = 0;

  for (const intent of intents) {
    if (intent.registerBy && intent.registerBy <= now) {
      const reason = "Commitment window expired during reconciliation";

      if (!dryRun) {
        await authDb
          .update(schema.ensPurchaseIntents)
          .set({
            status: "expired",
            failureReason: reason,
            updatedAt: now,
          })
          .where(eq(schema.ensPurchaseIntents.id, intent.id));
      }

      transitions.push({
        intentId: intent.id,
        domainName: intent.domainName,
        previousStatus: intent.status,
        nextStatus: "expired",
        reason,
      });
      expired += 1;
      continue;
    }

    if (intent.status === "committed" && intent.registerableAt && intent.registerableAt <= now) {
      const reason = "Intent promoted to registerable by reconciliation";

      if (!dryRun) {
        await authDb
          .update(schema.ensPurchaseIntents)
          .set({
            status: "registerable",
            failureReason: null,
            updatedAt: now,
          })
          .where(eq(schema.ensPurchaseIntents.id, intent.id));
      }

      transitions.push({
        intentId: intent.id,
        domainName: intent.domainName,
        previousStatus: intent.status,
        nextStatus: "registerable",
        reason,
      });
      promotedToRegisterable += 1;
      continue;
    }
  }

  const updated = transitions.length;
  const finishedAt = new Date();

  return {
    scanned: intents.length,
    updated,
    expired,
    promotedToRegisterable,
    unchanged: intents.length - updated,
    dryRun,
    staleMinutes,
    intents: transitions,
    startedAt,
    finishedAt,
  };
};
