# DG5 re-gate round 4: qa-verifier narrative

**Verdict: PASS** on candidate `sha256:d8d831814a6065af8b417c862486dc2132ee6cca40bae0573f4918ff52e782c9` (2203 files, source `54e02b61961550386d5ab24a74e8ae8bb612218f`). This is the same candidate as round 3 (D-189). No new finding.

## The two findings I reported in round 3

| Finding | Judgement | Why |
|---|---|---|
| F-DG5-145 (Low): p4-benefits test 8 runs on the default 30 s budget | **ACCEPTED_OBSERVATION** | It is a test-only budget defect. Test 8 took 16.7 s en / 15.5 s ar alone, 23.7 s under synthetic load (median 5.9) and 30.2 s in round 3's loaded full suite, with no step over 1.53 s. Its assertions hold in every run. A timeout fails, never passes falsely. Its requirement (REQ-PB-075) is a DG4 row. |
| F-DG5-146 (Low): session-end races My Work's paged load | **ACCEPTED_OBSERVATION** | I reproduced it deterministically (probe R1, 4/4 in en and ar). The product itself lands once on sign-in with the localized message and `returnTo=/my-work`, with no loop and no stale shell. With the precondition established (R2), the original assertions pass unchanged. A race fails, never passes falsely. Its requirement (REQ-S16-030) is a DG6 row. |

**DG6 carry items (D-189):**
- F-DG5-145: give test 8 an explicit budget with at least 2x headroom, or split it, and sweep the other default-budget specs that chain several axe scans or screenshots.
- F-DG5-146: in session-end.spec.ts, wait for My Work's work-items load to settle before `signOutElsewhere()`.
- Performance note: My Work loads every page of open work items eagerly (`fetchAllPages`).

## Orchestrator action needed before the audit (check QA-RG4-00b, FAIL)

Commit `8fbdc7a` added the D-189 row to `docs/delivery/decisions.md`, which is a **candidate file** (it is not meta-excluded). The repository working tree therefore hashes to `sha256:ec9b3d94…`, not to `d8d83181…`:
- `candidate.mjs --diff` exits 1 and lists `docs/delivery/decisions.md`;
- `validate.mjs --reconcile` marks every DG5 review as STALE.

This is the D-136 B1 defect class. What I reviewed is exactly `d8d83181`: a complete clone at 54e02b6, and no product, test or tooling file differs. My judgements are unaffected.

A current-mode DG5 gate validation on `d8d83181` will fail until `docs/delivery/decisions.md` is back to its frozen content (sha256 `818f68c0…`). A re-freeze instead would make every DG5 record stale, this one included. The owner is the delivery-orchestrator, not an implementer role, so this is a disclosed FAIL check, not a finding.

## Other disclosures
- **Task ID mismatch:** the invocation names task `T-DG5-RG-QA-R4`, while the assignment's first line still reads `T-DG5-REV-QA-R5`. This is cosmetic.
- **Cited, not re-run:** the 78 requirements are carried from my round-3 PASS on the identical candidate, which the assignment permits.
- **Log lines:** every warning and non-zero exit in my round-4 logs is explained in `docs/delivery/test-evidence/DG5/qa/round-4/RUN-NOTES.md`. No round-4 test failed, flaked, was skipped or timed out.
- **Clean-up:** the disposable clone and all scratch were removed.
