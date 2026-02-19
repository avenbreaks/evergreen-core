import { asc, eq } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { backendEnv } from "../config/env";
import { enqueueForumSearchSyncBatch } from "./forum-search-sync-queue";

type EnqueueForumSearchBackfillInput = {
  batchSize?: number;
  includePosts?: boolean;
  includeComments?: boolean;
};

type SearchSyncOperation = "upsert" | "delete";

type QueueOperation = {
  targetType: "post" | "comment";
  targetId: string;
  operation: SearchSyncOperation;
};

export type EnqueueForumSearchBackfillResult = {
  scannedPosts: number;
  scannedComments: number;
  queuedUpserts: number;
  queuedDeletes: number;
  batchesEnqueued: number;
  startedAt: Date;
  finishedAt: Date;
};

const clampBatchSize = (value: number | undefined): number => {
  if (!value || !Number.isInteger(value)) {
    return backendEnv.forumSearchSyncBatchLimit;
  }

  return Math.max(1, Math.min(value, 1000));
};

const appendOperation = (buffer: QueueOperation[], input: QueueOperation): void => {
  buffer.push(input);
};

export const enqueueForumSearchBackfill = async (
  input: EnqueueForumSearchBackfillInput = {}
): Promise<EnqueueForumSearchBackfillResult> => {
  const startedAt = new Date();
  const includePosts = input.includePosts ?? true;
  const includeComments = input.includeComments ?? true;
  const batchSize = clampBatchSize(input.batchSize);

  let scannedPosts = 0;
  let scannedComments = 0;
  let queuedUpserts = 0;
  let queuedDeletes = 0;
  let batchesEnqueued = 0;

  const buffer: QueueOperation[] = [];

  const flushBuffer = async (): Promise<void> => {
    if (buffer.length === 0) {
      return;
    }

    await enqueueForumSearchSyncBatch(buffer);
    buffer.length = 0;
    batchesEnqueued += 1;
  };

  if (includePosts) {
    let offset = 0;
    for (;;) {
      const rows = await authDb
        .select({
          id: schema.forumPosts.id,
          status: schema.forumPosts.status,
        })
        .from(schema.forumPosts)
        .orderBy(asc(schema.forumPosts.createdAt), asc(schema.forumPosts.id))
        .limit(batchSize)
        .offset(offset);

      if (rows.length === 0) {
        break;
      }

      scannedPosts += rows.length;

      for (const row of rows) {
        const operation: SearchSyncOperation = row.status === "published" ? "upsert" : "delete";
        appendOperation(buffer, {
          targetType: "post",
          targetId: row.id,
          operation,
        });

        if (operation === "upsert") {
          queuedUpserts += 1;
        } else {
          queuedDeletes += 1;
        }

        if (buffer.length >= batchSize) {
          await flushBuffer();
        }
      }

      offset += rows.length;
    }
  }

  if (includeComments) {
    let offset = 0;
    for (;;) {
      const rows = await authDb
        .select({
          id: schema.forumComments.id,
          status: schema.forumComments.status,
          postStatus: schema.forumPosts.status,
        })
        .from(schema.forumComments)
        .leftJoin(schema.forumPosts, eq(schema.forumPosts.id, schema.forumComments.postId))
        .orderBy(asc(schema.forumComments.createdAt), asc(schema.forumComments.id))
        .limit(batchSize)
        .offset(offset);

      if (rows.length === 0) {
        break;
      }

      scannedComments += rows.length;

      for (const row of rows) {
        const isPublished = row.status === "published" && row.postStatus === "published";
        const operation: SearchSyncOperation = isPublished ? "upsert" : "delete";
        appendOperation(buffer, {
          targetType: "comment",
          targetId: row.id,
          operation,
        });

        if (operation === "upsert") {
          queuedUpserts += 1;
        } else {
          queuedDeletes += 1;
        }

        if (buffer.length >= batchSize) {
          await flushBuffer();
        }
      }

      offset += rows.length;
    }
  }

  await flushBuffer();

  return {
    scannedPosts,
    scannedComments,
    queuedUpserts,
    queuedDeletes,
    batchesEnqueued,
    startedAt,
    finishedAt: new Date(),
  };
};
