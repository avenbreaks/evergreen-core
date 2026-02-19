import { randomUUID } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { HttpError } from "../lib/http-error";
import { analyzeMarkdown } from "./forum-markdown";

export const MAX_REPLY_DEPTH = 3;

export type Mention = ReturnType<typeof analyzeMarkdown>["mentions"][number];
export type Link = ReturnType<typeof analyzeMarkdown>["links"][number];

const slugify = (input: string): string =>
  input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

const sanitizeTag = (tag: string): string =>
  tag
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

export const uniqueSlug = (title: string): string => {
  const base = slugify(title) || "post";
  return `${base}-${randomUUID().slice(0, 8)}`;
};

export const summarizePost = (post: typeof schema.forumPosts.$inferSelect) => ({
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

export const summarizeComment = (comment: typeof schema.forumComments.$inferSelect) => ({
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

export const summarizeNotification = (notification: typeof schema.forumNotifications.$inferSelect) => ({
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

export const ensureUserExists = async (userId: string) => {
  const [user] = await authDb.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) {
    throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  }

  return user;
};

export const ensureModerator = async (userId: string) => {
  const user = await ensureUserExists(userId);
  if (!user.role || !["moderator", "admin"].includes(user.role)) {
    throw new HttpError(403, "FORBIDDEN", "Moderator access required");
  }

  return user;
};

export const ensureProfileMetrics = async (userId: string) => {
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

export const createNotification = async (input: {
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

export const upsertTags = async (postId: string, tags: string[]): Promise<string[]> => {
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

export const insertReferences = async (input: {
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

export const insertMentions = async (input: {
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

export const ensurePostEditableByUser = async (postId: string, userId: string) => {
  const [post] = await authDb.select().from(schema.forumPosts).where(eq(schema.forumPosts.id, postId)).limit(1);
  if (!post || post.status === "soft_deleted") {
    throw new HttpError(404, "POST_NOT_FOUND", "Forum post not found");
  }

  if (post.authorId !== userId) {
    throw new HttpError(403, "FORBIDDEN", "You do not have permission to modify this post");
  }

  return post;
};

export const ensureCommentEditableByUser = async (commentId: string, userId: string) => {
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

export const getPostById = async (postId: string) => {
  const [post] = await authDb.select().from(schema.forumPosts).where(eq(schema.forumPosts.id, postId)).limit(1);
  if (!post || post.status !== "published") {
    throw new HttpError(404, "POST_NOT_FOUND", "Forum post not found");
  }

  return post;
};

export const getCommentById = async (commentId: string) => {
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
