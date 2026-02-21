import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { proxyBackend } from "@/lib/server/backend-proxy";

const linkWalletSchema = z.object({
  message: z.string().min(1),
  signature: z.string().min(1),
  setAsPrimary: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = linkWalletSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "VALIDATION_ERROR",
        message: "Invalid wallet-link payload",
      },
      { status: 400 }
    );
  }

  return proxyBackend({
    request,
    path: "/api/me/wallets/link",
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: parsed.data,
  });
}
