import { NextRequest } from "next/server";

import { proxyBackend } from "@/lib/server/backend-proxy";

export async function PATCH(request: NextRequest) {
  return proxyBackend({
    request,
    path: "/api/notifications/read-all",
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: {},
  });
}
