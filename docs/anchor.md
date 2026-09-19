# Anchor Integration — SEP-6 / SEP-10 / SEP-12 / SEP-38

> How LiraLink turns a paid link's USDC into Turkish lira through a Stellar anchor, and what the
> anchor actually does when it departs from its own documentation. Contract context:
> [`00-PROJECT.md`](00-PROJECT.md); backend boundary: [`01-BACKEND.md`](01-BACKEND.md).

## Providers

One `AnchorAdapter` interface, three implementations, chosen by `ANCHOR_PROVIDER`:

| `ANCHOR_PROVIDER` | Anchor | Fiat | Shape | `settlementMode` |
|---|---|---|---|---|
| **`sep6`** | **`tr-mock-anchor.fly.dev`** — the hackathon's official TRY anchor | **TRY** | programmatic, no human step | `auto_payout` |
| `sep24` | `testanchor.stellar.org` — SDF's reference anchor | USD | interactive, a person completes KYC in a browser | `auto_payout` |
| `mock` | none | TRY | instant, in-process | `balance` |

Every mode has the same API shapes: a settlement goes `pending → processing → completed`,
`provider` names the adapter, `anchorRef` is the anchor's transaction id. A settlement always
continues on the provider it was created with.

The platform account (`PLATFORM_ACCOUNT_SECRET`) authenticates and sends the USDC — custodial.

## SEP-6 — the TRY rail

SEP-6 makes the whole withdrawal programmatic: no interactive page, no browser step, no KYC form.
`interactiveUrl` is always `null` for a `sep6` settlement. `sep6` refuses to start unless
`STELLAR_NETWORK=testnet` — the anchor is a sandbox that moves no real money and does not exist on
pubnet.

```
ANCHOR_PROVIDER=sep6
ANCHOR_HOME_DOMAIN=tr-mock-anchor.fly.dev
FX_PROVIDER=anchor        # the default (empty means anchor) — see "Why FX_PROVIDER=anchor"
```

### Flow

One settlement = one SEP-6 **withdrawal** of `settlement.amountUSDC`.

1. **SEP-1 discovery.** `GET https://{ANCHOR_HOME_DOMAIN}/.well-known/stellar.toml` →
   `TRANSFER_SERVER` (not `TRANSFER_SERVER_SEP0024`), `WEB_AUTH_ENDPOINT`, `SIGNING_KEY`,
   `KYC_SERVER`, `ANCHOR_QUOTE_SERVER`. Refuse an anchor whose `NETWORK_PASSPHRASE` differs from
   ours. 100 KB cap, no redirects, 20 s timeout. Re-read hourly; a rotated `SIGNING_KEY` drops
   every cached JWT.
2. **Pre-check — nothing is opened if it fails.** The merchant has an IBAN; otherwise the settlement
   stays `pending` with `blockedReason` `missing_iban` and the minute job retries (it goes on by
   itself once the IBAN is saved). **`/info` limits are not used**: they are wrong in both
   directions on this anchor (see *Observed*), so the anchor's own answer to the withdraw decides —
   an amount-shaped 4xx blocks with `outside_anchor_limits`, a "disabled" answer with
   `anchor_withdraw_disabled`. `blockedReason` is internal and never exposed by the API.
3. **SEP-10 auth, one anchor user per merchant.** Every merchant's USDC sits in one platform
   account, so the adapter logs in with SEP-10 **memos**:
   `GET {WEB_AUTH_ENDPOINT}?account=<platform>&memo=<merchant memo>&home_domain=…`. The anchor then
   sees one user per merchant (JWT `sub` = `G…:<memo>`) with its own KYC record, IBAN and history.
   - The memo is a 63-bit number derived from the merchant's UUID. The derivation must **never
     change** — a new formula would make every merchant a stranger to the anchor.
   - Verify the challenge **before** signing: server signature by `SIGNING_KEY`, sequence 0, time
     bounds, `<home domain> auth`, `web_auth_domain` (from the `WEB_AUTH_ENDPOINT` host, passed
     separately from the home domain), the optional `network_passphrase`, and that it carries the
     memo asked for.
   - Sign locally and POST it back; never submit it to the network.
   - The issued JWT's `sub` must be exactly `G…:<memo>`, otherwise nothing is cached — an anchor that
     ignored the memo would silently merge every merchant into one user.
   - One JWT cached per merchant until a minute before `exp`; a `401/403` evicts it.
4. **SEP-12: register the payout IBAN.** Without it this anchor pays a sandbox default account,
   not the merchant. On the first withdrawal — and whenever `merchant.iban` or the home domain
   differs from what was registered — `PUT {KYC_SERVER}/customer` with `bank_account_number=<IBAN>`
   as `multipart/form-data` (JSON is accepted too; never a query parameter — it is PII) and the
   merchant's JWT → `202 { id }`, stored with the IBAN and domain it was registered for. When
   all three match, one `GET {KYC_SERVER}/customer` confirms the customer is still `ACCEPTED`; after
   a sandbox reset (`NEEDS_INFO`, or another id) it registers again. A `400` (the anchor validates a
   Turkish mod-97 IBAN) blocks with `missing_iban`.
5. **Open the withdrawal.** `GET {TRANSFER_SERVER}/withdraw?asset_code=USDC&asset_issuer=…&funding_method=bank_account&amount=…&account=<platform>`
   with the merchant's JWT → `{ id, account_id, memo, memo_type }`. Store `anchorRef` **and
   `anchorMemo`** — the anchor scopes transactions to the JWT `sub`, so only that merchant's identity
   can see it. `funding_method` replaces the deprecated `type`. It is a **GET** with query params:
   `POST /sep6/withdraw` answers `404 "No route for POST /sep6/withdraw"` for both multipart and
   JSON (probed 2026-09-19) — the multipart-only rule belongs to testanchor's SEP-24, not here. The IBAN is **not** sent as `dest`: it would put PII in a query
   string, and this anchor ignores it (see *Observed*). An amount-shaped 4xx (naming a minimum or
   maximum) blocks with `outside_anchor_limits` rather than counting as transient.
6. **Send the USDC.** Status is `pending_user_transfer_start` immediately. Check that `amount_in`
   equals the settlement amount (else `failed` / `amount_mismatch`, nothing sent), then pay
   `withdraw_anchor_account` with **`Memo.id`** (`withdraw_memo_type: "id"`). Without the right
   memo the anchor cannot match the payment; an unknown memo type **throws** rather than sending a
   memo-less payment to a shared custodial account.
7. **Wait for the anchor.** `GET {TRANSFER_SERVER}/transaction?id=` as the identity in
   `anchorMemo`. `pending_anchor` / `pending_external` → `processing`; `completed` → `completed`.
   The completed transaction names where the lira went (`to`) and a bank reference; if `to` is not
   the merchant's IBAN the settlement still completes — the money already moved — but an ERROR is
   logged for manual reconciliation. `error` / `expired` / `refunded` / `no_market` / `too_small` /
   `too_large` → `failed` / `anchor_status`. `incomplete` has no meaning in SEP-6 and is treated as
   one more pending state. `pending_customer_info_update` / `pending_transaction_info_update` are
   **in progress**, not failures: the settlement stays `processing` with the status recorded as its
   (internal) `blockedReason`, cleared as soon as the anchor moves on.

### Double-spend guard (SEP-6 and SEP-24)

The signed payment XDR and its hash are persisted on the settlement **before** submission. A retry
resubmits that same transaction — same sequence number, so it can land at most once. A new payment
is built only when the saved one **provably never landed**: its hash is not on Horizon **and** a
ledger has closed after its `maxTime` (300 s time bound). Within one process a settlement never has
two adapter calls in flight.

### Polling

One adapter call follows the anchor for up to 2 minutes (every 3 s), then returns `processing`. The
minute reconciler (and a pass at boot) resumes every unfinished settlement. A thrown error leaves
the settlement as it is — a transient failure never marks money as failed.

### How the money is booked

This anchor charges its spread **in lira**, and reports the lira it actually paid:

```
amount_in  1.0328445 stellar:USDC:GBBD47IF…   amount_out 50.00 iso4217:TRY
amount_fee 0.25      iso4217:TRY              fee_details.asset iso4217:TRY
```

So `netTRY` = **`amount_out`** (the money that reached the bank) and `feeUSDC` = `0` — the 0.25 TRY
is already deducted from `amount_out`, and counting it again would net it twice. `feeUSDC` is only
populated when an anchor denominates its fee in our USDC (then
`netTRY = amountTRY × (amountUSDC − fee) / amountUSDC`, rounded down). An anchor that reports
neither a USDC fee nor a TRY `amount_out` fails the settlement with `unexpected_fee_asset` rather
than guessing. A fee below 0 or above `amountUSDC` → `invalid_fee`. Both are terminal, logged at
ERROR, and reconciled by hand (the anchor already paid out).

### SEP-38 — why `FX_PROVIDER=anchor`

With `FX_PROVIDER=mock` a link is priced at 34.00 TRY/USDC while the anchor settles at ~48.4, so a
50 TRY link would quote 1.47 USDC and the anchor would pay ~71 TRY: the merchant's figure and the
anchor's never agree, and small links fall under the 1 USDC minimum for no reason.

`FX_PROVIDER=anchor` locks the anchor's own rate at link creation:
`GET {ANCHOR_QUOTE_SERVER}/price?sell_asset=stellar:USDC:<issuer>&buy_asset=iso4217:TRY&sell_amount=1&context=sep6`.
- Rate = `1 / total_price`. `total_price` **includes** the spread, `price` does not, and the spread
  is what the settlement is really charged.
- Rounded **down** to 6 dp, so the quoted USDC is never short. Fetched **fresh for every link** —
  no rate cache; only the `stellar.toml` discovery is cached (1 h). `GET /fx` (not built yet) will
  report `source: 'anchor'`.
- **No rate, no link.** On any failure — `stellar.toml` unreadable or for another network, no https
  `ANCHOR_QUOTE_SERVER`, network error or 10 s timeout, a redirect, non-2xx, a body that is not
  JSON or over 64 KB, `total_price` / `price` missing or not a plain decimal > 0, a `sell_amount`
  other than the 1 asked for — the provider logs an ERROR and `POST /links` answers
  `503 "FX rate unavailable, no link created: …"`. There is **no fallback** to the mock rate or to
  an earlier anchor rate: a guessed or stale rate would put the merchant's figure and the anchor's
  apart without anyone noticing.
- Prices are public here. An anchor that demands a SEP-10 JWT (`401/403`) fails like any non-2xx
  until the SEP-10 session exists (it arrives with the `sep6` adapter).
- **What the link stores**, once, next to the locked quote, so a receipt can show what was quoted
  and when: `fxSource`, `fxRateAt` (when the price was fetched — `/price` carries no timestamp of
  its own), `fxMidRate` (`1 / price`, 6 dp down), `fxSpread` (`fee.total / sell_amount`, the share of
  each USDC the anchor keeps — `0.0050237` ≈ 50 bps; `null` if the fee is not stated in USDC) and
  `fxQuoteRaw` (the `/price` body, verbatim). None of these is in the API contract yet.

This is an *indicative* price, not a firm quote: no `quote_id` goes to the withdrawal, so the anchor
re-prices at settlement time (see *Open design items*).

## SEP-24 — the interactive rail

Kept behind the same interface for anchors that only offer hosted, interactive withdrawals.

```
ANCHOR_PROVIDER=sep24
ANCHOR_HOME_DOMAIN=testanchor.stellar.org
ANCHOR_SEP24_TEST_KYC_URL=     # testanchor only: the reference server the KYC form posts to
ANCHOR_SEP24_ENCODING=multipart
```

1. **SEP-1** as above, requiring `TRANSFER_SERVER_SEP0024`.
2. **Pre-checks** against `{TRANSFER_SERVER_SEP0024}/info`, same `blockedReason`s.
3. **SEP-10** as the platform account (no memo — see *Open design items*).
4. **Open:** `POST /transactions/withdraw/interactive { asset_code, asset_issuer, account, amount, lang }`
   as a **form, never JSON**: `multipart/form-data` or `application/x-www-form-urlencoded`. If the
   anchor rejects the format (400/415/422, or a 5xx whose body mentions `Content-Type`), retry once
   in the other format — a rejected request opened nothing — and remember what worked. → `{ id, url }`
   stored as `anchorRef` / `interactiveUrl`.
5. **Interactive step.** A real anchor: the merchant completes `interactiveUrl` ("Complete
   verification" in merchant-web). The settlement stays `processing`, never `failed`, while the
   anchor status is `incomplete`; one `GET /transaction` per minute. On testanchor only, the backend
   drives the reference server's `start` / `submit` calls itself.
6. **Send the USDC** at `pending_user_transfer_start`, exactly as SEP-6 step 6 (memo typed by
   `withdraw_memo_type`: `id` | `text` | `hash`).
7. **Complete:** the fee comes from `fee_details` (else `amount_fee`) and is accepted **only in our
   USDC**; any other fee asset → `unexpected_fee_asset`.

## Observed anchor behaviour

The adapter follows what the anchor **does**, not what its docs say. Measured on testnet.

### tr-mock-anchor (SEP-6)

| Topic | Documented | Observed | Design response |
|---|---|---|---|
| Fee asset | SEP-38: fee in the sell asset (USDC); `/info` `fee_percent: 0.5` | `amount_fee 0.25 iso4217:TRY`; `amount_out` already net | `netTRY = amount_out`, `feeUSDC = 0`. A SEP-24-style fee path would have wrongly failed the settlement |
| Withdraw minimum | Skill and hackathon docs: 1 USDC | `/info` advertises `min_amount: 0.5`, but 0.7 is rejected with `400 {"error":"Minimum off-ramp is 1.0000000 USDC"}` | Don't pre-check `/info`; map the amount 4xx to `outside_anchor_limits` (settlement stays `pending`, never failed) |
| Withdraw maximum | `/info`: `max_amount: 300` | 301 USDC accepted; **5000 USDC accepted** (2026-09-19) | Don't enforce `/info`: it would block links the anchor takes |
| Withdraw method | SEP-6: `GET /withdraw` | `GET` works; `POST` (multipart or JSON) → `404 No route for POST /sep6/withdraw` | `GET` with query params only |
| Payout IBAN | SEP-6: `dest` is where the fiat goes | `dest` ignored; the SEP-12-registered IBAN is used, else a sandbox default IBAN | Register the IBAN over SEP-12 per merchant; don't send `dest`; check `to` on completion |
| User identity | Skill examples: bare `?account=G…` | Memos supported (`sub` `G…:memo`); transactions scoped per `sub` — a withdrawal opened as memo A is `404` for memo B and for the bare account. Memo logins work on an account that already logged in without one | One anchor user per merchant; `anchorMemo` stored per settlement |
| `type` param | `type=bank_account` | Deprecated; `funding_method=bank_account` accepted | Use `funding_method` |
| Rate source | Reflector oracle + 50 bps spread | Confirmed by the anchor's `/health` (`source: reflector`, `static_fallback` if the oracle is down). ~48.41 TRY/USDC; `total_price 0.0206568891` ⇒ 48.409999 | SEP-38 `/price` → `1 / total_price` |
| `total_price` precision | SEP-38: `total_price` = `sell_amount / buy_amount` | It is computed from `buy_amount` **already rounded to 2 dp**: 2026-09-19 11:26 UTC, `buy_amount 48.54`, `total_price 0.0206015657` ⇒ 48.540000, while `/health` showed `sell_rate 48.541152` | Accept it: the rate can only come out lower (≤ 0.01 TRY per USDC), so `quotedUSDC` errs towards the payer sending slightly more, never less |
| Spread | `fee` in the sell asset | `fee.asset` = our USDC, `fee.total 0.0050237` per 1 USDC, one `details` entry `"spread"`, `"50 bps from the USD/TRY mid rate"` | Stored as `fxSpread`; `1 / price` (48.785077) is the mid rate |
| Persistence | "Assume it can be reset before events" | — | Re-check SEP-12 with a GET before every withdrawal; the pre-demo check fails if the anchor's `/health` is unreachable |

Other observations:
- `stellar.toml`: `TRANSFER_SERVER` `…/sep6`, `WEB_AUTH_ENDPOINT` `…/auth`, `KYC_SERVER` `…/sep12`
  (auto-approves), `ANCHOR_QUOTE_SERVER` `…/sep38`, **no** `TRANSFER_SERVER_SEP0024`. It serves the
  same USDC issuer LiraLink uses.
- Anchor-owned public accounts (both from its `stellar.toml`):

  | Role | Public account |
  |---|---|
  | Treasury (`withdraw_anchor_account`) | `GCLCZEQZ2THTEDAOFI66LACNPLY4OBKN7VKLEZFMBIHYKYQOW2W7T3Z6` |
  | SEP-10 challenge signer (`SIGNING_KEY`) | `GDXYO6FJCNXZEWGXD54GT76FGFYLOLSOGSOJLNQ6WGHCGEQPO7NTE73M` |
- Withdraw response: `memo_type: "id"` with a 12-digit memo, `fee_percent: 0.5`, `eta: 10`.
  Transaction ids look like `sep_…`.
- Statuses: `pending_user_transfer_start → pending_anchor → completed` (no `incomplete`).
- The payout is simulated — no bank is credited — but the routing to the registered IBAN is real.
- Settled by the backend on 2026-09-19 (auto-payout, one merchant customer, memo
  `694412119771947729`): `sep_hd4wlhxdlkxvtrr8oi6e` and `sep_4cxe5ql3frhjcb5w3u5g` (1.0300783 USDC →
  `amount_out 50.00 iso4217:TRY`, `amount_fee 0.25 iso4217:TRY`) and `sep_cyj71h8omo6xisfs95ow`
  (1.5451175 → 75.00 TRY, fee 0.37 TRY), each paid to the SEP-12-registered IBAN. With
  `FX_PROVIDER=anchor` the payout equals the link's TRY: the spread is already in the locked rate.
- A verified settlement: 1.0328445 USDC in → 50.00 TRY out (0.25 TRY fee) to the merchant's IBAN
  `TR33 **** **** **** **** **** 26`, with a bank reference on the completed transaction; payment
  [`440149f4…`](https://stellar.expert/explorer/testnet/tx/440149f4ac9cf07de9de10cb25f32c3fd5e4b766ed149f6a789715aac6e6269d)
  (`memo_type: id`, destination the treasury). The bare platform login got `404` for it.

### testanchor (SEP-24)

- `/info`: USDC withdraw enabled, 1–10 USDC, `fee.enabled: false` — yet the reference server books
  a 10% fee (`amount_in 1` → `amount_out 0.9`, `iso4217:USD`).
- It answers a urlencoded withdraw with `500 "Content-Type … is not supported"` — hence the
  one-retry-in-the-other-format rule.
- `withdraw_anchor_account` `GBN4NNCDGJO4XW4KQU3CBIESUJWFVBUZPOKUZHT7W7WRB7CWOA7BXVQF`,
  `withdraw_memo_type: id`.
- Statuses: `incomplete → pending_user_transfer_start → pending_anchor → pending_external →
  completed`. The interactive URL token lives ~15 minutes.

## Error hygiene

Anchors echo back what they receive, and the SEP-12 registration carries the IBAN, so an anchor
error message could contain it. IBAN-shaped tokens are **redacted once, at the anchor HTTP error
boundary**, before the message reaches a settlement's `blockedReason` detail or a log line. Stellar
account and contract ids (56 unbroken characters) cannot match the pattern.

## Settlement mode

`sep6` and `sep24` are **auto-payout per link**: the anchor pays the IBAN during settlement.
`GET /me` and `/health` report `settlementMode: 'auto_payout'` (mock: `'balance'`). Completed
settlements count toward `paidOutTRY` by `netTRY`, never `availableTRY`, and `POST /withdrawals`
returns `409`. Because the bucket follows the provider a settlement was created with, switching
`ANCHOR_PROVIDER` never moves completed money.

## Operations

- **Switch to `sep6`:** the pre-demo check must pass (anchor `/health` reachable, rate source and
  treasury printed), and the platform account must hold enough USDC. Set `ANCHOR_PROVIDER=sep6`,
  `ANCHOR_HOME_DOMAIN=tr-mock-anchor.fly.dev`, `FX_PROVIDER=anchor`; restart; confirm
  `settlementMode: auto_payout` and `GET /fx` `source: "anchor"`.
- **Smoke test:** one link worth ≥ 1 USDC (≈ 50 TRY at the anchor rate), paid, followed on
  `GET /settlements` to `completed`. Expect `feeUSDC` 0 and `netTRY` ≈ the link's TRY. The log line
  for the payout must name the merchant's IBAN (redacted); an ERROR saying it is not the merchant's
  IBAN means SEP-12 registration did not take.
- **Roll back to `mock`:** set `ANCHOR_PROVIDER=mock` and `FX_PROVIDER=mock`, restart. **Keep
  `ANCHOR_HOME_DOMAIN`** until every `sep6` settlement is `completed` or `failed` — they resume on
  their own provider. Reconcile any USDC already sent by `anchorRef` and tx hash.

## Open design items

- **Firm quotes.** USDC → TRY is a non-equivalent pair, so the spec path is `/withdraw-exchange`
  with a firm SEP-38 `quote_id`. Plain `/withdraw` + indicative `/price` means a link paid hours
  later settles at that moment's rate and `netTRY` can differ from `amountTRY` (in either direction;
  nothing caps it). Quotes live ~15 min while links live up to 24 h.
- **SEP-6-only statuses** `pending_customer_info_update` / `pending_transaction_info_update` are
  counted as in progress and recorded in `blockedReason`, but nothing supplies the missing info (no
  `PATCH /transactions/{id}`, no SEP-12 fields beyond the IBAN). Unreachable on this anchor (KYC
  auto-approved); a real one would wait forever.
- **`customer_id`** should be passed on `/withdraw`; today the anchor infers it from the JWT `sub`.
- **`/info` `fields`** are not modelled, so an anchor that requires an extra field gets a 400 or a
  stall instead of a clean block.
- **SEP-12 first registration** does not re-read `GET /customer`, so `NEEDS_INFO` / `PROCESSING`
  looks like `ACCEPTED`.
- **Mid-flow 401** evicts the JWT but fails the call; it recovers on the next minute run instead of
  re-authenticating and retrying inline.
- **HTTPS check** on endpoints read from `stellar.toml` is missing.
- **SEP-24** still logs in as the bare platform account (one KYC identity for every merchant);
  `pending_user` / `on_hold` / `more_info_url` are not surfaced; `refunds` are not netted; a stale
  interactive URL is never re-opened.
- **Anchor limits vs link sizes.** Links above the per-transaction maximum stay
  `pending / outside_anchor_limits`; splitting into several withdrawals is not designed yet.
- **No `KYC_SERVER`** → the payout IBAN cannot be registered; the settlement throws and retries
  rather than paying an unknown account.
- **Merchant memo collisions** are possible with probability ~n²/2⁶⁴.
- **Failed settlements are terminal** with no alerting or dead-letter queue — watch ERROR logs.
- **Single process only**; two instances would need a DB lock around the payment step.

## Tests

- Unit: status mapping, limit checks, memo types, fee/`amount_out` booking, JWT expiry, merchant
  memo derivation, SEP-38 rate parsing, `netTRY` math.
- Adapter tests against a fake anchor: SEP-12 register / re-register on IBAN or domain change /
  after a sandbox reset / IBAN rejected; `funding_method` and no `type`; the merchant JWT on every
  call; `anchorMemo` persisted and used for polling; every block reason including the anchor's own
  4xx; the wrong-payout-IBAN ERROR; no `interactiveUrl` for SEP-6.
- Session tests against real signed challenges: memo in the challenge URL, one JWT per memo,
  refusal of a `sub` or challenge that drops the memo.
- Live e2e, opt-in (`SEP6_E2E=1`, spends ~1 testnet USDC): `GET /fx` source, `settlementMode`,
  `missing_iban`, a block in the 0.5–1.0 USDC band, a full settlement checked on Horizon
  (`memo_type: id`), then at the anchor: the withdrawal belongs to the merchant identity (`404` for
  the bare login), the SEP-12 customer exists, and the payout `to` is the merchant's IBAN.
