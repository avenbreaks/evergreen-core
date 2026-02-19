CREATE TYPE "ens_status" AS ENUM('pending', 'active', 'failed', 'revoked');
--> statement-breakpoint
CREATE TYPE "user_role" AS ENUM('user', 'moderator', 'admin');
--> statement-breakpoint
CREATE TYPE "user_status" AS ENUM('active', 'suspended', 'deleted');
--> statement-breakpoint

CREATE TABLE "users" (
  "id" text PRIMARY KEY NOT NULL,
  "email" varchar(320) NOT NULL,
  "email_verified" boolean DEFAULT false NOT NULL,
  "name" varchar(120) NOT NULL,
  "username" varchar(32),
  "image" text,
  "role" "user_role" DEFAULT 'user' NOT NULL,
  "status" "user_status" DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone
);
--> statement-breakpoint

CREATE TABLE "profiles" (
  "user_id" text PRIMARY KEY NOT NULL,
  "display_name" varchar(120),
  "headline" varchar(160),
  "bio" text,
  "location" varchar(120),
  "website_url" text,
  "github_username" varchar(80),
  "skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint

CREATE TABLE "wallets" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "chain_id" integer NOT NULL,
  "address" varchar(42) NOT NULL,
  "wallet_type" varchar(24) DEFAULT 'evm' NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "verified_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint

CREATE TABLE "ens_identities" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "chain_id" integer NOT NULL,
  "name" varchar(255) NOT NULL,
  "label" varchar(255) NOT NULL,
  "node" varchar(66),
  "resolver_address" varchar(42),
  "owner_address" varchar(42),
  "tx_hash" varchar(66),
  "status" "ens_status" DEFAULT 'pending' NOT NULL,
  "claimed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ens_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint

CREATE TABLE "auth_accounts" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "account_id" varchar(255) NOT NULL,
  "provider_id" varchar(50) NOT NULL,
  "password" text,
  "access_token" text,
  "refresh_token" text,
  "refresh_token_expires_at" timestamp with time zone,
  "id_token" text,
  "scope" text,
  "token_type" varchar(64),
  "access_token_expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "auth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint

CREATE TABLE "auth_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "token" text NOT NULL,
  "ip_address" varchar(64),
  "user_agent" text,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint

CREATE TABLE "auth_verifications" (
  "id" text PRIMARY KEY NOT NULL,
  "identifier" varchar(320) NOT NULL,
  "value" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "siwe_nonces" (
  "id" text PRIMARY KEY NOT NULL,
  "nonce" varchar(96) NOT NULL,
  "wallet_address" varchar(42) NOT NULL,
  "chain_id" integer NOT NULL,
  "domain" varchar(255) NOT NULL,
  "uri" text NOT NULL,
  "statement" text,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email");
--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" ("username");
--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" ("status");
--> statement-breakpoint

CREATE INDEX "wallets_user_id_idx" ON "wallets" ("user_id");
--> statement-breakpoint
CREATE INDEX "wallets_user_primary_idx" ON "wallets" ("user_id", "is_primary");
--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_chain_address_unique" ON "wallets" ("chain_id", "address");
--> statement-breakpoint

CREATE UNIQUE INDEX "ens_identities_user_unique" ON "ens_identities" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ens_identities_name_unique" ON "ens_identities" ("name");
--> statement-breakpoint
CREATE INDEX "ens_identities_status_idx" ON "ens_identities" ("status");
--> statement-breakpoint
CREATE INDEX "ens_identities_chain_id_idx" ON "ens_identities" ("chain_id");
--> statement-breakpoint

CREATE INDEX "auth_accounts_user_id_idx" ON "auth_accounts" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "auth_accounts_provider_unique" ON "auth_accounts" ("provider_id", "account_id");
--> statement-breakpoint

CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_unique" ON "auth_sessions" ("token");
--> statement-breakpoint
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions" ("expires_at");
--> statement-breakpoint

CREATE UNIQUE INDEX "auth_verifications_unique_value" ON "auth_verifications" ("identifier", "value");
--> statement-breakpoint
CREATE INDEX "auth_verifications_expires_at_idx" ON "auth_verifications" ("expires_at");
--> statement-breakpoint

CREATE UNIQUE INDEX "siwe_nonces_nonce_unique" ON "siwe_nonces" ("nonce");
--> statement-breakpoint
CREATE INDEX "siwe_nonces_wallet_idx" ON "siwe_nonces" ("wallet_address");
--> statement-breakpoint
CREATE INDEX "siwe_nonces_expires_at_idx" ON "siwe_nonces" ("expires_at");
