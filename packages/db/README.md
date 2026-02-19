# packages/db

Shared database package for Evergreen Devparty.

## Contains
- Drizzle schema for auth + user core tables.
- Drizzle config for migration generation.
- Database client factory for PostgreSQL.

## Main files
- `src/schema/user-core.ts`
- `src/schema/auth.ts`
- `src/schema/relations.ts`
- `src/client.ts`
- `src/migrate.ts`
- `drizzle.config.ts`
- `drizzle/0000_initial_auth_user_core.sql`
- `drizzle/0001_ens_marketplace_flow.sql`

## Notes
- IDs are `text` to stay flexible with Better Auth/custom ID generators.
- Wallet addresses should be normalized to lowercase before insert.
- ENS state is tracked in `ens_identities.status` (`pending`, `active`, `failed`, `revoked`).
- ENS commit/register workflow tracking lives in `ens_purchase_intents`.

## Migration
- Generate migration: `pnpm --filter @evergreen-devparty/db db:generate`
- Apply migration: `pnpm --filter @evergreen-devparty/db db:migrate`
