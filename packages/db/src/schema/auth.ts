import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./user-core";

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: varchar("account_id", { length: 255 }).notNull(),
    providerId: varchar("provider_id", { length: 50 }).notNull(),
    password: text("password"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    idToken: text("id_token"),
    scope: text("scope"),
    tokenType: varchar("token_type", { length: 64 }),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("auth_accounts_user_id_idx").on(table.userId),
    providerUnique: uniqueIndex("auth_accounts_provider_unique").on(table.providerId, table.accountId),
  })
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("auth_sessions_user_id_idx").on(table.userId),
    tokenUnique: uniqueIndex("auth_sessions_token_unique").on(table.token),
    expiresIdx: index("auth_sessions_expires_at_idx").on(table.expiresAt),
  })
);

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: text("id").primaryKey(),
    identifier: varchar("identifier", { length: 320 }).notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueValue: uniqueIndex("auth_verifications_unique_value").on(table.identifier, table.value),
    expiresIdx: index("auth_verifications_expires_at_idx").on(table.expiresAt),
  })
);

export const siweNonces = pgTable(
  "siwe_nonces",
  {
    id: text("id").primaryKey(),
    nonce: varchar("nonce", { length: 96 }).notNull(),
    walletAddress: varchar("wallet_address", { length: 42 }).notNull(),
    chainId: integer("chain_id").notNull(),
    domain: varchar("domain", { length: 255 }).notNull(),
    uri: text("uri").notNull(),
    statement: text("statement"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    nonceUnique: uniqueIndex("siwe_nonces_nonce_unique").on(table.nonce),
    walletIdx: index("siwe_nonces_wallet_idx").on(table.walletAddress),
    expiresIdx: index("siwe_nonces_expires_at_idx").on(table.expiresAt),
  })
);
