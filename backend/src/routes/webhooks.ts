import type { FastifyPluginAsync } from "fastify";

import { HttpError } from "../lib/http-error";
import { createDebounceMiddleware, hashDebouncePayload } from "../middleware/debounce-limit";
import { requireSecureTransportMiddleware } from "../middleware/require-secure-transport";
import { verifyWebhookSignatureMiddleware } from "../middleware/webhook-auth";
import {
  ensWebhookPayloadSchema,
  processEnsWebhookPayload,
  type EnsWebhookPayload,
} from "../services/ens-webhook-processor";

type WebhookRouteDependencies = {
  reserveWebhookEvent: (input: {
    intentId: string;
    eventType: string;
    dedupeKey: string;
    txHash?: string;
    payload: unknown;
  }) => Promise<
    | {
        state: "reserved";
        event: { id: string; result?: unknown };
      }
    | {
        state: "duplicate_processed";
        event: { id: string; result?: unknown };
      }
    | {
        state: "duplicate_processing";
        event: { id: string; result?: unknown };
      }
  >;
  markWebhookEventProcessed: (input: { webhookEventId: string; result: unknown }) => Promise<void>;
  markWebhookEventFailed: (input: {
    webhookEventId: string;
    code: string;
    message: string;
  }) => Promise<unknown>;
  confirmCommitmentIntentByIntentId: (input: { intentId: string; txHash: string }) => Promise<{ intent: unknown }>;
  confirmRegisterTransactionByIntentId: (input: {
    intentId: string;
    txHash: string;
    setPrimary?: boolean;
  }) => Promise<{ domain: unknown; registerTxHash: string }>;
  markPurchaseIntentFailed: (input: {
    intentId: string;
    reason: string;
    txHash?: string;
  }) => Promise<unknown>;
};

type WebhookRoutesOptions = {
  deps?: Partial<WebhookRouteDependencies>;
  disableDebounce?: boolean;
};

type WebhookPayload = EnsWebhookPayload;

const getPayloadTxHash = (payload: WebhookPayload): string | undefined => {
  if (!("txHash" in payload.data) || !payload.data.txHash) {
    return undefined;
  }

  return payload.data.txHash.toLowerCase();
};

const buildWebhookDedupeKey = (payload: WebhookPayload): string => {
  const txHash = getPayloadTxHash(payload) ?? "none";
  return `${payload.event}:${payload.data.intentId}:${txHash}:${hashDebouncePayload(payload)}`;
};

const buildWebhookLogContext = (payload: WebhookPayload, webhookEventId?: string) => ({
  eventType: payload.event,
  intentId: payload.data.intentId,
  txHash: getPayloadTxHash(payload) ?? null,
  webhookEventId,
});

const resolveErrorDetails = (error: unknown): { code: string; message: string } => {
  if (error instanceof HttpError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      code: "UNHANDLED_WEBHOOK_ERROR",
      message: error.message,
    };
  }

  return {
    code: "UNHANDLED_WEBHOOK_ERROR",
    message: "Unknown webhook processing error",
  };
};

const debounceWebhookEvent = createDebounceMiddleware({
  namespace: "webhook.ens.tx",
  windowMs: 800,
  key: (request) => {
    const parsed = ensWebhookPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return `${request.ip}:invalid`;
    }

    return hashDebouncePayload({
      event: parsed.data.event,
      intentId: parsed.data.data.intentId,
      txHash: "txHash" in parsed.data.data ? parsed.data.data.txHash : undefined,
    });
  },
});

const hasCompleteDependencies = (
  deps: Partial<WebhookRouteDependencies> | undefined
): deps is WebhookRouteDependencies => {
  if (!deps) {
    return false;
  }

  return (
    typeof deps.reserveWebhookEvent === "function" &&
    typeof deps.markWebhookEventProcessed === "function" &&
    typeof deps.markWebhookEventFailed === "function" &&
    typeof deps.confirmCommitmentIntentByIntentId === "function" &&
    typeof deps.confirmRegisterTransactionByIntentId === "function" &&
    typeof deps.markPurchaseIntentFailed === "function"
  );
};

const loadDefaultDependencies = async (): Promise<WebhookRouteDependencies> => {
  const [webhookEventsService, ensMarketplaceService] = await Promise.all([
    import("../services/ens-webhook-events"),
    import("../services/ens-marketplace"),
  ]);

  return {
    reserveWebhookEvent: webhookEventsService.reserveWebhookEvent,
    markWebhookEventProcessed: webhookEventsService.markWebhookEventProcessed,
    markWebhookEventFailed: webhookEventsService.markWebhookEventFailed,
    confirmCommitmentIntentByIntentId: ensMarketplaceService.confirmCommitmentIntentByIntentId,
    confirmRegisterTransactionByIntentId: ensMarketplaceService.confirmRegisterTransactionByIntentId,
    markPurchaseIntentFailed: ensMarketplaceService.markPurchaseIntentFailed,
  };
};

export const webhookRoutes: FastifyPluginAsync<WebhookRoutesOptions> = async (app, options) => {
  const deps = hasCompleteDependencies(options.deps)
    ? options.deps
    : {
        ...(await loadDefaultDependencies()),
        ...(options.deps ?? {}),
      };

  app.post(
    "/api/webhooks/ens/tx",
    {
      preHandler: options.disableDebounce
        ? [requireSecureTransportMiddleware, verifyWebhookSignatureMiddleware]
        : [requireSecureTransportMiddleware, verifyWebhookSignatureMiddleware, debounceWebhookEvent],
    },
    async (request) => {
      const payload = ensWebhookPayloadSchema.parse(request.body);
      const reservation = await deps.reserveWebhookEvent({
        intentId: payload.data.intentId,
        eventType: payload.event,
        dedupeKey: buildWebhookDedupeKey(payload),
        txHash: getPayloadTxHash(payload),
        payload,
      });
      const logContext = buildWebhookLogContext(payload, reservation.event.id);

      if (reservation.state === "duplicate_processed") {
        const response = {
          acknowledged: true,
          deduplicated: true,
          event: payload.event,
          intentId: payload.data.intentId,
          outcome: reservation.event.result ?? null,
        };

        request.log.info(logContext, "ENS webhook deduplicated using processed event record");
        return response;
      }

      if (reservation.state === "duplicate_processing") {
        const response = {
          acknowledged: true,
          deduplicated: true,
          event: payload.event,
          intentId: payload.data.intentId,
          processing: true,
        };

        request.log.info(logContext, "ENS webhook deduplicated while existing event is processing");
        return response;
      }

      try {
        const response = await processEnsWebhookPayload(payload, {
          confirmCommitmentIntentByIntentId: deps.confirmCommitmentIntentByIntentId,
          confirmRegisterTransactionByIntentId: deps.confirmRegisterTransactionByIntentId,
          markPurchaseIntentFailed: deps.markPurchaseIntentFailed,
        });

        await deps.markWebhookEventProcessed({
          webhookEventId: reservation.event.id,
          result: response,
        });

        request.log.info(logContext, "ENS webhook processed successfully");
        return response;
      } catch (error) {
        const details = resolveErrorDetails(error);
        request.log.error(
          {
            err: error,
            ...logContext,
            errorCode: details.code,
          },
          "ENS webhook processing failed"
        );

        try {
          await deps.markWebhookEventFailed({
            webhookEventId: reservation.event.id,
            code: details.code,
            message: details.message,
          });
        } catch (persistError) {
          request.log.error(
            {
              err: persistError,
              webhookEventId: reservation.event.id,
            },
            "Failed to persist webhook failure state"
          );
        }

        throw error;
      }
    }
  );
};
