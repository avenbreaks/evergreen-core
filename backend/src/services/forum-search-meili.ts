import { backendEnv } from "../config/env";

import { type ForumSearchSyncTargetType } from "./forum-search-sync-queue";

type SearchResult = {
  postIds: string[];
  commentIds: string[];
};

export type ForumSearchDocument = {
  objectID: string;
  targetType: ForumSearchSyncTargetType;
  targetId: string;
  postId: string | null;
  title: string | null;
  content: string;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string | null;
};

type MeiliErrorResponse = {
  message?: unknown;
  code?: unknown;
};

const baseUrl = backendEnv.meiliUrl ? backendEnv.meiliUrl.replace(/\/+$/, "") : null;
let ensuredIndex = false;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const toMeiliError = async (response: Response): Promise<Error> => {
  let message = `Meilisearch request failed with ${response.status}`;

  try {
    const payload = (await response.json()) as MeiliErrorResponse;
    if (typeof payload.message === "string" && payload.message.trim()) {
      message = payload.message;
    }
  } catch {
    // Ignore response parse errors and keep fallback message.
  }

  return new Error(message);
};

const requestMeili = async (path: string, init?: RequestInit): Promise<unknown> => {
  if (!baseUrl) {
    throw new Error("Meilisearch is not configured");
  }

  const controller = new AbortController();
  const timeoutMs = backendEnv.forumSearchMeiliTimeoutMs;
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(backendEnv.meiliApiKey
          ? {
              Authorization: `Bearer ${backendEnv.meiliApiKey}`,
            }
          : {}),
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Meilisearch request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw await toMeiliError(response);
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  return JSON.parse(text) as unknown;
};

const ensureForumIndex = async (): Promise<void> => {
  if (!baseUrl || ensuredIndex) {
    return;
  }

  const encodedUid = encodeURIComponent(backendEnv.meiliForumIndexUid);

  try {
    await requestMeili(`/indexes/${encodedUid}`, {
      method: "GET",
    });
    ensuredIndex = true;
    return;
  } catch {
    const payload = await requestMeili("/indexes", {
      method: "POST",
      body: JSON.stringify({
        uid: backendEnv.meiliForumIndexUid,
        primaryKey: "objectID",
      }),
    });

    if (isObject(payload)) {
      const message = payload.message;
      if (typeof message === "string" && message.includes("already exists")) {
        ensuredIndex = true;
        return;
      }
    }

    ensuredIndex = true;
  }
};

const pushUnique = (arr: string[], value: string, max: number): void => {
  if (arr.length >= max || arr.includes(value)) {
    return;
  }

  arr.push(value);
};

export const isForumSearchMeiliEnabled = (): boolean => Boolean(baseUrl);

export const searchForumContentViaMeili = async (input: {
  query: string;
  limit: number;
}): Promise<SearchResult | null> => {
  if (!baseUrl) {
    return null;
  }

  await ensureForumIndex();

  const response = await requestMeili(`/indexes/${encodeURIComponent(backendEnv.meiliForumIndexUid)}/search`, {
    method: "POST",
    body: JSON.stringify({
      q: input.query,
      limit: Math.max(1, Math.min(input.limit * 3, 300)),
      attributesToRetrieve: ["targetType", "targetId"],
    }),
  });

  if (!isObject(response) || !Array.isArray(response.hits)) {
    return {
      postIds: [],
      commentIds: [],
    };
  }

  const postIds: string[] = [];
  const commentIds: string[] = [];
  for (const hit of response.hits) {
    if (!isObject(hit)) {
      continue;
    }

    const targetType = hit.targetType;
    const targetId = hit.targetId;
    if (typeof targetType !== "string" || typeof targetId !== "string") {
      continue;
    }

    if (targetType === "post") {
      pushUnique(postIds, targetId, input.limit);
      continue;
    }

    if (targetType === "comment") {
      pushUnique(commentIds, targetId, input.limit);
    }
  }

  return {
    postIds,
    commentIds,
  };
};

export const upsertForumSearchDocuments = async (documents: ForumSearchDocument[]): Promise<void> => {
  if (!baseUrl || documents.length === 0) {
    return;
  }

  await ensureForumIndex();

  await requestMeili(`/indexes/${encodeURIComponent(backendEnv.meiliForumIndexUid)}/documents`, {
    method: "POST",
    body: JSON.stringify(documents),
  });
};

export const deleteForumSearchDocuments = async (objectIds: string[]): Promise<void> => {
  if (!baseUrl || objectIds.length === 0) {
    return;
  }

  await ensureForumIndex();

  await requestMeili(`/indexes/${encodeURIComponent(backendEnv.meiliForumIndexUid)}/documents/delete-batch`, {
    method: "POST",
    body: JSON.stringify(objectIds),
  });
};
