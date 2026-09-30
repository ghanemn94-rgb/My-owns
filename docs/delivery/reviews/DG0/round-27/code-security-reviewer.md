# DG0 round 27 — code-security review (narrative)

**Verdict: PASS.** Candidate `sha256:9420948b55a5131e…` (source `49b5ad7`). This is the gate round: a re-review after the round-26 D-043 repair.

## Candidate and independence
- `git rev-parse HEAD` was `a4c6f82` at start (advanced to `b83aaf7`/`dd35f19` during the run through a concurrent domain-reviewer **run-evidence** auto-commit — metadata, excluded from the candidate). `node candidate.mjs --stage DG0` and `--ref 49b5ad7` both print the frozen id; the tree is a **complete** clone (`--is-shallow-repository` = false). Manifest self-hashes (91 entries, `mth-candidate-v2`).
- Implementers of the scope: `transformation-analyst`, `delivery-orchestrator`. I authored none of it. I formed this verdict before reading any other round-27 reviewer record.

## The D-043 delta is comment-only (behaviour unchanged)
- `git diff 7edacdc..49b5ad7 -- rules.mjs`: the **only** changed lines are the `commitPresent()` header comment. `grep -Ev '^[-+]\s*//'` over the changed lines returns **count = 0** (no executable line changed).
- rules.mjs with every full-line `//` comment stripped hashes to `352604df…` at **both** `7edacdc` and `49b5ad7` — byte-identical logic. `node --check` passes. No other file under `tools/`, `.github/`, `.claude/` changed in the delta.
- The header no longer duplicates the closure model: it now says the helper "answers presence… states no policy" and points to `findManifest`/`checkClosure`. The closure model is documented in **exactly one** place (`checkClosure`, :721-737), matching the code — anchor 1 is enforced **unconditionally** at :741-744. A grep census of every anchor/closure comment finds none that contradicts the code (the single absence tolerance, D-035, is documented at `findManifest`).

## F-DG0-170 (my round-26 finding) — verified CLOSED_VERIFIED
Reproduced the stale wording at `7edacdc` (`…frozen source_commit (when it resolves; this findManifest tolerance covers the one case it may not)…`), shown removed at `49b5ad7`. Fix `db5afe8` is present and an ancestor of the round-27 candidate/gate `49b5ad7` (anchors 1 & 3) and of this verifying run's head (anchor 2); it touches only the rules.mjs comment plus decisions.md/stages.json (metadata). Documentation-only, Low, non-mandatory. Closed in my verifications sidecar.

## Standing controls (behaviour unchanged, so they must still hold)
- SEC24–SEC27 reproductions on **both** `49b5ad7` and `7edacdc` give an **identical** pass/fail set: absent-source-round rejection (F-DG0-169), post-freeze fix caught by anchor 1 (F-DG0-168), forged-absent-round fix caught by anchor 2 (F-DG0-166/249), absent/all-zero/short `fix_revision` and `head_commit_at_start` rejected, immutable-field lock (F-DG0-165), shallow refusal (F-DG0-160), and the three anchors shown independent (SEC27-7). SEC24-2 fails on both commits **by design** since D-042 (a closure can no longer be verified in an absent-source round; its replacement SEC26-2 passes).
- Real-repo census over 116 CLOSED_VERIFIED closures: 0 anchor-1/2/3 failures, 0 anchor-1 skips (round 18 is the only absent-source round and has no verifying run), 0 head-content drift.
- Committed suites in a fresh `--no-local` clone: node **102/102**, python **22/22**, source extraction reproducible, `prefreeze.sh DG0` all PASS (working-tree candidate == HEAD).

## Sandbox, secrets, CI, determinism
- Live probes from this run's shell: all 18 protected/other-role write attempts refused; own evidence area writable. `/proc/sys` entries (incl. `core_pattern`) are openable for write as uid 0 — **exactly** disclosed residual 7 / **F-DG0-149** (already ACCEPTED_OBSERVATION); nothing was written and no repository/gate/other-run path became writable, so it is **not larger** than disclosed.
- No secrets or runtime CDN/builder-hosted deps in scope (the two URLs are a JSON-schema id and the OOXML XML namespace). CI: `permissions: contents: read`, actions pinned to 40-hex SHAs; `.claude/settings.json` auto-allows only `Bash(bwrap:*)`. Candidate id is identical across three recomputations, `--ref`, and an independent clone.

## Requirements
All 19 DG0-final requirements (`REQ-DLV-001/002/003/004/006/007/013/015/016/017/019/020/022/023/026/029/032`, `REQ-S20-024/025`) are IMPLEMENTED with existing evidence; the assigned set equals the register's `final_gate=DG0` set. A24 (9 named validator tests) and A25 are present and passing.

**No new Critical/High/Medium/Low findings. No unresolved mandatory violations.**
