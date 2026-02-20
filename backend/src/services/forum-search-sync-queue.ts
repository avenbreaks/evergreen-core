import { randomUUID } from "node:crypto";

import { and, asc, count, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

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

type RequeueForumSearchDeadLetterInput = {
  limit?: number;
  targetType?: ForumSearchSyncTargetType;
  targetIds?: string[];
};

type CancelForumSearchQueueInput = {
  limit?: number;
  statuses?: ForumSearchSyncStatus[];
};

export type ForumSearchSyncQueueStatusSummary = {
  pending: number;
  processing: number;
  failed: number;
  deadLetter: number;
  queueTotal: number;
  activeTotal: number;
  retryReady: number;
  oldestActiveCreatedAt: Date | null;
  oldestDeadLetterCreatedAt: Date | null;
  generatedAt: Date;
};

export type RequeueForumSearchDeadLetterResult = {
  selected: number;
  requeued: number;
  limit: number;
  targetType: ForumSearchSyncTargetType | null;
};

export type CancelForumSearchQueueResult = {
  selected: number;
  cancelled: number;
  limit: number;
  statuses: ForumSearchSyncStatus[];
};

const RETRYABLE_STATUSES = ["pending", "failed"] as const;
const QUEUE_STATUSES = ["pending", "processing", "failed", "dead_letter"] as const;
const ACTIVE_QUEUE_STATUSES = ["pending", "processing", "failed"] as const;

const clampRequeueLimit = (value: number | undefined): number => {
  if (!value || !Number.isInteger(value)) {
    return backendEnv.forumSearchSyncBatchLimit;
  }

  return Math.max(1, Math.min(value, 1000));
};

const clampCancelLimit = (value: number | undefined): number => {
  if (!value || !Number.isInteger(value)) {
    return backendEnv.forumSearchSyncBatchLimit;
  }

  return Math.max(1, Math.min(value, 5000));
};

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

export const getForumSearchSyncQueueStatusSummary = async (): Promise<ForumSearchSyncQueueStatusSummary> => {
  const now = new Date();

  const [statusRows, retryReadyRows, oldestActiveRows, oldestDeadLetterRows] = await Promise.all([
    authDb
      .select({
        status: schema.forumSearchSyncQueue.status,
        total: count(),
      })
      .from(schema.forumSearchSyncQueue)
      .where(inArray(schema.forumSearchSyncQueue.status, QUEUE_STATUSES))
      .groupBy(schema.forumSearchSyncQueue.status),
    authDb
      .select({
        total: count(),
      })
      .from(schema.forumSearchSyncQueue)
      .where(
        and(
          eq(schema.forumSearchSyncQueue.status, "failed"),
          or(isNull(schema.forumSearchSyncQueue.nextRetryAt), lte(schema.forumSearchSyncQueue.nextRetryAt, now))
        )
      ),
    authDb
      .select({ createdAt: schema.forumSearchSyncQueue.createdAt })
      .from(schema.forumSearchSyncQueue)
      .where(inArray(schema.forumSearchSyncQueue.status, ["pending", "processing", "failed"]))
      .orderBy(asc(schema.forumSearchSyncQueue.createdAt))
      .limit(1),
    authDb
      .select({ createdAt: schema.forumSearchSyncQueue.createdAt })
      .from(schema.forumSearchSyncQueue)
      .where(eq(schema.forumSearchSyncQueue.status, "dead_letter"))
      .orderBy(asc(schema.forumSearchSyncQueue.createdAt))
      .limit(1),
  ]);

  const statusMap: Record<(typeof QUEUE_STATUSES)[number], number> = {
    pending: 0,
    processing: 0,
    failed: 0,
    dead_letter: 0,
  };

  for (const row of statusRows) {
    statusMap[row.status] = row.total;
  }

  const activeTotal = statusMap.pending + statusMap.processing + statusMap.failed;

  return {
    pending: statusMap.pending,
    processing: statusMap.processing,
    failed: statusMap.failed,
    deadLetter: statusMap.dead_letter,
    queueTotal: activeTotal + statusMap.dead_letter,
    activeTotal,
    retryReady: retryReadyRows[0]?.total ?? 0,
    oldestActiveCreatedAt: oldestActiveRows[0]?.createdAt ?? null,
    oldestDeadLetterCreatedAt: oldestDeadLetterRows[0]?.createdAt ?? null,
    generatedAt: now,
  };
};

export const requeueForumSearchDeadLetterEntries = async (
  input: RequeueForumSearchDeadLetterInput = {}
): Promise<RequeueForumSearchDeadLetterResult> => {
  const limit = clampRequeueLimit(input.limit);
  const targetIds = [...new Set((input.targetIds ?? []).map((value) => value.trim()).filter(Boolean))];
  const now = new Date();

  const selected = await authDb
    .select({ id: schema.forumSearchSyncQueue.id })
    .from(schema.forumSearchSyncQueue)
    .where(
      and(
        eq(schema.forumSearchSyncQueue.status, "dead_letter"),
        input.targetType ? eq(schema.forumSearchSyncQueue.targetType, input.targetType) : undefined,
        targetIds.length > 0 ? inArray(schema.forumSearchSyncQueue.targetId, targetIds) : undefined
      )
    )
    .orderBy(asc(schema.forumSearchSyncQueue.updatedAt))
    .limit(limit);

  if (selected.length === 0) {
    return {
      selected: 0,
      requeued: 0,
      limit,
      targetType: input.targetType ?? null,
    };
  }

  const selectedIds = selected.map((row) => row.id);
  await authDb
    .update(schema.forumSearchSyncQueue)
    .set({
      status: "pending",
      attemptCount: 0,
      nextRetryAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      processedAt: null,
      updatedAt: now,
    })
    .where(inArray(schema.forumSearchSyncQueue.id, selectedIds));

  return {
    selected: selected.length,
    requeued: selected.length,
    limit,
    targetType: input.targetType ?? null,
  };
};

export const cancelForumSearchQueueEntries = async (
  input: CancelForumSearchQueueInput = {}
): Promise<CancelForumSearchQueueResult> => {
  const limit = clampCancelLimit(input.limit);
  const statuses =
    input.statuses && input.statuses.length > 0
      ? [...new Set(input.statuses.filter((status): status is ForumSearchSyncStatus => QUEUE_STATUSES.includes(status)))]
      : [...ACTIVE_QUEUE_STATUSES];

  const selected = await authDb
    .select({ id: schema.forumSearchSyncQueue.id })
    .from(schema.forumSearchSyncQueue)
    .where(inArray(schema.forumSearchSyncQueue.status, statuses))
    .orderBy(asc(schema.forumSearchSyncQueue.createdAt))
    .limit(limit);

  if (selected.length === 0) {
    return {
      selected: 0,
      cancelled: 0,
      limit,
      statuses,
    };
  }

  const selectedIds = selected.map((row) => row.id);
  await authDb.delete(schema.forumSearchSyncQueue).where(inArray(schema.forumSearchSyncQueue.id, selectedIds));

  return {
    selected: selected.length,
    cancelled: selected.length,
    limit,
    statuses,
  };
};
