# DG1 round 14: qa-verifier narrative

- **Candidate:** `sha256:dd747fe1df62d876a74101caa826542b90d3eb36cedb1de14f299b0b6de8c559`. The freeze commit is `985d0fa`. The ID recomputes identically in a full disposable clone, before and after all runs.
- **Run:** `DG1-T-DG1-REV-QA-R14-qa-verifier-20261001T170044Z-34d396b6`.
- **Verdict: PASS**, with one new Low, non-mandatory finding (proposed **F-DG1-217**).

## F-DG1-135 (Low, REQ-S16-003): CLOSED_VERIFIED

- **The fix is test-only.** Relative to the r13 candidate, the product tree changes only `architecture.testkit.ts` (build-excluded) and `architecture.test.ts`. The code change is `TEST_FILE = /\.test\.tsx?$/`. `CODE_FILE` is unchanged, so every buildable file is still walked.
- **Independent probe:** `qa/tests/dg1-r14-test-classification-probe.test.ts` passes 22/22 on Node 22 and Node 24. It plants files into the real `modules/transformations` directory and calls `moduleViolations()`.
  - `*.test.{mts,cts,js,jsx,mjs,cjs}` files that import vitest, `../../modules.ts` or `architecture.testkit.ts` are flagged, and rules 1-5 still apply.
  - `*.test.ts` and `*.test.tsx` keep the exemption, but a deep cross-module import is still flagged.
  - Near-miss names are classified as non-tests.
- **Empirical alignment** (`07-build-vitest-alignment.log`):
  - A planted `.test.mts` is emitted to `dist` and is not collected by vitest, so the non-test classification is correct.
  - `.test.ts` is collected and not emitted.
  - `.test.tsx` is neither emitted nor collected, so its exemption does no harm.
- **Candidate self-checks:** `architecture.test.ts` passes 128/128 on both runtimes.

## Regression and re-confirmations (Node 22 and Node 24)

| Area | Result |
|---|---|
| Unit | 321/321 (unit-web 110/110, so F-DG1-214 holds) |
| Integration | 200/200, three runs (Node 22 x2, Node 24 x1); no 57P01 in the server logs (F-DG1-009 holds) |
| Migrations | 0001-0008 apply |
| Audit trigger | Rejects UPDATE, DELETE and TRUNCATE |
| Contract | Covers all 33 operations, including getBrandingTokens |
| e2e | 22/22 in EN and AR, including the BU-Lead create → Edit/Archive journey without reload (F-DG1-210 holds) |
| Accessibility | axe: 0 violations on 15 screens per locale |
| Acceptance | A12, A13, A14, A18 (clean start) and A20 (token propagation) green |
| Requirements | All 12 DG1-final requirements IMPLEMENTED, with no missing evidence paths |
| Validators | register, pipeline and reconcile PASS |

## New finding (proposed F-DG1-217, Low, non-mandatory, REQ-S16-003)

The module lint crashes with `Debug Failure. Output generation failed` on any declaration-file name (`*.d.ts`, `*.d.mts`, `*.d.cts`).

- **Cause:** `ts.transpileModule` in `syntaxErrors()` throws for these names.
- **Effect:** the check fails closed (it goes red) and lets nothing through. The developer gets no named diagnostic.
- **Scope:** the defect has existed since r5 and lies outside F-DG1-135. The real tree contains no declaration file.
- **Recorded as:** check QA14-09 (result FAIL).

## Notes for the orchestrator

- **QA14-17b (installer AC-1 effect) is BLOCKED.** The reviewer sandbox has no registry network (`ECONNREFUSED`). REQ-DLV-042 relies on the orchestrator-run acceptance log, which shows 14/14 and is unchanged since r13. Rounds 12 and 13 recorded this sub-check the same way.
- **`checkReview` reports every non-PASS check as an error.** It flags QA14-09 (FAIL) and QA14-17b (BLOCKED). I recorded both honestly and did not mark them PASS.
- **Node 24 Playwright line numbers are wrong.** On Node 24, Playwright reports line numbers past the end of `journeys.spec.ts` for identical test titles. Round 13 shows the same behaviour. This comes from the tooling, not the product.
- **One probe attempt raced, which was my own artefact.** I ran the probe and `architecture.test.ts` in parallel, and the probe was planting and removing files in the directory the real-tree check walks. I then ran them separately.
