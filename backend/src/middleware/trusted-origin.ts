import type { preHandlerHookHandler } from "fastify";

import { backendEnv } from "../config/env";
import { HttpError } from "../lib/http-error";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const toStringHeader = (value: string | string[] | undefined): string | null => {
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? value[0] ?? null : value;
};

const extractOrigin = (originHeader: string | null, refererHeader: string | null): string | null => {
  if (originHeader) {
    return originHeader;
  }

  if (!refererHeader) {
    return null;
  }

  try {
    return new URL(refererHeader).origin;
  } catch {
    return null;
  }
};

export const requireTrustedOriginMiddleware: preHandlerHookHandler = async (request) => {
  if (SAFE_METHODS.has(request.method)) {
    return;
  }

  const origin = extractOrigin(
    toStringHeader(request.headers.origin),
    toStringHeader(request.headers.referer)
  );

  if (!origin) {
    throw new HttpError(403, "CSRF_ORIGIN_REQUIRED", "Missing trusted origin header for this operation");
  }

  if (!backendEnv.corsOrigins.includes(origin)) {
    throw new HttpError(403, "CSRF_ORIGIN_INVALID", "Origin is not allowed for this operation", {
      origin,
    });
  }
};
