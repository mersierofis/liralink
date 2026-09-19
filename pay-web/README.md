# LiraLink Pay Web

Mobile-first PWA for customers abroad who open a LiraLink payment link and pay in **USDC on Stellar testnet**.

Owner: **Yunus**. Specs: `../docs/00-PROJECT.md` → `../docs/02-PAY-WEB.md`. Types: `../docs/api.types.ts` (copied to `src/api/types.ts`).

## Run

```bash
# from repo root
nvm use                 # Node 22
cd pay-web
cp .env.example .env    # defaults to the live API
npm install
npx msw init public/ --save
npm run dev             # http://localhost:5174
```

Mock mode: set `VITE_USE_MOCK=true`, then `/p/DEMO0001` (open), `/p/DEMO0002` (paid), `/p/DEMO0003` (expired), `/p/DEMO0004` (cancelled), `/p/DEMO0001?mockpay=1` (skip wallet).

## Freighter setup (required for a real payment)

1. Install the [Freighter](https://www.freighter.app/) Chrome extension.
2. Create a wallet → **Settings → Network → Testnet**.
3. Copy your `G…` address.
4. Fund with XLM: [Stellar Lab](https://lab.stellar.org) → Testnet → Friendbot.
5. Add a **USDC** trustline for issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` (Lab → Change Trust).
6. Get testnet USDC from [faucet.circle.com](https://faucet.circle.com) → Stellar.

## Privy email path (secondary)

Freighter stays the stage demo. Optional fallback behind env flags (see `docs/spikes/privy.md`):

```bash
VITE_PRIVY_ENABLED=true
VITE_PRIVY_APP_ID=cmu888gb8001d0cjsugfqh6mo   # App ID only — secret on backend
```

UI shows **“No wallet? Sign in with email”** under Connect wallet. **Kill line:** if this path is not demo-ready by **01:00 local 2026-09-20**, remove Privy code without discussion.

## Pay flow

1. `GET /api/pay/:code` → quote (`rails.memo.destination` + `rails.memo.memo`).
2. Connect wallet (Stellar Wallets Kit / Freighter).
3. Build classic USDC payment with **`Memo.text(rails.memo.memo)`** — never drop the memo.
4. Sign → submit to Horizon → `POST /pay/:code/submitted` → poll `/status` every 2 s → receipt.

## Scripts

- `npm run dev` — Vite on port **5174** (CORS-allowed)
- `npm run typecheck`
- `npm run lint`
- `npm run build`
