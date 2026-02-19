import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { authNodeHandler } from "@evergreen-devparty/auth";

const forwardRequest = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  reply.hijack();

  try {
    await authNodeHandler(request.raw, reply.raw);
  } catch (error) {
    request.log.error({ err: error }, "Better Auth bridge failed");
    if (!reply.raw.headersSent) {
      reply.raw.statusCode = 500;
      reply.raw.setHeader("content-type", "application/json");
      reply.raw.end(JSON.stringify({ code: "AUTH_BRIDGE_ERROR", message: "Auth handler failed" }));
    }
  }
};

export const authBridgeRoutes: FastifyPluginAsync = async (app) => {
  app.all("/api/auth", forwardRequest);
  app.all("/api/auth/*", forwardRequest);
};
