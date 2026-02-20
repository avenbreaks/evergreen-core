import { NextRequest, NextResponse } from "next/server";

import { proxyBackend } from "@/lib/server/backend-proxy";

type ForumRouteContext = {
  params: Promise<{
    path: string[];
  }>;
};

const buildForumPath = async (request: NextRequest, context: ForumRouteContext): Promise<string> => {
  const { path } = await context.params;
  const suffix = path.length > 0 ? `/${path.join("/")}` : "";
  const query = request.nextUrl.searchParams.toString();
  return `/api/forum${suffix}${query ? `?${query}` : ""}`;
};

const parseBodyOrError = async (request: NextRequest): Promise<{ body?: unknown; response?: NextResponse }> => {
  const body = await request.json().catch(() => undefined);
  if (body === undefined) {
    return {
      response: NextResponse.json(
        {
          code: "VALIDATION_ERROR",
          message: "Invalid JSON payload",
        },
        { status: 400 }
      ),
    };
  }

  return { body };
};

export async function GET(request: NextRequest, context: ForumRouteContext) {
  const path = await buildForumPath(request, context);
  return proxyBackend({
    request,
    path,
    method: "GET",
  });
}

export async function DELETE(request: NextRequest, context: ForumRouteContext) {
  const path = await buildForumPath(request, context);
  return proxyBackend({
    request,
    path,
    method: "DELETE",
  });
}

export async function POST(request: NextRequest, context: ForumRouteContext) {
  const path = await buildForumPath(request, context);
  const parsed = await parseBodyOrError(request);
  if (parsed.response) {
    return parsed.response;
  }

  return proxyBackend({
    request,
    path,
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: parsed.body,
  });
}

export async function PUT(request: NextRequest, context: ForumRouteContext) {
  const path = await buildForumPath(request, context);
  const parsed = await parseBodyOrError(request);
  if (parsed.response) {
    return parsed.response;
  }

  return proxyBackend({
    request,
    path,
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: parsed.body,
  });
}

export async function PATCH(request: NextRequest, context: ForumRouteContext) {
  const path = await buildForumPath(request, context);
  const parsed = await parseBodyOrError(request);
  if (parsed.response) {
    return parsed.response;
  }

  return proxyBackend({
    request,
    path,
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: parsed.body,
  });
}
