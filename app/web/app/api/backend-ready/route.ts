import { NextResponse } from "next/server";

const resolveBackendUrl = (): string =>
  process.env.NEXT_PUBLIC_BACKEND_URL?.trim() || process.env.BACKEND_URL?.trim() || "http://localhost:3001";

export async function GET() {
  const backendUrl = resolveBackendUrl();

  try {
    const response = await fetch(`${backendUrl}/readyz`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          backendUrl,
          status: `http_${response.status}`,
        },
        { status: 503 }
      );
    }

    const payload = (await response.json()) as { status?: string };

    return NextResponse.json({
      ok: true,
      backendUrl,
      status: payload.status ?? "ready",
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        backendUrl,
        status: "unreachable",
      },
      { status: 503 }
    );
  }
}
