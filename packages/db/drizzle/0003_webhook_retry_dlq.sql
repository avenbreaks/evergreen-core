ALTER TYPE "ens_webhook_event_status" ADD VALUE IF NOT EXISTS 'dead_letter';
--> statement-breakpoint

ALTER TABLE "ens_webhook_events"
  ADD COLUMN IF NOT EXISTS "next_retry_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "dead_lettered_at" timestamp with time zone;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ens_webhook_events_retry_idx"
  ON "ens_webhook_events" ("status", "next_retry_at");
