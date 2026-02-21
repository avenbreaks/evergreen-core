import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { proxyBackend } from "@/lib/server/backend-proxy";

const sendVerificationSchema = z.object({
  email: z.string().trim().email(),
  callbackURL: z.string().trim().url().max(2048).optional(),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = sendVerificationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "VALIDATION_ERROR",
        message: "Invalid email verification payload",
      },
      { status: 400 }
    );
  }

  return proxyBackend({
    request,
    path: "/api/email-verification/send",
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: parsed.data,
  });
}
