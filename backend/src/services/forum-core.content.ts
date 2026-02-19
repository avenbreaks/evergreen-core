import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { HttpError } from "../lib/http-error";
import { analyzeMarkdown } from "./forum-markdown";
import { recordForumActionMetric } from "./forum-metrics";
import { enqueueForumSearchSync } from "./forum-search-sync-queue";
import {
  MAX_REPLY_DEPTH,
  createNotification,
  ensureCommentEditableByUser,
  ensurePostEditableByUser,
  ensureProfileMetrics,
  insertMentions,
  insertReferences,
  summarizeComment,
  summarizePost,
  uniqueSlug,
  upsertTags,
} from "./forum-core.shared";

export const previewForumMarkdown = async (input: { markdown: string }) => {
  const analysis = analyzeMarkdown({ markdown: input.markdown });

  return {
    markdown: analysis.markdown,
    plaintext: analysis.plaintext,
    htmlPreview: analysis.htmlPreview,
    meta: {
      wordCount: analysis.wordCount,
      codeBlockCount: analysis.codeBlockCount,
      inlineCodeCount: analysis.inlineCodeCount,
      linkCount: analysis.links.length,
      mentionCount: analysis.mentions.length,
      links: analysis.links,
      mentions: analysis.mentions,
    },
  };
};

export const createForumPost = async (input: {
  userId: string;
  title: string;
  markdown: string;
  tags?: string[];
}) => {
  const title = input.title.trim();
  if (!title) {
    throw new HttpError(400, "INVALID_TITLE", "Post title is required");
  }

  const analysis = analyzeMarkdown({ markdown: input.markdown });
  if (!analysis.markdown) {
    throw new HttpError(400, "INVALID_CONTENT", "Post content is required");
  }

  const postId = randomUUID();
  const now = new Date();
  const slug = uniqueSlug(title);

  await authDb.insert(schema.forumPosts).values({
    id: postId,
    authorId: input.userId,
    title,
    slug,
    contentMarkdown: analysis.markdown,
    contentPlaintext: analysis.plaintext,
    contentMeta: {
      codeBlockCount: analysis.codeBlockCount,
      inlineCodeCount: analysis.inlineCodeCount,
      wordCount: analysis.wordCount,
    },
    status: "published",
    isPinned: false,
    isLocked: false,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
  });

  const tags = await upsertTags(postId, input.tags ?? []);
  await insertReferences({
    targetType: "post",
    postId,
    links: analysis.links,
  });
  const mentions = await insertMentions({
    targetType: "post",
    postId,
    mentions: analysis.mentions,
  });

  await ensureProfileMetrics(input.userId);
  await authDb
    .update(schema.profileMetrics)
    .set({
      postCount: sql`${schema.profileMetrics.postCount} + 1`,
      engagementScore: sql`${schema.profileMetrics.engagementScore} + 5`,
      updatedAt: now,
    })
    .where(eq(schema.profileMetrics.userId, input.userId));

  for (const mention of mentions) {
    if (!mention.mentionedUserId) {
      continue;
    }

    await createNotification({
      recipientUserId: mention.mentionedUserId,
      actorUserId: input.userId,
      type: "mention",
      postId,
      payload: { context: "post" },
    });
  }

  await enqueueForumSearchSync({
    targetType: "post",
    targetId: postId,
    operation: "upsert",
  });

  const [post] = await authDb.select().from(schema.forumPosts).where(eq(schema.forumPosts.id, postId)).limit(1);
  if (!post) {
    throw new HttpError(500, "POST_CREATE_FAILED", "Failed to create forum post");
  }

  return {
    post: summarizePost(post),
    tags,
  };
};

export const updateForumPost = async (input: {
  userId: string;
  postId: string;
  title?: string;
  markdown?: string;
}) => {
  const post = await ensurePostEditableByUser(input.postId, input.userId);

  const nextTitle = input.title?.trim() || post.title;
  const analysis = analyzeMarkdown({ markdown: input.markdown ?? post.contentMarkdown });

  await authDb
    .update(schema.forumPosts)
    .set({
      title: nextTitle,
      contentMarkdown: analysis.markdown,
      contentPlaintext: analysis.plaintext,
      contentMeta: {
        codeBlockCount: analysis.codeBlockCount,
        inlineCodeCount: analysis.inlineCodeCount,
        wordCount: analysis.wordCount,
      },
      updatedAt: new Date(),
    })
    .where(eq(schema.forumPosts.id, input.postId));

  await authDb.delete(schema.forumReferences).where(and(eq(schema.forumReferences.targetType, "post"), eq(schema.forumReferences.postId, input.postId)));
  await authDb.delete(schema.forumMentions).where(eq(schema.forumMentions.postId, input.postId));

  await insertReferences({
    targetType: "post",
    postId: input.postId,
    links: analysis.links,
  });
  await insertMentions({
    targetType: "post",
    postId: input.postId,
    mentions: analysis.mentions,
  });

  await enqueueForumSearchSync({
    targetType: "post",
    targetId: input.postId,
    operation: "upsert",
  });

  const [updated] = await authDb
    .select()
    .from(schema.forumPosts)
    .where(eq(schema.forumPosts.id, input.postId))
    .limit(1);

  if (!updated) {
    throw new HttpError(500, "POST_UPDATE_FAILED", "Failed to update forum post");
  }

  return { post: summarizePost(updated) };
};

export const softDeleteForumPost = async (input: { userId: string; postId: string }) => {
  const post = await ensurePostEditableByUser(input.postId, input.userId);
  const now = new Date();

  await authDb
    .update(schema.forumPosts)
    .set({
      status: "soft_deleted",
      deletedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.forumPosts.id, input.postId));

  await ensureProfileMetrics(post.authorId);
  await authDb
    .update(schema.profileMetrics)
    .set({
      postCount: sql`GREATEST(${schema.profileMetrics.postCount} - 1, 0)`,
      updatedAt: now,
    })
    .where(eq(schema.profileMetrics.userId, post.authorId));

  await enqueueForumSearchSync({
    targetType: "post",
    targetId: input.postId,
    operation: "delete",
  });

  return {
    postId: input.postId,
    status: "soft_deleted" as const,
  };
};

export const listForumPosts = async (input: { limit?: number; cursor?: string } = {}) => {
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));

  const posts = await authDb
    .select()
    .from(schema.forumPosts)
    .where(and(eq(schema.forumPosts.status, "published"), input.cursor ? ne(schema.forumPosts.id, input.cursor) : undefined))
    .orderBy(desc(schema.forumPosts.isPinned), desc(schema.forumPosts.lastActivityAt), desc(schema.forumPosts.createdAt))
    .limit(limit);

  return {
    posts: posts.map((post) => summarizePost(post)),
    nextCursor: posts.at(-1)?.id ?? null,
  };
};

export const getForumPostDetail = async (postId: string) => {
  const [post] = await authDb.select().from(schema.forumPosts).where(eq(schema.forumPosts.id, postId)).limit(1);
  if (!post || post.status === "soft_deleted") {
    throw new HttpError(404, "POST_NOT_FOUND", "Forum post not found");
  }

  const comments = await authDb
    .select()
    .from(schema.forumComments)
    .where(and(eq(schema.forumComments.postId, postId), eq(schema.forumComments.status, "published")))
    .orderBy(asc(schema.forumComments.createdAt));

  return {
    post: summarizePost(post),
    comments: comments.map((comment) => summarizeComment(comment)),
  };
};

export const createForumComment = async (input: {
  userId: string;
  postId: string;
  parentId?: string;
  markdown: string;
}) => {
  const [post] = await authDb.select().from(schema.forumPosts).where(eq(schema.forumPosts.id, input.postId)).limit(1);
  if (!post || post.status !== "published") {
    throw new HttpError(404, "POST_NOT_FOUND", "Forum post not found");
  }

  if (post.isLocked) {
    throw new HttpError(409, "POST_LOCKED", "Comments are locked for this post");
  }

  let depth = 0;
  if (input.parentId) {
    const [parent] = await authDb
      .select()
      .from(schema.forumComments)
      .where(eq(schema.forumComments.id, input.parentId))
      .limit(1);

    if (!parent || parent.postId !== input.postId || parent.status !== "published") {
      throw new HttpError(404, "PARENT_COMMENT_NOT_FOUND", "Parent comment not found");
    }

    depth = parent.depth + 1;
    if (depth > MAX_REPLY_DEPTH) {
      throw new HttpError(400, "MAX_REPLY_DEPTH_EXCEEDED", `Maximum reply depth is ${MAX_REPLY_DEPTH}`);
    }
  }

  const analysis = analyzeMarkdown({ markdown: input.markdown });
  if (!analysis.markdown) {
    throw new HttpError(400, "INVALID_CONTENT", "Comment content is required");
  }

  const commentId = randomUUID();
  const now = new Date();

  await authDb.insert(schema.forumComments).values({
    id: commentId,
    postId: input.postId,
    authorId: input.userId,
    parentId: input.parentId ?? null,
    depth,
    contentMarkdown: analysis.markdown,
    contentPlaintext: analysis.plaintext,
    contentMeta: {
      codeBlockCount: analysis.codeBlockCount,
      inlineCodeCount: analysis.inlineCodeCount,
      wordCount: analysis.wordCount,
    },
    status: "published",
    createdAt: now,
    updatedAt: now,
  });

  if (input.parentId) {
    await authDb
      .update(schema.forumComments)
      .set({
        replyCount: sql`${schema.forumComments.replyCount} + 1`,
        updatedAt: now,
      })
      .where(eq(schema.forumComments.id, input.parentId));
  }

  await authDb
    .update(schema.forumPosts)
    .set({
      commentCount: sql`${schema.forumPosts.commentCount} + 1`,
      lastActivityAt: now,
      updatedAt: now,
    })
    .where(eq(schema.forumPosts.id, input.postId));

  await insertReferences({
    targetType: "comment",
    postId: input.postId,
    commentId,
    links: analysis.links,
  });
  const mentions = await insertMentions({
    targetType: "comment",
    postId: input.postId,
    commentId,
    mentions: analysis.mentions,
  });

  await enqueueForumSearchSync({
    targetType: "comment",
    targetId: commentId,
    operation: "upsert",
  });

  await ensureProfileMetrics(input.userId);
  await authDb
    .update(schema.profileMetrics)
    .set({
      commentCount: sql`${schema.profileMetrics.commentCount} + 1`,
      engagementScore: sql`${schema.profileMetrics.engagementScore} + 2`,
      updatedAt: now,
    })
    .where(eq(schema.profileMetrics.userId, input.userId));

  if (input.parentId) {
    const [parent] = await authDb
      .select({ authorId: schema.forumComments.authorId })
      .from(schema.forumComments)
      .where(eq(schema.forumComments.id, input.parentId))
      .limit(1);

    if (parent?.authorId) {
      await createNotification({
        recipientUserId: parent.authorId,
        actorUserId: input.userId,
        type: "reply",
        postId: input.postId,
        commentId,
      });
    }
  }

  for (const mention of mentions) {
    if (!mention.mentionedUserId) {
      continue;
    }

    await createNotification({
      recipientUserId: mention.mentionedUserId,
      actorUserId: input.userId,
      type: "mention",
      postId: input.postId,
      commentId,
      payload: { context: "comment" },
    });
  }

  const [comment] = await authDb.select().from(schema.forumComments).where(eq(schema.forumComments.id, commentId)).limit(1);
  if (!comment) {
    throw new HttpError(500, "COMMENT_CREATE_FAILED", "Failed to create forum comment");
  }

  recordForumActionMetric("comment_create");

  return {
    comment: summarizeComment(comment),
  };
};

export const updateForumComment = async (input: {
  userId: string;
  commentId: string;
  markdown: string;
}) => {
  const comment = await ensureCommentEditableByUser(input.commentId, input.userId);
  const analysis = analyzeMarkdown({ markdown: input.markdown });

  await authDb
    .update(schema.forumComments)
    .set({
      contentMarkdown: analysis.markdown,
      contentPlaintext: analysis.plaintext,
      contentMeta: {
        codeBlockCount: analysis.codeBlockCount,
        inlineCodeCount: analysis.inlineCodeCount,
        wordCount: analysis.wordCount,
      },
      updatedAt: new Date(),
    })
    .where(eq(schema.forumComments.id, input.commentId));

  await authDb.delete(schema.forumReferences).where(and(eq(schema.forumReferences.targetType, "comment"), eq(schema.forumReferences.commentId, input.commentId)));
  await authDb.delete(schema.forumMentions).where(eq(schema.forumMentions.commentId, input.commentId));

  await insertReferences({
    targetType: "comment",
    postId: comment.postId,
    commentId: comment.id,
    links: analysis.links,
  });
  await insertMentions({
    targetType: "comment",
    postId: comment.postId,
    commentId: comment.id,
    mentions: analysis.mentions,
  });

  await enqueueForumSearchSync({
    targetType: "comment",
    targetId: comment.id,
    operation: "upsert",
  });

  const [updated] = await authDb
    .select()
    .from(schema.forumComments)
    .where(eq(schema.forumComments.id, input.commentId))
    .limit(1);

  if (!updated) {
    throw new HttpError(500, "COMMENT_UPDATE_FAILED", "Failed to update forum comment");
  }

  return { comment: summarizeComment(updated) };
};

export const softDeleteForumComment = async (input: { userId: string; commentId: string }) => {
  const comment = await ensureCommentEditableByUser(input.commentId, input.userId);
  const now = new Date();

  await authDb
    .update(schema.forumComments)
    .set({
      status: "soft_deleted",
      deletedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.forumComments.id, input.commentId));

  await authDb
    .update(schema.forumPosts)
    .set({
      commentCount: sql`GREATEST(${schema.forumPosts.commentCount} - 1, 0)`,
      updatedAt: now,
    })
    .where(eq(schema.forumPosts.id, comment.postId));

  await ensureProfileMetrics(comment.authorId);
  await authDb
    .update(schema.profileMetrics)
    .set({
      commentCount: sql`GREATEST(${schema.profileMetrics.commentCount} - 1, 0)`,
      updatedAt: now,
    })
    .where(eq(schema.profileMetrics.userId, comment.authorId));

  await enqueueForumSearchSync({
    targetType: "comment",
    targetId: input.commentId,
    operation: "delete",
  });

  return {
    commentId: input.commentId,
    status: "soft_deleted" as const,
  };
};

export const getReplyDraft = async (input: { userId: string; postId: string; parentCommentId?: string }) => {
  const [draft] = await authDb
    .select()
    .from(schema.forumReplyDrafts)
    .where(
      and(
        eq(schema.forumReplyDrafts.userId, input.userId),
        eq(schema.forumReplyDrafts.postId, input.postId),
        input.parentCommentId
          ? eq(schema.forumReplyDrafts.parentCommentId, input.parentCommentId)
          : isNull(schema.forumReplyDrafts.parentCommentId)
      )
    )
    .limit(1);

  if (!draft) {
    return { draft: null };
  }

  return {
    draft: {
      id: draft.id,
      postId: draft.postId,
      parentCommentId: draft.parentCommentId,
      contentMarkdown: draft.contentMarkdown,
      updatedAt: draft.updatedAt,
    },
  };
};

export const upsertReplyDraft = async (input: {
  userId: string;
  postId: string;
  parentCommentId?: string;
  markdown: string;
}) => {
  const analysis = analyzeMarkdown({ markdown: input.markdown });
  const now = new Date();

  const [existing] = await authDb
    .select()
    .from(schema.forumReplyDrafts)
    .where(
      and(
        eq(schema.forumReplyDrafts.userId, input.userId),
        eq(schema.forumReplyDrafts.postId, input.postId),
        input.parentCommentId
          ? eq(schema.forumReplyDrafts.parentCommentId, input.parentCommentId)
          : isNull(schema.forumReplyDrafts.parentCommentId)
      )
    )
    .limit(1);

  if (existing) {
    await authDb
      .update(schema.forumReplyDrafts)
      .set({
        contentMarkdown: analysis.markdown,
        contentPlaintext: analysis.plaintext,
        contentMeta: {
          codeBlockCount: analysis.codeBlockCount,
          inlineCodeCount: analysis.inlineCodeCount,
          wordCount: analysis.wordCount,
        },
        updatedAt: now,
      })
      .where(eq(schema.forumReplyDrafts.id, existing.id));
  } else {
    await authDb.insert(schema.forumReplyDrafts).values({
      id: randomUUID(),
      userId: input.userId,
      postId: input.postId,
      parentCommentId: input.parentCommentId ?? null,
      contentMarkdown: analysis.markdown,
      contentPlaintext: analysis.plaintext,
      contentMeta: {
        codeBlockCount: analysis.codeBlockCount,
        inlineCodeCount: analysis.inlineCodeCount,
        wordCount: analysis.wordCount,
      },
      createdAt: now,
      updatedAt: now,
    });
  }

  return getReplyDraft({
    userId: input.userId,
    postId: input.postId,
    parentCommentId: input.parentCommentId,
  });
};

export const deleteReplyDraft = async (input: {
  userId: string;
  postId: string;
  parentCommentId?: string;
}) => {
  await authDb
    .delete(schema.forumReplyDrafts)
    .where(
      and(
        eq(schema.forumReplyDrafts.userId, input.userId),
        eq(schema.forumReplyDrafts.postId, input.postId),
        input.parentCommentId
          ? eq(schema.forumReplyDrafts.parentCommentId, input.parentCommentId)
          : isNull(schema.forumReplyDrafts.parentCommentId)
      )
    );

  return {
    deleted: true,
  };
};
