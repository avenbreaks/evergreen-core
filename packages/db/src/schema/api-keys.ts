import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./user-core";

export const apiKeyEnvironmentEnum = pgEnum("api_key_environment", ["live", "test"]);
export const apiKeyStatusEnum = pgEnum("api_key_status", ["active", "rotated", "revoked", "blocked"]);
export const apiKeyRiskLevelEnum = pgEnum("api_key_risk_level", ["low", "medium", "high"]);
export const apiKeyAuditEventTypeEnum = pgEnum("api_key_audit_event_type", [
  "created",
  "rotated",
  "revoked",
  "authenticated",
  "auth_failed",
  "signature_failed",
  "throttled",
  "blocked",
]);
export const apiKeyAuditOutcomeEnum = pgEnum("api_key_audit_outcome", ["success", "failure"]);
export const apiKeyPolicyActionEnum = pgEnum("api_key_policy_action", ["allow", "throttle", "block"]);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    environment: apiKeyEnvironmentEnum("environment").notNull().default("live"),
    name: varchar("name", { length: 120 }).notNull(),
    prefix: varchar("prefix", { length: 32 }).notNull(),
    secretHash: text("secret_hash").notNull(),
    secretHint: varchar("secret_hint", { length: 16 }).notNull(),
    scopes: jsonb("scopes").notNull().default(sql`'[]'::jsonb`),
    status: apiKeyStatusEnum("status").notNull().default("active"),
    riskLevel: apiKeyRiskLevelEnum("risk_level").notNull().default("low"),
    riskScore: integer("risk_score").notNull().default(0),
    riskLastEvaluatedAt: timestamp("risk_last_evaluated_at", { withTimezone: true }),
    rateLimitPerMinute: integer("rate_limit_per_minute").notNull().default(120),
    rateLimitPerIpMinute: integer("rate_limit_per_ip_minute").notNull().default(60),
    concurrencyLimit: integer("concurrency_limit").notNull().default(8),
    failedAuthStreak: integer("failed_auth_streak").notNull().default(0),
    lastFailedAuthAt: timestamp("last_failed_auth_at", { withTimezone: true }),
    blockedUntil: timestamp("blocked_until", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    graceExpiresAt: timestamp("grace_expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    usageCount: integer("usage_count").notNull().default(0),
    rotatedFromKeyId: text("rotated_from_key_id"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
    createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdFromIp: varchar("created_from_ip", { length: 64 }),
    createdFromUa: text("created_from_ua"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    rotatedFromFk: foreignKey({
      columns: [table.rotatedFromKeyId],
      foreignColumns: [table.id],
      name: "api_keys_rotated_from_key_id_api_keys_id_fk",
    }).onDelete("set null"),
    userCreatedIdx: index("api_keys_user_created_idx").on(table.userId, table.createdAt),
    statusIdx: index("api_keys_status_idx").on(table.status, table.blockedUntil, table.expiresAt),
    userUsedIdx: index("api_keys_user_last_used_idx").on(table.userId, table.lastUsedAt),
    rotatedFromIdx: index("api_keys_rotated_from_idx").on(table.rotatedFromKeyId),
    createdByIdx: index("api_keys_created_by_idx").on(table.createdByUserId),
  })
);

export const apiKeyAuditEvents = pgTable(
  "api_key_audit_events",
  {
    id: text("id").primaryKey(),
    keyId: text("key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    eventType: apiKeyAuditEventTypeEnum("event_type").notNull(),
    outcome: apiKeyAuditOutcomeEnum("outcome").notNull(),
    policyAction: apiKeyPolicyActionEnum("policy_action").notNull().default("allow"),
    scope: varchar("scope", { length: 120 }),
    riskLevel: apiKeyRiskLevelEnum("risk_level").notNull().default("low"),
    riskScore: integer("risk_score").notNull().default(0),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    requestMethod: varchar("request_method", { length: 16 }),
    requestPath: varchar("request_path", { length: 255 }),
    statusCode: integer("status_code"),
    reasonCode: varchar("reason_code", { length: 64 }),
    reason: text("reason"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    keyCreatedIdx: index("api_key_audit_events_key_created_idx").on(table.keyId, table.createdAt),
    userCreatedIdx: index("api_key_audit_events_user_created_idx").on(table.userId, table.createdAt),
    eventCreatedIdx: index("api_key_audit_events_event_created_idx").on(table.eventType, table.createdAt),
    createdIdx: index("api_key_audit_events_created_idx").on(table.createdAt),
  })
);

export const apiKeyRequestNonces = pgTable(
  "api_key_request_nonces",
  {
    keyId: text("key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    nonce: varchar("nonce", { length: 120 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({
      name: "api_key_request_nonces_pk",
      columns: [table.keyId, table.nonce],
    }),
    expiresIdx: index("api_key_request_nonces_expires_idx").on(table.expiresAt),
    keyExpiresIdx: index("api_key_request_nonces_key_expires_idx").on(table.keyId, table.expiresAt),
  })
);
