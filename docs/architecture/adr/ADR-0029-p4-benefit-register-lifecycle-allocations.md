# ADR-0029: Benefit register (T14), the six-step benefits lifecycle, enablers, allocations, shared-benefit groups, overlap warnings, scenarios and valuation methods

- **Status:** Proposed for P4 (DG4). Author: solution-architect (T-DG4-ARCH-03), 2026-10-09.
- **Requirements:** REQ-PB-058, REQ-PB-074, REQ-PB-075, REQ-PB-076, REQ-S08-002, REQ-S08-003, REQ-S08-009 (classes), REQ-S08-010, REQ-S08-013, REQ-S08-014, REQ-S08-018, and the register half of REQ-S16-017 (slice B of `docs/architecture/p4-plan.md`). Values, measurements, Finance validation, corrections, totals and the queue automation are in ADR-0030.
- **Sources (quoted where a design point has one):** playbook B0018 ("Finance / Value Office | Validates baseline, benefit logic, value realization."), B0084, B0088 ("Each benefit should have a unique owner, baseline, formula and link to financial statements or an agreed non-financial KPI."), B0120/B0121 (the six steps, their questions and outputs), B0122/B0123 (Template 14, ten columns, IDs B01…, the CX row "n/a | [Actual]"); master prompt M0166 ("Implement the source benefits lifecycle: Identify → Plan → Enable → Measure → Correct → Sustain … A delivered capability is an enabler, not proof of realized value."), M0167 (the profile fields), M0172 ("Keep revenue uplift separate from profit or margin benefit. Keep avoided cost separate from cash savings. Do not monetize CX or other non-financial benefits without an approved valuation method."), M0173 ("Prevent double counting using a canonical benefit register, parent/child relationships, shared-benefit groups and contribution allocations. Portfolio aggregation counts a shared benefit once. Allocation totals must not exceed 100%; less than 100% must show an unallocated share. Warn about overlapping populations, periods and drivers, but require Finance to resolve economic overlaps that rules cannot determine."), M0174 ("Support base/upside/downside scenarios without mixing scenarios into reported actuals."), M0323 (§16 entity group).
- **Decisions applied:** D-088 §2 (claims enumerated and exactly true), D-089 (plan adopted; seam 17 "a benefit register that *replaces* the business-case roll-up would be a reopen candidate; none is planned"; seam 5 formula engine unchanged; seam 8 permissions additive).
- **Builds on:** ADR-0003 (ids, versions, `If-Match`), ADR-0004 (audit), ADR-0006 (authorization), ADR-0016 (P2 guards, lock registry §6), ADR-0019 (decimal and Unknown), ADR-0024 (business case lines, T09 formulas and versions, the restricted formula engine §6), ADR-0025 (work items), ADR-0027 (KPI definitions and actuals).
- **Physical model:** `0037_p4_benefit_register.sql` (this ADR), `0038_p4_benefit_measurement_validation.sql` (the overlap table, §7, and the value-lock triggers, §2), `0039_p4_benefit_value_views.sql` (counting view, §6), `0040_p4_benefit_permissions.sql` (§9). Guard probe: `docs/delivery/handbacks/DG4/T-DG4-ARCH-03-evidence/probe-output.txt` (probe ids below).
- **Two gate systems.** Finance validation and valuation-method approval are decisions of named Finance users inside the product (`finance.validate`). No agent, seed, job or trigger takes such a decision. Nothing here reads or writes DG0–DG7.

## Context

DG3 built the business case (`business_case`, `business_case_line` with exactly one class per line and the value bases `revenue_uplift`, `margin_uplift`, `cash_saving`, `avoided_cost`, `working_capital_release`, `non_financial`), the T09 benefit formulas with immutable, Finance-validated versions (`benefit_formula`, `benefit_formula_version`), and the lineage row `benefit_calculation` (ADR-0024). It built no benefit register: there is no T14 row, lifecycle, allocation, group, overlap or scenario. P4 adds them **beside** the business case: a business-case benefit line can back at most one register benefit (`benefit_one_case_line_key`), and the DG3 roll-up of business-case lines is unchanged (seam 17, additive).

## Decision

### 1. The canonical benefit row (REQ-PB-075, REQ-S08-003, REQ-PB-058, REQ-S16-017 "Benefit")

Table `benefit` (0037). One row per canonical benefit of a transformation. The T14 columns (B0123) and the M0167 fields map as follows:

| Source field | Column(s) |
|---|---|
| T14 ID ("B01, B02…") | `code`, pattern `^B[0-9]{2,6}$`, unique per transformation (`benefit_code_key`; probe B18), allocated from `record_code_counter` prefix `B` (the 0020 widening precedent; probe G04 shows existing counters unchanged) |
| T14 Benefit; benefit profile (Identify output) | `title`, `description` (both required) |
| T14 Type ("Revenue \| Cost \| CX \| ...") | `benefit_type` ∈ {`revenue`, `cost`, `working_capital`, `cx`, `risk`, `strategic`, `other`} |
| value class (M0172, REQ-S08-009) | `value_class` ∈ {`revenue_uplift`, `margin_uplift`, `cash_saving`, `avoided_cost`, `working_capital_release`, `non_financial`} — the DG3 `value_basis` names. CHECK `benefit_type_fits_class`: revenue → revenue_uplift \| margin_uplift; cost → cash_saving \| avoided_cost; working_capital → working_capital_release; risk → avoided_cost \| non_financial; cx, strategic, other → non_financial (probe B05) |
| accountable business owner; T14 Owner | `owner_user_id` NOT NULL — one column, so a benefit has exactly one owner |
| Finance validator where applicable | `finance_validator_user_id` (nullable; never the owner, CHECK `benefit_validator_not_owner`, probe B19) |
| baseline / counterfactual; T14 Baseline | `baseline_value` + `baseline_unit` + `baseline_date`, or `baseline_id` (a DG2 baseline record); `counterfactual`; Finance validation of the baseline in `baseline_validation_status`/`_by`/`_at`/`_note` (§8) |
| formula | `benefit_formula_id` (a T09 formula; its versions are DG3's) and `measurement_kpi_variable` (the one formula variable fed by the measurement KPI, ADR-0030 §5) |
| driver units; overlap keys | `driver_units`; `driver_key`, `population_key` (normalised keys used by the overlap rule, §7) |
| target; T14 Target | `target_value`, `target_date` |
| timing | `realization_start`, `realization_end` |
| one-off / recurring | `recurrence` ∈ {`one_off`, `recurring`} |
| currency | `currency` char(3), per row (S-5) |
| T14 Value (SAR) | `planned_value` numeric(20,4); NULL = n/a for a non-financial benefit, Unknown for a financial one |
| measurement source; agreed non-financial KPI | `measurement_source`; `measurement_kpi_definition_id` |
| confidence; assumptions | `confidence` ∈ {H, M, L}; `assumptions` |
| contribution links | `benefit_allocation` (§5), `parent_benefit_id` (§6), `benefit_group_id` (§6), `benefit_enabler` (§3), `business_case_line_id` |
| financial-statement mapping | `financial_statement_line` |
| T14 Evidence | `benefit_evidence` (ADR-0030 §4) |
| T14 Realized | computed from the value series (ADR-0030 §6); never stored |
| T14 Status R/A/G | `status_rag` ∈ {green, amber, red} + `status_rag_note`; NULL is shown as Unknown, never green |

**Database rules on the row** (each a named constraint; the API checks the same rule first and returns the §11 code):

1. `benefit_mapping_required`: a financial class needs `financial_statement_line` (probe B03).
2. `benefit_kpi_required`: `non_financial` needs `measurement_kpi_definition_id` (probe B04).
3. `benefit_non_financial_unmonetised`: `non_financial` with a `planned_value` needs `valuation_method_id`; `benefit_valuation_method_approved` (trigger) needs that method `approved` and in the benefit's currency (probes B06, B07, B08).
4. `benefit_valuation_only_non_financial`: only a non-financial benefit references a valuation method.
5. `benefit_financial_needs_validation`: a financial benefit always has `finance_validation_required = true` (REQ-S07-014 "when Finance validation is required").
6. `benefit_kpi_variable_bound`: `measurement_kpi_variable` needs both a measurement KPI and a formula.
7. `benefit_baseline_validator_not_owner` (probe B20) and `benefit_baseline_validated_frozen` (trigger): a validated or rejected baseline changes only in the same update that resets it to `unvalidated` (probe B21).
8. `benefit_case_line_valid` (trigger): `business_case_line_id` names a benefit line of the same transformation; `benefit_one_case_line_key`: one active benefit per line.
9. `benefit_measure_locked` (trigger, 0038): once a benefit has a measurement, plan value or scenario value, its `benefit_type`, `value_class` and `currency` are fixed (probe M21).
10. P2 guards (`p2_attach_guards('benefit', true)`): version 1 on insert and +1 per update (probe B09), identity immutable, deferred audit coverage at COMMIT (probes B01, B22).

**REQ-PB-058 enforcement points (interpretation, stated for the reviewers).** The acceptance text says the system "rejects a benefit without a single owner, baseline, formula and a financial statement line or agreed non-financial KPI". The six-step lifecycle (REQ-PB-074) makes baseline, formula and target the *Plan* outputs, so a benefit can exist at Identify without them. This ADR enforces the row's rule in two places, both exact:
- **at create and on every update:** one owner (`ownerUserId` is a single uuid in the contract; a body that names two owners — an array, or any second owner field — fails schema validation with 400 `urn:mth:problem:validation`), and the statement line or agreed KPI (422 `benefit.mapping_required` / `benefit.kpi_required`);
- **before Enable and Measure, and before any value is recorded:** baseline, formula (financial classes; for `non_financial` the agreed KPI is the measure) and target (CHECK `benefit_plan_outputs_present`; 422 `benefit.plan_outputs_missing`). A measurement can only be recorded from Measure on (ADR-0030 §2), so no benefit without the Plan outputs ever has a measured, validated or sustained value.

### 2. The lifecycle (REQ-PB-074, REQ-S08-002)

`benefit_lifecycle_step_definition` (0037) seeds the six B0121 rows **verbatim** in English (step, question, output) with a provisional Arabic translation (`ar_is_provisional = true`), e.g. Plan — "How will it be measured, when, and by whom?" — "Baseline, formula, target, owner" (probe S01).

```
identify ──► plan ──► enable ──► measure ──► sustain
                                  │  ▲
                                  ▼  │
                                 correct
```

- A new benefit starts at `identify` (probe B10). Allowed moves: identify→plan, plan→enable, enable→measure, measure→correct, correct→measure, measure→sustain; every other change is refused by trigger `benefit_guard` (constraint `benefit_lifecycle_step`; probe B11). No step follows `sustain` in DG4.
- **Preconditions = the source outputs** (all enforced in the database as well as the API):

| Entering | Needs (B0121 output) | Constraint | Probe |
|---|---|---|---|
| plan | the benefit profile (title, description, type, class, owner, statement line or KPI: always present on a row) | NOT NULL + §1 rules | B02 |
| enable, and every later step | baseline (`baseline_value` or `baseline_id`), formula (`benefit_formula_id`; not required for `non_financial`), target (`target_value`), owner | CHECK `benefit_plan_outputs_present` | B12 |
| measure (from enable) | at least one active `benefit_enabler` row (the benefit dependency chain) | trigger, `benefit_enablers_required` | B13, B14 |
| correct | `recovery_plan` | CHECK `benefit_correct_output_present` | B16 |
| sustain | `bau_owner_user_id` and `control_cadence` ∈ {monthly, quarterly, semiannual, annual} | CHECK `benefit_sustain_outputs_present` | B15 |

- The literal acceptance "a benefit cannot enter Measure without the Plan outputs; Sustain requires a BAU owner and control cadence" is the second and last rows. Because the Plan-output CHECK covers every step from `enable` on, the Plan outputs can also not be cleared later.
- **History.** Trigger `benefit_lifecycle_history` inserts one `benefit_lifecycle_event` row (from, to, benefit version, actor = `updated_by`) on insert and on every step change, so history cannot diverge from the row (probe B14: four rows for identify→plan→enable→measure). The table is append-only (probe B17) and covered by the benefit's audit event.
- **Advance** = `POST …/benefits/{benefitId}/lifecycle` with `{ toStep, note? }`, `benefit.advance` (BO), `If-Match` on the benefit. The step's output fields are set by `updateBenefit` (`benefit.edit`) before advancing.
- **REQ-S08-002 "a delivered capability is an enabler, not proof of realized value".** A delivered enabler changes no value: enablers have no amount, and measurements are refused before the Measure step (ADR-0030 §2, probe M01). The read model reports `realizationState` (§4): when every active enabler is delivered and the benefit has no measurement, the state is `enabled_not_yet_measured` and the validated amount is `0` with `validatedCount = 0` (nothing validated, which is a known zero, not missing data).

### 3. Enablers (the Enable output)

`benefit_enabler` (0037): benefit → initiative (required), optionally one of its deliverables (trigger `benefit_enabler_deliverable_initiative`, probe EN01) or a capability. An enabler is **delivered** when its deliverable's `acceptance_status = 'accepted'`, or, without a deliverable, when the initiative's status is `completed`. Rows are versioned and audited; only `note` changes, and `active → removed` is final (`benefit_enabler_frozen`). One active link per benefit, initiative, deliverable and capability (`benefit_enabler_active_key`).

### 4. The T14 register read model

`listBenefits` returns one row per benefit with the ten T14 columns: `code`, `title`, `benefitType`, `baseline` (value, unit, date, validation status), `target`, `valueSar` (`{ status: "known", amount }`, `{ status: "not_applicable" }` for a non-financial benefit without an approved valuation method, `{ status: "unknown" }` for a financial benefit without a planned value), `realized` (ADR-0030 §6: `validated`, `sustained` and `pending` amounts as separate fields; for a non-financial benefit `kpiActual` = the latest accepted value of its agreed KPI from the KPI evaluation, or Unknown), `owner`, `evidence` (count and latest links), `status` (`status_rag` or `unknown`); plus `lifecycleStep`, `realizationState` ∈ {`not_enabled`, `enabled_not_yet_measured`, `measured_pending_validation`, `validated`, `sustained`} and `counted`/`exclusionReason` (§6). A pending (submitted) amount is labelled pending and is never part of `validated` (REQ-PB-075).

### 5. Contribution allocations (REQ-S08-013, REQ-PB-058)

- `benefit_allocation` (0037): append-only rows `(benefit, set_no, initiative, share)`; `share` is a fraction numeric(7,6) with 0 < share ≤ 1 (CHECK; probe A05); one row per initiative and set (`benefit_allocation_initiative_key`).
- `PUT …/benefits/{benefitId}/allocations` (`benefit.allocate`; TL, BO; `If-Match` = the benefit's ETag) replaces the whole set: in one transaction the API takes lock **730232** (key: benefit id), steps `benefit.allocation_set_no` by one (benefit version +1, one audit event `benefit.allocations_replaced` with the old and new sets) and inserts the new rows. An empty array clears the allocations (a new empty set).
- Trigger `benefit_allocation_guard` takes the same lock, accepts rows only for the benefit's current set (`benefit_allocation_current_set`; probe A03) and refuses a set whose shares sum above 1 (`benefit_allocation_total`; probes A01, A07 concurrency). `allocation_set_no` steps by one at most (`benefit_allocation_set_step`; probe A06).
- **Acceptance:** 60 % + 50 % → 422 `benefit_allocation.over_100`; 60 % + 30 % saves and `getBenefitAllocations` returns `unallocatedShare = "0.100000"` (probe A02), computed as 1 − Σ shares with decimal arithmetic.
- **Counted once.** Allocations attribute a benefit to initiatives for initiative views (share × value, labelled "allocated"); transformation and portfolio totals sum the benefit itself once and never its allocations (ADR-0030 §7; probe T01: a 10 000 000 SAR benefit allocated 50/50 to two initiatives totals 10000000.0000).

### 6. Parent/child and shared-benefit groups (REQ-PB-058)

- **Parent/child, one level.** `parent_benefit_id` (same transformation, same currency; `benefit_parent_currency`, probe PC03). A child never has children and a parent is never a child (`benefit_parent_depth`; probe PC01). **A parent is a roll-up container:** it carries no plan, scenario or measured values of its own (`<table>_leaf_only` from `p4_benefit_value_row_valid`, probe PC02; `benefit_parent_has_values`, probe L01). Its values are the sum of its children's, so each value is stored once.
- **Shared-benefit group.** `benefit_group` (code `BG-nn`) gathers benefits that claim one economic pool. Exactly one member, `counted_benefit_id`, is counted; it must be a member (`benefit_group_counted_member`, probe GR01) and cannot leave the group while it is the counted member (probe GR02). While no counted member is named, **no** member is counted (exclusion reason `group_counted_member_not_named`): a group never double counts by default. `benefit_group.manage` (TL, BO) names it; a Finance `duplicate` overlap resolution (§7) is the other way to exclude a claim.
- **View `benefit_counting`** (0039) gives each benefit `counted` and `exclusion_reason` ∈ {`archived`, `parent_rollup`, `group_counted_member_not_named`, `group_member_not_counted`, `overlap_duplicate`} and `overlap_open` (probe T02).

### 7. Overlap warnings and Finance resolution (REQ-S08-014)

- `benefit_overlap` (0038): a pair of benefits of one transformation stored in id order (`benefit_overlap_pair_order`, probe O01), the overlapping `dimensions` ⊆ {driver, population, period}, the keys and the overlapping dates, `detected_by` ∈ {rule, user}. At most one open warning per pair (`benefit_overlap_one_open_key`, probe O03).
- **The rule** (API, KBE-D `benefits/overlaps.ts`, run on `createBenefit` and on an `updateBenefit` that changes `driver_key`, `population_key`, `realization_start` or `realization_end`; lock **730234**, key `<transformationId>:<driverKey>`): two active benefits of the same transformation with the same `driver_key` and overlapping realization windows (a missing window counts as overlapping) raise a warning with dimensions `{driver, period}`, plus `population` when both have the same `population_key`. The warning writes one audit event and one `benefit_overlap_review` work item for the transformation's FIN party through `createWorkItemOnce` (key `benefit.overlap:<overlapId>`; "Overlap detected → Finance task"). A user may also raise a warning (`createBenefitOverlap`, `benefit.edit`).
- **While open**, both benefits are `overlap_open` in `benefit_counting` and their values are excluded from every validated and sustained total and reported on a separate `pendingOverlap` line (ADR-0030 §7; probe O02). "Two benefits using the same driver and period raise a warning and remain excluded from validated totals until Finance resolves" is this rule.
- **Resolution** (`POST …/benefit-overlaps/{id}/resolve`, `finance.validate` = FIN only, `If-Match`): `no_economic_overlap` (both count) or `duplicate` with `excludedBenefitId` (that benefit is never counted again, exclusion reason `overlap_duplicate`; probe O06), with a note. The resolver is never the owner of either benefit (`benefit_overlap_resolver_not_owner`, probe O04). `open → resolved` is final (`benefit_overlap_status_step`, probe O07); a later change raises a new warning.

### 8. Valuation methods and baseline validation (REQ-S08-010, REQ-PB-013 baseline half)

- `benefit_valuation_method` (code `VM-nn`): name, method text, the non-financial type it applies to, optional KPI and unit value, currency. Proposed by `benefit.edit` holders; `proposed → approved | rejected` by a `finance.validate` holder who is not the proposer (`benefit_valuation_method_decider_not_proposer`, probe VM01); `approved → retired`. The content is fixed once proposed (`benefit_valuation_method_frozen`, probe VM02); a rejection needs a note. A retired method stays valid for the benefits that already reference it; new references need an approved one.
- **Acceptance (REQ-S08-010):** "entering a SAR value on a CX benefit without an approved method is rejected" — on the benefit (`planned_value`), on plan and scenario values and on measurements (`<table>_unmonetised`; probes B06, B07, P01).
- **Baseline validation** (`POST …/benefits/{benefitId}/baseline-validation`, `finance.validate`): `{ decision: validated | rejected, note }`; not by the owner (403 `benefit.baseline_validator_is_owner`; DB `benefit_baseline_validator_not_owner`). A validated baseline is the **comparison basis** that ADR-0030 §5 requires before any value of the benefit is validated (REQ-S08-008). Formula versions keep the DG3 Finance validation (ADR-0024).

### 9. Authorization (permissions matrix §12)

New permissions (all `write`; seeded by 0040, equal to `P4_BENEFIT_PERMISSIONS` / `P4_BENEFIT_ROLE_PERMISSIONS`; probe S02; `seed.test.ts`): `benefit.edit` (TL, BO), `benefit.advance` (BO), `benefit.allocate` (TL, BO), `benefit.measure` (BO, WL, KDS), `benefit_scenario.edit` (TL, FIN), `benefit_group.manage` (TL, BO). Every Finance decision reuses the P1 `finance.validate` (category `finance_validation`), held by FIN only (probe S04); no new approval-category code, so the DG1/DG2 rules keyed on approval roles (F-DG1-106; ADR-0020 §3) are unchanged. AUD, SP, TO, TD, CM, SEC and the technical-admin roles get none of them; AUD reads through `transformation.read` and gets 403 on every mutation. No technical-admin role holds any slice B permission or `finance.validate` (the `0001` trigger `role_permission_no_admin_approver` refuses a `finance_validation` grant to one), so the implementers must answer an ADM-only caller of every slice B Finance endpoint (`decideFinanceValidation`, `amendFinanceValidation`, `reverseFinanceValidation`, `resolveBenefitOverlap`, `decideBenefitValuationMethod`, `decideBenefitBaseline`) with 403, as the DG1–DG3 gate and Finance endpoints do, and test it (REQ-S10-003; KBE-D and KBE-E tests, p4-work-split §B).

| Operation | Permission (role defaults) | Record-level rule |
|---|---|---|
| Create/edit/archive a benefit, enablers, plan values, propose a valuation method, raise an overlap | `benefit.edit` (TL, BO) | — |
| Advance the lifecycle | `benefit.advance` (BO) | — |
| Replace allocations | `benefit.allocate` (TL, BO) | — |
| Create/edit groups, name the counted member | `benefit_group.manage` (TL, BO) | — |
| Create/edit scenarios and scenario values | `benefit_scenario.edit` (TL, FIN) | — |
| Validate a baseline; decide a valuation method; resolve an overlap | `finance.validate` (FIN) | not the benefit owner / not the proposer / not the owner of either benefit (403) |
| Every read | `transformation.read` (every role in scope, AUD included) | scope (ADR-0006); 404 outside it |

### 10. Scenarios (REQ-S08-018, REQ-S16-017 "Scenario")

`benefit_scenario` (kind ∈ {base, upside, downside}, one active per kind and transformation, `benefit_scenario_one_kind_key`, probe SC01; optional link to the business case) and `benefit_scenario_value` (scenario, benefit, period, amount or KPI value, currency = the benefit's, non-financial unmonetised rule; probe SC02). Scenario values are stored only there: the views `benefit_value_line` and `benefit_counting` do not read them, and no realized, validated or sustained total reads them (probe SC03: an upside value of 7 777 777 appears in no value line). Wherever a scenario value is returned it carries its `kind` label (`getBenefitScenario`).

### 11. Refusal codes and English texts (exact; S-11)

| Status | Code | English `detail` |
|---|---|---|
| 400 | `urn:mth:problem:validation` | the shared schema-validation text (e.g. a body with two owners) |
| 422 | `benefit.mapping_required` | "A financial benefit needs a financial-statement line." |
| 422 | `benefit.kpi_required` | "A non-financial benefit needs an agreed KPI." |
| 422 | `benefit.type_class_mismatch` | "The value class {valueClass} does not fit the benefit type {benefitType}. Revenue uplift and margin are revenue classes; cash savings and avoided cost are cost classes." |
| 422 | `benefit.valuation_method_required` | "A non-financial benefit has no SAR value (n/a) unless an approved valuation method is selected." |
| 422 | `benefit.valuation_method_not_approved` | "The valuation method {methodCode} is not approved by Finance, or is in another currency." |
| 422 | `benefit.kpi_variable_unbound` | "A KPI-fed formula variable needs both the measurement KPI and the formula." |
| 422 | `benefit.validator_is_owner` | "The Finance validator cannot be the benefit's owner." |
| 422 | `benefit.lifecycle_step` | "A benefit moves Identify → Plan → Enable → Measure, between Measure and Correct, and from Measure to Sustain, one step at a time." |
| 422 | `benefit.plan_outputs_missing` | "The Plan outputs are missing: {missing}. A benefit needs its baseline, formula, target and owner before Enable and Measure." |
| 422 | `benefit.enablers_missing` | "The Enable output is missing: link at least one enabling initiative, deliverable or capability before Measure." |
| 422 | `benefit.recovery_plan_required` | "The Correct step needs a recovery plan." |
| 422 | `benefit.sustain_outputs_missing` | "The Sustain step needs a BAU owner and a control cadence." |
| 422 | `benefit.parent_depth` | "A child benefit cannot have children, and a parent cannot be a child." |
| 422 | `benefit.parent_has_values` | "This benefit already has values, so it cannot become a parent. A parent is the roll-up of its children." |
| 422 | `benefit.parent_currency` | "A child benefit uses its parent's currency ({currency})." |
| 422 | `benefit.measure_locked` | "This benefit has values, so its type, class and currency can no longer change." |
| 422 | `benefit.case_line_invalid` | "The business-case line must be a benefit line of this transformation." |
| 409 | `benefit.case_line_taken` (`urn:mth:problem:duplicate`) | "This business-case line already backs benefit {benefitCode}." |
| 422 | `benefit.archived` | "This benefit is archived and read-only." |
| 403 | `benefit.baseline_validator_is_owner` | "You own this benefit, so you cannot validate its baseline." |
| 422 | `benefit.baseline_missing` | "There is no baseline to validate." |
| 422 | `benefit.baseline_note_required` | "A baseline rejection needs a note." |
| 422 | `benefit_enabler.deliverable_initiative` | "The deliverable must belong to the enabling initiative." |
| 422 | `benefit_enabler.removed` | "This enabler link is removed." |
| 409 | `benefit_enabler.exists` (`urn:mth:problem:duplicate`) | "This enabler is already linked to the benefit." |
| 422 | `benefit_allocation.over_100` | "The allocations total {totalPercent} %, above 100 %. Reduce them so they total 100 % or less." |
| 422 | `benefit_allocation.duplicate_initiative` | "Each initiative appears once in a benefit's allocations." |
| 422 | `benefit_allocation.share_invalid` | "Each share is above 0 % and at most 100 %." |
| 422 | `benefit_group.counted_not_member` | "The counted benefit must be a member of the group." |
| 422 | `benefit_group.counted_member_leaving` | "Benefit {benefitCode} is the counted member of its shared-benefit group. Name another counted member first." |
| 409 | `benefit_scenario.kind_exists` (`urn:mth:problem:duplicate`) | "This transformation already has an active {kind} scenario." |
| 422 | `benefit_value.currency_mismatch` | "The value is in {currency}, but the benefit is in {benefitCurrency}. Values are never converted." |
| 422 | `benefit_value.unmonetised` | "A non-financial benefit has no SAR value without an approved valuation method. Record its KPI value instead." |
| 422 | `benefit_value.parent_rollup` | "Benefit {benefitCode} is a parent: its values come from its children." |
| 409 | `benefit_value.period_taken` (`urn:mth:problem:duplicate`) | "This benefit already has a {valueKind} value for the period starting {periodStart}." |
| 403 | `benefit_valuation_method.decider_is_proposer` | "The person who proposed this valuation method cannot decide it." |
| 422 | `benefit_valuation_method.not_proposed` | "Only a proposed valuation method can be decided." |
| 422 | `benefit_valuation_method.note_required` | "A rejection needs a note." |
| 422 | `benefit_overlap.same_benefit` | "An overlap needs two different benefits." |
| 409 | `benefit_overlap.already_open` (`urn:mth:problem:duplicate`) | "An open overlap warning already exists for these two benefits." |
| 422 | `benefit_overlap.not_open` | "Only an open overlap warning can be resolved." |
| 422 | `benefit_overlap.excluded_required` | "A duplicate resolution names which of the two benefits is not counted." |
| 422 | `benefit_overlap.note_required` | "A resolution needs a note." |
| 403 | `benefit_overlap.resolver_is_owner` | "You own one of the overlapping benefits, so you cannot resolve this overlap." |

Permission refusals (no permission at all, e.g. a Business Owner calling a Finance endpoint) are the generic ADR-0006 403 `urn:mth:problem:forbidden`. Database last-line mappings for `platform/db-errors.ts` (KBE-D adds them): `benefit_mapping_required` → `benefit.mapping_required`; `benefit_kpi_required` → `benefit.kpi_required`; `benefit_type_fits_class` → `benefit.type_class_mismatch`; `benefit_non_financial_unmonetised` → `benefit.valuation_method_required`; `benefit_valuation_method_approved`, `benefit_valuation_only_non_financial` → `benefit.valuation_method_not_approved`; `benefit_kpi_variable_bound` → `benefit.kpi_variable_unbound`; `benefit_validator_not_owner` → `benefit.validator_is_owner`; `benefit_baseline_validator_not_owner` → 403 `benefit.baseline_validator_is_owner`; `benefit_lifecycle_step` → `benefit.lifecycle_step`; `benefit_plan_outputs_present` → `benefit.plan_outputs_missing`; `benefit_enablers_required` → `benefit.enablers_missing`; `benefit_correct_output_present` → `benefit.recovery_plan_required`; `benefit_sustain_outputs_present` → `benefit.sustain_outputs_missing`; `benefit_parent_depth`, `benefit_not_own_parent` → `benefit.parent_depth`; `benefit_parent_has_values` → `benefit.parent_has_values`; `benefit_parent_currency` → `benefit.parent_currency`; `benefit_measure_locked` → `benefit.measure_locked`; `benefit_case_line_valid` → `benefit.case_line_invalid`; `benefit_one_case_line_key` → 409 `benefit.case_line_taken`; `benefit_code_key` → 409 `urn:mth:problem:version-conflict` (a concurrent code allocation; retry); `benefit_archived_frozen` → `benefit.archived`; `benefit_enabler_deliverable_initiative` → `benefit_enabler.deliverable_initiative`; `benefit_enabler_frozen` → `benefit_enabler.removed`; `benefit_enabler_active_key` → 409 `benefit_enabler.exists`; `benefit_allocation_total` → `benefit_allocation.over_100`; `benefit_allocation_initiative_key` → `benefit_allocation.duplicate_initiative`; `benefit_allocation_share_check` → `benefit_allocation.share_invalid`; `benefit_group_counted_member` → `benefit_group.counted_not_member` (group update) or `benefit_group.counted_member_leaving` (benefit update); `benefit_scenario_one_kind_key` → 409 `benefit_scenario.kind_exists`; `*_currency` (value tables) → `benefit_value.currency_mismatch`; `*_unmonetised` → `benefit_value.unmonetised`; `*_leaf_only` → `benefit_value.parent_rollup`; `benefit_plan_value_period_key`, `benefit_scenario_value_period_key` → 409 `benefit_value.period_taken`; `benefit_valuation_method_decider_not_proposer` → 403 `benefit_valuation_method.decider_is_proposer`; `benefit_valuation_method_status_step`, `benefit_valuation_method_frozen` → `benefit_valuation_method.not_proposed`; `benefit_valuation_method_decision_complete` → `benefit_valuation_method.note_required`; `benefit_overlap_pair_order` → 500 (the service orders the pair); `benefit_overlap_one_open_key` → 409 `benefit_overlap.already_open`; `benefit_overlap_status_step` → `benefit_overlap.not_open`; `benefit_overlap_resolution_complete` → `benefit_overlap.excluded_required` or `benefit_overlap.note_required`; `benefit_overlap_resolver_not_owner` → 403 `benefit_overlap.resolver_is_owner`; `*_version_step` → 409; `*_audit_required`, `benefit_allocation_current_set`, `benefit_allocation_set_step` → 500 (a programming error).

### 12. Decimal and Unknown

Money is numeric(20,4) (`planned_value`, value amounts, `unit_value`), baseline, target and KPI values numeric(24,6), allocation shares numeric(7,6); every one is a decimal string in the API and is computed with decimal.js (S-5), never a float (probes D01: 0.1 + 0.2 = 0.3000; D02: 100000 × 0.02 × 50 = 100000.00). A missing planned value is Unknown (financial) or n/a (non-financial); neither is shown or summed as 0 (probe T03). `status_rag` NULL is Unknown, never green.

## Alternatives considered

- **Extend `business_case_line` into the register.** Rejected: a T14 benefit has a lifecycle, owner, allocations and measurements that a business-case line does not; and changing the DG3 roll-up would be a reopen (seam 17). The register links to a line instead (one benefit per line).
- **Require baseline and formula on create (PB-058 literally at create).** Rejected: it makes the Identify and Plan steps of REQ-PB-074 empty. The Plan-output CHECK enforces the same fields before any value can exist (§1).
- **Groups that sum their members.** Rejected: a group exists because its members claim the same pool; summing them is the double count M0173 forbids. One counted member, none by default.
- **Allocations that split the benefit into per-initiative copies.** Rejected: copies would be counted per initiative; the canonical row plus shares keeps one value.
- **A free JSON profile.** Rejected (ADR-0003 rule): every M0167 field is a typed column with a CHECK.

## Consequences

- Nine tables and one reference table in 0037/0038 for this ADR (`benefit_lifecycle_step_definition`, `benefit_valuation_method`, `benefit_group`, `benefit`, `benefit_enabler`, `benefit_lifecycle_event`, `benefit_allocation`, `benefit_scenario`, `benefit_scenario_value`, `benefit_overlap`), one view (`benefit_counting`), three code prefixes (B, BG, VM), six permissions, two work-item kinds, three lock classes (730232–730234; 730235 reserved).
- The literal REQ-PB-058 rule is split between create (owner, mapping/KPI) and the Plan step (baseline, formula, target) as stated in §1; reviewers test both points.
- A benefit with values cannot change class, type or currency; a different classification is a new benefit.

## Verification

- `docs/delivery/handbacks/DG4/T-DG4-ARCH-03-evidence/probe.ts` on a disposable PostgreSQL 16: migrations 0001→0040 on an empty database and 0028→0040 over a P3-populated one; every guard named above has a probe id (`probe-output.txt`).
- `packages/db/test/integration/catalogue.test.ts` pins the slice B trigger attachments, the versioned tables and the grants (no DELETE); `packages/db/src/seed.test.ts` pins 0040 against `P4_BENEFIT_PERMISSIONS`; `advisory-locks.test.ts` pins 730232–730234 and the trigger constant `benefit_allocation_lock_class`.

## Amendment (2026-10-09, T-DG4-ARCH-R1): the weekly control cadence, and the codes and keys added outside §11

### A1. The weekly control cadence (BE-I handback §6 item 1; D-102, D-105)

Migration `0060` widens `benefit_control_cadence_check` to `weekly`, `monthly`, `quarterly`, `semiannual`, `annual` (NULL still allowed). `semiannual` keeps its spelling. `CONTROL_CADENCES` in `packages/shared/src/schemas/benefits.ts` and the contract's `controlCadence` enums (`Benefit`, `BenefitUpdate`) gain `weekly`. No job reads a benefit's `control_cadence` (the monitoring schedule follows transition decisions, ADR-0034), so nothing else changes. The BAU-handover mapping that writes it is in the ADR-0034 amendment.

### A2. Codes and keys added outside §11 (accepted, with their exact English texts)

| Code or key | Kind | Decision | English text (exact) |
|---|---|---|---|
| `benefit_valuation_method.not_approved` | 422 | accepted | Only an approved valuation method can be retired. |
| `benefit_value.period_range` | 422 | accepted | The period end cannot be before the period start. |
| `benefit_value.value_required` | 422 | accepted | A scenario value needs an amount or a KPI value. |
| `validation.decimal_share_scale` | 400 field | accepted | A share has at most 6 decimal places. |
| `validation.key` | 400 field | accepted | A key starts with a lower-case letter or digit and uses a-z, 0-9, '_', '.', ':' and '-' (up to 100 characters). |
| `validation.decimal_non_negative` | 400 field | accepted | Enter zero or a positive amount. |
| `benefits.task.overlap_review` | message key | accepted | Review a possible double count between {benefitACode} and {benefitBCode} ({dimensions}). |
| `benefit.planned_value_missing` | reason key | accepted | Unknown: the benefit has no planned value. |
| `benefit.value_amount_missing` | reason key | accepted | Unknown: an amount in this total is missing. |
| `benefit.kpi_actual_missing` | reason key | accepted | Unknown: the measuring KPI has no accepted actual. |
| `benefit.non_financial` | reason key | accepted | Not applicable: a non-financial benefit has no currency amount. |
| `benefit.not_counted` | reason key | accepted | Not applicable: this benefit is not counted in the total. |
| `benefit.overlap_open` | reason key | accepted | Unknown: an open double-count warning excludes this benefit until it is resolved. |
