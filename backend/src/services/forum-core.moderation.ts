import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { HttpError } from "../lib/http-error";
import { assertCanLockPost, ensureNoOpenDuplicateReport, resolveForumReportTarget } from "./forum-permissions";

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

  const target = await resolveForumReportTarget({
    reporterUserId: input.reporterUserId,
    targetType: input.targetType,
    targetId: input.targetId,
  });

  await ensureNoOpenDuplicateReport({
    reporterUserId: input.reporterUserId,
    targetType: input.targetType,
    targetId: input.targetId,
  });

  const reportId = randomUUID();
  await authDb.insert(schema.forumReports).values({
    id: reportId,
    targetType: input.targetType,
    postId: target.postId,
    commentId: target.commentId,
    reportedUserId: target.reportedUserId,
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
  const { post } = await assertCanLockPost({
    actorUserId: input.moderatorUserId,
    postId: input.postId,
  });

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
