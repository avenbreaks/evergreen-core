type TokenBucketState = {
  tokens: number;
  lastRefillAtMs: number;
};

const tokenBuckets = new Map<string, TokenBucketState>();
const inFlightByKey = new Map<string, number>();

const cleanupTokenBucket = (key: string, state: TokenBucketState, nowMs: number, windowMs: number, maxTokens: number): void => {
  if (state.tokens >= maxTokens && nowMs - state.lastRefillAtMs > windowMs * 3) {
    tokenBuckets.delete(key);
  }
};

export const consumeToken = (input: {
  bucketKey: string;
  maxTokens: number;
  windowMs: number;
  nowMs?: number;
}): {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
} => {
  const maxTokens = Math.max(1, Math.floor(input.maxTokens));
  const windowMs = Math.max(1000, Math.floor(input.windowMs));
  const nowMs = input.nowMs ?? Date.now();
  const refillPerMs = maxTokens / windowMs;

  const state = tokenBuckets.get(input.bucketKey) ?? {
    tokens: maxTokens,
    lastRefillAtMs: nowMs,
  };

  const elapsed = Math.max(0, nowMs - state.lastRefillAtMs);
  state.tokens = Math.min(maxTokens, state.tokens + elapsed * refillPerMs);
  state.lastRefillAtMs = nowMs;

  if (state.tokens < 1) {
    tokenBuckets.set(input.bucketKey, state);
    const retryAfterMs = Math.ceil((1 - state.tokens) / refillPerMs);
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(1, retryAfterMs),
    };
  }

  state.tokens -= 1;
  tokenBuckets.set(input.bucketKey, state);
  cleanupTokenBucket(input.bucketKey, state, nowMs, windowMs, maxTokens);

  return {
    allowed: true,
    remaining: Math.floor(state.tokens),
    retryAfterMs: 0,
  };
};

export const acquireInFlightSlot = (keyId: string, limit: number): (() => void) | null => {
  const maxConcurrent = Math.max(1, Math.floor(limit));
  const current = inFlightByKey.get(keyId) ?? 0;
  if (current >= maxConcurrent) {
    return null;
  }

  inFlightByKey.set(keyId, current + 1);

  let released = false;
  return () => {
    if (released) {
      return;
    }

    released = true;
    const next = (inFlightByKey.get(keyId) ?? 1) - 1;
    if (next <= 0) {
      inFlightByKey.delete(keyId);
      return;
    }

    inFlightByKey.set(keyId, next);
  };
};
