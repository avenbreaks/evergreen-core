import type { FastifyInstance } from "fastify";

import type { ForumRouteContext } from "./deps";
import {
  commentParamsSchema,
  createCommentBodySchema,
  createPostBodySchema,
  draftQuerySchema,
  listPostsQuerySchema,
  markdownBodySchema,
  postDetailQuerySchema,
  postParamsSchema,
  updatePostBodySchema,
} from "./schemas";

export const registerForumContentRoutes = (app: FastifyInstance, context: ForumRouteContext): void => {
  const { deps, forumWritePreHandler } = context;

  app.post(
    "/api/forum/content/preview",
    {
      preHandler: forumWritePreHandler,
    },
    async (request) => {
      const body = markdownBodySchema.parse(request.body);
      return deps.previewForumMarkdown({
        markdown: body.markdown,
      });
    }
  );

  app.post(
    "/api/forum/posts",
    {
      preHandler: forumWritePreHandler,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);
      const body = createPostBodySchema.parse(request.body);

      return deps.createForumPost({
        userId: authSession.user.id,
        title: body.title,
        markdown: body.markdown,
        tags: body.tags,
      });
    }
  );

  app.get("/api/forum/posts", async (request) => {
    const query = listPostsQuerySchema.parse(request.query);
    return deps.listForumPosts({
      limit: query.limit,
      cursor: query.cursor,
      authorId: query.authorId,
    });
  });

  app.get("/api/forum/posts/:postId", async (request) => {
    const params = postParamsSchema.parse(request.params);
    const query = postDetailQuerySchema.parse(request.query);

    return deps.getForumPostDetail({
      postId: params.postId,
      commentsLimit: query.commentsLimit,
      commentsCursor: query.commentsCursor,
    });
  });

  app.patch(
    "/api/forum/posts/:postId",
    {
      preHandler: forumWritePreHandler,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);
      const params = postParamsSchema.parse(request.params);
      const body = updatePostBodySchema.parse(request.body);

      return deps.updateForumPost({
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
      preHandler: forumWritePreHandler,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);
      const params = postParamsSchema.parse(request.params);

      return deps.softDeleteForumPost({
        userId: authSession.user.id,
        postId: params.postId,
      });
    }
  );

  app.post(
    "/api/forum/posts/:postId/comments",
    {
      preHandler: forumWritePreHandler,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);
      const params = postParamsSchema.parse(request.params);
      const body = createCommentBodySchema.parse(request.body);

      return deps.createForumComment({
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
      preHandler: forumWritePreHandler,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);
      const params = commentParamsSchema.parse(request.params);
      const body = markdownBodySchema.parse(request.body);

      return deps.updateForumComment({
        userId: authSession.user.id,
        commentId: params.commentId,
        markdown: body.markdown,
      });
    }
  );

  app.delete(
    "/api/forum/comments/:commentId",
    {
      preHandler: forumWritePreHandler,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);
      const params = commentParamsSchema.parse(request.params);

      return deps.softDeleteForumComment({
        userId: authSession.user.id,
        commentId: params.commentId,
      });
    }
  );

  app.get(
    "/api/forum/posts/:postId/drafts/me",
    {
      preHandler: deps.requireAuthSessionMiddleware,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);
      const params = postParamsSchema.parse(request.params);
      const query = draftQuerySchema.parse(request.query);

      return deps.getReplyDraft({
        userId: authSession.user.id,
        postId: params.postId,
        parentCommentId: query.parentCommentId,
      });
    }
  );

  app.put(
    "/api/forum/posts/:postId/drafts/me",
    {
      preHandler: forumWritePreHandler,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);
      const params = postParamsSchema.parse(request.params);
      const query = draftQuerySchema.parse(request.query);
      const body = markdownBodySchema.parse(request.body);

      return deps.upsertReplyDraft({
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
      preHandler: forumWritePreHandler,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);
      const params = postParamsSchema.parse(request.params);
      const query = draftQuerySchema.parse(request.query);

      return deps.deleteReplyDraft({
        userId: authSession.user.id,
        postId: params.postId,
        parentCommentId: query.parentCommentId,
      });
    }
  );
};
