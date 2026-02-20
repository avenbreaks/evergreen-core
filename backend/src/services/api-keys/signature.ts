import { createHash, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

import { lte } from "drizzle-orm";
import type { FastifyRequest } from "fastify";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { backendEnv } from "../../config/env";
import { HttpError } from "../../lib/http-error";

const SIGNATURE_INFO = Buffer.from("evergreen-api-key-signing");
const HEX_64 = /^[0-9a-f]{64}$/;

const toStringHeader = (value: string | string[] | undefined): string | null => {
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? value[0] ?? null : value;
};

const stableJsonStringify = (value: unknown): string => {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));

    const mapped = entries.map(([entryKey, entryValue]) => `${JSON.stringify(entryKey)}:${stableJsonStringify(entryValue)}`);
    return `{${mapped.join(",")}}`;
  }

  return JSON.stringify(String(value));
};

const normalizeSignature = (signatureHeader: string | null): string | null => {
  if (!signatureHeader) {
    return null;
  }

  const candidate = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice("sha256=".length).trim().toLowerCase()
    : signatureHeader.trim().toLowerCase();

  return HEX_64.test(candidate) ? candidate : null;
};

const buildBodyHash = (request: FastifyRequest): string => {
  let bodyContent = "";
  if (typeof request.body === "string") {
    bodyContent = request.body;
  } else if (request.body !== undefined) {
    bodyContent = stableJsonStringify(request.body);
  }

  return createHash("sha256").update(bodyContent).digest("hex");
};

const buildSignaturePayload = (input: {
  method: string;
  path: string;
  bodyHash: string;
  timestamp: number;
  nonce: string;
}): string => [input.method.toUpperCase(), input.path, input.bodyHash, String(input.timestamp), input.nonce].join("\n");

const deriveSigningKey = (secret: string): Buffer => {
  const derived = hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), SIGNATURE_INFO, 32);
  return Buffer.from(derived);
};

const verifyNonceUniqueness = async (input: { keyId: string; nonce: string; now: Date }): Promise<void> => {
  const expiresAt = new Date(input.now.getTime() + backendEnv.apiKey.signatureTtlSeconds * 1000);

  try {
    await authDb.insert(schema.apiKeyRequestNonces).values({
      keyId: input.keyId,
      nonce: input.nonce,
      expiresAt,
      createdAt: input.now,
    });
  } catch (error) {
    const directCode =
      typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : null;

    const causeCode =
      typeof error === "object" &&
      error !== null &&
      "cause" in error &&
      typeof (error as { cause?: unknown }).cause === "object" &&
      (error as { cause: { code?: unknown } }).cause !== null &&
      typeof (error as { cause: { code?: unknown } }).cause.code === "string"
        ? ((error as { cause: { code: string } }).cause.code as string)
        : null;

    if (directCode === "23505" || causeCode === "23505") {
      throw new HttpError(401, "API_KEY_SIGNATURE_REPLAY", "API key signature nonce already used");
    }

    throw error;
  }

  if (Math.random() < 0.02) {
    await authDb.delete(schema.apiKeyRequestNonces).where(lte(schema.apiKeyRequestNonces.expiresAt, input.now));
  }
};

export const verifyApiKeyRequestSignature = async (input: {
  request: FastifyRequest;
  keyId: string;
  secret: string;
}): Promise<void> => {
  const timestampHeader = toStringHeader(input.request.headers["x-api-key-timestamp"]);
  const nonce = toStringHeader(input.request.headers["x-api-key-nonce"]);
  const signature = normalizeSignature(toStringHeader(input.request.headers["x-api-key-signature"]));

  if (!timestampHeader || !nonce || !signature) {
    throw new HttpError(401, "API_KEY_SIGNATURE_REQUIRED", "Missing API key signature headers");
  }

  if (nonce.length < 12 || nonce.length > 120) {
    throw new HttpError(401, "API_KEY_SIGNATURE_INVALID", "Invalid API key nonce format");
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isInteger(timestamp) || timestamp <= 0) {
    throw new HttpError(401, "API_KEY_SIGNATURE_INVALID", "Invalid API key signature timestamp");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > backendEnv.apiKey.signatureTtlSeconds) {
    throw new HttpError(401, "API_KEY_SIGNATURE_EXPIRED", "API key signature timestamp outside allowed window", {
      nowSeconds,
      timestamp,
      allowedWindowSeconds: backendEnv.apiKey.signatureTtlSeconds,
    });
  }

  const path = (input.request.raw.url ?? input.request.url).split("?")[0] ?? input.request.url;
  const bodyHash = buildBodyHash(input.request);
  const payload = buildSignaturePayload({
    method: input.request.method,
    path,
    bodyHash,
    timestamp,
    nonce,
  });

  const expectedSignature = createHmac("sha256", deriveSigningKey(input.secret)).update(payload).digest("hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const receivedBuffer = Buffer.from(signature, "hex");
  const valid = expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);

  if (!valid) {
    throw new HttpError(401, "API_KEY_SIGNATURE_INVALID", "Invalid API key signature");
  }

  await verifyNonceUniqueness({
    keyId: input.keyId,
    nonce,
    now: new Date(),
  });
};
