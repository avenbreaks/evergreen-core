import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { HttpError } from "../lib/http-error";

type WebhookEventRecord = typeof schema.ensWebhookEvents.$inferSelect;

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
      updatedAt: retryNow,
    })
    .where(eq(schema.ensWebhookEvents.id, existingEvent.id));

  return {
    state: "reserved",
    event: await loadWebhookEventById(existingEvent.id),
  };
};

export const markWebhookEventProcessed = async (input: { webhookEventId: string; result: unknown }): Promise<void> => {
  await authDb
    .update(schema.ensWebhookEvents)
    .set({
      status: "processed",
      result: input.result,
      processedAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.ensWebhookEvents.id, input.webhookEventId));
};

export const markWebhookEventFailed = async (input: {
  webhookEventId: string;
  code: string;
  message: string;
}): Promise<void> => {
  await authDb
    .update(schema.ensWebhookEvents)
    .set({
      status: "failed",
      lastErrorCode: input.code,
      lastErrorMessage: input.message,
      updatedAt: new Date(),
    })
    .where(eq(schema.ensWebhookEvents.id, input.webhookEventId));
};
