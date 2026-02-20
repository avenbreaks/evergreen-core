import { z } from "zod";

export const markdownBodySchema = z.object({
  markdown: z.string().min(1).max(20000),
});

export const createPostBodySchema = z.object({
  title: z.string().min(3).max(280),
  markdown: z.string().min(1).max(20000),
  tags: z.array(z.string().min(1).max(40)).max(12).optional(),
});

export const updatePostBodySchema = z
  .object({
    title: z.string().min(3).max(280).optional(),
    markdown: z.string().min(1).max(20000).optional(),
  })
  .refine((value) => value.title !== undefined || value.markdown !== undefined, {
    message: "Provide at least one field to update",
  });

export const postParamsSchema = z.object({
  postId: z.string().uuid(),
});

export const postDetailQuerySchema = z.object({
  commentsLimit: z.coerce.number().int().positive().max(100).optional(),
  commentsCursor: z.string().uuid().optional(),
});

export const createCommentBodySchema = z.object({
  markdown: z.string().min(1).max(12000),
  parentId: z.string().uuid().optional(),
});

export const commentParamsSchema = z.object({
  commentId: z.string().uuid(),
});

export const listPostsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().uuid().optional(),
});

export const draftQuerySchema = z.object({
  parentCommentId: z.string().uuid().optional(),
});

export const reactionToggleBodySchema = z.object({
  targetType: z.enum(["post", "comment"]),
  targetId: z.string().uuid(),
  reactionType: z.string().min(1).max(32),
});

export const shareBodySchema = z.object({
  postId: z.string().uuid(),
  shareComment: z.string().max(500).optional(),
});

export const bookmarkToggleBodySchema = z.object({
  postId: z.string().uuid(),
  pinned: z.boolean().optional(),
});

export const followToggleBodySchema = z.object({
  followeeUserId: z.string().uuid(),
});

export const pinBodySchema = z.object({
  pinned: z.boolean(),
});

export const feedQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().uuid().optional(),
  followingOnly: z.coerce.boolean().optional(),
});

export const searchQuerySchema = z.object({
  query: z.string().min(1).max(200),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const limitQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const reportBodySchema = z.object({
  targetType: z.enum(["post", "comment", "user"]),
  targetId: z.string().uuid(),
  reason: z.string().min(3).max(2000),
});

export const lockBodySchema = z.object({
  locked: z.boolean(),
});

export const moderationReportListQuerySchema = z.object({
  status: z.enum(["open", "resolved", "dismissed"]).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  cursor: z.string().uuid().optional(),
});

export const moderationReportParamsSchema = z.object({
  reportId: z.string().uuid(),
});

export const moderationResolveBodySchema = z.object({
  status: z.enum(["resolved", "dismissed"]),
});

export const notificationListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  unreadOnly: z.coerce.boolean().optional(),
});

export const notificationParamsSchema = z.object({
  notificationId: z.string().uuid(),
});

export const profileParamsSchema = z.object({
  userId: z.string().uuid(),
});

export const profileUpdateBodySchema = z.object({
  location: z.string().max(160).optional(),
  organization: z.string().max(160).optional(),
  websiteUrl: z.string().max(1000).optional(),
  brandingEmail: z.string().email().max(320).optional(),
  displayWalletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  displayEnsName: z.string().max(255).optional(),
});
