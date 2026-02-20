# Backend (Fastify)

Evergreen Devparty backend API.

Core responsibilities:
- Better Auth bridge and session-protected APIs
- SIWE wallet verification and account linking
- ENS marketplace flow (check -> commitment -> register -> records)
- Forum/social/discovery/moderation APIs
- Internal workers, operational controls, and metrics

## Main Endpoints

- Health: `GET /healthz`, `GET /readyz`
- Auth bridge: `ALL /api/auth/*`
- Session profile: `GET /api/me`
- Wallet: `GET /api/me/wallets`, `POST /api/me/wallets/link`
- Network metadata: `GET /api/network`
- SIWE: `POST /api/siwe/challenge`, `POST /api/siwe/verify`

### ENS Public
- `GET /api/ens/tlds`
- `POST /api/ens/check`

### ENS Protected
- `GET /api/ens/domains`
- `GET /api/ens/intents`
- `POST /api/ens/commitments`
- `POST /api/ens/commitments/:intentId/confirm`
- `POST /api/ens/registrations/:intentId/prepare`
- `POST /api/ens/registrations/:intentId/confirm`
- `POST /api/ens/records/address/prepare`
- `POST /api/ens/renew/prepare`

### Forum Protected
- `POST /api/forum/content/preview`
- `POST /api/forum/posts`
- `PATCH /api/forum/posts/:postId`
- `DELETE /api/forum/posts/:postId`
- `POST /api/forum/posts/:postId/comments`
- `PATCH /api/forum/comments/:commentId`
- `DELETE /api/forum/comments/:commentId`
- `POST /api/forum/reactions/toggle`
- `POST /api/forum/shares`
- `POST /api/forum/bookmarks/toggle`
- `POST /api/forum/follows/toggle`
- `POST /api/forum/posts/:postId/pin`
- `POST /api/forum/reports`
- `POST /api/forum/mod/posts/:postId/lock`
- `GET /api/notifications`
- `PATCH /api/notifications/:notificationId/read`
- `PATCH /api/profile/me`
- `GET /api/forum/posts/:postId/drafts/me`
- `PUT /api/forum/posts/:postId/drafts/me`
- `DELETE /api/forum/posts/:postId/drafts/me`

### Forum Public
- `GET /api/forum/feed`
- `GET /api/forum/search`
- `GET /api/forum/trending-tags`
- `GET /api/forum/top-active`
- `GET /api/forum/top-topics`
- `GET /api/forum/top-discussion`
- `GET /api/forum/posts`
- `GET /api/forum/posts/:postId`
- `GET /api/profile/:userId`
- `GET /api/profile/:userId/analytics`

### ENS/Internal Operations
- `POST /api/internal/ens/intents/:intentId/retry` (requires `x-internal-secret`)
- `POST /api/internal/ens/intents/:intentId/expire` (requires `x-internal-secret`)
- `POST /api/internal/ens/reconcile` (requires `x-internal-secret`)
- `POST /api/internal/workers/reconciliation/run` (requires `x-internal-secret`)
- `POST /api/internal/workers/tx-watcher/run` (requires `x-internal-secret`)
- `POST /api/internal/workers/identity-sync/run` (requires `x-internal-secret`)
- `POST /api/internal/workers/webhook-retry/run` (requires `x-internal-secret`)
- `POST /api/internal/workers/ops-retention/run` (requires `x-internal-secret`)
- `GET /api/internal/workers/status` (requires `x-internal-secret`)

### Forum Search Internal Controls
- `POST /api/internal/workers/forum-search-sync/run` (requires `x-internal-secret`)
- `POST /api/internal/workers/forum-search-backfill/run` (requires `x-internal-secret`)
- `POST /api/internal/workers/forum-search/reindex` (requires `x-internal-secret`)
- `POST /api/internal/workers/forum-search/pause` (requires `x-internal-secret`)
- `POST /api/internal/workers/forum-search/cancel-queue` (requires `x-internal-secret`)
- `GET /api/internal/workers/forum-search/status` (requires `x-internal-secret`)
- `POST /api/internal/workers/forum-search/requeue-dead-letter` (requires `x-internal-secret`)
- `GET /api/internal/workers/forum-search/audit` (requires `x-internal-secret`)
- `GET /api/internal/forum/mvp/status` (requires `x-internal-secret`)

### Metrics
- `GET /metrics` (Prometheus format, requires `x-internal-secret`)
- Includes forum action counters (`reactions/comments/reports`) and forum endpoint latency metrics.

## Quick Start

1. Copy env file:
   - `cp backend/.env.example backend/.env`
2. Ensure infra and database are running and migrations are applied.
3. Run backend from repository root:
   - `pnpm backend:dev`

## Auth Model

- Protected routes read Better Auth session from cookies.
- No bootstrap `x-user-id` header is used.
- Frontend must send auth cookies (`credentials: include`).

## ENS Transaction Model

- Backend prepares transaction payloads (`to`, `functionName`, `args`, `value`).
- Frontend wallet executes transactions on-chain.
- Backend receives tx hash for receipt verification and DB state reconciliation.

## Forum Search Model

- `GET /api/forum/search` uses Meilisearch ranking when `MEILI_URL` is configured.
- Index sync runs asynchronously through DB queue (`forum_search_sync_queue`) and workers.
- Manual sync: `POST /api/internal/workers/forum-search-sync/run`.
- Full bootstrap backfill: `POST /api/internal/workers/forum-search-backfill/run`.
- One-shot reindex (backfill + sync): `POST /api/internal/workers/forum-search/reindex`.
- Pause/resume sync: `POST /api/internal/workers/forum-search/pause`.
- Cancel active queue (`pending/processing/failed`): `POST /api/internal/workers/forum-search/cancel-queue`.
- Queue/runtime status: `GET /api/internal/workers/forum-search/status`.
- Dead-letter requeue: `POST /api/internal/workers/forum-search/requeue-dead-letter`.
- `cancel-queue` and `requeue-dead-letter` support `dryRun=true`.
- Audit trail endpoint: `GET /api/internal/workers/forum-search/audit`.
- Audit filters: `outcome`, `actor`, `createdAfter`, `createdBefore`, `limit`.
- Internal cooldown protects reindex/requeue/cancel from burst triggering.
- `ops-retention` also cleans old internal audit events via `OPS_INTERNAL_AUDIT_RETENTION_DAYS`.
- If Meilisearch is unavailable, search falls back to DB query.

## Forum Discovery Notes

- `GET /api/forum/top-topics` ranks creators using aggregated topic popularity (reactions + comments + shares), not single-post ranking.

## ENS Webhook Contract

- Endpoint: `POST /api/webhooks/ens/tx`
- Required headers:
  - `x-webhook-timestamp` (unix seconds)
  - `x-webhook-signature` (`sha256=<hex>`)
- Signature input: `${timestamp}.${JSON.stringify(payload)}` using active webhook secret.
- Secret rotation via `WEBHOOK_ACTIVE_SECRET` + `WEBHOOK_NEXT_SECRET`.
- Optional IP allowlist via `WEBHOOK_IP_ALLOWLIST`.
- Replay window controlled by `WEBHOOK_SIGNATURE_TTL_SECONDS` (default `300`).
- Supported events:
  - `ens.commit.confirmed`
  - `ens.register.confirmed`
  - `ens.register.failed`
- Idempotency is persisted in `ens_webhook_events`.

## ENS Reconciliation Endpoint

- Endpoint: `POST /api/internal/ens/reconcile`
- Requires `x-internal-secret`
- Optional request body:

```json
{
  "limit": 100,
  "staleMinutes": 15,
  "dryRun": false
}
```

## Background Workers

- Reconciliation worker: `ENS_RECONCILIATION_INTERVAL_MS`, `ENS_RECONCILIATION_LIMIT`, `ENS_RECONCILIATION_STALE_MINUTES`
- Tx watcher: `ENS_TX_WATCHER_INTERVAL_MS`, `ENS_TX_WATCHER_LIMIT`
- Identity sync: `ENS_IDENTITY_SYNC_INTERVAL_MS`, `ENS_IDENTITY_SYNC_LIMIT`, `ENS_IDENTITY_SYNC_STALE_MINUTES`
- Ops retention: `OPS_RETENTION_INTERVAL_MS`, `OPS_RETENTION_BATCH_LIMIT`, `OPS_WEBHOOK_*_RETENTION_DAYS`, `OPS_INTERNAL_AUDIT_RETENTION_DAYS`
- Workers use Postgres advisory locks to prevent cross-instance overlap.

## Runtime Metrics and Alerts

- `/metrics` exposes Prometheus counters/gauges.
- Built-in alert hooks log warn/error for:
  - dead-letter webhook threshold breaches,
  - high webhook retry depth,
  - repeated worker skip streaks.
- Threshold env vars:
  - `ALERT_WEBHOOK_DEAD_LETTER_THRESHOLD`
  - `ALERT_WEBHOOK_RETRY_DEPTH_THRESHOLD`
  - `ALERT_WORKER_SKIP_STREAK_THRESHOLD`
