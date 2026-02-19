import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { verifyWebhookSecretMiddleware } from "../middleware/webhook-auth";

type ReconciliationRouteDependencies = {
  reconcileStalePurchaseIntents: (input: {
    limit?: number;
    staleMinutes?: number;
    dryRun?: boolean;
  }) => Promise<{
    scanned: number;
    updated: number;
    expired: number;
    promotedToRegisterable: number;
    unchanged: number;
    dryRun: boolean;
    staleMinutes: number;
    intents: Array<{
      intentId: string;
      domainName: string;
      previousStatus: string;
      nextStatus: string;
      reason: string;
    }>;
    startedAt: Date;
    finishedAt: Date;
  }>;
};

type ReconciliationRoutesOptions = {
  deps?: Partial<ReconciliationRouteDependencies>;
};

const reconcileBodySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  staleMinutes: z.coerce.number().int().positive().max(7 * 24 * 60).optional(),
  dryRun: z.boolean().optional(),
});

const hasCompleteDependencies = (
  deps: Partial<ReconciliationRouteDependencies> | undefined
): deps is ReconciliationRouteDependencies => {
  if (!deps) {
    return false;
  }

  return typeof deps.reconcileStalePurchaseIntents === "function";
};

const loadDefaultDependencies = async (): Promise<ReconciliationRouteDependencies> => {
  const reconciliationService = await import("../services/ens-reconciliation");

  return {
    reconcileStalePurchaseIntents: reconciliationService.reconcileStalePurchaseIntents,
  };
};

export const reconciliationRoutes: FastifyPluginAsync<ReconciliationRoutesOptions> = async (app, options) => {
  const deps = hasCompleteDependencies(options.deps)
    ? options.deps
    : {
        ...(await loadDefaultDependencies()),
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
