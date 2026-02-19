CREATE INDEX IF NOT EXISTS "ens_webhook_events_processed_at_idx"
  ON "ens_webhook_events" ("status", "processed_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ens_webhook_events_dead_lettered_at_idx"
  ON "ens_webhook_events" ("status", "dead_lettered_at");
