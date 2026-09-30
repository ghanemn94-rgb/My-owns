# DG0 round 25: code-security-reviewer

- **Candidate:** `sha256:b77a1c6303fe7be11fbdc858c2810329e947871d788d29b8f000cbd6dbfdcbab` (source `2386a0f`; HEAD `e84c393`, which adds metadata only).
- **Run:** `DG0-T-DG0-REV-SEC-R25-code-security-reviewer-20260930T134851Z-0325bb77`
- **Verdict:** **PASS**, with one Low observation (F-DG0-169).

## D-041 (three-anchor checkClosure)
- **F-DG0-168 is CLOSED_VERIFIED.** Each anchor is enforced separately, and none replaces another:
  1. `rules.mjs:742`: the fix must be an ancestor of the round's `source_commit`, when that commit resolves;
  2. `:744`: the fix must be an ancestor of the run's head;
  3. `:747`: the fix must be an ancestor of the gate candidate.
- **Before and after**, on `--no-local` clones:
  - My round-24 case (a genuine round with a fix committed after the freeze and before the run) gave 0 errors at `6db3b83`. At `2386a0f` it gives "not in the verified round-2 candidate".
  - The round-23 forge is still rejected, by anchor 2.
  - The controls pass, and the absent-fix, malformed-head and immutable-field protections all hold.
- **Real history:** all 114 closures pass all three anchors, and none of them skips anchor 1.
- **Tests and pre-freeze:** 101/101 node tests, 22/22 Python tests, pre-freeze 11/11.

## New: F-DG0-169 (Low, not mandatory)
- **Where:** anchor 1 runs only `if commitPresent(round.source_commit)`.
- **Scenario (SEC25-3):**
  1. A superseded round's write-once manifest names a `source_commit` that does not exist.
  2. A fix is committed after that round's freeze.
  3. The verifier's run starts after the fix.
  - Result: 0 errors. Anchor 1 is skipped, and anchors 2 and 3 are satisfied.
- **Documentation:** the new comment at `:737-738` says such a fix is "always rejected, whatever the round metadata says", and D-041 says "no single forgeable metadata value decides a closure". Both overstate the guarantee.
- **Impact:** mis-attribution only.
  - The verifier's checkout did contain the fix.
  - The fix is still in the gate candidate, which all four gate-round agents review.
  - Exploiting it needs a hand-forged manifest, which the threat model's residual 1 already covers.
- **Suggested fix** (any one):
  - reject a closure whose verifying round's `source_commit` does not resolve. No genuine record would break: round 18 is the only such round, and it has no verifying run.
  - require the run head's candidate content to equal the round candidate.
  - correct the comments and D-041.

## Unchanged since round 24
- `tools/agents`, `tools/source`, `.claude`, `.github`, the schemas, `candidate.mjs` and `validate.mjs` are byte-unchanged.
- CI keeps `contents: read`, SHA-pinned actions and `fetch-depth: 0`.
- `settings.json` auto-allows only `Bash(bwrap:*)`.
- Secrets and CDN scans are clean.
- Candidate hashing is deterministic across locale, umask and core.fileMode.
- Residuals 7 and 8 are as disclosed. Probe 7 used `access(W_OK)` only, with no host write; for residual 8, another run's `/proc/<pid>/root` is denied.
- All 19 DG0-final requirements are IMPLEMENTED, with their evidence present.

## Note on the assignment
`review-common.md` says "Review round: `23`", but it also gives the output path `round-25/`. The validator binds `record.round` to the directory, so I recorded `round: 25`.
