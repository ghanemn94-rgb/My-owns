# ADR-0035: The six-phase workspace and guided steps, G5 Scale and G6 Sustain, per-criterion gate review, gate exceptions (waivers), the approved scale scope and scale transitions, risk dispositions, and gate routing tasks with their outbox events

- **Status:** Proposed for P4 (DG4). Author: solution-architect (T-DG4-ARCH-07), 2026-10-09.
- **Requirements (slice H of `docs/architecture/p4-plan.md`, this ADR's part):** REQ-PB-014, REQ-PB-015, REQ-PB-020, REQ-PB-021, REQ-S03-004, REQ-S04-001, REQ-S04-002, REQ-S04-007, REQ-S04-008, REQ-S04-009, REQ-S04-010, REQ-S04-012, REQ-S04-013, REQ-S12-009, REQ-S12-010. The rest of slice H (REQ-S04-014, REQ-S07-015, REQ-S09-010) is ADR-0036.
- **Sources (quoted where a design point has one):**
  - Playbook B0021 (the phase table: "1 | DIAGNOSE | Establish fact base | Current state, root causes, value pools" … "6 | REALIZE | Prove & sustain value | Benefits, BAU handover, continuous improvement"); B0026/B0027, B0045/B0046, B0053/B0054, B0067/B0068, B0090/B0091, B0118/B0119 (phase titles and "Objective: …" sentences); B0023 (gates: "G5 - Scale | Are pilots/results sufficient to scale? | Performance evidence, adoption, risk closure, decision log." and "G6 - Sustain | Is value embedded in BAU? | Benefits evidence, ownership transfer, controls, continuous improvement backlog."); B0121 (benefits lifecycle); B0128 (T15 RAID, Impact H/M/L); B0130 (T16).
  - Master prompt M0083 and M0116 ("Each phase needs guided inputs, procedural steps, required evidence, named owners, completion rules, outputs and a review queue. Gates are explicit approval records tied to a versioned evidence snapshot; they must not be inferred solely from task completion."); M0094 ("Let teams prepare drafts at any time, but enforce required gate approvals before authorized execution or scaling."); M0118–M0123 (the phase procedure table); M0122 ("Performance/pilot evidence, adoption results, resolved material risks or approved dispositions and decision log. Decision: results justify the proposed scope of scale"); M0123 ("Benefit evidence, accepted BAU handover, ownership, controls and continuous-improvement backlog. Decision: value is embedded in BAU"); M0124 ("Gate submissions must show: criterion, required evidence, completeness, reviewer, finding, open condition, risk, decision and rationale. Support Draft, Submitted, Under Review, Changes Requested, Approved, Rejected and Deferred. Conditional approval is a configurable extension that records permitted scope, conditions, owners and deadlines; it cannot authorize unrestricted scaling."); M0125 ("Missing mandatory evidence blocks submission unless a specifically authorized exception is recorded. Waivers require reason, scope, approver, expiry and compensating action."); M0228 ("Mandatory gate evidence is missing | Display missing requirements and block unauthorized submission"); M0229 ("Valid gate submission | Route the exact evidence snapshot to the required approvers"); M0230 ("Gate is approved | Enable the authorized next phase/scope and create its tasks"); M0412 (product G6 never implies DG7).
- **Decisions applied:** D-088 §2 (claims enumerated and exactly true; F-DG3-100); D-089 Q2 (reopen accepted: a mandatory criterion may be `incomplete` only when an accepted, unexpired waiver covers it, and the snapshot records it; every DG2 refusal without a waiver unchanged), Q4 (G6 approval does not close a transformation), Q10 (canonical `approval` for new P4 approval types), R1 (ADR-0015 §2 outbox sentence is corrected when P4 implements the events), R4 (rows citing later A-tests judged on their own acceptance text).
- **Builds on:** ADR-0003, ADR-0004, ADR-0006, ADR-0007 (§5b statuses, problem+json), ADR-0015 (the gate engine), ADR-0016 (guards; lock registry §6), ADR-0018 (verified evidence), ADR-0021 (§5 dispensations, §7 G4 precedent), ADR-0025 (job kit `runOnce`, `createWorkItemOnce`, schedules, business date), ADR-0026 (canonical approval, `approval.decide`, delegation, technical-admin 403 helper of D-094), ADR-0027/0028 (KPI evaluations, Unknown), ADR-0030 (validated measurements), ADR-0031 (RAID), ADR-0032 (T16), ADR-0033 (adoption indicators), ADR-0034 (handovers, controls, CI backlog, closure).
- **Physical model:** `0051_p4_phases_gates_g5_g6_exceptions.sql`, `0053_p4_gates_change_permissions.sql`, `0054_p4_gate_exception_expiry_schedule.sql`. Probe ids refer to `docs/delivery/handbacks/DG4/T-DG4-ARCH-07-evidence/probe-output.txt`.
- **Two gate systems.** G1–G6 are business approvals inside the product (`gate_*` tables). Nothing in this ADR reads or writes the engineering delivery gates DG0–DG7 or `docs/delivery/`. An approved G6 changes no DG record and never implies DG7 (REQ-S04-008 acceptance; M0412). No migration, seed, trigger or job here approves a gate, an exception, a disposition or a scale scope: each needs a person's decision. All probe data is synthetic.

## Context

As built before slice H (checked on `HEAD` `76e128e`):

1. `gate_definition` (`0011`) already holds G5 (`phase = 'transform'`, `next_phase = 'realize'`, default approver `SP`, allowed `{SP, BO}`) and G6 (`phase = 'realize'`, `next_phase` NULL, allowed `{SP}`), both `submission_enabled = false`. `gate_criterion_definition` has 24 rows (G1 6, G2 5, G3 5, G4 8) and none for G5/G6. A submission of a closed gate is refused 422 `gate_not_enabled` "{gateCode} cannot be submitted in this release." (`workflows/gates.ts`).
2. `submitGate` evaluates every criterion in the submitting transaction; any mandatory `incomplete` criterion gives 422 `gate_criteria_incomplete` with detail "Mandatory required outputs are incomplete: {keys}." and one error per criterion. `0017`'s CHECK `gate_submission_criterion_mandatory_complete` is `NOT mandatory OR completeness = 'complete'`.
3. `gate_instance.status` has the seven values (`draft`, `submitted`, `under_review`, `changes_requested`, `approved`, `rejected`, `deferred`); no code path sets `under_review` (`grep -rn under_review apps/api/src` finds no assignment). The decision path (`decideGate`) checks the pending submission, not the instance status.
4. No table stores a per-criterion reviewer, finding, open condition, risk, decision or rationale; the gate decision's rationale is per gate (`gate_decision.rationale`, 3–8000 characters, DG2 400/422 when missing).
5. `gate_dispensation` (`0020`, ADR-0021 §5) holds `inherited_approval` and whole-gate `waiver` rows for G1–G3 only (CHECK `gate_dispensation_gate`); a waiver row has a reason but no scope, expiry date or compensating action, so it cannot satisfy REQ-S04-013.
6. **R1 (p4-plan §6).** ADR-0015 §2 says submission and decision write the outbox events `gate.submitted` and `gate.decided`. As built, `workflows/gates.ts` writes neither. The non-test files under `apps/api/src/modules` that write outbox events are `jobs/index.ts`, `jobs/outbox.ts` and `jobs/schedules.ts` (the outbox kit and `job_schedule.updated`), `transformations/routes.ts` (`transformation.created`), `kpi/kpi-outbox.ts` and `benefits/values.ts` (the slice A and B events); `grep -rn 'gate\.submitted\|gate\.decided'` over those non-test sources finds nothing. No gate-event backlog exists to replay.
7. There is no phase catalogue: no table or constant holds the B0021 purposes, key outputs or the phase objectives; `transformation.current_phase` holds the phase code only.
8. `gate_decision.outcome` has four values; an approval records no scope. No table records a scale action.

## Decision

### 1. Phase catalogue and guided phase steps (REQ-PB-014, REQ-S04-001)

**Entity `phase_definition`** (`0051`, seed, `GRANT SELECT` only to `mth_app`; probe S01): `code` (`diagnose` … `realize`), `ordinal` 1–6, `gate_code` (G1–G6), `source_name_en` (B0021 col. 2, verbatim), `source_title_en` (the phase heading, e.g. "TRANSFORM — Transformation Operating System"), `source_purpose_en` (B0021 col. 3), `source_key_outputs_en` (B0021 col. 4), `source_objective_en` (the B00xx "Objective:" sentence after the word "Objective:"), each with its Arabic column, `source_ref`, `ar_provisional` (true: Arabic is a provisional translation). REQ-PB-014's acceptance "API returns exactly six phases in order with names and purposes matching B0021" is `GET /api/v1/phases` (ordered by `ordinal`; six items).

**Entity `phase_step_definition`** (`0051`, seed, `GRANT SELECT` only to `mth_app`; probes S02, S07): `key` (`<phase>.<name>`, CHECK prefix = `phase_code`), `phase_code`, `ordinal`, `source_procedure_en` (one `;`-separated clause of the M0118–M0123 "Inputs and native procedure" column, verbatim), `required_evidence_en/ar`, `default_owner_role_code`, `reviewer_role_code` (≠ owner role), `completion_rule`. 25 rows: Diagnose 5, Define 3, Design 4, Mobilize 5, Transform 4, Realize 4. `required_evidence_*`, the role defaults and the rule choice are an **architect interpretation**, not source text.

**Completion rules** (evaluated by the API at review request and again at acceptance; the result is frozen into `phase_step.completion_check = {"rule", "met", "facts"}`):

| Rule | Met when (in the step's transformation) | Used by |
|---|---|---|
| `evidence_linked` | ≥ 1 active `phase_step_evidence` link whose evidence has `review_status = 'verified'` (ADR-0018) | all Diagnose–Mobilize steps, `transform.deliver_pilots` |
| `meeting_held` | ≥ 1 `meeting` with status `held` or `minutes_published` | `transform.workstreams_forums` |
| `kpi_actual_accepted` | ≥ 1 accepted KPI actual (ADR-0027) | `transform.track_progress` |
| `raid_register_present` | ≥ 1 `raid_entry` | `transform.manage_raid_decisions` |
| `benefit_validated` | ≥ 1 `benefit_measurement` with `status = 'validated'` | `realize.measure_validate_benefits` |
| `corrective_cases_owned` | every corrective case that is not closed has an owner and a follow-up date (true when there is none) | `realize.correct_gaps` |
| `handover_accepted` | ≥ 1 `bau_handover` with `status = 'accepted'` | `realize.transfer_ownership_controls` |
| `improvement_backlog_present` | ≥ 1 `improvement_item` | `realize.sustained_monitoring` |

**Entity `phase_step`** (`0051`; one row per transformation and step, created on first use or by the gate-approval consumer, §7; a step with no row is shown `not_started` with owner Unknown). Fields: `step_key`, `phase_code` (composite FK to the definition; probe PS04), `owner_user_id`, `status`, `enabled_by_gate_decision_id`, `review_requested_by/at`, `completion_check`, `reviewed_by/at`, `review_outcome` (`accepted` | `returned`), `review_note`, `completed_at`, P2 stamps and `version`. **State machine** (trigger `phase_step_status_step`; probes PS03, PS05–PS14):

```text
not_started -> in_progress -> in_review -> complete (final)
                                       \-> returned -> in_progress | in_review
```

Database invariants: `in_review` needs a frozen `completion_check` with `met = true` (`phase_step_in_review_checked`; PS07); `complete` needs `review_outcome = 'accepted'`, a met check and an owner (`phase_step_complete_shape`); the reviewer is neither the owner nor the review requester (`phase_step_reviewer_separate`; PS10); a return needs a note (PS11); the owner is fixed while in review (PS12); `complete` is final (PS14); step evidence is frozen once complete (PS15). **The review queue** is `GET …/phase-steps?status=in_review` plus one `phase_step_review` work item per review request for the reviewer role holders (§7). **"Step completed → next step task"** (REQ-S04-001 automation): accepting a step creates one `phase_step_enabled` work item for the owner of the next step of the same phase when that step has an owner (dedupe key `phase_step_next:<stepId>`); none when the next step has no owner (the step list shows owner Unknown).

REQ-S04-001's acceptance "a step with an unmet completion rule cannot be marked complete via the API": `POST …/phase-steps/{stepKey}/request-review` and `…/review` (accept) re-evaluate the rule and refuse with 422 `phase_step.completion_rule_unmet` (§11); the CHECKs above make a bypass impossible in SQL.

### 2. G5 Scale and G6 Sustain (REQ-PB-015, REQ-PB-020, REQ-PB-021, REQ-S04-007, REQ-S04-008)

**Criteria** (`0051`, 8 mandatory rows, labels verbatim from B0023; probe S03; G1–G4 rows untouched, probe G05):

| Key | Label (B0023) | Complete when (evaluator; facts read through `GateFactsProvider`) | Unknown handling |
|---|---|---|---|
| `g5.performance_evidence` | Performance evidence | every KPI linked to an outcome of the transformation (`outcome_kpi`) has an accepted actual whose latest evaluation is not Unknown/Stale/Not computable, **and** ≥ 1 verified evidence item is linked to step `transform.deliver_pilots` | an Unknown/Stale KPI makes the criterion incomplete, listing the KPI (never counted as met) |
| `g5.adoption` | Adoption | ≥ 1 adoption indicator (ADR-0033 metric link) is linked to the transformation, and each linked indicator's current value is not Unknown | Unknown indicator → incomplete |
| `g5.risk_closure` | Risk closure | every `raid_entry` of type `risk` with `impact = 'high'` is `closed` **or** has a `risk_disposition` whose canonical approval is `approved` (§6) | — |
| `g5.decision_log` | Decision log | the T16 log (`executive_decision_log`) has ≥ 1 row, and no row is `open` with a decision date (`due_date`) before today's business date | a NULL decision date is not "overdue" (Unknown, listed as missing date) |
| `g6.benefits_evidence` | Benefits evidence | ≥ 1 benefit exists, and each benefit has ≥ 1 `benefit_measurement` with `status = 'validated'` or an `approved` transition decision (ADR-0034 §3) | pending value is incomplete, never counted as validated |
| `g6.ownership_transfer` | Ownership transfer | ≥ 1 performance area of the transformation exists, and each has a `bau_handover` with `status = 'accepted'` in its current cycle | — |
| `g6.controls` | Controls | each performance area with an accepted handover has ≥ 1 `control` with `status = 'active'` | — |
| `g6.improvement_backlog` | Continuous improvement backlog | ≥ 1 `improvement_item` whose origin transformation is this one | — |

"High-impact" is REQ-PB-020's materiality threshold (its note (2)); "material risk" in REQ-S04-007 is read the same way. **`GateFactsProvider`** gains five read-only members — `raid`, `adoption`, `governance` (T16), `sustainment`, `benefits` — implemented in the owning modules and wired in `server.ts` (the G4 pattern, ADR-0021 §7); `workflows` imports none of those modules. Evaluators live in `workflows/g5.ts` and `workflows/g6.ts` and are registered in `EVALUATORS` (`criteria.ts`).

**Submission refusal text for G5/G6.** The DG2 422 `gate_criteria_incomplete` is kept; for G5 and G6 only, `detail` names the **labels**: "Mandatory required outputs are incomplete: {label}, {label}." and each `errors[i].message` starts with the label, e.g. "Risk closure: R-03 has High impact and is neither closed nor dispositioned.". This gives the literal acceptance "rejected listing 'Risk closure'" (REQ-PB-020) and "listing 'Ownership transfer'" (REQ-PB-021); G1–G4 responses are byte-for-byte unchanged.

**Approver.** G5's `allowed_approver_role_codes` is `{SP, BO}` since `0011`; configuring G5 to `BO` per T11 "Go-live / scale" uses the DG2 `PATCH …/gates/G5` (`gate.configure`). With BO configured, an SP decision gets the DG2 403 `gate.not_approver` "Only the configured approver of this gate can decide it." and a BO decision succeeds (REQ-PB-020 acceptance). G6 allows `SP` only (REQ-PB-021 "approve:SP").

**Enabling.** `0051` leaves G5/G6 `submission_enabled = false` (probe G05), so the DG2 `gate_not_enabled` refusal holds until BE-K's evaluators exist. BE-K enables both in one migration that takes a **repair-range number** assigned by the orchestrator (`0058`–`0069`; the slice H range `0051`–`0054` is fully used by this task so ARCH-08's `0055` can merge, S-12), with the `0026` guard pattern. The DG3 catalogue test "0026: … G5 and G6 stay closed" is updated by that task.

**Phase advance.** An approved G5 moves `current_phase` `transform → realize` through the existing `next_phase` path (ADR-0015 §2). An approved G6 has `next_phase` NULL: it changes no phase, does **not** close the transformation (D-089 Q4; closure is ADR-0034 §7), and writes nothing outside the `gate_*` tables, the audit log and the outbox (REQ-S04-008 "product G6 approval changes no engineering DG record").

**Snapshot** (REQ-S04-002). G5/G6 submissions use the DG2 snapshot (`mth.gate-submission/1`) plus a `g5`/`g6` member built from the same facts (KPI ids with their evaluation ids, indicator ids, risk ids with disposition and approval ids, T16 ids; benefit ids with validated measurement ids, handover ids, control ids, CI item ids), and the `exception` member of §4. The frozen-snapshot trigger `gate_submission_freeze` (`0017`) is unchanged, so editing a record after submission never changes the snapshot shown to approvers; completing every phase step never changes a gate status (no code path couples them; §1 writes only `phase_step`).

### 3. Per-criterion review and Under Review (REQ-S04-009, REQ-S04-010)

**Entity `gate_criterion_review`** (`0051`, append-only; probes GR01–GR08): `gate_submission_id`, `criterion_key`, `review_no` (1, 2, … per submission and criterion, trigger-checked), `reviewer_user_id`, `finding` (1–4000), `open_condition` (required when the recommendation is `meets_with_conditions`), `risk_note`, `raid_entry_id` (optional link to a T15 risk), `recommendation` ∈ {`meets`, `meets_with_conditions`, `does_not_meet`} (the criterion's "decision"), `rationale` (3–4000), `reviewed_at`. The trigger refuses a review of a non-pending submission, of a criterion that is not in the submission, and by the submitter (SoD, `insufficient_privilege`).

**The nine fields per criterion row** (REQ-S04-009) are read by `GET …/gates/{gateCode}/submissions/{submissionNo}/criteria`: criterion (`gate_criterion_definition.label_*`), required evidence (`description_*`), completeness (`gate_submission_criterion`), and reviewer, finding, open condition, risk, decision (recommendation) and rationale from the latest review (probe GR05: 9 of 9 non-null). A criterion with no review shows those six as Unknown ("not reviewed"), never as "meets". The gate-level decision keeps its DG2 mandatory rationale ("a gate decision without rationale is rejected by the API": the DG2 `gateDecisionCreate` schema requires `rationale` as `freeText(3, 8000)`, `packages/shared/src/schemas/gate.ts`, so a missing or blank rationale is a 400 validation problem).

**Status transitions.** `POST …/criteria/{criterionKey}/reviews` (`gate.review`, If-Match on the gate instance) inserts the review and, when the instance is `submitted`, moves it to `under_review` in the same transaction (REQ-S04-010 automation "review opened → Under Review"), with an audit event. The full table the API enforces (DG2 rows unchanged; the one new edge is marked):

| From | To | Actor |
|---|---|---|
| `draft`, `changes_requested`, `rejected`, `deferred` | `submitted` | submitter (`gate.submit`), via a new submission |
| `submitted` | `under_review` (**new**) | first reviewer (`gate.review`) |
| `submitted`, `under_review` | `approved`, `rejected`, `changes_requested`, `deferred` | configured approver (`gate.decide`) |
| `approved` | — | terminal; a material change creates a change request (ADR-0036), never a status edit |

`draft → approved` stays impossible (no decision without a pending submission: DG2 409 `gate.submission_superseded` "There is no pending submission to decide."). Every transition writes an audit event.

### 4. Gate exceptions (waivers) (REQ-S04-012, REQ-S04-013; D-089 Q2)

**Entity `gate_exception`** (`0051`; probes GE01–GE13): `gate_instance_id`, `gate_code`, `criterion_key` (a mandatory criterion of that gate, trigger `gate_exception_mandatory_criterion`), **`reason`**, **`scope`** (what the exception covers, 3–2000), **`compensating_action`** and `compensating_owner_user_id`, **`expires_on`** (a date), `status`, `requested_by/at`, **`decided_by`** (the approver), `decided_on_behalf_of`, `decided_at`, `decision_note`, `revoked_by/at`, `revoke_reason`, `expiry_notified_at`, P2 stamps, `version`. All five REQ-S04-013 fields are NOT NULL: "a waiver without expiry or compensating action is rejected" is the API 400 (`validation`) on the missing member, backed by NOT NULL (GE01, GE02). Content is immutable once requested (GE08).

**State machine** (trigger `gate_exception_guard`): `pending → accepted | rejected | withdrawn`; `accepted → revoked`; `rejected`, `withdrawn`, `revoked` final (GE10, GE11). One pending exception per gate instance and criterion (`gate_exception_one_pending_key`; GE06). **Authority:** the decider holds `gate_exception.decide` (business approval; SP, BO) **and** is the gate's configured approver (the DG2 `isGateApprover` check, incl. one-hop delegation per D-089 Q3), and is not the requester (CHECK `gate_exception_decider_not_requester`; GE07); an ADM-only caller gets 403 (`access/technical-admin.ts`, D-094).

**Coverage.** An exception covers its criterion on business date `d` (the transformation's timezone) when it is `accepted` and `d ≤ expires_on`. Expiry is a date comparison, not a status: on the day after `expires_on` the live gate view reports the criterion missing again with no job having run (REQ-S04-013 "after expiry the covered evidence item is again reported missing").

**Submission with an exception** (`submitGate`, BE-K): for each mandatory criterion the evaluator reports `incomplete`, the service looks for a covering exception under lock 730247 (key `<gateInstanceId>`). If one exists, the criterion row is frozen `incomplete` with `gate_exception_id` set, and the snapshot's criterion entry gains `exception: {id, reason, scope, compensatingAction, compensatingOwnerUserId, expiresOn, decidedBy, decidedAt}`. If any mandatory incomplete criterion has none, the exact DG2 422 `gate_criteria_incomplete` is returned (detail per §2), and nothing is written. **The changed DG2 invariant** (`0051`): `gate_submission_criterion_mandatory_complete` becomes `NOT mandatory OR completeness = 'complete' OR gate_exception_id IS NOT NULL`; new CHECK `…_exception_only_incomplete` (an exception only on a mandatory incomplete row); new trigger `gate_submission_criterion_exception_valid` (accepted, same gate instance, same criterion, `expires_on ≥` the submission's business date in the transformation's timezone). Probes: GC01 and G06 (no exception: refused exactly as in DG2, on a fresh and on an upgraded P3 database), GC02 (pending), GC03 (expired), GC04 (other criterion), GC05 (complete row), GC06 (covered: accepted; a submission at 23:59 Riyadh on the expiry date is covered).

**Decision time.** Approving a submission whose snapshot records an exception that has expired by the decision's business date is refused 422 `gate.exception_expired` (§11); rejecting, requesting changes or deferring is allowed.

**Expiry notification** (REQ-S04-013 "the owner is notified"): the daily job `gate.exception_expiry_scan` (`0054`, 00:30 Asia/Riyadh; BE-K handler, `apps/worker/src/handlers/gates.ts`) selects accepted exceptions with `expires_on` before today's business date and `expiry_notified_at` NULL, and per exception in one `runOnce` transaction (key `gate.exception_expired:<exceptionId>`): one inbox notification to the requester and one to the gate approver, one `gate_exception_expired` work item for the requester (dedupe `gate_exception_expired:<exceptionId>`), and `expiry_notified_at` set once (trigger `…_expiry_notified_once`; GE12). The job changes no exception status and no gate.

**`gate_dispensation` is not widened.** p4-plan §3 seam 3 proposed widening its `G1–G3` CHECK; REQ-S04-012/013 are met by the per-criterion `gate_exception` instead, because a dispensation waiver has no scope, expiry or compensating action. `gate_dispensation` and its DG3 routes are unchanged; DG4 has no whole-gate waiver for G4–G6.

### 5. Approved scale scope, conditions and scale transitions (REQ-S04-007, REQ-S03-004, REQ-S12-010)

**`GateDecisionCreate.scaleScope`** (the D-089-accepted extension, seam 2): `{ items: [{ initiativeId, businessUnitId, note? }] (1–100, unique pairs), conditions?: [{ text, ownerUserId, dueDate }] (0–20) }`. Rules: required when `gateCode = G5` and `outcome = approved` (422 `gate.scale_scope_required`); refused for any other gate or outcome (422 `gate.scale_scope_not_applicable`, the G1 `agreements` precedent). Every item names one initiative of the transformation and one business unit of its organization, so a scope is never unrestricted (M0124). Stored in `gate_decision_scale_scope` and `gate_decision_condition` (`0051`, append-only, written in the decision transaction; triggers require an approved G5 decision of the same transformation; probes SC01, SC03–SC05, SC09). Read: `GET …/scale-scope` (the latest approved G5 decision's items and conditions; 404-free empty list with `approved: false` before G5).

**Entity `scale_transition`** (`0051`, append-only; probes SC02, SC06–SC08, SC10): `initiative_id`, `business_unit_id`, `gate_decision_id`, `note`, `transitioned_by/at`; unique per initiative and business unit. `POST …/scale-transitions` (`scale.transition`, TL): before any approved G5, 422 invalid-transition `gate.g5_not_approved` "Scaling requires the G5 (Scale) business approval, which is not approved for this transformation." (REQ-S03-004 "returns 422 invalid-transition naming G5"); outside the approved scope, 422 invalid-transition `scale.outside_approved_scope`; after approval and inside scope, 201. The triggers `scale_transition_g5_approved` and `scale_transition_in_approved_scope` make both refusals hold in SQL. A Design-phase draft saved before G2 is unaffected (no slice H guard touches drafts; REQ-S03-004's first clause is the DG2 behaviour).

### 6. Risk dispositions (REQ-PB-020, REQ-S04-007)

**Entity `risk_disposition`** (`0051`, immutable; probes RD01–RD04): `raid_entry_id` (an open risk, trigger), `disposition` ∈ {`accept`, `transfer`, `carry_into_bau`}, `rationale`, `residual_owner_user_id`, `version = 1`. Its approval is a canonical P4 approval of type `risk_disposition` (`0053`; subject = the row), requested on creation through `requestApprovalInTx` (ADR-0026 §4; assignee party `SP`, or the party of the transformation's T11 row `go_live_scale` when G5's configured approver role is `BO`), decided with `approval.decide` by someone other than the proposer. "Approved disposition" in §2 means that approval's `status = 'approved'`.

### 7. Routing tasks and outbox events (REQ-S12-009, REQ-S12-010; R1)

`submitGate` and `decideGate` (BE-K's lines in `gates.ts`) call `enqueueOutboxEvent` in their transaction. Payloads (registered in `packages/shared/src/schemas/events.ts`, schema version 1, the ADR-0031 §5.4 convention):

- `gate.submitted` `{ gateInstanceId, transformationId, gateCode, submissionId, submissionNo, snapshotSha256, approverRoleCode, approverUserId, submittedBy, supersededSubmissionId }`; idempotency key `gate.submitted:<submissionId>`.
- `gate.decided` `{ gateInstanceId, transformationId, gateCode, submissionId, submissionNo, gateDecisionId, outcome, decidedBy, nextPhase, scaleScopeItemIds, conditionIds }`; key `gate.decided:<gateDecisionId>`.

Consumers (`apps/worker/src/handlers/gates.ts`, `runOnce` per event):

1. **`gate.submitted` → approver tasks** (REQ-S12-009 "each required approver receives exactly one task referencing the snapshot"). The required approvers are: the configured `approverUserId` if set; otherwise every active user holding the approver role with `gate.decide` on the transformation (resolved through scoped assignments), excluding the submitter. One `gate_decision_due` work item each, `subject_type = 'gate_submission'`, `subject_id = submissionId`, `message_params = {gateCode, submissionNo, snapshotSha256}`, dedupe key `gate_submission:<submissionId>:<userId>`. Open items of `supersededSubmissionId` are cancelled. No approver found → one inbox notification to the submitter with `routing.role_unmapped` (visible, never a silent skip).
2. **`gate.decided` → close and enable** (REQ-S12-010 "G2 approval enables Design tasks once; a conditional approval enables only its scope"). Every open `gate_decision_due` item of the submission is marked done (decider) or cancelled (others). When `outcome = approved`: (a) when `nextPhase` is set, insert the `phase_step` rows of that phase (`not_started`, `enabled_by_gate_decision_id`, `ON CONFLICT DO NOTHING` on `phase_step_key`) and one `phase_step_enabled` work item per step for the transformation's `lead_user_id`, else the submitter (dedupe `phase_enabled:<gateDecisionId>:<stepKey>`); (b) for G5, one `scale_scope_enabled` item per scope item for the initiative's executive owner, else its workstream lead, else the submitter (dedupe `scale_scope:<scopeItemId>`), and one `gate_condition_due` item per condition for its owner with its due date (dedupe `gate_condition:<conditionId>`). Nothing outside the approved scope is enabled. A redelivered event creates nothing (dedupe keys and the `processed_message` ledger).
3. **Phase-step review queue**: `request-review` creates one `phase_step_review` work item per holder of the definition's reviewer role on the transformation, excluding the owner (dedupe `phase_step_review:<stepId>:<reviewRequestedAt>`), synchronously in the API transaction (no remote I/O).

**ADR-0015 correction (R1).** ADR-0015 §2's sentences about the outbox events were not true of the DG2/DG3 code (Context 6). A dated correction note is added to ADR-0015 by this task; the events exist only once BE-K's lines merge.

### 8. Authorization (permissions matrix §16)

| Action | Permission (category) | Default roles | Record-level rule |
|---|---|---|---|
| Read phases, steps, gates, criteria, reviews, exceptions, scope, transitions, dispositions | `transformation.read` | every business role, AUD | 404 outside scope |
| Assign a step owner, start a step | `phase_step.manage` (write) | TL, TO | — |
| Link evidence, request review | `phase_step.progress` (write) | TL, BO, WL, FIN, TO, KDS | caller is the step owner |
| Accept or return a step | `phase_step.review` (write) | SP, BO, FIN, TO | caller ≠ owner and ≠ requester |
| Record a criterion review | `gate.review` (write) | SP, BO, FIN, TO | caller ≠ submitter |
| Submit G5/G6, configure approver | `gate.submit`, `gate.configure` (DG2) | TL; TO | — |
| Decide G5/G6 | `gate.decide` (business approval, DG2) | SP, BO | configured approver; ≠ submitter |
| Request an exception | `gate_exception.request` (write) | TL | — |
| Accept, reject, revoke an exception | `gate_exception.decide` (business approval) | SP, BO | configured approver of that gate; ≠ requester |
| Scale an initiative | `scale.transition` (write) | TL | inside the approved scope |
| Propose a risk disposition | `risk_disposition.propose` (write) | TL, BO, WL | — |
| Decide a risk disposition | `approval.decide` (business approval, ADR-0026) | SP, BO, FIN | ≠ proposer |

AUD holds `transformation.read` only, so every slice H write is 403 for AUD. No technical-admin role holds any code above (0001 trigger; probe S06); an ADM-only caller gets 403 on `gate_exception` decisions and on the gate decision (D-094 rule). The commit-time re-authorisation, `If-Match` (428/409), audit event and strict-UTF-8/free-text rules of p4-work-split §1 apply to every mutation.

### 9. Lock classes, events and jobs

- **730247 `gateException`** (`<gateInstanceId>`): exception request, decision, revocation, and the submission step that records a covering exception. **730248** reserved.
- Events: `gate.submitted`, `gate.decided` (§7). Job: `gate.exception_expiry_scan` (`0054`).
- Work-item kinds (`0053`): `gate_decision_due`, `gate_exception_to_decide` (created on exception request for the configured approver), `gate_exception_expired`, `gate_condition_due`, `phase_step_enabled`, `phase_step_review`, `scale_scope_enabled`.

### 10. Decimal and Unknown

No slice H table in this ADR stores money or a rate. Unknown is explicit: an unreviewed criterion shows its six review fields as "not reviewed"; a step without a row shows `not_started` and owner Unknown; an Unknown/Stale KPI or indicator never completes a G5 criterion (§2); a T16 row without a decision date is "date missing", not overdue and not on time; an exception's coverage is computed from the business date, never assumed.

### 11. Refusal codes and English texts (exact; S-11)

| Status | Code | English `detail` (or error `message`) |
|---|---|---|
| 422 | `gate_criteria_incomplete` (G5/G6 form) | "Mandatory required outputs are incomplete: {labels}." (labels joined with ", ") |
| 422 | `gate.exception_expired` | "The exception for {label} expired on {date}; it no longer covers the missing evidence." |
| 422 | `gate.scale_scope_required` (at `/scaleScope`) | "A G5 approval must record the approved scale scope." |
| 422 | `gate.scale_scope_not_applicable` (at `/scaleScope`) | "A scale scope is recorded only with a G5 approval." |
| 422 | `gate.scale_scope_invalid` (at `/scaleScope/items/{i}`) | "Each scope item names an initiative of this transformation and a business unit of its organization." |
| 422 | `gate.g5_not_approved` (invalid-transition) | "Scaling requires the G5 (Scale) business approval, which is not approved for this transformation." |
| 422 | `scale.outside_approved_scope` (invalid-transition) | "This initiative and business unit are outside the scale scope approved at G5." |
| 409 | `scale.already_scaled` (duplicate) | "This initiative is already scaled into this business unit." |
| 422 | `gate.review_not_open` | "Only a submitted or under-review gate submission can be reviewed." |
| 403 | `gate.reviewer_is_submitter` | "The submitter cannot review their own gate submission." |
| 422 | `gate.review_condition_required` (at `/openCondition`) | "An open condition is required when the criterion meets with conditions." |
| 422 | `gate_exception.criterion_not_mandatory` (at `/criterionKey`) | "An exception can only cover a mandatory criterion of this gate." |
| 409 | `gate_exception.already_pending` (duplicate) | "An exception for this criterion is already awaiting a decision." |
| 422 | `gate_exception.expiry_in_past` (at `/expiresOn`) | "The expiry date must be today or later." |
| 403 | `gate_exception.not_approver` | "Only the configured approver of this gate can decide its exceptions." |
| 403 | `gate_exception.requester_cannot_decide` | "The requester cannot decide their own exception." |
| 422 | `gate_exception.not_pending` (invalid-transition) | "Only a pending exception can be decided or withdrawn." |
| 422 | `gate_exception.not_accepted` (invalid-transition) | "Only an accepted exception can be revoked." |
| 400 | `gate_exception.revoke_reason_required` (at `/reason`) | "A reason is required to revoke an exception." |
| 422 | `phase_step.completion_rule_unmet` | "The completion rule of this step is not met: {rule message}." |
| 403 | `phase_step.not_owner` | "Only the owner of this step can do this." |
| 403 | `phase_step.reviewer_is_owner` | "The owner cannot review their own step." |
| 422 | `phase_step.invalid_transition` (invalid-transition) | "A step moves from {from} to {to} only as the phase procedure allows." |
| 422 | `phase_step.owner_required` | "Assign an owner before the step can be reviewed." |
| 400 | `phase_step.return_note_required` (at `/note`) | "A note is required to return a step." |
| 409 | `phase_step_evidence.exists` (duplicate) | "This evidence is already linked to the step." |
| 422 | `phase_step.complete` | "This step is complete; its evidence can no longer change." |
| 422 | `risk_disposition.not_open_risk` (at `/raidEntryId`) | "Only an open risk can be given a disposition." |

The rule messages of `phase_step.completion_rule_unmet` are, per rule: "at least one verified evidence item must be linked", "no meeting has been held", "no KPI actual has been accepted", "the RAID register is empty", "no benefit measurement has been validated by Finance", "an open corrective case has no owner or follow-up date", "no BAU handover has been accepted", "the improvement backlog is empty". All texts are translated at render time (FE-A/FE-F keys).

### 12. What DG4 does not build (stated so it is not claimed)

- Administrator configuration of phase steps or completion rules (REQ-S04-001 "configure:ADM"): the catalogue is seeded and SELECT-only in DG4; the form/rule builder is DG5 (REQ-S12-001/002).
- Rule-builder configurability of the two starter automations (p4-plan R5): DG5.
- Sequential or parallel multi-approver gates (p4-plan R6): DG4 gates are single-decision; "required approvers" are the holders resolved in §7.
- A whole-gate waiver for G4–G6 (§4) and conditional approval for gates other than G5 (§5).

## Alternatives considered

1. **Widen `gate_dispensation` for G5/G6 (p4-plan seam 3 as written).** Rejected: a dispensation has no scope, expiry or compensating action, and widening it would reopen a DG3 table and route for no requirement; a per-criterion table is what REQ-S04-012 ("unless an authorized, unexpired exception covers the item") describes.
2. **Store the criterion review on `gate_submission_criterion`.** Rejected: that table is append-only and frozen at submission; reviews happen after it, and several reviews per criterion must keep their history.
3. **A new gate outcome `approved_with_conditions`.** Rejected: it changes the DG2 outcome set and every consumer of it; conditions and scope are rows attached to an `approved` decision, which is additive.
4. **Instantiate all 25 phase steps for every transformation in a migration.** Rejected: rows without an owner or progress carry no information, and new transformations would need a DG2 instantiation change; "no row = not started" is exact and cheap.
5. **Evaluate completion rules in the database.** Rejected: the rules read five modules' facts; the API evaluates them and the database enforces the frozen result.

## Consequences

- One DG2 database invariant changes (D-089 Q2), with the exact DG2 refusal kept when no exception exists (probes G06, GC01).
- ADR-0015 §2 gets a correction note (R1); DG2/DG3 API responses for G1–G4 are unchanged; the new 422 texts for G5/G6 apply only to those gates.
- BE-K needs a repair-range migration number to enable G5/G6 (§2).
- REQ-S12-009/010 become true for every gate G1–G6 once BE-K's consumers merge, because the events are emitted for every gate.

## Verification

- **Database (probe, real output):** G00–G06, S01–S07, PS01–PS16, GR01–GR08, GE01–GE13, GC01–GC06, SC01–SC10, RD01–RD04 (`probe-output.txt`).
- **API (implementers' tests, p4-work-split §H):** `GET /phases` returns six phases matching B0021; each phase shows steps, required evidence, owners and a review queue; a step with an unmet rule cannot be completed (422); G5 with an open High-impact risk and no disposition → 422 listing "Risk closure"; G5 configured to BO: SP → 403, BO → 201; G6 without an accepted handover → 422 listing "Ownership transfer"; G6 approval changes no file under `docs/delivery/` and no phase; with a valid exception the submission succeeds and its snapshot records the exception; after expiry the live view lists the criterion missing; a waiver without expiry or compensating action → 400; the first review moves the gate to Under Review; each criterion row returns nine fields; a scale transition before G5 → 422 naming G5, after approval inside scope → 201, outside → 422; each required approver gets exactly one task referencing the snapshot SHA-256 (a redelivery adds none); G2 approval enables the Design steps once; a G5 approval enables only its scope items; AUD 403 on every write; technical-admin 403 on exception decisions; `If-Match` 428/409; one audit event per mutation.

## Amendment (2026-10-09, T-DG4-ARCH-R1): revoked exceptions, the version-0 phase step, and the codes added outside §11

### A1. A revoked exception blocks approval (BE-K2 handback §5 item 4; D-108)

REQ-S04-012 lets a mandatory criterion be incomplete only when "an authorized, unexpired exception covers the item". A revoked exception is no longer authorized, and §4 already says revoke makes the item "missing again from that moment". **Decision:** approving a submission whose snapshot records an exception that has been revoked (`status = 'revoked'`, whatever the revoke date relative to the submission) is refused **422 `gate.exception_revoked`**: "The exception for {label} was revoked on {date}; it no longer covers the missing evidence." ({label} = the criterion label, {date} = the revoke business date in the transformation's timezone). The check runs at the same point as `gate.exception_expired` and before it, so an exception that is both revoked and expired reports the revoke. Rejecting, requesting changes and deferring stay allowed, as for an expired exception. The submission row and its snapshot are never changed (frozen history); the requester resubmits once the evidence exists or a new exception is accepted. Nothing in DG2/DG3 changes: a submission without an exception never reaches this check. BE-R2 implements it in `workflows/gates.ts` (decision path) with tests: revoked before decision → 422 with the text, nothing written; reject on the same submission → allowed; an unrevoked, unexpired exception → approve allowed (unchanged).

### A2. Phase steps without a row

**The defaulted-record ETag rule (applies to three records only).** A record that exists by default before anyone writes it (one phase step per transformation and step key, ADR-0035 §1; one change-control policy per transformation, ADR-0036; one dashboard RAG policy per organization, ADR-0037 §3) is read with `version: 0` and `ETag: "0"` while no row exists, and the body shows the defaults (Unknown/null where the ADR says so). The first write sends `If-Match: "0"` and inserts the row at version 1; `If-Match: "0"` once a row exists is 409 `urn:mth:problem:version-conflict` with `currentVersion`; `If-Match: "<n ≥ 1>"` while no row exists is 409 without `currentVersion` (its schema starts at 1, and the BE-L behaviour is kept); a missing `If-Match` is 428. The contract declares this with two components used **only** by these six operations: the response header `ETagOrZero` (pattern `^"(0|[1-9][0-9]{0,9})"$`) on `getPhaseStep`, `getChangeControlPolicy` and `getDashboardRagPolicy`, and the parameter `IfMatchOrZero` (same pattern) on `updatePhaseStep`, `putChangeControlPolicy` and `putDashboardRagPolicy`. Every other operation keeps `ETag`/`IfMatch` starting at 1, and "creates are version 1" still holds for every row that is inserted. A 404 was rejected for these reads because the defaults are real, displayable values and the screen needs the ETag to make the first write. The three `contract: false` skips added for this (`workflows/phases.test.ts`, `workflows/change-requests.test.ts`, `reporting/rag-policy.test.ts`, one GET each) are removed by ARCH-R1, so these reads are contract-checked.

### A3. Codes and keys added outside §11 (accepted, with their exact English texts)

The `g5.*` and `g6.*` keys are the per-item keys of the "missing" list a G5/G6 evaluation returns (the server sends the English text shown). `forbidden` is the existing generic code; only its detail is recorded.

| Code or key | Kind | Decision | English text (exact) |
|---|---|---|---|
| `gate.exception_revoked` | 422 | new (item 7; BE-R2 implements) | The exception for {label} was revoked on {date}; it no longer covers the missing evidence. |
| `forbidden (existing code)` | 403 detail | accepted detail text | Only the requester can withdraw their exception. |
| `validation.duplicate_scope_item` | 400 field | accepted | Each item can appear only once in the scale scope. |
| `gates.task.gate_decision_due` | message key | accepted | Decide gate {gateCode}, submission {submissionNo}. |
| `gates.task.gate_condition_due` | message key | accepted | Meet condition {ordinal} of the {gateCode} decision. |
| `gates.task.gate_exception_to_decide` | message key | accepted | Decide an exception for {criterionKey} at gate {gateCode} (expires {expiresOn}). |
| `gates.task.gate_exception_expired` | message key | accepted | The exception for {criterionKey} at gate {gateCode} expired on {expiresOn}. Close the evidence gap. |
| `gates.notice.gate_exception_expired` | notice key | accepted | The exception for {criterionKey} at gate {gateCode} expired on {expiresOn}; it no longer covers the missing evidence. |
| `gates.task.phase_step_enabled` | message key | accepted | Phase step {stepKey} ({phaseCode}) can start. |
| `gates.task.phase_step_review` | message key | accepted | Review phase step {stepKey} ({phaseCode}). |
| `gates.task.scale_scope_enabled` | message key | accepted | Scale-out of {initiativeCode} is enabled in its approved scope. |
| `g5.performance_not_loaded / g5.adoption_not_loaded / g5.risk_closure_not_loaded / g5.decision_log_not_loaded / g6.benefits_not_loaded / g6.ownership_not_loaded / g6.controls_not_loaded / g6.improvement_not_loaded` | missing-item key | accepted | {label}: the facts could not be read. |
| `g5.performance_no_kpi` | missing-item key | accepted | Performance evidence: no KPI is linked to an outcome of the transformation. |
| `g5.performance_no_accepted_actual` | missing-item key | accepted | Performance evidence: {name} has no accepted actual. |
| `g5.performance_kpi_not_known` | missing-item key | accepted | Performance evidence: {name} is {valueStatus}. |
| `g5.performance_pilot_evidence_missing` | missing-item key | accepted | Performance evidence: no verified evidence is linked to the Transform step "deliver pilots". |
| `g5.adoption_none` | missing-item key | accepted | Adoption: no adoption indicator is linked to the transformation. |
| `g5.adoption_indicator_unknown` | missing-item key | accepted | Adoption: indicator {templateKey} has no current value ({valueStatus}). |
| `g5.risk_open` | missing-item key | accepted | Risk closure: {code} has High impact and is neither closed nor dispositioned. |
| `g5.decision_log_empty` | missing-item key | accepted | Decision log: the T16 decision log has no entry. |
| `g5.decision_date_missing` | missing-item key | accepted | Decision log: {name} is open and its decision date is missing. |
| `g5.decision_overdue` | missing-item key | accepted | Decision log: {name} is open past its decision date {decisionDate}. |
| `g6.benefits_none` | missing-item key | accepted | Benefits evidence: the transformation has no benefit. |
| `g6.benefit_not_validated` | missing-item key | accepted | Benefits evidence: {code} {title} has no Finance-validated measurement and no approved transition decision. |
| `g6.performance_area_none` | missing-item key | accepted | Ownership transfer: the transformation has no performance area. |
| `g6.handover_not_accepted` | missing-item key | accepted | Ownership transfer: {code} {name} has no accepted BAU handover in its current cycle. |
| `g6.controls_no_handover` | missing-item key | accepted | Controls: no performance area has an accepted BAU handover. |
| `g6.control_missing` | missing-item key | accepted | Controls: {code} {name} has no active control. |
| `g6.improvement_backlog_empty` | missing-item key | accepted | Continuous improvement backlog: the improvement backlog is empty. |

## Amendment (2026-10-10, T-DG4-ARCH-R3): the business units a G5 scale scope may name

Source: FE-F handback §5 item 1. Nothing above is removed. Where this amendment and §5 differ, this amendment wins.

### R1. `listScaleScopeBusinessUnits` (decided: a scoped read)

**The gap.** §5 lets a G5 scope item name any active business unit of the transformation's organization (`assertScaleScopeValid`; 422 `gate.scale_scope_invalid`). `listBusinessUnits` (DG1) returns only the units that the caller's `business_unit.read` grants reach (`scopeFilter` at level `business_unit`, `organization/routes.ts`). FE-F observed that the default G5 approver, a Sponsor with a transformation-scoped grant, could not list the organization's units. The scale-scope editor could offer only the transformation's own unit. The `ScaleScope` and `ScaleTransition` responses name units by id only, so the same caller could not label an approved scope either.

**Options considered:**
1. **A scoped read (decided).**
2. **A permission default** (give the Sponsor an organization-level `business_unit.read`). Rejected: it changes the DG2-approved role catalogue (ADR-0020) and its scope rule for every Sponsor, and it reveals every unit's full record (parent, version, timestamps) where only names are needed.
3. **A stated limitation** (only an approver with an organization-level grant can scope other units). Rejected: §5 lets a scope item name any active unit of the organization, and the Sponsor is G5's default approver. Under the limitation, the default approver could name no unit other than the transformation's own.

**Decided:** `listScaleScopeBusinessUnits`, `GET /api/v1/transformations/{transformationId}/scale-scope/business-units`:

- **Authorization:** `transformation.read` on the transformation (the `getScaleScope` gate; 404 outside scope).
- **Rows**, from the transformation's organization only:
  - every business unit with `status = 'active'`, which is exactly the set `assertScaleScopeValid` accepts;
  - plus every business unit, whatever its status, named by a `gate_decision_scale_scope` row or a `scale_transition` row of this transformation, so an approved scope and its transitions can always be labelled.
- **Members:** `ScaleScopeBusinessUnit` = `id`, `code`, `nameEn`, `nameAr`, `status`, and `selectable` (`true` iff `status = 'active'`). No parent, version or timestamps.
- **Order and paging:** `code`, then `id`. Cursor and `limit` as ADR-0007 §4 (`ScaleScopeBusinessUnitPage`, `{items, nextCursor}`).
- **No write and no `ETag`.** No change to `listBusinessUnits`, to the role catalogue, to `GateDecisionCreate.scaleScope` or to its refusals.
- **The editor** offers the `selectable` units. The scope view and the transition list label units from the same read.

**What it reveals.** A transformation reader learns the codes and names of the organization's active business units. That is the set a G5 scope of that transformation may name. Nothing else about a unit is returned, and no record or figure of another unit's transformations is reachable through it.

No schema, migration, audit or code change. The operation is pending in `apps/api/test/support/p4-pending-arch-r3.ts` until a backend task routes it in `apps/api/src/modules/workflows/scale.ts`.
