import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { auth } from "@evergreen-devparty/auth";

const withoutBody = new Set(["GET", "HEAD"]);

const toStringHeader = (value: string | string[] | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  return Array.isArray(value) ? value.join(",") : value;
};

const buildAuthRequest = (request: FastifyRequest): Request => {
  const protocol = request.protocol;
  const host = toStringHeader(request.headers.host) ?? "localhost";
  const url = new URL(request.raw.url ?? request.url, `${protocol}://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (key === "host" || value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
      continue;
    }

    headers.set(key, value);
  }

  if (withoutBody.has(request.method)) {
    return new Request(url, { method: request.method, headers });
  }

  if (typeof request.body === "string" || request.body instanceof Buffer) {
    return new Request(url, {
      method: request.method,
      headers,
      body: request.body,
    });
  }

  const bodyJson = request.body === undefined ? undefined : JSON.stringify(request.body);
  if (bodyJson && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return new Request(url, {
    method: request.method,
    headers,
    body: bodyJson,
  });
};

const sendAuthResponse = async (reply: FastifyReply, response: Response): Promise<void> => {
  reply.status(response.status);

  const setCookieHeader = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  if (setCookieHeader && setCookieHeader.length > 0) {
    reply.header("set-cookie", setCookieHeader);
  }

  for (const [key, value] of response.headers.entries()) {
    if (key === "set-cookie") {
      continue;
    }

    reply.header(key, value);
  }

  if (response.status === 204 || response.status === 304) {
    reply.send();
    return;
  }

  const body = Buffer.from(await response.arrayBuffer());
  reply.send(body);
};

const forwardRequest = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  try {
    const authRequest = buildAuthRequest(request);
    const authResponse = await auth.handler(authRequest);
    await sendAuthResponse(reply, authResponse);
  } catch (error) {
    request.log.error({ err: error }, "Better Auth bridge failed");
    if (!reply.sent) {
      reply.status(500).send({ code: "AUTH_BRIDGE_ERROR", message: "Auth handler failed" });
    }
  }
};

export const authBridgeRoutes: FastifyPluginAsync = async (app) => {
  app.all("/api/auth", forwardRequest);
  app.all("/api/auth/*", forwardRequest);
};
