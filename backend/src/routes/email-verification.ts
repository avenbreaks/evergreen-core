import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { backendEnv } from "../config/env";
import { requireSecureTransportMiddleware } from "../middleware/require-secure-transport";

type EmailVerificationRouteDependencies = {
  forwardAuthRequest: (input: {
    request: FastifyRequest;
    reply: FastifyReply;
    targetPath: string;
    method: "GET" | "POST";
    body?: unknown;
  }) => Promise<void>;
};

type EmailVerificationRoutesOptions = {
  deps?: Partial<EmailVerificationRouteDependencies>;
};

const sendVerificationBodySchema = z.object({
  email: z.string().trim().email(),
  callbackURL: z.string().trim().url().max(2048).optional(),
});

const verifyEmailQuerySchema = z.object({
  token: z.string().trim().min(8).max(4096),
  callbackURL: z.string().trim().url().max(2048).optional(),
});

const parseTrustedOrigins = (): string[] => {
  const configured = process.env.BETTER_AUTH_TRUSTED_ORIGINS;
  if (!configured) {
    return ["http://localhost:3000"];
  }

  return configured
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const trustedOrigins = parseTrustedOrigins().map((entry) => {
  try {
    return new URL(entry).origin.toLowerCase();
  } catch {
    return entry.toLowerCase();
  }
});

const sanitizeCallbackURL = (callbackURL: string | undefined): string | undefined => {
  if (!callbackURL) {
    return undefined;
  }

  try {
    const candidateOrigin = new URL(callbackURL).origin.toLowerCase();
    if (trustedOrigins.includes(candidateOrigin)) {
      return callbackURL;
    }
  } catch {
    return undefined;
  }

  return undefined;
};

const hasCompleteDependencies = (
  deps: Partial<EmailVerificationRouteDependencies> | undefined
): deps is EmailVerificationRouteDependencies => {
  if (!deps) {
    return false;
  }

  return typeof deps.forwardAuthRequest === "function";
};

const loadDefaultDependencies = async (): Promise<EmailVerificationRouteDependencies> => {
  const authForward = await import("../lib/auth-forward");

  return {
    forwardAuthRequest: async (input) => {
      await authForward.forwardAuthRequest({
        request: input.request,
        reply: input.reply,
        targetPath: input.targetPath,
        method: input.method,
        body: input.body,
      });
    },
  };
};

const safeForwardRequest = async (input: {
  deps: EmailVerificationRouteDependencies;
  request: FastifyRequest;
  reply: FastifyReply;
  targetPath: string;
  method: "GET" | "POST";
  body?: unknown;
}): Promise<void> => {
  try {
    await input.deps.forwardAuthRequest({
      request: input.request,
      reply: input.reply,
      targetPath: input.targetPath,
      method: input.method,
      body: input.body,
    });
  } catch (error) {
    input.request.log.error({ err: error }, "Email verification route forwarding failed");
    if (!input.reply.sent) {
      input.reply.status(500).send({ code: "AUTH_BRIDGE_ERROR", message: "Auth handler failed" });
    }
  }
};

const buildVerifyTargetPath = (input: { token: string; callbackURL?: string }): string => {
  const params = new URLSearchParams({ token: input.token });
  if (input.callbackURL) {
    params.set("callbackURL", input.callbackURL);
  }

  return `${backendEnv.authEndpoints.verifyEmail}?${params.toString()}`;
};

export const emailVerificationRoutes: FastifyPluginAsync<EmailVerificationRoutesOptions> = async (app, options) => {
  const deps = hasCompleteDependencies(options.deps)
    ? options.deps
    : {
        ...(await loadDefaultDependencies()),
        ...(options.deps ?? {}),
      };

  const handleSendVerificationEmail = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const body = sendVerificationBodySchema.parse(request.body ?? {});
    const safeCallbackURL = sanitizeCallbackURL(body.callbackURL);
    if (body.callbackURL && !safeCallbackURL) {
      request.log.warn({ callbackURL: body.callbackURL }, "Dropped untrusted verification callback URL");
    }

    await safeForwardRequest({
      deps,
      request,
      reply,
      targetPath: backendEnv.authEndpoints.sendVerificationEmail,
      method: "POST",
      body: {
        email: body.email,
        ...(safeCallbackURL ? { callbackURL: safeCallbackURL } : {}),
      },
    });
  };

  const handleVerifyEmail = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const query = verifyEmailQuerySchema.parse(request.query ?? {});
    const safeCallbackURL = sanitizeCallbackURL(query.callbackURL);
    if (query.callbackURL && !safeCallbackURL) {
      request.log.warn({ callbackURL: query.callbackURL }, "Dropped untrusted verification callback URL");
    }

    await safeForwardRequest({
      deps,
      request,
      reply,
      targetPath: buildVerifyTargetPath({
        token: query.token,
        ...(safeCallbackURL ? { callbackURL: safeCallbackURL } : {}),
      }),
      method: "GET",
    });
  };

  app.post(
    "/api/email-verification/send",
    {
      preHandler: [requireSecureTransportMiddleware],
    },
    handleSendVerificationEmail
  );

  app.get(
    "/api/email-verification/verify",
    {
      preHandler: [requireSecureTransportMiddleware],
    },
    handleVerifyEmail
  );

  app.get(
    "/verify-email",
    {
      preHandler: [requireSecureTransportMiddleware],
    },
    handleVerifyEmail
  );
};
