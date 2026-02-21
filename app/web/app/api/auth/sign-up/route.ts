import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { proxyBackend } from "@/lib/server/backend-proxy";

const signUpSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8),
  callbackURL: z.string().trim().url().max(2048).optional(),
});

const sanitizeCallbackURL = (request: NextRequest, callbackURL: string | undefined): string | undefined => {
  if (!callbackURL) {
    return undefined;
  }

  try {
    const candidate = new URL(callbackURL);
    if (candidate.origin !== request.nextUrl.origin) {
      return undefined;
    }

    return candidate.toString();
  } catch {
    return undefined;
  }
};

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

  const safeCallbackURL = sanitizeCallbackURL(request, parsed.data.callbackURL);

  return proxyBackend({
    request,
    path: "/api/auth/sign-up/email",
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: {
      name: parsed.data.name,
      email: parsed.data.email,
      password: parsed.data.password,
      ...(safeCallbackURL ? { callbackURL: safeCallbackURL } : {}),
    },
  });
}
