# LiraLink

**Your customer abroad pays in USDC. You get lira in your IBAN.**

## Demo video

https://www.youtube.com/watch?v=BFfT_cMtuvY (2 min 39 s)

Pitch deck: [docs/LiraLink-Pitch-MersiErOfis.pdf](docs/LiraLink-Pitch-MersiErOfis.pdf)

## Try it in 3 minutes

Demo login (intentional, for judges): `demo@liralink.app` / `RiseInStellar33`

1. Sign in at https://merchant.tutorialplatform.com with the demo login above.
2. Open the demo merchant's pay URL, https://pay.tutorialplatform.com/p/Y82H54DH (or create your
   own link in the panel and open its pay URL, e.g. on your phone).
3. Connect a testnet wallet (Freighter) holding testnet USDC from
   [faucet.circle.com](https://faucet.circle.com) and pay.
4. Watch the link flip to **Paid** on the merchant panel and the TRY settle to the merchant's IBAN.

## What it does

A Turkish merchant or exporter creates a payment link priced in **Turkish lira**. A customer
**abroad** opens it and pays in **USDC on Stellar** from their own wallet — through a Soroban invoice
contract, a classic memo payment, or, for AI agents, **x402**. LiraLink detects the payment on-chain
within seconds, withdraws the USDC through the hackathon's **TRY anchor over SEP-6**, and the lira
is paid out to the merchant's IBAN. The merchant never touches crypto. **Testnet only.**

## Live URLs

| | URL |
|---|---|
| Merchant panel | https://merchant.tutorialplatform.com |
| Payer page | https://pay.tutorialplatform.com/p/Y82H54DH (the demo merchant's open link) |
| API | https://liralink2-api.tutorialplatform.com/api |
| API docs (Swagger) | https://liralink2-api.tutorialplatform.com/docs |
| API health | https://liralink2-api.tutorialplatform.com/api/health |

## Contract ID

Soroban invoice contract on testnet:

- **Live contract:** `CCXHJK4Y667EDKM5H3CXKP26V3LRVOH6NULYS5K6T4BKQADSSFL23BIA`
  ([stellar.expert](https://stellar.expert/explorer/testnet/contract/CCXHJK4Y667EDKM5H3CXKP26V3LRVOH6NULYS5K6T4BKQADSSFL23BIA))
- Prototype contract (pre-event reference — NOT used by this build):
  `CDKZYQI4HI347ZVAMXT2XPHLYDSDKN6ERELKASGJDII6AQU6ROFQ45EJ`
  ([stellar.expert](https://stellar.expert/explorer/testnet/contract/CDKZYQI4HI347ZVAMXT2XPHLYDSDKN6ERELKASGJDII6AQU6ROFQ45EJ))

Interface and deployment details: [docs/00-PROJECT.md §7](docs/00-PROJECT.md).

## Architecture

See **[docs/architecture.md](docs/architecture.md)** — system diagram, the three payment rails, and
the contract's storage, TTL and auth patterns. Design docs start at
[docs/00-PROJECT.md](docs/00-PROJECT.md).

## User validation

An exporter interview and mentor feedback from the event: **[docs/validation.md](docs/validation.md)**.

## Stellar integrations used

- **Soroban smart contract** — invoice `create` / `pay` / `cancel` with admin and payer
  `require_auth`, USDC moved through the **Stellar Asset Contract**, RPC `getEvents`.
- **Classic payments** — USDC with text memos, trustlines, Horizon payment streaming.
- **x402** — agent payments on `stellar:testnet` through the x402.org facilitator.
- **Anchor SEPs** — SEP-1 discovery, SEP-10 web auth (one identity per merchant via memos), SEP-12
  payout IBAN registration, SEP-6 programmatic withdraw, SEP-38 prices. SEP-24 behind the same
  adapter. Details and observed anchor quirks: [docs/anchor.md](docs/anchor.md).
- **Stellar Wallets Kit** — payer wallet connect and signing (Freighter and others).

## Stellar Skills used

| Skill | File | Used for |
|---|---|---|
| Anchors (community, Cheesecake Labs) | [`skills/anchors/SKILL.md`](skills/anchors/SKILL.md) | SEP-6 / SEP-12 implementation checklist and gotchas |
| SEPs, CAPs & Ecosystem (official) | [`skills/standards/SKILL.md`](skills/standards/SKILL.md) | Routing to SEP-1 / SEP-10 / SEP-24 and spec review |
| Agent Payments — x402 + MPP (official) | [`skills/agentic-payments/SKILL.md`](skills/agentic-payments/SKILL.md) | x402 seller and buyer sides |
| TR Mock Anchor (hackathon) | [`skills/anchor-tr/SKILL.md`](skills/anchor-tr/SKILL.md) | Endpoints, treasury, `Memo.id` rule and SEP-38 asset ids of the TRY anchor |

Each skill is vendored unmodified under `skills/<name>/`. Its `SOURCE.md` gives the upstream URL,
the pinned commit, the fetch date and the licence.

## Regulatory note

We target cross-border collection precisely because the domestic use of crypto
as a payment instrument is restricted in Turkey: the payer is outside Turkey,
the merchant only ever prices and receives Turkish lira, and the licensed
anchor is the regulated party performing the conversion. We do not claim this
flow is cleared under Turkish payment regulation. That is a question for
counsel, and a formal legal opinion is a prerequisite before any production
launch. This is engineering framing, not legal advice.

### Custody

This hackathon build is **custodial**. The platform's Stellar account receives the payer's USDC,
and each merchant's balance is a row in LiraLink's ledger, not an on-chain account of their own.
This is a deliberate simplification for the event. Non-custodial settlement, where the payer pays
the anchor directly and the platform never holds funds, is on the roadmap.

## Timeline

- **Preparation week (before the event):** we wrote the design docs and built a working prototype
  to validate the approach end to end on testnet — the memo, contract and x402 rails, and the
  SEP-6 settlement against the TRY anchor. The design docs in `docs/` are carried over from that
  work.
- **During the event (19–20 Sept 2026):** this repository was written. The prototype informed the
  design; the code here is the event build.

## Team — MersiErOfis

- **Hasan** ([@movilidadagil](https://github.com/movilidadagil)) — backend and Stellar integrations
- **Vuslat** ([@vuslattt](https://github.com/vuslattt)) — merchant web and pitch
- **Yunus** ([@Yunussoydan33](https://github.com/Yunussoydan33)) — payer web
