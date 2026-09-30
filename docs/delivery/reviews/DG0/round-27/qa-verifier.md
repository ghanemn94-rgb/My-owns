# DG0 round 27: qa-verifier narrative

**Verdict: PASS.** Candidate `sha256:9420948b55a5131e5c0e61385071b6615b1d001bac9f7023c2e512e1e5ac8128`, commit `49b5ad79`. Run `DG0-T-DG0-REV-QA-R27-qa-verifier-20260930T142650Z-0b5715f0`.

## What I checked
- **Candidate and scope.** HEAD a4c6f82 held only freeze metadata. It later moved to b83aaf7 through the domain reviewer's auto-commit (metadata only; I didn't read those files). The candidate recomputes identically. The repository is complete (not shallow). Since the round-26 baseline, the only candidate-scope files changed are `tools/gates/lib/rules.mjs` and `docs/delivery/decisions.md`.
- **Base suites** (fresh `--no-local` clone):
  - extraction: PASS
  - gates: 63/63
  - agents: 39/39 node tests and 22 Python tests
  - `--register DG0`, `--pipeline`, `--reconcile`: PASS
  - pre-freeze: 11/11 PASS
- **Full-history dry-run gate:** 0 PRUNED, 0 RECORD-LESS, 0 DROPPED and 0 closure-anchor errors, and none of the D-042 form. All 46 "OTHER" lines are round-27 completion artifacts:
  - the round-27 records don't exist yet;
  - F-DG0-170 still awaits code-security's verification;
  - F-DG0-147/149 still await the auditor's acceptance;
  - one harness line comes from the probe gate.
- **D-043 is comment-only.**
  - 0 changed executable lines, and the code with comments stripped hashes identically.
  - The `commitPresent()` comment now states no policy. Only the `checkClosure` block describes the anchors, and it matches the code.
  - Behavioural equivalence (QA27-E1): the pre-D-043 and the candidate validator give identical error lists on 8 fixtures.
- **Standing controls** (round-26 suite re-run, 7/7):
  - an absent-source round closure is rejected;
  - a genuine post-freeze fix is rejected by anchor 1;
  - a forged-absent round is rejected by anchors 1 and 2;
  - an all-zero or absent fix is rejected, and so is an absent or `unknown` head;
  - severity and mandatory downgrade drift is detected (F-DG0-165);
  - a shallow clone is refused.
- **New cases** (`dg0-gate-negative-r27.test.mjs`, 7/7):
  - upper-case, tree and blob fix ids are rejected;
  - a side-branch fix merged after the freeze is rejected by anchor 1 only;
  - `fix == round source_commit` is accepted (boundary control);
  - a run head given as a tree id or in upper case is rejected;
  - an annotated tag as fix is **accepted**, which is F-DG0-250.
- **Other checks:**
  - Register: 412 rows, 0 errors.
  - Fix-revision census: 117 fixes, all commit objects, 0 anchor errors, anchor 1 never skipped.
  - Agent setup: 10/10 load runs; 100 run metas with distinct sessions, all on `claude-opus-5-5`.
  - Live guard: 3/3 Write-tool probes blocked and 3/3 shell probes refused.
  - A01–A28 feasibility: 28/28.

## Findings
- **F-DG0-250 (Low, not mandatory, owner delivery-orchestrator).** `checkClosure` accepts an annotated-tag object id as `fix_revision`, because `commitPresent()` and `merge-base` both peel tags. D-037 added an `objectType() === "commit"` check for the gate `source_commit` for exactly this reason. The impact is traceability and consistency only: the peeled commit still has to pass all three anchors, and no real record is affected.

## Notes
- `review-common.md` still says "Review round: 23", a stale template line also seen in round 26. I used round 27.
- I only verify findings I reported. My earlier ones are all CLOSED_VERIFIED already, so this round has no verifications sidecar.
