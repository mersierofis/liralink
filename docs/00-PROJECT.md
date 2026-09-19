# LiraLink — Project Design and API Contract

> This is the **single source of truth** for the product and the design. For the API contract —
> every request and response shape — [`api.types.ts`](api.types.ts) is the source of truth; this
> file restates it and must never contradict it. Read this file first. The per-app design docs
> (`01-BACKEND.md`, `02-PAY-WEB.md`, `03-MERCHANT-WEB.md`) and `anchor.md` refine it but never
> override it. If the API has to change, change `api.types.ts` **first**, then this file, then the
> app docs.

Name: **LiraLink** (slug `liralink` in code). Team: **MersiErOfis**.
Event: Rise In × Stellar Pro Hackathon, Istanbul, 19–20 Sept 2026, Genesis Track. **Testnet only.**

---

## 1. Product

A Turkish merchant or exporter creates a **payment link** priced in Turkish lira. A customer
**abroad** opens the link on their phone and pays in **USDC on Stellar** from their own wallet.
LiraLink detects the on-chain payment within seconds, converts it to lira through a **Stellar
anchor**, and pays the lira out to the merchant's IBAN. The merchant never touches crypto: they
sell in lira and receive lira. We target cross-border collection because the domestic use of
crypto as a payment instrument is restricted in Turkey: the payer is abroad, the merchant prices and
receives only lira, and the licensed anchor is the regulated party performing the conversion. We
make no claim about whether this flow is cleared under Turkish payment regulation; a legal opinion
is required before any production launch (see the regulatory note in the README).

**Why Stellar:** cross-border settlement in ~5 seconds for a fraction of a cent, native USDC, and
anchors that turn on-chain balances into local fiat. Bank wires take 3–5 days and cost 2–4%.

**Target users:** citrus and agri exporters in Mersin selling to buyers in the Gulf, Iraq, Russia
and the EU; boutique hotels and short-stay hosts with foreign guests; Turkish freelancers invoicing
foreign clients.

## 2. Hackathon requirements this design satisfies

| Requirement | How |
|---|---|
| Integration with an eligible Stellar protocol | **Stellar Wallets Kit** on the payer page |
| Anchor / local payments (real TRY rail) | USDC → TRY through the hackathon's TRY anchor over **SEP-6**, with SEP-1/10/12/38. An adapter interface also allows `sep24` and `mock` |
| Core feature is load-bearing | The whole product *is* the payment + settlement flow |
| Soroban contract on testnet | The **invoice contract** (§7) — a payer can pay the link *through* it |
| Stretch: agentic payments | The same link is payable by an AI agent over **x402** |

## 3. Roles and demo script

All merchant names and IBANs in this repo are fictional test data.

- **Merchant** (desktop, merchant-web): signs in → creates "Lemon order #1042, 5,000 TRY" → shares
  the URL → sees "Paid · 5,000 TRY" → sees the payout reach their IBAN.
- **Payer** (phone, pay-web): opens the link → sees 5,000 TRY ≈ 147.06 USDC → connects a wallet →
  pays → gets a receipt with an explorer link.
- **AI agent** (terminal): calls the same link's agent URL → `402 Payment Required` → pays → `200`.

Demo = two devices, one flow, a real testnet transaction, ~30 seconds.

## 4. Architecture

Diagram and Soroban storage/auth patterns: [`architecture.md`](architecture.md).

- **Payment rails.** One link, three ways to pay:
  - **memo** — a classic USDC payment to the platform collection account with **text memo = link
    code**. Wallet-friendly, detected from the Horizon payment stream. Always available; the fallback
    that the demo never depends on anything else for.
  - **contract** — `invoice.pay(code, payer)` on the Soroban invoice contract, detected from the
    contract's `paid` event over RPC `getEvents`.
  - **x402** — an agent calls `GET /pay/:code/agent`, receives `402`, signs a USDC transfer, and a
    facilitator settles it.
- **Settlement.** When a link becomes `paid`, the API creates a settlement and an anchor adapter
  converts the USDC to TRY. `mock` completes in-process; `sep6` drives the real TRY anchor; `sep24`
  drives an interactive anchor.
- **Custody model (hackathon simplification).** One platform account holds USDC; merchant balances
  are ledger rows in Postgres. Roadmap: segregated per-merchant accounts, then non-custodial
  per-link withdrawals.
- **Exact-amount policy.** `amountTRY` and `quotedUSDC` are locked when the link is created.
  Settlement always uses `link.amountTRY`, never `receivedUSDC × fxRate`.
  - `received == quotedUSDC` → `paid`.
  - `received < quotedUSDC` → `underpaid`; the link stays open for a top-up, `receivedUSDC` and
    `shortfallUSDC` track progress.
  - `received > quotedUSDC` → `paid`; the excess is credited to `merchant.unallocatedUSDC`, visible
    in the panel and never auto-converted to TRY.
  - An inbound payment that does not become a `Payment` is **never silently dropped**: it creates
    a `PaymentAttempt` row with the reason.
    - `link_not_open` — the link is `paid`, `expired` or `cancelled`: credited in full to that
      merchant's `unallocatedUSDC`, and listed on `GET /unallocated` as a `stray` credit (the same
      event; the API returns the `UnallocatedCredit`, never the `PaymentAttempt`).
    - `link_not_found` (no link has the code), `unmatched_memo` (no memo, or not a link code),
      `wrong_asset` (XLM or another asset instead of USDC): **no** merchant is credited; the funds
      stay in the platform account and are resolved manually.

**Repository layout (monorepo):**
```
liralink/
  docs/            design docs (this file first)
  backend/         NestJS API
  merchant-web/    React + Vite, merchant panel
  pay-web/         React + Vite PWA, payer page
  contracts/       Soroban invoice contract (Rust)
```
Each app has its own `package.json`. [`docs/api.types.ts`](api.types.ts) is the source of truth for
the API contract: the backend DTOs must conform to it, never the other way round, and the two
frontends commit a byte-identical copy of it.

**Networks and constants (testnet):**
- Horizon: `https://horizon-testnet.stellar.org`
- Soroban RPC: `https://soroban-testnet.stellar.org`
- Network passphrase: `Test SDF Network ; September 2015`
- USDC (Circle testnet): code `USDC`, issuer
  `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` (`home_domain: centre.io`). Testnet USDC
  for a payer comes from faucet.circle.com.
- USDC Stellar Asset Contract (SAC): `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`
- Explorer: `https://stellar.expert/explorer/testnet/tx/{hash}`,
  `https://stellar.expert/explorer/testnet/account/{address}`

## 5. Domain model

```ts
type LinkStatus   = 'open' | 'underpaid' | 'paid' | 'expired' | 'cancelled';
type PayRail      = 'contract' | 'memo' | 'x402';
type SettleStatus = 'pending' | 'processing' | 'completed' | 'failed';
type WdStatus     = 'requested' | 'processing' | 'completed' | 'failed';
type UsdcWdStatus = 'submitted' | 'completed' | 'failed';   // 'submitted' until the payment is on the ledger
type SettlementMode = 'balance' | 'auto_payout';            // balance: TRY accrues, merchant withdraws (mock) · auto_payout: the anchor pays the IBAN at settlement (sep6/sep24)
type SettleFailReason = 'unexpected_fee_asset' | 'invalid_fee' | 'anchor_status' | 'amount_mismatch'; // terminal, never retried

interface Merchant {
  id: string; email: string; businessName: string;
  iban?: string;                  // payout IBAN, ^TR\d{24}$ — full: the merchant's own profile, returned only to them
  autoSavePercent: number;        // 0–50, default 0 — share of each payment kept in USDC
  unallocatedUSDC: string;        // 7 dp — overpaid excess + stray payments, minus non-failed USDC withdrawals from it
  settlementMode: SettlementMode; // derived from ANCHOR_PROVIDER
  createdAt: string;
}

interface PaymentLink {
  id: string;                     // uuid
  code: string;                   // 8 chars, URL-safe, unique, uppercase, e.g. "K7Q2M9XA" — also the tx memo and the invoice code
  merchantId: string;
  merchantName: string;           // denormalized for the payer page
  title: string;                  // "Lemon order #1042"
  description?: string;
  amountTRY: string;              // 2 dp, e.g. "5000.00" — locked at creation
  quotedUSDC: string;             // 7 dp — locked at creation, never recomputed from what is received
  fxRate: string;                 // TRY per 1 USDC at quote time
  quoteExpiresAt: string;         // on-chain links: === expiresAt (locked); otherwise QUOTE_TTL_MINUTES and /pay re-quotes
  status: LinkStatus;
  expiresAt: string;              // default +24 h
  payUrl: string;                 // PAY_WEB_BASE_URL + '/' + code
  receivedUSDC: string;           // 7 dp — cumulative USDC matched so far ("0.0000000" until the first payment)
  shortfallUSDC?: string;         // 7 dp — only while status is 'underpaid'
  payment?: Payment;              // latest transfer — alias for payments.at(-1)
  payments: Payment[];            // every transfer that credited this link, oldest → newest
  onchain: { contractId: string; invoiceCode: string; deadlineLedger: number; txHash?: string } | null; // null if the best-effort invoice call failed
  createdAt: string;
}

interface Payment {
  id: string; linkId: string;
  rail: PayRail;
  txHash: string; payerAddress: string;
  amountUSDC: string; ledger: number;
  explorerUrl: string;
  detectedAt: string;
}

interface Settlement {
  id: string; merchantId: string; paymentId: string;
  amountUSDC: string; amountTRY: string; fxRate: string;
  savedUSDC: string;              // auto-save portion kept in USDC
  feeUSDC: string | null;         // anchor fee in USDC, 7 dp — null until completed; "0.0000000" when the anchor charges in TRY
  netTRY: string | null;          // TRY credited (balance) or paid to the IBAN (auto_payout), 2 dp — null until completed
  provider: 'mock' | 'sep6' | 'sep24';
  status: SettleStatus; anchorRef?: string;
  failReason: SettleFailReason | null;  // only when 'failed' (see anchor.md)
  interactiveUrl: string | null;  // sep24 only: the anchor's KYC page while it waits for the merchant
  createdAt: string; completedAt?: string;
}

interface Withdrawal {             // TRY to IBAN, balance mode only
  id: string; merchantId: string; amountTRY: string;
  iban: string;                   // masked, "TR33 **** **** **** **** **** 26" — the request carries the full IBAN
  status: WdStatus; anchorRef?: string; createdAt: string; completedAt?: string;
}

interface UsdcWithdrawal {         // USDC from the platform account to the merchant's own wallet
  id: string; merchantId: string;
  amountUSDC: string;             // 7 dp
  destination: string;            // G… — must exist and trust USDC
  source: 'saved' | 'unallocated';// the balance debited when the request is accepted
  status: UsdcWdStatus;
  txHash: string; explorerUrl: string;  // signed before submission, so present from the first response
  failReason: 'failed_on_ledger' | 'expired_unsubmitted' | null; // amount returned to `source`
  createdAt: string; completedAt?: string;
}

interface Balance {
  availableTRY: string; pendingTRY: string; savedUSDC: string; unallocatedUSDC: string;
  paidOutTRY: string;             // 2 dp — Σ netTRY of completed auto_payout settlements
}

interface PayQuote {               // what the payer page renders
  code: string; merchantName: string; title: string; description?: string;
  amountTRY: string; amountUSDC: string; fxRate: string; quoteExpiresAt: string;
  status: LinkStatus; expiresAt: string;
  receivedUSDC: string; shortfallUSDC?: string;
  rails: {
    contract?: { contractId: string; invoiceCode: string };  // present while the link is on-chain
    memo:      { destination: string; memo: string };        // always present
  };
  asset: { code: 'USDC'; issuer: string };
  network: 'testnet';             // LiraLink's own name; x402 fields use the x402 spec's 'stellar:testnet'
  payment?: Payment;
  payments: Payment[];
}

type PaymentAttemptReason = 'link_not_open' | 'link_not_found' | 'unmatched_memo' | 'wrong_asset';

interface PaymentAttempt {         // an inbound payment that did not become a Payment — never dropped (see §4); internal, no endpoint returns it
  id: string;
  linkCode: string | null;        // null when the memo is not a link code
  merchantId: string | null;      // null for link_not_found and unmatched_memo: there is no merchant
  txHash: string;
  amount: string;                 // 7 dp, in units of assetCode
  assetCode: string;              // e.g. 'USDC', 'XLM'
  assetIssuer: string | null;     // G… issuer; null for XLM. USDC is accepted by issuer (Circle), not by code — a wrong_asset row with assetCode 'USDC' and another issuer is a spoofed USDC
  reason: PaymentAttemptReason;
  createdAt: string;
}

interface UnallocatedCredit {       // returned by GET /unallocated; a 'stray' credit is the same event as a link_not_open PaymentAttempt
  id: string; source: 'stray' | 'overpaid';
  txHash: string; explorerUrl: string; amountUSDC: string;
  linkCode: string; reason: string; createdAt: string;
}

interface ApiError { statusCode: number; message: string | string[]; error?: string } // string[] for 400 validation errors
```

## 6. API contract (v1) — base path `/api`

All bodies are JSON. Timestamps are ISO-8601 UTC. **Money is always a decimal string** (TRY 2 dp,
USDC 7 dp, always written out in full: zero USDC is `"0.0000000"`). Merchant endpoints need
`Authorization: Bearer <jwt>`; payer and system endpoints are public. Lists are paginated with
`page` (from 1, default 1) and `limit` (default 20, max 100) and return `{ items, total }`, newest
first.

**IBAN visibility.** A merchant sees their own IBAN in full; nobody else sees it at all. Only the
merchant's own profile (`Merchant`, from `GET`/`PATCH /me`, register and login) carries the full
IBAN. Every other response and every log line carries it masked, exactly
`TR33 **** **** **** **** **** 26` (first 4 and last 2 characters visible, the 20 between masked),
and nothing the payer can see carries it at all. Requests carry the full IBAN, `^TR\d{24}$`.

### Auth (merchant)
| Method | Path | Body → Response |
|---|---|---|
| POST | `/auth/register` | `{ email, password, businessName }` → `201 { token, merchant }` |
| POST | `/auth/login` | `{ email, password }` → `200 { token, merchant }` |
| GET | `/me` | → `Merchant` |
| PATCH | `/me` | `{ businessName?, iban?, autoSavePercent?, currentPassword?, newPassword? }` → `Merchant`. A password change needs both fields (`newPassword` ≥ 8 chars); `400` if only one is sent, `403` if `currentPassword` is wrong |

### Payment links (merchant)
| Method | Path | Body → Response |
|---|---|---|
| POST | `/links` | `{ title, description?, amountTRY, expiresInHours? }` → `201 PaymentLink`. `amountTRY` matches `^\d+\.\d{2}$`, range 1.00–1,000,000. Also creates the Soroban invoice, best-effort, locking `quotedUSDC` until `expiresAt`; if RPC fails the link is still `201` with `onchain: null` |
| GET | `/links?status=&page=&limit=` | → `{ items: PaymentLink[], total }` |
| GET | `/links/:id` | → `PaymentLink` |
| POST | `/links/:id/cancel` | → `PaymentLink`. Only if `open`; also cancels the on-chain invoice, best-effort |
| POST | `/links/:id/onchain` | → `PaymentLink` with `onchain` set. Manual retry when creation's invoice call failed. Uses the existing `quotedUSDC` (no re-quote). `409` unless `open` with nothing received; unchanged if already on-chain; `503` if no contract is configured |

### Money (merchant)
| Method | Path | Response |
|---|---|---|
| GET | `/balance` | `Balance` |
| GET | `/payments?page=&limit=` | `{ items: (Payment & { link: Pick<PaymentLink,'code'\|'title'\|'amountTRY'\|'status'\|'quotedUSDC'\|'receivedUSDC'>, settlement: Settlement \| null })[], total }`. `settlement` is `null` for installments that did not complete the link; `link.*` are current values |
| GET | `/settlements?page=&limit=` | `{ items: Settlement[], total }` — one per paid link |
| POST | `/withdrawals` | `{ amountTRY, iban? }` (full IBAN; defaults to the profile IBAN) → `201 Withdrawal` with the IBAN masked (`requested`, amount reserved immediately). `422` if > `availableTRY`; `400` if ≤ 0 or no IBAN in body or profile; `409 "Payouts are automatic in this mode"` when `settlementMode` is `auto_payout` |
| GET | `/withdrawals?page=&limit=` | `{ items: Withdrawal[], total }` |
| POST | `/usdc-withdrawals` | `{ amountUSDC, destination, source }` → `201 UsdcWithdrawal`. Debits `source` in the same DB transaction. The payment is signed and stored before submission, so a retry resubmits the same transaction and it can never be sent twice. Usually `completed` (~5 s); `submitted` if Horizon did not confirm in time — a minute job retries until `completed` or `failed` (amount returned). `400` bad amount / address / source; `422` insufficient balance, or `destination` missing, without a USDC trustline, without trustline room, or equal to the platform account |
| GET | `/usdc-withdrawals?page=&limit=` | `{ items: UsdcWithdrawal[], total }` |
| GET | `/unallocated?page=&limit=` | `{ items: UnallocatedCredit[], total, summary: { creditedUSDC, withdrawnUSDC, remainingUSDC } }`. `stray` = a payment to a link that is no longer payable, credited in full (the same event as a `link_not_open` `PaymentAttempt`); `overpaid` = the excess on the completing payment. `remainingUSDC` = `Balance.unallocatedUSDC` |

**Balance rules.**
- `availableTRY` = Σ `netTRY` of completed **balance-mode** settlements − Σ non-failed withdrawals.
- `paidOutTRY` = Σ `netTRY` of completed **auto_payout** settlements. Never withdrawable — the anchor
  already paid the IBAN.
- `pendingTRY` = Σ `amountTRY` of pending/processing settlements (gross; the fee is known only on
  completion).
- `savedUSDC` = Σ `savedUSDC` of non-failed settlements − Σ non-failed USDC withdrawals from `saved`.
- `unallocatedUSDC` = stored counter: credited by overpaid/stray payments (never by a
  `link_not_found`, `unmatched_memo` or `wrong_asset` attempt), debited by USDC
  withdrawals from `unallocated` (a failed one gives it back).
- The bucket a settlement lands in follows the provider it was **created** with.
- A settlement's gross `amountTRY` = `link.amountTRY` × (100 − `autoSavePercent`)%, keeping
  `quotedUSDC` × `autoSavePercent`% as `savedUSDC`. On completion
  `netTRY = amountTRY × (amountUSDC − feeUSDC) / amountUSDC`, rounded down to kuruş — unless the
  anchor reports the lira it actually paid (SEP-6), in which case `netTRY` is that figure (see
  `anchor.md`).

### Payer (public, no auth)
| Method | Path | Response |
|---|---|---|
| GET | `/pay/:code` | `PayQuote`. Re-quotes when the quote expired, status is `open`, and the link is **not** on-chain (on-chain quotes are locked). `code` is case-insensitive |
| POST | `/pay/:code/submitted` | `{ txHash }` → `202 { accepted: true }`. A hint to check this tx immediately; detection works without it |
| GET | `/pay/:code/status` | `{ status, receivedUSDC, shortfallUSDC?, payment?, payments }` — poll every 2 s |
| GET | `/pay/:code/agent` | **x402, testnet only, experimental.** See below |

**`GET /pay/:code/agent` (x402).**
- Without a `PAYMENT-SIGNATURE` header → `402` with an x402 v2 `PaymentRequired` body and a base64
  `PAYMENT-REQUIRED` header: `exact` scheme, `stellar:testnet` (the x402 spec's network id —
  `PayQuote.network` is LiraLink's own `testnet`), the USDC SAC, `amount` = amount due
  in 7-dp base units, `payTo` = platform account. No memo — the URL identifies the link.
- With a valid header → the facilitator verifies and settles, the API reads the transfer back from
  Horizon and credits it (`Payment.rail = 'x402'`) → `200 { code, linkStatus, rail, network,
  facilitator, credit, reason?, settlement, payment }` + `PAYMENT-RESPONSE` header.
- Facilitator times out while settling (outcome unknown) → `202 { code, status: 'pending',
  x402SettlementId, rail, network, facilitator }`. A minute job reconciles it: it is credited only if
  a transaction carrying the payer's signed auth entries appears on Horizon (never by payer + amount),
  retried while the auth entries are valid, otherwise failed. Poll `/pay/:code/status`.
- `409` if the link is not `open`/`underpaid` or the tx hash was already processed; `503` if x402 is
  disabled or the facilitator is down.

### System
| Method | Path | Response |
|---|---|---|
| GET | `/health` | `{ ok, horizon: 'up'\|'down', anchor: 'mock'\|'sep6'\|'sep24', listener: 'running'\|'stopped', platformAccount: 'G…', settlementMode }` |
| GET | `/fx` | `{ pair: 'USDC/TRY', rate, source: 'mock'\|'live'\|'anchor', fetchedAt }` |

### Status codes
`200/201/202` success · `400` validation · `401` missing/invalid token · `403` wrong
`currentPassword` · `404` unknown link/code · `409` invalid state transition, or not allowed in this
settlement mode · `422` business rule (insufficient balance, destination cannot receive USDC) ·
`503` dependency not configured / down. Every non-2xx body is an `ApiError`.

## 7. Soroban invoice contract

`contracts/invoice` records links as on-chain invoices so a payer can pay *through* the contract
using the USDC Stellar Asset Contract.

| Function | Auth | Behaviour |
|---|---|---|
| `__constructor(token: Address, admin: Address)` | deployer | Pins the USDC SAC and the admin (platform account) |
| `create(merchant: Address, code: Symbol, amount: i128, deadline: u32)` | **admin** | Stores a `Pending` invoice. `merchant` is only the payout address and never signs. `amount` in USDC stroops (7 dp); `deadline` is a ledger sequence |
| `pay(code: Symbol, payer: Address)` | **payer** | Requires `Pending` and `ledger ≤ deadline`; `token.transfer(payer → merchant, amount)`; marks `Paid` |
| `get(code: Symbol) -> Invoice` | none | Read-only |
| `cancel(code: Symbol)` | **admin** | `Pending` → `Cancelled` |

Errors: `AlreadyExists=1`, `NotFound=2`, `NotPending=3`, `Expired=4`, `InvalidAmount=5`.

Events (topics `[event_name, code]`, data is a map), polled by the API over RPC `getEvents`:

| Event | Topics | Data |
|---|---|---|
| created | `["created", code]` | `{ merchant, amount, deadline }` |
| paid | `["paid", code]` | `{ payer, merchant, amount }` |
| cancelled | `["cancelled", code]` | `{ merchant }` |

Merchants are custodial, so the API signs `create`/`cancel` as admin and sets the payout `merchant`
to the platform account. The payer page shows a second "Pay via contract" button when
`rails.contract` is present; the memo rail stays the fallback so the demo never depends on the
contract. Storage and TTL strategy: [`architecture.md`](architecture.md).

**Testnet deployments:**

Live contract: TBD — deployed during the event

Prototype contract (pre-event reference — NOT used by this build):

| Field | Value |
|---|---|
| Contract ID | `CDKZYQI4HI347ZVAMXT2XPHLYDSDKN6ERELKASGJDII6AQU6ROFQ45EJ` |
| Admin / deployer | platform account `GDWV6USF4R2ULWR5XW3TEUZSIRGRCU7PQWGSBDYJVIRFNAJ3LVNQ34N2` |
| Constructor `token` | USDC SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Wasm hash | `f95d67feb7dd55ca72eaf49bc0c7dc61e1955b83fc65e273f2d3875c47370950` |
| Explorer | https://stellar.expert/explorer/testnet/contract/CDKZYQI4HI347ZVAMXT2XPHLYDSDKN6ERELKASGJDII6AQU6ROFQ45EJ |

Deploying during the event creates a new contract ID: fill in the live contract line above and set
`INVOICE_CONTRACT_ID`. Invoices do not carry over from the prototype.

Prototype contract (pre-event reference — NOT used by this build):
`CBN6Q5MPD3BUXAZNG3VPYWQ42EUAOBGDFW3WWDJVGTMRRJFZO7EBJVWE`. Do not use it: it required merchant auth
on `create`/`cancel` — something a custodial merchant can never give.

## 8. Conventions (all apps)

**Toolchain (binding):**
- Node **22** LTS (`.nvmrc` at the repo root).
- `@stellar/stellar-sdk` **16.x** (`lts-16`) in both backend and pay-web — the listener parses what
  pay-web builds, so the major must match. Not 17.x: it rewrites Buffer → Uint8Array and the XDR
  namespace across every public API, a porting cost with no benefit here.
- Backend: NestJS **11** (not 12, which swaps Jest/ESLint/Webpack for Vitest/oxlint/Rspack by
  default); Prisma pinned to an exact **7.x** (never unpinned — it resolves to an 8.0 release
  candidate); `bcryptjs` rather than `bcrypt` (no native build).

**Rules:**
- TypeScript strict. English for UI strings, code, comments and commit messages.
- Money is never a `number` in transport; arithmetic uses a decimal library.
- `.env.example` is committed with empty values; `.env` is git-ignored. Secrets never enter the repo.
- Small PRs into `master`. CI runs per app, only when that app's folder changes: install,
  `typecheck`, `lint`, `build`; tests run in the backend job only.
- Every screen has loading, empty and error states.
- Log every Stellar tx hash the system creates or detects at INFO level.
