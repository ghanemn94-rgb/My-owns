# ADR-0027: KPI data model and pipeline: dictionary v2, versions, reporting periods, trajectories, actuals, the accept pipeline, calculation runs, data-quality findings and RAG overrides

- **Status:** Proposed for P4 (DG4). Author: solution-architect (T-DG4-ARCH-02), 2026-10-09.
- **Requirements:** REQ-S07-001, REQ-S07-003, REQ-S07-009, REQ-S07-011 (the graph half), REQ-S07-012, REQ-S07-013, REQ-S07-017, REQ-S12-006, REQ-S16-014 (slice A of `docs/architecture/p4-plan.md`). The calculation semantics (REQ-S07-002, -004, -005, -006, -007, -008, -010, the unit half of -011) are in ADR-0028.
- **Sources:** master prompt M0158 (dictionary fields), M0159 (measures, actuals by KPI/scope/period), M0160 (RAG, override), M0161 (aggregation, formula dependencies), M0162 (routes, accept pipeline), M0163 (KPI change → change request; slice H), M0164 (routine update), M0225/M0226/M0227 (§12 starter automations), M0320 (§16 entity group); playbook B0050 (Template 2 Outcome & KPI Tree), B0095 (Template 10 RAG logic: "RAG based on target trajectory, not activity completion"), B0105 ("Manage adoption as an outcome with measurable leading indicators").
- **Decisions applied:** D-089 Q1 (aggregation rule required on activation and on every P4 use, not on the DG2 create), Q9 (single-actual entry with evidence; bulk import is P6), seam 5 (formula engine unchanged), seam 6 (DG2 `kpi_definition` extended additively), seam 7 (typed trajectory table, DG2 jsonb kept).
- **Builds on:** ADR-0003 (ids, versions, `If-Match`), ADR-0004 (audit), ADR-0008 (outbox, pg-boss), ADR-0016 (P2 guards, lock registry §6), ADR-0019 (decimal and Unknown), ADR-0024 §6 (formula engine, lineage rounding), ADR-0025 (time semantics, job kit, work items), ADR-0026 §4 (approval engine).
- **Physical model:** `0033_p4_kpi_dictionary_versions.sql`, `0034_p4_kpi_trajectories_actuals.sql`, `0035_p4_kpi_calculation_runs_quality.sql`, `0036_p4_kpi_permissions_backfill.sql`. Guard probe: `docs/delivery/handbacks/DG4/T-DG4-ARCH-02-evidence/probe-output.txt`.
- **Two gate systems.** Trajectory approval and KPI-version approval are **business** approvals inside the product, decided by named people. No agent, seed, job or trigger decides one; the `0036` backfill copies approvals that people already gave in DG2. Nothing here reads or writes DG0–DG7.

## Context

DG2 built a P2 subset of the KPI dictionary (`kpi_definition`, `0014`: name, description, business purpose, unit, currency, polarity `higher_is_better | lower_is_better | within_band`, frequency, leading flag, data source, owner, steward, status `draft → active → archived`) and the T02 tree (`outcome_kpi`) with trajectory points in a jsonb column and a DG2 trajectory approval. DG3 built the restricted formula engine (`packages/shared/src/formula/**`, ADR-0024 §6) and its lineage row (`benefit_calculation`).

P4 must add the rest of M0158 — "numerator/denominator, calculation, baseline and baseline date, target and target date, phased trajectory, source, aggregation rule, data-quality rule, reporting period, approval policy" —, actuals "by KPI, scope and reporting period" (M0159), "configurable draft/review/accept or direct-accept routes" (M0162), and the pipeline "An accepted actual triggers server-side validation, recalculation of dependent metrics and benefits, dashboard refresh, deviation evaluation and an audit event" (M0162), with the §16 entities "KPIDefinition, KPIVersion, KPIActual, TargetTrajectory, CalculationRun and DataQualityFinding" (M0320).

Constraints: P1–P3 contract operations stay byte-stable (D-089); the DG2 `createKpiDefinition` stays unchanged (D-089 Q1); the formula engine is reused unchanged (seam 5).

## Decision

### 1. Dictionary v2 = the DG2 definition + its versions (REQ-S07-001, REQ-S16-014)

The DG2 `kpi_definition` row keeps the identity and the descriptive fields; every measurement semantic is on a **`kpi_version`** row. Together they hold every M0158 field:

| M0158 field | Where |
|---|---|
| name, description, business purpose, owner, steward, unit, frequency, polarity, source, leading/lagging | `kpi_definition` (DG2): `name`, `description`, `business_purpose`, `owner_user_id`, `steward_user_id`, `unit_kind`/`unit_label`/`currency`, `frequency`, `polarity`, `data_source`, `is_leading` |
| numerator/denominator | `kpi_version.numerator_label`, `denominator_label` (ratio KPIs; the values are on each actual) |
| calculation | `kpi_version.calculation_method` (`entered` \| `formula`), `calculation_description`, `formula_expression` + `kpi_formula_input` rows |
| baseline and baseline date | `kpi_version.baseline_value`/`baseline_date`, or `baseline_id` (a DG2 baseline record; one source only, CHECK `kpi_version_baseline_one_source`) |
| target and target date | `kpi_version.target_value`, `target_date` |
| phased trajectory | `target_trajectory` + `target_trajectory_point` (§5) |
| aggregation rule | `kpi_version.aggregation_rule` (`sum`, `last_value`, `weighted_ratio`, `custom_formula`, `none`), `stock_additive_across_scopes` |
| data-quality rule | `kpi_version.dq_stale_after_days` (default 45), `dq_valid_min`, `dq_valid_max`, `dq_evidence_required` |
| reporting period | `kpi_definition.frequency` + `reporting_period` rows of that frequency (§3); `kpi_version.ytd_start_month` |
| approval policy | `kpi_version.submission_route` (`review` \| `direct_accept`) with `reviewer_party_code`, and `definition_approval` (`direct` \| `business_approval`) |
| measure type (M0159) | `kpi_version.measure_type` (`higher_is_better`, `lower_is_better`, `acceptable_band`, `binary_milestone`), `value_nature` (`flow`, `stock`, `ratio`, `milestone`), `band_lower`/`band_upper`, `milestone_due_date` |

- **The DG2 operations are unchanged.** `createKpiDefinition`, `updateKpiDefinition`, `activateKpiDefinition` and `archiveKpiDefinition` keep their DG2 requests, responses and refusals for every KPI without a version. One additive guard applies to KPIs that have a version (only P4 creates versions): trigger `kpi_definition_measure_lock` refuses a change of `unit_kind`, `currency`, `polarity` or `frequency` (probe V14), because stored versions and actuals depend on them; a KPI without a version can still change them (probe V15).
- **Measure type and polarity.** A version's `measure_type` must fit the DG2 polarity: `higher_is_better` → `higher_is_better` or `binary_milestone`; `lower_is_better` → `lower_is_better`; `within_band` → `acceptable_band` (trigger `kpi_version_guard`, constraint `kpi_version_measure_fits_polarity`; probe V05). Unit kind, currency and frequency equal the definition's (`kpi_version_matches_definition`; probe V04).

### 2. KPI version lifecycle (D-089 Q1)

```
draft ──activate──► active ──(next version activated)──► superseded
  └──withdraw──► withdrawn
```

- At most one `draft` and one `active` version per KPI (partial unique indexes; probe V12). `version_no` is 1, 2, 3 … per KPI (probe V10); a version after the first needs `change_reason` (CHECK).
- Content changes only while `draft`. An `active`, `superseded` or `withdrawn` version is immutable except its status stamps (`kpi_version_frozen`; probe V11).
- **Activation** (`POST …/kpi-versions/{id}/activate`, `kpi_version.activate`, `If-Match`) needs, in this order:
  1. the KPI definition `active` (`kpi_version_definition_active`; probe V06);
  2. a complete version (CHECK `kpi_version_complete_when_active`): **an aggregation rule** (D-089 Q1; probe V03), numerator and denominator labels for a ratio, a due date for a binary milestone; a band needs both bounds (`kpi_version_band`; probe V09);
  3. under `definition_approval = 'business_approval'`: an **approved** P4 approval of type `kpi_version_activation` for this version (`kpi_version_approval_required`; probe V07). The service requests it through the ADR-0026 §4 engine (assignee party `BO` by default; `approval.decide` holders decide; SoD: the requester cannot decide);
  4. no formula cycle (§4).
  The service supersedes the previous `active` version first and activates the new one in the same transaction (one audit event each), then enqueues `kpi.version_activated` (§8).
- **"Every P4 use"** (D-089 Q1): entering an actual, approving a trajectory for RAG, evaluating, aggregating and overriding all read the KPI's **active** version. A KPI with no active version has no aggregation rule in force, so these refuse with 422 `kpi_actual.no_active_version` (actual entry) or evaluate to Unknown with reason `kpi.no_active_version` (reads). The database refuses a value entered against a non-active version (`kpi_actual_value_active_version`; probe A19).
- **REQ-S07-001's literal acceptance** — "a KPI definition persists all listed fields; one without polarity, unit or aggregation rule is rejected" — is met as follows: polarity and unit are required by the DG2 create (400, unchanged); the aggregation rule is required to activate a version and so before any P4 use (422 `kpi_version.aggregation_rule_required`). A dictionary entry is "persisted with all listed fields" when its definition and active version are read together (`getKpiDictionaryEntry`, §12).
- **Change control.** A new version is how a KPI definition, baseline or target changes. M0163's versioned change request with impact preview is slice H's (REQ-S07-015, ARCH-07); this ADR provides the versions it changes. New versions take effect prospectively: evaluations record the version they used (`kpi_evaluation.kpi_version_id`), and earlier evaluations are never rewritten.

### 3. Reporting periods (REQ-S07-003, REQ-S07-005, REQ-S12-005)

- `reporting_period`: one row per organization, frequency and label (unique `reporting_period_label_key`), with `period_start`/`period_end` (the ADR-0025 §2 observation period), a stored `length_days`, `basis` (`calendar` \| `weeks`) and `week_count` (week-based periods last exactly `week_count × 7` days; probe RP03), an optional `update_due_date` after the end.
- Periods of one organization and frequency never overlap: trigger `reporting_period_guard` under lock **730230** (key `<organizationId>:<frequency>`; probe RP02).
- Status: `scheduled → open → closed`; a closed period stays closed in P4 (`reporting_period_status_step`; probe RP04). A correction of a closed period is a restatement through change control (M0163, slice H). The `kpi.reporting_period_open` job (ADR-0025 §3, KBE-C) opens each `scheduled` period whose `period_end` is before today's business date in the organization's default calendar, and creates one `kpi_update_due` work item per active KPI owner (ADR-0025 §4). `reporting_period.manage` (TO) creates, opens early and closes periods.
- `reporting_period` has no `transformation_id`: periods are shared by every transformation of the organization.

### 4. KPI formulas and the cycle guard (REQ-S07-011, graph half)

- A `formula` version names its inputs in `kpi_formula_input` (`variable_name` → `source_kpi_definition_id` of the same transformation, `input_basis` `period` \| `cumulative`). Inputs are inserted only while the version is a draft and never change (append-only; probes F05, F06).
- **Cycle rule.** The graph's edges are "KPI X's **active** version reads KPI Y". The database refuses, under lock **730228** (key: transformation id):
  1. an input whose source is the KPI itself (probe F03);
  2. an input whose source already reaches the KPI through active edges (`kpi_formula_input_guard`): "KPI A = B + 1 and B = A * 2 is rejected as circular" (probe F02);
  3. at activation, any input that closes a cycle with the active graph, ignoring the KPI's own version being replaced (`kpi_version_guard`). This catches two drafts that reference each other: the first activation succeeds, the second is refused (probe F04), also when both activations run concurrently (probe C01).
  Code `kpi_formula_no_cycle` → 422 `kpi_formula.circular`. KBE-B's service runs the same walk first to name the path in the detail.
- **Units** are checked by the DG3 engine at creation (ADR-0028 §7).

### 5. Target trajectories (REQ-S07-007, REQ-S16-014; seam 7)

- `target_trajectory` (one per KPI, scope and version number): `scope_kind`/`scope_id`, `basis` (`period` \| `cumulative`), `interpolation` (`linear` \| `step`), `source` (`api`, `outcome_kpi_import`, `outcome_kpi_backfill`) with `source_outcome_kpi_id`. Points in `target_trajectory_point` (`point_date`, `expected_value numeric(24,6)`), unique per date, **inserted only while the trajectory is a draft and never updated or deleted** (probes TJ03, TJ04, TJ04b). Different points mean a new draft version.
- Status: `draft → approved | withdrawn`; `approved → superseded`. An approved trajectory is immutable (probe TJ05), has at least one point (probe TJ01), and at most one is approved per KPI and scope (probe TJ07). The approver is never the creator (CHECK `target_trajectory_approver_not_creator`; probe TJ02); approving needs the DG2 business approval permission `kpi_target.approve` (SP, BO). The scope must be the transformation, one of its organization's business units or one of its initiatives (`p4_kpi_scope_valid`; probe TJ06).
- **DG2 T02 is unchanged.** `outcome_kpi.trajectory_points` and its DG2 approval stay what the T02 tree and the G2 facts read. P4 RAG reads only `target_trajectory`. `0036` copies once, for each KPI, the most recently approved active T02 trajectory into an approved `target_trajectory` (creator, approver and approval time preserved; two audit events, actor `system`, source `migration`; probes B01–B04). Values are copied verbatim. After P4, a T02 trajectory reaches RAG only through `createTargetTrajectory` with `sourceOutcomeKpiId` (a new draft that needs its own approval).

### 6. KPI actuals: slots, value versions and submission routes (REQ-S07-003, REQ-S07-012, REQ-S07-017, REQ-S15-008)

- **Slot.** `kpi_actual` is one row per KPI, scope and reporting period (unique `kpi_actual_slot_key`). "A second actual for the same KPI, scope and period is stored as a new version, not a duplicate row": a second entry adds value version 2 to the same slot (probe A03); a second slot row is refused (probe A02). The slot copies the period's start, end and label (`kpi_actual_period_copy`), and the service refuses a scope kind other than the version's `entry_scope_kind` (422 `kpi_actual.scope_kind`; not a database rule).
- **Values.** `kpi_actual_value` holds every entered value version, append-only (probe A14): `value` (flow, stock), or `numerator` + `denominator` (ratio), or `milestone_achieved` + `achieved_on` (milestone), or `missing_reason` with no value (an explicit "not available", stored as NULL, never 0; probe A11). Each value records the active `kpi_version_id`, `currency` (must equal the KPI's; probe A09), `data_as_of`, `entered_at` (event instant), `entered_by` and `business_date` (ADR-0025 §2: an entry at 2026-11-02 00:30 Asia/Riyadh for period 2026-10 has `period_label` `2026-10`, `business_date` 2026-11-02). The shape is checked by `kpi_actual_value_guard` (probe A10). Evidence links: `kpi_actual_evidence` (append-only).
- **Status machine of the slot** (trigger `kpi_actual_guard`, under lock **730229**, key `<kpiDefinitionId>:<scopeKind>:<scopeId>:<reportingPeriodId>`):

  | From | To | When |
  |---|---|---|
  | (new) | `draft`, `submitted`, `accepted` | value 1; `accepted` only on the direct-accept route; the period must be `open` (probe A12) and of the KPI's frequency (probe A13) |
  | `draft` | `draft` (new value), `submitted`, `accepted` | `accepted` only on the direct-accept route |
  | `submitted` | `submitted` (new value), `accepted`, `rejected` | review route |
  | `accepted`, `rejected` | `draft`, `submitted`, `accepted` (direct) | only with a new value version (a correction); the accepted value stays in force until the new one is accepted |

  The value number steps by one (probe A17). `accepted_value_no` changes only by accepting the current value (`kpi_actual_accepted_pointer`). At COMMIT (`kpi_actual_consistency`, deferred): the current value row exists (probe A05) and an `accepted`/`rejected` status has the matching `kpi_actual_review` row by the deciding person (probe A07). A rejection needs a reason (probe A18). On the review route the reviewer is never the submitter (`kpi_actual_review_sod`; probe A06).
- **Routes (REQ-S07-012).** The active version's `submission_route` decides:
  - `review`: submit → `submitted`; calculations keep using the previously accepted value (or Unknown) until a reviewer accepts (probe A03, A08). Submitting creates one `kpi_actual_review` work item (ADR-0025 §4, dedupe key `kpi.actual_review:<actualId>:<valueNo>`) for the people resolved from `reviewer_party_code` through the role mapping (ADR-0026 §2; an unmapped party → 422 `routing.role_unmapped`, nothing written).
  - `direct_accept`: submit → `accepted` in the same transaction, with a `direct_accept` review row by the submitter; the value is used immediately (probe A01).
- **Only the slot is audited.** Values, reviews and evidence links are append-only rows written in the same transaction as the slot's update, so each user action (save draft, submit, accept, reject) writes **exactly one** audit event on `kpi_actual` (probe A01; `p2_attach_guards('kpi_actual', true)` makes a missing one fail at COMMIT, probe A04). The audit event's `changes` carries the value number, value fields, route and decision.
- **The four-step update (REQ-S07-017; D-089 Q9).** Open KPI → select period → enter the value (or "not available" with a reason) and attach evidence → submit, in one request (`submitKpiActual`). The response (`KpiActualSubmission`) lists the downstream views that change and whether review is pending: `reviewPending` (route `review`), `downstream[]` (the KPI panel, every formula KPI that reads it transitively, the T02 outcome rows that use it, the Executive Overview Outcomes area, and the benefits a slice B provider reports), and `financeReview` = `pending` \| `not_applicable` \| `unknown` (`unknown` until slice B registers its `DownstreamImpactProvider`; never guessed). Bulk or file import is P6 (D-089 Q9).

### 7. Calculation runs (REQ-S07-013, REQ-S12-006, REQ-S16-014)

- `calculation_run` is one append-only lineage row per trigger: `trigger_kind` `actual_accepted` (record `kpi_actual`, slot = value number), `threshold_changed` (`kpi_rag_threshold`, its version number), `trajectory_approved` (`target_trajectory`, its version number), `version_activated` (`kpi_version`, its version number). `(trigger_kind, trigger_record_id, trigger_slot)` and `idempotency_key` are unique, so a redelivered or restarted job cannot write a second run for the same accepted value (probe R01). A run row is written once, when the run ends (`completed` or `failed` with an `error_code`), and carries `formula_engine_version` and `kpi_rules_version` (the KBE-A library version). UPDATE, DELETE and TRUNCATE are refused by the append-only triggers (probe R02 checks UPDATE).
- `kpi_evaluation` rows (append-only, probe R07) are the run's outputs: one per KPI, scope, period and basis (ADR-0028 §6 lists the columns). The current status of a slot and basis is its evaluation with the highest run `seq`; a dashboard reads that one row, so a new value is shown once.
- Runs and evaluations write **no audit event** (the `benefit_calculation` lineage precedent, `0023`): they are system lineage rows that name their trigger.

### 8. The accept pipeline (REQ-S07-013, REQ-S12-006; M0162, M0226)

1. **API transaction** (`acceptKpiActual` or a direct-accept `submitKpiActual`; KBE-C): authorization re-checked at commit; `If-Match`; slot lock 730229; insert the review row; update the slot (`accepted`, `accepted_value_no`); **one** audit event `kpi_actual.accepted`; **one** outbox event `kpi.actual_accepted` (aggregate `kpi_actual`, idempotency key `kpi.actual_accepted:<actualId>:<valueNo>`, payload `{ kpiActualId, valueNo, kpiDefinitionId, scopeKind, scopeId, reportingPeriodId }`). No remote I/O.
2. **Worker** (`apps/worker/src/handlers/kpi.ts`, consumer `kpi.recalculate`, `runOnce` with the same key; ADR-0025 §3), in one transaction:
   - server-side validation of the accepted value against the version's data-quality rule (range, evidence, staleness, zero denominator, negative baseline, comparability), recorded as `data_quality_finding` rows (§9);
   - recalculation: the accepted KPI's evaluations for the slot (period and cumulative bases), its roll-up to the transformation scope when the entry scope is narrower, and every formula KPI that reads it transitively, for the same reporting period (ADR-0028);
   - deviation evaluation: RAG against the approved trajectory and the threshold version in force;
   - inserts one `calculation_run` and its `kpi_evaluation` rows;
   - outbox: one `kpi.deviation_evaluated` per evaluation of basis `period` (key `kpi.deviation_evaluated:<evaluationId>`, payload `{ evaluationId, kpiDefinitionId, scopeKind, scopeId, reportingPeriodId, calculatedRag, deviation, previousCalculatedRag }`), consumed by slice E's corrective-action service (M0227); and exactly one `kpi.values_recalculated` (key `kpi.values_recalculated:<runId>`, payload `{ runId, kpiDefinitionIds[], reportingPeriodId }`), consumed by slice B to flag benefit validation as pending (S07-014, "flag benefit validation where needed", never auto-validated: M0162 "new benefit values remain pending") and by slice J's live views;
   - the `processed_message` ledger row.
3. **Counts** (REQ-S07-013 "exactly one calculation run and one audit event"; REQ-S12-006 "one recalculation and one validation flag"): the accept request writes exactly one audit event; the worker writes exactly one `calculation_run` for that value (unique key); the run emits exactly one `kpi.values_recalculated`, and slice B creates at most one validation flag per benefit and run (its own unique key; ARCH-03).
4. **Failure.** pg-boss retries (ADR-0008 §4). A retry finds no committed run (the transaction rolled back) and computes again. After the last attempt the handler writes a `failed` run with its `error_code` in a separate transaction; the slot stays accepted and the panel shows the last evaluation with its age (Stale when the data-quality rule says so).
5. The other triggers run the same steps: a new threshold version (`kpi.threshold_changed`, REQ-S07-007 "changing the threshold version recomputes RAG"), an approved trajectory (`kpi.trajectory_approved`) and an activated version (`kpi.version_activated`) re-evaluate the KPI's slots of its current reporting period (ADR-0028 §6).

### 9. Data-quality findings (REQ-S16-014; REQ-S07-005, REQ-S07-006)

`data_quality_finding`: KPI, scope, reporting period, optional actual and value number, `rule_code` (`missing_actual`, `stale`, `out_of_range`, `evidence_missing`, `zero_denominator`, `not_comparable`, `negative_baseline`, `scope_missing`), `severity` (`info` \| `warning`), `detail_params`, `detected_by_run_id` (NOT NULL), status `open → resolved | dismissed` (final; probe D05) with a note (probe D03). At most one open finding per KPI, scope, period and rule (probe D01): a later run that finds the same problem inserts nothing (`ON CONFLICT DO NOTHING`). Inserts are run lineage without an audit event; a person's resolve or dismiss is versioned and audited (deferred audit constraint on UPDATE only; probe D02, D06). Owner for My Work: the KPI's steward, or else its owner.

### 10. Manual RAG override (REQ-S07-009)

- `rag_override`: KPI, scope, period, `override_rag` (`green` \| `amber` \| `red`), the **preserved** `calculated_rag` at the time and the `kpi_evaluation_id` it overrode, `reason` (NOT NULL), `evidence_id` (NOT NULL, an evidence record of the transformation), `expires_at` (NOT NULL, after creation and at most 366 days later). Probes O01–O05.
- In force while `status = 'active'` and `now() < expires_at`. At most one in force per slot (`rag_override_one_in_force`, lock 730229; probe O06); after expiry a new one is allowed (probe O08). Immutable except `active → revoked` with a reason (probe O07).
- Evaluations keep being calculated underneath; the override changes only what is displayed (ADR-0028 §6). After expiry the calculated RAG is displayed, with no job needed (the read compares `expires_at` with the current time).
- Authorization: `rag.override` (TL, BO; never a technical admin, never AUD); everyone else gets 403 `forbidden` (REQ-S07-009 "an unauthorized user gets 403").

### 11. Authorization (permissions matrix §11)

All slice A permissions are `write` or `configure`; none is a business approval, so the DG1/DG2 rules keyed on "a role holding an approval permission" (creator-derived assignment, F-DG1-106; ADR-0020 §3) are unchanged (`0036`; `seed.test.ts`). AUD and the technical-admin roles get none: they read through `transformation.read` and get 403 on every mutation.

| Operation | Permission (role defaults) | Record-level rule |
|---|---|---|
| Create/edit/withdraw a draft KPI version, add formula inputs | `kpi_version.edit` (TL, KDS) | — |
| Activate a KPI version | `kpi_version.activate` (TL, KDS) | `business_approval` policy: an approved `kpi_version_activation` approval, decided by an `approval.decide` holder other than the requester (ADR-0026 §4) |
| New threshold version | `kpi_threshold.configure` (TL, KDS) | — |
| Create/withdraw a draft trajectory | `target_trajectory.edit` (TL, KDS) | — |
| Approve a trajectory | `kpi_target.approve` (SP, BO; DG2 business approval) | not the creator (403 `target_trajectory.approver_is_author`) |
| Create/open/close reporting periods | `reporting_period.manage` (TO) | organization scope |
| Enter and submit an actual | `kpi_actual.submit` (KDS, BO) | the KPI's owner or steward, or the assignee of its open `kpi_update_due` work item (403 `kpi_actual.not_owner`) |
| Accept or reject | `kpi_actual.accept` (SP, TL, BO) | resolves to the version's reviewer party (403 `kpi_actual.not_reviewer`); not the submitter (403 `kpi_actual.sod_submitter`) |
| RAG override, revoke | `rag.override` (TL, BO) | — |
| Resolve or dismiss a finding | `data_quality.manage` (TL, KDS) | — |
| Every read | `transformation.read` (all roles in scope, AUD included) | scope (ADR-0006); 404 outside it |

### 12. Contract (OpenAPI 1.3.0-p4)

39 operations under the tags `kpi-versions` (11), `reporting-periods` (5), `target-trajectories` (5), `kpi-actuals` (8), `calculation-runs` (2), `kpi-status` (2), `rag-overrides` (3) and `data-quality` (3), listed in `apps/api/test/support/p4-pending-kbe-b.ts` (19) and `p4-pending-kbe-c.ts` (20). Every mutation of an existing record needs `If-Match` (creates do not); every list is cursor-paginated; errors are `application/problem+json`; every request body is `application/json`, and the bodiless action POSTs (`activateKpiVersion`, `openReportingPeriod`, `closeReportingPeriod`, `submitKpiActualDraft`) declare none (the `activateKpiDefinition` precedent). The DG2 KPI-definition operations are byte-stable; nine values are appended to the response-only `PermissionCode` enum.

### 13. Refusal codes and English texts (exact; S-11)

| Status | Code | English `detail` |
|---|---|---|
| 422 | `kpi_version.aggregation_rule_required` | "A KPI version needs an aggregation rule before it can be activated." |
| 422 | `kpi_version.aggregation_not_allowed` | "The aggregation rule {aggregationRule} cannot be used for a {valueNature} KPI. Use sum for flows, last value for stocks, weighted ratio for ratios, none for milestones, or an approved custom formula." |
| 422 | `kpi_version.custom_formula_needs_approval` | "A custom aggregation formula needs a formula calculation and the business-approval policy." |
| 422 | `kpi_version.measure_mismatch` | "The measure type {measureType} does not fit the KPI's polarity {polarity}." |
| 422 | `kpi_version.band_required` | "An acceptable-band measure needs a lower and an upper bound, and the lower bound cannot be above the upper bound." |
| 422 | `kpi_version.milestone_due_date_required` | "A binary milestone measure needs a due date." |
| 422 | `kpi_version.ratio_labels_required` | "A ratio KPI needs a numerator and a denominator." |
| 422 | `kpi_version.reviewer_required` | "The review route needs a reviewer role, and the direct-accept route has none." |
| 422 | `kpi_version.change_reason_required` | "A new version of a KPI needs a reason for the change." |
| 422 | `kpi_version.not_draft` | "Only a draft KPI version can be changed, activated or withdrawn." |
| 422 | `kpi_version.definition_not_active` | "Activate the KPI definition before activating one of its versions." |
| 422 | `kpi_version.approval_required` | "This KPI version needs an approved business approval before it can be activated." |
| 409 | `kpi_version.draft_exists` (`urn:mth:problem:duplicate`) | "This KPI already has a draft version. Change or withdraw it first." |
| 422 | `kpi_definition.measure_locked` | "This KPI has a version, so its unit, currency, polarity and frequency can no longer change. Create a new KPI instead." |
| 422 | `kpi_formula.circular` | "The formula would create a circular reference: {path}." |
| 422 | `kpi_formula.unit_mismatch` | "The formula gives {resultUnit}, but the KPI is measured in {kpiUnit}." |
| 422 | `kpi_formula.input_unknown_kpi` | "The formula input {variable} must name a KPI of this transformation." |
| 422 | `formula.*` (ADR-0024 §6) | the engine's own texts, unchanged (e.g. `formula.kind_mismatch` for adding SAR to a count) |
| 422 | `kpi_threshold.order` | "The red threshold cannot be below the amber threshold." |
| 409 | `reporting_period.label_taken` (`urn:mth:problem:duplicate`) | "A {frequency} reporting period {periodLabel} already exists." |
| 422 | `reporting_period.overlap` | "The period overlaps the {frequency} reporting period {otherLabel}." |
| 422 | `reporting_period.weeks_invalid` | "A week-based period lasts exactly its number of weeks times seven days." |
| 422 | `reporting_period.range_invalid` | "A reporting period ends on or after its start and lasts at most 367 days." |
| 422 | `reporting_period.status_step` | "A reporting period moves from scheduled to open to closed, and a closed period stays closed." |
| 422 | `kpi.scope_invalid` | "The scope {scopeKind} {scopeId} is not part of this transformation." |
| 422 | `target_trajectory.points_required` | "An approved trajectory needs at least one point." |
| 422 | `target_trajectory.not_draft` | "Only a draft trajectory can be approved or withdrawn." |
| 409 | `target_trajectory.draft_exists` (`urn:mth:problem:duplicate`) | "This KPI already has a draft trajectory for this scope. Approve or withdraw it first." |
| 403 | `target_trajectory.approver_is_author` | "The person who created this trajectory cannot approve it." |
| 422 | `kpi_actual.no_active_version` | "This KPI has no active version. Activate a version with its aggregation rule before entering actuals." |
| 422 | `kpi_actual.period_not_open` | "The reporting period {periodLabel} is {status}. Actuals are entered only for an open period; a closed period is corrected through a restatement." |
| 422 | `kpi_actual.period_frequency` | "A {frequency} KPI is reported for {frequency} periods." |
| 422 | `kpi_actual.scope_kind` | "This KPI is reported per {entryScopeKind}." |
| 422 | `kpi_actual.currency_mismatch` | "The value is in {currency}, but the KPI is measured in {kpiCurrency}. Values are never converted." |
| 422 | `kpi_actual.value_shape` | "Enter {expectedFields} for this KPI, or state why the value is not available." |
| 422 | `kpi_actual.evidence_required` | "This KPI's data-quality rule requires evidence with every submitted value." |
| 422 | `kpi_actual.not_submitted` | "Only a submitted value can be accepted or rejected." |
| 422 | `kpi_actual.reject_reason_required` | "A rejection needs a reason." |
| 403 | `kpi_actual.not_owner` | "Only the KPI's owner or steward, or the person assigned its update, can submit its actuals." |
| 403 | `kpi_actual.not_reviewer` | "Only the KPI's configured reviewer can accept or reject this actual." |
| 403 | `kpi_actual.sod_submitter` | "You submitted this value, so you cannot accept or reject it." |
| 422 | `routing.role_unmapped` (ADR-0026 §2) | unchanged |
| 422 | `rag_override.reason_required` | "A RAG override needs a reason." |
| 422 | `rag_override.evidence_required` | "A RAG override needs evidence." |
| 422 | `rag_override.expiry_required` | "A RAG override needs an expiry date and time." |
| 422 | `rag_override.expiry_invalid` | "The expiry must be in the future and at most 366 days away." |
| 409 | `rag_override.already_in_force` (`urn:mth:problem:duplicate`) | "An override is already in force for this KPI, scope and period. Revoke it first." |
| 422 | `rag_override.not_active` | "Only an override in force can be revoked." |
| 422 | `data_quality.not_open` | "Only an open finding can be resolved or dismissed." |
| 422 | `data_quality.note_required` | "Resolving or dismissing a finding needs a note." |

Database last-line mappings for `platform/db-errors.ts` (KBE-B/KBE-C add them): `kpi_version_complete_when_active` → `kpi_version.aggregation_rule_required` when `aggregation_rule` is NULL, else the matching field code; `kpi_version_aggregation_fits_nature` → `kpi_version.aggregation_not_allowed`; `kpi_version_custom_formula_approved` → `kpi_version.custom_formula_needs_approval`; `kpi_version_measure_fits_polarity` → `kpi_version.measure_mismatch`; `kpi_version_band` → `kpi_version.band_required`; `kpi_version_one_draft` → 409 `kpi_version.draft_exists`; `kpi_version_status_step`, `kpi_version_frozen` → `kpi_version.not_draft`; `kpi_version_definition_active` → `kpi_version.definition_not_active`; `kpi_version_approval_required` → `kpi_version.approval_required`; `kpi_definition_measure_locked` → `kpi_definition.measure_locked`; `kpi_formula_no_cycle` → `kpi_formula.circular`; `kpi_rag_threshold_order` → `kpi_threshold.order`; `reporting_period_label_key` → 409 `reporting_period.label_taken`; `reporting_period_no_overlap` → `reporting_period.overlap`; `reporting_period_weeks` → `reporting_period.weeks_invalid`; `reporting_period_range` → `reporting_period.range_invalid`; `reporting_period_status_step` → `reporting_period.status_step`; `*_scope_valid` → `kpi.scope_invalid`; `target_trajectory_points_required` → `target_trajectory.points_required`; `target_trajectory_one_draft` → 409 `target_trajectory.draft_exists`; `target_trajectory_approver_not_creator` → 403 `target_trajectory.approver_is_author`; `kpi_actual_period_open` → `kpi_actual.period_not_open`; `kpi_actual_period_frequency` → `kpi_actual.period_frequency`; `kpi_actual_value_currency` → `kpi_actual.currency_mismatch`; `kpi_actual_value_shape` → `kpi_actual.value_shape`; `kpi_actual_value_active_version` → `kpi_actual.no_active_version`; `kpi_actual_review_sod` → 403 `kpi_actual.sod_submitter`; `kpi_actual_reject_reason` → `kpi_actual.reject_reason_required`; `kpi_actual_status_step` → `kpi_actual.not_submitted`; `kpi_actual_slot_key` → 409 `urn:mth:problem:version-conflict` (a concurrent first entry: retry reads the slot); `rag_override_one_in_force` → 409 `rag_override.already_in_force`; `rag_override_expiry_window` → `rag_override.expiry_invalid`; `rag_override_status_step` → `rag_override.not_active`; `data_quality_finding_status_step` → `data_quality.not_open`; `data_quality_finding_resolution` → `data_quality.note_required`; `*_version_step` → 409; `*_audit_required`, `kpi_actual_value_present`, `kpi_actual_review_present` → 500 (a programming error).

### 14. REQ-S16-014: the entity group

| §16 entity | Table(s) | Primary key | Owner | Status |
|---|---|---|---|---|
| KPIDefinition | `kpi_definition` (DG2) | `id` | `owner_user_id` (steward `steward_user_id`) | `draft`, `active`, `archived` |
| KPIVersion | `kpi_version` (+ `kpi_formula_input`) | `id` (`kpi_definition_id`, `version_no` unique) | the definition's owner; author `created_by` | `draft`, `active`, `superseded`, `withdrawn` |
| KPIActual | `kpi_actual` (+ `kpi_actual_value`, `kpi_actual_review`, `kpi_actual_evidence`) | `id` (slot unique) | submitter `submitted_by`; the KPI's owner | `draft`, `submitted`, `accepted`, `rejected` |
| TargetTrajectory | `target_trajectory` (+ `target_trajectory_point`) | `id` | author `created_by`, approver `approved_by` | `draft`, `approved`, `superseded`, `withdrawn` |
| CalculationRun | `calculation_run` (+ `kpi_evaluation`) | `id` (`seq` unique) | the system (worker); trigger record named | `completed`, `failed` |
| DataQualityFinding | `data_quality_finding` | `id` | the KPI's steward, or else its owner; `resolved_by` | `open`, `resolved`, `dismissed` |

The REQ-S16-014 integration test (KBE-C) creates and reads each through the API with authorization enforced: KPIDefinition, KPIVersion, TargetTrajectory and KPIActual by their create operations; CalculationRun and DataQualityFinding by accepting an actual and running the `kpi.recalculate` handler in the test (they have no create operation), then `getCalculationRun` and `listDataQualityFindings`; an AUD caller gets 403 on each mutation and 200 on each read.

### 15. Decimal and Unknown

Every KPI value, threshold, bound and expected value is `numeric(24,6)` (ADR-0019) and a decimal string in the API. Unknown, Stale and Not computable are statuses with a reason code, never 0 and never green; the database refuses a stored Unknown or Not computable value that is not NULL and a green, amber or red evaluation without a known value (ADR-0028 §6; probes R03–R05).

## Alternatives considered

- **Add the P4 fields to `kpi_definition` and require `aggregationRule` on create.** Rejected: it changes the DG2 contract (a valid DG2 request would get 400; D-089 Q1) and gives no version history for M0163.
- **One row per actual version in a single table.** Rejected: "not a duplicate row" is clearer with one slot row, and a slot row gives one audited record per user action (§6).
- **Audit every value, review and run row.** Rejected: REQ-S07-013 counts exactly one audit event per accepted actual; the append-only rows are written in the audited slot's transaction or are worker lineage (the `benefit_calculation` precedent).
- **Replace `outcome_kpi.trajectory_points` with the typed table.** Rejected as a DG2 reopen (seam 7); the one-time backfill plus import keeps DG2 unchanged.
- **Compute RAG only at read time.** Rejected: "changing the threshold version recomputes RAG" and "exactly one calculation run" need stored runs; only time-dependent display rules (staleness, override expiry) are applied at read (ADR-0028 §6).

## Consequences

- Fourteen new tables, one additive trigger on the DG2 `kpi_definition`, nine permissions, one approval type, two work-item kinds, three lock classes (730228–730230; 730231 reserved).
- Every KPI used in P4 needs an active version. Existing DG2 KPIs have none until someone creates one; until then their P4 panels show Unknown with reason `kpi.no_active_version`.
- A unit, currency, polarity or frequency change of a KPI with a version needs a new KPI.
- Trajectory points cannot be edited in place; a different set is a new draft version.

## Verification

- `docs/delivery/handbacks/DG4/T-DG4-ARCH-02-evidence/probe.ts` on a disposable PostgreSQL 16: migrations 0001→0036 on an empty database and 0028→0036 over a P3-populated one; every guard named above has a probe id (`probe-output.txt`).
- `packages/db/test/integration/catalogue.test.ts` pins the versioned tables, the grants (no DELETE) and the slice A trigger attachments; `packages/db/src/seed.test.ts` pins `0036` against `P4_KPI_PERMISSIONS`; `advisory-locks.test.ts` pins 730228–730230.
- The API behaviour (refusal texts, routes, pipeline counts, the four-step submission) is the implementers' tests (p4-work-split §A, KBE-A/B/C) and QA's A04/A05 (slice L).
