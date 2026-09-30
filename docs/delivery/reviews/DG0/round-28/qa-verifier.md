# DG0 round 28: qa-verifier narrative

**Verdict: PASS.** Candidate `sha256:1af91e8f…` (source `331407e9`, HEAD `57d7a53` = freeze metadata only), verified in fresh complete `git clone --no-local` copies.

## What ran (all exit 0)
| Check | Result |
|---|---|
| `check_extraction.sh` | PASS (docx hash, 165 / 423 blocks) |
| gate self-tests | 64/64, incl. "D-044 / F-DG0-250" |
| agent tests | node 39/39, Python 22 OK |
| `--register DG0`, `--pipeline`, `--reconcile` | PASS |
| `prefreeze.sh DG0` (fresh `--no-local` clone) | 11/11 PASS |
| full-history dry-run gate | 0 PRUNED / RECORD-LESS / DROPPED; 0 closure-anchor or tag-object errors; only round-28-unfinished and harness artefacts remain |
| new D-044 suite `dg0-gate-negative-r28.test.mjs` | 8/8 |
| round-26 and round-27 suites re-run (standing controls) | 7/7 and 7/7 |
| register integrity (Python), fix_revision + object-type census | 0 errors |
| agent load evidence, agents.md census, live guard probes, A01–A28 feasibility | PASS |

## D-044 / F-DG0-250
- **Reproduced, then shown fixed.** I ran both the pre-D-044 `rules.mjs` (49b5ad79) and the candidate on the same fixtures:
  - A tag-object `fix_revision` is ACCEPTED by the old rules and REJECTED by the candidate, with exactly the D-044 error (T1). A nested tag is also rejected (T4).
  - A tag-object `head_commit_at_start` is rejected, both for a verifying run (T2) and for the gate auditor's run (T3).
  - The two validators give identical errors on 8 commit-object fixtures (T6).
- **No real record is affected.** Every real `fix_revision` (118) and every present run head (100) is a commit object.
- **Closure.** F-DG0-250 is CLOSED_VERIFIED. The fix commit 8fec92f8 satisfies all three anchors.

## New finding
- **F-DG0-251 (Low, non-mandatory).** A review round's frozen `source_commit` can still be an annotated-tag object id (probe T7: accepted by old and new).
  - This field is closure anchor 1. D-044 says every commit-id field the gate depends on is now a commit object, but `checkClosure` anchor 1 and `findManifest` still peel tags.
  - The candidate has no unit test for the new `head_commit_at_start` branch.
  - Impact is traceability only, and it fails closed: the peeled commit must still contain the fix, and a deleted tag makes the round source absent, which F-DG0-169 rejects.
  - All real round sources are commit objects.

## Notes
- `review-common.md` still says "Review round: `23`" (a stale template line). I used round 28, which matches the paths and the task ID.
- F-DG0-147/149 are accepted observations awaiting the auditor. They're outside my verification scope.
