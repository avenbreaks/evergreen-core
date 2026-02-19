import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { backendEnv } from "../config/env";

export type ForumSearchSyncTargetType = "post" | "comment";
export type ForumSearchSyncOperation = "upsert" | "delete";
export type ForumSearchSyncStatus = "pending" | "processing" | "failed" | "dead_letter";

export type ForumSearchSyncQueueEntry = typeof schema.forumSearchSyncQueue.$inferSelect;

type EnqueueForumSearchSyncInput = {
  targetType: ForumSearchSyncTargetType;
  targetId: string;
  operation?: ForumSearchSyncOperation;
};

const RETRYABLE_STATUSES = ["pending", "failed"] as const;

const clampBatchLimit = (value: number | undefined): number => {
  if (!value || !Number.isInteger(value)) {
    return backendEnv.forumSearchSyncBatchLimit;
  }

  return Math.max(1, Math.min(value, 500));
};

const computeRetryDelayMs = (attemptCount: number): number => {
  const delay = backendEnv.forumSearchSyncBaseDelayMs * 2 ** Math.max(attemptCount - 1, 0);
  return Math.max(backendEnv.forumSearchSyncBaseDelayMs, Math.min(delay, backendEnv.forumSearchSyncMaxDelayMs));
};

export const buildForumSearchObjectId = (targetType: ForumSearchSyncTargetType, targetId: string): string =>
  `${targetType}:${targetId}`;

export const enqueueForumSearchSync = async (input: EnqueueForumSearchSyncInput): Promise<void> => {
  await enqueueForumSearchSyncBatch([input]);
};

export const enqueueForumSearchSyncBatch = async (inputs: EnqueueForumSearchSyncInput[]): Promise<void> => {
  if (inputs.length === 0) {
    return;
  }

  const now = new Date();

  await authDb
    .insert(schema.forumSearchSyncQueue)
    .values(
      inputs.map((input) => ({
        id: randomUUID(),
        targetType: input.targetType,
        targetId: input.targetId,
        operation: input.operation ?? "upsert",
        status: "pending" as const,
        attemptCount: 0,
        nextRetryAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        processedAt: null,
        createdAt: now,
        updatedAt: now,
      }))
    )
    .onConflictDoUpdate({
      target: [schema.forumSearchSyncQueue.targetType, schema.forumSearchSyncQueue.targetId],
      set: {
        operation: sql`excluded.operation`,
        status: "pending" as const,
        attemptCount: 0,
        nextRetryAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        processedAt: null,
        updatedAt: now,
      },
    });
};

export const reserveForumSearchSyncQueueEntries = async (input: {
  limit?: number;
} = {}): Promise<ForumSearchSyncQueueEntry[]> => {
  const now = new Date();
  const limit = clampBatchLimit(input.limit);

  return authDb.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.forumSearchSyncQueue)
      .where(
        and(
          inArray(schema.forumSearchSyncQueue.status, RETRYABLE_STATUSES),
          or(isNull(schema.forumSearchSyncQueue.nextRetryAt), lte(schema.forumSearchSyncQueue.nextRetryAt, now))
        )
      )
      .orderBy(asc(schema.forumSearchSyncQueue.createdAt))
      .limit(limit);

    if (rows.length === 0) {
      return [];
    }

    const ids = rows.map((row) => row.id);
    await tx
      .update(schema.forumSearchSyncQueue)
      .set({
        status: "processing" as const,
        updatedAt: now,
      })
      .where(inArray(schema.forumSearchSyncQueue.id, ids));

    return rows.map((row) => ({
      ...row,
      status: "processing" as const,
      updatedAt: now,
    }));
  });
};

export const markForumSearchSyncProcessed = async (entryId: string): Promise<void> => {
  await authDb.delete(schema.forumSearchSyncQueue).where(eq(schema.forumSearchSyncQueue.id, entryId));
};

export const markForumSearchSyncFailed = async (input: {
  entryId: string;
  code: string;
  message: string;
}): Promise<{ status: ForumSearchSyncStatus | "missing"; attemptCount: number }> => {
  const [entry] = await authDb
    .select({
      id: schema.forumSearchSyncQueue.id,
      attemptCount: schema.forumSearchSyncQueue.attemptCount,
    })
    .from(schema.forumSearchSyncQueue)
    .where(eq(schema.forumSearchSyncQueue.id, input.entryId))
    .limit(1);

  if (!entry) {
    return {
      status: "missing",
      attemptCount: 0,
    };
  }

  const now = new Date();
  const nextAttempt = entry.attemptCount + 1;
  if (nextAttempt >= backendEnv.forumSearchSyncMaxAttempts) {
    await authDb
      .update(schema.forumSearchSyncQueue)
      .set({
        status: "dead_letter" as const,
        attemptCount: nextAttempt,
        nextRetryAt: null,
        lastErrorCode: input.code,
        lastErrorMessage: input.message,
        processedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.forumSearchSyncQueue.id, input.entryId));

    return {
      status: "dead_letter",
      attemptCount: nextAttempt,
    };
  }

  const retryDelayMs = computeRetryDelayMs(nextAttempt);
  await authDb
    .update(schema.forumSearchSyncQueue)
    .set({
      status: "failed" as const,
      attemptCount: nextAttempt,
      nextRetryAt: new Date(now.getTime() + retryDelayMs),
      lastErrorCode: input.code,
      lastErrorMessage: input.message,
      updatedAt: now,
    })
    .where(eq(schema.forumSearchSyncQueue.id, input.entryId));

  return {
    status: "failed",
    attemptCount: nextAttempt,
  };
};
