import { z } from "zod";

export const runReconciliationBodySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  staleMinutes: z.coerce.number().int().positive().max(7 * 24 * 60).optional(),
  dryRun: z.boolean().optional(),
});

export const runLimitBodySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
});

export const runIdentitySyncBodySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  staleMinutes: z.coerce.number().int().positive().max(7 * 24 * 60).optional(),
});

export const runOpsRetentionBodySchema = z.object({
  batchLimit: z.coerce.number().int().positive().max(5000).optional(),
  processedRetentionDays: z.coerce.number().int().positive().max(365).optional(),
  deadLetterRetentionDays: z.coerce.number().int().positive().max(365).optional(),
  internalAuditRetentionDays: z.coerce.number().int().positive().max(3650).optional(),
});

export const runForumSearchBackfillBodySchema = z.object({
  batchSize: z.coerce.number().int().positive().max(1000).optional(),
  includePosts: z.boolean().optional(),
  includeComments: z.boolean().optional(),
});

export const runForumSearchReindexBodySchema = z.object({
  batchSize: z.coerce.number().int().positive().max(1000).optional(),
  includePosts: z.boolean().optional(),
  includeComments: z.boolean().optional(),
  syncLimit: z.coerce.number().int().positive().max(500).optional(),
});

export const requeueForumSearchDeadLetterBodySchema = z.object({
  limit: z.coerce.number().int().positive().max(1000).optional(),
  targetType: z.enum(["post", "comment"]).optional(),
  targetIds: z.array(z.string().uuid()).max(1000).optional(),
  dryRun: z.boolean().optional(),
});

export const pauseForumSearchBodySchema = z.object({
  paused: z.boolean(),
  reason: z.string().max(1000).optional(),
  pausedBy: z.string().max(120).optional(),
});

export const cancelForumSearchQueueBodySchema = z.object({
  limit: z.coerce.number().int().positive().max(5000).optional(),
  statuses: z.array(z.enum(["pending", "processing", "failed", "dead_letter"])).max(4).optional(),
  dryRun: z.boolean().optional(),
});

export const forumSearchAuditQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().max(1000).optional(),
    outcome: z.enum(["completed", "failed"]).optional(),
    actor: z.string().max(120).optional(),
    createdAfter: z.coerce.date().optional(),
    createdBefore: z.coerce.date().optional(),
  })
  .refine(
    (value) =>
      value.createdAfter === undefined ||
      value.createdBefore === undefined ||
      value.createdAfter.getTime() <= value.createdBefore.getTime(),
    {
      message: "createdAfter must be before or equal to createdBefore",
      path: ["createdAfter"],
    }
  );

export const FORUM_SEARCH_REINDEX_COOLDOWN_MS = 30_000;
export const FORUM_SEARCH_REQUEUE_COOLDOWN_MS = 5_000;
export const FORUM_SEARCH_CANCEL_COOLDOWN_MS = 5_000;
