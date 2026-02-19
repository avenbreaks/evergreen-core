import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { HttpError } from "../lib/http-error";
import { analyzeMarkdown } from "./forum-markdown";

const MAX_REPLY_DEPTH = 3;

type Mention = ReturnType<typeof analyzeMarkdown>["mentions"][number];
type Link = ReturnType<typeof analyzeMarkdown>["links"][number];

const slugify = (input: string): string =>
  input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

const uniqueSlug = (title: string): string => {
  const base = slugify(title) || "post";
  return `${base}-${randomUUID().slice(0, 8)}`;
};

const sanitizeTag = (tag: string): string =>
  tag
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

const summarizePost = (post: typeof schema.forumPosts.$inferSelect) => ({
  id: post.id,
  title: post.title,
  slug: post.slug,
  status: post.status,
  isPinned: post.isPinned,
  isLocked: post.isLocked,
  commentCount: post.commentCount,
  reactionCount: post.reactionCount,
  shareCount: post.shareCount,
  bookmarkCount: post.bookmarkCount,
  lastActivityAt: post.lastActivityAt,
  createdAt: post.createdAt,
  updatedAt: post.updatedAt,
  deletedAt: post.deletedAt,
  authorId: post.authorId,
});

const summarizeComment = (comment: typeof schema.forumComments.$inferSelect) => ({
  id: comment.id,
  postId: comment.postId,
  authorId: comment.authorId,
  parentId: comment.parentId,
  depth: comment.depth,
  status: comment.status,
  reactionCount: comment.reactionCount,
  replyCount: comment.replyCount,
  createdAt: comment.createdAt,
  updatedAt: comment.updatedAt,
  deletedAt: comment.deletedAt,
});

const summarizeNotification = (notification: typeof schema.forumNotifications.$inferSelect) => ({
  id: notification.id,
  recipientUserId: notification.recipientUserId,
  actorUserId: notification.actorUserId,
  type: notification.type,
  postId: notification.postId,
  commentId: notification.commentId,
  payload: notification.payload,
  readAt: notification.readAt,
  createdAt: notification.createdAt,
});

const ensureUserExists = async (userId: string) => {
  const [user] = await authDb.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) {
    throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  }

  return user;
};

const ensureModerator = async (userId: string) => {
  const user = await ensureUserExists(userId);
  if (!user.role || !["moderator", "admin"].includes(user.role)) {
    throw new HttpError(403, "FORBIDDEN", "Moderator access required");
  }

  return user;
};

const ensureProfileMetrics = async (userId: string) => {
  await authDb
    .insert(schema.profileMetrics)
    .values({
      userId,
      updatedAt: new Date(),
    })
    .onConflictDoNothing({
      target: schema.profileMetrics.userId,
    });
};

const createNotification = async (input: {
  recipientUserId: string;
  actorUserId?: string | null;
  type: "mention" | "reply" | "reaction" | "follow" | "share" | "report_update";
  postId?: string | null;
  commentId?: string | null;
  payload?: Record<string, unknown>;
}) => {
  if (input.actorUserId && input.actorUserId === input.recipientUserId) {
    return;
  }

  await authDb.insert(schema.forumNotifications).values({
    id: randomUUID(),
    recipientUserId: input.recipientUserId,
    actorUserId: input.actorUserId ?? null,
    type: input.type,
    postId: input.postId ?? null,
    commentId: input.commentId ?? null,
    payload: input.payload ?? {},
    createdAt: new Date(),
  });
};

const resolveMentionTargets = async (mentions: Mention[]) => {
  const userMentions = mentions.filter((mention) => mention.targetType === "user").map((mention) => mention.mentionText);
  const ensMentions = mentions.filter((mention) => mention.targetType === "ens").map((mention) => mention.mentionText.toLowerCase());

  const [users, ensIdentities] = await Promise.all([
    userMentions.length
      ? authDb
          .select({ id: schema.users.id, username: schema.users.username })
          .from(schema.users)
          .where(inArray(schema.users.username, userMentions))
      : Promise.resolve([]),
    ensMentions.length
      ? authDb
          .select({ id: schema.ensIdentities.id, name: schema.ensIdentities.name, userId: schema.ensIdentities.userId })
          .from(schema.ensIdentities)
          .where(inArray(schema.ensIdentities.name, ensMentions))
      : Promise.resolve([]),
  ]);

  const userByUsername = new Map(users.map((user) => [String(user.username).toLowerCase(), user.id]));
  const ensByName = new Map(ensIdentities.map((ens) => [ens.name.toLowerCase(), ens]));

  return mentions.map((mention) => {
    if (mention.targetType === "user") {
      return {
        mention,
        mentionedUserId: userByUsername.get(mention.mentionText.toLowerCase()) ?? null,
        mentionedEnsIdentityId: null,
      };
    }

    if (mention.targetType === "ens") {
      const ens = ensByName.get(mention.mentionText.toLowerCase()) ?? null;
      return {
        mention,
        mentionedUserId: ens?.userId ?? null,
        mentionedEnsIdentityId: ens?.id ?? null,
      };
    }

    return {
      mention,
      mentionedUserId: null,
      mentionedEnsIdentityId: null,
    };
  });
};

const upsertTags = async (postId: string, tags: string[]): Promise<string[]> => {
  const sanitizedTags = [...new Set(tags.map(sanitizeTag).filter(Boolean))];
  if (sanitizedTags.length === 0) {
    return [];
  }

  const existing = await authDb
    .select()
    .from(schema.forumTags)
    .where(inArray(schema.forumTags.slug, sanitizedTags));

  const existingBySlug = new Map(existing.map((tag) => [tag.slug, tag]));
  const newTags = sanitizedTags.filter((tag) => !existingBySlug.has(tag));

  if (newTags.length > 0) {
    await authDb.insert(schema.forumTags).values(
      newTags.map((slug) => ({
        id: randomUUID(),
        slug,
        displayName: slug,
        postCount: 0,
        trendScore: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    );
  }

  const resolved = await authDb
    .select({ id: schema.forumTags.id, slug: schema.forumTags.slug })
    .from(schema.forumTags)
    .where(inArray(schema.forumTags.slug, sanitizedTags));

  if (resolved.length === 0) {
    return [];
  }

  await authDb.insert(schema.forumPostTags).values(
    resolved.map((tag) => ({
      postId,
      tagId: tag.id,
      createdAt: new Date(),
    }))
  );

  for (const tag of resolved) {
    await authDb
      .update(schema.forumTags)
      .set({
        postCount: sql`${schema.forumTags.postCount} + 1`,
        trendScore: sql`${schema.forumTags.trendScore} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(schema.forumTags.id, tag.id));
  }

  return resolved.map((tag) => tag.slug);
};

const insertReferences = async (input: {
  targetType: "post" | "comment";
  postId?: string | null;
  commentId?: string | null;
  links: Link[];
}) => {
  if (input.links.length === 0) {
    return;
  }

  await authDb.insert(schema.forumReferences).values(
    input.links.map((link) => ({
      id: randomUUID(),
      targetType: input.targetType,
      postId: input.postId ?? null,
      commentId: input.commentId ?? null,
      url: link.url,
      normalizedUrl: link.normalizedUrl,
      domain: link.domain,
      createdAt: new Date(),
    }))
  );
};

const insertMentions = async (input: {
  targetType: "post" | "comment";
  postId?: string | null;
  commentId?: string | null;
  mentions: Mention[];
}) => {
  if (input.mentions.length === 0) {
    return [] as Array<{ mentionedUserId: string | null }>;
  }

  const resolved = await resolveMentionTargets(input.mentions);
  await authDb.insert(schema.forumMentions).values(
    resolved.map((item) => ({
      id: randomUUID(),
      targetType: item.mention.targetType,
      postId: input.postId ?? null,
      commentId: input.commentId ?? null,
      mentionedUserId: item.mentionedUserId,
      mentionedEnsIdentityId: item.mentionedEnsIdentityId,
      mentionedWalletAddress: item.mention.targetType === "wallet" ? item.mention.mentionText : null,
      mentionText: item.mention.mentionText,
      createdAt: new Date(),
    }))
  );

  return resolved.map((item) => ({
    mentionedUserId: item.mentionedUserId,
  }));
};

const ensurePostEditableByUser = async (postId: string, userId: string) => {
  const [post] = await authDb.select().from(schema.forumPosts).where(eq(schema.forumPosts.id, postId)).limit(1);
  if (!post || post.status === "soft_deleted") {
    throw new HttpError(404, "POST_NOT_FOUND", "Forum post not found");
  }

  if (post.authorId !== userId) {
    throw new HttpError(403, "FORBIDDEN", "You do not have permission to modify this post");
  }

  return post;
};

const ensureCommentEditableByUser = async (commentId: string, userId: string) => {
  const [comment] = await authDb
    .select()
    .from(schema.forumComments)
    .where(eq(schema.forumComments.id, commentId))
    .limit(1);

  if (!comment || comment.status === "soft_deleted") {
    throw new HttpError(404, "COMMENT_NOT_FOUND", "Forum comment not found");
  }

  if (comment.authorId !== userId) {
    throw new HttpError(403, "FORBIDDEN", "You do not have permission to modify this comment");
  }

  return comment;
};

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

const getPostById = async (postId: string) => {
  const [post] = await authDb.select().from(schema.forumPosts).where(eq(schema.forumPosts.id, postId)).limit(1);
  if (!post || post.status !== "published") {
    throw new HttpError(404, "POST_NOT_FOUND", "Forum post not found");
  }

  return post;
};

const getCommentById = async (commentId: string) => {
  const [comment] = await authDb
    .select()
    .from(schema.forumComments)
    .where(eq(schema.forumComments.id, commentId))
    .limit(1);
  if (!comment || comment.status !== "published") {
    throw new HttpError(404, "COMMENT_NOT_FOUND", "Forum comment not found");
  }

  return comment;
};

export const toggleForumReaction = async (input: {
  userId: string;
  targetType: "post" | "comment";
  targetId: string;
  reactionType: string;
}) => {
  const reactionType = input.reactionType.trim().toLowerCase();
  if (!reactionType) {
    throw new HttpError(400, "INVALID_REACTION", "Reaction type is required");
  }

  const now = new Date();
  let postId: string | null = null;
  let commentId: string | null = null;
  let recipientUserId: string | null = null;

  if (input.targetType === "post") {
    const post = await getPostById(input.targetId);
    postId = post.id;
    recipientUserId = post.authorId;
  } else {
    const comment = await getCommentById(input.targetId);
    postId = comment.postId;
    commentId = comment.id;
    recipientUserId = comment.authorId;
  }

  const [existing] = await authDb
    .select({ id: schema.forumReactions.id })
    .from(schema.forumReactions)
    .where(
      and(
        eq(schema.forumReactions.targetType, input.targetType),
        input.targetType === "post"
          ? eq(schema.forumReactions.postId, postId as string)
          : eq(schema.forumReactions.commentId, commentId as string),
        eq(schema.forumReactions.userId, input.userId),
        eq(schema.forumReactions.reactionType, reactionType)
      )
    )
    .limit(1);

  if (existing) {
    await authDb.delete(schema.forumReactions).where(eq(schema.forumReactions.id, existing.id));

    if (input.targetType === "post") {
      await authDb
        .update(schema.forumPosts)
        .set({
          reactionCount: sql`GREATEST(${schema.forumPosts.reactionCount} - 1, 0)`,
          updatedAt: now,
        })
        .where(eq(schema.forumPosts.id, postId as string));
    } else {
      await authDb
        .update(schema.forumComments)
        .set({
          reactionCount: sql`GREATEST(${schema.forumComments.reactionCount} - 1, 0)`,
          updatedAt: now,
        })
        .where(eq(schema.forumComments.id, commentId as string));
    }

    return {
      active: false,
      reactionType,
      targetType: input.targetType,
      targetId: input.targetId,
    };
  }

  await authDb.insert(schema.forumReactions).values({
    id: randomUUID(),
    targetType: input.targetType,
    postId,
    commentId,
    userId: input.userId,
    reactionType,
    createdAt: now,
  });

  if (input.targetType === "post") {
    await authDb
      .update(schema.forumPosts)
      .set({
        reactionCount: sql`${schema.forumPosts.reactionCount} + 1`,
        updatedAt: now,
      })
      .where(eq(schema.forumPosts.id, postId as string));
  } else {
    await authDb
      .update(schema.forumComments)
      .set({
        reactionCount: sql`${schema.forumComments.reactionCount} + 1`,
        updatedAt: now,
      })
      .where(eq(schema.forumComments.id, commentId as string));
  }

  await ensureProfileMetrics(input.userId);
  await authDb
    .update(schema.profileMetrics)
    .set({
      reactionGivenCount: sql`${schema.profileMetrics.reactionGivenCount} + 1`,
      updatedAt: now,
    })
    .where(eq(schema.profileMetrics.userId, input.userId));

  if (recipientUserId) {
    await ensureProfileMetrics(recipientUserId);
    await authDb
      .update(schema.profileMetrics)
      .set({
        reactionReceivedCount: sql`${schema.profileMetrics.reactionReceivedCount} + 1`,
        engagementScore: sql`${schema.profileMetrics.engagementScore} + 1`,
        updatedAt: now,
      })
      .where(eq(schema.profileMetrics.userId, recipientUserId));

    await createNotification({
      recipientUserId,
      actorUserId: input.userId,
      type: "reaction",
      postId,
      commentId,
      payload: {
        reactionType,
      },
    });
  }

  return {
    active: true,
    reactionType,
    targetType: input.targetType,
    targetId: input.targetId,
  };
};

export const createForumShare = async (input: {
  userId: string;
  postId: string;
  shareComment?: string;
}) => {
  const post = await getPostById(input.postId);
  const now = new Date();

  await authDb.insert(schema.forumShares).values({
    id: randomUUID(),
    postId: post.id,
    userId: input.userId,
    shareComment: input.shareComment?.trim() || null,
    createdAt: now,
  });

  await authDb
    .update(schema.forumPosts)
    .set({
      shareCount: sql`${schema.forumPosts.shareCount} + 1`,
      lastActivityAt: now,
      updatedAt: now,
    })
    .where(eq(schema.forumPosts.id, post.id));

  await createNotification({
    recipientUserId: post.authorId,
    actorUserId: input.userId,
    type: "share",
    postId: post.id,
  });

  return {
    shared: true,
    postId: post.id,
  };
};

export const toggleForumBookmark = async (input: {
  userId: string;
  postId: string;
  pinned?: boolean;
}) => {
  const post = await getPostById(input.postId);
  const now = new Date();

  const [existing] = await authDb
    .select()
    .from(schema.forumBookmarks)
    .where(and(eq(schema.forumBookmarks.userId, input.userId), eq(schema.forumBookmarks.postId, post.id)))
    .limit(1);

  if (!existing) {
    await authDb.insert(schema.forumBookmarks).values({
      userId: input.userId,
      postId: post.id,
      isPinned: Boolean(input.pinned),
      createdAt: now,
      updatedAt: now,
    });

    await authDb
      .update(schema.forumPosts)
      .set({
        bookmarkCount: sql`${schema.forumPosts.bookmarkCount} + 1`,
        updatedAt: now,
      })
      .where(eq(schema.forumPosts.id, post.id));

    return {
      bookmarked: true,
      pinned: Boolean(input.pinned),
      postId: post.id,
    };
  }

  if (input.pinned !== undefined) {
    await authDb
      .update(schema.forumBookmarks)
      .set({
        isPinned: input.pinned,
        updatedAt: now,
      })
      .where(and(eq(schema.forumBookmarks.userId, input.userId), eq(schema.forumBookmarks.postId, post.id)));

    return {
      bookmarked: true,
      pinned: input.pinned,
      postId: post.id,
    };
  }

  await authDb
    .delete(schema.forumBookmarks)
    .where(and(eq(schema.forumBookmarks.userId, input.userId), eq(schema.forumBookmarks.postId, post.id)));

  await authDb
    .update(schema.forumPosts)
    .set({
      bookmarkCount: sql`GREATEST(${schema.forumPosts.bookmarkCount} - 1, 0)`,
      updatedAt: now,
    })
    .where(eq(schema.forumPosts.id, post.id));

  return {
    bookmarked: false,
    pinned: false,
    postId: post.id,
  };
};

export const toggleForumFollow = async (input: {
  followerUserId: string;
  followeeUserId: string;
}) => {
  if (input.followerUserId === input.followeeUserId) {
    throw new HttpError(400, "INVALID_FOLLOW", "Cannot follow yourself");
  }

  await ensureUserExists(input.followeeUserId);
  await ensureProfileMetrics(input.followerUserId);
  await ensureProfileMetrics(input.followeeUserId);

  const [existing] = await authDb
    .select()
    .from(schema.forumFollows)
    .where(
      and(
        eq(schema.forumFollows.followerId, input.followerUserId),
        eq(schema.forumFollows.followeeId, input.followeeUserId)
      )
    )
    .limit(1);

  if (existing) {
    await authDb
      .delete(schema.forumFollows)
      .where(
        and(
          eq(schema.forumFollows.followerId, input.followerUserId),
          eq(schema.forumFollows.followeeId, input.followeeUserId)
        )
      );

    await authDb
      .update(schema.profileMetrics)
      .set({
        followingCount: sql`GREATEST(${schema.profileMetrics.followingCount} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(schema.profileMetrics.userId, input.followerUserId));

    await authDb
      .update(schema.profileMetrics)
      .set({
        followerCount: sql`GREATEST(${schema.profileMetrics.followerCount} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(schema.profileMetrics.userId, input.followeeUserId));

    return {
      following: false,
      followeeUserId: input.followeeUserId,
    };
  }

  await authDb.insert(schema.forumFollows).values({
    followerId: input.followerUserId,
    followeeId: input.followeeUserId,
    createdAt: new Date(),
  });

  await authDb
    .update(schema.profileMetrics)
    .set({
      followingCount: sql`${schema.profileMetrics.followingCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(schema.profileMetrics.userId, input.followerUserId));

  await authDb
    .update(schema.profileMetrics)
    .set({
      followerCount: sql`${schema.profileMetrics.followerCount} + 1`,
      engagementScore: sql`${schema.profileMetrics.engagementScore} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(schema.profileMetrics.userId, input.followeeUserId));

  await createNotification({
    recipientUserId: input.followeeUserId,
    actorUserId: input.followerUserId,
    type: "follow",
  });

  return {
    following: true,
    followeeUserId: input.followeeUserId,
  };
};

export const setForumPostPinned = async (input: {
  userId: string;
  postId: string;
  pinned: boolean;
}) => {
  const post = await ensurePostEditableByUser(input.postId, input.userId);
  await authDb
    .update(schema.forumPosts)
    .set({
      isPinned: input.pinned,
      updatedAt: new Date(),
    })
    .where(eq(schema.forumPosts.id, post.id));

  return {
    postId: post.id,
    pinned: input.pinned,
  };
};

export const getForumFeed = async (input: {
  limit?: number;
  cursor?: string;
  userId?: string;
  followingOnly?: boolean;
}) => {
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  let authorIds: string[] | null = null;

  if (input.followingOnly) {
    if (!input.userId) {
      throw new HttpError(401, "UNAUTHORIZED", "Authentication required for following feed");
    }

    const followings = await authDb
      .select({ followeeId: schema.forumFollows.followeeId })
      .from(schema.forumFollows)
      .where(eq(schema.forumFollows.followerId, input.userId));
    authorIds = followings.map((item) => item.followeeId);
    if (authorIds.length === 0) {
      return { posts: [], nextCursor: null };
    }
  }

  const filters = [eq(schema.forumPosts.status, "published"), input.cursor ? ne(schema.forumPosts.id, input.cursor) : undefined];
  if (authorIds) {
    filters.push(inArray(schema.forumPosts.authorId, authorIds));
  }

  const posts = await authDb
    .select()
    .from(schema.forumPosts)
    .where(and(...filters))
    .orderBy(desc(schema.forumPosts.isPinned), desc(schema.forumPosts.lastActivityAt), desc(schema.forumPosts.createdAt))
    .limit(limit);

  return {
    posts: posts.map((post) => summarizePost(post)),
    nextCursor: posts.at(-1)?.id ?? null,
  };
};

export const searchForumContent = async (input: { query: string; limit?: number }) => {
  const query = input.query.trim();
  if (!query) {
    return { posts: [], comments: [] };
  }

  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const pattern = `%${query}%`;

  const [posts, comments] = await Promise.all([
    authDb
      .select()
      .from(schema.forumPosts)
      .where(and(eq(schema.forumPosts.status, "published"), or(ilike(schema.forumPosts.title, pattern), ilike(schema.forumPosts.contentPlaintext, pattern))))
      .orderBy(desc(schema.forumPosts.lastActivityAt))
      .limit(limit),
    authDb
      .select()
      .from(schema.forumComments)
      .where(and(eq(schema.forumComments.status, "published"), ilike(schema.forumComments.contentPlaintext, pattern)))
      .orderBy(desc(schema.forumComments.createdAt))
      .limit(limit),
  ]);

  return {
    posts: posts.map((post) => summarizePost(post)),
    comments: comments.map((comment) => summarizeComment(comment)),
  };
};

export const listTrendingTags = async (limit?: number) => {
  const size = Math.max(1, Math.min(limit ?? 20, 100));
  const tags = await authDb
    .select()
    .from(schema.forumTags)
    .orderBy(desc(schema.forumTags.trendScore), desc(schema.forumTags.updatedAt))
    .limit(size);

  return {
    tags,
  };
};

export const listTopActiveUsers = async (limit?: number) => {
  const size = Math.max(1, Math.min(limit ?? 20, 100));
  const rows = await authDb
    .select({
      userId: schema.profileMetrics.userId,
      postCount: schema.profileMetrics.postCount,
      commentCount: schema.profileMetrics.commentCount,
      engagementScore: schema.profileMetrics.engagementScore,
      followerCount: schema.profileMetrics.followerCount,
    })
    .from(schema.profileMetrics)
    .orderBy(desc(schema.profileMetrics.engagementScore), desc(schema.profileMetrics.postCount), desc(schema.profileMetrics.commentCount))
    .limit(size);

  return {
    users: rows,
  };
};

export const listTopTopics = async (limit?: number) => {
  const size = Math.max(1, Math.min(limit ?? 20, 100));
  const posts = await authDb
    .select()
    .from(schema.forumPosts)
    .where(eq(schema.forumPosts.status, "published"))
    .orderBy(desc(sql`${schema.forumPosts.reactionCount} + ${schema.forumPosts.commentCount} + ${schema.forumPosts.shareCount}`), desc(schema.forumPosts.lastActivityAt))
    .limit(size);

  return {
    topics: posts.map((post) => summarizePost(post)),
  };
};

export const listTopDiscussions = async (limit?: number) => {
  const size = Math.max(1, Math.min(limit ?? 20, 100));
  const posts = await authDb
    .select()
    .from(schema.forumPosts)
    .where(eq(schema.forumPosts.status, "published"))
    .orderBy(desc(schema.forumPosts.commentCount), desc(schema.forumPosts.lastActivityAt))
    .limit(size);

  return {
    discussions: posts.map((post) => summarizePost(post)),
  };
};

export const createForumReport = async (input: {
  reporterUserId: string;
  targetType: "post" | "comment" | "user";
  targetId: string;
  reason: string;
}) => {
  const reason = input.reason.trim();
  if (!reason) {
    throw new HttpError(400, "INVALID_REASON", "Report reason is required");
  }

  let postId: string | null = null;
  let commentId: string | null = null;
  let reportedUserId: string | null = null;

  if (input.targetType === "post") {
    const post = await getPostById(input.targetId);
    postId = post.id;
    reportedUserId = post.authorId;
  } else if (input.targetType === "comment") {
    const comment = await getCommentById(input.targetId);
    commentId = comment.id;
    postId = comment.postId;
    reportedUserId = comment.authorId;
  } else {
    await ensureUserExists(input.targetId);
    reportedUserId = input.targetId;
  }

  const reportId = randomUUID();
  await authDb.insert(schema.forumReports).values({
    id: reportId,
    targetType: input.targetType,
    postId,
    commentId,
    reportedUserId,
    reporterUserId: input.reporterUserId,
    reason,
    status: "open",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return {
    reportId,
    status: "open" as const,
  };
};

export const lockForumPostAsModerator = async (input: {
  moderatorUserId: string;
  postId: string;
  locked: boolean;
}) => {
  await ensureModerator(input.moderatorUserId);
  const post = await getPostById(input.postId);

  await authDb
    .update(schema.forumPosts)
    .set({
      isLocked: input.locked,
      updatedAt: new Date(),
    })
    .where(eq(schema.forumPosts.id, post.id));

  return {
    postId: post.id,
    locked: input.locked,
  };
};

export const listForumNotifications = async (input: {
  userId: string;
  limit?: number;
  unreadOnly?: boolean;
}) => {
  const size = Math.max(1, Math.min(input.limit ?? 50, 200));
  const rows = await authDb
    .select()
    .from(schema.forumNotifications)
    .where(
      and(
        eq(schema.forumNotifications.recipientUserId, input.userId),
        input.unreadOnly ? isNull(schema.forumNotifications.readAt) : undefined
      )
    )
    .orderBy(desc(schema.forumNotifications.createdAt))
    .limit(size);

  return {
    notifications: rows.map((row) => summarizeNotification(row)),
  };
};

export const markForumNotificationRead = async (input: { userId: string; notificationId: string }) => {
  const [notification] = await authDb
    .select()
    .from(schema.forumNotifications)
    .where(eq(schema.forumNotifications.id, input.notificationId))
    .limit(1);

  if (!notification || notification.recipientUserId !== input.userId) {
    throw new HttpError(404, "NOTIFICATION_NOT_FOUND", "Notification not found");
  }

  await authDb
    .update(schema.forumNotifications)
    .set({
      readAt: new Date(),
    })
    .where(eq(schema.forumNotifications.id, input.notificationId));

  return {
    notificationId: input.notificationId,
    read: true,
  };
};

export const getForumProfile = async (userId: string) => {
  const [user] = await authDb.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) {
    throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  }

  await ensureProfileMetrics(userId);

  const [extended, metrics] = await Promise.all([
    authDb.select().from(schema.profileExtended).where(eq(schema.profileExtended.userId, userId)).limit(1),
    authDb.select().from(schema.profileMetrics).where(eq(schema.profileMetrics.userId, userId)).limit(1),
  ]);

  return {
    profile: {
      userId: user.id,
      email: user.email,
      name: user.name,
      username: user.username,
      image: user.image,
      location: extended[0]?.location ?? null,
      organization: extended[0]?.organization ?? null,
      websiteUrl: extended[0]?.websiteUrl ?? null,
      brandingEmail: extended[0]?.brandingEmail ?? null,
      displayWalletAddress: extended[0]?.displayWalletAddress ?? null,
      displayEnsName: extended[0]?.displayEnsName ?? null,
      metrics: metrics[0] ?? null,
    },
  };
};

export const updateForumProfile = async (input: {
  userId: string;
  location?: string;
  organization?: string;
  websiteUrl?: string;
  brandingEmail?: string;
  displayWalletAddress?: string;
  displayEnsName?: string;
}) => {
  const now = new Date();
  const [existing] = await authDb
    .select()
    .from(schema.profileExtended)
    .where(eq(schema.profileExtended.userId, input.userId))
    .limit(1);

  const values = {
    userId: input.userId,
    location: input.location?.trim() || null,
    organization: input.organization?.trim() || null,
    websiteUrl: input.websiteUrl?.trim() || null,
    brandingEmail: input.brandingEmail?.trim() || null,
    displayWalletAddress: input.displayWalletAddress?.trim() || null,
    displayEnsName: input.displayEnsName?.trim()?.toLowerCase() || null,
    updatedAt: now,
  };

  if (existing) {
    await authDb.update(schema.profileExtended).set(values).where(eq(schema.profileExtended.userId, input.userId));
  } else {
    await authDb.insert(schema.profileExtended).values(values);
  }

  return getForumProfile(input.userId);
};
