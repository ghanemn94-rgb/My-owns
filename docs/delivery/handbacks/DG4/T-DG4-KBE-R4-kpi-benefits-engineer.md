# Handback T-DG4-KBE-R4 (kpi-benefits-engineer): ARCH-R3 K1 (drill-down `valueClass` and three metrics), C5 (`windowValues`), and the D-114 `benefits-queue.test.ts` root cause

- **Stage:** DG4 (BUILDING), worktree `/home/user/wt/dg4-kbe-r4`, branch `dg4/kbe-r4`, base `HEAD` = `48eba105a78c21096a34163ffaf619f3cf6e0132` (D-114; its source equals `0a3da46`). The changes are **uncommitted**, for the orchestrator to integrate.
- **Invocation:** `DG4-T-DG4-KBE-R4-kpi-benefits-engineer-20261010T124146Z-e2907eb5` (session `e2907eb5-fafa-4682-950c-4056ccab8872`). Before starting, I checked the assignment `docs/delivery/assignments/DG4/T-DG4-KBE-R4.md` with `sha256sum`: `b73626874230a588e52f5bbdf8dad0cca8cd600b38b6e3f6c7fe37d0d43ad519`, which matches the hash I was given.
- **Time:** start `Sat Oct 10 12:41:59 UTC 2026`, end `Sat Oct 10 14:05:50 UTC 2026` (`date -u`; `evidence/start-time.txt`, `evidence/end-time.txt`).
- **Preceding gate:** before any edit, `node tools/gates/validate.mjs --historical --stage DG3` printed `PASS gate DG3 (historical)` and exited 0 (`evidence/validate-dg3-historical-start.log`). §3 has the re-run at the end.
- **Two gate systems.** This task writes no DG0–DG7 record other than this handback and its evidence. The Finance validations, Finance rejections, valuation-method approvals and Sustain moves in the test fixtures are synthetic in-product business approvals of test data. They approve nothing real. Product G6 never implies DG7.
- **Ports and disk.** I used ports 26000–26049 only: 26000–26019 for the reproduction run, 26020–26029 for single files, 26030–26039 for the A/B transcripts and 26040–26049 for both final integration runs. `df -h .` showed 16–19 GB free before each full run (`evidence/disk-checks.txt`, `disk-before-integration*.txt`), well above D-104's 3 GB floor.
- **Evidence folder:** `docs/delivery/handbacks/DG4/T-DG4-KBE-R4-evidence/` (written `evidence/` below).

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/dashboards.ts` | K1: `DASHBOARD_METRICS` gains `value.measured`, `value.rejected`, `value.sustained` (appended after the existing 14, so no existing value moves); new `FINANCE_VALUE_CLASSES` / `financeValueClass` (the OpenAPI `FinanceValueClass` mirror); `DASHBOARD_REFUSALS` gains `dashboard.value_class_not_applicable` with the exact K2 text |
| `apps/api/src/modules/reporting/dashboards/finance.ts` | K1 item 3: the one selection rule `lineEntersClassSum` (with `benefitInClass`), now used by `financeClassLines` (same conditions as before, regrouped); `DRILL_METRIC_OF` covers all seven states; `extraStateLinesOf` (the measured, rejected and sustained lines narrowed to the context's benefits) shared with the drill-down; K1 item 5: every class line's `drilldownHref` = its state's metric + `valueClass` (the "whole state's figure" condition is removed; `gross` and `net` untouched) |
| `apps/api/src/modules/reporting/dashboards/drilldown.ts` | K1 items 1–3: `valueClass` in the strict query schema; 422 `dashboard.value_class_not_applicable` at `/valueClass` for any non-value-state metric; `VALUE_STATE_OF` and `SUBJECT_METRICS` gain the three metrics; `valueDrill` selects lines with `lineEntersClassSum` (measured/rejected/sustained lines from `extraStateLinesOf`); `valueClass` enters the cursor's filter hash only when given |
| `apps/api/src/modules/reporting/dashboards/filters.ts` | `drilldownHref` takes an optional `valueClass`, appended last and only when given |
| `apps/worker/src/handlers/kpi.ts` | C5: `windowValuesOf` builds `windowValues: [{reportingPeriodId, kpiActualId, valueNo}]` in window order from the accepted values; added to each cumulative roll-up entry and to the entered cumulative `inputs`, only when the cumulative value is known |
| `apps/worker/test/integration/benefits-queue.test.ts` | D-114 fix: the file runs on its own scratch database (created, migrated with the real runner, dropped in `afterAll`; the `tests/qa` A04 precedent), and asserts before starting the worker that its job is the only one in `benefits.finance_queue`. No timeout changed, nothing skipped |
| `apps/api/src/modules/reporting/dashboards/k1-value-class.test.ts` (new) | Unit: without a class the K1 rule equals the as-built `valueLinesOf` over an exhaustive 56-fact grid × 7 states × 6 period ends × 2 clocks; class semantics; the pure half of the K1 item 4 invariant over a 42-line worked fixture |
| `apps/api/test/integration/reporting/finance-drilldown-k1.test.ts` (new) | Integration: the K1 item 4 invariant over all 42 class lines through HTTP, every page; the hrefs; the refusal and 400; the three metrics; Unknown-never-0; the scope sweep |
| `apps/api/test/integration/kpi-p4/cumulative-lineage.test.ts` (new) | Integration: the C5 tests (missing-scope rule pinned, `windowValues` on roll-up and entered shapes, none when Unknown, period shapes unchanged) |
| `apps/api/test/integration/reporting/finance-adoption.test.ts` | One assertion that pinned the very case K1 changes: KBE-G2's "a `measured` class line has no href" becomes "it drills to `value.measured&valueClass=revenue_uplift` and sums to 1150"; net still `null` |
| `apps/api/test/integration/kpi-p4/formula-recalc.test.ts` | One assertion that pinned the very case C5 changes: KBE-R1's exact stored cumulative row of B (a known value over a one-period window) now includes `windowValues: [{reportingPeriodId, kpiActualId, valueNo}]`; B's period row and every other assertion are unchanged (found by integration run 1, §3) |
| `apps/api/test/integration/contract/p4-exercises-kbe-g.ts` | Two calls through the validating client: `value.sustained` + `valueClass` (200, validated against the OpenAPI response and the zod mirror) and the 422 `dashboard.value_class_not_applicable` |
| `docs/delivery/handbacks/DG4/T-DG4-KBE-R4-kpi-benefits-engineer.md`, `…/T-DG4-KBE-R4-evidence/**` | This handback, logs, the D-114 reproduction and diagnostics, the A/B transcripts and their comparison |

No migration, no contract change (`docs/api/openapi.yaml` untouched; ARCH-R3 already declared everything used here), no `server.ts` or route-list change.

## 2. Behaviour delivered, per requirement row

### REQ-S13-003 — acceptance: "A04;A05: the validated benefit total drills to its benefit records; a KPI with no data shows Unknown, not 0"

ADR-0037 amendment K1 makes every Finance class line one of these drillable numbers (M0244):

- **Parameter and refusal (K1 item 1, K2).** `GET /api/v1/dashboard-drilldown` accepts `valueClass` ∈ `revenue_uplift | margin_uplift | cash_saving | avoided_cost | working_capital_release | non_financial_valued`. With any metric other than the seven value-state metrics it answers 422 `dashboard.value_class_not_applicable` at `/valueClass`, with the exact text "A value class narrows only a drill-down of benefit values by state." A value outside the enum (`gross`, `net`, `non_financial`, upper case) is 400 `validation` (tests: `finance-drilldown-k1.test.ts` "K1 items 1-2").
- **Three metrics (K1 item 2).** `value.measured`, `value.rejected`, `value.sustained`: one item per benefit, its lines of the state summed; `ruleKey` `dashboard.value.sum_<state>`; `inputs` one `total_<currency>` per currency; a benefit `subjectId` is accepted (tests "the three metrics take a benefit subjectId", "… sum the five financial classes"). No headline uses them.
- **Selection (K1 item 3), by construction.** `lineEntersClassSum(b, line, state, valueClass, clock)` is the one rule for both the Finance class lines and the drill-downs: `financeClassOf(b)` not null and equal to `valueClass` (or one of the five financial classes when none is given); `line.state === state`; `entersLine` (an open overlap holds back validated and sustained lines); `lineInWindow`. Measured, rejected and sustained lines come from the same `benefit_value_line` rows (`extraStateLinesOf`).
- **The invariant (K1 item 4)**, tested twice:
  - over HTTP, against PostgreSQL: for each of the **42** class lines (5 SAR classes: revenue uplift, margin uplift, cash saving, avoided cost (overlap-held), valued non-financial; 1 USD class; × 7 states), the drill-down at the line's own href, read **page by page with `limit=1`**, has a decimal item sum in the line's currency equal to the line's `total` (or both Unknown). The fixture has values in all seven states, a validated value held back by an open overlap (the line is a known 0 and its drill-down lists nothing), a valued non-financial benefit (planned 125000) and an unvalued one (in no line);
  - as a pure unit test over a worked fixture that adds an Unknown amount (`cash_saving` submitted with no amount: line Unknown, drill sum Unknown), out-of-window plans and a not-counted benefit.
  - **The test can fail:** a mutant `valueDrill` that ignores `valueClass` fails 3 of the 12 integration tests (`evidence/k1-mutation-check.log`).
- **Hrefs (K1 item 5).** Every class line carries `/api/v1/dashboard-drilldown?metric=value.<state>&organizationId=…[&transformationId=…][&…filters]&valueClass=<class>`. The `gross` lines keep their href (no `valueClass`); the `net` lines keep `null`.
- **Unknown, never 0 (ADR-0037 §5).** A class with no counted monetised benefit in scope drills to an empty result labelled `not_applicable` / `dashboard.value.no_financial_benefit`, with no `inputs` and never a 0. An eligible class with nothing in the state is a known `zero` in its own currency with no item, which is exactly what its Finance line shows (ADR-0030 §7 item 7). A missing amount makes the item and the sum Unknown (the unit fixture's `cash_saving` submitted line).

### REQ-S13-001 — acceptance: "A04;A12: a user scoped to transformation X opens each of the six dashboards and no tile, total or drill-down contains a transformation Y record or figure"

The scope sweep over the new surface (`finance-drilldown-k1.test.ts`, REQ-S13-001 block):
- **Y has non-zero, distinctive figures in every new state** (validated/measured 66666.6, rejected 55555.5, sustained 44444.4). The organization-wide auditor sees them in each of `value.measured`, `value.rejected`, `value.sustained`, so the sweep can fail.
- **An X-scoped user (FIN and TL at X only):** each of the 7 value-state metrics × (no class + the 6 classes) = 49 drill-downs, and every href of the organization-wide Finance dashboard, answer 200 with no Y id or figure.
- An explicit Y transformation with a `valueClass` is 404; a Y benefit as `subjectId` is 422 `metric_subject_mismatch` and discloses nothing.
- The existing sweeps `scope.test.ts` (KBE-G) and `bu-scope.test.ts` iterate `DASHBOARD_METRICS`, so they now also drill the three new metrics without change, and stay green (§3).

### REQ-S08-006 — acceptance: "A05;A07: a benefit value drills to the formula version, input actual versions and rates used; after a formula change old results keep the old version reference"

ADR-0027 amendment C5, in `apps/worker/src/handlers/kpi.ts` (`cumulative-lineage.test.ts`; worked fixture: a flow KPI summed from business units a1 and a2 over P1, P2 of one YTD window, a1 = 4, 10 and a2 = 6, 20):
- **Missing-scope rule, pinned.** After a1's P2 value only, a2 has an earlier value but no current one. The cumulative transformation evaluation is Unknown `kpi.scope_missing` with `value` null (never the partial 14); `missingScopes` = [a2], `expectedScopes` = both, `entries` lists a1 only. The run's findings are exactly one `scope_missing` on the period basis, none on the cumulative basis.
- **`windowValues`.** Once a2 reports P2, the cumulative roll-up is 40, and each entry is `{scopeId, kpiActualId, valueNo, windowValues: [{reportingPeriodId: P1, …}, {reportingPeriodId: P2, …}]}`. The last element equals the entry's own version. The entered cumulative evaluation of each scope (14 and 26) is `{kpiActualId, valueNo, window: [P1, P2], windowValues: [same two versions]}`.
- **Unknown → no `windowValues`.** A transformation KPI with a P2 value and none for P1 has its cumulative value Unknown (`kpi.cumulative_incomplete`), and `inputs` = `{kpiActualId, valueNo, window: [P1, P2]}` without `windowValues`.
- **Period-basis shapes unchanged:** `{kpiActualId, valueNo}` and `entries` without `windowValues`.
- A formula source on the cumulative basis copies its source slot's `inputs` (C1, `sourceEntry`), so it now carries `windowValues` too. No code was needed for that, and it has no test of its own here; the shape is the entered one tested above.
- C4: nothing relies on member order. The tests compare objects with `toEqual`, and the transcript shows `jsonb` reordering the `windowValues` element members (`valueNo`, `kpiActualId`, `reportingPeriodId`), as C4 says.

### REQ-S12-014 — acceptance: "A10;A13: submitting benefit evidence creates exactly one item in the Finance validation queue; replaying the same event creates no second item"

The D-114 failure of `benefits-queue.test.ts`, the test that proves this row with the production worker, is root-caused and fixed (§4). The test's assertions are unchanged; it gains an isolation precondition.

## 3. Checks actually run (real exit codes; logs in `evidence/`)

| Check | Command | Result |
|---|---|---|
| Preceding gate (start) | `node tools/gates/validate.mjs --historical --stage DG3` | `PASS gate DG3 (historical)`, exit 0 (`validate-dg3-historical-start.log`) |
| Typecheck | `pnpm -r typecheck` | exit 0 (`typecheck.log`) |
| Build | `pnpm -r build` | exit 0 (`build.log`) |
| Lint | `pnpm lint` (`eslint . --max-warnings=0`) | exit 0 (`lint.log`) |
| Format | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 (`format.log`) |
| OpenAPI | `pnpm openapi:lint` | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 652 operations`, exit 0 (`openapi-lint.log`) |
| Unit, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | exit 0. Invocation 1 (unit-node + unit-web): **144 files, 2726 passed** (2719 + the 7 new K1 unit tests). Invocation 2 (unit-formula-nocodegen): **3 files, 259 passed, 2 skipped** (`unit-locale-unset.log`) |
| Unit, `C.UTF-8` | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | exit 0, the same counts: 2726 passed; 259 passed, 2 skipped (`unit-c-utf8.log`) |
| Integration (final) | `QA_PG_PORT=26040 MTH_PORT_POOL=26041-26049 tests/qa/support/with-pg.sh pnpm test:integration` | **exit 0, 192/192 files, 1849/1849 tests** (run 2; 1832 + 12 `finance-drilldown-k1` + 5 `cumulative-lineage`; 190 + 2 files). Port 26040, attempt 1; 13:35:54–14:03:51Z. The two unit runs and the closing typecheck, lint and format check overlapped its second half, and the other W18 agents shared the machine (load average 10–16, recorded in `integration.meta`). No test failed or was retried (`integration.log`, `integration.meta`) |
| Integration (run 1, this tree before the `formula-recalc` update) | the same command, ports 26040–26049 | **exit 1, 1848 passed / 1 failed (1849), 191/192 files.** The one failure was `kpi-p4/formula-recalc.test.ts`, whose KBE-R1 assertion pinned B's stored cumulative `inputs` without `windowValues`, the exact member C5 adds. I updated that assertion (§1); it passed alone at once, and run 2 is the counted run. In run 1 `benefits-queue.test.ts` (2/2), `finance-drilldown-k1` (12/12), `cumulative-lineage` (5/5), `finance-adoption` (9/9), `scope` (3/3), `bu-scope` (4/4) and `contract` (45/45) all passed (`integration-run1.log`) |
| Integration (reproduction, base) | the same command on a disposable copy of `48eba10` with read-only diagnostics in `benefits-queue.test.ts` only, ports 26000–26019 | **exit 1, 1831 passed / 1 failed (1832), 189/190 files**: the D-114 failure reproduced (`d114/integration-before-fix-48eba10.log`). During it I ran single test files on ports 26020–26039, and the other W18 agents shared the machine (load average up to ~12.8, `load-during-integration.txt`); the timing data in §4 is from this run |
| K1 mutation check | `valueDrill` mutated to ignore `valueClass`, `finance-drilldown-k1.test.ts` alone | exit 1, 3 failed / 9 passed, as intended (`k1-mutation-check.log`); source restored |
| A/B byte stability | `ab/kbe-r4-transcript.test.ts` run once on the base copy (A) and once on this tree (B); `python3 ab/compare.py A-transcript.jsonl B-transcript.jsonl` | A exit 0, B exit 0, compare exit 0 (`ab/ab-run-A.log`, `ab/ab-run-B.log`, `ab/compare.txt`); see below |
| Preceding gate (end) | `node tools/gates/validate.mjs --historical --stage DG3` | `PASS gate DG3 (historical)`, exit 0 (`validate-dg3-historical-end.log`) |

Single-file runs during development (not counted above): `finance-drilldown-k1.test.ts` 12/12, `cumulative-lineage.test.ts` 5/5, `benefits-queue.test.ts` 2/2 alone with the fix, the dashboard unit tests 38/38. Their first attempts failed on my own fixture mistakes, all fixed before the counted runs: a 49-vs-42 line count in my unit fixture; `benefitType: "cost"` needed for the cost classes; the `kpi_evaluation` and `data_quality_finding` column names.

**Pinned counts.** No pinned count changes. `contract.test.ts` still has 652 operations and its media-type pin; no operation is routed or added. `DASHBOARD_METRICS` grows from 14 to 17. Its only other consumers are `scope.test.ts` and `bu-scope.test.ts`, which iterate it rather than pinning a number.

**Byte stability (the BE-M2/BE-R3 response-transcript method).**
- **Method.** One fixture, built only with base-commit APIs (the K1 benefit fixture plus a two-period business-unit KPI and a transformation KPI), records these responses:
  - the Finance dashboard (X-scoped, and org-wide for the auditor), the executive overview, X's transformation dashboard and the adoption dashboard;
  - every distinct href they carry, first page (`limit=1`) and second page (cursor);
  - each of the 13 base drill-down metrics org-wide, and the 4 value metrics with a benefit `subjectId`;
  - `getCalculationRun` of all 5 KPI runs.

  Normalization: `response-transcript.ts` (ids, instants, hashes), plus first-appearance placeholders for opaque cursors (they embed a hash over run-specific ids) and for the harness's random `uniq()` fixture codes (`TX…`). The hrefs carrying `valueClass` exist only in B, so they are followed after a separator line, and the common part lines up request for request.
- **Result** (`ab/compare.txt`). Of the **57 common responses, 51 are byte-identical**, including every drill-down (all metrics, both pages, the subject drills), the overview, the transformation and adoption dashboards, and the calculation run of the transformation KPI (its window is incomplete). The other 6 differ **only** in these members (the script asserts that no other member changed):
  - `lines[*].drilldownHref` (84 members, in the 2 Finance dashboard responses). Every changed line is a class line, never `gross` or `net` (asserted). In A these hrefs were `null`, except the 4 USD revenue-uplift lines, which had the "whole state's figure" href without `valueClass`. In B every class line has `…metric=value.<state>…&valueClass=<class>`;
  - `evaluations[*].inputs.windowValues` (4) and `evaluations[*].inputs.entries[*].windowValues` (6), in 4 calculation-run responses: the cumulative entered and roll-up shapes, as C5 adds them.
- **B only:** 72 responses of the new value-class hrefs, all 200.
- **Cursors.** A cursor's bytes cannot be compared across runs (it hashes run-specific ids). By code, `valueClass` enters the hash input only when given (`drilldown.ts`), so the hash input of every request without it is the same object as before. The cursor-paging tests (`drilldown.test.ts`, `finance-adoption.test.ts`) stay green.

## 4. D-114: `benefits-queue.test.ts` root cause (hypothesis confirmed) and fix

**Reproduced.** The full integration suite on a disposable copy of the base (`48eba10` = `0a3da46`'s source; ports 26000–26019, used by no other run) exited 1 with **1831/1832**. The failure was "one queue item; a redelivery and a restarted worker write no second item", `waitFor: timed out` at the queue-item wait, exactly as D-114 reports (`d114/integration-before-fix-48eba10.log`).

**Evidence.** Read-only diagnostics were added to that copy's test file only (`d114/diagnostic-instrumentation.diff`). They query `pgboss.job` and `outbox_event` before the worker starts and at the 15 s timeout. Only to learn when the job would have completed, they keep watching after the timeout, then rethrow the original failure. Output (`d114/diag-before-fix.jsonl`):

| When | `benefits.finance_queue` | This test's job |
|---|---|---|
| worker start (t = 0) | 32 `created`: this test's job + **31 jobs of other files' `benefit.evidence_submitted` events** (32 such events in the shared database) | `created`, **31 jobs ahead** of it (older `created_on`) |
| t = 15.154 s (the 15 s wait expired) | 31 `completed`, 1 `created` | still `created`, 0 ahead |
| t = 15.49 s | 32 `completed` | started 13:00:02.831, completed 13:00:02.859 (**28 ms** of work) |

The same worker also drained 26 `benefits.recalculate_pending` and 21 `benefits.value_decided` jobs of other files, running the production handlers on other files' rows.

**Mechanism (proved).**
1. The integration project runs every file serially against **one** shared per-run database (`vitest.config.ts`: `singleFork`, one `mth_test_*` database).
2. Every relay round (this test's `relayOnce` loop and the worker's own relay) publishes **every** unpublished outbox row in that database, including the events other files wrote and never consumed. No other file runs a worker on the benefits queues, so their jobs wait there.
3. pg-boss consumes oldest first. Its worker loop (pg-boss 11.0.0 `worker.js`, `start()`) waits `interval − duration` after **every** fetch, even when it got a job. With `batchSize: 1` and `jobPollingIntervalSeconds: 0.5` that is at least ~0.5 s per job, measured at **0.489 s**.
4. So the test's wait grows linearly with what other files left behind: 31 × 0.489 s ≈ 15.2 s, past the 15 s `waitFor`. The handler's own work is small (28 ms for this job); the polling delay dominates. That is why the failure does not depend on machine load, which matches D-114's low-load failure, while my reproduction ran under high load.

W17's 51 `tests/qa` tests added such events; with fewer than ~30 ahead the test passed (as at `c441586`, and alone). I did not re-run `c441586`, so its exact count is not measured; the per-job cost and the count at `0a3da46` are.

**Hypothesis: confirmed.** The production worker drains a backlog of other files' jobs on the same queue before this test's job. The backlog is jobs of other files' `benefit.evidence_submitted` events, plus the other two benefits queues.

**Fix: isolate the database state, not the timeout.**
- `benefits-queue.test.ts` now runs on its **own scratch database** of the run's cluster: `createScratchDatabase`, `migrate` with the real runner, `startApi({ database })`, dropped in `afterAll`. This is the precedent of `tests/qa/integration/a04-kpi-propagation.test.ts`, which also starts the production worker.
- Its queues then hold only its own jobs, whatever ran before it and in whatever order.
- It also asserts, before starting the worker, that `benefits.finance_queue` holds exactly one `created`/`retry` job, this test's. A future regression fails there with the cause, not with a timeout.
- No timeout was raised and no test was skipped; both tests' assertions are unchanged.
- **Why this is the outlier:** every other file that starts a production worker already runs on its own database (`workerEnv()` in the 8 other `apps/worker/test/integration` worker files; a scratch database in `tests/qa` A04 and A13). This file alone used the shared run database.

**Shown passing:** alone (2/2), and in the final full integration run (§3, run 2: `benefits-queue.test.ts` 2/2, 5.7 s, and in run 1 as well).

## 5. Operations routed, contract or schema needs, observations for the orchestrator

- **Pending-list delta: none.** This task routes no operation. `getDashboardDrilldown` was already routed (KBE-G), and `valueClass` is a parameter of it. I have no `p4-pending-kbe-r4.ts`, and no pending list changed. `p4-exercises-kbe-g.ts` gains two calls (§1).
- **Contract or schema needs: none blocking.** Two observations for ARCH:
  1. A class with no counted, monetised benefit in scope drills to `not_applicable` with the existing key `dashboard.value.no_financial_benefit` ("Not applicable: there is no financial benefit."). For `valueClass=non_financial_valued` that text is imprecise; the absent class is a valued non-financial one. A dedicated key, e.g. "there is no benefit of this value class", would need an ADR row (S-11), so I did not invent one.
  2. Byte stability keeps one as-built behaviour of the four original value metrics without `valueClass`: with no line in the window, their drill-down `value` is `{state: "zero", value: "0", currency: null}` and `inputs` is `[]`, while the Value headline may say n/a. The new metrics and every `valueClass` request use the eligible benefits' currencies instead, so they answer a labelled n/a or a currency-labelled zero (§2). Changing the four would change existing responses; that is ARCH's call.
- **For FE-R3 item 4** (depends on this task): every Finance class line now has a `drilldownHref` with `valueClass`, and `gross` is unchanged. A net line stays `null` and should show "gross − implementation cost" with links to the gross line and `value.investment` (K1 item 5). Web fixtures (`apps/web/src/pages/dashboards/dashboardFixtures.ts`) that model class lines with `null` hrefs are FE-owned; I did not touch them.

## 6. Known gaps and not done

- **Everything in the repair scope is done:** items 1 (K1 parameter, metrics, selection, hrefs, the invariant test and the scope sweep), 2 (C5 `windowValues` with the C5 tests) and 3 (D-114 root cause, fix, full suite before and after).
- **Not tested on its own:** a formula KPI whose input uses `inputBasis: cumulative`. Its `sources[var].inputs` copies the source slot's entered cumulative shape (C1, unchanged code), so it now carries `windowValues` too. The shape is tested on the entered cumulative evaluation itself (`cumulative-lineage.test.ts`), not through a formula consumer.
- **Not measured:** the backlog count at `c441586` (I did not re-run that commit). The claim "fewer than ~30 jobs ahead" there is an inference from the measured 0.489 s per job and D-114's report that the test passed then.
- **Not run:** the e2e suite. It is not in this assignment's acceptance list. The web is FE-owned; any web fixture or screen that assumes class lines carry `null` hrefs is for FE-R3 (§5).
- **Observations for ARCH** (no change made): the n/a reason key text for an absent `non_financial_valued` class, and the as-built zero-without-currency of the four original value metrics when they have no line (§5).

## 7. Merge instructions

- No migration; apply nothing. No `contract.test.ts` pin change.
- **Conflicts to expect:**
  - `apps/worker/src/handlers/kpi.ts`: three local hunks (helper above `evaluateSlot`, roll-up `entries`, entered `inputs`);
  - `packages/shared/src/schemas/dashboards.ts`: append-only lines;
  - `finance-adoption.test.ts`: one hunk;
  - `p4-exercises-kbe-g.ts`: one appended block after the existing drill-down exercise.
  - None of these files is owned by BE-R4, QA-C or FE-R2 as far as their assignments show.
- `scope.test.ts` and `bu-scope.test.ts` iterate `DASHBOARD_METRICS`, so after the merge they drill the three new metrics too; no edit is needed.
- After the merge, re-run the full integration suite. `benefits-queue.test.ts` must pass there, and it now asserts its isolation precondition.

