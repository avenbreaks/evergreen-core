import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuthSession } from "../lib/auth-session";
import { requireAuthSessionMiddleware } from "../middleware/auth-session";
import { createDebounceMiddleware, hashDebouncePayload } from "../middleware/debounce-limit";
import {
  createForumReport,
  createForumShare,
  createForumComment,
  createForumPost,
  deleteReplyDraft,
  getForumFeed,
  getForumPostDetail,
  getForumProfile,
  getReplyDraft,
  listForumPosts,
  listForumNotifications,
  listTopActiveUsers,
  listTopDiscussions,
  listTopTopics,
  listTrendingTags,
  lockForumPostAsModerator,
  markForumNotificationRead,
  previewForumMarkdown,
  searchForumContent,
  setForumPostPinned,
  softDeleteForumComment,
  softDeleteForumPost,
  toggleForumBookmark,
  toggleForumFollow,
  toggleForumReaction,
  updateForumProfile,
  updateForumComment,
  updateForumPost,
  upsertReplyDraft,
} from "../services/forum-core";

const markdownBodySchema = z.object({
  markdown: z.string().min(1).max(20000),
});

const createPostBodySchema = z.object({
  title: z.string().min(3).max(280),
  markdown: z.string().min(1).max(20000),
  tags: z.array(z.string().min(1).max(40)).max(12).optional(),
});

const updatePostBodySchema = z
  .object({
    title: z.string().min(3).max(280).optional(),
    markdown: z.string().min(1).max(20000).optional(),
  })
  .refine((value) => value.title !== undefined || value.markdown !== undefined, {
    message: "Provide at least one field to update",
  });

const postParamsSchema = z.object({
  postId: z.string().uuid(),
});

const createCommentBodySchema = z.object({
  markdown: z.string().min(1).max(12000),
  parentId: z.string().uuid().optional(),
});

const commentParamsSchema = z.object({
  commentId: z.string().uuid(),
});

const listPostsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().uuid().optional(),
});

const draftQuerySchema = z.object({
  parentCommentId: z.string().uuid().optional(),
});

const reactionToggleBodySchema = z.object({
  targetType: z.enum(["post", "comment"]),
  targetId: z.string().uuid(),
  reactionType: z.string().min(1).max(32),
});

const shareBodySchema = z.object({
  postId: z.string().uuid(),
  shareComment: z.string().max(500).optional(),
});

const bookmarkToggleBodySchema = z.object({
  postId: z.string().uuid(),
  pinned: z.boolean().optional(),
});

const followToggleBodySchema = z.object({
  followeeUserId: z.string().uuid(),
});

const pinBodySchema = z.object({
  pinned: z.boolean(),
});

const feedQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().uuid().optional(),
  followingOnly: z.coerce.boolean().optional(),
});

const searchQuerySchema = z.object({
  query: z.string().min(1).max(200),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

const limitQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
});

const reportBodySchema = z.object({
  targetType: z.enum(["post", "comment", "user"]),
  targetId: z.string().uuid(),
  reason: z.string().min(3).max(2000),
});

const lockBodySchema = z.object({
  locked: z.boolean(),
});

const notificationListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  unreadOnly: z.coerce.boolean().optional(),
});

const notificationParamsSchema = z.object({
  notificationId: z.string().uuid(),
});

const profileParamsSchema = z.object({
  userId: z.string().uuid(),
});

const profileUpdateBodySchema = z.object({
  location: z.string().max(160).optional(),
  organization: z.string().max(160).optional(),
  websiteUrl: z.string().max(1000).optional(),
  brandingEmail: z.string().email().max(320).optional(),
  displayWalletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  displayEnsName: z.string().max(255).optional(),
});

export const forumRoutes: FastifyPluginAsync = async (app) => {
  const debounceForumWrite = createDebounceMiddleware({
    namespace: "forum.write",
    key: async (request) => {
      const authSession = await requireAuthSession(request);
      return `${authSession.user.id}:${request.routeOptions.url}:${hashDebouncePayload(request.body)}`;
    },
  });

  app.post(
    "/api/forum/content/preview",
    {
      preHandler: [requireAuthSessionMiddleware, debounceForumWrite],
    },
    async (request) => {
      const body = markdownBodySchema.parse(request.body);
      return previewForumMarkdown({
        markdown: body.markdown,
      });
    }
  );

  app.post(
    "/api/forum/posts",
    {
      preHandler: [requireAuthSessionMiddleware, debounceForumWrite],
    },
    async (request) => {
      const authSession = await requireAuthSession(request);
      const body = createPostBodySchema.parse(request.body);

      return createForumPost({
        userId: authSession.user.id,
        title: body.title,
        markdown: body.markdown,
        tags: body.tags,
      });
    }
  );

  app.get("/api/forum/posts", async (request) => {
    const query = listPostsQuerySchema.parse(request.query);
    return listForumPosts({
      limit: query.limit,
      cursor: query.cursor,
    });
  });

  app.get("/api/forum/posts/:postId", async (request) => {
    const params = postParamsSchema.parse(request.params);
    return getForumPostDetail(params.postId);
  });

  app.patch(
    "/api/forum/posts/:postId",
    {
      preHandler: [requireAuthSessionMiddleware, debounceForumWrite],
    },
    async (request) => {
      const authSession = await requireAuthSession(request);
      const params = postParamsSchema.parse(request.params);
      const body = updatePostBodySchema.parse(request.body);

      return updateForumPost({
        userId: authSession.user.id,
        postId: params.postId,
        title: body.title,
        markdown: body.markdown,
      });
    }
  );

  app.delete(
    "/api/forum/posts/:postId",
    {
      preHandler: [requireAuthSessionMiddleware, debounceForumWrite],
    },
    async (request) => {
      const authSession = await requireAuthSession(request);
      const params = postParamsSchema.parse(request.params);

      return softDeleteForumPost({
        userId: authSession.user.id,
        postId: params.postId,
      });
    }
  );

  app.post(
    "/api/forum/posts/:postId/comments",
    {
      preHandler: [requireAuthSessionMiddleware, debounceForumWrite],
    },
    async (request) => {
      const authSession = await requireAuthSession(request);
      const params = postParamsSchema.parse(request.params);
      const body = createCommentBodySchema.parse(request.body);

      return createForumComment({
        userId: authSession.user.id,
        postId: params.postId,
        markdown: body.markdown,
        parentId: body.parentId,
      });
    }
  );

  app.patch(
    "/api/forum/comments/:commentId",
    {
      preHandler: [requireAuthSessionMiddleware, debounceForumWrite],
    },
    async (request) => {
      const authSession = await requireAuthSession(request);
      const params = commentParamsSchema.parse(request.params);
      const body = markdownBodySchema.parse(request.body);

      return updateForumComment({
        userId: authSession.user.id,
        commentId: params.commentId,
        markdown: body.markdown,
      });
    }
  );

  app.delete(
    "/api/forum/comments/:commentId",
    {
      preHandler: [requireAuthSessionMiddleware, debounceForumWrite],
    },
    async (request) => {
      const authSession = await requireAuthSession(request);
      const params = commentParamsSchema.parse(request.params);

      return softDeleteForumComment({
        userId: authSession.user.id,
        commentId: params.commentId,
      });
    }
  );

  app.get(
    "/api/forum/posts/:postId/drafts/me",
    {
      preHandler: requireAuthSessionMiddleware,
    },
    async (request) => {
      const authSession = await requireAuthSession(request);
      const params = postParamsSchema.parse(request.params);
      const query = draftQuerySchema.parse(request.query);

      return getReplyDraft({
        userId: authSession.user.id,
        postId: params.postId,
        parentCommentId: query.parentCommentId,
      });
    }
  );

  app.put(
    "/api/forum/posts/:postId/drafts/me",
    {
      preHandler: [requireAuthSessionMiddleware, debounceForumWrite],
    },
    async (request) => {
      const authSession = await requireAuthSession(request);
      const params = postParamsSchema.parse(request.params);
      const query = draftQuerySchema.parse(request.query);
      const body = markdownBodySchema.parse(request.body);

      return upsertReplyDraft({
        userId: authSession.user.id,
        postId: params.postId,
        parentCommentId: query.parentCommentId,
        markdown: body.markdown,
      });
    }
  );

  app.delete(
    "/api/forum/posts/:postId/drafts/me",
    {
      preHandler: [requireAuthSessionMiddleware, debounceForumWrite],
    },
    async (request) => {
      const authSession = await requireAuthSession(request);
      const params = postParamsSchema.parse(request.params);
      const query = draftQuerySchema.parse(request.query);

      return deleteReplyDraft({
        userId: authSession.user.id,
        postId: params.postId,
        parentCommentId: query.parentCommentId,
      });
    }
  );

  app.post(
    "/api/forum/reactions/toggle",
    {
      preHandler: [requireAuthSessionMiddleware, debounceForumWrite],
    },
    async (request) => {
      const authSession = await requireAuthSession(request);
      const body = reactionToggleBodySchema.parse(request.body);

      return toggleForumReaction({
        userId: authSession.user.id,
        targetType: body.targetType,
        targetId: body.targetId,
        reactionType: body.reactionType,
      });
    }
  );

  app.post(
    "/api/forum/shares",
    {
      preHandler: [requireAuthSessionMiddleware, debounceForumWrite],
    },
    async (request) => {
      const authSession = await requireAuthSession(request);
      const body = shareBodySchema.parse(request.body);

      return createForumShare({
        userId: authSession.user.id,
        postId: body.postId,
        shareComment: body.shareComment,
      });
    }
  );

  app.post(
    "/api/forum/bookmarks/toggle",
    {
      preHandler: [requireAuthSessionMiddleware, debounceForumWrite],
    },
    async (request) => {
      const authSession = await requireAuthSession(request);
      const body = bookmarkToggleBodySchema.parse(request.body);

      return toggleForumBookmark({
        userId: authSession.user.id,
        postId: body.postId,
        pinned: body.pinned,
      });
    }
  );

  app.post(
    "/api/forum/follows/toggle",
    {
      preHandler: [requireAuthSessionMiddleware, debounceForumWrite],
    },
    async (request) => {
      const authSession = await requireAuthSession(request);
      const body = followToggleBodySchema.parse(request.body);

      return toggleForumFollow({
        followerUserId: authSession.user.id,
        followeeUserId: body.followeeUserId,
      });
    }
  );

  app.post(
    "/api/forum/posts/:postId/pin",
    {
      preHandler: [requireAuthSessionMiddleware, debounceForumWrite],
    },
    async (request) => {
      const authSession = await requireAuthSession(request);
      const params = postParamsSchema.parse(request.params);
      const body = pinBodySchema.parse(request.body);

      return setForumPostPinned({
        userId: authSession.user.id,
        postId: params.postId,
        pinned: body.pinned,
      });
    }
  );

  app.get("/api/forum/feed", async (request) => {
    const query = feedQuerySchema.parse(request.query);
    let userId: string | undefined;

    if (query.followingOnly) {
      const authSession = await requireAuthSession(request);
      userId = authSession.user.id;
    }

    return getForumFeed({
      limit: query.limit,
      cursor: query.cursor,
      followingOnly: query.followingOnly,
      userId,
    });
  });

  app.get("/api/forum/search", async (request) => {
    const query = searchQuerySchema.parse(request.query);
    return searchForumContent({
      query: query.query,
      limit: query.limit,
    });
  });

  app.get("/api/forum/trending-tags", async (request) => {
    const query = limitQuerySchema.parse(request.query);
    return listTrendingTags(query.limit);
  });

  app.get("/api/forum/top-active", async (request) => {
    const query = limitQuerySchema.parse(request.query);
    return listTopActiveUsers(query.limit);
  });

  app.get("/api/forum/top-topics", async (request) => {
    const query = limitQuerySchema.parse(request.query);
    return listTopTopics(query.limit);
  });

  app.get("/api/forum/top-discussion", async (request) => {
    const query = limitQuerySchema.parse(request.query);
    return listTopDiscussions(query.limit);
  });

  app.post(
    "/api/forum/reports",
    {
      preHandler: [requireAuthSessionMiddleware, debounceForumWrite],
    },
    async (request) => {
      const authSession = await requireAuthSession(request);
      const body = reportBodySchema.parse(request.body);

      return createForumReport({
        reporterUserId: authSession.user.id,
        targetType: body.targetType,
        targetId: body.targetId,
        reason: body.reason,
      });
    }
  );

  app.post(
    "/api/forum/mod/posts/:postId/lock",
    {
      preHandler: [requireAuthSessionMiddleware, debounceForumWrite],
    },
    async (request) => {
      const authSession = await requireAuthSession(request);
      const params = postParamsSchema.parse(request.params);
      const body = lockBodySchema.parse(request.body);

      return lockForumPostAsModerator({
        moderatorUserId: authSession.user.id,
        postId: params.postId,
        locked: body.locked,
      });
    }
  );

  app.get(
    "/api/notifications",
    {
      preHandler: requireAuthSessionMiddleware,
    },
    async (request) => {
      const authSession = await requireAuthSession(request);
      const query = notificationListQuerySchema.parse(request.query);

      return listForumNotifications({
        userId: authSession.user.id,
        limit: query.limit,
        unreadOnly: query.unreadOnly,
      });
    }
  );

  app.patch(
    "/api/notifications/:notificationId/read",
    {
      preHandler: [requireAuthSessionMiddleware, debounceForumWrite],
    },
    async (request) => {
      const authSession = await requireAuthSession(request);
      const params = notificationParamsSchema.parse(request.params);

      return markForumNotificationRead({
        userId: authSession.user.id,
        notificationId: params.notificationId,
      });
    }
  );

  app.get("/api/profile/:userId", async (request) => {
    const params = profileParamsSchema.parse(request.params);
    return getForumProfile(params.userId);
  });

  app.get(
    "/api/profile/:userId/analytics",
    {
      preHandler: requireAuthSessionMiddleware,
    },
    async (request) => {
      const params = profileParamsSchema.parse(request.params);
      return getForumProfile(params.userId);
    }
  );

  app.patch(
    "/api/profile/me",
    {
      preHandler: [requireAuthSessionMiddleware, debounceForumWrite],
    },
    async (request) => {
      const authSession = await requireAuthSession(request);
      const body = profileUpdateBodySchema.parse(request.body);

      return updateForumProfile({
        userId: authSession.user.id,
        location: body.location,
        organization: body.organization,
        websiteUrl: body.websiteUrl,
        brandingEmail: body.brandingEmail,
        displayWalletAddress: body.displayWalletAddress,
        displayEnsName: body.displayEnsName,
      });
    }
  );
};
