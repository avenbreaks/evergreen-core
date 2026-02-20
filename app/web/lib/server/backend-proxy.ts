import { NextRequest, NextResponse } from "next/server";

const HOP_BY_HOP_HEADERS = new Set(["connection", "transfer-encoding", "content-length", "keep-alive", "host"]);

export const resolveBackendUrl = (): string =>
  process.env.BACKEND_URL?.trim() || process.env.NEXT_PUBLIC_BACKEND_URL?.trim() || "http://localhost:3001";

export const buildBackendHeaders = (request: NextRequest, extraHeaders?: HeadersInit): Headers => {
  const headers = new Headers(extraHeaders);

  const cookie = request.headers.get("cookie");
  if (cookie) {
    headers.set("cookie", cookie);
  }

  if (!headers.has("origin")) {
    headers.set("origin", request.nextUrl.origin);
  }

  headers.set("accept", "application/json");
  return headers;
};

export const toNextResponse = async (response: Response): Promise<NextResponse> => {
  const body = await response.arrayBuffer();
  const proxied = new NextResponse(body, {
    status: response.status,
  });

  for (const [key, value] of response.headers.entries()) {
    const normalized = key.toLowerCase();
    if (normalized === "set-cookie" || HOP_BY_HOP_HEADERS.has(normalized)) {
      continue;
    }

    proxied.headers.set(key, value);
  }

  const setCookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const cookie of setCookies) {
    proxied.headers.append("set-cookie", cookie);
  }

  return proxied;
};

export const proxyBackend = async (input: {
  request: NextRequest;
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: HeadersInit;
}): Promise<NextResponse> => {
  const backendUrl = resolveBackendUrl();
  const method = input.method ?? "GET";
  const headers = buildBackendHeaders(input.request, input.headers);

  const response = await fetch(`${backendUrl}${input.path}`, {
    method,
    headers,
    cache: "no-store",
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });

  return toNextResponse(response);
};
