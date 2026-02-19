import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireSecureTransportMiddleware } from "../middleware/require-secure-transport";
import { verifyInternalOpsSecretMiddleware } from "../middleware/webhook-auth";
import { expirePurchaseIntentById, retryPurchaseIntentById } from "../services/ens-marketplace";

const intentParamsSchema = z.object({
  intentId: z.string().uuid(),
});

const reasonBodySchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

export const internalEnsOpsRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/api/internal/ens/intents/:intentId/retry",
    {
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware],
    },
    async (request) => {
      const params = intentParamsSchema.parse(request.params);
      const body = reasonBodySchema.parse(request.body ?? {});

      const intent = await retryPurchaseIntentById({
        intentId: params.intentId,
        reason: body.reason,
      });

      return {
        acknowledged: true,
        action: "retry",
        intent,
      };
    }
  );

  app.post(
    "/api/internal/ens/intents/:intentId/expire",
    {
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware],
    },
    async (request) => {
      const params = intentParamsSchema.parse(request.params);
      const body = reasonBodySchema.parse(request.body ?? {});

      const intent = await expirePurchaseIntentById({
        intentId: params.intentId,
        reason: body.reason,
      });

      return {
        acknowledged: true,
        action: "expire",
        intent,
      };
    }
  );
};
