"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock3, Flag, Loader2, Search, ShieldAlert, Trash2 } from "lucide-react";

import { EvergreenHeader } from "@/components/layout/evergreen-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchModerationReports,
  resolveModerationReport,
  setModerationPostLock,
  submitForumReport,
  type ModerationReportStatus,
} from "@/lib/api-client";

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

const statusBadgeClass: Record<ModerationReportStatus, string> = {
  open: "border-amber-500/30 bg-amber-500/15 text-amber-300",
  resolved: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
  dismissed: "border-slate-500/30 bg-slate-500/15 text-slate-300",
};

export default function ModerationDashboardPage() {
  const queryClient = useQueryClient();
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const [statusFilter, setStatusFilter] = useState<ModerationReportStatus>("open");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [reportTargetType, setReportTargetType] = useState<"post" | "comment" | "user">("post");
  const [reportTargetId, setReportTargetId] = useState("");
  const [reportReason, setReportReason] = useState("");

  const reportsQuery = useInfiniteQuery({
    queryKey: ["moderation-reports", statusFilter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      fetchModerationReports({
        status: statusFilter,
        limit: 20,
        cursor: pageParam,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
  });

  const reports = useMemo(() => {
    const seen = new Set<string>();
    return (reportsQuery.data?.pages ?? [])
      .flatMap((page) => page.reports)
      .filter((report) => {
        if (seen.has(report.id)) {
          return false;
        }

        seen.add(report.id);
        return true;
      });
  }, [reportsQuery.data?.pages]);

  const visibleReports = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return reports;
    }

    return reports.filter((report) => {
      const haystack = [
        report.id,
        report.reason,
        report.targetType,
        report.postTitle,
        report.commentPreview,
        report.reporter?.name,
        report.reporter?.username,
        report.reportedUser?.name,
        report.reportedUser?.username,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [reports, searchQuery]);

  const hasNextPage = reportsQuery.hasNextPage;
  const isFetchingNextPage = reportsQuery.isFetchingNextPage;
  const fetchNextPage = reportsQuery.fetchNextPage;

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
      { rootMargin: "340px" }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const activeReport = useMemo(
    () => visibleReports.find((report) => report.id === activeReportId) || visibleReports[0] || null,
    [activeReportId, visibleReports]
  );

  const invalidateModerationData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["moderation-reports"] }),
      queryClient.invalidateQueries({ queryKey: ["forum-feed"] }),
      activeReport?.postId
        ? queryClient.invalidateQueries({ queryKey: ["forum-post-detail", activeReport.postId] })
        : Promise.resolve(),
    ]);
  };

  const reportMutation = useMutation({
    mutationFn: () =>
      submitForumReport({
        targetType: reportTargetType,
        targetId: reportTargetId,
        reason: reportReason,
      }),
    onSuccess: async () => {
      setActionError(null);
      setActionMessage("Report submitted.");
      setReportReason("");
      await invalidateModerationData();
    },
    onError: (error) => {
      setActionMessage(null);
      setActionError(error instanceof Error ? error.message : "Failed to submit report");
    },
  });

  const lockMutation = useMutation({
    mutationFn: (payload: { postId: string; locked: boolean }) => setModerationPostLock(payload),
    onSuccess: async (payload) => {
      setActionError(null);
      setActionMessage(payload?.locked ? "Post locked." : "Post unlocked.");
      await invalidateModerationData();
    },
    onError: (error) => {
      setActionMessage(null);
      setActionError(error instanceof Error ? error.message : "Failed to update post lock");
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (payload: { reportId: string; status: "resolved" | "dismissed" }) => resolveModerationReport(payload),
    onSuccess: async (payload) => {
      setActionError(null);
      setActionMessage(`Report ${payload?.status || "updated"}.`);
      await invalidateModerationData();
    },
    onError: (error) => {
      setActionMessage(null);
      setActionError(error instanceof Error ? error.message : "Failed to update report status");
    },
  });

  const submitManualReport = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActionMessage(null);
    setActionError(null);
    reportMutation.mutate();
  };

  return (
    <div className="min-h-screen">
      <div className="grid-atmosphere fixed inset-0 -z-10 opacity-30" />
      <EvergreenHeader />

      <main className="mx-auto grid w-full max-w-[1450px] grid-cols-1 gap-5 px-4 pb-10 pt-6 xl:grid-cols-[1fr_1fr] sm:px-6 lg:px-8">
        <section className="space-y-4 rounded-xl border border-border bg-card/90 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
                Moderation Queue
                <Badge variant="outline" className="border-border bg-background text-xs text-muted-foreground">
                  {visibleReports.length}
                </Badge>
              </h1>
              <p className="text-sm text-muted-foreground">Live reports with lock and resolution actions.</p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant={statusFilter === "open" ? "default" : "outline"}
                size="sm"
                className={statusFilter === "open" ? "bg-primary text-primary-foreground" : "border-border bg-background hover:bg-secondary/60"}
                onClick={() => setStatusFilter("open")}
              >
                <Clock3 className="size-4" />
                Open
              </Button>
              <Button
                variant={statusFilter === "resolved" ? "default" : "outline"}
                size="sm"
                className={statusFilter === "resolved" ? "bg-primary text-primary-foreground" : "border-border bg-background hover:bg-secondary/60"}
                onClick={() => setStatusFilter("resolved")}
              >
                <CheckCircle2 className="size-4" />
                Resolved
              </Button>
              <Button
                variant={statusFilter === "dismissed" ? "default" : "outline"}
                size="sm"
                className={statusFilter === "dismissed" ? "bg-primary text-primary-foreground" : "border-border bg-background hover:bg-secondary/60"}
                onClick={() => setStatusFilter("dismissed")}
              >
                <Trash2 className="size-4" />
                Dismissed
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
            <Search className="size-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search reports, target IDs, usernames..."
              className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            />
          </div>

          {reportsQuery.isPending ? (
            <Card className="border-border bg-background/70">
              <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading moderation queue...
              </CardContent>
            </Card>
          ) : null}

          {reportsQuery.isError ? (
            <Card className="border-destructive/40 bg-destructive/10">
              <CardContent className="p-4 text-sm text-destructive">
                {reportsQuery.error instanceof Error ? reportsQuery.error.message : "Failed to load moderation queue"}
              </CardContent>
            </Card>
          ) : null}

          <div className="space-y-2">
            {visibleReports.map((report) => (
              <article
                key={report.id}
                className={`cursor-pointer rounded-lg border p-3 transition ${
                  activeReport?.id === report.id
                    ? "border-primary/45 bg-primary/10"
                    : "border-border bg-background/70 hover:border-border/70 hover:bg-background"
                }`}
                onClick={() => setActiveReportId(report.id)}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge className={`border ${statusBadgeClass[report.status]}`}>{report.status}</Badge>
                  <span>{report.id.slice(0, 8)}</span>
                  <span>{formatRelative(report.createdAt)}</span>
                </div>
                <h2 className="mt-2 text-sm font-semibold text-foreground">{report.postTitle || `${report.targetType} report`}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{report.reason}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  reporter <span className="font-medium text-foreground">{report.reporter?.username || report.reporter?.name || report.reporterUserId.slice(0, 8)}</span>
                </p>
              </article>
            ))}

            {hasNextPage ? (
              <div ref={loadMoreRef} className="py-1">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-border bg-card/80 text-muted-foreground hover:bg-card"
                  disabled={isFetchingNextPage}
                  onClick={() => void fetchNextPage()}
                >
                  {isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : null}
                  Load more reports
                </Button>
              </div>
            ) : null}
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-border bg-card/90 p-4">
          {actionError ? <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{actionError}</p> : null}
          {actionMessage ? <p className="rounded-md border border-primary/40 bg-primary/10 p-2 text-xs text-primary">{actionMessage}</p> : null}

          <Card className="border-border bg-background/80">
            <CardHeader>
              <CardTitle className="text-lg">{activeReport?.postTitle || "Select a report"}</CardTitle>
              <CardDescription className="text-xs">
                {activeReport ? `${activeReport.id} · ${formatRelative(activeReport.createdAt)}` : "Pick a report from the queue."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {activeReport ? (
                <>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="rounded-md border border-border bg-card px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Reason</p>
                      <p className="mt-1 flex items-center gap-1.5 font-medium text-red-300">
                        <AlertTriangle className="size-4" />
                        {activeReport.reason}
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-card px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Target</p>
                      <p className="mt-1 text-foreground">{activeReport.targetType}</p>
                    </div>
                    <div className="rounded-md border border-border bg-card px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Reporter</p>
                      <p className="mt-1 text-foreground">{activeReport.reporter?.username || activeReport.reporter?.name || activeReport.reporterUserId}</p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-card p-4">
                    <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Target preview</p>
                    <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                      <p>{activeReport.commentPreview || activeReport.postTitle || "No preview available."}</p>
                      {activeReport.postId ? (
                        <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground">
                          <Link href={`/thread/${activeReport.postId}`}>Open target thread</Link>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No report selected.</p>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Button
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={!activeReport || activeReport.status !== "open" || resolveMutation.isPending}
              onClick={() =>
                activeReport
                  ? resolveMutation.mutate({
                      reportId: activeReport.id,
                      status: "resolved",
                    })
                  : null
              }
            >
              {resolveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              Resolve
            </Button>
            <Button
              variant="outline"
              className="border-border bg-background hover:bg-secondary/60"
              disabled={!activeReport?.postId || lockMutation.isPending}
              onClick={() =>
                activeReport?.postId
                  ? lockMutation.mutate({
                      postId: activeReport.postId,
                      locked: !activeReport.postLocked,
                    })
                  : null
              }
            >
              {lockMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <ShieldAlert className="size-4" />}
              {activeReport?.postLocked ? "Unlock Post" : "Lock Post"}
            </Button>
            <Button
              variant="outline"
              className="border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20"
              disabled={!activeReport || activeReport.status !== "open" || resolveMutation.isPending}
              onClick={() =>
                activeReport
                  ? resolveMutation.mutate({
                      reportId: activeReport.id,
                      status: "dismissed",
                    })
                  : null
              }
            >
              {resolveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Dismiss
            </Button>
          </div>

          <Card className="border-border bg-background/80">
            <CardHeader>
              <CardTitle className="text-base">Create report</CardTitle>
              <CardDescription>Submit a report manually to `/api/forum/reports`.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={submitManualReport}>
                <div className="flex flex-wrap gap-2">
                  {(["post", "comment", "user"] as const).map((targetType) => (
                    <Button
                      key={targetType}
                      type="button"
                      size="sm"
                      variant={reportTargetType === targetType ? "default" : "outline"}
                      className={reportTargetType === targetType ? "bg-primary text-primary-foreground" : "border-border bg-background hover:bg-secondary/60"}
                      onClick={() => setReportTargetType(targetType)}
                    >
                      <Flag className="size-3.5" />
                      {targetType}
                    </Button>
                  ))}
                </div>

                <Input
                  value={reportTargetId}
                  onChange={(event) => setReportTargetId(event.target.value)}
                  placeholder="Target UUID"
                  className="border-border bg-background"
                  required
                />
                <Textarea
                  value={reportReason}
                  onChange={(event) => setReportReason(event.target.value)}
                  placeholder="Describe why this content/account should be reviewed..."
                  className="min-h-[96px] border-border bg-background"
                  required
                />

                <Button className="bg-primary text-primary-foreground hover:bg-primary/90" disabled={reportMutation.isPending}>
                  {reportMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Flag className="size-4" />}
                  Submit report
                </Button>
              </form>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
