import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { auth } from "@evergreen-devparty/auth";

import { backendEnv } from "../config/env";
import { buildAuthForwardRequest, forwardAuthRequest, sendAuthForwardResponse } from "../lib/auth-forward";

type LegacyAuthAction = "signin" | "signup";

type LegacyAuthCredentials = {
  email: string;
  password: string;
  name?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getRequestPath = (request: FastifyRequest): string => {
  const url = request.raw.url ?? request.url;
  const [pathname] = url.split("?");
  return pathname ?? request.url;
};

const asStringOrNull = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const deriveNameFromEmail = (email: string): string => {
  const localPart = email.split("@")[0]?.trim();
  if (!localPart) {
    return "User";
  }

  return localPart.slice(0, 120);
};

const parseLegacyAuthCredentials = (body: unknown): LegacyAuthCredentials | null => {
  if (!isRecord(body)) {
    return null;
  }

  const email = asStringOrNull(body.email);
  const password = asStringOrNull(body.password);
  if (!email || !password) {
    return null;
  }

  const name = asStringOrNull(body.name) ?? undefined;
  return {
    email,
    password,
    name,
  };
};

const resolveLegacyAuthAction = (request: FastifyRequest): LegacyAuthAction | null => {
  if (request.method !== "POST") {
    return null;
  }

  const requestPath = getRequestPath(request);
  if (requestPath === "/api/auth/signin") {
    return "signin";
  }

  if (requestPath === "/api/auth/signup") {
    return "signup";
  }

  if (requestPath !== "/api/auth") {
    return null;
  }

  if (!isRecord(request.body)) {
    return null;
  }

  const rawAction = asStringOrNull(request.body.action) ?? asStringOrNull(request.body.type);
  const normalized = rawAction?.toLowerCase();

  if (normalized === "signin" || normalized === "sign-in" || normalized === "login") {
    return "signin";
  }

  if (normalized === "signup" || normalized === "sign-up" || normalized === "register") {
    return "signup";
  }

  return "signin";
};

const forwardLegacyAuthAction = async (input: {
  request: FastifyRequest;
  reply: FastifyReply;
  action: LegacyAuthAction;
  credentials: LegacyAuthCredentials;
}): Promise<void> => {
  const { request, reply, action, credentials } = input;

  if (action === "signin") {
    await forwardAuthRequest({
      request,
      reply,
      targetPath: backendEnv.authEndpoints.signInEmail,
      method: "POST",
      body: {
        email: credentials.email,
        password: credentials.password,
      },
    });
    return;
  }

  const signUpRequest = buildAuthForwardRequest({
    request,
    targetPath: backendEnv.authEndpoints.signUpEmail,
    method: "POST",
    body: {
      name: credentials.name ?? deriveNameFromEmail(credentials.email),
      email: credentials.email,
      password: credentials.password,
    },
  });

  const signUpResponse = await auth.handler(signUpRequest);
  if (signUpResponse.status < 400 || signUpResponse.status >= 500) {
    await sendAuthForwardResponse(reply, signUpResponse);
    return;
  }

  const signInRequest = buildAuthForwardRequest({
    request,
    targetPath: backendEnv.authEndpoints.signInEmail,
    method: "POST",
    body: {
      email: credentials.email,
      password: credentials.password,
    },
  });

  const signInResponse = await auth.handler(signInRequest);
  await sendAuthForwardResponse(reply, signInResponse);
};

const forwardRequest = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  try {
    const legacyAction = resolveLegacyAuthAction(request);
    if (legacyAction) {
      const credentials = parseLegacyAuthCredentials(request.body);
      if (!credentials) {
        reply.status(400).send({
          code: "VALIDATION_ERROR",
          message: "Invalid request payload",
        });
        return;
      }

      await forwardLegacyAuthAction({
        request,
        reply,
        action: legacyAction,
        credentials,
      });
      return;
    }

    await forwardAuthRequest({
      request,
      reply,
    });
  } catch (error) {
    request.log.error({ err: error }, "Better Auth bridge failed");
    if (!reply.sent) {
      reply.status(500).send({ code: "AUTH_BRIDGE_ERROR", message: "Auth handler failed" });
    }
  }
};

export const authBridgeRoutes: FastifyPluginAsync = async (app) => {
  app.all("/api/auth", forwardRequest);
  app.all("/api/auth/*", forwardRequest);
};
