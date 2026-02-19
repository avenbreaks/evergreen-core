import { sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

import { authDb } from "@evergreen-devparty/auth";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/healthz", async () => ({ status: "ok" }));

  app.get("/readyz", async (_request, reply) => {
    try {
      await authDb.execute(sql`select 1`);
      return { status: "ready" };
    } catch {
      return reply.status(503).send({ status: "not_ready" });
    }
  });
};
