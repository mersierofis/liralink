# Source: Agent Payments — x402 + MPP (official Stellar skill)

| | |
|---|---|
| Upstream | https://github.com/stellar/stellar-dev-skill/tree/1f57ed1a2b67e9f6e0adedc8f7897ea4935902a6/skills/agentic-payments |
| Commit | `1f57ed1a2b67e9f6e0adedc8f7897ea4935902a6` |
| Fetched | 2026-09-19, from `raw.githubusercontent.com` at that commit |
| Also served at | https://skills.stellar.org/skills/agentic-payments/SKILL.md |
| License | Apache-2.0 (`LICENSE`, copied from the upstream repo root) |

Files: `SKILL.md`, `x402.md`, `mpp.md`, all **unmodified**. As of 2026-09-19 none of them has changed
between this commit and upstream `main` (`202be802`).

How LiraLink uses it: the x402 rail in `docs/01-BACKEND.md` (*x402 rail*) and its API types follow
this skill's seller and buyer flows. We use the keyless x402.org facilitator on testnet, not the
facilitator the guide configures.

Relative links such as `../smart-contracts/` point at sibling skills that are not vendored here.
