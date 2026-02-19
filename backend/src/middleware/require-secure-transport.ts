import type { preHandlerHookHandler } from "fastify";

import { backendEnv } from "../config/env";
import { HttpError } from "../lib/http-error";

const toStringHeader = (value: string | string[] | undefined): string | null => {
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? value[0] ?? null : value;
};

const parseForwardedProto = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const first = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .find(Boolean);

  return first ?? null;
};

export const requireSecureTransportMiddleware: preHandlerHookHandler = async (request) => {
  if (!backendEnv.trustProxy || !backendEnv.enforceSecureTransport) {
    return;
  }

  const forwardedProto = parseForwardedProto(toStringHeader(request.headers["x-forwarded-proto"]));
  const protocol = forwardedProto ?? request.protocol;

  if (protocol === "https") {
    return;
  }

  throw new HttpError(426, "INSECURE_TRANSPORT", "HTTPS is required for this endpoint", {
    protocol,
  });
};
