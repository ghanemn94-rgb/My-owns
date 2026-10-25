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

**Outputs are real linked records.** A step's output is checked and linked by an **output adapter** (BE-G, `procedures/outputs/**`) per `output_record_type`, inside the step-completion transaction. _Corrected 2026-10-17 (T-DG5-ARCH-R1, amendment V3): the adapters **verify and link only**; they never produce a record._ For `create`, the person first produces the record through the owning module's own operation (e.g. a `baseline` through the DG3 baseline create, by a `baseline.edit` holder) and names it in `outputRecordId`; the adapter checks that it is of the step's type, in the instance's scope, produced since the launch and not another instance's output. _Amended 2026-10-18 (T-DG5-ARCH-R4, amendment V4): in every mode, the acting person must also be able to read the record in its own scope, re-checked in the completing transaction; otherwise 422 `procedure_step.output_record_invalid`, audited as `authorization.denied`, and nothing is linked or adopted._ For `advance`, the record an earlier step of this instance linked must have reached the state the step records (e.g. the DG3 baseline validated by Finance, the DG2 gate decision recorded by its approver). For `link`, the adapter verifies and links a record the user created through its own screen. Every DG2–DG4 rule, SoD and permission applies in the owning module's operation, and the adapters never write the domain tables. Each output is recorded in `procedure_instance_link` (append-only; PI16, PI17), which accepts only an existing record of its type in the instance's scope (`procedure_instance_link_record_ref`; PI15). With `completion_rule = all_steps_closed_and_outputs_linked` the instance completes only when every completed step with an expected output has linked it, and every step is closed (`procedure_instance_completion`; PI13). REQ-S06-002's acceptance (A02 part) is: a `baseline_validation` instance shows `record_baseline` active with its assignee; completing both steps creates a baseline record, the FIN step validates it, and the validated baseline is linked to the instance.

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
| launch | `procedure.launch` **and** one of the definition's `launch_role_codes` held in scope (403 `procedure.launch_role`) | ADM_METHOD cannot launch _Amended 2026-10-23 (V5):_ My procedures offers the launch form only to a holder of `procedure.launch`; a UI hint, the server check is unchanged |
| update inputs, complete/skip a step | `procedure.act` and (the step's assignee, or a holder of its `assignee_role_code` in scope when unassigned) (403 `procedure_step.not_assignee`) | _Amended 2026-10-18 (V4):_ completing with an output also needs `transformation.read` on the output record's transformation, on grants reloaded in the completing transaction (else 422 `procedure_step.output_record_invalid`, audited as `authorization.denied`) |
| link evidence to a step (_added 2026-10-18, V4_) | `procedure.act` and the step-actor rule above, **and** `transformation.read` on the evidence's transformation | else 422 `procedure_step.output_record_invalid`, audited as `authorization.denied`; nothing is linked |
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

## Amendment (2026-10-17, T-DG5-ARCH-R1; D-165, D-166): `procedures` v2, the intake adopts its transformation (Rule A), and "verify and link only"

Sources: D-165 (QA-E O-1, O-2 and D-QA-E-2), D-166 (Rule A, verbatim below), the T-DG5-BE-T3 handback §3.3 and §3.5, and the T-DG5-BE-C4 handback §2.4. Nothing above is removed, except the one §3 sentence corrected in V3. Where this amendment and §3–§5 differ, this amendment wins.

_Brought to the built state 2026-10-17 (T-DG5-ARCH-R2; D-167): V2 now describes Rule A as merged (W21, `0096` and `procedures/steps.ts`) and records D-167's clarification of who acts on an adopted step; V3 describes the output-record choice in the UI as merged (T-DG5-FE-D4). Every changed text cites the merged code by `file:line` at `f78afff`._

### V1. `procedures` v2: the baseline is recorded by the Transformation Lead (`0095`; T-DG5-BE-T3; D-165 QA-E O-2)

- **Why.** In v1 (`0069`), `baseline_validation.record_baseline` is assigned to BO. BO does not hold `baseline.edit`, which REQ-PB-027 gives to TL and KDS (`0018`), so BO could not produce the step's output.
- **What `0095` does** (`packages/db/migrations/0095_p5_procedures_v2_baseline_assignee.sql`). It inserts a new seeded version, `procedures` **v2** (`01920005-0300-7000-8000-000000000002`, `origin = 'seed'`, `published`, `based_on_version_id` = v1, with a change summary). It changes the configuration through its own versioning (§1, ADR-0039 §1–§4) and never edits a published version or an applied migration.
  - Its ten definitions and 31 steps are copies of v1's, with fixed deterministic ids. Each inserted row has its own audit event (`methodology_version.seed`, `procedure_definition.seed`, `procedure_step_definition.seed`).
  - Exactly two values differ from v1. `record_baseline.responsible_role_code` is BO → **TL**. `baseline_validation.responsible_role_codes` is `[BO, FIN]` → `[TL, FIN]`.
  - `validate_baseline` stays FIN, so the person who records the baseline and the person who validates it keep different roles.
  - v1 stays published, immutable and unchanged (`procedure_definition_draft_only`).
- **Who gets v2.** A launch uses the transformation's `procedure` pin, else the newest published `procedures` version (`procedures/instances.ts` `launchDefinition`). No transformation is pinned to `procedures` at creation. So every launch from now on in an unpinned transformation uses v2. That covers every new transformation, and also the seeded roaming transformation, which pins methodology, scoring defaults and forms only.
- **Why pins do not move.** A transformation that holds a `procedure` pin stays on its version. A pin moves only through an approved methodology migration (ADR-0040 §1, `transformation_config_pin_guard`), never through a publish or a seed. A **running** instance never changes: it stays on the definition row it was launched with (`procedure_instance_pinned`, §3). `seeded-procedures.test.ts`, whose transformation is pinned to v1, still shows BO.
- **§5 reading.** The §5 table describes v1 and stays true of v1. In v2 the `baseline_validation` row reads "1 record_baseline (TL, evidence) → 2 validate_baseline (FIN)".
- Requirement rows: REQ-S06-002 (A02: the instance shows its current step and assignee, and completing it creates a validated baseline linked to the instance), REQ-PB-027 and REQ-S06-003. Test: `apps/api/test/integration/environment/demo-users-new-transformation.test.ts` › "QA-E O-2".

### V2. Rule A: the intake adopts the transformation it produced (`0096`; decided by D-166; implemented by T-DG5-BE-T4 (W21), merged, D-167)

**The gap (D-QA-E-2, BE-T3 handback §3.3).** The `confirm_sponsor` step of an organization-scope `new_transformation_intake` instance could never request its Sponsor approval. The P2 identity guard (`0010` `p2_row_guard`, attached to `procedure_step_instance` by `0069`; constraint `procedure_step_instance_identity_immutable`) keeps `procedure_step_instance.transformation_id` NULL for ever. The DG4 approval guard (`0031` `p4_approval_subject_version`) needs the subject step's `transformation_id` to equal the approval's transformation. So `requestStepApproval` returned without an approval (`apps/api/src/modules/procedures/steps.ts:653` at `6f8ce12`; as merged, the same early return for a step without a transformation is `steps.ts:671`). D-166 chooses option (a) of the handback: the narrowest change, which keeps every other identity immutable and changes neither the DG4 approval guard nor the seeded intake's shape.

**Rule A, as decided by D-166 (verbatim):**
- When the `capture_intake` step of an organization-scope `new_transformation_intake` instance is completed with `outputRecordId` = T (a transformation), every step of the same instance that has not started gets `transformation_id = T` in the same transaction.
- This is the only change of `procedure_step_instance.transformation_id` ever allowed: from NULL to T, once; for a step that has not started; of an instance whose own `transformation_id` is NULL; and only to the transformation named by that instance's `capture_intake` output link. Repair migration `0096` narrows the P2 identity guard of `procedure_step_instance` to exactly this transition. Every other change stays refused.
- Each adopted step takes the P2 version step and one audit event.
- The instance keeps its launch scope (organization).
- Approvals of the adopted steps are requested on T and routed by T's role mappings (DG4 `resolveParty`, never a fallback). Until T has a mapped Sponsor, `confirm_sponsor` keeps today's truthful "awaiting routing" next action.

**What this changes in this ADR, and what it does not:**
- **The narrowed P2 identity guard.** `0096` narrows the guard for `procedure_step_instance` only. On that table, `id`, `organization_id`, `created_at` and `created_by` stay immutable without exception. `transformation_id` may change only by the single Rule A transition above. Every other table keeps the generic `p2_row_guard` unchanged. The database is still the last line of defence: a change of `transformation_id` that is not exactly this transition is refused, whatever the caller.
- **Unchanged.** `procedure_instance` keeps `transformation_id` NULL and its organization scope (`procedure_instance_pinned`, §3). The DG4 approval guard is unchanged. The adopted steps now satisfy it as written.
- **Routing.** No fallback approver. Until T has a mapped Sponsor, `getProcedureInstance`'s next action stays `procedures.next_action.await_approval_unrouted` (`steps.ts:994` as merged).
- **Who acts.** The decider must hold `approval.decide` on T and be T's mapped Sponsor. In the demo, the access administrator assigns SP on T and the TL maps it (ADR-0050 amendment D2).
- **§4 state machine.** Unchanged: only steps that have not started (`pending`) are adopted.
- **Data dictionary.** `procedure_step_instance.transformation_id` records the transition.
- Requirement row: REQ-S06-003 (A02: "the ten procedures … each can be launched and completed"). The code and `0096` are T-DG5-BE-T4's (W21), merged and verified by D-167, and described as built below.

**Rule A as merged (T-DG5-BE-T4, W21; verified by D-167):**

- **The database guard** (`packages/db/migrations/0096_p5_intake_adopts_transformation.sql`). A new function `procedure_step_instance_row_guard()` (`:27`) replaces `p2_row_guard` on `procedure_step_instance` only: the trigger keeps its name and is re-created on that table (`:99–100`). `p2_row_guard` itself is unchanged for every other table.
  - INSERT keeps the P2 rules: version 1, and the organization of its transformation.
  - UPDATE keeps `id`, `organization_id`, `created_at` and `created_by` immutable without exception (`:49–55`), and the version step `+ 1` (`:89–92`).
  - A change of `transformation_id` is allowed only when every condition of `adoptable` holds (`:59–82`):
    - `OLD.transformation_id IS NULL` and `NEW.transformation_id IS NOT NULL` (so once, and never to another transformation);
    - the step is `pending` before and after (`:61`), and no other column changes except `version`, `updated_at` and `updated_by` (the `to_jsonb` comparison, `:62–63`);
    - its instance has `transformation_id IS NULL`, status `active`, `procedure_code = 'new_transformation_intake'` and the step's organization (`:65–70`);
    - the new value is the transformation linked by an `output` link of record type `transformation` on the instance's **completed** `capture_intake` step, in the same organization (`:71–82`).
  - Every other change of `transformation_id` is refused with the same constraint name, `procedure_step_instance_identity_immutable` (`:83–86`). The deferred audit guard is unchanged.
- **The API** (`apps/api/src/modules/procedures/steps.ts`). `completeStep` records the adopted transformation when the step's output record type is `transformation` (`:1203`). After the step completes, and only for an organization-scope `new_transformation_intake` instance's `capture_intake` step, it calls `adoptIntakeTransformation` (`:1211–1218`) before `advance` activates the next step.
  - `adoptIntakeTransformation` (`:722`) updates every step that is `pending` with no transformation, under its own version check, with `version + 1`, `updated_at` and `updated_by`.
  - Each adopted step writes one audit event, action **`procedure_step_instance.adopt_transformation`** (`:745`), with the prior and new version and `changes: {transformation_id: {from: null, to: T}}`.
  - The instance row keeps `transformation_id` NULL and its organization scope.
- **The routing wait** (`steps.ts:646–694`). `requestStepApproval` requests the approval on the step's own transformation, routed by T's role mappings (DG4, never a fallback). For an **adopted** step (`isAdopted`, `:650`: the instance has no transformation and the step has one), the DG4 routing refusals `routing.role_unmapped` and `routing.assignee_not_approver` (`ROUTING_WAIT_CODES`, `:647`) do not fail the action that activated it (`:694`). The DG4 request writes nothing before it resolves the party, so the step stays active with no approval, and the next action reads `await_approval_unrouted` (`:994`). In a transformation-scope instance the refusal stays the action's 422, as in DG4.
- **The retry through the next instance action.** `advance` (`steps.ts:762`) first calls `routeWaitingApprovals` (`:703`, called at `:765`), which requests the approval of every active, adopted approval step that has none yet. `advance` runs after every step completion, skip and approved decision (`steps.ts:1219`, `:1236`, `:1330`) and after `PATCH /api/v1/procedure-instances/{instanceId}/inputs` (`updateProcedureInstanceInputs`; `instances.ts:436–438`). While `confirm_sponsor` is the active step, an inputs update is the instance action that retries the request once T's Sponsor is mapped.
- **Tests.** `apps/api/test/integration/procedures/intake-adoption.test.ts`: through the API (`describe` at `:126`, tests at `:127`, `:173`, `:241`: adoption with one audit event per step and the instance still organization-scope; a mapped Sponsor decides and the instance completes; without a mapped Sponsor the step waits unrouted and the next action requests it once mapped) and at the database (`describe` at `:438`, tests `:446–552`: every other `transformation_id` change refused).

**Who reads and acts on an adopted step (D-167 clarification).** As merged in W21, the instance's read gate and every step actor keep organization scope (`steps.ts:1142–1144`, `openStep` through `requireInstanceRead` and `authorizeInstanceWrite`). Nobody holds TL at organization scope, so the produced transformation's Lead could not act on `draft_charter`. D-167 decides:

- a step adopted into T (Rule A) is read and acted on with **T's** authorization and the step's assignee role on T (complete, skip, assign, link evidence, and inputs where they apply to it);
- the instance's other steps and its organization-level reads keep organization scope, and organization-scope actors who could act before keep their rights;
- the instance itself does not move to T: Rule A and `0096` are unchanged.

This was **decided by D-167, implemented by T-DG5-BE-T5 (W22), continued as T-DG5-BE-T5B, and merged (D-168)**. _Brought to the built state 2026-10-17 (T-DG5-ARCH-R3; D-168): this paragraph said the clarification was not in the tree at `f78afff`. The `steps.ts:1142–1144` reference above is the W21 state._ As merged (`b463552`), in `apps/api/src/modules/procedures/steps.ts` unless named otherwise:

- **Which step is adopted.** `adoptedTransformationOf` (`:409–414`) returns T when the instance's `transformation_id` is NULL and the step's is not, else null. Nothing else counts as adopted.
- **The scopes of a step.** `stepTargets` (`:417–429`) returns the instance's own scope first, then T for an adopted step. `stepRoleTarget` (`:432–439`) is the last of them: T for an adopted step, else the instance's scope.
- **Reading.** `requireReadInAny` (`:444–458`) grants `procedure.read` in the first scope that allows it, else the first refusal (404). `openStep` uses it on the step's scopes before it locks the instance (`:1276–1285`). The single-instance read and the inputs update use `requireInstanceOrAdoptedRead` (`:464–493`; `instances.ts:464`, `:592`): the instance's scope, else T of one of its adopted steps. The instance list is unchanged and keeps organization scope.
- **Acting.** `authorizeStepWrite` (`:501–536`) keeps `authorizeInstanceWrite` for a step that was not adopted (`:509–513`). For an adopted step it tries each scope, the organization first and then T, with the read gate, the permission and the step-actor rule (`:514–534`). The first scope where all of them hold is the acting scope. When none does, a 403 from a scope the caller can read wins over a 404 (`:532`, `:535`). `openStep` calls it for complete and skip (`:1293`).
- **Assign.** The assignee must hold the step's role in `stepRoleTarget`, so on T for an adopted step (`:1400`).
- **Link evidence.** The evidence of an adopted step must belong to T (`:1421–1431`; 422 `procedure_step.output_record_invalid` otherwise). _Amended 2026-10-18 (V4): for every instance the actor must also read the evidence's transformation; the code is now `steps.ts:1420–1442`._
- **Inputs.** An inputs update reaches T only through an open adopted task step, for the inputs that step requires (`authorizeInputsWrite`, `instances.ts:416–456`; the adopted-step branch at `:441–455`).
- **Unchanged.** Rule A, `0096`, the instance's organization scope, cancel and the instance list.
- **Tests.**
  - `apps/api/test/integration/procedures/adopted-step-authorization.test.ts`: `describe` at `:110`; tests at `:111` (T's Lead completes `draft_charter`; a user without TL on T gets 403 or 404; T's Lead cannot cancel and does not list the instance) and `:212` (the organization-scope Lead keeps its rights).
  - Black-box: `tests/qa/integration/a02-a21-complete-lifecycle.test.ts`, unchanged, now completes all ten procedures (T-DG5-BE-T5 handback §2.4; D-168).

### V3. `ProcedureStepComplete`: the adapters verify and link only (T-DG5-BE-C4; D-165 QA-E O-1, D-166)

- **The §3 body sentence that was false is corrected in place** (marked "Corrected 2026-10-17"). It said `create` "calls the owning module's existing service to create the record". As built (T-DG5-BE-G, `apps/api/src/modules/procedures/outputs/kit.ts`, header), every adapter **verifies and links**:
  - **create:** the person produces the record natively through its owning module's operation, with that module's permissions, rules and audit event, then names it in `outputRecordId`. The adapter checks, read-only, that it is of the step's type, in the instance's scope, produced since the instance was launched, not another instance's output, and in a state that shows it was produced;
  - **advance:** `outputRecordId` is omitted, or names the same record. The record an earlier step of this instance linked must have reached the state this step records;
  - **link:** `outputRecordId` names an existing record of the step's type, in scope.
- **Refusals (the §10 codes, unchanged):** no record named, or a record that has not reached the state the step records, → 422 `procedure_step.output_required`. A record of the wrong type, out of scope, or not produced for this step → 422 `procedure_step.output_record_invalid`. The whole completion rolls back. _Amended 2026-10-18 (V4): also a record the acting person cannot read, in every mode and for the generic `link`._
- **Why.** `procedures` may not import the owning modules (`modules.ts`; the architecture test). Most of those modules export no create or decide service, and p5-work-split §C.3 forbids re-implementing one. The adapters therefore never write a domain table, decide an approval or grant a business approval.
- **Contract.** `ProcedureStepComplete.description` (`docs/api/openapi.yaml`) states this. It is wording only; the schema is unchanged.
- **UI (T-DG5-FE-D4, W21; merged, D-167).** D-166 found that the instance page completed a step with a note only and never sent `outputRecordId`. As merged, the instance page renders `CompleteWithOutput` for a step whose output is `create` or `link` (`apps/web/src/pages/procedures/InstancePage.tsx:368`):
  - the person chooses the output record among the eligible records of the step's record type, read through that record type's own list operation (`OUTPUT_SOURCES`, `apps/web/src/pages/procedures/outputs.ts:55`; `eligibleRecords`, `outputs.ts:187`; `CompleteWithOutput.tsx:94`);
  - when none exists yet, the form links to the native screen where the record is produced, with that module's own permissions, rules and audit event (`CompleteWithOutput.tsx:1–7`);
  - the choice is sent as `outputRecordId` (`completeBody`, `outputs.ts:210–213`; `CompleteWithOutput.tsx:117`), with `If-Match`. The server re-checks every rule, and a refusal is shown by its code in English and Arabic;
  - an `advance` step keeps the note-only form and sends no `outputRecordId` (`InstancePage.tsx:7`);
  - an organization-scope intake reads the records in the transformation its first step produced (`scopeTransformationOf`, `outputs.ts:168`).
  - Test: `apps/web/src/pages/procedures/instance-output.test.tsx` (`:173`, `:263`, `:319`, `:374`), in both locales. A completion is never a business approval.
- Requirement rows: REQ-S06-002 and REQ-S06-003.

## Amendment (2026-10-18, T-DG5-ARCH-R4; D-170, F-DG5-101): §3, §9 and V3, the acting person's read of every record a step links

### V4. A person never links a record they cannot read: outputs and evidence (T-DG5-BE-V2, BE-V2B, BE-V2C)

Sources: D-170 (F-DG5-101, decided), the T-DG5-BE-V2 handback ("F-DG5-101" and its ADR list) and the T-DG5-BE-V2C handback (the evidence link and the sibling paths), checked against the merged tree (`9c96ee3`). Nothing above is removed. Where V4 and §3, §9 or V3 differ, V4 wins. No migration, operation, response shape or refusal code changes. File references are `apps/api/src/modules/procedures/` unless named otherwise.

- **The gap (F-DG5-101).** `completeStep` authorized the actor on the instance's scope only, and the adapters checked the record's type, scope and production but not that the acting person can read it. An organization-scope TL could therefore name another business unit's transformation in `capture_intake`, and Rule A (V2) then adopted the intake's steps into it.
- **The rule, for every output (§3 and V3, every mode: `create`, `advance`, `link`).** The record a step links must be readable by the acting person in **that record's own scope**: `transformation.read` (`OUTPUT_READ_PERMISSION`, `outputs/kit.ts:115`) on the record's transformation, asked of the same policy resolver the record's own GET uses (`requireOutputRead`, `outputs/kit.ts:124–137`). For a `transformation` record that is the transformation itself.
  - **Every adapter.** `outputAdapter.produce` calls it right after the scope check and before any mode-specific check (`outputs/kit.ts:243–250`). All registered adapters are built by `outputAdapter`.
  - **The engine's generic `link`** (no adapter registered for the record type) applies the same rule (`requireNamedRecordRead`, `outputs/kit.ts:144–157`; called at `steps.ts:1341–1344`). A record that does not exist is left to the `0069` link guard, as before.
  - **An approval step** completing through its business approver's decision (`onApprovalOutcome`, `steps.ts:1451`; `principal: null` at `:1473`) names no record. Its `advance` acts on the record an earlier step linked, which passed this check when it was linked (`outputs/kit.ts:121–122`, `:129`).
- **The rule for the step evidence link** (`POST /api/v1/procedure-instances/{instanceId}/steps/{stepKey}/evidence`, `linkEvidence`, `steps.ts:1420–1442`). For **every** instance, adopted step or not, the acting person must hold `transformation.read` on the evidence's transformation (`steps.ts:1439`), before the link is written (`:1440`). An unknown evidence id is left to the link guard. The adopted-step rule of V2 ("the evidence must belong to T") is unchanged and is now at `steps.ts:1426–1434`; V2's reference `:1421–1431` is its `b463552` state.
- **Re-checked in the completing transaction.** `openStep` locks the instance (`lockAndLoad`, `steps.ts:1287`), then `authorizeStepWrite` reloads the caller's grants inside the same transaction (`refreshPrincipal`, `steps.ts:517`). The read check runs on those grants, after the lock, so a grant revoked before commit is honoured (shared rule §2.4).
- **The refusal.** A read refused by the policy (its 404) becomes **422 `procedure_step.output_record_invalid`** with the §10 text "The linked record is not of the expected type or not in this scope.", byte-identical to the refusal of an unknown record, with no record id in the body (`outputs/kit.ts:133–135`). The path's existing refusals answer as before where they apply first (for example, an out-of-scope record still fails the scope check, `outputs/kit.ts:248`).
- **Audited as the existing `authorization.denied`.** The refusal carries the read gate's denial (`withDenial`, `outputs/kit.ts:135`), so the existing failed-mutation hook writes `authorization.denied` naming the record's transformation (`apps/api/src/modules/access/denials.ts:23`). The denial never appears in the response. No new event type is added. An unknown record still writes no audit event, because a missing record is not an authorization event.
- **Nothing is linked or adopted.** The refusal is thrown before `insertLink` (`steps.ts:1348`, `:1440`) and before `adoptIntakeTransformation` (`steps.ts:1364`), and the whole transaction rolls back. So Rule A (V2) never follows a refused link, and the instance version is unchanged.
- **V3's refusal list** therefore reads: a record of the wrong type, out of scope, not produced for this step, **or one the acting person cannot read** → 422 `procedure_step.output_record_invalid`. The `link` bullet reads "an existing record of the step's type, in scope, that the acting person can read". The same applies to the engine's generic `link`.
- **Sibling paths checked (T-DG5-BE-V2C).** The only writer of `procedure_instance_link` is `insertLink` (`steps.ts:680`). Its callers are the adapter path, the generic link, the evidence link (all three closed above) and `onApprovalOutcome` (no caller-named id). `assignStep` names a user, not a record, and `updateInputs` writes no link.
  - **Open, not changed: the launch's `subjectRecordType`/`subjectRecordId`** (`instances.ts`). It is stored as an opaque, frozen instance-level reference that the API never resolves or discloses, but it is not checked for the launcher's read. BE-V2C handed this to the orchestrator for a decision. No decision after D-170 is recorded yet, so this ADR states it as open.
- **Contract.** The `ProcedureStepComplete.description` in `docs/api/openapi.yaml` now states the read rule (description text only). The step-evidence operation's summary ("Link evidence of the instance's transformation to an active step…") stays true and is unchanged.
- **Tests.** `apps/api/test/integration/procedures/output-read-authorization.test.ts` (`:107`, the reviewer's reproduction, 422 with nothing linked or adopted and one `authorization.denied`; `:151`, the positive path; `:170`, the charter adapter and the generic link, refused after the read is revoked, then linked once it is restored) and `apps/api/test/integration/procedures/evidence-link-read-authorization.test.ts` (`:114`, `:151`, `:211`, `:227`: the adopted and transformation-scope refusals and positive paths). The QA fixture of `tests/qa/integration/a02-a21-complete-lifecycle.test.ts` gives the intake's organization Lead TL on the transformation it names, so it can read it (orchestrator commit `6c7f54b`).

Requirement row: REQ-S06-002. Nothing here decides or grants a business approval, a G1–G6 gate or an engineering gate DG0–DG7.

Product gates G1–G6 are business approvals inside the product. A procedure approval step is a canonical business approval decided by its person, never by an agent. Nothing here touches the engineering gates DG0–DG7.

## Amendment (2026-10-23, T-DG5-ARCH-RG1; D-185, F-DG5-140): §4 and §9, My procedures offers launch only with `procedure.launch`

Sources: D-185 (F-DG5-140, Low, qa round 1) and the T-DG5-FE-RG1 handback §5, verified against the merged code (`5474a66`). The assignment names §4. §4 holds the state machines, which are unchanged; the launch permission is §9's "launch" row, which this amendment annotates. No API, contract, migration or permission change.

### V5. The launch form is a UI hint; the server decides (T-DG5-FE-RG1)

- **The gap.** My procedures offered the read-only auditor (AUD) an enabled "Launch a procedure" form. Every launch then ended in 403, and nothing was created.
- **As merged.** `LaunchSection` (`apps/web/src/pages/procedures/MyProceduresPage.tsx:208`) shows the launch form (`LaunchForm`, `:226`) only when the signed-in user holds `procedure.launch` in some scope (`canAnywhere(me, "procedure.launch")`, `:211`). Otherwise the section shows a read-only note in English and Arabic: "You can follow procedures and their steps here, but none of your roles may launch a procedure. Only a user holding one of a procedure's launch roles can launch it." (`apps/web/src/i18n/en/workflowsP5.json:240`, `ar/workflowsP5.json:240`).
- **The server check is unchanged.** `launchProcedureInstance` still requires `procedure.launch` and one of the definition's `launch_role_codes` held in scope (`apps/api/src/modules/procedures/instances.ts:293`; 403 `procedure.launch_role`), as in §9. A user who holds `procedure.launch` but none of a definition's launch roles still sees the form and gets that 403. The UI only decides what it offers.
- **Tests.** `apps/web/src/pages/procedures/launch-permission.test.tsx` (`:60`, without `procedure.launch`: the note, no form and no Launch button; `:77`, with it: the form with an enabled Launch, in en and ar) and `apps/web/e2e/p5-launch-permission.spec.ts` (`:15`, AUD gets the note and a direct launch is still 403 with nothing created; `:63`, the Transformation Lead launches).

Requirement row: REQ-S06-002. Nothing here decides or grants a business approval, a G1–G6 gate or an engineering gate DG0–DG7.
