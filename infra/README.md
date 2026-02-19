# Infra Docker Compose

Infrastructure stack for local Evergreen Devparty development.

## Services
- PostgreSQL (`localhost:5436`)
- Redis (`localhost:6377`)
- Meilisearch (`localhost:7700`)
- NocoDB (`localhost:8080`)
- Mailpit SMTP + inbox UI (`localhost:1025`, `localhost:8025`)

## Mailpit Runtime Env
- `MAILPIT_MAX_MESSAGES` (default `1000`)
- `MAILPIT_SMTP_AUTH_ACCEPT_ANY` (default `true`)
- `MAILPIT_SMTP_AUTH_ALLOW_INSECURE` (default `true`, only untuk localhost)
- `MAILPIT_SEND_API_AUTH_ACCEPT_ANY` (default `true`)

Untuk aplikasi lokal, gunakan SMTP:
- host: `localhost`
- port: `1025`

## Blockchain Network (External)
- RPC: `https://rpc-api.oorthnexus.xyz`
- Chain ID: `131`
- Explorer: `https://analytics.oorthnexus.xyz`
- ENS contract and TLD deployment references: `deployment-custom.md`

## Quick start
1. Copy env template:
   - `cp infra/.env.example infra/.env`
2. Start stack:
   - `docker compose --env-file infra/.env -f infra/docker-compose.yml up -d`
3. Stop stack:
   - `docker compose --env-file infra/.env -f infra/docker-compose.yml down`

## Useful URLs
- Meilisearch: `http://localhost:7700`
- Mailpit UI: `http://localhost:8025`
- NocoDB UI: `http://localhost:8080`
