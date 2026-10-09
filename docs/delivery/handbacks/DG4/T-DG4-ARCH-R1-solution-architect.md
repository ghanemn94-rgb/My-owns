# Handback T-DG4-ARCH-R1 (solution-architect): P4 architecture repairs

- **Stage:** DG4 (BUILDING), branch `claude/mobily-transformation-platform-regate`, base `HEAD` `7aac2ad184fe88e76c620a6b426b4cbeba83af48`, main tree. Changes are **uncommitted**, for the orchestrator to integrate.
- **Invocation:** `DG4-T-DG4-ARCH-R1-solution-architect-20261009T210822Z-7ae4c80d` (session `7ae4c80d-2eb0-40e8-bd16-c100c8a07718`). Assignment sha256 `1223173366f913e8d8a4b09e613a53e3b80f823dace95bfed76182b7c3ca3cd3` (verified).
- **Time:** start `2026-10-09T21:09:44Z`, end `2026-10-09T22:07:16Z` (`date -u`; `evidence/start-time.txt`, `end-time.txt`), about 58 minutes.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` → `PASS gate DG3 (historical)`, exit 0, run first, before any edit (§3 has the re-run at the end).
- **Two gate systems.** Nothing here reads or writes DG0–DG7 records other than this handback and its evidence. No migration, seed, route or test of this task approves anything. Product gates G1–G6 are business approvals inside the product. All probe data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/api/openapi.yaml` | A1 ETag rule (`ETagOrZero`, `IfMatchOrZero` on six operations); A2 `getAdoptionMetricLink`; D9 `listTransformationReportingPeriods`; `weekly` in the two `controlCadence` enums; the createAssessmentForm 201 description (D8); an info paragraph. 645 → 647 operations. Every changed line is in §5 |
| `packages/db/migrations/0060_p4_governance_schedules_weekly_cadence.sql` (new) | The three governance `job_schedule` rows (audited) and `weekly` in `benefit_control_cadence_check`; a self-check block |
| `packages/db/src/schema.ts` | `BenefitOverlapTable.dimensions: string[]` (was `string`; the column is `text[]`) |
| `apps/api/src/modules/benefits/overlaps.ts` | Compile fallout of the type fix: the insert's `sql<string[]>`; the `dimensionsOf` comment corrected (the function still accepts both shapes, see §6) |
| `packages/shared/src/schemas/benefits.ts` | `CONTROL_CADENCES` gains `weekly` (matches `0060` and the contract) |
| `apps/api/test/support/p4-pending-arch-r1.ts` (new) | Pending list for the two new operations |
| `apps/api/test/support/p4-pending.ts` | Imports that list (one line, plus the comment noting the repair import) |
| `apps/api/test/support/p4-operations.ts` | The two new operation ids in the P4 set (keeps the P2-scoped sweeps on their scope) |
| `apps/api/test/integration/contract/contract.test.ts` | Operation-count pin 645 → 647, with the comment line |
| `apps/api/test/integration/contract/platform-statuses.ts` | `takesIfMatch` also recognises `#/components/parameters/IfMatchOrZero` (so the 409/428 platform statuses are still expected on the three PUT/PATCH operations) |
| `apps/api/test/integration/workflows/phases.test.ts`, `workflows/change-requests.test.ts`, `reporting/rag-policy.test.ts` | The three `contract: false` skips added for ETag `"0"` removed (one GET each); those reads are now contract-checked |
| `apps/worker/test/integration/schedules.test.ts` | Worker schedule pin: the three `0060` rows appear in `unhandled` (sorted by code) in both tests |
| `docs/architecture/adr/ADR-0025` … `ADR-0038` (14 files) | One dated amendment each (`## Amendment (2026-10-09, T-DG4-ARCH-R1)`), appended; nothing above it is changed |
| `docs/architecture/data-dictionary.md` | `benefit.control_cadence` CHECK text; the `job_schedule` purpose line lists every seeded row |
| `docs/delivery/handbacks/DG4/T-DG4-ARCH-R1-evidence/**` | Logs, the `0060` probe and its output, the regex scan, the code scan and the code-table generator |

The ERD is unchanged: `0060` adds rows and widens a CHECK; no table, column or relationship changes, and the ERD lists no CHECK values.

## 2. Behaviour delivered, item by item

### A. Contract defects

1. **ETag version 0 (rule decided).** A defaulted record (one phase step per transformation and step key; one change-control policy per transformation; one dashboard RAG policy per organization) is read at `version: 0` with `ETag: "0"` while no row exists; `If-Match: "0"` creates it at version 1; `If-Match: "0"` once a row exists is 409 with `currentVersion`; `If-Match: "<n ≥ 1>"` while no row exists is 409 without `currentVersion` (the BE-L behaviour, kept, because `Version` starts at 1); missing `If-Match` is 428. The contract gets two components used only by these six operations: header `ETagOrZero` on `getPhaseStep`, `getChangeControlPolicy`, `getDashboardRagPolicy`; parameter `IfMatchOrZero` on `updatePhaseStep`, `putChangeControlPolicy`, `putDashboardRagPolicy`. Both patterns are `^"(0|[1-9][0-9]{0,9})"$`. `ETag`/`IfMatch` and every other operation are unchanged. A 404 was rejected because the defaults are displayable values and the first write needs an ETag. Recorded in the ADR-0035, ADR-0036 and ADR-0037 amendments. **Skips:** the three implementer skips for this were removed by me (§1), so no change is left for BE-R1. The other `contract: false` calls in those files (`rag-policy.test.ts:178`, `change-requests.test.ts` revoked-mid-request PUT) are for another reason (a request that is deliberately revoked mid-flight) and are untouched. The behaviour of the API is unchanged; nothing for the implementers to change.
2. **`createAdoptionMetricLink` `Location`.** The read is defined: `GET /api/v1/transformations/{transformationId}/adoption-metric-links/{adoptionMetricLinkId}`, `getAdoptionMetricLink`, `transformation.read`, 200 `AdoptionMetricLink` with `ETag`, 400/401/404/429. The `Location` header is unchanged (it follows every other create of the slice). Pending in `p4-pending-arch-r1.ts`.
3. **Regex quoting.** All 52 distinct `pattern` values in the final contract (parsed with `yaml`) compile as Unicode regular expressions; the list with each first location is `evidence/contract-patterns.txt` (script `contract-patterns.mjs`). Inspected for values they must match: `CriterionKey` (`^g[1-6]\.[a-z_]{1,48}$`) matches all 32 distinct `'g[1-6].…'` keys in the migrations; `StepKey`/`PhaseStep.stepKey` matches all 25 `'<phase>.<step>'` keys in the migrations (the longest suffix is 27 characters ≤ 48); `JobCode` and `job_schedule.code` use the same pattern as the DB CHECK `job_schedule_code_format`; `WorkItemKind` (`^[a-z_]+$`) matches all 30 `work_item_kind` codes the migrations insert; `AuditEvent.action` (`^[a-z_]+\.[a-z_.]+$`): every `action: "…"` literal in the API, worker and shared source that does not match it is not an audit action (three: `save_draft`, `selected`, `submit`, which are local parameter types). The key checks were re-run with one script after the first pass (whose multi-line `INSERT` grep was incomplete). **No pattern that cannot match its intended values was found, so no pattern changed** (`evidence/key-checks.py`, output `key-checks-output.txt`). The two new patterns (`ETagOrZero`, `IfMatchOrZero`) are single-quoted with no backslash.

### B. Schema type

4. `benefit_overlap.dimensions` is typed `string[]`. Compile fallout was one line (the insert's `sql<string>` → `sql<string[]>`). `dimensionsOf` still accepts the array-literal string form; its comment now states the corrected type. KBE-D2's workaround is now unnecessary; I did not remove it (its unit test `d2-rules.test.ts` covers the string branch, which is KBE's file); removing the string branch and that one assertion is optional work for KBE.

### C. Migration `0060`

5. `0060_p4_governance_schedules_weekly_cadence.sql` (sha256 `b96cc23c…7f4158a7`, `evidence/migration-sha256.txt`):
   - `job_schedule` rows, each with a `job_schedule.create` audit event (actor system, source migration), enabled, `Asia/Riyadh`, owner `governance`, `queue_name = code` (names confirmed against `apps/worker/src/queues/meetings.ts` and `escalations.ts`): `governance.meeting_series_generate` `35 0 * * *`; `governance.decision_sla_scan` `40 0 * * *`; `governance.blocker_escalation_scan` `45 0 * * *`. ADR-0032 §10 states all three as daily (the SLA scan's working-day rule is its handler's own calendar check, §7).
   - `benefit_control_cadence_check` (the inline `0037` CHECK, PostgreSQL's name) dropped and re-added admitting `weekly, monthly, quarterly, semiannual, annual` (or NULL). `semiannual` is not renamed; the handover's `semi_annual` maps to it (ADR-0034 amendment A1).
   - A `DO` block raises if either change is missing.
   - **Pins:** `schema.ts` needs no change for `0060` (`control_cadence` is `string | null`, `job_schedule` unchanged). Worker pin `schedules.test.ts` updated. The catalogue/privilege pins (`packages/db/test/integration/catalogue.test.ts`: `job_schedule: "SELECT,UPDATE"`) are unchanged and pass. The P2 guard pattern is unchanged: `job_schedule` keeps `p2_attach_guards` (audit-required, row guard), and `0060` writes the audit event the deferred guard requires (probe R04/R11 count three).
   - **Probe:** §4.

### D. Decisions (each is a dated amendment in its owning ADR; listed here for the orchestrator)

6. **Approvals of version-tied subjects while in approval (ADR-0026 amendment A1–A4).** The `0031` trigger already allows what is needed, so no migration. Two exported services:
   - `resubmitApprovalInTx(tx, audit, { approvalId, subjectVersion, requestNote?, expectedApprovalVersion? })`: checks, in order, 404; 403 `approval.not_requester`; 409 version-conflict (when `expectedApprovalVersion` is given); 422 `invalid_transition` (not `changes_requested`); 422 `approval.resubmit_needs_new_version`; 409 `approval.stale_version` (subject not at `subjectVersion`, under lock 730226). Effects: exactly today's route body (pending, round + 1, subject_version, note, version + 1, audit `approval.resubmit`, `approval_changes_requested` items closed done, approver tasks). It does **not** call the provider's `onOutcome`.
   - `withdrawApprovalInTx(tx, audit, { approvalId, reason, expectedApprovalVersion? })`: 400 at `/reason` without text; 404; 403 `approval.not_requester`; 409; 422 `approval.not_open`. Effects: exactly today's route body (withdrawn, version + 1, audit `approval.withdraw` with reason, open items cancelled). No `onOutcome`.
   - The routes call these and then `emitOutcome`, so their contract and responses are unchanged. A provider may set `resubmitThroughSubject`; for those types `POST …/resubmit` is 422 `approval.resubmit_through_record` ("Resubmit this request by submitting its record again."), nothing written.
   - **Corrected flows:** governance matrices (round ≥ 2: `submitGovernanceMatrix` sets `in_approval`, then resubmits on the new header version; rows frozen again); transition decisions (stored `draft` while in approval is accepted; subject-side withdraw = `withdrawApprovalInTx` then `draft → withdrawn`; resubmit through `submitTransitionDecision`); change requests (resubmit inside `submitChangeRequest`; `withdrawChangeRequest` on a request in approval = `withdrawApprovalInTx` then `withdrawn`; `change_request.withdraw_via_approval` then retired). Every other approval type is unchanged. Required tests are listed in A4.
7. **Revoked gate exception (ADR-0035 amendment A1).** Decided: it blocks approval. Approving a submission whose snapshot records a revoked exception is 422 **`gate.exception_revoked`**: "The exception for {label} was revoked on {date}; it no longer covers the missing evidence." Checked before `gate.exception_expired`; reject, request changes and defer stay allowed; the frozen submission is never changed. Reason: REQ-S04-012 "an authorized, unexpired exception", and §4's "missing again from that moment".
8. **Assessment-form version (ADR-0033 amendment A1).** Decided: amend the rule for this entity, **no `0061`**. A new form is at record version 2 because the create makes two audited writes to the form row (insert at 1, step to its first question version at 2); this is the one documented exception to "creates are version 1". The contract's 201 description now says so. A trigger change was rejected (it would loosen two proven `0047` guards to save one version number).
9. **Transformation-scoped reporting periods (ADR-0027 amendment A1).** Decided: required, by REQ-S07-017 (procedure "open KPI, select period, …"; permission "submit: assigned KPI owner/steward") with REQ-S07-003 ("submit: KDS, BO (assigned)"). REQ-S12-005 itself needs no read. New operation `GET /api/v1/transformations/{transformationId}/reporting-periods`, `listTransformationReportingPeriods`, `transformation.read`, the same `ReportingPeriodPage`, parameters, order and cursor as `listReportingPeriods` for the transformation's organization. Pending in `p4-pending-arch-r1.ts`.
10. **RAID Dependency entries (ADR-0031 amendment A1),** as the orchestrator preferred, no DG3 reopen: (1) no In progress for a Dependency (Open = `open`/`at_risk`, Closed = `resolved`; `in_progress` is 422 `raid.status_transition`); (2) no closure columns on `dependency`; a closed entry returns `closedAt`/`closedBy`/`closureNote` null and the closure note is the resolving audit event's `reason`; the screen shows it Closed with the note from history, never a blank closure or "Unknown"; (3) the RAID form requires a "To" initiative for a Dependency (FE-D); the API mapping is unchanged.

### E. Codes and keys added outside the ADRs (item 11)

11. **Method.** (a) Every code each named handback reports (BE-F, BE-G, BE-H, BE-H2, BE-I, BE-I2, BE-J, BE-K2, BE-L, BE-L2, BE-M, KBE-F, KBE-G, KBE-D2, KBE-E). (b) A mechanical scan (`evidence/codes-scan.py`, output `codes-scan-output.txt`): every double-quoted dotted literal in `apps/api/src`, `apps/worker/src` and `packages/shared/src` (non-test) that is absent from the DG3-approved commit `d3e6fe6` (`dg3-literals.txt`) and from every ADR; I then classified that output by hand and dropped column aliases, audit actions, event types and permission codes. Codes built at run time from a template were found from the handbacks (`validation.user_unknown`, `validation.group_unknown`, `validation.decimal_measure_scale`). BE-I's, BE-I2's and BE-L2's codes are all already in their ADRs (the scan finds none of theirs outside). **The table below is complete for what (a) and (b) find; a code reached only through a variable that neither finds is not covered** (none is known). **Decision:** every code is accepted into its owning ADR's amendment with the English text shown, except `change_request.withdraw_via_approval` (accepted until BE-R2, then retired) and the two **new** codes this task introduces (`approval.resubmit_through_record`, `gate.exception_revoked`). No code is replaced by an existing one: the duplicates I considered (`raci.party_unknown`, `role_mapping.party_unknown`, `validation.party_unknown`, all "{party} is not a known governance role.") are a 422 on a cell, a 422 on a mapping and a 400 on a query parameter, so each keeps its own pointer and status, and renaming them would change shipped responses for no user-visible gain. "server" texts are what the API already sends (placeholders are named here; the server interpolates them). "authored" texts are written by this task because the server sends only the key; FE renders them. Arabic is for FE to write and mark provisional where not linguistically reviewed.

Generated by `evidence/codes-table.py` (also `evidence/codes-table.md`); each ADR amendment carries its own rows.

| # | Code or key | Kind | Owning ADR | Decision | English text | Text origin | Where |
|---|---|---|---|---|---|---|---|
| 1 | `validation.job_code` | 400 field | ADR-0025 | accepted | A job code is two lower-case words joined by a dot, such as kpi.reporting_period_open. | authored | shared schemas/jobs.ts |
| 2 | `validation.link_path` | 400 field | ADR-0025 | accepted | A link must be a path inside this application that starts with a single '/'. | authored | shared schemas/tasks.ts |
| 3 | `validation.pattern` | 400 field | ADR-0025 | accepted | Use lower-case letters and '_' only. | authored | api tasks/routes.ts; shared schemas/delegations.ts |
| 4 | `group.code_taken` | 409 | ADR-0026 | accepted | A group with the code {code} already exists in this organization. | server | api access/groups.ts |
| 5 | `group.member_exists` | 409 | ADR-0026 | accepted | This person is already a current member of the group. | server | api access/groups.ts |
| 6 | `group.member_other_organization` | 422 | ADR-0026 | accepted | Only an active user of the group's organization can be a member. | server | api access/groups.ts |
| 7 | `group.owner_invalid` | 422 | ADR-0026 | accepted | The owner must be an active user of the group's organization. | server | api access/groups.ts |
| 8 | `group.archived` | 422 | ADR-0026 | accepted | This group is archived. Reactivate it before adding members. | server | api access/groups.ts |
| 9 | `group.member_removed` | 422 | ADR-0026 | accepted | This member has already been removed. | server | api access/groups.ts |
| 10 | `group.member_window_invalid` | 422 | ADR-0026 | accepted | A membership must end after it starts. | server | api access/groups.ts |
| 11 | `role_mapping.already_mapped` | 409 | ADR-0026 | accepted | This party is already mapped in this transformation. End the current mapping first. | server | api access/role-mappings.ts |
| 12 | `role_mapping.party_unknown` | 422 | ADR-0026 | accepted | {party} is not a known governance role. | server | api access/role-mappings.ts |
| 13 | `role_mapping.target_invalid` | 422 | ADR-0026 | accepted | Map the party to an active user, or an active group, of this transformation's organization. | server | api access/role-mappings.ts |
| 14 | `role_mapping.ended` | 422 | ADR-0026 | accepted | This mapping has already ended. Create a new mapping instead. | server | api access/role-mappings.ts |
| 15 | `validation.party_unknown` | 400 field | ADR-0026 | accepted | {party} is not a known governance role. | server | api access/role-mappings.ts (/query/party) |
| 16 | `validation.party_code` | 400 field | ADR-0026 | accepted | A governance role code starts with a capital letter and uses A-Z, 0-9 and '_' (up to 32 characters). | authored | shared schemas/groups.ts |
| 17 | `validation.duplicate_party` | 400 field | ADR-0026 | accepted | Each governance role can appear only once in a row. | authored | shared schemas/governance.ts |
| 18 | `raci.party_unknown` | 422 | ADR-0026 | accepted | {party} is not a known governance role. | server | api governance/raci.ts |
| 19 | `delegation.delegate_unknown` | 422 | ADR-0026 | accepted | The delegate must be an active user of the delegator's organization. | server | api access/delegations.ts |
| 20 | `delegation.scope_invalid` | 422 | ADR-0026 | accepted | The scope must be the delegator's organization, one of its business units or one of its transformations. | server | api access/delegations.ts |
| 21 | `validation.scope_pair` | 400 field | ADR-0026 | accepted | Give scopeType and scopeId together. | server | api access/delegations.ts |
| 22 | `approval.decision_right_unknown` | 422 | ADR-0026 | accepted | Choose an active decision right of this transformation. | server | api workflows/approvals.ts; governance/decision-rights.ts |
| 23 | `approval.subject_unknown` | 422 | ADR-0026 | accepted | The record to approve does not exist in this transformation. | server | api workflows/approvals.ts |
| 24 | `approval.calendar_not_configured` | 422 | ADR-0026 | accepted | Configure the organization's default business calendar before deferring this approval. | server | api workflows/approvals.ts |
| 25 | `validation.defer_only` | 400 field | ADR-0026 | accepted | Only a deferral takes a new date. | server | api workflows/approvals.ts |
| 26 | `approval.resubmit_through_record` | 422 | ADR-0026 | new (§4.1 amendment; BE-R2 implements) | Resubmit this request by submitting its record again. | authored | to be added to workflows/approvals.ts |
| 27 | `approvals.task.decide` | message key | ADR-0026 | accepted | Decide: {title} (round {roundNo}), due {dueDate}. | authored | api workflows/approvals.ts |
| 28 | `approvals.task.changes_requested` | message key | ADR-0026 | accepted | Changes were requested on {title} (round {roundNo}). Update the record and resubmit, or withdraw. | authored | api workflows/approvals.ts |
| 29 | `approvals.task.outcome` | message key | ADR-0026 | accepted | Your approval request {title} (round {roundNo}) was {outcome}. | authored | api workflows/approvals.ts |
| 30 | `approvals.task.escalated` | message key | ADR-0026 | accepted | Escalated to you: {title}, due {dueDate} (level {level}, from {fromParty} to {toParty}). | authored | worker handlers/approvals.ts |
| 31 | `approvals.task.overdue` | message key | ADR-0026 | accepted | {title} (round {roundNo}) is overdue since {dueDate} and was escalated to {escalatedToParty} (level {level}). | authored | worker handlers/approvals.ts |
| 32 | `approvals.task.overdue_routing_error` | message key | ADR-0026 | accepted | {title} (round {roundNo}) is overdue since {dueDate}, but it could not be escalated: {routingParty} has no mapped person ({routingError}). | authored | worker handlers/approvals.ts |
| 33 | `charter.decision_rights` | missing-item key | ADR-0026 | accepted | Charter decision rights | authored | api portfolio/readiness.ts (§9 readiness) |
| 34 | `kpi_definition.archived` | 422 | ADR-0027 | accepted | Archived records are read-only. | server | api kpi/kpi-versions.ts, rag-thresholds.ts, trajectories.ts |
| 35 | `validation.period_label` | 400 field | ADR-0027 | accepted | A period label starts with a letter or digit and uses letters, digits, '_', '.' and '-' (up to 32 characters). | authored | shared schemas/kpi-actuals.ts |
| 36 | `validation.trajectory_points_or_source` | 400 field | ADR-0027 | accepted | Give either the trajectory points or the outcome KPI to copy them from, not both. | authored | shared schemas/kpi-versions.ts |
| 37 | `validation.trajectory_point_dates_distinct` | 400 field | ADR-0027 | accepted | Each trajectory point needs its own date. | authored | shared schemas/kpi-versions.ts |
| 38 | `validation.variable_name` | 400 field | ADR-0027 | accepted | A variable name starts with a lower-case letter and uses a-z, 0-9 and '_' (up to 48 characters). | authored | shared schemas/kpi-versions.ts, benefits.ts, benefit-values.ts |
| 39 | `kpi.update_due` | message key | ADR-0027 | accepted | Enter the {periodLabel} actual for {kpiName}. | authored | worker handlers/kpi.ts |
| 40 | `kpi_actual.review_due` | message key | ADR-0027 | accepted | Review the {periodLabel} actual of {kpiName} (value {valueNo}). | authored | api kpi/actuals.ts |
| 41 | `kpi_actual.rejected` | message key | ADR-0027 | accepted | The {periodLabel} actual of {kpiName} (value {valueNo}) was rejected. Correct it and submit again. | authored | api kpi/actuals.ts |
| 42 | `kpi.downstream.kpi_panel` | label key | ADR-0027 | accepted | KPI panel | authored | api kpi/downstream.ts |
| 43 | `kpi.downstream.formula_kpi` | label key | ADR-0027 | accepted | Formula KPI that reads this KPI | authored | api kpi/downstream.ts |
| 44 | `kpi.downstream.outcome_kpi` | label key | ADR-0027 | accepted | Outcome KPI | authored | api kpi/downstream.ts |
| 45 | `kpi.downstream.executive_overview_outcomes` | label key | ADR-0027 | accepted | Executive Overview: outcomes | authored | api kpi/downstream.ts |
| 46 | `kpi.aggregation_period_mismatch` | roll-up refusal | ADR-0028 | accepted | Roll-up refused: scope {scopeId} is for period {periodId} ({basis}), not {expectedPeriodId} ({expectedBasis}); a roll-up never mixes periods. | server | shared kpi/aggregate.ts |
| 47 | `kpi.before_trajectory` | reason key | ADR-0028 | accepted | Unknown: the date is before the first trajectory point. | authored | shared kpi/trajectory.ts; api kpi/kpi-status.ts |
| 48 | `kpi.no_approved_trajectory` | reason key | ADR-0028 | accepted | Unknown: the KPI has no approved target trajectory. | authored | shared kpi/trajectory.ts, rag.ts |
| 49 | `kpi.calculation_pending` | reason key | ADR-0028 | accepted | Unknown: an accepted actual is waiting for its calculation run. | authored | api kpi/kpi-status.ts; adoption/indicators.ts, gate-facts.ts |
| 50 | `kpi.value_out_of_range` | reason key | ADR-0028 | accepted | Not computable: the result does not fit the stored decimal range. | authored | shared kpi/types.ts, formula-binding.ts; worker handlers/kpi.ts |
| 51 | `benefit_valuation_method.not_approved` | 422 | ADR-0029 | accepted | Only an approved valuation method can be retired. | server | api benefits/valuation-methods.ts |
| 52 | `benefit_value.period_range` | 422 | ADR-0029 | accepted | The period end cannot be before the period start. | server | api benefits/scenarios.ts, values.ts; db-errors.ts |
| 53 | `benefit_value.value_required` | 422 | ADR-0029 | accepted | A scenario value needs an amount or a KPI value. | server | api benefits/scenarios.ts, values.ts; db-errors.ts |
| 54 | `validation.decimal_share_scale` | 400 field | ADR-0029 | accepted | A share has at most 6 decimal places. | authored | shared schemas/benefits.ts |
| 55 | `validation.key` | 400 field | ADR-0029 | accepted | A key starts with a lower-case letter or digit and uses a-z, 0-9, '_', '.', ':' and '-' (up to 100 characters). | authored | shared schemas/benefits.ts |
| 56 | `validation.decimal_non_negative` | 400 field | ADR-0029 | accepted | Enter zero or a positive amount. | authored | shared schemas/benefit-scenarios.ts |
| 57 | `benefits.task.overlap_review` | message key | ADR-0029 | accepted | Review a possible double count between {benefitACode} and {benefitBCode} ({dimensions}). | authored | api benefits/overlaps.ts |
| 58 | `benefit.planned_value_missing` | reason key | ADR-0029 | accepted | Unknown: the benefit has no planned value. | authored | api benefits/register.ts |
| 59 | `benefit.value_amount_missing` | reason key | ADR-0029 | accepted | Unknown: an amount in this total is missing. | authored | api benefits/register.ts, totals.ts |
| 60 | `benefit.kpi_actual_missing` | reason key | ADR-0029 | accepted | Unknown: the measuring KPI has no accepted actual. | authored | api benefits/register.ts |
| 61 | `benefit.non_financial` | reason key | ADR-0029 | accepted | Not applicable: a non-financial benefit has no currency amount. | authored | api reporting/dashboards/engine.ts |
| 62 | `benefit.not_counted` | reason key | ADR-0029 | accepted | Not applicable: this benefit is not counted in the total. | authored | api reporting/dashboards/engine.ts |
| 63 | `benefit.overlap_open` | reason key | ADR-0029 | accepted | Unknown: an open double-count warning excludes this benefit until it is resolved. | authored | api reporting/dashboards/engine.ts |
| 64 | `benefits.task.finance_validation_review` | message key | ADR-0030 | accepted | Validate the value of {benefitCode} for {periodStart} to {periodEnd}. | authored | worker handlers/benefits.ts |
| 65 | `kpi.downstream.benefit` | label key | ADR-0030 | accepted | Benefit measured by this KPI | authored | api benefits/downstream.ts |
| 66 | `validation.not_applicable` | 400 field | ADR-0031, ADR-0033, ADR-0034 | accepted | This field does not apply here. | authored (RAID sends a per-field detail; BE-H2 sends the key) | api raid/register.ts; adoption/assessments.ts; sustainment/handovers.ts |
| 67 | `raid.task.action_due` | message key | ADR-0031 | accepted | Your action is due. With {sourceCode}: Your action on {sourceCode} is due. | authored | api raid/actions.ts |
| 68 | `raid.task.corrective_follow_up` | message key | ADR-0031 | accepted | Follow up corrective case {caseCode}. | authored | api raid/corrective-cases.ts; worker handlers/raid.ts |
| 69 | `meeting.quorum_locked` | 422 | ADR-0032 | accepted | The quorum is set before the session starts; this meeting is {status}. | server | api governance/meetings.ts |
| 70 | `validation.user_unknown` | 400 field | ADR-0032 | accepted | Choose an active user of this transformation's organization. | server | api governance/forums.ts (built as validation.${what}_unknown) |
| 71 | `validation.group_unknown` | 400 field | ADR-0032 | accepted | Choose an active group of this transformation's organization. | server | api governance/forums.ts (built as validation.${what}_unknown) |
| 72 | `validation.forum_unknown` | 400 field | ADR-0032 | accepted | Choose a forum of this transformation. | server | api governance/meetings.ts |
| 73 | `validation.end_before_start` | 400 field | ADR-0032 | accepted | The end date cannot be before the start date. | server | api governance/meeting-series.ts |
| 74 | `validation.decision_right_unknown` | 400 field | ADR-0032 | accepted | Choose an active decision-rights row of this transformation. | server | api governance/executive-decisions.ts |
| 75 | `validation.blocker_pair` | 400 field | ADR-0032 | accepted | A blocker link names both its record type and its record. | server | api governance/executive-decisions.ts |
| 76 | `validation.empty_patch` | 400 field | ADR-0032 | accepted | Change at least one field. | authored | shared schemas/governance-meetings.ts |
| 77 | `validation.local_time` | 400 field | ADR-0032 | accepted | Enter a time as HH:MM (24-hour clock). | authored | shared schemas/governance-meetings.ts |
| 78 | `validation.option_label` | 400 field | ADR-0032 | accepted | An option label is one capital letter, A to Z. | authored | shared schemas/executive-decisions.ts |
| 79 | `governance.task.executive_decision_due` | message key | ADR-0032 | accepted | Decide the executive ask {code}: {title}. | authored | api governance/executive-decisions.ts; worker handlers/escalations.ts |
| 80 | `governance.task.executive_decision_escalated` | message key | ADR-0032 | accepted | Escalated to you: executive ask {code} ({title}) passed its SLA date {slaDueDate} (level {level}). | authored | worker handlers/escalations.ts |
| 81 | `governance.notice.executive_decision_escalated` | notice key | ADR-0032 | accepted | The executive ask {code} ({title}) passed its SLA date {slaDueDate} and was escalated (level {level}). | authored | worker handlers/escalations.ts |
| 82 | `governance.notice.blocker_ask_calendar_not_configured` | notice key | ADR-0032 | accepted | A blocker has been red for {redCycles} cycles, but no executive ask was raised: the organization has no business calendar to set its SLA date. | authored | worker handlers/escalations.ts |
| 83 | `governance.notice.blocker_ask_owner_unassigned` | notice key | ADR-0032 | accepted | The executive ask {code} ({title}) has no owner: {partyCode} has no mapped person ({routingError}). | authored | worker handlers/escalations.ts |
| 84 | `governance.notice.series_calendar_not_configured` | notice key | ADR-0032 | accepted | No meetings were generated for this series: the organization has no business calendar for working days. | authored | worker handlers/meetings.ts |
| 85 | `validation.conflict` | 400 field | ADR-0033 | accepted | Name an existing KPI or ask to create one, not both. | authored | shared schemas/adoption-indicators.ts |
| 86 | `adoption.task.intervention_due` | message key | ADR-0033 | accepted | Adoption intervention {code} is due. | authored | api adoption/interventions.ts; worker handlers/adoption.ts |
| 87 | `adoption.task.assessment_invitation` | message key | ADR-0033 | accepted | Please complete the form {formName}. | authored | api adoption/assessments.ts |
| 88 | `adoption.task.assessment_to_review` | message key | ADR-0033 | accepted | Review the submitted form {formName}. | authored | api adoption/assessments.ts |
| 89 | `adoption.no_reporting_period` | reason key | ADR-0033 | accepted | Unknown: the organization has no reporting period. | authored | api adoption/gate-facts.ts |
| 90 | `invalid_transition (existing code)` | 422 detail | ADR-0033 | accepted detail texts | This champion is already removed. / A withdrawal record cannot itself be withdrawn. / This metric link is already removed. | server | api adoption/register.ts, indicators.ts |
| 91 | `validation.required (existing code)` | 400 field | ADR-0033 | accepted use | at /reportingPeriodId when the organization has no open or closed period (getAdoptionIndicators) | server | api adoption/indicators.ts |
| 92 | `sustainment.task.bau_handover_to_accept` | message key | ADR-0034 | accepted | Accept or return the BAU handover {handoverCode} for {areaCode} {areaName}. | authored | api sustainment/handovers.ts |
| 93 | `sustainment.task.performance_review_due` | message key | ADR-0034 | accepted | Review performance area {areaCode} by {dueDate}. | authored | api sustainment/performance-areas.ts; worker handlers/sustainment.ts |
| 94 | `sustainment.task.control_check_due` | message key | ADR-0034 | accepted | Run the control check {controlCode} by {dueDate}. | authored | worker handlers/sustainment.ts |
| 95 | `sustainment.task.benefit_monitoring_due` | message key | ADR-0034 | accepted | Monitor the residual benefit of transition decision {decisionCode} by {dueDate}. | authored | api sustainment/transition-decisions.ts; worker handlers/sustainment.ts |
| 96 | `gate.exception_revoked` | 422 | ADR-0035 | new (item 7; BE-R2 implements) | The exception for {label} was revoked on {date}; it no longer covers the missing evidence. | authored | to be added to workflows/gates.ts |
| 97 | `forbidden (existing code)` | 403 detail | ADR-0035 | accepted detail text | Only the requester can withdraw their exception. | server | api workflows/gate-exceptions.ts |
| 98 | `validation.duplicate_scope_item` | 400 field | ADR-0035 | accepted | Each item can appear only once in the scale scope. | authored | shared schemas/gates-p4.ts |
| 99 | `gates.task.gate_decision_due` | message key | ADR-0035 | accepted | Decide gate {gateCode}, submission {submissionNo}. | authored | worker handlers/gates.ts |
| 100 | `gates.task.gate_condition_due` | message key | ADR-0035 | accepted | Meet condition {ordinal} of the {gateCode} decision. | authored | worker handlers/gates.ts |
| 101 | `gates.task.gate_exception_to_decide` | message key | ADR-0035 | accepted | Decide an exception for {criterionKey} at gate {gateCode} (expires {expiresOn}). | authored | api workflows/gate-exceptions.ts |
| 102 | `gates.task.gate_exception_expired` | message key | ADR-0035 | accepted | The exception for {criterionKey} at gate {gateCode} expired on {expiresOn}. Close the evidence gap. | authored | worker handlers/gates.ts |
| 103 | `gates.notice.gate_exception_expired` | notice key | ADR-0035 | accepted | The exception for {criterionKey} at gate {gateCode} expired on {expiresOn}; it no longer covers the missing evidence. | authored | worker handlers/gates.ts |
| 104 | `gates.task.phase_step_enabled` | message key | ADR-0035 | accepted | Phase step {stepKey} ({phaseCode}) can start. | authored | api workflows/phase-steps.ts; worker handlers/gates.ts |
| 105 | `gates.task.phase_step_review` | message key | ADR-0035 | accepted | Review phase step {stepKey} ({phaseCode}). | authored | api workflows/phase-steps.ts |
| 106 | `gates.task.scale_scope_enabled` | message key | ADR-0035 | accepted | Scale-out of {initiativeCode} is enabled in its approved scope. | authored | worker handlers/gates.ts |
| 107 | `g5.performance_not_loaded / g5.adoption_not_loaded / g5.risk_closure_not_loaded / g5.decision_log_not_loaded / g6.benefits_not_loaded / g6.ownership_not_loaded / g6.controls_not_loaded / g6.improvement_not_loaded` | missing-item key | ADR-0035 | accepted | {label}: the facts could not be read. | server | api workflows/g5.ts, g6.ts |
| 108 | `g5.performance_no_kpi` | missing-item key | ADR-0035 | accepted | Performance evidence: no KPI is linked to an outcome of the transformation. | server | api workflows/g5.ts |
| 109 | `g5.performance_no_accepted_actual` | missing-item key | ADR-0035 | accepted | Performance evidence: {name} has no accepted actual. | server | api workflows/g5.ts |
| 110 | `g5.performance_kpi_not_known` | missing-item key | ADR-0035 | accepted | Performance evidence: {name} is {valueStatus}. | server | api workflows/g5.ts |
| 111 | `g5.performance_pilot_evidence_missing` | missing-item key | ADR-0035 | accepted | Performance evidence: no verified evidence is linked to the Transform step "deliver pilots". | server | api workflows/g5.ts |
| 112 | `g5.adoption_none` | missing-item key | ADR-0035 | accepted | Adoption: no adoption indicator is linked to the transformation. | server | api workflows/g5.ts |
| 113 | `g5.adoption_indicator_unknown` | missing-item key | ADR-0035 | accepted | Adoption: indicator {templateKey} has no current value ({valueStatus}). | server | api workflows/g5.ts |
| 114 | `g5.risk_open` | missing-item key | ADR-0035 | accepted | Risk closure: {code} has High impact and is neither closed nor dispositioned. | server | api workflows/g5.ts |
| 115 | `g5.decision_log_empty` | missing-item key | ADR-0035 | accepted | Decision log: the T16 decision log has no entry. | server | api workflows/g5.ts |
| 116 | `g5.decision_date_missing` | missing-item key | ADR-0035 | accepted | Decision log: {name} is open and its decision date is missing. | server | api workflows/g5.ts |
| 117 | `g5.decision_overdue` | missing-item key | ADR-0035 | accepted | Decision log: {name} is open past its decision date {decisionDate}. | server | api workflows/g5.ts |
| 118 | `g6.benefits_none` | missing-item key | ADR-0035 | accepted | Benefits evidence: the transformation has no benefit. | server | api workflows/g6.ts |
| 119 | `g6.benefit_not_validated` | missing-item key | ADR-0035 | accepted | Benefits evidence: {code} {title} has no Finance-validated measurement and no approved transition decision. | server | api workflows/g6.ts |
| 120 | `g6.performance_area_none` | missing-item key | ADR-0035 | accepted | Ownership transfer: the transformation has no performance area. | server | api workflows/g6.ts |
| 121 | `g6.handover_not_accepted` | missing-item key | ADR-0035 | accepted | Ownership transfer: {code} {name} has no accepted BAU handover in its current cycle. | server | api workflows/g6.ts |
| 122 | `g6.controls_no_handover` | missing-item key | ADR-0035 | accepted | Controls: no performance area has an accepted BAU handover. | server | api workflows/g6.ts |
| 123 | `g6.control_missing` | missing-item key | ADR-0035 | accepted | Controls: {code} {name} has no active control. | server | api workflows/g6.ts |
| 124 | `g6.improvement_backlog_empty` | missing-item key | ADR-0035 | accepted | Continuous improvement backlog: the improvement backlog is empty. | server | api workflows/g6.ts |
| 125 | `change_request.withdraw_via_approval` | 422 | ADR-0036 | accepted until BE-R2, then retired (replaced by the in-transaction withdraw) | This change request is in approval; withdraw its approval instead. | server | api workflows/change-requests.ts |
| 126 | `validation.proposed_change` | 400 field | ADR-0036 | accepted | This proposed change does not fit the kind of change requested. | authored | shared schemas/change-control.ts |
| 127 | `validation.proposed_change_size` | 400 field | ADR-0036 | accepted | A change request proposes between 1 and 20 changes. | authored | shared schemas/change-control.ts |
| 128 | `validation.ratio_range` | 400 field | ADR-0037 | accepted | Enter a decimal ratio from 0 to 1. | authored | shared schemas/dashboards.ts |
| 129 | `dashboard.rag.outcomes.trajectory` | rule key | ADR-0037 | accepted | Outcomes: the worst outcome-KPI status against its trajectory. | authored | api reporting/dashboards/areas.ts |
| 130 | `dashboard.rag.value.validated_gap` | rule key | ADR-0037 | accepted | Value: validated value against the value planned to date. | authored | api reporting/dashboards/areas.ts |
| 131 | `dashboard.rag.portfolio.milestone_outcome` | rule key | ADR-0037 | accepted | Portfolio: the worst milestone slip of the top initiatives. | authored | api reporting/dashboards/areas.ts |
| 132 | `dashboard.rag.dependencies.needed_by_critical_path` | rule key | ADR-0037 | accepted | Dependencies: open dependencies needed soon or on the critical path. | authored | api reporting/dashboards/areas.ts |
| 133 | `dashboard.rag.decisions.overdue` | rule key | ADR-0037 | accepted | Decisions: at least one open decision is past its decision date. | authored | api reporting/dashboards/areas.ts |
| 134 | `dashboard.rag.decisions.due` | rule key | ADR-0037 | accepted | Decisions: open decisions are due soon. | authored | api reporting/dashboards/areas.ts |
| 135 | `dashboard.rag.adoption.curve` | rule key | ADR-0037 | accepted | People and adoption: the worst adoption indicator against its curve. | authored | api reporting/dashboards/areas.ts |
| 136 | `dashboard.value.gap_ratio` | rule key | ADR-0037 | accepted | Value gap = (planned due to date - validated) / planned due to date. | authored | api reporting/dashboards/drilldown.ts |
| 137 | `dashboard.value.sum_investment` | rule key | ADR-0037 | accepted | Investment = the sum of the approved budget lines. | authored | api reporting/dashboards/drilldown.ts |
| 138 | `dashboard.finance.pending_validation` | rule key | ADR-0037 | accepted | Values waiting for Finance validation. | authored | api reporting/dashboards/drilldown.ts |
| 139 | `dashboard.value.nothing_planned` | reason key | ADR-0037 | accepted | Not applicable: nothing is planned to date. | authored | api reporting/dashboards/areas.ts, drilldown.ts, engine.ts |
| 140 | `dashboard.value.no_financial_benefit` | reason key | ADR-0037 | accepted | Not applicable: there is no financial benefit. | authored | api reporting/dashboards/drilldown.ts, engine.ts |
| 141 | `dashboard.value.multiple_currencies` | reason key | ADR-0037 | accepted | Not applicable: the values are in more than one currency and are never converted. | authored | api reporting/dashboards/drilldown.ts |
| 142 | `dashboard.portfolio.no_allocated_value` | reason key | ADR-0037 | accepted | Unknown: no benefit value is allocated to this initiative. | authored | api reporting/dashboards/drilldown.ts, engine.ts |
| 143 | `dashboard.portfolio.no_approved_milestone` | reason key | ADR-0037 | accepted | Unknown: the initiative has no approved milestone date. | authored | api reporting/dashboards/areas.ts |
| 144 | `dashboard.portfolio.milestone_overdue` | reason key | ADR-0037 | accepted | Red: a milestone is past its approved date and not achieved. | authored | api reporting/dashboards/areas.ts |
| 145 | `dashboard.portfolio.milestone_slip` | reason key | ADR-0037 | accepted | A milestone has slipped past its approved date. | authored | api reporting/dashboards/areas.ts |
| 146 | `dashboard.kpi.no_period_in_window` | reason key | ADR-0037 | accepted | Unknown: no reporting period falls in the selected window. | authored | api kpi/dashboard-facts.ts |
| 147 | `dashboard.headline.value_planned` | label key | ADR-0037 | accepted | Planned value | authored | api reporting/dashboards/engine.ts |
| 148 | `dashboard.headline.value_forecast` | label key | ADR-0037 | accepted | Forecast value | authored | api reporting/dashboards/engine.ts |
| 149 | `dashboard.headline.value_submitted` | label key | ADR-0037 | accepted | Submitted value | authored | api reporting/dashboards/engine.ts |
| 150 | `dashboard.headline.value_validated` | label key | ADR-0037 | accepted | Validated value | authored | api reporting/dashboards/engine.ts |
| 151 | `dashboard.headline.value_gap` | label key | ADR-0037 | accepted | Value gap | authored | api reporting/dashboards/engine.ts |
| 152 | `dashboard.headline.value_investment` | label key | ADR-0037 | accepted | Investment | authored | api reporting/dashboards/engine.ts |
| 153 | `dashboard.headline.outcome_kpis` | label key | ADR-0037 | accepted | Outcome KPIs | authored | api reporting/dashboards/engine.ts |
| 154 | `dashboard.headline.top_initiatives` | label key | ADR-0037 | accepted | Top initiatives | authored | api reporting/dashboards/engine.ts |
| 155 | `dashboard.headline.open_dependencies` | label key | ADR-0037 | accepted | Open dependencies | authored | api reporting/dashboards/engine.ts |
| 156 | `dashboard.headline.open_decisions` | label key | ADR-0037 | accepted | Open decisions | authored | api reporting/dashboards/engine.ts |
| 157 | `dashboard.headline.overdue_decisions` | label key | ADR-0037 | accepted | Overdue decisions | authored | api reporting/dashboards/engine.ts |
| 158 | `dashboard.headline.adoption_indicators` | label key | ADR-0037 | accepted | Adoption indicators | authored | api reporting/dashboards/engine.ts |
| 159 | `validation.basis_needs_share` | 400 field | ADR-0038 | accepted | An allocation basis needs a share. | server | api portfolio/links.ts; reporting/traceability.ts |
| 160 | `validation.share_range` | 400 field | ADR-0038 | accepted | A share is more than 0 and at most 1 (100 %). | authored | shared schemas/traceability.ts |
| 161 | `validation.decimal_measure_scale` | 400 field | ADR-0038 | accepted | Enter a decimal with at most 6 decimal places. | authored | shared schemas/kpi.ts columnDecimal (SHARE_COLUMN is named 'measure') |
| 162 | `validation.root_pair` | 400 field | ADR-0038 | accepted | Give rootType and rootId together. | authored | shared schemas/traceability.ts (api reporting/traceability.ts) |
| 163 | `trace_link.record_not_found (existing ADR-0038 §12 code)` | 422 | ADR-0038 | accepted reuse | on a getTraceability root that is not a record of that type in the transformation (the §12 text) | server | api reporting/traceability.ts |

## 3. Checks actually run

All in the main tree (`/home/user/My-owns`), Node 24.21.0, offline. Logs under `docs/delivery/handbacks/DG4/T-DG4-ARCH-R1-evidence/`.

| Check | Command | Result |
|---|---|---|
| Historical DG3 (start) | `node tools/gates/validate.mjs --historical --stage DG3` | exit 0, `PASS gate DG3 (historical)` (before any edit) |
| `0060` probe | `QA_PG_PORT=23700 MTH_PORT_POOL=23701-23709 tests/qa/support/with-pg.sh node --conditions=@mth/source docs/delivery/handbacks/DG4/T-DG4-ARCH-R1-evidence/probe.ts` | exit 0, **29 PASS / 0 FAIL**, first and only run (`probe-output.txt`) |
| Typecheck | `pnpm -r typecheck` | exit 0 (`typecheck.log`) |
| Build | `pnpm -r build` | exit 0 (`build.log`) |
| Lint | `pnpm lint` | exit 0, `--max-warnings=0` (`lint.log`) |
| Format | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 (`format.log`) |
| OpenAPI | `pnpm openapi:lint` | exit 0, `PASS … OpenAPI 3.1.1, 647 operations` (`openapi-lint.log`) |
| Unit, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | exit 0: 121 files / **2313 passed**; 3 files / **259 passed, 2 skipped** (`unit-locale-unset.log`) |
| Unit, `C.UTF-8` | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | exit 0: 121 / **2313 passed**; 3 / **259 passed, 2 skipped** (`unit-c-utf8.log`) |
| Integration | `QA_PG_PORT=23720 MTH_PORT_POOL=23721-23749 tests/qa/support/with-pg.sh pnpm test:integration` | **Run 2 (cited): exit 0, 155 files, 1564/1564 passed** (`integration.log`). **Run 1: exit 1, 1563/1564** (`integration-run1-interfered.log`), disclosed below |
| Historical DG3 (end) | `node tools/gates/validate.mjs --historical --stage DG3` | exit 0, `PASS gate DG3 (historical)` (`validate-dg3-historical-end.log`) |

**Integration run 1 failure (disclosed).** One test failed: `workflows/g5-g6.test.ts` › "G6 Sustain … writes nothing under docs/delivery/" (`expected […(13401)] to deeply equal […(13401)]`). That test hashes every file under `docs/delivery/` before and after the G6 approval. During its 20-second window my run was appending its own log to `docs/delivery/handbacks/DG4/T-DG4-ARCH-R1-evidence/integration.log`, and I was writing this handback, so the tree changed for a reason outside the product. I re-ran the **whole** suite (same command and ports) with the log in `$TMPDIR` and wrote nothing under `docs/delivery/` until it ended. Run 2 passed 1564/1564, including that test, and its log was then copied into the evidence. The integration count equals D-108's 1564: this task adds no integration test. The three reads whose skips were removed are now contract-checked inside existing tests. Lesson for later runs: never write an integration log under `docs/delivery/` while the suite runs.

Unit counts equal the D-108 merged-tree counts (2313 + 259/2 skipped): this task adds no unit test. Disk before the full runs: 22 GB free (`df -h .`). I removed two empty `.claude/.cc-writes` directories that the file tools had left in `apps/api/test/support/` and `packages/db/migrations/` (as the sibling assignments instruct). I noticed them only after integration run 1 and the locale-unset unit run had started; they were gone before the `C.UTF-8` unit run and integration run 2. They are empty, untracked and not `.sql`, so the migrator skips them. Not run: e2e (not in this assignment's acceptance list; no web file changed).

## 4. The `0060` probe (summary of `probe-output.txt`)

- **R00** ids `0001`–`0060` contiguous, `0060` last, no `0061`.
- **Fresh database:** `0001`→`0059` apply (R01). Before `0060`: six `job_schedule` rows, none `governance.*`; `benefit_control_cadence_check` = `CHECK (((control_cadence IS NULL) OR (control_cadence = ANY (ARRAY['monthly'::text, 'quarterly'::text, 'semiannual'::text, 'annual'::text]))))` (R02). `0060` applies alone (R03). After: nine rows, the three new ones `governance.blocker_escalation_scan` `45 0 * * *`, `governance.decision_sla_scan` `40 0 * * *`, `governance.meeting_series_generate` `35 0 * * *`, all `Asia/Riyadh`, enabled, owner `governance`, v1; three `job_schedule.create` audit events; the CHECK is `… ARRAY['weekly'::text, 'monthly'::text, 'quarterly'::text, 'semiannual'::text, 'annual'::text] …` (R04). The exact new CHECK, applied to a scratch table, accepts `weekly`, `monthly`, `quarterly`, `semiannual`, `annual`, NULL and refuses `semi_annual`, `fortnightly` (R05). A second migrate applies nothing (R06).
- **P3-populated database:** `0001`→`0027`, synthetic P1 rows (organization, user, business unit, transformation), then `0028`→`0059` (32 files) (R07, R08); before/after exactly as on the fresh database (R09–R11); the synthetic transformation is untouched (R12); `mth_app` cannot insert a `job_schedule` row (`permission denied`, R13); the CHECK accepts/refuses as above (R14).

## 5. Every changed contract line (`git diff -U0 docs/api/openapi.yaml`, `evidence/openapi-diff.txt`; 65 added, 9 removed)

| Where (new line numbers) | Change | Reason |
|---|---|---|
| `info.description`, 107–111 | + one paragraph "P4 repairs (T-DG4-ARCH-R1, 2026-10-09)" | Records what this task changed |
| `paths`, 8868–8889 | + `/api/v1/transformations/{transformationId}/reporting-periods` `get` `listTransformationReportingPeriods` | Item 9 |
| `paths`, 13302–13321 | + `/api/v1/transformations/{transformationId}/adoption-metric-links/{adoptionMetricLinkId}` `get` `getAdoptionMetricLink` | Item 2 |
| 13407 (`createAssessmentForm` 201) | `description: "Created (draft, version 1)."` → the record-version-2 description | Item 8 |
| 15242 (`getPhaseStep` 200), 15804 (`getChangeControlPolicy` 200), 16269 (`getDashboardRagPolicy` 200) | `ETag: { $ref: "#/components/headers/ETag" }` → `…/ETagOrZero` | Item 1 |
| 15258 (`updatePhaseStep`), 15820 (`putChangeControlPolicy`), 16285 (`putDashboardRagPolicy`) | `- $ref: "#/components/parameters/IfMatch"` → `…/IfMatchOrZero` | Item 1 |
| `components.parameters`, 17916–17921 | + `IfMatchOrZero` | Item 1 |
| `components.headers`, 18188–18190 | + `ETagOrZero` | Item 1 |
| 24155 (`Benefit.controlCadence`), 24249 (`BenefitUpdate.controlCadence`) | enum gains `weekly` (first) | Item 5 (`0060`) |

No P1–P3 path, schema or component changes; no other P4 operation changes. The response ETag of the three PUT/PATCH operations stays `ETag` (a written row is at least version 1).

## 6. What the implementers must change (none of it is in BE-R1's or KBE-R1's current scope)

**A later backend-workflow-engineer repair task (named BE-R2 in the ADRs):**
1. ADR-0026 amendment A2–A4: export `resubmitApprovalInTx` and `withdrawApprovalInTx` from `workflows/index.ts` (route bodies refactored onto them, responses byte-stable); `resubmitThroughSubject` on the providers of `governance_matrix_change`, `benefit_transition_decision` and `change_request`; the 422 `approval.resubmit_through_record`; adopt them in `governance/matrices.ts` (BE-C), `sustainment/transition-decisions.ts` (BE-J) and `workflows/change-requests.ts` (BE-L); the four tests per subject in A4. Then `change_request.withdraw_via_approval` is no longer produced.
2. ADR-0035 amendment A1: `gate.exception_revoked` in `workflows/gates.ts` (decision path, before the expiry check) and its three tests.
3. ADR-0034 amendment A1: `handovers.ts` maps `weekly → weekly` (today it leaves the cadence unchanged), with the test.

**A later kpi-benefits-engineer repair task:**
1. Route and exercise `listTransformationReportingPeriods` (ADR-0027 amendment A1, with its tests) and `getAdoptionMetricLink` (ADR-0033 amendment A2); remove both from `p4-pending-arch-r1.ts`; add zod mirrors where the slice's convention requires them.
2. Optional: drop the string branch of `dimensionsOf` and its one assertion in `d2-rules.test.ts` (no longer needed after the type fix).

**FE (FE-C to FE-G, per slice):**
1. Translate every row of the §2 item 11 table (EN text as given; AR provisional until reviewed). FE-C was told to use the handbacks; this table supersedes them where they differ.
2. FE-D: the RAID form requires a "To" initiative for a Dependency; a closed Dependency shows Closed and its closure note from the record history (ADR-0031 A1).
3. FE-B follow-up: use `listTransformationReportingPeriods` once it is routed, instead of the current-period fallback.
4. Clients take a record's version from its ETag (a new assessment form is at version 2).

**BE-R1 / KBE-R1 (running now):** no change to their assignments is needed. My edits touch no file in their stated ownership; the only shared areas are the pending-list aggregator `p4-pending.ts` and `p4-operations.ts`, which they do not edit.

## 7. Known gaps / not done

- The two new operations are contract-only (pending); the two new codes and the three implementation changes in §6 are specified, not implemented (by assignment: "BE-R1 implements them" is superseded by BE-R1's own assignment, which says a later BE-R2 does).
- KBE-D2's `dimensionsOf` workaround is left in place (optional removal, §6).
- The code table is complete only for what the handbacks and the scan find (§2 item 11).
- The Arabic `description_ar` texts of the three `job_schedule` rows are provisional translations.
- No e2e run (not required; no web change).

## 8. Merge instructions

- Apply `0060` with `mth-db migrate` after `0059`. It depends only on `0028` (`job_schedule`) and `0037` (`benefit`). Forward-only; never edit it once merged.
- No conflict is expected with BE-R1, KBE-R1 or FE-C (their assignments name no file I changed). If a later task also edits `contract.test.ts`'s count pin, the counts add (647 + its own).
- The `contract.test.ts` pending mechanism fails if an operation in `p4-pending-arch-r1.ts` gets routed without being removed from the list, so the KBE repair task must remove both entries in the same change.

## 9. Untracked files that are not mine

`git status` lists untracked files at the repository root that this task did not create and did not touch: `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc` (all present at my first `git status`, before any edit), and `CLAUDE.local.md`, which was not in that first listing and appeared during the run (I did not create it; `ls -la` shows a character device 1,3 dated 20:23, i.e. a `/dev/null` mount, so it looks like a sandbox artifact), plus the four `docs/delivery/runs/DG4/*` run directories of this wave. The format check passed with them present. They are for the orchestrator to judge; none should be integrated as part of this task.
