# ADR-0017: Transformation Charter versioning, North Star, outcomes and strategic guardrails

- **Status:** Accepted for P2 (DG2). Author: solution-architect (T-DG2-ARCH-01 / 01B), 2026-10-02.
- **Requirements:** REQ-PB-029 (charter, 14 fields, versioned), REQ-PB-030 (thesis), REQ-PB-031 (five scope sanity checks), REQ-PB-033 (North Star), REQ-PB-035 (3–5 top outcomes warning), REQ-PB-036 (good outcome test), REQ-PB-037 (guardrails).
- **Sources:** playbook B0035 (charter fields), B0037 (thesis), B0038–B0043 (scope checks), B0048 (outcome tree), B0051 (good outcome test).
- **Builds on:** ADR-0003 (optimistic concurrency, `version`), ADR-0004 (audit), ADR-0016 (record guards). Physical model: migration `0013`.

## Context

The charter is a first-class record. Every saved change must create a new version, the history must be retained, and the baseline date must be a valid date. G1 needs an *initial* charter, and a G1 submission must pin the exact charter version that was submitted (ADR-0015).

## Decision

### 1. Current row plus immutable version snapshots

- **`charter`:** exactly one row per transformation (`charter_transformation_id_key`). It holds the current state:
  - **the 14 source fields:**
    - name;
    - executive sponsor and transformation lead (FKs to `app_user`);
    - case for change;
    - North Star (FK `north_star_id`; the statement itself lives in `north_star`);
    - scope in and scope out;
    - baseline date (`date`);
    - target horizon (value + unit);
    - top 3–5 outcomes (`outcome.is_top_outcome`/`top_rank`);
    - strategic guardrails (`strategic_guardrail` rows);
    - governance forum;
    - decision rights;
    - success definition;
  - the four-part thesis (`thesis_change`, `thesis_outcomes`, `thesis_benefits`, `thesis_because`);
  - the five scope-check answers (`sc_<code>` ∈ yes/partly/no + `sc_<code>_evidence`).

  Every field is nullable, so an *initial* charter may be partial. Completeness is a gate criterion (`g1.initial_charter`), not a NOT NULL constraint.
- **`charter_version`:** an append-only snapshot of every column, plus:
  - `north_star_statement`;
  - `top_outcomes_snapshot` and `guardrails_snapshot` (jsonb arrays of `{id, statement/title, rank, version}`);
  - `change_summary`, `saved_by`, `saved_at`.

  `(charter_id, version_no)` is unique. `version_no` equals the `charter.version` it captured.
- **Invariant:** every committed charter version has its snapshot. The deferred constraint trigger `charter_version_required` refuses to commit a charter INSERT/UPDATE without a `charter_version` row whose `version_no = charter.version`. Together with `p2_row_guard` (version +1) and `p2_audit_required`, a save is always all three: version bump, snapshot and audit event.

**Write path** (`POST`/`PATCH /transformations/{id}/charter`, `charter.edit`, If-Match on PATCH), all in one transaction:

1. `UPDATE charter … version = version + 1`;
2. INSERT `charter_version` with the new number and the snapshot of the linked North Star, top outcomes and guardrails, read in the same transaction;
3. INSERT `audit_event` with the field diff.

`baseline_date` is parsed as an ISO calendar date. `2026-02-30` is 400 at the API and is also rejected by PostgreSQL `date`.

**Read path:**
- `GET /charter` returns the current row plus computed `warnings[]` and `scopeCheckPrechecks[]`.
- `GET /charter/versions` and `GET /charter/versions/{versionNo}` return the history.
- A gate submission stores `(charter_id, charter_version_no)`, a composite FK into `charter_version`, so the approver always sees the version that was submitted.

### 2. Computed warnings and pre-checks (never blocking a save)

- **Top outcomes:** `charter.top_outcomes_count` when the number of active top outcomes is outside 3–5 (REQ-PB-035).
- **Scope-check pre-checks** support, but never replace, the human answer (the `system_precheck` column of `charter_scope_check_definition`):

| Pre-check | Passes when … |
|---|---|
| `scope_items_traced` | `in_scope` is non-empty and ≥ 1 confirmed diagnostic finding exists |
| `exclusions_present` | `out_of_scope` is non-empty after trimming; otherwise `attention` (see below) |
| `baseline_measurable` | ≥ 1 baseline has a value, a source and a date |
| `executive_decisions_visible` | open decisions with an owner exist |

  Each result is `pass`, `attention`, `not_applicable` or `unknown`. Missing data gives `unknown`, never `pass`.

  **`exclusions_present` on a saved charter (F-DG2-150).** An empty, null or whitespace-only Out of scope is a definite, failing answer to "Are explicit exclusions documented?", not missing data: it gives `attention` ("No explicit exclusions (out of scope) are documented; this check fails until Out of scope is completed."), never `unknown` and never `pass` (B0041; REQ-PB-031 acceptance A01, "an empty Out of scope field makes 'Are explicit exclusions documented?' fail"). It gives `pass` only when the trimmed text is non-empty. The G1 criterion `g1.initial_charter` uses the same rule (`hasExclusions`), so a blank Out of scope is also reported there as the missing "scope out" part.

  **Blank free text is rejected; `null` clears (F-DG2-150, T-DG2-BE5).** This applies to all P2 free text, not only Out of scope. A whitespace-only value is not content.
  - **Validation.** Every P2 shared schema builds its free-text fields with `freeText(min, max)` (`@mth/shared`, `schemas/common.ts`). It rejects a string whose trimmed length is 0 with a 400 validation problem: code `validation.blank`, plus a JSON pointer to the field. Nothing is written and no audit event is recorded.
  - **Storage.** An accepted value is stored exactly as entered; there is no trimming transform. A nullable field still accepts `null`, which clears it.
  - **Readiness.** Every free-text "is present" test in G1-G3 readiness, the charter pre-checks, KPI baseline measurability and the good outcome test uses the shared `hasText` helper (trimmed and non-empty), never `!== null`. `hasExclusions` is a named alias of it. A blank thesis part is incomplete (`composeThesis`). This is defense in depth for blank text that reaches the database around the API.
  - **Web.** Forms send blank input as `null`, and the shared schemas reject whitespace client-side. A server `validation.blank` is shown on its field in EN and AR.

### 3. North Star

- **`north_star` rows:** status `current`/`superseded`. A partial unique index allows exactly one current row per transformation.
- **The statement** is 1–300 characters with no line break (CHECK `statement !~ '[\r\n]'`). The API also rejects more than one sentence terminator.
- **Refining:** `PUT /north-star` supersedes the current row and inserts a new one in one transaction (both audited). The history is never overwritten.

### 4. Outcomes and the good outcome test

- **Tree:** `outcome` is a tree (`parent_outcome_id`, a composite FK inside the transformation). The trigger `outcome_hierarchy_guard` serialises writes per transformation with an advisory lock and keeps the tree acyclic and ≤ 6 levels deep (the P1 BU-hierarchy pattern).
- **Good outcome test (B0051):** evaluated per outcome from `good_outcome_criterion`:

| Criterion | How it is evaluated |
|---|---|
| specific | user-attested (`specific_confirmed`) |
| measurable | system: ≥ 1 T02 row with a KPI |
| strategically relevant | user-attested |
| owned by a business leader | system: `owner_user_id` set |
| causal chain | user-attested (`causal_chain` text present) |

  The API returns `goodOutcomeTest` per outcome, with each criterion `pass`, `fail` or `unknown`.

### 5. Strategic guardrails

`strategic_guardrail` rows hold category (regulatory/cx/capex/risk/brand/other), statement and optional owner, with status active/archived. G2 needs ≥ 1 active guardrail. The charter references them by transformation and snapshots them per version.

## Alternatives considered

- **Event-sourcing the charter (diffs only):** rejected. Reading version *n* would need a replay, and gate pins would point into a log. Full snapshots are small (one row per save).
- **A temporal table / `tstzrange` validity on one table:** rejected. PostgreSQL 16 has no system versioning, and hand-written temporal updates are error-prone. The current row plus append-only snapshots matches the P1 audit pattern.
- **Storing the charter as one jsonb document:** rejected (§16: typed columns for core entities). Gate criteria query individual fields.

## Consequences

- A charter save is three rows. The UI shows the version history and a diff of any two snapshots (computed client-side from two `CharterVersion` bodies).
- Links (outcomes, guardrails, North Star) are edited on their own resources. The charter snapshot captures them at each save, so a later outcome edit does not change an old charter version.

## Verification

- **Migration probe P6/P7:** a charter without its snapshot fails at COMMIT, and with its snapshot it commits.
- **Migration probe P8:** the snapshot cannot be updated or deleted.
- **Migration probe P9:** an invalid baseline date fails.
- **Required integration tests:**
  - create → version 1 + snapshot;
  - PATCH with stale If-Match → 409;
  - PATCH → version 2, both versions retrievable;
  - invalid date → 400;
  - top-outcome count warning;
  - AUD write → 403.
