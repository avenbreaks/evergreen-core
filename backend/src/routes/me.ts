import { and, desc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { authDb, linkSiweIdentity, verifySiweChallenge } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { requireAuthSession } from "../lib/auth-session";
import { HttpError } from "../lib/http-error";
import { createDebounceMiddleware, hashDebouncePayload } from "../middleware/debounce-limit";
import { requireAuthSessionMiddleware } from "../middleware/auth-session";

const linkWalletBodySchema = z.object({
  message: z.string().min(1),
  signature: z.string().min(1),
  setAsPrimary: z.boolean().optional(),
});

const mapSiweErrorToHttpError = (error: unknown): HttpError | null => {
  if (!(error instanceof Error)) {
    return null;
  }

  const message = error.message.toLowerCase();
  if (message.includes("signature") || message.includes("nonce") || message.includes("siwe")) {
    return new HttpError(400, "SIWE_VERIFICATION_FAILED", "SIWE verification failed");
  }

  return null;
};

export const meRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuthSessionMiddleware);

  const debounceWalletLink = createDebounceMiddleware({
    namespace: "me.wallet.link",
    key: async (request) => {
      const authSession = await requireAuthSession(request);
      return `${authSession.user.id}:${hashDebouncePayload(request.body)}`;
    },
  });

  app.get("/api/me", async (request) => {
    const authSession = await requireAuthSession(request);

    const [profileRows, wallets, domains] = await Promise.all([
      authDb
        .select()
        .from(schema.profiles)
        .where(eq(schema.profiles.userId, authSession.user.id))
        .limit(1),
      authDb
        .select()
        .from(schema.wallets)
        .where(eq(schema.wallets.userId, authSession.user.id))
        .orderBy(desc(schema.wallets.isPrimary), desc(schema.wallets.updatedAt)),
      authDb
        .select()
        .from(schema.ensIdentities)
        .where(and(eq(schema.ensIdentities.userId, authSession.user.id), eq(schema.ensIdentities.status, "active")))
        .orderBy(desc(schema.ensIdentities.isPrimary), desc(schema.ensIdentities.updatedAt)),
    ]);

    let profile = profileRows[0] ?? null;
    if (!profile) {
      await authDb
        .insert(schema.profiles)
        .values({
          userId: authSession.user.id,
        })
        .onConflictDoNothing({ target: schema.profiles.userId });

      const [createdProfile] = await authDb
        .select()
        .from(schema.profiles)
        .where(eq(schema.profiles.userId, authSession.user.id))
        .limit(1);

      profile = createdProfile ?? null;
    }

    return {
      user: authSession.user,
      session: authSession.session,
      profile,
      wallets,
      domains,
    };
  });

  app.get("/api/me/wallets", async (request) => {
    const authSession = await requireAuthSession(request);

    const wallets = await authDb
      .select()
      .from(schema.wallets)
      .where(eq(schema.wallets.userId, authSession.user.id))
      .orderBy(desc(schema.wallets.isPrimary), desc(schema.wallets.updatedAt));

    return { wallets };
  });

  app.post(
    "/api/me/wallets/link",
    {
      preHandler: debounceWalletLink,
    },
    async (request) => {
      const authSession = await requireAuthSession(request);
      const body = linkWalletBodySchema.parse(request.body);

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

      await linkSiweIdentity({
        db: authDb,
        userId: authSession.user.id,
        address: verification.address,
        chainId: verification.chainId,
        setAsPrimary: body.setAsPrimary,
      });

      return {
        linked: true,
        userId: authSession.user.id,
        walletAddress: verification.address,
        chainId: verification.chainId,
      };
    }
  );
};
