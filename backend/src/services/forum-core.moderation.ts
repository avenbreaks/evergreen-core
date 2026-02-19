import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { HttpError } from "../lib/http-error";
import { ensureModerator, ensureUserExists, getCommentById, getPostById } from "./forum-core.shared";

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
