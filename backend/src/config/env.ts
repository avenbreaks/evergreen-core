import { z } from "zod";

const envSchema = z.object({
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:3001"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid backend environment: ${issues}`);
}

const origins = parsed.data.CORS_ORIGINS.split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

export const backendEnv = {
  host: parsed.data.HOST,
  port: parsed.data.PORT,
  logLevel: parsed.data.LOG_LEVEL,
  corsOrigins: origins,
} as const;
