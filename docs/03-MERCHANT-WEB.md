# LiraLink Merchant Web — Design

> Read [`00-PROJECT.md`](00-PROJECT.md) first. This doc describes `merchant-web`: the **desktop web
> app a Turkish merchant or exporter uses** to create payment links, watch payments arrive and see
> the lira reach their IBAN.

## Stack

- **Vite + React 19 + TypeScript strict**, desktop-first, responsive down to tablet.
- **Tailwind CSS** + **shadcn/ui** (Table, Card, Badge, Dialog, Sheet, Form, Input, Select, Tabs,
  Sonner, Skeleton, Slider).
- **TanStack Query** (fetching, polling); **react-hook-form + zod** (forms); **React Router**.
- **MSW** for a mock API. UI language: English. No Next.js, no Redux, no CSS-in-JS.

## Screens

| Route | Screen | Content |
|---|---|---|
| `/login`, `/register` | Auth | Email, password (+ business name on register). JWT in memory + `sessionStorage`; redirect to `/` when signed in |
| `/` | **Dashboard** | Balance card: **Available TRY** (balance mode) or **Paid out TRY** (auto-payout mode), Pending TRY, Saved USDC and Unallocated USDC when > 0. "Create link". Last 5 payments, polled every 5 s. Links open / paid this week |
| `/links` | **Links** | Code, title, TRY, ≈ USDC, status badge, created, actions (copy URL, QR, cancel). Status filter. "Create link" dialog: title, description, amount (₺, exactly 2 dp), expiry (24 h default). On success: URL with copy, **QR code**, **Share on WhatsApp** |
| `/links/:id` | **Link detail** | The link, every payment (tx hash, payer, rail, explorer link), received vs quoted, and the settlement timeline (pending → processing → completed). Polls every 3 s while `open`/`underpaid`. "Retry on-chain" when `onchain` is `null`. **The projector screen of the demo** |
| `/payments` | **Payments** | Date, link, rail, USDC received, FX rate, TRY, settlement status, explorer link |
| `/withdrawals` | **Withdrawals** | Balance mode: withdraw dialog (≤ available, IBAN prefilled and validated) + history. Auto-payout mode: "Paid to your IBAN automatically" and the payout history. USDC withdrawals from Saved / Unallocated to the merchant's own wallet |
| `/settings` | **Settings** | Business name, IBAN, **Auto-save %** slider 0–50 ("Keep part of every payment in USDC"), password change |

Global: sidebar nav, top bar with business name and logout, a toast on every mutation, loading
skeletons, empty states ("No links yet — create your first one"), error states with retry.

`settlementMode` from `GET /me` decides the balance wording and whether a TRY withdraw button exists
at all (`POST /withdrawals` is `409` in `auto_payout`). A `sep24` settlement waiting on KYC shows a
**Complete verification** button that opens `interactiveUrl`.

## The demo moment

Link detail on a projector at 1080p: the status flips **Open → Paid** in real time when the payer
pays from their phone, the settlement steps light up, and the balance updates. Make that transition
visibly satisfying — badge colour change, a subtle animation, a toast "Payment received · 5,000.00
TRY". Do not over-animate anything else.

## API usage

Every merchant endpoint in [`00-PROJECT.md`](00-PROJECT.md) §6. The API client adds
`Authorization: Bearer`, maps `ApiError`, and redirects to `/login` on `401` — but a `403` from a
wrong `currentPassword` is an inline error, not a logout.

Hooks: `useMe`, `useLinks(filters)`, `useLink(id)` (3 s while payable), `useCreateLink`,
`useCancelLink`, `useRetryOnchain`, `useBalance` (5 s), `usePayments`, `useSettlements`,
`useWithdrawals`, `useCreateWithdrawal`, `useUsdcWithdrawals`, `useCreateUsdcWithdrawal`,
`useUnallocated`, `useUpdateMe`.

**Money:** TRY with `Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' })`; USDC at
2 dp with the full 7 dp in a tooltip. The UI does no arithmetic beyond display. `POST /links` can
take several seconds while it waits for the Soroban transaction — show a spinner.

## Configuration (`VITE_*`, public by nature)

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | API base, e.g. `http://localhost:3000/api` |
| `VITE_USE_MOCK` | `true` boots MSW |
| `VITE_EXPLORER_TX_URL` | e.g. `https://stellar.expert/explorer/testnet/tx/` |
| `VITE_EXPLORER_ACCOUNT_URL` | e.g. `https://stellar.expert/explorer/testnet/account/` |

## Mock API

All merchant names and IBANs in this repo are fictional test data.

Stateful, in memory, implementing every merchant endpoint:
- Demo merchant `demo@liralink.app` / `DEMO_PASSWORD` (a mock-only placeholder, never the real
  password), business "Erdemli Narenciye A.Ş.", IBAN `TR00 0000 0000 0000 0000 0000 00`.
- Six links: two open, three paid (with payments, completed settlements, 64-hex tx hashes, `G…`
  payer addresses), one expired. Titles like "Lemon order #1042 — Al Rashid Trading (Dubai)",
  "Orange shipment #77 — Berlin Fruchthandel".
- The balance is derived from mock settlements and withdrawals the same way the backend derives it.
- A mock-only `POST /mock/pay/:id` flips an open link to paid after 2 s and walks its settlement to
  `completed` over 6 s. A "Simulate payment" button on link detail appears **only** when
  `VITE_USE_MOCK=true`, so the demo transition can be rehearsed without the backend.

## Components

`BalanceCard`, `StatusBadge`, `SettlementStatusBadge`, `MoneyTRY`, `MoneyUSDC`, `CopyButton`,
`ExplorerLink`, `CreateLinkDialog`, `LinkCreatedDialog` (URL + QR + WhatsApp), `WithdrawDialog`,
`SettlementTimeline`, `PaymentsTable`, `LinksTable`, `EmptyState`, `ErrorState`.

## Definition of done

- The full merchant loop on mock and on the real API: register → create link → see it paid → see
  the settlement complete → balance / paid-out updated.
- The link detail transition looks good on a 1080p projector.
- Every list has empty, loading and error states.
- A README covers running locally, the demo login, and simulating a payment in mock mode.
