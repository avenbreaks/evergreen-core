import type { FastifyInstance } from "fastify";

import type { ForumRouteContext } from "./deps";
import { profileParamsSchema, profileUpdateBodySchema } from "./schemas";

export const registerForumProfileRoutes = (app: FastifyInstance, context: ForumRouteContext): void => {
  const { deps, forumWritePreHandler } = context;

  app.get("/api/profile/:userId", async (request) => {
    const params = profileParamsSchema.parse(request.params);
    return deps.getForumProfile(params.userId);
  });

  app.get(
    "/api/profile/:userId/analytics",
    {
      preHandler: deps.requireAuthSessionMiddleware,
    },
    async (request) => {
      const params = profileParamsSchema.parse(request.params);
      return deps.getForumProfile(params.userId);
    }
  );

  app.patch(
    "/api/profile/me",
    {
      preHandler: forumWritePreHandler,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);
      const body = profileUpdateBodySchema.parse(request.body);

      return deps.updateForumProfile({
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
