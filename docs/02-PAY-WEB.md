# LiraLink Pay Web — Design

> Read [`00-PROJECT.md`](00-PROJECT.md) first. This doc describes `pay-web`: the page a **foreign
> customer opens on their phone** to pay a LiraLink link in USDC on Stellar testnet.

## Stack

- **Vite + React 19 + TypeScript strict**, mobile-first, installable **PWA** ("LiraLink Pay").
- **Tailwind CSS** + **shadcn/ui** (Button, Card, Badge, Skeleton, Alert, Sheet).
- **TanStack Query** for fetching and polling; **React Router** — `/p/:code` (payment page) and `/`
  (a "no link" explainer).
- **Stellar Wallets Kit** (`@creit.tech/stellar-wallets-kit`) — wallet connect for Freighter, xBull,
  Albedo and others. This is the eligible Stellar-protocol integration.
- `@stellar/stellar-sdk` 16.x — same major as the backend. The wallet signs; the page never sees a
  secret key.
- **MSW** for a mock API, so the UI can be built and demoed without the backend.
- No Next.js, no Redux, no CSS-in-JS.

## The page in four states

1. **Quote** — merchant name, title, `5,000.00 TRY`, `≈ 147.06 USDC` (2 dp on screen, full 7 dp in
   the transaction), the FX rate, a quote countdown for off-chain links, **Connect wallet**.
2. **Ready** — short address `GABC…XYZ`, the wallet's USDC balance, or a warning "No USDC trustline /
   balance" linking to faucet.circle.com; **Pay 147.06 USDC**, and **Pay via contract** when
   `rails.contract` is present.
3. **Paying** — spinner, "Confirming on Stellar… (~5 s)"; poll `GET /pay/:code/status` every 2 s.
4. **Paid** — check mark, "Paid to <merchant>", amount, tx hash (copy), **View on Stellar.Expert**,
   **Share receipt** (Web Share API, copy as fallback).

**Other states:** `underpaid` (show `shortfallUSDC` and allow another payment for the remainder),
`expired`, `cancelled`, already paid (show the receipt), not found, signature rejected, submission
failed (show the Horizon result code, allow retry), and network mismatch (wallet on mainnet → block
with a clear message). No blank screens.

## Data flow

```
GET  /api/pay/:code        → PayQuote { amountUSDC, rails: { memo, contract? }, asset, status, … }
[Connect wallet]           → kit.openModal → getAddress()
[Pay]                      → build tx → kit.signTransaction(xdr) → submit
                           → POST /api/pay/:code/submitted { txHash }   (fire-and-forget hint)
                           → poll GET /api/pay/:code/status until terminal
```

- The destination and memo are nested under **`rails.memo`**, not at the top level.
- `amountUSDC` is locked at link creation; it is what the payer must send. Money is a decimal
  string end to end — never parse it to `number`.
- `payments` lists every transfer (installments included); `payment` is the latest one.
- Link codes are case-insensitive.

### Memo rail transaction

One `payment` operation: destination `rails.memo.destination`, asset
`USDC:<asset.issuer>`, amount `amountUSDC` (≤ 7 dp), with **`Memo.text(rails.memo.memo)`**, fee
`BASE_FEE`, 180 s timeout, testnet passphrase. **Never drop the memo** — without it the backend
cannot match the payment. Load the source account first: an unfunded account gets "account not
funded", a missing USDC trustline gets the trustline warning. The page does not add trustlines for
the user.

### Contract rail transaction

Invoke `pay(code = rails.contract.invoiceCode, payer = <wallet address>)` on
`rails.contract.contractId`, using TS bindings generated from the contract. Simulate, let the wallet
sign (the payer's `require_auth`), send, then `POST /submitted` as usual. No memo and no amount
input — the contract moves exactly the invoice amount.

### Wallet

A single `StellarWalletsKit` instance on `TESTNET`, Freighter preselected, all modules allowed. The
selected wallet id lives in memory only. A `useWallet()` hook exposes
`{ address, connect, disconnect, signXdr }`.

## Configuration (`VITE_*`, public by nature)

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | API base, e.g. `http://localhost:3000/api` |
| `VITE_USE_MOCK` | `true` boots MSW instead of calling the API |
| `VITE_HORIZON_URL` | Horizon for account loading and submission |
| `VITE_SOROBAN_RPC_URL` | Soroban RPC for the contract rail |
| `VITE_EXPLORER_TX_URL` | e.g. `https://stellar.expert/explorer/testnet/tx/` |

## Mock API

Implements `GET /pay/:code`, `POST /pay/:code/submitted` and `GET /pay/:code/status` exactly per
the contract. Seed codes: `DEMO0001` open (5,000.00 TRY, "Erdemli Narenciye A.Ş.", "Lemon order
#1042"), `DEMO0002` paid, `DEMO0003` expired, `DEMO0004` cancelled. After `/submitted`, `DEMO0001`
flips to `paid` after three polls. A `?mockpay=1` dev toggle skips the wallet.

All merchant names and IBANs in this repo are fictional test data.

## Components

`QuoteCard`, `MerchantHeader`, `AmountDisplay`, `QuoteCountdown`, `WalletButton`, `PayButton`,
`PayingState`, `PaidReceipt`, `ErrorState`.

## Definition of done

- On a phone: open the link → connect Freighter → pay → receipt, in under 60 s, without touching
  the laptop — on both the memo and the contract rail.
- Every link status and error state is handled.
- Installs and runs as a PWA on the demo phone.
- A README explains the Freighter testnet setup and faucet steps so anyone can reproduce a payment.
