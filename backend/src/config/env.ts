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
  WEBHOOK_SECRET: z.string().optional(),
  WEBHOOK_IP_ALLOWLIST: z.string().optional(),
  WEBHOOK_SIGNATURE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  ENS_RECONCILIATION_INTERVAL_MS: z.coerce.number().int().min(0).default(0),
  ENS_RECONCILIATION_LIMIT: z.coerce.number().int().positive().default(100),
  ENS_RECONCILIATION_STALE_MINUTES: z.coerce.number().int().positive().default(15),
  ENS_TX_WATCHER_INTERVAL_MS: z.coerce.number().int().min(0).default(0),
  ENS_TX_WATCHER_LIMIT: z.coerce.number().int().positive().default(100),
  TRUST_PROXY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid backend environment: ${issues}`);
}

const origins = parsed.data.CORS_ORIGINS.split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

export type BackendEnv = {
  host: string;
  port: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  corsOrigins: string[];
  rateLimitMax: number;
  rateLimitWindowMs: number;
  debounceWindowMs: number;
  bodyLimitBytes: number;
  webhookSecret: string | undefined;
  webhookIpAllowlist: string[];
  webhookSignatureTtlSeconds: number;
  ensReconciliationIntervalMs: number;
  ensReconciliationLimit: number;
  ensReconciliationStaleMinutes: number;
  ensTxWatcherIntervalMs: number;
  ensTxWatcherLimit: number;
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
  webhookSecret: parsed.data.WEBHOOK_SECRET,
  webhookIpAllowlist: parseCsv(parsed.data.WEBHOOK_IP_ALLOWLIST),
  webhookSignatureTtlSeconds: parsed.data.WEBHOOK_SIGNATURE_TTL_SECONDS,
  ensReconciliationIntervalMs: parsed.data.ENS_RECONCILIATION_INTERVAL_MS,
  ensReconciliationLimit: parsed.data.ENS_RECONCILIATION_LIMIT,
  ensReconciliationStaleMinutes: parsed.data.ENS_RECONCILIATION_STALE_MINUTES,
  ensTxWatcherIntervalMs: parsed.data.ENS_TX_WATCHER_INTERVAL_MS,
  ensTxWatcherLimit: parsed.data.ENS_TX_WATCHER_LIMIT,
  trustProxy: parseBoolean(parsed.data.TRUST_PROXY, false),
};
