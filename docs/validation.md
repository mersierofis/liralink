# User validation

## Exporter interview — 19 September 2026
Exporter based in Erdemli, Mersin (citrus export to Europe).
Name withheld at their request.

- Collects from foreign customers via SWIFT today
- Funds arrive in ~1 day, ~3% lost to fees
- On a $10,000 invoice that is $300. LiraLink's anchor spread is 50 bps (~$50)
- Said he would use a payment link that settles to his IBAN in TRY

## Mentor feedback — 19 September 2026
Kaan (Rise In / Stellar mentor) suggested calling the Soroswap router contract
directly, since the API path was dead.

We ran the spike: the router works on testnet and the XLM/USDC pool has real
liquidity, and a 10 XLM swap simulated fine. But a router swap arrives as a SAC
transfer inside a Soroban invocation, not as a classic payment with a memo, so
crediting it would have needed a second matching design in the money path during
the event. A classic path_payment_strict_receive already lets an XLM-only payer
pay a USDC link on our existing memo rail, which we proved live on testnet.

Shown the result, Kaan agreed: the simpler path already solves it, and keeping
Soroswap out of the demo was the right call.

Details in docs/spikes/soroswap.md.
