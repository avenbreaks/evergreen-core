# packages/auth

Authentication package for Evergreen Devparty.

## Includes
- Better Auth instance with Drizzle adapter.
- SIWE challenge + verification helpers.
- Wallet linking helpers for Better Auth account records.
- ENS pending-claim helper for backend service layer.
- Mail delivery abstraction (localhost SMTP via Mailpit, production API via Unosend).

## Files
- `src/auth.ts`: Better Auth configuration.
- `src/env.ts`: runtime env parsing.
- `src/siwe.ts`: SIWE nonce, verify, wallet/account linking.
- `src/ens.ts`: ENS validation + pending claim persistence.
- `src/network.ts`: OorthNexus chain + ENS contract references.
- `src/mail.ts`: auth email sender for SMTP and Unosend API.
- `src/index.ts`: exports.

## Usage notes
- Copy `.env.example` values to your runtime env.
- Keep `BETTER_AUTH_SECRET` at least 32 chars.
- Normalize wallet addresses to lowercase before persistence.
- ENS production contract references are documented in `deployment-custom.md`.
- For local mail, use `MAIL_PROVIDER=smtp` with `SMTP_HOST=localhost` and `SMTP_PORT=1025`.
- For production mail, use `MAIL_PROVIDER=unosend` and set `UNOSEND_API_KEY`.
