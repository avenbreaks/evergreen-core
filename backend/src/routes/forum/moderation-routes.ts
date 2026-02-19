import type { FastifyInstance } from "fastify";

import type { ForumRouteContext } from "./deps";
import { lockBodySchema, postParamsSchema, reportBodySchema } from "./schemas";

export const registerForumModerationRoutes = (app: FastifyInstance, context: ForumRouteContext): void => {
  const { deps, forumWritePreHandler } = context;

  app.post(
    "/api/forum/reports",
    {
      preHandler: forumWritePreHandler,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);
      const body = reportBodySchema.parse(request.body);

      return deps.createForumReport({
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
      preHandler: forumWritePreHandler,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);
      const params = postParamsSchema.parse(request.params);
      const body = lockBodySchema.parse(request.body);

      return deps.lockForumPostAsModerator({
        moderatorUserId: authSession.user.id,
        postId: params.postId,
        locked: body.locked,
      });
    }
  );
};
