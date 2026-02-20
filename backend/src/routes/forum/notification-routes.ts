import type { FastifyInstance } from "fastify";

import type { ForumRouteContext } from "./deps";
import { notificationListQuerySchema, notificationParamsSchema } from "./schemas";

export const registerForumNotificationRoutes = (app: FastifyInstance, context: ForumRouteContext): void => {
  const { deps, forumWritePreHandler } = context;

  app.get(
    "/api/notifications",
    {
      preHandler: deps.requireAuthSessionMiddleware,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);
      const query = notificationListQuerySchema.parse(request.query);

      return deps.listForumNotifications({
        userId: authSession.user.id,
        limit: query.limit,
        unreadOnly: query.unreadOnly,
      });
    }
  );

  app.patch(
    "/api/notifications/read-all",
    {
      preHandler: forumWritePreHandler,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);

      return deps.markAllForumNotificationsRead({
        userId: authSession.user.id,
      });
    }
  );

  app.patch(
    "/api/notifications/:notificationId/read",
    {
      preHandler: forumWritePreHandler,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);
      const params = notificationParamsSchema.parse(request.params);

      return deps.markForumNotificationRead({
        userId: authSession.user.id,
        notificationId: params.notificationId,
      });
    }
  );
};
