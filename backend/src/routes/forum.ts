import type { FastifyPluginAsync } from "fastify";

import { createDebounceMiddleware, hashDebouncePayload } from "../middleware/debounce-limit";
import { recordForumEndpointMetric } from "../services/forum-metrics";
import { registerForumContentRoutes } from "./forum/content-routes";
import { defaultForumRouteDeps, type ForumRouteDependencies, type ForumRoutesOptions } from "./forum/deps";
import { registerForumDiscoveryRoutes } from "./forum/discovery-routes";
import { registerForumModerationRoutes } from "./forum/moderation-routes";
import { registerForumNotificationRoutes } from "./forum/notification-routes";
import { registerForumProfileRoutes } from "./forum/profile-routes";
import { registerForumSocialRoutes } from "./forum/social-routes";

export type { ForumRouteDependencies, ForumRoutesOptions } from "./forum/deps";

export const forumRoutes: FastifyPluginAsync<ForumRoutesOptions> = async (app, options) => {
  const deps: ForumRouteDependencies = {
    ...defaultForumRouteDeps,
    ...(options.deps ?? {}),
  };

  const debounceForumWrite = createDebounceMiddleware({
    namespace: "forum.write",
    key: async (request) => {
      const authSession = await deps.requireAuthSession(request);
      return `${authSession.user.id}:${request.routeOptions.url}:${hashDebouncePayload(request.body)}`;
    },
  });

  const forumWritePreHandler = options.disableDebounce
    ? deps.requireAuthSessionMiddleware
    : [deps.requireAuthSessionMiddleware, debounceForumWrite];

  const context = {
    deps,
    forumWritePreHandler,
  };

  app.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions.url;
    if (!route) {
      return;
    }

    recordForumEndpointMetric({
      method: request.method,
      route,
      statusCode: reply.statusCode,
      latencyMs: reply.elapsedTime,
    });
  });

  registerForumContentRoutes(app, context);
  registerForumSocialRoutes(app, context);
  registerForumDiscoveryRoutes(app, context);
  registerForumModerationRoutes(app, context);
  registerForumNotificationRoutes(app, context);
  registerForumProfileRoutes(app, context);
};
