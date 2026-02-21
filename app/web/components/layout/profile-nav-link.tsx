"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useRef } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { User } from "lucide-react";

import { fetchForumPosts, fetchForumProfile, fetchMe, type ForumFeedPayload } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type ProfileNavLinkProps = {
  className?: string;
};

export function ProfileNavLink({ className }: ProfileNavLinkProps) {
  const pathname = usePathname();
  const currentPath = pathname ?? "";
  const queryClient = useQueryClient();
  const prefetchedRef = useRef(false);

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
  });

  const profileHref = meQuery.data?.user?.id ? `/profile/${meQuery.data.user.id}` : "/profile/me";
  const profileUserId = meQuery.data?.user?.id;
  const isActive = currentPath.startsWith("/profile");

  const prefetchProfile = useCallback(() => {
    if (!profileUserId || prefetchedRef.current) {
      return;
    }

    prefetchedRef.current = true;
    void queryClient.prefetchQuery({
      queryKey: ["forum-profile", profileUserId],
      queryFn: () => fetchForumProfile(profileUserId),
    });

    void queryClient.prefetchInfiniteQuery({
      queryKey: ["forum-posts", "author", profileUserId],
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) =>
        fetchForumPosts({
          authorId: profileUserId,
          limit: 12,
          cursor: pageParam,
        }),
      getNextPageParam: (lastPage: ForumFeedPayload) => lastPage.nextCursor || undefined,
    });
  }, [profileUserId, queryClient]);

  return (
    <Link
      href={profileHref}
      onMouseEnter={() => prefetchProfile()}
      onFocus={() => prefetchProfile()}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition",
        isActive ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-background hover:text-foreground",
        className
      )}
    >
      <User className="size-3.5" />
      <span>Profile</span>
    </Link>
  );
}
