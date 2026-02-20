import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, lt, or } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { HttpError } from "../lib/http-error";
import { recordForumActionMetric } from "./forum-metrics";
import { assertCanLockPost, assertModeratorAccess, ensureNoOpenDuplicateReport, resolveForumReportTarget } from "./forum-permissions";

type ModerationReportStatus = "open" | "resolved" | "dismissed";

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

  recordForumActionMetric("report_create");

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

export const listForumReportsForModeration = async (input: {
  moderatorUserId: string;
  status?: ModerationReportStatus;
  limit?: number;
  cursor?: string;
}) => {
  await assertModeratorAccess(input.moderatorUserId);

  const limit = Math.max(1, Math.min(input.limit ?? 30, 200));
  const filters = [input.status ? eq(schema.forumReports.status, input.status) : undefined];

  if (input.cursor) {
    const [cursorReport] = await authDb
      .select({
        id: schema.forumReports.id,
        createdAt: schema.forumReports.createdAt,
      })
      .from(schema.forumReports)
      .where(eq(schema.forumReports.id, input.cursor))
      .limit(1);

    if (cursorReport) {
      const cursorFilter = or(
        lt(schema.forumReports.createdAt, cursorReport.createdAt),
        and(eq(schema.forumReports.createdAt, cursorReport.createdAt), lt(schema.forumReports.id, cursorReport.id))
      );

      if (cursorFilter) {
        filters.push(cursorFilter);
      }
    }
  }

  const reports = await authDb
    .select()
    .from(schema.forumReports)
    .where(and(...filters))
    .orderBy(desc(schema.forumReports.createdAt), desc(schema.forumReports.id))
    .limit(limit);

  const postIds = [...new Set(reports.map((report) => report.postId).filter((value): value is string => Boolean(value)))];
  const commentIds = [...new Set(reports.map((report) => report.commentId).filter((value): value is string => Boolean(value)))];
  const userIds = [
    ...new Set(
      reports
        .flatMap((report) => [report.reporterUserId, report.reportedUserId, report.reviewedByUserId])
        .filter((value): value is string => Boolean(value))
    ),
  ];

  const [posts, comments, users] = await Promise.all([
    postIds.length > 0
      ? authDb
          .select({
            id: schema.forumPosts.id,
            title: schema.forumPosts.title,
            isLocked: schema.forumPosts.isLocked,
          })
          .from(schema.forumPosts)
          .where(inArray(schema.forumPosts.id, postIds))
      : Promise.resolve([]),
    commentIds.length > 0
      ? authDb
          .select({
            id: schema.forumComments.id,
            contentPlaintext: schema.forumComments.contentPlaintext,
            postId: schema.forumComments.postId,
          })
          .from(schema.forumComments)
          .where(inArray(schema.forumComments.id, commentIds))
      : Promise.resolve([]),
    userIds.length > 0
      ? authDb
          .select({
            id: schema.users.id,
            name: schema.users.name,
            username: schema.users.username,
            email: schema.users.email,
            role: schema.users.role,
          })
          .from(schema.users)
          .where(inArray(schema.users.id, userIds))
      : Promise.resolve([]),
  ]);

  const postById = new Map(posts.map((post) => [post.id, post]));
  const commentById = new Map(comments.map((comment) => [comment.id, comment]));
  const userById = new Map(users.map((user) => [user.id, user]));

  return {
    reports: reports.map((report) => {
      const post = report.postId ? postById.get(report.postId) : null;
      const comment = report.commentId ? commentById.get(report.commentId) : null;

      return {
        id: report.id,
        status: report.status,
        reason: report.reason,
        targetType: report.targetType,
        postId: report.postId,
        commentId: report.commentId,
        reportedUserId: report.reportedUserId,
        reporterUserId: report.reporterUserId,
        reviewedByUserId: report.reviewedByUserId,
        reviewedAt: report.reviewedAt,
        createdAt: report.createdAt,
        updatedAt: report.updatedAt,
        postTitle: post?.title ?? null,
        postLocked: post?.isLocked ?? false,
        commentPreview: comment?.contentPlaintext ? comment.contentPlaintext.slice(0, 220) : null,
        targetId: report.targetType === "post" ? report.postId : report.targetType === "comment" ? report.commentId : report.reportedUserId,
        reporter: report.reporterUserId ? userById.get(report.reporterUserId) ?? null : null,
        reportedUser: report.reportedUserId ? userById.get(report.reportedUserId) ?? null : null,
        reviewedBy: report.reviewedByUserId ? userById.get(report.reviewedByUserId) ?? null : null,
      };
    }),
    nextCursor: reports.at(-1)?.id ?? null,
  };
};

export const resolveForumReportAsModerator = async (input: {
  moderatorUserId: string;
  reportId: string;
  status: Exclude<ModerationReportStatus, "open">;
}) => {
  await assertModeratorAccess(input.moderatorUserId);

  const [report] = await authDb
    .select({
      id: schema.forumReports.id,
      status: schema.forumReports.status,
    })
    .from(schema.forumReports)
    .where(eq(schema.forumReports.id, input.reportId))
    .limit(1);

  if (!report) {
    throw new HttpError(404, "REPORT_NOT_FOUND", "Forum report not found");
  }

  const now = new Date();
  await authDb
    .update(schema.forumReports)
    .set({
      status: input.status,
      reviewedByUserId: input.moderatorUserId,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.forumReports.id, input.reportId));

  return {
    reportId: input.reportId,
    previousStatus: report.status,
    status: input.status,
    reviewedByUserId: input.moderatorUserId,
    reviewedAt: now,
  };
};
