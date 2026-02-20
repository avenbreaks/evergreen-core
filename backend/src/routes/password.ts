import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireSecureTransportMiddleware } from "../middleware/require-secure-transport";

type PasswordRouteDependencies = {
  forwardAuthRequest: (input: {
    request: FastifyRequest;
    reply: FastifyReply;
    targetPath: string;
    method: "POST";
    body: unknown;
  }) => Promise<void>;
};

type PasswordRoutesOptions = {
  deps?: Partial<PasswordRouteDependencies>;
};

const forgotPasswordBodySchema = z.object({
  email: z.string().trim().email(),
  redirectTo: z.string().trim().url().max(2048).optional(),
});

const resetPasswordBodySchema = z.object({
  token: z.string().trim().min(8).max(256),
  newPassword: z.string().min(8).max(256),
});

const hasCompleteDependencies = (deps: Partial<PasswordRouteDependencies> | undefined): deps is PasswordRouteDependencies => {
  if (!deps) {
    return false;
  }

  return typeof deps.forwardAuthRequest === "function";
};

const loadDefaultDependencies = async (): Promise<PasswordRouteDependencies> => {
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

const safeForwardPasswordRequest = async (input: {
  deps: PasswordRouteDependencies;
  request: FastifyRequest;
  reply: FastifyReply;
  targetPath: string;
  body: unknown;
}): Promise<void> => {
  try {
    await input.deps.forwardAuthRequest({
      request: input.request,
      reply: input.reply,
      targetPath: input.targetPath,
      method: "POST",
      body: input.body,
    });
  } catch (error) {
    input.request.log.error({ err: error }, "Password route forwarding failed");
    if (!input.reply.sent) {
      input.reply.status(500).send({ code: "AUTH_BRIDGE_ERROR", message: "Auth handler failed" });
    }
  }
};

export const passwordRoutes: FastifyPluginAsync<PasswordRoutesOptions> = async (app, options) => {
  const deps = hasCompleteDependencies(options.deps)
    ? options.deps
    : {
        ...(await loadDefaultDependencies()),
        ...(options.deps ?? {}),
      };

  const handleForgotPassword = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const body = forgotPasswordBodySchema.parse(request.body ?? {});
    await safeForwardPasswordRequest({
      deps,
      request,
      reply,
      targetPath: "/api/auth/request-password-reset",
      body,
    });
  };

  const handleResetPassword = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const body = resetPasswordBodySchema.parse(request.body ?? {});
    await safeForwardPasswordRequest({
      deps,
      request,
      reply,
      targetPath: "/api/auth/reset-password",
      body: {
        token: body.token,
        newPassword: body.newPassword,
      },
    });
  };

  app.post(
    "/api/password/forgot-password",
    {
      preHandler: [requireSecureTransportMiddleware],
    },
    handleForgotPassword
  );

  app.post(
    "/api/password/reset-password",
    {
      preHandler: [requireSecureTransportMiddleware],
    },
    handleResetPassword
  );
};
