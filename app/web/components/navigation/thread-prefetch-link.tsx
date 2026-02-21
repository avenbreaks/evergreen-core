"use client";

import Link from "next/link";
import { useCallback, useRef, type ComponentProps } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { fetchForumPostDetail, type ForumPostDetailPayload } from "@/lib/api-client";

type ThreadPrefetchLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  postId: string;
};

export function ThreadPrefetchLink({ postId, onMouseEnter, onFocus, ...props }: ThreadPrefetchLinkProps) {
  const queryClient = useQueryClient();
  const prefetchedRef = useRef(false);

  const prefetchThread = useCallback(() => {
    if (!postId || prefetchedRef.current) {
      return;
    }

    prefetchedRef.current = true;
    void queryClient.prefetchInfiniteQuery({
      queryKey: ["forum-post-detail", postId],
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) =>
        fetchForumPostDetail(postId, {
          commentsLimit: 20,
          commentsCursor: pageParam,
        }),
      getNextPageParam: (lastPage: ForumPostDetailPayload) => lastPage.commentsNextCursor || undefined,
    });
  }, [postId, queryClient]);

  return (
    <Link
      {...props}
      href={`/thread/${postId}`}
      onMouseEnter={(event) => {
        prefetchThread();
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        prefetchThread();
        onFocus?.(event);
      }}
    />
  );
}
