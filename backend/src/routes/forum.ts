import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuthSession } from "../lib/auth-session";
import { requireAuthSessionMiddleware } from "../middleware/auth-session";
import { createDebounceMiddleware, hashDebouncePayload } from "../middleware/debounce-limit";
import {
  createForumComment,
  createForumPost,
  deleteReplyDraft,
  getForumPostDetail,
  getReplyDraft,
  listForumPosts,
  previewForumMarkdown,
  softDeleteForumComment,
  softDeleteForumPost,
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
};
