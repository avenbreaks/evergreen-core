import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createDebounceMiddleware, hashDebouncePayload } from "../middleware/debounce-limit";
import { verifyWebhookSecretMiddleware } from "../middleware/webhook-auth";
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

      if (payload.event === "ens.commit.confirmed") {
        const result = await confirmCommitmentIntentByIntentId({
          intentId: payload.data.intentId,
          txHash: payload.data.txHash,
        });

        return {
          acknowledged: true,
          event: payload.event,
          intent: result.intent,
        };
      }

      if (payload.event === "ens.register.confirmed") {
        const result = await confirmRegisterTransactionByIntentId({
          intentId: payload.data.intentId,
          txHash: payload.data.txHash,
          setPrimary: payload.data.setPrimary,
        });

        return {
          acknowledged: true,
          event: payload.event,
          domain: result.domain,
          registerTxHash: result.registerTxHash,
        };
      }

      const intent = await markPurchaseIntentFailed({
        intentId: payload.data.intentId,
        txHash: payload.data.txHash,
        reason: payload.data.reason,
      });

      return {
        acknowledged: true,
        event: payload.event,
        intent,
      };
    }
  );
};
