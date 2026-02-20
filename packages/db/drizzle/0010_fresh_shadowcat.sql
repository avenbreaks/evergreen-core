CREATE TYPE "public"."api_key_audit_event_type" AS ENUM(
  'created',
  'rotated',
  'revoked',
  'authenticated',
  'auth_failed',
  'signature_failed',
  'throttled',
  'blocked'
);
--> statement-breakpoint
CREATE TYPE "public"."api_key_audit_outcome" AS ENUM('success', 'failure');
--> statement-breakpoint
CREATE TYPE "public"."api_key_environment" AS ENUM('live', 'test');
--> statement-breakpoint
CREATE TYPE "public"."api_key_policy_action" AS ENUM('allow', 'throttle', 'block');
--> statement-breakpoint
CREATE TYPE "public"."api_key_risk_level" AS ENUM('low', 'medium', 'high');
--> statement-breakpoint
CREATE TYPE "public"."api_key_status" AS ENUM('active', 'rotated', 'revoked', 'blocked');
--> statement-breakpoint
CREATE TABLE "api_keys" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "environment" "api_key_environment" DEFAULT 'live' NOT NULL,
  "name" varchar(120) NOT NULL,
  "prefix" varchar(32) NOT NULL,
  "secret_hash" text NOT NULL,
  "secret_hint" varchar(16) NOT NULL,
  "scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" "api_key_status" DEFAULT 'active' NOT NULL,
  "risk_level" "api_key_risk_level" DEFAULT 'low' NOT NULL,
  "risk_score" integer DEFAULT 0 NOT NULL,
  "risk_last_evaluated_at" timestamp with time zone,
  "rate_limit_per_minute" integer DEFAULT 120 NOT NULL,
  "rate_limit_per_ip_minute" integer DEFAULT 60 NOT NULL,
  "concurrency_limit" integer DEFAULT 8 NOT NULL,
  "failed_auth_streak" integer DEFAULT 0 NOT NULL,
  "last_failed_auth_at" timestamp with time zone,
  "blocked_until" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "grace_expires_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "usage_count" integer DEFAULT 0 NOT NULL,
  "rotated_from_key_id" text,
  "revoked_at" timestamp with time zone,
  "revoked_reason" text,
  "created_by_user_id" text,
  "created_from_ip" varchar(64),
  "created_from_ua" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_key_audit_events" (
  "id" text PRIMARY KEY NOT NULL,
  "key_id" text,
  "user_id" text,
  "event_type" "api_key_audit_event_type" NOT NULL,
  "outcome" "api_key_audit_outcome" NOT NULL,
  "policy_action" "api_key_policy_action" DEFAULT 'allow' NOT NULL,
  "scope" varchar(120),
  "risk_level" "api_key_risk_level" DEFAULT 'low' NOT NULL,
  "risk_score" integer DEFAULT 0 NOT NULL,
  "ip_address" varchar(64),
  "user_agent" text,
  "request_method" varchar(16),
  "request_path" varchar(255),
  "status_code" integer,
  "reason_code" varchar(64),
  "reason" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_key_request_nonces" (
  "key_id" text NOT NULL,
  "nonce" varchar(120) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "api_key_request_nonces_pk" PRIMARY KEY("key_id","nonce")
);
--> statement-breakpoint
ALTER TABLE "api_keys"
  ADD CONSTRAINT "api_keys_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api_keys"
  ADD CONSTRAINT "api_keys_rotated_from_key_id_api_keys_id_fk"
  FOREIGN KEY ("rotated_from_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api_keys"
  ADD CONSTRAINT "api_keys_created_by_user_id_users_id_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api_key_audit_events"
  ADD CONSTRAINT "api_key_audit_events_key_id_api_keys_id_fk"
  FOREIGN KEY ("key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api_key_audit_events"
  ADD CONSTRAINT "api_key_audit_events_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api_key_request_nonces"
  ADD CONSTRAINT "api_key_request_nonces_key_id_api_keys_id_fk"
  FOREIGN KEY ("key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "api_keys_user_created_idx" ON "api_keys" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX "api_keys_status_idx" ON "api_keys" USING btree ("status", "blocked_until", "expires_at");
--> statement-breakpoint
CREATE INDEX "api_keys_user_last_used_idx" ON "api_keys" USING btree ("user_id", "last_used_at");
--> statement-breakpoint
CREATE INDEX "api_keys_rotated_from_idx" ON "api_keys" USING btree ("rotated_from_key_id");
--> statement-breakpoint
CREATE INDEX "api_keys_created_by_idx" ON "api_keys" USING btree ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX "api_key_audit_events_key_created_idx" ON "api_key_audit_events" USING btree ("key_id", "created_at");
--> statement-breakpoint
CREATE INDEX "api_key_audit_events_user_created_idx" ON "api_key_audit_events" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX "api_key_audit_events_event_created_idx" ON "api_key_audit_events" USING btree ("event_type", "created_at");
--> statement-breakpoint
CREATE INDEX "api_key_audit_events_created_idx" ON "api_key_audit_events" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "api_key_request_nonces_expires_idx" ON "api_key_request_nonces" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "api_key_request_nonces_key_expires_idx" ON "api_key_request_nonces" USING btree ("key_id", "expires_at");
