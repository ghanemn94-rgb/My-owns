# ADR-0030: Benefit values and measurements, the Finance validation queue and decision, amendments and reversals, value states and totals counted once

- **Status:** Proposed for P4 (DG4). Author: solution-architect (T-DG4-ARCH-03), 2026-10-09.
- **Requirements:** REQ-PB-013, REQ-S07-014, REQ-S08-001, REQ-S08-004, REQ-S08-006, REQ-S08-008, REQ-S08-009 (totals), REQ-S08-011, REQ-S08-015, REQ-S08-016, REQ-S08-017, REQ-S12-014, REQ-S16-025, and the value half of REQ-S16-017 (slice B of `docs/architecture/p4-plan.md`). The register, lifecycle, allocations, groups, overlaps, scenarios and valuation methods are in ADR-0029.
- **Sources (quoted where a design point has one):** master prompt M0162 ("If Finance validation is required, new benefit values remain pending rather than automatically becoming validated realized value."), M0166 ("Track planned, forecast, measured, submitted-for-validation, validated, rejected and sustained values separately."), M0168 ("Provide a safe formula builder using a restricted expression language and typed variables. Never evaluate arbitrary user-supplied code. … Version formulas and preserve the calculation lineage: input actuals, source versions, assumptions, rates, period and formula version."), M0171 ("Cost reduction = eligible volume × reduction in unit cost for the same period, with a validated comparison basis."), M0172 ("Show gross benefits, implementation cost and net value separately; do not automatically subtract the same cost at both initiative and transformation level."), M0174 ("Finance validation must include baseline, attribution/counterfactual, calculation, evidence, measurement period and assumptions. Measure-only submissions do not increase the validated total until approved. Corrections create amendments/reversals linked to the original record."), M0234 ("Benefit evidence submitted | Route to the Finance/value validation queue"), M0323 (§16 entities), M0329 ("Preserve financial precision with decimal arithmetic."); playbook B0018 ("Finance / Value Office | Validates baseline, benefit logic, value realization."), B0084 ("Finance should validate the baseline and benefit logic early—not after delivery."), B0123 (T14 Realized).
- **Decisions applied:** D-088 §2; D-089 (seam 5: `packages/shared/src/formula/**` reused unchanged; R5: the starter automation is a code-defined handler, its rule-builder configurability is DG5's REQ-S12-001/-002).
- **Builds on:** ADR-0024 §6 (formula engine, `benefit_calculation` lineage with `rounding`), ADR-0025 §3–§4 (job kit `runOnce`, `createWorkItemOnce`), ADR-0027 §6–§8 (KPI actual value versions; `kpi.values_recalculated`; the `DownstreamImpactProvider`), ADR-0029.
- **Physical model:** `0038_p4_benefit_measurement_validation.sql`, `0039_p4_benefit_value_views.sql`. Guard probe ids below refer to `docs/delivery/handbacks/DG4/T-DG4-ARCH-03-evidence/probe-output.txt`.
- **Two gate systems.** A Finance validation is a decision by a named Finance user inside the product. No agent, seed, job or trigger approves one: the worker only creates queue items and pending values. Nothing here reads or writes DG0–DG7.

## Context

ADR-0029 gives each canonical benefit its profile and lifecycle. This ADR stores the benefit's **values**, keeps their states apart, routes every submitted value to Finance, records the Finance decision with its six content items, makes validated values immutable with linked corrections, and defines totals that count each benefit once.

## Decision

### 1. Planned and forecast values (REQ-S08-001)

`benefit_plan_value` (0038): `(benefit, value_kind ∈ {planned, forecast}, period_start, period_end)` unique per benefit, kind and start (`benefit_plan_value_period_key`), with `amount` numeric(20,4) and/or `kpi_value` numeric(24,6) (at least one, CHECK `benefit_plan_value_present`), `currency` = the benefit's (`benefit_plan_value_currency`, probe P02). Non-financial amounts need an approved valuation method (`benefit_plan_value_unmonetised`, probe P01); a parent benefit has none (`benefit_plan_value_leaf_only`, probe PC02). Versioned and audited (probe P03). `createBenefitPlanValue` / `updateBenefitPlanValue` (`benefit.edit`). A change to the plan after a G4 approval is slice H's change control (REQ-S04-014); this ADR only stores the series.

### 2. Measurements (REQ-S16-017 "BenefitMeasurement"; REQ-S08-016)

`benefit_measurement` (0038), one row per measured value of a benefit for one measurement period:

- `measurement_no` 1, 2, 3… per benefit (`benefit_measurement_no_step`, probe M02); `kind` ∈ {`measurement`, `amendment`, `reversal`} (§4); `source` ∈ {`manual`, `kpi_recalculation`, `correction`}.
- Value: `amount` numeric(20,4) (financial; a non-financial amount needs an approved valuation method, `benefit_measurement_unmonetised`), `kpi_value` numeric(24,6) (the KPI actual of a non-financial benefit: "Realized [Actual]", B0123), or `missing_reason` (Unknown; never 0; CHECK `benefit_measurement_value_present`, `benefit_measurement_missing_shape`). `currency` = the benefit's (probe M05).
- Content of the six Finance items: `period_start`/`period_end` (the measurement period, required to leave draft: `benefit_measurement_period_required`, probe M03), `attribution` (attribution/counterfactual statement), `assumptions`, the calculation (`formula_version_id`, `benefit_calculation_id`, `benefit_measurement_input` rows, §5), evidence (`benefit_evidence` rows, §3), and the benefit's baseline (ADR-0029 §1).
- **Status machine** (trigger `benefit_measurement_guard`):

```
draft ──submit──► submitted ──Finance approve──► validated (final; corrections are new rows)
  │                   ├──Finance reject──► rejected (final; kept and shown)
  └─(edit)            └──newer KPI recalculation──► superseded (final; its queue item withdrawn)
```

  A new measurement of kind `measurement` starts `draft` or `submitted` (`benefit_measurement_status_step`); a measurement is only accepted while the benefit is at Measure, Correct or Sustain (`benefit_measurement_step`, probe M01: "a delivered enabler is not realized value"). A submitted row is frozen until Finance decides it (`benefit_measurement_submitted_frozen`, probe M09). A validated row is never edited (`benefit_measurement_validated_immutable`, probe M14). Rejected and superseded rows are final (`benefit_measurement_final`). `sustain_phase` is set by the trigger from the benefit's step at insert (corrections copy the original's), and cannot change.
- **Counted once per period:** at most one live (`draft`, `submitted`, `validated`) measurement of kind `measurement` per benefit and period (`benefit_measurement_period_key`, probe M07). A correction of a validated value is an amendment or reversal (§4), never a second measurement.
- **No validated value without Finance:** the deferred constraint trigger `benefit_measurement_decision_present` checks at COMMIT that a `validated` or `rejected` measurement has the matching `finance_validation` decision (same decider, approved amount = `validated_amount`), that a correction has its approved Finance correction record, and that a superseded one has no queued item (probes M08, M16). SoD: the decider is never the submitter (`benefit_measurement_validator_not_submitter`; `finance_validation_sod`, probe FV07).
- **Comparison basis (REQ-S08-008).** Validation is refused unless the benefit's baseline is Finance-validated and, when a formula version was used, that version is Finance-validated (`benefit_measurement_basis_validated`; probes M11, M12). Until then the read model labels the value `provisional` (`basis: "provisional"`) and it stays out of every validated total. The same period rule is in §5.
- API: `createBenefitMeasurement` (`benefit.measure`; BO, WL, KDS; body may `submit: true`), `updateBenefitMeasurement` (draft only; on a validated row **409** `benefit_measurement.validated_immutable`, the REQ-S08-017 acceptance), `submitBenefitMeasurement` (bodiless), `listBenefitMeasurements`, `getBenefitMeasurement` (with lineage, evidence and its validation).
- **Evidence on submit.** A `manual` submission needs at least one evidence link (`benefit_measurement.evidence_required`); a `kpi_recalculation` value carries its KPI lineage (§5) instead.

### 3. Evidence and the Finance queue automation (REQ-S12-014, REQ-PB-013)

- `benefit_evidence` (0038): append-only links benefit → evidence and optionally measurement → evidence (probe E02); a link to a measurement only while it is draft or submitted (`benefit_evidence_measurement_open`, probe E01). The evidence row itself is the DG2 `evidence` record (ADR-0018).
- **Submit transaction** (KBE-E, `benefits/measurements.ts`): authorization re-checked at commit, `If-Match`, lock **730233** (key: measurement id), status `submitted`, one audit event `benefit_measurement.submitted`, and one outbox event **`benefit.evidence_submitted`** (aggregate `benefit_measurement`, idempotency key `benefit.evidence_submitted:<measurementId>`, payload `{ benefitId, measurementId, transformationId }`). No remote I/O.
- **Handler** `benefits.finance_queue` (`apps/worker/src/handlers/benefits.ts`, `runOnce` with the event key; ADR-0025 §3), in one transaction under lock 730233: insert exactly one `finance_validation` row `kind = 'validation'`, `status = 'queued'`, `idempotency_key` = the event key, the content snapshot (§4) and `assignee_user_id` = the benefit's `finance_validator_user_id` (NULL = the transformation's FIN party); one audit event by the service actor; one `finance_validation_review` work item for the assignee (or the FIN party) through `createWorkItemOnce` (key `finance_validation:<financeValidationId>`).
- **Exactly once:** a replayed event finds the `processed_message` row and does nothing; a second insert for the same measurement or key is refused by `finance_validation_one_per_measurement` and `finance_validation_idempotency_key` (probes FV01, FV02). REQ-S12-014's "submitting benefit evidence creates exactly one item in the Finance validation queue; replaying the same event creates no second item" is these three mechanisms.
- **Queue read:** `listFinanceValidationQueue` (`transformation.read`; status filter; oldest first) and `getFinanceValidation`. Configurability of this starter automation in the rule builder is DG5 (REQ-S12-001/-002; D-089 R5).

### 4. The Finance decision and corrections (REQ-PB-013, REQ-S08-015, REQ-S08-016, REQ-S08-017; REQ-S16-017 "FinanceValidation")

`finance_validation` (0038):

- `content` jsonb: the immutable snapshot presented to the validator, an object with the six keys `baseline`, `attribution`, `calculation`, `evidence`, `measurementPeriod`, `assumptions` (CHECK `finance_validation_content_complete`, probe FV04; the API validates the snapshot with a zod schema before insert, so this is validated JSON, not a free blob). `measurement_period_start`/`_end` are copied from the measurement and required (CHECK `finance_validation_period_required`, probe FV03: "a validation lacking a measurement period is rejected").
- Six item decisions `baseline_decision`, `attribution_decision`, `calculation_decision`, `evidence_decision`, `period_decision`, `assumptions_decision` ∈ {accepted, rejected}, each with an optional note, and the overall decision: `queued → approved | rejected | withdrawn` (final; `finance_validation_status_step`, probe FV10). **Approve** needs all six accepted (`finance_validation_all_items_accepted`, probe FV05) and, for a financial value, `approved_amount` (`finance_validation_amount_shape`, probe FV08); **reject** needs all six decided, at least one rejected, and a note (`finance_validation_rejection_reason`, probe FV06). The snapshot never changes (`finance_validation_frozen`).
- **Decide** = `POST …/finance-validations/{id}/decision` (`finance.validate` = FIN only; a Business Owner gets the generic 403, REQ-PB-013 acceptance; an ADM-only user gets 403, REQ-S10-003; `If-Match`): in one transaction, lock 730233, the validation row and the measurement row are updated (`validated` with `validated_amount = approved_amount`, or `rejected`), two audit events whose actor is the deciding Finance user (`finance_validation.approved` / `.rejected` with the six items; `benefit_measurement.validated` / `.rejected`), the work item completed, and one outbox event `benefit.value_validated` or `benefit.value_rejected`. The audit event records the validator's identity (REQ-PB-013 "the audit event records validator identity").
- **REQ-S08-016:** submitting leaves the validated total unchanged (probe M06, "validated 0; submitted (pending) 250000.0000"); approval raises it by exactly the approved amount (probe M13: 0 → 240000.5000).
- **Corrections (REQ-S08-017).** A validated value is never edited in place (409). Finance (`finance.validate`) records:
  - **amendment** `POST …/finance-validations/{id}/amendments` `{ correctedAmount, reason }`: a new `benefit_measurement` row `kind = 'amendment'`, `corrects_measurement_id` = the original, `amount = validated_amount = correctedAmount − (original validated amount + earlier amendments)` (the signed delta), status `validated`, plus a `finance_validation` row `kind = 'amendment'`, `corrects_validation_id` = the original decision, `status = 'approved'` (decided by its Finance author);
  - **reversal** `POST …/finance-validations/{id}/reversals` `{ reason }`: the same with `kind = 'reversal'` and `amount = −(original + amendments)` (`benefit_measurement_reversal_amount`, probe M15), once per original (`benefit_measurement_already_reversed`, `benefit_measurement_one_reversal_key`, probe M18).
  Corrections keep the original's period and phase, are linked to the original, and all rows stay visible (probe M17: after an amendment of −500.5 the validated total is 239500.0000; after the reversal it is 0.0000, with three validated rows). One audit event per new row, actor the Finance author. A correction is a Finance-authored record and has no second reviewer in DG4; its author is the deciding Finance user named in both rows.

### 5. Calculation lineage and the safe formula builder (REQ-S08-004, REQ-S08-006, REQ-S08-008)

- **Engine reused unchanged** (seam 5): a financial measurement with a formula is computed by `validateFormula`/`evaluateFormula` of `@mth/shared/calc` (ADR-0024 §6: whitelist grammar to an AST, decimal evaluation, no `eval`/`Function`). REQ-S08-004's acceptance — a non-whitelisted function call or a JavaScript payload rejected at parse time, no `eval`/`Function` in the code — is the DG3 engine's existing behaviour and test set; slice B adds no evaluator and no grammar.
- **Lineage of each computed value:** one DG3 `benefit_calculation` row (formula version, `inputs` jsonb, assumptions, period, result, engine version, `rounding`), referenced by `benefit_measurement.benefit_calculation_id`, plus one append-only `benefit_measurement_input` row per variable bound to a KPI actual **value version** (`kpi_actual_id`, `kpi_value_no` → `kpi_actual_value`) with the value used (probe I02, I03). `getBenefitMeasurement` returns the formula version, the input actual versions, the rates and other variables (from the calculation inputs), the assumptions and the period. After a formula change, older measurements keep their `formula_version_id` (versions are immutable, ADR-0024).
- **Same period (REQ-S08-008):** every input has the measurement's period, and a KPI actual input belongs to a KPI actual slot with that period (`benefit_measurement_input_same_period`, probe I01).
- **KPI binding.** A benefit's `measurement_kpi_definition_id` and `measurement_kpi_variable` (ADR-0029 §1) bind one formula variable to the KPI's accepted actuals; the other variables keep their values from the formula version (`benefit_formula_variable.value`). Binding several KPIs to one formula is not in DG4.

### 6. Value states, the T14 Realized column and pending values (REQ-S08-001, REQ-S07-014, REQ-PB-075, REQ-PB-076)

View `benefit_value_line` (0039) tags every stored value with exactly one state:

| State | Rows | Amount |
|---|---|---|
| `planned`, `forecast` | `benefit_plan_value` of that kind | `amount` |
| `measured` | measurements (kind `measurement`) `submitted` or `validated` | measured `amount` |
| `submitted` (submitted for validation; pending) | measurements `submitted` | `amount` |
| `validated` | rows `validated` with `sustain_phase = false`, corrections included | `validated_amount` (signed) |
| `sustained` | rows `validated` with `sustain_phase = true` | `validated_amount` |
| `rejected` | measurements `rejected` | `amount` |

- **A total is always for one state** and never adds states together. `measured` overlaps `submitted` and `validated` by definition (it is what was measured); the totals service never adds it to them.
- **Forecast is never validated** (probe M21: with a 999 999 forecast the benefit's validated total is 0.0000 after the reversal). **Scenarios are never value lines** (ADR-0029 §10).
- **Rejected values stay visible** as `rejected` (probe M19).
- **REQ-S07-014 / REQ-S12-006 (pending after an accepted KPI actual).** Handler `benefits.recalculate_pending` consumes `kpi.values_recalculated` (ADR-0027 §8) with `runOnce`. For each active benefit at Measure, Correct or Sustain with `finance_validation_required` whose `measurement_kpi_definition_id` is in the run's KPI list, for the run's reporting period: compute the value (§5), insert one measurement `source = 'kpi_recalculation'`, `status = 'submitted'`, `submitted_by` NULL (system), `calculation_run_id` = the run, its lineage inputs, and its queue item (idempotency key `benefit.value_recalculated:<measurementId>`; same row shape as §3) in one transaction; an earlier `kpi_recalculation` measurement of the same benefit and period that is still `submitted` becomes `superseded` and its queue item `withdrawn` first. **At most one pending value per benefit and run** (`benefit_measurement_run_key`, probe K02) — the "one validation flag" of REQ-S12-006. The new value is pending and the validated total is unchanged (probe K01). A benefit before Measure gets no pending value (it has no measurement yet; ADR-0029 §2), and a benefit whose period already has a manual live measurement is left unchanged and listed in the handler's run log.
- **T14 Realized** (`listBenefits`, `getBenefitValues`): `validated` and `sustained` sums and the `pending` (= `submitted`) sum as separate decimal fields with their counts, each `{ status: "known", amount }`; a non-financial benefit without a valuation method shows Value (SAR) `not_applicable` and Realized = the latest accepted KPI actual of its agreed KPI (or Unknown).
- **REQ-S07-017 downstream.** KBE-E registers the slice A `DownstreamImpactProvider`: `financeReview = "pending"` when the KPI feeds at least one benefit with `finance_validation_required`, `"not_applicable"` when it feeds none.
- **Variance event for slice E.** After a value is validated or a pending value is created, KBE-E enqueues `benefit.variance_evaluated` (key `benefit.variance_evaluated:<measurementId>`, payload `{ benefitId, measurementId, periodStart, periodEnd, plannedAmount, measuredAmount, variance, offTrack }`); `offTrack` is `null` (Unknown) when the period has no planned value. Slice E owns the corrective-action rule (REQ-PB-085).

### 7. Totals counted once; classes; gross, cost and net (REQ-PB-058, REQ-S08-009, REQ-S08-011, REQ-S08-014, REQ-PB-076)

`getBenefitTotals` (transformation) and `getPortfolioBenefitTotals` (organization: the transformations the caller may read) are computed by KBE-E `benefits/totals.ts` with decimal.js from `benefit_value_line` joined to `benefit_counting`:

1. **Benefits counted:** `counted = true` only (ADR-0029 §6). A benefit is summed once whatever its allocations (probe T01: 10000000.0000 for a 10 M SAR benefit allocated to two initiatives); a parent is a roll-up container, so values are summed at the children once (probe T02).
2. **Lines:** one line per `value_class` × state × currency: `revenue_uplift`, `margin_uplift`, `cash_saving`, `avoided_cost`, `working_capital_release` and `non_financial_valued` (non-financial benefits with an approved valuation method), each with its own total. Revenue uplift and margin, and avoided cost and cash savings, are separate lines and are never converted into each other (REQ-S08-009: "cost avoidance is not counted in cash savings"). Currencies are never converted; each currency is its own block.
3. **Non-financial benefits without a valuation method** are counted in `nonFinancialCount` with Value n/a and are not part of any SAR line (REQ-PB-076: "excluded from SAR totals and not counted as zero"; probe T03).
4. **Open overlaps (REQ-S08-014):** values of a benefit with an open warning are excluded from the `validated` and `sustained` lines and reported on `pendingOverlap` lines instead.
5. **Excluded benefits** are listed with their exclusion reason and are never summed.
6. **Gross, implementation cost, net (REQ-S08-011):** `gross` per state (`planned`, `validated`) = the sum of that state's financial lines in a currency. `implementationCost` = the sum of the DG3 `business_case_line` investment lines (status `active`) of the transformation-level case **and** its initiative cases, each line once, split `cash` and `non_cash` (their DG3 `value_basis`). Every line belongs to exactly one business case (`business_case_line.business_case_id` NOT NULL), so a line recorded on an initiative case is subtracted once at transformation level (the acceptance: a 1 M SAR initiative cost reduces transformation net value by exactly 1 M SAR, not 2 M). `net = gross − implementationCost` per state and currency. A cost line with a NULL amount makes `implementationCost` and `net` Unknown (`{ status: "unknown", reason: "benefit.cost_amount_missing" }`), never 0. Initiative-level totals (`?initiativeId=`) show allocated shares (share × value, labelled `allocated`) and that initiative's own cost lines; they are views, never added to the transformation total.
7. **Responses:** every amount is a decimal string with its currency, and every line carries `count`. An empty state is `{ status: "known", amount: "0.0000", count: 0 }` (nothing in that state); a missing input is `{ status: "unknown", reason }`.

### 8. Decimal and Unknown (REQ-S16-025)

All money in slice B is numeric(20,4) and a decimal string in the API; KPI values and baselines numeric(24,6); shares numeric(7,6). Code uses decimal.js only (`FORMULA_DECIMAL` from `@mth/shared/calc` for formula results), never `Number`, for a money, rate or share value. Rounding happens only at presentation (ADR-0024 §6 rounding rule). The acceptance values hold in the database: 0.1 + 0.2 SAR = 0.3000 (probe D01) and 100000 × 0.02 × 50 = 100000.00 (probe D02); KBE-E repeats both in its unit tests of `totals.ts`. Unknown (`missing_reason`) is NULL, never 0, and is never validated (probe M20).

### 9. Authorization (permissions matrix §12)

| Operation | Permission (role defaults) | Record-level rule |
|---|---|---|
| Create/edit/submit a measurement, link evidence | `benefit.measure` (BO, WL, KDS) | — |
| Read the queue, a validation, values, totals | `transformation.read` (every role in scope, AUD included) | scope; 404 outside it |
| Decide a validation (approve/reject) | `finance.validate` (FIN only) | not the submitter (403 `finance_validation.sod_submitter`) |
| Amend or reverse a validated value | `finance.validate` (FIN only) | — |
| Every write, for AUD and ADM-only users | — | 403 |

### 10. Contract (OpenAPI 1.3.0-p4)

45 slice B operations (ADR-0029 and this ADR) under the tags `benefits` (14), `benefit-allocations` (2), `benefit-groups` (4), `benefit-overlaps` (4), `benefit-scenarios` (6), `benefit-valuation-methods` (3), `benefit-measurements` (5), `finance-validations` (5) and `benefit-totals` (2), listed in `apps/api/test/support/p4-pending-kbe-d.ts` (16), `p4-pending-kbe-d2.ts` (13) and `p4-pending-kbe-e.ts` (16) (p4-work-split §B). Every mutation of an existing record needs `If-Match`; every list is cursor-paginated; errors are `application/problem+json`; every request body is `application/json`; the bodiless action POST `submitBenefitMeasurement` declares none. Six values are appended to the response-only `PermissionCode` enum.

### 11. Refusal codes and English texts (exact; S-11)

| Status | Code | English `detail` |
|---|---|---|
| 422 | `benefit_measurement.step` | "Benefit {benefitCode} is at the {step} step. Measurements start at Measure; a delivered enabler is not realized value." |
| 422 | `benefit_measurement.period_required` | "A measurement needs its measurement period before it is submitted." |
| 409 | `benefit_measurement.period_taken` (`urn:mth:problem:duplicate`) | "Benefit {benefitCode} already has a live measurement for {periodStart} to {periodEnd}. Correct that one instead." |
| 422 | `benefit_measurement.value_shape` | "Enter an amount, a KPI value, or why the value is not available." |
| 422 | `benefit_measurement.evidence_required` | "A measurement is submitted with at least one piece of evidence." |
| 422 | `benefit_measurement.not_draft` | "Only a draft measurement can be changed or submitted." |
| 409 | `benefit_measurement.validated_immutable` (`urn:mth:problem:invalid-transition`) | "A validated value is never edited. Record an amendment or a reversal." |
| 422 | `benefit_measurement.lineage_period` | "Every input is for the measurement period {periodStart} to {periodEnd}." |
| 422 | `benefit_value.currency_mismatch`, `benefit_value.unmonetised`, `benefit_value.parent_rollup` | as in ADR-0029 §11 |
| 403 | `finance_validation.sod_submitter` | "You submitted this value, so you cannot validate it." |
| 422 | `finance_validation.content_incomplete` | "A Finance decision covers all six items: baseline, attribution/counterfactual, calculation, evidence, measurement period and assumptions. Missing: {missing}." |
| 422 | `finance_validation.not_queued` | "Only a queued item can be decided." |
| 422 | `finance_validation.items_not_accepted` | "An approval needs every item accepted. Reject the value instead, with a note." |
| 422 | `finance_validation.rejection_note_required` | "A rejection needs a note and at least one rejected item." |
| 422 | `finance_validation.approved_amount_required` | "Approving a financial value states the approved amount; a non-financial value has none." |
| 422 | `finance_validation.basis_provisional` | "The comparison basis is not validated by Finance, so this value is provisional. Validate the benefit's baseline and its formula version first." |
| 422 | `finance_validation.not_approved` | "Only an approved validation can be amended or reversed." |
| 422 | `finance_validation.already_reversed` | "This value is already reversed." |
| 422 | `finance_validation.reason_required` | "A correction needs a reason." |
| 422 | `finance_validation.amendment_unchanged` | "The corrected amount equals the current validated amount." |

Database last-line mappings for `platform/db-errors.ts` (KBE-E adds them): `benefit_measurement_step` → `benefit_measurement.step`; `benefit_measurement_period_required` → `benefit_measurement.period_required`; `benefit_measurement_period_key` → 409 `benefit_measurement.period_taken`; `benefit_measurement_value_present`, `benefit_measurement_missing_shape` → `benefit_measurement.value_shape`; `benefit_measurement_status_step`, `benefit_measurement_final`, `benefit_measurement_submitted_frozen` → `benefit_measurement.not_draft`; `benefit_measurement_validated_immutable` → 409 `benefit_measurement.validated_immutable`; `benefit_measurement_input_same_period` → `benefit_measurement.lineage_period`; `benefit_measurement_basis_validated` → `finance_validation.basis_provisional`; `benefit_measurement_currency` → `benefit_value.currency_mismatch`; `benefit_measurement_unmonetised` → `benefit_value.unmonetised`; `benefit_measurement_leaf_only` → `benefit_value.parent_rollup`; `benefit_measurement_validator_not_submitter`, `finance_validation_sod` → 403 `finance_validation.sod_submitter`; `finance_validation_period_required`, `finance_validation_content_complete` → `finance_validation.content_incomplete`; `finance_validation_status_step` → `finance_validation.not_queued`; `finance_validation_all_items_accepted` → `finance_validation.items_not_accepted`; `finance_validation_rejection_reason` → `finance_validation.rejection_note_required`; `finance_validation_amount_shape` → `finance_validation.approved_amount_required`; `benefit_measurement_correction_target` → `finance_validation.not_approved`; `benefit_measurement_already_reversed`, `benefit_measurement_one_reversal_key` → `finance_validation.already_reversed`; `finance_validation_kind_shape`, `benefit_measurement_correction_shape` → `finance_validation.reason_required`; `benefit_measurement_run_key`, `finance_validation_one_per_measurement`, `finance_validation_idempotency_key` → handled by the worker as "already done" (no problem response); `*_version_step` → 409; `*_audit_required`, `benefit_measurement_decision_present`, `benefit_measurement_no_step`, `benefit_measurement_identity_fixed`, `benefit_measurement_reversal_amount`, `benefit_measurement_correction_period`, `finance_validation_subject`, `finance_validation_frozen`, `benefit_measurement_input_open`, `benefit_evidence_measurement_open` → 500 (a programming error; the service checks them first).

### 12. REQ-S16-017: the entity group

| §16 entity | Table(s) | Primary key | Owner | Status |
|---|---|---|---|---|
| BusinessCase | `business_case` (DG3, ADR-0024) | `id` | `benefit_owner_user_id`, `initiative_owner_user_id`; author `created_by` | `draft`, `archived` |
| Scenario | `benefit_scenario` (+ `benefit_scenario_value`) | `id` | author `created_by` | `active`, `archived` |
| Benefit | `benefit` (+ `benefit_enabler`, `benefit_lifecycle_event`) | `id` (`code` unique per transformation) | `owner_user_id` | `lifecycle_step`; `active`, `archived` |
| BenefitAllocation | `benefit_allocation` | `id` (`benefit_id`, `set_no`, `initiative_id` unique) | the benefit's owner; author `created_by` | set in force = `benefit.allocation_set_no` |
| BenefitFormulaVersion | `benefit_formula_version` (DG3) | `id` (`formula_id`, `version_no` unique) | author `created_by`; validator `validated_by` | `unvalidated`, `validated`, `rejected` |
| BenefitMeasurement | `benefit_measurement` (+ `benefit_measurement_input`, `benefit_evidence`) | `id` (`benefit_id`, `measurement_no` unique) | submitter `submitted_by`; the benefit's owner | `draft`, `submitted`, `validated`, `rejected`, `superseded` |
| FinanceValidation | `finance_validation` | `id` | `assignee_user_id`; decider `decided_by` | `queued`, `approved`, `rejected`, `withdrawn` |

The REQ-S16-017 integration test (KBE-E, `test/integration/benefits/entity-group.test.ts`) creates and reads each through the API with authorization enforced: BusinessCase and BenefitFormulaVersion through the DG3 operations; Scenario, Benefit, BenefitAllocation and BenefitMeasurement through `createBenefitScenario`, `createBenefit`, `replaceBenefitAllocations` and `createBenefitMeasurement`; FinanceValidation by submitting a measurement and running the `benefits.finance_queue` handler in the test (it has no create operation), then `getFinanceValidation`; an AUD caller gets 403 on each mutation and 200 on each read.

## Alternatives considered

- **One value table with a state column that changes.** Rejected: a validated value must stay immutable and a correction must be a linked row (M0174); separate kinds of rows give "both records remain visible".
- **Create the queue item inside the submit transaction.** Rejected for DG4: REQ-S12-014 is a starter automation on the "benefit evidence submitted" event (M0234), whose replay must create nothing; the outbox event and an idempotent consumer are the ADR-0025 kit. The unique index makes the item exactly-once either way.
- **Auto-validate values of a formula already validated by Finance.** Rejected: M0162 "new benefit values remain pending rather than automatically becoming validated realized value".
- **Sum validated and sustained into one "realized" total.** Rejected by M0166 ("separately"); the read model returns both, labelled.
- **Subtract cost at each level.** Rejected (M0172): costs are summed per line, and each line belongs to one business case.

## Consequences

- Five tables for this ADR (`benefit_plan_value`, `benefit_measurement`, `benefit_measurement_input`, `benefit_evidence`, `finance_validation`; migration 0038 also holds `benefit_overlap` of ADR-0029 §7) and one view (`benefit_value_line`), two outbox events (`benefit.evidence_submitted`, `benefit.variance_evaluated`) and the consumed `kpi.values_recalculated`, two worker consumers (`benefits.finance_queue`, `benefits.recalculate_pending`), one lock class for the queue (730233).
- A value cannot be validated before its baseline (and formula version, when one is used) is validated by Finance: Finance validates the basis first (B0084 "early").
- KBE-E owns the totals arithmetic; the database supplies the counted set and the state of each value, so a second consumer (slice J dashboards) reads the same view and cannot count differently.

## Verification

- Probe (`probe.ts`, `probe-output.txt`): every constraint named above has a probe id (M01–M21, FV01–FV10, K01–K02, I01–I03, E01–E02, T01–T03, D01–D02).
- `catalogue.test.ts` pins the triggers (incl. the deferred `benefit_measurement_decision_present`), the versioned tables and the grants; the views are pinned in `VIEW_NAMES`.
- KBE-E's integration tests prove the API half: queue exactly once on replay (REQ-S12-014), 403 for BO, AUD and ADM-only on the Finance endpoints, 409 on an in-place edit of a validated value, the entity-group test (§12), and the totals examples (§7, §8).

## Amendment (2026-10-09, T-DG4-ARCH-R1): codes and keys added outside the ADR

### A1. Codes and keys added outside the ADR's refusal table (accepted, with their exact English texts)

| Code or key | Kind | Decision | English text (exact) |
|---|---|---|---|
| `benefits.task.finance_validation_review` | message key | accepted | Validate the value of {benefitCode} for {periodStart} to {periodEnd}. |
| `kpi.downstream.benefit` | label key | accepted | Benefit measured by this KPI |

## Amendment (2026-10-10, T-DG4-ARCH-R2): reading one plan value for its version

### P1. `getBenefitPlanValue` (FE-C handback decision 1; KBE-R2 handback §5.1 item 3)

**The gap.** `updateBenefitPlanValue` needs `If-Match`. The only read of plan values is `getBenefitValues`, whose `BenefitValueLine` has `recordId` but no `version` and sets `additionalProperties: false`. So no client can learn the current version of an existing plan value, and `createBenefitPlanValue`'s `Location` (`…/benefit-plan-values/{id}`) has no read behind it.

**Decided: a plan-value read, not `version` on the line.**

- `GET /api/v1/transformations/{transformationId}/benefit-plan-values/{benefitPlanValueId}`, operation `getBenefitPlanValue`, tag `benefits`, permission `transformation.read` (§9: "values" are read with `transformation.read`, AUD included; 404 outside scope).
- 200 `BenefitPlanValue` (the schema the create and the update already return, with `version`, `note` and `valueKind`) and `ETag` = the row's `version`. 404 when the id is not a `benefit_plan_value` row of that transformation. 400 for a malformed id; 401; 429. A read: no write, no audit event.
- **Edit flow (FE):** the values screen takes `recordId` from a `benefit_plan_value` line of `getBenefitValues`, calls `getBenefitPlanValue` to get the record and its `ETag`, and sends that ETag as `If-Match` to `updateBenefitPlanValue`. A 409 shows the current version (the platform conflict pattern).

**Why not `version` on `BenefitValueLine`:**
1. It changes the response of an existing operation (`getBenefitValues`) and a shared schema that also describes `benefit_measurement` lines, whose edits go through their own record reads.
2. The line does not carry `note` and `valueKind` in edit form, so an edit form would still need a record read.
3. The single read also makes `createBenefitPlanValue`'s `Location` resolve, the precedent of `getAdoptionMetricLink` (ADR-0033 amendment of 2026-10-09) and `getInheritedRecord` (ADR-0038 amendment B3).

`getBenefitValues` and `BenefitValueLine` are unchanged. Pending in `apps/api/test/support/p4-pending-arch-r2.ts` until a kpi-benefits-engineer task routes it in KBE-E's `benefits` files and exercises it in the contract test.
