import type { FastifyRequest } from "fastify";

import { HttpError } from "./http-error";

const HEADER_USER_ID = "x-user-id";

export const getOptionalUserId = (request: FastifyRequest): string | null => {
  const value = request.headers[HEADER_USER_ID];
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
};

export const requireUserId = (request: FastifyRequest): string => {
  const userId = getOptionalUserId(request);
  if (!userId) {
    throw new HttpError(
      401,
      "UNAUTHORIZED",
      "Missing user context. Set x-user-id header or wire Better Auth session middleware."
    );
  }

  return userId;
};
