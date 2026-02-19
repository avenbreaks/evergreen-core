import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { ensIdentities, users } from "./user-core";

export const forumPostStatusEnum = pgEnum("forum_post_status", ["published", "soft_deleted", "hidden"]);
export const forumCommentStatusEnum = pgEnum("forum_comment_status", ["published", "soft_deleted", "hidden"]);
export const forumReactionTargetTypeEnum = pgEnum("forum_reaction_target_type", ["post", "comment"]);
export const forumReferenceTargetTypeEnum = pgEnum("forum_reference_target_type", ["post", "comment"]);
export const forumMentionTargetTypeEnum = pgEnum("forum_mention_target_type", ["user", "ens", "wallet"]);
export const forumReportTargetTypeEnum = pgEnum("forum_report_target_type", ["post", "comment", "user"]);
export const forumReportStatusEnum = pgEnum("forum_report_status", ["open", "resolved", "dismissed"]);
export const forumNotificationTypeEnum = pgEnum("forum_notification_type", [
  "mention",
  "reply",
  "reaction",
  "follow",
  "share",
  "report_update",
]);

export const forumPosts = pgTable(
  "forum_posts",
  {
    id: text("id").primaryKey(),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 280 }).notNull(),
    slug: varchar("slug", { length: 320 }).notNull(),
    contentMarkdown: text("content_markdown").notNull(),
    contentPlaintext: text("content_plaintext").notNull(),
    contentMeta: jsonb("content_meta").notNull().default(sql`'{}'::jsonb`),
    status: forumPostStatusEnum("status").notNull().default("published"),
    isPinned: boolean("is_pinned").notNull().default(false),
    isLocked: boolean("is_locked").notNull().default(false),
    commentCount: integer("comment_count").notNull().default(0),
    reactionCount: integer("reaction_count").notNull().default(0),
    shareCount: integer("share_count").notNull().default(0),
    bookmarkCount: integer("bookmark_count").notNull().default(0),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    authorIdx: index("forum_posts_author_id_idx").on(table.authorId),
    statusIdx: index("forum_posts_status_idx").on(table.status),
    pinnedIdx: index("forum_posts_pinned_idx").on(table.isPinned, table.lastActivityAt),
    activityIdx: index("forum_posts_activity_idx").on(table.lastActivityAt),
    slugUnique: uniqueIndex("forum_posts_slug_unique").on(table.slug),
  })
);

export const forumComments = pgTable(
  "forum_comments",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => forumPosts.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    depth: integer("depth").notNull().default(0),
    contentMarkdown: text("content_markdown").notNull(),
    contentPlaintext: text("content_plaintext").notNull(),
    contentMeta: jsonb("content_meta").notNull().default(sql`'{}'::jsonb`),
    status: forumCommentStatusEnum("status").notNull().default("published"),
    reactionCount: integer("reaction_count").notNull().default(0),
    replyCount: integer("reply_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    postIdx: index("forum_comments_post_id_idx").on(table.postId),
    parentIdx: index("forum_comments_parent_id_idx").on(table.parentId),
    authorIdx: index("forum_comments_author_id_idx").on(table.authorId),
    statusIdx: index("forum_comments_status_idx").on(table.status),
  })
);

export const forumReactions = pgTable(
  "forum_reactions",
  {
    id: text("id").primaryKey(),
    targetType: forumReactionTargetTypeEnum("target_type").notNull(),
    postId: text("post_id").references(() => forumPosts.id, { onDelete: "cascade" }),
    commentId: text("comment_id").references(() => forumComments.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reactionType: varchar("reaction_type", { length: 32 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    targetIdx: index("forum_reactions_target_idx").on(table.targetType, table.postId, table.commentId),
    userIdx: index("forum_reactions_user_id_idx").on(table.userId),
    userReactionUnique: uniqueIndex("forum_reactions_user_target_reaction_unique").on(
      table.targetType,
      table.postId,
      table.commentId,
      table.userId,
      table.reactionType
    ),
  })
);

export const forumShares = pgTable(
  "forum_shares",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => forumPosts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    shareComment: text("share_comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    postIdx: index("forum_shares_post_id_idx").on(table.postId),
    userIdx: index("forum_shares_user_id_idx").on(table.userId),
  })
);

export const forumBookmarks = pgTable(
  "forum_bookmarks",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    postId: text("post_id")
      .notNull()
      .references(() => forumPosts.id, { onDelete: "cascade" }),
    isPinned: boolean("is_pinned").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({
      name: "forum_bookmarks_pk",
      columns: [table.userId, table.postId],
    }),
    postIdx: index("forum_bookmarks_post_id_idx").on(table.postId),
    userPinnedIdx: index("forum_bookmarks_user_pinned_idx").on(table.userId, table.isPinned),
  })
);

export const forumFollows = pgTable(
  "forum_follows",
  {
    followerId: text("follower_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followeeId: text("followee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({
      name: "forum_follows_pk",
      columns: [table.followerId, table.followeeId],
    }),
    followeeIdx: index("forum_follows_followee_id_idx").on(table.followeeId),
  })
);

export const forumTags = pgTable(
  "forum_tags",
  {
    id: text("id").primaryKey(),
    slug: varchar("slug", { length: 120 }).notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    postCount: integer("post_count").notNull().default(0),
    trendScore: integer("trend_score").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugUnique: uniqueIndex("forum_tags_slug_unique").on(table.slug),
    trendIdx: index("forum_tags_trend_idx").on(table.trendScore),
  })
);

export const forumPostTags = pgTable(
  "forum_post_tags",
  {
    postId: text("post_id")
      .notNull()
      .references(() => forumPosts.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => forumTags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({
      name: "forum_post_tags_pk",
      columns: [table.postId, table.tagId],
    }),
    tagIdx: index("forum_post_tags_tag_id_idx").on(table.tagId),
  })
);

export const forumMentions = pgTable(
  "forum_mentions",
  {
    id: text("id").primaryKey(),
    targetType: forumMentionTargetTypeEnum("target_type").notNull(),
    postId: text("post_id").references(() => forumPosts.id, { onDelete: "cascade" }),
    commentId: text("comment_id").references(() => forumComments.id, { onDelete: "cascade" }),
    mentionedUserId: text("mentioned_user_id").references(() => users.id, { onDelete: "cascade" }),
    mentionedEnsIdentityId: text("mentioned_ens_identity_id").references(() => ensIdentities.id, { onDelete: "set null" }),
    mentionedWalletAddress: varchar("mentioned_wallet_address", { length: 42 }),
    mentionText: varchar("mention_text", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    targetIdx: index("forum_mentions_target_idx").on(table.postId, table.commentId),
    userIdx: index("forum_mentions_user_id_idx").on(table.mentionedUserId),
    ensIdx: index("forum_mentions_ens_id_idx").on(table.mentionedEnsIdentityId),
  })
);

export const forumReferences = pgTable(
  "forum_references",
  {
    id: text("id").primaryKey(),
    targetType: forumReferenceTargetTypeEnum("target_type").notNull(),
    postId: text("post_id").references(() => forumPosts.id, { onDelete: "cascade" }),
    commentId: text("comment_id").references(() => forumComments.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    domain: varchar("domain", { length: 255 }),
    normalizedUrl: text("normalized_url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    targetIdx: index("forum_references_target_idx").on(table.targetType, table.postId, table.commentId),
    domainIdx: index("forum_references_domain_idx").on(table.domain),
  })
);

export const forumReplyDrafts = pgTable(
  "forum_reply_drafts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    postId: text("post_id")
      .notNull()
      .references(() => forumPosts.id, { onDelete: "cascade" }),
    parentCommentId: text("parent_comment_id").references(() => forumComments.id, { onDelete: "cascade" }),
    contentMarkdown: text("content_markdown").notNull(),
    contentPlaintext: text("content_plaintext").notNull(),
    contentMeta: jsonb("content_meta").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("forum_reply_drafts_user_id_idx").on(table.userId),
    uniqueContext: uniqueIndex("forum_reply_drafts_unique_context").on(table.userId, table.postId, table.parentCommentId),
  })
);

export const forumReports = pgTable(
  "forum_reports",
  {
    id: text("id").primaryKey(),
    targetType: forumReportTargetTypeEnum("target_type").notNull(),
    postId: text("post_id").references(() => forumPosts.id, { onDelete: "cascade" }),
    commentId: text("comment_id").references(() => forumComments.id, { onDelete: "cascade" }),
    reportedUserId: text("reported_user_id").references(() => users.id, { onDelete: "cascade" }),
    reporterUserId: text("reporter_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    status: forumReportStatusEnum("status").notNull().default("open"),
    reviewedByUserId: text("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index("forum_reports_status_idx").on(table.status),
    reporterIdx: index("forum_reports_reporter_id_idx").on(table.reporterUserId),
    targetIdx: index("forum_reports_target_idx").on(table.targetType, table.postId, table.commentId, table.reportedUserId),
  })
);

export const forumNotifications = pgTable(
  "forum_notifications",
  {
    id: text("id").primaryKey(),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    type: forumNotificationTypeEnum("type").notNull(),
    postId: text("post_id").references(() => forumPosts.id, { onDelete: "cascade" }),
    commentId: text("comment_id").references(() => forumComments.id, { onDelete: "cascade" }),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    recipientIdx: index("forum_notifications_recipient_idx").on(table.recipientUserId, table.readAt, table.createdAt),
  })
);

export const profileExtended = pgTable("profile_extended", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  location: varchar("location", { length: 160 }),
  organization: varchar("organization", { length: 160 }),
  websiteUrl: text("website_url"),
  brandingEmail: varchar("branding_email", { length: 320 }),
  displayWalletAddress: varchar("display_wallet_address", { length: 42 }),
  displayEnsName: varchar("display_ens_name", { length: 255 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const profileMetrics = pgTable("profile_metrics", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  postCount: integer("post_count").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  reactionGivenCount: integer("reaction_given_count").notNull().default(0),
  reactionReceivedCount: integer("reaction_received_count").notNull().default(0),
  followerCount: integer("follower_count").notNull().default(0),
  followingCount: integer("following_count").notNull().default(0),
  profileViewCount: integer("profile_view_count").notNull().default(0),
  engagementScore: integer("engagement_score").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
