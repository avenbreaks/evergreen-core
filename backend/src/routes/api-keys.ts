import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { requireAuthSession } from "../lib/auth-session";
import { requireApiKeyAuth, requireApiKeyPrincipal } from "../middleware/api-key-auth";
import { requireAuthSessionMiddleware } from "../middleware/auth-session";
import { requireSecureTransportMiddleware } from "../middleware/require-secure-transport";
import { requireTrustedOriginMiddleware } from "../middleware/trusted-origin";
import {
  createApiKeyForUser,
  listApiKeysForUser,
  revokeApiKeyForUser,
  rotateApiKeyForUser,
} from "../services/api-keys/core";

const createApiKeyBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(z.string().trim().min(1).max(80)).min(1).max(32),
  environment: z.enum(["live", "test"]).optional(),
  expiresInDays: z.number().int().positive().optional(),
  rateLimitPerMinute: z.number().int().positive().optional(),
  rateLimitPerIpMinute: z.number().int().positive().optional(),
  concurrencyLimit: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const rotateApiKeyBodySchema = z.object({
  currentPassword: z.string().min(8).max(256).optional(),
  gracePeriodMinutes: z.number().int().min(0).max(30).optional(),
});

const revokeApiKeyBodySchema = z.object({
  currentPassword: z.string().min(8).max(256).optional(),
  reason: z.string().trim().max(255).optional(),
});

export const apiKeyRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/api/me/api-keys",
    {
      preHandler: [requireSecureTransportMiddleware, requireAuthSessionMiddleware],
    },
    async (request) => {
      const authSession = await requireAuthSession(request);
      const keys = await listApiKeysForUser(authSession.user.id);

      return {
        keys,
      };
    }
  );

  app.post(
    "/api/me/api-keys",
    {
      preHandler: [requireSecureTransportMiddleware, requireAuthSessionMiddleware, requireTrustedOriginMiddleware],
    },
    async (request) => {
      const body = createApiKeyBodySchema.parse(request.body);
      const authSession = await requireAuthSession(request);

      const created = await createApiKeyForUser({
        userId: authSession.user.id,
        name: body.name,
        scopes: body.scopes,
        environment: body.environment,
        expiresInDays: body.expiresInDays,
        rateLimitPerMinute: body.rateLimitPerMinute,
        rateLimitPerIpMinute: body.rateLimitPerIpMinute,
        concurrencyLimit: body.concurrencyLimit,
        metadata: body.metadata,
        createdByUserId: authSession.user.id,
        createdFromIp: request.ip,
        createdFromUa: request.headers["user-agent"],
      });

      return {
        created,
        warning: "Store this key now. It will not be shown again.",
      };
    }
  );

  app.post(
    "/api/me/api-keys/:keyId/rotate",
    {
      preHandler: [requireSecureTransportMiddleware, requireAuthSessionMiddleware, requireTrustedOriginMiddleware],
    },
    async (request) => {
      const { keyId } = z.object({ keyId: z.string().min(8).max(200) }).parse(request.params);
      const body = rotateApiKeyBodySchema.parse(request.body);
      const authSession = await requireAuthSession(request);

      const rotated = await rotateApiKeyForUser({
        userId: authSession.user.id,
        keyId,
        sessionUpdatedAt: authSession.session.updatedAt,
        currentPassword: body.currentPassword,
        gracePeriodMinutes: body.gracePeriodMinutes,
        requestIp: request.ip,
        requestUserAgent: request.headers["user-agent"],
      });

      return {
        rotated,
        warning: "Store this new key now. It will not be shown again.",
      };
    }
  );

  app.post(
    "/api/me/api-keys/:keyId/revoke",
    {
      preHandler: [requireSecureTransportMiddleware, requireAuthSessionMiddleware, requireTrustedOriginMiddleware],
    },
    async (request) => {
      const { keyId } = z.object({ keyId: z.string().min(8).max(200) }).parse(request.params);
      const body = revokeApiKeyBodySchema.parse(request.body);
      const authSession = await requireAuthSession(request);

      const revoked = await revokeApiKeyForUser({
        userId: authSession.user.id,
        keyId,
        sessionUpdatedAt: authSession.session.updatedAt,
        currentPassword: body.currentPassword,
        reason: body.reason,
        requestIp: request.ip,
        requestUserAgent: request.headers["user-agent"],
      });

      return {
        revoked,
      };
    }
  );

  app.get(
    "/api/integrations/me",
    {
      preHandler: [requireSecureTransportMiddleware, requireApiKeyAuth({ requiredScopes: ["profile:read"] })],
    },
    async (request) => {
      const principal = requireApiKeyPrincipal(request);
      const [user] = await authDb
        .select({
          id: schema.users.id,
          email: schema.users.email,
          name: schema.users.name,
          emailVerified: schema.users.emailVerified,
          role: schema.users.role,
          status: schema.users.status,
        })
        .from(schema.users)
        .where(eq(schema.users.id, principal.userId))
        .limit(1);

      return {
        authenticated: true,
        key: principal,
        user: user ?? null,
      };
    }
  );

  app.post(
    "/api/integrations/me/heartbeat",
    {
      preHandler: [
        requireSecureTransportMiddleware,
        requireApiKeyAuth({
          requiredScopes: ["profile:write"],
          requireSignature: true,
        }),
      ],
    },
    async (request) => {
      const principal = requireApiKeyPrincipal(request);
      const now = new Date();

      await authDb
        .update(schema.users)
        .set({
          lastSeenAt: now,
          updatedAt: now,
        })
        .where(eq(schema.users.id, principal.userId));

      return {
        acknowledged: true,
        userId: principal.userId,
        keyId: principal.keyId,
        at: now.toISOString(),
      };
    }
  );
};
