import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { verifyInternalOpsSecretMiddleware } from "../middleware/webhook-auth";

type InternalWorkersRouteDependencies = {
  runEnsReconciliationOnce: (app: unknown, input?: { limit?: number; staleMinutes?: number; dryRun?: boolean }) => Promise<unknown>;
  runEnsTxWatcherOnce: (app: unknown, input?: { limit?: number }) => Promise<unknown>;
  runEnsWebhookRetryOnce: (app: unknown, input?: { limit?: number }) => Promise<unknown>;
  runOpsRetentionOnce: (app: unknown, input?: {
    batchLimit?: number;
    processedRetentionDays?: number;
    deadLetterRetentionDays?: number;
  }) => Promise<unknown>;
  getInternalWorkerStatusSummary: () => Promise<unknown>;
};

type InternalWorkersRoutesOptions = {
  deps?: Partial<InternalWorkersRouteDependencies>;
};

const runReconciliationBodySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  staleMinutes: z.coerce.number().int().positive().max(7 * 24 * 60).optional(),
  dryRun: z.boolean().optional(),
});

const runLimitBodySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
});

const runOpsRetentionBodySchema = z.object({
  batchLimit: z.coerce.number().int().positive().max(5000).optional(),
  processedRetentionDays: z.coerce.number().int().positive().max(365).optional(),
  deadLetterRetentionDays: z.coerce.number().int().positive().max(365).optional(),
});

const hasCompleteDependencies = (
  deps: Partial<InternalWorkersRouteDependencies> | undefined
): deps is InternalWorkersRouteDependencies => {
  if (!deps) {
    return false;
  }

  return (
    typeof deps.runEnsReconciliationOnce === "function" &&
    typeof deps.runEnsTxWatcherOnce === "function" &&
    typeof deps.runEnsWebhookRetryOnce === "function" &&
    typeof deps.runOpsRetentionOnce === "function" &&
    typeof deps.getInternalWorkerStatusSummary === "function"
  );
};

const loadDefaultDependencies = async (): Promise<InternalWorkersRouteDependencies> => {
  const [reconciliationJob, txWatcherJob, webhookRetryJob, opsRetentionJob, workerStatusService] = await Promise.all([
    import("../jobs/ens-reconciliation"),
    import("../jobs/ens-tx-watcher"),
    import("../jobs/ens-webhook-retry"),
    import("../jobs/ops-retention"),
    import("../services/internal-worker-status"),
  ]);

  return {
    runEnsReconciliationOnce: reconciliationJob.runEnsReconciliationOnce as InternalWorkersRouteDependencies["runEnsReconciliationOnce"],
    runEnsTxWatcherOnce: txWatcherJob.runEnsTxWatcherOnce as InternalWorkersRouteDependencies["runEnsTxWatcherOnce"],
    runEnsWebhookRetryOnce: webhookRetryJob.runEnsWebhookRetryOnce as InternalWorkersRouteDependencies["runEnsWebhookRetryOnce"],
    runOpsRetentionOnce: opsRetentionJob.runOpsRetentionOnce as InternalWorkersRouteDependencies["runOpsRetentionOnce"],
    getInternalWorkerStatusSummary: workerStatusService.getInternalWorkerStatusSummary,
  };
};

export const internalWorkersRoutes: FastifyPluginAsync<InternalWorkersRoutesOptions> = async (app, options) => {
  const deps = hasCompleteDependencies(options.deps)
    ? options.deps
    : {
        ...(await loadDefaultDependencies()),
        ...(options.deps ?? {}),
      };

  app.post(
    "/api/internal/workers/reconciliation/run",
    {
      preHandler: verifyInternalOpsSecretMiddleware,
    },
    async (request) => {
      const body = runReconciliationBodySchema.parse(request.body ?? {});
      const run = await deps.runEnsReconciliationOnce(app, {
        limit: body.limit,
        staleMinutes: body.staleMinutes,
        dryRun: body.dryRun,
      });

      return {
        acknowledged: true,
        worker: "reconciliation",
        run,
      };
    }
  );

  app.post(
    "/api/internal/workers/tx-watcher/run",
    {
      preHandler: verifyInternalOpsSecretMiddleware,
    },
    async (request) => {
      const body = runLimitBodySchema.parse(request.body ?? {});
      const run = await deps.runEnsTxWatcherOnce(app, {
        limit: body.limit,
      });

      return {
        acknowledged: true,
        worker: "tx-watcher",
        run,
      };
    }
  );

  app.post(
    "/api/internal/workers/webhook-retry/run",
    {
      preHandler: verifyInternalOpsSecretMiddleware,
    },
    async (request) => {
      const body = runLimitBodySchema.parse(request.body ?? {});
      const run = await deps.runEnsWebhookRetryOnce(app, {
        limit: body.limit,
      });

      return {
        acknowledged: true,
        worker: "webhook-retry",
        run,
      };
    }
  );

  app.post(
    "/api/internal/workers/ops-retention/run",
    {
      preHandler: verifyInternalOpsSecretMiddleware,
    },
    async (request) => {
      const body = runOpsRetentionBodySchema.parse(request.body ?? {});
      const run = await deps.runOpsRetentionOnce(app, {
        batchLimit: body.batchLimit,
        processedRetentionDays: body.processedRetentionDays,
        deadLetterRetentionDays: body.deadLetterRetentionDays,
      });

      return {
        acknowledged: true,
        worker: "ops-retention",
        run,
      };
    }
  );

  app.get(
    "/api/internal/workers/status",
    {
      preHandler: verifyInternalOpsSecretMiddleware,
    },
    async () => {
      const status = await deps.getInternalWorkerStatusSummary();

      return {
        acknowledged: true,
        status,
      };
    }
  );
};
