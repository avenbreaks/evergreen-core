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

const nodeEnv = process.env.NODE_ENV ?? "development";
const trustedOrigins = parseCsv(process.env.BETTER_AUTH_TRUSTED_ORIGINS);

const githubClientId = process.env.GITHUB_CLIENT_ID;
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
ensureProviderPair(githubClientId, githubClientSecret);

export const authEnv = {
  nodeEnv,
  databaseUrl: requireEnv("DATABASE_URL"),
  betterAuthUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  betterAuthSecret: ensureSecret(requireEnv("BETTER_AUTH_SECRET")),
  trustedOrigins: trustedOrigins.length > 0 ? trustedOrigins : ["http://localhost:3000"],
  githubClientId,
  githubClientSecret,
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
