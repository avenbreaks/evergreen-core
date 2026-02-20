import { randomUUID } from "node:crypto";

import { and, count, eq, gte } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

export type ApiKeyAuditEventType = (typeof schema.apiKeyAuditEventTypeEnum.enumValues)[number];
export type ApiKeyAuditOutcome = (typeof schema.apiKeyAuditOutcomeEnum.enumValues)[number];
export type ApiKeyPolicyAction = (typeof schema.apiKeyPolicyActionEnum.enumValues)[number];
export type ApiKeyRiskLevel = (typeof schema.apiKeyRiskLevelEnum.enumValues)[number];

export type RecordApiKeyAuditEventInput = {
  keyId?: string | null;
  userId?: string | null;
  eventType: ApiKeyAuditEventType;
  outcome: ApiKeyAuditOutcome;
  policyAction?: ApiKeyPolicyAction;
  scope?: string | null;
  riskLevel?: ApiKeyRiskLevel;
  riskScore?: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestMethod?: string | null;
  requestPath?: string | null;
  statusCode?: number | null;
  reasonCode?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
};

const sanitize = (value: string | null | undefined): string | null => {
  const next = value?.trim();
  return next ? next : null;
};

export const recordApiKeyAuditEvent = async (input: RecordApiKeyAuditEventInput): Promise<string> => {
  const id = randomUUID();
  await authDb.insert(schema.apiKeyAuditEvents).values({
    id,
    keyId: sanitize(input.keyId),
    userId: sanitize(input.userId),
    eventType: input.eventType,
    outcome: input.outcome,
    policyAction: input.policyAction ?? "allow",
    scope: sanitize(input.scope),
    riskLevel: input.riskLevel ?? "low",
    riskScore: Math.max(0, Math.floor(input.riskScore ?? 0)),
    ipAddress: sanitize(input.ipAddress),
    userAgent: sanitize(input.userAgent),
    requestMethod: sanitize(input.requestMethod),
    requestPath: sanitize(input.requestPath),
    statusCode:
      input.statusCode === null || input.statusCode === undefined ? null : Math.max(100, Math.min(599, Math.floor(input.statusCode))),
    reasonCode: sanitize(input.reasonCode),
    reason: sanitize(input.reason),
    metadata: input.metadata ?? {},
    createdAt: new Date(),
  });

  return id;
};

export const countSuccessfulAuthenticationsForIp = async (input: {
  keyId: string;
  ipAddress: string;
  since: Date;
}): Promise<number> => {
  const [row] = await authDb
    .select({ total: count() })
    .from(schema.apiKeyAuditEvents)
    .where(
      and(
        eq(schema.apiKeyAuditEvents.keyId, input.keyId),
        eq(schema.apiKeyAuditEvents.eventType, "authenticated"),
        eq(schema.apiKeyAuditEvents.outcome, "success"),
        eq(schema.apiKeyAuditEvents.ipAddress, input.ipAddress),
        gte(schema.apiKeyAuditEvents.createdAt, input.since)
      )
    );

  return row?.total ?? 0;
};

export const countRecentSuccessfulAuthentications = async (input: {
  keyId: string;
  since: Date;
}): Promise<number> => {
  const [row] = await authDb
    .select({ total: count() })
    .from(schema.apiKeyAuditEvents)
    .where(
      and(
        eq(schema.apiKeyAuditEvents.keyId, input.keyId),
        eq(schema.apiKeyAuditEvents.eventType, "authenticated"),
        eq(schema.apiKeyAuditEvents.outcome, "success"),
        gte(schema.apiKeyAuditEvents.createdAt, input.since)
      )
    );

  return row?.total ?? 0;
};
