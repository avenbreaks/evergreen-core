import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { proxyBackend } from "@/lib/server/backend-proxy";

const signUpSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = signUpSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "VALIDATION_ERROR",
        message: "Invalid sign-up payload",
      },
      { status: 400 }
    );
  }

  return proxyBackend({
    request,
    path: "/api/auth/sign-up/email",
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: parsed.data,
  });
}
