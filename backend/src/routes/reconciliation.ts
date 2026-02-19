import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { verifyWebhookSecretMiddleware } from "../middleware/webhook-auth";
import { reconcileStalePurchaseIntents } from "../services/ens-reconciliation";

type ReconciliationRouteDependencies = {
  reconcileStalePurchaseIntents: typeof reconcileStalePurchaseIntents;
};

type ReconciliationRoutesOptions = {
  deps?: Partial<ReconciliationRouteDependencies>;
};

const reconcileBodySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  staleMinutes: z.coerce.number().int().positive().max(7 * 24 * 60).optional(),
  dryRun: z.boolean().optional(),
});

const defaultDeps: ReconciliationRouteDependencies = {
  reconcileStalePurchaseIntents,
};

export const reconciliationRoutes: FastifyPluginAsync<ReconciliationRoutesOptions> = async (app, options) => {
  const deps: ReconciliationRouteDependencies = {
    ...defaultDeps,
    ...(options.deps ?? {}),
  };

  app.post(
    "/api/internal/ens/reconcile",
    {
      preHandler: verifyWebhookSecretMiddleware,
    },
    async (request) => {
      const body = reconcileBodySchema.parse(request.body ?? {});
      const result = await deps.reconcileStalePurchaseIntents({
        limit: body.limit,
        staleMinutes: body.staleMinutes,
        dryRun: body.dryRun,
      });

      return {
        acknowledged: true,
        ...result,
      };
    }
  );
};
