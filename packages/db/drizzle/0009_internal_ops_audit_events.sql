CREATE TABLE "internal_ops_audit_events" (
  "id" text PRIMARY KEY NOT NULL,
  "operation" varchar(120) NOT NULL,
  "outcome" varchar(24) NOT NULL,
  "actor" varchar(120),
  "request_method" varchar(16),
  "request_path" varchar(255),
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "result" jsonb,
  "error_code" varchar(64),
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "internal_ops_audit_events_operation_idx" ON "internal_ops_audit_events" ("operation", "created_at");
--> statement-breakpoint
CREATE INDEX "internal_ops_audit_events_created_at_idx" ON "internal_ops_audit_events" ("created_at");
