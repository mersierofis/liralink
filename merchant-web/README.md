# merchant-web

Owner: Vuslat. Desktop web app a Turkish merchant uses to create LiraLink payment links, watch
payments arrive, see their TRY balance, and withdraw to their IBAN. Read `../docs/00-PROJECT.md`
first, then `../docs/03-MERCHANT-WEB.md` for the full brief and `../docs/04-BACKEND-HANDOFF.md` for
what the backend actually returns.

## Stack

Vite + React 19 + TypeScript (strict) + Tailwind CSS + shadcn/ui (hand-rolled components on
Radix primitives) + TanStack Query + React Router v6 + react-hook-form/zod + MSW.

## Screens

Login/Register · Dashboard (balance + recent payments + this-week stats) · Links (table, filter,
create-link dialog, link-created dialog with QR/copy/WhatsApp) · Link detail (the projector demo
screen — payments, explorer links, settlement timeline, live polling) · Payments · Withdrawals ·
Settings (business name, IBAN, auto-save slider).

## Run locally

```bash
nvm use                # Node 22.23.2, repo-root .nvmrc
npm install
cp .env.example .env    # then point VITE_API_URL at a backend, see below
npm run dev             # http://localhost:5173
```

### `.env`

```
VITE_API_URL=...                 # backend base URL, must end in /api
VITE_USE_MOCK=true|false         # true = MSW mock handlers, false = real API
VITE_EXPLORER_TX_URL=https://stellar.expert/explorer/testnet/tx/
VITE_EXPLORER_ACCOUNT_URL=https://stellar.expert/explorer/testnet/account/
```

### Against the real backend

This repo's own `.env` (git-ignored) currently points at the live testnet deployment:
`VITE_API_URL=https://liralink-api.tutorialplatform.com/api`, `VITE_USE_MOCK=false`.

Demo login: `demo@liralink.app` — the password isn't in the repo (it was rotated out, see
04-BACKEND-HANDOFF.md §5); ask Hasan or Vuslat for it.

### Against the mock API (no backend needed)

Set `VITE_USE_MOCK=true` in `.env` and restart `npm run dev`. MSW serves every merchant endpoint
from an in-memory fixture set: the same demo merchant/IBAN, 6 seeded links (2 open, 3 paid, 1
expired) with realistic tx hashes and completed settlements, and a balance derived from them the
same way the real backend computes it. Log in with `demo@liralink.app` / `mock-password` (a
mock-only credential, unrelated to the real account's password above).

**Simulating a payment in mock mode:** open an *open* link's detail page
(`/links/:id` — click into `DEMO0001` or `DEMO0002` from the Links table) and click **Simulate
payment**. After ~2s the link flips to `paid` (the projector-demo toast fires), and its settlement
walks `pending → processing → completed` over the following ~6s — the same transition the real
Horizon listener + settlement service produce, rehearsable without a wallet or a live backend.
This button only renders when `VITE_USE_MOCK=true`; it calls a mock-only endpoint
(`POST /mock/pay/:id`) that doesn't exist on the real API.

## Scripts

```bash
npm run dev         # dev server
npm run build        # tsc -b && vite build
npm run lint         # eslint
npm run typecheck    # tsc -b --noEmit
npm run test         # vitest run
```
