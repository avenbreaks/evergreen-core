import type { FastifyRequest, preHandlerHookHandler } from "fastify";

import { requireAuthSession as requireAuthSessionDefault } from "../../lib/auth-session";
import { requireAuthSessionMiddleware as requireAuthSessionMiddlewareDefault } from "../../middleware/auth-session";
import * as forumCore from "../../services/forum-core";

type AuthSession = Awaited<ReturnType<typeof requireAuthSessionDefault>>;

export type ForumRouteDependencies = typeof forumCore & {
  requireAuthSession: (request: FastifyRequest) => Promise<AuthSession>;
  requireAuthSessionMiddleware: preHandlerHookHandler;
};

export type ForumRoutesOptions = {
  disableDebounce?: boolean;
  deps?: Partial<ForumRouteDependencies>;
};

export type ForumRouteContext = {
  deps: ForumRouteDependencies;
  forumWritePreHandler: preHandlerHookHandler | preHandlerHookHandler[];
};

export const defaultForumRouteDeps: ForumRouteDependencies = {
  ...forumCore,
  requireAuthSession: requireAuthSessionDefault,
  requireAuthSessionMiddleware: requireAuthSessionMiddlewareDefault,
};
