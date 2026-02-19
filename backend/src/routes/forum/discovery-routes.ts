import type { FastifyInstance } from "fastify";

import type { ForumRouteContext } from "./deps";
import { feedQuerySchema, limitQuerySchema, searchQuerySchema } from "./schemas";

export const registerForumDiscoveryRoutes = (app: FastifyInstance, context: ForumRouteContext): void => {
  const { deps } = context;

  app.get("/api/forum/feed", async (request) => {
    const query = feedQuerySchema.parse(request.query);
    let userId: string | undefined;

    if (query.followingOnly) {
      const authSession = await deps.requireAuthSession(request);
      userId = authSession.user.id;
    }

    return deps.getForumFeed({
      limit: query.limit,
      cursor: query.cursor,
      followingOnly: query.followingOnly,
      userId,
    });
  });

  app.get("/api/forum/search", async (request) => {
    const query = searchQuerySchema.parse(request.query);
    return deps.searchForumContent({
      query: query.query,
      limit: query.limit,
    });
  });

  app.get("/api/forum/trending-tags", async (request) => {
    const query = limitQuerySchema.parse(request.query);
    return deps.listTrendingTags(query.limit);
  });

  app.get("/api/forum/top-active", async (request) => {
    const query = limitQuerySchema.parse(request.query);
    return deps.listTopActiveUsers(query.limit);
  });

  app.get("/api/forum/top-topics", async (request) => {
    const query = limitQuerySchema.parse(request.query);
    return deps.listTopTopics(query.limit);
  });

  app.get("/api/forum/top-discussion", async (request) => {
    const query = limitQuerySchema.parse(request.query);
    return deps.listTopDiscussions(query.limit);
  });
};
