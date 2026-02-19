CREATE TYPE "ens_webhook_event_status" AS ENUM('processing', 'processed', 'failed');
--> statement-breakpoint

CREATE TABLE "ens_webhook_events" (
  "id" text PRIMARY KEY NOT NULL,
  "intent_id" text NOT NULL,
  "event_type" varchar(64) NOT NULL,
  "dedupe_key" varchar(255) NOT NULL,
  "tx_hash" varchar(66),
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "result" jsonb,
  "status" "ens_webhook_event_status" DEFAULT 'processing' NOT NULL,
  "attempt_count" integer DEFAULT 1 NOT NULL,
  "last_error_code" varchar(64),
  "last_error_message" text,
  "processed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ens_webhook_events_intent_id_ens_purchase_intents_id_fk"
    FOREIGN KEY ("intent_id") REFERENCES "ens_purchase_intents"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint

CREATE INDEX "ens_webhook_events_intent_id_idx" ON "ens_webhook_events" ("intent_id");
--> statement-breakpoint
CREATE INDEX "ens_webhook_events_status_idx" ON "ens_webhook_events" ("status");
--> statement-breakpoint
CREATE INDEX "ens_webhook_events_tx_hash_idx" ON "ens_webhook_events" ("tx_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "ens_webhook_events_dedupe_key_unique" ON "ens_webhook_events" ("dedupe_key");
