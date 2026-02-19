import { and, eq } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { HttpError } from "../lib/http-error";
import { ensureUserExists, getCommentById, getPostById } from "./forum-core.shared";

type UserRole = typeof schema.users.$inferSelect.role;

const isModeratorOrAdmin = (role: UserRole | null | undefined): boolean => role === "moderator" || role === "admin";

export const assertCanPinPost = async (input: { actorUserId: string; postId: string }) => {
  const [actor, post] = await Promise.all([ensureUserExists(input.actorUserId), getPostById(input.postId)]);

  if (post.authorId === input.actorUserId) {
    return {
      actor,
      post,
      scope: "owner" as const,
    };
  }

  if (isModeratorOrAdmin(actor.role)) {
    return {
      actor,
      post,
      scope: "moderator" as const,
    };
  }

  throw new HttpError(403, "FORBIDDEN", "Only post owner or moderator/admin can pin this post");
};

export const assertCanLockPost = async (input: { actorUserId: string; postId: string }) => {
  const [actor, post] = await Promise.all([ensureUserExists(input.actorUserId), getPostById(input.postId)]);

  if (!isModeratorOrAdmin(actor.role)) {
    throw new HttpError(403, "FORBIDDEN", "Moderator access required to lock or unlock posts");
  }

  return {
    actor,
    post,
    scope: "moderator" as const,
  };
};

export const resolveForumReportTarget = async (input: {
  reporterUserId: string;
  targetType: "post" | "comment" | "user";
  targetId: string;
}) => {
  const reporter = await ensureUserExists(input.reporterUserId);

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
    const user = await ensureUserExists(input.targetId);
    reportedUserId = user.id;
  }

  if (reportedUserId === input.reporterUserId) {
    throw new HttpError(400, "INVALID_REPORT_TARGET", "You cannot report your own content or account");
  }

  return {
    reporter,
    postId,
    commentId,
    reportedUserId,
  };
};

export const ensureNoOpenDuplicateReport = async (input: {
  reporterUserId: string;
  targetType: "post" | "comment" | "user";
  targetId: string;
}) => {
  const [existing] = await authDb
    .select({ id: schema.forumReports.id })
    .from(schema.forumReports)
    .where(
      and(
        eq(schema.forumReports.reporterUserId, input.reporterUserId),
        eq(schema.forumReports.targetType, input.targetType),
        eq(schema.forumReports.status, "open"),
        input.targetType === "post"
          ? eq(schema.forumReports.postId, input.targetId)
          : input.targetType === "comment"
            ? eq(schema.forumReports.commentId, input.targetId)
            : eq(schema.forumReports.reportedUserId, input.targetId)
      )
    )
    .limit(1);

  if (existing) {
    throw new HttpError(409, "REPORT_ALREADY_OPEN", "You already have an open report for this target");
  }
};
