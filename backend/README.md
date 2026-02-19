# Backend (Fastify)

Backend API scaffold untuk Evergreen Devparty.

## Fitur scaffold
- Fastify server dengan CORS dan request logging.
- Bridge route Better Auth: `/api/auth/*`.
- SIWE routes: `/api/siwe/challenge`, `/api/siwe/verify`.
- ENS claim route: `/api/ens/claim`.
- Network metadata route: `/api/network`.
- Health/ready probes: `/healthz`, `/readyz`.

## Setup cepat
1. Copy env:
   - `cp backend/.env.example backend/.env`
2. Install deps workspace (root):
   - `pnpm install`
3. Jalankan backend (root):
   - `pnpm backend:dev`

## Catatan auth user context
Untuk endpoint `POST /api/siwe/verify` (link wallet) dan `POST /api/ens/claim`, scaffold ini memakai header:
- `x-user-id: <user-id>`

Header ini sementara untuk bootstrap backend. Saat auth middleware session sudah siap, ganti dengan user context dari Better Auth session.
