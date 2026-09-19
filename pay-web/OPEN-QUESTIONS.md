# Open questions (pay-web)

## Waiting on contract push

| Topic | Notes |
| --- | --- |
| Receipt FX fields | Backend will add makbuz fields to `docs/api.types.ts` (rate, rate time, spread). When that lands on master: `cp docs/api.types.ts pay-web/src/api/types.ts` and show them on `PaidReceipt`. |

## Still open

| Topic | Notes |
| --- | --- |
| Underpaid seed | Docs only list `DEMO0001`–`DEMO0004`. Need a fifth seed or a mock helper to rehearse `underpaid` / `shortfallUSDC`? |
| `rails.contract` on seeds | When should a DEMO link expose `rails.contract` for the contract-pay button? Live contract ID is TBD. |

## Settled

- **No re-quote.** Rate is locked at link creation. Countdown is to `expiresAt`; when it hits zero the link is **expired** — show “ask the merchant for a new link,” never refresh for a new price.
