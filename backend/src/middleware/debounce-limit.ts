import { createHash } from "node:crypto";

import type { FastifyRequest, preHandlerHookHandler } from "fastify";

import { backendEnv } from "../config/env";
import { HttpError } from "../lib/http-error";

type DebounceKeyResolver = (request: FastifyRequest) => string | Promise<string>;

type DebounceOptions = {
  namespace: string;
  key: DebounceKeyResolver;
  windowMs?: number;
};

const debounceStore = new Map<string, number>();

const cleanupStore = (now: number, maxAgeMs: number): void => {
  if (debounceStore.size < 1000) {
    return;
  }

  for (const [key, timestamp] of debounceStore.entries()) {
    if (now - timestamp > maxAgeMs) {
      debounceStore.delete(key);
    }
  }
};

export const hashDebouncePayload = (payload: unknown): string => {
  const encoded = JSON.stringify(payload ?? null);
  return createHash("sha256").update(encoded).digest("hex");
};

export const createDebounceMiddleware = (options: DebounceOptions): preHandlerHookHandler => {
  return async (request) => {
    const now = Date.now();
    const windowMs = options.windowMs ?? backendEnv.debounceWindowMs;
    const rawKey = await options.key(request);
    const storeKey = `${options.namespace}:${rawKey}`;
    const previousTimestamp = debounceStore.get(storeKey);

    if (previousTimestamp && now - previousTimestamp < windowMs) {
      const retryAfterMs = windowMs - (now - previousTimestamp);
      throw new HttpError(429, "DEBOUNCE_LIMIT", "Request repeated too quickly", {
        namespace: options.namespace,
        retryAfterMs,
      });
    }

    debounceStore.set(storeKey, now);
    cleanupStore(now, windowMs * 4);
  };
};
