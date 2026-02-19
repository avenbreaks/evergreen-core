import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { ZodError } from "zod";

import { backendEnv } from "./config/env";
import { registerEnsReconciliationJob } from "./jobs/ens-reconciliation";
import { HttpError } from "./lib/http-error";
import { authBridgeRoutes } from "./routes/auth-bridge";
import { ensRoutes } from "./routes/ens";
import { healthRoutes } from "./routes/health";
import { meRoutes } from "./routes/me";
import { networkRoutes } from "./routes/network";
import { reconciliationRoutes } from "./routes/reconciliation";
import { siweRoutes } from "./routes/siwe";
import { webhookRoutes } from "./routes/webhooks";

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
  app.register(reconciliationRoutes);
  app.register(webhookRoutes);

  registerEnsReconciliationJob(app);

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
