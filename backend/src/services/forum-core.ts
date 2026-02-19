import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";

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
    return;
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
  await insertMentions({
    targetType: "post",
    postId,
    mentions: analysis.mentions,
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
  await ensurePostEditableByUser(input.postId, input.userId);
  const now = new Date();

  await authDb
    .update(schema.forumPosts)
    .set({
      status: "soft_deleted",
      deletedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.forumPosts.id, input.postId));

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
  await insertMentions({
    targetType: "comment",
    postId: input.postId,
    commentId,
    mentions: analysis.mentions,
  });

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
