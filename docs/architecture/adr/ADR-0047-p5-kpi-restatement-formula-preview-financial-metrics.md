# ADR-0047: KPI and formula change semantics: prospective application by default, retrospective restatement (selected closed periods, authority, retained reconciliation, recalculation of the selected periods once, report reissue offer), formula preview (evaluated examples, unit, edge cases), and the optional NPV/ROI/payback extension with explicit methodology, timing and discount-rate assumptions

- **Status:** Proposed for P5 (DG5). Author: solution-architect (T-DG5-ARCH-05), 2026-10-14.
- **Requirements (slice G of `docs/architecture/p5-plan.md`):** REQ-S07-016, REQ-S08-005, REQ-S08-019. ADR-0048 covers slice H.
- **Sources (quoted where a design point has one):**
  - M0163 (§7): "Changing a KPI definition, baseline or target creates a versioned change request with reason and impact preview. Show affected outcomes, benefits, gates, reports and formulas. Approved changes take effect prospectively by default. A retrospective restatement requires explicit period selection, authority and a retained reconciliation. Previously issued reports remain unchanged and can be reissued as a new version."
  - M0168 (§8): "Provide a safe formula builder using a restricted expression language and typed variables. Never evaluate arbitrary user-supplied code. Preview examples, units and edge cases before publication. Version formulas and preserve the calculation lineage: input actuals, source versions, assumptions, rates, period and formula version."
  - M0174 (§8): "… Any optional NPV, ROI or payback metric requires explicitly defined methodology, timing and discount-rate assumptions; it is an extension, not a prescribed source requirement."
  - Playbook: B0087 (the two illustrative benefit formulas; the revenue uplift example `(target_attach_rate - baseline_attach_rate) * eligible_customers * arpu` seeded as `revenue_uplift` in `0023`). The playbook prescribes no NPV, ROI or payback (REQ-S08-019 notes: "Extension; not prescribed by the playbook"), and no restatement procedure.
- **Acceptance texts (binding, judged on their own text; D-142 R1):**
  - REQ-S07-016: "a prospective target change leaves last quarter's RAG unchanged; a restatement of Q1 without authority is rejected; the Q1 report issued earlier is unchanged and a reissue creates version 2".
  - REQ-S08-005: "preview of the revenue uplift example shows SAR as the unit and 'Not computable' for a missing ARPU".
  - REQ-S08-019: "with no discount rate configured NPV is not shown; with 10% configured, a fixture cash-flow set gives the expected NPV to 2 decimals".
- **Decisions applied:** D-141 (carried rules), D-142 (the plan; **Q10**: "The approver of the KPI change request holds `kpi_restatement.approve`, and the requester cannot approve (SoD default)"; R1), D-143–D-146; D-088 §2 and F-DG3-100 (claims enumerated and exactly true); D-117, D-119, D-122 (value bases never mixed).
- **Builds on:** ADR-0003 (optimistic concurrency), ADR-0004 (audit), ADR-0006 (authorization, technical admins hold no approval code), ADR-0007 (§5b statuses), ADR-0016 (P2 guards, lock registry), ADR-0024 §6 (the formula engine, unchanged), ADR-0026 (canonical approval, work items), ADR-0027 and ADR-0028 (KPI versions, periods, evaluations, RAG), ADR-0036 (KPI change requests), ADR-0045 §4 (reissue as a new version).
- **Physical model:** `0085_p5_kpi_restatements_financial_metrics.sql`, `0087_p5_kpi_launch_health_permissions.sql` (shared with ADR-0048). The guard probe (`docs/delivery/handbacks/DG5/T-DG5-ARCH-05-evidence/probe-output.txt`) tests this ADR's database claims in groups KR (restatement), KP (periods), KC (reconciliation), CR (restatement run), EV (evaluations), KO (reissue offers), FS (settings), CF (cash flows), S06 (permissions) and AO (append-only and grants); each probe names the constraint it expects.
- **Two gate systems.** Product gates G1–G6 are business approvals inside the product. Nothing here reads or writes the engineering records DG0–DG7. Deciding a restatement is a business approval recorded only when a person with the authority decides it through the API; no agent, seed or job decides one.

## Context

As built on `HEAD` `f591b7c` (DG4 APPROVED; P5 slices A–F merged or in flight):

1. A KPI changes through a new `kpi_version` (ADR-0027 §2). A KPI change request (ADR-0036 §2, kinds `baseline`, `target`, `kpi_definition`) activates the draft version on approval; the previous version becomes `superseded` and stays readable. ADR-0036 §2 states: "**Retrospective restatement** (M0163) is not built in DG4: every applied change is prospective; a request whose `proposed_change` names a past effective period is refused 422 `change_request.retrospective_not_supported`".
2. Evaluations are append-only (`kpi_evaluation`, `0035`). Each records the `kpi_version_id` it used and belongs to one `calculation_run` (trigger kinds `actual_accepted`, `threshold_changed`, `trajectory_approved`, `version_activated`). A slot's current value and RAG is its latest evaluation.
3. **The DG4 recalculation on activation** (`apps/worker/src/handlers/kpi.ts`, lines 862–866): for the three non-actual triggers, the worker recalculates "the KPI's current reporting period: the latest open or closed period of its frequency (ADR-0028 §6)". When no later period has opened yet, that is the last **closed** period. A new version activated before the next period opens is therefore evaluated against the last closed period. That evaluation is a new row, so nothing is rewritten, but it becomes that slot's latest evaluation, and last quarter's RAG as read changes.
4. Reporting periods move `scheduled → open → closed`; "a closed period is final in P4 … A correction of a closed period is a restatement through change control (M0163, slice H)" (`0033` comment). DG4's actual entry refuses a closed period with 422 `kpi_actual.period_not_open`: "… a closed period is corrected through a restatement."
5. The formula engine (`packages/shared/src/formula/**`, ADR-0024 §6) evaluates decimal expressions. A missing input gives `result: null` with `errorCode: formula.missing_input`; division by zero gives `formula.division_by_zero`. `POST /benefit-formulas/validate` (`checkBenefitFormula`) returns one preview value from the variables' own values and needs a session only.
6. Business cases (`0023`) hold investment and benefit lines with amounts, currencies, value bases and period ranges, but no cash flow per period and no discount rate. Nothing in DG1–DG4 computes NPV, ROI or payback.
7. ADR-0045 §4 reissues an issued report snapshot as a new `generated` snapshot of the same series; issuing it supersedes v1 and gives `issue_version` 2. ADR-0045 §10 publishes the event `report_snapshot.issued` for this slice.

## Decision

### 1. Prospective application is the default (REQ-S07-016, M0163 "take effect prospectively by default")

**Rule.** An approved KPI version is used by evaluations of the KPI's **open** reporting periods from its activation onwards, and of every period opened later. **A closed period is evaluated with a different version only through an approved restatement (§2).** Concretely, after the change in this section:

1. `version_activated`, `threshold_changed` and `trajectory_approved` recalculate the KPI's latest **open** period of its frequency. When no period of that frequency is open, the run evaluates nothing: zero evaluations, run status `completed`. The next period is evaluated with the new version when it opens or receives an accepted actual (the DG4 `kpi.reporting_period_open` job and `actual_accepted` trigger, unchanged).
2. `actual_accepted` is unchanged (DG4 accepts actuals only for an open period).
3. Earlier evaluations are never updated or deleted (`kpi_evaluation` stays append-only), so last quarter's latest evaluation, and its RAG, stays the one computed before the change.

**Effective date.** The UI shows a version's "effective from" as the first period it evaluated, read from its earliest `kpi_evaluation` row, or "from the next open period" when it has none. No column is added to `kpi_version`. REQ-S07-016's procedure text says "Default effective date is the next period". This ADR reads "next period" as the first open period, which is the period still being reported. That reading is an interpretation, listed for the orchestrator in the handback.

**Classification: a reopen candidate (D-088 trigger).** p5-plan §3 row 19 called prospective application "the DG4 behaviour" (additive). That is not exactly true (Context 3). Item 1 changes a DG4-approved worker behaviour (ADR-0028 §6's "latest open or closed period") for the three non-actual triggers. **Documented reason:** REQ-S07-016's acceptance "a prospective target change leaves last quarter's RAG unchanged" fails under the DG4 behaviour whenever the change is activated before the next period opens. **Alternative if the orchestrator declines:** limit item 1 to `version_activated` and keep the DG4 behaviour for thresholds and trajectories (they are not M0163 KPI definition changes). The owner is KBE-E (§9). The regression test asserts that a target change activated while Q2 is still `scheduled` leaves Q1's latest evaluation, and RAG, unchanged.

### 2. Retrospective restatement (REQ-S07-016, M0163 "explicit period selection, authority and a retained reconciliation")

**Entity `kpi_restatement`** (`0085`). Fields:
- `kpi_definition_id`;
- `kpi_version_id`, the version applied to the selected periods. It must be an approved version (`active` or `superseded`) of this KPI (`kpi_restatement_version_approved`);
- `change_request_id`, optional: the approved KPI change request that produced the version (ADR-0036);
- `reason` (3–2000 characters);
- `status`;
- `requested_by`;
- `submitted_at`, set by the database to the submitting transaction's time;
- `period_count` and `reconciliation_count`, both equal to the child rows at COMMIT (`kpi_restatement_counts`);
- the decision: `decided_by`, `decided_at`, `decision_note`, `authority_permission` (always `kpi_restatement.approve`) and `authority_role_code` (the role through which the decider held the right);
- `calculation_run_id` and `applied_at`;
- the withdrawal stamps;
- `version` and the audit columns.

At most one restatement per KPI is in progress, meaning in `draft`, `submitted` or `approved` (unique index `kpi_restatement_one_open_key`).

**State machine** (trigger `kpi_restatement_guard`):

```text
draft     -> submitted (needs >= 1 period and a reconciliation row for every period, written in the same transaction)
          |  withdrawn
submitted -> approved | rejected (a note is required) | withdrawn
approved  -> applied   (the worker, once: the restatement calculation run, §3)
rejected, withdrawn, applied: terminal
```

The KPI, version, change request and requester never change; the reason and the periods change only in `draft` (`kpi_restatement_identity_fixed`). The decision columns are written only by the approve or reject transition (`kpi_restatement_decision_frozen`).

**Selected periods** (`kpi_restatement_period`, append-only, written only while the restatement is a draft): each selected period is a **closed** reporting period of the restated version's frequency in the restatement's organization (`kpi_restatement_period_closed`). An open period is not restated, because it takes the new version prospectively (§1). There are 1–24 periods per restatement (CHECK 0–24 on `period_count`, plus the submit rule; the API refuses 25 or more). Changing the selection in a draft means withdrawing the restatement and creating a new one; the periods are append-only.

**Authority** (D-142 Q10). Deciding needs `kpi_restatement.approve` in the transformation, a `business_approval` code held by SP, BO and FIN by default. These are the holders of `approval.decide`, among them BO, the ADR-0036 §4 default approver of `baseline`/`target`/`kpi_definition` change requests. The decider is never the requester: the API refuses with 403 `kpi_restatement.self_decision`, and the database CHECK `kpi_restatement_sod` refuses it too. A decider without the right gets 403 `kpi_restatement.no_authority`. That is the acceptance case "a restatement of Q1 without authority is rejected", and it writes nothing. The database records `authority_permission` and `authority_role_code` with the decision (`kpi_restatement_decision_complete`). The decision is a business approval inside the product, never DG0–DG7.

**Submission and the retained reconciliation** (`kpi_restatement_reconciliation`, append-only). In one transaction under lock 730266 the API:
1. computes, for each selected period, scope and value basis (`period`, `cumulative`) that has an evaluation or an accepted actual, the **before** values: the slot's latest DG4 evaluation, with its `value`, `value_status`, `calculated_rag`, target and `kpi_version_id`, or `none` when the slot was never evaluated;
2. computes the **after** values: the same evaluation recomputed with the restated version by the DG4 KPI calculation library (`@mth/shared/calc` `kpi/**`, read-only, unchanged), in memory;
3. inserts one reconciliation row per slot, with `difference = after - before` when both are `ok` and NULL otherwise (CHECK `kpi_restatement_reconciliation_difference`);
4. moves the restatement to `submitted` with `reconciliation_count`.

A slot with no evaluation and no accepted actual gets no row. The database refuses submission unless every selected period has at least one row, and a reconciliation row written in any other transaction or for a non-draft restatement (`kpi_restatement_reconciliation_at_submit`, `kpi_restatement_reconciled`). Unknown, stale and not computable values have no number, never 0 (`kpi_restatement_reconciliation_before`/`_after`). The reconciliation is never updated or deleted.

### 3. Approval, recalculation of the selected periods, and the reissue offer (REQ-S07-016 automation "Restatement approved -> recalc selected periods and offer report reissue")

1. **Decide** (`decideKpiRestatement`, lock 730266). On `approved`, the API writes the outbox event `kpi_restatement.approved` `{restatementId, kpiDefinitionId, transformationId}` (schema_version 1) in the same transaction. The decision task, a `kpi_restatement_to_decide` work item created at submit for each holder of `kpi_restatement.approve` in the transformation except the requester (dedupe key `kpi_restatement:<restatementId>:<userId>`), is completed.
2. **Recalculate once** (worker, KBE-E2). It consumes the event with `runOnce`. Under lock 730266 it writes **one** `calculation_run` with `trigger_kind = 'restatement_approved'`, `trigger_record_type = 'kpi_restatement'`, `trigger_record_id` = the restatement, `trigger_slot = 1` and `idempotency_key = 'kpi_restatement:<id>'`. The DG4 UNIQUE constraints `calculation_run_trigger_key` and `calculation_run_idempotency_key` are the exactly-once backstops, and the trigger `calculation_run_restatement_guard` refuses a run for a restatement that is not `approved`. The run evaluates the restated KPI with the restated version for the selected periods only (trigger `kpi_evaluation_restatement_guard`), plus every formula KPI that reads it, for the same periods, with their own active versions (the DG4 reader rule). Then it sets the restatement to `applied` with `calculation_run_id` (`kpi_restatement_applied_run`). A replay writes nothing: the run key exists, and the restatement is no longer `approved`.
3. **Restated values become current.** The run's evaluations are the slots' latest. Reads show the restated value and RAG with their version, and the run's `trigger_kind` labels them "Restated". The pre-restatement evaluations stay readable through the reconciliation's `before_evaluation_id`.
4. **Offer report reissue** (same worker transaction). For every issued (or meanwhile superseded) `report_snapshot` of the transformation that (a) recorded a `kpi_version` row (`report_snapshot_version`) of a version of this KPI, or a `report_snapshot_source` row for the KPI definition, and (b) whose period overlaps a selected period, or that has no period, the worker inserts one `kpi_restatement_reissue_offer` row (`(restatement_id, snapshot_id)` UNIQUE). It then creates one `report_reissue_offer` work item per holder of `report.issue` in the transformation (dedupe key `report_reissue_offer:<restatementId>:<seriesId>:<userId>`). **Issued snapshots are never changed** (ADR-0045 §2–§4). A person reissues through `reissueReportSnapshot`, and issuing that reissue gives `issue_version` 2: the acceptance text "the Q1 report issued earlier is unchanged and a reissue creates version 2".

**DG4 text made true or changed (F-DG4-160; D-141 (2)):**
- `kpi_actual.period_not_open` ("… a closed period is corrected through a restatement.") becomes true and stays.
- `change_request.retrospective_not_supported` (ADR-0036 §8: "A retrospective restatement is not supported; changes take effect from now on.") becomes untrue as worded. Its code and status stay, because a change request still applies prospectively only. Its English text changes to **"A change request takes effect from now on; restate closed periods through a KPI restatement."** This is a DG4-approved text change with a documented reason, listed for the orchestrator. KBE-E2 changes it in the API and the en/ar problem keys.

### 4. Formula preview (REQ-S08-005, M0168 "Preview examples, units and edge cases before publication")

`POST /api/v1/formula-previews` (`previewFormula`; session and CSRF only, writes nothing, the `checkBenefitFormula` precedent) takes either `{exampleCode}` (a seeded B0087 example from `benefit_formula_example`, e.g. `revenue_uplift`) or `{expression, variables}` (the DG3 `FormulaCheckRequest` shape), plus up to 10 named `examples` (`{label, inputs}`) and `edgeCases` (default `true`). It returns:

- `valid` and `errors`, the engine's verdict. An invalid expression returns the engine's first error as 422 with its ADR-0024 §6 code and text, unchanged.
- `unit`: `{kind, currency, period, unitLabel}` from the engine's result type. The revenue uplift example's unit is kind `currency`, currency `SAR`, period `year`, and the UI shows "SAR".
- `examples[]`: each example evaluated with `evaluateFormula(expression, variables, inputs)`. A seeded example contributes one example, "Source example", with its seeded values. Each result has `status` `ok` with `result`, or `not_computable` with `reasonCode` (`formula.missing_input`, `formula.division_by_zero`, `formula.result_out_of_range`) and `result: null`.
- `edgeCases[]`: for each variable, the formula evaluated with that variable set to `"0"` (`zero`), to `null` (`missing`) and, for variables whose kind admits a sign, negated (`negative`). Each has the same `status`/`reasonCode` shape.

The UI labels `not_computable` with the i18n key `formulaPreview.notComputable` ("Not computable" / "غير قابل للحساب"), never 0. **The acceptance case:** `{exampleCode: "revenue_uplift"}` gives unit SAR, and edge case `arpu`/`missing` gives `not_computable` with `formula.missing_input`. **The formula engine is not changed** (p5-plan §3 row 20); the preview only calls `validateFormula`/`evaluateFormula`.

### 5. Optional NPV, ROI and payback (REQ-S08-019, M0174)

**Settings** (`financial_metric_setting`, one row per organization, `0085`): `enabled` (default false; **no row means disabled**, and none is seeded); `methodology` (closed set: `discounted_net_cash_flow`); and the Finance-set assumptions, all or none (`financial_metric_setting_assumptions_complete`): `methodology_note` (3–2000 characters, the explicit methodology statement), `timing` (`end_of_period` | `beginning_of_period`) and `period_basis` (`annual` | `quarterly` | `monthly`). Also `discount_rate` (`numeric(9,6)` decimal fraction in [0, 1] per period of the period basis; nullable independently), set together with the assumptions. Switching the extension on or off (`financial_metrics.enable`, ADM_METHOD) and setting the assumptions (`financial_metrics.define`, FIN) are separate operations on the same row. Both use `If-Match` (`"0"` creates the row, the `IfMatchOrZero` precedent of `putChangeControlPolicy`).

**Cash flows** (`financial_cash_flow_set` per business case plus append-only `financial_cash_flow` rows): Finance enters, per period index t = 0…120, an `outflow` and an `inflow` (`numeric(20,4)`, ≥ 0) in the business case's currency (`financial_cash_flow_set_currency`). Replacing the set steps `revision` by 1 and inserts the new rows; the earlier rows stay as history. At COMMIT the current revision has exactly `line_count` rows with indexes 0…n−1 (`financial_cash_flow_set_rows`). Cash flows are entered explicitly and **never derived from benefit values**, so no value basis is mixed (D-117, D-119, D-122).

**Computation** (pure functions in `packages/shared/src/finance/**`, decimal.js through `@mth/shared/calc`, KBE-F). Net_t = inflow_t − outflow_t.
- **NPV** = Σ Net_t / (1 + r)^e_t with e_t = t for `beginning_of_period` and e_t = t + 1 for `end_of_period` (Excel's `NPV()` convention). It is computed at precision 40 and rounded once to 2 decimals, ROUND_HALF_UP.
- **ROI** = (Σ inflow − Σ outflow) / Σ outflow, undiscounted, a decimal fraction rounded to 6 decimals. It is not computable when Σ outflow = 0.
- **Payback** = the smallest period index t at which the cumulative undiscounted net is ≥ 0, provided some earlier cumulative net was < 0. It is "not reached" when that never happens, and not computable when there is no outflow.

**What is shown** (`getBusinessCaseFinancialMetrics`, `listTransformationFinancialMetrics`):
1. Extension disabled → `status: disabled` and no metric.
2. Enabled with no assumptions → `status: assumptions_missing` and no metric.
3. Enabled with assumptions but no discount rate → ROI and payback shown; **NPV not shown** (`npv: null`, `npvReason: discount_rate_missing`).
4. No cash-flow set → `status: cash_flows_missing`.

Every response carries the assumptions it used (methodology, note, timing, period basis, discount rate, cash-flow revision) and `extension: true`. The UI labels this "Extension, not a playbook requirement". **Fixture (REQ-S08-019's acceptance, KBE-F's unit test):** outflow 1000 at t = 0 and inflows 300, 400, 500 at t = 1, 2, 3, at r = 0.100000. NPV = **−21.04** with `beginning_of_period` (exact −21.0368144…) and **−19.12** with `end_of_period` (exact −19.1243767…). ROI = 0.200000. Payback = period index 3. With no discount rate configured, NPV is not shown.

### 6. Authorization (permissions matrix §22)

| Operation group | Permission | Role defaults (`0087`) |
|---|---|---|
| Read restatements, reconciliation, reissue offers, financial metrics, cash flows | `transformation.read` in the transformation | every role holding it in scope, AUD included |
| Read the financial-metric settings | session (an organization-wide configuration, shown beside every metric) | every signed-in user |
| Create, update, submit, withdraw a restatement | `kpi_restatement.request` | TL, BO, FIN, KDS |
| Decide a restatement | `kpi_restatement.approve` (**business_approval**) | SP, BO, FIN; never the requester |
| Switch the financial extension on or off | `financial_metrics.enable` (configure) | ADM_METHOD |
| Set the assumptions and the cash flows | `financial_metrics.define` (write) | FIN |
| Formula preview | session and CSRF (writes nothing; a `formulaVersionId` input re-checks `transformation.read` of its formula) | every signed-in user |

AUD gets 403 on every write. TL holds no business-approval code (ADR-0039 §9). The technical administrators hold no `business_approval` code (the `0005` trigger refuses it); ADM_METHOD's only grant here is the on/off switch. Every mutation re-checks its permission and scope inside its transaction, validates, needs `If-Match` (428 missing, 409 stale; the creates `createKpiRestatement` and the `"0"` puts create version 1), writes one audit event per mutated row of `kpi_restatement`, `financial_metric_setting` and `financial_cash_flow_set`, and does no remote I/O inside the transaction. The append-only children (periods, reconciliation, offers, cash-flow rows) carry no audit event of their own; the parent's event covers them (the `report_snapshot_source` precedent).

### 7. Locks, events and jobs

- Lock **730266** `kpiRestatement`, key `<kpiDefinitionId>`: create, submit, decide, withdraw and apply. The trigger `kpi_restatement_guard` takes it on every write (`pg_advisory_xact_lock(730266, hashtext(kpi_definition_id::text))`), and so does the API before reading for the reconciliation; 730269 is reserved.
- Outbox event `kpi_restatement.approved` (schema_version 1), consumed once by `apps/worker/src/handlers/kpi.ts` (KBE-E2's lines).
- Work-item kinds: `kpi_restatement_to_decide` (My Work **Approvals**) and `report_reissue_offer` (My Work **Assigned actions**; `0085`).

### 8. Refusal codes and English texts (exact)

| Status | Code | English text (exact) |
|---|---|---|
| 403 | `kpi_restatement.no_authority` | Only a person who holds the restatement approval right in this transformation can decide a restatement. |
| 403 | `kpi_restatement.self_decision` | The requester of a restatement cannot decide it. |
| 409 | `kpi_restatement.open_exists` | This KPI already has a restatement in progress. |
| 422 | `kpi_restatement.version_not_approved` | A restatement applies an approved KPI version (active or superseded) of this KPI. |
| 422 | `kpi_restatement.periods_required` | Select at least one closed reporting period to restate. |
| 422 | `kpi_restatement.too_many_periods` | A restatement covers at most 24 reporting periods. |
| 422 | `kpi_restatement.period_not_closed` | Only closed reporting periods of the KPI's frequency can be restated; an open period takes the new version from now on. |
| 422 | `kpi_restatement.nothing_to_reconcile` | None of the selected periods has a value to restate. |
| 422 | `kpi_restatement.not_draft` | Only a draft restatement can be changed or submitted. |
| 422 | `kpi_restatement.not_submitted` | Only a submitted restatement can be decided. |
| 422 | `kpi_restatement.not_withdrawable` | A decided restatement cannot be withdrawn. |
| 422 | `kpi_restatement.note_required` | A rejection needs a note. |
| 422 | `financial_metrics.assumptions_incomplete` | Set the methodology statement, timing and period basis together. |
| 422 | `financial_metrics.discount_rate_invalid` | The discount rate is a decimal fraction from 0 to 1 per period (0.10 = 10%). |
| 422 | `financial_cash_flows.currency_mismatch` | Cash flows are entered in the business case currency. |
| 422 | `financial_cash_flows.periods_invalid` | Cash flows need one row per period index from 0, with no gap and at most 121 rows. |
| 422 | `change_request.retrospective_not_supported` | A change request takes effect from now on; restate closed periods through a KPI restatement. *(DG4 code; new text, §3)* |

The formula preview returns the engine's own ADR-0024 §6 codes and texts (`formula.*`) and adds none. A `notComputable` result is a value state, not an error. Generic codes (400, 401, 403 `forbidden`, 404, 409 `version_conflict`, 428 `precondition_required`) are ADR-0007's. KBE-E/KBE-F map the database constraints above to these codes in `platform/db-errors.ts` (P5 lines) where reaching them is not a programming error.

### 9. Decimal and Unknown semantics

KPI values, targets and differences are `numeric(24,6)` decimal strings, the DG4 rule. A reconciliation row without a value has `value_status`/`rag` `unknown`, `stale`, `not_computable` or `none`, and no number. Cash flows are `numeric(20,4)`; the discount rate is `numeric(9,6)`; NPV, ROI and payback are computed with decimal.js and returned as decimal strings (NPV to 2 decimals, ROI to 6 decimals, payback as an integer period index) with their unit kind (`currency` + currency for NPV, `ratio` for ROI, `count` of periods for payback; ADR-0037 N5). A metric that is not shown or not computable is `null` with its reason, never 0.

## Alternatives considered

1. **Restate by updating the closed period's evaluations.** Rejected: `kpi_evaluation` is append-only (ADR-0028), and M0163 requires a retained reconciliation. A new run with new evaluations keeps both.
2. **Restate through the DG4 change request** (a `proposed_change` with past periods). Rejected: ADR-0036's apply step is synchronous and prospective, and its approval route has no period selection or reconciliation. A separate record keeps DG4 change requests unchanged, except for one text (§3).
3. **A `kpi_version.effective_from` column.** Not needed: the first evaluation records it, and a new column on a DG4 table would add a guard surface without an acceptance need.
4. **Derive NPV cash flows from benefit values.** Rejected: benefit values carry value bases (revenue uplift, avoided cost, …) that must not be summed into cash (D-117, D-119, D-122). Explicit Finance-entered cash flows keep the assumptions visible.
5. **A discount rate per business case.** Deferred: M0174 asks for "explicitly defined … assumptions". One organization-wide set, shown beside every metric, is the smallest explicit model. A per-case override is a later extension.

## Consequences

- One restatement in progress per KPI serializes restatements of a KPI. A second one waits for the first to be applied, rejected or withdrawn.
- §1 changes when a version activated between periods is first evaluated. The orchestrator decides the reopen (§1).
- A restatement makes report reissue an offer, never automatic. An issued pack stays as issued until a person reissues it.

## Verification

- **Database (probe, 157/157 PASS on PostgreSQL 16.13):** groups KR, KP, KC, CR, EV, KO, FS, CF, S06 and AO in `docs/delivery/handbacks/DG5/T-DG5-ARCH-05-evidence/probe-output.txt`, plus G00–G05 (migrations fresh and over P4 data).
- **Catalogue and seed pins:** `packages/db/test/integration/catalogue.test.ts` (tables, the slice G triggers, the two added DG4 triggers, grants, mutable `version` tables), `packages/db/src/seed.test.ts` (`0087` equals `P5_KPI_LAUNCH_HEALTH_PERMISSIONS`/`_ROLE_PERMISSIONS`; one approval code; approvers SP, BO, FIN), `apps/api/src/modules/platform/advisory-locks.test.ts` (730266–730268 distinct and equal to the migration constants).
- **Implementer tests (literal, p5-work-split §G):**
  - REQ-S07-016: (a) a target change approved and activated while Q2 is `scheduled` leaves Q1's latest evaluation and RAG unchanged; (b) deciding a submitted Q1 restatement as a user without `kpi_restatement.approve` gives 403 `kpi_restatement.no_authority`, and as its requester 403 `kpi_restatement.self_decision`, both writing nothing; (c) after approval the Q1 report snapshot issued earlier returns its old content and versions unchanged, a reissue offer exists, and `reissueReportSnapshot` plus issue gives `issueVersion` 2.
  - REQ-S08-005: the `revenue_uplift` preview shows unit SAR and edge case `arpu` missing → `not_computable`.
  - REQ-S08-019: with no discount rate NPV is `null` (`discount_rate_missing`); with 0.10 the fixture gives −21.04 (`beginning_of_period`).
  - For every mutation: AUD 403, `If-Match` 428/409, one audit event, commit-time re-authorization.
