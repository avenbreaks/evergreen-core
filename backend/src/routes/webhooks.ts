import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { HttpError } from "../lib/http-error";
import { createDebounceMiddleware, hashDebouncePayload } from "../middleware/debounce-limit";
import { verifyWebhookSecretMiddleware } from "../middleware/webhook-auth";
import { markWebhookEventFailed, markWebhookEventProcessed, reserveWebhookEvent } from "../services/ens-webhook-events";
import {
  confirmCommitmentIntentByIntentId,
  confirmRegisterTransactionByIntentId,
  markPurchaseIntentFailed,
} from "../services/ens-marketplace";

const txHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);

const webhookPayloadSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("ens.commit.confirmed"),
    data: z.object({
      intentId: z.string().uuid(),
      txHash: txHashSchema,
    }),
  }),
  z.object({
    event: z.literal("ens.register.confirmed"),
    data: z.object({
      intentId: z.string().uuid(),
      txHash: txHashSchema,
      setPrimary: z.boolean().optional(),
    }),
  }),
  z.object({
    event: z.literal("ens.register.failed"),
    data: z.object({
      intentId: z.string().uuid(),
      txHash: txHashSchema.optional(),
      reason: z.string().min(1).max(500),
    }),
  }),
]);

type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

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
    const parsed = webhookPayloadSchema.safeParse(request.body);
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

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/api/webhooks/ens/tx",
    {
      preHandler: [verifyWebhookSecretMiddleware, debounceWebhookEvent],
    },
    async (request) => {
      const payload = webhookPayloadSchema.parse(request.body);
      const reservation = await reserveWebhookEvent({
        intentId: payload.data.intentId,
        eventType: payload.event,
        dedupeKey: buildWebhookDedupeKey(payload),
        txHash: getPayloadTxHash(payload),
        payload,
      });

      if (reservation.state === "duplicate_processed") {
        return {
          acknowledged: true,
          deduplicated: true,
          event: payload.event,
          intentId: payload.data.intentId,
          outcome: reservation.event.result ?? null,
        };
      }

      if (reservation.state === "duplicate_processing") {
        return {
          acknowledged: true,
          deduplicated: true,
          event: payload.event,
          intentId: payload.data.intentId,
          processing: true,
        };
      }

      try {
        if (payload.event === "ens.commit.confirmed") {
          const result = await confirmCommitmentIntentByIntentId({
            intentId: payload.data.intentId,
            txHash: payload.data.txHash,
          });

          const response = {
            acknowledged: true,
            event: payload.event,
            intent: result.intent,
          };

          await markWebhookEventProcessed({
            webhookEventId: reservation.event.id,
            result: response,
          });

          return response;
        }

        if (payload.event === "ens.register.confirmed") {
          const result = await confirmRegisterTransactionByIntentId({
            intentId: payload.data.intentId,
            txHash: payload.data.txHash,
            setPrimary: payload.data.setPrimary,
          });

          const response = {
            acknowledged: true,
            event: payload.event,
            domain: result.domain,
            registerTxHash: result.registerTxHash,
          };

          await markWebhookEventProcessed({
            webhookEventId: reservation.event.id,
            result: response,
          });

          return response;
        }

        const intent = await markPurchaseIntentFailed({
          intentId: payload.data.intentId,
          txHash: payload.data.txHash,
          reason: payload.data.reason,
        });

        const response = {
          acknowledged: true,
          event: payload.event,
          intent,
        };

        await markWebhookEventProcessed({
          webhookEventId: reservation.event.id,
          result: response,
        });

        return response;
      } catch (error) {
        const details = resolveErrorDetails(error);

        try {
          await markWebhookEventFailed({
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
