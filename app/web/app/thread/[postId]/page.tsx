"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

import { type InfiniteData, type QueryKey, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowBigUp, Bookmark, Loader2, MessageSquare, Share2, UserPlus } from "lucide-react";

import { ViewerSummaryCard } from "@/components/auth/viewer-summary-card";
import { EvergreenHeader } from "@/components/layout/evergreen-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  createForumComment,
  fetchForumPostDetail,
  fetchMe,
  shareForumPost,
  toggleForumBookmark,
  toggleForumFollow,
  toggleForumReaction,
} from "@/lib/api-client";
import type { ForumPostDetailPayload } from "@/lib/api-client";

const truncateId = (value: string): string => `${value.slice(0, 6)}...${value.slice(-4)}`;

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

export default function ThreadDiscussionPage() {
  const params = useParams<{ postId: string }>();
  const postId = typeof params.postId === "string" ? params.postId : "";

  const queryClient = useQueryClient();
  const loadMoreCommentsRef = useRef<HTMLDivElement | null>(null);
  const [replyMarkdown, setReplyMarkdown] = useState("");
  const [replyMessage, setReplyMessage] = useState<string | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [likedPostOverride, setLikedPostOverride] = useState<boolean>(false);
  const [bookmarkedPostOverride, setBookmarkedPostOverride] = useState<boolean>(false);
  const [followingAuthorOverride, setFollowingAuthorOverride] = useState<boolean>(false);
  const [likedCommentOverrides, setLikedCommentOverrides] = useState<Record<string, boolean>>({});

  const mutateThreadCache = (updater: (payload: ForumPostDetailPayload) => ForumPostDetailPayload) => {
    const snapshots = queryClient.getQueriesData<InfiniteData<ForumPostDetailPayload>>({
      queryKey: ["forum-post-detail", postId],
    });

    snapshots.forEach(([key, snapshot]) => {
      if (!snapshot) {
        return;
      }

      queryClient.setQueryData<InfiniteData<ForumPostDetailPayload>>(key, {
        ...snapshot,
        pages: snapshot.pages.map((page) => updater(page)),
      });
    });

    return snapshots;
  };

  const restoreThreadSnapshots = (
    snapshots: Array<[QueryKey, InfiniteData<ForumPostDetailPayload> | undefined]> | undefined
  ) => {
    snapshots?.forEach(([key, snapshot]) => {
      queryClient.setQueryData(key, snapshot);
    });
  };

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
  });

  const detailQuery = useInfiniteQuery({
    queryKey: ["forum-post-detail", postId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      fetchForumPostDetail(postId, {
        commentsLimit: 20,
        commentsCursor: pageParam,
      }),
    enabled: Boolean(postId),
    getNextPageParam: (lastPage) => lastPage.commentsNextCursor || undefined,
  });

  const invalidateThread = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["forum-post-detail", postId] }),
      queryClient.invalidateQueries({ queryKey: ["forum-feed"] }),
    ]);
  };

  const commentMutation = useMutation({
    mutationFn: (payload: { markdown: string }) => createForumComment(postId, payload),
    onSuccess: async () => {
      setReplyError(null);
      setReplyMessage("Reply posted.");
      setReplyMarkdown("");
      await invalidateThread();
    },
    onError: (error) => {
      setReplyMessage(null);
      setReplyError(error instanceof Error ? error.message : "Failed to post reply");
    },
  });

  const postReactionMutation = useMutation({
    mutationFn: () =>
      toggleForumReaction({
        targetType: "post",
        targetId: postId,
        reactionType: "like",
      }),
    onMutate: async () => {
      setActionMessage(null);
      setActionError(null);

      const previousLiked = likedPostOverride;
      const nextLiked = !previousLiked;
      setLikedPostOverride(nextLiked);

      const snapshots = mutateThreadCache((page) => ({
        ...page,
        post: {
          ...page.post,
          reactionCount: Math.max(0, page.post.reactionCount + (nextLiked ? 1 : -1)),
        },
      }));

      return {
        snapshots,
        previousLiked,
      };
    },
    onSuccess: (payload) => {
      if (typeof payload?.active === "boolean") {
        setLikedPostOverride(payload.active);
      }

      setActionError(null);
      setActionMessage("Reaction updated.");
    },
    onError: (error, _variables, context) => {
      restoreThreadSnapshots(context?.snapshots);
      if (context) {
        setLikedPostOverride(context.previousLiked);
      }

      setActionMessage(null);
      setActionError(error instanceof Error ? error.message : "Could not react to post");
    },
    onSettled: async () => {
      await invalidateThread();
    },
  });

  const commentReactionMutation = useMutation({
    mutationFn: (commentId: string) =>
      toggleForumReaction({
        targetType: "comment",
        targetId: commentId,
        reactionType: "like",
      }),
    onMutate: async (commentId) => {
      setActionMessage(null);
      setActionError(null);

      const previousLiked = likedCommentOverrides[commentId] ?? false;
      const nextLiked = !previousLiked;
      setLikedCommentOverrides((current) => ({
        ...current,
        [commentId]: nextLiked,
      }));

      const snapshots = mutateThreadCache((page) => ({
        ...page,
        comments: page.comments.map((comment) =>
          comment.id === commentId
            ? {
                ...comment,
                reactionCount: Math.max(0, comment.reactionCount + (nextLiked ? 1 : -1)),
              }
            : comment
        ),
      }));

      return {
        commentId,
        snapshots,
        previousLiked,
      };
    },
    onSuccess: (payload, _commentId, context) => {
      if (typeof payload?.active === "boolean" && context) {
        setLikedCommentOverrides((current) => ({
          ...current,
          [context.commentId]: payload.active,
        }));
      }

      setActionError(null);
      setActionMessage("Comment reaction updated.");
    },
    onError: (error, _commentId, context) => {
      restoreThreadSnapshots(context?.snapshots);
      if (context) {
        setLikedCommentOverrides((current) => ({
          ...current,
          [context.commentId]: context.previousLiked,
        }));
      }

      setActionMessage(null);
      setActionError(error instanceof Error ? error.message : "Could not react to comment");
    },
    onSettled: async () => {
      await invalidateThread();
    },
  });

  const shareMutation = useMutation({
    mutationFn: () => shareForumPost({ postId }),
    onMutate: async () => {
      setActionMessage(null);
      setActionError(null);

      const snapshots = mutateThreadCache((page) => ({
        ...page,
        post: {
          ...page.post,
          shareCount: Math.max(0, page.post.shareCount + 1),
        },
      }));

      return { snapshots };
    },
    onSuccess: () => {
      setActionError(null);
      setActionMessage("Post shared.");
    },
    onError: (error, _variables, context) => {
      restoreThreadSnapshots(context?.snapshots);
      setActionMessage(null);
      setActionError(error instanceof Error ? error.message : "Could not share post");
    },
    onSettled: async () => {
      await invalidateThread();
    },
  });

  const bookmarkMutation = useMutation({
    mutationFn: () => toggleForumBookmark({ postId }),
    onMutate: async () => {
      setActionMessage(null);
      setActionError(null);

      const previousBookmarked = bookmarkedPostOverride;
      const nextBookmarked = !previousBookmarked;
      setBookmarkedPostOverride(nextBookmarked);

      const snapshots = mutateThreadCache((page) => ({
        ...page,
        post: {
          ...page.post,
          bookmarkCount: Math.max(0, page.post.bookmarkCount + (nextBookmarked ? 1 : -1)),
        },
      }));

      return {
        snapshots,
        previousBookmarked,
      };
    },
    onSuccess: (payload) => {
      if (typeof payload?.bookmarked === "boolean") {
        setBookmarkedPostOverride(payload.bookmarked);
      }

      setActionError(null);
      setActionMessage("Bookmark updated.");
    },
    onError: (error, _variables, context) => {
      restoreThreadSnapshots(context?.snapshots);
      if (context) {
        setBookmarkedPostOverride(context.previousBookmarked);
      }

      setActionMessage(null);
      setActionError(error instanceof Error ? error.message : "Could not toggle bookmark");
    },
    onSettled: async () => {
      await invalidateThread();
    },
  });

  const followMutation = useMutation({
    mutationFn: (followeeUserId: string) => toggleForumFollow({ followeeUserId }),
    onMutate: async () => {
      setActionMessage(null);
      setActionError(null);

      const previousFollowing = followingAuthorOverride;
      const nextFollowing = !previousFollowing;
      setFollowingAuthorOverride(nextFollowing);

      return { previousFollowing };
    },
    onSuccess: (payload) => {
      if (typeof payload?.following === "boolean") {
        setFollowingAuthorOverride(payload.following);
      }

      setActionError(null);
      setActionMessage("Follow updated.");
    },
    onError: (error, _followeeUserId, context) => {
      if (context) {
        setFollowingAuthorOverride(context.previousFollowing);
      }

      setActionMessage(null);
      setActionError(error instanceof Error ? error.message : "Could not follow author");
    },
    onSettled: async () => {
      await invalidateThread();
    },
  });

  const submitReply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setReplyMessage(null);
    setReplyError(null);
    commentMutation.mutate({ markdown: replyMarkdown });
  };

  const threadPost = detailQuery.data?.pages[0]?.post;
  const threadComments = useMemo(() => {
    const seen = new Set<string>();
    return (detailQuery.data?.pages ?? [])
      .flatMap((page) => page.comments)
      .filter((comment) => {
        if (seen.has(comment.id)) {
          return false;
        }

        seen.add(comment.id);
        return true;
      });
  }, [detailQuery.data?.pages]);

  const hasNextCommentPage = detailQuery.hasNextPage;
  const isFetchingNextCommentPage = detailQuery.isFetchingNextPage;
  const fetchNextCommentPage = detailQuery.fetchNextPage;

  useEffect(() => {
    const target = loadMoreCommentsRef.current;
    if (!target || !hasNextCommentPage || isFetchingNextCommentPage) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void fetchNextCommentPage();
        }
      },
      { rootMargin: "320px" }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [fetchNextCommentPage, hasNextCommentPage, isFetchingNextCommentPage]);

  const viewerId = meQuery.data?.user?.id;
  const threadBody = threadPost?.contentMarkdown?.trim() || threadPost?.contentPlaintext?.trim() || "";

  return (
    <div className="min-h-screen">
      <div className="grid-atmosphere fixed inset-0 -z-10 opacity-30" />
      <EvergreenHeader />

      <main className="mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-6 px-4 pb-12 pt-6 xl:grid-cols-[1fr_320px] sm:px-6 lg:px-8">
        <section className="space-y-6">
          <Card className="border-border bg-card/90">
            <CardHeader className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Home</span>
                <span>•</span>
                <span>Forum</span>
                <span>•</span>
                <span>Thread</span>
              </div>

              <CardTitle className="text-3xl leading-tight">
                {threadPost?.title || "Thread not selected"}
              </CardTitle>
              <CardDescription>
                Live thread details from `/api/forum/posts/:postId` with full post/comment content.
              </CardDescription>

              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  {(threadPost
                    ? [
                        `id:${threadPost.id.slice(0, 8)}`,
                        `slug:${threadPost.slug.slice(0, 16)}`,
                        `author:${truncateId(threadPost.authorId)}`,
                      ]
                    : ["thread", "live-data", "forum"]
                  ).map((tag) => (
                    <Badge key={tag} variant="outline" className="border-border bg-background">
                      {tag}
                    </Badge>
                  ))}
                </div>
                {threadPost && viewerId && viewerId !== threadPost.authorId ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 border-border bg-background px-2 text-xs hover:bg-secondary/60"
                    disabled={followMutation.isPending && followMutation.variables === threadPost.authorId}
                    onClick={() => followMutation.mutate(threadPost.authorId)}
                  >
                    {followMutation.isPending && followMutation.variables === threadPost.authorId ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <UserPlus className="size-3.5" />
                    )}
                    {followingAuthorOverride ? "Following" : "Follow"}
                  </Button>
                ) : null}
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {detailQuery.isPending ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading thread detail...
                </div>
              ) : null}

              {detailQuery.isError ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                  {detailQuery.error instanceof Error ? detailQuery.error.message : "Could not load thread details"}
                </div>
              ) : null}

              {actionError ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                  {actionError}
                </div>
              ) : null}
              {actionMessage ? (
                <div className="rounded-md border border-primary/40 bg-primary/10 p-2 text-xs text-primary">{actionMessage}</div>
              ) : null}

              <div className="rounded-lg border border-border bg-background p-4">
                {threadBody ? (
                  <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-foreground">{threadBody}</pre>
                ) : (
                  <p className="text-xs text-muted-foreground">Post body is empty.</p>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-border pt-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-4">
                  <button
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    onClick={() => postReactionMutation.mutate()}
                    disabled={postReactionMutation.isPending || !threadPost}
                  >
                    {postReactionMutation.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ArrowBigUp className={`size-4 ${likedPostOverride ? "text-primary" : ""}`} />
                    )}
                    {threadPost?.reactionCount ?? 0}
                  </button>
                  <span className="inline-flex items-center gap-1">
                    <MessageSquare className="size-4" />
                    {threadPost?.commentCount ?? threadComments.length} comments
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    onClick={() => bookmarkMutation.mutate()}
                    disabled={bookmarkMutation.isPending || !threadPost}
                  >
                    {bookmarkMutation.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Bookmark className={`size-4 ${bookmarkedPostOverride ? "text-primary" : ""}`} />
                    )}
                    {threadPost?.bookmarkCount ?? 0}
                  </button>
                  <button
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    onClick={() => shareMutation.mutate()}
                    disabled={shareMutation.isPending || !threadPost}
                  >
                    {shareMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Share2 className="size-4" />}
                    {threadPost?.shareCount ?? 0}
                  </button>
                  <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground">
                    <Link href="/feed">Back to Feed</Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card/90">
            <CardHeader>
              <CardTitle className="text-lg">Add to discussion</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={submitReply}>
                <Textarea
                  className="min-h-[120px] border-border bg-background/70"
                  placeholder="Add your reasoning and include snippets if needed..."
                  value={replyMarkdown}
                  onChange={(event) => setReplyMarkdown(event.target.value)}
                  required
                  disabled={!threadPost || commentMutation.isPending}
                />
                {replyError ? (
                  <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{replyError}</p>
                ) : null}
                {replyMessage ? <p className="rounded-md border border-primary/40 bg-primary/10 p-2 text-xs text-primary">{replyMessage}</p> : null}
                <div className="flex justify-end">
                  <Button className="bg-primary text-primary-foreground hover:bg-primary/90" disabled={!threadPost || commentMutation.isPending}>
                    {commentMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                    Post reply
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="space-y-4">
            {!detailQuery.isPending && !detailQuery.isError && threadComments.length === 0 ? (
              <Card className="border-border bg-card/90">
                <CardContent className="p-5 text-sm text-muted-foreground">No replies yet. Be the first to comment.</CardContent>
              </Card>
            ) : null}

            {threadComments.map((comment) => (
              <Card key={comment.id} id={`comment-${comment.id}`} className="border-border bg-card/90">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{truncateId(comment.authorId)}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p className="whitespace-pre-wrap break-words text-foreground">
                    {comment.contentMarkdown?.trim() || comment.contentPlaintext?.trim() || "(empty comment)"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    depth {comment.depth} · replies {comment.replyCount} · {formatRelative(comment.createdAt)}
                  </p>
                  <button
                    className="inline-flex items-center gap-1 text-xs hover:text-foreground"
                    onClick={() => commentReactionMutation.mutate(comment.id)}
                    disabled={commentReactionMutation.isPending && commentReactionMutation.variables === comment.id}
                  >
                    {commentReactionMutation.isPending && commentReactionMutation.variables === comment.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ArrowBigUp className={`size-4 ${likedCommentOverrides[comment.id] ? "text-primary" : ""}`} />
                    )}
                    {comment.reactionCount}
                  </button>
                </CardContent>
              </Card>
            ))}

            {hasNextCommentPage ? (
              <div ref={loadMoreCommentsRef} className="py-1">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-border bg-card/80 text-muted-foreground hover:bg-card"
                  disabled={isFetchingNextCommentPage}
                  onClick={() => void fetchNextCommentPage()}
                >
                  {isFetchingNextCommentPage ? <Loader2 className="size-4 animate-spin" /> : null}
                  Load more comments
                </Button>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="space-y-4">
          <ViewerSummaryCard />

          <Card className="border-border bg-card/90">
            <CardHeader>
              <CardTitle className="text-base">Related threads</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>Understanding referential equality in JavaScript</p>
              <p>Why does `useEffect` run twice in Strict Mode?</p>
              <p>Best practices for large React context providers</p>
            </CardContent>
          </Card>
        </aside>
      </main>
    </div>
  );
}
