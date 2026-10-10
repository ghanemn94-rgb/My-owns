# Handback: T-DG4-QA-A, executable acceptance suites A04, A05 and A10 (qa-verifier, authoring)

- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-QA-A-qa-verifier-20261010T055115Z-e127c811","session_id":"e127c811-9e08-45c5-adcc-643366a705c0"}`
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-QA-A.md`, sha256 `901bccd6…af99e1` (verified before starting).
- **Tree:** worktree `/home/user/wt/dg4-qa-a`, branch `dg4/qa-a`, HEAD `8db6679bf3ba18d8de0ad8009de2f01d4ec40461`. The tree was clean apart from the sandbox's placeholder dotfiles, which I left untouched.
- **Time:** started 2026-10-10 05:51:28 UTC, ended 06:38:25 UTC.
- **Kind of task:** this was authoring, not a gate review. It grants no DG4 verdict, and it is not the independent DG4 QA review.
- **Approvals:** none was granted. Every Finance, Sponsor or trajectory approval in a fixture is a synthetic in-product approval of synthetic test data.

## 1. Changed files

All files are **uncommitted**, ready for the orchestrator to integrate.

| File | Purpose |
|---|---|
| `tests/qa/support/p4.ts` | New support module, setup only. It re-exports the backend's P4 integration fixtures (worlds, periods, KPIs, benefits, execution) and adds `canon` (decimal-string canonicaliser, no floats), `SIX_ACCEPTED`, `expectCode`, `get200`, `waitFor`, `ifMatch` and `asBenefitWorld`. `api.ts` and `with-pg.sh` are unchanged. |
| `tests/qa/integration/a04-kpi-propagation.test.ts` | A04, end to end. Runs the real API, a real worker (`startWorker`: outbox relay, pg-boss and every production domain handler) and real PostgreSQL, on its own freshly migrated scratch database. 8 tests. |
| `tests/qa/integration/a05-calculation-correctness.test.ts` | A05, black-box through the API. 17 tests. |
| `tests/qa/integration/a10-benefit-integrity.test.ts` | A10, black-box through the API. 16 tests. |
| `tests/qa/unit/a05-calc-units.test.ts` | A05 rows whose text says "unit tests", plus the pure display, period, critical-path (CPM) and business-date rules, through the public `calc.ts` and `time` entry points. 15 tests. |
| `e2e/a04-kpi-update.spec.ts` | REQ-S07-017 on the real stack, in chromium-en and chromium-ar. A keyboard-only update in four steps; the confirmation lists the dashboards and 'Finance review pending'; axe reports 0 serious or critical issues. |
| `docs/delivery/test-evidence/DG4/qa/T-DG4-QA-A-authoring/**` | This handback, the logs (`logs/`, ANSI and `$TMPDIR` paths stripped, no secrets), the mutation runner (`logs/mutate.py`) and the EN/AR screenshots (`screenshots/{en,ar}/`). |

**Disclosure on fixtures.** The suites build their synthetic worlds with the backend's own integration fixtures (`apps/api/test/integration/**` and `apps/api/test/support/harness.ts`). Some of those write initiatives, outcomes, outcome KPIs, workstreams, dependencies and milestones directly, with their audit events, because those routes belong to other modules. Every **assertion** is derived from the acceptance texts, the requirement rows and `docs/api/openapi.yaml`. No assertion reuses a backend expectation. Every request made through `call` is validated against the OpenAPI contract by the harness.

Root-level tests cannot resolve the bare `@mth/*` specifiers (the root `package.json` declares no such dependency). They therefore import `packages/*/src` by relative path.

## 2. What each suite asserts (behaviour per requirement)

### A04: KPI propagation (`a04-kpi-propagation.test.ts`, real worker)

Fixture world:
- **Transformation X:** a KPI with an approved trajectory, linked to an outcome (outcome KPI) and to a benefit at Measure that requires Finance validation. The benefit uses the B0087 formula with `eligible_customers` bound to the KPI.
- **Transformation Y:** in the same organization, with its own KPI actual, benefit and workstream.

Cases:
1. **REQ-S07-017 and REQ-S07-013.** The direct-accept submission returns `accepted`, `reviewPending=false` and `financeReview="pending"`. The downstream list includes the benefit (by id) and a dashboard or Executive Overview item. The actual has exactly 1 audit event.
2. **REQ-S07-013 and REQ-S12-006.** The live worker produces exactly 1 completed `actual_accepted` calculation run, 1 pending benefit value for that run and 1 queued Finance item. Once every outbox row is published and the pg-boss queues are drained, the counts are still 1 / 1 / 1 and the audit count is still 1.
3. **REQ-S03-009 and REQ-S13-003.** The Executive Overview Outcomes area shows 100000 on exactly one item (the outcome KPI). The `outcomes.kpi_status` drill-down lists exactly that `kpi_actual`. The transformation dashboard shows the value once. The KPI panel's `calculationRunId` is that run.
4. **REQ-S07-014.** The benefit's `submitted` series is 100000 SAR, computed as (0.12 − 0.10) × 100000 × 50. `validated` stays 0, the transformation's validated total is unchanged, and the Finance dashboard shows at least one pending validation.
5. **REQ-S07-012.** On the review route the submission is `submitted` with `reviewPending=true`. After the worker is idle there is no run, and the status is Unknown with a null actual. After the reviewer accepts, there is exactly 1 run and the status shows `42 / ok`.
6. **REQ-S13-003 and REQ-S07-006.** An outcome KPI with no actual is `unknown` with a null value (never 0), on the overview and in its drill-down.
7. **REQ-S13-001.** A user granted BO on X only opens all six dashboards: Executive Overview (including every headline drill-down), the transformation dashboard, the workstream dashboard, Finance, Adoption and My Work. None of them contains any Y id or code (transformation, outcome, KPI, outcome KPI, actual, benefit, initiative, workstream). Y's transformation and workstream dashboards return 404.
8. **REQ-S13-002.** With `periodId` = 2026-Q1, all six areas differ from the unfiltered view, and each shows its Q1 figure:
   - Outcomes: 150 (unfiltered: 50).
   - Adoption: 140 (unfiltered: 60).
   - Planned value: 1000 (unfiltered: 3000).
   - Dependencies: 1 (unfiltered: 2).
   - Decisions: 1 (unfiltered: 2).
   - The milestone flag is `milestone_green` (unfiltered: `milestone_red`).

   `appliedFilters` echoes the window. The transformation and Finance dashboards apply the same filter.

### A05: calculation correctness (API `a05-…test.ts` plus unit `a05-calc-units.test.ts`)

- **REQ-S07-007:**
  - API: on the current reporting period, actual 80 against an expected 100 is Red. A new threshold version (amber 0.25, red 0.30) produces exactly one `threshold_changed` run, and the RAG turns green.
- **REQ-S07-002:**
  - API: lower-is-better 80 against 90 is green; higher-is-better 80 against 90 is amber or red; band 5–10 with 12 is not green.
  - Unit: adverse, favourable and outside (`above`); a milestone not achieved by its due date is adverse; a missing actual is Unknown.
- **REQ-S07-004:**
  - API: a percentage KPI going 0.10 → 0.12 has variance 0.02 (a fraction), `changeLabel` `pp` and varianceRatio 0.2. The cumulative evaluation equals the sum of the period flows (10.5 + 15.25 = 25.75, from the calculation run's evaluations).
  - Unit: `+2.0 pp` and `+20%`; YTD of 10.1 + 20.2 + 30.3 = 60.6.
- **REQ-S07-005:**
  - API: `saved / handled` with a zero denominator gives a null result with `formula.division_by_zero`. A ratio KPI entry of 0/0 is either refused (422) or stored with a non-ok, null actual.
  - Unit: a zero base is Not computable (null and never `0%`); a negative baseline is flagged; 4 weeks against 5 weeks is `{comparable:false, reason:"week_count"}`.
- **REQ-S07-006:** no actual means Unknown in the panel and in the list. A scope that reported before but is missing now makes the roll-up Unknown, not a sum with 0.
- **REQ-S07-010:**
  - API: 1/10 and 9/10 roll up to 0.5. A **discriminating** case, 1/10 and 80/90, rolls up to 0.81 (the mean of percentages would be 0.494). An actual in USD on a SAR KPI is 422 `kpi_actual.currency_mismatch`, and SAR + USD in a formula is 422.
  - Unit: the same two cases through `rollUp`; SAR + USD gives `kpi.aggregation_unit_mismatch`.
- **REQ-S07-011:** KPI A = B + 1 is active, so B = A × 2 is 422 `kpi_formula.circular`. SAR + count is 422.
- **REQ-S08-004:**
  - API: 8 payloads (`eval`, `Function`, `constructor.constructor`, `require`, statement injection, arrow IIFE, `fetch`, template literal) are each 422 with a `formula.*` code. A whitelisted expression is evaluated.
  - Unit: the engine's sources (comments stripped) contain no `eval(` or `Function(`.
- **REQ-S08-006:** a pending benefit value created from an accepted KPI actual references the formula version and its input (`kpiActualId`, `kpiValueNo` 1, value 100000), and its amount is 100000. After a formula version 2 is created, the old value still references version 1.
- **REQ-S16-025:**
  - API: 0.1 + 0.2 SAR = 0.3, and 100000 × 0.02 × 50 = 100000 SAR. A **discriminating** probe, 900719925474099.1 + 0.2, gives exactly ...099.3 (a float sum gives ...099.25). Two Finance-approved values of 0.1 and 0.2 SAR give a validated total of `0.30…`.
  - Unit: the same, through `evaluateFormula`.
- **REQ-S09-007:** budget lines in decimal SAR (0.1 + 0.2 budget, 0.05 + 0.25 actual, 0.15 + 0.15 forecast) total 0.3 / 0.3 / 0.3. A milestone approved for Thursday 2041-01-03 and forecast for Thursday 2041-01-17 shows `calendarVarianceDays` 14 and `slipWorkingDays` `{known, 10}` on a Sunday–Thursday calendar.
- **REQ-S09-009:**
  - API: network A(3)→B(7)→D(2) and A→C(4)→D. With D's duration missing, the result is `not_computable`/`missing_durations`, lists D, has no critical node and no path. With D = 2, the result is `computed` with P = 12, path `[A,B,D]`, and C non-critical with float 3.
  - Unit: the same, through `computeCriticalPath`.
- **REQ-S15-008:** an actual for 2026-10 keeps label and start/end 2026-10. `enteredAt` is UTC, and `businessDate` = `businessDateOf(enteredAt, Asia/Riyadh)`. The row's example (23:30 Riyadh on 2026-11-02 = 20:30Z) gives 2026-11-02 through the database's `p4_business_date` and through the library; 21:30Z gives 2026-11-03.

### A10: benefit integrity (`a10-benefit-integrity.test.ts`)

- **REQ-PB-058:**
  - Two owners (as a list in `ownerUserId`, and as an extra `ownerUserIds`) are 400, and no row is written.
  - A 10 M SAR benefit allocated 50 / 50 to two initiatives appears once in the totals (planned 10000000, count 1) and once on the organization-level Finance dashboard.
  - Two records in a shared-benefit group never add up to 20 M. Once the counted member is named they count 10 M, with the other excluded as `group_member_not_counted`.
- **REQ-S08-013:** 0.6 + 0.5 is 422 `benefit_allocation.over_100`, and the set is unchanged. 0.6 + 0.3 is saved, with allocated 0.9 and unallocated 0.1.
- **REQ-S03-006:** `kpi_benefit` trace links (outcome KPI → benefit) of 0.6 + 0.5 are 422 `trace_link.allocation_exceeds_total`, leaving 0.4 unallocated. 0.6 + 0.4 is accepted, leaving 0 unallocated.
- **REQ-PB-075 and REQ-S08-016:** a submitted 250000.10 shows as `submitted` and the validated total stays 0. Finance approves 240000.05, and the validated total becomes exactly 240000.05.
- **REQ-S08-001:** a forecast of 500000 appears in the forecast line and never in validated. A Finance-rejected measurement is kept: the rejected series is 70000 with count 1, and the measurement is still readable.
- **REQ-S08-018:** an upside scenario value of 900000 changes no measured, validated, submitted or sustained figure.
- **REQ-PB-076:** a CX benefit with Value n/a leaves every SAR figure byte-identical, increments `nonFinancialCount` and adds no `non_financial_valued` line.
- **REQ-S08-010:** a SAR value on a CX benefit without a method is 422 (`benefit.valuation_method_required` or `…_not_approved`). With a proposed, unapproved method it is 422 `benefit.valuation_method_not_approved`. Once Finance approves the method it is 201.
- **REQ-S08-009:** revenue uplift (300) and margin (70) are separate lines in the totals and on the Finance dashboard. Avoided cost (45) is its own line, and cash saving stays 0.
- **REQ-S08-011:** a 1 000 000 SAR capex line on an initiative case gives gross 3 000 000, cost 1 000 000 and net 2 000 000. Net was 3 000 000 before the line, so it dropped by exactly 1 M, not 2 M.
- **REQ-S08-014:**
  - Two benefits with the same driver and population get an **open overlap warning raised by the system**.
  - Both Finance-approved values (100000 and 200000) are excluded from validated (0) and appear in `pendingOverlap` (300000).
  - BO's resolve attempt is 403. Finance's `no_economic_overlap` resolution brings the validated total to 300000.
- **REQ-S08-015 and REQ-PB-013:**
  - Submitting without a measurement period is 422 `benefit_measurement.period_required`.
  - A decision without the `measurementPeriod` item is 422.
  - BO and the auditor get 403, and the total is unchanged.
  - Finance's approval succeeds, the audit event on the queue item carries the FIN user as actor (and never BO), and the total becomes 1000.
- **REQ-S08-017:** a PATCH of a validated measurement is 409 `benefit_measurement.validated_immutable`. A reversal (201) nets the validated total to 0. Both the original `validation` and the `reversal` stay listed, and the reversal's `correctsValidationId` is the original.
- **REQ-S12-014:** before delivery there is no item. The first delivery is `done`. Replaying the same event, under the same job id and under another, is `duplicate` both times. Exactly one queued `validation` item exists and is listed by the queue API.

### e2e: `e2e/a04-kpi-update.spec.ts` (REQ-S07-017, A20 aspects)

All fixtures are created through the public API by the seeded dev users and fresh synthetic users. The KPI owner's stored preference is set to the project's language. The test then:
1. signs the owner in through the dev form;
2. checks `<html lang dir>` (en/ltr or ar/rtl);
3. checks exactly four `fieldset[data-step]` steps, each with a legend;
4. runs axe on the form: 0 serious or critical issues;
5. drives the update **keyboard only** (Tab to the period, ArrowDown, type 100000, Tab to the evidence, Space, Tab to submit, Enter);
6. checks the confirmation: `data-finance-review="pending"`, with the text "Finance review pending" (EN) or "مراجعة المالية قيد الانتظار" (AR, from the shipped catalogue), a dashboard or Executive Overview item and exactly one benefit item;
7. runs axe on the confirmation: 0 serious or critical issues;
8. reads through the API that the period has one slot, `accepted`, with one value of 100000.

## 3. Requirement → test table

| Requirement | Test that proves it | Status |
|---|---|---|
| REQ-S07-013 | `a04…` "REQ-S07-017, REQ-S07-013: …one audit event" and "REQ-S07-013, REQ-S12-006: the worker makes exactly one calculation run…" | Covered |
| REQ-S12-006 | `a04…` "REQ-S07-013, REQ-S12-006: …one pending benefit value with one queue item" | Covered |
| REQ-S03-009 | `a04…` "REQ-S03-009, REQ-S13-003: the overview's Outcomes area shows the new actual once…" | Covered |
| REQ-S13-003 | `a04…` (same case), plus "REQ-S13-003, REQ-S07-006: a KPI with no actual shows Unknown…" | Covered. The validated-total → benefit-records drill-down is not separately asserted. |
| REQ-S07-014 | `a04…` "REQ-S07-014: the linked benefit shows a pending amount…" | Covered |
| REQ-S07-012 | `a04…` "REQ-S07-012: with review configured…" | Covered (the review route). The direct-accept "used immediately" side is proven by the first two A04 cases. |
| REQ-S07-006 | `a04…` Unknown case; `a05…` "REQ-S07-006: a KPI with no actual…" and "…a roll-up with a scope … missing now is Unknown" | Covered |
| REQ-S13-001 | `a04…` "REQ-S13-001: a user scoped to transformation X sees nothing of Y on any of the six dashboards" | Covered |
| REQ-S13-002 | `a04…` "REQ-S13-002: a Q1 filter changes every tile to Q1 values" | Covered |
| REQ-S07-017 | `e2e/a04-kpi-update.spec.ts` (chromium-en and chromium-ar); API side in `a04…` first case | Covered |
| REQ-S07-002 | `a05-calc-units…` "REQ-S07-002 …" (4 unit tests); `a05…` two API cases | Covered |
| REQ-S07-004 | `a05-calc-units…` "+2.0 pp and +20%" and YTD; `a05…` pp label and YTD-from-run cases | Covered |
| REQ-S07-005 | `a05…` zero-denominator case; `a05-calc-units…` zero base, negative baseline, 4 vs 5 weeks | Covered. The 4 vs 5 weeks and negative-baseline checks are unit-level only. |
| REQ-S07-007 | `a05…` "REQ-S07-007: actual below the red threshold … Red; a new threshold version recomputes RAG" | **Partial.** "With all tasks complete" is not exercised: no task or action is completed in the fixture. ADR-0028 says the evaluator reads no task status. |
| REQ-S07-010 | `a05…` weighted-ratio case (with the discriminating 80/90) and the SAR + USD case; unit `rollUp` cases | Covered |
| REQ-S07-011 | `a05…` "REQ-S07-011: KPI A = B + 1 and B = A * 2 is rejected as circular; adding SAR to a count is rejected" | Covered |
| REQ-S08-004 | `a05…` "REQ-S08-004: …rejected at parse time"; unit "no eval or Function constructor" | Covered |
| REQ-S08-006 | `a05…` "REQ-S08-006: a benefit value drills to the formula version and input actual versions…" | Covered (formula version, input actual and value version, period). Rates appear as the formula's variables; no separate FX "rates" entity was exercised. |
| REQ-S16-025 | `a05…` "REQ-S16-025 …" (API and stored totals); unit decimal cases | Covered |
| REQ-S09-007 | `a05…` "REQ-S09-007: budget/actual/forecast use decimal SAR; … working days" | Covered |
| REQ-S09-009 | `a05…` "REQ-S09-009: the fixture network's critical path…"; unit CPM case | Covered |
| REQ-S15-008 | `a05…` "REQ-S15-008 …"; unit business-date case | **Partial.** The API cannot inject the server clock, so the 2026-11-02 23:30 example is proven through the database's `p4_business_date` and `businessDateOf`. The API-stored `businessDate` is checked against `enteredAt` for "now". "Changing the default currency affects only new records" is the A09 part and was not asked for here. |
| REQ-PB-058 | `a10…` three REQ-PB-058 cases | Covered |
| REQ-S08-013 | `a10…` "REQ-S08-013: allocations 60% + 50% are rejected; 60% + 30% … 10% unallocated" | Covered |
| REQ-S03-006 | `a10…` "REQ-S03-006: an allocation link set totalling 110% into one benefit is rejected" | Covered (the A10 part only; the A01 parts were not asked for) |
| REQ-PB-075 | `a10…` "REQ-PB-075, REQ-S08-016 …" | Covered for the pending/validated part. "T14 persists all 10 columns" was not asked for and is NOT COVERED here. |
| REQ-S08-016 | (same case) | Covered |
| REQ-S08-001 | `a10…` "REQ-S08-001: a forecast amount never appears in the validated total; a rejected measurement is kept…" | Covered |
| REQ-S08-018 | `a10…` "REQ-S08-018: upside scenario values never appear…" | Covered |
| REQ-PB-076 | `a10…` "REQ-PB-076: a CX benefit with Value n/a…" | Covered |
| REQ-S08-010 | `a10…` "REQ-S08-010: a SAR value on a CX benefit without an approved valuation method is rejected" | Covered. The first refusal accepts either of two documented codes. |
| REQ-S08-009 | `a10…` "REQ-S08-009: revenue uplift and margin are separate … avoided cost is not cash saving" | Covered |
| REQ-S08-011 | `a10…` "REQ-S08-011: a 1 million SAR initiative cost reduces transformation net value by exactly 1 million" | Covered |
| REQ-S08-014 | `a10…` "REQ-S08-014: …raise a warning and stay out of validated totals until Finance resolves" | Covered |
| REQ-S08-015 | `a10…` "REQ-S08-015, REQ-PB-013 …" | Covered for "lacking a measurement period" and "non-Finance 403". The per-item refusal asserts status 422 only, not the exact code. |
| REQ-PB-013 | (same case) | Covered |
| REQ-S08-017 | `a10…` "REQ-S08-017: an in-place edit of a validated value is 409; a reversal nets the total…" | Covered |
| REQ-S12-014 | `a10…` "REQ-S12-014: …exactly one Finance queue item; replaying the event creates none" | Covered. The replay goes to the consumer function with the relay's envelope; the full relay and pg-boss path for a queue item is proven in A04. |

## 4. Checks run (real exit codes)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline; PostgreSQL 16.13 from `with-pg.sh`/`with-stack.sh`; Chromium from `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`. Ports were 25650–25699 only. Disk was checked before each full run (7.9 G free).

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG3` (start, 05:51) | 0 | `PASS gate DG3 (historical)` | console |
| 2 | **Exact acceptance command:** `QA_PG_PORT=25650 MTH_PORT_POOL=25651-25699 tests/qa/support/with-pg.sh pnpm vitest run --project integration tests/qa` | **1** | **BLOCKED in this sandbox, before any test ran:** Vite's default config loader does `mkdir node_modules/.vite-temp`, and `node_modules` is not writable here (`ENOENT … .vite-temp`). This is an environment limitation, not a test result. | `logs/accept1-exact.log` |
| 3 | Same command plus `--configLoader runner` (config loaded in-process, nothing written to `node_modules`), final run | **0** | 6 files, **65 passed**: a10 16, a05 17, a04 8, a12 14, a13 5, a14 5 | `logs/accept1-runner-final.log` (an earlier identical pass is `accept1-runner.log`) |
| 4 | `pnpm vitest run --configLoader runner --project unit-node tests/qa/unit` | 0 | 1 file, **15 passed** | `logs/unit-final.log` |
| 5 | `apps/web/e2e/support/with-stack.sh npx playwright test e2e/a04-kpi-update.spec.ts --workers=1 --reporter=list --output=$TMPDIR/pw-out` (`E2E_PG_PORT=25660`, `E2E_API_PORT=25661`, pool 25662–25699) | 0 | **2 passed**: chromium-en and chromium-ar; axe 0 serious/critical on 2 screens × 2 languages | `logs/e2e-final2.log`, then a confirming rerun `logs/e2e-final3.log` (exit 0, 2 passed) |
| 6 | `pnpm lint` (`eslint . --max-warnings=0`) | 0 | clean | `logs/pnpm-lint-final.log` |
| 7 | `npx eslint --max-warnings=0 <my 6 files>` | 0 | clean | `logs/eslint-files.log` |
| 8 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `logs/prettier-all-final.log` |
| 9 | `npx tsc -p $TMPDIR/tsconfig.qa.json` (ad-hoc strict type-check of my 5 test files with `tsconfig.base.json`; no repository typecheck covers `tests/qa` or `e2e`) | 0 | 0 errors after fixes (the first run found 9 errors in my files, all fixed) | `logs/tsc-qa.log`, `logs/tsc-qa-final.log` |
| 10 | Mutation checks (section 6) | see below | 9 mutants run, 8 killed, 1 equivalent (explained) | `logs/mutations.log`, `logs/mutations-round2.log` |
| 11 | `node tools/gates/validate.mjs --historical --stage DG3` (end, 06:38) | 0 | `PASS gate DG3 (historical)` | console |

**Non-zero exits and failures during authoring.** Every one was a defect in my tests, fixed before the final runs. None was a product defect.

| Log | Exit | What failed | Fix |
|---|---|---|---|
| `a10-run1.log` | 1 | 5 of 16. I used plan dates outside the dashboards' "to date" window, the enum `non_financial_valued` on create (the contract's create enum is `non_financial`), and a KPI definition as a `kpi_benefit` source (the contract says outcome KPI). I also assumed the overlap had to be raised manually; the system had already raised it. | `a10-run2.log`: 16/16 |
| `a05-run1.log` | 1 | 7 of 17. My `dataAsOf` was stale, so the product correctly showed Stale. KPI polarity must match the measure type (`kpi_version.measure_mismatch`). Other causes: a list query parameter not in the contract, count/count kinds, a missing formula `If-Match`, and an initiative code pattern. | `a05-run2.log`: 1 left |
| `a05-run2.log` | 1 | REQ-S07-007 probed January. ADR-0027 §8 and ADR-0028 §5 say a threshold change re-evaluates the **current** period. | Now uses the period containing today. `a05-run3.log`: 17/17 |
| `a04-run1.log` | 1 | 1 test hit the 30 s timeout: my `settled()` helper required at least one outbox row, and the review-route submission writes none. | `a04-run2.log`: 8/8 |
| `e2e-run1.log`, `e2e-run2.log` | 1 | Setup only: `If-Match` for preferences (the user version), and the formula-version `If-Match`. | `e2e-run3.log`: 2/2 |
| `e2e-final.log` | 1 | **Flaky test, my bug:** chromium-ar landed on `/login`. The spec navigated before the dev sign-in had completed; it waited for a `main` landmark, which the login page also has. chromium-en passed in the same run. | Now waits for the 204 `dev-login` response and for the URL to leave `/login`. Re-run alone with both projects: `e2e-final2.log` 2/2, then `e2e-final3.log` 2/2. |
| baseline in `mutations.log` (first attempt, overwritten) | 1 | Ordering dependency: the A04 S07-014 case, when run alone with `-t`, did not wait for the worker. | It now waits for the pending value itself. Baselines after the fix are green. |

## 5. Product defects found

**None.** No suite exposed a product defect. Every failure in section 4 was traced to my own test and fixed without working around product behaviour.

Observations for the reviewers. None is a finding, and I filed none:
1. **REQ-S07-010.** The acceptance example cannot detect a mean-of-ratios bug: 1/10 and 9/10 give 0.5 under both rules. The suites add 1/10 and 80/90 (weighted 0.81, mean 0.494). The mutant replacing the weighted ratio by a mean is killed only because of this case.
2. **REQ-S16-025.** The 0.1 + 0.2 example cannot detect binary-float addition once results are rounded at money scale: the float mutant survived the row's own example. The suites add 900719925474099.1 + 0.2 = …099.3, which kills it.
3. **REQ-S07-007.** A new threshold version recomputes the RAG of the KPI's **current** reporting period only (ADR-0027 §8, ADR-0028 §5). A past period keeps the RAG computed with the earlier threshold. This matches the ADR. The domain reviewer may want to confirm that it matches the row's intent ("changing the threshold version recomputes RAG").
4. **REQ-S08-013 defence in depth.** The over-100 % refusal is enforced both in the API (`allocations.ts`) and by the database trigger `benefit_allocation_guard` (migration 0037). Disabling the API check alone still gives 422 with the same code. The test fails only when both layers are disabled.
5. **Vitest config loader.** In this sandbox the documented command needs `--configLoader runner`, because `node_modules` is read-only. Elsewhere, where `node_modules` is writable, the command as written is expected to run unchanged; I did not verify that here.

## 6. Mutation checks

All mutations were applied only to a disposable copy of the tree (`$TMPDIR/mut`, made with `tar`, without `.git`), using the runner `logs/mutate.py`. The runner applies one textual mutation, runs the targeted tests in the copy (`with-pg.sh … vitest run --configLoader runner --project … <file> -t <filter>`) and restores the file. The copy was deleted afterwards. No product file in the worktree was touched. The baselines (unmutated copy) were all green: `BASE-A04` 3 passed, `BASE-A05` 2 passed, `BASE-A10` 3 passed, `BASE-A05-S16-025` 1 passed.

| Id | Scenario | Mutation (copy only) | Targeted test | Result |
|---|---|---|---|---|
| MUT-A04-1 | A04 | `benefits/downstream.ts`: `financeReview` always `not_applicable` | REQ-S07-017 | **Killed** (exit 1, 1 failed) |
| MUT-A04-2 | A04 | `benefits/totals.ts`: the `submitted` state counted as `validated` | REQ-S07-014 | **Killed** (exit 1, 1 failed) |
| MUT-A04-3 | A04 | `reporting/dashboards/filters.ts`: period window ignored (`windowStart/End` null, `asOf` today) | REQ-S13-002 | **Killed** (exit 1, 1 failed) |
| MUT-A05-1 | A05 | `shared/kpi/aggregate.ts`: weighted ratio replaced by the mean of ratios | REQ-S07-010 (API) | **Killed** (exit 1, 1 failed) |
| MUT-A05-2 | A05 | `shared/formula/evaluate.ts`: decimal `+` replaced by float addition | REQ-S16-025 | First round: **survived**, because the row's 0.1 + 0.2 is masked by rounding. After the stronger probe: **killed**, with "expected 900719925474099.4 to be …099.3" (API) and the same in the unit test (MUT-A05-2u). |
| MUT-A10-1 | A10 | `benefits/allocations.ts`: over-100 % API check disabled | REQ-S08-013 | **Equivalent:** survived, because the database trigger still refuses (observation 4) |
| MUT-A10-1b | A10 | Same, plus migration 0037 `IF total > 1` → `IF total > 2` | REQ-S08-013 | **Killed**: "expected 200 to be 422", with an allocated share of 1.1 saved. The migration was restored, and `cmp` confirms it is identical to the worktree. |
| MUT-A10-2 | A10 | `benefits/totals.ts`: `submitted` counted as `validated` | REQ-PB-075/S08-016 | **Killed** (exit 1, 1 failed) |

The runner's own exit was 0 for every row; that is the runner, not the tests. The vitest exit for each mutant is the "exit" value in the logs.

## 7. BLOCKED and not done

- **BLOCKED (environment):** the acceptance command in its exact form exits 1 in this sandbox before running any test (Vite cannot create `node_modules/.vite-temp`). The same command with `--configLoader runner` passes 65/65 (check 3). The orchestrator should run the exact form in an environment where `node_modules` is writable.
- **Partial:**
  - REQ-S07-007: "all tasks complete" is not exercised.
  - REQ-S15-008: the clock-injected example is proven through the database function and the library, not through an API write at that instant.
  - REQ-S13-003: the drill-down of the validated benefit total to its benefit records is not separately asserted.
  - REQ-S08-015: the exact problem code for a decision missing an item is not pinned.
  - REQ-PB-075: "T14 persists all 10 columns" was not asked for and is not covered.
- **Not run:** the frontend's own journeys (`apps/web/e2e/**`), which are not mine, and the backend's integration suites.
- **Lenient assertions, disclosed:**
  - REQ-S07-005: the 0/0 ratio entry accepts either a 422 or a stored non-ok null actual.
  - REQ-S08-010: the first refusal accepts either `benefit.valuation_method_required` or `benefit.valuation_method_not_approved`.
  - REQ-S07-002 (API): adverse is asserted as amber or red.

## 8. Merge instructions

- Integrate the six test files and `tests/qa/support/p4.ts` as they are. No migration, no product change and no dependency change is needed.
- `tests/qa/integration/a04-kpi-propagation.test.ts` creates and drops its own scratch database (`mth_qa_a04…`) and starts its own pg-boss and worker inside it, like `a13-job-idempotency.test.ts`.
- The suites depend on the backend's test fixtures listed in section 1. If those fixtures change signature, `tests/qa/support/p4.ts` is the single place to adapt.
- `e2e/a04-kpi-update.spec.ts` needs a built tree (`apps/api/dist`, `apps/web/dist`) and `with-stack.sh`, like the other root e2e spec. It writes screenshots to `QA_EVIDENCE_DIR` (default `test-results/qa-a04`). If both projects run against one stack, the current month's reporting period is created once and then reused.
- I wrote no delivery record, review, gate file or product source. The runner commits the run evidence.
