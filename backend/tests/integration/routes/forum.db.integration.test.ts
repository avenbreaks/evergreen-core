import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import Fastify from "fastify";
import { eq, inArray, sql } from "drizzle-orm";

import type { FastifyRequest } from "fastify";

import { HttpError } from "../../../src/lib/http-error";
import type { ForumRouteDependencies } from "../../../src/routes/forum";

const DEFAULT_DATABASE_URL = "postgresql://devparty:devparty@localhost:5436/devpartydb";

const ensureIntegrationEnv = (): void => {
  process.env.DATABASE_URL ??= DEFAULT_DATABASE_URL;
  process.env.BETTER_AUTH_SECRET ??= "forum-db-integration-secret-0123456789abcdef";
  process.env.BETTER_AUTH_URL ??= "http://localhost:3001";
  process.env.BETTER_AUTH_TRUSTED_ORIGINS ??= "http://localhost:3000,http://localhost:3001";
};

const canConnectToDatabase = async (): Promise<boolean> => {
  ensureIntegrationEnv();

  try {
    const { authDb } = await import("@evergreen-devparty/auth");
    await authDb.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
};

const getTestUserId = (request: FastifyRequest): string => {
  const raw = request.headers["x-test-user-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || typeof value !== "string") {
    throw new HttpError(401, "UNAUTHORIZED", "Test auth user header is required");
  }

  return value;
};

const buildTestSession = (userId: string): Awaited<ReturnType<ForumRouteDependencies["requireAuthSession"]>> => ({
  session: {
    id: `session-${userId}`,
    token: `token-${userId}`,
    userId,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  },
  user: {
    id: userId,
    email: `integration-${userId}@example.com`,
    name: `Integration ${userId.slice(0, 8)}`,
  },
});

const buildForumDbTestApp = async () => {
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
    deps: {
      requireAuthSession: async (request) => {
        const userId = getTestUserId(request);
        return buildTestSession(userId);
      },
      requireAuthSessionMiddleware: async (request) => {
        getTestUserId(request);
      },
    },
  });

  return app;
};

const insertUser = async (input: { id: string; role?: "user" | "moderator" | "admin" }) => {
  const [{ authDb }, { schema }] = await Promise.all([import("@evergreen-devparty/auth"), import("@evergreen-devparty/db")]);

  await authDb.insert(schema.users).values({
    id: input.id,
    email: `integration-${input.id}@example.com`,
    name: `Integration ${input.id.slice(0, 8)}`,
    role: input.role ?? "user",
  });
};

const insertWallet = async (input: { id: string; userId: string; chainId: number; address: string; isPrimary?: boolean }) => {
  const [{ authDb }, { schema }] = await Promise.all([import("@evergreen-devparty/auth"), import("@evergreen-devparty/db")]);

  await authDb.insert(schema.wallets).values({
    id: input.id,
    userId: input.userId,
    chainId: input.chainId,
    address: input.address,
    walletType: "evm",
    isPrimary: input.isPrimary ?? true,
  });
};

const insertForumPostRow = async (input: {
  id: string;
  authorId: string;
  title: string;
  slug: string;
  reactionCount?: number;
  commentCount?: number;
  shareCount?: number;
  lastActivityAt?: Date;
}) => {
  const [{ authDb }, { schema }] = await Promise.all([import("@evergreen-devparty/auth"), import("@evergreen-devparty/db")]);

  await authDb.insert(schema.forumPosts).values({
    id: input.id,
    authorId: input.authorId,
    title: input.title,
    slug: input.slug,
    contentMarkdown: "seed content",
    contentPlaintext: "seed content",
    status: "published",
    reactionCount: input.reactionCount ?? 0,
    commentCount: input.commentCount ?? 0,
    shareCount: input.shareCount ?? 0,
    lastActivityAt: input.lastActivityAt ?? new Date(),
  });
};

const cleanupUsersAndQueueTargets = async (input: { userIds: string[]; targetIds: string[] }) => {
  const [{ authDb }, { schema }] = await Promise.all([import("@evergreen-devparty/auth"), import("@evergreen-devparty/db")]);

  const userIds = [...new Set(input.userIds)];
  const targetIds = [...new Set(input.targetIds)];

  if (targetIds.length > 0) {
    await authDb.delete(schema.forumSearchSyncQueue).where(inArray(schema.forumSearchSyncQueue.targetId, targetIds));
  }

  if (userIds.length > 0) {
    await authDb.delete(schema.users).where(inArray(schema.users.id, userIds));
  }
};

test("forum DB integration enforces auth on protected write route", async (t) => {
  if (!(await canConnectToDatabase())) {
    t.skip("integration database is not available");
    return;
  }

  const app = await buildForumDbTestApp();

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/forum/posts",
    payload: {
      title: "Unauthorized post",
      markdown: "Should fail without auth header",
    },
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().code, "UNAUTHORIZED");
});

test("forum DB integration happy-path for post comment reaction and report", async (t) => {
  if (!(await canConnectToDatabase())) {
    t.skip("integration database is not available");
    return;
  }

  const authorId = randomUUID();
  const commenterId = randomUUID();
  const reporterId = randomUUID();

  await insertUser({ id: authorId });
  await insertUser({ id: commenterId });
  await insertUser({ id: reporterId });

  const app = await buildForumDbTestApp();

  let postId: string | null = null;
  let commentId: string | null = null;

  t.after(async () => {
    await app.close();
    await cleanupUsersAndQueueTargets({
      userIds: [authorId, commenterId, reporterId],
      targetIds: [postId, commentId].filter((value): value is string => Boolean(value)),
    });
  });

  const createPostResponse = await app.inject({
    method: "POST",
    url: "/api/forum/posts",
    headers: {
      "x-test-user-id": authorId,
    },
    payload: {
      title: `Integration Post ${authorId.slice(0, 8)}`,
      markdown: "hello integration forum",
    },
  });

  assert.equal(createPostResponse.statusCode, 200);
  postId = createPostResponse.json().post.id;

  const createCommentResponse = await app.inject({
    method: "POST",
    url: `/api/forum/posts/${postId}/comments`,
    headers: {
      "x-test-user-id": commenterId,
    },
    payload: {
      markdown: "comment from integration test",
    },
  });

  assert.equal(createCommentResponse.statusCode, 200);
  commentId = createCommentResponse.json().comment.id;

  const reactionResponse = await app.inject({
    method: "POST",
    url: "/api/forum/reactions/toggle",
    headers: {
      "x-test-user-id": authorId,
    },
    payload: {
      targetType: "comment",
      targetId: commentId,
      reactionType: "like",
    },
  });

  assert.equal(reactionResponse.statusCode, 200);
  assert.equal(reactionResponse.json().active, true);

  const reportResponse = await app.inject({
    method: "POST",
    url: "/api/forum/reports",
    headers: {
      "x-test-user-id": reporterId,
    },
    payload: {
      targetType: "comment",
      targetId: commentId,
      reason: "integration report",
    },
  });

  assert.equal(reportResponse.statusCode, 200);
  assert.equal(reportResponse.json().status, "open");
});

test("forum DB integration detail endpoint returns post and comment bodies", async (t) => {
  if (!(await canConnectToDatabase())) {
    t.skip("integration database is not available");
    return;
  }

  const authorId = randomUUID();
  const commenterId = randomUUID();

  await insertUser({ id: authorId });
  await insertUser({ id: commenterId });

  const app = await buildForumDbTestApp();
  let postId: string | null = null;
  let commentId: string | null = null;
  let secondCommentId: string | null = null;

  t.after(async () => {
    await app.close();
    await cleanupUsersAndQueueTargets({
      userIds: [authorId, commenterId],
      targetIds: [postId, commentId, secondCommentId].filter((value): value is string => Boolean(value)),
    });
  });

  const postMarkdown = "## Post body\n\nThis is a full markdown body from integration test.";
  const createPostResponse = await app.inject({
    method: "POST",
    url: "/api/forum/posts",
    headers: {
      "x-test-user-id": authorId,
    },
    payload: {
      title: `Detail body post ${authorId.slice(0, 8)}`,
      markdown: postMarkdown,
    },
  });

  assert.equal(createPostResponse.statusCode, 200);
  postId = createPostResponse.json().post.id;

  const commentMarkdown = "Comment body from integration test";
  const createCommentResponse = await app.inject({
    method: "POST",
    url: `/api/forum/posts/${postId}/comments`,
    headers: {
      "x-test-user-id": commenterId,
    },
    payload: {
      markdown: commentMarkdown,
    },
  });

  assert.equal(createCommentResponse.statusCode, 200);
  commentId = createCommentResponse.json().comment.id;

  const secondCommentMarkdown = "Second comment body from integration test";
  const createSecondCommentResponse = await app.inject({
    method: "POST",
    url: `/api/forum/posts/${postId}/comments`,
    headers: {
      "x-test-user-id": commenterId,
    },
    payload: {
      markdown: secondCommentMarkdown,
    },
  });

  assert.equal(createSecondCommentResponse.statusCode, 200);
  secondCommentId = createSecondCommentResponse.json().comment.id;

  const detailResponse = await app.inject({
    method: "GET",
    url: `/api/forum/posts/${postId}?commentsLimit=1`,
  });

  assert.equal(detailResponse.statusCode, 200);
  const payload = detailResponse.json();
  assert.equal(payload.post.id, postId);
  assert.ok(typeof payload.post.contentMarkdown === "string");
  assert.ok(payload.post.contentMarkdown.includes("full markdown body"));
  assert.ok(Array.isArray(payload.comments));
  assert.equal(payload.comments.length, 1);
  assert.ok(payload.commentsNextCursor);

  const createdComment = payload.comments[0] as { id: string; contentMarkdown?: string };
  assert.ok(createdComment);
  assert.ok(createdComment.id === commentId || createdComment.id === secondCommentId);

  const nextPageResponse = await app.inject({
    method: "GET",
    url: `/api/forum/posts/${postId}?commentsLimit=1&commentsCursor=${payload.commentsNextCursor}`,
  });

  assert.equal(nextPageResponse.statusCode, 200);
  const nextPayload = nextPageResponse.json();
  assert.equal(nextPayload.comments.length, 1);
  const nextComment = nextPayload.comments[0] as { id: string; contentMarkdown?: string };
  assert.ok(nextComment);
  assert.notEqual(nextComment.id, createdComment.id);
  assert.ok([commentMarkdown, secondCommentMarkdown].includes(nextComment.contentMarkdown || ""));
});

test("forum DB integration blocks self-share on own post", async (t) => {
  if (!(await canConnectToDatabase())) {
    t.skip("integration database is not available");
    return;
  }

  const ownerId = randomUUID();
  await insertUser({ id: ownerId });

  const app = await buildForumDbTestApp();
  let postId: string | null = null;

  t.after(async () => {
    await app.close();
    await cleanupUsersAndQueueTargets({
      userIds: [ownerId],
      targetIds: [postId].filter((value): value is string => Boolean(value)),
    });
  });

  const createPostResponse = await app.inject({
    method: "POST",
    url: "/api/forum/posts",
    headers: {
      "x-test-user-id": ownerId,
    },
    payload: {
      title: `Self share ${ownerId.slice(0, 8)}`,
      markdown: "owner post",
    },
  });

  assert.equal(createPostResponse.statusCode, 200);
  postId = createPostResponse.json().post.id;

  const shareResponse = await app.inject({
    method: "POST",
    url: "/api/forum/shares",
    headers: {
      "x-test-user-id": ownerId,
    },
    payload: {
      postId,
      shareComment: "this should fail",
    },
  });

  assert.equal(shareResponse.statusCode, 400);
  assert.equal(shareResponse.json().code, "INVALID_SHARE_TARGET");

  const [{ authDb }, { schema }] = await Promise.all([import("@evergreen-devparty/auth"), import("@evergreen-devparty/db")]);
  assert.ok(postId);
  const postIdValue = postId;
  const shareRows = await authDb
    .select({ id: schema.forumShares.id })
    .from(schema.forumShares)
    .where(eq(schema.forumShares.postId, postIdValue));

  assert.equal(shareRows.length, 0);
});

test("forum DB integration resolves wallet mention to user notification", async (t) => {
  if (!(await canConnectToDatabase())) {
    t.skip("integration database is not available");
    return;
  }

  const authorId = randomUUID();
  const mentionedUserId = randomUUID();
  const walletId = randomUUID();
  const walletAddress = "0x1234567890abcdef1234567890abcdef12345678";

  await insertUser({ id: authorId });
  await insertUser({ id: mentionedUserId });
  await insertWallet({
    id: walletId,
    userId: mentionedUserId,
    chainId: 131,
    address: walletAddress,
    isPrimary: true,
  });

  const app = await buildForumDbTestApp();

  let postId: string | null = null;

  t.after(async () => {
    await app.close();
    await cleanupUsersAndQueueTargets({
      userIds: [authorId, mentionedUserId],
      targetIds: [postId].filter((value): value is string => Boolean(value)),
    });
  });

  const createPostResponse = await app.inject({
    method: "POST",
    url: "/api/forum/posts",
    headers: {
      "x-test-user-id": authorId,
    },
    payload: {
      title: `Wallet mention ${authorId.slice(0, 8)}`,
      markdown: `hello @${walletAddress}`,
    },
  });

  assert.equal(createPostResponse.statusCode, 200);
  postId = createPostResponse.json().post.id;

  const notificationsResponse = await app.inject({
    method: "GET",
    url: "/api/notifications?limit=20&unreadOnly=true",
    headers: {
      "x-test-user-id": mentionedUserId,
    },
  });

  assert.equal(notificationsResponse.statusCode, 200);
  const mentionNotification = notificationsResponse
    .json()
    .notifications.find((item: { type: string; postId: string | null; actorUserId: string | null }) => item.type === "mention");

  assert.ok(mentionNotification);
  assert.equal(mentionNotification.postId, postId);
  assert.equal(mentionNotification.actorUserId, authorId);

  const [{ authDb }, { schema }] = await Promise.all([import("@evergreen-devparty/auth"), import("@evergreen-devparty/db")]);
  assert.ok(postId);
  const postIdValue = postId;
  const mentionRows = await authDb
    .select({
      mentionedUserId: schema.forumMentions.mentionedUserId,
      mentionedWalletAddress: schema.forumMentions.mentionedWalletAddress,
    })
    .from(schema.forumMentions)
    .where(eq(schema.forumMentions.postId, postIdValue));

  const walletMentionRow = mentionRows.find((row) => row.mentionedWalletAddress?.toLowerCase() === walletAddress.toLowerCase());
  assert.ok(walletMentionRow);
  assert.equal(walletMentionRow?.mentionedUserId, mentionedUserId);
});

test("forum DB integration marks all unread notifications as read", async (t) => {
  if (!(await canConnectToDatabase())) {
    t.skip("integration database is not available");
    return;
  }

  const authorId = randomUUID();
  const recipientUserId = randomUUID();
  const walletId = randomUUID();
  const walletAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  await insertUser({ id: authorId });
  await insertUser({ id: recipientUserId });
  await insertWallet({
    id: walletId,
    userId: recipientUserId,
    chainId: 131,
    address: walletAddress,
    isPrimary: true,
  });

  const app = await buildForumDbTestApp();

  let postId: string | null = null;

  t.after(async () => {
    await app.close();
    await cleanupUsersAndQueueTargets({
      userIds: [authorId, recipientUserId],
      targetIds: [postId].filter((value): value is string => Boolean(value)),
    });
  });

  const createPostResponse = await app.inject({
    method: "POST",
    url: "/api/forum/posts",
    headers: {
      "x-test-user-id": authorId,
    },
    payload: {
      title: `Mark all read ${authorId.slice(0, 8)}`,
      markdown: `ping @${walletAddress}`,
    },
  });

  assert.equal(createPostResponse.statusCode, 200);
  postId = createPostResponse.json().post.id;

  const unreadBefore = await app.inject({
    method: "GET",
    url: "/api/notifications?limit=20&unreadOnly=true",
    headers: {
      "x-test-user-id": recipientUserId,
    },
  });

  assert.equal(unreadBefore.statusCode, 200);
  assert.equal(unreadBefore.json().notifications.length > 0, true);

  const markAllReadResponse = await app.inject({
    method: "PATCH",
    url: "/api/notifications/read-all",
    headers: {
      "x-test-user-id": recipientUserId,
    },
  });

  assert.equal(markAllReadResponse.statusCode, 200);
  assert.equal(markAllReadResponse.json().read, true);
  assert.equal(markAllReadResponse.json().updatedCount > 0, true);

  const unreadAfter = await app.inject({
    method: "GET",
    url: "/api/notifications?limit=20&unreadOnly=true",
    headers: {
      "x-test-user-id": recipientUserId,
    },
  });

  assert.equal(unreadAfter.statusCode, 200);
  assert.equal(unreadAfter.json().notifications.length, 0);
});

test("forum DB integration paginates notification list with cursor", async (t) => {
  if (!(await canConnectToDatabase())) {
    t.skip("integration database is not available");
    return;
  }

  const authorId = randomUUID();
  const recipientUserId = randomUUID();
  const walletId = randomUUID();
  const walletAddress = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  await insertUser({ id: authorId });
  await insertUser({ id: recipientUserId });
  await insertWallet({
    id: walletId,
    userId: recipientUserId,
    chainId: 131,
    address: walletAddress,
    isPrimary: true,
  });

  const app = await buildForumDbTestApp();
  const targetIds: string[] = [];

  t.after(async () => {
    await app.close();
    await cleanupUsersAndQueueTargets({
      userIds: [authorId, recipientUserId],
      targetIds,
    });
  });

  const createPostOne = await app.inject({
    method: "POST",
    url: "/api/forum/posts",
    headers: {
      "x-test-user-id": authorId,
    },
    payload: {
      title: `Notif pagination one ${authorId.slice(0, 8)}`,
      markdown: `hello @${walletAddress}`,
    },
  });
  assert.equal(createPostOne.statusCode, 200);
  targetIds.push(createPostOne.json().post.id);

  const createPostTwo = await app.inject({
    method: "POST",
    url: "/api/forum/posts",
    headers: {
      "x-test-user-id": authorId,
    },
    payload: {
      title: `Notif pagination two ${authorId.slice(0, 8)}`,
      markdown: `hello again @${walletAddress}`,
    },
  });
  assert.equal(createPostTwo.statusCode, 200);
  targetIds.push(createPostTwo.json().post.id);

  const firstPageResponse = await app.inject({
    method: "GET",
    url: "/api/notifications?limit=1&unreadOnly=true",
    headers: {
      "x-test-user-id": recipientUserId,
    },
  });

  assert.equal(firstPageResponse.statusCode, 200);
  const firstPagePayload = firstPageResponse.json();
  assert.equal(firstPagePayload.notifications.length, 1);
  assert.ok(firstPagePayload.nextCursor);

  const secondPageResponse = await app.inject({
    method: "GET",
    url: `/api/notifications?limit=1&unreadOnly=true&cursor=${firstPagePayload.nextCursor}`,
    headers: {
      "x-test-user-id": recipientUserId,
    },
  });

  assert.equal(secondPageResponse.statusCode, 200);
  const secondPagePayload = secondPageResponse.json();
  assert.equal(secondPagePayload.notifications.length, 1);
  assert.notEqual(secondPagePayload.notifications[0].id, firstPagePayload.notifications[0].id);
});

test("forum DB integration top topics ranks creators by aggregated popularity", async (t) => {
  if (!(await canConnectToDatabase())) {
    t.skip("integration database is not available");
    return;
  }

  const creatorA = randomUUID();
  const creatorB = randomUUID();
  const postA1 = randomUUID();
  const postA2 = randomUUID();
  const postB1 = randomUUID();

  await insertUser({ id: creatorA });
  await insertUser({ id: creatorB });

  await insertForumPostRow({
    id: postA1,
    authorId: creatorA,
    title: "Creator A topic 1",
    slug: `creator-a-1-${postA1.slice(0, 8)}`,
    reactionCount: 10,
    commentCount: 4,
    shareCount: 2,
  });
  await insertForumPostRow({
    id: postA2,
    authorId: creatorA,
    title: "Creator A topic 2",
    slug: `creator-a-2-${postA2.slice(0, 8)}`,
    reactionCount: 5,
    commentCount: 3,
    shareCount: 1,
  });
  await insertForumPostRow({
    id: postB1,
    authorId: creatorB,
    title: "Creator B topic 1",
    slug: `creator-b-1-${postB1.slice(0, 8)}`,
    reactionCount: 12,
    commentCount: 2,
    shareCount: 1,
  });

  const app = await buildForumDbTestApp();

  t.after(async () => {
    await app.close();
    await cleanupUsersAndQueueTargets({
      userIds: [creatorA, creatorB],
      targetIds: [postA1, postA2, postB1],
    });
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/forum/top-topics?limit=2",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().topics.length, 2);
  assert.equal(response.json().topics[0].userId, creatorA);
  assert.equal(response.json().topics[0].topicCount, 2);
  assert.equal(response.json().topics[0].popularityScore, 25);
  assert.equal(response.json().topics[1].userId, creatorB);
  assert.equal(response.json().topics[1].popularityScore, 15);
});

test("forum DB integration rejects forbidden pin by non-owner non-moderator", async (t) => {
  if (!(await canConnectToDatabase())) {
    t.skip("integration database is not available");
    return;
  }

  const ownerId = randomUUID();
  const strangerId = randomUUID();

  await insertUser({ id: ownerId });
  await insertUser({ id: strangerId });

  const app = await buildForumDbTestApp();

  let postId: string | null = null;

  t.after(async () => {
    await app.close();
    await cleanupUsersAndQueueTargets({
      userIds: [ownerId, strangerId],
      targetIds: [postId].filter((value): value is string => Boolean(value)),
    });
  });

  const createPostResponse = await app.inject({
    method: "POST",
    url: "/api/forum/posts",
    headers: {
      "x-test-user-id": ownerId,
    },
    payload: {
      title: `Pin target ${ownerId.slice(0, 8)}`,
      markdown: "owner content",
    },
  });

  assert.equal(createPostResponse.statusCode, 200);
  postId = createPostResponse.json().post.id;

  const pinResponse = await app.inject({
    method: "POST",
    url: `/api/forum/posts/${postId}/pin`,
    headers: {
      "x-test-user-id": strangerId,
    },
    payload: {
      pinned: true,
    },
  });

  assert.equal(pinResponse.statusCode, 403);
  assert.equal(pinResponse.json().code, "FORBIDDEN");
});

test("forum DB integration moderator can lock post and resolve report", async (t) => {
  if (!(await canConnectToDatabase())) {
    t.skip("integration database is not available");
    return;
  }

  const ownerId = randomUUID();
  const reporterId = randomUUID();
  const moderatorId = randomUUID();

  await insertUser({ id: ownerId });
  await insertUser({ id: reporterId });
  await insertUser({ id: moderatorId, role: "moderator" });

  const app = await buildForumDbTestApp();
  let postId: string | null = null;
  let reportId: string | null = null;

  t.after(async () => {
    await app.close();
    await cleanupUsersAndQueueTargets({
      userIds: [ownerId, reporterId, moderatorId],
      targetIds: [postId, reportId].filter((value): value is string => Boolean(value)),
    });
  });

  const createPostResponse = await app.inject({
    method: "POST",
    url: "/api/forum/posts",
    headers: {
      "x-test-user-id": ownerId,
    },
    payload: {
      title: `Mod target ${ownerId.slice(0, 8)}`,
      markdown: "moderation target post",
    },
  });

  assert.equal(createPostResponse.statusCode, 200);
  postId = createPostResponse.json().post.id;

  const reportResponse = await app.inject({
    method: "POST",
    url: "/api/forum/reports",
    headers: {
      "x-test-user-id": reporterId,
    },
    payload: {
      targetType: "post",
      targetId: postId,
      reason: "integration moderation review",
    },
  });

  assert.equal(reportResponse.statusCode, 200);
  reportId = reportResponse.json().reportId;

  const listOpenResponse = await app.inject({
    method: "GET",
    url: "/api/forum/mod/reports?status=open&limit=20",
    headers: {
      "x-test-user-id": moderatorId,
    },
  });

  assert.equal(listOpenResponse.statusCode, 200);
  assert.ok(Array.isArray(listOpenResponse.json().reports));
  assert.ok(listOpenResponse.json().reports.some((report: { id: string }) => report.id === reportId));

  const lockResponse = await app.inject({
    method: "POST",
    url: `/api/forum/mod/posts/${postId}/lock`,
    headers: {
      "x-test-user-id": moderatorId,
    },
    payload: {
      locked: true,
    },
  });

  assert.equal(lockResponse.statusCode, 200);
  assert.equal(lockResponse.json().locked, true);

  const detailResponse = await app.inject({
    method: "GET",
    url: `/api/forum/posts/${postId}`,
  });
  assert.equal(detailResponse.statusCode, 200);
  assert.equal(detailResponse.json().post.isLocked, true);

  const resolveResponse = await app.inject({
    method: "PATCH",
    url: `/api/forum/mod/reports/${reportId}`,
    headers: {
      "x-test-user-id": moderatorId,
    },
    payload: {
      status: "resolved",
    },
  });

  assert.equal(resolveResponse.statusCode, 200);
  assert.equal(resolveResponse.json().status, "resolved");

  const listResolvedResponse = await app.inject({
    method: "GET",
    url: "/api/forum/mod/reports?status=resolved&limit=20",
    headers: {
      "x-test-user-id": moderatorId,
    },
  });

  assert.equal(listResolvedResponse.statusCode, 200);
  assert.ok(listResolvedResponse.json().reports.some((report: { id: string; status: string }) => report.id === reportId && report.status === "resolved"));
});

test("forum DB integration end-to-end flow post interaction and profile update", async (t) => {
  if (!(await canConnectToDatabase())) {
    t.skip("integration database is not available");
    return;
  }

  const authorId = randomUUID();
  const actorId = randomUUID();

  await insertUser({ id: authorId });
  await insertUser({ id: actorId });

  const app = await buildForumDbTestApp();
  let postId: string | null = null;
  let commentId: string | null = null;

  t.after(async () => {
    await app.close();
    await cleanupUsersAndQueueTargets({
      userIds: [authorId, actorId],
      targetIds: [postId, commentId].filter((value): value is string => Boolean(value)),
    });
  });

  const createPostResponse = await app.inject({
    method: "POST",
    url: "/api/forum/posts",
    headers: {
      "x-test-user-id": authorId,
    },
    payload: {
      title: `E2E flow ${authorId.slice(0, 8)}`,
      markdown: "Initial post body for end-to-end integration flow.",
    },
  });

  assert.equal(createPostResponse.statusCode, 200);
  postId = createPostResponse.json().post.id;

  const reactionResponse = await app.inject({
    method: "POST",
    url: "/api/forum/reactions/toggle",
    headers: {
      "x-test-user-id": actorId,
    },
    payload: {
      targetType: "post",
      targetId: postId,
      reactionType: "like",
    },
  });
  assert.equal(reactionResponse.statusCode, 200);
  assert.equal(reactionResponse.json().active, true);

  const bookmarkResponse = await app.inject({
    method: "POST",
    url: "/api/forum/bookmarks/toggle",
    headers: {
      "x-test-user-id": actorId,
    },
    payload: {
      postId,
    },
  });
  assert.equal(bookmarkResponse.statusCode, 200);
  assert.equal(bookmarkResponse.json().bookmarked, true);

  const shareResponse = await app.inject({
    method: "POST",
    url: "/api/forum/shares",
    headers: {
      "x-test-user-id": actorId,
    },
    payload: {
      postId,
      shareComment: "sharing this discussion",
    },
  });
  assert.equal(shareResponse.statusCode, 200);

  const followResponse = await app.inject({
    method: "POST",
    url: "/api/forum/follows/toggle",
    headers: {
      "x-test-user-id": actorId,
    },
    payload: {
      followeeUserId: authorId,
    },
  });
  assert.equal(followResponse.statusCode, 200);
  assert.equal(followResponse.json().following, true);

  const threadDetailBeforeComment = await app.inject({
    method: "GET",
    url: `/api/forum/posts/${postId}`,
  });
  assert.equal(threadDetailBeforeComment.statusCode, 200);
  assert.equal(threadDetailBeforeComment.json().post.id, postId);

  const createCommentResponse = await app.inject({
    method: "POST",
    url: `/api/forum/posts/${postId}/comments`,
    headers: {
      "x-test-user-id": actorId,
    },
    payload: {
      markdown: "Comment from integration actor",
    },
  });
  assert.equal(createCommentResponse.statusCode, 200);
  commentId = createCommentResponse.json().comment.id;

  const threadDetailAfterComment = await app.inject({
    method: "GET",
    url: `/api/forum/posts/${postId}`,
  });
  assert.equal(threadDetailAfterComment.statusCode, 200);
  assert.ok(threadDetailAfterComment.json().comments.some((comment: { id: string }) => comment.id === commentId));

  const updateProfileResponse = await app.inject({
    method: "PATCH",
    url: "/api/profile/me",
    headers: {
      "x-test-user-id": authorId,
    },
    payload: {
      displayName: "Integration Author",
      bio: "Updated via end-to-end integration test",
      websiteUrl: "https://example.com/integration",
      githubUsername: "integration-author",
      location: "Jakarta",
    },
  });
  assert.equal(updateProfileResponse.statusCode, 200);

  const profileResponse = await app.inject({
    method: "GET",
    url: `/api/profile/${authorId}`,
  });
  assert.equal(profileResponse.statusCode, 200);
  assert.equal(profileResponse.json().profile.displayName, "Integration Author");
  assert.equal(profileResponse.json().profile.bio, "Updated via end-to-end integration test");
  assert.equal(profileResponse.json().profile.githubUsername, "integration-author");
});

test("forum DB integration enforces max reply depth", async (t) => {
  if (!(await canConnectToDatabase())) {
    t.skip("integration database is not available");
    return;
  }

  const userId = randomUUID();
  await insertUser({ id: userId });

  const app = await buildForumDbTestApp();

  let postId: string | null = null;
  const commentIds: string[] = [];

  t.after(async () => {
    await app.close();
    await cleanupUsersAndQueueTargets({
      userIds: [userId],
      targetIds: [postId, ...commentIds].filter((value): value is string => Boolean(value)),
    });
  });

  const createPostResponse = await app.inject({
    method: "POST",
    url: "/api/forum/posts",
    headers: {
      "x-test-user-id": userId,
    },
    payload: {
      title: `Depth test ${userId.slice(0, 8)}`,
      markdown: "depth base post",
    },
  });

  assert.equal(createPostResponse.statusCode, 200);
  postId = createPostResponse.json().post.id;

  let parentId: string | undefined;
  for (let index = 0; index < 4; index += 1) {
    const response = await app.inject({
      method: "POST",
      url: `/api/forum/posts/${postId}/comments`,
      headers: {
        "x-test-user-id": userId,
      },
      payload: {
        markdown: `depth level ${index}`,
        parentId,
      },
    });

    assert.equal(response.statusCode, 200);
    const createdId = response.json().comment.id as string;
    commentIds.push(createdId);
    parentId = createdId;
  }

  const overflowResponse = await app.inject({
    method: "POST",
    url: `/api/forum/posts/${postId}/comments`,
    headers: {
      "x-test-user-id": userId,
    },
    payload: {
      markdown: "should exceed depth",
      parentId,
    },
  });

  assert.equal(overflowResponse.statusCode, 400);
  assert.equal(overflowResponse.json().code, "MAX_REPLY_DEPTH_EXCEEDED");
});
