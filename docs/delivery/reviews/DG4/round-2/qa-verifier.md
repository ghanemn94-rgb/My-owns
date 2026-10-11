# DG4 round 2: qa-verifier narrative (T-DG4-REV-QA-R2B, re-run)

**Verdict: PASS. No new findings.**

- **Candidate:** `sha256:3f51b79d671ebf6d220c5bb4b104916ca4eddac30266dd74c32e89ed37ccea4b` (1455 files, source `93a7dd7`). I re-checked it at the start and the end in the repo, at `--ref 93a7dd7`, and in three complete disposable clones.
- **Provenance:** nothing from the killed first run (`qa-r2-orphaned/`) is used or cited. All evidence is under `docs/delivery/test-evidence/DG4/qa/round-2/`, and my tests are under `docs/delivery/test-evidence/DG4/qa/tests/round-2/`.

## Round-1 findings: both verified closed

| Finding | Result | Basis |
|---|---|---|
| F-DG4-140 (Low) | CLOSED_VERIFIED | REQ-PB-010 and REQ-S03-004 are the only register rows changed. Each cites the QA-D test that asserts its acceptance literally (a01 for A01; a02-a08 for A02;A08). Every cited path exists, and no false gap sentence remains. Both tests are green here. |
| F-DG4-141 (Low) | CLOSED_VERIFIED | `journeys.spec.ts` was 9/9 in chromium-en and 9/9 in chromium-ar, in both full one-stack runs that also ran the root acceptance specs and my sweep. The test now searches the users register and waits for the `q=` response. |

**The a10 change (KBE-R5).** The REQ-S08-011 test still asserts the clause literally: 3 M gross, 1 M initiative cost, 2 M net, and exactly 1 M less than before.
- The class switch to margin uplift was needed. Under D-117, a revenue-uplift benefit is not in gross or net, so with the old class the test would no longer exercise the clause.
- No assertion was removed or loosened.

## What ran (all on the frozen candidate)

- **Static:** typecheck, build, lint, openapi (652 operations), no-cdn, format and contrast. All exit 0.
- **Unit (`pnpm test`):** 2782 + 259/2 skipped on Node 22 and Node 24, with the locale unset and with C.UTF-8. All four were green on the first run. The 2 skipped tests are skipIf(NOCODEGEN) by design.
- **Integration, run twice:** 1953/1953 each time on fresh PostgreSQL, with migrations 0001→**0061**. The assignment says 0060; 0061 is the repair migration accepted in D-118. contract.test.ts was green (45 cases), and the p4-pending lists are empty.
- **`tests/qa` alone:** 172/172.
- **REQ-DLV-036:** A04 8/8, A09 17/17, A10 16/16 and A11 40/40, so 81/81.
- **My new probes** (`dg4-qa-r2-repairs.test.ts`), 3/3:
  - two simultaneous Finance amendments from one ETag give exactly one 201 and one 409, one correction row, and the original stepped once; a retry from the new ETag works;
  - the migration-0061 trigger branch refuses a version step with any other change, a step of 2, and a step on an uncorrected decision;
  - on both /benefit-totals and /dashboards/finance, gross is 95 (margin + cash + working capital), revenue uplift and avoided cost are separate lines, and net is 95 − 30 = 65.
- **My round-1 probes, re-run:** 10/10, including the S13-001 figure-for-figure scope check on the changed Finance dashboard.
- **e2e:** two full one-stack runs (locale unset and C.UTF-8, run in parallel), each with 348 passed, 1 failed and 3 not run.
  - **The one failure:** p2-journeys 'Define → G2' in chromium-en, a 30 s test timeout at load average 6–12. Its 3 serial followers did not run.
  - **Solo re-runs:** run 1, still in parallel under load, timed out again in both locales. Run 2, at low load, gave 24/24 in both locales, with that test at 21.8–23.7 s.
  - **Diagnosis:** a timing margin of about 22 s out of 30 s, as recorded in D-111, D-112 and D-115. It is a P2 test and is not evidence for any DG4 row.
  - **Everything else passed,** including all P4 specs, the root acceptance specs (14/14), and my sweep: 474 checks per language and run, 0 failed. The sweep covers lang/dir, axe serious/critical = 0, AUD read-only with no writes, and 390 px and 200 % with no page-level overflow, for AUD and TL.
- **Validators:** `--register DG4`, `--pipeline`, and `--historical --stage DG3`, `DG2` and `DG1`. All PASS.
- **Trace:** 137/137 rows have their evidence tests run here with 0 failures.

## Observations (not findings)

1. **The p2-journeys 'Define → G2' journey uses about 75 % of its 30 s budget at low load,** so it fails whenever the load average goes above about 7. This is a test-robustness matter, not a product defect, and is already recorded in D-111, D-112 and D-115.
2. **The two gross bases now differ.** The T10 Value-area headlines and the DG3 business-case totals still sum five classes, while benefit-totals and Finance gross use D-117's three. ARCH-R4 raised this for the domain reviewer. No DG4 acceptance text requires the two to match.
3. **REQ-PB-009's 'Delivered — value validation pending' label** is asserted on screen only in jsdom, unchanged from round 1. Together with the server-side test, it proves the clause.

## Environmental residuals

- No live registry (REQ-DLV-042 AC-1, D-057).
- No live CI (REQ-DLV-025 A24, D-058).
- No Keycloak (D-049); the e2e runs use AUTH_MODE=dev.

The offline surface works, and these are recorded as PASS-with-residual. None of them is DG4-final.

All data is synthetic. Every in-product approval exercised here (Finance, Sponsor, G1–G6) is a synthetic approval of test data and approves nothing real. Product gate G6 never implies DG7.
