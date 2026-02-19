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
import { createDebounceMiddleware, hashDebouncePayload } from "../middleware/debounce-limit";

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
  const debounceChallenge = createDebounceMiddleware({
    namespace: "siwe.challenge",
    key: (request) => {
      const parsed = challengeBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return `${request.ip}:invalid`;
      }

      return `${request.ip}:${parsed.data.walletAddress.toLowerCase()}:${parsed.data.chainId ?? oorthNexusNetwork.chainId}`;
    },
  });

  const debounceVerify = createDebounceMiddleware({
    namespace: "siwe.verify",
    key: (request) => `${request.ip}:${hashDebouncePayload(request.body)}`,
  });

  app.post(
    "/api/siwe/challenge",
    {
      preHandler: debounceChallenge,
    },
    async (request) => {
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
    }
  );

  app.post(
    "/api/siwe/verify",
    {
      preHandler: debounceVerify,
    },
    async (request) => {
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
    }
  );
};
