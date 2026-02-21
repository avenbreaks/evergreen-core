"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowRight, Filter, Loader2, MessageCircle, Search } from "lucide-react";

import { EvergreenHeader } from "@/components/layout/evergreen-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchForumFeed, fetchForumSearch } from "@/lib/api-client";

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

export default function ThreadLandingPage() {
  const [searchInput, setSearchInput] = useState("");
  const [feedMode, setFeedMode] = useState<"all" | "following">("all");
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const searchTerm = searchInput.trim();
  const isSearchMode = searchTerm.length >= 2;

  const feedQuery = useInfiniteQuery({
    queryKey: ["thread-directory", feedMode],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      fetchForumFeed({
        limit: 20,
        cursor: pageParam,
        followingOnly: feedMode === "following" ? true : undefined,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    enabled: !isSearchMode,
    retry: false,
  });

  const searchQuery = useQuery({
    queryKey: ["thread-search", searchTerm],
    queryFn: () =>
      fetchForumSearch({
        query: searchTerm,
        limit: 60,
      }),
    enabled: isSearchMode,
    retry: false,
  });

  const feedPosts = useMemo(() => {
    const seen = new Set<string>();
    return (feedQuery.data?.pages ?? [])
      .flatMap((page) => page.posts)
      .filter((post) => {
        if (seen.has(post.id)) {
          return false;
        }

        seen.add(post.id);
        return true;
      });
  }, [feedQuery.data?.pages]);

  const posts = isSearchMode ? (searchQuery.data?.posts ?? []) : feedPosts;
  const commentMatches = isSearchMode ? (searchQuery.data?.comments.length ?? 0) : 0;

  const hasNextPage = feedQuery.hasNextPage;
  const isFetchingNextPage = feedQuery.isFetchingNextPage;
  const fetchNextPage = feedQuery.fetchNextPage;

  useEffect(() => {
    const target = loadMoreRef.current;
    if (isSearchMode || !target || !hasNextPage || isFetchingNextPage) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void fetchNextPage();
        }
      },
      { rootMargin: "360px" }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, isSearchMode]);

  return (
    <div className="min-h-screen">
      <div className="grid-atmosphere fixed inset-0 -z-10 opacity-30" />
      <EvergreenHeader />

      <main className="mx-auto w-full max-w-6xl px-4 pb-12 pt-8 sm:px-6 lg:px-8">
        <div className="mb-5 space-y-2">
          <h1 className="text-3xl font-black tracking-tight">Thread Directory</h1>
          <p className="text-sm text-muted-foreground">
            Browse every live thread from `/api/forum/feed`, or run direct search from `/api/forum/search`.
          </p>
        </div>

        <Card className="mb-5 border-border bg-card/90">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                <Search className="size-4 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Search thread title or content (min 2 chars)"
                  className="h-auto border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                />
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={feedMode === "all" ? "default" : "outline"}
                  className={feedMode === "all" ? "bg-primary text-primary-foreground" : "border-border bg-background"}
                  onClick={() => setFeedMode("all")}
                >
                  All
                </Button>
                <Button
                  type="button"
                  variant={feedMode === "following" ? "default" : "outline"}
                  className={feedMode === "following" ? "bg-primary text-primary-foreground" : "border-border bg-background"}
                  onClick={() => setFeedMode("following")}
                >
                  <Filter className="size-4" />
                  Following
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="border-border bg-background">
                mode:{isSearchMode ? "search" : feedMode}
              </Badge>
              {isSearchMode ? (
                <Badge variant="outline" className="border-border bg-background">
                  {posts.length} posts, {commentMatches} comment matches
                </Badge>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {!isSearchMode && feedQuery.isPending ? (
            <Card className="border-border bg-card/90">
              <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading thread directory...
              </CardContent>
            </Card>
          ) : null}

          {isSearchMode && searchQuery.isPending ? (
            <Card className="border-border bg-card/90">
              <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Searching threads...
              </CardContent>
            </Card>
          ) : null}

          {!isSearchMode && feedQuery.isError ? (
            <Card className="border-destructive/40 bg-destructive/10">
              <CardContent className="p-6 text-sm text-destructive">
                {feedQuery.error instanceof Error ? feedQuery.error.message : "Could not load thread directory"}
              </CardContent>
            </Card>
          ) : null}

          {isSearchMode && searchQuery.isError ? (
            <Card className="border-destructive/40 bg-destructive/10">
              <CardContent className="p-6 text-sm text-destructive">
                {searchQuery.error instanceof Error ? searchQuery.error.message : "Search failed"}
              </CardContent>
            </Card>
          ) : null}

          {!feedQuery.isPending && !searchQuery.isPending && posts.length === 0 ? (
            <Card className="border-border bg-card/90">
              <CardContent className="p-6 text-sm text-muted-foreground">
                {isSearchMode ? "No threads matched your search." : "No threads yet. Open feed and publish the first discussion."}
              </CardContent>
            </Card>
          ) : null}

          {posts.map((post) => (
            <Card key={post.id} className="border-border bg-card/90">
              <CardHeader className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{formatRelative(post.lastActivityAt || post.createdAt)}</span>
                  <span>•</span>
                  <span>author:{post.authorId.slice(0, 8)}</span>
                </div>
                <CardTitle className="text-xl leading-tight">
                  <Link href={`/thread/${post.id}`} className="hover:text-primary">
                    {post.title}
                  </Link>
                </CardTitle>
                <CardDescription>slug: {post.slug}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-4">
                  <span className="inline-flex items-center gap-1">
                    <MessageCircle className="size-4" />
                    {post.commentCount}
                  </span>
                  <span>reactions: {post.reactionCount}</span>
                  <span>shares: {post.shareCount}</span>
                  <span>bookmarks: {post.bookmarkCount}</span>
                  {post.isLocked ? (
                    <Badge variant="outline" className="border-amber-400/40 bg-amber-400/10 text-amber-300">
                      locked
                    </Badge>
                  ) : null}
                  {post.isPinned ? (
                    <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
                      pinned
                    </Badge>
                  ) : null}
                </div>

                <Button asChild variant="outline" size="sm" className="border-border bg-background hover:bg-card">
                  <Link href={`/thread/${post.id}`}>
                    Open thread
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}

          {!isSearchMode && hasNextPage ? (
            <div ref={loadMoreRef} className="py-1">
              <Button
                type="button"
                variant="outline"
                className="w-full border-border bg-card/80 text-muted-foreground hover:bg-card"
                disabled={isFetchingNextPage}
                onClick={() => void fetchNextPage()}
              >
                {isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : null}
                Load more threads
              </Button>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
