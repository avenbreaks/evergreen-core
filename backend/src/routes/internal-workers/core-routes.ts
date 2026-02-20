import type { FastifyInstance } from "fastify";

import { requireSecureTransportMiddleware } from "../../middleware/require-secure-transport";
import { verifyInternalOpsSecretMiddleware } from "../../middleware/webhook-auth";

import {
  runIdentitySyncBodySchema,
  runLimitBodySchema,
  runOpsRetentionBodySchema,
  runReconciliationBodySchema,
} from "./schemas";
import type { InternalWorkersRouteDependencies } from "./types";

export const registerInternalCoreWorkerRoutes = (app: FastifyInstance, deps: InternalWorkersRouteDependencies): void => {
  app.post(
    "/api/internal/workers/reconciliation/run",
    {
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware],
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
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware],
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
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware],
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
    "/api/internal/workers/identity-sync/run",
    {
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware],
    },
    async (request) => {
      const body = runIdentitySyncBodySchema.parse(request.body ?? {});
      const run = await deps.runEnsIdentitySyncOnce(app, {
        limit: body.limit,
        staleMinutes: body.staleMinutes,
      });

      return {
        acknowledged: true,
        worker: "identity-sync",
        run,
      };
    }
  );

  app.post(
    "/api/internal/workers/ops-retention/run",
    {
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware],
    },
    async (request) => {
      const body = runOpsRetentionBodySchema.parse(request.body ?? {});
      const run = await deps.runOpsRetentionOnce(app, {
        batchLimit: body.batchLimit,
        processedRetentionDays: body.processedRetentionDays,
        deadLetterRetentionDays: body.deadLetterRetentionDays,
        internalAuditRetentionDays: body.internalAuditRetentionDays,
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
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware],
    },
    async () => {
      const status = await deps.getInternalWorkerStatusSummary();

      return {
        acknowledged: true,
        status,
      };
    }
  );

  app.get(
    "/api/internal/forum/mvp/status",
    {
      preHandler: [requireSecureTransportMiddleware, verifyInternalOpsSecretMiddleware],
    },
    async () => {
      const status = await deps.getForumMvpStatusSummary();

      return {
        acknowledged: true,
        scope: "forum-mvp",
        status,
      };
    }
  );
};
