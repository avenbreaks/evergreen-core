CREATE TABLE "internal_ops_throttle" (
  "operation" varchar(120) PRIMARY KEY NOT NULL,
  "next_allowed_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "internal_ops_throttle_next_allowed_at_idx" ON "internal_ops_throttle" ("next_allowed_at");
