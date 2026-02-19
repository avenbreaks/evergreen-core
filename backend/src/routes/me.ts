import { and, desc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { authDb, linkSiweIdentity, verifySiweChallenge } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { requireAuthSession } from "../lib/auth-session";
import { createDebounceMiddleware, hashDebouncePayload } from "../middleware/debounce-limit";
import { requireAuthSessionMiddleware } from "../middleware/auth-session";

const linkWalletBodySchema = z.object({
  message: z.string().min(1),
  signature: z.string().min(1),
  setAsPrimary: z.boolean().optional(),
});

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

    const [profile, wallets, domains] = await Promise.all([
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

    return {
      user: authSession.user,
      session: authSession.session,
      profile: profile[0] ?? null,
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

      const verification = await verifySiweChallenge({
        db: authDb,
        message: body.message,
        signature: body.signature,
      });

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
