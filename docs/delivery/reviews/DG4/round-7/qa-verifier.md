# DG4 round 7: qa-verifier narrative (T-DG4-REV-QA-R7B, re-run)

- **Candidate:** `sha256:baa6ff4da306402cfefe67b54b03ad05f1bb80776187e9fbad44d3bbb31ab527` (1475 files), source `dab4562`.
- **Verdict:** **FAIL**, because one of my round-6 findings, F-DG4-148, does not verify CLOSED. The assignment allows PASS only if all three do.
- **New findings:** none.
- **Evidence:** `docs/delivery/test-evidence/DG4/qa/round-7/` (index in `RUN-NOTES.md`).

## Round-6 findings

| Finding | Result | Why |
|---|---|---|
| F-DG4-146 (Low) | **CLOSED_VERIFIED** | My mutant M4 fails 6 tests of `session-wait.test.tsx`. The split mutants each fail one: M4a fails W4 and M4b fails W3. |
| F-DG4-147 (Low) | **CLOSED_VERIFIED** | I forwarded the boot `GET /me` 1.5 s or 4 s late. The pre-repair spec then fails 12/12 with 403 vs 200, and the candidate passes 12/12. The candidate also passes ×10 per project at load 5–9 and at held load 13–17. |
| F-DG4-148 (Low) | **FAIL, stays OPEN** | The split test script and the warm-up are sound, and they weaken no test (H1–H5b). But `pnpm test` still fails at load ≥ 13. See below. |

**F-DG4-148 runs:**
- **Under the concurrent-review load (22–30):** 3 of 4 runs exit 1.
- **With the load held at 13–16** (median 15.5 during the failing run, inside FE-R10's own band): 1 of 4 runs exits 1.
- **At low load (2–5):** 4 of 4 runs pass.
- **The failures fall in the finding's two classes:**
  - `apps/api/src/architecture.test.ts` runs 33–41 s against its 30 s timeout.
  - In `raid.test.tsx`, the first render of `/actions` misses the 5 s wait in 'action register' (en), even with the page module already warmed.
- **The difference from FE-R10's evidence is the load composition.** Their load was pure busy loops. Mine also carried a Playwright e2e run, as the delivery process does.
- **The product is unaffected.**

## The full review

- **Static checks:** 7/7.
- **Integration:** run twice, 1984/1984 each time. That covers 61 migrations, `contract.test.ts` (45 cases, 652 operations) and the new `supervise-cadence.test.ts` (9/9). Every p4-pending list is empty.
- **QA suites:** `tests/qa` alone passes 172/172. REQ-DLV-036 passes 85/85: A04 12, A09 17, A10 16 and A11 40.
- **e2e:** all 364 tests are counted in each locale setting.
  - Locale unset: 349 passed, 5 failed, 10 did not run.
  - C.UTF-8: 360 passed, 1 failed, 3 did not run.
  - Every failure was a 30 s timeout under load, and each passed when its spec ran alone (68/68 and 24/24).
- **My probes:** 546 + 77 + 14 checks per language, 0 failed, in both locale settings. They cover axe, 390 px, 200 % text and the AUD read-only views.
- **My older integration probes:** 4 expectations fail. Later decided amendments superseded them (ADR-0037 R5/R6, D-119/D-122), so none is a product defect. The current-rule probe passes 5/5.
- **Validator:** 5/5.
- **Trace:** 137/137 rows. The partial-coverage disclosures in the register notes are acceptable.

No product gate G1–G6 was decided. Product G6 never implies DG7. All data is synthetic.
