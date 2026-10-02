# ADR-0015: One decision model and the product-gate engine (G1–G3 in P2)

- **Status:** Accepted for P2 (DG2). Author: solution-architect (T-DG2-ARCH-01 / 01B), 2026-10-02.
- **Requirements:** REQ-PB-016, REQ-PB-017, REQ-PB-018, REQ-S04-003, REQ-S04-004, REQ-S04-005, REQ-DLV-034, REQ-PB-043, REQ-PB-042, REQ-S13-012, REQ-S16-012 (P2 increment).
- **Sources:** playbook B0023 (gate table), B0065 (T04 Design Decision Log), B0063 (TOM workshop); master prompt §4 (gates, lines ~191–193), the shared decision model note (~235), §16.
- **Builds on:** ADR-0003 (optimistic concurrency), ADR-0004 (audit), ADR-0006 (authorization, SoD), ADR-0014 (methodology versions).
- **Physical model:** migrations `0011` (gate definitions + criteria), `0017` (decision, gate instance/submission/criterion/decision). Contract: `docs/api/openapi.yaml` tags `decisions` and `gates`.

## Context

The playbook asks for one decision log that design decisions (T04), decision-rights decisions (T11) and executive decisions (T16) all share, and for six phase gates G1–G6 that each answer a decision question with required evidence (B0023). The master prompt adds:

- versioned submissions;
- a rule that evidence which is only a filename or an inaccessible link is unverified;
- a 403 for a non-configured approver or the submitter;
- a 409 for a decision on a superseded submission.

P2 delivers G1 (Case for Change), G2 (Direction) and G3 (Target State).

**G1–G6 and DG0–DG7 are separate.**
- **G1–G6** are *business* approvals made by people inside the product.
- **DG0–DG7** are the *engineering* delivery gates of this project, recorded in `docs/delivery/`.

The two systems share nothing: no table, no code path and no status. A product gate decision never implies any engineering gate, and the reverse is also true. G6 never implies DG7. No engineering agent and no seed row ever grants a real business approval. Demo approvals in synthetic seed data approve nothing real.

## Decision

### 1. One canonical `decision` table

`decision.kind` is one of:

| `kind` | What it holds | Code |
|---|---|---|
| `design` | T04 rows | `D-01`, `D-02`, … |
| `gate` | The canonical row behind every product-gate decision | `GD-01`, … |
| `executive` | T16, reserved for P4 | `DEC-01`, … |

- **Codes:** generated per transformation from `record_code_counter` (prefix `D`/`GD`/`DEC`/`DEP`). The counter row is locked `FOR UPDATE` in the creating transaction, so two concurrent creates never get the same code. The unique constraint `decision_code_key` backs this up.
- **Options:** `decision_option` holds options `A`, `B`, `C` (letters `^[A-Z]$`, unique per decision).
  - `recommendation_option_id` and `chosen_option_id` are composite foreign keys `(decision.id, option id)`, so a decision can only point at its own options.
- **Status:** `open → decided | deferred | cancelled`; `deferred → open`.
  - A new design decision defaults to `open` (REQ-PB-043).
  - `decided` requires `decided_by`, `decided_at` and (for `design`) a `chosen_option_id`, all enforced by CHECK constraints.
  - Gate decisions are born `decided` (`decision_gate_is_decided`).
- **Views, not copies:**
  - `GET /api/v1/decisions?transformationId=…&kind=design` is the T04 Design Decision Log.
  - The TOM canvas, the TOM gap matrix (`tom_gap.design_decision_id`), dependencies (`dependency.decision_id`) and workshop conversions (`tom_workshop_item.converted_decision_id`) all reference the same rows.
  - There is no second decision register that could drift (master prompt "avoid duplicate registers").
- **Deciding a design decision:** `POST /decisions/{id}/decide`. It needs `decision.decide` **and** record-level ownership: the caller is `owner_user_id`, or a delegate acting on their behalf (recorded as `on_behalf_of_user_id` in the audit event).
  - `decision.decide` is in the `write` category, not `business_approval`. It records the choice made by the decision owner the playbook names (B0065). It is not a gate or Finance approval.
  - This keeps the DG1 F-DG1-106 invariant intact: a BU-scoped TL who creates a transformation still gets the derived, approval-free transformation assignment.
  - P4 adds a separate business-approval permission for executive (T16) decisions that need sponsor approval.

### 2. The product-gate engine

| Table | Role |
|---|---|
| `gate_definition` (seed, 0011) | G1–G6 per methodology version: phase, next phase, source decision question and evidence text (B0023, verbatim), `default_approver_role_code` (SP), `allowed_approver_role_codes`, `submission_enabled` (true for G1–G3 in P2). |
| `gate_criterion_definition` (seed, 0011) | The **required outputs** per gate. Each has `mandatory` and `requires_verified_evidence`. |
| `gate_instance` (0017) | One per transformation and gate, created by `p2_instantiate_transformation()` (ADR-0016). Holds status, configured approver (role, optional named user), `current_submission_id` and `latest_submission_no`. Versioned. |
| `gate_submission` (0017) | One row per submission, `submission_no` 1, 2, 3… per instance. Holds the frozen `snapshot` jsonb plus its SHA-256, the pinned `charter_version_no`, the submitter and the resolved approver. A trigger freezes everything except the lifecycle columns, and a status can only move out of `pending`. At most one `pending` submission per gate (partial unique index). |
| `gate_submission_criterion` (0017) | Append-only per-criterion completeness frozen at submission (`complete`/`incomplete` plus a `detail` jsonb with missing items and unverified evidence ids). |
| `gate_decision` (0017) | Append-only. Holds outcome (`approved`, `rejected`, `changes_requested`, `deferred`), mandatory rationale, `decided_by`, `on_behalf_of_user_id`, `approver_basis` (`configured_user`, `configured_role`, `default_role`), approver role, submission number and timestamp. Points at its canonical `decision` row through the composite FK `(decision_id, 'gate')`. |

#### Required outputs per gate

These are seeded in `gate_criterion_definition`. Every criterion is mandatory, and the source references are in the seed.

| Gate | Criterion key | Required output (complete when …) | Verified evidence |
|---|---|---|---|
| **G1 Case for Change** | `g1.diagnostic` | every seeded T01 dimension has current state, root cause, impact and confidence, and is backed by a linked baseline or verified evidence | **yes** |
| | `g1.baseline` | ≥ 1 measurable baseline (value, source, baseline date) backed by verified evidence | **yes** |
| | `g1.root_causes` | every seeded T01 row states a root cause, and ≥ 1 confirmed finding is classified `root_cause` | no |
| | `g1.value_pools` | ≥ 1 value pool, each quantified (upside + downside) or explicitly `unquantified`, with materiality assessed | no |
| | `g1.case_for_change` | the charter states the case for change | no |
| | `g1.initial_charter` | a charter exists with name, sponsor, lead, scope in/out and baseline date. **A submission without an initial charter is rejected.** | no |
| **G2 Direction** | `g2.north_star` | exactly one current North Star, one sentence | no |
| | `g2.outcome_tree` | ≥ 1 top outcome, each with ≥ 1 T02 row | no |
| | `g2.kpi_definitions` | every KPI in T02 has an active definition with unit, polarity and owner | no |
| | `g2.target_trajectory` | every T02 row has a target, a target date and an approved trajectory | no |
| | `g2.guardrails` | ≥ 1 active strategic guardrail | no |
| **G3 Target State** | `g3.target_operating_model` | all ten TOM dimensions have a target design and an owner (canvas cell `ready`) | no |
| | `g3.gap_matrix` | ≥ 1 T03 row, and every open gap has an owner | no |
| | `g3.capability_gaps` | ≥ 1 rated capability with target level > current level | no |
| | `g3.future_journeys` | ≥ 1 future-state journey or process | no |
| | `g3.design_decisions` | no open design decision without an owner | no |

#### Evaluation

- **Where it runs:** criteria are evaluated by pure functions in the `workflows` module, one evaluator per criterion key, reading through the owning modules' public interfaces.
- **Live view:** `GET /gates/{gateCode}` shows the live evaluation. Each criterion carries:
  - `completeness`;
  - `missing[]`, as machine-readable i18n codes;
  - `unverifiedEvidenceIds`.
- **On submit:** submitting re-evaluates the criteria inside the submitting transaction and freezes the result.
- **Unverified-evidence rule (REQ-S13-012):** evidence counts only when `evidence.review_status = 'verified'` (ADR-0018). The rule is enforced in three places:
  - **Verification is gated:** verification needs `accessibility_status = 'accessible'` and a reviewer who did not create the evidence (`evidence_verified_rule`).
  - **Filenames never count:** a `file_reference` (bare filename) can never be verified (`evidence_filename_never_verified`).
  - **Unverified is not enough:** a criterion with `requires_verified_evidence` stays `incomplete` while it has only unverified evidence.

#### Submission (`POST /gates/{gateCode}/submissions`, `gate.submit`)

1. Resolve the approver:
   - `gate_instance.approver_user_id`, if one is configured;
   - otherwise `approver_role_code`, which defaults to `gate_definition.default_approver_role_code` (SP).

   Configuration (`PATCH /gates/{gateCode}`, `gate.configure`) only accepts roles in `allowed_approver_role_codes`. The trigger `gate_instance_approver_allowed` enforces this too. Configuration is refused while a submission is pending.
2. Lock the gate instance through If-Match on its version. Re-evaluate every criterion. Any incomplete mandatory criterion means **422 `gate_criteria_incomplete`**, listing the missing criteria, and nothing is written. The CHECK `gate_submission_criterion_mandatory_complete` makes this impossible to bypass in SQL.
3. Mark the previous `pending` submission `superseded` (setting `superseded_by_submission_id`). Insert submission N+1 with its snapshot and criteria. Set `gate_instance.status = 'submitted'`, `current_submission_id` and `latest_submission_no = N+1`. Write all the audit events and an outbox event `gate.submitted`. The event is the hook for routing to the approver's work queue; the notification itself is a later-stage increment.

#### Decision (`POST /gates/{gateCode}/decision`)

Checks run in this order, each one also enforced in the database where it can be:

| # | Check | Failure |
|---|---|---|
| 1 | The caller can read the transformation. | 404 |
| 2 | The caller is the configured approver: the named `approver_user_id`, or a holder of `approver_role_code` with `gate.decide` on the transformation, or a delegate acting on that person's behalf (P1 delegation table, record types incl. `gate`). | **403** `gate.not_approver` |
| 3 | The caller (or the person they act for) is not the submitter of the pending submission. The `gate_decision_guard` trigger enforces this with ERRCODE `insufficient_privilege`. | **403** `gate.submitter_cannot_decide` |
| 4 | Body `submissionNo` equals the current **pending** submission number. Otherwise (superseded, withdrawn or already decided) nothing is written. `gate_decision_guard` enforces this with constraint `gate_decision_current_submission`. | **409** `urn:mth:problem:version-conflict`, code `gate.submission_superseded`, `currentVersion` = the current submission number |
| 5 | Rationale has ≥ 3 characters. | 400 / 422 |

On success, one transaction:

- inserts a `decision` row (`kind = 'gate'`, `GD-nn`) and a `gate_decision` row (approver basis, role and submission number);
- marks the submission `decided`;
- updates `gate_instance.status` to the outcome. `approved` also sets `approved_at`.

  For an approved G1/G2/G3, the transformation's `current_phase` moves to `gate_definition.next_phase` through the transformations module's public interface. That is the only path that advances a phase, so phase progression is gate-controlled, as the P1 contract promised.
- writes the audit events and an outbox event `gate.decided`.

A `rejected` or `changes_requested` gate can be resubmitted. That creates submission N+1, and the old decision remains in the history.

**Approval semantics.** The approver is a person. The API never auto-approves. Seed and demo data may contain a demo SP decision on synthetic data, clearly marked synthetic, which approves nothing real. G-gate status is a product state and never feeds DG0–DG7 records or tooling.

### 3. Workshop mode (REQ-PB-042)

- `tom_workshop` → `tom_workshop_item` (`contribution` = `recorded`; `unresolved` = `open` → `converted`).
- Conversion is one transaction. It creates either a `decision` (kind `design`, status `open`, `source_workshop_item_id` set) or an `action_item` (with an owner), then sets the item's `converted_decision_id`/`converted_action_id`.
- A workshop cannot move to `closed` while it has an `open` unresolved item (trigger `tom_workshop_close_guard`, API 422).

## Alternatives considered

1. **A separate table per decision type (T04, T11, T16, gate).** Rejected. It duplicates registers that drift apart, which the source explicitly warns against, and it makes "every decision about dimension X" a union of four tables.
2. **Gate decisions stored only on `gate_instance` columns.** Rejected. It loses the submission history and cannot express "decision on a superseded version". The canonical `decision` row also lets the decision register list gate decisions.
3. **Re-evaluating criteria at decision time instead of freezing them at submission.** Rejected. The approver must decide on what was submitted. A later edit creates a new submission rather than silently changing the evidence under review. The snapshot plus its SHA-256 makes this auditable.
4. **Optimistic version on `gate_submission` for the 409.** Rejected in favour of `submissionNo`. The meaningful staleness is "a newer submission exists", which the submission number expresses directly and the trigger can enforce.

## Consequences

- One register serves T04 now and T11/T16 in P4. P4 adds columns and views, not a new table.
- Product gate data lives only in `gate_*` tables and the `workflows` module. No code path writes to `docs/delivery/` or reads it.
- The criterion evaluators couple `workflows` to `transformations`, `kpi` and `evidence` through their public interfaces. The module dependency graph in `apps/api/src/modules.ts` must allow `workflows → transformations, kpi, evidence, access, audit, platform` (no cycle, because those modules never import `workflows`).
- G4–G6 definitions and their gate instances exist from P2, with `submission_enabled = false` (API 422 `gate_not_enabled`). Their criteria are added by later migrations without touching P2 rows.

## Verification

- **Migration probe (real PostgreSQL 16.13, `docs/delivery/handbacks/DG2/T-DG2-ARCH-01B-evidence/`):**
  - P13: the submitter's decision is refused, `gate_decision_not_submitter`.
  - P14: a stale `submission_no` is refused, `gate_decision_current_submission`.
  - P17: `gate_decision` cannot be truncated, even by the owner role.
- **Required integration tests (backend-workflow-engineer):**
  - G1 submit without charter → 422.
  - Submit with only filename evidence → criterion `incomplete`.
  - Decision by a non-approver → 403.
  - Decision by the submitter → 403.
  - Decision on submission 1 after submission 2 → 409, nothing written.
  - Approved G1 → `current_phase = define`.
  - A read-only auditor (AUD) gets 403 on submit and on decide.
  - Every mutation writes its audit event (the database refuses to commit otherwise, ADR-0016).
- **Required e2e test (qa-verifier):** the G1 happy path with two distinct synthetic users (submitter TL, approver SP).
