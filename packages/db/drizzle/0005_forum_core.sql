CREATE TYPE "forum_post_status" AS ENUM('published', 'soft_deleted', 'hidden');
--> statement-breakpoint
CREATE TYPE "forum_comment_status" AS ENUM('published', 'soft_deleted', 'hidden');
--> statement-breakpoint
CREATE TYPE "forum_reaction_target_type" AS ENUM('post', 'comment');
--> statement-breakpoint
CREATE TYPE "forum_reference_target_type" AS ENUM('post', 'comment');
--> statement-breakpoint
CREATE TYPE "forum_mention_target_type" AS ENUM('user', 'ens', 'wallet');
--> statement-breakpoint
CREATE TYPE "forum_report_target_type" AS ENUM('post', 'comment', 'user');
--> statement-breakpoint
CREATE TYPE "forum_report_status" AS ENUM('open', 'resolved', 'dismissed');
--> statement-breakpoint
CREATE TYPE "forum_notification_type" AS ENUM('mention', 'reply', 'reaction', 'follow', 'share', 'report_update');
--> statement-breakpoint

CREATE TABLE "forum_posts" (
  "id" text PRIMARY KEY NOT NULL,
  "author_id" text NOT NULL,
  "title" varchar(280) NOT NULL,
  "slug" varchar(320) NOT NULL,
  "content_markdown" text NOT NULL,
  "content_plaintext" text NOT NULL,
  "content_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" "forum_post_status" DEFAULT 'published' NOT NULL,
  "is_pinned" boolean DEFAULT false NOT NULL,
  "is_locked" boolean DEFAULT false NOT NULL,
  "comment_count" integer DEFAULT 0 NOT NULL,
  "reaction_count" integer DEFAULT 0 NOT NULL,
  "share_count" integer DEFAULT 0 NOT NULL,
  "bookmark_count" integer DEFAULT 0 NOT NULL,
  "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "forum_posts_author_id_users_id_fk"
    FOREIGN KEY ("author_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint

CREATE TABLE "forum_comments" (
  "id" text PRIMARY KEY NOT NULL,
  "post_id" text NOT NULL,
  "author_id" text NOT NULL,
  "parent_id" text,
  "depth" integer DEFAULT 0 NOT NULL,
  "content_markdown" text NOT NULL,
  "content_plaintext" text NOT NULL,
  "content_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" "forum_comment_status" DEFAULT 'published' NOT NULL,
  "reaction_count" integer DEFAULT 0 NOT NULL,
  "reply_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "forum_comments_post_id_forum_posts_id_fk"
    FOREIGN KEY ("post_id") REFERENCES "forum_posts"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "forum_comments_author_id_users_id_fk"
    FOREIGN KEY ("author_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "forum_comments_parent_id_forum_comments_id_fk"
    FOREIGN KEY ("parent_id") REFERENCES "forum_comments"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION
);
--> statement-breakpoint

CREATE TABLE "forum_reactions" (
  "id" text PRIMARY KEY NOT NULL,
  "target_type" "forum_reaction_target_type" NOT NULL,
  "post_id" text,
  "comment_id" text,
  "user_id" text NOT NULL,
  "reaction_type" varchar(32) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "forum_reactions_post_id_forum_posts_id_fk"
    FOREIGN KEY ("post_id") REFERENCES "forum_posts"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "forum_reactions_comment_id_forum_comments_id_fk"
    FOREIGN KEY ("comment_id") REFERENCES "forum_comments"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "forum_reactions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint

CREATE TABLE "forum_shares" (
  "id" text PRIMARY KEY NOT NULL,
  "post_id" text NOT NULL,
  "user_id" text NOT NULL,
  "share_comment" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "forum_shares_post_id_forum_posts_id_fk"
    FOREIGN KEY ("post_id") REFERENCES "forum_posts"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "forum_shares_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint

CREATE TABLE "forum_bookmarks" (
  "user_id" text NOT NULL,
  "post_id" text NOT NULL,
  "is_pinned" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "forum_bookmarks_pk" PRIMARY KEY("user_id", "post_id"),
  CONSTRAINT "forum_bookmarks_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "forum_bookmarks_post_id_forum_posts_id_fk"
    FOREIGN KEY ("post_id") REFERENCES "forum_posts"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint

CREATE TABLE "forum_follows" (
  "follower_id" text NOT NULL,
  "followee_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "forum_follows_pk" PRIMARY KEY("follower_id", "followee_id"),
  CONSTRAINT "forum_follows_follower_id_users_id_fk"
    FOREIGN KEY ("follower_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "forum_follows_followee_id_users_id_fk"
    FOREIGN KEY ("followee_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint

CREATE TABLE "forum_tags" (
  "id" text PRIMARY KEY NOT NULL,
  "slug" varchar(120) NOT NULL,
  "display_name" varchar(120) NOT NULL,
  "post_count" integer DEFAULT 0 NOT NULL,
  "trend_score" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "forum_post_tags" (
  "post_id" text NOT NULL,
  "tag_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "forum_post_tags_pk" PRIMARY KEY("post_id", "tag_id"),
  CONSTRAINT "forum_post_tags_post_id_forum_posts_id_fk"
    FOREIGN KEY ("post_id") REFERENCES "forum_posts"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "forum_post_tags_tag_id_forum_tags_id_fk"
    FOREIGN KEY ("tag_id") REFERENCES "forum_tags"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint

CREATE TABLE "forum_mentions" (
  "id" text PRIMARY KEY NOT NULL,
  "target_type" "forum_mention_target_type" NOT NULL,
  "post_id" text,
  "comment_id" text,
  "mentioned_user_id" text,
  "mentioned_ens_identity_id" text,
  "mentioned_wallet_address" varchar(42),
  "mention_text" varchar(255) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "forum_mentions_post_id_forum_posts_id_fk"
    FOREIGN KEY ("post_id") REFERENCES "forum_posts"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "forum_mentions_comment_id_forum_comments_id_fk"
    FOREIGN KEY ("comment_id") REFERENCES "forum_comments"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "forum_mentions_mentioned_user_id_users_id_fk"
    FOREIGN KEY ("mentioned_user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "forum_mentions_mentioned_ens_identity_id_ens_identities_id_fk"
    FOREIGN KEY ("mentioned_ens_identity_id") REFERENCES "ens_identities"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION
);
--> statement-breakpoint

CREATE TABLE "forum_references" (
  "id" text PRIMARY KEY NOT NULL,
  "target_type" "forum_reference_target_type" NOT NULL,
  "post_id" text,
  "comment_id" text,
  "url" text NOT NULL,
  "domain" varchar(255),
  "normalized_url" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "forum_references_post_id_forum_posts_id_fk"
    FOREIGN KEY ("post_id") REFERENCES "forum_posts"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "forum_references_comment_id_forum_comments_id_fk"
    FOREIGN KEY ("comment_id") REFERENCES "forum_comments"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint

CREATE TABLE "forum_reply_drafts" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "post_id" text NOT NULL,
  "parent_comment_id" text,
  "content_markdown" text NOT NULL,
  "content_plaintext" text NOT NULL,
  "content_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "forum_reply_drafts_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "forum_reply_drafts_post_id_forum_posts_id_fk"
    FOREIGN KEY ("post_id") REFERENCES "forum_posts"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "forum_reply_drafts_parent_comment_id_forum_comments_id_fk"
    FOREIGN KEY ("parent_comment_id") REFERENCES "forum_comments"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint

CREATE TABLE "forum_reports" (
  "id" text PRIMARY KEY NOT NULL,
  "target_type" "forum_report_target_type" NOT NULL,
  "post_id" text,
  "comment_id" text,
  "reported_user_id" text,
  "reporter_user_id" text NOT NULL,
  "reason" text NOT NULL,
  "status" "forum_report_status" DEFAULT 'open' NOT NULL,
  "reviewed_by_user_id" text,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "forum_reports_post_id_forum_posts_id_fk"
    FOREIGN KEY ("post_id") REFERENCES "forum_posts"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "forum_reports_comment_id_forum_comments_id_fk"
    FOREIGN KEY ("comment_id") REFERENCES "forum_comments"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "forum_reports_reported_user_id_users_id_fk"
    FOREIGN KEY ("reported_user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "forum_reports_reporter_user_id_users_id_fk"
    FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "forum_reports_reviewed_by_user_id_users_id_fk"
    FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION
);
--> statement-breakpoint

CREATE TABLE "forum_notifications" (
  "id" text PRIMARY KEY NOT NULL,
  "recipient_user_id" text NOT NULL,
  "actor_user_id" text,
  "type" "forum_notification_type" NOT NULL,
  "post_id" text,
  "comment_id" text,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "forum_notifications_recipient_user_id_users_id_fk"
    FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "forum_notifications_actor_user_id_users_id_fk"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "forum_notifications_post_id_forum_posts_id_fk"
    FOREIGN KEY ("post_id") REFERENCES "forum_posts"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "forum_notifications_comment_id_forum_comments_id_fk"
    FOREIGN KEY ("comment_id") REFERENCES "forum_comments"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint

CREATE TABLE "profile_extended" (
  "user_id" text PRIMARY KEY NOT NULL,
  "location" varchar(160),
  "organization" varchar(160),
  "website_url" text,
  "branding_email" varchar(320),
  "display_wallet_address" varchar(42),
  "display_ens_name" varchar(255),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "profile_extended_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint

CREATE TABLE "profile_metrics" (
  "user_id" text PRIMARY KEY NOT NULL,
  "post_count" integer DEFAULT 0 NOT NULL,
  "comment_count" integer DEFAULT 0 NOT NULL,
  "reaction_given_count" integer DEFAULT 0 NOT NULL,
  "reaction_received_count" integer DEFAULT 0 NOT NULL,
  "follower_count" integer DEFAULT 0 NOT NULL,
  "following_count" integer DEFAULT 0 NOT NULL,
  "profile_view_count" integer DEFAULT 0 NOT NULL,
  "engagement_score" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "profile_metrics_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint

CREATE INDEX "forum_posts_author_id_idx" ON "forum_posts" ("author_id");
--> statement-breakpoint
CREATE INDEX "forum_posts_status_idx" ON "forum_posts" ("status");
--> statement-breakpoint
CREATE INDEX "forum_posts_pinned_idx" ON "forum_posts" ("is_pinned", "last_activity_at");
--> statement-breakpoint
CREATE INDEX "forum_posts_activity_idx" ON "forum_posts" ("last_activity_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "forum_posts_slug_unique" ON "forum_posts" ("slug");
--> statement-breakpoint

CREATE INDEX "forum_comments_post_id_idx" ON "forum_comments" ("post_id");
--> statement-breakpoint
CREATE INDEX "forum_comments_parent_id_idx" ON "forum_comments" ("parent_id");
--> statement-breakpoint
CREATE INDEX "forum_comments_author_id_idx" ON "forum_comments" ("author_id");
--> statement-breakpoint
CREATE INDEX "forum_comments_status_idx" ON "forum_comments" ("status");
--> statement-breakpoint

CREATE INDEX "forum_reactions_target_idx" ON "forum_reactions" ("target_type", "post_id", "comment_id");
--> statement-breakpoint
CREATE INDEX "forum_reactions_user_id_idx" ON "forum_reactions" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "forum_reactions_user_target_reaction_unique"
  ON "forum_reactions" ("target_type", "post_id", "comment_id", "user_id", "reaction_type");
--> statement-breakpoint

CREATE INDEX "forum_shares_post_id_idx" ON "forum_shares" ("post_id");
--> statement-breakpoint
CREATE INDEX "forum_shares_user_id_idx" ON "forum_shares" ("user_id");
--> statement-breakpoint

CREATE INDEX "forum_bookmarks_post_id_idx" ON "forum_bookmarks" ("post_id");
--> statement-breakpoint
CREATE INDEX "forum_bookmarks_user_pinned_idx" ON "forum_bookmarks" ("user_id", "is_pinned");
--> statement-breakpoint

CREATE INDEX "forum_follows_followee_id_idx" ON "forum_follows" ("followee_id");
--> statement-breakpoint

CREATE UNIQUE INDEX "forum_tags_slug_unique" ON "forum_tags" ("slug");
--> statement-breakpoint
CREATE INDEX "forum_tags_trend_idx" ON "forum_tags" ("trend_score");
--> statement-breakpoint
CREATE INDEX "forum_post_tags_tag_id_idx" ON "forum_post_tags" ("tag_id");
--> statement-breakpoint

CREATE INDEX "forum_mentions_target_idx" ON "forum_mentions" ("post_id", "comment_id");
--> statement-breakpoint
CREATE INDEX "forum_mentions_user_id_idx" ON "forum_mentions" ("mentioned_user_id");
--> statement-breakpoint
CREATE INDEX "forum_mentions_ens_id_idx" ON "forum_mentions" ("mentioned_ens_identity_id");
--> statement-breakpoint

CREATE INDEX "forum_references_target_idx" ON "forum_references" ("target_type", "post_id", "comment_id");
--> statement-breakpoint
CREATE INDEX "forum_references_domain_idx" ON "forum_references" ("domain");
--> statement-breakpoint

CREATE INDEX "forum_reply_drafts_user_id_idx" ON "forum_reply_drafts" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "forum_reply_drafts_unique_context"
  ON "forum_reply_drafts" ("user_id", "post_id", "parent_comment_id");
--> statement-breakpoint

CREATE INDEX "forum_reports_status_idx" ON "forum_reports" ("status");
--> statement-breakpoint
CREATE INDEX "forum_reports_reporter_id_idx" ON "forum_reports" ("reporter_user_id");
--> statement-breakpoint
CREATE INDEX "forum_reports_target_idx"
  ON "forum_reports" ("target_type", "post_id", "comment_id", "reported_user_id");
--> statement-breakpoint

CREATE INDEX "forum_notifications_recipient_idx"
  ON "forum_notifications" ("recipient_user_id", "read_at", "created_at");
