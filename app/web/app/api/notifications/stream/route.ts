import { NextRequest } from "next/server";

import { proxyBackendStream } from "@/lib/server/backend-proxy";

export async function GET(request: NextRequest) {
  return proxyBackendStream({
    request,
    path: "/api/notifications/stream",
  });
}
