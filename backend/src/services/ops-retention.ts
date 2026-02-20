import { and, asc, eq, inArray, lte } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { backendEnv } from "../config/env";

type RunOpsRetentionInput = {
  batchLimit?: number;
  processedRetentionDays?: number;
  deadLetterRetentionDays?: number;
  internalAuditRetentionDays?: number;
};

export type RunOpsRetentionResult = {
  scanned: number;
  deletedProcessed: number;
  deletedDeadLetter: number;
  deletedAuditEvents: number;
  processedCutoff: Date;
  deadLetterCutoff: Date;
  auditCutoff: Date;
  startedAt: Date;
  finishedAt: Date;
};

const clamp = (value: number | undefined, fallback: number, max: number): number => {
  if (!value || !Number.isInteger(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(value, max));
};

const daysToCutoff = (days: number): Date => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const deleteWebhookEventsBatch = async (input: {
  status: "processed" | "dead_letter";
  cutoff: Date;
  limit: number;
}) => {
  const timestampField =
    input.status === "processed" ? schema.ensWebhookEvents.processedAt : schema.ensWebhookEvents.deadLetteredAt;

  const candidates = await authDb
    .select({
      id: schema.ensWebhookEvents.id,
    })
    .from(schema.ensWebhookEvents)
    .where(
      and(
        eq(schema.ensWebhookEvents.status, input.status),
        lte(timestampField, input.cutoff)
      )
    )
    .orderBy(asc(timestampField))
    .limit(input.limit);

  if (candidates.length === 0) {
    return {
      scanned: 0,
      deleted: 0,
    };
  }

  const candidateIds = candidates.map((candidate) => candidate.id);

  await authDb
    .delete(schema.ensWebhookEvents)
    .where(inArray(schema.ensWebhookEvents.id, candidateIds));

  return {
    scanned: candidates.length,
    deleted: candidateIds.length,
  };
};

const deleteInternalOpsAuditBatch = async (input: {
  cutoff: Date;
  limit: number;
}) => {
  const candidates = await authDb
    .select({
      id: schema.internalOpsAuditEvents.id,
    })
    .from(schema.internalOpsAuditEvents)
    .where(lte(schema.internalOpsAuditEvents.createdAt, input.cutoff))
    .orderBy(asc(schema.internalOpsAuditEvents.createdAt))
    .limit(input.limit);

  if (candidates.length === 0) {
    return {
      scanned: 0,
      deleted: 0,
    };
  }

  const candidateIds = candidates.map((candidate) => candidate.id);
  await authDb.delete(schema.internalOpsAuditEvents).where(inArray(schema.internalOpsAuditEvents.id, candidateIds));

  return {
    scanned: candidates.length,
    deleted: candidateIds.length,
  };
};

export const runOpsRetention = async (input: RunOpsRetentionInput = {}): Promise<RunOpsRetentionResult> => {
  const startedAt = new Date();
  const batchLimit = clamp(input.batchLimit, backendEnv.opsRetentionBatchLimit, 5000);
  const processedRetentionDays = clamp(
    input.processedRetentionDays,
    backendEnv.opsWebhookProcessedRetentionDays,
    365
  );
  const deadLetterRetentionDays = clamp(
    input.deadLetterRetentionDays,
    backendEnv.opsWebhookDeadLetterRetentionDays,
    365
  );
  const internalAuditRetentionDays = clamp(
    input.internalAuditRetentionDays,
    backendEnv.opsInternalAuditRetentionDays,
    3650
  );

  const processedCutoff = daysToCutoff(processedRetentionDays);
  const deadLetterCutoff = daysToCutoff(deadLetterRetentionDays);
  const auditCutoff = daysToCutoff(internalAuditRetentionDays);

  const [processedResult, deadLetterResult, internalAuditResult] = await Promise.all([
    deleteWebhookEventsBatch({
      status: "processed",
      cutoff: processedCutoff,
      limit: batchLimit,
    }),
    deleteWebhookEventsBatch({
      status: "dead_letter",
      cutoff: deadLetterCutoff,
      limit: batchLimit,
    }),
    deleteInternalOpsAuditBatch({
      cutoff: auditCutoff,
      limit: batchLimit,
    }),
  ]);

  return {
    scanned: processedResult.scanned + deadLetterResult.scanned + internalAuditResult.scanned,
    deletedProcessed: processedResult.deleted,
    deletedDeadLetter: deadLetterResult.deleted,
    deletedAuditEvents: internalAuditResult.deleted,
    processedCutoff,
    deadLetterCutoff,
    auditCutoff,
    startedAt,
    finishedAt: new Date(),
  };
};
