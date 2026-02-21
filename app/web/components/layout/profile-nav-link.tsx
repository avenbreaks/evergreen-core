"use client";

import Link from "next/link";
import { useCallback, useRef } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { fetchForumPosts, fetchForumProfile, fetchMe, type ForumFeedPayload } from "@/lib/api-client";

export function ProfileNavLink() {
  const queryClient = useQueryClient();
  const prefetchedRef = useRef(false);

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
  });

  const profileHref = meQuery.data?.user?.id ? `/profile/${meQuery.data.user.id}` : "/profile/me";
  const profileUserId = meQuery.data?.user?.id;

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
    <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
      <Link
        href={profileHref}
        onMouseEnter={() => prefetchProfile()}
        onFocus={() => prefetchProfile()}
      >
        Profile
      </Link>
    </Button>
  );
}
