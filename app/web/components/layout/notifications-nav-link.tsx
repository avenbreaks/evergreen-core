"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";

import { fetchForumNotifications, fetchSession } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type NotificationsNavLinkProps = {
  className?: string;
};

export function NotificationsNavLink({ className }: NotificationsNavLinkProps) {
  const pathname = usePathname();
  const currentPath = pathname ?? "";
  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: fetchSession,
  });

  const isAuthenticated = Boolean(sessionQuery.data?.user?.id);

  const notificationsQuery = useQuery({
    queryKey: ["notifications", "header-unread"],
    queryFn: () =>
      fetchForumNotifications({
        limit: 200,
        unreadOnly: true,
      }),
    enabled: isAuthenticated,
    retry: false,
  });

  const unreadCount = notificationsQuery.data?.notifications.length ?? 0;
  const unreadLabel = unreadCount >= 200 ? "200+" : String(unreadCount);
  const isActive = currentPath === "/notifications";

  return (
    <Link
      href="/notifications"
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition",
        isActive ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-background hover:text-foreground",
        className
      )}
    >
      <Bell className="size-3.5" />
      <span>Notifications</span>
      {isAuthenticated && unreadCount > 0 ? (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-primary/30 bg-primary/15 px-1.5 text-[11px] font-semibold leading-none text-primary">
          {unreadLabel}
        </span>
      ) : null}
    </Link>
  );
}
