# Handback T-DG4-KBE-C (kpi-benefits-engineer): p4-work-split §A.3, plus the item carried from KBE-B (D-095)

- **Stage:** P4, gate DG4 (BUILDING). **Branch:** `dg4/kbe-c`, base `b48147a8f2a89b7002cc1591b3052fe67de7664f`. The changes are **uncommitted**, ready for the orchestrator to integrate.
- **Invocation:** `DG4-T-DG4-KBE-C-kpi-benefits-engineer-20261009T054053Z-973e2108` (session `973e2108-dc07-4cbc-97f0-4fb060a9bf97`).
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-KBE-C.md`, sha256 `bb572f8b…cba4c6b`, verified at the start.
- **Time:** started `Fri Oct  9 05:41:09 UTC 2026`, ended `Fri Oct  9 06:45:22 UTC 2026` (about 64 minutes).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` printed `PASS gate DG3 (historical)` and exited **0** (run at the start and again at the end; see §5).
- **Gates:** product gates G1–G6 are business approvals inside the product. Nothing here grants a business, Finance or IT approval, or touches DG0–DG7. Every approval in the tests is a synthetic in-product approval by a seeded user, and all test data is synthetic.

## 1. Result in one paragraph

All of §A.3 is delivered, including its "separable second half" (the worker handler, calculation runs and the KPI status panel), plus the first item carried from KBE-B: `requestKpiVersionApproval` and the `kpi_version_activation` subject provider. Both pending lists are now empty: `p4-pending-kbe-b.ts` (1 → 0) and `p4-pending-kbe-c.ts` (20 → 0). All 21 operations are routed and exercised through the validating client, and `contract.test.ts` is green (44/44). Every required check exits 0; §5 gives the commands and counts. Three plan deviations are disclosed in §7:

1. The approval stamp. The planned "approval_id with version + 1" at request time is impossible under the 0031 guards. Activation stores `approval_id` instead.
2. `server.ts` imports the approval service from `workflows/approvals.ts` directly.
3. One pin in `server.test.ts` was narrowed.

## 2. Changed files

**New files:**

| File | Purpose |
|---|---|
| `apps/api/src/modules/kpi/downstream.ts` | The `DownstreamImpactProvider` seam (KBE-E registers it) and slice A's downstream list: KPI panel, transitive formula readers, T02 outcome rows, Executive Overview. `financeReview` is `unknown` until a provider registers. |
| `packages/shared/src/schemas/kpi-actuals.ts` | Zod mirrors of every KBE-C request and response, plus the outbox payloads `kpi.actual_accepted`, `kpi.values_recalculated` and `kpi.deviation_evaluated`. |
| `apps/api/src/modules/kpi/kbe-c.test.ts` | Unit tests: the period shape, the value shape and currency, override-in-force, and the DB last-line mappings. |
| `apps/api/test/integration/kpi-p4/kbe-c-fixtures.ts` | Synthetic fixtures. Periods through the API (TO), KPIs owned by KDS, party mapping, evidence, `runRecalculation` (the worker consumer run on the outbox envelope), and approved trajectories. |
| `apps/api/test/integration/kpi-p4/{periods,actuals,pipeline,status,overrides,entity-group}.test.ts` | The §A.3 integration tests. |
| `apps/api/test/integration/kpi-p4/version-approval.test.ts` | The D-095 item: request, SoD, freeze, approve-does-not-activate, then activate. |
| `apps/worker/test/integration/kpi-recalculate.test.ts` | The relay and the production worker: one run, and no second run after a redelivery or a restart. Also the period-open job. |

**Filled stubs and owned files:**

| File | Purpose |
|---|---|
| `apps/api/src/modules/kpi/reporting-periods.ts` | 5 operations (ADR-0027 §3). |
| `apps/api/src/modules/kpi/actuals.ts` | 8 operations: the routine update, value versions, submit, accept, reject and the review queue. Review and correction tasks go through `createWorkItemOnce`. |
| `apps/api/src/modules/kpi/accept-pipeline.ts` | The accept transaction: the review row and the single `kpi.actual_accepted` outbox event (`kpi.actual_accepted:<actualId>:<valueNo>`). |
| `apps/api/src/modules/kpi/calculation-runs.ts` | 2 read operations, the run lineage with its evaluations. |
| `apps/api/src/modules/kpi/kpi-status.ts` | 2 read operations: the seven-element panel, read-time staleness and the override in force. |
| `apps/api/src/modules/kpi/rag-overrides.ts` | 3 operations (ADR-0027 §10). |
| `apps/worker/src/handlers/kpi.ts` | Consumer `kpi.recalculate` (the four triggers) and the job `kpi.reporting_period_open` (REQ-S12-005). |
| `apps/worker/src/queues/kpi.ts` | Queue specs, and the 4 trigger events → `kpi.recalculate`. |
| `apps/api/test/support/p4-pending-kbe-c.ts` | Emptied (20 → 0). |
| `apps/api/test/integration/contract/p4-exercises-kbe-c.ts` | Exercises all 21 operations, with the zod mirrors. |

**Files changed for the D-095 item** (assigned to me for this item):

| File | Purpose |
|---|---|
| `apps/api/src/modules/kpi/kpi-versions.ts` | New route `POST …/kpi-versions/{id}/approval-requests`. Adds the `KpiApprovalPort`, the subject provider whose `onOutcome` changes nothing, and the freeze while an approval is pending or deferred (409 `approval.already_open` on PATCH and withdraw). Activation now looks up the approved approval **at the current version** and stores its id. |
| `apps/api/src/modules/kpi/index.ts` | `registerKpiModule(app, deps, { approvals })` registers the subject provider. Also exports the downstream seam and the port types. |
| `apps/api/src/modules/kpi/routes.ts` | Passes the port through. |
| `apps/api/src/server.ts` | The kpi registration line passes `{ requestApproval: requestApprovalInTx, registerSubject: registerApprovalSubject, present: toApprovals }` (see §7.2). |
| `apps/api/test/support/p4-pending-kbe-b.ts` | Emptied (1 → 0). |

**Shared files touched by single appended blocks or pins** (for orchestrator acceptance):

| File | Change |
|---|---|
| `apps/api/src/modules/platform/db-errors.ts` | Appended the `mapP4KpiActualGuardError` block after KBE-B's, and one call line (ADR-0027 §13 last lines). |
| `packages/shared/src/schemas/events.ts` | 3 registry lines and 1 import. |
| `packages/shared/src/schemas/index.ts` | 1 export line. |
| `apps/api/src/modules/kpi/kpi-outbox.ts` (KBE-B's) | The event-type union widened by `kpi.actual_accepted`. |
| `apps/api/src/modules/kpi/kpi.test.ts` | Adds the KBE-C operation list, the 4 write permissions, 2 `organization.read` exceptions and the `registerDownstreamImpactProvider` export pin. |
| `apps/api/test/integration/contract/contract.test.ts` | Media-type pin `[184, 183, 1]` → `[192, 191, 1]`, i.e. +8 JSON bodies. |
| `apps/api/src/server.test.ts` | One pin narrowed (§7.3). |

## 3. Behaviour delivered, per requirement row (acceptance texts quoted)

- **REQ-S07-003.** Acceptance: *"A05;A17: a second actual for the same KPI, scope and period is stored as a new version, not a duplicate row"*.
  - `submitKpiActual` creates the one slot. A second routine-update POST for that slot is 409, with `currentVersion`.
  - `addKpiActualValue` adds value version 2 to the **same** row.
  - Test `actuals.test.ts` "REQ-S07-003" asserts `currentValueNo 2`, two values and **one** slot row.
- **REQ-S07-006.** Acceptance: *"A05: a KPI with no actual for the current period renders Unknown (grey, labelled) and contributes no zero to aggregates"*.
  - `getKpiStatus` and `listKpiStatus` return `actual: null`, `actualStatus: unknown`, `actualReason: kpi.no_accepted_actual` and `calculatedRag`/`displayedRag: unknown`, never 0 or green.
  - In a roll-up, a scope that reported before but is missing now makes the transformation value Unknown (`kpi.scope_missing`) and writes a `scope_missing` finding. A missing scope contributes no zero.
  - Tests: `pipeline.test.ts`, "roll-up across scopes" (both cases). The grey rendering is FE-B's.
- **REQ-S07-007** (my part is the run). Acceptance: *"A04;A05: with all tasks complete and actual below the red threshold the KPI is Red; changing the threshold version recomputes RAG"*.
  - The evaluator reads only values, the active version, the approved trajectory, the threshold version and the business date. It reads no task, action or initiative state.
  - An actual of 80 against an expected 100 gives `red` (`kpi.rag.red_threshold`). A new threshold version writes **one** `threshold_changed` run, after which the RAG is `green` and the explanation names threshold version 1.
  - Test: `pipeline.test.ts`, first case.
- **REQ-S07-008.** Acceptance: *"A04;A20: the KPI panel shows all seven elements in en and ar; the explanation names the threshold used"*.
  - `KpiStatus` always carries `actual`, `expectedToDate`, `finalTarget`, `variance`/`varianceRatio`, `trend`, `freshness` and `explanation`. The explanation has `thresholdSource`, `thresholdVersion`, `toleranceMode`, the amber and red thresholds, and `trajectoryVersion`.
  - Missing elements are null with a reason. Keys and reasons are i18n keys.
  - Test: `status.test.ts`, "the seven elements…" (absolute mode, version 1, amber, linear interpolation 94.94…).
  - The **en/ar rendering is FE-B's** (p4-work-split §A.5). The API returns keys only.
- **REQ-S07-009.** Acceptance: *"A05;A12: an override without evidence or expiry is rejected; an unauthorized user gets 403; after expiry the calculated RAG displays"*.
  - Each of these is a 422 with its exact ADR text, and nothing is written: missing reason, evidence or expiry, an expiry in the past, and an expiry more than 366 days away.
  - KDS, AUD and ADM-only callers get 403.
  - One override in force per slot (409). Revoke takes `If-Match` and a reason.
  - `inForce` turns false at expiry with no job. `getKpiStatus` then shows `displayedRag = calculatedRag` with `override: null`, and the calculated RAG is preserved on the override.
  - Tests: `overrides.test.ts` (4) and `status.test.ts` "override display".
- **REQ-S07-010** (roll-up in the run). Acceptance: *"A05: two BU ratios 1/10 and 9/10 roll up to 0.50 (weighted), not the mean of percentages; summing SAR with USD without conversion is rejected"*.
  - The run calls KBE-A's `rollUp`: BU ratios 1/10 and 9/10 give `0.5` at the transformation scope (`pipeline.test.ts`).
  - A USD value for a SAR KPI is refused at entry: 422 `kpi_actual.currency_mismatch`, "Values are never converted." (`actuals.test.ts` "SAR + USD"). So no mixed-currency input reaches a sum.
- **REQ-S07-012.** Acceptance: *"A04: with review configured, a submitted actual is not used in calculations until accepted; with direct-accept it is used immediately"*.
  - Review route: `submitted`, `acceptedValueNo null`, no outbox event, no run, and the panel shows Unknown. After a reviewer accepts, there is one run and the value.
  - Direct route: `accepted` at once, with `acceptedValueNo 1`, a `direct_accept` review row and one outbox event.
  - Tests: `actuals.test.ts` and `pipeline.test.ts` "review route".
- **REQ-S07-013.** Acceptance: *"A04;A13: accepting one actual produces exactly one calculation run and one audit event; linked dashboards show the new value once"*.
  - One accept writes exactly **one** audit event on `kpi_actual` and **one** `kpi.actual_accepted` event.
  - The worker writes **one** run, also after a redelivery and after a worker restart (`kpi-recalculate.test.ts`, through pg-boss and the production `startWorker`). The run itself writes no audit event.
  - The panel reads the single latest evaluation, so the value is shown once.
- **REQ-S07-017** (API half). Acceptance: *"A04;A20: a keyboard-only user completes an update in four steps; the confirmation lists affected dashboards and 'Finance review pending' where applicable"*.
  - `submitKpiActual` is one request: KPI, period, value or "not available", and evidence.
  - `KpiActualSubmission` lists `downstream` (KPI panel, formula KPIs, T02 rows, Executive Overview), `reviewPending` and `financeReview` (`unknown` until KBE-E registers its provider).
  - The keyboard-only four-step UI is **FE-B's**.
- **REQ-S12-006** (my part). Acceptance: *"A04;A13: one accepted actual yields one recalculation and one validation flag"*.
  - One accepted actual gives one run and exactly one `kpi.values_recalculated` (key `kpi.values_recalculated:<runId>`).
  - The **validation flag is slice B's (KBE-E)**, consuming that event.
- **REQ-S16-014.** Acceptance: *"A04: … an integration test creates and reads each one through the API with authorization enforced"*.
  - `entity-group.test.ts` creates KPIDefinition, KPIVersion, TargetTrajectory and KPIActual through their create operations.
  - It produces CalculationRun and a DataQualityFinding (`out_of_range`) by accepting an actual and running the handler, then reads them with `getCalculationRun` and `listDataQualityFindings`.
  - AUD gets 403 on each mutation and 200 on each read.
  - The ERD and migrations are ARCH-02's (unchanged).
- **REQ-S12-005** (the handler, §I+C.5). Acceptance: *"A13: a period opening creates one task per KPI owner; a worker restart during the run creates no duplicates"*.
  - `kpi.reporting_period_open` opens each scheduled period whose end is before today's business date, with one audit event (actor `service`).
  - It creates one `kpi_update_due` per active KPI owner, with dedupe key `kpi.period_open:<kpi>:<label>:<owner>`.
  - A second run opens nothing and creates nothing (`kpi-recalculate.test.ts`).
  - Not tested: a kill **mid-run**. Idempotency comes from `runOnce` plus `createWorkItemOnce` in one transaction, the BE-A pattern proven by `restart.test.ts`.
- **D-095 item (`requestKpiVersionApproval`, REQ-S07-001 support).** Tested in `version-approval.test.ts` (6 tests):
  - 428 and 409 on `If-Match`; AUD gets 403.
  - A direct-policy version gets 422 `validation.constraint`.
  - An unmapped BO party gets 422 `routing.role_unmapped`, with nothing written.
  - The response is 201 `Approval` with Location and ETag, routed to party BO with the requester excluded. SoD gives 403 `approval.sod_requester`.
  - A pending approval freezes the draft: PATCH and withdraw both get 409 `approval.already_open`.
  - **Approving does not activate.** The explicit activation then succeeds and stores the approval id.
  - An approval of earlier content (the draft edited after approval) does not count: 422 `kpi_version.approval_required`.
  - `changes_requested`, then edit, then resubmit at the new version, then approve, then activate works.

## 4. Operations routed (delta to the pending lists)

- **`p4-pending-kbe-b.ts`:** `requestKpiVersionApproval`, leaving `[]`.
- **`p4-pending-kbe-c.ts`:** all 20 operations, leaving `[]`:
  - reporting periods: `listReportingPeriods`, `createReportingPeriod`, `getReportingPeriod`, `openReportingPeriod`, `closeReportingPeriod`;
  - actuals: `listKpiActuals`, `submitKpiActual`, `getKpiActual`, `addKpiActualValue`, `submitKpiActualDraft`, `acceptKpiActual`, `rejectKpiActual`, `listKpiActualReviewQueue`;
  - runs and status: `listCalculationRuns`, `getCalculationRun`, `listKpiStatus`, `getKpiStatus`;
  - overrides: `listRagOverrides`, `createRagOverride`, `revokeRagOverride`.
- **Exercises:** all 21 are exercised in `p4-exercises-kbe-c.ts`, with zod mirrors in `P4_MIRRORS_KBE_C`.
- **`config.consumes`** equals the contract for each route (S-3):
  - JSON for the 8 operations with bodies;
  - none for `openReportingPeriod`, `closeReportingPeriod` and `submitKpiActualDraft`;
  - `contract.test.ts` "every route accepts exactly the request media types" passes.

## 5. Checks actually run

Environment: Node 24.21.0, offline. PostgreSQL 16 disposable clusters via `tests/qa/support/with-pg.sh`, `QA_PG_PORT=23300`, `MTH_PORT_POOL=23301-23349`. Logs are under `docs/delivery/handbacks/DG4/T-DG4-KBE-C-evidence/`. Empty `.claude/.cc-writes` sandbox directories inside source folders were removed before the test runs.

| Command | Exit | Result / counts | Log |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG3` (start) | 0 | `PASS gate DG3 (historical)` | (console, §0) |
| `pnpm -r typecheck` | 0 | all packages Done | `typecheck.log` |
| `pnpm -r build` | 0 | all packages Done | `build.log` |
| `pnpm lint` | 0 | (first run exit 1: one unused constant in `kpi-versions.ts`, fixed and rerun) | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 485 operations` | `openapi-lint.log` |
| `pnpm test` (LANG/LC_ALL/LC_CTYPE unset) | 0 | Vitest 1: 103 files, **2059 passed**. Vitest 2: 3 files, **259 passed, 2 skipped** | `unit-locale-unset.log` |
| `LC_ALL=C.UTF-8 pnpm test` | 0 | the same: **2059**, then **259 + 2 skipped** | `unit-c-utf8.log` |
| `QA_PG_PORT=23300 MTH_PORT_POOL=23301-23349 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | 83 files, **1006 passed (1006)** (D-097: 967). The +39 are KBE-C's: version-approval 6, periods 4, actuals 11, pipeline 6, status 5, overrides 4, entity-group 1, worker kpi-recalculate 2. | `integration.log` |
| `node tools/gates/validate.mjs --historical --stage DG3` (end) | 0 | `PASS gate DG3 (historical)` | (console) |

**Disclosed non-zero runs and failures:**

- **First `pnpm test` (locale unset): exit 1**, 1 failure in `apps/api/src/server.test.ts`. The test assumed no route URL contains "report"; the contract path `/reporting-periods` does. I narrowed the pin (§7.3) and reran; both locale runs then exited 0. The failing run is kept as `unit-locale-unset-run1-failed.log`.
- **First `pnpm lint`: exit 1** (an unused constant); fixed.
- **Earlier focused runs during development** (not the acceptance runs):
  - `version-approval.test.ts` had 2 failures that exposed the stamp/stale conflict (§7.1), and 1 because KDS cannot resubmit (§7.4).
  - `actuals.test.ts` had 1 failure from a fixture body missing `validMin`/`validMax`.
  - `contract.test.ts` had 3 failures: an exercise expecting 403 got 400 because the reason was too short, the media pin, and the coverage check while the exercises were incomplete.
  - The `kpi-recalculate` worker test had 1 failure: the seeded `data_as_of` was older than 45 days, so the engine correctly said Stale. The fixture date was fixed.
  - A unit run had the architecture test (computed members, a private import) and the lock-registry test (lock numbers spelled out in comments) failing.
  - Each was fixed before the acceptance runs above.

**Pinned-count changes:**

- `contract.test.ts` media pin goes to `[192, 191, 1]` (+8 JSON bodies).
- `kpi.test.ts` goes to 48 + 18 + 21 kpi routes.
- The unit count rose from 2049 (D-097) to 2059.

## 6. Shared rules S-1 … S-14

| Rule | How it is met |
|---|---|
| S-1 | Free text goes through `freeText`: comments, missing reasons, the reject reason, the override reason, the approval request note. |
| S-2 | No route-local parser. |
| S-3 | See §4. |
| S-4 | Every mutation: `openWrite(…, { atCommit: true })` or, for periods, an organization read gate plus `refreshPrincipal` and `commitTimeDenial`; zod validation then business rules; `If-Match` (428/409; creates are version 1); one audit event per user action in the same transaction (only the slot is audited); no remote I/O. Tests cover 428, 409, AUD 403 and ADM-only 403, and that nothing is written on a refusal. |
| S-5 | Decimal strings and `numeric(24,6)`, rounded once by `roundForStorage`. Unknown and Not computable are NULL with a reason. JSON numbers get 400. Currency is never converted. |
| S-6 | Problem codes and explanation keys are i18n keys. Work items store `messageKey` + `messageParams`: `kpi_actual.review_due`, `kpi_actual.rejected`, `kpi.update_due`. |
| S-9 | Nothing under `packages/shared/src/formula/**` or `packages/shared/src/kpi/**` changed; the KBE-A library is consumed. |
| S-10 | See §4. |
| S-11 | The ADR-0027 §13 codes and English texts are used verbatim (unit and integration tests assert the texts). |
| S-12 | No migration. |
| S-13 | Jobs use `runOnce` and `createWorkItemOnce`; the job actor is `service`. |
| S-14 | kpi never writes `approval*`. It requests through `requestApprovalInTx`, via the port. |

## 7. Deviations, observations and decisions requested

1. **The approval stamp of KBE-B's plan cannot work, so activation stores `approval_id` instead.**
   - The plan was: "store `approval_id` on the draft with version + 1".
   - The 0031 `approval_decision_guard` trigger refuses a decision unless `p4_approval_subject_version` (the subject row's **actual** version) equals the approval's `subject_version`. Any write to the draft after the request therefore makes every decision `approval_decision_stale`. The first test run showed exactly this.
   - **As built:** the request does not change the draft. The approval engine writes the approval, its audit event and the approver tasks. While the approval is pending or deferred, the draft is frozen (409 `approval.already_open`); under `changes_requested` it can be edited and resubmitted.
   - Activation looks up the approved `kpi_version_activation` approval **of this version at its current row version**, so an approval of older content does not count. It stores that `approval_id` in the activation update, and the 0033 trigger re-checks it.
   - **Decision requested:** accept this reading of D-095's plan.
2. **Port wiring.** kpi cannot import workflows, because workflows depends on kpi (`modules.ts`).
   - The kpi module takes a `KpiApprovalPort` in `registerKpiModule(…, { approvals })`, the GateFactsProvider pattern.
   - `server.ts` imports `requestApprovalInTx`, `registerApprovalSubject` and `toApprovals` directly from `./modules/workflows/approvals.ts`, because `workflows/index.ts` does not export them and that file is not mine. The architecture test does not cover `server.ts`, and every other `server.ts` import uses a module's `index.ts`.
   - **Decision requested:** either accept this, or add those three exports to `workflows/index.ts`. BE-C may add the same exports for governance.
3. **`server.test.ts` pin narrowed** (not my file). Its P3 check `routes.filter(r => /report/i.test(r.url))` toEqual `[]` guards the reporting scaffold. The **contract** path `/organizations/{id}/reporting-periods` (ARCH-02) trips it, so the filter now excludes `/reporting-periods`. **Decision requested:** accept the pin change.
4. **A KDS requester cannot resubmit.** BE-B's `resubmitApproval` requires `approval.request`, which KDS lacks. TL can. This is an observation on the engine's rule; the test uses TL for the resubmit path.
5. **Codes not in ADR-0027 §13** (the D-095 precedent of using generic codes):
   - `validation.constraint` for a request on a direct-policy version and for an update due date not after the period end;
   - `validation.reference` for an unknown period or evidence;
   - `invalid_transition` for submitting a non-draft;
   - 409 `version_conflict` with `currentVersion` for the routine-update POST on an existing slot (the ADR's `kpi_actual_slot_key` mapping);
   - 409 `approval.already_open` for PATCH and withdraw of a frozen draft;
   - the status reason `kpi.calculation_pending`, for an accepted value whose run has not happened yet (pattern-valid, not in KBE-A's list).
   - FE-A/FE-B need the i18n keys of these.
6. **Review-task dedupe key** carries the recipient: `kpi.actual_review:<actualId>:<valueNo>:<userId>`. This follows the ADR-0025 §3 convention `<rule>:<subject>:<slot>[:<recipient>]`, because a group party has several reviewers. ADR-0027 §6 writes the key without the recipient.
7. **Events without a consumer yet.** `kpi.values_recalculated` (KBE-E) and `kpi.deviation_evaluated` (BE-D2) are written by each run, but no queue maps them yet. The relay records them as failures and never drops them (relay rule) until those slices add their `*_EVENT_QUEUES` entries. Also, KBE-B's three events are now mapped to `kpi.recalculate`; before this they had no queue.
8. **Failed runs.** "After the last attempt the handler writes a `failed` run" (ADR-0027 §8 step 4) is **not implemented**. The handler receives no attempt count; pg-boss retries, and the dead-letter queue `ops.failed` keeps the job. This is listed in §8.
9. **Milestone evaluations** store `1` (achieved) or `0` (not achieved) as the value, because the 0035 CHECK requires a non-NULL value for status `ok`. Milestone trend is `unknown`. Cumulative is not evaluated for milestones (ADR-0028 §2).
10. **Formula KPIs** are evaluated at the triggering scope and period, binding each input to this run's value, else Unknown (`kpi.formula_input_unknown`). There is no integration test of a formula KPI recalculation; it is covered only by the code path and KBE-A's unit tests.
11. **The `reporting_period_no_overlap` last-line text** cannot name `{otherLabel}`, because the guard message does not carry it. The service checks the overlap first with the exact text.
12. **Untracked top-level files** (`.bashrc`, `.mcp.json`, `.vscode`, …) are character devices (`/dev/null`) that the sandbox runner mounted. They are not mine, and I did not touch them. The prettier check ignores them (`--ignore-unknown`) and exited 0.

## 8. What remains

- **Failed-run lineage** (§7.8): a `failed` `calculation_run` with `error_code` after the last pg-boss attempt. This needs the attempt count passed to `JobHandler.handle`, or a dead-letter consumer.
- **A formula-KPI recalculation integration test** (§7.10).
- **A kill-mid-run test of `kpi.reporting_period_open`.** The BE-A pattern in `restart.test.ts` covers `runOnce`/`createWorkItemOnce` generally.
- **FE-B:** the en/ar rendering of the panel, the four-step keyboard flow and the "Finance review pending" label. **KBE-E:** the validation flag and the `DownstreamImpactProvider`.
- Nothing else of §A.3 or of the D-095 item is open.

## 9. Contract or schema needs

- **Schema:** none. No migration and no repair-range number are needed.
- **Contract:** none. `openapi.yaml` is unchanged (485 operations, lint PASS).
- **Decisions requested:** §7.1, §7.2 and §7.3. Also accept the shared-file blocks listed in §2 (`db-errors.ts`, `events.ts`, `schemas/index.ts`, `kpi-outbox.ts` union, `kpi.test.ts` and `contract.test.ts` pins).

## 10. Merge instructions

- **Ordering:** no migration. Merge after KBE-B (merged) and BE-B (merged).
- **Expected conflicts:**
  - `contract.test.ts` media pin: add +8 JSON to the other W5 tasks' counts.
  - `schemas/index.ts` and `events.ts`: appended lines.
  - `db-errors.ts`: appended block plus one call line after `mapP4KpiGuardError`.
  - `server.ts`: the kpi registration line plus one import. BE-C may also touch `workflows/index.ts` (§7.2).
- **Worker:** the `kpi.recalculate` and `kpi.reporting_period_open` queues are created by `ensureQueues`. The `job_schedule` row `kpi.reporting_period_open` already exists (0028).
