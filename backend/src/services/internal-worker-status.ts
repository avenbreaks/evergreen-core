import { and, count, eq, inArray, lte } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { getOpsMetricsSnapshot } from "./ops-metrics";

const INTENT_TRACKED_STATUSES = [
  "prepared",
  "committed",
  "registerable",
  "registered",
  "expired",
  "failed",
] as const;

const WEBHOOK_TRACKED_STATUSES = ["processing", "processed", "failed", "dead_letter"] as const;
const IDENTITY_TRACKED_STATUSES = ["pending", "active", "failed", "revoked"] as const;
const FORUM_SEARCH_SYNC_TRACKED_STATUSES = ["pending", "processing", "failed", "dead_letter"] as const;

type IntentStatus = (typeof INTENT_TRACKED_STATUSES)[number];
type WebhookStatus = (typeof WEBHOOK_TRACKED_STATUSES)[number];
type IdentityStatus = (typeof IDENTITY_TRACKED_STATUSES)[number];
type ForumSearchSyncStatus = (typeof FORUM_SEARCH_SYNC_TRACKED_STATUSES)[number];

export type InternalWorkerStatusSummary = {
  intents: {
    prepared: number;
    committed: number;
    registerable: number;
    registered: number;
    expired: number;
    failed: number;
    stuckTotal: number;
  };
  webhooks: {
    processing: number;
    processed: number;
    failed: number;
    deadLetter: number;
    retryReady: number;
  };
  identities: {
    pending: number;
    active: number;
    failed: number;
    revoked: number;
  };
  forumSearchSync: {
    pending: number;
    processing: number;
    failed: number;
    deadLetter: number;
  };
  runtimeMetrics: ReturnType<typeof getOpsMetricsSnapshot>;
  generatedAt: Date;
};

const buildIntentStatusMap = (rows: Array<{ status: IntentStatus; total: number }>) => {
  const map: Record<IntentStatus, number> = {
    prepared: 0,
    committed: 0,
    registerable: 0,
    registered: 0,
    expired: 0,
    failed: 0,
  };

  for (const row of rows) {
    map[row.status] = row.total;
  }

  return map;
};

const buildWebhookStatusMap = (rows: Array<{ status: WebhookStatus; total: number }>) => {
  const map: Record<WebhookStatus, number> = {
    processing: 0,
    processed: 0,
    failed: 0,
    dead_letter: 0,
  };

  for (const row of rows) {
    map[row.status] = row.total;
  }

  return map;
};

const buildIdentityStatusMap = (rows: Array<{ status: IdentityStatus; total: number }>) => {
  const map: Record<IdentityStatus, number> = {
    pending: 0,
    active: 0,
    failed: 0,
    revoked: 0,
  };

  for (const row of rows) {
    map[row.status] = row.total;
  }

  return map;
};

const buildForumSearchSyncStatusMap = (rows: Array<{ status: ForumSearchSyncStatus; total: number }>) => {
  const map: Record<ForumSearchSyncStatus, number> = {
    pending: 0,
    processing: 0,
    failed: 0,
    dead_letter: 0,
  };

  for (const row of rows) {
    map[row.status] = row.total;
  }

  return map;
};

export const getInternalWorkerStatusSummary = async (): Promise<InternalWorkerStatusSummary> => {
  const now = new Date();

  const [intentStatusRows, webhookStatusRows, identityStatusRows, forumSearchSyncStatusRows, retryReadyRows] = await Promise.all([
    authDb
      .select({
        status: schema.ensPurchaseIntents.status,
        total: count(),
      })
      .from(schema.ensPurchaseIntents)
      .where(inArray(schema.ensPurchaseIntents.status, INTENT_TRACKED_STATUSES))
      .groupBy(schema.ensPurchaseIntents.status),
    authDb
      .select({
        status: schema.ensWebhookEvents.status,
        total: count(),
      })
      .from(schema.ensWebhookEvents)
      .where(inArray(schema.ensWebhookEvents.status, WEBHOOK_TRACKED_STATUSES))
      .groupBy(schema.ensWebhookEvents.status),
    authDb
      .select({
        status: schema.ensIdentities.status,
        total: count(),
      })
      .from(schema.ensIdentities)
      .where(inArray(schema.ensIdentities.status, IDENTITY_TRACKED_STATUSES))
      .groupBy(schema.ensIdentities.status),
    authDb
      .select({
        status: schema.forumSearchSyncQueue.status,
        total: count(),
      })
      .from(schema.forumSearchSyncQueue)
      .where(inArray(schema.forumSearchSyncQueue.status, FORUM_SEARCH_SYNC_TRACKED_STATUSES))
      .groupBy(schema.forumSearchSyncQueue.status),
    authDb
      .select({
        total: count(),
      })
      .from(schema.ensWebhookEvents)
      .where(
        and(
          eq(schema.ensWebhookEvents.status, "failed"),
          lte(schema.ensWebhookEvents.nextRetryAt, now)
        )
      ),
  ]);

  const intentStatusMap = buildIntentStatusMap(intentStatusRows as Array<{ status: IntentStatus; total: number }>);
  const webhookStatusMap = buildWebhookStatusMap(webhookStatusRows as Array<{ status: WebhookStatus; total: number }>);
  const identityStatusMap = buildIdentityStatusMap(identityStatusRows as Array<{ status: IdentityStatus; total: number }>);
  const forumSearchSyncStatusMap = buildForumSearchSyncStatusMap(
    forumSearchSyncStatusRows as Array<{ status: ForumSearchSyncStatus; total: number }>
  );

  return {
    intents: {
      prepared: intentStatusMap.prepared,
      committed: intentStatusMap.committed,
      registerable: intentStatusMap.registerable,
      registered: intentStatusMap.registered,
      expired: intentStatusMap.expired,
      failed: intentStatusMap.failed,
      stuckTotal: intentStatusMap.prepared + intentStatusMap.committed + intentStatusMap.registerable,
    },
    webhooks: {
      processing: webhookStatusMap.processing,
      processed: webhookStatusMap.processed,
      failed: webhookStatusMap.failed,
      deadLetter: webhookStatusMap.dead_letter,
      retryReady: retryReadyRows[0]?.total ?? 0,
    },
    identities: {
      pending: identityStatusMap.pending,
      active: identityStatusMap.active,
      failed: identityStatusMap.failed,
      revoked: identityStatusMap.revoked,
    },
    forumSearchSync: {
      pending: forumSearchSyncStatusMap.pending,
      processing: forumSearchSyncStatusMap.processing,
      failed: forumSearchSyncStatusMap.failed,
      deadLetter: forumSearchSyncStatusMap.dead_letter,
    },
    runtimeMetrics: getOpsMetricsSnapshot(),
    generatedAt: now,
  };
};
