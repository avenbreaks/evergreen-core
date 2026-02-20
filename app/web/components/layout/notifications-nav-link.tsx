"use client";

import Link from "next/link";

import { useQuery } from "@tanstack/react-query";

import { fetchForumNotifications } from "@/lib/api-client";

export function NotificationsNavLink() {
  const notificationsQuery = useQuery({
    queryKey: ["notifications", "header-unread"],
    queryFn: () =>
      fetchForumNotifications({
        limit: 200,
        unreadOnly: true,
      }),
    refetchInterval: 15_000,
    retry: false,
  });

  const unreadCount = notificationsQuery.data?.notifications.length ?? 0;
  const unreadLabel = unreadCount >= 200 ? "200+" : String(unreadCount);

  return (
    <Link href="/notifications" className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
      <span>Notifications</span>
      {unreadCount > 0 ? (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-primary/30 bg-primary/15 px-1.5 text-[11px] font-semibold leading-none text-primary">
          {unreadLabel}
        </span>
      ) : null}
    </Link>
  );
}
