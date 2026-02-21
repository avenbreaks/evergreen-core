"use client";

import { useEffect } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchSession } from "@/lib/api-client";

export function NotificationsRealtimeBridge() {
  const queryClient = useQueryClient();

  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: fetchSession,
  });

  const isAuthenticated = Boolean(sessionQuery.data?.user?.id);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const source = new EventSource("/api/notifications/stream");

    const onNotificationEvent = () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    };

    source.addEventListener("notifications", onNotificationEvent);

    return () => {
      source.removeEventListener("notifications", onNotificationEvent);
      source.close();
    };
  }, [isAuthenticated, queryClient]);

  return null;
}
