import { randomUUID } from "node:crypto";

import { desc, inArray } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

export type InternalOpsAuditOutcome = "completed" | "failed";

export type InternalOpsAuditEvent = typeof schema.internalOpsAuditEvents.$inferSelect;

type RecordInternalOpsAuditEventInput = {
  operation: string;
  outcome: InternalOpsAuditOutcome;
  actor?: string | null;
  requestMethod?: string | null;
  requestPath?: string | null;
  payload?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

type ListInternalOpsAuditEventsInput = {
  operations?: string[];
  limit?: number;
};

const clampLimit = (value: number | undefined): number => {
  if (!value || !Number.isInteger(value)) {
    return 100;
  }

  return Math.max(1, Math.min(value, 1000));
};

const sanitize = (value: string | null | undefined): string | null => {
  const next = value?.trim();
  return next ? next : null;
};

export const recordInternalOpsAuditEvent = async (input: RecordInternalOpsAuditEventInput): Promise<string> => {
  const id = randomUUID();
  await authDb.insert(schema.internalOpsAuditEvents).values({
    id,
    operation: input.operation,
    outcome: input.outcome,
    actor: sanitize(input.actor),
    requestMethod: sanitize(input.requestMethod),
    requestPath: sanitize(input.requestPath),
    payload: input.payload ?? {},
    result: input.result ?? null,
    errorCode: sanitize(input.errorCode),
    errorMessage: sanitize(input.errorMessage),
    createdAt: new Date(),
  });

  return id;
};

export const listInternalOpsAuditEvents = async (input: ListInternalOpsAuditEventsInput = {}): Promise<InternalOpsAuditEvent[]> => {
  const operations = [...new Set((input.operations ?? []).map((value) => value.trim()).filter(Boolean))];

  return authDb
    .select()
    .from(schema.internalOpsAuditEvents)
    .where(operations.length > 0 ? inArray(schema.internalOpsAuditEvents.operation, operations) : undefined)
    .orderBy(desc(schema.internalOpsAuditEvents.createdAt))
    .limit(clampLimit(input.limit));
};
