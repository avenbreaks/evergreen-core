import { relations } from "drizzle-orm";

import { authAccounts, authSessions } from "./auth";
import { ensIdentities, ensPurchaseIntents, profiles, users, wallets } from "./user-core";

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(profiles, {
    fields: [users.id],
    references: [profiles.userId],
  }),
  wallets: many(wallets),
  ensIdentities: many(ensIdentities),
  ensPurchaseIntents: many(ensPurchaseIntents),
  authAccounts: many(authAccounts),
  authSessions: many(authSessions),
}));

export const profilesRelations = relations(profiles, ({ one }) => ({
  user: one(users, {
    fields: [profiles.userId],
    references: [users.id],
  }),
}));

export const walletsRelations = relations(wallets, ({ one }) => ({
  user: one(users, {
    fields: [wallets.userId],
    references: [users.id],
  }),
}));

export const ensIdentitiesRelations = relations(ensIdentities, ({ one }) => ({
  user: one(users, {
    fields: [ensIdentities.userId],
    references: [users.id],
  }),
}));

export const ensPurchaseIntentsRelations = relations(ensPurchaseIntents, ({ one }) => ({
  user: one(users, {
    fields: [ensPurchaseIntents.userId],
    references: [users.id],
  }),
}));

export const authAccountsRelations = relations(authAccounts, ({ one }) => ({
  user: one(users, {
    fields: [authAccounts.userId],
    references: [users.id],
  }),
}));

export const authSessionsRelations = relations(authSessions, ({ one }) => ({
  user: one(users, {
    fields: [authSessions.userId],
    references: [users.id],
  }),
}));
