import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { backendEnv } from "../config/env";
import { runWithEnsWebhookRetryLock } from "../services/ens-reconciliation-lock";
import { recordWorkerRunMetric } from "../services/ops-metrics";
import { retryFailedWebhookEvents } from "../services/ens-webhook-retry";

type RunEnsWebhookRetryOnceInput = {
  limit?: number;
};

export const runEnsWebhookRetryOnce = async (
  app: FastifyInstance,
  input: RunEnsWebhookRetryOnceInput = {}
) => {
  const retryRunId = randomUUID();
  try {
    const lockResult = await runWithEnsWebhookRetryLock(async () => {
      app.log.info({ retryRunId }, "ENS webhook retry run started");

      const result = await retryFailedWebhookEvents({
        limit: input.limit ?? backendEnv.webhookRetryBatchLimit,
      });

      return result;
    });

    if (!lockResult.acquired) {
      app.log.info({ retryRunId }, "ENS webhook retry run skipped: advisory lock held by another instance");
      recordWorkerRunMetric({
        worker: "webhook-retry",
        outcome: "skipped",
        runId: retryRunId,
      });
      return {
        retryRunId,
        skipped: true,
      } as const;
    }

    const result = lockResult.result;
    app.log.info(
      {
        retryRunId,
        scanned: result.scanned,
        processed: result.processed,
        failed: result.failed,
        deadLettered: result.deadLettered,
        errors: result.errors,
      },
      "ENS webhook retry run completed"
    );
    recordWorkerRunMetric({
      worker: "webhook-retry",
      outcome: "completed",
      runId: retryRunId,
    });

    return {
      retryRunId,
      skipped: false,
      result,
    } as const;
  } catch (error) {
    recordWorkerRunMetric({
      worker: "webhook-retry",
      outcome: "failed",
      runId: retryRunId,
    });
    throw error;
  }
};

export const registerEnsWebhookRetryJob = (app: FastifyInstance): void => {
  const intervalMs = backendEnv.webhookRetryIntervalMs;

  if (intervalMs <= 0) {
    app.log.info({ intervalMs }, "ENS webhook retry job disabled");
    return;
  }

  let timer: NodeJS.Timeout | null = null;

  app.addHook("onReady", async () => {
    timer = setInterval(() => {
      void runEnsWebhookRetryOnce(app).catch((error) => {
        app.log.error({ err: error }, "ENS webhook retry run failed");
      });
    }, intervalMs);

    app.log.info(
      {
        intervalMs,
        limit: backendEnv.webhookRetryBatchLimit,
      },
      "ENS webhook retry job started"
    );

    void runEnsWebhookRetryOnce(app).catch((error) => {
      app.log.error({ err: error }, "Initial ENS webhook retry run failed");
    });
  });

  app.addHook("onClose", async () => {
    if (!timer) {
      return;
    }

    clearInterval(timer);
    timer = null;
  });
};
