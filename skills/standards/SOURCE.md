# Source: SEPs, CAPs & Ecosystem (official Stellar skill)

| | |
|---|---|
| Upstream | https://github.com/stellar/stellar-dev-skill/tree/1f57ed1a2b67e9f6e0adedc8f7897ea4935902a6/skills/standards |
| Commit | `1f57ed1a2b67e9f6e0adedc8f7897ea4935902a6` |
| Fetched | 2026-09-19, from `raw.githubusercontent.com` at that commit |
| Also served at | https://skills.stellar.org/skills/standards/SKILL.md |
| License | Apache-2.0 (`LICENSE`, copied from the upstream repo root) |

Files: `SKILL.md`, `ecosystem.md`, `resources.md`, all **unmodified**. As of 2026-09-19 none of them
has changed between this commit and upstream `main` (`202be802`).

How LiraLink uses it: its anchor section routes fiat rails to SEP-6 / SEP-24, with SEP-1
(`stellar.toml`) and SEP-10 (web auth) as prerequisites, plus SEP-38 for quotes. The anchor
adapters in `backend/src/settlements/anchor/` and `docs/anchor.md` follow those specs.
`ecosystem.md` and `resources.md` are vendored for completeness.

Relative links such as `../assets/` point at sibling skills that are not vendored here.
