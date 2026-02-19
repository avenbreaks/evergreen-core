import { eq } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import {
  buildForumSearchObjectId,
  markForumSearchSyncFailed,
  markForumSearchSyncProcessed,
  reserveForumSearchSyncQueueEntries,
  type ForumSearchSyncQueueEntry,
} from "./forum-search-sync-queue";
import {
  deleteForumSearchDocuments,
  isForumSearchMeiliEnabled,
  type ForumSearchDocument,
  upsertForumSearchDocuments,
} from "./forum-search-meili";

type SyncForumSearchQueueInput = {
  limit?: number;
};

type SyncForumSearchQueueError = {
  entryId: string;
  targetType: "post" | "comment";
  targetId: string;
  code: string;
  message: string;
};

export type SyncForumSearchQueueResult = {
  scanned: number;
  processed: number;
  failed: number;
  deadLettered: number;
  skipped: boolean;
  startedAt: Date;
  finishedAt: Date;
  errors: SyncForumSearchQueueError[];
};

const pushError = (errors: SyncForumSearchQueueError[], error: SyncForumSearchQueueError): void => {
  if (errors.length >= 100) {
    return;
  }

  errors.push(error);
};

const toErrorDetails = (error: unknown): { code: string; message: string } => {
  if (error instanceof Error) {
    return {
      code: "FORUM_SEARCH_SYNC_ERROR",
      message: error.message,
    };
  }

  return {
    code: "FORUM_SEARCH_SYNC_ERROR",
    message: "Unknown forum search sync error",
  };
};

const toIso = (value: Date | null): string | null => (value ? value.toISOString() : null);

const loadPostDocument = async (postId: string): Promise<ForumSearchDocument | null> => {
  const [post] = await authDb.select().from(schema.forumPosts).where(eq(schema.forumPosts.id, postId)).limit(1);
  if (!post || post.status !== "published") {
    return null;
  }

  return {
    objectID: buildForumSearchObjectId("post", post.id),
    targetType: "post",
    targetId: post.id,
    postId: post.id,
    title: post.title,
    content: post.contentPlaintext,
    authorId: post.authorId,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    lastActivityAt: toIso(post.lastActivityAt),
  };
};

const loadCommentDocument = async (commentId: string): Promise<ForumSearchDocument | null> => {
  const [row] = await authDb
    .select({
      id: schema.forumComments.id,
      postId: schema.forumComments.postId,
      authorId: schema.forumComments.authorId,
      contentPlaintext: schema.forumComments.contentPlaintext,
      status: schema.forumComments.status,
      createdAt: schema.forumComments.createdAt,
      updatedAt: schema.forumComments.updatedAt,
      postStatus: schema.forumPosts.status,
      postLastActivityAt: schema.forumPosts.lastActivityAt,
    })
    .from(schema.forumComments)
    .leftJoin(schema.forumPosts, eq(schema.forumPosts.id, schema.forumComments.postId))
    .where(eq(schema.forumComments.id, commentId))
    .limit(1);

  if (!row || row.status !== "published" || row.postStatus !== "published") {
    return null;
  }

  return {
    objectID: buildForumSearchObjectId("comment", row.id),
    targetType: "comment",
    targetId: row.id,
    postId: row.postId,
    title: null,
    content: row.contentPlaintext,
    authorId: row.authorId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastActivityAt: toIso(row.postLastActivityAt),
  };
};

const resolveQueueEntry = async (
  entry: ForumSearchSyncQueueEntry
): Promise<{ kind: "upsert"; document: ForumSearchDocument } | { kind: "delete"; objectId: string }> => {
  const objectId = buildForumSearchObjectId(entry.targetType, entry.targetId);

  if (entry.operation === "delete") {
    return {
      kind: "delete",
      objectId,
    };
  }

  const document =
    entry.targetType === "post"
      ? await loadPostDocument(entry.targetId)
      : await loadCommentDocument(entry.targetId);

  if (!document) {
    return {
      kind: "delete",
      objectId,
    };
  }

  return {
    kind: "upsert",
    document,
  };
};

const processQueueEntry = async (entry: ForumSearchSyncQueueEntry): Promise<void> => {
  const resolved = await resolveQueueEntry(entry);

  if (resolved.kind === "upsert") {
    await upsertForumSearchDocuments([resolved.document]);
    return;
  }

  await deleteForumSearchDocuments([resolved.objectId]);
};

export const syncForumSearchQueue = async (
  input: SyncForumSearchQueueInput = {}
): Promise<SyncForumSearchQueueResult> => {
  const startedAt = new Date();
  if (!isForumSearchMeiliEnabled()) {
    return {
      scanned: 0,
      processed: 0,
      failed: 0,
      deadLettered: 0,
      skipped: true,
      startedAt,
      finishedAt: new Date(),
      errors: [],
    };
  }

  const queueEntries = await reserveForumSearchSyncQueueEntries({
    limit: input.limit,
  });

  const errors: SyncForumSearchQueueError[] = [];
  let processed = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const entry of queueEntries) {
    try {
      await processQueueEntry(entry);
      await markForumSearchSyncProcessed(entry.id);
      processed += 1;
    } catch (error) {
      const details = toErrorDetails(error);
      const marked = await markForumSearchSyncFailed({
        entryId: entry.id,
        code: details.code,
        message: details.message,
      });

      if (marked.status === "dead_letter") {
        deadLettered += 1;
      } else if (marked.status !== "missing") {
        failed += 1;
      }

      pushError(errors, {
        entryId: entry.id,
        targetType: entry.targetType,
        targetId: entry.targetId,
        code: details.code,
        message: details.message,
      });
    }
  }

  return {
    scanned: queueEntries.length,
    processed,
    failed,
    deadLettered,
    skipped: false,
    startedAt,
    finishedAt: new Date(),
    errors,
  };
};
