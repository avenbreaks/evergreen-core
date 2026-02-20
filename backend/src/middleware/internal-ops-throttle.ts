import type { preHandlerHookHandler } from "fastify";

import { HttpError } from "../lib/http-error";

type CreateInternalOpsThrottleInput = {
  operation: string;
  cooldownMs: number;
  now?: () => number;
};

export const createInternalOpsThrottleMiddleware = (
  input: CreateInternalOpsThrottleInput
): preHandlerHookHandler => {
  const cooldownMs = Math.max(1, Math.floor(input.cooldownMs));
  const now = input.now ?? Date.now;
  let lastAcceptedAt = 0;

  return async () => {
    const current = now();
    const elapsed = current - lastAcceptedAt;
    if (lastAcceptedAt > 0 && elapsed < cooldownMs) {
      throw new HttpError(429, "INTERNAL_OPS_RATE_LIMITED", `${input.operation} is rate limited`, {
        operation: input.operation,
        cooldownMs,
        retryAfterMs: cooldownMs - Math.max(elapsed, 0),
      });
    }

    lastAcceptedAt = current;
  };
};
