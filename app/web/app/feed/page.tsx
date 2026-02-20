"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Loader2, MessageCircle, Plus, Search, Share2, ThumbsUp, UserPlus } from "lucide-react";

import { ViewerSummaryCard } from "@/components/auth/viewer-summary-card";
import { EvergreenHeader } from "@/components/layout/evergreen-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  createForumPost,
  fetchForumFeed,
  fetchMe,
  shareForumPost,
  toggleForumBookmark,
  toggleForumFollow,
  toggleForumReaction,
} from "@/lib/api-client";

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

export default function FeedPage() {
  const queryClient = useQueryClient();
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [feedMode, setFeedMode] = useState<"all" | "following">("all");
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [composerMessage, setComposerMessage] = useState<string | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
  });

  const feedInfiniteQuery = useInfiniteQuery({
    queryKey: ["forum-feed", feedMode],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      fetchForumFeed({
        limit: 20,
        cursor: pageParam,
        followingOnly: feedMode === "following" ? true : undefined,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
  });

  const createPostMutation = useMutation({
    mutationFn: (payload: { title: string; markdown: string; tags?: string[] }) => createForumPost(payload),
    onSuccess: async () => {
      setComposerError(null);
      setComposerMessage("Post created. Feed refreshed.");
      setTitle("");
      setMarkdown("");
      setTagInput("");
      await queryClient.invalidateQueries({ queryKey: ["forum-feed"] });
    },
    onError: (error) => {
      setComposerMessage(null);
      setComposerError(error instanceof Error ? error.message : "Could not create post");
    },
  });

  const likeMutation = useMutation({
    mutationFn: (postId: string) =>
      toggleForumReaction({
        targetType: "post",
        targetId: postId,
        reactionType: "like",
      }),
    onSuccess: async () => {
      setActionError(null);
      setActionMessage("Reaction updated.");
      await queryClient.invalidateQueries({ queryKey: ["forum-feed"] });
    },
    onError: (error) => {
      setActionMessage(null);
      setActionError(error instanceof Error ? error.message : "Could not toggle reaction");
    },
  });

  const shareMutation = useMutation({
    mutationFn: (postId: string) => shareForumPost({ postId }),
    onSuccess: async () => {
      setActionError(null);
      setActionMessage("Post shared.");
      await queryClient.invalidateQueries({ queryKey: ["forum-feed"] });
    },
    onError: (error) => {
      setActionMessage(null);
      setActionError(error instanceof Error ? error.message : "Could not share post");
    },
  });

  const bookmarkMutation = useMutation({
    mutationFn: (postId: string) => toggleForumBookmark({ postId }),
    onSuccess: async () => {
      setActionError(null);
      setActionMessage("Bookmark updated.");
      await queryClient.invalidateQueries({ queryKey: ["forum-feed"] });
    },
    onError: (error) => {
      setActionMessage(null);
      setActionError(error instanceof Error ? error.message : "Could not toggle bookmark");
    },
  });

  const followMutation = useMutation({
    mutationFn: (followeeUserId: string) => toggleForumFollow({ followeeUserId }),
    onSuccess: async () => {
      setActionError(null);
      setActionMessage("Follow updated.");
      await queryClient.invalidateQueries({ queryKey: ["forum-feed"] });
    },
    onError: (error) => {
      setActionMessage(null);
      setActionError(error instanceof Error ? error.message : "Could not follow user");
    },
  });

  const submitPost = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setComposerMessage(null);
    setComposerError(null);

    const tags = tagInput
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    createPostMutation.mutate({
      title,
      markdown,
      tags: tags.length > 0 ? tags : undefined,
    });
  };

  const posts = useMemo(() => {
    const seen = new Set<string>();
    return (feedInfiniteQuery.data?.pages ?? [])
      .flatMap((page) => page.posts)
      .filter((post) => {
        if (seen.has(post.id)) {
          return false;
        }

        seen.add(post.id);
        return true;
      });
  }, [feedInfiniteQuery.data?.pages]);

  const feedHasNextPage = feedInfiniteQuery.hasNextPage;
  const isFeedFetchingNextPage = feedInfiniteQuery.isFetchingNextPage;
  const fetchFeedNextPage = feedInfiniteQuery.fetchNextPage;

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !feedHasNextPage || isFeedFetchingNextPage) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void fetchFeedNextPage();
        }
      },
      { rootMargin: "360px" }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [fetchFeedNextPage, feedHasNextPage, isFeedFetchingNextPage]);

  const viewerId = meQuery.data?.user?.id;

  return (
    <div className="min-h-screen">
      <div className="grid-atmosphere fixed inset-0 -z-10 opacity-30" />
      <EvergreenHeader />

      <main className="mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-6 px-4 pb-12 pt-6 md:grid-cols-[220px_1fr] xl:grid-cols-[220px_1fr_300px] sm:px-6 lg:px-8">
        <aside className="hidden space-y-4 rounded-xl border border-border bg-card/80 p-4 md:block">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Navigation</h2>
          <div className="space-y-1">
            {[
              { label: "Home", active: true },
              { label: "Following", active: false },
              { label: "Categories", active: false },
              { label: "Tags", active: false },
              { label: "Bookmarks", active: false },
            ].map(({ label, active }) => (
              <div
                key={label}
                className={`rounded-md px-3 py-2 text-sm ${active ? "border-l-2 border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}
              >
                {label}
              </div>
            ))}
          </div>
        </aside>

        <section className="space-y-5">
          <Card className="border-border bg-card/85">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Share a snippet or start a discussion</CardTitle>
              <CardDescription>Published to backend `/api/forum/posts`.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={submitPost}>
                <Input
                  placeholder="Post title"
                  className="border-border bg-background/70"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  minLength={3}
                  required
                />
                <Textarea
                  placeholder="Share a snippet or ask the community..."
                  className="min-h-[110px] border-border bg-background/70"
                  value={markdown}
                  onChange={(event) => setMarkdown(event.target.value)}
                  required
                />
                <div className="flex items-center justify-between">
                  <div className="hidden items-center gap-2 md:flex">
                    <Input
                      placeholder="Comma tags: react, nextjs"
                      className="w-56 border-border bg-background/70"
                      value={tagInput}
                      onChange={(event) => setTagInput(event.target.value)}
                    />
                    <Button type="button" variant="outline" size="sm" className="border-border bg-background hover:bg-secondary/60">
                      <Search className="size-4" />
                      Suggest tags
                    </Button>
                  </div>
                  <Button className="bg-primary text-primary-foreground hover:bg-primary/90" disabled={createPostMutation.isPending}>
                    {createPostMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                    Publish
                  </Button>
                </div>
                {composerError ? (
                  <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                    {composerError}
                  </p>
                ) : null}
                {composerMessage ? (
                  <p className="rounded-md border border-primary/40 bg-primary/10 p-2 text-xs text-primary">{composerMessage}</p>
                ) : null}
              </form>
            </CardContent>
          </Card>

          <Tabs value={feedMode} onValueChange={(value) => setFeedMode(value as "all" | "following")}>
            <TabsList className="bg-card">
              <TabsTrigger value="all">Public Feed</TabsTrigger>
              <TabsTrigger value="following">Following</TabsTrigger>
            </TabsList>
          </Tabs>

          {actionError ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{actionError}</p>
          ) : null}
          {actionMessage ? (
            <p className="rounded-md border border-primary/40 bg-primary/10 p-2 text-xs text-primary">{actionMessage}</p>
          ) : null}

          <div className="space-y-4">
            {feedInfiniteQuery.isPending ? (
              <Card className="border-border bg-card/90">
                <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading feed...
                </CardContent>
              </Card>
            ) : null}

            {feedInfiniteQuery.isError ? (
              <Card className="border-destructive/30 bg-destructive/10">
                <CardContent className="p-6 text-sm text-destructive">
                  {feedInfiniteQuery.error instanceof Error ? feedInfiniteQuery.error.message : "Could not load forum feed"}
                </CardContent>
              </Card>
            ) : null}

            {!feedInfiniteQuery.isPending && !feedInfiniteQuery.isError && posts.length === 0 ? (
              <Card className="border-border bg-card/90">
                <CardContent className="p-6 text-sm text-muted-foreground">
                  No posts yet for this feed mode. Publish the first discussion.
                </CardContent>
              </Card>
            ) : null}

            {posts.map((post) => (
              <Card key={post.id} className="border-border bg-card/90">
                <CardHeader>
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-foreground">{truncateId(post.authorId)}</span>
                      <span>•</span>
                      <span>{formatRelative(post.lastActivityAt || post.createdAt)}</span>
                    </div>
                    {viewerId && viewerId !== post.authorId ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 border-border bg-background px-2 text-xs hover:bg-secondary/60"
                        disabled={followMutation.isPending && followMutation.variables === post.authorId}
                        onClick={() => followMutation.mutate(post.authorId)}
                      >
                        {followMutation.isPending && followMutation.variables === post.authorId ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <UserPlus className="size-3.5" />
                        )}
                        Follow
                      </Button>
                    ) : null}
                  </div>
                  <CardTitle className="text-xl leading-tight">
                    <Link href={`/thread/${post.id}`} className="hover:text-primary">
                      {post.title}
                    </Link>
                  </CardTitle>
                  <CardDescription>
                    API currently returns metadata summaries for feed cards. Open thread to continue discussion.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-1.5">
                    {post.isPinned ? (
                      <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                        pinned
                      </Badge>
                    ) : null}
                    {post.isLocked ? (
                      <Badge variant="outline" className="border-amber-400/35 bg-amber-400/10 text-amber-300">
                        locked
                      </Badge>
                    ) : null}
                    {[`slug:${post.slug.slice(0, 16)}`, `id:${post.id.slice(0, 8)}`].map((tag) => (
                      <Badge key={tag} variant="outline" className="border-border bg-background">
                        {tag}
                      </Badge>
                    ))}
                  </div>

                  <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-4">
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={() => likeMutation.mutate(post.id)}
                        disabled={likeMutation.isPending && likeMutation.variables === post.id}
                      >
                        {likeMutation.isPending && likeMutation.variables === post.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <ThumbsUp className="size-4" />
                        )}
                        {post.reactionCount}
                      </button>
                      <Button asChild variant="ghost" size="sm" className="h-6 px-0 text-xs text-muted-foreground hover:text-foreground">
                        <Link href={`/thread/${post.id}`}>
                          <MessageCircle className="size-4" />
                          {post.commentCount}
                        </Link>
                      </Button>
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={() => bookmarkMutation.mutate(post.id)}
                        disabled={bookmarkMutation.isPending && bookmarkMutation.variables === post.id}
                      >
                        {bookmarkMutation.isPending && bookmarkMutation.variables === post.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Bookmark className="size-4" />
                        )}
                        {post.bookmarkCount}
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={() => shareMutation.mutate(post.id)}
                        disabled={shareMutation.isPending && shareMutation.variables === post.id}
                      >
                        {shareMutation.isPending && shareMutation.variables === post.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Share2 className="size-4" />
                        )}
                        {post.shareCount}
                      </button>
                      <Button asChild variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground">
                        <Link href={`/thread/${post.id}`}>Open Thread</Link>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {feedHasNextPage ? (
              <div ref={loadMoreRef} className="py-2">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-border bg-card/80 text-muted-foreground hover:bg-card"
                  disabled={isFeedFetchingNextPage}
                  onClick={() => void fetchFeedNextPage()}
                >
                  {isFeedFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : null}
                  Load more posts
                </Button>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="hidden space-y-4 xl:block">
          <ViewerSummaryCard />

          <Card className="border-border bg-card/90">
            <CardHeader>
              <CardTitle className="text-base">Trending Technical</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>Why we migrated from Next.js to Astro</p>
              <p>The state of AI agents in Q3</p>
              <p>Is TypeScript becoming too complex?</p>
            </CardContent>
          </Card>
        </aside>
      </main>
    </div>
  );
}
