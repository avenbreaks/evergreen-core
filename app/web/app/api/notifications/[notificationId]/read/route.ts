import { NextRequest, NextResponse } from "next/server";

import { proxyBackend } from "@/lib/server/backend-proxy";

type NotificationReadContext = {
  params: Promise<{
    notificationId: string;
  }>;
};

export async function PATCH(request: NextRequest, context: NotificationReadContext) {
  const { notificationId } = await context.params;
  if (!notificationId) {
    return NextResponse.json(
      {
        code: "VALIDATION_ERROR",
        message: "Notification ID is required",
      },
      { status: 400 }
    );
  }

  return proxyBackend({
    request,
    path: `/api/notifications/${notificationId}/read`,
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: {},
  });
}
