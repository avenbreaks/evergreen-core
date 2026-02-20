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
import { HttpError } from "../lib/http-error";
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

const mapSiweErrorToHttpError = (error: unknown): HttpError | null => {
  if (!(error instanceof Error)) {
    return null;
  }

  const message = error.message.toLowerCase();

  if (message.includes("nonce is invalid") || message.includes("nonce") && message.includes("expired")) {
    return new HttpError(400, "SIWE_NONCE_INVALID_OR_EXPIRED", "SIWE nonce is invalid or expired");
  }

  if (message.includes("signature") || message.includes("byteslike")) {
    return new HttpError(400, "SIWE_SIGNATURE_INVALID", "SIWE signature is invalid");
  }

  if (
    message.includes("domain mismatch") ||
    message.includes("uri mismatch") ||
    message.includes("chain is not in allowlist") ||
    message.includes("address mismatch")
  ) {
    return new HttpError(400, "SIWE_MESSAGE_MISMATCH", "SIWE message does not match expected challenge context");
  }

  if (message.includes("siwe message is invalid") || message.includes("invalid eip-55 address") || message.includes("invalid address")) {
    return new HttpError(400, "SIWE_MESSAGE_INVALID", "SIWE message payload is invalid");
  }

  return null;
};

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
      let challenge: Awaited<ReturnType<typeof createSiweChallenge>>;
      try {
        challenge = await createSiweChallenge({
          db: authDb,
          walletAddress: body.walletAddress,
          chainId: body.chainId ?? oorthNexusNetwork.chainId,
          statement: body.statement,
        });
      } catch (error) {
        const mapped = mapSiweErrorToHttpError(error);
        if (mapped) {
          throw mapped;
        }

        throw error;
      }

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
      let verification: Awaited<ReturnType<typeof verifySiweChallenge>>;
      try {
        verification = await verifySiweChallenge({
          db: authDb,
          message: body.message,
          signature: body.signature,
        });
      } catch (error) {
        const mapped = mapSiweErrorToHttpError(error);
        if (mapped) {
          throw mapped;
        }

        throw error;
      }

      const authSession = await getAuthSession(request);
      const userId = authSession?.user.id;
      const responseUserId = userId ?? "anonymous";
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
        userId: responseUserId,
      };
    }
  );
};
