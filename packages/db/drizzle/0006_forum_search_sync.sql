CREATE TYPE "forum_search_sync_target_type" AS ENUM('post', 'comment');
--> statement-breakpoint
CREATE TYPE "forum_search_sync_operation" AS ENUM('upsert', 'delete');
--> statement-breakpoint
CREATE TYPE "forum_search_sync_status" AS ENUM('pending', 'processing', 'failed', 'dead_letter');
--> statement-breakpoint

CREATE TABLE "forum_search_sync_queue" (
  "id" text PRIMARY KEY NOT NULL,
  "target_type" "forum_search_sync_target_type" NOT NULL,
  "target_id" text NOT NULL,
  "operation" "forum_search_sync_operation" DEFAULT 'upsert' NOT NULL,
  "status" "forum_search_sync_status" DEFAULT 'pending' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_retry_at" timestamp with time zone,
  "last_error_code" varchar(64),
  "last_error_message" text,
  "processed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX "forum_search_sync_target_unique" ON "forum_search_sync_queue" ("target_type", "target_id");
--> statement-breakpoint
CREATE INDEX "forum_search_sync_status_retry_idx" ON "forum_search_sync_queue" ("status", "next_retry_at");
