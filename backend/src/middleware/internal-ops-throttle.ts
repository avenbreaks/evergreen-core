import type { preHandlerHookHandler } from "fastify";

import { HttpError } from "../lib/http-error";
import type {
  ClaimInternalOpsCooldownInput,
  ClaimInternalOpsCooldownResult,
} from "../services/internal-ops-throttle-store";

type CreateInternalOpsThrottleInput = {
  operation: string;
  cooldownMs: number;
  claim: (input: ClaimInternalOpsCooldownInput) => Promise<ClaimInternalOpsCooldownResult>;
};

export const createInternalOpsThrottleMiddleware = (
  input: CreateInternalOpsThrottleInput
): preHandlerHookHandler => {
  const cooldownMs = Math.max(1, Math.floor(input.cooldownMs));

  return async () => {
    const claim = await input.claim({
      operation: input.operation,
      cooldownMs,
    });

    if (!claim.allowed) {
      throw new HttpError(429, "INTERNAL_OPS_RATE_LIMITED", `${input.operation} is rate limited`, {
        operation: input.operation,
        cooldownMs,
        retryAfterMs: claim.retryAfterMs,
        nextAllowedAt: claim.nextAllowedAt,
      });
    }
  };
};
