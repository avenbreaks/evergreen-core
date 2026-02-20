import { and, desc, eq, ilike, inArray, lt, or, sql } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { HttpError } from "../lib/http-error";
import { searchForumContentViaMeili } from "./forum-search-meili";
import { summarizeComment, summarizePost } from "./forum-core.shared";

const orderByIds = <T extends { id: string }>(rows: T[], ids: string[]): T[] => {
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const ordered: T[] = [];

  for (const id of ids) {
    const row = rowById.get(id);
    if (!row) {
      continue;
    }

    ordered.push(row);
  }

  return ordered;
};

const searchForumContentFromDb = async (query: string, limit: number) => {
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

  const filters = [eq(schema.forumPosts.status, "published")];

  if (input.cursor) {
    const [cursorPost] = await authDb
      .select({
        id: schema.forumPosts.id,
        lastActivityAt: schema.forumPosts.lastActivityAt,
        createdAt: schema.forumPosts.createdAt,
      })
      .from(schema.forumPosts)
      .where(eq(schema.forumPosts.id, input.cursor))
      .limit(1);

    if (cursorPost) {
      const cursorFilter = or(
        lt(schema.forumPosts.lastActivityAt, cursorPost.lastActivityAt),
        and(eq(schema.forumPosts.lastActivityAt, cursorPost.lastActivityAt), lt(schema.forumPosts.createdAt, cursorPost.createdAt)),
        and(
          eq(schema.forumPosts.lastActivityAt, cursorPost.lastActivityAt),
          eq(schema.forumPosts.createdAt, cursorPost.createdAt),
          lt(schema.forumPosts.id, cursorPost.id)
        )
      );

      if (cursorFilter) {
        filters.push(cursorFilter);
      }
    }
  }

  if (authorIds) {
    filters.push(inArray(schema.forumPosts.authorId, authorIds));
  }

  const posts = await authDb
    .select()
    .from(schema.forumPosts)
    .where(and(...filters))
    .orderBy(desc(schema.forumPosts.lastActivityAt), desc(schema.forumPosts.createdAt), desc(schema.forumPosts.id))
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

  try {
    const meili = await searchForumContentViaMeili({
      query,
      limit,
    });

    if (!meili) {
      return searchForumContentFromDb(query, limit);
    }

    const [posts, comments] = await Promise.all([
      meili.postIds.length > 0
        ? authDb
            .select()
            .from(schema.forumPosts)
            .where(and(eq(schema.forumPosts.status, "published"), inArray(schema.forumPosts.id, meili.postIds)))
        : Promise.resolve([]),
      meili.commentIds.length > 0
        ? authDb
            .select({
              comment: schema.forumComments,
              postStatus: schema.forumPosts.status,
            })
            .from(schema.forumComments)
            .leftJoin(schema.forumPosts, eq(schema.forumPosts.id, schema.forumComments.postId))
            .where(and(eq(schema.forumComments.status, "published"), inArray(schema.forumComments.id, meili.commentIds)))
        : Promise.resolve([]),
    ]);

    const orderedPosts = orderByIds(posts, meili.postIds);
    const orderedComments = orderByIds(
      comments
        .filter((entry) => entry.postStatus === "published")
        .map((entry) => entry.comment),
      meili.commentIds
    );

    if (orderedPosts.length === 0 && orderedComments.length === 0) {
      return searchForumContentFromDb(query, limit);
    }

    return {
      posts: orderedPosts.map((post) => summarizePost(post)),
      comments: orderedComments.map((comment) => summarizeComment(comment)),
    };
  } catch {
    return searchForumContentFromDb(query, limit);
  }
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
  const rows = await authDb
    .select({
      authorId: schema.forumPosts.authorId,
      topicCount: sql<number>`count(*)`,
      totalReactions: sql<number>`coalesce(sum(${schema.forumPosts.reactionCount}), 0)`,
      totalComments: sql<number>`coalesce(sum(${schema.forumPosts.commentCount}), 0)`,
      totalShares: sql<number>`coalesce(sum(${schema.forumPosts.shareCount}), 0)`,
      popularityScore: sql<number>`coalesce(sum(${schema.forumPosts.reactionCount} + ${schema.forumPosts.commentCount} + ${schema.forumPosts.shareCount}), 0)`,
      latestActivityAt: sql<Date | null>`max(${schema.forumPosts.lastActivityAt})`,
    })
    .from(schema.forumPosts)
    .where(eq(schema.forumPosts.status, "published"))
    .groupBy(schema.forumPosts.authorId)
    .orderBy(
      desc(sql`coalesce(sum(${schema.forumPosts.reactionCount} + ${schema.forumPosts.commentCount} + ${schema.forumPosts.shareCount}), 0)`),
      desc(sql`count(*)`),
      desc(sql`max(${schema.forumPosts.lastActivityAt})`)
    )
    .limit(size);

  if (rows.length === 0) {
    return {
      topics: [],
    };
  }

  const authorIds = rows.map((row) => row.authorId);
  const authors = await authDb
    .select({
      id: schema.users.id,
      username: schema.users.username,
      name: schema.users.name,
      image: schema.users.image,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, authorIds));

  const authorById = new Map(authors.map((author) => [author.id, author]));

  return {
    topics: rows.map((row) => {
      const author = authorById.get(row.authorId);
      return {
        userId: row.authorId,
        username: author?.username ?? null,
        name: author?.name ?? null,
        image: author?.image ?? null,
        topicCount: Number(row.topicCount),
        totalReactions: Number(row.totalReactions),
        totalComments: Number(row.totalComments),
        totalShares: Number(row.totalShares),
        popularityScore: Number(row.popularityScore),
        latestActivityAt: row.latestActivityAt,
      };
    }),
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
