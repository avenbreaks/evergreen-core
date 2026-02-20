import { NextRequest } from "next/server";

import { proxyBackend } from "@/lib/server/backend-proxy";

export async function POST(request: NextRequest) {
  return proxyBackend({
    request,
    path: "/api/auth/sign-out",
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: {},
  });
}
