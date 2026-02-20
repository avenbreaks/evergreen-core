import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { proxyBackend } from "@/lib/server/backend-proxy";

const forgotPasswordSchema = z.object({
  email: z.string().trim().email(),
  redirectTo: z.string().trim().url().optional(),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = forgotPasswordSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "VALIDATION_ERROR",
        message: "Invalid forgot-password payload",
      },
      { status: 400 }
    );
  }

  return proxyBackend({
    request,
    path: "/api/password/forgot-password",
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: parsed.data,
  });
}
