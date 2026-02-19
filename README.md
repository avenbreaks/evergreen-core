# Evergreen Devparty

Open source forum + social networking platform for developers, with Better Auth, SIWE, ENS (private chain), and modular monorepo architecture.

## Workspace
- `packages/db`: Drizzle schema, migration, and db client.
- `packages/auth`: Better Auth config + SIWE/ENS helpers.
- `infra`: local infrastructure (Postgres, Redis, Meilisearch, NocoDB, Mailpit).
- `docs/architecture`: architecture and flow docs.

## Local bootstrap
1. Copy infra env:
   - `cp infra/.env.example infra/.env`
2. Start infrastructure:
   - `pnpm infra:up`
3. Export `DATABASE_URL` and auth env vars (see `packages/auth/.env.example`).
4. Run migrations:
   - `pnpm db:migrate`

## Notes
- Initial migration is provided in `packages/db/drizzle`.
- Better Auth model mapping is configured in `packages/auth/src/auth.ts`.
- SIWE nonce + wallet link flow helpers live in `packages/auth/src/siwe.ts`.
- Email setup is documented in `docs/email-delivery.md` (Mailpit localhost, Unosend production).
- Blockchain target network: OorthNexus (`chainId 131`, `https://rpc-api.oorthnexus.xyz`).
- ENS production contract references live in `deployment-custom.md`.
