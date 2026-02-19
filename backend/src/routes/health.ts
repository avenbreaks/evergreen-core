import { sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

import { authDb } from "@evergreen-devparty/auth";

import { getChainBlockNumber } from "../services/ens-marketplace";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/healthz", async () => ({ status: "ok" }));

  app.get("/readyz", async (_request, reply) => {
    try {
      const [_, blockNumber] = await Promise.all([authDb.execute(sql`select 1`), getChainBlockNumber()]);
      return {
        status: "ready",
        chainBlockNumber: blockNumber.toString(),
      };
    } catch {
      return reply.status(503).send({ status: "not_ready" });
    }
  });
};
