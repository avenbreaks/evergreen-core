import type { FastifyInstance } from "fastify";

import type { ForumRouteContext } from "./deps";
import {
  lockBodySchema,
  moderationReportListQuerySchema,
  moderationReportParamsSchema,
  moderationResolveBodySchema,
  postParamsSchema,
  reportBodySchema,
} from "./schemas";

export const registerForumModerationRoutes = (app: FastifyInstance, context: ForumRouteContext): void => {
  const { deps, forumWritePreHandler } = context;

  app.get(
    "/api/forum/mod/reports",
    {
      preHandler: deps.requireAuthSessionMiddleware,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);
      const query = moderationReportListQuerySchema.parse(request.query);

      return deps.listForumReportsForModeration({
        moderatorUserId: authSession.user.id,
        status: query.status,
        limit: query.limit,
        cursor: query.cursor,
      });
    }
  );

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

  app.patch(
    "/api/forum/mod/reports/:reportId",
    {
      preHandler: forumWritePreHandler,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);
      const params = moderationReportParamsSchema.parse(request.params);
      const body = moderationResolveBodySchema.parse(request.body);

      return deps.resolveForumReportAsModerator({
        moderatorUserId: authSession.user.id,
        reportId: params.reportId,
        status: body.status,
      });
    }
  );
};
