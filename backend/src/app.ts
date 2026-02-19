import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { ZodError } from "zod";

import { backendEnv } from "./config/env";
import { registerEnsReconciliationJob } from "./jobs/ens-reconciliation";
import { registerEnsWebhookRetryJob } from "./jobs/ens-webhook-retry";
import { registerEnsTxWatcherJob } from "./jobs/ens-tx-watcher";
import { registerOpsRetentionJob } from "./jobs/ops-retention";
import { HttpError } from "./lib/http-error";
import { authBridgeRoutes } from "./routes/auth-bridge";
import { ensRoutes } from "./routes/ens";
import { healthRoutes } from "./routes/health";
import { internalEnsOpsRoutes } from "./routes/internal-ens-ops";
import { internalWorkersRoutes } from "./routes/internal-workers";
import { meRoutes } from "./routes/me";
import { metricsRoutes } from "./routes/metrics";
import { networkRoutes } from "./routes/network";
import { reconciliationRoutes } from "./routes/reconciliation";
import { siweRoutes } from "./routes/siwe";
import { webhookRoutes } from "./routes/webhooks";
import { setOpsMetricAlertHandler } from "./services/ops-metrics";

export const buildApp = () => {
  const app = Fastify({
    trustProxy: backendEnv.trustProxy,
    bodyLimit: backendEnv.bodyLimitBytes,
    logger: {
      level: backendEnv.logLevel,
    },
  });

  app.register(helmet, {
    global: true,
  });

  app.register(cors, {
    origin: backendEnv.corsOrigins,
    credentials: true,
  });

  app.register(rateLimit, {
    max: backendEnv.rateLimitMax,
    timeWindow: backendEnv.rateLimitWindowMs,
  });

  app.register(healthRoutes);
  app.register(networkRoutes);
  app.register(authBridgeRoutes);
  app.register(siweRoutes);
  app.register(meRoutes);
  app.register(ensRoutes);
  app.register(metricsRoutes);
  app.register(internalEnsOpsRoutes);
  app.register(internalWorkersRoutes);
  app.register(reconciliationRoutes);
  app.register(webhookRoutes);

  setOpsMetricAlertHandler((alert) => {
    const details = {
      code: alert.code,
      ...(alert.context ?? {}),
    };

    if (alert.level === "error") {
      app.log.error(details, alert.message);
      return;
    }

    app.log.warn(details, alert.message);
  });

  app.addHook("onClose", async () => {
    setOpsMetricAlertHandler(null);
  });

  registerEnsReconciliationJob(app);
  registerEnsWebhookRetryJob(app);
  registerEnsTxWatcherJob(app);
  registerOpsRetentionJob(app);

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "Request failed");

    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        code: "VALIDATION_ERROR",
        message: "Invalid request payload",
        details: error.issues,
      });
    }

    return reply.status(500).send({
      code: "INTERNAL_SERVER_ERROR",
      message: "Unexpected error",
    });
  });

  return app;
};
