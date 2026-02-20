import type { FastifyReply, FastifyRequest } from "fastify";

import { auth } from "@evergreen-devparty/auth";

const WITHOUT_BODY_METHODS = new Set(["GET", "HEAD"]);

const toStringHeader = (value: string | string[] | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  return Array.isArray(value) ? value.join(",") : value;
};

const buildForwardHeaders = (request: FastifyRequest): Headers => {
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

  return headers;
};

const resolveAuthUrl = (request: FastifyRequest, targetPath?: string): URL => {
  const protocol = request.protocol;
  const host = toStringHeader(request.headers.host) ?? "localhost";
  if (targetPath) {
    return new URL(targetPath, `${protocol}://${host}`);
  }

  return new URL(request.raw.url ?? request.url, `${protocol}://${host}`);
};

const toRequestBody = (body: unknown, headers: Headers): BodyInit | undefined => {
  if (body === undefined) {
    return undefined;
  }

  if (typeof body === "string" || body instanceof Buffer) {
    return body;
  }

  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return JSON.stringify(body);
};

export const buildAuthForwardRequest = (input: {
  request: FastifyRequest;
  targetPath?: string;
  method?: string;
  body?: unknown;
}): Request => {
  const method = input.method ?? input.request.method;
  const url = resolveAuthUrl(input.request, input.targetPath);
  const headers = buildForwardHeaders(input.request);

  if (WITHOUT_BODY_METHODS.has(method.toUpperCase())) {
    return new Request(url, {
      method,
      headers,
    });
  }

  const hasBodyOverride = input.body !== undefined;
  const body =
    input.body !== undefined
      ? toRequestBody(input.body, headers)
      : toRequestBody(
          typeof input.request.body === "string" || input.request.body instanceof Buffer
            ? input.request.body
            : input.request.body,
          headers
        );

  if (hasBodyOverride) {
    headers.delete("content-length");
  }

  return new Request(url, {
    method,
    headers,
    body,
  });
};

export const sendAuthForwardResponse = async (reply: FastifyReply, response: Response): Promise<void> => {
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

export const forwardAuthRequest = async (input: {
  request: FastifyRequest;
  reply: FastifyReply;
  targetPath?: string;
  method?: string;
  body?: unknown;
}): Promise<void> => {
  const authRequest = buildAuthForwardRequest({
    request: input.request,
    targetPath: input.targetPath,
    method: input.method,
    body: input.body,
  });

  const authResponse = await auth.handler(authRequest);
  await sendAuthForwardResponse(input.reply, authResponse);
};
