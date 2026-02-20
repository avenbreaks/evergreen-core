import { randomUUID } from "node:crypto";

import { createClient } from "redis";

import { backendEnv } from "../../config/env";

type TokenBucketState = {
  tokens: number;
  lastRefillAtMs: number;
};

type ConsumeTokenInput = {
  bucketKey: string;
  maxTokens: number;
  windowMs: number;
  nowMs?: number;
};

type ConsumeTokenResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

const tokenBuckets = new Map<string, TokenBucketState>();
const inFlightByKey = new Map<string, number>();

const TOKEN_BUCKET_SCRIPT = `
local stateKey = KEYS[1]
local maxTokens = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])

local refillPerMs = maxTokens / windowMs
local tokens = tonumber(redis.call("HGET", stateKey, "tokens"))
local lastRefillAtMs = tonumber(redis.call("HGET", stateKey, "lastRefillAtMs"))

if not tokens or not lastRefillAtMs then
  tokens = maxTokens
  lastRefillAtMs = nowMs
end

local elapsed = math.max(0, nowMs - lastRefillAtMs)
tokens = math.min(maxTokens, tokens + (elapsed * refillPerMs))
lastRefillAtMs = nowMs

if tokens < 1 then
  redis.call("HSET", stateKey, "tokens", tokens, "lastRefillAtMs", lastRefillAtMs)
  redis.call("PEXPIRE", stateKey, windowMs * 3)
  local retryAfterMs = math.ceil((1 - tokens) / refillPerMs)
  return {0, 0, math.max(1, retryAfterMs)}
end

tokens = tokens - 1
redis.call("HSET", stateKey, "tokens", tokens, "lastRefillAtMs", lastRefillAtMs)
redis.call("PEXPIRE", stateKey, windowMs * 3)

return {1, math.floor(tokens), 0}
`;

const INFLIGHT_ACQUIRE_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local nowMs = tonumber(ARGV[2])
local ttlMs = tonumber(ARGV[3])
local token = ARGV[4]

redis.call("ZREMRANGEBYSCORE", key, "-inf", nowMs)
local current = redis.call("ZCARD", key)

if current >= limit then
  redis.call("PEXPIRE", key, ttlMs)
  return {0, current}
end

redis.call("ZADD", key, nowMs + ttlMs, token)
redis.call("PEXPIRE", key, ttlMs)
return {1, current + 1}
`;

const INFLIGHT_RELEASE_SCRIPT = `
local key = KEYS[1]
local nowMs = tonumber(ARGV[1])
local token = ARGV[2]

redis.call("ZREMRANGEBYSCORE", key, "-inf", nowMs)
redis.call("ZREM", key, token)

local remaining = redis.call("ZCARD", key)
if remaining <= 0 then
  redis.call("DEL", key)
end

return remaining
`;

type RateLimitRedisClient = ReturnType<typeof createClient>;

let redisClientPromise: Promise<RateLimitRedisClient | null> | null = null;

const cleanupTokenBucket = (key: string, state: TokenBucketState, nowMs: number, windowMs: number, maxTokens: number): void => {
  if (state.tokens >= maxTokens && nowMs - state.lastRefillAtMs > windowMs * 3) {
    tokenBuckets.delete(key);
  }
};

const toNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
};

const toTuple = (value: unknown, minLength: number): unknown[] => {
  if (!Array.isArray(value) || value.length < minLength) {
    throw new Error("Unexpected Redis script response format");
  }

  return value;
};

const buildRedisKey = (suffix: string): string => `${backendEnv.apiKey.rateLimiter.redisPrefix}:${suffix}`;

const shouldUseRedis = (): boolean => Boolean(backendEnv.apiKey.rateLimiter.redisUrl);

const createRedisRateLimitClient = async (): Promise<RateLimitRedisClient | null> => {
  const redisUrl = backendEnv.apiKey.rateLimiter.redisUrl;
  if (!redisUrl) {
    return null;
  }

  const client = createClient({
    url: redisUrl,
    socket: {
      connectTimeout: backendEnv.apiKey.rateLimiter.redisConnectTimeoutMs,
      reconnectStrategy: () => false,
    },
  });

  client.on("error", () => {
    // Avoid noisy unhandled events; requests fall back to in-memory limiter.
  });

  try {
    await client.connect();
    return client;
  } catch {
    return null;
  }
};

const getRedisClient = async (): Promise<RateLimitRedisClient | null> => {
  if (!shouldUseRedis()) {
    return null;
  }

  if (!redisClientPromise) {
    redisClientPromise = createRedisRateLimitClient();
  }

  return redisClientPromise;
};

const resetRedisClient = async (): Promise<void> => {
  const current = redisClientPromise;
  redisClientPromise = null;

  if (!current) {
    return;
  }

  const client = await current;
  if (!client) {
    return;
  }

  try {
    if (client.isOpen) {
      await client.quit();
    }
  } catch {
    // Ignore shutdown errors.
  }
};

const withRedisFallback = async <T>(
  operation: (client: RateLimitRedisClient) => Promise<T>,
  fallback: () => Promise<T> | T
): Promise<T> => {
  const client = await getRedisClient();
  if (!client) {
    return fallback();
  }

  try {
    return await operation(client);
  } catch {
    await resetRedisClient();
    return fallback();
  }
};

const consumeTokenInMemory = (input: ConsumeTokenInput): ConsumeTokenResult => {
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

const consumeTokenInRedis = async (client: RateLimitRedisClient, input: ConsumeTokenInput): Promise<ConsumeTokenResult> => {
  const maxTokens = Math.max(1, Math.floor(input.maxTokens));
  const windowMs = Math.max(1000, Math.floor(input.windowMs));
  const nowMs = input.nowMs ?? Date.now();
  const redisKey = buildRedisKey(`bucket:${input.bucketKey}`);

  const raw = await client.eval(TOKEN_BUCKET_SCRIPT, {
    keys: [redisKey],
    arguments: [String(maxTokens), String(windowMs), String(nowMs)],
  });

  const tuple = toTuple(raw, 3);
  return {
    allowed: toNumber(tuple[0]) === 1,
    remaining: Math.max(0, Math.floor(toNumber(tuple[1]))),
    retryAfterMs: Math.max(0, Math.ceil(toNumber(tuple[2]))),
  };
};

const acquireInFlightSlotInMemory = (keyId: string, limit: number): (() => void) | null => {
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

const releaseInFlightSlotInRedis = async (input: { keyId: string; token: string; nowMs?: number }): Promise<void> => {
  const client = await getRedisClient();
  if (!client) {
    return;
  }

  await client.eval(INFLIGHT_RELEASE_SCRIPT, {
    keys: [buildRedisKey(`inflight:${input.keyId}`)],
    arguments: [String(input.nowMs ?? Date.now()), input.token],
  });
};

const acquireInFlightSlotInRedis = async (
  client: RateLimitRedisClient,
  keyId: string,
  limit: number
): Promise<(() => void) | null> => {
  const maxConcurrent = Math.max(1, Math.floor(limit));
  const nowMs = Date.now();
  const ttlMs = Math.max(1000, backendEnv.apiKey.rateLimiter.concurrencySlotTtlSeconds * 1000);
  const token = randomUUID();

  const raw = await client.eval(INFLIGHT_ACQUIRE_SCRIPT, {
    keys: [buildRedisKey(`inflight:${keyId}`)],
    arguments: [String(maxConcurrent), String(nowMs), String(ttlMs), token],
  });

  const tuple = toTuple(raw, 2);
  if (toNumber(tuple[0]) !== 1) {
    return null;
  }

  let released = false;
  return () => {
    if (released) {
      return;
    }

    released = true;
    void releaseInFlightSlotInRedis({
      keyId,
      token,
    });
  };
};

export const consumeToken = async (input: ConsumeTokenInput): Promise<ConsumeTokenResult> =>
  withRedisFallback(
    async (client) => consumeTokenInRedis(client, input),
    async () => consumeTokenInMemory(input)
  );

export const acquireInFlightSlot = async (keyId: string, limit: number): Promise<(() => void) | null> =>
  withRedisFallback(
    async (client) => acquireInFlightSlotInRedis(client, keyId, limit),
    async () => acquireInFlightSlotInMemory(keyId, limit)
  );

export const shutdownApiKeyRateLimiter = async (): Promise<void> => {
  await resetRedisClient();
};
