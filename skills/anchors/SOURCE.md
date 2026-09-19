# Source: Anchors (community skill, Cheesecake Labs)

| | |
|---|---|
| Upstream | https://github.com/CheesecakeLabs/stellar-anchor-skill/tree/be34740f1d81a43e543279eab7544994e17b7c95 |
| Commit | `be34740f1d81a43e543279eab7544994e17b7c95` (upstream `main`, 2026-07-01) |
| Fetched | 2026-09-19, from `raw.githubusercontent.com` at that commit |
| Listed at | https://skills.stellar.org/ (*Community* → Anchors) |
| License | Apache-2.0 (`LICENSE`, vendored) |

Files: `SKILL.md`, `README.md`, `LICENSE` and the whole `references/` tree, all **unmodified**.
Upstream's `CLAUDE.md` is a contributor guide for that repo, not skill content, and is not
vendored. This is a community skill in its own repo, not part of `stellar/stellar-dev-skill`.

How LiraLink uses it: it is the implementation checklist for the SEP-6 TRY rail
(`backend/src/settlements/anchor/sep6.adapter.ts`), in particular its gotchas and
`references/client/sep6-programmatic.md`, `discovery-and-auth.md` (SEP-1/SEP-10) and
`sep38-quotes.md`. The server half (`references/server/`, `references/testing/`) is vendored for
completeness but unused: LiraLink integrates *with* an anchor, it does not run one.
