import { randomUUID } from "node:crypto";

import { and, asc, eq, lte } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { backendEnv } from "../config/env";
import { HttpError } from "../lib/http-error";

export type WebhookEventRecord = typeof schema.ensWebhookEvents.$inferSelect;
type WebhookEventStatus = WebhookEventRecord["status"];

type ReserveWebhookEventInput = {
  intentId: string;
  eventType: string;
  dedupeKey: string;
  txHash?: string;
  payload: unknown;
};

type ReserveWebhookEventResult =
  | {
      state: "reserved";
      event: WebhookEventRecord;
    }
  | {
      state: "duplicate_processed";
      event: WebhookEventRecord;
    }
  | {
      state: "duplicate_processing";
      event: WebhookEventRecord;
    };

type ReserveRetryableWebhookEventsInput = {
  limit?: number;
};

const MAX_BATCH_LIMIT = 500;

const clampBatchLimit = (value: number | undefined, fallback: number): number => {
  if (!value || !Number.isInteger(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(value, MAX_BATCH_LIMIT));
};

const retryDelayMs = (attemptCount: number): number => {
  const baseDelay = backendEnv.webhookRetryBaseDelayMs;
  const exponent = Math.max(0, attemptCount - 1);
  const delay = baseDelay * 2 ** exponent;
  return Math.min(delay, backendEnv.webhookRetryMaxDelayMs);
};

const toPgErrorCode = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
};

const loadWebhookEventById = async (eventId: string): Promise<WebhookEventRecord> => {
  const [event] = await authDb
    .select()
    .from(schema.ensWebhookEvents)
    .where(eq(schema.ensWebhookEvents.id, eventId))
    .limit(1);

  if (!event) {
    throw new HttpError(500, "WEBHOOK_EVENT_NOT_FOUND", "Failed to load ENS webhook event");
  }

  return event;
};

export const getWebhookEventById = loadWebhookEventById;

const loadWebhookEventByDedupeKey = async (dedupeKey: string): Promise<WebhookEventRecord | null> => {
  const [event] = await authDb
    .select()
    .from(schema.ensWebhookEvents)
    .where(eq(schema.ensWebhookEvents.dedupeKey, dedupeKey))
    .limit(1);

  return event ?? null;
};

export const reserveWebhookEvent = async (input: ReserveWebhookEventInput): Promise<ReserveWebhookEventResult> => {
  const now = new Date();
  const eventId = randomUUID();

  try {
    await authDb.insert(schema.ensWebhookEvents).values({
      id: eventId,
      intentId: input.intentId,
      eventType: input.eventType,
      dedupeKey: input.dedupeKey,
      txHash: input.txHash,
      payload: input.payload,
      status: "processing",
      attemptCount: 1,
      nextRetryAt: null,
      deadLetteredAt: null,
      createdAt: now,
      updatedAt: now,
    });

    return {
      state: "reserved",
      event: await loadWebhookEventById(eventId),
    };
  } catch (error) {
    if (toPgErrorCode(error) !== "23505") {
      throw error;
    }
  }

  const existingEvent = await loadWebhookEventByDedupeKey(input.dedupeKey);
  if (!existingEvent) {
    throw new HttpError(500, "WEBHOOK_EVENT_LOOKUP_FAILED", "Failed to load duplicate ENS webhook event");
  }

  if (existingEvent.status === "processed") {
    return {
      state: "duplicate_processed",
      event: existingEvent,
    };
  }

  if (existingEvent.status === "processing") {
    return {
      state: "duplicate_processing",
      event: existingEvent,
    };
  }

  const retryNow = new Date();
  await authDb
    .update(schema.ensWebhookEvents)
    .set({
      status: "processing",
      attemptCount: existingEvent.attemptCount + 1,
      txHash: input.txHash ?? existingEvent.txHash,
      payload: input.payload,
      lastErrorCode: null,
      lastErrorMessage: null,
      nextRetryAt: null,
      deadLetteredAt: null,
      updatedAt: retryNow,
    })
    .where(eq(schema.ensWebhookEvents.id, existingEvent.id));

  return {
    state: "reserved",
    event: await loadWebhookEventById(existingEvent.id),
  };
};

export const reserveRetryableWebhookEvents = async (
  input: ReserveRetryableWebhookEventsInput = {}
): Promise<WebhookEventRecord[]> => {
  const limit = clampBatchLimit(input.limit, backendEnv.webhookRetryBatchLimit);
  const now = new Date();
  const candidates = await authDb
    .select()
    .from(schema.ensWebhookEvents)
    .where(
      and(
        eq(schema.ensWebhookEvents.status, "failed"),
        lte(schema.ensWebhookEvents.nextRetryAt, now)
      )
    )
    .orderBy(asc(schema.ensWebhookEvents.nextRetryAt), asc(schema.ensWebhookEvents.createdAt))
    .limit(limit);

  const reservedEvents: WebhookEventRecord[] = [];

  for (const candidate of candidates) {
    const [reservedRow] = await authDb
      .update(schema.ensWebhookEvents)
      .set({
        status: "processing",
        attemptCount: candidate.attemptCount + 1,
        nextRetryAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.ensWebhookEvents.id, candidate.id),
          eq(schema.ensWebhookEvents.status, "failed")
        )
      )
      .returning({ id: schema.ensWebhookEvents.id });

    if (!reservedRow) {
      continue;
    }

    reservedEvents.push(await loadWebhookEventById(candidate.id));
  }

  return reservedEvents;
};

export const markWebhookEventProcessed = async (input: { webhookEventId: string; result: unknown }): Promise<void> => {
  const now = new Date();
  await authDb
    .update(schema.ensWebhookEvents)
    .set({
      status: "processed",
      result: input.result,
      processedAt: now,
      lastErrorCode: null,
      lastErrorMessage: null,
      nextRetryAt: null,
      deadLetteredAt: null,
      updatedAt: now,
    })
    .where(eq(schema.ensWebhookEvents.id, input.webhookEventId));
};

export const markWebhookEventFailed = async (input: {
  webhookEventId: string;
  code: string;
  message: string;
}): Promise<WebhookEventRecord> => {
  const event = await loadWebhookEventById(input.webhookEventId);
  const now = new Date();
  const shouldMoveToDeadLetter = event.attemptCount >= backendEnv.webhookRetryMaxAttempts;
  const nextStatus: WebhookEventStatus = shouldMoveToDeadLetter ? "dead_letter" : "failed";
  const nextRetryAt = shouldMoveToDeadLetter
    ? null
    : new Date(now.getTime() + retryDelayMs(event.attemptCount));

  await authDb
    .update(schema.ensWebhookEvents)
    .set({
      status: nextStatus,
      lastErrorCode: input.code,
      lastErrorMessage: input.message,
      nextRetryAt,
      deadLetteredAt: shouldMoveToDeadLetter ? now : null,
      updatedAt: now,
    })
    .where(eq(schema.ensWebhookEvents.id, input.webhookEventId));

  return loadWebhookEventById(input.webhookEventId);
};
