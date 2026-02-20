import { NextRequest } from "next/server";

import { proxyBackend } from "@/lib/server/backend-proxy";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.toString();
  return proxyBackend({
    request,
    path: `/api/notifications${query ? `?${query}` : ""}`,
    method: "GET",
  });
}
