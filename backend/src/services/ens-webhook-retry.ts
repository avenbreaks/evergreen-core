import { backendEnv } from "../config/env";
import { HttpError } from "../lib/http-error";
import {
  ensWebhookPayloadSchema,
  loadDefaultEnsWebhookProcessorDependencies,
  processEnsWebhookPayload,
} from "./ens-webhook-processor";
import {
  markWebhookEventFailed,
  markWebhookEventProcessed,
  reserveRetryableWebhookEvents,
} from "./ens-webhook-events";

type RetryWebhookEventsInput = {
  limit?: number;
};

type RetryWebhookEventsError = {
  webhookEventId: string;
  intentId: string;
  eventType: string;
  code: string;
  message: string;
};

export type RetryWebhookEventsResult = {
  scanned: number;
  processed: number;
  failed: number;
  deadLettered: number;
  startedAt: Date;
  finishedAt: Date;
  errors: RetryWebhookEventsError[];
};

const clampLimit = (value: number | undefined): number => {
  if (!value || !Number.isInteger(value)) {
    return backendEnv.webhookRetryBatchLimit;
  }

  return Math.max(1, Math.min(value, 500));
};

const toErrorDetails = (error: unknown): { code: string; message: string } => {
  if (error instanceof HttpError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      code: "WEBHOOK_RETRY_UNHANDLED_ERROR",
      message: error.message,
    };
  }

  return {
    code: "WEBHOOK_RETRY_UNHANDLED_ERROR",
    message: "Unknown webhook retry error",
  };
};

const pushError = (errors: RetryWebhookEventsError[], error: RetryWebhookEventsError): void => {
  if (errors.length >= 100) {
    return;
  }

  errors.push(error);
};

export const retryFailedWebhookEvents = async (
  input: RetryWebhookEventsInput = {}
): Promise<RetryWebhookEventsResult> => {
  const startedAt = new Date();
  const limit = clampLimit(input.limit);
  const retryCandidates = await reserveRetryableWebhookEvents({
    limit,
  });
  const processingDeps = await loadDefaultEnsWebhookProcessorDependencies();

  const errors: RetryWebhookEventsError[] = [];
  let processed = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const event of retryCandidates) {
    const parsedPayload = ensWebhookPayloadSchema.safeParse(event.payload);
    if (!parsedPayload.success) {
      const updatedEvent = await markWebhookEventFailed({
        webhookEventId: event.id,
        code: "INVALID_WEBHOOK_PAYLOAD",
        message: "Stored webhook payload no longer matches schema",
      });

      pushError(errors, {
        webhookEventId: event.id,
        intentId: event.intentId,
        eventType: event.eventType,
        code: "INVALID_WEBHOOK_PAYLOAD",
        message: "Stored webhook payload no longer matches schema",
      });

      if (updatedEvent.status === "dead_letter") {
        deadLettered += 1;
      } else {
        failed += 1;
      }
      continue;
    }

    try {
      const response = await processEnsWebhookPayload(parsedPayload.data, processingDeps);
      await markWebhookEventProcessed({
        webhookEventId: event.id,
        result: response,
      });
      processed += 1;
    } catch (error) {
      const details = toErrorDetails(error);
      const updatedEvent = await markWebhookEventFailed({
        webhookEventId: event.id,
        code: details.code,
        message: details.message,
      });

      pushError(errors, {
        webhookEventId: event.id,
        intentId: event.intentId,
        eventType: event.eventType,
        code: details.code,
        message: details.message,
      });

      if (updatedEvent.status === "dead_letter") {
        deadLettered += 1;
      } else {
        failed += 1;
      }
    }
  }

  return {
    scanned: retryCandidates.length,
    processed,
    failed,
    deadLettered,
    startedAt,
    finishedAt: new Date(),
    errors,
  };
};
