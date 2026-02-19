import type { FastifyInstance } from "fastify";

import type { ForumRouteContext } from "./deps";
import {
  bookmarkToggleBodySchema,
  followToggleBodySchema,
  pinBodySchema,
  postParamsSchema,
  reactionToggleBodySchema,
  shareBodySchema,
} from "./schemas";

export const registerForumSocialRoutes = (app: FastifyInstance, context: ForumRouteContext): void => {
  const { deps, forumWritePreHandler } = context;

  app.post(
    "/api/forum/reactions/toggle",
    {
      preHandler: forumWritePreHandler,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);
      const body = reactionToggleBodySchema.parse(request.body);

      return deps.toggleForumReaction({
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
      preHandler: forumWritePreHandler,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);
      const body = shareBodySchema.parse(request.body);

      return deps.createForumShare({
        userId: authSession.user.id,
        postId: body.postId,
        shareComment: body.shareComment,
      });
    }
  );

  app.post(
    "/api/forum/bookmarks/toggle",
    {
      preHandler: forumWritePreHandler,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);
      const body = bookmarkToggleBodySchema.parse(request.body);

      return deps.toggleForumBookmark({
        userId: authSession.user.id,
        postId: body.postId,
        pinned: body.pinned,
      });
    }
  );

  app.post(
    "/api/forum/follows/toggle",
    {
      preHandler: forumWritePreHandler,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);
      const body = followToggleBodySchema.parse(request.body);

      return deps.toggleForumFollow({
        followerUserId: authSession.user.id,
        followeeUserId: body.followeeUserId,
      });
    }
  );

  app.post(
    "/api/forum/posts/:postId/pin",
    {
      preHandler: forumWritePreHandler,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);
      const params = postParamsSchema.parse(request.params);
      const body = pinBodySchema.parse(request.body);

      return deps.setForumPostPinned({
        userId: authSession.user.id,
        postId: params.postId,
        pinned: body.pinned,
      });
    }
  );
};
