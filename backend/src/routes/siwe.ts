import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import {
  authDb,
  createSiweChallenge,
  linkSiweIdentity,
  oorthNexusNetwork,
  verifySiweChallenge,
} from "@evergreen-devparty/auth";

import { getAuthSession } from "../lib/auth-session";

const challengeBodySchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.number().int().positive().optional(),
  statement: z.string().min(1).max(280).optional(),
});

const verifyBodySchema = z.object({
  message: z.string().min(1),
  signature: z.string().min(1),
  setAsPrimary: z.boolean().optional(),
});

export const siweRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/siwe/challenge", async (request) => {
    const body = challengeBodySchema.parse(request.body);
    const challenge = await createSiweChallenge({
      db: authDb,
      walletAddress: body.walletAddress,
      chainId: body.chainId ?? oorthNexusNetwork.chainId,
      statement: body.statement,
    });

    return {
      nonce: challenge.nonce,
      message: challenge.message,
      expiresAt: challenge.expiresAt,
    };
  });

  app.post("/api/siwe/verify", async (request) => {
    const body = verifyBodySchema.parse(request.body);
    const verification = await verifySiweChallenge({
      db: authDb,
      message: body.message,
      signature: body.signature,
    });

    const authSession = await getAuthSession(request);
    const userId = authSession?.user.id;
    if (authSession) {
      await linkSiweIdentity({
        db: authDb,
        userId: authSession.user.id,
        address: verification.address,
        chainId: verification.chainId,
        setAsPrimary: body.setAsPrimary,
      });
    }

    return {
      ...verification,
      linkedToUser: Boolean(userId),
      userId,
    };
  });
};
