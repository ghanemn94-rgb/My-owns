# DG0 round 29: code-security-reviewer

**Verdict: PASS.** No new findings. F-DG0-171 is CLOSED_VERIFIED.

- **Candidate:** `sha256:84130c624e877424eed6deb91d086249bc1330bda34ff109b0183102533751bd`
- **Source commit:** `1e4c022`
- **Repository state:** HEAD `ffa3fae` is a metadata-only freeze commit, and the repository is a complete clone.

## D-045 / F-DG0-171

**Reproduced on the round-28 baseline `331407e`.** I annotated-tagged the freeze commit and wrote that tag object id as the round manifest's `source_commit` and into every `review_rounds[]` entry. `checkReviewRounds` then reported 0 rule-relevant errors:
- the manifest and the round entries agree, so the mismatch rule stays silent;
- `manifestFromRef` peels the tag, so the recompute matches.

The only error was the fixture's own write-once artefact, which I logged separately.

**Fixed on `1e4c022`.** `rules.mjs:785-787` now rejects a present non-commit object:
- A tag object is rejected with "is a tag object, not a commit", in both current and historical mode.
- A nested tag, a tree and a blob are each rejected with their own type.

**The absent case is unchanged.** An absent 40-hex id returns `null`, so the check doesn't fire and D-035 still governs it. A closure verified in such a round is still rejected by the unconditional anchor 1 (F-DG0-169). The stages schema pins the field to 40-hex, so `objectType` never receives a ref name or an option string.

**The fix commit checks out.** `fix_revision` `83721ced` is a commit object that sits between the two freezes.

**Supporting tests:**
- The new unit tests (the D-045 test and the D-044 `head_commit_at_start` test) pass.
- The full suite passes 105/105.

## Standing controls

**Commit-object census, on a `--no-local` clone that includes the round-29 freeze:**
- 120/120 `fix_revision` values are commit objects.
- 103 run heads are commit objects; the other 3 are absent, all from round 18.
- 28 round `source_commit` values are commit objects; the other 1 is round 18.
- All 118 closures pass all three anchors.

**Real-repo dry-run:**
- 0 errors in every history bucket, and no object-type error.
- Every remaining error is one that the round-29 records, the auditor's F-DG0-147/149 acceptance, or the probe gate stub clears.

**Pre-freeze:** 11/11 PASS in a fresh `--no-local` clone.

**Validator and candidate hash:** the validator's exit codes are correct, and the candidate hash is deterministic across 5 computations.

**CSV/JSON robustness:** malformed input fails closed.

**CI:** permissions are `contents: read`, actions are SHA-pinned, and the checkout uses `fetch-depth: 0`.

**Secrets and dependencies:** no secrets and no CDN references. `.claude/settings.json` allows only `Bash(bwrap:*)`.

**Write confinement:** every protected and other-role write from my shell is refused. Top-level scratch lands on the throwaway skeleton, as designed in D-030.

**Residuals:**
- Residual 7: `/proc/sys` can be opened for writing. This is exactly as disclosed, and F-DG0-149 is an accepted observation.
- Residual 8: host PIDs are visible, the IPC namespace is private, and no other run's scratch is visible.

Neither residual is larger than disclosed.

## Note (informational, not a finding)

Two commit fields are not type-checked. The gate decision doesn't depend on either, so I did not raise a finding.

- **Each review record's own `source_commit`.** It is only checked for 40-hex format. The gate binds a record by `candidate_id` and by the run's head, and CLAUDE.md treats the commit as a traceability pointer. In the census, all 78 genuine records equal their round's frozen commit (`record-source-commit-census.log`).
- **`stages.json` `candidate.source_commit`.** The enforced chain from `candidate_id` to the manifest to the gate's `source_commit` makes it redundant.

D-045's claim is scoped to fields "the gate depends on", and that scope is accurate.

## Requirements

All 19 DG0-final requirements are IMPLEMENTED with their evidence present, and none of their quoted tests failed:

REQ-DLV-001, 002, 003, 004, 006, 007, 013, 015, 016, 017, 019, 020, 022, 023, 026, 029 and 032; REQ-S20-024; REQ-S20-025.
