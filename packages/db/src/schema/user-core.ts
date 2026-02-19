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
