import { timingSafeEqual } from "node:crypto";

import type { preHandlerHookHandler } from "fastify";

import { backendEnv } from "../config/env";
import { HttpError } from "../lib/http-error";

const toStringHeader = (value: string | string[] | undefined): string | null => {
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? value[0] ?? null : value;
};

const isIpAllowed = (ip: string): boolean => {
  if (backendEnv.webhookIpAllowlist.length === 0) {
    return true;
  }

  return backendEnv.webhookIpAllowlist.includes(ip);
};

export const verifyWebhookSecretMiddleware: preHandlerHookHandler = async (request) => {
  if (!backendEnv.webhookSecret) {
    throw new HttpError(503, "WEBHOOK_DISABLED", "Webhook endpoint disabled: WEBHOOK_SECRET is not configured");
  }

  if (!isIpAllowed(request.ip)) {
    throw new HttpError(403, "WEBHOOK_IP_NOT_ALLOWED", "Webhook caller IP is not allowlisted", {
      ip: request.ip,
    });
  }

  const candidate = toStringHeader(request.headers["x-webhook-secret"]);
  if (!candidate) {
    throw new HttpError(401, "WEBHOOK_UNAUTHORIZED", "Missing x-webhook-secret header");
  }

  const expectedBuffer = Buffer.from(backendEnv.webhookSecret);
  const receivedBuffer = Buffer.from(candidate);

  if (expectedBuffer.length !== receivedBuffer.length) {
    throw new HttpError(401, "WEBHOOK_UNAUTHORIZED", "Invalid webhook secret");
  }

  if (!timingSafeEqual(expectedBuffer, receivedBuffer)) {
    throw new HttpError(401, "WEBHOOK_UNAUTHORIZED", "Invalid webhook secret");
  }
};
