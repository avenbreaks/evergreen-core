import { randomBytes } from "node:crypto";

export type ApiKeyEnvironment = "live" | "test";

const API_KEY_PATTERN = /^egp_(live|test)_([A-Za-z0-9_-]{12,128})\.([A-Za-z0-9_-]{24,256})$/;

export type ParsedApiKeyToken = {
  environment: ApiKeyEnvironment;
  keyId: string;
  secret: string;
};

const normalizeScope = (scope: string): string => scope.trim().toLowerCase();

export const generateApiKeyId = (): string => randomBytes(16).toString("base64url");

export const generateApiKeySecret = (): string => randomBytes(32).toString("base64url");

export const createApiKeyToken = (input: ParsedApiKeyToken): string =>
  `egp_${input.environment}_${input.keyId}.${input.secret}`;

export const parseApiKeyToken = (token: string): ParsedApiKeyToken | null => {
  const trimmed = token.trim();
  const match = API_KEY_PATTERN.exec(trimmed);
  if (!match) {
    return null;
  }

  return {
    environment: match[1] as ApiKeyEnvironment,
    keyId: match[2],
    secret: match[3],
  };
};

export const normalizeScopes = (scopes: string[]): string[] => {
  const normalized = scopes.map(normalizeScope).filter(Boolean);
  return [...new Set(normalized)].sort();
};

const splitScope = (scope: string): [string, string] => {
  const [resource, action = "*"] = normalizeScope(scope).split(":");
  return [resource || "*", action || "*"];
};

export const hasScope = (grantedScopes: string[], requiredScope: string): boolean => {
  const normalizedRequired = normalizeScope(requiredScope);
  if (!normalizedRequired) {
    return true;
  }

  const [requiredResource, requiredAction] = splitScope(normalizedRequired);

  for (const scope of grantedScopes) {
    const [resource, action] = splitScope(scope);
    const resourceMatches = resource === "*" || resource === requiredResource;
    const actionMatches = action === "*" || action === requiredAction;

    if (resourceMatches && actionMatches) {
      return true;
    }
  }

  return false;
};

export const hasAllScopes = (grantedScopes: string[], requiredScopes: string[]): boolean =>
  requiredScopes.every((scope) => hasScope(grantedScopes, scope));

export const getApiKeyPrefix = (environment: ApiKeyEnvironment): string => `egp_${environment}`;

export const maskApiKeyDisplay = (input: {
  environment: ApiKeyEnvironment;
  keyId: string;
  secretHint: string;
}): string => {
  const suffix = input.secretHint ? `****${input.secretHint}` : "****";
  return `egp_${input.environment}_${input.keyId}.${suffix}`;
};
