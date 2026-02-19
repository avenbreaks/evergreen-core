import { backendEnv } from "../config/env";

const WORKER_NAMES = [
  "reconciliation",
  "tx-watcher",
  "webhook-retry",
  "ops-retention",
  "identity-sync",
  "forum-search-sync",
] as const;
const WORKER_OUTCOMES = ["completed", "skipped", "failed"] as const;

type WorkerName = (typeof WORKER_NAMES)[number];
type WorkerOutcome = (typeof WORKER_OUTCOMES)[number];

type WorkerTotals = Record<WorkerName, Record<WorkerOutcome, number>>;
type WorkerSkipStreak = Record<WorkerName, number>;

export type OpsMetricAlert = {
  level: "warn" | "error";
  code: string;
  message: string;
  context?: Record<string, unknown>;
};

type OpsMetricAlertHandler = (alert: OpsMetricAlert) => void;

type OpsMetricsSnapshot = {
  webhookProcessedTotal: number;
  webhookFailedTotal: number;
  webhookDeadLetterTotal: number;
  webhookRetryDepthMax: number;
  workerRunTotals: WorkerTotals;
  workerSkipStreak: WorkerSkipStreak;
};

const initWorkerTotals = (): WorkerTotals => ({
  reconciliation: { completed: 0, skipped: 0, failed: 0 },
  "tx-watcher": { completed: 0, skipped: 0, failed: 0 },
  "webhook-retry": { completed: 0, skipped: 0, failed: 0 },
  "ops-retention": { completed: 0, skipped: 0, failed: 0 },
  "identity-sync": { completed: 0, skipped: 0, failed: 0 },
  "forum-search-sync": { completed: 0, skipped: 0, failed: 0 },
});

const initWorkerSkipStreak = (): WorkerSkipStreak => ({
  reconciliation: 0,
  "tx-watcher": 0,
  "webhook-retry": 0,
  "ops-retention": 0,
  "identity-sync": 0,
  "forum-search-sync": 0,
});

const state: OpsMetricsSnapshot = {
  webhookProcessedTotal: 0,
  webhookFailedTotal: 0,
  webhookDeadLetterTotal: 0,
  webhookRetryDepthMax: 0,
  workerRunTotals: initWorkerTotals(),
  workerSkipStreak: initWorkerSkipStreak(),
};

let alertHandler: OpsMetricAlertHandler | null = null;

const dispatchAlert = (alert: OpsMetricAlert): void => {
  if (!alertHandler) {
    return;
  }

  alertHandler(alert);
};

const cloneWorkerTotals = (input: WorkerTotals): WorkerTotals => ({
  reconciliation: { ...input.reconciliation },
  "tx-watcher": { ...input["tx-watcher"] },
  "webhook-retry": { ...input["webhook-retry"] },
  "ops-retention": { ...input["ops-retention"] },
  "identity-sync": { ...input["identity-sync"] },
  "forum-search-sync": { ...input["forum-search-sync"] },
});

const cloneWorkerSkipStreak = (input: WorkerSkipStreak): WorkerSkipStreak => ({
  reconciliation: input.reconciliation,
  "tx-watcher": input["tx-watcher"],
  "webhook-retry": input["webhook-retry"],
  "ops-retention": input["ops-retention"],
  "identity-sync": input["identity-sync"],
  "forum-search-sync": input["forum-search-sync"],
});

export const setOpsMetricAlertHandler = (handler: OpsMetricAlertHandler | null): void => {
  alertHandler = handler;
};

export const recordWebhookProcessedMetric = (): void => {
  state.webhookProcessedTotal += 1;
};

export const recordWebhookFailedMetric = (input: {
  attemptCount: number;
  deadLettered: boolean;
  webhookEventId?: string;
  intentId?: string;
  eventType?: string;
}): void => {
  state.webhookFailedTotal += 1;

  if (input.attemptCount > state.webhookRetryDepthMax) {
    state.webhookRetryDepthMax = input.attemptCount;

    if (state.webhookRetryDepthMax >= backendEnv.alertWebhookRetryDepthThreshold) {
      dispatchAlert({
        level: "warn",
        code: "WEBHOOK_RETRY_DEPTH_HIGH",
        message: "Webhook retry depth reached alert threshold",
        context: {
          maxDepth: state.webhookRetryDepthMax,
          threshold: backendEnv.alertWebhookRetryDepthThreshold,
          webhookEventId: input.webhookEventId ?? null,
          intentId: input.intentId ?? null,
          eventType: input.eventType ?? null,
        },
      });
    }
  }

  if (!input.deadLettered) {
    return;
  }

  state.webhookDeadLetterTotal += 1;

  if (state.webhookDeadLetterTotal % backendEnv.alertWebhookDeadLetterThreshold !== 0) {
    return;
  }

  dispatchAlert({
    level: "error",
    code: "WEBHOOK_DEAD_LETTER_THRESHOLD_REACHED",
    message: "Webhook dead-letter counter reached alert threshold",
    context: {
      deadLetterTotal: state.webhookDeadLetterTotal,
      threshold: backendEnv.alertWebhookDeadLetterThreshold,
      webhookEventId: input.webhookEventId ?? null,
      intentId: input.intentId ?? null,
      eventType: input.eventType ?? null,
    },
  });
};

export const recordWorkerRunMetric = (input: {
  worker: WorkerName;
  outcome: WorkerOutcome;
  runId?: string;
}): void => {
  state.workerRunTotals[input.worker][input.outcome] += 1;

  if (input.outcome === "skipped") {
    state.workerSkipStreak[input.worker] += 1;
    const streak = state.workerSkipStreak[input.worker];

    if (streak % backendEnv.alertWorkerSkipStreakThreshold === 0) {
      dispatchAlert({
        level: "warn",
        code: "WORKER_SKIP_STREAK_HIGH",
        message: "Worker skip streak reached alert threshold",
        context: {
          worker: input.worker,
          streak,
          threshold: backendEnv.alertWorkerSkipStreakThreshold,
          runId: input.runId ?? null,
        },
      });
    }

    return;
  }

  state.workerSkipStreak[input.worker] = 0;

  if (input.outcome === "failed") {
    dispatchAlert({
      level: "warn",
      code: "WORKER_RUN_FAILED",
      message: "Worker run failed",
      context: {
        worker: input.worker,
        runId: input.runId ?? null,
      },
    });
  }
};

export const getOpsMetricsSnapshot = (): OpsMetricsSnapshot => ({
  webhookProcessedTotal: state.webhookProcessedTotal,
  webhookFailedTotal: state.webhookFailedTotal,
  webhookDeadLetterTotal: state.webhookDeadLetterTotal,
  webhookRetryDepthMax: state.webhookRetryDepthMax,
  workerRunTotals: cloneWorkerTotals(state.workerRunTotals),
  workerSkipStreak: cloneWorkerSkipStreak(state.workerSkipStreak),
});

export const renderPrometheusMetrics = (): string => {
  const snapshot = getOpsMetricsSnapshot();

  const lines: string[] = [
    "# HELP evergreen_backend_webhook_processed_total Total webhook events processed successfully.",
    "# TYPE evergreen_backend_webhook_processed_total counter",
    `evergreen_backend_webhook_processed_total ${snapshot.webhookProcessedTotal}`,
    "# HELP evergreen_backend_webhook_failed_total Total webhook events marked as failed.",
    "# TYPE evergreen_backend_webhook_failed_total counter",
    `evergreen_backend_webhook_failed_total ${snapshot.webhookFailedTotal}`,
    "# HELP evergreen_backend_webhook_dead_letter_total Total webhook events moved to dead-letter state.",
    "# TYPE evergreen_backend_webhook_dead_letter_total counter",
    `evergreen_backend_webhook_dead_letter_total ${snapshot.webhookDeadLetterTotal}`,
    "# HELP evergreen_backend_webhook_retry_depth_max Maximum webhook retry depth observed.",
    "# TYPE evergreen_backend_webhook_retry_depth_max gauge",
    `evergreen_backend_webhook_retry_depth_max ${snapshot.webhookRetryDepthMax}`,
    "# HELP evergreen_backend_worker_runs_total Worker run totals by worker and outcome.",
    "# TYPE evergreen_backend_worker_runs_total counter",
  ];

  for (const worker of WORKER_NAMES) {
    for (const outcome of WORKER_OUTCOMES) {
      lines.push(
        `evergreen_backend_worker_runs_total{worker="${worker}",outcome="${outcome}"} ${snapshot.workerRunTotals[worker][outcome]}`
      );
    }
  }

  lines.push("# HELP evergreen_backend_worker_skip_streak Consecutive skip streak per worker.");
  lines.push("# TYPE evergreen_backend_worker_skip_streak gauge");

  for (const worker of WORKER_NAMES) {
    lines.push(`evergreen_backend_worker_skip_streak{worker="${worker}"} ${snapshot.workerSkipStreak[worker]}`);
  }

  return `${lines.join("\n")}\n`;
};
