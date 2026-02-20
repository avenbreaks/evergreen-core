import { z } from "zod";

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
};

const parseCsv = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const uniqueSecrets = (values: Array<string | undefined>): string[] => {
  const normalized = values
    .map((entry) => entry?.trim())
    .filter((entry): entry is string => Boolean(entry));

  return [...new Set(normalized)];
};

const envSchema = z.object({
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:3001"),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  DEBOUNCE_WINDOW_MS: z.coerce.number().int().positive().default(1500),
  BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(1048576),
  WEBHOOK_ACTIVE_SECRET: z.string().optional(),
  WEBHOOK_NEXT_SECRET: z.string().optional(),
  WEBHOOK_SECRET: z.string().optional(),
  INTERNAL_OPS_ACTIVE_SECRET: z.string().optional(),
  INTERNAL_OPS_NEXT_SECRET: z.string().optional(),
  INTERNAL_OPS_SECRET: z.string().optional(),
  WEBHOOK_IP_ALLOWLIST: z.string().optional(),
  WEBHOOK_SIGNATURE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  WEBHOOK_RETRY_INTERVAL_MS: z.coerce.number().int().min(0).default(0),
  WEBHOOK_RETRY_BATCH_LIMIT: z.coerce.number().int().positive().default(50),
  WEBHOOK_RETRY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  WEBHOOK_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(5000),
  WEBHOOK_RETRY_MAX_DELAY_MS: z.coerce.number().int().positive().default(300000),
  ENS_RECONCILIATION_INTERVAL_MS: z.coerce.number().int().min(0).default(0),
  ENS_RECONCILIATION_LIMIT: z.coerce.number().int().positive().default(100),
  ENS_RECONCILIATION_STALE_MINUTES: z.coerce.number().int().positive().default(15),
  ENS_TX_WATCHER_INTERVAL_MS: z.coerce.number().int().min(0).default(0),
  ENS_TX_WATCHER_LIMIT: z.coerce.number().int().positive().default(100),
  ENS_IDENTITY_SYNC_INTERVAL_MS: z.coerce.number().int().min(0).default(0),
  ENS_IDENTITY_SYNC_LIMIT: z.coerce.number().int().positive().default(100),
  ENS_IDENTITY_SYNC_STALE_MINUTES: z.coerce.number().int().positive().default(60),
  OPS_RETENTION_INTERVAL_MS: z.coerce.number().int().min(0).default(0),
  OPS_RETENTION_BATCH_LIMIT: z.coerce.number().int().positive().default(500),
  OPS_WEBHOOK_PROCESSED_RETENTION_DAYS: z.coerce.number().int().positive().default(7),
  OPS_WEBHOOK_DEAD_LETTER_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  OPS_INTERNAL_AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  FORUM_SEARCH_SYNC_INTERVAL_MS: z.coerce.number().int().min(0).default(0),
  FORUM_SEARCH_SYNC_BATCH_LIMIT: z.coerce.number().int().positive().default(100),
  FORUM_SEARCH_SYNC_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  FORUM_SEARCH_SYNC_BASE_DELAY_MS: z.coerce.number().int().positive().default(5000),
  FORUM_SEARCH_SYNC_MAX_DELAY_MS: z.coerce.number().int().positive().default(300000),
  MEILI_URL: z.string().optional(),
  MEILI_API_KEY: z.string().optional(),
  MEILI_FORUM_INDEX_UID: z.string().min(1).default("forum_content"),
  FORUM_SEARCH_MEILI_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  ALERT_WEBHOOK_DEAD_LETTER_THRESHOLD: z.coerce.number().int().positive().default(10),
  ALERT_WEBHOOK_RETRY_DEPTH_THRESHOLD: z.coerce.number().int().positive().default(3),
  ALERT_WORKER_SKIP_STREAK_THRESHOLD: z.coerce.number().int().positive().default(3),
  API_KEY_DEFAULT_EXPIRES_DAYS: z.coerce.number().int().positive().default(90),
  API_KEY_MIN_EXPIRES_DAYS: z.coerce.number().int().positive().default(1),
  API_KEY_MAX_EXPIRES_DAYS: z.coerce.number().int().positive().default(365),
  API_KEY_DEFAULT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  API_KEY_DEFAULT_RATE_LIMIT_PER_IP_PER_MINUTE: z.coerce.number().int().positive().default(60),
  API_KEY_DEFAULT_CONCURRENCY_LIMIT: z.coerce.number().int().positive().default(8),
  API_KEY_SESSION_FRESH_SECONDS: z.coerce.number().int().positive().default(900),
  API_KEY_RISK_MEDIUM_THRESHOLD: z.coerce.number().int().min(0).default(40),
  API_KEY_RISK_HIGH_THRESHOLD: z.coerce.number().int().min(0).default(70),
  API_KEY_RISK_BLOCK_SECONDS: z.coerce.number().int().positive().default(900),
  API_KEY_RISK_BURST_THRESHOLD: z.coerce.number().int().positive().default(30),
  API_KEY_SIGNATURE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  API_KEY_REQUIRE_SIGNATURE_FOR_WRITE: z.string().optional(),
  API_KEY_RATE_LIMIT_REDIS_URL: z.string().optional(),
  API_KEY_RATE_LIMIT_REDIS_PREFIX: z.string().min(1).default("evergreen:api-key"),
  API_KEY_RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
  API_KEY_CONCURRENCY_SLOT_TTL_SECONDS: z.coerce.number().int().positive().default(120),
  ENFORCE_SECURE_TRANSPORT: z.string().optional(),
  TRUST_PROXY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid backend environment: ${issues}`);
}

if (parsed.data.API_KEY_MAX_EXPIRES_DAYS < parsed.data.API_KEY_MIN_EXPIRES_DAYS) {
  throw new Error("Invalid backend environment: API_KEY_MAX_EXPIRES_DAYS must be >= API_KEY_MIN_EXPIRES_DAYS");
}

if (parsed.data.API_KEY_RISK_HIGH_THRESHOLD < parsed.data.API_KEY_RISK_MEDIUM_THRESHOLD) {
  throw new Error("Invalid backend environment: API_KEY_RISK_HIGH_THRESHOLD must be >= API_KEY_RISK_MEDIUM_THRESHOLD");
}

const origins = parsed.data.CORS_ORIGINS.split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

const webhookSecrets = uniqueSecrets([
  parsed.data.WEBHOOK_ACTIVE_SECRET,
  parsed.data.WEBHOOK_NEXT_SECRET,
  parsed.data.WEBHOOK_SECRET,
]);

const internalOpsSecrets = uniqueSecrets([
  parsed.data.INTERNAL_OPS_ACTIVE_SECRET,
  parsed.data.INTERNAL_OPS_NEXT_SECRET,
  parsed.data.INTERNAL_OPS_SECRET,
]);

export type BackendEnv = {
  host: string;
  port: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  corsOrigins: string[];
  rateLimitMax: number;
  rateLimitWindowMs: number;
  debounceWindowMs: number;
  bodyLimitBytes: number;
  webhookSecrets: string[];
  internalOpsSecrets: string[];
  webhookIpAllowlist: string[];
  webhookSignatureTtlSeconds: number;
  webhookRetryIntervalMs: number;
  webhookRetryBatchLimit: number;
  webhookRetryMaxAttempts: number;
  webhookRetryBaseDelayMs: number;
  webhookRetryMaxDelayMs: number;
  ensReconciliationIntervalMs: number;
  ensReconciliationLimit: number;
  ensReconciliationStaleMinutes: number;
  ensTxWatcherIntervalMs: number;
  ensTxWatcherLimit: number;
  ensIdentitySyncIntervalMs: number;
  ensIdentitySyncLimit: number;
  ensIdentitySyncStaleMinutes: number;
  opsRetentionIntervalMs: number;
  opsRetentionBatchLimit: number;
  opsWebhookProcessedRetentionDays: number;
  opsWebhookDeadLetterRetentionDays: number;
  opsInternalAuditRetentionDays: number;
  forumSearchSyncIntervalMs: number;
  forumSearchSyncBatchLimit: number;
  forumSearchSyncMaxAttempts: number;
  forumSearchSyncBaseDelayMs: number;
  forumSearchSyncMaxDelayMs: number;
  meiliUrl: string | null;
  meiliApiKey: string | null;
  meiliForumIndexUid: string;
  forumSearchMeiliTimeoutMs: number;
  alertWebhookDeadLetterThreshold: number;
  alertWebhookRetryDepthThreshold: number;
  alertWorkerSkipStreakThreshold: number;
  apiKey: {
    defaultExpiresDays: number;
    minExpiresDays: number;
    maxExpiresDays: number;
    defaultRateLimitPerMinute: number;
    defaultRateLimitPerIpMinute: number;
    defaultConcurrencyLimit: number;
    sessionFreshSeconds: number;
    riskMediumThreshold: number;
    riskHighThreshold: number;
    riskBlockSeconds: number;
    riskBurstThreshold: number;
    signatureTtlSeconds: number;
    requireSignatureForWrite: boolean;
    rateLimiter: {
      redisUrl: string | null;
      redisPrefix: string;
      redisConnectTimeoutMs: number;
      concurrencySlotTtlSeconds: number;
    };
  };
  enforceSecureTransport: boolean;
  trustProxy: boolean;
};

export const backendEnv: BackendEnv = {
  host: parsed.data.HOST,
  port: parsed.data.PORT,
  logLevel: parsed.data.LOG_LEVEL,
  corsOrigins: origins,
  rateLimitMax: parsed.data.RATE_LIMIT_MAX,
  rateLimitWindowMs: parsed.data.RATE_LIMIT_WINDOW_MS,
  debounceWindowMs: parsed.data.DEBOUNCE_WINDOW_MS,
  bodyLimitBytes: parsed.data.BODY_LIMIT_BYTES,
  webhookSecrets,
  internalOpsSecrets,
  webhookIpAllowlist: parseCsv(parsed.data.WEBHOOK_IP_ALLOWLIST),
  webhookSignatureTtlSeconds: parsed.data.WEBHOOK_SIGNATURE_TTL_SECONDS,
  webhookRetryIntervalMs: parsed.data.WEBHOOK_RETRY_INTERVAL_MS,
  webhookRetryBatchLimit: parsed.data.WEBHOOK_RETRY_BATCH_LIMIT,
  webhookRetryMaxAttempts: parsed.data.WEBHOOK_RETRY_MAX_ATTEMPTS,
  webhookRetryBaseDelayMs: parsed.data.WEBHOOK_RETRY_BASE_DELAY_MS,
  webhookRetryMaxDelayMs: parsed.data.WEBHOOK_RETRY_MAX_DELAY_MS,
  ensReconciliationIntervalMs: parsed.data.ENS_RECONCILIATION_INTERVAL_MS,
  ensReconciliationLimit: parsed.data.ENS_RECONCILIATION_LIMIT,
  ensReconciliationStaleMinutes: parsed.data.ENS_RECONCILIATION_STALE_MINUTES,
  ensTxWatcherIntervalMs: parsed.data.ENS_TX_WATCHER_INTERVAL_MS,
  ensTxWatcherLimit: parsed.data.ENS_TX_WATCHER_LIMIT,
  ensIdentitySyncIntervalMs: parsed.data.ENS_IDENTITY_SYNC_INTERVAL_MS,
  ensIdentitySyncLimit: parsed.data.ENS_IDENTITY_SYNC_LIMIT,
  ensIdentitySyncStaleMinutes: parsed.data.ENS_IDENTITY_SYNC_STALE_MINUTES,
  opsRetentionIntervalMs: parsed.data.OPS_RETENTION_INTERVAL_MS,
  opsRetentionBatchLimit: parsed.data.OPS_RETENTION_BATCH_LIMIT,
  opsWebhookProcessedRetentionDays: parsed.data.OPS_WEBHOOK_PROCESSED_RETENTION_DAYS,
  opsWebhookDeadLetterRetentionDays: parsed.data.OPS_WEBHOOK_DEAD_LETTER_RETENTION_DAYS,
  opsInternalAuditRetentionDays: parsed.data.OPS_INTERNAL_AUDIT_RETENTION_DAYS,
  forumSearchSyncIntervalMs: parsed.data.FORUM_SEARCH_SYNC_INTERVAL_MS,
  forumSearchSyncBatchLimit: parsed.data.FORUM_SEARCH_SYNC_BATCH_LIMIT,
  forumSearchSyncMaxAttempts: parsed.data.FORUM_SEARCH_SYNC_MAX_ATTEMPTS,
  forumSearchSyncBaseDelayMs: parsed.data.FORUM_SEARCH_SYNC_BASE_DELAY_MS,
  forumSearchSyncMaxDelayMs: parsed.data.FORUM_SEARCH_SYNC_MAX_DELAY_MS,
  meiliUrl: parsed.data.MEILI_URL?.trim() || null,
  meiliApiKey: parsed.data.MEILI_API_KEY?.trim() || null,
  meiliForumIndexUid: parsed.data.MEILI_FORUM_INDEX_UID,
  forumSearchMeiliTimeoutMs: parsed.data.FORUM_SEARCH_MEILI_TIMEOUT_MS,
  alertWebhookDeadLetterThreshold: parsed.data.ALERT_WEBHOOK_DEAD_LETTER_THRESHOLD,
  alertWebhookRetryDepthThreshold: parsed.data.ALERT_WEBHOOK_RETRY_DEPTH_THRESHOLD,
  alertWorkerSkipStreakThreshold: parsed.data.ALERT_WORKER_SKIP_STREAK_THRESHOLD,
  apiKey: {
    defaultExpiresDays: parsed.data.API_KEY_DEFAULT_EXPIRES_DAYS,
    minExpiresDays: parsed.data.API_KEY_MIN_EXPIRES_DAYS,
    maxExpiresDays: parsed.data.API_KEY_MAX_EXPIRES_DAYS,
    defaultRateLimitPerMinute: parsed.data.API_KEY_DEFAULT_RATE_LIMIT_PER_MINUTE,
    defaultRateLimitPerIpMinute: parsed.data.API_KEY_DEFAULT_RATE_LIMIT_PER_IP_PER_MINUTE,
    defaultConcurrencyLimit: parsed.data.API_KEY_DEFAULT_CONCURRENCY_LIMIT,
    sessionFreshSeconds: parsed.data.API_KEY_SESSION_FRESH_SECONDS,
    riskMediumThreshold: parsed.data.API_KEY_RISK_MEDIUM_THRESHOLD,
    riskHighThreshold: parsed.data.API_KEY_RISK_HIGH_THRESHOLD,
    riskBlockSeconds: parsed.data.API_KEY_RISK_BLOCK_SECONDS,
    riskBurstThreshold: parsed.data.API_KEY_RISK_BURST_THRESHOLD,
    signatureTtlSeconds: parsed.data.API_KEY_SIGNATURE_TTL_SECONDS,
    requireSignatureForWrite: parseBoolean(parsed.data.API_KEY_REQUIRE_SIGNATURE_FOR_WRITE, true),
    rateLimiter: {
      redisUrl: parsed.data.API_KEY_RATE_LIMIT_REDIS_URL?.trim() || null,
      redisPrefix: parsed.data.API_KEY_RATE_LIMIT_REDIS_PREFIX,
      redisConnectTimeoutMs: parsed.data.API_KEY_RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS,
      concurrencySlotTtlSeconds: parsed.data.API_KEY_CONCURRENCY_SLOT_TTL_SECONDS,
    },
  },
  enforceSecureTransport: parseBoolean(parsed.data.ENFORCE_SECURE_TRANSPORT, true),
  trustProxy: parseBoolean(parsed.data.TRUST_PROXY, false),
};
