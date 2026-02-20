import type { FastifyRequest, preHandlerHookHandler } from "fastify";

import { backendEnv } from "../config/env";
import { HttpError } from "../lib/http-error";
import { authenticateApiKeyRequest, type ApiKeyPrincipal } from "../services/api-keys/core";

type RequestApiKeyContext = {
  principal: ApiKeyPrincipal;
  releaseConcurrency: () => void;
};

const apiKeyContext = new WeakMap<FastifyRequest, RequestApiKeyContext>();

const isWriteScope = (scope: string): boolean => {
  const normalized = scope.toLowerCase();
  return normalized.includes(":write") || normalized.includes(":admin") || normalized.startsWith("keys:");
};

export const requireApiKeyAuth = (options?: {
  requiredScopes?: string[];
  requireSignature?: boolean;
}): preHandlerHookHandler => {
  const requiredScopes = options?.requiredScopes ?? [];
  const requireSignature =
    options?.requireSignature ?? (backendEnv.apiKey.requireSignatureForWrite && requiredScopes.some(isWriteScope));

  return async (request, reply) => {
    const authenticated = await authenticateApiKeyRequest({
      request,
      requiredScopes,
      requireSignature,
    });

    apiKeyContext.set(request, {
      principal: authenticated.principal,
      releaseConcurrency: authenticated.releaseConcurrency,
    });

    let released = false;
    const releaseOnce = () => {
      if (released) {
        return;
      }

      released = true;
      authenticated.releaseConcurrency();
    };

    reply.raw.once("finish", releaseOnce);
    reply.raw.once("close", releaseOnce);
  };
};

export const getApiKeyPrincipal = (request: FastifyRequest): ApiKeyPrincipal | null => {
  const context = apiKeyContext.get(request);
  return context?.principal ?? null;
};

export const requireApiKeyPrincipal = (request: FastifyRequest): ApiKeyPrincipal => {
  const principal = getApiKeyPrincipal(request);
  if (!principal) {
    throw new HttpError(401, "API_KEY_UNAUTHORIZED", "API key authentication required");
  }

  return principal;
};
