import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { forwardAuthRequest } from "../lib/auth-forward";

const forwardRequest = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  try {
    await forwardAuthRequest({
      request,
      reply,
    });
  } catch (error) {
    request.log.error({ err: error }, "Better Auth bridge failed");
    if (!reply.sent) {
      reply.status(500).send({ code: "AUTH_BRIDGE_ERROR", message: "Auth handler failed" });
    }
  }
};

export const authBridgeRoutes: FastifyPluginAsync = async (app) => {
  app.all("/api/auth", forwardRequest);
  app.all("/api/auth/*", forwardRequest);
};
