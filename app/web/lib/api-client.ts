export type AuthSession = {
  user?: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  } | null;
  session?: {
    id: string;
    expiresAt?: string | Date;
  } | null;
} | null;

export type MePayload = {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
  };
  profile?: {
    userId?: string;
    displayName?: string | null;
    bio?: string | null;
  } | null;
  wallets?: Array<{
    address: string;
    isPrimary: boolean;
  }>;
} | null;

export type NetworkPayload = {
  network?: {
    name?: string;
    chainId?: number;
  };
};

export type EnsTldsPayload = {
  tlds: string[];
};

export type EnsCheckPayload = {
  domainName?: string;
  available?: boolean;
  [key: string]: unknown;
};

export type ForumPostSummary = {
  id: string;
  title: string;
  slug: string;
  status: string;
  isPinned: boolean;
  isLocked: boolean;
  commentCount: number;
  reactionCount: number;
  shareCount: number;
  bookmarkCount: number;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  authorId: string;
  contentMarkdown?: string;
  contentPlaintext?: string;
  contentMeta?: Record<string, unknown>;
};

export type ForumCommentSummary = {
  id: string;
  postId: string;
  authorId: string;
  parentId: string | null;
  depth: number;
  status: string;
  reactionCount: number;
  replyCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  contentMarkdown?: string;
  contentPlaintext?: string;
  contentMeta?: Record<string, unknown>;
};

export type ForumFeedPayload = {
  posts: ForumPostSummary[];
  nextCursor: string | null;
};

export type ForumPostDetailPayload = {
  post: ForumPostSummary;
  comments: ForumCommentSummary[];
  commentsNextCursor: string | null;
};

export type ModerationReportStatus = "open" | "resolved" | "dismissed";

export type ModerationReportItem = {
  id: string;
  status: ModerationReportStatus;
  reason: string;
  targetType: "post" | "comment" | "user";
  targetId: string | null;
  postId: string | null;
  commentId: string | null;
  reportedUserId: string | null;
  reporterUserId: string;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  postTitle: string | null;
  postLocked: boolean;
  commentPreview: string | null;
  reporter?: {
    id: string;
    name?: string | null;
    username?: string | null;
    email?: string | null;
    role?: string | null;
  } | null;
  reportedUser?: {
    id: string;
    name?: string | null;
    username?: string | null;
    email?: string | null;
    role?: string | null;
  } | null;
  reviewedBy?: {
    id: string;
    name?: string | null;
    username?: string | null;
    email?: string | null;
    role?: string | null;
  } | null;
};

export type ModerationReportsPayload = {
  reports: ModerationReportItem[];
  nextCursor: string | null;
};

export type ForumProfilePayload = {
  profile?: {
    userId: string;
    email?: string | null;
    name?: string | null;
    username?: string | null;
    image?: string | null;
    displayName?: string | null;
    headline?: string | null;
    bio?: string | null;
    location?: string | null;
    organization?: string | null;
    websiteUrl?: string | null;
    githubUsername?: string | null;
    brandingEmail?: string | null;
    displayWalletAddress?: string | null;
    displayEnsName?: string | null;
    metrics?: {
      followerCount?: number;
      followingCount?: number;
      postCount?: number;
      commentCount?: number;
      engagementScore?: number;
      [key: string]: unknown;
    } | null;
    [key: string]: unknown;
  };
};

export const AUTH_REQUIRED_EVENT_NAME = "evergreen:auth-required";

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const notifyAuthRequired = (message?: string) => {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<{ message?: string }>(AUTH_REQUIRED_EVENT_NAME, {
      detail: { message },
    })
  );
};

const getErrorMessage = (data: unknown, status: number): string => {
  if (data && typeof data === "object" && "message" in data && typeof (data as { message?: unknown }).message === "string") {
    return (data as { message: string }).message;
  }

  return `Request failed (${status})`;
};

const ensureOk = <T>(response: Response, data: T | null): T | null => {
  if (response.ok) {
    return data;
  }

  const message = getErrorMessage(data, response.status);
  if (response.status === 401) {
    notifyAuthRequired(message);
  }

  throw new ApiError(message, response.status);
};

const parseJson = async <T>(response: Response): Promise<T | null> => {
  const text = await response.text();
  if (!text) {
    return null;
  }

  return JSON.parse(text) as T;
};

export const fetchSession = async (): Promise<AuthSession> => {
  const response = await fetch("/api/auth/session", {
    cache: "no-store",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Session request failed (${response.status})`);
  }

  return parseJson<AuthSession>(response);
};

export const fetchMe = async (): Promise<MePayload> => {
  const response = await fetch("/api/me", {
    cache: "no-store",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Profile request failed (${response.status})`);
  }

  return parseJson<MePayload>(response);
};

export const fetchNetwork = async (): Promise<NetworkPayload> => {
  const response = await fetch("/api/network", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Network request failed (${response.status})`);
  }

  const payload = await parseJson<NetworkPayload>(response);
  return payload ?? {};
};

const requestJson = async <TResponse>(
  url: string,
  input: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    payload?: unknown;
  }
): Promise<TResponse | null> => {
  const response = await fetch(url, {
    method: input.method,
    headers: {
      "content-type": "application/json",
    },
    body: input.payload === undefined ? undefined : JSON.stringify(input.payload),
    cache: "no-store",
  });

  const data = await parseJson<TResponse>(response);

  return ensureOk(response, data);
};

export const postJson = async <TResponse>(url: string, payload: unknown): Promise<TResponse | null> => {
  return requestJson<TResponse>(url, {
    method: "POST",
    payload,
  });
};

export const patchJson = async <TResponse>(url: string, payload: unknown): Promise<TResponse | null> => {
  return requestJson<TResponse>(url, {
    method: "PATCH",
    payload,
  });
};

export const fetchEnsTlds = async (): Promise<EnsTldsPayload> => {
  const response = await fetch("/api/ens/tlds", {
    cache: "no-store",
  });

  const data = ensureOk(response, await parseJson<EnsTldsPayload>(response));
  return data ?? { tlds: [] };
};

export const postEnsCheck = async (payload: {
  label: string;
  tld: string;
  durationSeconds?: number;
}): Promise<EnsCheckPayload> => {
  const data = await postJson<EnsCheckPayload>("/api/ens/check", payload);
  return data ?? {};
};

export const requestPasswordReset = async (payload: { email: string; redirectTo?: string }) => {
  return postJson<{ status?: boolean; message?: string }>("/api/password/forgot-password", payload);
};

export const submitResetPassword = async (payload: { token: string; newPassword: string }) => {
  return postJson<{ status?: boolean; message?: string }>("/api/password/reset-password", payload);
};

export const fetchForumFeed = async (input: {
  limit?: number;
  cursor?: string;
  followingOnly?: boolean;
} = {}): Promise<ForumFeedPayload> => {
  const params = new URLSearchParams();
  if (input.limit) {
    params.set("limit", String(input.limit));
  }
  if (input.cursor) {
    params.set("cursor", input.cursor);
  }
  if (input.followingOnly !== undefined) {
    params.set("followingOnly", String(input.followingOnly));
  }

  const query = params.toString();
  const response = await fetch(`/api/forum/feed${query ? `?${query}` : ""}`, {
    cache: "no-store",
  });

  const payload = ensureOk(response, await parseJson<ForumFeedPayload>(response));
  return payload ?? { posts: [], nextCursor: null };
};

export const createForumPost = async (payload: {
  title: string;
  markdown: string;
  tags?: string[];
}) => {
  return postJson<{ post: ForumPostSummary; tags?: string[] }>("/api/forum/posts", payload);
};

export const fetchForumPostDetail = async (
  postId: string,
  input: { commentsLimit?: number; commentsCursor?: string } = {}
): Promise<ForumPostDetailPayload> => {
  const params = new URLSearchParams();
  if (input.commentsLimit) {
    params.set("commentsLimit", String(input.commentsLimit));
  }
  if (input.commentsCursor) {
    params.set("commentsCursor", input.commentsCursor);
  }

  const query = params.toString();
  const response = await fetch(`/api/forum/posts/${postId}${query ? `?${query}` : ""}`, {
    cache: "no-store",
  });

  const payload = ensureOk(response, await parseJson<ForumPostDetailPayload>(response));
  if (!payload) {
    throw new Error("Forum post payload is empty");
  }

  return {
    ...payload,
    commentsNextCursor: payload.commentsNextCursor ?? null,
  };
};

export const createForumComment = async (postId: string, payload: { markdown: string; parentId?: string }) => {
  return postJson<{ comment: ForumCommentSummary }>(`/api/forum/posts/${postId}/comments`, payload);
};

export const patchForumProfile = async (payload: {
  displayName?: string;
  headline?: string;
  bio?: string;
  location?: string;
  organization?: string;
  websiteUrl?: string;
  githubUsername?: string;
  brandingEmail?: string;
  displayWalletAddress?: string;
  displayEnsName?: string;
}) => {
  return patchJson<ForumProfilePayload>("/api/profile/me", payload);
};

export const fetchForumProfile = async (userId: string): Promise<ForumProfilePayload> => {
  const response = await fetch(`/api/profile/${userId}`, {
    cache: "no-store",
  });

  return ensureOk(response, await parseJson<ForumProfilePayload>(response)) ?? {};
};

export const submitForumReport = async (payload: {
  targetType: "post" | "comment" | "user";
  targetId: string;
  reason: string;
}) => {
  return postJson<{ reportId: string; status: ModerationReportStatus }>("/api/forum/reports", payload);
};

export const fetchModerationReports = async (input: {
  status?: ModerationReportStatus;
  limit?: number;
  cursor?: string;
} = {}): Promise<ModerationReportsPayload> => {
  const params = new URLSearchParams();
  if (input.status) {
    params.set("status", input.status);
  }
  if (input.limit) {
    params.set("limit", String(input.limit));
  }
  if (input.cursor) {
    params.set("cursor", input.cursor);
  }

  const query = params.toString();
  const response = await fetch(`/api/forum/mod/reports${query ? `?${query}` : ""}`, {
    cache: "no-store",
  });

  return ensureOk(response, await parseJson<ModerationReportsPayload>(response)) ?? { reports: [], nextCursor: null };
};

export const resolveModerationReport = async (payload: { reportId: string; status: Exclude<ModerationReportStatus, "open"> }) => {
  return patchJson<{
    reportId: string;
    previousStatus: ModerationReportStatus;
    status: Exclude<ModerationReportStatus, "open">;
    reviewedByUserId: string;
    reviewedAt: string;
  }>(`/api/forum/mod/reports/${payload.reportId}`, {
    status: payload.status,
  });
};

export const setModerationPostLock = async (payload: { postId: string; locked: boolean }) => {
  return postJson<{ postId: string; locked: boolean }>(`/api/forum/mod/posts/${payload.postId}/lock`, {
    locked: payload.locked,
  });
};

export const toggleForumReaction = async (payload: {
  targetType: "post" | "comment";
  targetId: string;
  reactionType?: string;
}) => {
  return postJson<{ active: boolean; targetType: string; targetId: string; reactionType: string }>(
    "/api/forum/reactions/toggle",
    {
      targetType: payload.targetType,
      targetId: payload.targetId,
      reactionType: payload.reactionType || "like",
    }
  );
};

export const shareForumPost = async (payload: { postId: string; shareComment?: string }) => {
  return postJson<{ id: string; postId: string; authorId: string }>("/api/forum/shares", payload);
};

export const toggleForumBookmark = async (payload: { postId: string; pinned?: boolean }) => {
  return postJson<{ bookmarked: boolean; postId: string; pinned?: boolean }>("/api/forum/bookmarks/toggle", payload);
};

export const toggleForumFollow = async (payload: { followeeUserId: string }) => {
  return postJson<{ following: boolean; followeeUserId: string }>("/api/forum/follows/toggle", payload);
};
