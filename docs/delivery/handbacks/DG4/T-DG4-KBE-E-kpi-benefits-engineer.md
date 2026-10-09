# Handback T-DG4-KBE-E: values, measurements, Finance queue and decisions, corrections, totals, worker (kpi-benefits-engineer)

- **Stage:** P4, gate DG4 (BUILDING). Section `docs/architecture/p4-work-split.md` §B.3. Design: ADR-0030 (in full), ADR-0029 §6, §8, §11.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-KBE-E.md` (sha256 `b4da2e65a87eee784198207c9821f3ca1f741f19aaba336e81ec1ca3dedc6f8e`).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-KBE-E-kpi-benefits-engineer-20261009T070221Z-399db36a","session_id":"399db36a-eeae-44a8-9db6-1b4e47b912f3"}`.
- **Working tree:** `/home/user/wt/dg4-kbe-e`, branch `dg4/kbe-e`, base `HEAD` = `588fe12` (D-098). All changes are **uncommitted**, for the orchestrator to integrate.
- **Time:** start `Fri Oct 9 07:02:39 UTC 2026`; end `Fri Oct 9 08:33:16 UTC 2026` (about 91 minutes, inside the 100-minute mark).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` → `PASS gate DG3 (historical)`, exit 0 (run at the start; re-run at the end, §3).
- **Gates:** product gates G1–G6 are business approvals inside the product. Nothing here grants a real business, Finance or IT approval, and nothing reads or writes DG0–DG7 records. Every Finance decision in the tests is made by a synthetic FIN user in a disposable database. All data is synthetic.

## 1. Changed files

### New

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/benefit-values.ts` | zod mirrors of the 16 operations' bodies and responses (BenefitValues, BenefitPlanValue±, BenefitMeasurement±, FinanceValidation±, the six-key `FinanceValidationContent`, BenefitTotals); `missingFinanceItems`/`financeItemsText`; the pure `buildFinanceContent` snapshot builder (strict schema, so the jsonb is validated JSON); the 4 slice B outbox payloads. |
| `apps/api/src/modules/benefits/values.ts` | `getBenefitValues` (7 states apart), `createBenefitPlanValue`, `updateBenefitPlanValue`; shared helpers: the module-local outbox writer `enqueueBenefitEvent`, `enqueueVariance`, `basisOf` (REQ-S08-008), `isUnmonetised`, `money4`/`sumExact`, and `realizedFor(db, benefitIds)` (T14 Realized fields, read from the same view as KBE-D's `realizationFor`). |
| `apps/api/src/modules/benefits/downstream.ts` | Slice A `DownstreamImpactProvider`: `financeReview` = `pending` / `not_applicable`, benefit items `kind: "benefit"`. |
| `apps/api/src/modules/benefits/totals.test.ts` | Unit tests with worked fixtures (D01, D02, B0087 revenue and cost examples, counted once, classes, n/a, overlap, net, corrections, six items, no-eval source scan). |
| `apps/api/test/integration/benefits/value-fixtures.ts` | KBE-E fixtures on top of KBE-D's `fixtures.ts`: B0087 revenue formula (TL creates, FIN validates through DG3), evidence, benefits at Measure with a FIN-validated baseline, in-process handler runs on the outbox envelope. |
| `apps/api/test/integration/benefits/{values,measurements,finance-validation,corrections,totals,entity-group}.test.ts` | Integration tests (each with AUD-403, ADM-only-403, and BO-403 on the Finance endpoints; If-Match 428/409; audit; commit-time authorization). |
| `apps/worker/test/integration/benefits-queue.test.ts` | Relay + production worker: one queue item, redelivery and restart write none; K01 pending value per benefit and run; supersede. |
| `docs/delivery/handbacks/DG4/T-DG4-KBE-E-evidence/*` | Logs of every check in §3. |

### Modified (stubs filled, or lines added)

| File | Change |
|---|---|
| `apps/api/src/modules/benefits/measurements.ts` | Stub filled: list, create (incl. formula evaluation on the unchanged DG3 engine, `benefit_calculation` + `benefit_measurement_input` lineage), get, update (draft only; 409 `validated_immutable`), submit (financeValidationQueue lock, audit, outbox `benefit.evidence_submitted`). |
| `apps/api/src/modules/benefits/finance-validation.ts` | Stub filled: queue list (queued first, oldest first, microsecond keyset cursor), get, decide (six items, SoD, basis, two audit events by the FIN user, task done, outbox), `decideBenefitBaseline`. |
| `apps/api/src/modules/benefits/corrections.ts` | Stub filled: `amendFinanceValidation`, `reverseFinanceValidation` (signed linked rows; pure `amendmentDelta`/`reversalAmount`). |
| `apps/api/src/modules/benefits/totals.ts` | Stub filled: pure `computeTotals` (decimal.js) + `getBenefitTotals` (incl. `?initiativeId=` allocated view) and `getPortfolioBenefitTotals`. |
| `apps/api/src/modules/benefits/routes.ts` | KBE-E's line for `values.ts` (after KBE-D2's lines). |
| `apps/api/src/modules/benefits/index.ts` | Registers the DownstreamImpactProvider in the wiring hook. |
| `apps/api/src/modules/platform/db-errors.ts` | `mapP4BenefitValueError` (ADR-0030 §11 last-line mappings + the `benefit_plan_value_*` ones), called after KBE-D2's mapper. |
| `apps/worker/src/handlers/benefits.ts`, `apps/worker/src/queues/benefits.ts` | Stubs filled: `benefits.finance_queue`, `benefits.recalculate_pending`, `benefits.value_decided` (ack); queue specs and event → queue entries. |
| `apps/api/test/support/p4-pending-kbe-e.ts` | Now empty (all 16 routed). |
| `apps/api/test/integration/contract/p4-exercises-kbe-e.ts` | Stub filled: all 16 operations through `ctx.mirrored`, with zod mirrors. |
| `apps/api/test/integration/contract/contract.test.ts` | Media-type pin `[205, 204, 1]` → `[213, 212, 1]` (assignment-permitted line). |
| `packages/shared/src/schemas/index.ts` | `export * from "./benefit-values.ts"` line. |
| `packages/shared/src/schemas/events.ts` | **Outside my explicit list (disclosed):** 1 import + 4 registry lines for `benefit.evidence_submitted`, `benefit.value_validated`, `benefit.value_rejected`, `benefit.variance_evaluated` (the outbox writer and the relay refuse an unregistered event; KBE-C added its events the same way). |
| `apps/api/test/integration/kpi-p4/actuals.test.ts` | **Outside my list (disclosed):** one assertion `financeReview` `"unknown"` → `"not_applicable"`. Registering the provider is my §B.3 duty (ADR-0030 §6) and ADR-0027 §6 / `kpi/downstream.ts` say "until one is registered, unknown"; the KPI in that test feeds no benefit. |

## 2. Behaviour delivered, per requirement row (acceptance quoted)

| Row | Acceptance (verbatim) | Delivered and proven |
|---|---|---|
| REQ-PB-013 | "a Business Owner calling the validate endpoint receives 403; a Finance user succeeds and the audit event records validator identity" | `decideFinanceValidation` and `decideBenefitBaseline` need `finance.validate` (FIN only): BO, TL, AUD, ADM-only → 403; FIN → 200; `finance_validation.approved` and `benefit_measurement.validated` audit events have `actor_user_id` = the FIN user (`finance-validation.test.ts` first test; baseline test). |
| REQ-S07-014 | "after an accepted KPI actual, the linked benefit shows a pending amount and the validated total is unchanged" | `benefits.recalculate_pending` on `kpi.values_recalculated` of an `actual_accepted` run: one `submitted` measurement (source `kpi_recalculation`, no submitter, `calculation_run_id`), amount from the DG3 engine with the accepted KPI value version bound (lineage row), queue item, `benefit.variance_evaluated`; submitted 100000.0000, validated 0.0000; replay → none; newer value supersedes and withdraws (`benefits-queue.test.ts`). |
| REQ-S08-001 | "a forecast amount never appears in the validated total; a rejected measurement is retained and shown as rejected" | `getBenefitValues` returns the 7 series apart (a 999999 forecast, validated 240000.5000); a rejected value is in `rejected` (300.0000) and the period can be measured again (`values.test.ts`, `finance-validation.test.ts`). |
| REQ-S08-004 | "an expression containing a function call outside the whitelist or a JavaScript payload is rejected at parse time; code review finds no eval/Function use" | Measurements use `evaluateFormula` of `@mth/shared/calc` unchanged (S-9). Since the DG3 API never stores an invalid expression, the test injects versions `eval(1)`, `constructor.constructor('return process')()`, `process.exit(1)` directly and `createBenefitMeasurement` answers 422 `formula.*`, nothing written; a unit source scan finds no `eval(`, `Function(`, `new Function`, `vm.` in the KBE-E sources and the worker handler. |
| REQ-S08-006 | "a benefit value drills to the formula version, input actual versions and rates used; after a formula change old results keep the old version reference" | `getBenefitMeasurement` returns `formulaVersionId`, `benefitCalculationId`, `inputs` (every variable value used, with `kpiActualId`/`kpiValueNo` when bound), assumptions and period; after version 2 is created, the old measurement still references version 1 (100000.0000), a new one version 2 (200000.0000). |
| REQ-S08-008 | "with an unvalidated comparison basis the result is labelled provisional and excluded from validated totals" | `basis: "provisional"` until the baseline (and the formula version used) are FIN-validated; approval refused with 422 `finance_validation.basis_provisional`; after `decideBenefitBaseline` it succeeds. |
| REQ-S08-009 (totals) | "the Finance dashboard shows revenue uplift and margin benefit on separate lines; cost avoidance is not counted in cash savings" | Totals have one line per class × state × currency; revenue vs margin and cash saving vs avoided cost are separate (`totals.test.ts` integration + unit). |
| REQ-S08-011 | "a 1 million SAR cost recorded on an initiative reduces transformation net value by exactly 1 million SAR, not 2 million" | 1000000 cash line on an initiative case: implementationCost 1000000.0000 once; net planned 3000000 − 1000000 = 2000000.0000; a NULL-amount cost line makes cost and net Unknown (`benefit.cost_amount_missing`), never 0. |
| REQ-S08-015 | "a validation lacking a measurement period is rejected; a non-Finance user gets 403" | A decision without `measurementPeriod` → 422 `finance_validation.content_incomplete` "… Missing: measurement period."; BO → 403; the snapshot builder refuses a measurement without a period. |
| REQ-S08-016 | "submitting a measurement leaves the validated total unchanged; approval increases it by exactly the approved amount" | Submit: validated 0.0000, submitted 250000.0000; approve 240000.5: validated 240000.5000 (measured keeps 250000.0000). |
| REQ-S08-017 | "an in-place edit of a validated value returns 409; a reversal nets the total and both records remain visible" | PATCH on a validated measurement → 409 `urn:mth:problem:invalid-transition` `benefit_measurement.validated_immutable`, row unchanged; amend → −500.5000 (239500.0000); reverse → −239500.0000 (0.0000); three validated rows listed and linked. |
| REQ-S12-014 | "submitting benefit evidence creates exactly one item in the Finance validation queue; replaying the same event creates no second item" | Relay → `benefits.finance_queue` → one queued item (key = event key); redelivery and a restarted worker → still one item, one ledger row (`benefits-queue.test.ts`); in-process replay → `duplicate`. |
| REQ-S16-017 | "the ERD and migrations contain every entity listed (…) with primary keys, owner and status where applicable, and an integration test creates and reads each one through the API with authorization enforced" | ERD/migrations are ARCH-03's (frozen). `entity-group.test.ts` creates and reads BusinessCase, BenefitFormulaVersion, Scenario, Benefit, BenefitAllocation, BenefitMeasurement and FinanceValidation (via submit + handler) through the API; AUD 403 on each mutation, 200 on each read. |
| REQ-S16-025 | "0.1 + 0.2 SAR sums to exactly 0.30; a benefit of 100000 x 0.02 x 50 SAR equals exactly 100000.00" | Unit tests in `benefits/totals.test.ts` (D01, D02); integration: gross planned of 0.1 + 0.2 (+ 7) = 7.3000; the formula measurement 0.02 × 100000 × 50 = 100000.0000. |

## 3. Checks (real exit codes)

Environment: Node v24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline; PostgreSQL 16.13 disposable cluster from `tests/qa/support/with-pg.sh` on port 23450 (pool 23451–23499, my range); empty `.claude/.cc-writes` directories removed before each run. The evidence run is **one sequential script run** from `Fri Oct 9 08:16:54 UTC 2026` to `08:32:32 UTC` (`T-DG4-KBE-E-evidence/summary.txt`).

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `pnpm -r typecheck` | 0 | 7 projects Done | `typecheck.log` |
| 1 | `pnpm -r build` | 0 | Done | `build.log` |
| 1 | `pnpm lint` | 0 | `eslint . --max-warnings=0` clean | `lint.log` |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (re-run after this handback was written: see the last row) | `prettier.log` |
| 1 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 485 operations` (contract unchanged) | `openapi-lint.log` |
| 2 | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | 0 | unit-node + unit-web: **107 files, 2094 passed**; unit-formula-nocodegen: **3 files, 259 passed, 2 skipped** | `unit-locale-unset.log` |
| 2 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same: **2094 passed**; **259 passed, 2 skipped** | `unit-c-utf8.log` |
| 3 | `QA_PG_PORT=23450 MTH_PORT_POOL=23451-23499 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **96 files, 1099 passed**, 0 failed (47 migrations applied to a fresh database) | `integration.log` |
| 4 | `node tools/gates/validate.mjs --historical --stage DG3` | 0 | `PASS gate DG3 (historical)` (start of the task and again at 08:33 UTC) | `validate-dg3-historical.log` |
| – | the same prettier command, re-run after writing this handback (08:33 UTC) | 0 | "All matched files use Prettier code style!" | `prettier-final.log` |

**Count deltas against D-098** (unit 2080 + 259/2, integration 1062): unit **+14** (2094: my `benefits/totals.test.ts`), no-codegen unchanged, integration **+37** (1099: 6 new API test files + 1 worker test file + the KBE-E contract exercise). **Pinned-count change:** the media-type pin in `contract.test.ts`, `[205, 204, 1]` → `[213, 212, 1]`. No other pin changed.

**Disclosed non-zero exits and repairs during the task (none in the evidence run):**

1. First full unit run: 2 failures in repository guard tests. These were real defects in my code, fixed before the evidence run. (a) `advisory-locks.test.ts`: my comments spelled the lock number "730233" (now "financeValidationQueue"). (b) `architecture.test.ts`: six computed member accesses with non-literal keys in `finance-validation.ts` / `measurements.ts` (now explicit fields / `Map`).
2. A typecheck error (`values.test.ts` `unknown`) and 2 unused imports (`measurements.test.ts`), fixed.
3. `finance-validation.test.ts`: the queue cursor repeated a row because the key had millisecond precision against microsecond timestamps. This was a real defect, fixed with a microsecond keyset key (the transformations-list technique).
4. **Overlapping runs:** I stopped the first full check script with `pkill`, which exited 143 and did **not** stop it. Its integration step (stale code, running concurrently with the second script) ended with exit 1, and both scripts wrote into the same `summary.txt`/logs. Those results are discarded. The second script's integration then failed **one** test: `benefits-queue.test.ts` "one queue item; a redelivery and a restarted worker…" (`waitFor: timed out`). Cause: in the full suite's shared database, `relayOnce` ends a round at the first unpublishable older row (events of other files whose consumer is not merged yet, incl. my `benefit.variance_evaluated`, §5.2), so one call did not reach my event. The test now relays until its own event is published (bounded at 180 s). I deleted every log and re-ran the whole script once, sequentially: the table above. Nothing flaky was observed in the evidence run, which logs no retries.

## 4. Operations routed (delta to `p4-pending-kbe-e.ts`)

All 16 removed (16 → 0) and exercised in `p4-exercises-kbe-e.ts`: `decideBenefitBaseline`, `getBenefitValues`, `createBenefitPlanValue`, `updateBenefitPlanValue`, `listBenefitMeasurements`, `createBenefitMeasurement`, `getBenefitMeasurement`, `updateBenefitMeasurement`, `submitBenefitMeasurement`, `listFinanceValidationQueue`, `getFinanceValidation`, `decideFinanceValidation`, `amendFinanceValidation`, `reverseFinanceValidation`, `getBenefitTotals`, `getPortfolioBenefitTotals`. Media-type pin: `[205, 204, 1]` → `[213, 212, 1]` (+8 JSON bodies; `submitBenefitMeasurement` is bodiless and declares no `consumes`).

## 5. Contract, schema and integration needs (for the orchestrator)

1. **No migration needed.** No contract change.
2. **`benefit.variance_evaluated` has no queue yet.** I emit it (ADR-0030 §6) but do not map it: slice E (BE-D, concurrent) consumes it and must add `"benefit.variance_evaluated": "<its queue>"` in `queues/raid.ts`. Until then the relay records a relay failure for each such event (never dropped). If BE-D does not map it, the orchestrator should map it to a slice E queue or to `benefits.value_decided` (the ack consumer) as a stop-gap.
3. **`events.ts`** and **`kpi-p4/actuals.test.ts`**: the two out-of-list edits in §1, both minimal and disclosed.
4. **i18n keys** for FE-A/FE-C: every ADR-0030 §11 code; plus `benefit_value.value_required`, `benefit_value.period_range` (reused from KBE-D2's texts for plan values: ADR-0030 has no own text for them), `benefits.task.finance_validation_review` (work item `messageKey`, params `benefitCode`, `periodStart`, `periodEnd`) and `kpi.downstream.benefit` (downstream item label).
5. **Worker test imports the API test harness** (`apps/worker/test/integration/benefits-queue.test.ts` → `apps/api/test/support/harness.ts` and fixtures). Test-only; the API tests already import worker handlers the same way (KBE-C precedent). The worker source imports no API code (lock class 730233 is a documented constant there).

## 6. Design choices a reviewer should check

- **Pending values only after an accepted actual.** `benefits.recalculate_pending` acts on runs whose trigger is `actual_accepted` (REQ-S07-014 "after an accepted KPI actual"); threshold, trajectory and version runs bring no new value and are skipped (`outcome: "skipped"`). The measurement's `created_by` (NOT NULL) is the KPI actual's decider (else its creator); `submitted_by` stays NULL (system), as ADR-0030 §6 requires.
- **Computing from the KPI.** A financial benefit is computed through its formula's **current** version with `measurement_kpi_variable` bound to the accepted value. Without a formula binding it is left unchanged (`no_formula_binding` in the run log), never guessed. An unmonetised non-financial benefit records the KPI value as `kpi_value`.
- **Queue task recipients.** The named Finance validator; else the mapped FIN party (person, or current active group members). The submitter is excluded. With neither, the item is still listed in the queue, with no personal task. The decision completes the tasks.
- **Gross** sums the five financial classes. Valued non-financial benefits have their own `non_financial_valued` lines and are not added to gross (conservative reading of "financial lines").
- **Cost lines** are active investment lines of non-archived business cases (each line once). The initiative view uses that initiative's own case lines.
- **Portfolio totals** need `organization.read` in the organization (404 otherwise), then sum the transformations the caller may read (`scopeFilter` on `transformation.read`).
- **Formula measurements** need the period (lineage rows are period-bound). Their period and value cannot be edited (422 `lineage_period` / `value_shape`); an amount next to `formulaVersionId` is 422 `value_shape`; an Unknown result is stored as `missing_reason = "Not computable: <engine code>"`, never 0.
- **Corrections** take If-Match on the original decision (its version is final after the decision), and lock the original measurement.

## 7. What remains

Nothing from §B.3 is left undone: all 16 operations, both worker consumers (plus the decision-event acknowledger), the DownstreamImpactProvider, the slice B measurement/Finance error mappings, and the tests named in §B.3 are delivered. Open items belong to other tasks or need an orchestrator decision:

1. The `benefit.variance_evaluated` queue mapping (BE-D, §5.2).
2. The i18n keys (FE-A/FE-C, §5.4).
3. Acceptance of the two disclosed out-of-list edits (§1: `events.ts`, `kpi-p4/actuals.test.ts`).

No real business, Finance or IT approval was granted. All demo and test data is synthetic.
