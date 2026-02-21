"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellDot, CheckCheck, Loader2 } from "lucide-react";

import { EvergreenHeader } from "@/components/layout/evergreen-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fetchSession,
  fetchForumNotifications,
  markAllForumNotificationsRead,
  markForumNotificationRead,
  type ForumNotification,
} from "@/lib/api-client";

const notificationMessage = (notification: ForumNotification): string => {
  switch (notification.type) {
    case "mention":
      return "You were mentioned in a discussion.";
    case "reply":
      return "Someone replied to your thread/comment.";
    case "reaction":
      return "Your content received a new reaction.";
    case "follow":
      return "You have a new follower.";
    case "share":
      return "Your post was shared.";
    case "report_update":
      return "A moderation report status changed.";
    default:
      return "You have a new notification.";
  }
};

const notificationHref = (notification: ForumNotification): string => {
  if (notification.postId && notification.commentId) {
    return `/thread/${notification.postId}#comment-${notification.commentId}`;
  }

  if (notification.postId) {
    return `/thread/${notification.postId}`;
  }

  return "/feed";
};

const formatRelative = (value: string): string => {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(1, Math.floor(diffMs / (1000 * 60)));

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  return `${Math.floor(diffHours / 24)}d ago`;
};

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: fetchSession,
  });

  const isAuthenticated = Boolean(sessionQuery.data?.user?.id);

  const notificationsQuery = useInfiniteQuery({
    queryKey: ["notifications", unreadOnly],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      fetchForumNotifications({
        limit: 25,
        cursor: pageParam,
        unreadOnly,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    enabled: isAuthenticated,
    retry: false,
  });

  const markReadMutation = useMutation({
    mutationFn: (notificationId: string) => markForumNotificationRead(notificationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => markAllForumNotificationsRead(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const notifications = useMemo(() => {
    if (!isAuthenticated) {
      return [] as ForumNotification[];
    }

    const seen = new Set<string>();
    return (notificationsQuery.data?.pages ?? [])
      .flatMap((page) => page.notifications)
      .filter((notification) => {
        if (seen.has(notification.id)) {
          return false;
        }

        seen.add(notification.id);
        return true;
      });
  }, [isAuthenticated, notificationsQuery.data?.pages]);

  const hasNextPage = notificationsQuery.hasNextPage;
  const isFetchingNextPage = notificationsQuery.isFetchingNextPage;
  const fetchNextPage = notificationsQuery.fetchNextPage;

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasNextPage || isFetchingNextPage) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void fetchNextPage();
        }
      },
      { rootMargin: "320px" }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  return (
    <div className="min-h-screen">
      <div className="grid-atmosphere fixed inset-0 -z-10 opacity-30" />
      <EvergreenHeader />

      <main className="mx-auto w-full max-w-5xl px-4 pb-12 pt-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="flex items-center gap-2 text-3xl font-black tracking-tight">
              Notification Center
              <Badge className="border border-primary/30 bg-primary/10 text-primary">{unreadCount} unread</Badge>
            </h1>
            <p className="text-sm text-muted-foreground">
              {isAuthenticated ? "Infinite list with cursor pagination from backend notifications." : "Sign in to view your notifications."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="border-border bg-background hover:bg-secondary/60"
              disabled={!isAuthenticated || unreadCount === 0 || markAllReadMutation.isPending}
              onClick={() => markAllReadMutation.mutate()}
            >
              {markAllReadMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}
              Mark all read
            </Button>

            <Button
              variant={unreadOnly ? "default" : "outline"}
              className={unreadOnly ? "bg-primary text-primary-foreground" : "border-border bg-background hover:bg-secondary/60"}
              disabled={!isAuthenticated}
              onClick={() => setUnreadOnly((value) => !value)}
            >
              {unreadOnly ? <BellDot className="size-4" /> : <Bell className="size-4" />}
              {unreadOnly ? "Showing unread only" : "Show unread only"}
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          {!sessionQuery.isPending && !isAuthenticated ? (
            <Card className="border-border bg-card/90">
              <CardContent className="p-6 text-sm text-muted-foreground">
                You need to sign in first. Use the <strong>Sign in</strong> button in the header to load your notification center.
              </CardContent>
            </Card>
          ) : null}

          {isAuthenticated && notificationsQuery.isPending ? (
            <Card className="border-border bg-card/90">
              <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading notifications...
              </CardContent>
            </Card>
          ) : null}

          {isAuthenticated && notificationsQuery.isError ? (
            <Card className="border-destructive/40 bg-destructive/10">
              <CardContent className="p-6 text-sm text-destructive">
                {notificationsQuery.error instanceof Error ? notificationsQuery.error.message : "Failed to load notifications"}
              </CardContent>
            </Card>
          ) : null}

          {isAuthenticated && !notificationsQuery.isPending && !notificationsQuery.isError && notifications.length === 0 ? (
            <Card className="border-border bg-card/90">
              <CardContent className="p-6 text-sm text-muted-foreground">No notifications in this filter yet.</CardContent>
            </Card>
          ) : null}

          {isAuthenticated && notifications.map((notification) => {
            const isUnread = !notification.readAt;

            return (
              <Card
                key={notification.id}
                className={
                  isUnread
                    ? "border-primary/30 bg-primary/10"
                    : "border-border bg-card/90"
                }
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">{notificationMessage(notification)}</CardTitle>
                    <Badge variant="outline" className="border-border bg-background text-xs text-muted-foreground">
                      {notification.type}
                    </Badge>
                  </div>
                  <CardDescription>{formatRelative(notification.createdAt)}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center justify-between gap-2">
                  <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground">
                    <Link href={notificationHref(notification)}>Open context</Link>
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                    disabled={!isUnread || (markReadMutation.isPending && markReadMutation.variables === notification.id)}
                    onClick={() => markReadMutation.mutate(notification.id)}
                  >
                    {markReadMutation.isPending && markReadMutation.variables === notification.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <CheckCheck className="size-4" />
                    )}
                    Mark read
                  </Button>
                </CardContent>
              </Card>
            );
          })}

          {isAuthenticated && hasNextPage ? (
            <div ref={loadMoreRef} className="py-1">
              <Button
                type="button"
                variant="outline"
                className="w-full border-border bg-card/80 text-muted-foreground hover:bg-card"
                disabled={isFetchingNextPage}
                onClick={() => void fetchNextPage()}
              >
                {isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : null}
                Load more notifications
              </Button>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
