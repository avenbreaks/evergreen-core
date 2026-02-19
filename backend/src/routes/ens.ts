import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { authDb, createPendingEnsIdentity, oorthNexusNetwork } from "@evergreen-devparty/auth";

import { requireUserId } from "../lib/request-context";

const claimBodySchema = z.object({
  label: z.string().min(3).max(63),
  rootDomain: z.string().min(2).max(63).optional(),
  chainId: z.number().int().positive().optional(),
});

export const ensRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/ens/claim", async (request, reply) => {
    const userId = requireUserId(request);
    const body = claimBodySchema.parse(request.body);

    const result = await createPendingEnsIdentity({
      db: authDb,
      userId,
      chainId: body.chainId ?? oorthNexusNetwork.chainId,
      label: body.label,
      rootDomain: body.rootDomain,
    });

    return reply.status(202).send({
      status: "pending",
      userId,
      ...result,
    });
  });
};
