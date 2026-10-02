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
