import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import type { ForumRouteDependencies } from "../../../src/routes/forum";
import { HttpError } from "../../../src/lib/http-error";

process.env.DATABASE_URL ??= "postgresql://devparty:devparty@localhost:5436/devpartydb";
process.env.BETTER_AUTH_SECRET ??= "forum-route-test-secret-0123456789abcdef";
process.env.BETTER_AUTH_URL ??= "http://localhost:3001";
process.env.BETTER_AUTH_TRUSTED_ORIGINS ??= "http://localhost:3000,http://localhost:3001";

const TEST_USER_ID = "11111111-1111-4111-8111-111111111111";
const TEST_POST_ID = "22222222-2222-4222-8222-222222222222";
const TEST_COMMENT_ID = "33333333-3333-4333-8333-333333333333";
const TEST_TARGET_USER_ID = "44444444-4444-4444-8444-444444444444";

const TEST_AUTH_SESSION: Awaited<ReturnType<ForumRouteDependencies["requireAuthSession"]>> = {
  session: {
    id: "session-test-1",
    token: "token-test-1",
    userId: TEST_USER_ID,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  },
  user: {
    id: TEST_USER_ID,
    email: "forum-test@example.com",
    name: "Forum Test",
  },
};

const buildDeps = (overrides: Partial<ForumRouteDependencies> = {}): Partial<ForumRouteDependencies> => ({
  requireAuthSession: async () => TEST_AUTH_SESSION,
  requireAuthSessionMiddleware: async () => {},
  ...overrides,
});

const buildForumTestApp = async (depsOverrides: Partial<ForumRouteDependencies> = {}) => {
  const { forumRoutes } = await import("../../../src/routes/forum");
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }

    return reply.status(500).send({
      code: "INTERNAL_SERVER_ERROR",
      message: "Unexpected error",
    });
  });

  await app.register(forumRoutes, {
    disableDebounce: true,
    deps: buildDeps(depsOverrides),
  });

  return app;
};

test("forum route forwards reaction toggle payload", async (t) => {
  let receivedInput: unknown = null;

  const app = await buildForumTestApp({
    toggleForumReaction: async (input) => {
      receivedInput = input;
      return {
        active: true,
        reactionType: input.reactionType,
        targetType: input.targetType,
        targetId: input.targetId,
      };
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/forum/reactions/toggle",
    payload: {
      targetType: "post",
      targetId: TEST_POST_ID,
      reactionType: "like",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(receivedInput, {
    userId: TEST_USER_ID,
    targetType: "post",
    targetId: TEST_POST_ID,
    reactionType: "like",
  });
});

test("forum route forwards share payload", async (t) => {
  let receivedInput: unknown = null;

  const app = await buildForumTestApp({
    createForumShare: async (input) => {
      receivedInput = input;
      return {
        shared: true,
        postId: input.postId,
      };
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/forum/shares",
    payload: {
      postId: TEST_POST_ID,
      shareComment: "share this",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(receivedInput, {
    userId: TEST_USER_ID,
    postId: TEST_POST_ID,
    shareComment: "share this",
  });
});

test("forum route forwards bookmark and follow payloads", async (t) => {
  let bookmarkInput: unknown = null;
  let followInput: unknown = null;

  const app = await buildForumTestApp({
    toggleForumBookmark: async (input) => {
      bookmarkInput = input;
      return {
        bookmarked: true,
        pinned: Boolean(input.pinned),
        postId: input.postId,
      };
    },
    toggleForumFollow: async (input) => {
      followInput = input;
      return {
        following: true,
        followeeUserId: input.followeeUserId,
      };
    },
  });

  t.after(async () => {
    await app.close();
  });

  const bookmarkResponse = await app.inject({
    method: "POST",
    url: "/api/forum/bookmarks/toggle",
    payload: {
      postId: TEST_POST_ID,
      pinned: true,
    },
  });

  const followResponse = await app.inject({
    method: "POST",
    url: "/api/forum/follows/toggle",
    payload: {
      followeeUserId: TEST_TARGET_USER_ID,
    },
  });

  assert.equal(bookmarkResponse.statusCode, 200);
  assert.equal(followResponse.statusCode, 200);
  assert.deepEqual(bookmarkInput, {
    userId: TEST_USER_ID,
    postId: TEST_POST_ID,
    pinned: true,
  });
  assert.deepEqual(followInput, {
    followerUserId: TEST_USER_ID,
    followeeUserId: TEST_TARGET_USER_ID,
  });
});

test("forum route forwards report payload", async (t) => {
  let reportInput: unknown = null;

  const app = await buildForumTestApp({
    createForumReport: async (input) => {
      reportInput = input;
      return {
        reportId: "55555555-5555-4555-8555-555555555555",
        status: "open",
      };
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/forum/reports",
    payload: {
      targetType: "comment",
      targetId: TEST_COMMENT_ID,
      reason: "spam content",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(reportInput, {
    reporterUserId: TEST_USER_ID,
    targetType: "comment",
    targetId: TEST_COMMENT_ID,
    reason: "spam content",
  });
});

test("forum route forwards search query params", async (t) => {
  let receivedInput: unknown = null;

  const app = await buildForumTestApp({
    searchForumContent: async (input) => {
      receivedInput = input;
      return {
        posts: [],
        comments: [],
      };
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/forum/search?query=ens&limit=12",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(receivedInput, {
    query: "ens",
    limit: 12,
  });
});

test("forum route forwards feed params without auth for public feed", async (t) => {
  let authCalls = 0;
  let feedInput: unknown = null;

  const app = await buildForumTestApp({
    requireAuthSession: async () => {
      authCalls += 1;
      return TEST_AUTH_SESSION;
    },
    getForumFeed: async (input) => {
      feedInput = input;
      return {
        posts: [],
        nextCursor: null,
      };
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/forum/feed?limit=15",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(authCalls, 0);
  assert.deepEqual(feedInput, {
    limit: 15,
    cursor: undefined,
    followingOnly: undefined,
    userId: undefined,
  });
});

test("forum route resolves auth user for following-only feed", async (t) => {
  let authCalls = 0;
  let feedInput: unknown = null;

  const app = await buildForumTestApp({
    requireAuthSession: async () => {
      authCalls += 1;
      return TEST_AUTH_SESSION;
    },
    getForumFeed: async (input) => {
      feedInput = input;
      return {
        posts: [],
        nextCursor: null,
      };
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/forum/feed?limit=7&followingOnly=true",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(authCalls, 1);
  assert.deepEqual(feedInput, {
    limit: 7,
    cursor: undefined,
    followingOnly: true,
    userId: TEST_USER_ID,
  });
});

test("forum post detail route forwards comments pagination query", async (t) => {
  let receivedInput: unknown = null;

  const app = await buildForumTestApp({
    getForumPostDetail: async (input) => {
      receivedInput = input;
      const now = new Date();
      return {
        post: {
          id: TEST_POST_ID,
          title: "sample",
          slug: "sample",
          status: "published",
          isPinned: false,
          isLocked: false,
          commentCount: 0,
          reactionCount: 0,
          shareCount: 0,
          bookmarkCount: 0,
          createdAt: now,
          updatedAt: now,
          lastActivityAt: now,
          deletedAt: null,
          authorId: TEST_USER_ID,
          contentMarkdown: "sample",
          contentPlaintext: "sample",
          contentMeta: {},
        },
        comments: [],
        commentsNextCursor: null,
      };
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "GET",
    url: `/api/forum/posts/${TEST_POST_ID}?commentsLimit=12&commentsCursor=${TEST_COMMENT_ID}`,
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(receivedInput, {
    postId: TEST_POST_ID,
    commentsLimit: 12,
    commentsCursor: TEST_COMMENT_ID,
  });
});

test("forum protected write route rejects missing auth", async (t) => {
  const app = await buildForumTestApp({
    requireAuthSessionMiddleware: async () => {
      throw new HttpError(401, "UNAUTHORIZED", "Authentication required");
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/forum/posts",
    payload: {
      title: "Unauthorized",
      markdown: "Should fail",
    },
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().code, "UNAUTHORIZED");
});

test("forum comment endpoint happy-path returns created comment", async (t) => {
  const app = await buildForumTestApp({
    createForumComment: async () => ({
      comment: {
        id: TEST_COMMENT_ID,
        postId: TEST_POST_ID,
        authorId: TEST_USER_ID,
        parentId: null,
        depth: 0,
        status: "published",
        reactionCount: 0,
        replyCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    }),
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: `/api/forum/posts/${TEST_POST_ID}/comments`,
    payload: {
      markdown: "first reply",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().comment.id, TEST_COMMENT_ID);
});

test("forum comment endpoint returns depth-limit error", async (t) => {
  const app = await buildForumTestApp({
    createForumComment: async () => {
      throw new HttpError(400, "MAX_REPLY_DEPTH_EXCEEDED", "Maximum reply depth is 3");
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: `/api/forum/posts/${TEST_POST_ID}/comments`,
    payload: {
      markdown: "nested reply",
      parentId: TEST_COMMENT_ID,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, "MAX_REPLY_DEPTH_EXCEEDED");
});

test("forum pin endpoint returns forbidden when permission denied", async (t) => {
  const app = await buildForumTestApp({
    setForumPostPinned: async () => {
      throw new HttpError(403, "FORBIDDEN", "Only post owner or moderator/admin can pin this post");
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: `/api/forum/posts/${TEST_POST_ID}/pin`,
    payload: {
      pinned: true,
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.json().code, "FORBIDDEN");
});
