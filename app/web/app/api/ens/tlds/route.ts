import { NextRequest } from "next/server";

import { proxyBackend } from "@/lib/server/backend-proxy";

export async function GET(request: NextRequest) {
  return proxyBackend({
    request,
    path: "/api/ens/tlds",
    method: "GET",
  });
}
