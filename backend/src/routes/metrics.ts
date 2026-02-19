import type { FastifyPluginAsync } from "fastify";

import { requireSecureTransportMiddleware } from "../middleware/require-secure-transport";
import { renderForumPrometheusMetrics } from "../services/forum-metrics";
import { verifyInternalOpsSecretMiddleware } from "../middleware/webhook-auth";
import { renderPrometheusMetrics } from "../services/ops-metrics";

export const metricsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/metrics",
    {
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware],
    },
    async (_request, reply) => {
      reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8");
      return reply.send(`${renderPrometheusMetrics()}${renderForumPrometheusMetrics()}`);
    }
  );
};
