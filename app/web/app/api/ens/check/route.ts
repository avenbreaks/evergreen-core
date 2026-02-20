import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { proxyBackend } from "@/lib/server/backend-proxy";

const ensCheckSchema = z.object({
  label: z.string().trim().min(3).max(63),
  tld: z.string().trim().min(2).max(64),
  durationSeconds: z.number().int().positive().optional(),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = ensCheckSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "VALIDATION_ERROR",
        message: "Invalid ENS check payload",
      },
      { status: 400 }
    );
  }

  return proxyBackend({
    request,
    path: "/api/ens/check",
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: parsed.data,
  });
}
