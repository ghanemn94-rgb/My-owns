# ADR-0016: P2 data model — typed register tables, database record guards and the transformation starter structure

- **Status:** Accepted for P2 (DG2). Author: solution-architect (T-DG2-ARCH-01 / 01B), 2026-10-02.
- **Requirements:** REQ-S16-013, REQ-PB-023…028, REQ-PB-033…043, REQ-S12-004 (P2 increment), REQ-S16-023/026/032 (integrity increments).
- **Sources:** playbook B0029 (workstreams), B0031 (T01), B0048–B0051 (outcomes, T02, good outcome test), B0056 (TOM dimensions), B0058 (T03), B0062–B0063 (TOM canvas, workshop), B0065 (T04).
- **Builds on:** ADR-0003, ADR-0004, ADR-0014. Physical model: migrations `0010`–`0018`. Columns: `docs/architecture/data-dictionary.md` §P2.

## Context

P2 brings the first business registers:

- the four source templates T01–T04;
- the TOM canvas, capability heatmap and journeys;
- the six §16 "diagnosis and direction" entities;
- evidence;
- the decision and gate model (ADR-0015).

Every one of them is mutable, transformation-scoped, versioned, audited and checked against source-faithful columns and validation rules. P1 enforced audit coverage and optimistic concurrency in application code and tests only.

## Decision

### 1. One typed table per register (no EAV)

Each template is its own relational table, with the source columns as typed columns. The API enforces each template's validation rule, and the database enforces it again.

| Register | Table | Source columns → physical | Rule enforced in SQL |
|---|---|---|---|
| T01 Current-State Diagnostic (B0031) | `diagnostic_item` | Dimension → `dimension_code` (FK to the 6-row seed `diagnostic_dimension`); Current state; Evidence/baseline → `evidence_baseline` text + `baseline_id` FK; Root cause; Impact (SAR/KPI) → `impact_amount numeric(20,4)` + `impact_currency` or `impact_kpi_definition_id` or `impact_text`; Confidence → `confidence ∈ {H,M,L}` | Confidence CHECK; money pair; six seeded rows per transformation (`diagnostic_item_seeded_key`), never archivable |
| T02 Outcome & KPI Tree (B0050) | `outcome_kpi` | Outcome → `outcome_id`; KPI → `kpi_definition_id`; Baseline → `baseline_id` or `baseline_value`; Target → `target_value`; Target date → `target_date date NOT NULL`; Owner; Leading indicator → text or `leading_kpi_definition_id` | A row without a target date is rejected (NOT NULL); one baseline source; trajectory approver ≠ creator |
| T03 TOM Gap Matrix (B0058) | `tom_gap` | TOM dimension → `dimension_code NOT NULL` (FK to the 10-row seed); Current; Target; Gap; Design decision → `design_decision_id` (FK to `decision`); Owner | A row without a dimension is rejected (NOT NULL); the link to T04 is a real FK |
| T04 Design Decision Log (B0065) | `decision` (kind `design`) + `decision_option` | Decision ID → `code` `D-01…`; Decision; Options A/B/C → `decision_option.label`; Recommendation; Owner; Due; Status (default Open) | Code format; status default `open`; decided ⇒ chosen option; options belong to their decision (composite FKs) |
| TOM Canvas (B0062) | `tom_canvas_cell` | ten boxes = ten rows per transformation (`dimension_code` unique per transformation); current, target, owner; gaps/evidence/dependencies/decisions are links | `ready` ⇒ target design and owner |
| Capability heatmap (REQ-PB-024) | `capability` | current/target level 1–5, `sourcing_need ∈ {build, buy, partner, undecided}` | CHECKs |
| Journey / process map (REQ-PB-025) | `journey` (+ `steps jsonb`) and `journey_pain_point` | steps (key, actor, handoff, systems, controls, cycle time) validated by the shared zod `JourneyStep` schema; pain points relational | array bounds; cycle-time pair |

**Why not one generic "register row" table (EAV or jsonb).**

- §16 forbids "one unvalidated blob".
- Gate criteria, reports and the TOM canvas need typed joins: T03 → T04, T02 → KPI → baseline.
- Typed columns give real foreign keys, CHECKs and indexes.

Validated jsonb appears only where the shape is a nested list owned by one row:

- `journey.steps`;
- `outcome_kpi.trajectory_points`;
- `gate_submission.snapshot`;
- the `charter_version` snapshots of outcomes and guardrails.

Each of these has a zod schema in `@mth/shared` that the API applies before writing. Custom fields (ADR-0014 `custom_field_values`) are not introduced in P2.

### 2. Methodology catalogue, seeded and pinned (ADR-0014 made concrete)

- **Version row:** `methodology_version` holds one published row, `playbook` v1. Its `definition` jsonb carries a SHA-256, and the source document hash is `2584a352…548ad2`.
- **Catalogue tables:** `diagnostic_dimension` (6), `diagnostic_workstream` (6, with key questions and typical outputs, B0029), `tom_dimension` (10, with design question B0056 and canvas box/prompt B0062), `gate_definition` (6), `gate_criterion_definition` (16 for G1–G3), `charter_scope_check_definition` (5) and `good_outcome_criterion` (5).
- **Seed text:** source text is verbatim from `docs/source/playbook.md`. The Arabic is a **provisional translation** and needs linguistic review.
- **Immutability:**
  - Published methodology definitions are immutable (trigger).
  - TOM dimensions allow only label and Arabic edits (`methodology.configure`), and those edits are versioned and audited (trigger `tom_dimension_source_immutable`).
- **Pin:** each transformation is pinned to its methodology version (`transformation_config_pin`).
- **Out of scope for P2:** a phase-definition table. The six phases stay the CHECK-constrained `phase` value (P1) plus `gate_definition.phase/next_phase`.

### 3. Database record guards (`0010`), the last line of defence behind the API

Every P2 business table calls `p2_attach_guards(table, audited)` in its own migration.

| Guard | Rule |
|---|---|
| `p2_row_guard` (BEFORE INSERT/UPDATE) | INSERT: `version = 1`, and `organization_id` equals the parent transformation's. UPDATE: `id`, `organization_id`, `transformation_id`, `created_at`, `created_by` are immutable, and `version` must be exactly `OLD.version + 1` (ADR-0003 optimistic concurrency). |
| `p2_audit_required` (DEFERRABLE INITIALLY DEFERRED constraint trigger) | At COMMIT, an `audit_event` with `record_type` = the table name, `record_id` = the row id and `new_version` = the row version must exist. **A P2 mutation without its audit event cannot commit** (ADR-0004 coverage, enforced by the database). |
| `p2_append_only` | History and snapshot tables: `charter_version`, `evidence_content`, `gate_submission_criterion`, `gate_decision`. UPDATE, DELETE and TRUNCATE raise, even for the owner role. |
| `p2_record_ref_guard` | Polymorphic `(record_type, record_id)` references (evidence links, workstream outputs) must name an existing row of an allow-listed table **in the same transformation**. |
| Composite foreign keys `(transformation_id, x_id)` | Every child-to-parent reference inside a transformation. A row can never point at another transformation's record. |

`mth_app` has no DELETE on any P2 table. Business records are archived (`status = archived` plus `archived_at`/`archived_by`/`archive_reason`, all-or-nothing CHECK) and never deleted.

**Consequence for implementers:** write each mutation as one transaction:

1. lock or check the version;
2. `UPDATE … SET version = version + 1`;
3. insert the `audit_event` with the matching `new_version` and the field diff.

The P1 audit helpers (`@mth/db` `insertAuditEvent` and `diffFields`) handle step 3. A forgotten audit event becomes a COMMIT error (`<table>_audit_required`) instead of a silent gap. Problem mapping: `_version_step` → 409, the other guards → 500 (a programming error, never user-facing).

### 4. Transformation starter structure (`p2_instantiate_transformation`, 0018)

`p2_instantiate_transformation(transformation_id, actor_user_id, request_id, source)` creates, idempotently, with an audit event per row:

- the methodology pin;
- the six seeded T01 rows;
- the ten TOM canvas cells;
- the six gate instances (approver = default role).

- **Who calls it:** the API's `POST /transformations` handler calls it inside the create transaction. It cannot wait for the asynchronous outbox worker, because the gate and T01 screens must exist immediately. P1's `transformation.created` outbox event stays for non-structural automation.
- **Backfill:** migration 0018 backfills existing transformations as actor `system`, on behalf of the creator.
- **IDs:** rows created in SQL use `mth_uuid_v7()`. Columns never default to it (ADR-0003: application IDs).

### 5. Dates, money and Unknown

- **Business dates** (`baseline_date`, `target_date`, `due_date`, `workshop_date`, …) are PostgreSQL `date`. `pool.ts` registers a parser for OID 1082 so they stay `YYYY-MM-DD` strings and never shift by a process time zone.
- **Money and quantities** are `numeric`, carried as decimal strings in the API and as `decimal.js` values in code (ADR-0019).
- **Unknown:** a missing value is `NULL`, which the API returns as `null` and the UI shows as Unknown/Stale. It is never `0`.

### 6. Advisory-lock registry (all stages; T-DG3-ARCH-03, 2026-10-08)

This is the **one registry** of the transaction-scoped advisory-lock classes. ADR-0022 and ADR-0023 point here. A guard that must be race-free across concurrent writers takes `pg_advisory_xact_lock(<class>::integer, hashtext(<key>::text))` (the F-DG1-140 pattern). A class names exactly **one kind of resource**: two kinds must never share a class, or unrelated writes would serialize on each other whenever their keys hash alike.

| Class | Constant (module) | Resource serialized | Key (`hashtext` of …) | Taken by |
|---|---|---|---|---|
| 730219 | `HIERARCHY_LOCK_CLASS` (organization) | business-unit hierarchy of one organization | `organization_id` | API + trigger `business_unit_hierarchy_guard` (0009) |
| 730220 | — (database only) | outcome tree of one transformation | `transformation_id` | trigger in 0013 (`outcome_lock_class`) |
| 730221 | `DEPENDENCY_GRAPH_LOCK_CLASS` (workflows) | initiative dependency graph of one transformation | `transformation_id` | API (T08) + trigger `dependency_cycle_guard` (0022) |
| 730222 | `PRIORITIZATION_LOCK_CLASS` (portfolio) | prioritization writes of one transformation (weight-set proposal and activation, ranking snapshots, score results) | `transformation_id` | API only (ADR-0022) |
| 730223 | `DEPENDENCY_TYPE_LOCK_CLASS` (workflows) | creation of one dependency-type code | the requested code | API only (ADR-0023 §4) |
| 730224 | `delegationGraph` (access) | delegation graph of one organization (loop guard) | `organization_id` | API (BE-B) + trigger `delegation_loop_guard` (0029; `delegation_graph_lock_class`) (ADR-0026 §3) |
| 730225 | `raciDeliverable` (governance) | the accountable cells of one T12 RACI deliverable | the deliverable id | API (BE-C) + deferred triggers `transformation_raci_*_one_accountable` (0030; `raci_deliverable_lock_class`) (ADR-0026 §7) |
| 730226 | `approvalSubject` (workflows) | the subject record of an approval (request, decision, subject update) | the subject record id | API (BE-B, and any module updating a subject with an open approval) + triggers `approval_guard`, `approval_decision_guard` (0031; `approval_subject_lock_class`) (ADR-0026 §4) |
| 730227 | — | reserved for the T-DG4-ARCH-01 block (p4-plan §4); not allocated | — | — |
| 730228 | `kpiFormulaGraph` (kpi) | the KPI formula graph of one transformation (formula input insert, version activation) | transformation_id | API (KBE-B formula validation) + triggers `kpi_formula_input_guard`, `kpi_version_guard` (0033; `kpi_formula_graph_lock_class`) (ADR-0027 §4) |
| 730229 | `kpiActualSlot` (kpi) | one KPI actual slot: KPI, scope, reporting period (value versions, review decisions, RAG overrides) | `<kpiDefinitionId>:<scopeKind>:<scopeId>:<reportingPeriodId>` | API (KBE-C actuals and overrides) + triggers `kpi_actual_guard` (0034), `rag_override_guard` (0035) (`kpi_actual_slot_lock_class`) (ADR-0027 §6, §10) |
| 730230 | `reportingPeriod` (kpi) | the reporting periods of one organization and frequency (create, date change, open, close; overlap check) | `<organizationId>:<frequency>` | API (KBE-C reporting periods, the period-open job) + trigger `reporting_period_guard` (0033; `reporting_period_lock_class`) (ADR-0027 §3) |
| 730231 | — | reserved for the T-DG4-ARCH-02 block (p4-plan §4); not allocated | — | — |
| 730232 | `benefitAllocationSet` (benefits) | the allocation set of one benefit (a PUT that replaces the set; the 100 % sum check) | the benefit id | API (KBE-D allocations) + trigger `benefit_allocation_guard` (0037; `benefit_allocation_lock_class`) (ADR-0029 §5) |
| 730233 | `financeValidationQueue` (benefits) | the Finance validation queue item of one benefit measurement (submit, the queue handler, withdrawal on supersede) | the measurement id | API only (KBE-E submit and the `benefits.finance_queue` handler; exactly one item also held by the unique index `finance_validation_one_per_measurement`) (ADR-0030 §3) |
| 730234 | `benefitOverlap` (benefits) | overlap detection and resolution of one transformation and driver | `<transformationId>:<driverKey>` | API only (KBE-D overlaps) (ADR-0029 §7) |
| 730235 | — | reserved for the T-DG4-ARCH-03 block (p4-plan §4); not allocated | — | — |
| 730236 | `correctiveCase` (raid) | the corrective-action case of one source (KPI and scope, benefit, failed check): open-or-update, manual create | `<transformationId>:<sourceKind>:<sourceScopeKey>` | API only (BE-D: the four event consumers in `apps/worker/src/handlers/raid.ts` and `createCorrectiveCase`; one open case per source is also held by the unique index `corrective_case_one_open_key`, 0041) (ADR-0031 §5) |
| 730237 | — | reserved for the T-DG4-ARCH-04 block (p4-plan §4); not allocated | — | — |
| 730238 | `meetingSeriesGeneration` (governance) | the generation and regeneration of one meeting series (no duplicate occurrence; future-only replacement) | `<meetingSeriesId>` | API only (BE-F: `updateMeetingSeries`, `endMeetingSeries` and the `governance.meeting_series_generate` job in `apps/worker/src/handlers/meetings.ts`; no duplicate occurrence is also held by the unique index `meeting_series_occurrence_key`, 0044) (ADR-0032 §2) |
| 730239 | `executiveAskBlocker` (governance) | the executive ask of one blocker (create-once on N red cycles) | `<transformationId>:<blockerRecordType>:<blockerRecordId>` | API only (BE-G: the `governance.blocker_escalation` consumer and scan in `apps/worker/src/handlers/escalations.ts`; one open ask per blocker is also held by the unique index `decision_one_open_blocker_ask`, 0045) (ADR-0032 §8) |
| 730240 | `decisionEscalation` (governance) | the SLA escalation of one executive decision | `<decisionId>` | API only (BE-G: the `governance.decision_sla_scan` job; one escalation per due date is also held by the unique constraint `decision_escalation_once`, 0045) (ADR-0032 §7) |
| 730241 | — | reserved for the T-DG4-ARCH-05 block (p4-plan §4); not allocated | — | — |
| 730242 | `adoptionIntervention` (adoption) | the below-trajectory intervention of one adoption indicator, scope and reporting period | `<metricLinkId>:<scopeKind>:<scopeId>:<reportingPeriodId>` | API only (KBE-F: the `adoption.indicator_evaluated` consumer; exactly one intervention is also held by the unique index `adoption_intervention_trigger_key`, 0047) (ADR-0033 §4) |
| 730243 | `bauHandover` (sustainment) | the BAU handover of one performance area | `<performanceAreaId>` | API only (BE-I: prepare, submit, accept, return, reopen; one open and one accepted handover per cycle are also held by `bau_handover_open_key` and `bau_handover_accepted_key`, 0048) (ADR-0034 §4) |
| 730244 | `closure` (sustainment) | the closure of one initiative or transformation | `initiative:<initiativeId>` or `transformation:<transformationId>` | API only (BE-J: `closeInitiative`, `closeTransformation`; one closure per subject is also held by `closure_record_initiative_key` and `closure_record_transformation_key`, 0048) (ADR-0034 §7) |
| 730245 | — | reserved for the T-DG4-ARCH-06 block (p4-plan §4); not allocated | — | — |

Rules:

- **Single source.** The numbers live in `apps/api/src/modules/platform/advisory-locks.ts` (`ADVISORY_LOCK_CLASSES`, exported by `platform/index.ts`). Each module's constant is defined from it, and no other module file spells a number. A migration that shares a lock declares the same number as a PL/pgSQL `*_lock_class CONSTANT`.
- **Tested.** `platform/advisory-locks.test.ts` asserts that the classes are distinct int4 values, that every `*_lock_class` constant in `packages/db/migrations/` equals its registry entry, and that no module source outside the registry spells a class number.
- **The 730222 collision (fixed).** Until T-DG3-ARCH-03, dependency-type creation (BE-C) and prioritization (BE-D) both used 730222. Dependency-type creation now has 730223. No migration was involved: both locks are API-only.
- **A new class** takes the next free number in its task's P4 block (p4-plan §4: 730224–730249, one block per architecture task), adds a row here and an entry in the registry file in the same change. Rows 730224–730227 were added by T-DG4-ARCH-01 (2026-10-09), rows 730228–730231 by T-DG4-ARCH-02 (2026-10-09), rows 730232–730235 by T-DG4-ARCH-03 (2026-10-09), rows 730236–730237 by T-DG4-ARCH-04 (2026-10-09), rows 730238–730241 by T-DG4-ARCH-05 (2026-10-09), rows 730242–730245 by T-DG4-ARCH-06 (2026-10-09).
- **Out of scope** (a different key space, so no collision with the two-int4 form): the single-bigint locks `pg_advisory_xact_lock(hashtextextended(<text>, 0))` used for idempotency keys, the North Star and readable codes, and the fixed bigint keys of the migration runner and bootstrap in `packages/db`.

## Alternatives considered

- **EAV / generic template engine for T01–T04 now:** rejected (see §1). The P5 form designer (ADR-0014) adds *custom* fields on top of the typed tables. It never replaces them.
- **Audit coverage enforced only by tests:** rejected for P2. With three implementers in parallel and about 30 new mutable tables, a database guard is cheap. P1's 0003 trigger already makes the audit log append-only; this guard makes it complete.
- **Starter structure via the async worker:** rejected (see §4). Gate and T01 screens would be empty for seconds and need "not ready" states.
- **Hard delete for drafts:** rejected (§16 no hard deletes; the audit trail references every id).

## Consequences

- `packages/db/src/schema.ts` lists every P2 table. `catalogue.test.ts` compares it with the migrated database, and it now also lists the P2 `version` tables and `mth_app` grants.
- P2 tables are created only by 0010–0018 (solution-architect). Any later change is a new forward migration `0019+` owned by backend-workflow-engineer. 0010–0018 are frozen once DG2 approves.
- Polymorphic links are guarded, but they carry no FK. Archiving (not deleting) keeps them valid.

## Verification

Evidence (real output) is in `docs/delivery/handbacks/DG2/T-DG2-ARCH-01B-evidence/`:

- **Fresh apply:** `mth-db migrate` applies 0001→0018 on an empty PostgreSQL 16.13 database.
- **Backfill apply:** 0010–0018 apply over a populated P1 database, and the backfill creates 1 pin, 6 T01 rows, 10 canvas cells, 6 gate instances and 23 system audit events.
- **Instantiation:** `p2_instantiate_transformation` creates 23 rows and is idempotent (0 on re-run).
- **Guard probes, each raising its named error:**
  - P2: a missing audit event fails at COMMIT.
  - P3: a version jump fails.
  - P3b: an unchanged version fails.
  - P4: an UPDATE without an audit event fails at COMMIT.
  - P6: a charter without its version snapshot fails.
  - P8 and the owner block: UPDATE/DELETE on `charter_version` fails.
  - P10–P12: the T01/T02/T03 template rules fail.
  - P15: a filename can never be verified.
  - P16: DELETE is denied to `mth_app`.

The integration suite runs on the same migrations and passes 206/209. The 3 failures come from an environmental stray directory and pass in a clean copy (see the handback).
