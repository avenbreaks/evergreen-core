import type { preHandlerHookHandler } from "fastify";

import { requireAuthSession } from "../lib/auth-session";

export const requireAuthSessionMiddleware: preHandlerHookHandler = async (request) => {
  await requireAuthSession(request);
};
