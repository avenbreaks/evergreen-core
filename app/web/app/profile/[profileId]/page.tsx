"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowRight, Code2, Loader2, MessageCircle, Trophy } from "lucide-react";

import { EvergreenHeader } from "@/components/layout/evergreen-header";
import { ThreadPrefetchLink } from "@/components/navigation/thread-prefetch-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchForumPosts, fetchForumProfile, fetchMe } from "@/lib/api-client";

const looksLikeUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const heatmapValues = Array.from({ length: 84 }, (_, index) => {
  const value = (index * 17 + 13) % 10;
  if (value > 8) return "bg-primary/80";
  if (value > 6) return "bg-primary/50";
  if (value > 3) return "bg-primary/30";
  return "bg-border";
});

export default function DeveloperProfilePage() {
  const params = useParams<{ profileId: string }>();
  const profileIdParam = typeof params.profileId === "string" ? params.profileId : "";

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
  });

  const meUserId = meQuery.data?.user?.id ?? "";
  const resolvedProfileId = useMemo(() => {
    if (profileIdParam === "me" || profileIdParam === "alex-devparty") {
      return meUserId;
    }

    return profileIdParam;
  }, [meUserId, profileIdParam]);

  const canFetchProfile = looksLikeUuid(resolvedProfileId);

  const profileQuery = useQuery({
    queryKey: ["forum-profile", resolvedProfileId],
    queryFn: () => fetchForumProfile(resolvedProfileId),
    enabled: canFetchProfile,
  });

  const authoredPostsQuery = useInfiniteQuery({
    queryKey: ["forum-posts", "author", resolvedProfileId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      fetchForumPosts({
        authorId: resolvedProfileId,
        limit: 12,
        cursor: pageParam,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    enabled: canFetchProfile,
    retry: false,
  });

  const profile = profileQuery.data?.profile;
  const isOwnProfile = Boolean(meUserId && resolvedProfileId && meUserId === resolvedProfileId);

  const displayName = profile?.displayEnsName || profile?.displayName || profile?.username || profile?.name || "Developer";
  const headline = profile?.headline || profile?.organization || "Builder profile";
  const bio = profile?.bio || "Profile has no bio yet.";
  const githubUsername = profile?.githubUsername;
  const followers = profile?.metrics?.followerCount ?? 0;
  const following = profile?.metrics?.followingCount ?? 0;
  const postsCount = profile?.metrics?.postCount ?? 0;
  const commentsCount = profile?.metrics?.commentCount ?? 0;
  const engagementScore = profile?.metrics?.engagementScore ?? 0;

  const unresolvedProfileRequest = !canFetchProfile && !meQuery.isPending;
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [threadSort, setThreadSort] = useState<"latest" | "mostDiscussed" | "pinnedFirst">("latest");

  const authoredPosts = useMemo(() => {
    const seen = new Set<string>();
    return (authoredPostsQuery.data?.pages ?? [])
      .flatMap((page) => page.posts)
      .filter((post) => {
        if (seen.has(post.id)) {
          return false;
        }

        seen.add(post.id);
        return true;
      });
  }, [authoredPostsQuery.data?.pages]);

  const sortedAuthoredPosts = useMemo(() => {
    const rankLatest = (value: { lastActivityAt: string; createdAt: string }) => {
      const lastActivityAt = Date.parse(value.lastActivityAt || "");
      const createdAt = Date.parse(value.createdAt || "");
      return Math.max(Number.isNaN(lastActivityAt) ? 0 : lastActivityAt, Number.isNaN(createdAt) ? 0 : createdAt);
    };

    const items = [...authoredPosts];
    items.sort((left, right) => {
      if (threadSort === "mostDiscussed") {
        const discussionScoreLeft = left.commentCount * 3 + left.reactionCount + left.shareCount;
        const discussionScoreRight = right.commentCount * 3 + right.reactionCount + right.shareCount;
        if (discussionScoreLeft !== discussionScoreRight) {
          return discussionScoreRight - discussionScoreLeft;
        }
      }

      if (threadSort === "pinnedFirst" && left.isPinned !== right.isPinned) {
        return left.isPinned ? -1 : 1;
      }

      return rankLatest(right) - rankLatest(left);
    });

    return items;
  }, [authoredPosts, threadSort]);

  const hasMoreAuthoredPosts = authoredPostsQuery.hasNextPage;
  const isFetchingMoreAuthoredPosts = authoredPostsQuery.isFetchingNextPage;
  const fetchMoreAuthoredPosts = authoredPostsQuery.fetchNextPage;

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMoreAuthoredPosts || isFetchingMoreAuthoredPosts) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void fetchMoreAuthoredPosts();
        }
      },
      { rootMargin: "320px" }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [fetchMoreAuthoredPosts, hasMoreAuthoredPosts, isFetchingMoreAuthoredPosts]);

  return (
    <div className="min-h-screen">
      <div className="grid-atmosphere fixed inset-0 -z-10 opacity-30" />
      <EvergreenHeader />

      <main className="mx-auto grid w-full max-w-[1450px] grid-cols-1 gap-6 px-4 pb-10 pt-6 lg:grid-cols-[310px_1fr] sm:px-6 lg:px-8">
        <aside className="space-y-4">
          <Card className="border-border bg-card/90">
            <CardContent className="space-y-5 p-6 text-center">
              <div className="mx-auto flex size-24 items-center justify-center rounded-full border-2 border-border bg-background text-2xl font-black text-primary">
                {displayName.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <h1 className="font-mono text-2xl font-bold text-foreground">{displayName}</h1>
                <p className="text-sm text-muted-foreground">{headline}</p>
              </div>

              {isOwnProfile ? (
                <Badge className="w-fit border border-primary/30 bg-primary/15 text-primary">Your profile</Badge>
              ) : (
                <Badge variant="outline" className="w-fit border-border bg-background text-muted-foreground">
                  Public profile
                </Badge>
              )}

              <p className="text-sm leading-relaxed text-muted-foreground">
                {bio}
                {profile?.location ? ` Location: ${profile.location}.` : ""}
                {profile?.websiteUrl ? ` Website: ${profile.websiteUrl}.` : ""}
                {githubUsername ? ` GitHub: @${githubUsername}.` : ""}
              </p>

              <div className="grid grid-cols-3 gap-2 border-t border-border pt-4 text-center">
                <div>
                  <p className="text-lg font-bold text-foreground">{followers}</p>
                  <p className="text-xs text-muted-foreground">Followers</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-foreground">{following}</p>
                  <p className="text-xs text-muted-foreground">Following</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-foreground">{postsCount}</p>
                  <p className="text-xs text-muted-foreground">Posts</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card/90">
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-[0.16em] text-muted-foreground">Profile ID</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <p className="break-all font-mono">route: {profileIdParam}</p>
              <p className="break-all font-mono">resolved: {resolvedProfileId || "(awaiting auth)"}</p>
            </CardContent>
          </Card>
        </aside>

        <section className="space-y-5">
          {meQuery.isPending ? <p className="text-sm text-muted-foreground">Loading session...</p> : null}

          {profileIdParam === "me" && !meQuery.isPending && !meUserId ? (
            <Card className="border-border bg-card/90">
              <CardContent className="p-5 text-sm text-muted-foreground">Sign in first to view your profile route.</CardContent>
            </Card>
          ) : null}

          {unresolvedProfileRequest ? (
            <Card className="border-destructive/40 bg-destructive/10">
              <CardContent className="p-5 text-sm text-destructive">
                Invalid profile identifier. Use `/profile/me` or `/profile/&lt;uuid&gt;`.
              </CardContent>
            </Card>
          ) : null}

          {canFetchProfile && profileQuery.isPending ? <p className="text-sm text-muted-foreground">Loading backend profile...</p> : null}

          {canFetchProfile && profileQuery.isError ? (
            <Card className="border-destructive/40 bg-destructive/10">
              <CardContent className="p-5 text-sm text-destructive">
                {profileQuery.error instanceof Error ? profileQuery.error.message : "Could not load backend profile"}
              </CardContent>
            </Card>
          ) : null}

          {canFetchProfile && !profileQuery.isPending && !profileQuery.isError && !profile ? (
            <Card className="border-border bg-card/90">
              <CardContent className="p-5 text-sm text-muted-foreground">Profile not found for this user ID.</CardContent>
            </Card>
          ) : null}

          <Card className="overflow-hidden border-border bg-card/90">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Code2 className="size-4 text-primary" />
                    Contribution Activity
                  </CardTitle>
                  <CardDescription>
                    {profile ? `Live backend metrics loaded for ${displayName}.` : "Metrics appear after profile data is available."}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <div>
                    <p className="font-mono text-lg font-bold text-foreground">{commentsCount}</p>
                    <p className="text-xs text-muted-foreground">Comments</p>
                  </div>
                  <div className="h-8 w-px bg-border" />
                  <div>
                    <p className="font-mono text-lg font-bold text-foreground">{engagementScore}</p>
                    <p className="text-xs text-muted-foreground">Engagement</p>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-flow-col grid-rows-7 gap-1 overflow-x-auto pb-2">
                {heatmapValues.map((tone, index) => (
                  <div key={index} className={`size-3 rounded-sm ${tone}`} />
                ))}
              </div>
              <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                <span>Less</span>
                <div className="size-3 rounded-sm bg-border" />
                <div className="size-3 rounded-sm bg-primary/30" />
                <div className="size-3 rounded-sm bg-primary/50" />
                <div className="size-3 rounded-sm bg-primary/80" />
                <span>More</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card/90">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">Recent Threads</CardTitle>
                  <CardDescription>Latest discussions by this profile from `/api/forum/posts?authorId=...`.</CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={threadSort === "latest" ? "default" : "outline"}
                    className={threadSort === "latest" ? "bg-primary text-primary-foreground" : "border-border bg-background"}
                    onClick={() => setThreadSort("latest")}
                  >
                    Latest
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={threadSort === "mostDiscussed" ? "default" : "outline"}
                    className={threadSort === "mostDiscussed" ? "bg-primary text-primary-foreground" : "border-border bg-background"}
                    onClick={() => setThreadSort("mostDiscussed")}
                  >
                    Most discussed
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={threadSort === "pinnedFirst" ? "default" : "outline"}
                    className={threadSort === "pinnedFirst" ? "bg-primary text-primary-foreground" : "border-border bg-background"}
                    onClick={() => setThreadSort("pinnedFirst")}
                  >
                    Pinned first
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {canFetchProfile && authoredPostsQuery.isPending ? (
                <div className="flex items-center gap-2 rounded-md border border-border bg-background p-3 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading authored threads...
                </div>
              ) : null}

              {canFetchProfile && authoredPostsQuery.isError ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  {authoredPostsQuery.error instanceof Error ? authoredPostsQuery.error.message : "Could not load authored threads"}
                </div>
              ) : null}

              {canFetchProfile && !authoredPostsQuery.isPending && !authoredPostsQuery.isError && authoredPosts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No published threads from this profile yet.</p>
              ) : null}

              {sortedAuthoredPosts.map((post) => (
                <div key={post.id} className="rounded-lg border border-border bg-background p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <ThreadPrefetchLink postId={post.id} className="text-sm font-semibold text-foreground hover:text-primary">
                        {post.title}
                      </ThreadPrefetchLink>
                      <p className="text-xs text-muted-foreground">slug: {post.slug}</p>
                    </div>
                    <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground">
                      <ThreadPrefetchLink postId={post.id}>
                        Open
                        <ArrowRight className="size-4" />
                      </ThreadPrefetchLink>
                    </Button>
                  </div>

                  <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle className="size-3.5" />
                      {post.commentCount}
                    </span>
                    <span>reactions: {post.reactionCount}</span>
                    <span>shares: {post.shareCount}</span>
                    <span>bookmarks: {post.bookmarkCount}</span>
                  </div>
                </div>
              ))}

              {canFetchProfile && hasMoreAuthoredPosts ? (
                <div ref={loadMoreRef} className="pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-border bg-background text-muted-foreground hover:bg-card"
                    disabled={isFetchingMoreAuthoredPosts}
                    onClick={() => void fetchMoreAuthoredPosts()}
                  >
                    {isFetchingMoreAuthoredPosts ? <Loader2 className="size-4 animate-spin" /> : null}
                    Load more authored threads
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-border bg-card/90">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Trophy className="size-4 text-primary" />
                Profile Snapshot
              </CardTitle>
              <CardDescription>Fetched from `/api/profile/:userId` with live profile metrics.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm text-muted-foreground sm:grid-cols-4">
              <div className="rounded-md border border-border bg-background p-3">
                <p className="text-xs uppercase tracking-[0.14em]">Posts</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{postsCount}</p>
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <p className="text-xs uppercase tracking-[0.14em]">Comments</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{commentsCount}</p>
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <p className="text-xs uppercase tracking-[0.14em]">Followers</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{followers}</p>
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <p className="text-xs uppercase tracking-[0.14em]">Following</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{following}</p>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
