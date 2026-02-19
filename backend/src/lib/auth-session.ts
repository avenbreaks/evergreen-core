import type { FastifyRequest } from "fastify";

import { auth } from "@evergreen-devparty/auth";

import { HttpError } from "./http-error";

type AuthSession = {
  session: {
    id: string;
    token: string;
    userId: string;
    expiresAt: string | Date;
  };
  user: {
    id: string;
    email: string;
    name: string;
    image?: string | null;
  };
};

const sessionCache = new WeakMap<FastifyRequest, AuthSession | null>();

const toHeaders = (request: FastifyRequest): Headers => {
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
      continue;
    }

    headers.set(key, String(value));
  }

  return headers;
};

export const getAuthSession = async (request: FastifyRequest): Promise<AuthSession | null> => {
  if (sessionCache.has(request)) {
    return sessionCache.get(request) ?? null;
  }

  const session = (await auth.api.getSession({
    headers: toHeaders(request),
  })) as AuthSession | null;

  sessionCache.set(request, session);
  return session;
};

export const requireAuthSession = async (request: FastifyRequest): Promise<AuthSession> => {
  const session = await getAuthSession(request);
  if (!session) {
    throw new HttpError(401, "UNAUTHORIZED", "Authentication required");
  }

  return session;
};
