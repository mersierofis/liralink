# LiraLink Backend — Design

> Read [`00-PROJECT.md`](00-PROJECT.md) first; it owns the data model and the API contract. This
> doc describes how the backend is designed to meet that contract: modules, persistence, the
> payment listener, settlement and the anchor boundary.

## Stack

- Node 22, **NestJS 11**, TypeScript strict.
- **PostgreSQL 18** through **Prisma 7** (exact pin) with the `pg` driver adapter.
- `@stellar/stellar-sdk` 16.x — Horizon and Soroban RPC clients, transaction building.
- Money math with **decimal.js**, imported in exactly one file, `src/common/money.ts`, which
  parses, rounds and formats every amount. Money is a decimal string everywhere else: strings go
  into Prisma on write, and a Prisma `Decimal` read back is converted with `toFixed()` (never
  `toString()`, which switches to exponent notation for small values) and re-parsed there. Prisma's
  `Decimal` is a distinct class, so it is never used for arithmetic or mixed with decimal.js.
  ESLint enforces this: `decimal.js` imports outside `money.ts`, `Number()`, `parseFloat`,
  `parseInt` and `.toNumber()` are errors.
- `@nestjs/config`, `schedule`, `swagger`, `event-emitter`, `throttler`; `class-validator`.
- Auth: `@nestjs/jwt` + `@nestjs/passport` (`passport-jwt`), `bcryptjs` (cost 10), JWT lifetime 7 d.
- Tests: Jest (unit) + Supertest (e2e against a test database).

### Toolchain traps to design around

- Nest companion packages (`@nestjs/jwt`, `@nestjs/passport`) have ESM-only 12.x releases with no
  `require` export — they break Jest. Check `npm view <pkg>@<ver> exports --json` for a `require`
  key before bumping any of them.
- Prisma 7 has no `datasource.url` in the schema: the connection string goes to a config file for
  the CLI and to `PrismaClient` at runtime through the driver adapter. The generated client must be
  emitted **inside** `src/` or the Nest compiler will not see it.
- Prisma 7's WASM engine uses dynamic `import()`: every Jest run needs
  `NODE_OPTIONS=--experimental-vm-modules`. The generated client's `.js` relative imports need a
  Jest `moduleNameMapper` that strips the extension.
- The stellar-sdk CJS build pulls in ESM-only transitive deps (`@noble/*`, `uint8array-extras`);
  Jest's `transformIgnorePatterns` must let ts-jest transform them.
- E2E boots the real Horizon SSE listener, so e2e runs `--forceExit`, or replaces the listener with
  a no-op in a dedicated test module.

## Modules

| Module | Responsibility |
|---|---|
| config | Env schema validated at boot (zod); fail fast on a missing or malformed variable |
| prisma | Database client |
| auth | Register, login, JWT strategy and guard, `@CurrentMerchant()` |
| merchants | `GET/PATCH /me` — `autoSavePercent` 0–50, `iban` `^TR\d{24}$` |
| links | Create / list / get / cancel / on-chain retry; code generator; quote at creation; expiry cron |
| fx | Rate source: `anchor` (default) — SEP-38 `/price`, fetched fresh for every link, no cache and no fallback: a failure is a `503` on `POST /links`; `mock` — fixed rate, for tests and offline work; `live` — not implemented, refused at boot. See [`anchor.md`](anchor.md#sep-38--why-fx_provideranchor) |
| stellar | Horizon + RPC clients, platform account bootstrap, asset constants, **payment listener**, invoice-contract client and event poller |
| payments | Records a detected transfer, applies the exact-amount policy, emits `payment.detected` |
| settlements | On `payment.detected`: create a settlement and drive it through an anchor adapter; minute reconciler |
| anchor | `AnchorAdapter` interface + `mock`, `sep6`, `sep24` adapters and a shared anchor session (SEP-1 + SEP-10) — see [`anchor.md`](anchor.md) |
| balance | Derives `Balance` from settlements, withdrawals and counters |
| withdrawals | TRY withdrawals (balance mode only) |
| usdc-withdrawals | USDC to the merchant's own wallet, with the signed-before-submit guard |
| unallocated | Ledger of stray and overpaid credits |
| pay | Public payer endpoints, including the x402 agent route |
| health | `/health`, `/fx` |
| common | `ApiError` filter, decimal helpers, pagination DTO |

Bootstrap: global prefix `/api`, `ValidationPipe({ whitelist: true, transform: true })`, CORS for
the two web origins, Swagger at `/docs`, and an exception filter that always returns `ApiError`.

Listener and settlement are **decoupled** through `EventEmitter2` (`payment.detected`), so the
listener never waits on an anchor.

## Configuration

The full list, one name per variable, is in [`../.env.example`](../.env.example). The code reads
**`SOROBAN_RPC_URL`** (not `RPC_URL`), **`PLATFORM_ACCOUNT_SECRET`** and **`INVOICE_CONTRACT_ID`**.
An empty `INVOICE_CONTRACT_ID` disables the contract rail; an empty `X402_FACILITATOR_URL`, or
`STELLAR_NETWORK=public`, disables x402 with `503`; `ANCHOR_PROVIDER=sep6` refuses to start unless
`STELLAR_NETWORK=testnet`.

## Persistence

Money columns are `Decimal(20,7)`.

| Table | Purpose |
|---|---|
| `Merchant` | Profile, IBAN, `autoSavePercent`, `unallocatedUSDC` counter; SEP-12 registration (`sep12CustomerId`, `sep12Iban`, `sep12HomeDomain`) |
| `PaymentLink` | Unique `code`; locked `amountTRY` / `quotedUSDC` / `fxRate`; `receivedUSDC`, nullable `shortfallUSDC`; on-chain invoice fields. Indexes: `code`, `(merchantId, createdAt)` |
| `Payment` | One row per successful transfer that credited a link (a link can have several). Unique `txHash`; `rail` |
| `PaymentAttempt` | Inbound operations that never became a `Payment` (wrong asset, unknown memo, not payable), with the reason |
| `ProcessedOperation` | Unique Horizon operation id — listener idempotency |
| `ListenerCursor` | One row per stream: the Horizon paging token, and one per contract (`soroban-invoice:<contractId>`) for the RPC event cursor |
| `Settlement` | One per paid link; provider, status, anchor ref/memo/status, saved signed payment XDR + hash, fee, `netTRY`, `failReason`, `blockedReason` |
| `Withdrawal` | TRY withdrawals |
| `UsdcWithdrawal` | USDC withdrawals, with the signed XDR stored before submission |
| `X402Settlement` | x402 settlements whose outcome is not yet known, with a hash of the payer's auth entries |

## Platform account bootstrap

At startup the stellar module loads the keypair from `PLATFORM_ACCOUNT_SECRET`, checks the account
exists and holds a **USDC trustline**, submits a one-time `changeTrust` if it does not, and logs
the public key. `/health` exposes it.

## Links and quotes

- **Code:** 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I), retried on collision.
  The same code is the memo, the invoice `Symbol` and the URL path segment.
- **Quote:** `quotedUSDC = amountTRY / rate`, rounded **up** to 7 dp so the payer never underpays.
- **On-chain invoice:** `POST /links` calls `create` on the contract best-effort, with
  `deadline` = the ledger that corresponds to `expiresAt`. An on-chain link's quote is locked until
  `expiresAt`, because the contract enforces the exact amount. Off-chain links re-quote on
  `GET /pay/:code` after `QUOTE_TTL_MINUTES`.
- **Expiry:** a minute cron moves `open` links past `expiresAt` to `expired`.

## Payment listener — the heart

### Memo rail (Horizon)

- Stream `payments().forAccount(platform).join('transactions').cursor(saved ?? 'now')`.
  `.join('transactions')` embeds the memo in every record at no extra HTTP cost — no follow-up
  `transaction()` call.
- Accept `payment`, `path_payment_strict_receive` and `path_payment_strict_send`. A payer who swaps
  XLM→USDC in one transaction produces a path payment; filtering on `payment` alone drops real money.
- **Match** only when all hold: `to` = platform; `asset_type` = `credit_alphanum4` **and**
  `asset_code` = `USDC_CODE` **and** `asset_issuer` = `USDC_ISSUER` (anyone can issue a "USDC");
  `memo_type` = `text` and **`memo_bytes`** (base64) equals the base64 of a link code — never the
  lossy UTF-8 `memo` field; the link is `open` or `underpaid`.
- The matcher is a **pure function** `(operation, link, config) → decision`, unit-tested with
  fixtures: wrong asset, wrong issuer, wrong memo, underpay, overpay, top-up on an `underpaid` link.
- **Exact-amount policy:** `total = link.receivedUSDC + op.amount`; equal → `paid`; less →
  `underpaid` with `shortfallUSDC`; more → `paid` with the excess credited to
  `merchant.unallocatedUSDC` in the same DB transaction. A payment to a link that is no longer
  payable is credited in full to `unallocatedUSDC` as `stray`.
- **Idempotency:** insert `ProcessedOperation(opId)`, the state change and the cursor update in one
  DB transaction; a unique-constraint violation means "already seen" — reconnects **will** replay.
- **Resilience:** the SDK does not back off on error (its only reconnect is a silence watchdog), so
  the listener reconnects with its own exponential backoff. A REST reconciliation poll every ~2 min
  runs the same matcher over the same cursor range, because SSE can stall without erroring.
  `/health.listener` reflects the state.
- `POST /pay/:code/submitted` fetches the tx from Horizon and runs the same matcher immediately.
- Out of scope: claimable-balance deposits never appear on `/payments` and would need their own
  watcher.

### Contract rail (Soroban RPC)

- Poll `getEvents` for the invoice contract every 5 s, filtered on the `paid` topic, with the cursor
  in `ListenerCursor` (`soroban-invoice:<contractId>`). A redeploy starts a fresh cursor.
- A `paid` event is credited as a `Payment` with `rail: 'contract'`. The contract moves exactly the
  invoice amount, so the result is always `paid`.

### x402 rail

- Seller side of x402 v2, `exact` scheme, `stellar:testnet`, through the keyless x402.org
  facilitator (testnet only). The facilitator settles; the backend reads the settled transfer back
  from Horizon and credits it with `rail: 'x402'`.
- Unknown outcome (facilitator timeout) → `X402Settlement` row; a minute job credits it only when a
  transaction carrying the payer's signed auth entries appears, retries while those entries are
  valid, and fails it otherwise. Never match by payer + amount.
- A CLI demo client plays the agent (buyer) side.

## Settlement

`payment.detected` for a now-`paid` link → create a `Settlement`:
- `fxRate = link.fxRate`, `amountTRY = link.amountTRY × (100 − autoSavePercent)%`,
  `savedUSDC = link.quotedUSDC × autoSavePercent%`, `amountUSDC` = the remainder.
- `provider` = the current `ANCHOR_PROVIDER`; the settlement **always continues on the provider it
  was created with**, even after the config changes.
- `pending → processing → completed`, or a terminal `failed` with `failReason`. A thrown error
  (network, Horizon, anchor 5xx) leaves the settlement unchanged for the next run — a transient
  error never marks money as failed.
- A minute reconciler (and a pass at boot) resumes every unfinished settlement.
- Within one process a settlement never has two adapter calls in flight. Multiple instances would
  need a DB lock around the payment step.

### Anchor adapter boundary

```ts
interface AnchorAdapter {
  name: 'mock' | 'sep6' | 'sep24';
  settle(settlement, merchant): Promise<SettleOutcome>;   // resumable: safe to call again
  payoutTRY?(withdrawal): Promise<{ ref: string }>;        // balance mode only
}
```
- `mock`: completes after `ANCHOR_MOCK_DELAY_MS`, deterministic `mock-…` refs, balance mode.
- `sep6`: the TRY rail, auto-payout. `sep24`: interactive, auto-payout.
- Which providers are balance-mode is one explicit list; a new balance-mode provider must be added
  there or its settlements land in `paidOutTRY`.

Full SEP flows, the double-spend guard and the anchor quirks: [`anchor.md`](anchor.md).

## Withdrawals

- **TRY** (`POST /withdrawals`): IBAN from the body or the profile, `amountTRY ≤ availableTRY`
  (`422`), reserved immediately; `409` in `auto_payout` mode.
- **USDC** (`POST /usdc-withdrawals`): validate the destination on Horizon (exists, USDC trustline,
  enough limit, not the platform account), debit `source` and store the **signed** payment in one DB
  transaction, then submit. Every retry resubmits the same XDR. It is failed — and the amount
  returned — only when it provably cannot land (`failed_on_ledger`, or `expired_unsubmitted` after
  its time bound has passed).

## Deploy

- Multi-stage Dockerfile; `docker-compose.yml` with Postgres.
- A single VM behind nginx with TLS on `<api-host>`; CORS for the two web origins. `/health` must be
  green from the internet.
- Secrets live only in the server's `.env` (systemd: comments on their own lines — inline `#` is
  not stripped).
- One-command seed: a demo merchant `demo@liralink.app` whose password comes from
  `SEED_DEMO_PASSWORD` (never committed, never printed), and realistic Mersin-exporter links. The
  seed never fabricates payments.

## Tests

- Unit: code generator, quote rounding, the matcher, settlement math (`netTRY`), SEP helpers.
- E2E: auth + links happy path, money endpoints, underpay/overpay/stray, auto-payout mode.
- Opt-in live e2e (spend real testnet USDC, skipped by default): `SEP6_E2E`, `SEP24_E2E`,
  `SEP24_MANUAL_KYC`, `USDC_WD_E2E`.

## Definition of done

- `/health` green from the internet with the listener `running`.
- A real testnet USDC payment with the memo flips a link to `paid` in < 10 s and settles exactly
  `link.amountTRY`; underpay and overpay behave per the exact-amount policy.
- The same link is payable through the contract and over x402.
- Swagger matches this contract; the exported API types are committed for the frontends.
- Seed data loads with one command.
