const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
};

const parseCsv = (value?: string): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const parseNumberList = (value: string | undefined, fallback: number[]): number[] => {
  if (!value) {
    return fallback;
  }

  const result = value
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isInteger(entry) && entry > 0);

  return result.length > 0 ? result : fallback;
};

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const parseRateLimitStorage = (value: string | undefined): "memory" | "database" => {
  const normalized = value?.trim().toLowerCase();
  return normalized === "database" ? "database" : "memory";
};

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

const ensureSecret = (value: string): string => {
  if (value.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
  }

  return value;
};

const ensureProviderPair = (clientId?: string, clientSecret?: string): void => {
  const hasClientId = Boolean(clientId);
  const hasClientSecret = Boolean(clientSecret);

  if (hasClientId !== hasClientSecret) {
    throw new Error("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must both be set or both omitted");
  }
};

const ensureOptionalPair = (leftName: string, rightName: string, left?: string, right?: string): void => {
  const hasLeft = Boolean(left);
  const hasRight = Boolean(right);

  if (hasLeft !== hasRight) {
    throw new Error(`${leftName} and ${rightName} must both be set or both omitted`);
  }
};

const nodeEnv = process.env.NODE_ENV ?? "development";
const trustedOrigins = parseCsv(process.env.BETTER_AUTH_TRUSTED_ORIGINS);

const githubClientId = process.env.GITHUB_CLIENT_ID;
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
ensureProviderPair(githubClientId, githubClientSecret);

const mailProvider = process.env.MAIL_PROVIDER === "unosend" ? "unosend" : "smtp";
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
ensureOptionalPair("SMTP_USER", "SMTP_PASS", smtpUser, smtpPass);

const unosendApiKey = process.env.UNOSEND_API_KEY;
if (mailProvider === "unosend" && !unosendApiKey) {
  throw new Error("UNOSEND_API_KEY is required when MAIL_PROVIDER=unosend");
}

export const authEnv = {
  nodeEnv,
  databaseUrl: requireEnv("DATABASE_URL"),
  betterAuthUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  betterAuthSecret: ensureSecret(requireEnv("BETTER_AUTH_SECRET")),
  trustedOrigins: trustedOrigins.length > 0 ? trustedOrigins : ["http://localhost:3000"],
  githubClientId,
  githubClientSecret,
  mail: {
    provider: mailProvider,
    from: process.env.MAIL_FROM ?? "Evergreen Devparty <no-reply@localhost>",
    replyTo: process.env.MAIL_REPLY_TO,
    smtp: {
      host: process.env.SMTP_HOST ?? "localhost",
      port: parsePositiveInt(process.env.SMTP_PORT, 1025),
      secure: parseBoolean(process.env.SMTP_SECURE, false),
      ignoreTls: parseBoolean(process.env.SMTP_IGNORE_TLS, true),
      user: smtpUser,
      pass: smtpPass,
    },
    unosend: {
      baseUrl: process.env.UNOSEND_BASE_URL ?? "https://www.unosend.co/api/v1",
      apiKey: unosendApiKey,
      timeoutMs: parsePositiveInt(process.env.UNOSEND_REQUEST_TIMEOUT_MS, 10000),
    },
  },
  security: {
    allowDifferentLinkedEmails: parseBoolean(process.env.AUTH_ALLOW_DIFFERENT_LINKED_EMAILS, false),
    requireEmailVerification: parseBoolean(process.env.AUTH_REQUIRE_EMAIL_VERIFICATION, true),
  },
  rateLimit: {
    enabled: parseBoolean(process.env.AUTH_RATE_LIMIT_ENABLED, true),
    storage: parseRateLimitStorage(process.env.AUTH_RATE_LIMIT_STORAGE),
  },
  siwe: {
    domain: process.env.SIWE_DOMAIN ?? "localhost",
    uri: process.env.SIWE_URI ?? "http://localhost:3000",
    chainIdAllowlist: parseNumberList(process.env.SIWE_CHAIN_IDS, [131]),
    nonceTtlSeconds: Number(process.env.SIWE_NONCE_TTL_SECONDS ?? 300),
    statement: process.env.SIWE_STATEMENT ?? "Sign in to Evergreen Devparty",
  },
  network: {
    rpcUrl: process.env.OORTHNEXUS_RPC_URL ?? "https://rpc-api.oorthnexus.xyz",
    chainId: parsePositiveInt(process.env.OORTHNEXUS_CHAIN_ID, 131),
    explorerUrl: process.env.OORTHNEXUS_EXPLORER_URL ?? "https://analytics.oorthnexus.xyz",
  },
  ens: {
    registryAddress:
      process.env.ENS_REGISTRY_ADDRESS ?? "0x38355d6486e725896690f727a297fb57a143556c",
    publicResolverAddress:
      process.env.ENS_PUBLIC_RESOLVER_ADDRESS ?? "0x47e9cbbd0ee572d996ffd0d7aa17796c5a247590",
    reverseRegistrarAddress:
      process.env.ENS_REVERSE_REGISTRAR_ADDRESS ?? "0x98fc575ec10729a3350ca7b74cfd2f1bf81e8f12",
  },
} as const;
