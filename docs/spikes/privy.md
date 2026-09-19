# Spike: Privy × Stellar (raw_sign proven, email OTP unproven)

**Owner:** Yunus  
**Date:** 2026-09-19  
**Status:** **raw_sign proven** on an **app-owned** server wallet; email OTP and USDC payment **unproven**. Second path on pay-web only.  
**Kill line:** if the email path is not demo-ready by **01:00 local (2026-09-20)**, remove it from pay-web without discussion. Freighter / Wallets Kit stays.

## Decision

| Role | Choice |
| --- | --- |
| Primary payer path | **Stellar Wallets Kit** (Freighter / xBull) — stage demo |
| Secondary path | **Privy** — “No wallet? Sign in with email” |
| Secrets | **App ID** on pay-web (`VITE_PRIVY_APP_ID`). **App Secret stays on the backend** — never in the frontend, never in this doc. Rotate any secret that was pasted in chat. |

Privy is not the happy path for the projector demo. It is a fallback for a foreign payer who has no Freighter. Do not read this spike as a product **GO** for walletless email payers — only `raw_sign` → Horizon was proven.

## Question we answered

> Does Privy `raw_sign` over a real Stellar **testnet** `changeTrust` (Circle USDC issuer) produce a signature **Horizon accepts**?

**YES.**

## USDC issuer

Matches `docs/00-PROJECT.md` §4 (Circle testnet USDC, `home_domain: centre.io`):

`GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`

Horizon operations for the spike tx list the same issuer on the `change_trust` op (verified 2026-09-19).

## What we tried

### Round 1 (invalid GO) — ~12:30

- Read Privy docs: Stellar is Tier 2; `createWallet({ chainType: 'stellar' })`; `raw_sign` / `signRawHash`.
- Probed `api.privy.io` without credentials (expected `missing_or_invalid_privy_app_id`).
- Built a **local** `@stellar/stellar-sdk` `Keypair.sign` simulation of `changeTrust` + payment shapes.
- **Bug:** RESULT marked **GO** even though **Privy `raw_sign` was never called**. Corrected to **NOT GO**.

### Round 2 (live proof) — ~13:50

1. Created an **app-owned** Stellar wallet via `POST /v1/wallets` `{ "chain_type": "stellar" }` (Basic auth with App ID + App Secret on the machine running the spike — secret not stored in repo).
2. Friendbot-funded the address on testnet.
3. Built `Operation.changeTrust` for USDC issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`.
4. Called Privy `POST /v1/wallets/{id}/raw_sign` with `params.hash = 0x` + tx hash hex.
5. Verified Ed25519 locally with `Keypair.fromPublicKey(address).verify(...)`.
6. Attached signature and submitted to `https://horizon-testnet.stellar.org`.

## What Horizon said

Horizon **accepted** the Privy-signed `changeTrust`.

| Field | Value |
| --- | --- |
| Answer | **YES** |
| Address | `GB64MTKSN7CQ3QVZXD4MIOWMTXVJGKFKNC62Z7QORERM6VP2ID5N3WUZ` |
| Wallet id | `rl0s0pbu1luj89guw3honwa8` |
| Tx hash | `c403c3da65ba37d1a1ce6c916eb7a5ffb080cb8dec6bbb4ca91ab62046527e21` |
| Ledger | `4758312` |
| Explorer | https://stellar.expert/explorer/testnet/tx/c403c3da65ba37d1a1ce6c916eb7a5ffb080cb8dec6bbb4ca91ab62046527e21 |

## What this does / does not prove

**Proven**

- Privy can custody a Stellar Ed25519 key and `raw_sign` a transaction hash (**app-owned** wallet).
- Horizon testnet accepts that signature on a `changeTrust` envelope for the Circle testnet USDC issuer above.

**Not proven in this spike (follow-ups on pay-web)**

- End-user **email OTP** → user-owned embedded wallet (spike used an **app-owned** server wallet).
- Privy-signed **USDC payment** with memo (only trustline was submitted).
- Full pay-web UI path under time pressure.

## pay-web integration rules

1. Wallets Kit remains the default connect / pay UI.
2. Secondary CTA only: **“No wallet? Sign in with email”** (behind `VITE_PRIVY_ENABLED`).
3. Frontend may hold **App ID only**. Any App Secret usage lives in the API (backend).
4. **01:00 kill switch:** if email → trustline/pay is not working on device, delete the Privy UI + deps and leave Freighter only. No debate.

## References

- https://docs.privy.io/wallets/overview/chains (Stellar Tier 2)
- https://docs.privy.io/recipes/use-tier-2 (Stellar raw hash)
- https://docs.privy.io/api-reference/wallets/raw-sign
- `docs/00-PROJECT.md` §4 — USDC issuer
