import { relations } from "drizzle-orm";

import { apiKeyAuditEvents, apiKeyRequestNonces, apiKeys } from "./api-keys";
import { authAccounts, authSessions } from "./auth";
import {
  forumBookmarks,
  forumComments,
  forumFollows,
  forumMentions,
  forumNotifications,
  forumPostTags,
  forumPosts,
  forumReactions,
  forumReferences,
  forumReplyDrafts,
  forumReports,
  forumShares,
  forumTags,
  profileExtended,
  profileMetrics,
} from "./forum";
import { ensIdentities, ensPurchaseIntents, ensWebhookEvents, profiles, users, wallets } from "./user-core";

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
  ownedApiKeys: many(apiKeys, { relationName: "api_key_owner" }),
  createdApiKeys: many(apiKeys, { relationName: "api_key_creator" }),
  apiKeyAuditEvents: many(apiKeyAuditEvents),
  forumPosts: many(forumPosts),
  forumComments: many(forumComments),
  forumReactions: many(forumReactions),
  forumShares: many(forumShares),
  bookmarks: many(forumBookmarks),
  followers: many(forumFollows, { relationName: "followers" }),
  following: many(forumFollows, { relationName: "following" }),
  mentions: many(forumMentions),
  notifications: many(forumNotifications),
  reports: many(forumReports, { relationName: "reporter" }),
  profileExtended: one(profileExtended, {
    fields: [users.id],
    references: [profileExtended.userId],
  }),
  profileMetrics: one(profileMetrics, {
    fields: [users.id],
    references: [profileMetrics.userId],
  }),
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

export const ensPurchaseIntentsRelations = relations(ensPurchaseIntents, ({ one, many }) => ({
  user: one(users, {
    fields: [ensPurchaseIntents.userId],
    references: [users.id],
  }),
  webhookEvents: many(ensWebhookEvents),
}));

export const ensWebhookEventsRelations = relations(ensWebhookEvents, ({ one }) => ({
  intent: one(ensPurchaseIntents, {
    fields: [ensWebhookEvents.intentId],
    references: [ensPurchaseIntents.id],
  }),
}));

export const forumPostsRelations = relations(forumPosts, ({ one, many }) => ({
  author: one(users, {
    fields: [forumPosts.authorId],
    references: [users.id],
  }),
  comments: many(forumComments),
  reactions: many(forumReactions),
  shares: many(forumShares),
  bookmarks: many(forumBookmarks),
  postTags: many(forumPostTags),
  mentions: many(forumMentions),
  references: many(forumReferences),
  replyDrafts: many(forumReplyDrafts),
  reports: many(forumReports),
  notifications: many(forumNotifications),
}));

export const forumCommentsRelations = relations(forumComments, ({ one, many }) => ({
  post: one(forumPosts, {
    fields: [forumComments.postId],
    references: [forumPosts.id],
  }),
  author: one(users, {
    fields: [forumComments.authorId],
    references: [users.id],
  }),
  parent: one(forumComments, {
    fields: [forumComments.parentId],
    references: [forumComments.id],
    relationName: "comment_children",
  }),
  children: many(forumComments, {
    relationName: "comment_children",
  }),
  reactions: many(forumReactions),
  mentions: many(forumMentions),
  references: many(forumReferences),
  replyDrafts: many(forumReplyDrafts),
  reports: many(forumReports),
  notifications: many(forumNotifications),
}));

export const forumReactionsRelations = relations(forumReactions, ({ one }) => ({
  user: one(users, {
    fields: [forumReactions.userId],
    references: [users.id],
  }),
  post: one(forumPosts, {
    fields: [forumReactions.postId],
    references: [forumPosts.id],
  }),
  comment: one(forumComments, {
    fields: [forumReactions.commentId],
    references: [forumComments.id],
  }),
}));

export const forumSharesRelations = relations(forumShares, ({ one }) => ({
  user: one(users, {
    fields: [forumShares.userId],
    references: [users.id],
  }),
  post: one(forumPosts, {
    fields: [forumShares.postId],
    references: [forumPosts.id],
  }),
}));

export const forumBookmarksRelations = relations(forumBookmarks, ({ one }) => ({
  user: one(users, {
    fields: [forumBookmarks.userId],
    references: [users.id],
  }),
  post: one(forumPosts, {
    fields: [forumBookmarks.postId],
    references: [forumPosts.id],
  }),
}));

export const forumFollowsRelations = relations(forumFollows, ({ one }) => ({
  follower: one(users, {
    fields: [forumFollows.followerId],
    references: [users.id],
    relationName: "followers",
  }),
  followee: one(users, {
    fields: [forumFollows.followeeId],
    references: [users.id],
    relationName: "following",
  }),
}));

export const forumTagsRelations = relations(forumTags, ({ many }) => ({
  postTags: many(forumPostTags),
}));

export const forumPostTagsRelations = relations(forumPostTags, ({ one }) => ({
  post: one(forumPosts, {
    fields: [forumPostTags.postId],
    references: [forumPosts.id],
  }),
  tag: one(forumTags, {
    fields: [forumPostTags.tagId],
    references: [forumTags.id],
  }),
}));

export const forumMentionsRelations = relations(forumMentions, ({ one }) => ({
  post: one(forumPosts, {
    fields: [forumMentions.postId],
    references: [forumPosts.id],
  }),
  comment: one(forumComments, {
    fields: [forumMentions.commentId],
    references: [forumComments.id],
  }),
  user: one(users, {
    fields: [forumMentions.mentionedUserId],
    references: [users.id],
  }),
  ensIdentity: one(ensIdentities, {
    fields: [forumMentions.mentionedEnsIdentityId],
    references: [ensIdentities.id],
  }),
}));

export const forumReferencesRelations = relations(forumReferences, ({ one }) => ({
  post: one(forumPosts, {
    fields: [forumReferences.postId],
    references: [forumPosts.id],
  }),
  comment: one(forumComments, {
    fields: [forumReferences.commentId],
    references: [forumComments.id],
  }),
}));

export const forumReplyDraftsRelations = relations(forumReplyDrafts, ({ one }) => ({
  user: one(users, {
    fields: [forumReplyDrafts.userId],
    references: [users.id],
  }),
  post: one(forumPosts, {
    fields: [forumReplyDrafts.postId],
    references: [forumPosts.id],
  }),
  parentComment: one(forumComments, {
    fields: [forumReplyDrafts.parentCommentId],
    references: [forumComments.id],
  }),
}));

export const forumReportsRelations = relations(forumReports, ({ one }) => ({
  post: one(forumPosts, {
    fields: [forumReports.postId],
    references: [forumPosts.id],
  }),
  comment: one(forumComments, {
    fields: [forumReports.commentId],
    references: [forumComments.id],
  }),
  reporter: one(users, {
    fields: [forumReports.reporterUserId],
    references: [users.id],
    relationName: "reporter",
  }),
  reportedUser: one(users, {
    fields: [forumReports.reportedUserId],
    references: [users.id],
  }),
  reviewer: one(users, {
    fields: [forumReports.reviewedByUserId],
    references: [users.id],
  }),
}));

export const forumNotificationsRelations = relations(forumNotifications, ({ one }) => ({
  recipient: one(users, {
    fields: [forumNotifications.recipientUserId],
    references: [users.id],
  }),
  actor: one(users, {
    fields: [forumNotifications.actorUserId],
    references: [users.id],
  }),
  post: one(forumPosts, {
    fields: [forumNotifications.postId],
    references: [forumPosts.id],
  }),
  comment: one(forumComments, {
    fields: [forumNotifications.commentId],
    references: [forumComments.id],
  }),
}));

export const profileExtendedRelations = relations(profileExtended, ({ one }) => ({
  user: one(users, {
    fields: [profileExtended.userId],
    references: [users.id],
  }),
}));

export const profileMetricsRelations = relations(profileMetrics, ({ one }) => ({
  user: one(users, {
    fields: [profileMetrics.userId],
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

export const apiKeysRelations = relations(apiKeys, ({ one, many }) => ({
  owner: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
    relationName: "api_key_owner",
  }),
  createdBy: one(users, {
    fields: [apiKeys.createdByUserId],
    references: [users.id],
    relationName: "api_key_creator",
  }),
  rotatedFrom: one(apiKeys, {
    fields: [apiKeys.rotatedFromKeyId],
    references: [apiKeys.id],
    relationName: "api_key_rotation",
  }),
  rotatedTo: many(apiKeys, {
    relationName: "api_key_rotation",
  }),
  auditEvents: many(apiKeyAuditEvents),
  requestNonces: many(apiKeyRequestNonces),
}));

export const apiKeyAuditEventsRelations = relations(apiKeyAuditEvents, ({ one }) => ({
  key: one(apiKeys, {
    fields: [apiKeyAuditEvents.keyId],
    references: [apiKeys.id],
  }),
  user: one(users, {
    fields: [apiKeyAuditEvents.userId],
    references: [users.id],
  }),
}));

export const apiKeyRequestNoncesRelations = relations(apiKeyRequestNonces, ({ one }) => ({
  key: one(apiKeys, {
    fields: [apiKeyRequestNonces.keyId],
    references: [apiKeys.id],
  }),
}));
