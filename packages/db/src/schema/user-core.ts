import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["user", "moderator", "admin"]);
export const userStatusEnum = pgEnum("user_status", ["active", "suspended", "deleted"]);
export const ensStatusEnum = pgEnum("ens_status", ["pending", "active", "failed", "revoked"]);
export const ensPurchaseIntentStatusEnum = pgEnum("ens_purchase_intent_status", [
  "prepared",
  "committed",
  "registerable",
  "registered",
  "expired",
  "failed",
  "cancelled",
]);
export const ensWebhookEventStatusEnum = pgEnum("ens_webhook_event_status", [
  "processing",
  "processed",
  "failed",
  "dead_letter",
]);

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    name: varchar("name", { length: 120 }).notNull(),
    username: varchar("username", { length: 32 }),
    image: text("image"),
    role: userRoleEnum("role").notNull().default("user"),
    status: userStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (table) => ({
    emailUnique: uniqueIndex("users_email_unique").on(table.email),
    usernameUnique: uniqueIndex("users_username_unique").on(table.username),
    statusIdx: index("users_status_idx").on(table.status),
  })
);

export const profiles = pgTable("profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  displayName: varchar("display_name", { length: 120 }),
  headline: varchar("headline", { length: 160 }),
  bio: text("bio"),
  location: varchar("location", { length: 120 }),
  websiteUrl: text("website_url"),
  githubUsername: varchar("github_username", { length: 80 }),
  skills: jsonb("skills").notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const wallets = pgTable(
  "wallets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chainId: integer("chain_id").notNull(),
    address: varchar("address", { length: 42 }).notNull(),
    walletType: varchar("wallet_type", { length: 24 }).notNull().default("evm"),
    isPrimary: boolean("is_primary").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("wallets_user_id_idx").on(table.userId),
    userPrimaryIdx: index("wallets_user_primary_idx").on(table.userId, table.isPrimary),
    chainAddressUnique: uniqueIndex("wallets_chain_address_unique").on(table.chainId, table.address),
  })
);

export const ensIdentities = pgTable(
  "ens_identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chainId: integer("chain_id").notNull(),
    tld: varchar("tld", { length: 64 }).notNull().default("dev"),
    name: varchar("name", { length: 255 }).notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    node: varchar("node", { length: 66 }),
    resolverAddress: varchar("resolver_address", { length: 42 }),
    ownerAddress: varchar("owner_address", { length: 42 }),
    controllerAddress: varchar("controller_address", { length: 42 }),
    baseRegistrarAddress: varchar("base_registrar_address", { length: 42 }),
    txHash: varchar("tx_hash", { length: 66 }),
    status: ensStatusEnum("status").notNull().default("pending"),
    isPrimary: boolean("is_primary").notNull().default(false),
    commitmentId: text("commitment_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    registeredAt: timestamp("registered_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("ens_identities_user_id_idx").on(table.userId),
    userPrimaryIdx: index("ens_identities_user_primary_idx").on(table.userId, table.isPrimary),
    nameUnique: uniqueIndex("ens_identities_name_unique").on(table.name),
    userDomainUnique: uniqueIndex("ens_identities_user_domain_unique").on(table.userId, table.name),
    statusIdx: index("ens_identities_status_idx").on(table.status),
    chainIdx: index("ens_identities_chain_id_idx").on(table.chainId),
  })
);

export const ensPurchaseIntents = pgTable(
  "ens_purchase_intents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chainId: integer("chain_id").notNull(),
    walletAddress: varchar("wallet_address", { length: 42 }).notNull(),
    tld: varchar("tld", { length: 64 }).notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    domainName: varchar("domain_name", { length: 255 }).notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    resolverAddress: varchar("resolver_address", { length: 42 }).notNull(),
    controllerAddress: varchar("controller_address", { length: 42 }).notNull(),
    baseRegistrarAddress: varchar("base_registrar_address", { length: 42 }).notNull(),
    secretHash: varchar("secret_hash", { length: 66 }).notNull(),
    commitment: varchar("commitment", { length: 66 }).notNull(),
    registerValueWei: text("register_value_wei"),
    commitTxHash: varchar("commit_tx_hash", { length: 66 }),
    registerTxHash: varchar("register_tx_hash", { length: 66 }),
    minCommitmentAgeSeconds: integer("min_commitment_age_seconds").notNull(),
    maxCommitmentAgeSeconds: integer("max_commitment_age_seconds").notNull(),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    registerableAt: timestamp("registerable_at", { withTimezone: true }),
    registerBy: timestamp("register_by", { withTimezone: true }),
    status: ensPurchaseIntentStatusEnum("status").notNull().default("prepared"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("ens_purchase_intents_user_id_idx").on(table.userId),
    statusIdx: index("ens_purchase_intents_status_idx").on(table.status),
    domainIdx: index("ens_purchase_intents_domain_idx").on(table.chainId, table.tld, table.label),
    commitmentUnique: uniqueIndex("ens_purchase_intents_commitment_unique").on(table.commitment),
    commitTxUnique: uniqueIndex("ens_purchase_intents_commit_tx_hash_unique").on(table.commitTxHash),
    registerTxUnique: uniqueIndex("ens_purchase_intents_register_tx_hash_unique").on(table.registerTxHash),
  })
);

export const ensWebhookEvents = pgTable(
  "ens_webhook_events",
  {
    id: text("id").primaryKey(),
    intentId: text("intent_id")
      .notNull()
      .references(() => ensPurchaseIntents.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    dedupeKey: varchar("dedupe_key", { length: 255 }).notNull(),
    txHash: varchar("tx_hash", { length: 66 }),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    result: jsonb("result"),
    status: ensWebhookEventStatusEnum("status").notNull().default("processing"),
    attemptCount: integer("attempt_count").notNull().default(1),
    lastErrorCode: varchar("last_error_code", { length: 64 }),
    lastErrorMessage: text("last_error_message"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    intentIdx: index("ens_webhook_events_intent_id_idx").on(table.intentId),
    statusIdx: index("ens_webhook_events_status_idx").on(table.status),
    retryIdx: index("ens_webhook_events_retry_idx").on(table.status, table.nextRetryAt),
    processedIdx: index("ens_webhook_events_processed_at_idx").on(table.status, table.processedAt),
    deadLetterIdx: index("ens_webhook_events_dead_lettered_at_idx").on(table.status, table.deadLetteredAt),
    txHashIdx: index("ens_webhook_events_tx_hash_idx").on(table.txHash),
    dedupeUnique: uniqueIndex("ens_webhook_events_dedupe_key_unique").on(table.dedupeKey),
  })
);

export const internalOpsThrottle = pgTable(
  "internal_ops_throttle",
  {
    operation: varchar("operation", { length: 120 }).primaryKey(),
    nextAllowedAt: timestamp("next_allowed_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    nextAllowedIdx: index("internal_ops_throttle_next_allowed_at_idx").on(table.nextAllowedAt),
  })
);

export const internalWorkerControls = pgTable(
  "internal_worker_controls",
  {
    worker: varchar("worker", { length: 120 }).primaryKey(),
    isPaused: boolean("is_paused").notNull().default(false),
    pauseReason: text("pause_reason"),
    pausedBy: varchar("paused_by", { length: 120 }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pausedIdx: index("internal_worker_controls_paused_idx").on(table.worker, table.isPaused),
  })
);

export const internalOpsAuditEvents = pgTable(
  "internal_ops_audit_events",
  {
    id: text("id").primaryKey(),
    operation: varchar("operation", { length: 120 }).notNull(),
    outcome: varchar("outcome", { length: 24 }).notNull(),
    actor: varchar("actor", { length: 120 }),
    requestMethod: varchar("request_method", { length: 16 }),
    requestPath: varchar("request_path", { length: 255 }),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    result: jsonb("result"),
    errorCode: varchar("error_code", { length: 64 }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    operationIdx: index("internal_ops_audit_events_operation_idx").on(table.operation, table.createdAt),
    createdIdx: index("internal_ops_audit_events_created_at_idx").on(table.createdAt),
  })
);
