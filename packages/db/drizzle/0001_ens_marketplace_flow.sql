CREATE TYPE "ens_purchase_intent_status" AS ENUM(
  'prepared',
  'committed',
  'registerable',
  'registered',
  'expired',
  'failed',
  'cancelled'
);
--> statement-breakpoint

ALTER TABLE "ens_identities"
  ADD COLUMN "tld" varchar(64) DEFAULT 'dev',
  ADD COLUMN "controller_address" varchar(42),
  ADD COLUMN "base_registrar_address" varchar(42),
  ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL,
  ADD COLUMN "commitment_id" text,
  ADD COLUMN "expires_at" timestamp with time zone,
  ADD COLUMN "registered_at" timestamp with time zone;
--> statement-breakpoint

UPDATE "ens_identities"
SET "tld" = split_part("name", '.', 2)
WHERE "tld" IS NULL;
--> statement-breakpoint

ALTER TABLE "ens_identities"
  ALTER COLUMN "tld" SET NOT NULL;
--> statement-breakpoint

DROP INDEX IF EXISTS "ens_identities_user_unique";
--> statement-breakpoint

CREATE INDEX "ens_identities_user_id_idx" ON "ens_identities" ("user_id");
--> statement-breakpoint
CREATE INDEX "ens_identities_user_primary_idx" ON "ens_identities" ("user_id", "is_primary");
--> statement-breakpoint
CREATE UNIQUE INDEX "ens_identities_user_domain_unique" ON "ens_identities" ("user_id", "name");
--> statement-breakpoint

CREATE TABLE "ens_purchase_intents" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "chain_id" integer NOT NULL,
  "wallet_address" varchar(42) NOT NULL,
  "tld" varchar(64) NOT NULL,
  "label" varchar(255) NOT NULL,
  "domain_name" varchar(255) NOT NULL,
  "duration_seconds" integer NOT NULL,
  "resolver_address" varchar(42) NOT NULL,
  "controller_address" varchar(42) NOT NULL,
  "base_registrar_address" varchar(42) NOT NULL,
  "secret_hash" varchar(66) NOT NULL,
  "commitment" varchar(66) NOT NULL,
  "register_value_wei" text,
  "commit_tx_hash" varchar(66),
  "register_tx_hash" varchar(66),
  "min_commitment_age_seconds" integer NOT NULL,
  "max_commitment_age_seconds" integer NOT NULL,
  "committed_at" timestamp with time zone,
  "registerable_at" timestamp with time zone,
  "register_by" timestamp with time zone,
  "status" "ens_purchase_intent_status" DEFAULT 'prepared' NOT NULL,
  "failure_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ens_purchase_intents_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint

CREATE INDEX "ens_purchase_intents_user_id_idx" ON "ens_purchase_intents" ("user_id");
--> statement-breakpoint
CREATE INDEX "ens_purchase_intents_status_idx" ON "ens_purchase_intents" ("status");
--> statement-breakpoint
CREATE INDEX "ens_purchase_intents_domain_idx" ON "ens_purchase_intents" ("chain_id", "tld", "label");
--> statement-breakpoint
CREATE UNIQUE INDEX "ens_purchase_intents_commitment_unique" ON "ens_purchase_intents" ("commitment");
--> statement-breakpoint
CREATE UNIQUE INDEX "ens_purchase_intents_commit_tx_hash_unique" ON "ens_purchase_intents" ("commit_tx_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "ens_purchase_intents_register_tx_hash_unique" ON "ens_purchase_intents" ("register_tx_hash");
--> statement-breakpoint

ALTER TABLE "ens_identities"
  ADD CONSTRAINT "ens_identities_commitment_id_ens_purchase_intents_id_fk"
  FOREIGN KEY ("commitment_id") REFERENCES "ens_purchase_intents"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
