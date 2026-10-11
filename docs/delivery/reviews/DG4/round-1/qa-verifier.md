# DG4 review round 1: qa-verifier narrative (T-DG4-REV-QA-R1)

- **Candidate:** `sha256:19656b1ff2cc5ce167e8651166631c105d74883e45e1d714e8cff0d087eae86e` (1449 files), freeze commit `a613f6f`, source `a91d82cf6fb6f5bffe68e623d469307421ad121b`.
  - I recomputed the ID on the repo and on two complete, non-shallow clones, at the start and at the end. HEAD moved to `4434ec9` during the run, with 0 files changed outside `docs/delivery/`.
- **Invocation:** `DG4-T-DG4-REV-QA-R1-qa-verifier-20261010T212648Z-f5fe7a31`, session `f5fe7a31-0f8b-4ace-8cb4-605d5263d717`.
- **Independence:** I authored no product code in the DG4 scope. In this round I wrote only:
  - three QA test files outside the candidate (`docs/delivery/test-evidence/DG4/qa/tests/round-1/`);
  - the evidence under `docs/delivery/test-evidence/DG4/qa/round-1/`;
  - this record, its narrative and the findings sidecar.
- **Approvals:** every product approval exercised is synthetic test data. Product gates G1–G6 never imply DG0–DG7.

## Verdict: PASS, with two new Low findings (non-blocking)

| Finding | Severity | What |
|---|---|---|
| F-DG4-140 | Low (documentation) | REQ-PB-010 and REQ-S03-004 still disclose test gaps that QA-D closed, and their `evidence` omits the two QA-D tests. |
| F-DG4-141 | Low (test robustness) | `apps/web/e2e/journeys.spec.ts` "administration screens" assumes the seeded Lead is on page 1 (25 rows) of the users register. It fails in chromium-ar when the product journeys and the root acceptance specs share one stack. It passes alone in both projects. |

I found no product defect, nothing Critical or High, and no mandatory violation. Every failure in the logs I cite is listed and explained below.

## What ran (all on the frozen candidate, in disposable clones under `$TMPDIR`)

| Check | Result |
|---|---|
| Static: typecheck, build, lint, `openapi:lint` (652 operations), `check:no-cdn`, `format:check`, contrast | All exit 0. The build prints Vite's advisory warning that one chunk exceeds 500 kB (`index-*.js`, 1.15 MB). |
| `pnpm test`, Node 22 and Node 24, locale unset and `C.UTF-8` | 2771 passed, plus 259 passed and 2 skipped (no-codegen project), in every configuration. Two non-green first runs are explained below. |
| Integration, two runs on disposable PostgreSQL 16.13 | Migrations `0001`–`0060`, 202 files, **1922/1922** in each run. `contract.test.ts`: 45 cases green. All 40 `p4-pending-*.ts` lists are empty. |
| `tests/qa` alone | 15 files, **172/172**. |
| REQ-DLV-036 | A04 8/8, A09 17/17, A10 16/16, A11 12 + 11 + 17 = 40/40, so **81/81**. |
| e2e on the real stack, `--workers=1`, chromium-en and chromium-ar, locale unset and `C.UTF-8` | 332 product journeys, 14 root acceptance specs (A03, A04, A08/A09, A20) and my 6 tests per run. See the e2e section. |
| My probes | ERD/migrations for the six entity groups, REQ-S12-005 with two owners, REQ-S13-001 figures (see below). All green. |
| Validators | `--register DG4`, `--pipeline`, `--historical --stage DG3`, `DG2` and `DG1`: all PASS. |

## Every non-zero exit or failure, explained

1. **`02-unit-node22-C-run1.log`, exit 1: a load timeout, not an assertion.**
   - The failing test is `apps/api/src/architecture.test.ts` › "every import respects dependsOn…", a whole-repo AST scan. It hit its 30 s limit at 34.9 s, under a load average of about 15 on 4 cores (three reviews running at once).
   - The same test took 24.0 s at load 9, 27.6 s at load 17, and 8.2 s at load 7 in the re-run.
   - The re-run, `02-unit-node22-C-run2.log`, exits 0: 2771 + 259/2.
   - Observation: under heavy load this test runs close to its timeout.
2. **`02-unit-node24-C-run1-KILLED-by-runner-30min-limit.log`: incomplete, not counted.**
   - My agent harness's 30-minute background limit stopped the runner script during this last configuration. The test run itself did not fail.
   - The re-run, `02-unit-node24-C-run2.log`, exits 0.
3. **`03-integration-tests-qa-with-r1-probes-run1-PROBE-EXPECTATION-ERROR.log`, exit 1: my probe's error.**
   - The 172 candidate tests all passed. One of my 7 probe tests failed: I expected a `status` column on `benefit_formula_version`.
   - The ERD's slice-B register (§1f.3) names `validation_status` as that immutable table's status column, and migration 0023 has it.
   - I corrected the probe; `03-integration-r1-probes-run2.log` is 7/7.
4. **`03-integration-r1-scope-totals-run1-PROBE-IMPORT-ERROR.log`, exit 1: my import error.**
   - My probe imported `seedWorld` from the QA support module, which does not re-export it. No test ran (3 skipped).
   - I fixed the import; run 2 is 3/3.
5. **e2e, product journey: `journeys.spec.ts` "administration screens", chromium-ar, failed in both full runs; its 2 serial followers did not run.** This is F-DG4-141.
   - The trace shows `GET /api/v1/users?…&limit=25` → 200 with 25 items and a `nextCursor`, without "Synthetic Transformation Lead". The users the chromium-en project created sort before it.
   - The spec alone on a fresh stack passes 9/9 in both projects (`04-e2e-solo-journeys-qa-unset.log`).
   - The analysis is in `04-journeys-admin-failure-analysis.txt`.
6. **e2e, my own sweep, locale-unset run (revision 1 of my spec): failures were mine.**
   - `/admin/jobs` was recorded as "no h1". That page renders the product's no-permission state by design: `job.read` belongs to ADM_TECH only (migration 0031).
   - The lead sweep stalled until its 30-minute timeout. On `/admin/calendar` the lead briefly sees an h1, then the "Not found" state replaces it, and my unbounded `textContent(h1)` waited for ever. "Z" was therefore skipped.
   - Revision 2 (the C.UTF-8 run) and revision 3 (the solo run) accept the no-permission state as a valid render and bound every wait.
   - Revision 2: 474 checks per language, 0 failed. Revision 3: 3/3 tests in both languages.

## e2e results

Each run had 352 tests in total: 332 product journeys, 14 root acceptance tests and my 6.

- **Locale unset** (`04-e2e-full-unset.log`): 345 passed, 3 failed, 4 did not run.
  - Product journeys: 329/332. One failure (F-DG4-141) and its 2 serial followers did not run.
  - Root acceptance specs: 14/14.
  - My spec, revision 1: both lead sweeps timed out; their 2 "Z" tests did not run.
  - The revision-1 auditor sweep still recorded 445 checks per language. Its only failure was the by-design `/admin/jobs` no-permission page; every axe, `lang`/`dir`, 390 px, 200 % and no-write check passed.
- **`LANG=C.UTF-8`** (`04-e2e-full-cutf8.log`): 349 passed, 1 failed (F-DG4-141), 2 did not run.
  - Product journeys: 329/332.
  - Root acceptance specs: 14/14.
  - My spec, revision 2: 6/6.
- **Solo re-run, locale unset** (`04-e2e-solo-journeys-qa-unset.log`): `journeys.spec.ts` 9/9 in both projects, and my spec (revision 3) 3/3 in both projects; 24/24 in total.
- **Concurrency and duration:**
  - The C.UTF-8 run overlapped the second half of the locale-unset run, on separate ports, clones and databases.
  - No product test timed out in either run. The slowest product test took 27.0 s, under its 30 s limit: chromium-ar "Define → G2" in the locale-unset run, with 26.3 s for the slowest in the C.UTF-8 run. These journeys run close to their limit, which D-111, D-112 and D-115 already record.
- **axe:** every product journey asserts axe with 0 serious or critical issues on each screen it visits, and all passing tests passed that assertion. My sweep adds its own axe check on 59 routes per language.

## Probes beyond the candidate's suites

- **P1, the ERD and migration halves of REQ-S16-011, -014, -017, -018, -019 and -020.** Until now these were covered only by an analyst inspection, or by QA-B's test for 018/019. For every listed entity, I checked that its ERD §2 table:
  - is named in `erd.md`;
  - exists after migrations `0001`–`0060`;
  - has exactly one primary key;
  - has its owner/scoping column and its status column, where applicable.

  Result: 6/6 (`03-integration-r1-probes-run2.log`).
- **P2, REQ-S12-005 with two KPI owners.** The worker's own test has one owner. Here, owner 1 owns 2 KPIs and owner 2 owns 1, and a second organization also has a KPI and a due period.
  - The period opens once and creates exactly 3 tasks, one per (KPI, owner).
  - Nobody else gets a task, and nothing is created for the other organization.
  - A re-run creates nothing.
- **P3, REQ-S13-001's "no total … contains a Y figure".** The candidate's tests look for Y ids and distinctive Y numbers, but a Y amount folded into an X total would not show up that way. So I compared figures: what a user granted at X only sees on the Executive Overview, Finance and Adoption dashboards equals, figure for figure, the organization-wide auditor's view filtered to X. As a sanity check, the auditor's unfiltered view differs. 3/3.
- **The e2e sweep: the auditor (AUD) and the Lead (TL) on 59 P4 routes in both languages.**
  - The 59 routes: 43 transformation routes, the seeded forum's detail page, and 15 organization routes.
  - Auditor checks: `<html lang dir>`; axe with 0 serious or critical issues; no write request sent.
  - Both the auditor and the Lead: no page-level horizontal scroll at 390 px or at 200 % text.
  - All green in revision 2 (C.UTF-8) and revision 3 (solo, locale unset).

## Acceptance texts tested literally: judgement of the register's partial-coverage notes

- **Acceptable as disclosed:**
  - **REQ-PB-066 and REQ-S15-008:** the API clock cannot be set. The "raised Thursday" and "23:30 Riyadh" examples are proven through the calendar engine, `p4_business_date` and an independent `Intl` oracle. The business date is computed from the database's `now()` in the organization's timezone, so the boundary proof is the right one.
  - **REQ-PB-065, REQ-S04-014 and REQ-S07-015:** API integration plus jsdom web tests. These clauses are server behaviour or previews, and their integration tests ran green twice.
  - **REQ-S04-010:** the refusal is 409, not 422. The clause only asks for a refusal.
  - **REQ-S08-006:** "rates" are formula variables, with no FX entity.
  - **REQ-S07-005:** the negative-baseline flag is tested at unit level only.
  - **REQ-S20-005:** "stale" is covered by the KPI status tests.
  - **REQ-S20-011:** there is no root A11 e2e. The screens are covered by `p4-adoption-bau` and `p4-gates-closure`, 8/8 and 9/9 per project.
  - **The REQ-S16 ERD halves:** now independently confirmed by P1.
- **Not acceptable as written:** REQ-PB-010 and REQ-S03-004 (F-DG4-140). Their notes still claim gaps that the candidate's QA-D tests close (2/2 and 1/1, green).
- **Observation:** REQ-PB-009's UI label "Delivered — value validation pending" is asserted on screen only by the jsdom test `closure.test.tsx`. The real-stack `p4-gates-closure` spec shows the "In delivery" label. The server label is proven by `a11-value-closure`, and the UI mapping by the jsdom test, so I accept this and raise no finding.

## Environmental residuals

These are not BLOCKED. I checked each one on its offline/config surface:

- live registry (REQ-DLV-042 AC-1, D-057);
- live CI (REQ-DLV-025 A24, D-058);
- Keycloak (D-049).

The e2e runs use dev authentication, `AUTH_MODE=dev`.
