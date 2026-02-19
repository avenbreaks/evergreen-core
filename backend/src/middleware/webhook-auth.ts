import { createHmac, timingSafeEqual } from "node:crypto";

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

const assertWebhookEnabledAndIpAllowed = (request: { ip: string }): void => {
  if (!backendEnv.webhookSecret) {
    throw new HttpError(503, "WEBHOOK_DISABLED", "Webhook endpoint disabled: WEBHOOK_SECRET is not configured");
  }

  if (!isIpAllowed(request.ip)) {
    throw new HttpError(403, "WEBHOOK_IP_NOT_ALLOWED", "Webhook caller IP is not allowlisted", {
      ip: request.ip,
    });
  }
};

const normalizeSignature = (signatureHeader: string | null): string | null => {
  if (!signatureHeader) {
    return null;
  }

  if (signatureHeader.startsWith("sha256=")) {
    return signatureHeader.slice("sha256=".length).toLowerCase();
  }

  return signatureHeader.toLowerCase();
};

const verifyHexSignature = (expectedHex: string, receivedHex: string): boolean => {
  if (!/^[0-9a-f]{64}$/.test(receivedHex)) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedHex, "hex");
  const receivedBuffer = Buffer.from(receivedHex, "hex");

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
};

export const verifyWebhookSecretMiddleware: preHandlerHookHandler = async (request) => {
  assertWebhookEnabledAndIpAllowed(request);
  const secret = backendEnv.webhookSecret as string;

  const candidate = toStringHeader(request.headers["x-webhook-secret"]);
  if (!candidate) {
    throw new HttpError(401, "WEBHOOK_UNAUTHORIZED", "Missing x-webhook-secret header");
  }

  const expectedBuffer = Buffer.from(secret);
  const receivedBuffer = Buffer.from(candidate);

  if (expectedBuffer.length !== receivedBuffer.length) {
    throw new HttpError(401, "WEBHOOK_UNAUTHORIZED", "Invalid webhook secret");
  }

  if (!timingSafeEqual(expectedBuffer, receivedBuffer)) {
    throw new HttpError(401, "WEBHOOK_UNAUTHORIZED", "Invalid webhook secret");
  }
};

export const verifyWebhookSignatureMiddleware: preHandlerHookHandler = async (request) => {
  assertWebhookEnabledAndIpAllowed(request);
  const secret = backendEnv.webhookSecret as string;

  const signatureHeader = normalizeSignature(toStringHeader(request.headers["x-webhook-signature"]));
  if (!signatureHeader) {
    throw new HttpError(401, "WEBHOOK_UNAUTHORIZED", "Missing x-webhook-signature header");
  }

  const timestampHeader = toStringHeader(request.headers["x-webhook-timestamp"]);
  if (!timestampHeader) {
    throw new HttpError(401, "WEBHOOK_UNAUTHORIZED", "Missing x-webhook-timestamp header");
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isInteger(timestamp) || timestamp <= 0) {
    throw new HttpError(401, "WEBHOOK_UNAUTHORIZED", "Invalid x-webhook-timestamp header");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > backendEnv.webhookSignatureTtlSeconds) {
    throw new HttpError(401, "WEBHOOK_SIGNATURE_EXPIRED", "Webhook signature timestamp outside allowed window", {
      nowSeconds,
      timestamp,
      allowedWindowSeconds: backendEnv.webhookSignatureTtlSeconds,
    });
  }

  const payload = `${timestamp}.${JSON.stringify(request.body ?? {})}`;
  const expectedSignature = createHmac("sha256", secret).update(payload).digest("hex");

  if (!verifyHexSignature(expectedSignature, signatureHeader)) {
    throw new HttpError(401, "WEBHOOK_UNAUTHORIZED", "Invalid webhook signature");
  }
};
