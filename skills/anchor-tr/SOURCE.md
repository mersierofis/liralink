# Source: TR Mock Anchor (hackathon skill)

| | |
|---|---|
| Upstream | https://github.com/yigitcangokmen/stellar-hackathon-turkiye/blob/183fe262a2029eb9eae68209e052cbb77a6e8cdb/SKILL.md |
| Commit | `183fe262a2029eb9eae68209e052cbb77a6e8cdb` (last commit touching `SKILL.md`; repo `main` is `f06e1ae6`, where it is unchanged) |
| Fetched | 2026-09-19, from `raw.githubusercontent.com` at that commit |
| Also published at | https://stellar-hackathon-turkiye.vercel.app/docs/entegrasyon/skill |
| License | None declared upstream. Vendored unmodified, with attribution, as the hackathon's official integration skill for participants |

Files: `SKILL.md`, **unmodified**.

How LiraLink uses it: it is the source for `ANCHOR_PROVIDER=sep6` against `tr-mock-anchor.fly.dev`:
the home domain, the `/auth`, `/sep6`, `/sep12`, `/sep38` layout, the USDC issuer, the `Memo.id`
rule on the withdraw payment, and the SEP-38 asset ids (`iso4217:TRY`, `stellar:USDC:…`).

Where the running anchor disagrees with this skill is recorded in `docs/anchor.md` →
*Observed anchor behaviour*: the skill says the withdraw minimum is 1 USDC, `/sep6/info` advertises
0.5, and the anchor rejects anything under 1 USDC.
