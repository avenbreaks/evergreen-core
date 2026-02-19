import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { eq, inArray, sql } from "drizzle-orm";

import { HttpError } from "../lib/http-error";

const DEFAULT_DATABASE_URL = "postgresql://devparty:devparty@localhost:5436/devpartydb";

const ensureIntegrationEnv = (): void => {
  process.env.DATABASE_URL ??= DEFAULT_DATABASE_URL;
  process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-0123456789abcdef";
  process.env.BETTER_AUTH_URL ??= "http://localhost:3001";
  process.env.BETTER_AUTH_TRUSTED_ORIGINS ??= "http://localhost:3000,http://localhost:3001";
  process.env.WEBHOOK_SECRET ??= "integration-webhook-secret";
  process.env.WEBHOOK_IP_ALLOWLIST ??= "";
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

const createUserRow = (id: string, role: "user" | "moderator" | "admin" = "user") => ({
  id,
  email: `integration-${id}@example.com`,
  name: `Integration ${id.slice(0, 8)}`,
  role,
});

const createPostRow = (id: string, authorId: string) => ({
  id,
  authorId,
  title: `Post ${id.slice(0, 8)}`,
  slug: `post-${id.slice(0, 8)}`,
  contentMarkdown: "hello world",
  contentPlaintext: "hello world",
});

test("setForumPostPinned enforces owner-or-moderator permission matrix", async (t) => {
  if (!(await canConnectToDatabase())) {
    t.skip("integration database is not available");
    return;
  }

  const [{ authDb }, { schema }, social] = await Promise.all([
    import("@evergreen-devparty/auth"),
    import("@evergreen-devparty/db"),
    import("./forum-core.social"),
  ]);

  const ownerId = randomUUID();
  const moderatorId = randomUUID();
  const strangerId = randomUUID();
  const postId = randomUUID();

  t.after(async () => {
    await authDb.delete(schema.forumPosts).where(eq(schema.forumPosts.id, postId));
    await authDb.delete(schema.users).where(inArray(schema.users.id, [ownerId, moderatorId, strangerId]));
  });

  await authDb.insert(schema.users).values([
    createUserRow(ownerId, "user"),
    createUserRow(moderatorId, "moderator"),
    createUserRow(strangerId, "user"),
  ]);
  await authDb.insert(schema.forumPosts).values(createPostRow(postId, ownerId));

  const ownerResult = await social.setForumPostPinned({
    userId: ownerId,
    postId,
    pinned: true,
  });
  assert.equal(ownerResult.pinned, true);

  await assert.rejects(
    () =>
      social.setForumPostPinned({
        userId: strangerId,
        postId,
        pinned: false,
      }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.code, "FORBIDDEN");
      return true;
    }
  );

  const moderatorResult = await social.setForumPostPinned({
    userId: moderatorId,
    postId,
    pinned: false,
  });
  assert.equal(moderatorResult.pinned, false);
});

test("createForumReport blocks self-report and duplicate open report", async (t) => {
  if (!(await canConnectToDatabase())) {
    t.skip("integration database is not available");
    return;
  }

  const [{ authDb }, { schema }, moderation] = await Promise.all([
    import("@evergreen-devparty/auth"),
    import("@evergreen-devparty/db"),
    import("./forum-core.moderation"),
  ]);

  const reporterId = randomUUID();
  const targetAuthorId = randomUUID();
  const postId = randomUUID();

  t.after(async () => {
    await authDb.delete(schema.forumReports).where(eq(schema.forumReports.postId, postId));
    await authDb.delete(schema.forumPosts).where(eq(schema.forumPosts.id, postId));
    await authDb.delete(schema.users).where(inArray(schema.users.id, [reporterId, targetAuthorId]));
  });

  await authDb.insert(schema.users).values([createUserRow(reporterId), createUserRow(targetAuthorId)]);
  await authDb.insert(schema.forumPosts).values(createPostRow(postId, targetAuthorId));

  await assert.rejects(
    () =>
      moderation.createForumReport({
        reporterUserId: targetAuthorId,
        targetType: "post",
        targetId: postId,
        reason: "self report attempt",
      }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.code, "INVALID_REPORT_TARGET");
      return true;
    }
  );

  const created = await moderation.createForumReport({
    reporterUserId: reporterId,
    targetType: "post",
    targetId: postId,
    reason: "spam",
  });
  assert.equal(created.status, "open");

  await assert.rejects(
    () =>
      moderation.createForumReport({
        reporterUserId: reporterId,
        targetType: "post",
        targetId: postId,
        reason: "duplicate",
      }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.code, "REPORT_ALREADY_OPEN");
      return true;
    }
  );
});

test("lockForumPostAsModerator requires moderator role", async (t) => {
  if (!(await canConnectToDatabase())) {
    t.skip("integration database is not available");
    return;
  }

  const [{ authDb }, { schema }, moderation] = await Promise.all([
    import("@evergreen-devparty/auth"),
    import("@evergreen-devparty/db"),
    import("./forum-core.moderation"),
  ]);

  const ownerId = randomUUID();
  const moderatorId = randomUUID();
  const postId = randomUUID();

  t.after(async () => {
    await authDb.delete(schema.forumPosts).where(eq(schema.forumPosts.id, postId));
    await authDb.delete(schema.users).where(inArray(schema.users.id, [ownerId, moderatorId]));
  });

  await authDb.insert(schema.users).values([createUserRow(ownerId), createUserRow(moderatorId, "moderator")]);
  await authDb.insert(schema.forumPosts).values(createPostRow(postId, ownerId));

  await assert.rejects(
    () =>
      moderation.lockForumPostAsModerator({
        moderatorUserId: ownerId,
        postId,
        locked: true,
      }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.code, "FORBIDDEN");
      return true;
    }
  );

  const result = await moderation.lockForumPostAsModerator({
    moderatorUserId: moderatorId,
    postId,
    locked: true,
  });
  assert.equal(result.locked, true);
});
