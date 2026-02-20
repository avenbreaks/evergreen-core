CREATE TABLE "internal_worker_controls" (
  "worker" varchar(120) PRIMARY KEY NOT NULL,
  "is_paused" boolean DEFAULT false NOT NULL,
  "pause_reason" text,
  "paused_by" varchar(120),
  "paused_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "internal_worker_controls_paused_idx" ON "internal_worker_controls" ("worker", "is_paused");
