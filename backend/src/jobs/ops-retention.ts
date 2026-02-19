import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { backendEnv } from "../config/env";
import { runWithOpsRetentionLock } from "../services/ens-reconciliation-lock";
import { recordWorkerRunMetric } from "../services/ops-metrics";
import { runOpsRetention } from "../services/ops-retention";

type RunOpsRetentionOnceInput = {
  batchLimit?: number;
  processedRetentionDays?: number;
  deadLetterRetentionDays?: number;
};

export const runOpsRetentionOnce = async (app: FastifyInstance, input: RunOpsRetentionOnceInput = {}) => {
  const retentionRunId = randomUUID();
  try {
    const lockResult = await runWithOpsRetentionLock(async () => {
      app.log.info({ retentionRunId }, "Ops retention run started");

      const result = await runOpsRetention({
        batchLimit: input.batchLimit ?? backendEnv.opsRetentionBatchLimit,
        processedRetentionDays: input.processedRetentionDays ?? backendEnv.opsWebhookProcessedRetentionDays,
        deadLetterRetentionDays: input.deadLetterRetentionDays ?? backendEnv.opsWebhookDeadLetterRetentionDays,
      });

      return result;
    });

    if (!lockResult.acquired) {
      app.log.info({ retentionRunId }, "Ops retention run skipped: advisory lock held by another instance");
      recordWorkerRunMetric({
        worker: "ops-retention",
        outcome: "skipped",
        runId: retentionRunId,
      });
      return {
        retentionRunId,
        skipped: true,
      } as const;
    }

    const result = lockResult.result;
    app.log.info(
      {
        retentionRunId,
        scanned: result.scanned,
        deletedProcessed: result.deletedProcessed,
        deletedDeadLetter: result.deletedDeadLetter,
      },
      "Ops retention run completed"
    );
    recordWorkerRunMetric({
      worker: "ops-retention",
      outcome: "completed",
      runId: retentionRunId,
    });

    return {
      retentionRunId,
      skipped: false,
      result,
    } as const;
  } catch (error) {
    recordWorkerRunMetric({
      worker: "ops-retention",
      outcome: "failed",
      runId: retentionRunId,
    });
    throw error;
  }
};

export const registerOpsRetentionJob = (app: FastifyInstance): void => {
  const intervalMs = backendEnv.opsRetentionIntervalMs;

  if (intervalMs <= 0) {
    app.log.info({ intervalMs }, "Ops retention job disabled");
    return;
  }

  let timer: NodeJS.Timeout | null = null;

  app.addHook("onReady", async () => {
    timer = setInterval(() => {
      void runOpsRetentionOnce(app).catch((error) => {
        app.log.error({ err: error }, "Ops retention run failed");
      });
    }, intervalMs);

    app.log.info(
      {
        intervalMs,
        batchLimit: backendEnv.opsRetentionBatchLimit,
      },
      "Ops retention job started"
    );

    void runOpsRetentionOnce(app).catch((error) => {
      app.log.error({ err: error }, "Initial ops retention run failed");
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
