import { and, count, eq, inArray } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

type ReadinessLevel = "complete" | "partial" | "missing";

type ForumMvpChecklistItem = {
  key: string;
  label: string;
  status: ReadinessLevel;
  note: string;
};

export type ForumMvpStatusSummary = {
  completed: number;
  partial: number;
  missing: number;
  total: number;
  readinessPercent: number;
  checklist: ForumMvpChecklistItem[];
  signals: {
    publishedPosts: number;
    publishedComments: number;
    openReports: number;
    queuedSearchJobs: number;
    notificationRows: number;
  };
  generatedAt: Date;
};

const buildForumMvpChecklist = (): ForumMvpChecklistItem[] => [
  { key: "post_crud", label: "Create/update/delete post", status: "complete", note: "Post CRUD + soft delete tersedia" },
  { key: "threaded_comments", label: "Comment + nested reply", status: "complete", note: "Reply bertingkat dengan depth guard" },
  { key: "reactions", label: "Reaction post/comment", status: "complete", note: "Toggle reaction untuk post dan comment" },
  {
    key: "share",
    label: "Share postingan user lain",
    status: "partial",
    note: "Share tersedia, tapi guard self-share belum strict",
  },
  {
    key: "mentions",
    label: "Mention user + ENS + wallet",
    status: "complete",
    note: "@username, @ens, @0xwallet resolve ke target user/identity",
  },
  { key: "follow", label: "Saling follow", status: "complete", note: "Follow/unfollow user tersedia" },
  { key: "bookmark", label: "Bookmark", status: "complete", note: "Toggle bookmark + pin bookmark tersedia" },
  { key: "pin", label: "Pin post", status: "complete", note: "Owner atau moderator/admin bisa pin" },
  { key: "feed_detail", label: "Feed + thread detail", status: "complete", note: "Feed/listing + detail thread tersedia" },
  { key: "moderation", label: "Moderasi dasar", status: "complete", note: "Report, lock, soft delete tersedia" },
  {
    key: "notifications",
    label: "Notifikasi dasar",
    status: "complete",
    note: "Mention/reply/reaction dan read-state tersedia",
  },
  { key: "search", label: "Search post/comment", status: "complete", note: "Meili + fallback DB tersedia" },
  { key: "trending_tags", label: "Trending tags", status: "complete", note: "Hot tags by trend score" },
  { key: "top_active", label: "Top Active", status: "complete", note: "Based on profile engagement score" },
  {
    key: "top_topics",
    label: "Top Topics by creator popularity",
    status: "complete",
    note: "Ranking creator by aggregate topic popularity",
  },
  { key: "top_discussion", label: "Top Discussion", status: "complete", note: "Latest hot discussion by comments/activity" },
  {
    key: "profile_account",
    label: "Profile account fields + analytics",
    status: "complete",
    note: "Location/organization/website/branding email/address/ENS/metrics",
  },
  {
    key: "markdown_references_drafts",
    label: "Markdown + code + links + references + save replies",
    status: "complete",
    note: "Markdown analysis, references, mentions, draft replies tersedia",
  },
];

const computeReadinessPercent = (input: { completed: number; partial: number; total: number }): number => {
  if (input.total <= 0) {
    return 0;
  }

  const weighted = input.completed + input.partial * 0.5;
  return Math.round((weighted / input.total) * 100);
};

export const getForumMvpStatusSummary = async (): Promise<ForumMvpStatusSummary> => {
  const checklist = buildForumMvpChecklist();

  const completed = checklist.filter((item) => item.status === "complete").length;
  const partial = checklist.filter((item) => item.status === "partial").length;
  const missing = checklist.filter((item) => item.status === "missing").length;
  const total = checklist.length;

  const [publishedPostsRows, publishedCommentsRows, openReportsRows, queuedSearchRows, notificationsRows] = await Promise.all([
    authDb
      .select({ total: count() })
      .from(schema.forumPosts)
      .where(eq(schema.forumPosts.status, "published")),
    authDb
      .select({ total: count() })
      .from(schema.forumComments)
      .where(eq(schema.forumComments.status, "published")),
    authDb
      .select({ total: count() })
      .from(schema.forumReports)
      .where(eq(schema.forumReports.status, "open")),
    authDb
      .select({ total: count() })
      .from(schema.forumSearchSyncQueue)
      .where(inArray(schema.forumSearchSyncQueue.status, ["pending", "processing", "failed"])),
    authDb.select({ total: count() }).from(schema.forumNotifications),
  ]);

  return {
    completed,
    partial,
    missing,
    total,
    readinessPercent: computeReadinessPercent({
      completed,
      partial,
      total,
    }),
    checklist,
    signals: {
      publishedPosts: publishedPostsRows[0]?.total ?? 0,
      publishedComments: publishedCommentsRows[0]?.total ?? 0,
      openReports: openReportsRows[0]?.total ?? 0,
      queuedSearchJobs: queuedSearchRows[0]?.total ?? 0,
      notificationRows: notificationsRows[0]?.total ?? 0,
    },
    generatedAt: new Date(),
  };
};
