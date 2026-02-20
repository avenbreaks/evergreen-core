import { randomUUID } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";

import { authDb, hashSecretValue, verifySecretValue } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { backendEnv } from "../../config/env";
import { HttpError } from "../../lib/http-error";
import {
  type ApiKeyPolicyAction,
  recordApiKeyAuditEvent,
  type ApiKeyRiskLevel,
} from "./audit";
import {
  createApiKeyToken,
  generateApiKeyId,
  generateApiKeySecret,
  getApiKeyPrefix,
  hasAllScopes,
  maskApiKeyDisplay,
  normalizeScopes,
  parseApiKeyToken,
  type ApiKeyEnvironment,
} from "./format";
import { acquireInFlightSlot, consumeToken } from "./rate-limit";
import { evaluateApiKeyRisk } from "./risk";
import { verifyApiKeyRequestSignature } from "./signature";

type ApiKeyStatus = (typeof schema.apiKeyStatusEnum.enumValues)[number];

const SCOPE_PATTERN = /^[a-z0-9_*:-]+$/;

const toDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const sanitize = (value: string | null | undefined): string | null => {
  const next = value?.trim();
  return next ? next : null;
};

const isExpired = (expiresAt: Date | null, now: Date): boolean => Boolean(expiresAt && expiresAt.getTime() <= now.getTime());

const getRequestPath = (request: FastifyRequest): string => (request.raw.url ?? request.url).split("?")[0] ?? request.url;

const getAuthTokenFromRequest = (request: FastifyRequest): string | null => {
  const authorization = request.headers.authorization;
  if (typeof authorization === "string" && authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  const xApiKey = request.headers["x-api-key"];
  if (typeof xApiKey === "string") {
    return xApiKey.trim();
  }

  if (Array.isArray(xApiKey) && xApiKey.length > 0) {
    return xApiKey[0]?.trim() ?? null;
  }

  return null;
};

const hasApiKeyInQuery = (request: FastifyRequest): boolean => {
  const query = request.query;
  if (!query || typeof query !== "object") {
    return false;
  }

  return "api_key" in query || "apikey" in query || "key" in query;
};

const validateStoredScopesOrThrow = (scopes: string[]): string[] => {
  const normalized = normalizeScopes(scopes);
  if (normalized.length === 0) {
    throw new HttpError(400, "API_KEY_SCOPE_REQUIRED", "At least one API key scope is required");
  }

  const invalidScope = normalized.find((scope) => !SCOPE_PATTERN.test(scope));
  if (invalidScope) {
    throw new HttpError(400, "API_KEY_SCOPE_INVALID", `Invalid API key scope: ${invalidScope}`);
  }

  return normalized;
};

const normalizeRequiredScopes = (scopes: string[]): string[] => {
  const normalized = normalizeScopes(scopes);
  const invalidScope = normalized.find((scope) => !SCOPE_PATTERN.test(scope));
  if (invalidScope) {
    throw new HttpError(400, "API_KEY_SCOPE_INVALID", `Invalid API key scope: ${invalidScope}`);
  }

  return normalized;
};

const getStepUpAllowedAgeMs = (): number => backendEnv.apiKey.sessionFreshSeconds * 1000;

const assertUserEmailVerified = async (userId: string): Promise<void> => {
  const [user] = await authDb
    .select({ emailVerified: schema.users.emailVerified })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!user) {
    throw new HttpError(404, "USER_NOT_FOUND", "User account was not found");
  }

  if (!user.emailVerified) {
    throw new HttpError(403, "EMAIL_NOT_VERIFIED", "Email verification is required to manage API keys");
  }
};

const assertStepUpAuthentication = async (input: {
  userId: string;
  sessionUpdatedAt?: string | Date | null;
  currentPassword?: string;
}): Promise<void> => {
  const now = Date.now();
  const sessionUpdatedAt = toDate(input.sessionUpdatedAt) ?? new Date(0);
  const isFresh = now - sessionUpdatedAt.getTime() <= getStepUpAllowedAgeMs();
  if (isFresh) {
    return;
  }

  const password = sanitize(input.currentPassword);
  if (!password) {
    throw new HttpError(403, "SESSION_REAUTH_REQUIRED", "Please re-authenticate by providing currentPassword");
  }

  const [credentialAccount] = await authDb
    .select({ passwordHash: schema.authAccounts.password })
    .from(schema.authAccounts)
    .where(and(eq(schema.authAccounts.userId, input.userId), eq(schema.authAccounts.providerId, "credential")))
    .limit(1);

  if (!credentialAccount?.passwordHash) {
    throw new HttpError(403, "SESSION_REAUTH_REQUIRED", "Password-based re-authentication is unavailable for this account");
  }

  const verified = await verifySecretValue({
    hash: credentialAccount.passwordHash,
    value: password,
  });

  if (!verified) {
    throw new HttpError(403, "SESSION_REAUTH_REQUIRED", "Current password is invalid");
  }
};

const calculateExpiryDate = (expiresInDays: number | undefined): Date | null => {
  const configured = expiresInDays ?? backendEnv.apiKey.defaultExpiresDays;
  const days = Math.floor(configured);

  if (days < backendEnv.apiKey.minExpiresDays || days > backendEnv.apiKey.maxExpiresDays) {
    throw new HttpError(
      400,
      "API_KEY_EXPIRES_INVALID",
      `API key expiry must be between ${backendEnv.apiKey.minExpiresDays} and ${backendEnv.apiKey.maxExpiresDays} days`
    );
  }

  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
};

const safeRecordAudit = async (input: Parameters<typeof recordApiKeyAuditEvent>[0]): Promise<void> => {
  try {
    await recordApiKeyAuditEvent(input);
  } catch {
    // Ignore audit write failures to avoid masking the request result.
  }
};

const markFailedAuthentication = async (input: {
  keyId: string;
  userId: string;
  ipAddress: string;
  userAgent: string | null;
  request: FastifyRequest;
  reasonCode: string;
  reason: string;
  policyAction?: ApiKeyPolicyAction;
  riskLevel?: ApiKeyRiskLevel;
  riskScore?: number;
}): Promise<void> => {
  const now = new Date();

  await authDb
    .update(schema.apiKeys)
    .set({
      failedAuthStreak: sql`${schema.apiKeys.failedAuthStreak} + 1`,
      lastFailedAuthAt: now,
      updatedAt: now,
    })
    .where(eq(schema.apiKeys.id, input.keyId));

  await safeRecordAudit({
    keyId: input.keyId,
    userId: input.userId,
    eventType: "auth_failed",
    outcome: "failure",
    policyAction: input.policyAction ?? "allow",
    riskLevel: input.riskLevel,
    riskScore: input.riskScore,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    requestMethod: input.request.method,
    requestPath: getRequestPath(input.request),
    statusCode: 401,
    reasonCode: input.reasonCode,
    reason: input.reason,
  });
};

export type CreateApiKeyInput = {
  userId: string;
  name: string;
  scopes: string[];
  environment?: ApiKeyEnvironment;
  expiresInDays?: number;
  rateLimitPerMinute?: number;
  rateLimitPerIpMinute?: number;
  concurrencyLimit?: number;
  metadata?: Record<string, unknown>;
  createdByUserId?: string;
  createdFromIp?: string;
  createdFromUa?: string;
};

export type CreateApiKeyResult = {
  id: string;
  key: string;
  name: string;
  environment: ApiKeyEnvironment;
  scopes: string[];
  expiresAt: Date | null;
  createdAt: Date;
};

export const createApiKeyForUser = async (input: CreateApiKeyInput): Promise<CreateApiKeyResult> => {
  await assertUserEmailVerified(input.userId);

  const name = sanitize(input.name);
  if (!name) {
    throw new HttpError(400, "API_KEY_NAME_REQUIRED", "API key name is required");
  }

  const scopes = validateStoredScopesOrThrow(input.scopes);
  const environment = input.environment ?? "live";
  const keyId = generateApiKeyId();
  const secret = generateApiKeySecret();
  const secretHash = await hashSecretValue(secret);
  const secretHint = secret.slice(-6);
  const now = new Date();
  const expiresAt = calculateExpiryDate(input.expiresInDays);

  await authDb.insert(schema.apiKeys).values({
    id: keyId,
    userId: input.userId,
    environment,
    name,
    prefix: getApiKeyPrefix(environment),
    secretHash,
    secretHint,
    scopes,
    status: "active",
    riskLevel: "low",
    riskScore: 0,
    rateLimitPerMinute: Math.max(1, Math.floor(input.rateLimitPerMinute ?? backendEnv.apiKey.defaultRateLimitPerMinute)),
    rateLimitPerIpMinute: Math.max(1, Math.floor(input.rateLimitPerIpMinute ?? backendEnv.apiKey.defaultRateLimitPerIpMinute)),
    concurrencyLimit: Math.max(1, Math.floor(input.concurrencyLimit ?? backendEnv.apiKey.defaultConcurrencyLimit)),
    expiresAt,
    createdByUserId: sanitize(input.createdByUserId),
    createdFromIp: sanitize(input.createdFromIp),
    createdFromUa: sanitize(input.createdFromUa),
    metadata: input.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  });

  await safeRecordAudit({
    keyId,
    userId: input.userId,
    eventType: "created",
    outcome: "success",
    policyAction: "allow",
    riskLevel: "low",
    riskScore: 0,
    ipAddress: input.createdFromIp,
    userAgent: input.createdFromUa,
    metadata: {
      scopes,
      environment,
      expiresAt: expiresAt?.toISOString() ?? null,
    },
  });

  return {
    id: keyId,
    key: createApiKeyToken({ environment, keyId, secret }),
    name,
    environment,
    scopes,
    expiresAt,
    createdAt: now,
  };
};

export const listApiKeysForUser = async (userId: string) => {
  const rows = await authDb
    .select()
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.userId, userId))
    .orderBy(desc(schema.apiKeys.createdAt));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    environment: row.environment,
    status: row.status,
    scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : [],
    keyDisplay: maskApiKeyDisplay({
      environment: row.environment,
      keyId: row.id,
      secretHint: row.secretHint,
    }),
    expiresAt: row.expiresAt,
    graceExpiresAt: row.graceExpiresAt,
    lastUsedAt: row.lastUsedAt,
    usageCount: row.usageCount,
    riskLevel: row.riskLevel,
    riskScore: row.riskScore,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
};

const assertKeyOwnedByUser = async (input: { userId: string; keyId: string }) => {
  const [row] = await authDb
    .select()
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.id, input.keyId), eq(schema.apiKeys.userId, input.userId)))
    .limit(1);

  if (!row) {
    throw new HttpError(404, "API_KEY_NOT_FOUND", "API key not found");
  }

  return row;
};

export const rotateApiKeyForUser = async (input: {
  userId: string;
  keyId: string;
  sessionUpdatedAt?: string | Date | null;
  currentPassword?: string;
  gracePeriodMinutes?: number;
  requestIp?: string;
  requestUserAgent?: string;
}) => {
  await assertUserEmailVerified(input.userId);
  await assertStepUpAuthentication({
    userId: input.userId,
    sessionUpdatedAt: input.sessionUpdatedAt,
    currentPassword: input.currentPassword,
  });

  const currentKey = await assertKeyOwnedByUser({
    userId: input.userId,
    keyId: input.keyId,
  });

  if (currentKey.status === "revoked") {
    throw new HttpError(409, "API_KEY_ALREADY_REVOKED", "API key is already revoked");
  }

  const gracePeriodMinutes = Math.max(0, Math.min(30, Math.floor(input.gracePeriodMinutes ?? 10)));
  const now = new Date();
  const graceExpiresAt = gracePeriodMinutes > 0 ? new Date(now.getTime() + gracePeriodMinutes * 60 * 1000) : now;

  const rotatedKey = await createApiKeyForUser({
    userId: input.userId,
    name: `${currentKey.name} (rotated ${now.toISOString().slice(0, 10)})`,
    scopes: Array.isArray(currentKey.scopes) ? (currentKey.scopes as string[]) : [],
    environment: currentKey.environment,
    expiresInDays: currentKey.expiresAt
      ? Math.max(backendEnv.apiKey.minExpiresDays, Math.ceil((currentKey.expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
      : backendEnv.apiKey.defaultExpiresDays,
    rateLimitPerMinute: currentKey.rateLimitPerMinute,
    rateLimitPerIpMinute: currentKey.rateLimitPerIpMinute,
    concurrencyLimit: currentKey.concurrencyLimit,
    metadata: {
      ...(typeof currentKey.metadata === "object" && currentKey.metadata ? (currentKey.metadata as Record<string, unknown>) : {}),
      rotatedFromKeyId: currentKey.id,
    },
    createdByUserId: input.userId,
    createdFromIp: input.requestIp,
    createdFromUa: input.requestUserAgent,
  });

  await authDb
    .update(schema.apiKeys)
    .set({
      status: "rotated",
      graceExpiresAt,
      revokedAt: gracePeriodMinutes === 0 ? now : null,
      revokedReason: gracePeriodMinutes === 0 ? "rotated" : "rotated_grace_period",
      updatedAt: now,
    })
    .where(eq(schema.apiKeys.id, currentKey.id));

  await authDb
    .update(schema.apiKeys)
    .set({
      rotatedFromKeyId: currentKey.id,
      updatedAt: now,
    })
    .where(eq(schema.apiKeys.id, rotatedKey.id));

  await safeRecordAudit({
    keyId: currentKey.id,
    userId: input.userId,
    eventType: "rotated",
    outcome: "success",
    policyAction: "allow",
    ipAddress: input.requestIp,
    userAgent: input.requestUserAgent,
    metadata: {
      rotatedToKeyId: rotatedKey.id,
      gracePeriodMinutes,
      graceExpiresAt: graceExpiresAt.toISOString(),
    },
  });

  return {
    ...rotatedKey,
    rotatedFromKeyId: currentKey.id,
    gracePeriodMinutes,
    graceExpiresAt,
  };
};

export const revokeApiKeyForUser = async (input: {
  userId: string;
  keyId: string;
  sessionUpdatedAt?: string | Date | null;
  currentPassword?: string;
  reason?: string;
  requestIp?: string;
  requestUserAgent?: string;
}) => {
  await assertUserEmailVerified(input.userId);
  await assertStepUpAuthentication({
    userId: input.userId,
    sessionUpdatedAt: input.sessionUpdatedAt,
    currentPassword: input.currentPassword,
  });

  const key = await assertKeyOwnedByUser({
    userId: input.userId,
    keyId: input.keyId,
  });

  if (key.status === "revoked") {
    return {
      revoked: true,
      id: key.id,
      alreadyRevoked: true,
    };
  }

  const now = new Date();
  await authDb
    .update(schema.apiKeys)
    .set({
      status: "revoked",
      revokedAt: now,
      revokedReason: sanitize(input.reason) ?? "manual_revoke",
      blockedUntil: null,
      graceExpiresAt: now,
      updatedAt: now,
    })
    .where(eq(schema.apiKeys.id, key.id));

  await safeRecordAudit({
    keyId: key.id,
    userId: input.userId,
    eventType: "revoked",
    outcome: "success",
    policyAction: "allow",
    ipAddress: input.requestIp,
    userAgent: input.requestUserAgent,
    reasonCode: "MANUAL_REVOKE",
    reason: sanitize(input.reason) ?? "manual_revoke",
  });

  return {
    revoked: true,
    id: key.id,
    alreadyRevoked: false,
  };
};

export type ApiKeyPrincipal = {
  keyId: string;
  userId: string;
  environment: ApiKeyEnvironment;
  scopes: string[];
  riskLevel: ApiKeyRiskLevel;
  riskScore: number;
  policyAction: ApiKeyPolicyAction;
};

export type AuthenticatedApiKey = {
  principal: ApiKeyPrincipal;
  releaseConcurrency: () => void;
};

const assertKeyStatusAllowsUse = async (key: typeof schema.apiKeys.$inferSelect, now: Date): Promise<void> => {
  const blockedUntil = toDate(key.blockedUntil);
  if (blockedUntil && blockedUntil.getTime() > now.getTime()) {
    throw new HttpError(403, "API_KEY_BLOCKED", "API key is temporarily blocked", {
      blockedUntil: blockedUntil.toISOString(),
    });
  }

  const expiresAt = toDate(key.expiresAt);
  if (isExpired(expiresAt, now)) {
    await authDb
      .update(schema.apiKeys)
      .set({
        status: "revoked",
        revokedAt: now,
        revokedReason: "expired",
        updatedAt: now,
      })
      .where(eq(schema.apiKeys.id, key.id));

    throw new HttpError(401, "API_KEY_EXPIRED", "API key has expired");
  }

  const graceExpiresAt = toDate(key.graceExpiresAt);
  if (key.status === "rotated" && (!graceExpiresAt || graceExpiresAt.getTime() <= now.getTime())) {
    throw new HttpError(401, "API_KEY_ROTATED", "API key has been rotated and can no longer be used");
  }

  if (key.status === "revoked") {
    throw new HttpError(401, "API_KEY_REVOKED", "API key has been revoked");
  }

  if (key.status === "blocked") {
    throw new HttpError(403, "API_KEY_BLOCKED", "API key is blocked");
  }
};

const updateSuccessfulAuthenticationState = async (input: {
  keyId: string;
  riskLevel: ApiKeyRiskLevel;
  riskScore: number;
  now: Date;
}): Promise<void> => {
  await authDb
    .update(schema.apiKeys)
    .set({
      failedAuthStreak: 0,
      lastUsedAt: input.now,
      usageCount: sql`${schema.apiKeys.usageCount} + 1`,
      riskLevel: input.riskLevel,
      riskScore: input.riskScore,
      riskLastEvaluatedAt: input.now,
      updatedAt: input.now,
    })
    .where(eq(schema.apiKeys.id, input.keyId));
};

export const authenticateApiKeyRequest = async (input: {
  request: FastifyRequest;
  requiredScopes?: string[];
  requireSignature?: boolean;
}): Promise<AuthenticatedApiKey> => {
  if (hasApiKeyInQuery(input.request)) {
    throw new HttpError(400, "API_KEY_QUERY_NOT_ALLOWED", "API key must not be provided via query string");
  }

  const token = getAuthTokenFromRequest(input.request);
  if (!token) {
    throw new HttpError(401, "API_KEY_MISSING", "Missing API key authentication header");
  }

  const parsed = parseApiKeyToken(token);
  if (!parsed) {
    throw new HttpError(401, "API_KEY_INVALID", "Invalid API key format");
  }

  const requiredScopes = normalizeRequiredScopes(input.requiredScopes ?? []);
  const requestPath = getRequestPath(input.request);
  const ipAddress = input.request.ip;
  const userAgent = sanitize(input.request.headers["user-agent"] as string | undefined);
  const now = new Date();

  const [key] = await authDb.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, parsed.keyId)).limit(1);
  if (!key) {
    throw new HttpError(401, "API_KEY_INVALID", "API key not found");
  }

  if (key.environment !== parsed.environment) {
    await markFailedAuthentication({
      keyId: key.id,
      userId: key.userId,
      ipAddress,
      userAgent,
      request: input.request,
      reasonCode: "API_KEY_ENV_MISMATCH",
      reason: "API key environment prefix mismatch",
    });

    throw new HttpError(401, "API_KEY_INVALID", "API key not found");
  }

  await assertKeyStatusAllowsUse(key, now);

  const secretValid = await verifySecretValue({
    hash: key.secretHash,
    value: parsed.secret,
  });

  if (!secretValid) {
    await markFailedAuthentication({
      keyId: key.id,
      userId: key.userId,
      ipAddress,
      userAgent,
      request: input.request,
      reasonCode: "API_KEY_INVALID_SECRET",
      reason: "API key secret mismatch",
    });

    throw new HttpError(401, "API_KEY_INVALID", "Invalid API key credentials");
  }

  const grantedScopes = normalizeRequiredScopes(Array.isArray(key.scopes) ? (key.scopes as string[]) : []);
  if (!hasAllScopes(grantedScopes, requiredScopes)) {
    await markFailedAuthentication({
      keyId: key.id,
      userId: key.userId,
      ipAddress,
      userAgent,
      request: input.request,
      reasonCode: "API_KEY_SCOPE_FORBIDDEN",
      reason: "API key does not include required scope",
    });

    throw new HttpError(403, "API_KEY_SCOPE_FORBIDDEN", "API key does not include required scope", {
      requiredScopes,
    });
  }

  const risk = await evaluateApiKeyRisk({
    keyId: key.id,
    ipAddress,
    failedAuthStreak: key.failedAuthStreak,
    requiredScopes,
  });

  if (risk.policyAction === "block") {
    const blockedUntil = new Date(now.getTime() + backendEnv.apiKey.riskBlockSeconds * 1000);
    await authDb
      .update(schema.apiKeys)
      .set({
        status: "blocked",
        blockedUntil,
        riskLevel: "high",
        riskScore: risk.score,
        riskLastEvaluatedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.apiKeys.id, key.id));

    await safeRecordAudit({
      keyId: key.id,
      userId: key.userId,
      eventType: "blocked",
      outcome: "failure",
      policyAction: "block",
      scope: requiredScopes.join(","),
      riskLevel: "high",
      riskScore: risk.score,
      ipAddress,
      userAgent,
      requestMethod: input.request.method,
      requestPath,
      statusCode: 403,
      reasonCode: "API_KEY_RISK_BLOCKED",
      reason: risk.reasons.join(","),
    });

    throw new HttpError(403, "API_KEY_RISK_BLOCKED", "API key blocked by adaptive security policy", {
      blockedUntil: blockedUntil.toISOString(),
      riskScore: risk.score,
      reasons: risk.reasons,
    });
  }

  const effectiveRatePerMinute =
    risk.policyAction === "throttle"
      ? Math.max(1, Math.floor(key.rateLimitPerMinute / 2))
      : Math.max(1, key.rateLimitPerMinute);
  const effectiveRatePerIpMinute =
    risk.policyAction === "throttle"
      ? Math.max(1, Math.floor(key.rateLimitPerIpMinute / 2))
      : Math.max(1, key.rateLimitPerIpMinute);
  const effectiveConcurrency =
    risk.policyAction === "throttle"
      ? Math.max(1, Math.floor(key.concurrencyLimit / 2))
      : Math.max(1, key.concurrencyLimit);

  const keyRate = await consumeToken({
    bucketKey: `api-key:${key.id}`,
    maxTokens: effectiveRatePerMinute,
    windowMs: 60_000,
  });
  if (!keyRate.allowed) {
    await safeRecordAudit({
      keyId: key.id,
      userId: key.userId,
      eventType: "throttled",
      outcome: "failure",
      policyAction: risk.policyAction,
      scope: requiredScopes.join(","),
      riskLevel: risk.level,
      riskScore: risk.score,
      ipAddress,
      userAgent,
      requestMethod: input.request.method,
      requestPath,
      statusCode: 429,
      reasonCode: "API_KEY_RATE_LIMITED",
      reason: "API key global rate limit exceeded",
      metadata: {
        retryAfterMs: keyRate.retryAfterMs,
      },
    });

    throw new HttpError(429, "API_KEY_RATE_LIMITED", "API key global rate limit exceeded", {
      retryAfterMs: keyRate.retryAfterMs,
    });
  }

  const ipRate = await consumeToken({
    bucketKey: `api-key-ip:${key.id}:${ipAddress}`,
    maxTokens: effectiveRatePerIpMinute,
    windowMs: 60_000,
  });
  if (!ipRate.allowed) {
    await safeRecordAudit({
      keyId: key.id,
      userId: key.userId,
      eventType: "throttled",
      outcome: "failure",
      policyAction: risk.policyAction,
      scope: requiredScopes.join(","),
      riskLevel: risk.level,
      riskScore: risk.score,
      ipAddress,
      userAgent,
      requestMethod: input.request.method,
      requestPath,
      statusCode: 429,
      reasonCode: "API_KEY_IP_RATE_LIMITED",
      reason: "API key per-IP rate limit exceeded",
      metadata: {
        retryAfterMs: ipRate.retryAfterMs,
      },
    });

    throw new HttpError(429, "API_KEY_IP_RATE_LIMITED", "API key per-IP rate limit exceeded", {
      retryAfterMs: ipRate.retryAfterMs,
    });
  }

  const releaseConcurrency = await acquireInFlightSlot(key.id, effectiveConcurrency);
  if (!releaseConcurrency) {
    await safeRecordAudit({
      keyId: key.id,
      userId: key.userId,
      eventType: "throttled",
      outcome: "failure",
      policyAction: risk.policyAction,
      scope: requiredScopes.join(","),
      riskLevel: risk.level,
      riskScore: risk.score,
      ipAddress,
      userAgent,
      requestMethod: input.request.method,
      requestPath,
      statusCode: 429,
      reasonCode: "API_KEY_CONCURRENCY_LIMITED",
      reason: "API key concurrent request limit exceeded",
    });

    throw new HttpError(429, "API_KEY_CONCURRENCY_LIMITED", "API key concurrent request limit exceeded");
  }

  if (input.requireSignature) {
    try {
      await verifyApiKeyRequestSignature({
        request: input.request,
        keyId: key.id,
        secret: parsed.secret,
      });
    } catch (error) {
      releaseConcurrency();
      await safeRecordAudit({
        keyId: key.id,
        userId: key.userId,
        eventType: "signature_failed",
        outcome: "failure",
        policyAction: risk.policyAction,
        scope: requiredScopes.join(","),
        riskLevel: risk.level,
        riskScore: risk.score,
        ipAddress,
        userAgent,
        requestMethod: input.request.method,
        requestPath,
        statusCode: 401,
        reasonCode: error instanceof HttpError ? error.code : "API_KEY_SIGNATURE_FAILED",
        reason: error instanceof Error ? error.message : "API key signature verification failed",
      });

      throw error;
    }
  }

  await updateSuccessfulAuthenticationState({
    keyId: key.id,
    riskLevel: risk.level,
    riskScore: risk.score,
    now,
  });

  await safeRecordAudit({
    keyId: key.id,
    userId: key.userId,
    eventType: "authenticated",
    outcome: "success",
    policyAction: risk.policyAction,
    scope: requiredScopes.join(","),
    riskLevel: risk.level,
    riskScore: risk.score,
    ipAddress,
    userAgent,
    requestMethod: input.request.method,
    requestPath,
    statusCode: 200,
    metadata: {
      remainingGlobalPerMinute: keyRate.remaining,
      remainingIpPerMinute: ipRate.remaining,
    },
  });

  return {
    principal: {
      keyId: key.id,
      userId: key.userId,
      environment: key.environment,
      scopes: grantedScopes,
      riskLevel: risk.level,
      riskScore: risk.score,
      policyAction: risk.policyAction,
    },
    releaseConcurrency,
  };
};
