# ADR-0042: Procedure definitions (versioned through Studio), persistent procedure instances pinned to the definition version, outputs as linked records, the ten seeded procedures, the methodology coverage view, and the TOM and procedures entity group

- **Status:** Proposed for P5 (DG5). Author: solution-architect (T-DG5-ARCH-02), 2026-10-14.
- **Requirements (slice C of `docs/architecture/p5-plan.md`):** REQ-S01-003, REQ-S06-001, REQ-S06-002, REQ-S06-003, REQ-S16-015.
- **Sources (quoted where a design point has one):**
  - M0078 (§1): "Convert its entire operating system into connected, editable, executable workflows: input → procedure → validation → approval where required → output → performance and benefits monitoring → correction → sustainment."
  - M0152 (§6): "The playbook must be both readable and executable. A procedure definition must contain purpose, trigger, scope, prerequisites, inputs and input schema, ordered/conditional/parallel steps, responsible roles, SLA, validation rules, approval path, escalation path, expected outputs, completion conditions, exceptions and version/effective date."
  - M0153 (§6): "Each launched procedure creates a persistent procedure instance showing current step, assignee, due date, missing inputs, completed evidence and next action. Its outputs must be real linked records or generated deliverables. Include configurable procedures for new transformation intake, baseline validation, KPI submission, TOM approval, initiative prioritization, gate review, scope/target change, benefit validation, executive escalation and BAU handover."
  - M0155 (§6): "Keep published versions immutable."
  - M0321 (§16): "TOMDimension, TOMCanvas, Capability, Gap, Journey, Process, ProcedureDefinition and ProcedureInstance."
  - M0118–M0123 (§4): the phase procedure clauses already built as DG4 phase steps (ADR-0035 §1); unchanged here (p5-plan §3 row 7).
- **Decisions applied:** D-141, D-142 (**Q1**, **Q4** "create" for fixed catalogue entities), D-143, D-088 §2 and F-DG3-100.
- **Builds on:** ADR-0003, ADR-0004, ADR-0006, ADR-0007, ADR-0016, ADR-0018 (evidence), ADR-0026 (canonical approval and work items), ADR-0028 (business calendar and working days), ADR-0035 (phase steps), ADR-0039 (Studio kinds and pipeline), ADR-0041 (field types for inputs; `form_record_type` registry).
- **Physical model:** `0069_p5_procedures.sql`, `0070_p5_forms_procedures_permissions_coverage.sql` (permissions, coverage links). Probe ids (PS, PD, PI, CO, PM) refer to `docs/delivery/handbacks/DG5/T-DG5-ARCH-02-evidence/probe-output.txt`.
- **Two gate systems.** Product gates G1–G6 are business approvals inside the product; nothing here reads or writes DG0–DG7. An approval step of a procedure is decided by the human holder of the business approval right through the canonical approval; no seed, job, rule or agent decides it.

## Context

As built on `HEAD` `7344b25`: there is no procedure entity. The DG4 phase steps (`phase_step_definition`, `phase_step`, `0051`) implement the phase procedure clauses M0118–M0123 as a fixed checklist per phase. Slice A declared the configuration kind `procedure` (`0062`) and its review policy row (review required, reviewer TO). The canonical approval (`approval`, `0031`; ADR-0026) decides business approvals with SoD and stale-409 rules. Work items and reminders exist (ADR-0026 §6), and slice E (ADR-0043/0044) owns the rule engine that will send step due/overdue reminders.

## Decision

### 1. Procedure definitions are versioned Studio configuration (REQ-S06-001)

Procedure definitions are configuration kind `procedure`, one key **`procedures`** (one pin per kind, as forms; ADR-0041 Alternative 2). A definition is a **typed, version-scoped row** `procedure_definition (methodology_version_id, code)` with its steps in `procedure_step_definition`; both are written only while their version is a draft being edited (`procedure_definition_draft_only`, `procedure_step_definition_draft_only`; PS03), never change version/code/origin (PD15), and are published, reviewed, diffed and rolled back through the slice A pipeline unchanged (lock 730250/730251). A new draft copies every definition and step row of its base version (the ADR-0039 §2 copy rule; BE-F's provider does it in the draft-create transaction). The content hash of a `procedure` version covers its definition and step rows: the provider supplies them to the ADR-0039 §1 canonical JSON as `elements` entries `{elementType: 'procedure' | 'procedure_step', stableKey: code | code.stepKey, origin, removed, ordinal, attributes: <typed columns>}`, so a step edit after preview invalidates the stored runs.

**The M0152 parts, one column each (all typed; `NOT NULL` unless marked optional):**

| M0152 part | Column(s) |
|---|---|
| purpose | `purpose_en`, `purpose_ar` |
| trigger | `trigger_kind` (`manual`, `event`, `schedule`), `trigger_event` (required exactly for `event`: an outbox event type; CHECK `procedure_definition_trigger_event`; PD05), `trigger_en/ar` |
| scope | `scope_level` (`organization`, `transformation`), `scope_en/ar` |
| prerequisites | `prerequisites_en/ar` (optional, both or neither) |
| inputs and input schema | `input_schema`: JSON array (≤ 50) of field definitions validated with the ADR-0041 §3 Zod schemas (key, fieldType, labels, required, settings) |
| ordered/conditional/parallel steps | `procedure_step_definition` (§2) |
| responsible roles | `responsible_role_codes[]` (1–14); `launch_role_codes[]` (who may launch) |
| SLA | `sla_working_days` 1–250 (instance), `procedure_step_definition.sla_working_days` (step) |
| validation rules | `validation_rules_en/ar` (statement) + the enforced rules: the input schema, step required inputs, evidence and output requirements (§3) |
| approval path | `approval_mode` (`none`, `any`, `sequential`, `parallel`) + `approval_role_codes[]` (complete together; CHECK) + approval steps (§2) |
| escalation path | `escalation_role_code` + `escalation_after_working_days` (both or neither) |
| expected outputs | `expected_outputs_en/ar` + each step's `output_record_type`/`output_mode` |
| completion conditions | `completion_rule` (`all_steps_closed`, `all_steps_closed_and_outputs_linked`), `completion_en/ar` |
| exceptions | `exceptions_en/ar` (optional, both or neither) |
| version / effective date | the configuration `version_no` of `methodology_version` + `effective_from` (date) |

**Rejection of a definition missing a trigger or a completion condition** (REQ-S06-001): the API refuses it first with 422 `procedure_definition.trigger_required` / `procedure_definition.completion_required` (§10); the database has `trigger_kind`, `trigger_en/ar`, `completion_rule`, `completion_en/ar` `NOT NULL` (PD03, PD04).

**Roles.** Every role named (launch, responsible, approval, escalation, step) exists and is never a technical administrator (`ADM_*`) or `AUD` (`procedure_definition_roles`, `procedure_step_definition_roles`; PD06, PD07) — the S06-006/S10-003 rule of slice A applied to procedures.

### 2. Steps: ordered, conditional, parallel, approval

`procedure_step_definition`: `step_key`, `ordinal` 1–99, `parallel_group`, `step_kind` (`task`, `approval`), bilingual name and instructions, `responsible_role_code`, `approval_role_code`, `sla_working_days`, an optional condition (`condition_input_key`, `condition_operator` ∈ `eq`, `neq`, `in`, `gt`, `gte`, `lt`, `lte`, `present`, `absent`, `condition_value` JSON), `required_input_keys[]`, `evidence_required`, `output_record_type` + `output_mode` (`create`, `advance`, `link`), `skippable`, `removed`.

- **Ordered:** steps run in `ordinal` order; a step activates only when every step with a lower ordinal is closed (`completed`, `skipped`, `not_applicable`, `cancelled`) (trigger `procedure_step_instance_order`; PI07).
- **Parallel:** steps sharing an ordinal form one parallel group and must all name the same `parallel_group` (`procedure_step_definition_parallel_group`; PD09, PD10); they activate together, and the next ordinal waits for all of them.
- **Conditional:** a step with a condition is evaluated at activation against the instance inputs; when the condition is false the step becomes `not_applicable` (it never runs; shown as such, not as completed). Condition keys and required inputs must be declared inputs (`procedure_step_definition_inputs`; PD11). Numeric comparisons use decimal.js on decimal strings.
- **Approval:** an approval step names its business approver role (CHECK `procedure_step_definition_approval_complete`; PD12), cannot be skippable, and is completed only through an **approved** canonical approval (ADR-0026) created for the step (trigger `procedure_step_instance_approval`; PI21, PI22). The approval's SoD, delegation and stale rules apply unchanged; slice E's sequential/parallel routes (ADR-0044) apply when configured, and until then a DG4 single-step approval is used.

### 3. Procedure instances (REQ-S06-002)

`procedure_instance` is created by `launchProcedureInstance` in one transaction with one `procedure_step_instance` per not-removed step of the definition, then activates the first ordinal (lock 730254 on the instance id). It is **pinned**: `procedure_definition_id` and `methodology_version_id` (composite FK to that exact definition row), `procedure_code`, subject, launch key and launcher never change (`procedure_instance_pinned`; PI06); it is launched only from a **published**, not removed definition (`procedure_instance_launch`; PI03); scope matches the definition (`procedure_instance_scope`; PI04); input values name only declared inputs (`procedure_instance_inputs`; PI05) and are validated by the API with ADR-0041 §3. A later publish of a new `procedures` version never changes a running instance.

**What the instance shows** (`getProcedureInstance`; M0153's six items):

| Item | Source |
|---|---|
| current step | the active step(s) (several for a parallel group) |
| assignee | each step's `assignee_user_id`, else its `assignee_role_code` ("unassigned — role X") |
| due date | step `due_date` = activation date + `sla_working_days` working days on the transformation's business calendar (ADR-0028); instance `due_date` = launch + definition SLA. No calendar → **Unknown**, never today. |
| missing inputs | required inputs of the definition and of open steps that are absent or null in `input_values` (computed; the database refuses completing a step with missing required inputs: `procedure_step_instance_inputs`; PI09) |
| completed evidence | `procedure_instance_link` rows of kind `evidence` (the database refuses completing an evidence-required step without one: `procedure_step_instance_evidence`; PI11, PI12) |
| next action | the first open step's action for the reader: "Provide input X", "Link evidence", "Complete step Y", "Waiting for business approval by role Z", or "None — completed/cancelled" |

**Outputs are real linked records.** A step's output is produced by an **output adapter** (BE-G, `procedures/outputs/**`) per `output_record_type`, inside the step-completion transaction: `create` calls the owning module's existing service to create the record (e.g. `baseline` through the DG3 baseline create), `advance` performs the owning module's existing action on the record the instance already produced (e.g. the DG3 baseline validation by the FIN assignee, the DG2 gate decision recorded by its approver), `link` verifies and links a record the user created through its own screen. Adapters call the domain services with the acting user (every DG2–DG4 rule, SoD and permission applies; a domain refusal surfaces as that domain's problem code) and never write the domain tables directly. Each output is recorded in `procedure_instance_link` (append-only; PI16, PI17), which accepts only an existing record of its type in the instance's scope (`procedure_instance_link_record_ref`; PI15). With `completion_rule = all_steps_closed_and_outputs_linked` the instance completes only when every completed step with an expected output has linked it, and every step is closed (`procedure_instance_completion`; PI13). REQ-S06-002's acceptance (A02 part) is: a `baseline_validation` instance shows `record_baseline` active with its assignee; completing both steps creates a baseline record, the FIN step validates it, and the validated baseline is linked to the instance.

Output record types (closed set, CHECK on both tables): `transformation`, `charter`, `baseline`, `kpi_actual`, `tom_canvas_cell`, `approval`, `ranking_snapshot`, `gate_submission`, `change_request`, `finance_validation`, `decision`, `bau_handover`, `evidence`.

**Exactly once.** A launch by an automation (slice E) passes `launch_key` (UNIQUE `procedure_instance_launch_key`; PI25, PI26): a replay creates nothing. A user launch may send `Idempotency-Key` (ADR-0007). Step transitions take lock 730254 and check `If-Match` on the instance.

### 4. State machines

```text
procedure_instance:      active -> completed | cancelled           (final; PI24)
                         completed needs every step closed and, by completion_rule, every expected output linked (PI13)
                         cancelled needs reason, by, at; open steps are cancelled in the same transaction (PI23)
procedure_step_instance: pending -> active | not_applicable | cancelled
                         active  -> completed | skipped | cancelled
                         (others final; a closed step never changes: PI14)
                         active/not_applicable only when every lower ordinal is closed (PI07)
                         completed: required inputs present (PI09), evidence linked when required (PI11),
                                    approval steps only with an approved canonical approval (PI21)
                         skipped: only skippable steps (never approval steps; PI22), with a reason
procedure versions:      the slice A machine (ADR-0039 §1)
```

### 5. The ten seeded procedures (REQ-S06-003)

`procedures` v1 (`0069`, seed, published; PS01) holds the ten M0153 procedures in the M0153 order, each with all M0152 parts, a trigger and a completion rule, two to four steps (31 steps; conditional, parallel and approval steps included; PS02):

| Code | Scope | Steps (ordinal: key; role) | Output(s) |
|---|---|---|---|
| `new_transformation_intake` | organization | 1 capture_intake (TL) → 2 draft_charter (TL) → 3 confirm_sponsor (approval SP) | transformation (create), charter (link), approval |
| `baseline_validation` | transformation | 1 record_baseline (BO, evidence) → 2 validate_baseline (FIN) | baseline (create, then advance = validated) |
| `kpi_submission` | transformation, trigger `schedule` | 1 submit_actual (BO) → 2 accept_actual (KDS) | kpi_actual |
| `tom_approval` | transformation | 1 complete_canvas (TL) → 2 ∥ technology_review (TD), business_review (BO) → 3 sponsor_approval (approval SP) | tom_canvas_cell (link), approval |
| `initiative_prioritization` | transformation | 1 score_initiatives (TL) → 2 record_ranking (TO) → 3 approve_ranking (approval SP) | ranking_snapshot, approval |
| `gate_review` | transformation | 1 prepare_submission (TL, evidence) → 2 ∥ criteria_review (TO), finance_review (FIN, **conditional** on `financeReviewRequired = yes`) → 3 gate_decision (approval SP) | gate_submission (create, then advance = decided) |
| `scope_target_change` | transformation | 1 raise_change (TL) → 2 assess_impact (TO) → 3 decide_change (approval SP) | change_request |
| `benefit_validation` | transformation | 1 measure_benefit (BO) → 2 ∥ attach_evidence (BO, evidence), finance_validation (FIN) → 3 recovery_plan (TL, **conditional** on `belowTarget = yes`) | evidence (link), finance_validation |
| `executive_escalation` | transformation | 1 raise_escalation (TL) → 2 executive_decision (approval SP) → 3 communicate_decision (TL, skippable) | decision (T16) |
| `bau_handover` | transformation | 1 prepare_handover (TL, evidence) → 2 accept_handover (approval BO, the DG4 `bau_handover.accept` holder) → 3 schedule_reviews (TO) | bau_handover |

**Provenance (exactly true):** the ten names are the M0153 list; every other part (purpose, steps, roles, SLAs, inputs, rules) is a **product default** written for this platform, not playbook text, and is labelled so in the definition (`definition.productDefaults = true`) and in the reader (slice I). Arabic texts are provisional translations marked "(ترجمة مؤقتة)" on the names. Seeded definitions are editable through Studio drafts and **cannot be removed** (CHECK `procedure_definition_source_kept`; PD08) so the coverage view stays complete. Each can be launched and completed through §3 in the A02 scenario (QA-E); slice E registers the `trigger_kind = event/schedule` launches as rule actions.

### 6. The methodology coverage view (REQ-S01-003)

`methodology_coverage_link` (`0070`, read-only) maps each of the 80 counted source elements of slice A's `source_element` inventory to its native form(s) and procedure(s) (114 links; every element has at least one: CO01; targets checked: CO02; read-only: CO03). The mapping: modes → `new_transformation_intake`; phases → form `phase_step` + `gate_review`; gates → `gate_review`; templates T01–T09, T11–T16 → their own forms, T10 → `kpi_submission` (it feeds the dashboard), T14 also → `benefit_validation`; TOM dimensions → forms T03 and `tom_canvas` + `tom_approval`; forums → form `meeting_record`; benefit lifecycle steps → form T14 + `benefit_validation`; launch windows → form `launch_plan`; the roaming example → form `charter` + `new_transformation_intake`; the health questions → form `health_assessment`.

`getMethodologyCoverage` (`/admin/coverage?versionId=`; `methodology.read`) returns, per element: the set, key, verbatim label, block reference, the links, and a status computed live: **Covered** (a link resolves to a working form, or to a procedure present and not removed in the newest published `procedures` version), **Planned** (only planned targets, e.g. launch windows and health questions until slice H ships; shown as "Planned", never green), **Not covered** (no resolvable link; red). Totals are integer counts per status. The chain of M0078 (input → procedure → validation → approval → output → monitoring → correction → sustainment) is shown per procedure by its step kinds and outputs; REQ-S01-003's "guided scenario … on persisted records" is the A02 test (QA-E), judged at DG5 on its own clause (p5-plan R1).

### 7. Locks, events, jobs

Lock **730254** `procedureInstanceStep` (key `<procedureInstanceId>`): launch, input updates, step activate/complete/skip/assign, cancel and completion (ADR-0016 §6 registry; `platform/advisory-locks.ts`). 730256–730257 stay reserved. Outbox events (schema_version 1): `procedure_instance.launched` `{instanceId, procedureCode, transformationId}`, `procedure_step.activated` `{instanceId, stepKey, dueDate, assigneeUserId, assigneeRoleCode}`, `procedure_step.completed`, `procedure_instance.completed`, `procedure_instance.cancelled`. Step due/overdue reminders and the escalation path are **slice E rule actions** consuming `procedure_step.activated` (worker handler `apps/worker/src/handlers/procedures.ts`, BE-F stub; work items through `createWorkItemOnce` with dedupe key `procedure_step:<stepInstanceId>:<kind>`). No scheduled job in this slice.

### 8. REQ-S16-015 entity group

| Entity | Table (PK `id`) | Owner column | Status | Create / read through the API |
|---|---|---|---|---|
| TOMDimension | `tom_dimension` (`0011`) + `methodology_element(type 'tom_dimension')` | `created_by` of the element | version status | **`putConfigElement` (tom_dimension) in a draft** / `listConfigElements?elementType=tom_dimension` (D-142 Q4: a version-scoped row of an existing identity; an eleventh dimension is refused) |
| TOMCanvas | `tom_canvas_cell` (`0016`; ten cells per transformation, created by the DG2 instantiation) | `owner_user_id` | `status` | DG2 `updateTomCanvasCell` (the cells exist from instantiation; "create" is filling a cell) / `getTomCanvas`, `getTomCanvasCell` |
| Capability | `capability` (`0016`) | `owner_user_id` | `status` | DG2 `createCapability` / `getCapability` |
| Gap | `tom_gap` (`0016`) | `owner_user_id` | `status` | DG2 `createTomGap` / `getTomGap` |
| Journey | `journey` with `kind = 'journey'` (`0016`) | `owner_user_id` | `status` | DG2 `createJourney` / `getJourney` |
| Process | `journey` with `kind = 'process'` (`0016`) | `owner_user_id` | `status` | DG2 `createJourney` (kind process) / `getJourney` |
| ProcedureDefinition | `procedure_definition` (`0069`) | `created_by` (author) | version status (`draft_stage`/`status`) + `removed` | **`putProcedureDefinition` in a draft** / `getProcedureDefinition` |
| ProcedureInstance | `procedure_instance` (`0069`) | `launched_by` (steps: `assignee_user_id`) | `status` | `launchProcedureInstance` / `getProcedureInstance` |

The DG2 operation ids above exist in the contract at this commit; BE-G uses them in the entity-group test (`apps/api/test/integration/procedures/entity-group.test.ts`: create and read each, AUD 403 on writes, 404 outside scope); the ERD (§1m) lists every entity with keys, owner and status.

### 9. Authorization (permissions matrix §19)

`P5_FORMS_PROCEDURES_PERMISSIONS` (`0070`; PM01): `procedure.read` (read: all fourteen roles, M0153 "view: all signed-in users"), `procedure.launch` (write: SP, TL, BO, WL, FIN, TO, KDS), `procedure.act` (write: SP, TL, BO, WL, FIN, TO, KDS, TD, CM), `procedure.manage` (write: TL, TO). No business-approval or finance code.

| Operation group | Permission | Notes |
|---|---|---|
| list/get definitions, validate a definition body | `procedure.read` (validate: `methodology.configure`) | AUD reads |
| put/remove definition in a draft | `methodology.configure` (ADM_METHOD); publish/review through slice A | REQ-S06-001 "author: ADM; review: TO" |
| launch | `procedure.launch` **and** one of the definition's `launch_role_codes` held in scope (403 `procedure.launch_role`) | ADM_METHOD cannot launch |
| update inputs, complete/skip a step | `procedure.act` and (the step's assignee, or a holder of its `assignee_role_code` in scope when unassigned) (403 `procedure_step.not_assignee`) | |
| assign a step, cancel an instance | `procedure.manage` in scope | |
| approval step | the canonical approval's own permission and SoD (ADR-0026); never this module | |
| coverage view | `methodology.read` | |

AUD gets 403 on every write. SoD: the approval steps inherit ADR-0026 (the requester never decides); ADM_* roles cannot be named in any procedure role (§1).

### 10. Refusal codes and English texts (exact)

| Status | Code | English text (exact) |
|---|---|---|
| 422 | `procedure_definition.trigger_required` | A procedure needs a trigger. |
| 422 | `procedure_definition.completion_required` | A procedure needs a completion condition. |
| 422 | `procedure_definition.steps_required` | A procedure needs at least one step. |
| 422 | `procedure_definition.parallel_group_invalid` | Steps that run in parallel must share a position and a parallel group. |
| 422 | `procedure_definition.condition_invalid` | A step condition must use a declared input and a valid operator. |
| 422 | `procedure_definition.input_unknown` | A step needs an input the procedure does not declare. |
| 422 | `procedure_definition.input_schema_invalid` | An input definition is not valid for its field type. |
| 422 | `procedure_definition.role_not_allowed` | An administrator role or the auditor cannot run, approve or receive escalations of a procedure. |
| 422 | `procedure_definition.approval_step_invalid` | An approval step needs a business approver role and cannot be skipped. |
| 422 | `procedure_definition.source_protected` | Seeded procedures can be edited but not deleted. |
| 422 | `procedure_definition.code_invalid` | A procedure code is 3 to 48 lowercase letters, digits or underscores, starting with a letter. |
| 403 | `procedure.launch_role` | Your role cannot launch this procedure. |
| 422 | `procedure.not_published` | Only a published procedure can be launched. |
| 422 | `procedure.scope_mismatch` | This procedure cannot be launched in this scope. |
| 422 | `procedure.input_invalid` | An input does not match the procedure's input schema. |
| 422 | `procedure.not_active` | This procedure instance is completed or cancelled. |
| 422 | `procedure.steps_open` | Close every step before completing the procedure. |
| 422 | `procedure_step.not_active` | This step is not active. |
| 422 | `procedure_step.inputs_missing` | Provide the missing inputs before completing this step. |
| 422 | `procedure_step.evidence_required` | Link evidence before completing this step. |
| 422 | `procedure_step.output_required` | This step must produce or link its output record. |
| 422 | `procedure_step.output_record_invalid` | The linked record is not of the expected type or not in this scope. |
| 422 | `procedure_step.decided_through_approval` | An approval step is completed by its business approval decision. |
| 422 | `procedure_step.not_skippable` | This step cannot be skipped. |
| 403 | `procedure_step.not_assignee` | Only the step's assignee or a holder of its role can act on this step. |
| 409 | `procedure.launch_replayed` | This launch was already processed. |

Edits to a published version → 409 `config_version.not_editable` (ADR-0039 §13). `If-Match` 428/409, AUD and missing permission 403, outside scope 404, as ADR-0007. `missingInputs[]` (keys and labels) is a problem extension of `procedure_step.inputs_missing`.

### 11. Decimal and Unknown semantics

Inputs follow ADR-0041 §3 (decimal strings, percentage fractions, currency with code). Condition comparisons on numbers use decimal.js. An unknown due date (no business calendar) shows **Unknown**, and overdue is never computed from it; a missing input is listed under missing inputs, never defaulted to 0 or "no"; the coverage counts are integers; "Planned" and "Not covered" are never shown green.

## Alternatives considered

1. **Re-express the DG4 phase steps as procedures.** Rejected (p5-plan §3 row 7): a reopen of DG4 behaviour; phase steps stay, and procedures may link phase-step records.
2. **Procedure definitions as JSON documents inside `methodology_element`.** Rejected: ProcedureDefinition is a minimum domain entity (M0321) and the step graph needs typed keys and database invariants (ordering, parallel groups, roles).
3. **One configuration key per procedure.** Rejected: pins are unique per kind; ADR-0039's lineage rule needs a published base for every draft, which a new key does not have.
4. **Copy the definition into the instance.** Rejected: pinning the exact published definition row is smaller, and published rows never change (M0155).
5. **Steps that complete approvals themselves.** Rejected: business approvals stay in the canonical approval with its SoD (ADR-0026); an engineering seed or job never approves.

## Consequences

- Ten procedures run from initialization; new ones are authored in Studio drafts and published through review.
- BE-G's adapters reuse DG2–DG4 services; no DG2–DG4 table, route or rule changes.
- Slice E adds the event/schedule launches and the step reminders/escalations as rule actions on the events of §7.
- The coverage view makes the planned slice H/J items visible as Planned until their tasks move `source_element.feature_status` (p5-work-split §A rule A-7) and ship their forms.

## Verification

- **Database (probe, real output):** PS01–PS03, PD01–PD15, PI01–PI28, CO01–CO03, PM01 (`probe-output.txt`).
- **API (implementer tests, p5-work-split §C):** a procedure with a conditional and a parallel step publishes and runs; a definition missing a trigger or completion condition → 422 with the §10 codes; a `baseline_validation` instance shows its current step and assignee and, when completed, links a validated baseline; the ten seeded procedures exist after initialization and each launches; the entity-group test; AUD 403 on writes; `If-Match` 428/409; one audit event per mutation; replay of an automation launch creates nothing.
