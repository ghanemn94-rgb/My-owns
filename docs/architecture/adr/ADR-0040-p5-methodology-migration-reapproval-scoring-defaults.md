# ADR-0040: Methodology migration of a pinned transformation (plan, approval, execution, re-approval tasks, history untouched), the T06 default weights and rubric as versioned configuration, and the S16-012 entity group

- **Status:** Proposed for P5 (DG5). Author: solution-architect (T-DG5-ARCH-01), 2026-10-13.
- **Requirements:** REQ-S06-008; REQ-PB-093; REQ-S06-010 (the migration-approval half); REQ-S16-012 (ADR-0039 §10 has the table; this ADR names the test).
- **Sources:**
  - M0155 (§6): "Existing transformations remain pinned to their methodology and form versions until a deliberate migration is approved. Migration must explain default mappings, new required fields, invalidated calculations and necessary reapprovals. Do not silently rewrite historical records."
  - M0176 (§9): "Seed the source scorecard weights: strategic fit 25%, financial value 25%, customer impact 20%, feasibility 15%, time-to-value 15%. Use a 1–5 scale … Weights must total 100%. … Make scoring rubrics and approved weights configurable and versioned. Allow risk/compliance criteria to replace part of the weighting as the source permits."
  - Playbook B0076 (the T06 header "Strategic fit (25%) | Financial value (25%) | Customer impact (20%) | Feasibility (15%) | Time-to-value (15%)", each scored "1-5"), B0077 ("Adjust weights to the transformation context. For regulated or safety-critical transformations, risk/compliance can replace part of the weighting.").
- **Decisions applied:** D-142 **Q9** (what a re-approval does to an approved gate: "The approved G2 decision and its snapshot stay in history, the gate is marked 're-approval required', and a G2 submission task is created. Later-phase work continues, but the next gate cannot be submitted until the re-approval. This is a product default … not a business approval granted by an agent."), **Q12** (scoped reopen: a new migration redefines `p3_instantiate_transformation` to read the pinned scoring-defaults version, adds `approval_basis = 'studio_default'`; output byte-identical to DG3 while the published defaults equal the source); D-088 §2.
- **Builds on:** ADR-0039 (kinds, versions, resolver, pins), ADR-0015 (gates; submissions and decisions frozen/append-only), ADR-0022 (T06 weight sets), ADR-0026 §4 (canonical approval, SoD `requester_excluded`, work items), ADR-0036 (preserved originals).
- **Physical model:** `0063_p5_pins_methodology_migrations.sql`; KBE-A's `0065` (Q12, §5). Probe ids PN, MM, GR refer to `docs/delivery/handbacks/DG5/T-DG5-ARCH-01-evidence/probe-output.txt`.
- **Two gate systems.** Approving a migration and re-approving a gate are business approvals inside the product, made by people. No agent, job or trigger approves. Nothing reads or writes DG0–DG7.

## Context

1. Publishing a new version changes no pin: a transformation keeps the version its pin names (ADR-0039 §3), so after v2 is published an existing transformation still renders v1 (REQ-S06-008's first clause holds by construction).
2. `gate_instance` (`0017`) has no database transition guard; the DG2 API refuses a submission of an approved gate with 422 `gate.already_approved` ("This gate is already approved; it cannot be resubmitted."). `gate_submission` snapshots and `gate_decision` rows are frozen/append-only.
3. `scoring_weight_set` (`0021`) is per transformation and immutable; v1 is created by `p3_instantiate_transformation` with `approval_basis = 'source_default'`.

## Decision

### 1. The methodology migration (REQ-S06-008)

**Entity `methodology_migration`** (`0063`): `transformation_id`, `config_kind` (any of the six kinds), `from_version_id` (must be the transformation's current pin at creation, `methodology_migration_from_is_pin`), `to_version_id` (a **published** version of the same kind and key, different from `from`, `methodology_migration_target_published`; MM01), `reason` (3–4000), `plan_revision`, `plan_sha256`, `plan_ready`, `requested_by`, `submitted_by/at`, `approval_id` (the canonical approval), `decided_by/at`, `executed_by/at`, `withdrawn_at`, P2 stamps, `version`. Owner: `requested_by`. One open migration (draft, submitted, changes_requested, approved) per transformation and kind (unique index `methodology_migration_one_open_key`).

**State machine** (trigger `methodology_migration_guard`; MM03–MM14):

```text
draft -> submitted | withdrawn
submitted -> approved | rejected | changes_requested | withdrawn
changes_requested -> submitted | withdrawn
approved -> executed | withdrawn
executed, rejected, withdrawn: final
```

Database invariants: kind, from, to and requester never change; the plan (`reason`, `plan_revision`, `plan_sha256`, `plan_ready`) changes only in `draft`/`changes_requested` (`methodology_migration_plan_frozen`; MM06); leaving `draft` needs a ready plan (`methodology_migration_ready_to_submit`; MM03); `approved`, `rejected` and `changes_requested` each need a person's matching `approval_decision` (`approve`, `reject`, `request_changes`) on the migration's canonical approval of type `methodology_migration` (`methodology_migration_outcome_needs_decision`; MM07, MM09); the decider is never the requester (CHECK `methodology_migration_decider_not_requester`, behind the decision guard and the approval's own SoD trigger; MM08); at COMMIT an `executed` migration has moved its pin to `to_version_id` with `last_migration_id` = itself (`methodology_migration_executed_moved_pin`; MM10); a pin moves only through its approved migration (`transformation_config_pin_moves_by_migration`; PN01, MM11) and every move has its `transformation_config_pin_history` row at the pin's new version (`transformation_config_pin_history_required`; MM11, MM12). History tables are append-only (MM05, MM13).

### 2. The plan and its preview (M0155 "default mappings, new required fields, invalidated calculations and necessary reapprovals")

`createMethodologyMigration` generates plan revision 1; `previewMethodologyMigration` (with the admin's inputs for new required fields) generates the next revision. Each revision appends `methodology_migration_item` rows (append-only), ordered, one per finding:

| `item_kind` | Produced when | `resolution` |
|---|---|---|
| `mapping` | an element of `from` changed identity attributes in `to` (renamed label, moved ordinal, changed approver route): states the default mapping (old → new) | `automatic` |
| `new_required_field` | the kind provider (form_schema, ADR-0041) reports a field required in `to` that `from` lacks, for a record type the transformation has records of | `needs_input` until the admin supplies a default value or "leave empty until next edit", then `provided` |
| `invalidated_calculation` | the kind provider reports calculated values of this transformation computed with a definition that differs in `to` (e.g. a calculated form field, ADR-0041; a health-check scheme, ADR-0048); lists record type, id and the calculation | `acknowledged` |
| `reapproval` | §3 | `automatic` |
| `removed_element` | an element present in `from` is removed in `to` (a template removal cannot reach a published version, ADR-0039 §6; other removals can): records referring to it keep their reference | `acknowledged` |
| `unchanged_history` | always one row: "Historical records keep the version they were captured with; nothing is rewritten." | `automatic` |

`plan_ready` = no `needs_input` item; `plan_sha256` = SHA-256 of the canonical JSON of the revision's items. The preview response is the latest revision with every item, bilingual labels and the counts. For `methodology` and `scoring_defaults` (slice A's own kinds) the provider reports no `new_required_field` and no `invalidated_calculation` (their elements hold no record fields and no formulas: the transformation's T06 weight set is its own approved record and is never changed by a migration, §5); those two item kinds come from slices B and H.

### 3. Re-approvals (D-142 Q9)

A gate G of the transformation needs re-approval when it is `approved` and the migration changes, beyond label/help text, G's resolved `gate` element, any of its `gate_criterion`, `checklist_item` or `mandatory_artifact` elements, or (through the form_schema provider) a required field of a template whose records are evidence for G. The plan lists one `reapproval` item per such gate (`gate_code`; CHECK `methodology_migration_item_reapproval_gate`). On execution (§4) each item becomes a **`gate_reapproval`** row (`0063`): `gate_instance_id`, `gate_code`, `approved_decision_id` (the approved decision being re-approved; must be an approved decision of that gate, `gate_reapproval_names_approved_decision`; GR01), `status` (`required` → `satisfied` | `superseded`), `satisfied_decision_id` (a later approved decision of the same gate, `gate_reapproval_satisfied_by_decision`), `work_item_id`, `resolved_at`; one `required` row per gate instance.

Product behaviour (BE-C):

- The approved `gate_instance`, its `gate_submission` snapshot and its `gate_decision` stay unchanged; the gate shows "Re-approval required" (en) / "إعادة الاعتماد مطلوبة" (ar, provisional) beside its approved state.
- A `gate_reapproval` work item is created for each person holding the gate's submitter role (`gate.submit`) on the transformation, linking to the gate; My Work shows it under **Assigned actions** (`MY_WORK_SECTION_BY_KIND`, ADR-0037 §7, one added line).
- **While a re-approval of gate G is `required`, `submitGate` on G is allowed** (the DG2 refusal `gate.already_approved` does not apply to that gate), through the unchanged DG2 submission path: a new submission is snapshotted and decided by the gate's resolved approver; the instance moves `approved → submitted` with `approved_at` cleared (the DG2 CHECK `gate_instance_approved_complete`), so G reads as in review until decided. This is the scoped DG2 behaviour change D-142 Q9 decided; for gates with no required re-approval the DG2 refusal is unchanged.
- **The next gate cannot be submitted** while any earlier gate has a `required` re-approval: `submitGate` for a later gate returns 422 `gate.reapproval_required`. Work in later phases continues (no other operation is blocked).
- When the re-approval decision is `approved`, the row moves to `satisfied` in the same transaction (BE-C's line in `workflows/gates.ts`); a later migration that requires the same gate again marks the earlier row `superseded`.

### 4. Approval and execution

- `submitMethodologyMigration` (`methodology_migration.plan`): needs a ready plan; requests one canonical approval of type `methodology_migration` (`0063`; SoD `requester_excluded`) routed to the transformation's **SP** party by default, creating the DG4 approval work item. REQ-S06-008 names "approve-migration: TL or configured business approver"; the default configured business approver is the Sponsor because TL must stay free of business-approval codes: the DG1 creator-derived assignment (`0008`, ADR-0006) never derives a role holding one, and a TL granted at business-unit scope would lose access to the transformations it creates (this task's first integration run showed exactly that). An organization that wants TL to approve configures a separate approver role through access administration; a T11 decision-right row does not apply.
- `decideMethodologyMigration` (`methodology_migration.approve`, business approval; SP by default): records the canonical `approval_decision` and moves the migration in the same transaction; the requester gets 403 `methodology_migration.self_approval`. As built, the DG4 decide service is only reachable through `POST /approvals/{id}/decision` (`approval.decide`), whose holders (SP, BO, FIN) are not the holders of `methodology_migration.approve`; BE-C therefore exports its in-transaction form `decideApprovalInTx` from `workflows/approvals.ts` (the ADR-0026 A2/A3 pattern for resubmit and withdraw) and registers the `methodology_migration` subject provider with a new optional flag `decideThroughSubject: true`, for which the generic `decideApproval` route answers 422 `approval.decide_through_record` and writes nothing (additive: no existing approval type sets the flag).
- `executeMethodologyMigration` (`methodology_migration.execute`, ADM_METHOD; lock 730252 on the transformation id): in one transaction: the migration is `approved`; the pin still names `from` (else 409 `methodology_migration.pin_moved`); the pin moves to `to` (version + 1, `last_migration_id`), its history row is appended, each `reapproval` item becomes a `gate_reapproval` with its work items, the provided new-field values are stored on the plan items as the defaults offered at the next edit of each affected record, the migration becomes `executed`; audit events for the migration, the pin, each re-approval and each work item; outbox `methodology_migration.executed` (schema_version 1) `{migrationId, transformationId, kind, fromVersionId, toVersionId}`.
- **Never silently rewriting history:** execution updates no business record, no submission, snapshot or decision, and no row of another transformation. Records keep the form/configuration version they were captured with (ADR-0041 stores it per record); a record is validated against `to` only when it is next edited.

### 5. T06 default weights and rubric (REQ-PB-093)

- **Kind `scoring_defaults`, key `scoring-defaults`.** v1 is seeded in `0062` as published, with five `scoring_weight` elements 25.00/25.00/20.00/15.00/15.00 (B0076; SE02) and six `scoring_rubric` elements (the five criteria plus the optional `risk_compliance` of B0077), each with five levels whose descriptors are `null` (the source gives the 1–5 scale only). A draft is edited with `putScoringDefaultsDraft` (`methodology.configure`): the full set of weights (2–6 criteria from the DG3 criterion codes) and rubric descriptors (free text, en/ar, 1–500 each, or null).
- **The 100 % rule** is applied at publish: weights are decimal strings (ADR-0039 §12) and must total exactly 100.00 over 2–6 criteria; a total of 95 % is refused 422 `config_version.weights_total` by the API and by the database (`methodology_version_weights_total`; SD02). The draft may be saved with another total (the editor shows the running total, never rounded).
- **New transformations** (KBE-A, migration `0065`, the D-142 Q12 reopen): `p3_instantiate_transformation` is redefined to (a) pin `scoring_defaults` to the newest published version of `scoring-defaults` (a `transformation_config_pin` of kind `scoring_defaults` with its audit event), and (b) create the v1 weight set from that version's weights: while those equal B0076 the inserted rows, `approval_basis = 'source_default'` and the DG3 rationale text are byte-identical to DG3 (a regression test); when they differ, `approval_basis = 'studio_default'` (the column CHECK `scoring_weight_set_approval_basis_check` widened, and `scoring_weight_set_approval_complete` extended so `studio_default` also has no approver) and the rationale is "Studio default weights (scoring defaults v{n}): strategic fit {w}%, …" naming the published version.
- **Existing transformations** keep their weight set (it is their own record) and their rubric: a transformation without a `scoring_defaults` pin resolves to version 1 (ADR-0039 §3), never to the newest. A migration of kind `scoring_defaults` (§1) changes only which rubric and default reference the transformation uses; its approved weight set is untouched.
- **Read:** `getScoringDefaults` (admin, `methodology.read`) and `getTransformationScoringDefaults` (`transformation.read`): weights as decimal strings, rubric levels with `null` descriptors rendered "No descriptor defined" / "لا يوجد وصف محدد" (provisional), the version number and whether it is the newest.

### 6. Authorization (permissions matrix "P5 slice A")

| Operation | Permission | Roles (default) |
|---|---|---|
| list/get migrations, plan items, config pins, pin history | `methodology.read` | SP, TL, TO, AUD, ADM_METHOD |
| list gate re-approvals, transformation scoring defaults | `transformation.read` | every role with transformation scope (AUD read-only) |
| create, preview, submit, withdraw a migration | `methodology_migration.plan` | ADM_METHOD |
| decide a migration | `methodology_migration.approve` (business_approval) | SP; never the requester |
| execute an approved migration | `methodology_migration.execute` | ADM_METHOD |
| resubmit a gate with a required re-approval | `gate.submit` (DG2) | unchanged |

AUD gets 403 on every write. No technical admin holds `methodology_migration.approve` (the `0005` trigger; SE04).

### 7. Decimal and Unknown

Weights and totals: decimal strings and decimal.js/`numeric`, never floats. Invalidated calculations are listed and the affected values show "Stale — recalculation needed under v{n}" until recalculated, never 0. A plan item whose impact cannot be computed (e.g. a provider not yet registered) is listed with `detail.unknown = true` and blocks `plan_ready`, never treated as "no impact".

### 8. Refusal codes and English texts (exact)

| Status | Code | English text (exact) |
|---|---|---|
| 409 | `methodology_migration.open_exists` | This transformation already has an open migration for this configuration. |
| 422 | `methodology_migration.target_invalid` | The target must be a published version of the same configuration, other than the pinned one. |
| 422 | `methodology_migration.inputs_required` | Provide a value or mapping for every new required field before submitting. |
| 403 | `methodology_migration.self_approval` | You cannot approve a migration you requested. |
| 422 | `methodology_migration.not_approved` | Only an approved migration can be executed. |
| 409 | `methodology_migration.pin_moved` | The transformation's pinned version changed after this migration was planned. Plan it again. |
| 422 | `methodology_migration.not_open` | This migration is no longer open. |
| 422 | `approval.decide_through_record` | Decide this request from its record. |
| 422 | `gate.reapproval_required` | An earlier gate needs re-approval after a methodology migration before this gate can be submitted. |
| 422 | `config_version.weights_total` | Default weights must total exactly 100% over 2 to 6 criteria. |

### 9. REQ-S16-012

The entity table is ADR-0039 §10. BE-C writes `apps/api/test/integration/methodology/entity-group.test.ts`: creates and reads Transformation, PerformanceArea, Charter, MethodologyVersion (a draft), Phase and GateDefinition (version-scoped rows in that draft), GateInstance (instantiation) and GateDecision (a synthetic G1 decision by a person), with AUD 403 on each write and 404 outside scope.

## Alternatives considered

1. **Migrate automatically on publish.** Rejected by M0155 ("until a deliberate migration is approved").
2. **Re-open the approved gate decision.** Rejected: `gate_decision` is append-only and the approval must stay in history (Q9).
3. **Block all later-phase work until re-approval.** Rejected by Q9 (only the next gate submission is blocked).
4. **Rewrite existing records to the new form version.** Rejected: "Do not silently rewrite historical records."
5. **Store the default weights only in `p3_instantiate_transformation`.** Rejected: PB-093 needs them versioned and editable in the UI (Q12).

## Consequences

- The DG2 refusal `gate.already_approved` no longer applies to a gate with a `required` re-approval (Q9, a scoped DG2 behaviour change); BE-C's test proves it unchanged for every other approved gate.
- `p3_instantiate_transformation` is replaced in `0065` (Q12); its DG3 output stays byte-identical while the defaults equal B0076.
- Slices B and H supply the `new_required_field` and `invalidated_calculation` items through their kind providers; until they land, methodology and scoring migrations list none.

## Verification

- **Database (probe, real output):** PN01–PN03, MM01–MM14, GR01; SE02, SD01, SD02.
- **API (BE-C, KBE-A, p5-work-split §A):** after publishing v2, an existing transformation still renders v1; the migration preview lists the new required field (with slice B's provider) and a required G2 re-approval; execution leaves every historical record, submission, snapshot and decision byte-identical; the G2 resubmission is allowed and G3 submission is refused 422 until G2 is re-approved; the requester cannot decide (403); AUD 403; `If-Match` 428/409; exactly one pin history row and one audit event per mutation; PB-093: the admin changes the Feasibility rubric text and the weights to 30/20/20/15/15 and publishes, a transformation created afterwards starts with 30/20/20/15/15 (`studio_default`), an existing one keeps 25/25/20/15/15 and rubric v1, and publishing 95 % is refused.
