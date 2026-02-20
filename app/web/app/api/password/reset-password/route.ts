import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { proxyBackend } from "@/lib/server/backend-proxy";

const resetPasswordSchema = z.object({
  token: z.string().trim().min(8).max(256),
  newPassword: z.string().min(8).max(256),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = resetPasswordSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "VALIDATION_ERROR",
        message: "Invalid reset-password payload",
      },
      { status: 400 }
    );
  }

  return proxyBackend({
    request,
    path: "/api/password/reset-password",
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: parsed.data,
  });
}
