# Soroswap Spike

> Question: can a payer holding XLM pay a USDC link through Soroswap on **testnet**, and should
> LiraLink integrate it for the hackathon build?
>
> Second look, 2026-09-19 11:49–11:53 UTC, read-only. Everything below was measured from the
> public Soroswap API, Soroban RPC `https://soroban-testnet.stellar.org` (protocol 28) and Horizon
> testnet. Nothing was signed or submitted. No code or dependency was added to the repo.

## Verdict

- **API: still a no-go on testnet.** It has no testnet index and needs an API key.
- **Contract level: viable today.** The router is live on testnet. The XLM/USDC pair for **the Circle
  USDC LiraLink settles in** has large reserves, and a simulated 10 XLM → USDC swap returns a
  sensible amount.
- **Recommendation: do not integrate Soroswap for the hackathon build.** Paying a USDC link with
  XLM already works through a classic path payment over the SDEX. The memo rail accepts
  `path_payment_strict_*` today, at no extra cost. Keep the router as a documented post-hackathon
  option, not a demo dependency. Details under *Recommendation*.

## 1. API — `api.soroswap.finance`

The earlier no-go was reported as "no key, testnet not indexed". Re-checked:

```
GET https://api.soroswap.finance/health → 200
{"status":{"indexer":{"mainnet":["soroswap","phoenix","aqua","sdex"],"testnet":[]},"reachable":true}}

POST https://api.soroswap.finance/quote?network=testnet   (no API key; XLM → Circle USDC, 10 XLM, EXACT_IN)
→ 403 {"message":"Forbidden resource","error":"Forbidden","statusCode":403}
```

The `testnet` indexer list is empty, and quotes need a key. Both blockers hold.

## 2. Contract level — Soroban RPC

### Addresses and where they come from

| Contract | Testnet id | Source |
|---|---|---|
| Router | `CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD` | [`soroswap/core` `public/testnet.contracts.json`](https://github.com/soroswap/core/blob/main/public/testnet.contracts.json), `ids.router`. Last changed in commit `bb90a65556` "Testnet Deployment 22-12-2025"; repo `main` at `6eade008` |
| Factory | `CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY` | same file, `ids.factory` |
| XLM (native SAC) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | [`soroswap/core` `public/tokens.json`](https://github.com/soroswap/core/blob/main/public/tokens.json), testnet |
| USDC in Soroswap's token list | `CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F` | same file, testnet `USDC`. **Not** Circle's USDC |
| USDC that LiraLink uses (Circle SAC) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | `00-PROJECT.md` §4 |

Contract instances exist on the ledger (`getLedgerEntries`, latest ledger 4759015):

```
router  CCJUD55A…  exists, lastModifiedLedger 82780,   liveUntilLedger 7561567
factory CDP3HMUH…  exists, lastModifiedLedger 4742034, liveUntilLedger 6692888
factory.all_pairs_length() → 251   (retval AAAAAwAAAPs=)
```

### XLM/USDC reserves (raw)

`factory.get_pair(XLM, USDC)`, then `token_0()`, `token_1()` and `get_reserves()` on the pair.
The values are i128 stroops (7 dp):

**Circle USDC** (the one LiraLink settles in)
```
pair            CCBX3NZTCQLQFSPG7HBOKL4P2RVPOPVFHDNRTOSCCJWBTPL2GHEH7RQS  (lastModifiedLedger 4758531, liveUntilLedger 6692889)
token_0         CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA   (USDC)
token_1         CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC   (XLM)
get_reserves()  ["4169483670617", "39375209480385"]
                retval AAAAEAAAAAEAAAACAAAACgAAAAAAAAAAAAADysiX1FkAAAAKAAAAAAAAAAAAACPPwV/AwQ==
                = 416,948.3670617 USDC / 3,937,520.9480385 XLM  (≈ 0.1059 USDC per XLM)
```

**Soroswap's own test USDC**
```
pair            CDVAIOYHCD4RUSLQNVFI7RIZBFT2JZMJWM4RTOLQZQXL4QAVXU5RFKDB  (lastModifiedLedger 4758104, liveUntilLedger 5261560)
token_0         CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F   (USDC, Soroswap list)
token_1         CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC   (XLM)
get_reserves()  ["38532618703", "132539762257"]
                retval AAAAEAAAAAEAAAACAAAACgAAAAAAAAAAAAAACPi5Gc8AAAAKAAAAAAAAAAAAAAAe2/xGUQ==
                = 3,853.2618703 USDC / 13,253.9762257 XLM
```

Neither pair is dead. Both were last modified within 911 ledgers (≈ 75 min at ~5 s per ledger) of the reading, so
someone is trading on them.

### Simulated swap: 10 XLM → USDC (simulated, **not** submitted)

`router.swap_exact_tokens_for_tokens(amount_in = 100000000, amount_out_min = 0, path = [XLM, USDC],
to = <LiraLink platform account GDWV6USF…34N2>, deadline = now + 300)`. It was built with the
account's real sequence number and sent to `simulateTransaction` only. It was never signed and
`sendTransaction` was never called. `amount_out_min = 0` is acceptable only because nothing is
submitted.

```
→ Circle USDC pair
  retval AAAAEAAAAAEAAAACAAAACgAAAAAAAAAAAAAAAAX14QAAAAAKAAAAAAAAAAAAAAAAAKEXgg==
  amounts ["100000000", "10557314"]  →  amountOut = 1.0557314 USDC
  1 auth entry (the `to` account), 19 events, minResourceFee 43332 stroops

→ Soroswap-list USDC pair
  retval AAAAEAAAAAEAAAACAAAACgAAAAAAAAAAAAAAAAX14QAAAAAKAAAAAAAAAAAAAAAAAbnypA==
  amounts ["100000000", "28963492"]  →  amountOut = 2.8963492 USDC
  1 auth entry, 19 events, minResourceFee 165641 stroops
```

`router_get_amounts_out(100000000, [XLM, USDC])` returns the same amounts, which gives a
read-only quote. Against the Circle pair's spot price (≈ 1.0589 USDC for 10 XLM), the output
reflects the 0.3 % pool fee plus price impact.

### For comparison: the classic SDEX path

```
GET https://horizon-testnet.stellar.org/paths/strict-send?source_asset_type=native&source_amount=10
    &destination_assets=USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
→ 1 path: 10.0000000 XLM → 10.5384105 USDC, direct (path [])
```

**Testnet prices mean nothing.** The SDEX and the Circle-USDC pool disagree by 10×. Nothing here
says anything about a real XLM price.

## Recommendation

**Do not integrate Soroswap for the hackathon. Keep the contract route documented as a post-event option.**

1. **The need is already met without it.** "Pay a USDC link with XLM" is a classic
   `path_payment_strict_receive` to the platform account with the link code as memo. SDEX has a
   path on testnet, and the memo rail already accepts path payments (`01-BACKEND.md`, Memo rail).
   That needs no new contract call, no new detection, and no new failure mode.
2. **A router swap does not fit the memo rail.** A swap's USDC arrives as a SAC transfer inside a
   Soroban invocation, not as a classic payment. The listener matches on the transaction memo and on
   classic payment operations. Crediting a swap would need its own matching design: which link, and
   by what key? That is new money-path code during the event, for a demo that must not fail.
3. **Testnet liquidity is someone else's test deposit.** The Circle pool looks healthy now, but
   it's an unowned testnet position that can be withdrawn at any moment or vanish in a testnet
   reset. The demo would depend on it.
4. **If we do it later:** quote with `router_get_amounts_out`, set `amount_out_min` from that quote
   minus a slippage bound (never 0), and use a short `deadline`. The payer signs the `to`
   authorization, and `to` is the payer, who then pays the link. Or design a router → platform
   credit path with a proper matcher first. Mainnet additionally needs the API key or our own
   quoting.

## How to reproduce

Every step is a public read: `getLedgerEntries` for the contract instances, and
`simulateTransaction` for `factory.all_pairs_length`, `factory.get_pair`, `pair.token_0`,
`pair.token_1`, `pair.get_reserves`, `router.router_get_amounts_out` and
`router.swap_exact_tokens_for_tokens`, all with the addresses above. Any Soroban client works. The
source account of a simulation does not need to exist, except for the swap, which needs a `to`
that actually holds the XLM.
