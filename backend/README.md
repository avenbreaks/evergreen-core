# Backend (Fastify)

Backend API untuk Evergreen Devparty dengan fokus:
- Better Auth bridge + session-aware protected routes
- SIWE wallet verification/linking
- ENS marketplace flow (check -> commitment -> register -> records)

## Endpoint utama
- Health: `GET /healthz`, `GET /readyz`
- Auth bridge: `ALL /api/auth/*`
- Session profile: `GET /api/me`
- Wallet: `GET /api/me/wallets`, `POST /api/me/wallets/link`
- Network metadata: `GET /api/network`
- SIWE: `POST /api/siwe/challenge`, `POST /api/siwe/verify`
- ENS public: `GET /api/ens/tlds`, `POST /api/ens/check`
- ENS protected:
  - `GET /api/ens/domains`
  - `GET /api/ens/intents`
  - `POST /api/ens/commitments`
  - `POST /api/ens/commitments/:intentId/confirm`
  - `POST /api/ens/registrations/:intentId/prepare`
  - `POST /api/ens/registrations/:intentId/confirm`
  - `POST /api/ens/records/address/prepare`
  - `POST /api/ens/renew/prepare`
- Forum protected:
  - `POST /api/forum/content/preview`
  - `POST /api/forum/posts`
  - `PATCH /api/forum/posts/:postId`
  - `DELETE /api/forum/posts/:postId`
  - `POST /api/forum/posts/:postId/comments`
  - `PATCH /api/forum/comments/:commentId`
  - `DELETE /api/forum/comments/:commentId`
  - `GET /api/forum/posts/:postId/drafts/me`
  - `PUT /api/forum/posts/:postId/drafts/me`
  - `DELETE /api/forum/posts/:postId/drafts/me`
- Forum public:
  - `GET /api/forum/posts`
  - `GET /api/forum/posts/:postId`
- ENS internal maintenance:
  - `POST /api/internal/ens/intents/:intentId/retry` (auth via `x-internal-secret`)
  - `POST /api/internal/ens/intents/:intentId/expire` (auth via `x-internal-secret`)
  - `POST /api/internal/ens/reconcile` (auth via `x-internal-secret`)
  - `POST /api/internal/workers/reconciliation/run` (auth via `x-internal-secret`)
  - `POST /api/internal/workers/tx-watcher/run` (auth via `x-internal-secret`)
  - `POST /api/internal/workers/identity-sync/run` (auth via `x-internal-secret`)
  - `POST /api/internal/workers/webhook-retry/run` (auth via `x-internal-secret`)
  - `POST /api/internal/workers/ops-retention/run` (auth via `x-internal-secret`)
  - `GET /api/internal/workers/status` (auth via `x-internal-secret`)
- Metrics:
  - `GET /metrics` (Prometheus text format, auth via `x-internal-secret`)

## Setup cepat
1. Copy env:
   - `cp backend/.env.example backend/.env`
2. Pastikan infra + DB sudah up dan migrasi sudah jalan.
3. Jalankan backend dari root:
   - `pnpm backend:dev`

## Auth model
- Protected routes membaca session dari Better Auth cookie.
- Tidak ada lagi `x-user-id` bootstrap header.
- Frontend harus kirim cookie auth (`credentials: include`).

## ENS tx model
- Backend menyiapkan payload tx (`to`, `functionName`, `args`, `value`).
- Frontend wallet mengeksekusi tx on-chain.
- Backend menerima tx hash untuk verifikasi receipt dan sinkronisasi state DB.

## ENS webhook internal contract
- Endpoint: `POST /api/webhooks/ens/tx`
- Auth wajib:
  - `x-webhook-timestamp` (unix seconds)
  - `x-webhook-signature` dengan format `sha256=<hex>`
  - signature dihitung dari `${timestamp}.${JSON.stringify(payload)}` memakai secret aktif webhook
  - secret rotation didukung via `WEBHOOK_ACTIVE_SECRET` + `WEBHOOK_NEXT_SECRET`
  - opsional allowlist IP via `WEBHOOK_IP_ALLOWLIST`
- Anti replay window dikontrol oleh `WEBHOOK_SIGNATURE_TTL_SECONDS` (default `300`).
- Event yang diterima:
  - `ens.commit.confirmed`
  - `ens.register.confirmed`
  - `ens.register.failed`
- Semua payload memakai `intentId` (UUID), contoh:

```json
{
  "event": "ens.register.confirmed",
  "data": {
    "intentId": "11111111-1111-4111-8111-111111111111",
    "txHash": "0x...",
    "setPrimary": true
  }
}
```

- Retry semantics:
  - Aman untuk retry callback yang sama berkali-kali.
  - Backend simpan idempotency event di DB (`ens_webhook_events`) berdasarkan dedupe key.
  - Jika callback duplikat, response akan mengandung `deduplicated: true`.
- Pola response:
  - sukses normal: `acknowledged: true` + hasil event
  - duplikat selesai: `deduplicated: true` + `outcome`
  - duplikat masih diproses: `deduplicated: true` + `processing: true`
- Error code umum:
  - `WEBHOOK_UNAUTHORIZED`
  - `WEBHOOK_SIGNATURE_EXPIRED`
  - `WEBHOOK_IP_NOT_ALLOWED`
  - `VALIDATION_ERROR`
  - `COMMIT_TX_FAILED`
  - `REGISTER_TX_FAILED`

## ENS reconciliation contract
- Endpoint: `POST /api/internal/ens/reconcile`
- Auth wajib: header `x-internal-secret`
- Request body (opsional):

```json
{
  "limit": 100,
  "staleMinutes": 15,
  "dryRun": false
}
```

- Response utama:
  - `acknowledged`
  - `reconcileRunId` (untuk tracing log)
  - ringkasan (`scanned`, `updated`, `expired`, `promotedToRegisterable`, `unchanged`)
  - daftar `intents` yang berubah status
- Contoh transition yang dihasilkan:
  - `committed -> registerable`
  - `committed/registerable -> expired` jika lewat `registerBy`

## ENS reconciliation worker
- Optional background job bisa diaktifkan via env:
  - `ENS_RECONCILIATION_INTERVAL_MS` (`0` untuk disable)
  - `ENS_RECONCILIATION_LIMIT`
  - `ENS_RECONCILIATION_STALE_MINUTES`
- Worker memakai Postgres advisory lock agar tidak ada overlap run antar instance backend.

## ENS tx watcher fallback
- Optional background watcher bisa diaktifkan via env:
  - `ENS_TX_WATCHER_INTERVAL_MS` (`0` untuk disable)
  - `ENS_TX_WATCHER_LIMIT`
- Watcher memeriksa intent `prepared/committed/registerable` untuk fallback saat webhook telat/hilang.
- Watcher juga memakai Postgres advisory lock agar tidak ada overlap run antar instance backend.

## ENS identity sync worker
- Optional background sync worker bisa diaktifkan via env:
  - `ENS_IDENTITY_SYNC_INTERVAL_MS` (`0` untuk disable)
  - `ENS_IDENTITY_SYNC_LIMIT`
  - `ENS_IDENTITY_SYNC_STALE_MINUTES`
- Worker memvalidasi ownership dan expiry ENS domain yang sudah terdaftar (`ens_identities`) agar status tetap sinkron dengan on-chain.
- Worker juga memakai Postgres advisory lock agar tidak ada overlap run antar instance backend.

## Ops retention cleanup
- Optional background cleanup bisa diaktifkan via env:
  - `OPS_RETENTION_INTERVAL_MS` (`0` untuk disable)
  - `OPS_RETENTION_BATCH_LIMIT`
  - `OPS_WEBHOOK_PROCESSED_RETENTION_DAYS`
  - `OPS_WEBHOOK_DEAD_LETTER_RETENTION_DAYS`
- Cleanup menghapus event webhook operasional lama (`processed` dan `dead_letter`) per batch.

## Runtime metrics and alerts
- Endpoint `/metrics` expose counter/gauge operasional backend dalam format Prometheus.
- Hook alert bawaan akan log `warn/error` untuk:
  - dead-letter webhook yang melewati threshold,
  - retry depth webhook yang terlalu tinggi,
  - skip streak worker yang beruntun.
- Konfigurasi threshold lewat env:
  - `ALERT_WEBHOOK_DEAD_LETTER_THRESHOLD`
  - `ALERT_WEBHOOK_RETRY_DEPTH_THRESHOLD`
  - `ALERT_WORKER_SKIP_STREAK_THRESHOLD`
