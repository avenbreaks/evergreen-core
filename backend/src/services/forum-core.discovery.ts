import { and, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { HttpError } from "../lib/http-error";
import { summarizeComment, summarizePost } from "./forum-core.shared";

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
