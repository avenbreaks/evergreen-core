import { eq } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

export const FORUM_SEARCH_CONTROL_WORKER = "forum-search";

export type ForumSearchControlState = {
  worker: string;
  paused: boolean;
  pauseReason: string | null;
  pausedBy: string | null;
  pausedAt: Date | null;
  updatedAt: Date | null;
};

const sanitizeText = (value: string | undefined): string | null => {
  const next = value?.trim();
  return next ? next : null;
};

export const getForumSearchControlState = async (): Promise<ForumSearchControlState> => {
  const [row] = await authDb
    .select()
    .from(schema.internalWorkerControls)
    .where(eq(schema.internalWorkerControls.worker, FORUM_SEARCH_CONTROL_WORKER))
    .limit(1);

  if (!row) {
    return {
      worker: FORUM_SEARCH_CONTROL_WORKER,
      paused: false,
      pauseReason: null,
      pausedBy: null,
      pausedAt: null,
      updatedAt: null,
    };
  }

  return {
    worker: row.worker,
    paused: row.isPaused,
    pauseReason: row.pauseReason,
    pausedBy: row.pausedBy,
    pausedAt: row.pausedAt,
    updatedAt: row.updatedAt,
  };
};

export const setForumSearchPauseState = async (input: {
  paused: boolean;
  reason?: string;
  pausedBy?: string;
}): Promise<ForumSearchControlState> => {
  const now = new Date();
  const pauseReason = input.paused ? sanitizeText(input.reason) : null;
  const pausedBy = input.paused ? sanitizeText(input.pausedBy) : null;
  const pausedAt = input.paused ? now : null;

  await authDb
    .insert(schema.internalWorkerControls)
    .values({
      worker: FORUM_SEARCH_CONTROL_WORKER,
      isPaused: input.paused,
      pauseReason,
      pausedBy,
      pausedAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.internalWorkerControls.worker,
      set: {
        isPaused: input.paused,
        pauseReason,
        pausedBy,
        pausedAt,
        updatedAt: now,
      },
    });

  return getForumSearchControlState();
};
