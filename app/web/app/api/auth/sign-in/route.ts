import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { proxyBackend } from "@/lib/server/backend-proxy";

const signInSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = signInSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "VALIDATION_ERROR",
        message: "Invalid sign-in payload",
      },
      { status: 400 }
    );
  }

  return proxyBackend({
    request,
    path: "/api/auth/sign-in/email",
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: parsed.data,
  });
}
