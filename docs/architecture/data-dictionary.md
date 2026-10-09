# Data dictionary: P1, P2, P3 and P4 tables and views

- **Task:** T-DG1-ARCH-01 (solution-architect), 2026-09-30.
- **Contract for:** backend-workflow-engineer's P1 migrations (`packages/db/migrations/**`).
- **Governed by:** ADR-0003 (types, IDs, time, concurrency, retention), ADR-0004 (audit), ADR-0005 (sessions), ADR-0006 (access) and ADR-0008 (outbox/jobs).
- **Changes:** changes to this contract after DG1 approval go through the orchestrator.
- **P2 (DG2):** the P2 tables (migrations 0010–0018) are in the section "P2 tables" at the end of this file (T-DG2-ARCH-01B). The P1 sections are unchanged.
- **P3 (DG3):** the P3 tables (migrations 0020–0024) are in the section "P3 tables" at the end of this file (T-DG3-ARCH-01). Two P2 entries were regenerated because P3 migrations change them compatibly: `record_code_counter` (prefixes INI/BC/BF) and `dependency` (initiative endpoints, type FK, cycle guard). Every P3 entry is generated from the migrated catalogue (`pg_catalog`), so it matches the migrations exactly.
- **0027 (T-DG3-ARCH-04):** adds `benefit_calculation.rounding` and its three CHECKs. That entry was updated from `pg_get_constraintdef` on a database migrated `0001`→`0027` (the `catalogue.test.ts` 0027 case pins the definitions). As in the other entries, the `::text` casts on literals are omitted.

## Global rules

- **Schema:** `public`, owned by `mth_owner`. `mth_app` gets `SELECT, INSERT, UPDATE` on business tables, **no `DELETE`** unless a row says otherwise below, and only `INSERT, SELECT` on `audit_event`.
- **SQL floor:** SQL must run on PostgreSQL 16 and 18 (ADR-0003).
- **Encoding:** the database must be `UTF8` (ADR-0003 "Database encoding"). Every "n chars" limit in this dictionary is a `char_length` limit in Unicode code points, which holds only on a UTF8 database (on `SQL_ASCII` it would count bytes). `mth-db` refuses any other encoding, and `/readyz` reports `database: fail`.
- **IDs:** `id uuid PRIMARY KEY` with no default; the application supplies a UUIDv7.
- **Time:** only `timestamptz`, and `DEFAULT now()` only where noted.
- **Status values:** `text` plus `CHECK (col IN (...))`, not PostgreSQL enums, so later values can be added with a simple forward migration.
- **Codes:**

  | Column | Rule |
  |---|---|
  | `code` | `CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$')` |
  | `currency` | `char(3) CHECK (currency ~ '^[A-Z]{3}$')` |
  | `timezone` | `text`, validated by the API against `Intl`; the DB only checks `CHECK (length(timezone) BETWEEN 1 AND 64)` |
  | `locale` | `CHECK (locale IN ('ar','en'))` |

- **Concurrency:** `version integer NOT NULL DEFAULT 1 CHECK (version >= 1)` on every mutable table. Updates increment it by exactly 1 (ADR-0003).
- **Row stamps:**
  - `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`;
  - `created_by uuid NULL REFERENCES app_user(id)` and `updated_by`: NULL only for system and bootstrap rows.
- **Foreign keys:** `ON DELETE RESTRICT ON UPDATE RESTRICT` (the default `NO ACTION` is acceptable, since there are no cascades).
- **Case-insensitive uniqueness:** a unique index on `lower(col)`. No `citext` extension, to avoid extension dependencies.

---

## schema_migration
Bookkeeping for the migration runner (ADR-0003).

| Column | Type | Constraints |
|---|---|---|
| id | integer | PK (the `NNNN` prefix) |
| name | text | NOT NULL, UNIQUE |
| sha256 | char(64) | NOT NULL |
| applied_at | timestamptz | NOT NULL DEFAULT now() |
| applied_by | text | NOT NULL DEFAULT current_user |

**Invariant:** the runner aborts if a file's checksum differs from the recorded `sha256`.

## organization

| Column | Type | Constraints / default |
|---|---|---|
| id | uuid | PK |
| code | text | NOT NULL, code check |
| name_en | text | NOT NULL, 1–200 chars |
| name_ar | text | NOT NULL, 1–200 chars |
| default_timezone | text | NOT NULL DEFAULT `'Asia/Riyadh'` |
| default_currency | char(3) | NOT NULL DEFAULT `'SAR'` |
| default_locale | text | NOT NULL DEFAULT `'ar'`, locale check |
| status | text | NOT NULL DEFAULT `'active'`, `IN ('active','inactive')` |
| version, created_at, updated_at, created_by, updated_by | | standard |

**Indexes:** `UNIQUE (code)`.

**Invariants:**
- The first organization is created by the bootstrap CLI (safe production initialization, §19 item 3), not by a migration.
- Demo data lives in a separate environment (REQ-S18-001).

## business_unit

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| organization_id | uuid | NOT NULL FK → organization |
| parent_business_unit_id | uuid | NULL FK → business_unit |
| code | text | NOT NULL, code check |
| name_en / name_ar | text | NOT NULL |
| status | text | NOT NULL DEFAULT 'active', `IN ('active','inactive')` |
| version, stamps | | standard |

**Indexes:**
- `UNIQUE (organization_id, code)`;
- `(parent_business_unit_id)`;
- `UNIQUE (organization_id, id)`, the target for composite FKs.

**Invariants:**
- The parent is in the same organization. This is enforced by the composite FK `(organization_id, parent_business_unit_id) → business_unit(organization_id, id)`.
- No cycles, and at most 10 levels below the organization (`MAX_BU_DEPTH = 9`, 0 = top-level unit). Enforced twice (F-DG1-140):
  - **API (friendly path):** on create and re-parent the API takes the organization's hierarchy advisory lock, then checks the cycle and depth against `business_unit_closure`, and answers 422 `business_unit.cycle` / `business_unit.depth_exceeded` (400 field error on create).
  - **Database (last line of defence, migration 0009):** the `AFTER INSERT OR UPDATE OF parent_business_unit_id, organization_id` trigger `business_unit_hierarchy_guard` takes the same transaction-scoped advisory lock `(730219, hashtext(organization_id))`, walks the parent chain with `SELECT … FOR SHARE` and checks the subtree height. It raises SQLSTATE `23514` with constraint name `business_unit_acyclic` or `business_unit_max_depth`, which the API maps to the same problems. Concurrent re-parents are therefore serialized per organization, and a cycle can never commit. Under REPEATABLE READ the locking walk turns a stale parent chain into a serialization failure (`40001`). The one residual is depth (not cycles) for a concurrent child insert into a moved subtree; the application uses READ COMMITTED, where that case is serialized too.
- A re-parent needs `business_unit.manage` on the moved unit **and** on the destination: the new parent unit, or the organization for a move to the top level (F-DG1-141; 403 otherwise, audited `authorization.denied`).
- An inactive BU cannot receive new transformations (422).

## app_user

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| organization_id | uuid | NOT NULL FK → organization (home organization) |
| display_name | text | NOT NULL, 1–200 |
| email | text | NULL, ≤ 320 |
| preferred_locale | text | NOT NULL DEFAULT 'ar', locale check |
| timezone | text | NULL (null = organization default) |
| status | text | NOT NULL DEFAULT 'active', `IN ('active','disabled')` |
| last_login_at | timestamptz | NULL |
| version, stamps | | standard |

**Indexes:**
- `UNIQUE (organization_id, lower(email)) WHERE email IS NOT NULL`;
- `(organization_id, lower(display_name))` for search.

**Invariants:**
- Disabling a user sets `revoked_at` on all of their sessions in the same transaction.
- No password columns ever: authentication is OIDC, or dev login bound to `urn:mth:dev-local`.

## user_identity

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | NOT NULL FK → app_user |
| issuer | text | NOT NULL, ≤ 512 |
| subject | text | NOT NULL, ≤ 255 |
| email_at_binding | text | NULL |
| created_at | timestamptz | NOT NULL DEFAULT now() |
| last_login_at | timestamptz | NULL |

**Indexes:** `UNIQUE (issuer, subject)`, `(user_id)`.

**Invariants:**
- (issuer, subject) identifies exactly one user.
- Rebinding is an audited admin action (ADR-0005).
- `mth_app` may `DELETE` here, only through the audited rebinding service.

## session

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| token_hash | bytea | NOT NULL UNIQUE (SHA-256 of the cookie value; 32 bytes) |
| user_id | uuid | NOT NULL FK → app_user |
| auth_mode | text | NOT NULL `IN ('oidc','dev')` |
| idp_issuer | text | NULL |
| idp_session_id | text | NULL (`sid` claim, for back-channel logout later) |
| csrf_token_hash | bytea | NOT NULL |
| created_at | timestamptz | NOT NULL DEFAULT now() |
| last_seen_at | timestamptz | NOT NULL DEFAULT now() |
| idle_expires_at | timestamptz | NOT NULL |
| absolute_expires_at | timestamptz | NOT NULL |
| revoked_at | timestamptz | NULL |
| user_agent | text | NULL, ≤ 512 |

**Indexes:**
- `(user_id) WHERE revoked_at IS NULL`;
- `(absolute_expires_at)` for purging.

**Invariants:**
- A session is valid only if `revoked_at IS NULL AND now() < idle_expires_at AND now() < absolute_expires_at` and the user is active.
- Raw tokens are never stored or logged.
- Expired rows are purged by the worker. `mth_app` may `DELETE` expired rows; session rows are not business records.
- The table has no `version` column: sessions are not user-editable records.

## oidc_login_state

| Column | Type | Constraints |
|---|---|---|
| state_hash | bytea | PK (SHA-256 of `state`) |
| code_verifier | text | NOT NULL |
| nonce | text | NOT NULL |
| return_to | text | NOT NULL DEFAULT '/', must start with a single `/` |
| created_at | timestamptz | NOT NULL DEFAULT now() |
| expires_at | timestamptz | NOT NULL (created_at + 10 min) |
| browser_binding_hash | bytea | NOT NULL, `octet_length = 32` (SHA-256 of a random `__Host-`/HttpOnly/`SameSite=Lax` pre-session cookie set by `GET /auth/login`) — migration 0007, F-DG1-103 |

**Invariants:**
- Single use: the callback deletes the row with `DELETE … RETURNING` inside the callback transaction (`mth_app` may `DELETE`).
- **Browser-bound (CSRF, RFC 6749 §10.12 / OIDC Core §3.1.2.1):** the callback consumes a state only when the presenting browser's cookie hashes to `browser_binding_hash`; a callback URL captured from another browser is refused and the state is not consumed. Only the SHA-256 is stored, never the cookie value.
- Expired rows are purged.

## role

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| code | text | NOT NULL UNIQUE (SP, TL, BO, WL, FIN, TO, KDS, TD, CM, SEC, AUD, ADM_TECH, ADM_ACCESS, ADM_METHOD) |
| name_en / name_ar | text | NOT NULL |
| kind | text | NOT NULL `IN ('source','implementation','technical_admin')` |
| inherits_downward | boolean | NOT NULL DEFAULT false |
| is_system | boolean | NOT NULL DEFAULT true (seeded; not deletable) |
| version, stamps | | standard |

**Seed:**
- The P1 seed migration inserts the 14 roles with fixed literal UUIDs and the permission links from `packages/shared/src/permissions.ts`.
- A unit test asserts that the seed equals that file.
- Arabic role names are provisional translations that need linguistic review.

## permission

| Column | Type | Constraints |
|---|---|---|
| code | text | PK, `CHECK (code ~ '^[a-z_]+\.[a-z_]+$')` |
| category | text | NOT NULL `IN ('read','write','configure','business_approval','finance_validation')` |
| description_en / description_ar | text | NOT NULL |

## role_permission

| Column | Type | Constraints |
|---|---|---|
| role_id | uuid | FK → role, part of PK |
| permission_code | text | FK → permission, part of PK |
| created_at | timestamptz | NOT NULL DEFAULT now() |

**Invariant (SoD, ADR-0006):**
- Trigger `role_permission_no_admin_approver` runs `BEFORE INSERT OR UPDATE`.
- It raises if the role's `kind = 'technical_admin'` and the permission's `category IN ('business_approval','finance_validation')`.
- An integration test proves the rejection.

## scoped_assignment

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| organization_id | uuid | NOT NULL FK → organization |
| user_id | uuid | NOT NULL FK → app_user |
| role_id | uuid | NOT NULL FK → role |
| scope_type | text | NOT NULL, `IN (organization, business_unit, transformation, portfolio, workstream, initiative, performance_area, forum, record)`; P1 API accepts only the first three |
| scope_id | uuid | NOT NULL |
| effective_from | timestamptz | NOT NULL DEFAULT now() |
| effective_to | timestamptz | NULL, `CHECK (effective_to IS NULL OR effective_to > effective_from)` |
| reason | text | NOT NULL, 3–1000 |
| granted_by | uuid | NOT NULL FK → app_user (NULL-free: the bootstrap CLI creates the first admin as a system user) |
| revoked_at | timestamptz | NULL |
| revoked_by | uuid | NULL FK → app_user |
| revoke_reason | text | NULL; `CHECK ((revoked_at IS NULL) = (revoked_by IS NULL) AND (revoked_at IS NULL) = (revoke_reason IS NULL))` |
| derived_from_assignment_id | uuid | NULL FK → scoped_assignment (`ON DELETE/UPDATE RESTRICT`); `CHECK (derived_from_assignment_id IS DISTINCT FROM id)` and `CHECK (… IS NULL OR scope_type = 'transformation')` — migration 0008, F-DG1-106 |
| version, stamps | | standard |

**Indexes:**
- `(user_id) WHERE revoked_at IS NULL`;
- `(scope_type, scope_id) WHERE revoked_at IS NULL`;
- `(organization_id, role_id)`;
- `(derived_from_assignment_id) WHERE derived_from_assignment_id IS NOT NULL AND revoked_at IS NULL`;
- `UNIQUE (user_id, role_id, scope_type, scope_id) WHERE revoked_at IS NULL`, so there are no duplicate active grants (a duplicate gives 409).

**Invariants:**
- `scope_id` is polymorphic, so the API verifies that it exists and belongs to `organization_id`: `organization_id = scope_id` when `scope_type = 'organization'`.
- **Derived creator assignment (F-DG1-106):** when a business-unit-scoped grant *without* downward inheritance (e.g. TL) creates a transformation, the API gives the creator an explicit, audited `transformation`-scope assignment of the same role (never a role holding an approval permission), with the source grant's `effective_to`; `derived_from_assignment_id` links it to the source so revoking the source revokes the derived row in the same transaction. NULL for every directly granted row.
- Revocation never deletes the row.
- A user's home organization does not limit which organizations they can be granted in.

## delegation (P1 table; logic P2/P4)

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| organization_id | uuid | NOT NULL FK → organization |
| delegator_user_id | uuid | NOT NULL FK → app_user |
| delegate_user_id | uuid | NOT NULL FK → app_user, `CHECK (delegate_user_id <> delegator_user_id)` |
| scope_type | text | NULL (null = all of the delegator's scopes); same values as scoped_assignment |
| scope_id | uuid | NULL; `CHECK ((scope_type IS NULL) = (scope_id IS NULL))` |
| record_types | text[] | NULL (null = all) |
| reason_code | text | NOT NULL `IN ('absence','other')` |
| reason_text | text | NULL |
| effective_from | timestamptz | NOT NULL |
| effective_to | timestamptz | NOT NULL, `CHECK (effective_to > effective_from)` |
| status | text | NOT NULL DEFAULT 'active' `IN ('active','revoked','expired')` |
| version, stamps | | standard |

**Indexes:** `(delegate_user_id, status)`, `(delegator_user_id, status)`.

**Invariants (enforced in the service, P2/P4):**
- No cycles.
- No delegation to the requester of a pending item.
- Delegated rights never exceed the delegator's.

## transformation

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| organization_id | uuid | NOT NULL FK → organization |
| business_unit_id | uuid | NOT NULL; composite FK `(organization_id, business_unit_id) → business_unit(organization_id, id)` |
| code | text | NOT NULL, code check; generated `TR-0001`… per organization when omitted |
| name | text | NOT NULL, 1–200 |
| description | text | NULL, ≤ 4000 |
| mode | text | NOT NULL `IN ('end_to_end','modular')` |
| entry_phase | text | NULL, phase check |
| standalone_deliverable_type | text | NULL `IN ('target_operating_model','initiative_business_case','benefits_register')` |
| status | text | NOT NULL DEFAULT 'draft' `IN ('draft','active','on_hold','closed')` |
| current_phase | text | NOT NULL, phase check `IN ('diagnose','define','design','mobilize','transform','realize')` |
| sponsor_user_id | uuid | NULL FK → app_user |
| lead_user_id | uuid | NULL FK → app_user |
| timezone | text | NOT NULL (copied from organization default when omitted) |
| currency | char(3) | NOT NULL (copied from organization default when omitted) |
| archived_at | timestamptz | NULL |
| archived_by | uuid | NULL FK → app_user |
| archive_reason | text | NULL; `CHECK ((archived_at IS NULL) = (archive_reason IS NULL) AND (archived_at IS NULL) = (archived_by IS NULL))` |
| version | integer | standard |
| created_at, created_by, updated_at, updated_by | | NOT NULL (created_by and updated_by are NOT NULL here: always a real user) |

**Table CHECK constraints:**
- `(mode = 'modular') = (entry_phase IS NOT NULL)`
- `mode = 'modular' OR standalone_deliverable_type IS NULL`
- `mode = 'modular' OR current_phase = 'diagnose'` at creation. This is enforced in the API, not as a CHECK, because phases advance later.

**Indexes:**
- `UNIQUE (organization_id, code)`;
- `(organization_id, updated_at DESC, id DESC)` for the default cursor sort;
- `(business_unit_id)`;
- `(organization_id, status) WHERE archived_at IS NULL`;
- `(organization_id, lower(name))`.

**Invariants:**
- Status changes follow `TRANSFORMATION_STATUS_TRANSITIONS` (API, 422).
- `current_phase` does not change through the P1 API.
- Archived rows are read-only.
- Create, update and archive each write one `audit_event`.
- Create also writes one `outbox_event` (`transformation.created`, schema_version 1).
- Setting `sponsor_user_id` or `lead_user_id` does **not** grant access. Access comes only from `scoped_assignment`. The create flow *offers* the matching SP/TL assignments, which are created explicitly, audited, and need `access.assign`.

## audit_event (append-only; ADR-0004)

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| seq | bigint | GENERATED ALWAYS AS IDENTITY, UNIQUE |
| occurred_at | timestamptz | NOT NULL DEFAULT now() |
| organization_id | uuid | NULL FK → organization (null only for installation-level events) |
| transformation_id | uuid | NULL (no FK, so the trail survives any future retention of the record) |
| actor_type | text | NOT NULL `IN ('user','service','system')` |
| actor_user_id | uuid | NULL; `CHECK (actor_type <> 'user' OR actor_user_id IS NOT NULL)` |
| on_behalf_of_user_id | uuid | NULL |
| action | text | NOT NULL, `CHECK (action ~ '^[a-z_]+\.[a-z_.]+$')` |
| record_type | text | NOT NULL |
| record_id | uuid | NOT NULL |
| prior_version | integer | NULL |
| new_version | integer | NULL; `CHECK (prior_version IS NULL OR new_version IS NULL OR new_version = prior_version + 1)` |
| reason | text | NULL |
| request_id | text | NULL |
| source | text | NOT NULL `IN ('api','worker','cli','migration')` |
| changes | jsonb | NULL, `CHECK (changes IS NULL OR jsonb_typeof(changes) = 'object')` |

**Indexes:** `(transformation_id, seq DESC)`, `(record_type, record_id, seq DESC)`, `(organization_id, occurred_at DESC)`.

**Protection:**
- Trigger `audit_event_immutable` runs `BEFORE UPDATE OR DELETE` for each row and `BEFORE TRUNCATE` for each statement, and raises.
- Grants: `mth_app` gets `INSERT, SELECT` only.
- Integration tests prove that UPDATE, DELETE and TRUNCATE fail.

## outbox_event (ADR-0008)

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| seq | bigint | GENERATED ALWAYS AS IDENTITY, UNIQUE |
| organization_id | uuid | NOT NULL FK → organization |
| aggregate_type | text | NOT NULL |
| aggregate_id | uuid | NOT NULL |
| event_type | text | NOT NULL (e.g. `transformation.created`) |
| schema_version | integer | NOT NULL `CHECK (schema_version >= 1)` |
| payload | jsonb | NOT NULL, `jsonb_typeof = 'object'`; validated by the zod schema for (event_type, schema_version) before insert |
| idempotency_key | text | NOT NULL UNIQUE |
| created_at | timestamptz | NOT NULL DEFAULT now() |
| published_at | timestamptz | NULL |
| publish_attempts | integer | NOT NULL DEFAULT 0 |
| last_error | text | NULL |

**Indexes:** `(seq) WHERE published_at IS NULL`.

**Invariants:**
- Inserted in the same transaction as the business change.
- The payload never contains secrets, tokens or evidence bytes.

## processed_message (consumer idempotency ledger)

| Column | Type | Constraints |
|---|---|---|
| consumer | text | PK part (handler name) |
| idempotency_key | text | PK part |
| processed_at | timestamptz | NOT NULL DEFAULT now() |
| outcome | text | NOT NULL `IN ('done','skipped')` |

**Invariant:** the ledger row is inserted in the same transaction as the handler's effects.

## idempotency_record (HTTP Idempotency-Key, ADR-0007)

| Column | Type | Constraints |
|---|---|---|
| user_id | uuid | PK part, FK → app_user |
| key | text | PK part, 8–128 chars |
| request_hash | char(64) | NOT NULL (SHA-256 of method + path + canonical body) |
| response_status | integer | NOT NULL |
| response_body | jsonb | NOT NULL |
| created_at | timestamptz | NOT NULL DEFAULT now() |
| expires_at | timestamptz | NOT NULL (created_at + 24 h) |

**Invariants:**
- The same key with a different `request_hash` gives 422.
- Expired rows are purged by the worker (`mth_app` may `DELETE` expired rows).

## Views (read models)

The P1 migrations create three views, owned by `mth_owner`. `mth_app` has `SELECT` only. They store nothing: every row is derived from the base tables above at query time. `packages/db/src/schema.ts` lists them in `VIEW_NAMES`, and `packages/db/test/integration/catalogue.test.ts` pins both their columns and the fact that they are views.

### actor_display (migration 0001; owner module: identity)

| Column | Type | Source |
|---|---|---|
| user_id | uuid | `app_user.id` |
| display_name | text | `app_user.display_name` |

- **Purpose:** the only user attribute other modules may read. The audit module uses it to show actor names (`LEFT JOIN actor_display`), so no other module reads `app_user` directly (ADR-0002 module boundaries).
- **Source:** `SELECT id AS user_id, display_name FROM app_user`. One row per user, including disabled users, so historical audit events keep their actor name.

### business_unit_closure (migration 0001; owner module: organization)

| Column | Type | Meaning |
|---|---|---|
| ancestor_id | uuid | a business unit |
| descendant_id | uuid | the ancestor itself (depth 0) or a unit below it |
| organization_id | uuid | the descendant's organization |
| depth | integer | levels from ancestor to descendant (0 = same unit) |

- **Purpose:** the business-unit hierarchy as (ancestor, descendant) pairs. The policy function (ADR-0006) uses it to resolve a target's BU ancestry and to compile downward-inheriting grants into SQL list filters (`access/policy.ts`). The organization module uses it for the API cycle check and the subtree height.
- **Source:** a `WITH RECURSIVE` over `business_unit.parent_business_unit_id`, seeded with every unit at depth 0. Recursion stops at `depth < 10`, so the view returns depths 0–10 and cannot loop even on corrupt data. The hierarchy invariant (no cycles, at most 10 levels) is enforced on `business_unit` itself (see above and migration 0009), so for valid data the cap never truncates a result.

### scope_node (migration 0002; owner module: access)

| Column | Type | Meaning |
|---|---|---|
| scope_type | text | `organization`, `business_unit` or `transformation` |
| scope_id | uuid | id of the node at that level |
| organization_id | uuid | the node's organization |
| business_unit_id | uuid NULL | the node's business unit: NULL for an organization, the unit itself for a BU, the owning BU for a transformation |
| transformation_id | uuid NULL | the transformation id for a transformation node; otherwise NULL |

- **Purpose:** one row for every scope node that a `scoped_assignment` can point at in P1. The policy function and the assignment service resolve `(scope_type, scope_id)` to the node's position in the hierarchy (organization → business unit → transformation) through it.
- **Source:** `UNION ALL` of `organization`, `business_unit` and `transformation`. Later stages add portfolio, workstream and other levels with a forward migration.

## pg-boss schema (`pgboss.*`)

- Owned, created and migrated by pg-boss 11 itself (ADR-0008), installed by `mth-db migrate` as `mth_owner`.
- `mth_app` receives the grants pg-boss documents for a non-owner runtime role.
- The tables are not described here; pg-boss's own documentation applies. These are the P1 "job tables as required by the queue choice".

## Validation rules summary (REQ-S19-004)

| Layer | What it checks |
|---|---|
| Database | Type, NOT NULL, CHECK, FK and UNIQUE constraints above, plus the BU hierarchy trigger (no cycles, at most 10 levels; migration 0009). These are the last line of defence. |
| API (`@mth/shared/schemas`) | Shapes, lengths, formats and the mode/entry-phase rule |
| Service | Existence and scope of referenced IDs, status transitions, archived read-only, BU in the same organization, no BU cycles, SoD |

---

# P2 tables (migrations 0010–0018)

- **Task:** T-DG2-ARCH-01 / T-DG2-ARCH-01B (solution-architect), 2026-10-02.
- **Generated from the migrated database** (PostgreSQL 16.13, `information_schema`/`pg_catalog` after `mth-db migrate` 0001→0018), so every column, constraint, index, trigger and grant below is exactly what 0010–0018 build. Constraint text is `pg_get_constraintdef` with `::text` casts removed for readability.
- **Governed by:** ADR-0015 (decisions, product gates), ADR-0016 (registers, record guards, instantiation), ADR-0017 (charter), ADR-0018 (evidence), ADR-0019 (decimal, unquantified, Unknown) and ADR-0020 (roles).

## P2 global rules (in addition to the global rules above)

| Rule | Detail |
|---|---|
| Record guards (0010, ADR-0016) | `<t>_row_guard`: insert at version 1 with the transformation's organization; immutable identity columns; version steps by exactly 1. `<t>_audit_required` (deferred): an `audit_event` (record_type = table, record_id, new_version) must exist at COMMIT. |
| Append-only | `charter_version`, `evidence_content`, `gate_submission_criterion`, `gate_decision`: UPDATE/DELETE/TRUNCATE raise even for the owner. |
| Same-transformation references | Child → parent references use composite FKs `(transformation_id, x_id) → x(transformation_id, id)`. Polymorphic `(record_type, record_id)` references use `p2_record_ref_guard`. |
| No DELETE | `mth_app` has no DELETE on any P2 table. Business records are archived (`status`, `archived_at`, `archived_by`, `archive_reason`, all-or-nothing CHECK). |
| Business dates | `date` columns are `YYYY-MM-DD` strings in TypeScript (`pool.ts` OID 1082 parser) and `BusinessDate` in the API. |
| Money and quantities | `numeric(20,4)` (money) and `numeric(24,6)` (KPI values), carried as decimal strings and handled with decimal.js. NULL means Unknown, never 0 (ADR-0019). |
| Seeds | Methodology catalogue rows use fixed literal UUIDs `01920002-…`. Source text is verbatim from `docs/source/playbook.md`; the Arabic is a provisional translation awaiting linguistic review. |
| Starter structure | `p2_instantiate_transformation()` creates the methodology pin, the 6 T01 rows, the 10 TOM canvas cells and the 6 gate instances, each with its audit event (0018; called by `POST /transformations`; backfilled for existing rows). |

## methodology_version

- **Purpose:** Immutable published methodology versions (ADR-0014). P2 seeds the playbook v1.0 version.
- **Migration:** `0011_p2_methodology_catalogue.sql`. **API module:** `methodology`. **Who writes:** ADM_METHOD (publish, later stages); seeded. **Lifecycle:** draft → published → retired; published definition immutable.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| key | text | NOT NULL |  | `CHECK ((key ~ '^[a-z][a-z0-9_-]{0,63}$'))` |
| version_no | integer | NOT NULL |  | `CHECK ((version_no >= 1))` |
| status | text | NOT NULL | `'draft'` | `CHECK ((status = ANY (ARRAY['draft', 'published', 'retired'])))` |
| title_en | text | NOT NULL |  | `CHECK (((char_length(title_en) >= 1) AND (char_length(title_en) <= 200)))` |
| title_ar | text | NOT NULL |  | `CHECK (((char_length(title_ar) >= 1) AND (char_length(title_ar) <= 200)))` |
| source_document | text | NOT NULL |  | `CHECK (((char_length(source_document) >= 1) AND (char_length(source_document) <= 500)))` |
| source_sha256 | character(64) | NULL |  | `CHECK (((source_sha256 IS NULL) OR (source_sha256 ~ '^[0-9a-f]{64}$')))` |
| definition | jsonb | NOT NULL |  | `CHECK ((jsonb_typeof(definition) = 'object'))` |
| content_sha256 | character(64) | NOT NULL |  | `CHECK ((content_sha256 ~ '^[0-9a-f]{64}$'))` |
| published_at | timestamp with time zone | NULL |  |  |
| published_by | uuid | NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `methodology_version_key_no_key` (UNIQUE): `UNIQUE (key, version_no)`
- `methodology_version_published_complete` (CHECK): `CHECK (((status = 'draft') = (published_at IS NULL)))`

**Triggers:**

- `methodology_version_published_immutable`: BEFORE UPDATE FOR EACH ROW → `methodology_version_published_immutable()`

## transformation_config_pin

- **Purpose:** Configuration version a transformation is pinned to (ADR-0014). P2: kind = methodology.
- **Migration:** `0011_p2_methodology_catalogue.sql`. **API module:** `methodology`. **Who writes:** system (instantiation). **Lifecycle:** —.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| kind | text | NOT NULL |  | `CHECK ((kind = 'methodology'))` |
| methodology_version_id | uuid | NOT NULL |  | FK → methodology_version(id) |
| pinned_at | timestamp with time zone | NOT NULL | `now()` |  |
| pinned_by | uuid | NOT NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `transformation_config_pin_kind_key` (UNIQUE): `UNIQUE (transformation_id, kind)`

**Triggers:**

- `transformation_config_pin_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `transformation_config_pin_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## diagnostic_dimension

- **Purpose:** T01 dimensions (B0031): Financial, Customer, Process, People / Org, Technology, Data.
- **Migration:** `0011_p2_methodology_catalogue.sql`. **API module:** `methodology`. **Who writes:** seed (read-only). **Lifecycle:** active / retired.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| code | text | NOT NULL |  | `CHECK ((code ~ '^[a-z][a-z0-9_]{0,47}$'))`; UNIQUE (`diagnostic_dimension_code_key`) |
| methodology_version_id | uuid | NOT NULL |  | FK → methodology_version(id) |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 99)))`; UNIQUE (`diagnostic_dimension_ordinal_key`) |
| source_label | text | NOT NULL |  | `CHECK (((char_length(source_label) >= 1) AND (char_length(source_label) <= 100)))` |
| label_en | text | NOT NULL |  | `CHECK (((char_length(label_en) >= 1) AND (char_length(label_en) <= 200)))` |
| label_ar | text | NOT NULL |  | `CHECK (((char_length(label_ar) >= 1) AND (char_length(label_ar) <= 200)))` |
| evidence_hint_en | text | NOT NULL |  | `CHECK (((char_length(evidence_hint_en) >= 1) AND (char_length(evidence_hint_en) <= 200)))` |
| evidence_hint_ar | text | NOT NULL |  | `CHECK (((char_length(evidence_hint_ar) >= 1) AND (char_length(evidence_hint_ar) <= 200)))` |
| impact_hint_en | text | NOT NULL |  | `CHECK (((char_length(impact_hint_en) >= 1) AND (char_length(impact_hint_en) <= 200)))` |
| impact_hint_ar | text | NOT NULL |  | `CHECK (((char_length(impact_hint_ar) >= 1) AND (char_length(impact_hint_ar) <= 200)))` |
| is_source_seeded | boolean | NOT NULL | `true` |  |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'retired'])))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

## diagnostic_workstream

- **Purpose:** The six Diagnose workstreams with key questions and typical outputs (B0029).
- **Migration:** `0011_p2_methodology_catalogue.sql`. **API module:** `methodology`. **Who writes:** seed (read-only). **Lifecycle:** active / retired.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| code | text | NOT NULL |  | `CHECK ((code ~ '^[a-z][a-z0-9_]{0,47}$'))`; UNIQUE (`diagnostic_workstream_code_key`) |
| methodology_version_id | uuid | NOT NULL |  | FK → methodology_version(id) |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 99)))`; UNIQUE (`diagnostic_workstream_ordinal_key`) |
| source_name_en | text | NOT NULL |  | `CHECK (((char_length(source_name_en) >= 1) AND (char_length(source_name_en) <= 100)))` |
| name_ar | text | NOT NULL |  | `CHECK (((char_length(name_ar) >= 1) AND (char_length(name_ar) <= 200)))` |
| source_key_questions_en | text | NOT NULL |  | `CHECK (((char_length(source_key_questions_en) >= 1) AND (char_length(source_key_questions_en) <= 1000)))` |
| key_questions_ar | text | NOT NULL |  | `CHECK (((char_length(key_questions_ar) >= 1) AND (char_length(key_questions_ar) <= 1000)))` |
| source_typical_outputs_en | text | NOT NULL |  | `CHECK (((char_length(source_typical_outputs_en) >= 1) AND (char_length(source_typical_outputs_en) <= 1000)))` |
| typical_outputs_ar | text | NOT NULL |  | `CHECK (((char_length(typical_outputs_ar) >= 1) AND (char_length(typical_outputs_ar) <= 1000)))` |
| source_ref | text | NOT NULL |  | `CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 50)))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'retired'])))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

## tom_dimension

- **Purpose:** The ten TOM dimensions with design questions (B0056) and canvas boxes/prompts (B0062).
- **Migration:** `0011_p2_methodology_catalogue.sql`. **API module:** `methodology`. **Who writes:** seed; ADM_METHOD edits labels only. **Lifecycle:** —.
- **`mth_app` privileges:** SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| code | text | NOT NULL |  | `CHECK ((code ~ '^[a-z][a-z0-9_]{0,47}$'))`; UNIQUE (`tom_dimension_code_key`) |
| methodology_version_id | uuid | NOT NULL |  | FK → methodology_version(id) |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 10)))`; UNIQUE (`tom_dimension_ordinal_key`) |
| source_name_en | text | NOT NULL |  | `CHECK (((char_length(source_name_en) >= 1) AND (char_length(source_name_en) <= 100)))` |
| source_design_question_en | text | NOT NULL |  | `CHECK (((char_length(source_design_question_en) >= 1) AND (char_length(source_design_question_en) <= 500)))` |
| source_canvas_box_en | text | NOT NULL |  | `CHECK (((char_length(source_canvas_box_en) >= 1) AND (char_length(source_canvas_box_en) <= 100)))` |
| source_canvas_prompt_en | text | NOT NULL |  | `CHECK (((char_length(source_canvas_prompt_en) >= 1) AND (char_length(source_canvas_prompt_en) <= 500)))` |
| label_en | text | NOT NULL |  | `CHECK (((char_length(label_en) >= 1) AND (char_length(label_en) <= 200)))` |
| label_ar | text | NOT NULL |  | `CHECK (((char_length(label_ar) >= 1) AND (char_length(label_ar) <= 200)))` |
| design_question_ar | text | NOT NULL |  | `CHECK (((char_length(design_question_ar) >= 1) AND (char_length(design_question_ar) <= 500)))` |
| canvas_box_ar | text | NOT NULL |  | `CHECK (((char_length(canvas_box_ar) >= 1) AND (char_length(canvas_box_ar) <= 200)))` |
| canvas_prompt_ar | text | NOT NULL |  | `CHECK (((char_length(canvas_prompt_ar) >= 1) AND (char_length(canvas_prompt_ar) <= 500)))` |
| source_ref | text | NOT NULL |  | `CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 50)))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Triggers:**

- `tom_dimension_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `tom_dimension_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`
- `tom_dimension_source_immutable`: BEFORE UPDATE FOR EACH ROW → `tom_dimension_source_immutable()`

## gate_definition

- **Purpose:** Product gates G1-G6 (B0023): decision question, evidence required, default approver.
- **Migration:** `0011_p2_methodology_catalogue.sql`. **API module:** `workflows`. **Who writes:** seed (read-only). **Lifecycle:** —.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| code | text | NOT NULL |  | `CHECK ((code ~ '^G[1-6]$'))`; UNIQUE (`gate_definition_code_key`) |
| methodology_version_id | uuid | NOT NULL |  | FK → methodology_version(id) |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 6)))`; UNIQUE (`gate_definition_ordinal_key`) |
| phase | text | NOT NULL |  | `CHECK ((phase = ANY (ARRAY['diagnose', 'define', 'design', 'mobilize', 'transform', 'realize'])))` |
| next_phase | text | NULL |  | `CHECK (((next_phase IS NULL) OR (next_phase = ANY (ARRAY['diagnose', 'define', 'design', 'mobilize', 'transform', 'realize']))))` |
| source_name_en | text | NOT NULL |  | `CHECK (((char_length(source_name_en) >= 1) AND (char_length(source_name_en) <= 100)))` |
| name_ar | text | NOT NULL |  | `CHECK (((char_length(name_ar) >= 1) AND (char_length(name_ar) <= 200)))` |
| source_decision_question_en | text | NOT NULL |  | `CHECK (((char_length(source_decision_question_en) >= 1) AND (char_length(source_decision_question_en) <= 500)))` |
| decision_question_ar | text | NOT NULL |  | `CHECK (((char_length(decision_question_ar) >= 1) AND (char_length(decision_question_ar) <= 500)))` |
| source_evidence_required_en | text | NOT NULL |  | `CHECK (((char_length(source_evidence_required_en) >= 1) AND (char_length(source_evidence_required_en) <= 500)))` |
| evidence_required_ar | text | NOT NULL |  | `CHECK (((char_length(evidence_required_ar) >= 1) AND (char_length(evidence_required_ar) <= 500)))` |
| default_approver_role_code | text | NOT NULL |  | FK → role(code) |
| allowed_approver_role_codes | text[] | NOT NULL |  |  |
| submission_enabled | boolean | NOT NULL | `false` |  |
| source_ref | text | NOT NULL |  | `CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 50)))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `gate_definition_approver_allowed` (CHECK): `CHECK ((((cardinality(allowed_approver_role_codes) >= 1) AND (cardinality(allowed_approver_role_codes) <= 5)) AND (default_approver_role_code = ANY (allowed_approver_role_codes))))`

## gate_criterion_definition

- **Purpose:** Required outputs (criteria) per gate, evaluated by the workflows module (ADR-0015).
- **Migration:** `0011_p2_methodology_catalogue.sql`. **API module:** `workflows`. **Who writes:** seed (read-only). **Lifecycle:** —.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| gate_definition_id | uuid | NOT NULL |  | FK → gate_definition(id) |
| key | text | NOT NULL |  | `CHECK ((key ~ '^g[1-6]\.[a-z_]{1,48}$'))`; UNIQUE (`gate_criterion_definition_key_key`) |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 20)))` |
| label_en | text | NOT NULL |  | `CHECK (((char_length(label_en) >= 1) AND (char_length(label_en) <= 200)))` |
| label_ar | text | NOT NULL |  | `CHECK (((char_length(label_ar) >= 1) AND (char_length(label_ar) <= 200)))` |
| description_en | text | NOT NULL |  | `CHECK (((char_length(description_en) >= 1) AND (char_length(description_en) <= 1000)))` |
| description_ar | text | NOT NULL |  | `CHECK (((char_length(description_ar) >= 1) AND (char_length(description_ar) <= 1000)))` |
| mandatory | boolean | NOT NULL | `true` |  |
| requires_verified_evidence | boolean | NOT NULL | `false` |  |
| source_ref | text | NOT NULL |  | `CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 100)))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `gate_criterion_definition_ordinal_key` (UNIQUE): `UNIQUE (gate_definition_id, ordinal)`

## charter_scope_check_definition

- **Purpose:** The five charter scope sanity checks, verbatim (B0038-B0043).
- **Migration:** `0011_p2_methodology_catalogue.sql`. **API module:** `methodology`. **Who writes:** seed (read-only). **Lifecycle:** —.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| code | text | NOT NULL |  | `CHECK ((code ~ '^[a-z][a-z0-9_]{0,47}$'))`; UNIQUE (`charter_scope_check_definition_code_key`) |
| methodology_version_id | uuid | NOT NULL |  | FK → methodology_version(id) |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 5)))`; UNIQUE (`charter_scope_check_definition_ordinal_key`) |
| source_question_en | text | NOT NULL |  | `CHECK (((char_length(source_question_en) >= 1) AND (char_length(source_question_en) <= 500)))` |
| question_ar | text | NOT NULL |  | `CHECK (((char_length(question_ar) >= 1) AND (char_length(question_ar) <= 500)))` |
| source_ref | text | NOT NULL |  | `CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 50)))` |
| system_precheck | text | NOT NULL |  | `CHECK ((system_precheck = ANY (ARRAY['none', 'scope_items_traced', 'exclusions_present', 'baseline_measurable', 'executive_decisions_visible'])))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

## good_outcome_criterion

- **Purpose:** The good outcome test criteria (B0051).
- **Migration:** `0011_p2_methodology_catalogue.sql`. **API module:** `methodology`. **Who writes:** seed (read-only). **Lifecycle:** —.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| code | text | NOT NULL |  | `CHECK ((code ~ '^[a-z][a-z0-9_]{0,47}$'))`; UNIQUE (`good_outcome_criterion_code_key`) |
| methodology_version_id | uuid | NOT NULL |  | FK → methodology_version(id) |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 5)))`; UNIQUE (`good_outcome_criterion_ordinal_key`) |
| source_label_en | text | NOT NULL |  | `CHECK (((char_length(source_label_en) >= 1) AND (char_length(source_label_en) <= 200)))` |
| label_ar | text | NOT NULL |  | `CHECK (((char_length(label_ar) >= 1) AND (char_length(label_ar) <= 200)))` |
| evaluation | text | NOT NULL |  | `CHECK ((evaluation = ANY (ARRAY['user_attested', 'system_kpi_linked', 'system_owner_set'])))` |
| source_ref | text | NOT NULL |  | `CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 50)))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

## evidence

- **Purpose:** Evidence repository item (§13, ADR-0010/0018): a stored file, a native note, an external link or a bare filename reference. Counts toward gates only when verified.
- **Migration:** `0012_p2_evidence.sql`. **API module:** `evidence`. **Who writes:** evidence.create (TL, BO, WL, FIN, TO, KDS, TD); review: evidence.review. **Lifecycle:** review: unverified → verified / rejected (new content → unverified); active → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| kind | text | NOT NULL |  | `CHECK ((kind = ANY (ARRAY['file', 'note', 'external_link', 'file_reference'])))` |
| title | text | NOT NULL |  | `CHECK (((char_length(title) >= 1) AND (char_length(title) <= 300)))` |
| description | text | NULL |  | `CHECK (((description IS NULL) OR ((char_length(description) >= 1) AND (char_length(description) <= 4000))))` |
| evidence_type | text | NOT NULL | `'document'` | `CHECK ((evidence_type = ANY (ARRAY['document', 'data_extract', 'analysis', 'interview', 'observation', 'system_report', 'other'])))` |
| source | text | NULL |  | `CHECK (((source IS NULL) OR ((char_length(source) >= 1) AND (char_length(source) <= 500))))` |
| owner_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| observation_start | date | NULL |  |  |
| observation_end | date | NULL |  |  |
| note_body | text | NULL |  | `CHECK (((note_body IS NULL) OR ((char_length(note_body) >= 1) AND (char_length(note_body) <= 20000))))` |
| url | text | NULL |  | `CHECK (((url IS NULL) OR ((url ~ '^https?://') AND (char_length(url) <= 2000))))` |
| file_name | text | NULL |  | `CHECK (((file_name IS NULL) OR ((char_length(file_name) >= 1) AND (char_length(file_name) <= 255))))` |
| current_content_id | uuid | NULL |  |  |
| review_status | text | NOT NULL | `'unverified'` | `CHECK ((review_status = ANY (ARRAY['unverified', 'verified', 'rejected'])))` |
| accessibility_status | text | NOT NULL | `'unchecked'` | `CHECK ((accessibility_status = ANY (ARRAY['unchecked', 'accessible', 'inaccessible'])))` |
| reviewed_content_id | uuid | NULL |  |  |
| content_authored_by | uuid | NULL |  | FK → app_user(id). Added by migration 0019. The user who authored the current note/URL text or uploaded the current content revision; NULL means "the creator". Used by the `evidence_review_separation` trigger so a reviewer cannot verify content they themselves authored (F-DG2-140, separation of duties beyond `reviewed_by <> created_by`). |
| reviewed_by | uuid | NULL |  | FK → app_user(id) |
| reviewed_at | timestamp with time zone | NULL |  |  |
| review_note | text | NULL |  | `CHECK (((review_note IS NULL) OR ((char_length(review_note) >= 1) AND (char_length(review_note) <= 2000))))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `evidence_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `evidence_current_content_fkey` (FK): `FOREIGN KEY (id, current_content_id) REFERENCES evidence_content(evidence_id, id)`
- `evidence_filename_never_verified` (CHECK): `CHECK (((kind <> 'file_reference') OR ((review_status <> 'verified') AND (accessibility_status <> 'accessible'))))`
- `evidence_kind_payload` (CHECK): `CHECK ((((kind = 'note') AND (note_body IS NOT NULL) AND (url IS NULL) AND (current_content_id IS NULL)) OR ((kind = 'external_link') AND (url IS NOT NULL) AND (note_body IS NULL) AND (current_content_id IS NULL)) OR ((kind = 'file') AND (url IS NULL) AND (note_body IS NULL)) OR ((kind = 'file_reference') AND (file_name IS NOT NULL) AND (url IS NULL) AND (note_body IS NULL) AND (current_content_id IS NULL))))`
- `evidence_observation_range` (CHECK): `CHECK (((observation_end IS NULL) OR (observation_start IS NULL) OR (observation_end >= observation_start)))`
- `evidence_review_complete` (CHECK): `CHECK ((((review_status = 'unverified') = (reviewed_by IS NULL)) AND ((reviewed_by IS NULL) = (reviewed_at IS NULL))))`
- `evidence_reviewed_content_fkey` (FK): `FOREIGN KEY (id, reviewed_content_id) REFERENCES evidence_content(evidence_id, id)`
- `evidence_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`
- `evidence_verified_rule` (CHECK): `CHECK (((review_status <> 'verified') OR ((accessibility_status = 'accessible') AND (reviewed_by <> created_by) AND ((kind <> 'file') OR ((current_content_id IS NOT NULL) AND (reviewed_content_id = current_content_id))))))`

**Indexes:**

- `evidence_review_idx`: `(transformation_id, review_status) WHERE (status = 'active'::text)`
- `evidence_transformation_updated_idx`: `(transformation_id, updated_at DESC, id DESC)`

**Triggers:**

- `evidence_review_separation` (migration 0019): on a review that sets `review_status = 'verified'`, rejects it when the reviewer is the evidence creator, the author of the current note/URL text, or the uploader of the current content revision (`content_authored_by`). Defence-in-depth for the API separation-of-duties rule (F-DG2-140); pre-0019 rows carry `content_authored_by = NULL` (= the creator) and are guarded on any new review.

**Triggers:**

- `evidence_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `evidence_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## evidence_content

- **Purpose:** Append-only stored content revisions of a file evidence item (key + SHA-256 in the EvidenceStore).
- **Migration:** `0012_p2_evidence.sql`. **API module:** `evidence`. **Who writes:** evidence.create. **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| evidence_id | uuid | NOT NULL |  |  |
| revision | integer | NOT NULL |  | `CHECK ((revision >= 1))` |
| storage_key | text | NOT NULL |  | `CHECK ((storage_key ~ '^[A-Za-z0-9/_.-]{1,200}$'))`; UNIQUE (`evidence_content_storage_key_key`) |
| sha256 | character(64) | NOT NULL |  | `CHECK ((sha256 ~ '^[0-9a-f]{64}$'))` |
| size_bytes | bigint | NOT NULL |  | `CHECK (((size_bytes >= 0) AND (size_bytes <= 1073741824)))` |
| content_type | text | NOT NULL |  | `CHECK (((char_length(content_type) >= 1) AND (char_length(content_type) <= 200)))` |
| file_name | text | NOT NULL |  | `CHECK (((char_length(file_name) >= 1) AND (char_length(file_name) <= 255)))` |
| uploaded_by | uuid | NOT NULL |  | FK → app_user(id) |
| uploaded_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `evidence_content_evidence_id_fkey` (FK): `FOREIGN KEY (transformation_id, evidence_id) REFERENCES evidence(transformation_id, id)`
- `evidence_content_evidence_id_id_key` (UNIQUE): `UNIQUE (evidence_id, id)`
- `evidence_content_revision_key` (UNIQUE): `UNIQUE (evidence_id, revision)`

**Triggers:**

- `evidence_content_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `evidence_content_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `evidence_content_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## evidence_link

- **Purpose:** Links an evidence item to any P2 record of the same transformation (polymorphic, guarded).
- **Migration:** `0012_p2_evidence.sql`. **API module:** `evidence`. **Who writes:** evidence.create. **Lifecycle:** active → removed.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| evidence_id | uuid | NOT NULL |  |  |
| record_type | text | NOT NULL |  | `CHECK ((record_type = ANY (ARRAY['charter', 'north_star', 'strategic_guardrail', 'outcome', 'kpi_definition', 'baseline', 'outcome_kpi', 'value_pool', 'diagnostic_item', 'diagnostic_finding', 'diagnostic_workstream_output', 'tom_canvas_cell', 'tom_gap', 'capability', 'journey', 'journey_pain_point', 'decision', 'dependency', 'tom_workshop', 'action_item'])))` |
| record_id | uuid | NOT NULL |  |  |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'removed'])))` |
| removed_at | timestamp with time zone | NULL |  |  |
| removed_by | uuid | NULL |  | FK → app_user(id) |
| remove_reason | text | NULL |  | `CHECK (((remove_reason IS NULL) OR ((char_length(remove_reason) >= 3) AND (char_length(remove_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `evidence_link_evidence_id_fkey` (FK): `FOREIGN KEY (transformation_id, evidence_id) REFERENCES evidence(transformation_id, id)`
- `evidence_link_removal_complete` (CHECK): `CHECK ((((status = 'removed') = (removed_at IS NOT NULL)) AND ((removed_at IS NULL) = (removed_by IS NULL)) AND ((removed_at IS NULL) = (remove_reason IS NULL))))`

**Indexes:**

- `evidence_link_active_key`: `UNIQUE (evidence_id, record_type, record_id) WHERE (status = 'active'::text)`
- `evidence_link_record_idx`: `(record_type, record_id) WHERE (status = 'active'::text)`

**Triggers:**

- `evidence_link_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `evidence_link_record_ref`: BEFORE INSERT FOR EACH ROW → `p2_record_ref_guard()`
- `evidence_link_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## north_star

- **Purpose:** The transformation's North Star: one concise sentence; exactly one current (REQ-PB-033).
- **Migration:** `0013_p2_direction_charter.sql`. **API module:** `transformations`. **Who writes:** north_star.edit (TL). **Lifecycle:** current → superseded (one current per transformation).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| statement | text | NOT NULL |  | `CHECK ((((char_length(statement) >= 1) AND (char_length(statement) <= 300)) AND (statement !~ '[\r\n]')))` |
| status | text | NOT NULL | `'current'` | `CHECK ((status = ANY (ARRAY['current', 'superseded'])))` |
| superseded_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `north_star_superseded_complete` (CHECK): `CHECK (((status = 'superseded') = (superseded_at IS NOT NULL)))`
- `north_star_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `north_star_one_current_key`: `UNIQUE (transformation_id) WHERE (status = 'current'::text)`

**Triggers:**

- `north_star_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `north_star_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## strategic_guardrail

- **Purpose:** Strategic guardrails: non-negotiables (B0035, REQ-PB-037); G2 evidence.
- **Migration:** `0013_p2_direction_charter.sql`. **API module:** `transformations`. **Who writes:** charter.edit (TL, TO). **Lifecycle:** active → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| title | text | NOT NULL |  | `CHECK (((char_length(title) >= 1) AND (char_length(title) <= 200)))` |
| category | text | NOT NULL |  | `CHECK ((category = ANY (ARRAY['regulatory', 'cx', 'capex', 'risk', 'brand', 'other'])))` |
| statement | text | NOT NULL |  | `CHECK (((char_length(statement) >= 1) AND (char_length(statement) <= 4000)))` |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `strategic_guardrail_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `strategic_guardrail_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `strategic_guardrail_transformation_updated_idx`: `(transformation_id, updated_at DESC, id DESC)`

**Triggers:**

- `strategic_guardrail_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `strategic_guardrail_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## outcome

- **Purpose:** Strategic outcomes under the North Star, as a tree (B0048); top outcomes are the charter's 3-5.
- **Migration:** `0013_p2_direction_charter.sql`. **API module:** `transformations`. **Who writes:** outcome.edit (TL, BO, KDS). **Lifecycle:** draft → active → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| parent_outcome_id | uuid | NULL |  |  |
| statement | text | NOT NULL |  | `CHECK (((char_length(statement) >= 1) AND (char_length(statement) <= 500)))` |
| description | text | NULL |  | `CHECK (((description IS NULL) OR ((char_length(description) >= 1) AND (char_length(description) <= 4000))))` |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| is_top_outcome | boolean | NOT NULL | `false` |  |
| top_rank | smallint | NULL |  | `CHECK (((top_rank IS NULL) OR ((top_rank >= 1) AND (top_rank <= 99))))` |
| specific_confirmed | boolean | NULL |  |  |
| strategically_relevant_confirmed | boolean | NULL |  |  |
| causal_chain | text | NULL |  | `CHECK (((causal_chain IS NULL) OR ((char_length(causal_chain) >= 1) AND (char_length(causal_chain) <= 4000))))` |
| status | text | NOT NULL | `'draft'` | `CHECK ((status = ANY (ARRAY['draft', 'active', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `outcome_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `outcome_not_own_parent` (CHECK): `CHECK ((parent_outcome_id IS DISTINCT FROM id))`
- `outcome_parent_outcome_id_fkey` (FK): `FOREIGN KEY (transformation_id, parent_outcome_id) REFERENCES outcome(transformation_id, id)`
- `outcome_rank_only_top` (CHECK): `CHECK (((top_rank IS NULL) OR is_top_outcome))`
- `outcome_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `outcome_parent_idx`: `(parent_outcome_id) WHERE (parent_outcome_id IS NOT NULL)`
- `outcome_transformation_updated_idx`: `(transformation_id, updated_at DESC, id DESC)`

**Triggers:**

- `outcome_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `outcome_hierarchy_guard`: AFTER INSERT OR UPDATE OF parent_outcome_id FOR EACH ROW → `outcome_hierarchy_guard()`
- `outcome_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## charter

- **Purpose:** Transformation Charter: first-class record with the 14 source fields (B0035), the thesis (B0037) and the five scope sanity check responses (B0038-B0043). Current state; every saved change appends a charter_version.
- **Migration:** `0013_p2_direction_charter.sql`. **API module:** `transformations`. **Who writes:** charter.edit (TL, TO). **Lifecycle:** one per transformation; each save = version + 1 + snapshot.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id); UNIQUE (`charter_transformation_id_key`) |
| transformation_name | text | NULL |  | `CHECK (((transformation_name IS NULL) OR ((char_length(transformation_name) >= 1) AND (char_length(transformation_name) <= 200))))` |
| executive_sponsor_user_id | uuid | NULL |  | FK → app_user(id) |
| transformation_lead_user_id | uuid | NULL |  | FK → app_user(id) |
| case_for_change | text | NULL |  | `CHECK (((case_for_change IS NULL) OR ((char_length(case_for_change) >= 1) AND (char_length(case_for_change) <= 20000))))` |
| north_star_id | uuid | NULL |  |  |
| in_scope | text | NULL |  | `CHECK (((in_scope IS NULL) OR ((char_length(in_scope) >= 1) AND (char_length(in_scope) <= 20000))))` |
| out_of_scope | text | NULL |  | `CHECK (((out_of_scope IS NULL) OR ((char_length(out_of_scope) >= 1) AND (char_length(out_of_scope) <= 20000))))` |
| baseline_date | date | NULL |  |  |
| target_horizon_value | integer | NULL |  | `CHECK (((target_horizon_value IS NULL) OR ((target_horizon_value >= 1) AND (target_horizon_value <= 600))))` |
| target_horizon_unit | text | NULL |  | `CHECK (((target_horizon_unit IS NULL) OR (target_horizon_unit = ANY (ARRAY['months', 'quarters', 'years']))))` |
| governance_forum | text | NULL |  | `CHECK (((governance_forum IS NULL) OR ((char_length(governance_forum) >= 1) AND (char_length(governance_forum) <= 500))))` |
| decision_rights | text | NULL |  | `CHECK (((decision_rights IS NULL) OR ((char_length(decision_rights) >= 1) AND (char_length(decision_rights) <= 20000))))` |
| success_definition | text | NULL |  | `CHECK (((success_definition IS NULL) OR ((char_length(success_definition) >= 1) AND (char_length(success_definition) <= 20000))))` |
| thesis_change | text | NULL |  | `CHECK (((thesis_change IS NULL) OR ((char_length(thesis_change) >= 1) AND (char_length(thesis_change) <= 4000))))` |
| thesis_outcomes | text | NULL |  | `CHECK (((thesis_outcomes IS NULL) OR ((char_length(thesis_outcomes) >= 1) AND (char_length(thesis_outcomes) <= 4000))))` |
| thesis_benefits | text | NULL |  | `CHECK (((thesis_benefits IS NULL) OR ((char_length(thesis_benefits) >= 1) AND (char_length(thesis_benefits) <= 4000))))` |
| thesis_because | text | NULL |  | `CHECK (((thesis_because IS NULL) OR ((char_length(thesis_because) >= 1) AND (char_length(thesis_because) <= 8000))))` |
| sc_outcome_linkage | text | NULL |  | `CHECK (((sc_outcome_linkage IS NULL) OR (sc_outcome_linkage = ANY (ARRAY['yes', 'partly', 'no']))))` |
| sc_outcome_linkage_evidence | text | NULL |  | `CHECK (((sc_outcome_linkage_evidence IS NULL) OR ((char_length(sc_outcome_linkage_evidence) >= 1) AND (char_length(sc_outcome_linkage_evidence) <= 4000))))` |
| sc_problem_traceability | text | NULL |  | `CHECK (((sc_problem_traceability IS NULL) OR (sc_problem_traceability = ANY (ARRAY['yes', 'partly', 'no']))))` |
| sc_problem_traceability_evidence | text | NULL |  | `CHECK (((sc_problem_traceability_evidence IS NULL) OR ((char_length(sc_problem_traceability_evidence) >= 1) AND (char_length(sc_problem_traceability_evidence) <= 4000))))` |
| sc_exclusions_documented | text | NULL |  | `CHECK (((sc_exclusions_documented IS NULL) OR (sc_exclusions_documented = ANY (ARRAY['yes', 'partly', 'no']))))` |
| sc_exclusions_documented_evidence | text | NULL |  | `CHECK (((sc_exclusions_documented_evidence IS NULL) OR ((char_length(sc_exclusions_documented_evidence) >= 1) AND (char_length(sc_exclusions_documented_evidence) <= 4000))))` |
| sc_baseline_measurable | text | NULL |  | `CHECK (((sc_baseline_measurable IS NULL) OR (sc_baseline_measurable = ANY (ARRAY['yes', 'partly', 'no']))))` |
| sc_baseline_measurable_evidence | text | NULL |  | `CHECK (((sc_baseline_measurable_evidence IS NULL) OR ((char_length(sc_baseline_measurable_evidence) >= 1) AND (char_length(sc_baseline_measurable_evidence) <= 4000))))` |
| sc_executive_decisions_visible | text | NULL |  | `CHECK (((sc_executive_decisions_visible IS NULL) OR (sc_executive_decisions_visible = ANY (ARRAY['yes', 'partly', 'no']))))` |
| sc_executive_decisions_visible_evidence | text | NULL |  | `CHECK (((sc_executive_decisions_visible_evidence IS NULL) OR ((char_length(sc_executive_decisions_visible_evidence) >= 1) AND (char_length(sc_executive_decisions_visible_evidence) <= 4000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `charter_north_star_id_fkey` (FK): `FOREIGN KEY (transformation_id, north_star_id) REFERENCES north_star(transformation_id, id)`
- `charter_target_horizon_pair` (CHECK): `CHECK (((target_horizon_value IS NULL) = (target_horizon_unit IS NULL)))`
- `charter_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Triggers:**

- `charter_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `charter_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`
- `charter_version_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `charter_version_required()`

## charter_version

- **Purpose:** Immutable snapshot of the charter at each saved change (version_no = charter.version).
- **Migration:** `0013_p2_direction_charter.sql`. **API module:** `transformations`. **Who writes:** charter.edit (written with every charter save). **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| charter_id | uuid | NOT NULL |  |  |
| version_no | integer | NOT NULL |  | `CHECK ((version_no >= 1))` |
| transformation_name | text | NULL |  | `CHECK (((transformation_name IS NULL) OR ((char_length(transformation_name) >= 1) AND (char_length(transformation_name) <= 200))))` |
| executive_sponsor_user_id | uuid | NULL |  | FK → app_user(id) |
| transformation_lead_user_id | uuid | NULL |  | FK → app_user(id) |
| case_for_change | text | NULL |  | `CHECK (((case_for_change IS NULL) OR ((char_length(case_for_change) >= 1) AND (char_length(case_for_change) <= 20000))))` |
| north_star_id | uuid | NULL |  |  |
| in_scope | text | NULL |  | `CHECK (((in_scope IS NULL) OR ((char_length(in_scope) >= 1) AND (char_length(in_scope) <= 20000))))` |
| out_of_scope | text | NULL |  | `CHECK (((out_of_scope IS NULL) OR ((char_length(out_of_scope) >= 1) AND (char_length(out_of_scope) <= 20000))))` |
| baseline_date | date | NULL |  |  |
| target_horizon_value | integer | NULL |  | `CHECK (((target_horizon_value IS NULL) OR ((target_horizon_value >= 1) AND (target_horizon_value <= 600))))` |
| target_horizon_unit | text | NULL |  | `CHECK (((target_horizon_unit IS NULL) OR (target_horizon_unit = ANY (ARRAY['months', 'quarters', 'years']))))` |
| governance_forum | text | NULL |  | `CHECK (((governance_forum IS NULL) OR ((char_length(governance_forum) >= 1) AND (char_length(governance_forum) <= 500))))` |
| decision_rights | text | NULL |  | `CHECK (((decision_rights IS NULL) OR ((char_length(decision_rights) >= 1) AND (char_length(decision_rights) <= 20000))))` |
| success_definition | text | NULL |  | `CHECK (((success_definition IS NULL) OR ((char_length(success_definition) >= 1) AND (char_length(success_definition) <= 20000))))` |
| thesis_change | text | NULL |  | `CHECK (((thesis_change IS NULL) OR ((char_length(thesis_change) >= 1) AND (char_length(thesis_change) <= 4000))))` |
| thesis_outcomes | text | NULL |  | `CHECK (((thesis_outcomes IS NULL) OR ((char_length(thesis_outcomes) >= 1) AND (char_length(thesis_outcomes) <= 4000))))` |
| thesis_benefits | text | NULL |  | `CHECK (((thesis_benefits IS NULL) OR ((char_length(thesis_benefits) >= 1) AND (char_length(thesis_benefits) <= 4000))))` |
| thesis_because | text | NULL |  | `CHECK (((thesis_because IS NULL) OR ((char_length(thesis_because) >= 1) AND (char_length(thesis_because) <= 8000))))` |
| sc_outcome_linkage | text | NULL |  | `CHECK (((sc_outcome_linkage IS NULL) OR (sc_outcome_linkage = ANY (ARRAY['yes', 'partly', 'no']))))` |
| sc_outcome_linkage_evidence | text | NULL |  | `CHECK (((sc_outcome_linkage_evidence IS NULL) OR ((char_length(sc_outcome_linkage_evidence) >= 1) AND (char_length(sc_outcome_linkage_evidence) <= 4000))))` |
| sc_problem_traceability | text | NULL |  | `CHECK (((sc_problem_traceability IS NULL) OR (sc_problem_traceability = ANY (ARRAY['yes', 'partly', 'no']))))` |
| sc_problem_traceability_evidence | text | NULL |  | `CHECK (((sc_problem_traceability_evidence IS NULL) OR ((char_length(sc_problem_traceability_evidence) >= 1) AND (char_length(sc_problem_traceability_evidence) <= 4000))))` |
| sc_exclusions_documented | text | NULL |  | `CHECK (((sc_exclusions_documented IS NULL) OR (sc_exclusions_documented = ANY (ARRAY['yes', 'partly', 'no']))))` |
| sc_exclusions_documented_evidence | text | NULL |  | `CHECK (((sc_exclusions_documented_evidence IS NULL) OR ((char_length(sc_exclusions_documented_evidence) >= 1) AND (char_length(sc_exclusions_documented_evidence) <= 4000))))` |
| sc_baseline_measurable | text | NULL |  | `CHECK (((sc_baseline_measurable IS NULL) OR (sc_baseline_measurable = ANY (ARRAY['yes', 'partly', 'no']))))` |
| sc_baseline_measurable_evidence | text | NULL |  | `CHECK (((sc_baseline_measurable_evidence IS NULL) OR ((char_length(sc_baseline_measurable_evidence) >= 1) AND (char_length(sc_baseline_measurable_evidence) <= 4000))))` |
| sc_executive_decisions_visible | text | NULL |  | `CHECK (((sc_executive_decisions_visible IS NULL) OR (sc_executive_decisions_visible = ANY (ARRAY['yes', 'partly', 'no']))))` |
| sc_executive_decisions_visible_evidence | text | NULL |  | `CHECK (((sc_executive_decisions_visible_evidence IS NULL) OR ((char_length(sc_executive_decisions_visible_evidence) >= 1) AND (char_length(sc_executive_decisions_visible_evidence) <= 4000))))` |
| north_star_statement | text | NULL |  | `CHECK (((north_star_statement IS NULL) OR ((char_length(north_star_statement) >= 1) AND (char_length(north_star_statement) <= 300))))` |
| top_outcomes_snapshot | jsonb | NOT NULL | `'[]'` | `CHECK ((jsonb_typeof(top_outcomes_snapshot) = 'array'))` |
| guardrails_snapshot | jsonb | NOT NULL | `'[]'` | `CHECK ((jsonb_typeof(guardrails_snapshot) = 'array'))` |
| change_summary | text | NULL |  | `CHECK (((change_summary IS NULL) OR ((char_length(change_summary) >= 1) AND (char_length(change_summary) <= 1000))))` |
| saved_by | uuid | NOT NULL |  | FK → app_user(id) |
| saved_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `charter_version_charter_id_fkey` (FK): `FOREIGN KEY (transformation_id, charter_id) REFERENCES charter(transformation_id, id)`
- `charter_version_no_key` (UNIQUE): `UNIQUE (charter_id, version_no)`
- `charter_version_target_horizon_pair` (CHECK): `CHECK (((target_horizon_value IS NULL) = (target_horizon_unit IS NULL)))`

**Triggers:**

- `charter_version_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `charter_version_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `charter_version_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## kpi_definition

- **Purpose:** KPI dictionary entry (P2 subset of REQ-S07-001; P4 adds versions, formulas and actuals).
- **Migration:** `0014_p2_kpi_baseline_value_pool.sql`. **API module:** `kpi`. **Who writes:** kpi_definition.edit (TL, KDS). **Lifecycle:** draft → active → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| name | text | NOT NULL |  | `CHECK (((char_length(name) >= 1) AND (char_length(name) <= 200)))` |
| description | text | NULL |  | `CHECK (((description IS NULL) OR ((char_length(description) >= 1) AND (char_length(description) <= 4000))))` |
| business_purpose | text | NULL |  | `CHECK (((business_purpose IS NULL) OR ((char_length(business_purpose) >= 1) AND (char_length(business_purpose) <= 4000))))` |
| unit_kind | text | NOT NULL |  | `CHECK ((unit_kind = ANY (ARRAY['currency', 'percentage', 'count', 'ratio', 'duration', 'score', 'other'])))` |
| unit_label | text | NULL |  | `CHECK (((unit_label IS NULL) OR ((char_length(unit_label) >= 1) AND (char_length(unit_label) <= 50))))` |
| currency | character(3) | NULL |  | `CHECK (((currency IS NULL) OR (currency ~ '^[A-Z]{3}$')))` |
| polarity | text | NOT NULL |  | `CHECK ((polarity = ANY (ARRAY['higher_is_better', 'lower_is_better', 'within_band'])))` |
| frequency | text | NOT NULL | `'monthly'` | `CHECK ((frequency = ANY (ARRAY['daily', 'weekly', 'monthly', 'quarterly', 'annual', 'ad_hoc'])))` |
| is_leading | boolean | NOT NULL | `false` |  |
| data_source | text | NULL |  | `CHECK (((data_source IS NULL) OR ((char_length(data_source) >= 1) AND (char_length(data_source) <= 500))))` |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| steward_user_id | uuid | NULL |  | FK → app_user(id) |
| status | text | NOT NULL | `'draft'` | `CHECK ((status = ANY (ARRAY['draft', 'active', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `kpi_definition_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `kpi_definition_currency_unit` (CHECK): `CHECK (((unit_kind = 'currency') = (currency IS NOT NULL)))`
- `kpi_definition_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `kpi_definition_name_key`: `UNIQUE (transformation_id, lower(name)) WHERE (status <> 'archived'::text)`
- `kpi_definition_transformation_updated_idx`: `(transformation_id, updated_at DESC, id DESC)`

**Triggers:**

- `kpi_definition_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `kpi_definition_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## baseline

- **Purpose:** Baseline registry entry: metric, value, unit, source, baseline date (REQ-PB-027). Missing value = Unknown.
- **Migration:** `0014_p2_kpi_baseline_value_pool.sql`. **API module:** `kpi`. **Who writes:** baseline.edit (TL, KDS); validation: finance.validate (FIN). **Lifecycle:** validation: unvalidated → validated / rejected; active → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| metric | text | NOT NULL |  | `CHECK (((char_length(metric) >= 1) AND (char_length(metric) <= 300)))` |
| kpi_definition_id | uuid | NULL |  |  |
| value | numeric(24,6) | NULL |  |  |
| unit | text | NOT NULL |  | `CHECK (((char_length(unit) >= 1) AND (char_length(unit) <= 50)))` |
| currency | character(3) | NULL |  | `CHECK (((currency IS NULL) OR (currency ~ '^[A-Z]{3}$')))` |
| source | text | NULL |  | `CHECK (((source IS NULL) OR ((char_length(source) >= 1) AND (char_length(source) <= 1000))))` |
| baseline_date | date | NULL |  |  |
| scope | text | NOT NULL |  | `CHECK ((scope = ANY (ARRAY['revenue', 'cost', 'customer', 'operational', 'capability'])))` |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| validation_status | text | NOT NULL | `'unvalidated'` | `CHECK ((validation_status = ANY (ARRAY['unvalidated', 'validated', 'rejected'])))` |
| validated_by | uuid | NULL |  | FK → app_user(id) |
| validated_at | timestamp with time zone | NULL |  |  |
| validation_note | text | NULL |  | `CHECK (((validation_note IS NULL) OR ((char_length(validation_note) >= 1) AND (char_length(validation_note) <= 2000))))` |
| validated_record_version | integer | NULL |  | `CHECK (((validated_record_version IS NULL) OR (validated_record_version >= 1)))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `baseline_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `baseline_kpi_definition_id_fkey` (FK): `FOREIGN KEY (transformation_id, kpi_definition_id) REFERENCES kpi_definition(transformation_id, id)`
- `baseline_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`
- `baseline_validated_measurable` (CHECK): `CHECK (((validation_status <> 'validated') OR ((value IS NOT NULL) AND (source IS NOT NULL) AND (baseline_date IS NOT NULL))))`
- `baseline_validation_complete` (CHECK): `CHECK ((((validation_status = 'unvalidated') = (validated_by IS NULL)) AND ((validated_by IS NULL) = (validated_at IS NULL)) AND ((validated_at IS NULL) = (validated_record_version IS NULL))))`

**Indexes:**

- `baseline_transformation_updated_idx`: `(transformation_id, updated_at DESC, id DESC)`

**Triggers:**

- `baseline_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `baseline_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## outcome_kpi

- **Purpose:** T02 Outcome & KPI Tree row (B0050): outcome, KPI, baseline, target, target date, owner, leading indicator.
- **Migration:** `0014_p2_kpi_baseline_value_pool.sql`. **API module:** `kpi`. **Who writes:** outcome.edit (TL, BO, KDS); trajectory: kpi_target.approve (SP, BO). **Lifecycle:** trajectory draft → approved; active → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| outcome_id | uuid | NOT NULL |  |  |
| kpi_definition_id | uuid | NOT NULL |  |  |
| baseline_id | uuid | NULL |  |  |
| baseline_value | numeric(24,6) | NULL |  |  |
| target_value | numeric(24,6) | NULL |  |  |
| target_date | date | NOT NULL |  |  |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| leading_indicator_text | text | NULL |  | `CHECK (((leading_indicator_text IS NULL) OR ((char_length(leading_indicator_text) >= 1) AND (char_length(leading_indicator_text) <= 1000))))` |
| leading_kpi_definition_id | uuid | NULL |  |  |
| ordinal | integer | NOT NULL | `1` | `CHECK ((ordinal >= 1))` |
| trajectory_points | jsonb | NOT NULL | `'[]'` | `CHECK (((jsonb_typeof(trajectory_points) = 'array') AND (jsonb_array_length(trajectory_points) <= 120)))` |
| trajectory_status | text | NOT NULL | `'draft'` | `CHECK ((trajectory_status = ANY (ARRAY['draft', 'approved'])))` |
| trajectory_approved_by | uuid | NULL |  | FK → app_user(id) |
| trajectory_approved_at | timestamp with time zone | NULL |  |  |
| trajectory_approved_version | integer | NULL |  | `CHECK (((trajectory_approved_version IS NULL) OR (trajectory_approved_version >= 1)))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `outcome_kpi_approver_not_creator` (CHECK): `CHECK (((trajectory_approved_by IS NULL) OR (trajectory_approved_by <> created_by)))`
- `outcome_kpi_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `outcome_kpi_baseline_id_fkey` (FK): `FOREIGN KEY (transformation_id, baseline_id) REFERENCES baseline(transformation_id, id)`
- `outcome_kpi_kpi_definition_id_fkey` (FK): `FOREIGN KEY (transformation_id, kpi_definition_id) REFERENCES kpi_definition(transformation_id, id)`
- `outcome_kpi_leading_kpi_definition_id_fkey` (FK): `FOREIGN KEY (transformation_id, leading_kpi_definition_id) REFERENCES kpi_definition(transformation_id, id)`
- `outcome_kpi_one_baseline_source` (CHECK): `CHECK (((baseline_id IS NULL) OR (baseline_value IS NULL)))`
- `outcome_kpi_outcome_id_fkey` (FK): `FOREIGN KEY (transformation_id, outcome_id) REFERENCES outcome(transformation_id, id)`
- `outcome_kpi_trajectory_complete` (CHECK): `CHECK ((((trajectory_status = 'approved') = (trajectory_approved_by IS NOT NULL)) AND ((trajectory_approved_by IS NULL) = (trajectory_approved_at IS NULL)) AND ((trajectory_approved_at IS NULL) = (trajectory_approved_version IS NULL)) AND ((trajectory_status <> 'approved') OR (target_value IS NOT NULL))))`
- `outcome_kpi_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `outcome_kpi_outcome_idx`: `(outcome_id)`
- `outcome_kpi_transformation_updated_idx`: `(transformation_id, updated_at DESC, id DESC)`

**Triggers:**

- `outcome_kpi_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `outcome_kpi_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## value_pool

- **Purpose:** Value pool quantified by driver with upside/downside, or explicitly unquantified (REQ-PB-028, ADR-0019).
- **Migration:** `0014_p2_kpi_baseline_value_pool.sql`. **API module:** `kpi`. **Who writes:** diagnostic.edit (TL, TO); validation: finance.validate (FIN). **Lifecycle:** quantified / unquantified; validation unvalidated → validated / rejected; active → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| name | text | NOT NULL |  | `CHECK (((char_length(name) >= 1) AND (char_length(name) <= 300)))` |
| driver | text | NULL |  | `CHECK (((driver IS NULL) OR ((char_length(driver) >= 1) AND (char_length(driver) <= 1000))))` |
| workstream_code | text | NULL |  | FK → diagnostic_workstream(code) |
| quantification_status | text | NOT NULL | `'unquantified'` | `CHECK ((quantification_status = ANY (ARRAY['quantified', 'unquantified'])))` |
| upside_amount | numeric(20,4) | NULL |  |  |
| downside_amount | numeric(20,4) | NULL |  |  |
| currency | character(3) | NOT NULL |  | `CHECK ((currency ~ '^[A-Z]{3}$'))` |
| unquantified_reason | text | NULL |  | `CHECK (((unquantified_reason IS NULL) OR ((char_length(unquantified_reason) >= 1) AND (char_length(unquantified_reason) <= 2000))))` |
| materiality | text | NOT NULL | `'not_assessed'` | `CHECK ((materiality = ANY (ARRAY['material', 'not_material', 'not_assessed'])))` |
| confidence | text | NULL |  | `CHECK (((confidence IS NULL) OR (confidence = ANY (ARRAY['H', 'M', 'L']))))` |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| validation_status | text | NOT NULL | `'unvalidated'` | `CHECK ((validation_status = ANY (ARRAY['unvalidated', 'validated', 'rejected'])))` |
| validated_by | uuid | NULL |  | FK → app_user(id) |
| validated_at | timestamp with time zone | NULL |  |  |
| validation_note | text | NULL |  | `CHECK (((validation_note IS NULL) OR ((char_length(validation_note) >= 1) AND (char_length(validation_note) <= 2000))))` |
| validated_record_version | integer | NULL |  | `CHECK (((validated_record_version IS NULL) OR (validated_record_version >= 1)))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `value_pool_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `value_pool_quantification` (CHECK): `CHECK ((((quantification_status = 'quantified') AND (upside_amount IS NOT NULL) AND (downside_amount IS NOT NULL) AND (downside_amount <= upside_amount) AND (unquantified_reason IS NULL)) OR ((quantification_status = 'unquantified') AND (upside_amount IS NULL) AND (downside_amount IS NULL))))`
- `value_pool_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`
- `value_pool_validated_quantified` (CHECK): `CHECK (((validation_status <> 'validated') OR (quantification_status = 'quantified')))`
- `value_pool_validation_complete` (CHECK): `CHECK ((((validation_status = 'unvalidated') = (validated_by IS NULL)) AND ((validated_by IS NULL) = (validated_at IS NULL)) AND ((validated_at IS NULL) = (validated_record_version IS NULL))))`

**Indexes:**

- `value_pool_materiality_idx`: `(transformation_id, materiality) WHERE (status = 'active'::text)`
- `value_pool_transformation_updated_idx`: `(transformation_id, updated_at DESC, id DESC)`

**Triggers:**

- `value_pool_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `value_pool_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## diagnostic_item

- **Purpose:** T01 Current-State Diagnostic row (B0031): dimension, current state, evidence/baseline, root cause, impact (SAR or KPI), confidence H/M/L. Six rows pre-seeded per transformation.
- **Migration:** `0015_p2_diagnose.sql`. **API module:** `transformations`. **Who writes:** diagnostic.edit (TL, TO), diagnostic.contribute (WL, own). **Lifecycle:** active → archived (seeded rows never archived).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| dimension_code | text | NOT NULL |  | FK → diagnostic_dimension(code) |
| is_seeded | boolean | NOT NULL | `false` |  |
| current_state | text | NULL |  | `CHECK (((current_state IS NULL) OR ((char_length(current_state) >= 1) AND (char_length(current_state) <= 20000))))` |
| evidence_baseline | text | NULL |  | `CHECK (((evidence_baseline IS NULL) OR ((char_length(evidence_baseline) >= 1) AND (char_length(evidence_baseline) <= 4000))))` |
| baseline_id | uuid | NULL |  |  |
| root_cause | text | NULL |  | `CHECK (((root_cause IS NULL) OR ((char_length(root_cause) >= 1) AND (char_length(root_cause) <= 20000))))` |
| impact_text | text | NULL |  | `CHECK (((impact_text IS NULL) OR ((char_length(impact_text) >= 1) AND (char_length(impact_text) <= 4000))))` |
| impact_amount | numeric(20,4) | NULL |  |  |
| impact_currency | character(3) | NULL |  | `CHECK (((impact_currency IS NULL) OR (impact_currency ~ '^[A-Z]{3}$')))` |
| impact_kpi_definition_id | uuid | NULL |  |  |
| confidence | text | NULL |  | `CHECK (((confidence IS NULL) OR (confidence = ANY (ARRAY['H', 'M', 'L']))))` |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `diagnostic_item_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `diagnostic_item_baseline_id_fkey` (FK): `FOREIGN KEY (transformation_id, baseline_id) REFERENCES baseline(transformation_id, id)`
- `diagnostic_item_impact_kpi_definition_id_fkey` (FK): `FOREIGN KEY (transformation_id, impact_kpi_definition_id) REFERENCES kpi_definition(transformation_id, id)`
- `diagnostic_item_impact_money_pair` (CHECK): `CHECK (((impact_amount IS NULL) = (impact_currency IS NULL)))`
- `diagnostic_item_seeded_not_archived` (CHECK): `CHECK ((NOT (is_seeded AND (status = 'archived'))))`
- `diagnostic_item_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `diagnostic_item_seeded_key`: `UNIQUE (transformation_id, dimension_code) WHERE is_seeded`
- `diagnostic_item_transformation_updated_idx`: `(transformation_id, updated_at DESC, id DESC)`

**Triggers:**

- `diagnostic_item_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `diagnostic_item_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## diagnostic_finding

- **Purpose:** A diagnostic finding in a workstream, classified to separate symptoms from root causes (REQ-S04-003).
- **Migration:** `0015_p2_diagnose.sql`. **API module:** `transformations`. **Who writes:** diagnostic.edit / diagnostic.contribute. **Lifecycle:** draft → confirmed / rejected; → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| workstream_code | text | NOT NULL |  | FK → diagnostic_workstream(code) |
| diagnostic_item_id | uuid | NULL |  |  |
| kind | text | NOT NULL |  | `CHECK ((kind = ANY (ARRAY['symptom', 'root_cause', 'opportunity', 'observation'])))` |
| statement | text | NOT NULL |  | `CHECK (((char_length(statement) >= 1) AND (char_length(statement) <= 2000)))` |
| detail | text | NULL |  | `CHECK (((detail IS NULL) OR ((char_length(detail) >= 1) AND (char_length(detail) <= 20000))))` |
| confidence | text | NULL |  | `CHECK (((confidence IS NULL) OR (confidence = ANY (ARRAY['H', 'M', 'L']))))` |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| status | text | NOT NULL | `'draft'` | `CHECK ((status = ANY (ARRAY['draft', 'confirmed', 'rejected', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `diagnostic_finding_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `diagnostic_finding_diagnostic_item_id_fkey` (FK): `FOREIGN KEY (transformation_id, diagnostic_item_id) REFERENCES diagnostic_item(transformation_id, id)`
- `diagnostic_finding_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `diagnostic_finding_transformation_updated_idx`: `(transformation_id, updated_at DESC, id DESC)`

**Triggers:**

- `diagnostic_finding_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `diagnostic_finding_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## diagnostic_workstream_output

- **Purpose:** An output attached to one of the six workstreams, as a linked record and/or evidence (REQ-PB-023).
- **Migration:** `0015_p2_diagnose.sql`. **API module:** `transformations`. **Who writes:** diagnostic.edit / diagnostic.contribute. **Lifecycle:** active → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| workstream_code | text | NOT NULL |  | FK → diagnostic_workstream(code) |
| title | text | NOT NULL |  | `CHECK (((char_length(title) >= 1) AND (char_length(title) <= 300)))` |
| output_kind | text | NULL |  | `CHECK (((output_kind IS NULL) OR ((char_length(output_kind) >= 1) AND (char_length(output_kind) <= 100))))` |
| record_type | text | NULL |  | `CHECK (((record_type IS NULL) OR (record_type = ANY (ARRAY['diagnostic_item', 'diagnostic_finding', 'baseline', 'value_pool', 'capability', 'journey', 'kpi_definition']))))` |
| record_id | uuid | NULL |  |  |
| evidence_id | uuid | NULL |  |  |
| note | text | NULL |  | `CHECK (((note IS NULL) OR ((char_length(note) >= 1) AND (char_length(note) <= 4000))))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `diagnostic_workstream_output_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `diagnostic_workstream_output_evidence_id_fkey` (FK): `FOREIGN KEY (transformation_id, evidence_id) REFERENCES evidence(transformation_id, id)`
- `diagnostic_workstream_output_has_target` (CHECK): `CHECK (((record_id IS NOT NULL) OR (evidence_id IS NOT NULL)))`
- `diagnostic_workstream_output_record_pair` (CHECK): `CHECK (((record_type IS NULL) = (record_id IS NULL)))`
- `diagnostic_workstream_output_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `diagnostic_workstream_output_transformation_updated_idx`: `(transformation_id, updated_at DESC, id DESC)`

**Triggers:**

- `diagnostic_workstream_output_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `diagnostic_workstream_output_record_ref`: BEFORE INSERT OR UPDATE OF record_type, record_id FOR EACH ROW → `p2_record_ref_guard()`
- `diagnostic_workstream_output_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## tom_canvas_cell

- **Purpose:** One TOM Canvas box per dimension per transformation (B0062): current/target design and owner. Ten rows pre-created per transformation.
- **Migration:** `0016_p2_design_tom.sql`. **API module:** `transformations`. **Who writes:** tom.edit (TL, BO). **Lifecycle:** draft ↔ ready.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| dimension_code | text | NOT NULL |  | FK → tom_dimension(code) |
| current_design | text | NULL |  | `CHECK (((current_design IS NULL) OR ((char_length(current_design) >= 1) AND (char_length(current_design) <= 20000))))` |
| target_design | text | NULL |  | `CHECK (((target_design IS NULL) OR ((char_length(target_design) >= 1) AND (char_length(target_design) <= 20000))))` |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| status | text | NOT NULL | `'draft'` | `CHECK ((status = ANY (ARRAY['draft', 'ready'])))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `tom_canvas_cell_dimension_key` (UNIQUE): `UNIQUE (transformation_id, dimension_code)`
- `tom_canvas_cell_ready_complete` (CHECK): `CHECK (((status <> 'ready') OR ((target_design IS NOT NULL) AND (owner_user_id IS NOT NULL))))`
- `tom_canvas_cell_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Triggers:**

- `tom_canvas_cell_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `tom_canvas_cell_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## tom_gap

- **Purpose:** T03 TOM Gap Matrix row (B0058): TOM dimension, current state, target state, gap, design decision, owner.
- **Migration:** `0016_p2_design_tom.sql`. **API module:** `transformations`. **Who writes:** tom.edit (TL, BO), tom.contribute (WL, TD, own). **Lifecycle:** open → resolved; → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| dimension_code | text | NOT NULL |  | FK → tom_dimension(code) |
| current_state | text | NULL |  | `CHECK (((current_state IS NULL) OR ((char_length(current_state) >= 1) AND (char_length(current_state) <= 20000))))` |
| target_state | text | NULL |  | `CHECK (((target_state IS NULL) OR ((char_length(target_state) >= 1) AND (char_length(target_state) <= 20000))))` |
| gap | text | NULL |  | `CHECK (((gap IS NULL) OR ((char_length(gap) >= 1) AND (char_length(gap) <= 20000))))` |
| design_decision_id | uuid | NULL |  |  |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| status | text | NOT NULL | `'open'` | `CHECK ((status = ANY (ARRAY['open', 'resolved', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `tom_gap_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `tom_gap_design_decision_fkey` (FK): `FOREIGN KEY (transformation_id, design_decision_id) REFERENCES decision(transformation_id, id)`
- `tom_gap_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `tom_gap_dimension_idx`: `(transformation_id, dimension_code) WHERE (status <> 'archived'::text)`
- `tom_gap_transformation_updated_idx`: `(transformation_id, updated_at DESC, id DESC)`

**Triggers:**

- `tom_gap_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `tom_gap_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## capability

- **Purpose:** Capability heatmap entry: current vs target level and build/buy/partner need (REQ-PB-024).
- **Migration:** `0016_p2_design_tom.sql`. **API module:** `transformations`. **Who writes:** tom.edit / tom.contribute. **Lifecycle:** active → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| name | text | NOT NULL |  | `CHECK (((char_length(name) >= 1) AND (char_length(name) <= 300)))` |
| description | text | NULL |  | `CHECK (((description IS NULL) OR ((char_length(description) >= 1) AND (char_length(description) <= 4000))))` |
| dimension_code | text | NULL |  | FK → tom_dimension(code) |
| current_level | smallint | NULL |  | `CHECK (((current_level IS NULL) OR ((current_level >= 1) AND (current_level <= 5))))` |
| target_level | smallint | NULL |  | `CHECK (((target_level IS NULL) OR ((target_level >= 1) AND (target_level <= 5))))` |
| sourcing_need | text | NULL |  | `CHECK (((sourcing_need IS NULL) OR (sourcing_need = ANY (ARRAY['build', 'buy', 'partner', 'undecided']))))` |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| tom_gap_id | uuid | NULL |  |  |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `capability_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `capability_tom_gap_id_fkey` (FK): `FOREIGN KEY (transformation_id, tom_gap_id) REFERENCES tom_gap(transformation_id, id)`
- `capability_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `capability_transformation_updated_idx`: `(transformation_id, updated_at DESC, id DESC)`

**Triggers:**

- `capability_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `capability_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## journey

- **Purpose:** Journey or process map, current or future state (REQ-PB-025); steps with actors, handoffs, systems, controls.
- **Migration:** `0016_p2_design_tom.sql`. **API module:** `transformations`. **Who writes:** tom.edit / tom.contribute. **Lifecycle:** draft → active → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| name | text | NOT NULL |  | `CHECK (((char_length(name) >= 1) AND (char_length(name) <= 300)))` |
| kind | text | NOT NULL |  | `CHECK ((kind = ANY (ARRAY['journey', 'process'])))` |
| state | text | NOT NULL |  | `CHECK ((state = ANY (ARRAY['current', 'future'])))` |
| description | text | NULL |  | `CHECK (((description IS NULL) OR ((char_length(description) >= 1) AND (char_length(description) <= 20000))))` |
| dimension_code | text | NULL |  | FK → tom_dimension(code) |
| steps | jsonb | NOT NULL | `'[]'` | `CHECK (((jsonb_typeof(steps) = 'array') AND (jsonb_array_length(steps) <= 200)))` |
| cycle_time_value | numeric(14,4) | NULL |  | `CHECK (((cycle_time_value IS NULL) OR (cycle_time_value >= (0)::numeric)))` |
| cycle_time_unit | text | NULL |  | `CHECK (((cycle_time_unit IS NULL) OR (cycle_time_unit = ANY (ARRAY['minutes', 'hours', 'days', 'weeks']))))` |
| failure_demand | text | NULL |  | `CHECK (((failure_demand IS NULL) OR ((char_length(failure_demand) >= 1) AND (char_length(failure_demand) <= 4000))))` |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| status | text | NOT NULL | `'draft'` | `CHECK ((status = ANY (ARRAY['draft', 'active', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `journey_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `journey_cycle_time_pair` (CHECK): `CHECK (((cycle_time_value IS NULL) = (cycle_time_unit IS NULL)))`
- `journey_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `journey_state_idx`: `(transformation_id, state) WHERE (status <> 'archived'::text)`
- `journey_transformation_updated_idx`: `(transformation_id, updated_at DESC, id DESC)`

**Triggers:**

- `journey_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `journey_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## journey_pain_point

- **Purpose:** A pain point on a journey (optionally on one step), linkable to a T01 row (REQ-PB-025).
- **Migration:** `0016_p2_design_tom.sql`. **API module:** `transformations`. **Who writes:** tom.edit / tom.contribute. **Lifecycle:** active → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| journey_id | uuid | NOT NULL |  |  |
| step_key | uuid | NULL |  |  |
| description | text | NOT NULL |  | `CHECK (((char_length(description) >= 1) AND (char_length(description) <= 2000)))` |
| diagnostic_item_id | uuid | NULL |  |  |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `journey_pain_point_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `journey_pain_point_diagnostic_item_id_fkey` (FK): `FOREIGN KEY (transformation_id, diagnostic_item_id) REFERENCES diagnostic_item(transformation_id, id)`
- `journey_pain_point_journey_id_fkey` (FK): `FOREIGN KEY (transformation_id, journey_id) REFERENCES journey(transformation_id, id)`
- `journey_pain_point_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `journey_pain_point_journey_idx`: `(journey_id)`

**Triggers:**

- `journey_pain_point_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `journey_pain_point_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## decision

- **Purpose:** THE canonical decision record (one decision model): T04 design decisions (kind = design) in P2, gate decisions (kind = gate, specialised by gate_decision), T16 executive decisions (kind = executive, P4).
- **Migration:** `0017_p2_decisions_gates.sql`. **API module:** `workflows`. **Who writes:** decision.edit (TL, WL); decide: decision.decide (named owner); gate kind: gate decision op. **Lifecycle:** open → decided / deferred / cancelled; deferred → open; gate kind always decided.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| kind | text | NOT NULL |  | `CHECK ((kind = ANY (ARRAY['design', 'executive', 'gate'])))` |
| code | text | NOT NULL |  |  |
| title | text | NOT NULL |  | `CHECK (((char_length(title) >= 1) AND (char_length(title) <= 500)))` |
| context | text | NULL |  | `CHECK (((context IS NULL) OR ((char_length(context) >= 1) AND (char_length(context) <= 20000))))` |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| due_date | date | NULL |  |  |
| status | text | NOT NULL | `'open'` | `CHECK ((status = ANY (ARRAY['open', 'decided', 'deferred', 'cancelled'])))` |
| recommendation_option_id | uuid | NULL |  |  |
| recommendation_text | text | NULL |  | `CHECK (((recommendation_text IS NULL) OR ((char_length(recommendation_text) >= 1) AND (char_length(recommendation_text) <= 4000))))` |
| chosen_option_id | uuid | NULL |  |  |
| outcome_text | text | NULL |  | `CHECK (((outcome_text IS NULL) OR ((char_length(outcome_text) >= 1) AND (char_length(outcome_text) <= 8000))))` |
| decided_by | uuid | NULL |  | FK → app_user(id) |
| decided_at | timestamp with time zone | NULL |  |  |
| tom_dimension_code | text | NULL |  | FK → tom_dimension(code) |
| source_workshop_item_id | uuid | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `decision_chosen_option_fkey` (FK): `FOREIGN KEY (id, chosen_option_id) REFERENCES decision_option(decision_id, id)`
- `decision_code_format` (CHECK): `CHECK ((((kind = 'design') AND (code ~ '^D-[0-9]{2,6}$')) OR ((kind = 'executive') AND (code ~ '^DEC-[0-9]{2,6}$')) OR ((kind = 'gate') AND (code ~ '^GD-[0-9]{2,6}$'))))`
- `decision_code_key` (UNIQUE): `UNIQUE (transformation_id, code)`
- `decision_decided_complete` (CHECK): `CHECK ((((status = 'decided') = (decided_at IS NOT NULL)) AND ((decided_at IS NULL) = (decided_by IS NULL))))`
- `decision_design_choice` (CHECK): `CHECK (((kind <> 'design') OR (status <> 'decided') OR (chosen_option_id IS NOT NULL)))`
- `decision_design_only_links` (CHECK): `CHECK (((kind = 'design') OR ((tom_dimension_code IS NULL) AND (source_workshop_item_id IS NULL))))`
- `decision_gate_is_decided` (CHECK): `CHECK (((kind <> 'gate') OR (status = 'decided')))`
- `decision_id_kind_key` (UNIQUE): `UNIQUE (id, kind)`
- `decision_recommendation_option_fkey` (FK): `FOREIGN KEY (id, recommendation_option_id) REFERENCES decision_option(decision_id, id)`
- `decision_source_workshop_item_fkey` (FK): `FOREIGN KEY (transformation_id, source_workshop_item_id) REFERENCES tom_workshop_item(transformation_id, id)`
- `decision_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `decision_kind_status_idx`: `(transformation_id, kind, status)`
- `decision_open_owner_idx`: `(owner_user_id) WHERE (status = 'open'::text)`
- `decision_transformation_updated_idx`: `(transformation_id, updated_at DESC, id DESC)`

**Triggers:**

- `decision_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `decision_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## decision_option

- **Purpose:** Options A / B / C… of a decision (B0065); also used by T16 in P4.
- **Migration:** `0017_p2_decisions_gates.sql`. **API module:** `workflows`. **Who writes:** decision.edit. **Lifecycle:** active → withdrawn.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| decision_id | uuid | NOT NULL |  |  |
| label | text | NOT NULL |  | `CHECK ((label ~ '^[A-Z]$'))` |
| title | text | NOT NULL |  | `CHECK (((char_length(title) >= 1) AND (char_length(title) <= 300)))` |
| description | text | NULL |  | `CHECK (((description IS NULL) OR ((char_length(description) >= 1) AND (char_length(description) <= 4000))))` |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 26)))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'withdrawn'])))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `decision_option_decision_id_fkey` (FK): `FOREIGN KEY (transformation_id, decision_id) REFERENCES decision(transformation_id, id)`
- `decision_option_decision_id_id_key` (UNIQUE): `UNIQUE (decision_id, id)`
- `decision_option_label_key` (UNIQUE): `UNIQUE (decision_id, label)`

**Triggers:**

- `decision_option_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `decision_option_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## record_code_counter

- **Purpose:** Per-transformation counters for human-readable codes (D-01, DEC-01, GD-01, DEP-01; P3 adds INI-01, BC-01, BF-01).
- **Migration:** `0017_p2_decisions_gates.sql (prefix CHECK widened by 0020)`. **API module:** `workflows`. **Who writes:** system (code generation). **Lifecycle:** —.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| prefix | text | NOT NULL |  | `CHECK ((prefix = ANY (ARRAY['D', 'DEC', 'GD', 'DEP', 'INI', 'BC', 'BF'])))` |
| last_value | integer | NOT NULL |  | `CHECK ((last_value >= 0))` |

**Table constraints:**

- `record_code_counter_pkey` (PK): `PRIMARY KEY (transformation_id, prefix)`

## tom_workshop

- **Purpose:** TOM canvas workshop (B0063): 90-120 minute session with business owners.
- **Migration:** `0017_p2_decisions_gates.sql`. **API module:** `workflows`. **Who writes:** workshop.facilitate (TL). **Lifecycle:** planned → in_progress → closed (no open unresolved items).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| title | text | NOT NULL |  | `CHECK (((char_length(title) >= 1) AND (char_length(title) <= 300)))` |
| workshop_date | date | NOT NULL |  |  |
| duration_minutes | integer | NOT NULL |  | `CHECK (((duration_minutes >= 15) AND (duration_minutes <= 480)))` |
| agenda | text | NULL |  | `CHECK (((agenda IS NULL) OR ((char_length(agenda) >= 1) AND (char_length(agenda) <= 20000))))` |
| facilitator_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| status | text | NOT NULL | `'planned'` | `CHECK ((status = ANY (ARRAY['planned', 'in_progress', 'closed'])))` |
| closed_at | timestamp with time zone | NULL |  |  |
| closed_by | uuid | NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `tom_workshop_closed_complete` (CHECK): `CHECK ((((status = 'closed') = (closed_at IS NOT NULL)) AND ((closed_at IS NULL) = (closed_by IS NULL))))`
- `tom_workshop_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `tom_workshop_transformation_updated_idx`: `(transformation_id, updated_at DESC, id DESC)`

**Triggers:**

- `tom_workshop_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `tom_workshop_close_guard`: BEFORE UPDATE OF status FOR EACH ROW → `tom_workshop_close_guard()`
- `tom_workshop_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## tom_workshop_participant

- **Purpose:** Participants of a TOM workshop (business owners flagged).
- **Migration:** `0017_p2_decisions_gates.sql`. **API module:** `workflows`. **Who writes:** workshop.facilitate. **Lifecycle:** active → removed.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| workshop_id | uuid | NOT NULL |  |  |
| user_id | uuid | NOT NULL |  | FK → app_user(id) |
| is_business_owner | boolean | NOT NULL | `false` |  |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'removed'])))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `tom_workshop_participant_workshop_id_fkey` (FK): `FOREIGN KEY (transformation_id, workshop_id) REFERENCES tom_workshop(transformation_id, id)`

**Indexes:**

- `tom_workshop_participant_active_key`: `UNIQUE (workshop_id, user_id) WHERE (status = 'active'::text)`

**Triggers:**

- `tom_workshop_participant_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `tom_workshop_participant_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## tom_workshop_item

- **Purpose:** A workshop contribution, or an unresolved item that must be converted into a design decision or an owned action.
- **Migration:** `0017_p2_decisions_gates.sql`. **API module:** `workflows`. **Who writes:** workshop.facilitate; tom.edit / tom.contribute participants. **Lifecycle:** contribution: recorded; unresolved: open → converted.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| workshop_id | uuid | NOT NULL |  |  |
| dimension_code | text | NULL |  | FK → tom_dimension(code) |
| kind | text | NOT NULL |  | `CHECK ((kind = ANY (ARRAY['contribution', 'unresolved'])))` |
| body | text | NOT NULL |  | `CHECK (((char_length(body) >= 1) AND (char_length(body) <= 4000)))` |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| status | text | NOT NULL |  | `CHECK ((status = ANY (ARRAY['recorded', 'open', 'converted'])))` |
| converted_decision_id | uuid | NULL |  |  |
| converted_action_id | uuid | NULL |  |  |
| converted_at | timestamp with time zone | NULL |  |  |
| converted_by | uuid | NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `tom_workshop_item_conversion` (CHECK): `CHECK ((((status = 'converted') = (converted_at IS NOT NULL)) AND ((converted_at IS NULL) = (converted_by IS NULL)) AND ((status <> 'converted') OR ((owner_user_id IS NOT NULL) AND ((converted_decision_id IS NULL) <> (converted_action_id IS NULL)))) AND ((status = 'converted') OR ((converted_decision_id IS NULL) AND (converted_action_id IS NULL)))))`
- `tom_workshop_item_converted_action_id_fkey` (FK): `FOREIGN KEY (transformation_id, converted_action_id) REFERENCES action_item(transformation_id, id)`
- `tom_workshop_item_converted_decision_id_fkey` (FK): `FOREIGN KEY (transformation_id, converted_decision_id) REFERENCES decision(transformation_id, id)`
- `tom_workshop_item_kind_status` (CHECK): `CHECK (((kind = 'contribution') = (status = 'recorded')))`
- `tom_workshop_item_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`
- `tom_workshop_item_workshop_id_fkey` (FK): `FOREIGN KEY (transformation_id, workshop_id) REFERENCES tom_workshop(transformation_id, id)`

**Indexes:**

- `tom_workshop_item_workshop_idx`: `(workshop_id, status)`

**Triggers:**

- `tom_workshop_item_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `tom_workshop_item_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## action_item

- **Purpose:** An owned action (P2: from workshop conversion; P4 extends it for RAID, meetings and corrective actions).
- **Migration:** `0017_p2_decisions_gates.sql`. **API module:** `workflows`. **Who writes:** action.edit (TL, TO); action.update_own (owner). **Lifecycle:** open → in_progress → done / cancelled.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| title | text | NOT NULL |  | `CHECK (((char_length(title) >= 1) AND (char_length(title) <= 500)))` |
| description | text | NULL |  | `CHECK (((description IS NULL) OR ((char_length(description) >= 1) AND (char_length(description) <= 4000))))` |
| owner_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| due_date | date | NULL |  |  |
| status | text | NOT NULL | `'open'` | `CHECK ((status = ANY (ARRAY['open', 'in_progress', 'done', 'cancelled'])))` |
| source_workshop_item_id | uuid | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `action_item_source_workshop_item_id_fkey` (FK): `FOREIGN KEY (transformation_id, source_workshop_item_id) REFERENCES tom_workshop_item(transformation_id, id)`
- `action_item_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `action_item_transformation_updated_idx`: `(transformation_id, updated_at DESC, id DESC)`

**Triggers:**

- `action_item_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `action_item_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## dependency

- **Purpose:** THE canonical dependency record shared by T08 and RAID. P2: TOM-level dependencies; P3 (0022): initiative endpoints (`from_initiative_id`, `to_initiative_id`), configurable types (FK to `dependency_type`) and the race-free cycle guard (ADR-0023 §4–§5).
- **Migration:** `0017_p2_decisions_gates.sql; extended by 0022`. **API module:** `workflows`. **Who writes:** dependency.edit (TL, WL, TO, TD). **Lifecycle:** open ↔ at_risk → resolved; → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| code | text | NOT NULL |  | `CHECK ((code ~ '^DEP-[0-9]{2,6}$'))` |
| description | text | NOT NULL |  | `CHECK (((char_length(description) >= 1) AND (char_length(description) <= 2000)))` |
| from_kind | text | NOT NULL |  | `CHECK ((from_kind = ANY (ARRAY['initiative', 'external', 'tom_dimension', 'decision', 'other'])))` |
| from_label | text | NULL |  | `CHECK (((from_label IS NULL) OR ((char_length(from_label) >= 1) AND (char_length(from_label) <= 300))))` |
| to_kind | text | NOT NULL |  | `CHECK ((to_kind = ANY (ARRAY['initiative', 'external', 'tom_dimension', 'decision', 'other'])))` |
| to_label | text | NULL |  | `CHECK (((to_label IS NULL) OR ((char_length(to_label) >= 1) AND (char_length(to_label) <= 300))))` |
| dependency_type | text | NOT NULL |  | FK → dependency_type(code) |
| needed_by | date | NULL |  |  |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| status | text | NOT NULL | `'open'` | `CHECK ((status = ANY (ARRAY['open', 'at_risk', 'resolved', 'archived'])))` |
| mitigation | text | NULL |  | `CHECK (((mitigation IS NULL) OR ((char_length(mitigation) >= 1) AND (char_length(mitigation) <= 4000))))` |
| tom_dimension_code | text | NULL |  | FK → tom_dimension(code) |
| decision_id | uuid | NULL |  |  |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |
| from_initiative_id | uuid | NULL |  |  |
| to_initiative_id | uuid | NULL |  |  |

**Table constraints:**

- `dependency_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `dependency_code_key` (UNIQUE): `UNIQUE (transformation_id, code)`
- `dependency_decision_id_fkey` (FK): `FOREIGN KEY (transformation_id, decision_id) REFERENCES decision(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `dependency_from_initiative_id_fkey` (FK): `FOREIGN KEY (transformation_id, from_initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `dependency_from_initiative_kind` (CHECK): `CHECK (((from_initiative_id IS NULL) OR (from_kind = 'initiative')))`
- `dependency_not_self` (CHECK): `CHECK (((from_initiative_id IS NULL) OR (from_initiative_id IS DISTINCT FROM to_initiative_id)))`
- `dependency_to_initiative_id_fkey` (FK): `FOREIGN KEY (transformation_id, to_initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `dependency_to_initiative_kind` (CHECK): `CHECK (((to_initiative_id IS NULL) OR (to_kind = 'initiative')))`
- `dependency_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `dependency_dimension_idx`: `(transformation_id, tom_dimension_code) WHERE (status <> 'archived'::text)`
- `dependency_from_initiative_idx`: `(transformation_id, from_initiative_id) WHERE ((from_initiative_id IS NOT NULL) AND (status <> 'archived'::text))`
- `dependency_to_initiative_idx`: `(transformation_id, to_initiative_id) WHERE ((to_initiative_id IS NOT NULL) AND (status <> 'archived'::text))`
- `dependency_transformation_updated_idx`: `(transformation_id, updated_at DESC, id DESC)`

**Triggers:**

- `dependency_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `dependency_cycle_guard`: AFTER INSERT OR UPDATE OF from_initiative_id, to_initiative_id, status FOR EACH ROW → `dependency_cycle_guard()`
- `dependency_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`
- `dependency_type_active`: BEFORE INSERT OR UPDATE OF dependency_type FOR EACH ROW → `dependency_type_active()`

## gate_instance

- **Purpose:** A product gate (G1-G6) of one transformation: status, configured approver, current submission. Business approval inside the product; unrelated to engineering gates DG0-DG7.
- **Migration:** `0017_p2_decisions_gates.sql`. **API module:** `workflows`. **Who writes:** system (instantiation); approver config: gate.configure (TO). **Lifecycle:** draft → submitted → approved / rejected / changes_requested / deferred (→ resubmitted).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| gate_code | text | NOT NULL |  | FK → gate_definition(code) |
| status | text | NOT NULL | `'draft'` | `CHECK ((status = ANY (ARRAY['draft', 'submitted', 'under_review', 'changes_requested', 'approved', 'rejected', 'deferred'])))` |
| approver_role_code | text | NOT NULL |  | FK → role(code) |
| approver_user_id | uuid | NULL |  | FK → app_user(id) |
| current_submission_id | uuid | NULL |  |  |
| latest_submission_no | integer | NOT NULL | `0` | `CHECK ((latest_submission_no >= 0))` |
| approved_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `gate_instance_approved_complete` (CHECK): `CHECK (((status = 'approved') = (approved_at IS NOT NULL)))`
- `gate_instance_current_submission_fkey` (FK): `FOREIGN KEY (id, current_submission_id) REFERENCES gate_submission(gate_instance_id, id)`
- `gate_instance_draft_unsubmitted` (CHECK): `CHECK ((((status = 'draft') = (latest_submission_no = 0)) AND ((current_submission_id IS NULL) = (latest_submission_no = 0))))`
- `gate_instance_gate_key` (UNIQUE): `UNIQUE (transformation_id, gate_code)`
- `gate_instance_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Triggers:**

- `gate_instance_approver_allowed`: BEFORE INSERT OR UPDATE OF approver_role_code FOR EACH ROW → `gate_instance_approver_allowed()`
- `gate_instance_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `gate_instance_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## gate_submission

- **Purpose:** A versioned submission of a gate with its immutable evidence snapshot (REQ-S04-002).
- **Migration:** `0017_p2_decisions_gates.sql`. **API module:** `workflows`. **Who writes:** gate.submit (TL). **Lifecycle:** pending → superseded / decided / withdrawn (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| gate_instance_id | uuid | NOT NULL |  |  |
| gate_code | text | NOT NULL |  | FK → gate_definition(code) |
| submission_no | integer | NOT NULL |  | `CHECK ((submission_no >= 1))` |
| status | text | NOT NULL | `'pending'` | `CHECK ((status = ANY (ARRAY['pending', 'superseded', 'decided', 'withdrawn'])))` |
| submitted_by | uuid | NOT NULL |  | FK → app_user(id) |
| submitted_at | timestamp with time zone | NOT NULL | `now()` |  |
| submission_note | text | NULL |  | `CHECK (((submission_note IS NULL) OR ((char_length(submission_note) >= 1) AND (char_length(submission_note) <= 4000))))` |
| approver_role_code | text | NOT NULL |  | FK → role(code) |
| approver_user_id | uuid | NULL |  | FK → app_user(id) |
| due_date | date | NULL |  |  |
| charter_id | uuid | NULL |  |  |
| charter_version_no | integer | NULL |  |  |
| snapshot | jsonb | NOT NULL |  | `CHECK ((jsonb_typeof(snapshot) = 'object'))` |
| snapshot_sha256 | character(64) | NOT NULL |  | `CHECK ((snapshot_sha256 ~ '^[0-9a-f]{64}$'))` |
| superseded_at | timestamp with time zone | NULL |  |  |
| superseded_by_submission_id | uuid | NULL |  | FK → gate_submission(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `gate_submission_charter_pair` (CHECK): `CHECK (((charter_id IS NULL) = (charter_version_no IS NULL)))`
- `gate_submission_charter_version_fkey` (FK): `FOREIGN KEY (charter_id, charter_version_no) REFERENCES charter_version(charter_id, version_no)`
- `gate_submission_gate_instance_id_fkey` (FK): `FOREIGN KEY (transformation_id, gate_instance_id) REFERENCES gate_instance(transformation_id, id)`
- `gate_submission_instance_id_key` (UNIQUE): `UNIQUE (gate_instance_id, id)`
- `gate_submission_no_key` (UNIQUE): `UNIQUE (gate_instance_id, submission_no)`
- `gate_submission_superseded_complete` (CHECK): `CHECK ((((status = 'superseded') = (superseded_at IS NOT NULL)) AND ((superseded_at IS NULL) = (superseded_by_submission_id IS NULL))))`

**Indexes:**

- `gate_submission_one_pending_key`: `UNIQUE (gate_instance_id) WHERE (status = 'pending'::text)`

**Triggers:**

- `gate_submission_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `gate_submission_freeze`: BEFORE UPDATE FOR EACH ROW → `gate_submission_freeze()`
- `gate_submission_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## gate_submission_criterion

- **Purpose:** Per-criterion completeness frozen at submission (§4: criterion, required evidence, completeness).
- **Migration:** `0017_p2_decisions_gates.sql`. **API module:** `workflows`. **Who writes:** written with the submission. **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| gate_submission_id | uuid | NOT NULL |  | FK → gate_submission(id) |
| criterion_key | text | NOT NULL |  | FK → gate_criterion_definition(key) |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 20)))` |
| mandatory | boolean | NOT NULL |  |  |
| completeness | text | NOT NULL |  | `CHECK ((completeness = ANY (ARRAY['complete', 'incomplete'])))` |
| detail | jsonb | NOT NULL | `'{}'` | `CHECK ((jsonb_typeof(detail) = 'object'))` |
| evaluated_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `gate_submission_criterion_key` (UNIQUE): `UNIQUE (gate_submission_id, criterion_key)`
- `gate_submission_criterion_mandatory_complete` (CHECK): `CHECK (((NOT mandatory) OR (completeness = 'complete')))`

**Triggers:**

- `gate_submission_criterion_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `gate_submission_criterion_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `gate_submission_criterion_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## gate_decision

- **Purpose:** The approval record of a gate submission (assignee basis, request version, rationale, timestamp); specialises a canonical decision row of kind gate.
- **Migration:** `0017_p2_decisions_gates.sql`. **API module:** `workflows`. **Who writes:** configured approver with gate.decide (default SP); never the submitter. **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| gate_submission_id | uuid | NOT NULL |  | FK → gate_submission(id); UNIQUE (`gate_decision_gate_submission_id_key`) |
| decision_id | uuid | NOT NULL |  | UNIQUE (`gate_decision_decision_id_key`) |
| decision_kind | text | NOT NULL | `'gate'` | `CHECK ((decision_kind = 'gate'))` |
| gate_code | text | NOT NULL |  | FK → gate_definition(code) |
| submission_no | integer | NOT NULL |  | `CHECK ((submission_no >= 1))` |
| outcome | text | NOT NULL |  | `CHECK ((outcome = ANY (ARRAY['approved', 'rejected', 'changes_requested', 'deferred'])))` |
| rationale | text | NOT NULL |  | `CHECK (((char_length(rationale) >= 3) AND (char_length(rationale) <= 8000)))` |
| comments | text | NULL |  | `CHECK (((comments IS NULL) OR ((char_length(comments) >= 1) AND (char_length(comments) <= 8000))))` |
| decided_by | uuid | NOT NULL |  | FK → app_user(id) |
| on_behalf_of_user_id | uuid | NULL |  | FK → app_user(id) |
| decided_at | timestamp with time zone | NOT NULL | `now()` |  |
| approver_basis | text | NOT NULL |  | `CHECK ((approver_basis = ANY (ARRAY['configured_user', 'configured_role', 'default_role'])))` |
| approver_role_code | text | NOT NULL |  | FK → role(code) |

**Table constraints:**

- `gate_decision_decision_fkey` (FK): `FOREIGN KEY (decision_id, decision_kind) REFERENCES decision(id, kind)`

**Triggers:**

- `gate_decision_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `gate_decision_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `gate_decision_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `gate_decision_guard`: BEFORE INSERT FOR EACH ROW → `gate_decision_guard()`
- `gate_decision_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## role_accountability

- **Purpose:** Accountability text per role, shown on role assignments (REQ-PB-012; source text from B0018).
- **Migration:** `0018_p2_access_instantiation.sql`. **API module:** `access`. **Who writes:** seed (read-only). **Lifecycle:** —.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| role_id | uuid | NOT NULL |  | PK; FK → role(id) |
| accountability_en | text | NOT NULL |  | `CHECK (((char_length(accountability_en) >= 1) AND (char_length(accountability_en) <= 1000)))` |
| accountability_ar | text | NOT NULL |  | `CHECK (((char_length(accountability_ar) >= 1) AND (char_length(accountability_ar) <= 1000)))` |
| is_source_text | boolean | NOT NULL |  |  |
| source_ref | text | NOT NULL |  | `CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 50)))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

## P2 functions

| Function | Migration | Purpose | Callable by `mth_app` |
|---|---|---|---|
| `mth_uuid_v7()` | 0010 | RFC 9562 UUIDv7 for rows created inside SQL (instantiation, backfills); never a column default | yes |
| `p2_row_guard()`, `p2_audit_required()`, `p2_append_only()`, `p2_record_ref_guard()` | 0010 | record guards (triggers only) | via triggers |
| `p2_attach_guards(regclass, boolean)`, `p2_attach_append_only(regclass)` | 0010 | migration helpers | no (owner only) |
| `methodology_version_published_immutable()`, `tom_dimension_source_immutable()` | 0011 | catalogue immutability | via triggers |
| `outcome_hierarchy_guard()` | 0013 | outcome tree acyclic, ≤ 6 levels (advisory lock per transformation) | via trigger |
| `charter_version_required()` | 0013 | every committed charter version has its snapshot | via trigger |
| `tom_workshop_close_guard()` | 0017 | no closing with open unresolved items | via trigger |
| `gate_instance_approver_allowed()` | 0017 | approver role ∈ gate's allowed roles | via trigger |
| `gate_submission_freeze()` | 0017 | submission facts and snapshot immutable; status final once out of pending | via trigger |
| `gate_decision_guard()` | 0017 | submitter never decides (SoD → API 403); only the current pending submission (→ API 409) | via trigger |
| `p2_instantiate_transformation(uuid, uuid, text, text)` | 0018 | idempotent starter structure with audit events | yes |

## P2 validation rules summary

| Layer | What it checks |
|---|---|
| Database | Everything above, plus the P2 record guards (version step, audit coverage, append-only, same-transformation references) and the per-template rules: T01 confidence H/M/L and the six seeded rows; T02 target date NOT NULL; T03 dimension NOT NULL; T04 code format, default `open`, chosen option when decided. Also unquantified value pools never carry amounts, a filename is never verified evidence, and gate SoD/staleness. |
| API (`@mth/shared/schemas`) | Shapes (OpenAPI `docs/api/openapi.yaml` P2 schemas), decimal strings within the column scale, ISO dates, one-sentence North Star, journey step shape, trajectory points |
| Service | Permissions and record-level rules (ADR-0020), If-Match, status transitions, gate criteria evaluation (ADR-0015), charter versioning (ADR-0017), evidence verification (ADR-0018), totals with an unquantified count (ADR-0019) |

---

# P3 tables (migrations 0020–0024, DG3)

- **Task:** T-DG3-ARCH-01 (solution-architect), 2026-10-07. **ADRs:** ADR-0021 (portfolio, lifecycle, G4, G1 extension), ADR-0022 (prioritization), ADR-0023 (roadmap, dependencies, capacity, funding), ADR-0024 (business case, formula foundation).
- **Global rules** are those at the top of this file and the P2 record guards (`p2_attach_guards`: row guard, version step by 1, deferred audit coverage; `p2_attach_append_only` on history and decision tables). Money `numeric(20,4)`, measures and formula values `numeric(24,6)`, weights `numeric(5,2)`, weighted scores `numeric(7,4)`, FTE `numeric(6,2)`; no floating point.
- **No DELETE** grant on any P3 table.

## roadmap_wave

- **Purpose:** T07 wave of one transformation (B0079). The four source waves are instantiated with VERBATIM text (immutable); horizons may overlap (ADR-0023 §1).
- **Migration:** `0020_p3_portfolio_roadmap.sql`. **API module:** `portfolio`. **Who writes:** system (instantiation); roadmap.edit (TL, TO, WL) for planned dates, owner, notes and added waves. **Lifecycle:** active → archived (seeded waves never archived).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| code | text | NOT NULL |  | `CHECK ((code ~ '^[a-z][a-z0-9_]{0,47}$'))` |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 0) AND (ordinal <= 99)))` |
| is_source_seeded | boolean | NOT NULL | `false` |  |
| source_ref | text | NULL |  | `CHECK (((source_ref IS NULL) OR ((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 50))))` |
| name_en | text | NOT NULL |  | `CHECK (((char_length(name_en) >= 1) AND (char_length(name_en) <= 200)))` |
| name_ar | text | NOT NULL |  | `CHECK (((char_length(name_ar) >= 1) AND (char_length(name_ar) <= 200)))` |
| purpose_en | text | NOT NULL |  | `CHECK (((char_length(purpose_en) >= 1) AND (char_length(purpose_en) <= 500)))` |
| purpose_ar | text | NOT NULL |  | `CHECK (((char_length(purpose_ar) >= 1) AND (char_length(purpose_ar) <= 500)))` |
| horizon_en | text | NOT NULL |  | `CHECK (((char_length(horizon_en) >= 1) AND (char_length(horizon_en) <= 100)))` |
| horizon_ar | text | NOT NULL |  | `CHECK (((char_length(horizon_ar) >= 1) AND (char_length(horizon_ar) <= 100)))` |
| entry_criteria_en | text | NOT NULL |  | `CHECK (((char_length(entry_criteria_en) >= 1) AND (char_length(entry_criteria_en) <= 500)))` |
| entry_criteria_ar | text | NOT NULL |  | `CHECK (((char_length(entry_criteria_ar) >= 1) AND (char_length(entry_criteria_ar) <= 500)))` |
| exit_evidence_en | text | NOT NULL |  | `CHECK (((char_length(exit_evidence_en) >= 1) AND (char_length(exit_evidence_en) <= 500)))` |
| exit_evidence_ar | text | NOT NULL |  | `CHECK (((char_length(exit_evidence_ar) >= 1) AND (char_length(exit_evidence_ar) <= 500)))` |
| horizon_from_weeks | smallint | NOT NULL |  | `CHECK (((horizon_from_weeks >= 0) AND (horizon_from_weeks <= 520)))` |
| horizon_to_weeks | smallint | NOT NULL |  | `CHECK (((horizon_to_weeks >= 0) AND (horizon_to_weeks <= 520)))` |
| planned_start | date | NULL |  |  |
| planned_end | date | NULL |  |  |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| notes | text | NULL |  | `CHECK (((notes IS NULL) OR ((char_length(notes) >= 1) AND (char_length(notes) <= 4000))))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `roadmap_wave_code_key` (UNIQUE): `UNIQUE (transformation_id, code)`
- `roadmap_wave_horizon_range` (CHECK): `CHECK ((horizon_to_weeks >= horizon_from_weeks))`
- `roadmap_wave_planned_range` (CHECK): `CHECK (((planned_end IS NULL) OR (planned_start IS NULL) OR (planned_end >= planned_start)))`
- `roadmap_wave_seeded_has_source` (CHECK): `CHECK (((NOT is_source_seeded) OR (source_ref IS NOT NULL)))`
- `roadmap_wave_seeded_not_archived` (CHECK): `CHECK ((NOT (is_source_seeded AND (status = 'archived'))))`
- `roadmap_wave_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `roadmap_wave_transformation_idx`: `(transformation_id, ordinal)`

**Triggers:**

- `roadmap_wave_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `roadmap_wave_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`
- `roadmap_wave_source_immutable`: BEFORE UPDATE FOR EACH ROW → `roadmap_wave_source_immutable()`

## initiative

- **Purpose:** T05 Initiative Card (B0072) and the portfolio lifecycle (ADR-0021 §2–§3). A vehicle, never part of the TOM (B0059).
- **Migration:** `0020_p3_portfolio_roadmap.sql`. **API module:** `portfolio`. **Who writes:** initiative.edit (TL, WL, TO); initiative.launch (TL); status mirrors selection/funding records. **Lifecycle:** draft → submitted → ranked → selected → funded → launched → completed; cancelled (edges: `initiative_status_step`).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| code | text | NOT NULL |  | `CHECK ((code ~ '^INI-[0-9]{2,6}$'))` |
| name | text | NOT NULL |  | `CHECK (((char_length(name) >= 1) AND (char_length(name) <= 300)))` |
| executive_owner_user_id | uuid | NULL |  | FK → app_user(id) |
| workstream_lead_user_id | uuid | NULL |  | FK → app_user(id) |
| problem_statement | text | NULL |  | `CHECK (((problem_statement IS NULL) OR ((char_length(problem_statement) >= 1) AND (char_length(problem_statement) <= 8000))))` |
| objective | text | NULL |  | `CHECK (((objective IS NULL) OR ((char_length(objective) >= 1) AND (char_length(objective) <= 4000))))` |
| scope_in | text | NULL |  | `CHECK (((scope_in IS NULL) OR ((char_length(scope_in) >= 1) AND (char_length(scope_in) <= 8000))))` |
| scope_out | text | NULL |  | `CHECK (((scope_out IS NULL) OR ((char_length(scope_out) >= 1) AND (char_length(scope_out) <= 8000))))` |
| financial_benefit_summary | text | NULL |  | `CHECK (((financial_benefit_summary IS NULL) OR ((char_length(financial_benefit_summary) >= 1) AND (char_length(financial_benefit_summary) <= 4000))))` |
| customer_benefit_summary | text | NULL |  | `CHECK (((customer_benefit_summary IS NULL) OR ((char_length(customer_benefit_summary) >= 1) AND (char_length(customer_benefit_summary) <= 4000))))` |
| risks_summary | text | NULL |  | `CHECK (((risks_summary IS NULL) OR ((char_length(risks_summary) >= 1) AND (char_length(risks_summary) <= 4000))))` |
| wave_id | uuid | NULL |  |  |
| planned_start | date | NULL |  |  |
| planned_end | date | NULL |  |  |
| status | text | NOT NULL | `'draft'` | `CHECK ((status = ANY (ARRAY['draft', 'submitted', 'ranked', 'selected', 'funded', 'launched', 'completed', 'cancelled'])))` |
| launched_at | timestamp with time zone | NULL |  |  |
| launched_by | uuid | NULL |  | FK → app_user(id) |
| cancelled_at | timestamp with time zone | NULL |  |  |
| cancelled_by | uuid | NULL |  | FK → app_user(id) |
| cancel_reason | text | NULL |  | `CHECK (((cancel_reason IS NULL) OR ((char_length(cancel_reason) >= 3) AND (char_length(cancel_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `initiative_cancelled_complete` (CHECK): `CHECK ((((status = 'cancelled') = (cancelled_at IS NOT NULL)) AND ((cancelled_at IS NULL) = (cancelled_by IS NULL)) AND ((cancelled_at IS NULL) = (cancel_reason IS NULL))))`
- `initiative_code_key` (UNIQUE): `UNIQUE (transformation_id, code)`
- `initiative_launched_complete` (CHECK): `CHECK ((((status = ANY (ARRAY['launched', 'completed'])) = (launched_at IS NOT NULL)) AND ((launched_at IS NULL) = (launched_by IS NULL))))`
- `initiative_planned_range` (CHECK): `CHECK (((planned_end IS NULL) OR (planned_start IS NULL) OR (planned_end >= planned_start)))`
- `initiative_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`
- `initiative_wave_id_fkey` (FK): `FOREIGN KEY (transformation_id, wave_id) REFERENCES roadmap_wave(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Indexes:**

- `initiative_status_idx`: `(transformation_id, status)`
- `initiative_transformation_updated_idx`: `(transformation_id, updated_at DESC, id DESC)`
- `initiative_wave_idx`: `(wave_id) WHERE (wave_id IS NOT NULL)`

**Triggers:**

- `initiative_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `initiative_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`
- `initiative_status_step`: BEFORE UPDATE OF status FOR EACH ROW → `initiative_status_step()`

## initiative_gap_link

- **Purpose:** T05 'Problem / gap addressed': the initiative is a vehicle for a TOM gap (T03) or a diagnosed finding; never TOM evidence (REQ-PB-040, REQ-PB-046).
- **Migration:** `0020_p3_portfolio_roadmap.sql`. **API module:** `portfolio`. **Who writes:** initiative.edit. **Lifecycle:** active → removed.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| initiative_id | uuid | NOT NULL |  |  |
| target_type | text | NOT NULL |  | `CHECK ((target_type = ANY (ARRAY['tom_gap', 'diagnostic_finding'])))` |
| tom_gap_id | uuid | NULL |  |  |
| diagnostic_finding_id | uuid | NULL |  |  |
| note | text | NULL |  | `CHECK (((note IS NULL) OR ((char_length(note) >= 1) AND (char_length(note) <= 2000))))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'removed'])))` |
| removed_at | timestamp with time zone | NULL |  |  |
| removed_by | uuid | NULL |  | FK → app_user(id) |
| remove_reason | text | NULL |  | `CHECK (((remove_reason IS NULL) OR ((char_length(remove_reason) >= 3) AND (char_length(remove_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `initiative_gap_link_diagnostic_finding_id_fkey` (FK): `FOREIGN KEY (transformation_id, diagnostic_finding_id) REFERENCES diagnostic_finding(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `initiative_gap_link_initiative_id_fkey` (FK): `FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `initiative_gap_link_one_target` (CHECK): `CHECK ((((target_type = 'tom_gap') = (tom_gap_id IS NOT NULL)) AND ((target_type = 'diagnostic_finding') = (diagnostic_finding_id IS NOT NULL))))`
- `initiative_gap_link_removal_complete` (CHECK): `CHECK ((((status = 'removed') = (removed_at IS NOT NULL)) AND ((removed_at IS NULL) = (removed_by IS NULL)) AND ((removed_at IS NULL) = (remove_reason IS NULL))))`
- `initiative_gap_link_tom_gap_id_fkey` (FK): `FOREIGN KEY (transformation_id, tom_gap_id) REFERENCES tom_gap(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Indexes:**

- `initiative_gap_link_finding_active_key`: `UNIQUE (initiative_id, diagnostic_finding_id) WHERE ((status = 'active'::text) AND (diagnostic_finding_id IS NOT NULL))`
- `initiative_gap_link_initiative_idx`: `(initiative_id) WHERE (status = 'active'::text)`
- `initiative_gap_link_tom_gap_active_key`: `UNIQUE (initiative_id, tom_gap_id) WHERE ((status = 'active'::text) AND (tom_gap_id IS NOT NULL))`

**Triggers:**

- `initiative_gap_link_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `initiative_gap_link_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## initiative_outcome_contribution

- **Purpose:** T05 'Outcome/KPI contribution', fifth level of the outcome hierarchy (B0048); outcome mandatory, T02 row (KPI) optional and must belong to the outcome (REQ-PB-032, REQ-PB-006).
- **Migration:** `0020_p3_portfolio_roadmap.sql`. **API module:** `portfolio`. **Who writes:** initiative.edit. **Lifecycle:** active → removed.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| initiative_id | uuid | NOT NULL |  |  |
| outcome_id | uuid | NOT NULL |  |  |
| outcome_kpi_id | uuid | NULL |  |  |
| contribution_statement | text | NOT NULL |  | `CHECK (((char_length(contribution_statement) >= 1) AND (char_length(contribution_statement) <= 2000)))` |
| expected_kpi_movement | text | NULL |  | `CHECK (((expected_kpi_movement IS NULL) OR ((char_length(expected_kpi_movement) >= 1) AND (char_length(expected_kpi_movement) <= 500))))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'removed'])))` |
| removed_at | timestamp with time zone | NULL |  |  |
| removed_by | uuid | NULL |  | FK → app_user(id) |
| remove_reason | text | NULL |  | `CHECK (((remove_reason IS NULL) OR ((char_length(remove_reason) >= 3) AND (char_length(remove_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `initiative_outcome_contribution_initiative_id_fkey` (FK): `FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `initiative_outcome_contribution_outcome_id_fkey` (FK): `FOREIGN KEY (transformation_id, outcome_id) REFERENCES outcome(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `initiative_outcome_contribution_outcome_kpi_id_fkey` (FK): `FOREIGN KEY (transformation_id, outcome_kpi_id) REFERENCES outcome_kpi(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `initiative_outcome_contribution_removal_complete` (CHECK): `CHECK ((((status = 'removed') = (removed_at IS NOT NULL)) AND ((removed_at IS NULL) = (removed_by IS NULL)) AND ((removed_at IS NULL) = (remove_reason IS NULL))))`

**Indexes:**

- `initiative_outcome_contribution_initiative_idx`: `(initiative_id) WHERE (status = 'active'::text)`
- `initiative_outcome_contribution_outcome_idx`: `(outcome_id) WHERE (status = 'active'::text)`

**Triggers:**

- `initiative_contribution_kpi_matches_outcome`: BEFORE INSERT OR UPDATE OF outcome_id, outcome_kpi_id FOR EACH ROW → `initiative_contribution_kpi_matches_outcome()`
- `initiative_outcome_contribution_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `initiative_outcome_contribution_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## initiative_decision_link

- **Purpose:** T05 'Required decisions': references to canonical `decision` rows (owner and due date come from the decision).
- **Migration:** `0020_p3_portfolio_roadmap.sql`. **API module:** `portfolio`. **Who writes:** initiative.edit. **Lifecycle:** active → removed.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| initiative_id | uuid | NOT NULL |  |  |
| decision_id | uuid | NOT NULL |  |  |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'removed'])))` |
| removed_at | timestamp with time zone | NULL |  |  |
| removed_by | uuid | NULL |  | FK → app_user(id) |
| remove_reason | text | NULL |  | `CHECK (((remove_reason IS NULL) OR ((char_length(remove_reason) >= 3) AND (char_length(remove_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `initiative_decision_link_decision_id_fkey` (FK): `FOREIGN KEY (transformation_id, decision_id) REFERENCES decision(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `initiative_decision_link_initiative_id_fkey` (FK): `FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `initiative_decision_link_removal_complete` (CHECK): `CHECK ((((status = 'removed') = (removed_at IS NOT NULL)) AND ((removed_at IS NULL) = (removed_by IS NULL)) AND ((removed_at IS NULL) = (remove_reason IS NULL))))`

**Indexes:**

- `initiative_decision_link_active_key`: `UNIQUE (initiative_id, decision_id) WHERE (status = 'active'::text)`

**Triggers:**

- `initiative_decision_link_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `initiative_decision_link_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## deliverable

- **Purpose:** T05 'Key deliverables' (3–7 is a warning) with acceptance status (ADR-0023 §2).
- **Migration:** `0020_p3_portfolio_roadmap.sql`. **API module:** `portfolio`. **Who writes:** initiative.edit; deliverable.accept (SP, TL, BO) and record-level executive owner for acceptance. **Lifecycle:** acceptance pending → submitted → accepted | rejected (rejected → submitted); status active → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| initiative_id | uuid | NOT NULL |  |  |
| ordinal | smallint | NOT NULL | `1` | `CHECK (((ordinal >= 1) AND (ordinal <= 999)))` |
| title | text | NOT NULL |  | `CHECK (((char_length(title) >= 1) AND (char_length(title) <= 300)))` |
| description | text | NULL |  | `CHECK (((description IS NULL) OR ((char_length(description) >= 1) AND (char_length(description) <= 4000))))` |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| due_date | date | NULL |  |  |
| acceptance_status | text | NOT NULL | `'pending'` | `CHECK ((acceptance_status = ANY (ARRAY['pending', 'submitted', 'accepted', 'rejected'])))` |
| submitted_by | uuid | NULL |  | FK → app_user(id) |
| submitted_at | timestamp with time zone | NULL |  |  |
| decided_by | uuid | NULL |  | FK → app_user(id) |
| decided_at | timestamp with time zone | NULL |  |  |
| acceptance_note | text | NULL |  | `CHECK (((acceptance_note IS NULL) OR ((char_length(acceptance_note) >= 1) AND (char_length(acceptance_note) <= 2000))))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `deliverable_acceptor_not_submitter` (CHECK): `CHECK (((decided_by IS NULL) OR (decided_by <> submitted_by)))`
- `deliverable_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `deliverable_decided_complete` (CHECK): `CHECK ((((acceptance_status = ANY (ARRAY['accepted', 'rejected'])) = (decided_at IS NOT NULL)) AND ((decided_at IS NULL) = (decided_by IS NULL))))`
- `deliverable_initiative_id_fkey` (FK): `FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `deliverable_submitted_complete` (CHECK): `CHECK ((((acceptance_status = ANY (ARRAY['submitted', 'accepted', 'rejected'])) = (submitted_at IS NOT NULL)) AND ((submitted_at IS NULL) = (submitted_by IS NULL))))`
- `deliverable_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `deliverable_initiative_idx`: `(initiative_id, ordinal) WHERE (status = 'active'::text)`

**Triggers:**

- `deliverable_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `deliverable_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## milestone

- **Purpose:** T05/T07 milestone with approved (baseline) vs forecast date (ADR-0023 §2).
- **Migration:** `0020_p3_portfolio_roadmap.sql`. **API module:** `portfolio`. **Who writes:** roadmap.edit / initiative.edit (forecast); roadmap.approve (TL, TO) for the approved date. **Lifecycle:** planned → achieved | missed | cancelled.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| initiative_id | uuid | NOT NULL |  |  |
| wave_id | uuid | NULL |  |  |
| title | text | NOT NULL |  | `CHECK (((char_length(title) >= 1) AND (char_length(title) <= 300)))` |
| description | text | NULL |  | `CHECK (((description IS NULL) OR ((char_length(description) >= 1) AND (char_length(description) <= 4000))))` |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| approved_date | date | NULL |  |  |
| approved_by | uuid | NULL |  | FK → app_user(id) |
| approved_at | timestamp with time zone | NULL |  |  |
| approval_reason | text | NULL |  | `CHECK (((approval_reason IS NULL) OR ((char_length(approval_reason) >= 3) AND (char_length(approval_reason) <= 1000))))` |
| forecast_date | date | NULL |  |  |
| actual_date | date | NULL |  |  |
| status | text | NOT NULL | `'planned'` | `CHECK ((status = ANY (ARRAY['planned', 'achieved', 'missed', 'cancelled'])))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `milestone_achieved_actual` (CHECK): `CHECK (((status = 'achieved') = (actual_date IS NOT NULL)))`
- `milestone_approved_complete` (CHECK): `CHECK ((((approved_date IS NULL) = (approved_by IS NULL)) AND ((approved_by IS NULL) = (approved_at IS NULL))))`
- `milestone_initiative_id_fkey` (FK): `FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `milestone_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`
- `milestone_wave_id_fkey` (FK): `FOREIGN KEY (transformation_id, wave_id) REFERENCES roadmap_wave(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Indexes:**

- `milestone_initiative_idx`: `(initiative_id)`
- `milestone_transformation_forecast_idx`: `(transformation_id, forecast_date)`

**Triggers:**

- `milestone_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `milestone_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## gate_dispensation

- **Purpose:** Modular inherited approval (captured as verified evidence, never a gate decision) or End-to-End waiver for G1–G3 sequencing (ADR-0021 §5).
- **Migration:** `0020_p3_portfolio_roadmap.sql`. **API module:** `portfolio`. **Who writes:** gate.submit records; gate.decide holder (not the recorder) accepts/rejects/revokes. **Lifecycle:** pending → accepted | rejected; accepted → revoked.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| kind | text | NOT NULL |  | `CHECK ((kind = ANY (ARRAY['inherited_approval', 'waiver'])))` |
| gate_code | text | NOT NULL |  | FK → gate_definition(code) |
| initiative_id | uuid | NULL |  |  |
| reason | text | NULL |  | `CHECK (((reason IS NULL) OR ((char_length(reason) >= 3) AND (char_length(reason) <= 4000))))` |
| approving_body | text | NULL |  | `CHECK (((approving_body IS NULL) OR ((char_length(approving_body) >= 1) AND (char_length(approving_body) <= 300))))` |
| approved_on | date | NULL |  |  |
| evidence_id | uuid | NULL |  |  |
| expires_on | date | NULL |  |  |
| status | text | NOT NULL | `'pending'` | `CHECK ((status = ANY (ARRAY['pending', 'accepted', 'rejected', 'revoked'])))` |
| recorded_by | uuid | NOT NULL |  | FK → app_user(id) |
| decided_by | uuid | NULL |  | FK → app_user(id) |
| decided_at | timestamp with time zone | NULL |  |  |
| decision_note | text | NULL |  | `CHECK (((decision_note IS NULL) OR ((char_length(decision_note) >= 1) AND (char_length(decision_note) <= 2000))))` |
| revoked_by | uuid | NULL |  | FK → app_user(id) |
| revoked_at | timestamp with time zone | NULL |  |  |
| revoke_reason | text | NULL |  | `CHECK (((revoke_reason IS NULL) OR ((char_length(revoke_reason) >= 3) AND (char_length(revoke_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `gate_dispensation_decided_complete` (CHECK): `CHECK ((((status = ANY (ARRAY['accepted', 'rejected', 'revoked'])) = (decided_at IS NOT NULL)) AND ((decided_at IS NULL) = (decided_by IS NULL))))`
- `gate_dispensation_decider_not_recorder` (CHECK): `CHECK (((decided_by IS NULL) OR (decided_by <> recorded_by)))`
- `gate_dispensation_evidence_id_fkey` (FK): `FOREIGN KEY (transformation_id, evidence_id) REFERENCES evidence(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `gate_dispensation_gate` (CHECK): `CHECK ((gate_code = ANY (ARRAY['G1', 'G2', 'G3'])))`
- `gate_dispensation_inherited_shape` (CHECK): `CHECK (((kind <> 'inherited_approval') OR ((evidence_id IS NOT NULL) AND (approving_body IS NOT NULL) AND (approved_on IS NOT NULL) AND (initiative_id IS NULL))))`
- `gate_dispensation_initiative_id_fkey` (FK): `FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `gate_dispensation_revoked_complete` (CHECK): `CHECK ((((status = 'revoked') = (revoked_at IS NOT NULL)) AND ((revoked_at IS NULL) = (revoked_by IS NULL)) AND ((revoked_at IS NULL) = (revoke_reason IS NULL))))`
- `gate_dispensation_waiver_shape` (CHECK): `CHECK (((kind <> 'waiver') OR ((reason IS NOT NULL) AND (evidence_id IS NULL) AND (approving_body IS NULL) AND (approved_on IS NULL))))`

**Indexes:**

- `gate_dispensation_transformation_idx`: `(transformation_id, gate_code, status)`

**Triggers:**

- `gate_dispensation_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `gate_dispensation_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## scoring_weight_set

- **Purpose:** Versioned, immutable T06 weight set per transformation; v1 = source defaults (B0076), instantiated by `p3_instantiate_transformation()` (ADR-0022 §1).
- **Migration:** `0021_p3_prioritization.sql`. **API module:** `portfolio`. **Who writes:** prioritization.edit (TL, TO) proposes; prioritization.approve (SP) activates; never the proposer. **Lifecycle:** proposed → active → superseded; proposed → withdrawn.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| version_no | integer | NOT NULL |  | `CHECK ((version_no >= 1))` |
| status | text | NOT NULL | `'proposed'` | `CHECK ((status = ANY (ARRAY['proposed', 'active', 'superseded', 'withdrawn'])))` |
| approval_basis | text | NULL |  | `CHECK (((approval_basis IS NULL) OR (approval_basis = ANY (ARRAY['source_default', 'approved']))))` |
| rationale | text | NULL |  | `CHECK (((rationale IS NULL) OR ((char_length(rationale) >= 1) AND (char_length(rationale) <= 4000))))` |
| approved_by | uuid | NULL |  | FK → app_user(id) |
| approved_at | timestamp with time zone | NULL |  |  |
| activated_at | timestamp with time zone | NULL |  |  |
| superseded_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `scoring_weight_set_activated_complete` (CHECK): `CHECK ((((status = ANY (ARRAY['active', 'superseded'])) = (activated_at IS NOT NULL)) AND ((activated_at IS NULL) = (approval_basis IS NULL))))`
- `scoring_weight_set_approval_complete` (CHECK): `CHECK ((((approved_by IS NULL) = (approved_at IS NULL)) AND ((approval_basis IS DISTINCT FROM 'approved') OR (approved_by IS NOT NULL)) AND ((approval_basis IS DISTINCT FROM 'source_default') OR (approved_by IS NULL))))`
- `scoring_weight_set_approver_not_proposer` (CHECK): `CHECK (((approved_by IS NULL) OR (approved_by <> created_by)))`
- `scoring_weight_set_id_version_no_key` (UNIQUE): `UNIQUE (id, version_no)`
- `scoring_weight_set_superseded_complete` (CHECK): `CHECK (((status = 'superseded') = (superseded_at IS NOT NULL)))`
- `scoring_weight_set_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`
- `scoring_weight_set_version_no_key` (UNIQUE): `UNIQUE (transformation_id, version_no)`

**Indexes:**

- `scoring_weight_set_one_active_key`: `UNIQUE (transformation_id) WHERE (status = 'active'::text)`

**Triggers:**

- `scoring_weight_set_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `scoring_weight_set_freeze`: BEFORE UPDATE FOR EACH ROW → `scoring_weight_set_freeze()`
- `scoring_weight_set_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`
- `scoring_weight_set_total`: CONSTRAINT AFTER INSERT DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `scoring_weight_set_total()`

## scoring_weight

- **Purpose:** One weight of a weight set (percent, two decimals); a set totals exactly 100.00 over 2–6 criteria (deferred check).
- **Migration:** `0021_p3_prioritization.sql`. **API module:** `portfolio`. **Who writes:** with its weight set. **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| weight_set_id | uuid | NOT NULL |  |  |
| criterion_code | text | NOT NULL |  | `CHECK ((criterion_code = ANY (ARRAY['strategic_fit', 'financial_value', 'customer_impact', 'feasibility', 'time_to_value', 'risk_compliance'])))` |
| weight_percent | numeric(5,2) | NOT NULL |  | `CHECK (((weight_percent > (0)::numeric) AND (weight_percent <= (100)::numeric)))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `scoring_weight_criterion_key` (UNIQUE): `UNIQUE (weight_set_id, criterion_code)`
- `scoring_weight_weight_set_id_fkey` (FK): `FOREIGN KEY (transformation_id, weight_set_id) REFERENCES scoring_weight_set(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Triggers:**

- `scoring_weight_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `scoring_weight_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `scoring_weight_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`
- `scoring_weight_total`: CONSTRAINT AFTER INSERT DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `scoring_weight_set_total()`

## initiative_score

- **Purpose:** Current 1–5 T06 score of an initiative on one criterion (NULL = cleared).
- **Migration:** `0021_p3_prioritization.sql`. **API module:** `portfolio`. **Who writes:** prioritization.score (TL, WL, BO). **Lifecycle:** —.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| initiative_id | uuid | NOT NULL |  |  |
| criterion_code | text | NOT NULL |  | `CHECK ((criterion_code = ANY (ARRAY['strategic_fit', 'financial_value', 'customer_impact', 'feasibility', 'time_to_value', 'risk_compliance'])))` |
| score | smallint | NULL |  | `CHECK (((score IS NULL) OR ((score >= 1) AND (score <= 5))))` |
| note | text | NULL |  | `CHECK (((note IS NULL) OR ((char_length(note) >= 1) AND (char_length(note) <= 2000))))` |
| scored_by | uuid | NULL |  | FK → app_user(id) |
| scored_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `initiative_score_criterion_key` (UNIQUE): `UNIQUE (initiative_id, criterion_code)`
- `initiative_score_initiative_id_fkey` (FK): `FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `initiative_score_scored_complete` (CHECK): `CHECK ((((score IS NULL) = (scored_by IS NULL)) AND ((scored_by IS NULL) = (scored_at IS NULL))))`

**Triggers:**

- `initiative_score_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `initiative_score_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## initiative_score_result

- **Purpose:** Calculated weighted score, pinned to the weight-set version it used; NULL = incomplete, never 0 (ADR-0022 §2).
- **Migration:** `0021_p3_prioritization.sql`. **API module:** `portfolio`. **Who writes:** system (on score change / weight-set activation). **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| initiative_id | uuid | NOT NULL |  |  |
| weight_set_id | uuid | NOT NULL |  |  |
| weight_set_version_no | integer | NOT NULL |  | `CHECK ((weight_set_version_no >= 1))` |
| weighted_score | numeric(7,4) | NULL |  | `CHECK (((weighted_score IS NULL) OR ((weighted_score >= (1)::numeric) AND (weighted_score <= (5)::numeric))))` |
| completeness | text | NOT NULL |  | `CHECK ((completeness = ANY (ARRAY['complete', 'incomplete'])))` |
| missing_criteria | text[] | NOT NULL | `'{}'::text[]` |  |
| inputs | jsonb | NOT NULL |  | `CHECK ((jsonb_typeof(inputs) = 'object'))` |
| cause | text | NOT NULL |  | `CHECK ((cause = ANY (ARRAY['initial', 'score_change', 'weight_set_activated'])))` |
| computed_at | timestamp with time zone | NOT NULL | `now()` |  |
| computed_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `initiative_score_result_complete` (CHECK): `CHECK ((((completeness = 'complete') = (weighted_score IS NOT NULL)) AND ((completeness = 'complete') = (cardinality(missing_criteria) = 0))))`
- `initiative_score_result_initiative_id_fkey` (FK): `FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `initiative_score_result_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`
- `initiative_score_result_weight_set_fkey` (FK): `FOREIGN KEY (weight_set_id, weight_set_version_no) REFERENCES scoring_weight_set(id, version_no) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Indexes:**

- `initiative_score_result_latest_idx`: `(initiative_id, weight_set_id, computed_at DESC, id DESC)`

**Triggers:**

- `initiative_score_result_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `initiative_score_result_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `initiative_score_result_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## ranking_snapshot

- **Purpose:** A proposed ranking (advisory; never a selection) under one weight set (ADR-0022 §4).
- **Migration:** `0021_p3_prioritization.sql`. **API module:** `portfolio`. **Who writes:** prioritization.edit (TL, TO). **Lifecycle:** current → superseded.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| snapshot_no | integer | NOT NULL |  | `CHECK ((snapshot_no >= 1))` |
| weight_set_id | uuid | NOT NULL |  |  |
| status | text | NOT NULL | `'current'` | `CHECK ((status = ANY (ARRAY['current', 'superseded'])))` |
| note | text | NULL |  | `CHECK (((note IS NULL) OR ((char_length(note) >= 1) AND (char_length(note) <= 2000))))` |
| proposed_by | uuid | NOT NULL |  | FK → app_user(id) |
| proposed_at | timestamp with time zone | NOT NULL | `now()` |  |
| superseded_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `ranking_snapshot_no_key` (UNIQUE): `UNIQUE (transformation_id, snapshot_no)`
- `ranking_snapshot_superseded_complete` (CHECK): `CHECK (((status = 'superseded') = (superseded_at IS NOT NULL)))`
- `ranking_snapshot_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`
- `ranking_snapshot_weight_set_id_fkey` (FK): `FOREIGN KEY (transformation_id, weight_set_id) REFERENCES scoring_weight_set(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Indexes:**

- `ranking_snapshot_one_current_key`: `UNIQUE (transformation_id) WHERE (status = 'current'::text)`

**Triggers:**

- `ranking_snapshot_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `ranking_snapshot_freeze`: BEFORE UPDATE FOR EACH ROW → `ranking_snapshot_freeze()`
- `ranking_snapshot_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## ranking_override

- **Purpose:** A manual rank with a mandatory reason and an approver who is not the proposer (REQ-S09-005).
- **Migration:** `0021_p3_prioritization.sql`. **API module:** `portfolio`. **Who writes:** prioritization.edit proposes; prioritization.approve (SP) decides. **Lifecycle:** proposed → approved | rejected; approved → revoked.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| initiative_id | uuid | NOT NULL |  |  |
| override_rank | integer | NOT NULL |  | `CHECK ((override_rank >= 1))` |
| reason | text | NOT NULL |  | `CHECK (((char_length(reason) >= 3) AND (char_length(reason) <= 2000)))` |
| status | text | NOT NULL | `'proposed'` | `CHECK ((status = ANY (ARRAY['proposed', 'approved', 'rejected', 'revoked'])))` |
| proposed_by | uuid | NOT NULL |  | FK → app_user(id) |
| decided_by | uuid | NULL |  | FK → app_user(id) |
| decided_at | timestamp with time zone | NULL |  |  |
| decision_note | text | NULL |  | `CHECK (((decision_note IS NULL) OR ((char_length(decision_note) >= 1) AND (char_length(decision_note) <= 2000))))` |
| revoked_by | uuid | NULL |  | FK → app_user(id) |
| revoked_at | timestamp with time zone | NULL |  |  |
| revoke_reason | text | NULL |  | `CHECK (((revoke_reason IS NULL) OR ((char_length(revoke_reason) >= 3) AND (char_length(revoke_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `ranking_override_approver_not_proposer` (CHECK): `CHECK (((decided_by IS NULL) OR (decided_by <> proposed_by)))`
- `ranking_override_decided_complete` (CHECK): `CHECK ((((status = ANY (ARRAY['approved', 'rejected', 'revoked'])) = (decided_at IS NOT NULL)) AND ((decided_at IS NULL) = (decided_by IS NULL))))`
- `ranking_override_initiative_id_fkey` (FK): `FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `ranking_override_revoked_complete` (CHECK): `CHECK ((((status = 'revoked') = (revoked_at IS NOT NULL)) AND ((revoked_at IS NULL) = (revoked_by IS NULL)) AND ((revoked_at IS NULL) = (revoke_reason IS NULL))))`
- `ranking_override_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `ranking_override_one_live_key`: `UNIQUE (initiative_id) WHERE (status = ANY (ARRAY['proposed'::text, 'approved'::text]))`

**Triggers:**

- `ranking_override_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `ranking_override_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## ranking_entry

- **Purpose:** One initiative in one ranking snapshot, with its rank-change causes (new, score, weight, override, relative, removed).
- **Migration:** `0021_p3_prioritization.sql`. **API module:** `portfolio`. **Who writes:** with its snapshot. **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| snapshot_id | uuid | NOT NULL |  |  |
| initiative_id | uuid | NOT NULL |  |  |
| rank | integer | NULL |  | `CHECK (((rank IS NULL) OR (rank >= 1)))` |
| weighted_score | numeric(7,4) | NULL |  | `CHECK (((weighted_score IS NULL) OR ((weighted_score >= (1)::numeric) AND (weighted_score <= (5)::numeric))))` |
| completeness | text | NOT NULL |  | `CHECK ((completeness = ANY (ARRAY['complete', 'incomplete', 'removed'])))` |
| score_result_id | uuid | NULL |  |  |
| previous_rank | integer | NULL |  | `CHECK (((previous_rank IS NULL) OR (previous_rank >= 1)))` |
| causes | text[] | NOT NULL | `'{}'::text[]` | `CHECK ((causes <@ ARRAY['new', 'score', 'weight', 'override', 'relative', 'removed']))` |
| cause_detail | jsonb | NOT NULL | `'{}'::jsonb` | `CHECK ((jsonb_typeof(cause_detail) = 'object'))` |
| override_id | uuid | NULL |  |  |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `ranking_entry_initiative_id_fkey` (FK): `FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `ranking_entry_initiative_key` (UNIQUE): `UNIQUE (snapshot_id, initiative_id)`
- `ranking_entry_override_id_fkey` (FK): `FOREIGN KEY (transformation_id, override_id) REFERENCES ranking_override(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `ranking_entry_rank_complete` (CHECK): `CHECK ((((rank IS NOT NULL) = (completeness = 'complete')) AND ((completeness = 'complete') = (weighted_score IS NOT NULL))))`
- `ranking_entry_score_result_id_fkey` (FK): `FOREIGN KEY (transformation_id, score_result_id) REFERENCES initiative_score_result(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `ranking_entry_snapshot_id_fkey` (FK): `FOREIGN KEY (transformation_id, snapshot_id) REFERENCES ranking_snapshot(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Indexes:**

- `ranking_entry_initiative_idx`: `(initiative_id, created_at DESC)`
- `ranking_entry_rank_key`: `UNIQUE (snapshot_id, rank) WHERE (rank IS NOT NULL)`

**Triggers:**

- `ranking_entry_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `ranking_entry_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `ranking_entry_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## dependency_type

- **Purpose:** T08 dependency types: Decision/Tech/Data/Vendor (B0081) and Other are system rows that cannot be deleted or retired; admins add types (REQ-PB-052).
- **Migration:** `0022_p3_dependency_capacity_funding.sql`. **API module:** `workflows`. **Who writes:** seed; dependency_type.configure (ADM_METHOD). **Lifecycle:** active → retired (custom only); never deleted.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| code | text | NOT NULL |  | `CHECK ((code ~ '^[a-z][a-z0-9_]{1,47}$'))`; UNIQUE (`dependency_type_code_key`) |
| label_en | text | NOT NULL |  | `CHECK (((char_length(label_en) >= 1) AND (char_length(label_en) <= 100)))` |
| label_ar | text | NOT NULL |  | `CHECK (((char_length(label_ar) >= 1) AND (char_length(label_ar) <= 100)))` |
| is_system | boolean | NOT NULL | `false` |  |
| source_ref | text | NULL |  | `CHECK (((source_ref IS NULL) OR ((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 50))))` |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 999)))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'retired'])))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `dependency_type_system_active` (CHECK): `CHECK (((NOT is_system) OR (status = 'active')))`

**Triggers:**

- `dependency_type_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `dependency_type_no_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `dependency_type_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`
- `dependency_type_system_guard`: BEFORE DELETE OR UPDATE FOR EACH ROW → `dependency_type_system_guard()`

## resource_role

- **Purpose:** Resourcing role of one transformation (not an access role).
- **Migration:** `0022_p3_dependency_capacity_funding.sql`. **API module:** `portfolio`. **Who writes:** capacity.edit (TL, WL, TO). **Lifecycle:** active → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| code | text | NOT NULL |  | `CHECK ((code ~ '^[a-z][a-z0-9_]{0,47}$'))` |
| label_en | text | NOT NULL |  | `CHECK (((char_length(label_en) >= 1) AND (char_length(label_en) <= 200)))` |
| label_ar | text | NOT NULL |  | `CHECK (((char_length(label_ar) >= 1) AND (char_length(label_ar) <= 200)))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `resource_role_code_key` (UNIQUE): `UNIQUE (transformation_id, code)`
- `resource_role_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Triggers:**

- `resource_role_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `resource_role_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## capacity

- **Purpose:** Available FTE of one resourcing role in one month (REQ-PB-059).
- **Migration:** `0022_p3_dependency_capacity_funding.sql`. **API module:** `portfolio`. **Who writes:** capacity.edit. **Lifecycle:** active → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| resource_role_id | uuid | NOT NULL |  |  |
| period_month | date | NOT NULL |  | `CHECK ((EXTRACT(day FROM period_month) = (1)::numeric))` |
| available_fte | numeric(6,2) | NOT NULL |  | `CHECK ((available_fte >= (0)::numeric))` |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| note | text | NULL |  | `CHECK (((note IS NULL) OR ((char_length(note) >= 1) AND (char_length(note) <= 2000))))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `capacity_resource_role_id_fkey` (FK): `FOREIGN KEY (transformation_id, resource_role_id) REFERENCES resource_role(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Indexes:**

- `capacity_role_month_active_key`: `UNIQUE (resource_role_id, period_month) WHERE (status = 'active'::text)`
- `capacity_transformation_month_idx`: `(transformation_id, period_month)`

**Triggers:**

- `capacity_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `capacity_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## resource_demand

- **Purpose:** FTE an initiative needs from a role in a month; `committed` is the capacity commitment G4 requires (ADR-0023 §6).
- **Migration:** `0022_p3_dependency_capacity_funding.sql`. **API module:** `portfolio`. **Who writes:** capacity.edit plans; capacity.commit (TO, BO) commits/releases. **Lifecycle:** planned → committed → released; → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| initiative_id | uuid | NOT NULL |  |  |
| resource_role_id | uuid | NOT NULL |  |  |
| period_month | date | NOT NULL |  | `CHECK ((EXTRACT(day FROM period_month) = (1)::numeric))` |
| demand_fte | numeric(6,2) | NOT NULL |  | `CHECK ((demand_fte > (0)::numeric))` |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| note | text | NULL |  | `CHECK (((note IS NULL) OR ((char_length(note) >= 1) AND (char_length(note) <= 2000))))` |
| status | text | NOT NULL | `'planned'` | `CHECK ((status = ANY (ARRAY['planned', 'committed', 'released', 'archived'])))` |
| committed_by | uuid | NULL |  | FK → app_user(id) |
| committed_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `resource_demand_committed_complete` (CHECK): `CHECK ((((committed_at IS NULL) = (committed_by IS NULL)) AND ((status <> 'committed') OR (committed_at IS NOT NULL))))`
- `resource_demand_initiative_id_fkey` (FK): `FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `resource_demand_resource_role_id_fkey` (FK): `FOREIGN KEY (transformation_id, resource_role_id) REFERENCES resource_role(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Indexes:**

- `resource_demand_initiative_idx`: `(initiative_id)`
- `resource_demand_role_month_idx`: `(resource_role_id, period_month) WHERE (status = ANY (ARRAY['planned'::text, 'committed'::text]))`

**Triggers:**

- `resource_demand_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `resource_demand_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## portfolio_selection

- **Purpose:** Approved portfolio selection decision (business approval, REQ-S09-003); the latest row per initiative decides.
- **Migration:** `0022_p3_dependency_capacity_funding.sql`. **API module:** `portfolio`. **Who writes:** portfolio.select (SP). **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| initiative_id | uuid | NOT NULL |  |  |
| action | text | NOT NULL |  | `CHECK ((action = ANY (ARRAY['selected', 'deselected'])))` |
| rationale | text | NOT NULL |  | `CHECK (((char_length(rationale) >= 3) AND (char_length(rationale) <= 4000)))` |
| ranking_snapshot_id | uuid | NULL |  |  |
| decided_by | uuid | NOT NULL |  | FK → app_user(id) |
| on_behalf_of_user_id | uuid | NULL |  | FK → app_user(id) |
| decided_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `portfolio_selection_initiative_id_fkey` (FK): `FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `portfolio_selection_ranking_snapshot_id_fkey` (FK): `FOREIGN KEY (transformation_id, ranking_snapshot_id) REFERENCES ranking_snapshot(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `portfolio_selection_selected_from_ranking` (CHECK): `CHECK (((action <> 'selected') OR (ranking_snapshot_id IS NOT NULL)))`

**Indexes:**

- `portfolio_selection_initiative_idx`: `(initiative_id, decided_at DESC, id DESC)`

**Triggers:**

- `portfolio_selection_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `portfolio_selection_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `portfolio_selection_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `portfolio_selection_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## funding_decision

- **Purpose:** Recorded human funding decision (business approval) for one initiative, specialising a canonical `decision` row of kind `executive` (ADR-0023 §7); latest row decides.
- **Migration:** `0022_p3_dependency_capacity_funding.sql (business_case FK added by 0023)`. **API module:** `portfolio`. **Who writes:** funding.approve (SP, FIN). **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| initiative_id | uuid | NOT NULL |  |  |
| decision_id | uuid | NOT NULL |  | UNIQUE (`funding_decision_decision_id_key`) |
| decision_kind | text | NOT NULL | `'executive'` | `CHECK ((decision_kind = 'executive'))` |
| outcome | text | NOT NULL |  | `CHECK ((outcome = ANY (ARRAY['approved', 'rejected', 'deferred', 'revoked'])))` |
| amount | numeric(20,4) | NULL |  | `CHECK (((amount IS NULL) OR (amount >= (0)::numeric)))` |
| currency | character(3) | NOT NULL |  | `CHECK ((currency ~ '^[A-Z]{3}$'))` |
| funding_source | text | NULL |  | `CHECK (((funding_source IS NULL) OR ((char_length(funding_source) >= 1) AND (char_length(funding_source) <= 300))))` |
| conditions | text | NULL |  | `CHECK (((conditions IS NULL) OR ((char_length(conditions) >= 1) AND (char_length(conditions) <= 4000))))` |
| rationale | text | NOT NULL |  | `CHECK (((char_length(rationale) >= 3) AND (char_length(rationale) <= 8000)))` |
| business_case_id | uuid | NULL |  |  |
| approver_role_code | text | NOT NULL |  | FK → role(code) |
| decided_by | uuid | NOT NULL |  | FK → app_user(id) |
| on_behalf_of_user_id | uuid | NULL |  | FK → app_user(id) |
| decided_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `funding_decision_business_case_id_fkey` (FK): `FOREIGN KEY (transformation_id, business_case_id) REFERENCES business_case(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `funding_decision_decision_fkey` (FK): `FOREIGN KEY (decision_id, decision_kind) REFERENCES decision(id, kind) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `funding_decision_initiative_id_fkey` (FK): `FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `funding_decision_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `funding_decision_initiative_idx`: `(initiative_id, decided_at DESC, id DESC)`

**Triggers:**

- `funding_decision_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `funding_decision_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `funding_decision_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `funding_decision_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## benefit_formula

- **Purpose:** T09 Benefit Formula row (B0087): benefit, baseline driver, change assumption, formula (= current version), ramp, confidence H/M/L.
- **Migration:** `0023_p3_business_case_formula.sql`. **API module:** `kpi`. **Who writes:** benefit_formula.edit (TL, BO, KDS). **Lifecycle:** active → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| code | text | NOT NULL |  | `CHECK ((code ~ '^BF-[0-9]{2,6}$'))` |
| benefit_name | text | NOT NULL |  | `CHECK (((char_length(benefit_name) >= 1) AND (char_length(benefit_name) <= 300)))` |
| baseline_driver | text | NULL |  | `CHECK (((baseline_driver IS NULL) OR ((char_length(baseline_driver) >= 1) AND (char_length(baseline_driver) <= 1000))))` |
| change_assumption | text | NULL |  | `CHECK (((change_assumption IS NULL) OR ((char_length(change_assumption) >= 1) AND (char_length(change_assumption) <= 1000))))` |
| ramp | text | NULL |  | `CHECK (((ramp IS NULL) OR ((char_length(ramp) >= 1) AND (char_length(ramp) <= 100))))` |
| confidence | character(1) | NULL |  | `CHECK (((confidence IS NULL) OR (confidence = ANY (ARRAY['H'::bpchar, 'M'::bpchar, 'L'::bpchar]))))` |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| current_version_no | integer | NULL |  | `CHECK (((current_version_no IS NULL) OR (current_version_no >= 1)))` |
| is_illustrative | boolean | NOT NULL | `false` |  |
| example_code | text | NULL |  | `CHECK (((example_code IS NULL) OR (example_code = ANY (ARRAY['revenue_uplift', 'cost_reduction']))))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `benefit_formula_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `benefit_formula_code_key` (UNIQUE): `UNIQUE (transformation_id, code)`
- `benefit_formula_current_version_fkey` (FK): `FOREIGN KEY (id, current_version_no) REFERENCES benefit_formula_version(formula_id, version_no) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_formula_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `benefit_formula_transformation_updated_idx`: `(transformation_id, updated_at DESC, id DESC)`

**Triggers:**

- `benefit_formula_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `benefit_formula_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## benefit_formula_version

- **Purpose:** Immutable restricted-language expression (ADR-0024 §6) with its Finance validation (validator ≠ author).
- **Migration:** `0023_p3_business_case_formula.sql`. **API module:** `kpi`. **Who writes:** benefit_formula.edit creates; finance.validate (FIN) validates. **Lifecycle:** validation unvalidated → validated | rejected (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| formula_id | uuid | NOT NULL |  |  |
| version_no | integer | NOT NULL |  | `CHECK ((version_no >= 1))` |
| expression | text | NOT NULL |  | `CHECK (((char_length(expression) >= 1) AND (char_length(expression) <= 2000)))` |
| expression_sha256 | character(64) | NOT NULL |  | `CHECK ((expression_sha256 ~ '^[0-9a-f]{64}$'))` |
| result_kind | text | NOT NULL |  | `CHECK ((result_kind = ANY (ARRAY['fraction', 'fraction_delta', 'percent_change', 'count', 'currency', 'quantity', 'number'])))` |
| result_unit | text | NULL |  | `CHECK (((result_unit IS NULL) OR ((char_length(result_unit) >= 1) AND (char_length(result_unit) <= 50))))` |
| result_currency | character(3) | NULL |  | `CHECK (((result_currency IS NULL) OR (result_currency ~ '^[A-Z]{3}$')))` |
| result_period | text | NOT NULL |  | `CHECK ((result_period = ANY (ARRAY['none', 'month', 'quarter', 'year'])))` |
| preview_result | numeric(24,6) | NULL |  |  |
| engine_version | text | NOT NULL |  | `CHECK (((char_length(engine_version) >= 1) AND (char_length(engine_version) <= 50)))` |
| change_note | text | NULL |  | `CHECK (((change_note IS NULL) OR ((char_length(change_note) >= 1) AND (char_length(change_note) <= 2000))))` |
| validation_status | text | NOT NULL | `'unvalidated'` | `CHECK ((validation_status = ANY (ARRAY['unvalidated', 'validated', 'rejected'])))` |
| validated_by | uuid | NULL |  | FK → app_user(id) |
| validated_at | timestamp with time zone | NULL |  |  |
| validation_note | text | NULL |  | `CHECK (((validation_note IS NULL) OR ((char_length(validation_note) >= 1) AND (char_length(validation_note) <= 2000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `benefit_formula_version_currency_kind` (CHECK): `CHECK (((result_kind = 'currency') = (result_currency IS NOT NULL)))`
- `benefit_formula_version_formula_id_fkey` (FK): `FOREIGN KEY (transformation_id, formula_id) REFERENCES benefit_formula(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_formula_version_no_key` (UNIQUE): `UNIQUE (formula_id, version_no)`
- `benefit_formula_version_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`
- `benefit_formula_version_validation_complete` (CHECK): `CHECK ((((validation_status = 'unvalidated') = (validated_by IS NULL)) AND ((validated_by IS NULL) = (validated_at IS NULL))))`
- `benefit_formula_version_validator_not_author` (CHECK): `CHECK (((validated_by IS NULL) OR (validated_by <> created_by)))`

**Triggers:**

- `benefit_formula_version_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `benefit_formula_version_freeze`: BEFORE UPDATE FOR EACH ROW → `benefit_formula_version_freeze()`
- `benefit_formula_version_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## benefit_formula_variable

- **Purpose:** Typed variable of one formula version: kind (fraction, fraction_delta, percent_change, count, currency, quantity, number), unit, currency, period.
- **Migration:** `0023_p3_business_case_formula.sql`. **API module:** `kpi`. **Who writes:** with its version. **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| formula_version_id | uuid | NOT NULL |  |  |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 30)))` |
| name | text | NOT NULL |  | `CHECK ((name ~ '^[a-z][a-z0-9_]{0,47}$'))` |
| kind | text | NOT NULL |  | `CHECK ((kind = ANY (ARRAY['fraction', 'fraction_delta', 'percent_change', 'count', 'currency', 'quantity', 'number'])))` |
| unit | text | NULL |  | `CHECK (((unit IS NULL) OR ((char_length(unit) >= 1) AND (char_length(unit) <= 50))))` |
| currency | character(3) | NULL |  | `CHECK (((currency IS NULL) OR (currency ~ '^[A-Z]{3}$')))` |
| period | text | NOT NULL | `'none'` | `CHECK ((period = ANY (ARRAY['none', 'month', 'quarter', 'year'])))` |
| value | numeric(24,6) | NULL |  |  |
| description | text | NULL |  | `CHECK (((description IS NULL) OR ((char_length(description) >= 1) AND (char_length(description) <= 1000))))` |
| source | text | NULL |  | `CHECK (((source IS NULL) OR ((char_length(source) >= 1) AND (char_length(source) <= 500))))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `benefit_formula_variable_currency_kind` (CHECK): `CHECK (((kind = 'currency') = (currency IS NOT NULL)))`
- `benefit_formula_variable_name_key` (UNIQUE): `UNIQUE (formula_version_id, name)`
- `benefit_formula_variable_ordinal_key` (UNIQUE): `UNIQUE (formula_version_id, ordinal)`
- `benefit_formula_variable_reserved_name` (CHECK): `CHECK ((name <> ALL (ARRAY['to_period', 'min', 'max', 'abs', 'month', 'quarter', 'year'])))`
- `benefit_formula_variable_version_id_fkey` (FK): `FOREIGN KEY (transformation_id, formula_version_id) REFERENCES benefit_formula_version(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Triggers:**

- `benefit_formula_variable_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `benefit_formula_variable_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `benefit_formula_variable_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## benefit_calculation

- **Purpose:** Calculation lineage: inputs, formula version, assumptions, period, result (NULL = Unknown), engine version.
- **Migration:** `0023_p3_business_case_formula.sql`; column `rounding` added by `0027_p3_calculation_rounding.sql` (T-DG3-ARCH-04, ADR-0024 §6 item 11). **API module:** `kpi`. **Who writes:** system (preview/calculation). **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.
- **`rounding` (0027):** the engine's rounding record `{column, scale, mode, precision, exact, stored, rounded, inexactIntermediate}` as is. It is NULL only on rows written before 0027: there is no backfill, because the table is append-only and each such row's record is already in its `benefit_calculation.create` audit event. `benefit_calculation_rounding_required` is `NOT VALID`, so PostgreSQL enforces it on every new row but does not check the older ones. `benefit_calculation_rounding_shape` binds `rounded` to the column and `stored` to `result::text` (JSON null when the result is Unknown).

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| formula_version_id | uuid | NOT NULL |  |  |
| inputs | jsonb | NOT NULL |  | `CHECK ((jsonb_typeof(inputs) = 'object'))` |
| assumptions | text | NULL |  | `CHECK (((assumptions IS NULL) OR ((char_length(assumptions) >= 1) AND (char_length(assumptions) <= 4000))))` |
| period_start | date | NULL |  |  |
| period_end | date | NULL |  |  |
| outcome | text | NOT NULL |  | `CHECK ((outcome = ANY (ARRAY['ok', 'error'])))` |
| result | numeric(24,6) | NULL |  |  |
| result_kind | text | NOT NULL |  | `CHECK ((result_kind = ANY (ARRAY['fraction', 'fraction_delta', 'percent_change', 'count', 'currency', 'quantity', 'number'])))` |
| result_unit | text | NULL |  | `CHECK (((result_unit IS NULL) OR ((char_length(result_unit) >= 1) AND (char_length(result_unit) <= 50))))` |
| result_currency | character(3) | NULL |  | `CHECK (((result_currency IS NULL) OR (result_currency ~ '^[A-Z]{3}$')))` |
| result_period | text | NOT NULL |  | `CHECK ((result_period = ANY (ARRAY['none', 'month', 'quarter', 'year'])))` |
| error_code | text | NULL |  | `CHECK (((error_code IS NULL) OR (error_code ~ '^formula\.[a-z_]{1,48}$')))` |
| rounded | boolean | NOT NULL | `false` |  |
| engine_version | text | NOT NULL |  | `CHECK (((char_length(engine_version) >= 1) AND (char_length(engine_version) <= 50)))` |
| computed_at | timestamp with time zone | NOT NULL | `now()` |  |
| computed_by | uuid | NOT NULL |  | FK → app_user(id) |
| rounding | jsonb | NULL |  | `CHECK (((rounding IS NULL) OR (jsonb_typeof(rounding) = 'object')))` |

**Table constraints:**

- `benefit_calculation_rounding_required` (CHECK, NOT VALID): `CHECK ((rounding IS NOT NULL)) NOT VALID`
- `benefit_calculation_rounding_shape` (CHECK): `CHECK (((rounding IS NULL) OR ((rounding ?& ARRAY['column', 'scale', 'mode', 'precision', 'exact', 'stored', 'rounded', 'inexactIntermediate']) AND ((rounding -> 'column') = '"numeric(24,6)"'::jsonb) AND ((rounding -> 'scale') = '6'::jsonb) AND ((rounding -> 'mode') = '"ROUND_HALF_UP"'::jsonb) AND ((rounding -> 'precision') = '80'::jsonb) AND (jsonb_typeof((rounding -> 'exact')) = ANY (ARRAY['string', 'null'])) AND (jsonb_typeof((rounding -> 'inexactIntermediate')) = 'boolean') AND ((rounding -> 'rounded') = to_jsonb(rounded)) AND ((rounding -> 'stored') = CASE WHEN (result IS NULL) THEN 'null'::jsonb ELSE to_jsonb((result)::text) END))))`
- `benefit_calculation_outcome_shape` (CHECK): `CHECK ((((outcome = 'error') = (error_code IS NOT NULL)) AND ((outcome = 'ok') OR (result IS NULL))))`
- `benefit_calculation_period_range` (CHECK): `CHECK (((period_end IS NULL) OR (period_start IS NULL) OR (period_end >= period_start)))`
- `benefit_calculation_version_id_fkey` (FK): `FOREIGN KEY (transformation_id, formula_version_id) REFERENCES benefit_formula_version(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Indexes:**

- `benefit_calculation_version_idx`: `(formula_version_id, computed_at DESC)`

**Triggers:**

- `benefit_calculation_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `benefit_calculation_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `benefit_calculation_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## business_case

- **Purpose:** Transformation-level business case (ten B0085 sections) or a lighter initiative case linked to it (ADR-0024 §1, §3), with the Finance baseline validation.
- **Migration:** `0023_p3_business_case_formula.sql`. **API module:** `kpi`. **Who writes:** business_case.edit (TL, WL record-level, TO); finance.validate (FIN) validates the baseline. **Lifecycle:** draft → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| code | text | NOT NULL |  | `CHECK ((code ~ '^BC-[0-9]{2,6}$'))` |
| level | text | NOT NULL |  | `CHECK ((level = ANY (ARRAY['transformation', 'initiative'])))` |
| initiative_id | uuid | NULL |  |  |
| parent_case_id | uuid | NULL |  |  |
| title | text | NOT NULL |  | `CHECK (((char_length(title) >= 1) AND (char_length(title) <= 300)))` |
| currency | character(3) | NOT NULL |  | `CHECK ((currency ~ '^[A-Z]{3}$'))` |
| strategic_rationale | text | NULL |  | `CHECK (((strategic_rationale IS NULL) OR ((char_length(strategic_rationale) >= 1) AND (char_length(strategic_rationale) <= 20000))))` |
| baseline_summary | text | NULL |  | `CHECK (((baseline_summary IS NULL) OR ((char_length(baseline_summary) >= 1) AND (char_length(baseline_summary) <= 20000))))` |
| value_pools_summary | text | NULL |  | `CHECK (((value_pools_summary IS NULL) OR ((char_length(value_pools_summary) >= 1) AND (char_length(value_pools_summary) <= 20000))))` |
| interventions_summary | text | NULL |  | `CHECK (((interventions_summary IS NULL) OR ((char_length(interventions_summary) >= 1) AND (char_length(interventions_summary) <= 20000))))` |
| investment_summary | text | NULL |  | `CHECK (((investment_summary IS NULL) OR ((char_length(investment_summary) >= 1) AND (char_length(investment_summary) <= 20000))))` |
| benefits_summary | text | NULL |  | `CHECK (((benefits_summary IS NULL) OR ((char_length(benefits_summary) >= 1) AND (char_length(benefits_summary) <= 20000))))` |
| benefit_ramp | text | NULL |  | `CHECK (((benefit_ramp IS NULL) OR ((char_length(benefit_ramp) >= 1) AND (char_length(benefit_ramp) <= 4000))))` |
| recurrence_summary | text | NULL |  | `CHECK (((recurrence_summary IS NULL) OR ((char_length(recurrence_summary) >= 1) AND (char_length(recurrence_summary) <= 4000))))` |
| implementation_horizon | text | NULL |  | `CHECK (((implementation_horizon IS NULL) OR ((char_length(implementation_horizon) >= 1) AND (char_length(implementation_horizon) <= 4000))))` |
| key_assumptions | text | NULL |  | `CHECK (((key_assumptions IS NULL) OR ((char_length(key_assumptions) >= 1) AND (char_length(key_assumptions) <= 20000))))` |
| downside_case | text | NULL |  | `CHECK (((downside_case IS NULL) OR ((char_length(downside_case) >= 1) AND (char_length(downside_case) <= 8000))))` |
| upside_case | text | NULL |  | `CHECK (((upside_case IS NULL) OR ((char_length(upside_case) >= 1) AND (char_length(upside_case) <= 8000))))` |
| benefit_owner_user_id | uuid | NULL |  | FK → app_user(id) |
| initiative_owner_user_id | uuid | NULL |  | FK → app_user(id) |
| finance_validator_user_id | uuid | NULL |  | FK → app_user(id) |
| decision_ask_types | text[] | NOT NULL | `'{}'::text[]` | `CHECK ((decision_ask_types <@ ARRAY['funding', 'policy', 'resource', 'prioritization']))` |
| decision_ask_text | text | NULL |  | `CHECK (((decision_ask_text IS NULL) OR ((char_length(decision_ask_text) >= 1) AND (char_length(decision_ask_text) <= 8000))))` |
| baseline_validation_status | text | NOT NULL | `'unvalidated'` | `CHECK ((baseline_validation_status = ANY (ARRAY['unvalidated', 'validated', 'rejected'])))` |
| baseline_validated_by | uuid | NULL |  | FK → app_user(id) |
| baseline_validated_at | timestamp with time zone | NULL |  |  |
| baseline_validation_note | text | NULL |  | `CHECK (((baseline_validation_note IS NULL) OR ((char_length(baseline_validation_note) >= 1) AND (char_length(baseline_validation_note) <= 2000))))` |
| baseline_validated_sha256 | character(64) | NULL |  | `CHECK (((baseline_validated_sha256 IS NULL) OR (baseline_validated_sha256 ~ '^[0-9a-f]{64}$')))` |
| status | text | NOT NULL | `'draft'` | `CHECK ((status = ANY (ARRAY['draft', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `business_case_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `business_case_baseline_validation_complete` (CHECK): `CHECK ((((baseline_validation_status = 'unvalidated') = (baseline_validated_by IS NULL)) AND ((baseline_validated_by IS NULL) = (baseline_validated_at IS NULL)) AND ((baseline_validation_status = 'validated') = (baseline_validated_sha256 IS NOT NULL))))`
- `business_case_code_key` (UNIQUE): `UNIQUE (transformation_id, code)`
- `business_case_initiative_id_fkey` (FK): `FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `business_case_level_shape` (CHECK): `CHECK ((((level = 'transformation') AND (initiative_id IS NULL) AND (parent_case_id IS NULL)) OR ((level = 'initiative') AND (initiative_id IS NOT NULL) AND (parent_case_id IS NOT NULL))))`
- `business_case_parent_case_id_fkey` (FK): `FOREIGN KEY (transformation_id, parent_case_id) REFERENCES business_case(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `business_case_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`
- `business_case_validator_not_author` (CHECK): `CHECK (((baseline_validated_by IS NULL) OR (baseline_validated_by <> created_by)))`

**Indexes:**

- `business_case_one_initiative_case_key`: `UNIQUE (initiative_id) WHERE ((level = 'initiative'::text) AND (status <> 'archived'::text))`
- `business_case_one_transformation_case_key`: `UNIQUE (transformation_id) WHERE ((level = 'transformation'::text) AND (status <> 'archived'::text))`
- `business_case_parent_idx`: `(parent_case_id) WHERE (parent_case_id IS NOT NULL)`

**Triggers:**

- `business_case_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `business_case_parent_is_transformation`: BEFORE INSERT OR UPDATE OF parent_case_id FOR EACH ROW → `business_case_parent_is_transformation()`
- `business_case_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## business_case_line

- **Purpose:** Investment or benefit line with exactly one class and a value basis; one T09 formula backs at most one active line (ADR-0024 §2).
- **Migration:** `0023_p3_business_case_formula.sql`. **API module:** `kpi`. **Who writes:** business_case.edit. **Lifecycle:** active → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| business_case_id | uuid | NOT NULL |  |  |
| line_kind | text | NOT NULL |  | `CHECK ((line_kind = ANY (ARRAY['investment', 'benefit'])))` |
| investment_class | text | NULL |  | `CHECK (((investment_class IS NULL) OR (investment_class = ANY (ARRAY['capex', 'opex', 'internal_fte', 'vendor_cost', 'opportunity_cost']))))` |
| benefit_class | text | NULL |  | `CHECK (((benefit_class IS NULL) OR (benefit_class = ANY (ARRAY['revenue', 'cost_reduction', 'cost_avoidance', 'working_capital', 'strategic_non_financial']))))` |
| value_basis | text | NOT NULL |  | `CHECK ((value_basis = ANY (ARRAY['revenue_uplift', 'margin_uplift', 'cash_saving', 'avoided_cost', 'working_capital_release', 'non_financial', 'cash', 'non_cash'])))` |
| title | text | NOT NULL |  | `CHECK (((char_length(title) >= 1) AND (char_length(title) <= 300)))` |
| description | text | NULL |  | `CHECK (((description IS NULL) OR ((char_length(description) >= 1) AND (char_length(description) <= 4000))))` |
| amount | numeric(20,4) | NULL |  | `CHECK (((amount IS NULL) OR (amount >= (0)::numeric)))` |
| currency | character(3) | NOT NULL |  | `CHECK ((currency ~ '^[A-Z]{3}$'))` |
| fte | numeric(6,2) | NULL |  | `CHECK (((fte IS NULL) OR (fte > (0)::numeric)))` |
| period_start | date | NULL |  |  |
| period_end | date | NULL |  |  |
| recurrence | text | NULL |  | `CHECK (((recurrence IS NULL) OR (recurrence = ANY (ARRAY['one_off', 'recurring']))))` |
| benefit_formula_id | uuid | NULL |  |  |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `business_case_line_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `business_case_line_case_id_fkey` (FK): `FOREIGN KEY (transformation_id, business_case_id) REFERENCES business_case(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `business_case_line_formula_id_fkey` (FK): `FOREIGN KEY (transformation_id, benefit_formula_id) REFERENCES benefit_formula(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `business_case_line_formula_only_benefit` (CHECK): `CHECK (((benefit_formula_id IS NULL) OR (line_kind = 'benefit')))`
- `business_case_line_fte_only_internal` (CHECK): `CHECK (((fte IS NULL) OR (investment_class = 'internal_fte')))`
- `business_case_line_non_financial_unmonetised` (CHECK): `CHECK (((benefit_class IS DISTINCT FROM 'strategic_non_financial') OR (amount IS NULL)))`
- `business_case_line_one_class` (CHECK): `CHECK (((num_nonnulls(investment_class, benefit_class) = 1) AND ((line_kind = 'investment') = (investment_class IS NOT NULL))))`
- `business_case_line_period_range` (CHECK): `CHECK (((period_end IS NULL) OR (period_start IS NULL) OR (period_end >= period_start)))`
- `business_case_line_value_basis` (CHECK): `CHECK ((((investment_class = ANY (ARRAY['capex', 'opex', 'vendor_cost'])) AND (value_basis = 'cash')) OR ((investment_class = ANY (ARRAY['internal_fte', 'opportunity_cost'])) AND (value_basis = 'non_cash')) OR ((benefit_class = 'revenue') AND (value_basis = ANY (ARRAY['revenue_uplift', 'margin_uplift']))) OR ((benefit_class = 'cost_reduction') AND (value_basis = 'cash_saving')) OR ((benefit_class = 'cost_avoidance') AND (value_basis = 'avoided_cost')) OR ((benefit_class = 'working_capital') AND (value_basis = 'working_capital_release')) OR ((benefit_class = 'strategic_non_financial') AND (value_basis = 'non_financial'))))`

**Indexes:**

- `business_case_line_case_idx`: `(business_case_id) WHERE (status = 'active'::text)`
- `business_case_line_one_formula_key`: `UNIQUE (benefit_formula_id) WHERE ((status = 'active'::text) AND (benefit_formula_id IS NOT NULL))`

**Triggers:**

- `business_case_line_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `business_case_line_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## benefit_formula_example

- **Purpose:** The two B0087 source examples, ILLUSTRATIVE with synthetic values (REQ-PB-057).
- **Migration:** `0023_p3_business_case_formula.sql`. **API module:** `kpi`. **Who writes:** seed. **Lifecycle:** —.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| code | text | NOT NULL |  | UNIQUE (`benefit_formula_example_code_key`) |
| methodology_version_id | uuid | NOT NULL |  | FK → methodology_version(id) |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 99)))` |
| source_benefit_en | text | NOT NULL |  | `CHECK (((char_length(source_benefit_en) >= 1) AND (char_length(source_benefit_en) <= 200)))` |
| source_baseline_driver_en | text | NOT NULL |  | `CHECK (((char_length(source_baseline_driver_en) >= 1) AND (char_length(source_baseline_driver_en) <= 300)))` |
| source_change_assumption_en | text | NOT NULL |  | `CHECK (((char_length(source_change_assumption_en) >= 1) AND (char_length(source_change_assumption_en) <= 300)))` |
| source_formula_en | text | NOT NULL |  | `CHECK (((char_length(source_formula_en) >= 1) AND (char_length(source_formula_en) <= 300)))` |
| source_ramp_en | text | NOT NULL |  | `CHECK (((char_length(source_ramp_en) >= 1) AND (char_length(source_ramp_en) <= 50)))` |
| source_confidence | character(1) | NOT NULL |  | `CHECK ((source_confidence = ANY (ARRAY['H'::bpchar, 'M'::bpchar, 'L'::bpchar])))` |
| benefit_ar | text | NOT NULL |  | `CHECK (((char_length(benefit_ar) >= 1) AND (char_length(benefit_ar) <= 200)))` |
| baseline_driver_ar | text | NOT NULL |  | `CHECK (((char_length(baseline_driver_ar) >= 1) AND (char_length(baseline_driver_ar) <= 300)))` |
| change_assumption_ar | text | NOT NULL |  | `CHECK (((char_length(change_assumption_ar) >= 1) AND (char_length(change_assumption_ar) <= 300)))` |
| formula_ar | text | NOT NULL |  | `CHECK (((char_length(formula_ar) >= 1) AND (char_length(formula_ar) <= 300)))` |
| expression | text | NOT NULL |  | `CHECK (((char_length(expression) >= 1) AND (char_length(expression) <= 2000)))` |
| result_kind | text | NOT NULL |  | `CHECK ((result_kind = ANY (ARRAY['currency', 'count', 'quantity', 'number'])))` |
| result_currency | character(3) | NULL |  | `CHECK (((result_currency IS NULL) OR (result_currency ~ '^[A-Z]{3}$')))` |
| result_period | text | NOT NULL |  | `CHECK ((result_period = ANY (ARRAY['none', 'month', 'quarter', 'year'])))` |
| example_result | numeric(24,6) | NOT NULL |  |  |
| is_illustrative | boolean | NOT NULL | `true` | `CHECK (is_illustrative)` |
| source_ref | text | NOT NULL |  | `CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 50)))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `benefit_formula_example_code_check1` (CHECK): `CHECK ((code ~ '^[a-z][a-z0-9_]{0,47}$'))`

## benefit_formula_example_variable

- **Purpose:** Typed variables and illustrative values of a seeded example.
- **Migration:** `0023_p3_business_case_formula.sql`. **API module:** `kpi`. **Who writes:** seed. **Lifecycle:** —.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| example_id | uuid | NOT NULL |  | FK → benefit_formula_example(id) |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 30)))` |
| name | text | NOT NULL |  | `CHECK ((name ~ '^[a-z][a-z0-9_]{0,47}$'))` |
| kind | text | NOT NULL |  | `CHECK ((kind = ANY (ARRAY['fraction', 'fraction_delta', 'percent_change', 'count', 'currency', 'quantity', 'number'])))` |
| unit | text | NULL |  | `CHECK (((unit IS NULL) OR ((char_length(unit) >= 1) AND (char_length(unit) <= 50))))` |
| currency | character(3) | NULL |  | `CHECK (((currency IS NULL) OR (currency ~ '^[A-Z]{3}$')))` |
| period | text | NOT NULL |  | `CHECK ((period = ANY (ARRAY['none', 'month', 'quarter', 'year'])))` |
| example_value | numeric(24,6) | NOT NULL |  |  |
| label_en | text | NOT NULL |  | `CHECK (((char_length(label_en) >= 1) AND (char_length(label_en) <= 200)))` |
| label_ar | text | NOT NULL |  | `CHECK (((char_length(label_ar) >= 1) AND (char_length(label_ar) <= 200)))` |

**Table constraints:**

- `benefit_formula_example_variable_currency_kind` (CHECK): `CHECK (((kind = 'currency') = (currency IS NOT NULL)))`
- `benefit_formula_example_variable_name_key` (UNIQUE): `UNIQUE (example_id, name)`

## gate_decision_agreement

- **Purpose:** The three B0032 leadership agreement confirmations of an approved G1 decision (REQ-PB-022; ADR-0021 §8).
- **Migration:** `0024_p3_gates_access_instantiation.sql`. **API module:** `workflows`. **Who writes:** the G1 decider, in the approving transaction. **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| gate_decision_id | uuid | NOT NULL |  | FK → gate_decision(id) |
| agreement_code | text | NOT NULL |  | `CHECK ((agreement_code = ANY (ARRAY['problem', 'baseline', 'material_value_pools'])))` |
| confirmed_by | uuid | NOT NULL |  | FK → app_user(id) |
| confirmed_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `gate_decision_agreement_key` (UNIQUE): `UNIQUE (gate_decision_id, agreement_code)`

**Triggers:**

- `gate_decision_agreement_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `gate_decision_agreement_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `gate_decision_agreement_guard`: BEFORE INSERT FOR EACH ROW → `gate_decision_agreement_guard()`
- `gate_decision_agreement_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## P3 functions

| Function | Migration | Purpose | Callable by `mth_app` |
|---|---|---|---|
| `roadmap_wave_source_immutable()` | 0020 | the verbatim B0079 text of a seeded wave never changes | via trigger |
| `initiative_status_step()` | 0020 | only the ADR-0021 §3 status edges | via trigger |
| `initiative_contribution_kpi_matches_outcome()` | 0020 | a contribution's T02 row belongs to its outcome | via trigger |
| `scoring_weight_set_freeze()` | 0021 | weight set content immutable; status edges proposed→active/withdrawn, active→superseded | via trigger |
| `scoring_weight_set_total()` | 0021 | deferred: every touched set has 2–6 weights totalling exactly 100.00 | via constraint triggers |
| `ranking_snapshot_freeze()` | 0021 | a ranking snapshot is immutable except its status | via trigger |
| `dependency_type_system_guard()` | 0022 | system types never deleted, retired or renamed; no type is ever deleted | via trigger |
| `dependency_type_active()` | 0022 | a new or changed dependency type must be active | via trigger |
| `dependency_cycle_guard()` | 0022 | race-free acyclic initiative graph: advisory lock (730221, hashtext(transformation_id)) shared with the API, BFS re-check, fails closed outside READ COMMITTED; error `dependency_acyclic` with the cycle path | via trigger |
| `benefit_formula_version_freeze()` | 0023 | formula version immutable; Finance validation final once set | via trigger |
| `business_case_parent_is_transformation()` | 0023 | an initiative case's parent is the transformation-level case | via trigger |
| `gate_decision_agreement_guard()` | 0024 | agreement rows only for an approved G1 decision, confirmed by its decider | via trigger |
| `p3_instantiate_transformation(uuid, uuid, text, text)` | 0024 | P2 starter structure + four verbatim waves + weight set v1 (25/25/20/15/15), idempotent, audited; backfilled for existing transformations | yes |

## P3 validation rules summary

| Layer | What it checks |
|---|---|
| Database | The P2 record guards on every P3 table; the closed sets (statuses, criteria, classes, kinds, periods, confidence H/M/L); score 1–5; weights total 100; one class per business-case line and the class/value-basis pairing; non-financial lines unmonetised; one active line per T09 formula; one active transformation case and one active case per initiative; formula versions immutable; validators ≠ authors; inherited approvals need evidence; dispensation decider ≠ recorder; override approver ≠ proposer; acyclic initiative graph; system dependency types permanent |
| API (`@mth/shared/schemas`) | Shapes (OpenAPI P3 schemas), decimal strings within the column scale, the formula grammar and type rules (`packages/shared/src/formula`), one `class` per line, free-text rules |
| Service | Permissions and record-level rules, If-Match, the ADR-0021 transition preconditions and their exact 422 texts, ranking causes, schedule and capacity flags, G4 criteria evaluation |

# P4 tables, slices I and C (migrations 0028–0031, DG4)

- **Task:** T-DG4-ARCH-01 (solution-architect), 2026-10-09. **ADRs:** ADR-0025 (business calendar, time semantics, scheduled-job kit, work items, inbox), ADR-0026 (groups, role mapping, delegation, the P4 approval record, T11, T12).
- **Generated:** the per-table sections below were generated from the catalogue of a freshly migrated database by `docs/delivery/handbacks/DG4/T-DG4-ARCH-01-evidence/gen-dictionary.ts` (types, nullability, defaults, constraints, indexes, triggers and `mth_app` privileges as PostgreSQL reports them; `::text` casts removed for readability). Purpose, module, writers and lifecycle are written by hand.
- **Global rules** are those at the top of this file and the P2 record guards (`p2_attach_guards`: row guard, version step by 1, deferred audit coverage; `p2_attach_append_only` on `approval_decision` and `approval_escalation`). No money, rate or FTE column in slices I and C. Event instants are `timestamptz`; business dates and due dates are `date` (ADR-0025 §2).
- **No DELETE** grant on any P4 table. Seeded catalogues (`work_item_kind`, `governance_party`, `decision_right_template`, `raci_template_deliverable`, `raci_template_cell`, `approval_type`) are SELECT only; `job_schedule` is SELECT, UPDATE.
- **Advisory locks** (ADR-0016 §6): 730224 delegation graph (per organization), 730225 RACI deliverable, 730226 approval subject; 730227 reserved.

## delegation (0001) — P4 extension (0029)

- **Added columns** (all NULL on rows that existed before 0029):

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| absence_note | text | NULL |  | `CHECK (((absence_note IS NULL) OR ((char_length(absence_note) >= 1) AND (char_length(absence_note) <= 1000))))` |
| requested_by_user_id | uuid | NULL |  | FK → app_user(id); set when an access administrator records the delegation on the delegator's request |
| revoked_at | timestamp with time zone | NULL |  |  |
| revoked_by | uuid | NULL |  | FK → app_user(id) |
| revoke_reason | text | NULL |  | `CHECK (((revoke_reason IS NULL) OR ((char_length(revoke_reason) >= 1) AND (char_length(revoke_reason) <= 1000))))` |

- **Added table constraint:** `delegation_revocation_complete` (CHECK): the revocation fields are all set or all NULL, and set only with `status = 'revoked'`.
- **Added triggers:** `delegation_loop_guard` (BEFORE INSERT OR UPDATE OF status, delegator_user_id, delegate_user_id, effective_to FOR EACH ROW → `delegation_loop_guard()`: lock 730224 per organization, refuses a path back to the delegator through active, not-yet-ended delegations; error `delegation_no_loop`); `delegation_row_guard` (BEFORE INSERT OR UPDATE → `p2_row_guard()`: version step by 1, immutable identity).
- **Not attached:** `p2_audit_required` (DG3 fixtures insert delegation rows directly; the API writes the audit event; ADR-0026 §3 rule 3).

## business_calendar

- **Purpose:** Working-day calendar of an organization (REQ-S10-006, M0196; ADR-0025 §1). One active default per organization; default Asia/Riyadh, workweek Sunday-Thursday (ISO 7,1,2,3,4). No holiday is seeded.
- **Migration:** `0028_p4_calendar_jobs_work_items.sql`. **API module:** `organization`. **Who writes:** system (`p4_ensure_default_calendar`); `calendar.configure` (ADM_TECH). **Lifecycle:** active → archived (the default calendar cannot be archived).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| code | text | NOT NULL |  |  |
| name_en | text | NOT NULL |  | `CHECK (((char_length(name_en) >= 1) AND (char_length(name_en) <= 200)))` |
| name_ar | text | NOT NULL |  | `CHECK (((char_length(name_ar) >= 1) AND (char_length(name_ar) <= 200)))` |
| timezone | text | NOT NULL | `'Asia/Riyadh'` | `CHECK (((char_length(timezone) >= 1) AND (char_length(timezone) <= 64)))` |
| workweek | smallint[] | NOT NULL | `ARRAY[(7)::smallint, (1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint]` |  |
| is_default | boolean | NOT NULL | `false` |  |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `business_calendar_code_format` (CHECK): `CHECK ((code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'))`
- `business_calendar_default_active` (CHECK): `CHECK (((NOT is_default) OR (status = 'active')))`
- `business_calendar_org_code_key` (UNIQUE): `UNIQUE (organization_id, code)`
- `business_calendar_org_id_key` (UNIQUE): `UNIQUE (organization_id, id)`
- `business_calendar_workweek_valid` (CHECK): `CHECK (p4_valid_workweek(workweek))`

**Indexes:**

- `business_calendar_one_default`: `UNIQUE (organization_id) WHERE is_default`

**Triggers:**

- `business_calendar_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `business_calendar_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`
- `business_calendar_timezone_known`: BEFORE INSERT OR UPDATE OF timezone FOR EACH ROW → `p4_timezone_known()`

## business_calendar_holiday

- **Purpose:** An administered non-working date range (inclusive, at most 31 days) of a calendar (REQ-S10-006; ADR-0025 §1).
- **Migration:** `0028_p4_calendar_jobs_work_items.sql`. **API module:** `organization`. **Who writes:** `calendar.configure` (ADM_TECH). **Lifecycle:** active → removed (never deleted).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| calendar_id | uuid | NOT NULL |  |  |
| date_from | date | NOT NULL |  |  |
| date_to | date | NOT NULL |  |  |
| name_en | text | NOT NULL |  | `CHECK (((char_length(name_en) >= 1) AND (char_length(name_en) <= 200)))` |
| name_ar | text | NOT NULL |  | `CHECK (((char_length(name_ar) >= 1) AND (char_length(name_ar) <= 200)))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'removed'])))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `business_calendar_holiday_calendar_fkey` (FK): `FOREIGN KEY (organization_id, calendar_id) REFERENCES business_calendar(organization_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `business_calendar_holiday_range` (CHECK): `CHECK (((date_to >= date_from) AND ((date_to - date_from) <= 30)))`

**Indexes:**

- `business_calendar_holiday_calendar_idx`: `(calendar_id, date_from) WHERE (status = 'active')`

**Triggers:**

- `business_calendar_holiday_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `business_calendar_holiday_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## job_schedule

- **Purpose:** A recurring job of the scheduled-job kit: queue, five-field cron and timezone (REQ-S16-005; ADR-0025 §3). Platform-wide. Seeded: approval.escalation_scan, delegation.expiry_sweep, kpi.reporting_period_open.
- **Migration:** `0028_p4_calendar_jobs_work_items.sql`. **API module:** `jobs (worker registers it with pg-boss)`. **Who writes:** migrations insert; `job.configure` (ADM_TECH) updates enabled/cron/timezone. **Lifecycle:** enabled ⇄ disabled.
- **`mth_app` privileges:** SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| code | text | NOT NULL |  |  |
| queue_name | text | NOT NULL |  | `CHECK ((queue_name ~ '^[a-z_]+\.[a-z_.]+$'))` |
| cron | text | NOT NULL |  | `CHECK ((cron ~ '^\S+( \S+){4}$'))` |
| timezone | text | NOT NULL | `'Asia/Riyadh'` | `CHECK (((char_length(timezone) >= 1) AND (char_length(timezone) <= 64)))` |
| enabled | boolean | NOT NULL | `true` |  |
| description_en | text | NOT NULL |  | `CHECK (((char_length(description_en) >= 1) AND (char_length(description_en) <= 500)))` |
| description_ar | text | NOT NULL |  | `CHECK (((char_length(description_ar) >= 1) AND (char_length(description_ar) <= 500)))` |
| owner_module | text | NOT NULL |  | `CHECK ((owner_module ~ '^[a-z_]+$'))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `job_schedule_code_format` (CHECK): `CHECK ((code ~ '^[a-z_]+\.[a-z_]+$'))`
- `job_schedule_code_key` (UNIQUE): `UNIQUE (code)`

**Triggers:**

- `job_schedule_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `job_schedule_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`
- `job_schedule_timezone_known`: BEFORE INSERT OR UPDATE OF timezone FOR EACH ROW → `p4_timezone_known()`

## work_item_kind

- **Purpose:** Catalogue of My Work item kinds; later slices insert their own kinds by migration (ADR-0025 §4).
- **Migration:** `0028_p4_calendar_jobs_work_items.sql`. **API module:** `tasks`. **Who writes:** migrations only. **Lifecycle:** seed (read-only).
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| code | text | NOT NULL |  | `CHECK ((code ~ '^[a-z_]+$'))`; PK |
| owner_module | text | NOT NULL |  | `CHECK ((owner_module ~ '^[a-z_]+$'))` |
| label_en | text | NOT NULL |  | `CHECK (((char_length(label_en) >= 1) AND (char_length(label_en) <= 200)))` |
| label_ar | text | NOT NULL |  | `CHECK (((char_length(label_ar) >= 1) AND (char_length(label_ar) <= 200)))` |
| source_ref | text | NOT NULL |  | `CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 50)))` |

## work_item

- **Purpose:** One owned task in My Work with an i18n message and a relative deep link (REQ-S12-005, REQ-S03-008; ADR-0025 §4). The dedupe key makes a duplicate creation impossible (REQ-S16-005).
- **Migration:** `0028_p4_calendar_jobs_work_items.sql`. **API module:** `tasks`. **Who writes:** `tasks/service.ts` `createWorkItemOnce` (domain services, job handlers); the assignee completes. **Lifecycle:** open → done | cancelled (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NULL |  | FK → transformation(id) |
| kind | text | NOT NULL |  | FK → work_item_kind(code) |
| assignee_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| subject_type | text | NOT NULL |  | `CHECK (((subject_type ~ '^[a-z_]+$') AND (char_length(subject_type) <= 64)))` |
| subject_id | uuid | NOT NULL |  |  |
| link_path | text | NOT NULL |  |  |
| message_key | text | NOT NULL |  | `CHECK (((message_key ~ '^[a-z][a-zA-Z0-9_.]*$') AND (char_length(message_key) <= 128)))` |
| message_params | jsonb | NOT NULL | `'{}'::jsonb` | `CHECK ((jsonb_typeof(message_params) = 'object'))` |
| due_date | date | NULL |  |  |
| period_label | text | NULL |  | `CHECK (((period_label IS NULL) OR ((char_length(period_label) >= 1) AND (char_length(period_label) <= 32))))` |
| status | text | NOT NULL | `'open'` | `CHECK ((status = ANY (ARRAY['open', 'done', 'cancelled'])))` |
| completed_at | timestamp with time zone | NULL |  |  |
| completed_by | uuid | NULL |  | FK → app_user(id) |
| dedupe_key | text | NOT NULL |  | `CHECK (((char_length(dedupe_key) >= 1) AND (char_length(dedupe_key) <= 200)))` |
| created_source | text | NOT NULL |  | `CHECK ((created_source = ANY (ARRAY['api', 'worker', 'migration'])))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `work_item_completion` (CHECK): `CHECK ((((status = 'done') = (completed_at IS NOT NULL)) AND ((completed_by IS NULL) OR (completed_at IS NOT NULL))))`
- `work_item_dedupe_key` (UNIQUE): `UNIQUE (organization_id, dedupe_key)`
- `work_item_link_path_relative` (CHECK): `CHECK ((("left"(link_path, 1) = '/') AND (substr(link_path, 2, 1) <> ALL (ARRAY['/', '\'])) AND (char_length(link_path) <= 500)))`

**Indexes:**

- `work_item_assignee_open_idx`: `(assignee_user_id, due_date, id) WHERE (status = 'open')`
- `work_item_subject_idx`: `(subject_type, subject_id)`
- `work_item_transformation_idx`: `(transformation_id, status)`

**Triggers:**

- `work_item_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `work_item_guard`: BEFORE UPDATE FOR EACH ROW → `work_item_guard()`
- `work_item_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## inbox_notification

- **Purpose:** In-app reminder with a direct link (REQ-S12-005; ADR-0025 §4). No email or messaging channel in P4.
- **Migration:** `0028_p4_calendar_jobs_work_items.sql`. **API module:** `tasks`. **Who writes:** `createWorkItemOnce`; the recipient marks it read. **Lifecycle:** unread → read (once).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NULL |  | FK → transformation(id) |
| recipient_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| work_item_id | uuid | NULL |  | FK → work_item(id) |
| link_path | text | NOT NULL |  |  |
| message_key | text | NOT NULL |  | `CHECK (((message_key ~ '^[a-z][a-zA-Z0-9_.]*$') AND (char_length(message_key) <= 128)))` |
| message_params | jsonb | NOT NULL | `'{}'::jsonb` | `CHECK ((jsonb_typeof(message_params) = 'object'))` |
| dedupe_key | text | NOT NULL |  | `CHECK (((char_length(dedupe_key) >= 1) AND (char_length(dedupe_key) <= 200)))` |
| read_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `inbox_notification_dedupe_key` (UNIQUE): `UNIQUE (organization_id, dedupe_key)`
- `inbox_notification_link_path_relative` (CHECK): `CHECK ((("left"(link_path, 1) = '/') AND (substr(link_path, 2, 1) <> ALL (ARRAY['/', '\'])) AND (char_length(link_path) <= 500)))`

**Indexes:**

- `inbox_notification_recipient_idx`: `(recipient_user_id, created_at DESC, id DESC)`
- `inbox_notification_unread_idx`: `(recipient_user_id) WHERE (read_at IS NULL)`

**Triggers:**

- `inbox_notification_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `inbox_notification_read_once`: BEFORE UPDATE FOR EACH ROW → `inbox_notification_read_once()`
- `inbox_notification_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## access_group

- **Purpose:** A governed group (REQ-S16-011 Group, REQ-S10-008), e.g. SteerCo. A routing target; it grants no permission (ADR-0026 §1).
- **Migration:** `0029_p4_groups_role_mapping_delegation.sql`. **API module:** `access`. **Who writes:** `group.manage` (TO). **Lifecycle:** active → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| code | text | NOT NULL |  |  |
| name_en | text | NOT NULL |  | `CHECK (((char_length(name_en) >= 1) AND (char_length(name_en) <= 200)))` |
| name_ar | text | NOT NULL |  | `CHECK (((char_length(name_ar) >= 1) AND (char_length(name_ar) <= 200)))` |
| description | text | NULL |  | `CHECK (((description IS NULL) OR ((char_length(description) >= 1) AND (char_length(description) <= 2000))))` |
| owner_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `access_group_code_format` (CHECK): `CHECK ((code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'))`
- `access_group_org_code_key` (UNIQUE): `UNIQUE (organization_id, code)`
- `access_group_org_id_key` (UNIQUE): `UNIQUE (organization_id, id)`

**Triggers:**

- `access_group_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `access_group_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## access_group_member

- **Purpose:** Membership of a governed group with an effective window; removal is recorded (ADR-0026 §1).
- **Migration:** `0029_p4_groups_role_mapping_delegation.sql`. **API module:** `access`. **Who writes:** `group.manage` (TO). **Lifecycle:** current → removed (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| group_id | uuid | NOT NULL |  |  |
| user_id | uuid | NOT NULL |  | FK → app_user(id) |
| effective_from | timestamp with time zone | NOT NULL | `now()` |  |
| effective_to | timestamp with time zone | NULL |  |  |
| removed_at | timestamp with time zone | NULL |  |  |
| removed_by | uuid | NULL |  | FK → app_user(id) |
| remove_reason | text | NULL |  | `CHECK (((remove_reason IS NULL) OR ((char_length(remove_reason) >= 1) AND (char_length(remove_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `access_group_member_effective_range` (CHECK): `CHECK (((effective_to IS NULL) OR (effective_to > effective_from)))`
- `access_group_member_group_fkey` (FK): `FOREIGN KEY (organization_id, group_id) REFERENCES access_group(organization_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `access_group_member_removal_complete` (CHECK): `CHECK ((((removed_at IS NULL) = (removed_by IS NULL)) AND ((removed_at IS NULL) = (remove_reason IS NULL))))`

**Indexes:**

- `access_group_member_active_key`: `UNIQUE (group_id, user_id) WHERE (removed_at IS NULL)`
- `access_group_member_user_idx`: `(user_id) WHERE (removed_at IS NULL)`

**Triggers:**

- `access_group_member_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `access_group_member_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`
- `access_group_member_same_org`: BEFORE INSERT FOR EACH ROW → `access_group_member_same_org()`

## governance_party

- **Purpose:** The 18 parties named by T11 (B0099) and T12 (B0101); label_en is the source wording, label_ar provisional (ADR-0026 §2).
- **Migration:** `0029_p4_groups_role_mapping_delegation.sql`. **API module:** `access`. **Who writes:** migrations only. **Lifecycle:** seed (read-only).
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| code | text | NOT NULL |  | `CHECK ((code ~ '^[A-Z][A-Z0-9_]{0,31}$'))`; PK |
| ordinal | smallint | NOT NULL |  | `CHECK ((ordinal >= 1))` |
| kind | text | NOT NULL |  | `CHECK ((kind = ANY (ARRAY['role', 'forum', 'office', 'owner_group'])))` |
| role_code | text | NULL |  | FK → role(code) |
| label_en | text | NOT NULL |  | `CHECK (((char_length(label_en) >= 1) AND (char_length(label_en) <= 200)))` |
| label_ar | text | NOT NULL |  | `CHECK (((char_length(label_ar) >= 1) AND (char_length(label_ar) <= 200)))` |
| source_ref | text | NOT NULL |  | `CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 50)))` |

**Table constraints:**

- `governance_party_ordinal_key` (UNIQUE): `UNIQUE (ordinal)`

## role_mapping

- **Purpose:** Who a governance party is in one transformation: one named person or one governed group; no fallback when unmapped (REQ-S10-008; ADR-0026 §2).
- **Migration:** `0029_p4_groups_role_mapping_delegation.sql`. **API module:** `access`. **Who writes:** `role_mapping.assign` (TL, TO). **Lifecycle:** active → ended (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| party_code | text | NOT NULL |  | FK → governance_party(code) |
| target_kind | text | NOT NULL |  | `CHECK ((target_kind = ANY (ARRAY['user', 'group'])))` |
| user_id | uuid | NULL |  | FK → app_user(id) |
| group_id | uuid | NULL |  |  |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'ended'])))` |
| ended_at | timestamp with time zone | NULL |  |  |
| ended_by | uuid | NULL |  | FK → app_user(id) |
| end_reason | text | NULL |  | `CHECK (((end_reason IS NULL) OR ((char_length(end_reason) >= 1) AND (char_length(end_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `role_mapping_end_complete` (CHECK): `CHECK ((((status = 'ended') = (ended_at IS NOT NULL)) AND ((ended_at IS NULL) = (ended_by IS NULL)) AND ((ended_at IS NULL) = (end_reason IS NULL))))`
- `role_mapping_group_fkey` (FK): `FOREIGN KEY (organization_id, group_id) REFERENCES access_group(organization_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `role_mapping_one_target` (CHECK): `CHECK ((((target_kind = 'user') AND (user_id IS NOT NULL) AND (group_id IS NULL)) OR ((target_kind = 'group') AND (group_id IS NOT NULL) AND (user_id IS NULL))))`

**Indexes:**

- `role_mapping_active_key`: `UNIQUE (transformation_id, party_code) WHERE (status = 'active')`
- `role_mapping_user_idx`: `(user_id) WHERE (status = 'active')`

**Triggers:**

- `role_mapping_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `role_mapping_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `role_mapping_guard()`
- `role_mapping_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## decision_right_template

- **Purpose:** The four T11 rows of B0099, VERBATIM (REQ-PB-065; ADR-0026 §5).
- **Migration:** `0030_p4_decision_rights_raci.sql`. **API module:** `governance`. **Who writes:** migrations only. **Lifecycle:** seed (read-only).
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| key | text | NOT NULL |  | `CHECK ((key ~ '^[a-z_]+$'))`; PK |
| ordinal | smallint | NOT NULL |  | `CHECK ((ordinal >= 1))` |
| source_decision_en | text | NOT NULL |  |  |
| source_recommend_en | text | NOT NULL |  |  |
| source_approve_en | text | NOT NULL |  |  |
| source_consult_en | text | NOT NULL |  |  |
| source_inform_en | text | NOT NULL |  |  |
| source_sla_en | text | NOT NULL |  |  |
| decision_ar | text | NOT NULL |  |  |
| recommend_ar | text | NOT NULL |  |  |
| approve_ar | text | NOT NULL |  |  |
| consult_ar | text | NOT NULL |  |  |
| inform_ar | text | NOT NULL |  |  |
| sla_ar | text | NOT NULL |  |  |
| recommend_parties | text[] | NOT NULL |  |  |
| approve_party_code | text | NOT NULL |  | FK → governance_party(code) |
| consult_parties | text[] | NOT NULL |  |  |
| inform_parties | text[] | NOT NULL |  |  |
| sla_type | text | NOT NULL |  | `CHECK ((sla_type = ANY (ARRAY['working_days', 'next_steerco_or_urgent', 'release_plan'])))` |
| sla_working_days | smallint | NULL |  | `CHECK (((sla_working_days IS NULL) OR ((sla_working_days >= 1) AND (sla_working_days <= 250))))` |
| escalation_chain | text[] | NOT NULL |  | `CHECK (((cardinality(escalation_chain) >= 1) AND (cardinality(escalation_chain) <= 5)))` |
| source_ref | text | NOT NULL |  | `CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 50)))` |

**Table constraints:**

- `decision_right_template_ordinal_key` (UNIQUE): `UNIQUE (ordinal)`
- `decision_right_template_sla` (CHECK): `CHECK (((sla_type = 'working_days') = (sla_working_days IS NOT NULL)))`

## governance_matrix

- **Purpose:** Approval header of a transformation's T11 (decision_rights) or T12 (raci) matrix; row edits bump its version; SP approves a version (REQ-S10-007; ADR-0026 §7).
- **Migration:** `0030_p4_decision_rights_raci.sql`. **API module:** `governance`. **Who writes:** system (instantiation); `decision_right.configure` / `raci.edit`; the approval engine. **Lifecycle:** draft → in_approval → approved | draft.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| kind | text | NOT NULL |  | `CHECK ((kind = ANY (ARRAY['decision_rights', 'raci'])))` |
| status | text | NOT NULL | `'draft'` | `CHECK ((status = ANY (ARRAY['draft', 'in_approval', 'approved'])))` |
| approved_version | integer | NULL |  | `CHECK (((approved_version IS NULL) OR (approved_version >= 1)))` |
| approved_at | timestamp with time zone | NULL |  |  |
| approved_by | uuid | NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `governance_matrix_approval_complete` (CHECK): `CHECK ((((approved_version IS NULL) = (approved_at IS NULL)) AND ((approved_at IS NULL) = (approved_by IS NULL)) AND ((status <> 'approved') OR (approved_version IS NOT NULL))))`
- `governance_matrix_kind_key` (UNIQUE): `UNIQUE (transformation_id, kind)`
- `governance_matrix_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Triggers:**

- `governance_matrix_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `governance_matrix_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## transformation_decision_right

- **Purpose:** One T11 row of a transformation: the seeded copy (template_key) or an added row; parties, SLA type and escalation chain (REQ-PB-065, REQ-PB-066; ADR-0026 §5).
- **Migration:** `0030_p4_decision_rights_raci.sql`. **API module:** `governance`. **Who writes:** system (instantiation); `decision_right.configure` (TO, TL). **Lifecycle:** active → retired.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| template_key | text | NULL |  | FK → decision_right_template(key) |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 999)))` |
| decision_en | text | NOT NULL |  | `CHECK (((char_length(decision_en) >= 1) AND (char_length(decision_en) <= 300)))` |
| decision_ar | text | NOT NULL |  | `CHECK (((char_length(decision_ar) >= 1) AND (char_length(decision_ar) <= 300)))` |
| recommend_label | text | NOT NULL |  | `CHECK (((char_length(recommend_label) >= 1) AND (char_length(recommend_label) <= 300)))` |
| approve_label | text | NOT NULL |  | `CHECK (((char_length(approve_label) >= 1) AND (char_length(approve_label) <= 300)))` |
| consult_label | text | NOT NULL |  | `CHECK (((char_length(consult_label) >= 1) AND (char_length(consult_label) <= 300)))` |
| inform_label | text | NOT NULL |  | `CHECK (((char_length(inform_label) >= 1) AND (char_length(inform_label) <= 300)))` |
| sla_label | text | NOT NULL |  | `CHECK (((char_length(sla_label) >= 1) AND (char_length(sla_label) <= 300)))` |
| recommend_parties | text[] | NOT NULL | `'{}'[]` |  |
| approve_party_code | text | NOT NULL |  | FK → governance_party(code) |
| consult_parties | text[] | NOT NULL | `'{}'[]` |  |
| inform_parties | text[] | NOT NULL | `'{}'[]` |  |
| sla_type | text | NOT NULL |  | `CHECK ((sla_type = ANY (ARRAY['working_days', 'next_steerco_or_urgent', 'release_plan'])))` |
| sla_working_days | smallint | NULL |  | `CHECK (((sla_working_days IS NULL) OR ((sla_working_days >= 1) AND (sla_working_days <= 250))))` |
| urgent_working_days | smallint | NULL |  | `CHECK (((urgent_working_days IS NULL) OR ((urgent_working_days >= 1) AND (urgent_working_days <= 250))))` |
| escalation_chain | text[] | NOT NULL |  | `CHECK (((cardinality(escalation_chain) >= 1) AND (cardinality(escalation_chain) <= 5)))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'retired'])))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `transformation_decision_right_sla` (CHECK): `CHECK ((((sla_type = 'working_days') = (sla_working_days IS NOT NULL)) AND ((urgent_working_days IS NULL) OR (sla_type = 'next_steerco_or_urgent'))))`
- `transformation_decision_right_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `transformation_decision_right_order_idx`: `(transformation_id, ordinal, id)`
- `transformation_decision_right_template_key`: `UNIQUE (transformation_id, template_key) WHERE (template_key IS NOT NULL)`

**Triggers:**

- `transformation_decision_right_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `transformation_decision_right_editable`: BEFORE INSERT OR UPDATE FOR EACH ROW → `governance_matrix_rows_editable()`
- `transformation_decision_right_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `transformation_decision_right_guard()`
- `transformation_decision_right_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## raci_template_deliverable

- **Purpose:** The six T12 deliverables of B0101, VERBATIM (REQ-PB-067).
- **Migration:** `0030_p4_decision_rights_raci.sql`. **API module:** `governance`. **Who writes:** migrations only. **Lifecycle:** seed (read-only).
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| key | text | NOT NULL |  | `CHECK ((key ~ '^[a-z_]+$'))`; PK |
| ordinal | smallint | NOT NULL |  | `CHECK ((ordinal >= 1))` |
| source_deliverable_en | text | NOT NULL |  |  |
| deliverable_ar | text | NOT NULL |  |  |
| source_ref | text | NOT NULL |  | `CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 50)))` |

**Table constraints:**

- `raci_template_deliverable_ordinal_key` (UNIQUE): `UNIQUE (ordinal)`

## raci_template_cell

- **Purpose:** The 36 T12 cells of B0101 (A, R, C, I, A/R), VERBATIM (REQ-PB-067).
- **Migration:** `0030_p4_decision_rights_raci.sql`. **API module:** `governance`. **Who writes:** migrations only. **Lifecycle:** seed (read-only).
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| deliverable_key | text | NOT NULL |  | FK → raci_template_deliverable(key) |
| party_code | text | NOT NULL |  | FK → governance_party(code) |
| value | text | NOT NULL |  | `CHECK ((value = ANY (ARRAY['A', 'R', 'C', 'I', 'A/R'])))` |

**Table constraints:**

- `raci_template_cell_pkey` (PK): `PRIMARY KEY (deliverable_key, party_code)`

## transformation_raci_deliverable

- **Purpose:** A T12 deliverable of one transformation, copied from the template or added; an accountability exception documents the governance rule that permits zero or several A (REQ-S10-007, REQ-S10-009; ADR-0026 §7).
- **Migration:** `0030_p4_decision_rights_raci.sql`. **API module:** `governance`. **Who writes:** system (instantiation); `raci.edit` (TO, TL). **Lifecycle:** active → retired.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| template_key | text | NULL |  | FK → raci_template_deliverable(key) |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 999)))` |
| label_en | text | NOT NULL |  | `CHECK (((char_length(label_en) >= 1) AND (char_length(label_en) <= 300)))` |
| label_ar | text | NOT NULL |  | `CHECK (((char_length(label_ar) >= 1) AND (char_length(label_ar) <= 300)))` |
| accountability_exception | text | NULL |  | `CHECK (((accountability_exception IS NULL) OR ((char_length(accountability_exception) >= 10) AND (char_length(accountability_exception) <= 2000))))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'retired'])))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `transformation_raci_deliverable_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `transformation_raci_deliverable_order_idx`: `(transformation_id, ordinal, id)`
- `transformation_raci_deliverable_template_key`: `UNIQUE (transformation_id, template_key) WHERE (template_key IS NOT NULL)`

**Triggers:**

- `transformation_raci_deliverable_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `transformation_raci_deliverable_editable`: BEFORE INSERT OR UPDATE FOR EACH ROW → `governance_matrix_rows_editable()`
- `transformation_raci_deliverable_one_accountable`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `transformation_raci_one_accountable()`
- `transformation_raci_deliverable_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## transformation_raci_assignment

- **Purpose:** One RACI cell (deliverable × party): A, R, C, I, A/R or NULL; exactly one A or A/R per active deliverable at COMMIT unless excepted (REQ-PB-067, REQ-S10-009).
- **Migration:** `0030_p4_decision_rights_raci.sql`. **API module:** `governance`. **Who writes:** system (instantiation); `raci.edit` (TO, TL). **Lifecycle:** value changes; never deleted.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| deliverable_id | uuid | NOT NULL |  |  |
| party_code | text | NOT NULL |  | FK → governance_party(code) |
| value | text | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `transformation_raci_assignment_cell_key` (UNIQUE): `UNIQUE (deliverable_id, party_code)`
- `transformation_raci_assignment_deliverable_fkey` (FK): `FOREIGN KEY (transformation_id, deliverable_id) REFERENCES transformation_raci_deliverable(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `transformation_raci_assignment_value` (CHECK): `CHECK (((value IS NULL) OR (value = ANY (ARRAY['A', 'R', 'C', 'I', 'A/R']))))`

**Triggers:**

- `transformation_raci_assignment_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `transformation_raci_assignment_editable`: BEFORE INSERT OR UPDATE FOR EACH ROW → `governance_matrix_rows_editable()`
- `transformation_raci_assignment_guard`: BEFORE UPDATE FOR EACH ROW → `transformation_raci_assignment_guard()`
- `transformation_raci_assignment_one_accountable`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `transformation_raci_one_accountable()`
- `transformation_raci_assignment_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## approval_type

- **Purpose:** What can be approved through the P4 engine, its subject table and default SoD policy (ADR-0026 §4).
- **Migration:** `0031_p4_approvals_permissions.sql`. **API module:** `workflows`. **Who writes:** migrations only. **Lifecycle:** seed (read-only).
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| code | text | NOT NULL |  | `CHECK ((code ~ '^[a-z_]+$'))`; PK |
| subject_table | text | NOT NULL |  | `CHECK ((subject_table ~ '^[a-z_]+$'))` |
| default_sod_policy | text | NOT NULL |  | `CHECK ((default_sod_policy = ANY (ARRAY['requester_excluded', 'requester_allowed'])))` |
| requires_decision_right | boolean | NOT NULL |  |  |
| owner_module | text | NOT NULL |  | `CHECK ((owner_module ~ '^[a-z_]+$'))` |
| label_en | text | NOT NULL |  | `CHECK (((char_length(label_en) >= 1) AND (char_length(label_en) <= 200)))` |
| label_ar | text | NOT NULL |  | `CHECK (((char_length(label_ar) >= 1) AND (char_length(label_ar) <= 200)))` |
| source_ref | text | NOT NULL |  | `CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 50)))` |

## approval

- **Purpose:** The canonical P4 business-approval record: assignee, request version, due date (or Unknown with a reason), status, escalation, decision (REQ-S10-014, -016, -017, -018, -019; D-089 Q10; ADR-0026 §4).
- **Migration:** `0031_p4_approvals_permissions.sql`. **API module:** `workflows`. **Who writes:** `approval.request` (requester); `approval.decide` (assignee); the escalation job (escalation fields only). **Lifecycle:** pending → approved | rejected | changes_requested | deferred | withdrawn; changes_requested → pending (resubmission); final: approved, rejected, withdrawn.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| approval_type | text | NOT NULL |  | FK → approval_type(code) |
| subject_type | text | NOT NULL |  | `CHECK ((subject_type ~ '^[a-z_]+$'))` |
| subject_id | uuid | NOT NULL |  |  |
| subject_version | integer | NOT NULL |  | `CHECK ((subject_version >= 1))` |
| round_no | smallint | NOT NULL | `1` | `CHECK ((round_no >= 1))` |
| decision_right_id | uuid | NULL |  |  |
| title | text | NOT NULL |  | `CHECK (((char_length(title) >= 1) AND (char_length(title) <= 300)))` |
| request_note | text | NULL |  | `CHECK (((request_note IS NULL) OR ((char_length(request_note) >= 1) AND (char_length(request_note) <= 4000))))` |
| requested_by | uuid | NOT NULL |  | FK → app_user(id) |
| requested_at | timestamp with time zone | NOT NULL | `now()` |  |
| request_business_date | date | NOT NULL |  |  |
| assignee_party_code | text | NOT NULL |  | FK → governance_party(code) |
| assignee_user_id | uuid | NULL |  | FK → app_user(id) |
| assignee_group_id | uuid | NULL |  |  |
| sla_type | text | NULL |  | `CHECK (((sla_type IS NULL) OR (sla_type = ANY (ARRAY['working_days', 'next_steerco_or_urgent', 'release_plan']))))` |
| urgent_reason | text | NULL |  | `CHECK (((urgent_reason IS NULL) OR ((char_length(urgent_reason) >= 1) AND (char_length(urgent_reason) <= 2000))))` |
| due_date | date | NULL |  |  |
| due_unknown_reason | text | NULL |  | `CHECK (((due_unknown_reason IS NULL) OR (due_unknown_reason = ANY (ARRAY['no_steerco_scheduled', 'no_release_date', 'calendar_not_configured', 'no_sla']))))` |
| calendar_id | uuid | NULL |  |  |
| calendar_version | integer | NULL |  | `CHECK (((calendar_version IS NULL) OR (calendar_version >= 1)))` |
| sod_policy | text | NOT NULL |  | `CHECK ((sod_policy = ANY (ARRAY['requester_excluded', 'requester_allowed'])))` |
| status | text | NOT NULL | `'pending'` | `CHECK ((status = ANY (ARRAY['pending', 'changes_requested', 'deferred', 'approved', 'rejected', 'withdrawn'])))` |
| escalation_level | smallint | NOT NULL | `0` | `CHECK (((escalation_level >= 0) AND (escalation_level <= 5)))` |
| escalated_to_party_code | text | NULL |  | FK → governance_party(code) |
| escalated_to_user_id | uuid | NULL |  | FK → app_user(id) |
| escalated_to_group_id | uuid | NULL |  |  |
| decided_by | uuid | NULL |  | FK → app_user(id) |
| decided_on_behalf_of | uuid | NULL |  | FK → app_user(id) |
| decided_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `approval_assignee_group_fkey` (FK): `FOREIGN KEY (organization_id, assignee_group_id) REFERENCES access_group(organization_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `approval_calendar_fkey` (FK): `FOREIGN KEY (organization_id, calendar_id) REFERENCES business_calendar(organization_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `approval_decision_right_fkey` (FK): `FOREIGN KEY (transformation_id, decision_right_id) REFERENCES transformation_decision_right(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `approval_due_known_or_reason` (CHECK): `CHECK (((due_date IS NULL) = (due_unknown_reason IS NOT NULL)))`
- `approval_escalated_group_fkey` (FK): `FOREIGN KEY (organization_id, escalated_to_group_id) REFERENCES access_group(organization_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `approval_escalation_target` (CHECK): `CHECK ((((escalation_level = 0) AND (escalated_to_party_code IS NULL) AND (escalated_to_user_id IS NULL) AND (escalated_to_group_id IS NULL)) OR ((escalation_level > 0) AND ((escalated_to_user_id IS NULL) OR (escalated_to_group_id IS NULL)))))`
- `approval_final_decided` (CHECK): `CHECK ((((status = ANY (ARRAY['approved', 'rejected'])) = (decided_at IS NOT NULL)) AND ((decided_at IS NULL) = (decided_by IS NULL)) AND ((decided_on_behalf_of IS NULL) OR (decided_by IS NOT NULL))))`
- `approval_one_assignee` (CHECK): `CHECK (((assignee_user_id IS NULL) <> (assignee_group_id IS NULL)))`
- `approval_sod` (CHECK): `CHECK (((sod_policy = 'requester_allowed') OR (decided_by IS NULL) OR ((decided_by <> requested_by) AND (decided_on_behalf_of IS DISTINCT FROM requested_by))))`
- `approval_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`
- `approval_urgent_reason` (CHECK): `CHECK (((urgent_reason IS NULL) OR (sla_type = 'next_steerco_or_urgent')))`
- `approval_working_day_calendar` (CHECK): `CHECK (((sla_type IS DISTINCT FROM 'working_days') OR (due_date IS NULL) OR (calendar_id IS NOT NULL)))`

**Indexes:**

- `approval_assignee_open_idx`: `(assignee_user_id, due_date) WHERE (status = ANY (ARRAY['pending', 'deferred']))`
- `approval_group_open_idx`: `(assignee_group_id) WHERE (status = ANY (ARRAY['pending', 'deferred']))`
- `approval_one_open_per_subject`: `UNIQUE (approval_type, subject_id) WHERE (status = ANY (ARRAY['pending', 'changes_requested', 'deferred']))`
- `approval_overdue_scan_idx`: `(due_date) WHERE ((status = ANY (ARRAY['pending', 'deferred'])) AND (due_date IS NOT NULL))`
- `approval_requested_by_idx`: `(requested_by, requested_at DESC, id DESC)`
- `approval_transformation_idx`: `(transformation_id, requested_at DESC, id DESC)`

**Triggers:**

- `approval_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `approval_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `approval_guard()`
- `approval_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## approval_decision

- **Purpose:** Every outcome a person records on an approval, with rationale, comments, request version and decision instant (REQ-S10-014, REQ-S10-018).
- **Migration:** `0031_p4_approvals_permissions.sql`. **API module:** `workflows`. **Who writes:** `approval.decide` (assignee, group member, escalation target or their delegate). **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| approval_id | uuid | NOT NULL |  |  |
| round_no | smallint | NOT NULL |  | `CHECK ((round_no >= 1))` |
| outcome | text | NOT NULL |  | `CHECK ((outcome = ANY (ARRAY['approve', 'reject', 'request_changes', 'defer'])))` |
| rationale | text | NOT NULL |  |  |
| comments | text | NULL |  | `CHECK (((comments IS NULL) OR ((char_length(comments) >= 1) AND (char_length(comments) <= 8000))))` |
| subject_version | integer | NOT NULL |  | `CHECK ((subject_version >= 1))` |
| decided_by | uuid | NOT NULL |  | FK → app_user(id) |
| on_behalf_of_user_id | uuid | NULL |  | FK → app_user(id) |
| decided_at | timestamp with time zone | NOT NULL | `now()` |  |
| business_date | date | NOT NULL |  |  |
| defer_until | date | NULL |  |  |

**Table constraints:**

- `approval_decision_approval_fkey` (FK): `FOREIGN KEY (transformation_id, approval_id) REFERENCES approval(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `approval_decision_defer_date` (CHECK): `CHECK ((((outcome = 'defer') = (defer_until IS NOT NULL)) AND ((defer_until IS NULL) OR (defer_until > business_date))))`
- `approval_decision_not_self_behalf` (CHECK): `CHECK ((on_behalf_of_user_id IS DISTINCT FROM decided_by))`
- `approval_decision_rationale_required` (CHECK): `CHECK (((char_length(btrim(rationale)) >= 1) AND (char_length(rationale) <= 8000)))`

**Indexes:**

- `approval_decision_approval_idx`: `(approval_id, decided_at, id)`

**Triggers:**

- `approval_decision_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `approval_decision_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `approval_decision_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `approval_decision_guard`: BEFORE INSERT FOR EACH ROW → `approval_decision_guard()`
- `approval_decision_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## approval_escalation

- **Purpose:** What the overdue timer did: one row per approval, round and due date; target or routing error (REQ-S10-019; ADR-0026 §6).
- **Migration:** `0031_p4_approvals_permissions.sql`. **API module:** `workflows`. **Who writes:** the `approval.escalation_scan` job (service actor). **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| approval_id | uuid | NOT NULL |  |  |
| round_no | smallint | NOT NULL |  | `CHECK ((round_no >= 1))` |
| due_date | date | NOT NULL |  |  |
| level | smallint | NOT NULL |  |  |
| from_party_code | text | NOT NULL |  | FK → governance_party(code) |
| to_party_code | text | NULL |  | FK → governance_party(code) |
| to_user_id | uuid | NULL |  | FK → app_user(id) |
| to_group_id | uuid | NULL |  |  |
| routing_error | text | NULL |  | `CHECK (((routing_error IS NULL) OR (routing_error = ANY (ARRAY['no_next_authority', 'party_unmapped', 'party_not_approver']))))` |
| escalated_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `approval_escalation_approval_fkey` (FK): `FOREIGN KEY (transformation_id, approval_id) REFERENCES approval(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `approval_escalation_group_fkey` (FK): `FOREIGN KEY (organization_id, to_group_id) REFERENCES access_group(organization_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `approval_escalation_level_check1` (CHECK): `CHECK (((level >= 1) AND (level <= 5)))`
- `approval_escalation_once` (UNIQUE): `UNIQUE (approval_id, round_no, due_date)`
- `approval_escalation_target` (CHECK): `CHECK ((((routing_error IS NULL) AND (to_party_code IS NOT NULL) AND ((to_user_id IS NULL) <> (to_group_id IS NULL))) OR ((routing_error = ANY (ARRAY['party_unmapped', 'party_not_approver'])) AND (to_party_code IS NOT NULL) AND (to_user_id IS NULL) AND (to_group_id IS NULL)) OR ((routing_error = 'no_next_authority') AND (to_party_code IS NULL) AND (to_user_id IS NULL) AND (to_group_id IS NULL))))`

**Triggers:**

- `approval_escalation_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `approval_escalation_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `approval_escalation_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `approval_escalation_guard`: BEFORE INSERT FOR EACH ROW → `approval_escalation_guard()`
- `approval_escalation_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## approval_decision_record (view)

- **Purpose:** Read-only union of the business-approval decisions (D-089 Q10): `approval_decision` (source `approval`), `gate_decision` (source `gate_decision`, kind `gate_g1`…`gate_g6`) and `funding_decision` (source `funding_decision`, kind `funding`). Outcomes normalized to `approved | rejected | changes_requested | deferred | revoked`. No existing table is migrated.
- **Migration:** `0031_p4_approvals_permissions.sql`. **`mth_app` privileges:** SELECT.
- **Columns:** `source` text, `record_id` uuid, `organization_id` uuid, `transformation_id` uuid, `approval_kind` text, `subject_type` text, `subject_id` uuid, `subject_version` integer (NULL for funding), `outcome` text, `rationale` text, `decided_by` uuid, `on_behalf_of_user_id` uuid, `decided_at` timestamptz.

## P4 functions (slices I and C)

| Function | Migration | Purpose | Callable by `mth_app` |
|---|---|---|---|
| `p4_business_date(timestamptz, text)` | 0028 | the business date of an instant in a timezone: `(at AT TIME ZONE tz)::date` (ADR-0025 §2) | yes |
| `p4_valid_workweek(smallint[])` | 0028 | 1–7 distinct ISO weekdays (CHECK helper) | via CHECK |
| `p4_timezone_known()` | 0028 | the timezone is in `pg_timezone_names` | via trigger |
| `p4_ensure_default_calendar(uuid, uuid, text, text)` | 0028 | the organization's default calendar (Asia/Riyadh or the organization's timezone, Sunday–Thursday, no holiday), idempotent, audited; backfilled | yes |
| `inbox_notification_read_once()`, `work_item_guard()` | 0028 | read once; immutable identity; a closed item never reopens | via trigger |
| `access_group_member_same_org()`, `role_mapping_guard()` | 0029 | members and mapped users belong to the organization; mapping target immutable, ended final | via trigger |
| `delegation_loop_guard()` | 0029 | no delegation loop, race-free (lock 730224) | via trigger |
| `p4_parties_known(text[])` | 0030 | every party code exists | via trigger |
| `governance_matrix_rows_editable()` | 0030 | T11/T12 rows frozen while their matrix is in approval | via trigger |
| `transformation_decision_right_guard()`, `transformation_raci_assignment_guard()` | 0030 | known parties, immutable template key; immutable cell identity | via trigger |
| `transformation_raci_one_accountable()` | 0030 | deferred: exactly one A or A/R per active deliverable unless excepted (lock 730225) | via constraint triggers |
| `p4_instantiate_transformation(uuid, uuid, text, text)` | 0030 | P3 structure + 2 matrix headers + 4 T11 rows + 6 T12 deliverables + 36 cells, verbatim, idempotent, audited; backfilled | yes |
| `p4_approval_subject_version(text, uuid, uuid)` | 0031 | the subject's current version, read FOR SHARE | via triggers |
| `approval_guard()`, `approval_decision_guard()`, `approval_escalation_guard()` | 0031 | state machine, current request version, SoD, outcomes need a user's decision, escalation once and only when overdue (lock 730226) | via trigger |

## P4 validation rules summary (slices I and C)

| Layer | What it checks |
|---|---|
| Database | The P2 record guards on every mutable P4 table; closed sets (statuses, kinds, outcomes, SLA types, RACI values); workweek and timezone; one default calendar; holiday range; work-item and inbox dedupe keys; one active mapping per party; no delegation loop; one accountable per RACI deliverable; T11/T12 rows frozen in approval; approval state machine, current request version, SoD, rationale, defer date, outcome needs a user's decision, escalation once per due date and never an outcome; append-only decisions and escalations; technical-admin roles never hold `approval.decide` (0001 trigger) |
| API (`@mth/shared/schemas`) | Shapes (OpenAPI P4 schemas), free-text rules (`freeText`/`hasText`), strict UTF-8, request media types, `If-Match` |
| Service | Permissions and record-level rules (assignee, group, escalation target, delegate), commit-time re-authorization, routing without fallback (`routing.role_unmapped`), SLA computation and Unknown reasons, the exact refusal codes and English texts of ADR-0025 and ADR-0026 |

# P4 tables, slice A (migrations 0033–0036, DG4)

- **Task:** T-DG4-ARCH-02 (solution-architect), 2026-10-09. **ADRs:** ADR-0027 (KPI data model and pipeline), ADR-0028 (KPI calculation semantics).
- **Generated:** the per-table sections below were generated from the catalogue of a freshly migrated database by `docs/delivery/handbacks/DG4/T-DG4-ARCH-02-evidence/gen-dictionary.ts` (types, nullability, defaults, constraints, indexes, triggers and `mth_app` privileges as PostgreSQL reports them; `::text` casts removed for readability). Purpose, module, writers and lifecycle are written by hand.
- **Global rules** are those at the top of this file and the P2 record guards (`p2_attach_guards`: row guard, version step by 1, deferred audit coverage on `reporting_period`, `kpi_version`, `kpi_rag_threshold`, `target_trajectory`, `kpi_actual`, `rag_override`, and on UPDATE only for `data_quality_finding`; `p2_attach_append_only` on `kpi_formula_input`, `target_trajectory_point`, `kpi_actual_value`, `kpi_actual_review`, `kpi_actual_evidence`, `calculation_run`, `kpi_evaluation`). KPI values, bounds, thresholds and expected values are `numeric(24,6)` (decimal strings in the API; percentages are fractions). Event instants are `timestamptz`; observation periods and business dates are `date` (ADR-0025 §2). Every value row carries its own `currency` (`char(3)`), equal to the KPI's.
- **No DELETE** grant on any slice A table.
- **Advisory locks** (ADR-0016 §6): 730228 KPI formula graph (per transformation), 730229 KPI actual slot (KPI, scope, period; also RAG overrides), 730230 reporting periods (per organization and frequency); 730231 reserved.

## kpi_definition (0014) — P4 extension (0033)

- **No column change.** One additive trigger, `kpi_definition_measure_lock` (BEFORE UPDATE → `kpi_definition_measure_lock()`): once any `kpi_version` row exists for the KPI, `unit_kind`, `currency`, `polarity` and `frequency` cannot change (`kpi_definition_measure_locked`). A KPI without a version behaves exactly as in DG2.

## reporting_period

- **Purpose:** An observation period of one organization and frequency (REQ-S07-003, REQ-S12-005; ADR-0027 §3). Periods of one frequency never overlap (lock 730230). basis 'weeks' marks a week-based period whose week count decides comparability (REQ-S07-005).
- **Migration:** `0033_p4_kpi_dictionary_versions.sql`. **API module:** `kpi`. **Who writes:** `reporting_period.manage` (TO); the `kpi.reporting_period_open` job opens due periods. **Lifecycle:** scheduled → open → closed (final in P4).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| frequency | text | NOT NULL |  | `CHECK ((frequency = ANY (ARRAY['daily', 'weekly', 'monthly', 'quarterly', 'annual', 'ad_hoc'])))` |
| period_label | text | NOT NULL |  | `CHECK ((period_label ~ '^[0-9A-Za-z][0-9A-Za-z_.-]{0,31}$'))` |
| period_start | date | NOT NULL |  |  |
| period_end | date | NOT NULL |  |  |
| length_days | integer | NULL | `((period_end - period_start) + 1)` |  |
| basis | text | NOT NULL | `'calendar'` | `CHECK ((basis = ANY (ARRAY['calendar', 'weeks'])))` |
| week_count | smallint | NULL |  | `CHECK (((week_count IS NULL) OR ((week_count >= 1) AND (week_count <= 53))))` |
| update_due_date | date | NULL |  |  |
| status | text | NOT NULL | `'scheduled'` | `CHECK ((status = ANY (ARRAY['scheduled', 'open', 'closed'])))` |
| opened_at | timestamp with time zone | NULL |  |  |
| closed_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `reporting_period_due_after_end` (CHECK): `CHECK (((update_due_date IS NULL) OR (update_due_date > period_end)))`
- `reporting_period_label_key` (UNIQUE): `UNIQUE (organization_id, frequency, period_label)`
- `reporting_period_org_id_key` (UNIQUE): `UNIQUE (organization_id, id)`
- `reporting_period_range` (CHECK): `CHECK (((period_end >= period_start) AND ((period_end - period_start) <= 366)))`
- `reporting_period_status_stamps` (CHECK): `CHECK ((((status = 'scheduled') = (opened_at IS NULL)) AND ((status = 'closed') = (closed_at IS NOT NULL))))`
- `reporting_period_weeks` (CHECK): `CHECK ((((basis = 'weeks') = (week_count IS NOT NULL)) AND ((week_count IS NULL) OR (((period_end - period_start) + 1) = (week_count * 7)))))`

**Indexes:**

- `reporting_period_org_freq_idx`: `(organization_id, frequency, period_start DESC)`

**Triggers:**

- `reporting_period_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `reporting_period_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `reporting_period_guard()`
- `reporting_period_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## kpi_version

- **Purpose:** KPIVersion (REQ-S16-014): the versioned P4 measurement definition of a KPI; with the DG2 kpi_definition it holds every REQ-S07-001 field (measure type, value nature, numerator/denominator, calculation, baseline, target, aggregation rule, data-quality rule, submission route and approval policy; ADR-0027 §1-§2). An aggregation rule is required to activate (D-089 Q1).
- **Migration:** `0033_p4_kpi_dictionary_versions.sql`. **API module:** `kpi`. **Who writes:** `kpi_version.edit` (TL, KDS); `kpi_version.activate` (TL, KDS), after a business approval when definition_approval = business_approval. **Lifecycle:** draft → active | withdrawn; active → superseded.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| kpi_definition_id | uuid | NOT NULL |  |  |
| version_no | smallint | NOT NULL |  | `CHECK ((version_no >= 1))` |
| status | text | NOT NULL | `'draft'` | `CHECK ((status = ANY (ARRAY['draft', 'active', 'superseded', 'withdrawn'])))` |
| measure_type | text | NOT NULL |  | `CHECK ((measure_type = ANY (ARRAY['higher_is_better', 'lower_is_better', 'acceptable_band', 'binary_milestone'])))` |
| value_nature | text | NOT NULL |  | `CHECK ((value_nature = ANY (ARRAY['flow', 'stock', 'ratio', 'milestone'])))` |
| entry_scope_kind | text | NOT NULL | `'transformation'` | `CHECK ((entry_scope_kind = ANY (ARRAY['transformation', 'business_unit', 'initiative'])))` |
| unit_kind | text | NOT NULL |  | `CHECK ((unit_kind = ANY (ARRAY['currency', 'percentage', 'count', 'ratio', 'duration', 'score', 'other'])))` |
| unit_label | text | NULL |  | `CHECK (((unit_label IS NULL) OR ((char_length(unit_label) >= 1) AND (char_length(unit_label) <= 50))))` |
| currency | character(3) | NULL |  | `CHECK (((currency IS NULL) OR (currency ~ '^[A-Z]{3}$')))` |
| frequency | text | NOT NULL |  | `CHECK ((frequency = ANY (ARRAY['daily', 'weekly', 'monthly', 'quarterly', 'annual', 'ad_hoc'])))` |
| numerator_label | text | NULL |  | `CHECK (((numerator_label IS NULL) OR ((char_length(numerator_label) >= 1) AND (char_length(numerator_label) <= 200))))` |
| denominator_label | text | NULL |  | `CHECK (((denominator_label IS NULL) OR ((char_length(denominator_label) >= 1) AND (char_length(denominator_label) <= 200))))` |
| calculation_method | text | NOT NULL | `'entered'` | `CHECK ((calculation_method = ANY (ARRAY['entered', 'formula'])))` |
| calculation_description | text | NULL |  | `CHECK (((calculation_description IS NULL) OR ((char_length(calculation_description) >= 1) AND (char_length(calculation_description) <= 4000))))` |
| formula_expression | text | NULL |  | `CHECK (((formula_expression IS NULL) OR ((char_length(formula_expression) >= 1) AND (char_length(formula_expression) <= 2000))))` |
| formula_engine_version | text | NULL |  | `CHECK (((formula_engine_version IS NULL) OR ((char_length(formula_engine_version) >= 1) AND (char_length(formula_engine_version) <= 50))))` |
| aggregation_rule | text | NULL |  | `CHECK (((aggregation_rule IS NULL) OR (aggregation_rule = ANY (ARRAY['sum', 'last_value', 'weighted_ratio', 'custom_formula', 'none']))))` |
| stock_additive_across_scopes | boolean | NOT NULL | `false` |  |
| ytd_start_month | smallint | NOT NULL | `1` | `CHECK (((ytd_start_month >= 1) AND (ytd_start_month <= 12)))` |
| baseline_id | uuid | NULL |  |  |
| baseline_value | numeric(24,6) | NULL |  |  |
| baseline_date | date | NULL |  |  |
| target_value | numeric(24,6) | NULL |  |  |
| target_date | date | NULL |  |  |
| band_lower | numeric(24,6) | NULL |  |  |
| band_upper | numeric(24,6) | NULL |  |  |
| milestone_due_date | date | NULL |  |  |
| dq_stale_after_days | smallint | NOT NULL | `45` | `CHECK (((dq_stale_after_days >= 1) AND (dq_stale_after_days <= 3660)))` |
| dq_valid_min | numeric(24,6) | NULL |  |  |
| dq_valid_max | numeric(24,6) | NULL |  |  |
| dq_evidence_required | boolean | NOT NULL | `false` |  |
| submission_route | text | NOT NULL | `'review'` | `CHECK ((submission_route = ANY (ARRAY['review', 'direct_accept'])))` |
| reviewer_party_code | text | NULL |  | FK → governance_party(code) |
| definition_approval | text | NOT NULL | `'direct'` | `CHECK ((definition_approval = ANY (ARRAY['direct', 'business_approval'])))` |
| approval_id | uuid | NULL |  |  |
| change_reason | text | NULL |  | `CHECK (((change_reason IS NULL) OR ((char_length(change_reason) >= 3) AND (char_length(change_reason) <= 2000))))` |
| activated_at | timestamp with time zone | NULL |  |  |
| activated_by | uuid | NULL |  | FK → app_user(id) |
| superseded_at | timestamp with time zone | NULL |  |  |
| withdrawn_at | timestamp with time zone | NULL |  |  |
| withdrawn_by | uuid | NULL |  | FK → app_user(id) |
| withdraw_reason | text | NULL |  | `CHECK (((withdraw_reason IS NULL) OR ((char_length(withdraw_reason) >= 3) AND (char_length(withdraw_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `kpi_version_aggregation_fits_nature` (CHECK): `CHECK (((aggregation_rule IS NULL) OR (aggregation_rule = 'custom_formula') OR ((value_nature = 'flow') AND (aggregation_rule = 'sum')) OR ((value_nature = 'stock') AND (aggregation_rule = 'last_value')) OR ((value_nature = 'ratio') AND (aggregation_rule = 'weighted_ratio')) OR ((value_nature = 'milestone') AND (aggregation_rule = 'none'))))`
- `kpi_version_approval_fkey` (FK): `FOREIGN KEY (transformation_id, approval_id) REFERENCES approval(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_version_band` (CHECK): `CHECK ((((measure_type = 'acceptable_band') = ((band_lower IS NOT NULL) AND (band_upper IS NOT NULL))) AND ((band_lower IS NULL) = (band_upper IS NULL)) AND ((band_lower IS NULL) OR (band_lower <= band_upper))))`
- `kpi_version_baseline_fkey` (FK): `FOREIGN KEY (transformation_id, baseline_id) REFERENCES baseline(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_version_baseline_one_source` (CHECK): `CHECK (((baseline_id IS NULL) OR (baseline_value IS NULL)))`
- `kpi_version_change_reason` (CHECK): `CHECK (((version_no = 1) OR (change_reason IS NOT NULL)))`
- `kpi_version_complete_when_active` (CHECK): `CHECK (((status = ANY (ARRAY['draft', 'withdrawn'])) OR ((aggregation_rule IS NOT NULL) AND ((value_nature <> 'ratio') OR ((numerator_label IS NOT NULL) AND (denominator_label IS NOT NULL))) AND ((measure_type <> 'binary_milestone') OR (milestone_due_date IS NOT NULL)) AND (activated_at IS NOT NULL) AND (activated_by IS NOT NULL))))`
- `kpi_version_currency_unit` (CHECK): `CHECK (((unit_kind = 'currency') = (currency IS NOT NULL)))`
- `kpi_version_custom_formula_approved` (CHECK): `CHECK (((aggregation_rule IS DISTINCT FROM 'custom_formula') OR ((calculation_method = 'formula') AND (definition_approval = 'business_approval'))))`
- `kpi_version_dq_range` (CHECK): `CHECK (((dq_valid_min IS NULL) OR (dq_valid_max IS NULL) OR (dq_valid_min <= dq_valid_max)))`
- `kpi_version_formula_shape` (CHECK): `CHECK ((((calculation_method = 'formula') = (formula_expression IS NOT NULL)) AND ((formula_expression IS NULL) = (formula_engine_version IS NULL))))`
- `kpi_version_kpi_definition_fkey` (FK): `FOREIGN KEY (transformation_id, kpi_definition_id) REFERENCES kpi_definition(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_version_milestone` (CHECK): `CHECK ((((measure_type = 'binary_milestone') = (value_nature = 'milestone')) AND ((milestone_due_date IS NULL) OR (measure_type = 'binary_milestone'))))`
- `kpi_version_no_key` (UNIQUE): `UNIQUE (kpi_definition_id, version_no)`
- `kpi_version_ratio_labels` (CHECK): `CHECK (((value_nature = 'ratio') OR ((numerator_label IS NULL) AND (denominator_label IS NULL))))`
- `kpi_version_route_reviewer` (CHECK): `CHECK (((submission_route = 'review') = (reviewer_party_code IS NOT NULL)))`
- `kpi_version_status_stamps` (CHECK): `CHECK ((((status = 'superseded') = (superseded_at IS NOT NULL)) AND ((status = 'withdrawn') = (withdrawn_at IS NOT NULL)) AND ((withdrawn_at IS NULL) = (withdrawn_by IS NULL)) AND ((withdrawn_at IS NULL) = (withdraw_reason IS NULL)) AND ((status = ANY (ARRAY['draft', 'withdrawn'])) OR (activated_at IS NOT NULL))))`
- `kpi_version_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `kpi_version_one_active`: `UNIQUE (kpi_definition_id) WHERE (status = 'active')`
- `kpi_version_one_draft`: `UNIQUE (kpi_definition_id) WHERE (status = 'draft')`
- `kpi_version_transformation_idx`: `(transformation_id, updated_at DESC, id DESC)`

**Triggers:**

- `kpi_version_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `kpi_version_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `kpi_version_guard()`
- `kpi_version_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## kpi_formula_input

- **Purpose:** A formula variable of a KPI version bound to another KPI of the transformation; the edges of the cycle check (REQ-S07-011; ADR-0027 §4).
- **Migration:** `0033_p4_kpi_dictionary_versions.sql`. **API module:** `kpi`. **Who writes:** `kpi_version.edit` (with its draft version). **Lifecycle:** append-only; inserted only while the version is a draft.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| kpi_version_id | uuid | NOT NULL |  |  |
| variable_name | text | NOT NULL |  | `CHECK ((variable_name ~ '^[a-z][a-z0-9_]{0,47}$'))` |
| source_kpi_definition_id | uuid | NOT NULL |  |  |
| input_basis | text | NOT NULL | `'period'` | `CHECK ((input_basis = ANY (ARRAY['period', 'cumulative'])))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `kpi_formula_input_source_fkey` (FK): `FOREIGN KEY (transformation_id, source_kpi_definition_id) REFERENCES kpi_definition(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_formula_input_variable_key` (UNIQUE): `UNIQUE (kpi_version_id, variable_name)`
- `kpi_formula_input_version_fkey` (FK): `FOREIGN KEY (transformation_id, kpi_version_id) REFERENCES kpi_version(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Indexes:**

- `kpi_formula_input_source_idx`: `(source_kpi_definition_id)`

**Triggers:**

- `kpi_formula_input_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `kpi_formula_input_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `kpi_formula_input_guard`: BEFORE INSERT FOR EACH ROW → `kpi_formula_input_guard()`
- `kpi_formula_input_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## kpi_rag_threshold

- **Purpose:** A versioned set of RAG thresholds of a KPI (REQ-S07-007; ADR-0028 §5). A new version supersedes the active one and triggers a calculation run.
- **Migration:** `0033_p4_kpi_dictionary_versions.sql`. **API module:** `kpi`. **Who writes:** `kpi_threshold.configure` (TL, KDS). **Lifecycle:** active → superseded.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| kpi_definition_id | uuid | NOT NULL |  |  |
| version_no | smallint | NOT NULL |  | `CHECK ((version_no >= 1))` |
| tolerance_mode | text | NOT NULL |  | `CHECK ((tolerance_mode = ANY (ARRAY['relative', 'absolute'])))` |
| amber_threshold | numeric(24,6) | NOT NULL |  | `CHECK ((amber_threshold >= (0)::numeric))` |
| red_threshold | numeric(24,6) | NOT NULL |  |  |
| reason | text | NOT NULL |  | `CHECK (((char_length(btrim(reason)) >= 3) AND (char_length(reason) <= 2000)))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'superseded'])))` |
| superseded_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `kpi_rag_threshold_kpi_fkey` (FK): `FOREIGN KEY (transformation_id, kpi_definition_id) REFERENCES kpi_definition(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_rag_threshold_no_key` (UNIQUE): `UNIQUE (kpi_definition_id, version_no)`
- `kpi_rag_threshold_order` (CHECK): `CHECK ((red_threshold >= amber_threshold))`
- `kpi_rag_threshold_superseded` (CHECK): `CHECK (((status = 'superseded') = (superseded_at IS NOT NULL)))`
- `kpi_rag_threshold_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `kpi_rag_threshold_one_active`: `UNIQUE (kpi_definition_id) WHERE (status = 'active')`

**Triggers:**

- `kpi_rag_threshold_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `kpi_rag_threshold_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `kpi_rag_threshold_guard()`
- `kpi_rag_threshold_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## target_trajectory

- **Purpose:** TargetTrajectory (REQ-S16-014): the expected path of a KPI for one scope; RAG uses the approved one (REQ-S07-007; ADR-0027 §5). DG2 outcome_kpi trajectories are copied once by 0036 (source outcome_kpi_backfill).
- **Migration:** `0034_p4_kpi_trajectories_actuals.sql`. **API module:** `kpi`. **Who writes:** `target_trajectory.edit` (TL, KDS); approval `kpi_target.approve` (SP, BO; not the creator). **Lifecycle:** draft → approved | withdrawn; approved → superseded.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| kpi_definition_id | uuid | NOT NULL |  |  |
| scope_kind | text | NOT NULL | `'transformation'` | `CHECK ((scope_kind = ANY (ARRAY['transformation', 'business_unit', 'initiative'])))` |
| scope_id | uuid | NOT NULL |  |  |
| version_no | smallint | NOT NULL |  | `CHECK ((version_no >= 1))` |
| basis | text | NOT NULL | `'period'` | `CHECK ((basis = ANY (ARRAY['period', 'cumulative'])))` |
| interpolation | text | NOT NULL | `'linear'` | `CHECK ((interpolation = ANY (ARRAY['linear', 'step'])))` |
| source | text | NOT NULL | `'api'` | `CHECK ((source = ANY (ARRAY['api', 'outcome_kpi_import', 'outcome_kpi_backfill'])))` |
| source_outcome_kpi_id | uuid | NULL |  |  |
| status | text | NOT NULL | `'draft'` | `CHECK ((status = ANY (ARRAY['draft', 'approved', 'superseded', 'withdrawn'])))` |
| approved_by | uuid | NULL |  | FK → app_user(id) |
| approved_at | timestamp with time zone | NULL |  |  |
| approved_record_version | integer | NULL |  | `CHECK (((approved_record_version IS NULL) OR (approved_record_version >= 1)))` |
| superseded_at | timestamp with time zone | NULL |  |  |
| withdrawn_at | timestamp with time zone | NULL |  |  |
| withdraw_reason | text | NULL |  | `CHECK (((withdraw_reason IS NULL) OR ((char_length(withdraw_reason) >= 3) AND (char_length(withdraw_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `target_trajectory_approval_complete` (CHECK): `CHECK ((((status = ANY (ARRAY['approved', 'superseded'])) = (approved_by IS NOT NULL)) AND ((approved_by IS NULL) = (approved_at IS NULL)) AND ((approved_at IS NULL) = (approved_record_version IS NULL))))`
- `target_trajectory_approver_not_creator` (CHECK): `CHECK (((approved_by IS NULL) OR (approved_by <> created_by)))`
- `target_trajectory_kpi_fkey` (FK): `FOREIGN KEY (transformation_id, kpi_definition_id) REFERENCES kpi_definition(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `target_trajectory_no_key` (UNIQUE): `UNIQUE (kpi_definition_id, scope_kind, scope_id, version_no)`
- `target_trajectory_outcome_kpi_fkey` (FK): `FOREIGN KEY (transformation_id, source_outcome_kpi_id) REFERENCES outcome_kpi(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `target_trajectory_source_ref` (CHECK): `CHECK (((source = 'api') = (source_outcome_kpi_id IS NULL)))`
- `target_trajectory_status_stamps` (CHECK): `CHECK ((((status = 'superseded') = (superseded_at IS NOT NULL)) AND ((status = 'withdrawn') = (withdrawn_at IS NOT NULL)) AND ((withdrawn_at IS NULL) = (withdraw_reason IS NULL))))`
- `target_trajectory_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `target_trajectory_one_approved`: `UNIQUE (kpi_definition_id, scope_kind, scope_id) WHERE (status = 'approved')`
- `target_trajectory_one_draft`: `UNIQUE (kpi_definition_id, scope_kind, scope_id) WHERE (status = 'draft')`
- `target_trajectory_transformation_idx`: `(transformation_id, updated_at DESC, id DESC)`

**Triggers:**

- `target_trajectory_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `target_trajectory_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `target_trajectory_guard()`
- `target_trajectory_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## target_trajectory_point

- **Purpose:** One expected value at a date of a trajectory (ADR-0027 §5).
- **Migration:** `0034_p4_kpi_trajectories_actuals.sql`. **API module:** `kpi`. **Who writes:** `target_trajectory.edit` (with its draft trajectory). **Lifecycle:** append-only; inserted only while the trajectory is a draft.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| target_trajectory_id | uuid | NOT NULL |  |  |
| point_date | date | NOT NULL |  |  |
| expected_value | numeric(24,6) | NOT NULL |  |  |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `target_trajectory_point_date_key` (UNIQUE): `UNIQUE (target_trajectory_id, point_date)`
- `target_trajectory_point_trajectory_fkey` (FK): `FOREIGN KEY (transformation_id, target_trajectory_id) REFERENCES target_trajectory(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Triggers:**

- `target_trajectory_point_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `target_trajectory_point_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `target_trajectory_point_guard`: BEFORE INSERT FOR EACH ROW → `target_trajectory_point_guard()`
- `target_trajectory_point_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## kpi_actual

- **Purpose:** KPIActual (REQ-S16-014): the actual SLOT of one KPI, scope and reporting period (REQ-S07-003). A second actual is a new value version of the same slot. The only audited row of an entry: one audit event per save, submit, accept or reject (REQ-S07-013).
- **Migration:** `0034_p4_kpi_trajectories_actuals.sql`. **API module:** `kpi`. **Who writes:** `kpi_actual.submit` (KDS, BO; owner, steward or update assignee); `kpi_actual.accept` (SP, TL, BO; the configured reviewer, not the submitter). **Lifecycle:** draft → submitted → accepted | rejected; direct-accept route: draft → accepted; a new value reopens to draft/submitted.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| kpi_definition_id | uuid | NOT NULL |  |  |
| scope_kind | text | NOT NULL |  | `CHECK ((scope_kind = ANY (ARRAY['transformation', 'business_unit', 'initiative'])))` |
| scope_id | uuid | NOT NULL |  |  |
| reporting_period_id | uuid | NOT NULL |  |  |
| period_start | date | NOT NULL |  |  |
| period_end | date | NOT NULL |  |  |
| period_label | text | NOT NULL |  |  |
| current_value_no | smallint | NOT NULL | `1` | `CHECK ((current_value_no >= 1))` |
| accepted_value_no | smallint | NULL |  | `CHECK (((accepted_value_no IS NULL) OR (accepted_value_no >= 1)))` |
| status | text | NOT NULL |  | `CHECK ((status = ANY (ARRAY['draft', 'submitted', 'accepted', 'rejected'])))` |
| route | text | NOT NULL |  | `CHECK ((route = ANY (ARRAY['review', 'direct_accept'])))` |
| submitted_by | uuid | NULL |  | FK → app_user(id) |
| submitted_at | timestamp with time zone | NULL |  |  |
| decided_by | uuid | NULL |  | FK → app_user(id) |
| decided_at | timestamp with time zone | NULL |  |  |
| decision_reason | text | NULL |  | `CHECK (((decision_reason IS NULL) OR ((char_length(decision_reason) >= 1) AND (char_length(decision_reason) <= 2000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `kpi_actual_accepted_le_current` (CHECK): `CHECK (((accepted_value_no IS NULL) OR (accepted_value_no <= current_value_no)))`
- `kpi_actual_accepted_pointer` (CHECK): `CHECK (((status <> 'accepted') OR (accepted_value_no = current_value_no)))`
- `kpi_actual_decided_stamps` (CHECK): `CHECK ((((status = ANY (ARRAY['accepted', 'rejected'])) = (decided_by IS NOT NULL)) AND ((decided_by IS NULL) = (decided_at IS NULL))))`
- `kpi_actual_direct_route` (CHECK): `CHECK (((route <> 'direct_accept') OR (status <> 'submitted')))`
- `kpi_actual_kpi_fkey` (FK): `FOREIGN KEY (transformation_id, kpi_definition_id) REFERENCES kpi_definition(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_actual_period_fkey` (FK): `FOREIGN KEY (organization_id, reporting_period_id) REFERENCES reporting_period(organization_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_actual_reject_reason` (CHECK): `CHECK (((status <> 'rejected') OR (decision_reason IS NOT NULL)))`
- `kpi_actual_review_sod` (CHECK): `CHECK (((route <> 'review') OR (decided_by IS NULL) OR (decided_by <> submitted_by)))`
- `kpi_actual_slot_key` (UNIQUE): `UNIQUE (kpi_definition_id, scope_kind, scope_id, reporting_period_id)`
- `kpi_actual_submitted_stamps` (CHECK): `CHECK ((((status = 'draft') = (submitted_by IS NULL)) AND ((submitted_by IS NULL) = (submitted_at IS NULL))))`
- `kpi_actual_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `kpi_actual_kpi_period_idx`: `(kpi_definition_id, period_end DESC)`
- `kpi_actual_review_queue_idx`: `(transformation_id, submitted_at) WHERE (status = 'submitted')`
- `kpi_actual_transformation_idx`: `(transformation_id, updated_at DESC, id DESC)`

**Triggers:**

- `kpi_actual_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `kpi_actual_consistency`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `kpi_actual_consistency()`
- `kpi_actual_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `kpi_actual_guard()`
- `kpi_actual_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## kpi_actual_value

- **Purpose:** Every entered value version of a slot: value, numerator/denominator, milestone flag, or an explicit missing_reason (Unknown, never 0); currency, data-as-of, entry instant and business date (REQ-S07-003, REQ-S07-005, REQ-S15-008).
- **Migration:** `0034_p4_kpi_trajectories_actuals.sql`. **API module:** `kpi`. **Who writes:** `kpi_actual.submit` (in the slot's transaction). **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| kpi_actual_id | uuid | NOT NULL |  |  |
| value_no | smallint | NOT NULL |  | `CHECK ((value_no >= 1))` |
| kpi_version_id | uuid | NOT NULL |  |  |
| value | numeric(24,6) | NULL |  |  |
| numerator | numeric(24,6) | NULL |  |  |
| denominator | numeric(24,6) | NULL |  |  |
| milestone_achieved | boolean | NULL |  |  |
| achieved_on | date | NULL |  |  |
| currency | character(3) | NULL |  | `CHECK (((currency IS NULL) OR (currency ~ '^[A-Z]{3}$')))` |
| missing_reason | text | NULL |  | `CHECK (((missing_reason IS NULL) OR ((char_length(missing_reason) >= 1) AND (char_length(missing_reason) <= 1000))))` |
| data_as_of | date | NOT NULL |  |  |
| comment | text | NULL |  | `CHECK (((comment IS NULL) OR ((char_length(comment) >= 1) AND (char_length(comment) <= 4000))))` |
| entered_at | timestamp with time zone | NOT NULL | `now()` |  |
| entered_by | uuid | NOT NULL |  | FK → app_user(id) |
| business_date | date | NOT NULL |  |  |

**Table constraints:**

- `kpi_actual_value_achieved_on` (CHECK): `CHECK (((achieved_on IS NULL) OR (milestone_achieved IS TRUE)))`
- `kpi_actual_value_actual_fkey` (FK): `FOREIGN KEY (transformation_id, kpi_actual_id) REFERENCES kpi_actual(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_actual_value_no_key` (UNIQUE): `UNIQUE (kpi_actual_id, value_no)`
- `kpi_actual_value_version_fkey` (FK): `FOREIGN KEY (transformation_id, kpi_version_id) REFERENCES kpi_version(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Triggers:**

- `kpi_actual_value_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `kpi_actual_value_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `kpi_actual_value_guard`: BEFORE INSERT FOR EACH ROW → `kpi_actual_value_guard()`
- `kpi_actual_value_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## kpi_actual_review

- **Purpose:** The decision on one value version: accept, reject (with reason) or direct_accept (REQ-S07-012).
- **Migration:** `0034_p4_kpi_trajectories_actuals.sql`. **API module:** `kpi`. **Who writes:** `kpi_actual.accept` (reviewer); the direct-accept route (submitter). **Lifecycle:** append-only; one per value version.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| kpi_actual_id | uuid | NOT NULL |  |  |
| value_no | smallint | NOT NULL |  | `CHECK ((value_no >= 1))` |
| outcome | text | NOT NULL |  | `CHECK ((outcome = ANY (ARRAY['accept', 'reject', 'direct_accept'])))` |
| reason | text | NULL |  | `CHECK (((reason IS NULL) OR ((char_length(reason) >= 1) AND (char_length(reason) <= 2000))))` |
| decided_by | uuid | NOT NULL |  | FK → app_user(id) |
| on_behalf_of_user_id | uuid | NULL |  | FK → app_user(id) |
| decided_at | timestamp with time zone | NOT NULL | `now()` |  |
| business_date | date | NOT NULL |  |  |

**Table constraints:**

- `kpi_actual_review_actual_fkey` (FK): `FOREIGN KEY (transformation_id, kpi_actual_id) REFERENCES kpi_actual(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_actual_review_not_self_behalf` (CHECK): `CHECK ((on_behalf_of_user_id IS DISTINCT FROM decided_by))`
- `kpi_actual_review_reject_reason` (CHECK): `CHECK (((outcome <> 'reject') OR (reason IS NOT NULL)))`
- `kpi_actual_review_value_fkey` (FK): `FOREIGN KEY (kpi_actual_id, value_no) REFERENCES kpi_actual_value(kpi_actual_id, value_no) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_actual_review_value_key` (UNIQUE): `UNIQUE (kpi_actual_id, value_no)`

**Triggers:**

- `kpi_actual_review_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `kpi_actual_review_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `kpi_actual_review_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## kpi_actual_evidence

- **Purpose:** Evidence linked to a value version (REQ-S07-017).
- **Migration:** `0034_p4_kpi_trajectories_actuals.sql`. **API module:** `kpi`. **Who writes:** `kpi_actual.submit`. **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| kpi_actual_id | uuid | NOT NULL |  |  |
| value_no | smallint | NOT NULL |  | `CHECK ((value_no >= 1))` |
| evidence_id | uuid | NOT NULL |  |  |
| linked_at | timestamp with time zone | NOT NULL | `now()` |  |
| linked_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `kpi_actual_evidence_actual_fkey` (FK): `FOREIGN KEY (transformation_id, kpi_actual_id) REFERENCES kpi_actual(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_actual_evidence_evidence_fkey` (FK): `FOREIGN KEY (transformation_id, evidence_id) REFERENCES evidence(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_actual_evidence_key` (UNIQUE): `UNIQUE (kpi_actual_id, value_no, evidence_id)`
- `kpi_actual_evidence_value_fkey` (FK): `FOREIGN KEY (kpi_actual_id, value_no) REFERENCES kpi_actual_value(kpi_actual_id, value_no) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Triggers:**

- `kpi_actual_evidence_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `kpi_actual_evidence_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `kpi_actual_evidence_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## calculation_run

- **Purpose:** CalculationRun (REQ-S16-014): one run per trigger (accepted value, threshold version, approved trajectory, activated version); unique per trigger so a retry or restart never writes a second (REQ-S07-013, REQ-S12-006; ADR-0027 §7-§8). Lineage; no audit event.
- **Migration:** `0035_p4_kpi_calculation_runs_quality.sql`. **API module:** `kpi (worker `kpi.recalculate`)`. **Who writes:** the worker (service actor). **Lifecycle:** append-only; completed | failed.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| seq | bigint | NOT NULL |  |  |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| trigger_kind | text | NOT NULL |  | `CHECK ((trigger_kind = ANY (ARRAY['actual_accepted', 'threshold_changed', 'trajectory_approved', 'version_activated'])))` |
| trigger_record_type | text | NOT NULL |  | `CHECK ((trigger_record_type = ANY (ARRAY['kpi_actual', 'kpi_rag_threshold', 'target_trajectory', 'kpi_version'])))` |
| trigger_record_id | uuid | NOT NULL |  |  |
| trigger_slot | integer | NOT NULL |  | `CHECK ((trigger_slot >= 1))` |
| idempotency_key | text | NOT NULL |  | `CHECK (((char_length(idempotency_key) >= 1) AND (char_length(idempotency_key) <= 200)))` |
| status | text | NOT NULL |  | `CHECK ((status = ANY (ARRAY['completed', 'failed'])))` |
| error_code | text | NULL |  | `CHECK (((error_code IS NULL) OR (error_code ~ '^[a-z_]+\.[a-z_.]{1,80}$')))` |
| evaluation_count | integer | NOT NULL | `0` | `CHECK ((evaluation_count >= 0))` |
| finding_count | integer | NOT NULL | `0` | `CHECK ((finding_count >= 0))` |
| formula_engine_version | text | NOT NULL |  | `CHECK (((char_length(formula_engine_version) >= 1) AND (char_length(formula_engine_version) <= 50)))` |
| kpi_rules_version | text | NOT NULL |  | `CHECK (((char_length(kpi_rules_version) >= 1) AND (char_length(kpi_rules_version) <= 50)))` |
| started_at | timestamp with time zone | NOT NULL |  |  |
| completed_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `calculation_run_failed_shape` (CHECK): `CHECK (((status = 'failed') = (error_code IS NOT NULL)))`
- `calculation_run_idempotency_key` (UNIQUE): `UNIQUE (idempotency_key)`
- `calculation_run_seq_key` (UNIQUE): `UNIQUE (seq)`
- `calculation_run_times` (CHECK): `CHECK ((completed_at >= started_at))`
- `calculation_run_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`
- `calculation_run_trigger_key` (UNIQUE): `UNIQUE (trigger_kind, trigger_record_id, trigger_slot)`
- `calculation_run_trigger_pair` (CHECK): `CHECK ((((trigger_kind = 'actual_accepted') AND (trigger_record_type = 'kpi_actual')) OR ((trigger_kind = 'threshold_changed') AND (trigger_record_type = 'kpi_rag_threshold')) OR ((trigger_kind = 'trajectory_approved') AND (trigger_record_type = 'target_trajectory')) OR ((trigger_kind = 'version_activated') AND (trigger_record_type = 'kpi_version'))))`

**Indexes:**

- `calculation_run_transformation_idx`: `(transformation_id, seq DESC)`

**Triggers:**

- `calculation_run_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `calculation_run_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `calculation_run_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## kpi_evaluation

- **Purpose:** One evaluated KPI value per run, KPI, scope, period and basis: value and status, expected-to-date, final target, variance, trend, freshness, calculated RAG and the rule explanation (REQ-S07-004..-008; ADR-0028 §6). Lineage; no audit event.
- **Migration:** `0035_p4_kpi_calculation_runs_quality.sql`. **API module:** `kpi (worker)`. **Who writes:** the worker (service actor). **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| calculation_run_id | uuid | NOT NULL |  |  |
| kpi_definition_id | uuid | NOT NULL |  |  |
| kpi_version_id | uuid | NOT NULL |  |  |
| scope_kind | text | NOT NULL |  | `CHECK ((scope_kind = ANY (ARRAY['transformation', 'business_unit', 'initiative'])))` |
| scope_id | uuid | NOT NULL |  |  |
| reporting_period_id | uuid | NOT NULL |  |  |
| period_label | text | NOT NULL |  |  |
| value_basis | text | NOT NULL |  | `CHECK ((value_basis = ANY (ARRAY['period', 'cumulative'])))` |
| value | numeric(24,6) | NULL |  |  |
| value_status | text | NOT NULL |  | `CHECK ((value_status = ANY (ARRAY['ok', 'unknown', 'stale', 'not_computable'])))` |
| value_reason | text | NULL |  | `CHECK (((value_reason IS NULL) OR (value_reason ~ '^kpi\.[a-z_]{1,60}$')))` |
| value_source | text | NOT NULL |  | `CHECK ((value_source = ANY (ARRAY['entered', 'rolled_up', 'formula', 'none'])))` |
| currency | character(3) | NULL |  | `CHECK (((currency IS NULL) OR (currency ~ '^[A-Z]{3}$')))` |
| inputs | jsonb | NOT NULL | `'{}'::jsonb` | `CHECK ((jsonb_typeof(inputs) = 'object'))` |
| rounding | jsonb | NULL |  | `CHECK (((rounding IS NULL) OR (jsonb_typeof(rounding) = 'object')))` |
| expected_value | numeric(24,6) | NULL |  |  |
| final_target | numeric(24,6) | NULL |  |  |
| variance | numeric(24,6) | NULL |  |  |
| variance_ratio | numeric(24,6) | NULL |  |  |
| comparison_flag | text | NULL |  | `CHECK (((comparison_flag IS NULL) OR (comparison_flag = ANY (ARRAY['negative_baseline', 'not_comparable', 'zero_base']))))` |
| trend | text | NOT NULL |  | `CHECK ((trend = ANY (ARRAY['improving', 'worsening', 'flat', 'not_comparable', 'unknown'])))` |
| previous_period_id | uuid | NULL |  |  |
| data_as_of | date | NULL |  |  |
| calculated_rag | text | NOT NULL |  | `CHECK ((calculated_rag = ANY (ARRAY['green', 'amber', 'red', 'unknown', 'stale', 'not_computable'])))` |
| deviation | text | NOT NULL |  | `CHECK ((deviation = ANY (ARRAY['favourable', 'within', 'adverse', 'unknown'])))` |
| threshold_id | uuid | NULL |  |  |
| threshold_source | text | NOT NULL |  | `CHECK ((threshold_source = ANY (ARRAY['configured', 'default', 'none'])))` |
| target_trajectory_id | uuid | NULL |  |  |
| explanation_key | text | NOT NULL |  | `CHECK ((explanation_key ~ '^kpi\.rag\.[a-z_]{1,60}$'))` |
| explanation_params | jsonb | NOT NULL | `'{}'::jsonb` | `CHECK ((jsonb_typeof(explanation_params) = 'object'))` |
| evaluated_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `kpi_evaluation_key` (UNIQUE): `UNIQUE (calculation_run_id, kpi_definition_id, scope_kind, scope_id, reporting_period_id, value_basis)`
- `kpi_evaluation_kpi_fkey` (FK): `FOREIGN KEY (transformation_id, kpi_definition_id) REFERENCES kpi_definition(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_evaluation_period_fkey` (FK): `FOREIGN KEY (organization_id, reporting_period_id) REFERENCES reporting_period(organization_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_evaluation_rag_needs_data` (CHECK): `CHECK (((calculated_rag <> ALL (ARRAY['green', 'amber', 'red'])) OR ((value_status = 'ok') AND (deviation <> 'unknown'))))`
- `kpi_evaluation_run_fkey` (FK): `FOREIGN KEY (transformation_id, calculation_run_id) REFERENCES calculation_run(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_evaluation_threshold_fkey` (FK): `FOREIGN KEY (transformation_id, threshold_id) REFERENCES kpi_rag_threshold(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_evaluation_threshold_source` (CHECK): `CHECK (((threshold_source = 'configured') = (threshold_id IS NOT NULL)))`
- `kpi_evaluation_trajectory_fkey` (FK): `FOREIGN KEY (transformation_id, target_trajectory_id) REFERENCES target_trajectory(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_evaluation_unknown_rag` (CHECK): `CHECK (((value_status = 'ok') OR (calculated_rag = value_status)))`
- `kpi_evaluation_value_status` (CHECK): `CHECK ((((value IS NOT NULL) = (value_status = ANY (ARRAY['ok', 'stale']))) AND ((value_status = 'ok') OR (value_reason IS NOT NULL))))`
- `kpi_evaluation_version_fkey` (FK): `FOREIGN KEY (transformation_id, kpi_version_id) REFERENCES kpi_version(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Indexes:**

- `kpi_evaluation_run_idx`: `(calculation_run_id)`
- `kpi_evaluation_slot_idx`: `(kpi_definition_id, scope_kind, scope_id, reporting_period_id, value_basis)`

**Triggers:**

- `kpi_evaluation_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `kpi_evaluation_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `kpi_evaluation_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## data_quality_finding

- **Purpose:** DataQualityFinding (REQ-S16-014): a data-quality exception found by a run (missing, stale, out of range, evidence missing, zero denominator, not comparable, negative baseline, scope missing; ADR-0027 §9).
- **Migration:** `0035_p4_kpi_calculation_runs_quality.sql`. **API module:** `kpi`. **Who writes:** the worker inserts (lineage); `data_quality.manage` (TL, KDS) resolves or dismisses (audited). **Lifecycle:** open → resolved | dismissed (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| kpi_definition_id | uuid | NOT NULL |  |  |
| scope_kind | text | NOT NULL |  | `CHECK ((scope_kind = ANY (ARRAY['transformation', 'business_unit', 'initiative'])))` |
| scope_id | uuid | NOT NULL |  |  |
| reporting_period_id | uuid | NOT NULL |  |  |
| kpi_actual_id | uuid | NULL |  |  |
| value_no | smallint | NULL |  | `CHECK (((value_no IS NULL) OR (value_no >= 1)))` |
| rule_code | text | NOT NULL |  | `CHECK ((rule_code = ANY (ARRAY['missing_actual', 'stale', 'out_of_range', 'evidence_missing', 'zero_denominator', 'not_comparable', 'negative_baseline', 'scope_missing'])))` |
| severity | text | NOT NULL |  | `CHECK ((severity = ANY (ARRAY['info', 'warning'])))` |
| detail_params | jsonb | NOT NULL | `'{}'::jsonb` | `CHECK ((jsonb_typeof(detail_params) = 'object'))` |
| detected_by_run_id | uuid | NOT NULL |  |  |
| detected_at | timestamp with time zone | NOT NULL | `now()` |  |
| status | text | NOT NULL | `'open'` | `CHECK ((status = ANY (ARRAY['open', 'resolved', 'dismissed'])))` |
| resolution_note | text | NULL |  | `CHECK (((resolution_note IS NULL) OR ((char_length(resolution_note) >= 3) AND (char_length(resolution_note) <= 2000))))` |
| resolved_by | uuid | NULL |  | FK → app_user(id) |
| resolved_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `data_quality_finding_actual_fkey` (FK): `FOREIGN KEY (transformation_id, kpi_actual_id) REFERENCES kpi_actual(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `data_quality_finding_kpi_fkey` (FK): `FOREIGN KEY (transformation_id, kpi_definition_id) REFERENCES kpi_definition(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `data_quality_finding_period_fkey` (FK): `FOREIGN KEY (organization_id, reporting_period_id) REFERENCES reporting_period(organization_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `data_quality_finding_resolution` (CHECK): `CHECK ((((status = 'open') = (resolved_at IS NULL)) AND ((resolved_at IS NULL) = (resolved_by IS NULL)) AND ((resolved_at IS NULL) = (resolution_note IS NULL))))`
- `data_quality_finding_run_fkey` (FK): `FOREIGN KEY (transformation_id, detected_by_run_id) REFERENCES calculation_run(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `data_quality_finding_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`
- `data_quality_finding_value_ref` (CHECK): `CHECK (((value_no IS NULL) OR (kpi_actual_id IS NOT NULL)))`

**Indexes:**

- `data_quality_finding_one_open`: `UNIQUE (kpi_definition_id, scope_kind, scope_id, reporting_period_id, rule_code) WHERE (status = 'open')`
- `data_quality_finding_transformation_idx`: `(transformation_id, status, detected_at DESC)`

**Triggers:**

- `data_quality_finding_audit_required`: CONSTRAINT AFTER UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `data_quality_finding_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `data_quality_finding_guard()`
- `data_quality_finding_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## rag_override

- **Purpose:** A manual RAG for one KPI, scope and period with reason, evidence and expiry; the calculated RAG is preserved (REQ-S07-009; ADR-0027 §10). In force while active and before expires_at.
- **Migration:** `0035_p4_kpi_calculation_runs_quality.sql`. **API module:** `kpi`. **Who writes:** `rag.override` (TL, BO). **Lifecycle:** active → revoked (final); expiry ends it without a write.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| kpi_definition_id | uuid | NOT NULL |  |  |
| scope_kind | text | NOT NULL |  | `CHECK ((scope_kind = ANY (ARRAY['transformation', 'business_unit', 'initiative'])))` |
| scope_id | uuid | NOT NULL |  |  |
| reporting_period_id | uuid | NOT NULL |  |  |
| override_rag | text | NOT NULL |  | `CHECK ((override_rag = ANY (ARRAY['green', 'amber', 'red'])))` |
| calculated_rag | text | NOT NULL |  | `CHECK ((calculated_rag = ANY (ARRAY['green', 'amber', 'red', 'unknown', 'stale', 'not_computable'])))` |
| kpi_evaluation_id | uuid | NULL |  | FK → kpi_evaluation(id) |
| reason | text | NOT NULL |  | `CHECK (((char_length(btrim(reason)) >= 3) AND (char_length(reason) <= 2000)))` |
| evidence_id | uuid | NOT NULL |  |  |
| expires_at | timestamp with time zone | NOT NULL |  |  |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'revoked'])))` |
| revoked_by | uuid | NULL |  | FK → app_user(id) |
| revoked_at | timestamp with time zone | NULL |  |  |
| revoke_reason | text | NULL |  | `CHECK (((revoke_reason IS NULL) OR ((char_length(revoke_reason) >= 3) AND (char_length(revoke_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `rag_override_evidence_fkey` (FK): `FOREIGN KEY (transformation_id, evidence_id) REFERENCES evidence(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `rag_override_expiry_window` (CHECK): `CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '366 days'::interval))))`
- `rag_override_kpi_fkey` (FK): `FOREIGN KEY (transformation_id, kpi_definition_id) REFERENCES kpi_definition(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `rag_override_period_fkey` (FK): `FOREIGN KEY (organization_id, reporting_period_id) REFERENCES reporting_period(organization_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `rag_override_revoked` (CHECK): `CHECK ((((status = 'revoked') = (revoked_at IS NOT NULL)) AND ((revoked_at IS NULL) = (revoked_by IS NULL)) AND ((revoked_at IS NULL) = (revoke_reason IS NULL))))`
- `rag_override_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `rag_override_slot_idx`: `(kpi_definition_id, scope_kind, scope_id, reporting_period_id, expires_at DESC)`

**Triggers:**

- `rag_override_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `rag_override_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `rag_override_guard()`
- `rag_override_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## P4 seeds and backfill (0036, slice A)

- `approval_type` `kpi_version_activation` (subject `kpi_version`, SoD `requester_excluded`, owner module `kpi`).
- `work_item_kind` `kpi_actual_review`, `kpi_actual_rejected` (label_ar provisional wording).
- `permission` (9 rows, each `write` or `configure`) and `role_permission` (18 rows): exactly `P4_KPI_PERMISSIONS` / `P4_KPI_ROLE_PERMISSIONS` in `packages/shared/src/permissions.ts` (`packages/db/src/seed.test.ts`). AUD and the technical-admin roles hold none.
- Backfill: one approved `target_trajectory` (+ points) per KPI from its most recently approved, active DG2 `outcome_kpi` trajectory; creator, approver and approval time preserved; two audit events each (actor `system`, source `migration`). `outcome_kpi` rows are unchanged.

## P4 functions (slice A)

| Function | Migration | Purpose | Callable by `mth_app` |
|---|---|---|---|
| `reporting_period_guard()` | 0033 | fixed identity, status step, no overlap per organization and frequency (lock 730230) | via trigger |
| `p4_kpi_formula_reaches(uuid, uuid, uuid)` | 0033 | does one KPI reach another through the inputs of active versions (cycle walk) | via triggers |
| `kpi_formula_input_guard()` | 0033 | inputs only on a draft formula version; no self-reference or cycle (lock 730228) | via trigger |
| `kpi_version_guard()` | 0033 | version number step; unit, currency, frequency and polarity fit the definition; status machine; frozen content; activation preconditions (active definition, business approval, no cycle) | via trigger |
| `kpi_definition_measure_lock()` | 0033 | the DG2 definition's measure fields are fixed once a version exists | via trigger |
| `kpi_rag_threshold_guard()` | 0033 | version number step; immutable except active → superseded | via trigger |
| `p4_kpi_scope_valid(uuid, uuid, text, uuid)` | 0034 | the scope is the transformation, a business unit of its organization or one of its initiatives | via triggers |
| `target_trajectory_guard()`, `target_trajectory_point_guard()` | 0034 | scope, version step, status machine, frozen content, points only while draft, at least one point to approve | via trigger |
| `kpi_actual_guard()` | 0034 | slot identity, period open and of the KPI's frequency, period copy, status machine, value step, accepted pointer (lock 730229) | via trigger |
| `kpi_actual_consistency()` | 0034 | deferred: the current value row exists; accepted/rejected has the matching review row | via constraint trigger |
| `kpi_actual_value_guard()` | 0034 | value number is the slot's current one; the KPI's active version; currency equal; shape per value nature or missing_reason | via trigger |
| `data_quality_finding_guard()`, `rag_override_guard()` | 0035 | status machines, immutable content; one override in force per slot (lock 730229) | via trigger |

## P4 validation rules summary (slice A)

| Layer | What it checks |
|---|---|
| Database | The P2 record guards; closed sets (measure types, value natures, aggregation rules, routes, statuses, RAG values, rule codes); aggregation fits value nature (no averaging rule exists); custom formula needs the business-approval policy; activation completeness (aggregation rule, ratio labels, milestone due date, band bounds); formula cycles; one draft/active version, one approved trajectory, one slot per KPI/scope/period, one override in force, one open finding per rule; value shape and currency; review SoD; Unknown/Not computable stored as NULL and never green |
| API (`@mth/shared/schemas`) | Shapes (OpenAPI slice A schemas), free-text rules (`freeText`/`hasText`), strict UTF-8, request media types, `If-Match`, decimal strings |
| Service | Permissions and record-level rules (owner/steward/assignee submits; configured reviewer accepts; not the submitter), commit-time re-authorization, formula validation on the DG3 engine and the unit match, evidence rule, the exact refusal codes and English texts of ADR-0027 §13 |
| Worker | One run per trigger (`runOnce` + unique trigger key), evaluations per ADR-0028, data-quality findings, `kpi.deviation_evaluated` and `kpi.values_recalculated` outbox events |

# P4 tables, slice B (migrations 0037–0040, DG4)

Written by T-DG4-ARCH-03 (solution-architect), 2026-10-09. Binding design: ADR-0029 (register, lifecycle, enablers, allocations, groups, overlaps, scenarios, valuation methods) and ADR-0030 (values, measurements, Finance validation, corrections, value states, totals). The table sections below are generated from the catalogue of a freshly migrated disposable PostgreSQL 16 by `docs/delivery/handbacks/DG4/T-DG4-ARCH-03-evidence/gen-dictionary.ts`, so they match the migrations exactly. Every money column is numeric(20,4), every KPI/baseline value numeric(24,6), every share numeric(7,6); NULL is Unknown (or n/a for a non-financial Value (SAR)), never 0.

## benefit_lifecycle_step_definition

- **Purpose:** The six B0121 lifecycle steps with their question and output, seeded verbatim in English; Arabic provisional (REQ-PB-074; ADR-0029 §2).
- **Migration:** `0037_p4_benefit_register.sql`. **API module:** `benefits`. **Who writes:** seed only (read-only for the application). **Lifecycle:** reference data.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| code | text | NOT NULL |  | `CHECK ((code = ANY (ARRAY['identify', 'plan', 'enable', 'measure', 'correct', 'sustain'])))`; PK |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 6)))` |
| step_en | text | NOT NULL |  | `CHECK (((char_length(step_en) >= 1) AND (char_length(step_en) <= 50)))` |
| question_en | text | NOT NULL |  | `CHECK (((char_length(question_en) >= 1) AND (char_length(question_en) <= 200)))` |
| output_en | text | NOT NULL |  | `CHECK (((char_length(output_en) >= 1) AND (char_length(output_en) <= 200)))` |
| step_ar | text | NOT NULL |  | `CHECK (((char_length(step_ar) >= 1) AND (char_length(step_ar) <= 50)))` |
| question_ar | text | NOT NULL |  | `CHECK (((char_length(question_ar) >= 1) AND (char_length(question_ar) <= 200)))` |
| output_ar | text | NOT NULL |  | `CHECK (((char_length(output_ar) >= 1) AND (char_length(output_ar) <= 200)))` |
| ar_is_provisional | boolean | NOT NULL | `true` |  |
| source_ref | text | NOT NULL |  | `CHECK ((source_ref = 'B0121'))` |

**Table constraints:**

- `benefit_lifecycle_step_definition_ordinal_key` (UNIQUE): `UNIQUE (ordinal)`

## benefit_valuation_method

- **Purpose:** A method that values a non-financial benefit in SAR (REQ-S08-010; ADR-0029 §8). Only an approved method lets a non-financial benefit carry an amount.
- **Migration:** `0037_p4_benefit_register.sql`. **API module:** `benefits`. **Who writes:** `benefit.edit` proposes (TL, BO); `finance.validate` (FIN) decides, never the proposer. **Lifecycle:** proposed → approved | rejected; approved → retired.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| code | text | NOT NULL |  | `CHECK ((code ~ '^VM-[0-9]{2,6}$'))` |
| name | text | NOT NULL |  | `CHECK (((char_length(name) >= 1) AND (char_length(name) <= 300)))` |
| method | text | NOT NULL |  | `CHECK (((char_length(method) >= 1) AND (char_length(method) <= 8000)))` |
| applies_to_type | text | NOT NULL |  | `CHECK ((applies_to_type = ANY (ARRAY['cx', 'risk', 'strategic', 'other'])))` |
| kpi_definition_id | uuid | NULL |  |  |
| unit_value | numeric(20,4) | NULL |  | `CHECK (((unit_value IS NULL) OR (unit_value >= (0)::numeric)))` |
| currency | character(3) | NOT NULL |  | `CHECK ((currency ~ '^[A-Z]{3}$'))` |
| status | text | NOT NULL | `'proposed'` | `CHECK ((status = ANY (ARRAY['proposed', 'approved', 'rejected', 'retired'])))` |
| decided_by | uuid | NULL |  | FK → app_user(id) |
| decided_at | timestamp with time zone | NULL |  |  |
| decision_note | text | NULL |  | `CHECK (((decision_note IS NULL) OR ((char_length(decision_note) >= 1) AND (char_length(decision_note) <= 2000))))` |
| retired_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `benefit_valuation_method_code_key` (UNIQUE): `UNIQUE (transformation_id, code)`
- `benefit_valuation_method_decider_not_proposer` (CHECK): `CHECK (((decided_by IS NULL) OR (decided_by <> created_by)))`
- `benefit_valuation_method_decision_complete` (CHECK): `CHECK ((((status = ANY (ARRAY['approved', 'rejected', 'retired'])) = (decided_by IS NOT NULL)) AND ((decided_by IS NULL) = (decided_at IS NULL)) AND ((status <> 'rejected') OR (decision_note IS NOT NULL)) AND ((status = 'retired') = (retired_at IS NOT NULL))))`
- `benefit_valuation_method_kpi_fkey` (FK): `FOREIGN KEY (transformation_id, kpi_definition_id) REFERENCES kpi_definition(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_valuation_method_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Triggers:**

- `benefit_valuation_method_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `benefit_valuation_method_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `benefit_valuation_method_guard()`
- `benefit_valuation_method_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## benefit_group

- **Purpose:** A shared-benefit group (REQ-PB-058, M0173): exactly the named counted member is counted; while none is named no member is counted (ADR-0029 §6).
- **Migration:** `0037_p4_benefit_register.sql`. **API module:** `benefits`. **Who writes:** `benefit_group.manage` (TL, BO). **Lifecycle:** active → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| code | text | NOT NULL |  | `CHECK ((code ~ '^BG-[0-9]{2,6}$'))` |
| title | text | NOT NULL |  | `CHECK (((char_length(title) >= 1) AND (char_length(title) <= 300)))` |
| description | text | NULL |  | `CHECK (((description IS NULL) OR ((char_length(description) >= 1) AND (char_length(description) <= 4000))))` |
| counted_benefit_id | uuid | NULL |  |  |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `benefit_group_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `benefit_group_code_key` (UNIQUE): `UNIQUE (transformation_id, code)`
- `benefit_group_counted_fkey` (FK): `FOREIGN KEY (transformation_id, counted_benefit_id) REFERENCES benefit(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_group_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Triggers:**

- `benefit_group_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `benefit_group_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `benefit_group_guard()`
- `benefit_group_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## benefit

- **Purpose:** Benefit (REQ-S16-017): one canonical T14 register row with the REQ-S08-003 profile, one owner, one value class and currency, and the six-step lifecycle whose source outputs are preconditions (REQ-PB-058, REQ-PB-074, REQ-PB-075, REQ-PB-076; ADR-0029 §1-§2).
- **Migration:** `0037_p4_benefit_register.sql`. **API module:** `benefits`. **Who writes:** `benefit.edit` (TL, BO); `benefit.advance` (BO) for the step; `benefit.allocate` (TL, BO) for allocation_set_no; `finance.validate` (FIN) for the baseline validation. **Lifecycle:** identify → plan → enable → measure ⇄ correct; measure → sustain; active → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| code | text | NOT NULL |  | `CHECK ((code ~ '^B[0-9]{2,6}$'))` |
| title | text | NOT NULL |  | `CHECK (((char_length(title) >= 1) AND (char_length(title) <= 300)))` |
| description | text | NOT NULL |  | `CHECK (((char_length(description) >= 1) AND (char_length(description) <= 8000)))` |
| benefit_type | text | NOT NULL |  | `CHECK ((benefit_type = ANY (ARRAY['revenue', 'cost', 'working_capital', 'cx', 'risk', 'strategic', 'other'])))` |
| value_class | text | NOT NULL |  | `CHECK ((value_class = ANY (ARRAY['revenue_uplift', 'margin_uplift', 'cash_saving', 'avoided_cost', 'working_capital_release', 'non_financial'])))` |
| owner_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| finance_validator_user_id | uuid | NULL |  | FK → app_user(id) |
| finance_validation_required | boolean | NOT NULL | `true` |  |
| financial_statement_line | text | NULL |  | `CHECK (((financial_statement_line IS NULL) OR ((char_length(financial_statement_line) >= 1) AND (char_length(financial_statement_line) <= 200))))` |
| measurement_kpi_definition_id | uuid | NULL |  |  |
| measurement_kpi_variable | text | NULL |  | `CHECK (((measurement_kpi_variable IS NULL) OR (measurement_kpi_variable ~ '^[a-z][a-z0-9_]{0,47}$')))` |
| business_case_line_id | uuid | NULL |  | FK → business_case_line(id) |
| benefit_formula_id | uuid | NULL |  |  |
| baseline_id | uuid | NULL |  |  |
| baseline_value | numeric(24,6) | NULL |  |  |
| baseline_unit | text | NULL |  | `CHECK (((baseline_unit IS NULL) OR ((char_length(baseline_unit) >= 1) AND (char_length(baseline_unit) <= 50))))` |
| baseline_date | date | NULL |  |  |
| counterfactual | text | NULL |  | `CHECK (((counterfactual IS NULL) OR ((char_length(counterfactual) >= 1) AND (char_length(counterfactual) <= 4000))))` |
| baseline_validation_status | text | NOT NULL | `'unvalidated'` | `CHECK ((baseline_validation_status = ANY (ARRAY['unvalidated', 'validated', 'rejected'])))` |
| baseline_validated_by | uuid | NULL |  | FK → app_user(id) |
| baseline_validated_at | timestamp with time zone | NULL |  |  |
| baseline_validation_note | text | NULL |  | `CHECK (((baseline_validation_note IS NULL) OR ((char_length(baseline_validation_note) >= 1) AND (char_length(baseline_validation_note) <= 2000))))` |
| driver_key | text | NULL |  | `CHECK (((driver_key IS NULL) OR (driver_key ~ '^[a-z0-9][a-z0-9_.:-]{0,99}$')))` |
| driver_units | text | NULL |  | `CHECK (((driver_units IS NULL) OR ((char_length(driver_units) >= 1) AND (char_length(driver_units) <= 100))))` |
| population_key | text | NULL |  | `CHECK (((population_key IS NULL) OR (population_key ~ '^[a-z0-9][a-z0-9_.:-]{0,99}$')))` |
| target_value | numeric(24,6) | NULL |  |  |
| target_date | date | NULL |  |  |
| realization_start | date | NULL |  |  |
| realization_end | date | NULL |  |  |
| recurrence | text | NULL |  | `CHECK (((recurrence IS NULL) OR (recurrence = ANY (ARRAY['one_off', 'recurring']))))` |
| currency | character(3) | NOT NULL |  | `CHECK ((currency ~ '^[A-Z]{3}$'))` |
| planned_value | numeric(20,4) | NULL |  |  |
| valuation_method_id | uuid | NULL |  |  |
| measurement_source | text | NULL |  | `CHECK (((measurement_source IS NULL) OR ((char_length(measurement_source) >= 1) AND (char_length(measurement_source) <= 500))))` |
| confidence | character(1) | NULL |  | `CHECK (((confidence IS NULL) OR (confidence = ANY (ARRAY['H'::bpchar, 'M'::bpchar, 'L'::bpchar]))))` |
| assumptions | text | NULL |  | `CHECK (((assumptions IS NULL) OR ((char_length(assumptions) >= 1) AND (char_length(assumptions) <= 8000))))` |
| parent_benefit_id | uuid | NULL |  |  |
| benefit_group_id | uuid | NULL |  |  |
| allocation_set_no | smallint | NOT NULL | `0` | `CHECK ((allocation_set_no >= 0))` |
| lifecycle_step | text | NOT NULL | `'identify'` | `CHECK ((lifecycle_step = ANY (ARRAY['identify', 'plan', 'enable', 'measure', 'correct', 'sustain'])))` |
| recovery_plan | text | NULL |  | `CHECK (((recovery_plan IS NULL) OR ((char_length(recovery_plan) >= 1) AND (char_length(recovery_plan) <= 8000))))` |
| bau_owner_user_id | uuid | NULL |  | FK → app_user(id) |
| control_cadence | text | NULL |  | `CHECK (((control_cadence IS NULL) OR (control_cadence = ANY (ARRAY['monthly', 'quarterly', 'semiannual', 'annual']))))` |
| status_rag | text | NULL |  | `CHECK (((status_rag IS NULL) OR (status_rag = ANY (ARRAY['green', 'amber', 'red']))))` |
| status_rag_note | text | NULL |  | `CHECK (((status_rag_note IS NULL) OR ((char_length(status_rag_note) >= 1) AND (char_length(status_rag_note) <= 2000))))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `benefit_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `benefit_baseline_fkey` (FK): `FOREIGN KEY (transformation_id, baseline_id) REFERENCES baseline(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_baseline_validation_complete` (CHECK): `CHECK ((((baseline_validation_status = 'unvalidated') = (baseline_validated_by IS NULL)) AND ((baseline_validated_by IS NULL) = (baseline_validated_at IS NULL)) AND ((baseline_validation_status <> 'rejected') OR (baseline_validation_note IS NOT NULL)) AND ((baseline_validation_status = 'unvalidated') OR (baseline_value IS NOT NULL) OR (baseline_id IS NOT NULL))))`
- `benefit_baseline_validator_not_owner` (CHECK): `CHECK (((baseline_validated_by IS NULL) OR (baseline_validated_by <> owner_user_id)))`
- `benefit_code_key` (UNIQUE): `UNIQUE (transformation_id, code)`
- `benefit_correct_output_present` (CHECK): `CHECK (((lifecycle_step <> 'correct') OR (recovery_plan IS NOT NULL)))`
- `benefit_financial_needs_validation` (CHECK): `CHECK (((value_class = 'non_financial') OR finance_validation_required))`
- `benefit_formula_fkey` (FK): `FOREIGN KEY (transformation_id, benefit_formula_id) REFERENCES benefit_formula(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_group_fkey` (FK): `FOREIGN KEY (transformation_id, benefit_group_id) REFERENCES benefit_group(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_kpi_fkey` (FK): `FOREIGN KEY (transformation_id, measurement_kpi_definition_id) REFERENCES kpi_definition(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_kpi_required` (CHECK): `CHECK (((value_class <> 'non_financial') OR (measurement_kpi_definition_id IS NOT NULL)))`
- `benefit_kpi_variable_bound` (CHECK): `CHECK (((measurement_kpi_variable IS NULL) OR ((measurement_kpi_definition_id IS NOT NULL) AND (benefit_formula_id IS NOT NULL))))`
- `benefit_mapping_required` (CHECK): `CHECK (((value_class = 'non_financial') OR (financial_statement_line IS NOT NULL)))`
- `benefit_non_financial_unmonetised` (CHECK): `CHECK (((value_class <> 'non_financial') OR (planned_value IS NULL) OR (valuation_method_id IS NOT NULL)))`
- `benefit_not_own_parent` (CHECK): `CHECK (((parent_benefit_id IS NULL) OR (parent_benefit_id <> id)))`
- `benefit_parent_fkey` (FK): `FOREIGN KEY (transformation_id, parent_benefit_id) REFERENCES benefit(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_plan_outputs_present` (CHECK): `CHECK (((lifecycle_step = ANY (ARRAY['identify', 'plan'])) OR (((baseline_value IS NOT NULL) OR (baseline_id IS NOT NULL)) AND (target_value IS NOT NULL) AND ((benefit_formula_id IS NOT NULL) OR (value_class = 'non_financial')))))`
- `benefit_realization_range` (CHECK): `CHECK (((realization_end IS NULL) OR (realization_start IS NULL) OR (realization_end >= realization_start)))`
- `benefit_sustain_outputs_present` (CHECK): `CHECK (((lifecycle_step <> 'sustain') OR ((bau_owner_user_id IS NOT NULL) AND (control_cadence IS NOT NULL))))`
- `benefit_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`
- `benefit_type_fits_class` (CHECK): `CHECK ((((benefit_type = 'revenue') AND (value_class = ANY (ARRAY['revenue_uplift', 'margin_uplift']))) OR ((benefit_type = 'cost') AND (value_class = ANY (ARRAY['cash_saving', 'avoided_cost']))) OR ((benefit_type = 'working_capital') AND (value_class = 'working_capital_release')) OR ((benefit_type = 'risk') AND (value_class = ANY (ARRAY['avoided_cost', 'non_financial']))) OR ((benefit_type = ANY (ARRAY['cx', 'strategic', 'other'])) AND (value_class = 'non_financial'))))`
- `benefit_validator_not_owner` (CHECK): `CHECK (((finance_validator_user_id IS NULL) OR (finance_validator_user_id <> owner_user_id)))`
- `benefit_valuation_method_fkey` (FK): `FOREIGN KEY (transformation_id, valuation_method_id) REFERENCES benefit_valuation_method(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_valuation_only_non_financial` (CHECK): `CHECK (((valuation_method_id IS NULL) OR (value_class = 'non_financial')))`

**Indexes:**

- `benefit_driver_idx`: `(transformation_id, driver_key) WHERE ((driver_key IS NOT NULL) AND (status = 'active'))`
- `benefit_group_idx`: `(benefit_group_id) WHERE (benefit_group_id IS NOT NULL)`
- `benefit_one_case_line_key`: `UNIQUE (business_case_line_id) WHERE ((business_case_line_id IS NOT NULL) AND (status = 'active'))`
- `benefit_parent_idx`: `(parent_benefit_id) WHERE (parent_benefit_id IS NOT NULL)`
- `benefit_transformation_updated_idx`: `(transformation_id, updated_at DESC, id DESC)`

**Triggers:**

- `benefit_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `benefit_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `benefit_guard()`
- `benefit_lifecycle_history`: AFTER INSERT OR UPDATE OF lifecycle_step FOR EACH ROW → `benefit_lifecycle_history()`
- `benefit_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`
- `benefit_value_lock_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `benefit_value_lock_guard()`

## benefit_enabler

- **Purpose:** The Enable output: the initiative (and optionally its deliverable or a capability) a benefit depends on; delivered when the deliverable is accepted or the initiative completed; never realized value (REQ-S08-002; ADR-0029 §3).
- **Migration:** `0037_p4_benefit_register.sql`. **API module:** `benefits`. **Who writes:** `benefit.edit` (TL, BO). **Lifecycle:** active → removed (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| benefit_id | uuid | NOT NULL |  |  |
| initiative_id | uuid | NOT NULL |  |  |
| deliverable_id | uuid | NULL |  |  |
| capability_id | uuid | NULL |  |  |
| note | text | NULL |  | `CHECK (((note IS NULL) OR ((char_length(note) >= 1) AND (char_length(note) <= 2000))))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'removed'])))` |
| removed_at | timestamp with time zone | NULL |  |  |
| removed_by | uuid | NULL |  | FK → app_user(id) |
| remove_reason | text | NULL |  | `CHECK (((remove_reason IS NULL) OR ((char_length(remove_reason) >= 3) AND (char_length(remove_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `benefit_enabler_benefit_fkey` (FK): `FOREIGN KEY (transformation_id, benefit_id) REFERENCES benefit(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_enabler_capability_fkey` (FK): `FOREIGN KEY (transformation_id, capability_id) REFERENCES capability(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_enabler_deliverable_fkey` (FK): `FOREIGN KEY (transformation_id, deliverable_id) REFERENCES deliverable(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_enabler_initiative_fkey` (FK): `FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_enabler_removal_complete` (CHECK): `CHECK ((((status = 'removed') = (removed_at IS NOT NULL)) AND ((removed_at IS NULL) = (removed_by IS NULL)) AND ((removed_at IS NULL) = (remove_reason IS NULL))))`

**Indexes:**

- `benefit_enabler_active_key`: `UNIQUE (benefit_id, initiative_id, COALESCE(deliverable_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(capability_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE (status = 'active')`

**Triggers:**

- `benefit_enabler_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `benefit_enabler_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `benefit_enabler_guard()`
- `benefit_enabler_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## benefit_lifecycle_event

- **Purpose:** Append-only history of a benefit's lifecycle steps, written only by the trigger benefit_lifecycle_history (ADR-0029 §2).
- **Migration:** `0037_p4_benefit_register.sql`. **API module:** `benefits`. **Who writes:** trigger on benefit (actor = benefit.updated_by). **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| benefit_id | uuid | NOT NULL |  |  |
| from_step | text | NULL |  | `CHECK (((from_step IS NULL) OR (from_step = ANY (ARRAY['identify', 'plan', 'enable', 'measure', 'correct', 'sustain']))))` |
| to_step | text | NOT NULL |  | `CHECK ((to_step = ANY (ARRAY['identify', 'plan', 'enable', 'measure', 'correct', 'sustain'])))` |
| benefit_version | integer | NOT NULL |  | `CHECK ((benefit_version >= 1))` |
| occurred_at | timestamp with time zone | NOT NULL | `now()` |  |
| actor_user_id | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `benefit_lifecycle_event_benefit_fkey` (FK): `FOREIGN KEY (transformation_id, benefit_id) REFERENCES benefit(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_lifecycle_event_version_key` (UNIQUE): `UNIQUE (benefit_id, benefit_version)`

**Triggers:**

- `benefit_lifecycle_event_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `benefit_lifecycle_event_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `benefit_lifecycle_event_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## benefit_allocation

- **Purpose:** BenefitAllocation (REQ-S16-017): contribution shares of one canonical benefit to initiatives, per allocation set; at most 1 (100 %) in total under lock 730232; the rest is unallocated (REQ-S08-013; ADR-0029 §5). Totals never sum allocations.
- **Migration:** `0037_p4_benefit_register.sql`. **API module:** `benefits`. **Who writes:** `benefit.allocate` (TL, BO), with the benefit's set number step. **Lifecycle:** append-only; the set in force is benefit.allocation_set_no.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| benefit_id | uuid | NOT NULL |  |  |
| set_no | smallint | NOT NULL |  |  |
| initiative_id | uuid | NOT NULL |  |  |
| share | numeric(7,6) | NOT NULL |  | `CHECK (((share > (0)::numeric) AND (share <= (1)::numeric)))` |
| basis | text | NULL |  | `CHECK (((basis IS NULL) OR ((char_length(basis) >= 1) AND (char_length(basis) <= 1000))))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `benefit_allocation_benefit_fkey` (FK): `FOREIGN KEY (transformation_id, benefit_id) REFERENCES benefit(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_allocation_initiative_fkey` (FK): `FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_allocation_initiative_key` (UNIQUE): `UNIQUE (benefit_id, set_no, initiative_id)`
- `benefit_allocation_set_no_check1` (CHECK): `CHECK ((set_no >= 1))`

**Triggers:**

- `benefit_allocation_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `benefit_allocation_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `benefit_allocation_guard`: BEFORE INSERT FOR EACH ROW → `benefit_allocation_guard()`
- `benefit_allocation_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## benefit_scenario

- **Purpose:** Scenario (REQ-S16-017, REQ-S08-018): base, upside or downside of one transformation; one active per kind (ADR-0029 §10).
- **Migration:** `0037_p4_benefit_register.sql`. **API module:** `benefits`. **Who writes:** `benefit_scenario.edit` (TL, FIN). **Lifecycle:** active → archived.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| business_case_id | uuid | NULL |  |  |
| kind | text | NOT NULL |  | `CHECK ((kind = ANY (ARRAY['base', 'upside', 'downside'])))` |
| title | text | NOT NULL |  | `CHECK (((char_length(title) >= 1) AND (char_length(title) <= 300)))` |
| assumptions | text | NULL |  | `CHECK (((assumptions IS NULL) OR ((char_length(assumptions) >= 1) AND (char_length(assumptions) <= 8000))))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `benefit_scenario_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `benefit_scenario_case_fkey` (FK): `FOREIGN KEY (transformation_id, business_case_id) REFERENCES business_case(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_scenario_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `benefit_scenario_one_kind_key`: `UNIQUE (transformation_id, kind) WHERE (status = 'active')`

**Triggers:**

- `benefit_scenario_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `benefit_scenario_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## benefit_scenario_value

- **Purpose:** A scenario value of one benefit and period; never read by an actual, realized or validated total (REQ-S08-018).
- **Migration:** `0037_p4_benefit_register.sql`. **API module:** `benefits`. **Who writes:** `benefit_scenario.edit` (TL, FIN). **Lifecycle:** mutable (versioned).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| scenario_id | uuid | NOT NULL |  |  |
| benefit_id | uuid | NOT NULL |  |  |
| period_start | date | NOT NULL |  |  |
| period_end | date | NOT NULL |  |  |
| amount | numeric(20,4) | NULL |  |  |
| kpi_value | numeric(24,6) | NULL |  |  |
| currency | character(3) | NOT NULL |  | `CHECK ((currency ~ '^[A-Z]{3}$'))` |
| note | text | NULL |  | `CHECK (((note IS NULL) OR ((char_length(note) >= 1) AND (char_length(note) <= 2000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `benefit_scenario_value_benefit_fkey` (FK): `FOREIGN KEY (transformation_id, benefit_id) REFERENCES benefit(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_scenario_value_period_key` (UNIQUE): `UNIQUE (scenario_id, benefit_id, period_start)`
- `benefit_scenario_value_period_range` (CHECK): `CHECK ((period_end >= period_start))`
- `benefit_scenario_value_present` (CHECK): `CHECK ((num_nonnulls(amount, kpi_value) >= 1))`
- `benefit_scenario_value_scenario_fkey` (FK): `FOREIGN KEY (transformation_id, scenario_id) REFERENCES benefit_scenario(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Triggers:**

- `benefit_scenario_value_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `benefit_scenario_value_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `benefit_scenario_value_guard()`
- `benefit_scenario_value_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## benefit_plan_value

- **Purpose:** The planned and forecast value series of a benefit per period (REQ-S08-001; ADR-0030 §1).
- **Migration:** `0038_p4_benefit_measurement_validation.sql`. **API module:** `benefits`. **Who writes:** `benefit.edit` (TL, BO). **Lifecycle:** mutable (versioned).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| benefit_id | uuid | NOT NULL |  |  |
| value_kind | text | NOT NULL |  | `CHECK ((value_kind = ANY (ARRAY['planned', 'forecast'])))` |
| period_start | date | NOT NULL |  |  |
| period_end | date | NOT NULL |  |  |
| amount | numeric(20,4) | NULL |  |  |
| kpi_value | numeric(24,6) | NULL |  |  |
| currency | character(3) | NOT NULL |  | `CHECK ((currency ~ '^[A-Z]{3}$'))` |
| note | text | NULL |  | `CHECK (((note IS NULL) OR ((char_length(note) >= 1) AND (char_length(note) <= 2000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `benefit_plan_value_benefit_fkey` (FK): `FOREIGN KEY (transformation_id, benefit_id) REFERENCES benefit(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_plan_value_period_key` (UNIQUE): `UNIQUE (benefit_id, value_kind, period_start)`
- `benefit_plan_value_period_range` (CHECK): `CHECK ((period_end >= period_start))`
- `benefit_plan_value_present` (CHECK): `CHECK ((num_nonnulls(amount, kpi_value) >= 1))`
- `benefit_plan_value_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Triggers:**

- `benefit_plan_value_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `benefit_plan_value_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `benefit_plan_value_guard()`
- `benefit_plan_value_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## benefit_measurement

- **Purpose:** BenefitMeasurement (REQ-S16-017): one measured value of a benefit for one period with its lineage, or a Finance amendment or reversal linked to the original validated value (REQ-S08-016, REQ-S08-017; ADR-0030 §2, §4). Validated only with the matching Finance decision (deferred check).
- **Migration:** `0038_p4_benefit_measurement_validation.sql`. **API module:** `benefits`. **Who writes:** `benefit.measure` (BO, WL, KDS); the worker (`kpi_recalculation`, submitted_by NULL); `finance.validate` (FIN) decides and records corrections. **Lifecycle:** draft → submitted → validated | rejected | superseded (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| benefit_id | uuid | NOT NULL |  |  |
| measurement_no | integer | NOT NULL |  | `CHECK ((measurement_no >= 1))` |
| kind | text | NOT NULL | `'measurement'` | `CHECK ((kind = ANY (ARRAY['measurement', 'amendment', 'reversal'])))` |
| corrects_measurement_id | uuid | NULL |  |  |
| source | text | NOT NULL |  |  |
| calculation_run_id | uuid | NULL |  |  |
| benefit_calculation_id | uuid | NULL |  | FK → benefit_calculation(id) |
| formula_version_id | uuid | NULL |  |  |
| period_start | date | NULL |  |  |
| period_end | date | NULL |  |  |
| amount | numeric(20,4) | NULL |  |  |
| kpi_value | numeric(24,6) | NULL |  |  |
| currency | character(3) | NOT NULL |  | `CHECK ((currency ~ '^[A-Z]{3}$'))` |
| missing_reason | text | NULL |  | `CHECK (((missing_reason IS NULL) OR ((char_length(missing_reason) >= 3) AND (char_length(missing_reason) <= 1000))))` |
| attribution | text | NULL |  | `CHECK (((attribution IS NULL) OR ((char_length(attribution) >= 1) AND (char_length(attribution) <= 4000))))` |
| assumptions | text | NULL |  | `CHECK (((assumptions IS NULL) OR ((char_length(assumptions) >= 1) AND (char_length(assumptions) <= 8000))))` |
| status | text | NOT NULL |  | `CHECK ((status = ANY (ARRAY['draft', 'submitted', 'validated', 'rejected', 'superseded'])))` |
| sustain_phase | boolean | NOT NULL | `false` |  |
| validated_amount | numeric(20,4) | NULL |  |  |
| submitted_by | uuid | NULL |  | FK → app_user(id) |
| submitted_at | timestamp with time zone | NULL |  |  |
| decided_by | uuid | NULL |  | FK → app_user(id) |
| decided_at | timestamp with time zone | NULL |  |  |
| reason | text | NULL |  | `CHECK (((reason IS NULL) OR ((char_length(reason) >= 3) AND (char_length(reason) <= 2000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `benefit_measurement_benefit_fkey` (FK): `FOREIGN KEY (transformation_id, benefit_id) REFERENCES benefit(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_measurement_correction_shape` (CHECK): `CHECK (((kind = 'measurement') OR ((status = 'validated') AND (reason IS NOT NULL) AND (amount IS NOT NULL) AND (validated_amount = amount))))`
- `benefit_measurement_corrects_fkey` (FK): `FOREIGN KEY (transformation_id, corrects_measurement_id) REFERENCES benefit_measurement(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_measurement_decided_stamps` (CHECK): `CHECK ((((status = ANY (ARRAY['validated', 'rejected'])) = (decided_at IS NOT NULL)) AND ((decided_at IS NULL) = (decided_by IS NULL))))`
- `benefit_measurement_formula_version_fkey` (FK): `FOREIGN KEY (transformation_id, formula_version_id) REFERENCES benefit_formula_version(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_measurement_kind_shape` (CHECK): `CHECK ((((kind = 'measurement') = (corrects_measurement_id IS NULL)) AND ((kind = 'measurement') = (source <> 'correction'))))`
- `benefit_measurement_missing_shape` (CHECK): `CHECK (((missing_reason IS NULL) OR ((amount IS NULL) AND (kpi_value IS NULL) AND (status <> 'validated'))))`
- `benefit_measurement_no_key` (UNIQUE): `UNIQUE (benefit_id, measurement_no)`
- `benefit_measurement_period_range` (CHECK): `CHECK (((period_end IS NULL) OR (period_start IS NULL) OR (period_end >= period_start)))`
- `benefit_measurement_period_required` (CHECK): `CHECK (((status = 'draft') OR ((period_start IS NOT NULL) AND (period_end IS NOT NULL))))`
- `benefit_measurement_run_fkey` (FK): `FOREIGN KEY (transformation_id, calculation_run_id) REFERENCES calculation_run(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_measurement_source_check1` (CHECK): `CHECK ((source = ANY (ARRAY['manual', 'kpi_recalculation', 'correction'])))`
- `benefit_measurement_submitted_stamps` (CHECK): `CHECK ((((status = 'draft') = (submitted_at IS NULL)) AND ((submitted_at IS NULL) OR (submitted_by IS NOT NULL) OR (source = 'kpi_recalculation')) AND ((submitted_at IS NOT NULL) OR (submitted_by IS NULL))))`
- `benefit_measurement_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`
- `benefit_measurement_validated_amount` (CHECK): `CHECK ((((status = 'validated') AND (amount IS NOT NULL)) = (validated_amount IS NOT NULL)))`
- `benefit_measurement_validator_not_submitter` (CHECK): `CHECK (((kind <> 'measurement') OR (decided_by IS NULL) OR (submitted_by IS NULL) OR (decided_by <> submitted_by)))`
- `benefit_measurement_value_present` (CHECK): `CHECK (((kind <> 'measurement') OR (num_nonnulls(amount, kpi_value) >= 1) OR (missing_reason IS NOT NULL)))`

**Indexes:**

- `benefit_measurement_benefit_idx`: `(benefit_id, measurement_no DESC)`
- `benefit_measurement_one_reversal_key`: `UNIQUE (corrects_measurement_id) WHERE (kind = 'reversal')`
- `benefit_measurement_period_key`: `UNIQUE (benefit_id, period_start, period_end) WHERE ((kind = 'measurement') AND (status = ANY (ARRAY['draft', 'submitted', 'validated'])))`
- `benefit_measurement_run_key`: `UNIQUE (benefit_id, calculation_run_id) WHERE (calculation_run_id IS NOT NULL)`

**Triggers:**

- `benefit_measurement_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `benefit_measurement_decision_present`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `benefit_measurement_decision_present()`
- `benefit_measurement_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `benefit_measurement_guard()`
- `benefit_measurement_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## benefit_measurement_input

- **Purpose:** Calculation lineage: each formula variable bound to a KPI actual value version, with the value used; same period as the measurement (REQ-S08-006, REQ-S08-008; ADR-0030 §5).
- **Migration:** `0038_p4_benefit_measurement_validation.sql`. **API module:** `benefits`. **Who writes:** in the measurement's transaction (API or worker). **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| measurement_id | uuid | NOT NULL |  |  |
| variable_name | text | NOT NULL |  | `CHECK ((variable_name ~ '^[a-z][a-z0-9_]{0,47}$'))` |
| kpi_actual_id | uuid | NULL |  |  |
| kpi_value_no | smallint | NULL |  |  |
| value | numeric(24,6) | NOT NULL |  |  |
| period_start | date | NOT NULL |  |  |
| period_end | date | NOT NULL |  |  |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `benefit_measurement_input_actual_fkey` (FK): `FOREIGN KEY (kpi_actual_id, kpi_value_no) REFERENCES kpi_actual_value(kpi_actual_id, value_no) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_measurement_input_actual_pair` (CHECK): `CHECK (((kpi_actual_id IS NULL) = (kpi_value_no IS NULL)))`
- `benefit_measurement_input_measurement_fkey` (FK): `FOREIGN KEY (transformation_id, measurement_id) REFERENCES benefit_measurement(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_measurement_input_name_key` (UNIQUE): `UNIQUE (measurement_id, variable_name)`

**Triggers:**

- `benefit_measurement_input_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `benefit_measurement_input_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `benefit_measurement_input_guard`: BEFORE INSERT FOR EACH ROW → `benefit_measurement_input_guard()`
- `benefit_measurement_input_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## benefit_evidence

- **Purpose:** Evidence linked to a benefit (T14 Evidence) or to one of its draft or submitted measurements (ADR-0030 §3).
- **Migration:** `0038_p4_benefit_measurement_validation.sql`. **API module:** `benefits`. **Who writes:** `benefit.edit` (benefit links), `benefit.measure` (measurement links). **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| benefit_id | uuid | NOT NULL |  |  |
| measurement_id | uuid | NULL |  |  |
| evidence_id | uuid | NOT NULL |  |  |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `benefit_evidence_benefit_fkey` (FK): `FOREIGN KEY (transformation_id, benefit_id) REFERENCES benefit(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_evidence_evidence_fkey` (FK): `FOREIGN KEY (transformation_id, evidence_id) REFERENCES evidence(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_evidence_measurement_fkey` (FK): `FOREIGN KEY (transformation_id, measurement_id) REFERENCES benefit_measurement(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Indexes:**

- `benefit_evidence_link_key`: `UNIQUE (benefit_id, COALESCE(measurement_id, '00000000-0000-0000-0000-000000000000'::uuid), evidence_id)`

**Triggers:**

- `benefit_evidence_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `benefit_evidence_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `benefit_evidence_guard`: BEFORE INSERT FOR EACH ROW → `benefit_evidence_guard()`
- `benefit_evidence_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## finance_validation

- **Purpose:** FinanceValidation (REQ-S16-017): the Finance queue item of one submitted measurement (exactly one, REQ-S12-014) and its decision on the six REQ-S08-015 items, or a Finance amendment or reversal linked to the original (ADR-0030 §3-§4).
- **Migration:** `0038_p4_benefit_measurement_validation.sql`. **API module:** `benefits (worker `benefits.finance_queue`)`. **Who writes:** the worker creates queue items (service actor); `finance.validate` (FIN) decides, never the submitter, and records corrections. **Lifecycle:** queued → approved | rejected | withdrawn (final); corrections are created approved.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| benefit_id | uuid | NOT NULL |  |  |
| benefit_measurement_id | uuid | NOT NULL |  |  |
| kind | text | NOT NULL | `'validation'` | `CHECK ((kind = ANY (ARRAY['validation', 'amendment', 'reversal'])))` |
| corrects_validation_id | uuid | NULL |  |  |
| idempotency_key | text | NOT NULL |  | `CHECK (((char_length(idempotency_key) >= 1) AND (char_length(idempotency_key) <= 200)))` |
| assignee_user_id | uuid | NULL |  | FK → app_user(id) |
| status | text | NOT NULL |  | `CHECK ((status = ANY (ARRAY['queued', 'approved', 'rejected', 'withdrawn'])))` |
| content | jsonb | NOT NULL |  |  |
| measurement_period_start | date | NULL |  |  |
| measurement_period_end | date | NULL |  |  |
| baseline_decision | text | NULL |  | `CHECK (((baseline_decision IS NULL) OR (baseline_decision = ANY (ARRAY['accepted', 'rejected']))))` |
| attribution_decision | text | NULL |  | `CHECK (((attribution_decision IS NULL) OR (attribution_decision = ANY (ARRAY['accepted', 'rejected']))))` |
| calculation_decision | text | NULL |  | `CHECK (((calculation_decision IS NULL) OR (calculation_decision = ANY (ARRAY['accepted', 'rejected']))))` |
| evidence_decision | text | NULL |  | `CHECK (((evidence_decision IS NULL) OR (evidence_decision = ANY (ARRAY['accepted', 'rejected']))))` |
| period_decision | text | NULL |  | `CHECK (((period_decision IS NULL) OR (period_decision = ANY (ARRAY['accepted', 'rejected']))))` |
| assumptions_decision | text | NULL |  | `CHECK (((assumptions_decision IS NULL) OR (assumptions_decision = ANY (ARRAY['accepted', 'rejected']))))` |
| baseline_note | text | NULL |  | `CHECK (((baseline_note IS NULL) OR ((char_length(baseline_note) >= 1) AND (char_length(baseline_note) <= 2000))))` |
| attribution_note | text | NULL |  | `CHECK (((attribution_note IS NULL) OR ((char_length(attribution_note) >= 1) AND (char_length(attribution_note) <= 2000))))` |
| calculation_note | text | NULL |  | `CHECK (((calculation_note IS NULL) OR ((char_length(calculation_note) >= 1) AND (char_length(calculation_note) <= 2000))))` |
| evidence_note | text | NULL |  | `CHECK (((evidence_note IS NULL) OR ((char_length(evidence_note) >= 1) AND (char_length(evidence_note) <= 2000))))` |
| period_note | text | NULL |  | `CHECK (((period_note IS NULL) OR ((char_length(period_note) >= 1) AND (char_length(period_note) <= 2000))))` |
| assumptions_note | text | NULL |  | `CHECK (((assumptions_note IS NULL) OR ((char_length(assumptions_note) >= 1) AND (char_length(assumptions_note) <= 2000))))` |
| approved_amount | numeric(20,4) | NULL |  |  |
| decision_note | text | NULL |  | `CHECK (((decision_note IS NULL) OR ((char_length(decision_note) >= 1) AND (char_length(decision_note) <= 2000))))` |
| decided_by | uuid | NULL |  | FK → app_user(id) |
| decided_at | timestamp with time zone | NULL |  |  |
| reason | text | NULL |  | `CHECK (((reason IS NULL) OR ((char_length(reason) >= 3) AND (char_length(reason) <= 2000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `finance_validation_all_items_accepted` (CHECK): `CHECK (((kind <> 'validation') OR (status <> 'approved') OR ((baseline_decision = 'accepted') AND (attribution_decision = 'accepted') AND (calculation_decision = 'accepted') AND (evidence_decision = 'accepted') AND (period_decision = 'accepted') AND (assumptions_decision = 'accepted'))))`
- `finance_validation_benefit_fkey` (FK): `FOREIGN KEY (transformation_id, benefit_id) REFERENCES benefit(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `finance_validation_content_complete` (CHECK): `CHECK (((jsonb_typeof(content) = 'object') AND (content ?& ARRAY['baseline', 'attribution', 'calculation', 'evidence', 'measurementPeriod', 'assumptions'])))`
- `finance_validation_corrects_fkey` (FK): `FOREIGN KEY (transformation_id, corrects_validation_id) REFERENCES finance_validation(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `finance_validation_decided_stamps` (CHECK): `CHECK ((((status = ANY (ARRAY['approved', 'rejected'])) = (decided_by IS NOT NULL)) AND ((decided_by IS NULL) = (decided_at IS NULL))))`
- `finance_validation_idempotency_key` (UNIQUE): `UNIQUE (idempotency_key)`
- `finance_validation_items_open` (CHECK): `CHECK (((status <> ALL (ARRAY['queued', 'withdrawn'])) OR (num_nonnulls(baseline_decision, attribution_decision, calculation_decision, evidence_decision, period_decision, assumptions_decision, approved_amount) = 0)))`
- `finance_validation_kind_shape` (CHECK): `CHECK ((((kind = 'validation') = (corrects_validation_id IS NULL)) AND ((kind = 'validation') OR ((status = 'approved') AND (reason IS NOT NULL)))))`
- `finance_validation_measurement_fkey` (FK): `FOREIGN KEY (transformation_id, benefit_measurement_id) REFERENCES benefit_measurement(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `finance_validation_period_required` (CHECK): `CHECK (((measurement_period_start IS NOT NULL) AND (measurement_period_end IS NOT NULL) AND (measurement_period_end >= measurement_period_start)))`
- `finance_validation_rejection_reason` (CHECK): `CHECK (((status <> 'rejected') OR ((decision_note IS NOT NULL) AND (num_nonnulls(baseline_decision, attribution_decision, calculation_decision, evidence_decision, period_decision, assumptions_decision) = 6) AND (((((('rejected' = baseline_decision) OR ('rejected' = attribution_decision)) OR ('rejected' = calculation_decision)) OR ('rejected' = evidence_decision)) OR ('rejected' = period_decision)) OR ('rejected' = assumptions_decision)))))`
- `finance_validation_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `finance_validation_one_per_measurement`: `UNIQUE (benefit_measurement_id) WHERE (kind = 'validation')`
- `finance_validation_queue_idx`: `(transformation_id, created_at) WHERE (status = 'queued')`

**Triggers:**

- `finance_validation_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `finance_validation_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `finance_validation_guard()`
- `finance_validation_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## benefit_overlap

- **Purpose:** An overlap warning between two benefits (same driver, population or period); both are excluded from validated totals until Finance resolves it (REQ-S08-014; ADR-0029 §7).
- **Migration:** `0038_p4_benefit_measurement_validation.sql`. **API module:** `benefits`. **Who writes:** the overlap rule (lock 730234) or `benefit.edit` raises; `finance.validate` (FIN) resolves, not the owner of either benefit. **Lifecycle:** open → resolved (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| benefit_a_id | uuid | NOT NULL |  |  |
| benefit_b_id | uuid | NOT NULL |  |  |
| dimensions | text[] | NOT NULL |  | `CHECK (((cardinality(dimensions) >= 1) AND (dimensions <@ ARRAY['driver', 'population', 'period'])))` |
| driver_key | text | NULL |  | `CHECK (((driver_key IS NULL) OR (driver_key ~ '^[a-z0-9][a-z0-9_.:-]{0,99}$')))` |
| population_key | text | NULL |  | `CHECK (((population_key IS NULL) OR (population_key ~ '^[a-z0-9][a-z0-9_.:-]{0,99}$')))` |
| overlap_start | date | NULL |  |  |
| overlap_end | date | NULL |  |  |
| detected_by | text | NOT NULL |  | `CHECK ((detected_by = ANY (ARRAY['rule', 'user'])))` |
| status | text | NOT NULL | `'open'` | `CHECK ((status = ANY (ARRAY['open', 'resolved'])))` |
| resolution | text | NULL |  | `CHECK (((resolution IS NULL) OR (resolution = ANY (ARRAY['no_economic_overlap', 'duplicate']))))` |
| excluded_benefit_id | uuid | NULL |  |  |
| resolution_note | text | NULL |  | `CHECK (((resolution_note IS NULL) OR ((char_length(resolution_note) >= 3) AND (char_length(resolution_note) <= 4000))))` |
| resolved_by | uuid | NULL |  | FK → app_user(id) |
| resolved_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `benefit_overlap_a_fkey` (FK): `FOREIGN KEY (transformation_id, benefit_a_id) REFERENCES benefit(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_overlap_b_fkey` (FK): `FOREIGN KEY (transformation_id, benefit_b_id) REFERENCES benefit(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `benefit_overlap_pair_order` (CHECK): `CHECK ((benefit_a_id < benefit_b_id))`
- `benefit_overlap_period_range` (CHECK): `CHECK (((overlap_end IS NULL) OR (overlap_start IS NULL) OR (overlap_end >= overlap_start)))`
- `benefit_overlap_resolution_complete` (CHECK): `CHECK ((((status = 'resolved') = (resolution IS NOT NULL)) AND ((resolution IS NULL) = (resolved_by IS NULL)) AND ((resolved_by IS NULL) = (resolved_at IS NULL)) AND ((resolution IS NULL) = (resolution_note IS NULL)) AND ((resolution = 'duplicate') = (excluded_benefit_id IS NOT NULL)) AND ((excluded_benefit_id IS NULL) OR ((excluded_benefit_id = benefit_a_id) OR (excluded_benefit_id = benefit_b_id)))))`
- `benefit_overlap_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `benefit_overlap_one_open_key`: `UNIQUE (benefit_a_id, benefit_b_id) WHERE (status = 'open')`
- `benefit_overlap_transformation_idx`: `(transformation_id, status, created_at DESC)`

**Triggers:**

- `benefit_overlap_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `benefit_overlap_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `benefit_overlap_guard()`
- `benefit_overlap_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## benefit_counting

- **Purpose:** View: whether each benefit's values may enter a total (counted), why not (exclusion_reason) and whether an overlap warning is open (ADR-0029 §6, ADR-0030 §7).
- **Migration:** `0039_p4_benefit_value_views.sql`. **API module:** `benefits (read model)`. **Who writes:** none (view). **Lifecycle:** view.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| benefit_id | uuid | NULL |  |  |
| organization_id | uuid | NULL |  |  |
| transformation_id | uuid | NULL |  |  |
| value_class | text | NULL |  |  |
| currency | character(3) | NULL |  |  |
| counted | boolean | NULL |  |  |
| exclusion_reason | text | NULL |  |  |
| overlap_open | boolean | NULL |  |  |

## benefit_value_line

- **Purpose:** View: every stored benefit value tagged with exactly one state: planned, forecast, measured, submitted, validated, sustained or rejected (REQ-S08-001; ADR-0030 §6). Scenario values are not included.
- **Migration:** `0039_p4_benefit_value_views.sql`. **API module:** `benefits (read model)`. **Who writes:** none (view). **Lifecycle:** view.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| benefit_id | uuid | NULL |  |  |
| transformation_id | uuid | NULL |  |  |
| value_state | text | NULL |  |  |
| period_start | date | NULL |  |  |
| period_end | date | NULL |  |  |
| amount | numeric(20,4) | NULL |  |  |
| kpi_value | numeric(24,6) | NULL |  |  |
| currency | character(3) | NULL |  |  |
| record_table | text | NULL |  |  |
| record_id | uuid | NULL |  |  |

## P4 seeds (0037, 0040, slice B)

- `benefit_lifecycle_step_definition`: the six B0121 rows (identify, plan, enable, measure, correct, sustain) with step, question and output **verbatim** in English; Arabic provisional (`ar_is_provisional = true`, linguistic review needed).
- `record_code_counter` prefixes widened with `B` (T14 IDs B01…), `BG` (groups) and `VM` (valuation methods); existing prefixes and counters unchanged.
- `work_item_kind` `finance_validation_review` (M0234) and `benefit_overlap_review` (M0173), owner module `benefits` (label_ar provisional wording).
- `permission` (6 rows, each `write`) and `role_permission` (12 rows): exactly `P4_BENEFIT_PERMISSIONS` / `P4_BENEFIT_ROLE_PERMISSIONS` in `packages/shared/src/permissions.ts` (`packages/db/src/seed.test.ts`). Finance decisions reuse `finance.validate` (FIN only). AUD and the technical-admin roles hold none.

## P4 functions (slice B)

| Function | Migration | Purpose | Callable by `mth_app` |
|---|---|---|---|
| `benefit_valuation_method_guard()` | 0037 | starts proposed; content fixed; proposed → approved/rejected, approved → retired | via trigger |
| `benefit_guard()` | 0037 | starts at identify; lifecycle step machine; enablers before Measure; allocation set step; validated baseline frozen unless reset; archived read-only; parent/child one level and same currency; approved valuation method; business-case line valid; counted group member stays | via trigger |
| `benefit_lifecycle_history()` | 0037 | inserts one `benefit_lifecycle_event` per insert and step change | via trigger |
| `benefit_group_guard()` | 0037 | the counted benefit is a member | via trigger |
| `benefit_enabler_guard()` | 0037 | deliverable belongs to the initiative; only the note changes; removed is final | via trigger |
| `benefit_allocation_guard()` | 0037 | rows only for the current set; the set totals at most 1 (lock 730232) | via trigger |
| `p4_benefit_value_row_valid(uuid, char, numeric, text)` | 0037 | value tables: currency = the benefit's; non-financial amount needs an approved method; no values on a parent; benefit active | via triggers |
| `benefit_scenario_value_guard()`, `benefit_plan_value_guard()` | 0037, 0038 | fixed scenario/benefit/kind; `p4_benefit_value_row_valid` | via trigger |
| `benefit_measurement_guard()` | 0038 | number step; Measure step or later; status machine; submitted frozen; validated immutable; corrections target a validated value, keep its period, a reversal nets it to zero, at most one reversal; basis validated before validation; sustain phase | via trigger |
| `benefit_measurement_decision_present()` | 0038 | deferred: validated/rejected has the matching Finance decision; a correction has its Finance record; superseded has no queued item | via constraint trigger |
| `benefit_measurement_input_guard()` | 0038 | inputs only with a draft/submitted measurement; same period as the measurement and the KPI actual | via trigger |
| `benefit_evidence_guard()` | 0038 | a measurement link only while draft or submitted | via trigger |
| `finance_validation_guard()` | 0038 | subject and period match the measurement; queued → approved/rejected/withdrawn; snapshot frozen; decider not the submitter; approved amount shape | via trigger |
| `benefit_overlap_guard()` | 0038 | starts open; resolved once; resolver not an owner | via trigger |
| `benefit_value_lock_guard()` | 0038 | type, class and currency fixed once values exist; a benefit with values cannot become a parent | via trigger |

## P4 validation rules summary (slice B)

| Layer | What it checks |
|---|---|
| Database | The P2 record guards (version step, identity, deferred audit coverage, append-only history and lineage); closed sets (types, classes, steps, cadences, statuses, kinds, decisions, dimensions); type ↔ class; statement line or agreed KPI; non-financial unmonetised without an approved method; step outputs as preconditions; one owner column; allocations ≤ 100 % (lock 730232); one counted group member; one live measurement per benefit and period; one queue item per measurement and idempotency key; one pending value per benefit and KPI run; six items accepted to approve; measurement period required; validated values immutable; reversals net to zero; basis validated before validation; SoD (validator ≠ owner, decider ≠ submitter, resolver ≠ owner, method decider ≠ proposer) |
| API (`@mth/shared/schemas`) | Shapes (OpenAPI slice B schemas, incl. a single `ownerUserId`), free-text rules (`freeText`/`hasText`), strict UTF-8, request media types, `If-Match`, decimal strings, the Finance content snapshot (six keys) |
| Service | Permissions and record-level rules (ADR-0029 §9, ADR-0030 §9), commit-time re-authorization, the overlap rule (lock 730234), the formula engine (unchanged), evidence on manual submission, the exact refusal codes and English texts of ADR-0029 §11 and ADR-0030 §11 |
| Worker | `benefits.finance_queue` (exactly one queue item per submission, replay-safe), `benefits.recalculate_pending` (one pending value per benefit and KPI run; supersedes the older pending value), `benefit.variance_evaluated` events |

# P4 tables, slice E (migrations 0041–0043, DG4)

Written by T-DG4-ARCH-04 (solution-architect), 2026-10-09. Binding design: ADR-0031 (RAID on canonical records, actions, corrective-action cases, budget/actual/forecast with the working-day slip, critical path). The table sections below are generated from the catalogue of a freshly migrated disposable PostgreSQL 16 by `docs/delivery/handbacks/DG4/T-DG4-ARCH-04-evidence/gen-dictionary.ts`, so they match the migrations exactly. Every money column is numeric(20,4) with a per-row char(3) currency; NULL is Unknown, never 0. Durations are integer working days.

## Changes to existing tables (0041)

- **`dependency`** (DG2 `0017`, canonical, shared by T08 and RAID): new column `impact text NULL` with `dependency_impact_check` = `impact IS NULL OR impact IN ('high', 'medium', 'low')` (the T15 Impact of the RAID Dependency entry; NULL = Unknown). No probability column: Probability is n/a by construction (REQ-PB-080). Existing rows unchanged.
- **`action_item`** (DG2 `0017`): new columns `raid_entry_id uuid NULL` (FK `action_item_raid_entry_id_fkey` (transformation_id, raid_entry_id) → raid_entry), `dependency_id uuid NULL` (FK `action_item_dependency_id_fkey` → dependency), `corrective_case_id uuid NULL` (FK `action_item_corrective_case_id_fkey` → corrective_case), `follow_up_date date NULL`; CHECK `action_item_one_source` = `num_nonnulls(source_workshop_item_id, raid_entry_id, dependency_id, corrective_case_id) <= 1`; trigger `action_item_source_immutable` (BEFORE UPDATE OF the three links) keeps the source link fixed; partial indexes `action_item_raid_entry_idx`, `action_item_dependency_idx`, `action_item_corrective_case_idx`. `created_by` stays NOT NULL (actions are person-authored). Existing rows unchanged.
- **`record_code_counter`**: `record_code_counter_prefix_check` widened with `R`, `A`, `I` (T15 IDs R-01, A-01, I-01) and `CA` (corrective cases); existing prefixes and counters unchanged.

## raid_entry

- **Purpose:** Risk, Assumption and Issue (REQ-S16-018): T15 rows with the nine B0128 columns; Probability only for a Risk (REQ-PB-079, REQ-PB-080; ADR-0031 §1). Dependency entries are the canonical dependency rows, not stored here.
- **Migration:** `0041_p4_raid_actions_corrective.sql`. **API module:** `raid`. **Who writes:** `raid.edit` (TL, WL, TO). **Lifecycle:** open ⇄ in_progress; open | in_progress → closed (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| entry_type | text | NOT NULL |  | `CHECK ((entry_type = ANY (ARRAY['risk', 'assumption', 'issue'])))` |
| code | text | NOT NULL |  |  |
| description | text | NOT NULL |  | `CHECK (((char_length(description) >= 1) AND (char_length(description) <= 4000)))` |
| impact | text | NOT NULL |  | `CHECK ((impact = ANY (ARRAY['high', 'medium', 'low'])))` |
| probability | text | NULL |  | `CHECK (((probability IS NULL) OR (probability = ANY (ARRAY['high', 'medium', 'low']))))` |
| owner_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| due_date | date | NULL |  |  |
| mitigation | text | NULL |  | `CHECK (((mitigation IS NULL) OR ((char_length(mitigation) >= 1) AND (char_length(mitigation) <= 4000))))` |
| initiative_id | uuid | NULL |  |  |
| status | text | NOT NULL | `'open'` | `CHECK ((status = ANY (ARRAY['open', 'in_progress', 'closed'])))` |
| closed_at | timestamp with time zone | NULL |  |  |
| closed_by | uuid | NULL |  | FK → app_user(id) |
| closure_note | text | NULL |  | `CHECK (((closure_note IS NULL) OR ((char_length(closure_note) >= 3) AND (char_length(closure_note) <= 2000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `raid_entry_closed_complete` (CHECK): `CHECK ((((status = 'closed') = (closed_at IS NOT NULL)) AND ((closed_at IS NULL) = (closed_by IS NULL)) AND ((closed_at IS NULL) = (closure_note IS NULL))))`
- `raid_entry_code_format` (CHECK): `CHECK ((((entry_type = 'risk') AND (code ~ '^R-[0-9]{2,6}$')) OR ((entry_type = 'assumption') AND (code ~ '^A-[0-9]{2,6}$')) OR ((entry_type = 'issue') AND (code ~ '^I-[0-9]{2,6}$'))))`
- `raid_entry_code_key` (UNIQUE): `UNIQUE (transformation_id, code)`
- `raid_entry_initiative_id_fkey` (FK): `FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `raid_entry_probability_applicable` (CHECK): `CHECK (((entry_type = 'risk') = (probability IS NOT NULL)))`
- `raid_entry_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `raid_entry_open_owner_idx`: `(owner_user_id) WHERE (status <> 'closed')`
- `raid_entry_transformation_updated_idx`: `(transformation_id, updated_at DESC, id DESC)`
- `raid_entry_type_status_idx`: `(transformation_id, entry_type, status)`

**Triggers:**

- `raid_entry_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `raid_entry_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `raid_entry_guard()`
- `raid_entry_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## raid_register

- **Purpose:** View: the T15 register as one read model over raid_entry and the non-archived canonical dependency rows, with no copy (REQ-PB-078 A01; ADR-0031 §2). Dependency probability is always NULL (n/a).
- **Migration:** `0041_p4_raid_actions_corrective.sql`. **API module:** `raid`. **Who writes:** none (view). **Lifecycle:** derived.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NULL |  |  |
| organization_id | uuid | NULL |  |  |
| transformation_id | uuid | NULL |  |  |
| entry_type | text | NULL |  |  |
| code | text | NULL |  |  |
| description | text | NULL |  |  |
| impact | text | NULL |  |  |
| probability | text | NULL |  |  |
| owner_user_id | uuid | NULL |  |  |
| due_date | date | NULL |  |  |
| mitigation | text | NULL |  |  |
| raid_status | text | NULL |  |  |
| record_status | text | NULL |  |  |
| record_table | text | NULL |  |  |
| initiative_id | uuid | NULL |  |  |
| version | integer | NULL |  |  |
| created_at | timestamp with time zone | NULL |  |  |
| updated_at | timestamp with time zone | NULL |  |  |

## corrective_action_rule

- **Purpose:** The configured severity and persistence rule per transformation and source kind (M0227; ADR-0031 §5.2). Without a row the code defaults apply.
- **Migration:** `0041_p4_raid_actions_corrective.sql`. **API module:** `raid`. **Who writes:** `corrective_rule.configure` (TL, TO). **Lifecycle:** mutable, versioned; source kind immutable.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| source_kind | text | NOT NULL |  | `CHECK ((source_kind = ANY (ARRAY['kpi_deviation', 'benefit_variance', 'adoption_check', 'control_check'])))` |
| min_kpi_rag | text | NULL |  | `CHECK (((min_kpi_rag IS NULL) OR (min_kpi_rag = ANY (ARRAY['amber', 'red']))))` |
| persistence_cycles | smallint | NOT NULL |  | `CHECK (((persistence_cycles >= 1) AND (persistence_cycles <= 12)))` |
| follow_up_working_days | smallint | NOT NULL |  | `CHECK (((follow_up_working_days >= 1) AND (follow_up_working_days <= 60)))` |
| enabled | boolean | NOT NULL | `true` |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `corrective_action_rule_persistence_series_only` (CHECK): `CHECK (((source_kind = ANY (ARRAY['kpi_deviation', 'benefit_variance'])) OR (persistence_cycles = 1)))`
- `corrective_action_rule_severity_kpi_only` (CHECK): `CHECK (((source_kind = 'kpi_deviation') = (min_kpi_rag IS NOT NULL)))`
- `corrective_action_rule_source_key` (UNIQUE): `UNIQUE (transformation_id, source_kind)`

**Triggers:**

- `corrective_action_rule_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `corrective_action_rule_guard`: BEFORE UPDATE FOR EACH ROW → `corrective_action_rule_guard()`
- `corrective_action_rule_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## corrective_case

- **Purpose:** A recovery plan / corrective-action case (REQ-PB-085, REQ-S12-016; ADR-0031 §5): at most one case that is not closed per source; one case ever per failed check; worker cases have no human author (service audit actor).
- **Migration:** `0041_p4_raid_actions_corrective.sql`. **API module:** `raid`. **Who writes:** the worker consumers (kpi_deviation, benefit_variance, adoption_check, control_check); `corrective_action.manage` (TL, BO, FIN) for value_review cases and person updates. **Lifecycle:** open ⇄ in_progress; open | in_progress → closed (final; needs an owner).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| code | text | NOT NULL |  | `CHECK ((code ~ '^CA-[0-9]{2,6}$'))` |
| source_kind | text | NOT NULL |  | `CHECK ((source_kind = ANY (ARRAY['kpi_deviation', 'benefit_variance', 'adoption_check', 'control_check', 'value_review'])))` |
| source_scope_key | text | NOT NULL |  | `CHECK (((char_length(source_scope_key) >= 1) AND (char_length(source_scope_key) <= 200)))` |
| kpi_definition_id | uuid | NULL |  |  |
| kpi_scope_kind | text | NULL |  | `CHECK (((kpi_scope_kind IS NULL) OR (kpi_scope_kind = ANY (ARRAY['transformation', 'business_unit', 'initiative']))))` |
| kpi_scope_id | uuid | NULL |  |  |
| benefit_id | uuid | NULL |  |  |
| source_record_type | text | NULL |  | `CHECK (((source_record_type IS NULL) OR (source_record_type ~ '^[a-z][a-z0-9_]{1,62}$')))` |
| source_record_id | uuid | NULL |  |  |
| title | text | NOT NULL |  | `CHECK (((char_length(title) >= 1) AND (char_length(title) <= 500)))` |
| recovery_plan | text | NULL |  | `CHECK (((recovery_plan IS NULL) OR ((char_length(recovery_plan) >= 1) AND (char_length(recovery_plan) <= 8000))))` |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| follow_up_date | date | NULL |  |  |
| follow_up_calendar_id | uuid | NULL |  |  |
| follow_up_calendar_version | integer | NULL |  | `CHECK (((follow_up_calendar_version IS NULL) OR (follow_up_calendar_version >= 1)))` |
| status | text | NOT NULL | `'open'` | `CHECK ((status = ANY (ARRAY['open', 'in_progress', 'closed'])))` |
| consecutive_off_track | smallint | NULL |  | `CHECK (((consecutive_off_track IS NULL) OR (consecutive_off_track >= 0)))` |
| signal_count | integer | NOT NULL | `0` | `CHECK ((signal_count >= 0))` |
| last_signal_at | timestamp with time zone | NULL |  |  |
| closed_at | timestamp with time zone | NULL |  |  |
| closed_by | uuid | NULL |  | FK → app_user(id) |
| closure_note | text | NULL |  | `CHECK (((closure_note IS NULL) OR ((char_length(closure_note) >= 3) AND (char_length(closure_note) <= 2000))))` |
| created_source | text | NOT NULL |  | `CHECK ((created_source = ANY (ARRAY['api', 'worker'])))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `corrective_case_benefit_fkey` (FK): `FOREIGN KEY (transformation_id, benefit_id) REFERENCES benefit(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `corrective_case_calendar_fkey` (FK): `FOREIGN KEY (organization_id, follow_up_calendar_id) REFERENCES business_calendar(organization_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `corrective_case_closed_complete` (CHECK): `CHECK ((((status = 'closed') = (closed_at IS NOT NULL)) AND ((closed_at IS NULL) = (closed_by IS NULL)) AND ((closed_at IS NULL) = (closure_note IS NULL))))`
- `corrective_case_code_key` (UNIQUE): `UNIQUE (transformation_id, code)`
- `corrective_case_created_source` (CHECK): `CHECK ((((created_source = 'api') = (source_kind = 'value_review')) AND ((created_source = 'worker') OR ((created_by IS NOT NULL) AND (updated_by IS NOT NULL) AND (owner_user_id IS NOT NULL) AND (follow_up_date IS NOT NULL))) AND ((created_source = 'api') OR (created_by IS NULL))))`
- `corrective_case_follow_up_calendar` (CHECK): `CHECK (((follow_up_calendar_id IS NULL) = (follow_up_calendar_version IS NULL)))`
- `corrective_case_kpi_fkey` (FK): `FOREIGN KEY (transformation_id, kpi_definition_id) REFERENCES kpi_definition(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `corrective_case_source_fields` (CHECK): `CHECK ((((source_kind = 'kpi_deviation') = (kpi_definition_id IS NOT NULL)) AND ((kpi_definition_id IS NULL) = (kpi_scope_kind IS NULL)) AND ((kpi_definition_id IS NULL) = (kpi_scope_id IS NULL)) AND ((source_kind = 'benefit_variance') = (benefit_id IS NOT NULL)) AND ((source_kind = ANY (ARRAY['adoption_check', 'control_check'])) = (source_record_id IS NOT NULL)) AND ((source_record_id IS NULL) = (source_record_type IS NULL))))`
- `corrective_case_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `corrective_case_one_open_key`: `UNIQUE (transformation_id, source_kind, source_scope_key) WHERE (status <> 'closed')`
- `corrective_case_one_per_check_key`: `UNIQUE (transformation_id, source_kind, source_scope_key) WHERE (source_kind = ANY (ARRAY['adoption_check', 'control_check']))`
- `corrective_case_open_owner_idx`: `(owner_user_id) WHERE (status <> 'closed')`
- `corrective_case_transformation_updated_idx`: `(transformation_id, updated_at DESC, id DESC)`

**Triggers:**

- `corrective_case_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `corrective_case_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `corrective_case_guard()`
- `corrective_case_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## corrective_signal

- **Purpose:** Append-only log of every consumed source event, with its period, off-track flag (NULL = Unknown), consecutive count and outcome (ADR-0031 §5.3). System lineage: no audit event of its own.
- **Migration:** `0041_p4_raid_actions_corrective.sql`. **API module:** `raid`. **Who writes:** the worker consumers. **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| source_kind | text | NOT NULL |  | `CHECK ((source_kind = ANY (ARRAY['kpi_deviation', 'benefit_variance', 'adoption_check', 'control_check'])))` |
| source_scope_key | text | NOT NULL |  | `CHECK (((char_length(source_scope_key) >= 1) AND (char_length(source_scope_key) <= 200)))` |
| source_event_key | text | NOT NULL |  | `CHECK (((char_length(source_event_key) >= 1) AND (char_length(source_event_key) <= 200)))` |
| period_key | text | NOT NULL |  | `CHECK (((char_length(period_key) >= 1) AND (char_length(period_key) <= 100)))` |
| period_start | date | NULL |  |  |
| period_end | date | NULL |  |  |
| observed_rag | text | NULL |  | `CHECK (((observed_rag IS NULL) OR (observed_rag = ANY (ARRAY['green', 'amber', 'red', 'unknown', 'stale', 'not_computable']))))` |
| off_track | boolean | NULL |  |  |
| rule_persistence | smallint | NULL |  | `CHECK (((rule_persistence IS NULL) OR ((rule_persistence >= 1) AND (rule_persistence <= 12))))` |
| consecutive_off_track | smallint | NULL |  | `CHECK (((consecutive_off_track IS NULL) OR (consecutive_off_track >= 0)))` |
| outcome | text | NOT NULL |  | `CHECK ((outcome = ANY (ARRAY['recorded', 'case_created', 'case_updated', 'rule_disabled'])))` |
| corrective_case_id | uuid | NULL |  |  |
| payload | jsonb | NOT NULL |  | `CHECK ((jsonb_typeof(payload) = 'object'))` |
| received_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `corrective_signal_case_fkey` (FK): `FOREIGN KEY (transformation_id, corrective_case_id) REFERENCES corrective_case(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `corrective_signal_event_key` (UNIQUE): `UNIQUE (source_event_key)`
- `corrective_signal_outcome_case` (CHECK): `CHECK (((outcome = ANY (ARRAY['case_created', 'case_updated'])) = (corrective_case_id IS NOT NULL)))`
- `corrective_signal_period_range` (CHECK): `CHECK (((period_end IS NULL) OR (period_start IS NULL) OR (period_end >= period_start)))`
- `corrective_signal_rag_kpi_only` (CHECK): `CHECK (((source_kind = 'kpi_deviation') OR (observed_rag IS NULL)))`

**Indexes:**

- `corrective_signal_case_idx`: `(corrective_case_id) WHERE (corrective_case_id IS NOT NULL)`
- `corrective_signal_scope_idx`: `(transformation_id, source_kind, source_scope_key, period_start DESC, received_at DESC)`

**Triggers:**

- `corrective_signal_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `corrective_signal_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `corrective_signal_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## budget_line

- **Purpose:** One budget line of an initiative: budget, actual and forecast as numeric(20,4) in the line's own currency, NULL = Unknown (REQ-S09-007; ADR-0031 §7).
- **Migration:** `0042_p4_budget_schedule.sql`. **API module:** `portfolio`. **Who writes:** `budget.edit` (TL, FIN). **Lifecycle:** active → archived (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| initiative_id | uuid | NOT NULL |  |  |
| label | text | NOT NULL |  | `CHECK (((char_length(label) >= 1) AND (char_length(label) <= 200)))` |
| period_month | date | NULL |  | `CHECK (((period_month IS NULL) OR (EXTRACT(day FROM period_month) = (1)::numeric)))` |
| currency | character(3) | NOT NULL |  | `CHECK ((currency ~ '^[A-Z]{3}$'))` |
| budget_amount | numeric(20,4) | NULL |  | `CHECK (((budget_amount IS NULL) OR (budget_amount >= (0)::numeric)))` |
| actual_amount | numeric(20,4) | NULL |  | `CHECK (((actual_amount IS NULL) OR (actual_amount >= (0)::numeric)))` |
| forecast_amount | numeric(20,4) | NULL |  | `CHECK (((forecast_amount IS NULL) OR (forecast_amount >= (0)::numeric)))` |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| note | text | NULL |  | `CHECK (((note IS NULL) OR ((char_length(note) >= 1) AND (char_length(note) <= 2000))))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `budget_line_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `budget_line_initiative_id_fkey` (FK): `FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `budget_line_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `budget_line_active_key`: `UNIQUE (initiative_id, lower(label), COALESCE(period_month, '0001-01-01'::date)) WHERE (status = 'active')`
- `budget_line_initiative_idx`: `(initiative_id, period_month NULLS FIRST, id) WHERE (status = 'active')`

**Triggers:**

- `budget_line_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `budget_line_guard`: BEFORE UPDATE FOR EACH ROW → `budget_line_guard()`
- `budget_line_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## initiative_schedule

- **Purpose:** The planned duration of an initiative in working days, the input of the critical path (REQ-S09-009; ADR-0031 §8). NULL = missing input: no critical path is claimed.
- **Migration:** `0042_p4_budget_schedule.sql`. **API module:** `portfolio`. **Who writes:** `roadmap.edit` (TL, WL, TO). **Lifecycle:** mutable, versioned; one row per initiative.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| initiative_id | uuid | NOT NULL |  |  |
| duration_working_days | integer | NULL |  | `CHECK (((duration_working_days IS NULL) OR ((duration_working_days >= 0) AND (duration_working_days <= 2600))))` |
| note | text | NULL |  | `CHECK (((note IS NULL) OR ((char_length(note) >= 1) AND (char_length(note) <= 2000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `initiative_schedule_initiative_id_fkey` (FK): `FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `initiative_schedule_initiative_key` (UNIQUE): `UNIQUE (initiative_id)`
- `initiative_schedule_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Triggers:**

- `initiative_schedule_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `initiative_schedule_guard`: BEFORE UPDATE FOR EACH ROW → `initiative_schedule_guard()`
- `initiative_schedule_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## P4 seeds (0041, 0043, slice E)

- `work_item_kind` `corrective_case_follow_up` (M0236) and `raid_action_due` (M0143), owner module `raid` (label_ar provisional wording).
- `permission` (4 rows: `raid.edit` write, `corrective_action.manage` write, `corrective_rule.configure` configure, `budget.edit` write) and `role_permission` (10 rows): exactly `P4_RAID_PERMISSIONS` / `P4_RAID_ROLE_PERMISSIONS` in `packages/shared/src/permissions.ts` (`packages/db/src/seed.test.ts`). AUD and the technical-admin roles hold none; none is an approval category.
- No RAID entry, case, rule, budget line or duration is seeded.

## P4 functions (slice E)

| Function | Migration | Purpose | Callable by `mth_app` |
|---|---|---|---|
| `raid_entry_guard()` | 0041 | starts open; type and code immutable; open ⇄ in_progress, → closed; closed is final | via trigger |
| `corrective_action_rule_guard()` | 0041 | source kind immutable | via trigger |
| `corrective_case_guard()` | 0041 | starts open; code, source and creation source immutable; open ⇄ in_progress, → closed; closed is final; no closing without an owner | via trigger |
| `action_item_source_immutable()` | 0041 | the RAID/dependency/case link of an action never changes | via trigger |
| `budget_line_guard()` | 0042 | currency and initiative immutable; archived is frozen | via trigger |
| `initiative_schedule_guard()` | 0042 | the initiative is immutable | via trigger |

## P4 validation rules summary (slice E)

| Layer | What it checks |
|---|---|
| Database | The P2 record guards (version step, identity, organization = transformation's, deferred audit coverage; append-only signal log); closed sets (RAID types, H/M/L, statuses, source kinds, outcomes, RAG values); Probability only for a Risk; RAID code prefix per type; one case not closed per source (`corrective_case_one_open_key`) and one case per failed check (`corrective_case_one_per_check_key`); source fields per kind; worker vs person authorship; closure note and owner on close; one signal per source event; one active budget line per initiative, label and month; non-negative decimal amounts; first-of-month periods; one duration row per initiative, 0–2600 working days |
| API (`@mth/shared/schemas`) | Shapes (OpenAPI slice E schemas; `type` outside the four T15 values is 400 `raid.type_invalid`), free-text rules, strict UTF-8, request media types, `If-Match`, decimal strings with at most 16 + 4 digits |
| Service | Permissions (ADR-0031 §9; a Dependency entry needs `raid.edit` and `dependency.edit`), commit-time re-authorization, the T08 port for Dependency entries, the exact refusal codes and English texts of ADR-0031 §11, the working-day slip on the business calendar, the critical path method (no claim with a missing duration), decimal.js totals per currency |
| Worker | `raid.corrective_kpi`, `raid.corrective_benefit`, `raid.corrective_adoption`, `raid.corrective_control`: the severity and persistence rule under lock 730236, one case created or updated (never duplicated), replay-safe (`processed_message` and `corrective_signal_event_key`), follow-up work item through `createWorkItemOnce` |

# P4 tables, slice D (migrations 0044–0046, DG4)

Written by T-DG4-ARCH-05 (solution-architect), 2026-10-09. Binding design: ADR-0032 (forums and meeting series, meetings and the committee workflow, agenda items with executive asks, attendance and quorum, minutes, meeting outputs and action links, the T16 Executive Decision Log, decision-SLA escalation, blocker-red escalation). The table sections below are generated from the catalogue of a freshly migrated disposable PostgreSQL 16 by `docs/delivery/handbacks/DG4/T-DG4-ARCH-05-evidence/gen-dictionary.ts`, so they match the migrations exactly. Slice D stores no money, rate or FTE value.

## Changes to existing tables (0044, 0045)

- **`decision`** (DG2 `0017`, the one decision model): new nullable columns `why_now text` (1–4000), `impact_of_delay text` (1–4000), `ask_origin text` (`api`, `agenda`, `blocker_escalation`), `created_source text` (`api`, `worker`), `source_agenda_item_id uuid` (FK `decision_source_agenda_item_fkey` (transformation_id, source_agenda_item_id) → agenda_item), `decision_right_id uuid` (FK `decision_decision_right_fkey` (transformation_id, decision_right_id) → transformation_decision_right), `sla_due_date date`, `sla_unknown_reason text` (`calendar_not_configured`, `no_steerco_scheduled`, `no_release_date`), `decided_on_behalf_of_user_id uuid` (FK → app_user), `blocker_record_type text` (`raid_entry`, `dependency`, `corrective_case`, `initiative`, `milestone`), `blocker_record_id uuid`. CHECKs: `decision_ask_executive_only` (`ask_origin IS NULL OR kind = 'executive'`); `decision_ask_columns` (the ask columns are NULL when `ask_origin` is NULL); `decision_ask_complete` (an `api`/`agenda` ask has why now, impact of delay, due date, owner and a recommendation); `decision_ask_source` (`agenda` ⇔ `source_agenda_item_id`; `blocker_escalation` ⇔ `created_source = 'worker'`, with a blocker and a due date); `decision_blocker_pair`; `decision_ask_sla_known_or_reason`; `decision_ask_outcome_recorded` (a decided ask has `outcome_text`). Partial unique index `decision_one_open_blocker_ask` (transformation_id, blocker_record_type, blocker_record_id) WHERE `blocker_record_id IS NOT NULL AND status IN ('open', 'deferred')`; index `decision_executive_sla_idx` (sla_due_date) on open or deferred asks. Triggers `decision_ask_guard` (BEFORE INSERT OR UPDATE: origin, creation source, agenda link and blocker immutable; the blocker exists in the transformation) and `decision_ask_options` (CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED: a person-raised ask has at least two active options at commit). Existing rows (T04 design, gate and DG3 funding decisions) keep `ask_origin` NULL and are unchanged; the DG2 `Decision` representation is unchanged.
- **`p4_instantiate_transformation`** (`0030`): redefined by `0044` with one added line at its end that calls `p4_instantiate_forums`; the rest of the body is the `0030` text.

## forum_template

- **Purpose:** The five operating-system layers of B0093, verbatim (Layer, Cadence, Purpose, Participants, Outputs), with provisional Arabic and the platform's structured reading (chair party, participant parties, output kinds, publication rule, default recurrence) (REQ-PB-060; ADR-0032 §1).
- **Migration:** `0044_p4_forums_meetings.sql`. **API module:** `governance`. **Who writes:** none (seed, read-only). **Lifecycle:** seed.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| key | text | NOT NULL |  | `CHECK ((key ~ '^[a-z_]+$'))`; PK |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 99)))` |
| source_layer_en | text | NOT NULL |  |  |
| source_cadence_en | text | NOT NULL |  |  |
| source_purpose_en | text | NOT NULL |  |  |
| source_participants_en | text | NOT NULL |  |  |
| source_outputs_en | text | NOT NULL |  |  |
| layer_ar | text | NOT NULL |  |  |
| cadence_ar | text | NOT NULL |  |  |
| purpose_ar | text | NOT NULL |  |  |
| participants_ar | text | NOT NULL |  |  |
| outputs_ar | text | NOT NULL |  |  |
| ar_provisional | boolean | NOT NULL | `true` |  |
| chair_party_code | text | NULL |  | FK → governance_party(code) |
| participant_parties | text[] | NOT NULL |  | `CHECK (p4_parties_known(participant_parties))` |
| output_kinds | text[] | NOT NULL |  | `CHECK (((cardinality(output_kinds) >= 1) AND p4_meeting_output_kinds_valid(output_kinds)))` |
| publish_requires_any_output | text[] | NOT NULL | `'{}'[]` |  |
| executive_asks_only | boolean | NOT NULL |  |  |
| default_frequency | text | NOT NULL |  | `CHECK ((default_frequency = ANY (ARRAY['daily', 'weekly', 'monthly'])))` |
| default_interval | smallint | NOT NULL |  | `CHECK (((default_interval >= 1) AND (default_interval <= 12)))` |
| source_ref | text | NOT NULL |  | `CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 50)))` |

**Table constraints:**

- `forum_template_check` (CHECK): `CHECK ((publish_requires_any_output <@ output_kinds))`
- `forum_template_ordinal_key` (UNIQUE): `UNIQUE (ordinal)`

## forum

- **Purpose:** A governance forum of a transformation (REQ-S16-019 Forum): the five layers copied at instantiation, plus forums a team adds; participants, quorum, cut-off and agenda rules are configuration (REQ-S10-005; ADR-0032 §1.1).
- **Migration:** `0044_p4_forums_meetings.sql`. **API module:** `governance`. **Who writes:** `forum.configure` (TO); `p4_instantiate_forums` (instantiation and backfill). **Lifecycle:** active → archived (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| template_key | text | NULL |  | FK → forum_template(key) |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 999)))` |
| name_en | text | NOT NULL |  | `CHECK (((char_length(name_en) >= 1) AND (char_length(name_en) <= 200)))` |
| name_ar | text | NOT NULL |  | `CHECK (((char_length(name_ar) >= 1) AND (char_length(name_ar) <= 200)))` |
| cadence_label | text | NOT NULL |  | `CHECK (((char_length(cadence_label) >= 1) AND (char_length(cadence_label) <= 200)))` |
| purpose | text | NOT NULL |  | `CHECK (((char_length(purpose) >= 1) AND (char_length(purpose) <= 2000)))` |
| participants_label | text | NOT NULL |  | `CHECK (((char_length(participants_label) >= 1) AND (char_length(participants_label) <= 500)))` |
| outputs_label | text | NOT NULL |  | `CHECK (((char_length(outputs_label) >= 1) AND (char_length(outputs_label) <= 500)))` |
| chair_party_code | text | NULL |  | FK → governance_party(code) |
| secretary_user_id | uuid | NULL |  | FK → app_user(id) |
| participant_parties | text[] | NOT NULL | `'{}'[]` |  |
| output_kinds | text[] | NOT NULL |  |  |
| publish_requires_any_output | text[] | NOT NULL | `'{}'[]` |  |
| executive_asks_only | boolean | NOT NULL | `false` |  |
| quorum_min | smallint | NULL |  | `CHECK (((quorum_min IS NULL) OR ((quorum_min >= 1) AND (quorum_min <= 100))))` |
| cutoff_working_days | smallint | NOT NULL | `2` | `CHECK (((cutoff_working_days >= 0) AND (cutoff_working_days <= 20)))` |
| agenda_max_items | smallint | NULL |  | `CHECK (((agenda_max_items IS NULL) OR ((agenda_max_items >= 1) AND (agenda_max_items <= 50))))` |
| late_items_rule | text | NOT NULL | `'flag'` | `CHECK ((late_items_rule = ANY (ARRAY['flag', 'refuse'])))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `forum_output_kinds_valid` (CHECK): `CHECK (((cardinality(output_kinds) >= 1) AND p4_meeting_output_kinds_valid(output_kinds)))`
- `forum_participant_parties_known` (CHECK): `CHECK (p4_parties_known(participant_parties))`
- `forum_publish_outputs_subset` (CHECK): `CHECK ((publish_requires_any_output <@ output_kinds))`
- `forum_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `forum_template_key`: `UNIQUE (transformation_id, template_key) WHERE (template_key IS NOT NULL)`
- `forum_transformation_ordinal_idx`: `(transformation_id, ordinal, id)`

**Triggers:**

- `forum_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `forum_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `forum_guard()`
- `forum_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## forum_participant

- **Purpose:** A named participant of a forum, a person or a governed group, and whether it counts for quorum (REQ-S10-005; ADR-0032 §1.2). Grants no permission.
- **Migration:** `0044_p4_forums_meetings.sql`. **API module:** `governance`. **Who writes:** `forum.configure` (TO). **Lifecycle:** active → removed (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| forum_id | uuid | NOT NULL |  |  |
| user_id | uuid | NULL |  | FK → app_user(id) |
| group_id | uuid | NULL |  | FK → access_group(id) |
| counts_for_quorum | boolean | NOT NULL | `true` |  |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'removed'])))` |
| removed_at | timestamp with time zone | NULL |  |  |
| removed_by | uuid | NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `forum_participant_forum_id_fkey` (FK): `FOREIGN KEY (transformation_id, forum_id) REFERENCES forum(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `forum_participant_one_target` (CHECK): `CHECK (((user_id IS NULL) <> (group_id IS NULL)))`
- `forum_participant_removed_complete` (CHECK): `CHECK ((((status = 'removed') = (removed_at IS NOT NULL)) AND ((removed_at IS NULL) = (removed_by IS NULL))))`

**Indexes:**

- `forum_participant_active_group_key`: `UNIQUE (forum_id, group_id) WHERE ((status = 'active') AND (group_id IS NOT NULL))`
- `forum_participant_active_user_key`: `UNIQUE (forum_id, user_id) WHERE ((status = 'active') AND (user_id IS NOT NULL))`

**Triggers:**

- `forum_participant_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `forum_participant_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `forum_participant_guard()`
- `forum_participant_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## meeting_series

- **Purpose:** The recurrence of a forum's meetings; rule_version steps by 1 on every recurrence change; a change regenerates future meetings only (REQ-PB-060, REQ-S10-005; ADR-0032 §2).
- **Migration:** `0044_p4_forums_meetings.sql`. **API module:** `governance`. **Who writes:** `forum.configure` (TO); the generation job advances generated_through only. **Lifecycle:** active → ended (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| forum_id | uuid | NOT NULL |  |  |
| frequency | text | NOT NULL |  | `CHECK ((frequency = ANY (ARRAY['daily', 'weekly', 'monthly'])))` |
| interval_count | smallint | NOT NULL |  | `CHECK (((interval_count >= 1) AND (interval_count <= 12)))` |
| weekdays | smallint[] | NULL |  |  |
| month_day | smallint | NULL |  | `CHECK (((month_day IS NULL) OR ((month_day >= 1) AND (month_day <= 28))))` |
| start_date | date | NOT NULL |  |  |
| end_date | date | NULL |  |  |
| start_time | time without time zone | NOT NULL |  |  |
| duration_minutes | smallint | NOT NULL |  | `CHECK (((duration_minutes >= 15) AND (duration_minutes <= 480)))` |
| timezone | text | NOT NULL | `'Asia/Riyadh'` | `CHECK (((char_length(timezone) >= 1) AND (char_length(timezone) <= 64)))` |
| non_working_day_rule | text | NOT NULL | `'next_working_day'` | `CHECK ((non_working_day_rule = ANY (ARRAY['next_working_day', 'skip', 'keep'])))` |
| horizon_days | smallint | NOT NULL | `90` | `CHECK (((horizon_days >= 7) AND (horizon_days <= 366)))` |
| location | text | NULL |  | `CHECK (((location IS NULL) OR ((char_length(location) >= 1) AND (char_length(location) <= 300))))` |
| rule_version | integer | NOT NULL | `1` | `CHECK ((rule_version >= 1))` |
| generated_through | date | NULL |  |  |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'ended'])))` |
| ended_at | timestamp with time zone | NULL |  |  |
| ended_by | uuid | NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `meeting_series_dates` (CHECK): `CHECK (((end_date IS NULL) OR (end_date >= start_date)))`
- `meeting_series_ended_complete` (CHECK): `CHECK (((status = 'ended') = (ended_at IS NOT NULL)))`
- `meeting_series_forum_id_fkey` (FK): `FOREIGN KEY (transformation_id, forum_id) REFERENCES forum(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `meeting_series_rule_shape` (CHECK): `CHECK ((((frequency = 'weekly') AND (weekdays IS NOT NULL) AND p4_valid_workweek(weekdays) AND (month_day IS NULL)) OR ((frequency = 'monthly') AND (weekdays IS NULL) AND (month_day IS NOT NULL)) OR ((frequency = 'daily') AND (weekdays IS NULL) AND (month_day IS NULL))))`
- `meeting_series_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `meeting_series_one_active_key`: `UNIQUE (forum_id) WHERE (status = 'active')`

**Triggers:**

- `meeting_series_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `meeting_series_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `meeting_series_guard()`
- `meeting_series_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`
- `meeting_series_timezone_known`: BEFORE INSERT OR UPDATE OF timezone FOR EACH ROW → `p4_timezone_known()`

## meeting

- **Purpose:** One forum meeting (REQ-S16-019 Meeting): generated from a series by the worker (no human author) or created ad hoc (ADR-0032 §3.1).
- **Migration:** `0044_p4_forums_meetings.sql`. **API module:** `governance`. **Who writes:** the generation job; `meeting.prepare` (TL, TO, SEC); `meeting.chair` (agenda publication); minutes publication. **Lifecycle:** scheduled → agenda_published → in_session → held → minutes_published; scheduled → in_session; scheduled | agenda_published → cancelled (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| forum_id | uuid | NOT NULL |  |  |
| series_id | uuid | NULL |  |  |
| series_rule_version | integer | NULL |  |  |
| occurrence_date | date | NULL |  |  |
| scheduled_date | date | NOT NULL |  |  |
| starts_at | timestamp with time zone | NOT NULL |  |  |
| ends_at | timestamp with time zone | NOT NULL |  |  |
| timezone | text | NOT NULL | `'Asia/Riyadh'` | `CHECK (((char_length(timezone) >= 1) AND (char_length(timezone) <= 64)))` |
| location | text | NULL |  | `CHECK (((location IS NULL) OR ((char_length(location) >= 1) AND (char_length(location) <= 300))))` |
| chair_user_id | uuid | NULL |  | FK → app_user(id) |
| secretary_user_id | uuid | NULL |  | FK → app_user(id) |
| quorum_min | smallint | NULL |  | `CHECK (((quorum_min IS NULL) OR ((quorum_min >= 1) AND (quorum_min <= 100))))` |
| cutoff_date | date | NULL |  |  |
| cutoff_unknown_reason | text | NULL |  | `CHECK (((cutoff_unknown_reason IS NULL) OR (cutoff_unknown_reason = 'calendar_not_configured')))` |
| status | text | NOT NULL | `'scheduled'` | `CHECK ((status = ANY (ARRAY['scheduled', 'agenda_published', 'in_session', 'held', 'minutes_published', 'cancelled'])))` |
| cancel_reason | text | NULL |  | `CHECK (((cancel_reason IS NULL) OR (cancel_reason = ANY (ARRAY['series_regenerated', 'series_ended', 'manual']))))` |
| cancel_note | text | NULL |  | `CHECK (((cancel_note IS NULL) OR ((char_length(cancel_note) >= 3) AND (char_length(cancel_note) <= 2000))))` |
| cancelled_at | timestamp with time zone | NULL |  |  |
| cancelled_by | uuid | NULL |  | FK → app_user(id) |
| started_at | timestamp with time zone | NULL |  |  |
| held_at | timestamp with time zone | NULL |  |  |
| created_source | text | NOT NULL |  | `CHECK ((created_source = ANY (ARRAY['api', 'worker'])))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `meeting_cancelled_complete` (CHECK): `CHECK ((((status = 'cancelled') = (cancelled_at IS NOT NULL)) AND ((status = 'cancelled') = (cancel_reason IS NOT NULL)) AND ((cancel_reason IS DISTINCT FROM 'manual') OR ((cancelled_by IS NOT NULL) AND (cancel_note IS NOT NULL)))))`
- `meeting_created_source` (CHECK): `CHECK ((((created_source = 'worker') AND (series_id IS NOT NULL) AND (created_by IS NULL)) OR ((created_source = 'api') AND (created_by IS NOT NULL))))`
- `meeting_cutoff_known_or_reason` (CHECK): `CHECK (((cutoff_date IS NULL) = (cutoff_unknown_reason IS NOT NULL)))`
- `meeting_forum_id_fkey` (FK): `FOREIGN KEY (transformation_id, forum_id) REFERENCES forum(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `meeting_series_fields` (CHECK): `CHECK ((((series_id IS NULL) = (series_rule_version IS NULL)) AND ((series_id IS NULL) = (occurrence_date IS NULL))))`
- `meeting_series_id_fkey` (FK): `FOREIGN KEY (transformation_id, series_id) REFERENCES meeting_series(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `meeting_series_rule_version_check1` (CHECK): `CHECK (((series_rule_version IS NULL) OR (series_rule_version >= 1)))`
- `meeting_times` (CHECK): `CHECK ((ends_at > starts_at))`
- `meeting_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `meeting_forum_date_idx`: `(forum_id, scheduled_date, id)`
- `meeting_series_occurrence_key`: `UNIQUE (series_id, occurrence_date) WHERE ((status <> 'cancelled') AND (series_id IS NOT NULL))`
- `meeting_transformation_date_idx`: `(transformation_id, scheduled_date DESC, id DESC)`

**Triggers:**

- `meeting_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `meeting_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `meeting_guard()`
- `meeting_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`
- `meeting_timezone_known`: BEFORE INSERT OR UPDATE OF timezone FOR EACH ROW → `p4_timezone_known()`

## agenda_item

- **Purpose:** One agenda item (REQ-S16-019 AgendaItem); an executive ask links its T16 decision or carries a draft brief, never both; publication needs the elements of B0102 and REQ-S10-012; quorum is enforced on a decided outcome (REQ-PB-068, REQ-S10-011; ADR-0032 §3.2, §3.3).
- **Migration:** `0044_p4_forums_meetings.sql`. **API module:** `governance`. **Who writes:** `meeting.prepare` (TL, TO, SEC); publish `meeting.chair`; outcome decided `executive_decision.decide`. **Lifecycle:** draft → published → closed; draft | published → withdrawn (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| meeting_id | uuid | NOT NULL |  |  |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 999)))` |
| item_kind | text | NOT NULL |  | `CHECK ((item_kind = ANY (ARRAY['executive_ask', 'discussion', 'information'])))` |
| title | text | NOT NULL |  | `CHECK (((char_length(title) >= 1) AND (char_length(title) <= 500)))` |
| description | text | NULL |  | `CHECK (((description IS NULL) OR ((char_length(description) >= 1) AND (char_length(description) <= 8000))))` |
| presenter_user_id | uuid | NULL |  | FK → app_user(id) |
| duration_minutes | smallint | NULL |  | `CHECK (((duration_minutes IS NULL) OR ((duration_minutes >= 1) AND (duration_minutes <= 480))))` |
| materials_evidence_ids | uuid[] | NOT NULL | `'{}'::uuid[]` | `CHECK ((cardinality(materials_evidence_ids) <= 20))` |
| decision_id | uuid | NULL |  |  |
| ask_decision_required | text | NULL |  | `CHECK (((ask_decision_required IS NULL) OR ((char_length(ask_decision_required) >= 1) AND (char_length(ask_decision_required) <= 500))))` |
| ask_why_now | text | NULL |  | `CHECK (((ask_why_now IS NULL) OR ((char_length(ask_why_now) >= 1) AND (char_length(ask_why_now) <= 4000))))` |
| ask_options | text[] | NULL |  | `CHECK (((ask_options IS NULL) OR ((cardinality(ask_options) >= 1) AND (cardinality(ask_options) <= 26))))` |
| ask_recommendation | text | NULL |  | `CHECK (((ask_recommendation IS NULL) OR ((char_length(ask_recommendation) >= 1) AND (char_length(ask_recommendation) <= 4000))))` |
| ask_impact_of_delay | text | NULL |  | `CHECK (((ask_impact_of_delay IS NULL) OR ((char_length(ask_impact_of_delay) >= 1) AND (char_length(ask_impact_of_delay) <= 4000))))` |
| ask_owner_user_id | uuid | NULL |  | FK → app_user(id) |
| ask_required_date | date | NULL |  |  |
| late | boolean | NOT NULL | `false` |  |
| status | text | NOT NULL | `'draft'` | `CHECK ((status = ANY (ARRAY['draft', 'published', 'closed', 'withdrawn'])))` |
| published_at | timestamp with time zone | NULL |  |  |
| published_by | uuid | NULL |  | FK → app_user(id) |
| outcome | text | NULL |  | `CHECK (((outcome IS NULL) OR (outcome = ANY (ARRAY['decided', 'deferred', 'noted']))))` |
| outcome_quorum_present | smallint | NULL |  | `CHECK (((outcome_quorum_present IS NULL) OR (outcome_quorum_present >= 0)))` |
| outcome_recorded_at | timestamp with time zone | NULL |  |  |
| outcome_recorded_by | uuid | NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `agenda_item_ask_shape` (CHECK): `CHECK ((((item_kind = 'executive_ask') OR ((decision_id IS NULL) AND (ask_decision_required IS NULL) AND (ask_why_now IS NULL) AND (ask_options IS NULL) AND (ask_recommendation IS NULL) AND (ask_impact_of_delay IS NULL) AND (ask_owner_user_id IS NULL) AND (ask_required_date IS NULL))) AND ((decision_id IS NULL) OR ((ask_decision_required IS NULL) AND (ask_why_now IS NULL) AND (ask_options IS NULL) AND (ask_recommendation IS NULL) AND (ask_impact_of_delay IS NULL) AND (ask_owner_user_id IS NULL) AND (ask_required_date IS NULL)))))`
- `agenda_item_decision_id_fkey` (FK): `FOREIGN KEY (transformation_id, decision_id) REFERENCES decision(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `agenda_item_meeting_id_fkey` (FK): `FOREIGN KEY (transformation_id, meeting_id) REFERENCES meeting(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `agenda_item_ordinal_key` (UNIQUE): `UNIQUE (meeting_id, ordinal) DEFERRABLE INITIALLY DEFERRED`
- `agenda_item_outcome_complete` (CHECK): `CHECK ((((outcome IS NULL) = (outcome_recorded_at IS NULL)) AND ((outcome_recorded_at IS NULL) = (outcome_recorded_by IS NULL)) AND ((outcome IS NULL) OR (status = 'closed')) AND ((outcome IS DISTINCT FROM 'decided') OR (item_kind = 'executive_ask'))))`
- `agenda_item_published_ask_linked` (CHECK): `CHECK (((item_kind <> 'executive_ask') OR (status = ANY (ARRAY['draft', 'withdrawn'])) OR (decision_id IS NOT NULL)))`
- `agenda_item_published_complete` (CHECK): `CHECK ((((status = ANY (ARRAY['published', 'closed'])) = (published_at IS NOT NULL)) AND ((published_at IS NULL) = (published_by IS NULL))))`
- `agenda_item_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `agenda_item_decision_idx`: `(decision_id) WHERE (decision_id IS NOT NULL)`
- `agenda_item_meeting_idx`: `(meeting_id, ordinal)`

**Triggers:**

- `agenda_item_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `agenda_item_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `agenda_item_guard()`
- `agenda_item_meeting_editable`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p4_meeting_child_editable()`
- `agenda_item_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## meeting_attendance

- **Purpose:** One person's attendance at one meeting (REQ-S16-019 Attendance); the quorum count is the present rows that count for quorum (REQ-S10-011; ADR-0032 §3.3).
- **Migration:** `0044_p4_forums_meetings.sql`. **API module:** `governance`. **Who writes:** `meeting.prepare` (TL, TO, SEC). **Lifecycle:** mutable until the meeting's minutes are published.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| meeting_id | uuid | NOT NULL |  |  |
| user_id | uuid | NOT NULL |  | FK → app_user(id) |
| attendance | text | NOT NULL |  | `CHECK ((attendance = ANY (ARRAY['present', 'absent', 'apologies'])))` |
| counts_for_quorum | boolean | NOT NULL | `true` |  |
| on_behalf_of_user_id | uuid | NULL |  | FK → app_user(id) |
| note | text | NULL |  | `CHECK (((note IS NULL) OR ((char_length(note) >= 1) AND (char_length(note) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `meeting_attendance_meeting_id_fkey` (FK): `FOREIGN KEY (transformation_id, meeting_id) REFERENCES meeting(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `meeting_attendance_not_self_proxy` (CHECK): `CHECK (((on_behalf_of_user_id IS NULL) OR (on_behalf_of_user_id <> user_id)))`
- `meeting_attendance_person_key` (UNIQUE): `UNIQUE (meeting_id, user_id)`
- `meeting_attendance_proxy_present` (CHECK): `CHECK (((on_behalf_of_user_id IS NULL) OR (attendance = 'present')))`

**Triggers:**

- `meeting_attendance_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `meeting_attendance_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `meeting_attendance_guard()`
- `meeting_attendance_meeting_editable`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p4_meeting_child_editable()`
- `meeting_attendance_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## meeting_output

- **Purpose:** One output of a meeting as defined for its layer (B0093 Outputs), linked to the canonical record it is about (REQ-PB-061; ADR-0032 §4).
- **Migration:** `0044_p4_forums_meetings.sql`. **API module:** `governance`. **Who writes:** `meeting.prepare` (TL, TO, SEC). **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| meeting_id | uuid | NOT NULL |  |  |
| agenda_item_id | uuid | NULL |  |  |
| output_kind | text | NOT NULL |  |  |
| record_type | text | NULL |  |  |
| record_id | uuid | NULL |  |  |
| note | text | NULL |  | `CHECK (((note IS NULL) OR ((char_length(note) >= 1) AND (char_length(note) <= 4000))))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `meeting_output_agenda_item_id_fkey` (FK): `FOREIGN KEY (transformation_id, agenda_item_id) REFERENCES agenda_item(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `meeting_output_kind_valid` (CHECK): `CHECK (p4_meeting_output_kinds_valid(ARRAY[output_kind]))`
- `meeting_output_meeting_id_fkey` (FK): `FOREIGN KEY (transformation_id, meeting_id) REFERENCES meeting(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `meeting_output_note_or_record` (CHECK): `CHECK (((record_id IS NOT NULL) OR (note IS NOT NULL)))`
- `meeting_output_record_pair` (CHECK): `CHECK (((record_type IS NULL) = (record_id IS NULL)))`
- `meeting_output_record_type` (CHECK): `CHECK (COALESCE(
CASE output_kind
    WHEN 'decision' THEN (record_type = 'decision')
    WHEN 'decision_log' THEN ((record_type IS NULL) OR (record_type = 'decision'))
    WHEN 'unblocker' THEN ((record_type IS NULL) OR (record_type = ANY (ARRAY['raid_entry', 'dependency', 'decision'])))
    WHEN 'benefit_view' THEN ((record_type IS NULL) OR (record_type = 'benefit'))
    WHEN 'integrated_status' THEN (record_type IS NULL)
    WHEN 'milestone' THEN (record_type = 'milestone')
    WHEN 'action' THEN (record_type = 'action_item')
    WHEN 'raid' THEN (record_type = ANY (ARRAY['raid_entry', 'dependency']))
    WHEN 'test' THEN ((record_type IS NULL) OR (record_type = 'evidence'))
    WHEN 'evidence' THEN (record_type = 'evidence')
    WHEN 'recommendation' THEN ((record_type IS NULL) OR (record_type = 'decision'))
    WHEN 'benefit_evidence' THEN (record_type = ANY (ARRAY['benefit_evidence', 'benefit_measurement']))
    WHEN 'forecast' THEN (record_type = ANY (ARRAY['benefit', 'benefit_measurement']))
    WHEN 'corrective_action' THEN (record_type = 'corrective_case')
    ELSE false
END, false))`

**Indexes:**

- `meeting_output_meeting_idx`: `(meeting_id, output_kind, created_at, id)`

**Triggers:**

- `meeting_output_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `meeting_output_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `meeting_output_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `meeting_output_guard`: BEFORE INSERT FOR EACH ROW → `meeting_output_guard()`
- `meeting_output_meeting_editable`: BEFORE INSERT FOR EACH ROW → `p4_meeting_child_editable()`
- `meeting_output_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## meeting_action_link

- **Purpose:** An action assigned or reviewed in a meeting (REQ-S16-019 MeetingActionLink); the action itself is the canonical action_item (ADR-0032 §5.4).
- **Migration:** `0044_p4_forums_meetings.sql`. **API module:** `governance`. **Who writes:** `meeting.prepare` (TL, TO, SEC). **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| meeting_id | uuid | NOT NULL |  |  |
| agenda_item_id | uuid | NULL |  |  |
| action_item_id | uuid | NOT NULL |  |  |
| link_kind | text | NOT NULL |  | `CHECK ((link_kind = ANY (ARRAY['assigned', 'reviewed'])))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `meeting_action_link_action_item_id_fkey` (FK): `FOREIGN KEY (transformation_id, action_item_id) REFERENCES action_item(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `meeting_action_link_agenda_item_id_fkey` (FK): `FOREIGN KEY (transformation_id, agenda_item_id) REFERENCES agenda_item(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `meeting_action_link_key` (UNIQUE): `UNIQUE (meeting_id, action_item_id)`
- `meeting_action_link_meeting_id_fkey` (FK): `FOREIGN KEY (transformation_id, meeting_id) REFERENCES meeting(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Indexes:**

- `meeting_action_link_action_idx`: `(action_item_id)`

**Triggers:**

- `meeting_action_link_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `meeting_action_link_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `meeting_action_link_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `meeting_action_link_meeting_editable`: BEFORE INSERT FOR EACH ROW → `p4_meeting_child_editable()`
- `meeting_action_link_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## meeting_minutes

- **Purpose:** The minutes of one meeting (REQ-S16-019 Minutes); immutable once published; publication needs a held meeting and the forum's required outputs (REQ-S10-011, REQ-PB-061; ADR-0032 §5).
- **Migration:** `0044_p4_forums_meetings.sql`. **API module:** `governance`. **Who writes:** `meeting.prepare` (draft); `meeting.chair` (approve, publish, return to draft). **Lifecycle:** draft → approved → published (final); approved → draft.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| meeting_id | uuid | NOT NULL |  |  |
| body | text | NOT NULL |  | `CHECK (((char_length(body) >= 1) AND (char_length(body) <= 50000)))` |
| status | text | NOT NULL | `'draft'` | `CHECK ((status = ANY (ARRAY['draft', 'approved', 'published'])))` |
| approved_at | timestamp with time zone | NULL |  |  |
| approved_by | uuid | NULL |  | FK → app_user(id) |
| published_at | timestamp with time zone | NULL |  |  |
| published_by | uuid | NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `meeting_minutes_approved_complete` (CHECK): `CHECK ((((status = ANY (ARRAY['approved', 'published'])) = (approved_at IS NOT NULL)) AND ((approved_at IS NULL) = (approved_by IS NULL))))`
- `meeting_minutes_meeting_id_fkey` (FK): `FOREIGN KEY (transformation_id, meeting_id) REFERENCES meeting(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `meeting_minutes_meeting_key` (UNIQUE): `UNIQUE (meeting_id)`
- `meeting_minutes_published_complete` (CHECK): `CHECK ((((status = 'published') = (published_at IS NOT NULL)) AND ((published_at IS NULL) = (published_by IS NULL))))`

**Triggers:**

- `meeting_minutes_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `meeting_minutes_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `meeting_minutes_guard()`
- `meeting_minutes_no_delete`: BEFORE DELETE OR TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `meeting_minutes_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## governance_escalation_rule

- **Purpose:** The decision-SLA and blocker-red escalation rules per transformation (M0231, M0233; ADR-0032 §8.1). Without a row the code defaults apply.
- **Migration:** `0045_p4_t16_escalation.sql`. **API module:** `governance`. **Who writes:** `escalation_rule.configure` (TL, TO). **Lifecycle:** mutable, versioned; kind immutable.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| rule_kind | text | NOT NULL |  | `CHECK ((rule_kind = ANY (ARRAY['decision_sla', 'blocker_red'])))` |
| enabled | boolean | NOT NULL | `true` |  |
| escalation_chain | text[] | NULL |  | `CHECK (((escalation_chain IS NULL) OR (((cardinality(escalation_chain) >= 1) AND (cardinality(escalation_chain) <= 5)) AND p4_parties_known(escalation_chain))))` |
| red_cycles | smallint | NULL |  | `CHECK (((red_cycles IS NULL) OR ((red_cycles >= 2) AND (red_cycles <= 12))))` |
| deadline_working_days | smallint | NULL |  | `CHECK (((deadline_working_days IS NULL) OR ((deadline_working_days >= 1) AND (deadline_working_days <= 60))))` |
| owner_party_code | text | NULL |  | FK → governance_party(code) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `governance_escalation_rule_kind_key` (UNIQUE): `UNIQUE (transformation_id, rule_kind)`
- `governance_escalation_rule_shape` (CHECK): `CHECK ((((rule_kind = 'decision_sla') AND (escalation_chain IS NOT NULL) AND (red_cycles IS NULL) AND (deadline_working_days IS NULL) AND (owner_party_code IS NULL)) OR ((rule_kind = 'blocker_red') AND (escalation_chain IS NULL) AND (red_cycles IS NOT NULL) AND (deadline_working_days IS NOT NULL) AND (owner_party_code IS NOT NULL))))`

**Triggers:**

- `governance_escalation_rule_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `governance_escalation_rule_guard`: BEFORE UPDATE FOR EACH ROW → `governance_escalation_rule_guard()`
- `governance_escalation_rule_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## decision_escalation

- **Purpose:** One escalation of an executive ask whose SLA expired, with its target or routing error and the delay impact; once per (ask, SLA due date); never a decision (REQ-S12-011; ADR-0032 §7).
- **Migration:** `0045_p4_t16_escalation.sql`. **API module:** `governance`. **Who writes:** the `governance.decision_sla_scan` job (actor service). **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| decision_id | uuid | NOT NULL |  |  |
| sla_due_date | date | NOT NULL |  |  |
| business_date | date | NOT NULL |  |  |
| level | smallint | NOT NULL |  | `CHECK (((level >= 1) AND (level <= 5)))` |
| party_code | text | NULL |  | FK → governance_party(code) |
| target_user_id | uuid | NULL |  | FK → app_user(id) |
| target_group_id | uuid | NULL |  | FK → access_group(id) |
| routing_error | text | NULL |  | `CHECK (((routing_error IS NULL) OR (routing_error = ANY (ARRAY['party_unmapped', 'party_not_executive', 'no_next_authority']))))` |
| delay_impact | text | NULL |  | `CHECK (((delay_impact IS NULL) OR ((char_length(delay_impact) >= 1) AND (char_length(delay_impact) <= 4000))))` |
| escalated_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `decision_escalation_decision_fkey` (FK): `FOREIGN KEY (transformation_id, decision_id) REFERENCES decision(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `decision_escalation_expired` (CHECK): `CHECK ((sla_due_date < business_date))`
- `decision_escalation_once` (UNIQUE): `UNIQUE (decision_id, sla_due_date)`
- `decision_escalation_party_error` (CHECK): `CHECK (((routing_error = 'no_next_authority') = ((routing_error IS NOT NULL) AND (party_code IS NULL))))`
- `decision_escalation_target` (CHECK): `CHECK ((((routing_error IS NULL) AND (party_code IS NOT NULL) AND ((target_user_id IS NULL) <> (target_group_id IS NULL))) OR ((routing_error IS NOT NULL) AND (target_user_id IS NULL) AND (target_group_id IS NULL))))`

**Indexes:**

- `decision_escalation_decision_idx`: `(decision_id, escalated_at, id)`
- `decision_escalation_transformation_idx`: `(transformation_id, escalated_at DESC, id DESC)`

**Triggers:**

- `decision_escalation_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `decision_escalation_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `decision_escalation_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `decision_escalation_guard`: BEFORE INSERT FOR EACH ROW → `decision_escalation_guard()`
- `decision_escalation_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## blocker_status

- **Purpose:** A blocker's RAG in one review cycle (one meeting): the RAG history by cycle of REQ-PB-082 (ADR-0032 §8.2).
- **Migration:** `0045_p4_t16_escalation.sql`. **API module:** `governance`. **Who writes:** `meeting.prepare` (TL, TO, SEC). **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| meeting_id | uuid | NOT NULL |  |  |
| forum_id | uuid | NOT NULL |  |  |
| cycle_date | date | NOT NULL |  |  |
| source_record_type | text | NOT NULL |  | `CHECK ((source_record_type = ANY (ARRAY['raid_entry', 'dependency', 'corrective_case', 'initiative', 'milestone'])))` |
| source_record_id | uuid | NOT NULL |  |  |
| rag | text | NOT NULL |  | `CHECK ((rag = ANY (ARRAY['red', 'amber', 'green', 'unknown'])))` |
| note | text | NULL |  | `CHECK (((note IS NULL) OR ((char_length(note) >= 1) AND (char_length(note) <= 2000))))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `blocker_status_forum_fkey` (FK): `FOREIGN KEY (transformation_id, forum_id) REFERENCES forum(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `blocker_status_meeting_fkey` (FK): `FOREIGN KEY (transformation_id, meeting_id) REFERENCES meeting(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `blocker_status_once_per_cycle` (UNIQUE): `UNIQUE (meeting_id, source_record_type, source_record_id)`

**Indexes:**

- `blocker_status_source_idx`: `(transformation_id, source_record_type, source_record_id, forum_id, cycle_date DESC)`

**Triggers:**

- `blocker_status_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `blocker_status_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `blocker_status_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `blocker_status_guard`: BEFORE INSERT FOR EACH ROW → `blocker_status_guard()`
- `blocker_status_meeting_editable`: BEFORE INSERT FOR EACH ROW → `p4_meeting_child_editable()`
- `blocker_status_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## executive_decision_log

- **Purpose:** View: the T16 Executive Decision Log (B0130) over the canonical decision rows of kind executive, with the nine T16 columns (REQ-PB-081; ADR-0032 §6). No copy.
- **Migration:** `0045_p4_t16_escalation.sql`. **API module:** `governance`. **Who writes:** none (view). **Lifecycle:** derived.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NULL |  |  |
| organization_id | uuid | NULL |  |  |
| transformation_id | uuid | NULL |  |  |
| t16_id | text | NULL |  |  |
| decision | text | NULL |  |  |
| why_now | text | NULL |  |  |
| options | text | NULL |  |  |
| recommendation | text | NULL |  |  |
| owner_user_id | uuid | NULL |  |  |
| decision_date | date | NULL |  |  |
| impact_of_delay | text | NULL |  |  |
| outcome | text | NULL |  |  |
| status | text | NULL |  |  |
| ask_origin | text | NULL |  |  |
| sla_due_date | date | NULL |  |  |
| sla_unknown_reason | text | NULL |  |  |
| decided_at | timestamp with time zone | NULL |  |  |
| decided_by | uuid | NULL |  |  |
| blocker_record_type | text | NULL |  |  |
| blocker_record_id | uuid | NULL |  |  |
| version | integer | NULL |  |  |
| created_at | timestamp with time zone | NULL |  |  |
| updated_at | timestamp with time zone | NULL |  |  |

## P4 seeds (0044, 0046, slice D)

- `forum_template`: the five B0093 rows, verbatim English, Arabic marked provisional (`ar_provisional = true`).
- `forum`: five rows per existing transformation (the `0044` backfill), audited `system` on behalf of the transformation's creator; new transformations get them from `p4_instantiate_transformation`.
- `work_item_kind` `meeting_action_due` (M0212), `executive_decision_due` (M0144), `executive_decision_escalated` (M0231) and `minutes_to_approve` (M0212), owner module `governance` (label_ar provisional wording).
- `permission` (6 rows: `forum.configure` configure, `meeting.prepare` write, `meeting.chair` write, `executive_decision.create` write, `executive_decision.decide` business_approval, `escalation_rule.configure` configure) and `role_permission` (18 rows): exactly `P4_GOVERNANCE_PERMISSIONS` / `P4_GOVERNANCE_ROLE_PERMISSIONS` in `packages/shared/src/permissions.ts` (`packages/db/src/seed.test.ts`). AUD and the technical-admin roles hold none; `executive_decision.decide` is held by SP, BO and FIN only.
- No meeting, series, agenda item, executive ask, escalation or rule is seeded.

## P4 functions (slice D)

| Function | Migration | Purpose | Callable by `mth_app` |
|---|---|---|---|
| `p4_meeting_output_kinds_valid(text[])` | 0044 | the closed set of B0093 output kinds | via CHECK |
| `p4_instantiate_forums(uuid, uuid, text, text)` | 0044 | copy the five layers into a transformation; idempotent; audited | yes (EXECUTE) |
| `p4_instantiate_transformation(uuid, uuid, text, text)` | 0030, redefined 0044 | the P4 starter structure, now including the forums | yes (EXECUTE) |
| `forum_guard()` | 0044 | template key immutable; archived is final | via trigger |
| `forum_participant_guard()` | 0044 | starts active; forum and participant immutable; removed is final; group of the same organization | via trigger |
| `meeting_series_guard()` | 0044 | starts active at rule version 1; forum immutable; a recurrence change steps rule_version by 1 and is made by a person; ended is final | via trigger |
| `meeting_guard()` | 0044 | starts scheduled; identity immutable; legal transitions; final states; future-only regeneration; minutes_published needs published minutes | via trigger |
| `p4_meeting_child_editable()` | 0044 | children of a meeting are frozen once its minutes are published or it is cancelled | via trigger |
| `agenda_item_guard()` | 0044 | starts draft; executive-asks-only forums; legal transitions; published items frozen; a decided outcome needs a session and the quorum | via trigger |
| `meeting_attendance_guard()` | 0044 | meeting and person immutable | via trigger |
| `meeting_output_guard()` | 0044 | the kind is one of the forum's outputs; the linked record exists in the transformation | via trigger |
| `meeting_minutes_guard()` | 0044 | starts draft; legal transitions; approved minutes not edited in place; published minutes immutable; publication needs a held meeting and the forum's required outputs | via trigger |
| `decision_ask_guard()` | 0045 | ask origin and source immutable; the blocker exists | via trigger |
| `decision_ask_options()` | 0045 | at least two active options on a person-raised ask (deferred) | via constraint trigger |
| `governance_escalation_rule_guard()` | 0045 | rule kind immutable | via trigger |
| `decision_escalation_guard()` | 0045 | only an open or deferred ask whose current SLA date is escalated; levels step by 1 | via trigger |
| `blocker_status_guard()` | 0045 | recorded in a meeting in session or held; the meeting's own forum and date; the blocker exists | via trigger |

## P4 validation rules summary (slice D)

| Layer | What it checks |
|---|---|
| Database | The P2 record guards (version step, identity, organization = transformation's, deferred audit coverage; append-only outputs, action links, escalations and blocker statuses); closed sets (output kinds, frequencies, statuses, item kinds, attendance values, RAG values, rule kinds, routing errors); known governance parties; one copy of each layer per transformation; one active series per forum; no duplicate series occurrence; future-only regeneration; meeting and agenda state machines; frozen meetings after publication; the executive-ask shape (link xor brief) and the published-ask link; the quorum on a decided outcome; immutable published minutes; the forum's required outputs on publication; the T16 ask completeness, options, outcome and SLA-or-reason; one open ask per blocker; one escalation per ask and due date |
| API (`@mth/shared/schemas`) | Shapes (OpenAPI slice D schemas; an executive ask without `whyNow` is 400 `executive_decision.field_required` at `/whyNow`), free-text rules, strict UTF-8, request media types, `If-Match` |
| Service | Permissions and record-level rules (ADR-0032 §9: the meeting's chair; the decision owner or delegate), commit-time re-authorization, occurrence generation on the business calendar, the publication checks with the exact refusal codes and English texts of ADR-0032 §11, the quorum count, `NextForumDateProvider` |
| Worker | `governance.meeting_series_generate` (lock 730238, idempotent), `governance.decision_sla_scan` (working days only, once per due date, lock 730240, never decides), `governance.blocker_escalation` and `governance.blocker_escalation_scan` (N red cycles → one open ask, lock 730239) |

# P4 tables, slices F and G (migrations 0047–0050, DG4)

Written by T-DG4-ARCH-06 (solution-architect), 2026-10-09. Binding design: ADR-0033 (adoption: indicators as KPI templates, T13, champions, interventions, forms, training versus proficiency, involvement and champion constraints) and ADR-0034 (sustainment: separate statuses, transition decisions, performance areas beyond closure, BAU handover and receiving-owner acceptance, controls and checks, reviews, CI backlog, lessons, governed closure). The table sections below are generated from the catalogue of a freshly migrated disposable PostgreSQL 16 by `docs/delivery/handbacks/DG4/T-DG4-ARCH-06-evidence/gen-dictionary.ts`, so they match the migrations exactly. Slices F and G store no money, rate or FTE value; the two record-fed adoption measures are computed decimals at read time (ADR-0033 §6), never stored.

## Changes to existing tables (0047, 0048)

- **`record_code_counter`** (DG2): the CHECK `record_code_counter_prefix_check` is widened (dropped and re-added) to add the prefixes `SG`, `AI` (`0047`) and `PA`, `HO`, `CTL`, `CI`, `LL`, `TD` (`0048`); every earlier prefix stays.
- **`initiative`** (DG3 `0020`): new columns `delivery_completed_at timestamptz NULL`, `delivery_completed_by uuid NULL` (FK → app_user), `adoption_status text NOT NULL DEFAULT 'not_assessed'` (CHECK `initiative_adoption_status_valid`: `not_assessed`, `on_track`, `at_risk`, `adopted`), `adoption_status_note text NULL` (1–2000), `adoption_status_set_at timestamptz NULL`, `adoption_status_set_by uuid NULL` (FK → app_user). CHECKs `initiative_delivery_completed_stamps` (both delivery stamps or neither) and `initiative_adoption_status_stamps` (both adoption stamps or neither; a status other than `not_assessed` has them). Trigger `initiative_delivery_complete_guard` (BEFORE UPDATE: the move to `completed` needs the delivery stamps; the stamps are set once, with that move). Existing rows take the defaults (NULL stamps, `not_assessed`) and keep their version; the DG3 status edges (`initiative_status_step`) are unchanged.
- **`transformation`** (DG1 `0002`): trigger `transformation_closure_guard` (BEFORE UPDATE OF status: `closed` needs the transformation's `closure_record`). The DG1 `PATCH` keeps refusing closure in the API; no existing row is touched.

## adoption_indicator_template

- **Purpose:** The seven leading adoption indicators of B0109-B0115, verbatim, one row per measure (indicator 4 has two: training completion and observed proficiency), with provisional Arabic and the platform's KPI-template reading (REQ-PB-071, REQ-PB-072; ADR-0033 §2).
- **Migration:** `0047_p4_adoption.sql`. **API module:** `adoption`. **Who writes:** none (seed, read-only). **Lifecycle:** seed.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| key | text | NOT NULL |  | `CHECK ((key ~ '^[a-z_]+$'))`; PK |
| indicator_key | text | NOT NULL |  | `CHECK ((indicator_key ~ '^[a-z_]+$'))` |
| indicator_ordinal | smallint | NOT NULL |  | `CHECK (((indicator_ordinal >= 1) AND (indicator_ordinal <= 7)))` |
| measure_ordinal | smallint | NOT NULL |  | `CHECK (((measure_ordinal >= 1) AND (measure_ordinal <= 2)))` |
| source_indicator_en | text | NOT NULL |  | `CHECK (((char_length(source_indicator_en) >= 1) AND (char_length(source_indicator_en) <= 200)))` |
| indicator_ar | text | NOT NULL |  | `CHECK (((char_length(indicator_ar) >= 1) AND (char_length(indicator_ar) <= 200)))` |
| measure_en | text | NOT NULL |  | `CHECK (((char_length(measure_en) >= 1) AND (char_length(measure_en) <= 200)))` |
| measure_ar | text | NOT NULL |  | `CHECK (((char_length(measure_ar) >= 1) AND (char_length(measure_ar) <= 200)))` |
| ar_provisional | boolean | NOT NULL | `true` |  |
| unit_kind | text | NOT NULL |  | `CHECK ((unit_kind = ANY (ARRAY['percentage', 'duration'])))` |
| polarity | text | NOT NULL |  | `CHECK ((polarity = ANY (ARRAY['higher_is_better', 'lower_is_better'])))` |
| value_nature | text | NOT NULL |  | `CHECK ((value_nature = ANY (ARRAY['ratio', 'stock'])))` |
| aggregation_rule | text | NOT NULL |  | `CHECK ((aggregation_rule = ANY (ARRAY['weighted_ratio', 'last_value'])))` |
| value_source | text | NOT NULL |  | `CHECK ((value_source = ANY (ARRAY['kpi_actuals', 'training_records', 'assessment_records'])))` |
| source_ref | text | NOT NULL |  | `CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 50)))` |

**Table constraints:**

- `adoption_indicator_template_measure_key` (UNIQUE): `UNIQUE (indicator_ordinal, measure_ordinal)`
- `adoption_indicator_template_nature_rule` (CHECK): `CHECK (((value_nature = 'ratio') = (aggregation_rule = 'weighted_ratio')))`

## stakeholder_group

- **Purpose:** One T13 row (B0107; REQ-PB-070) with the M0215 additions: influence and impact separately, stance, required behavior, intervention types, intervention plan, owner, adoption KPI (REQ-S11-001; REQ-S16-020 StakeholderGroup; ADR-0033 §1, §3).
- **Migration:** `0047_p4_adoption.sql`. **API module:** `adoption`. **Who writes:** `adoption.edit` (TL, BO, WL). **Lifecycle:** active → archived (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| code | text | NOT NULL |  | `CHECK ((code ~ '^SG-[0-9]{2,6}$'))` |
| name | text | NOT NULL |  | `CHECK (((char_length(name) >= 1) AND (char_length(name) <= 200)))` |
| description | text | NULL |  | `CHECK (((description IS NULL) OR ((char_length(description) >= 1) AND (char_length(description) <= 4000))))` |
| influence | text | NULL |  | `CHECK (((influence IS NULL) OR (influence = ANY (ARRAY['H', 'M', 'L']))))` |
| impact | text | NOT NULL |  | `CHECK ((impact = ANY (ARRAY['H', 'M', 'L'])))` |
| current_stance | text | NOT NULL |  | `CHECK ((current_stance = ANY (ARRAY['support', 'neutral', 'resist'])))` |
| required_behavior | text | NOT NULL |  | `CHECK (((char_length(required_behavior) >= 1) AND (char_length(required_behavior) <= 2000)))` |
| intervention_types | text[] | NOT NULL |  |  |
| intervention_plan | text | NULL |  | `CHECK (((intervention_plan IS NULL) OR ((char_length(intervention_plan) >= 1) AND (char_length(intervention_plan) <= 8000))))` |
| owner_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| adoption_kpi_definition_id | uuid | NULL |  |  |
| headcount | integer | NULL |  | `CHECK (((headcount IS NULL) OR ((headcount >= 1) AND (headcount <= 10000000))))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `stakeholder_group_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `stakeholder_group_code_key` (UNIQUE): `UNIQUE (transformation_id, code)`
- `stakeholder_group_intervention_types_distinct` (CHECK): `CHECK (p4_text_array_distinct(intervention_types))`
- `stakeholder_group_intervention_types_valid` (CHECK): `CHECK ((((cardinality(intervention_types) >= 1) AND (cardinality(intervention_types) <= 4)) AND (intervention_types <@ ARRAY['comms', 'training', 'involvement', 'incentive'])))`
- `stakeholder_group_kpi_fkey` (FK): `FOREIGN KEY (transformation_id, adoption_kpi_definition_id) REFERENCES kpi_definition(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `stakeholder_group_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `stakeholder_group_name_key`: `UNIQUE (transformation_id, lower(name)) WHERE (status = 'active')`
- `stakeholder_group_transformation_idx`: `(transformation_id, code)`

**Triggers:**

- `stakeholder_group_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `stakeholder_group_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `stakeholder_group_guard()`
- `stakeholder_group_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## stakeholder_champion

- **Purpose:** A named champion of a stakeholder group (M0215; B0116; ADR-0033 §7).
- **Migration:** `0047_p4_adoption.sql`. **API module:** `adoption`. **Who writes:** `adoption.edit` (TL, BO, WL). **Lifecycle:** active → removed (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| stakeholder_group_id | uuid | NOT NULL |  |  |
| user_id | uuid | NOT NULL |  | FK → app_user(id) |
| note | text | NULL |  | `CHECK (((note IS NULL) OR ((char_length(note) >= 1) AND (char_length(note) <= 1000))))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'removed'])))` |
| removed_at | timestamp with time zone | NULL |  |  |
| removed_by | uuid | NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `stakeholder_champion_group_fkey` (FK): `FOREIGN KEY (transformation_id, stakeholder_group_id) REFERENCES stakeholder_group(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `stakeholder_champion_removed_complete` (CHECK): `CHECK ((((status = 'removed') = (removed_at IS NOT NULL)) AND ((removed_at IS NULL) = (removed_by IS NULL))))`
- `stakeholder_champion_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `stakeholder_champion_active_key`: `UNIQUE (stakeholder_group_id, user_id) WHERE (status = 'active')`

**Triggers:**

- `stakeholder_champion_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `stakeholder_champion_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `stakeholder_champion_guard()`
- `stakeholder_champion_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## adoption_metric_link

- **Purpose:** An indicator measure attached to an outcome, initiative, stakeholder group or the transformation; a KPI-fed measure names its KPI (REQ-S16-020 AdoptionMetricLink; ADR-0033 §3).
- **Migration:** `0047_p4_adoption.sql`. **API module:** `adoption`. **Who writes:** `adoption.edit` (TL, BO, WL). **Lifecycle:** active → removed (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| template_key | text | NOT NULL |  | FK → adoption_indicator_template(key) |
| kpi_definition_id | uuid | NULL |  |  |
| target_kind | text | NOT NULL |  | `CHECK ((target_kind = ANY (ARRAY['transformation', 'outcome', 'initiative', 'stakeholder_group'])))` |
| outcome_id | uuid | NULL |  |  |
| initiative_id | uuid | NULL |  |  |
| stakeholder_group_id | uuid | NULL |  |  |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'removed'])))` |
| removed_at | timestamp with time zone | NULL |  |  |
| removed_by | uuid | NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `adoption_metric_link_group_fkey` (FK): `FOREIGN KEY (transformation_id, stakeholder_group_id) REFERENCES stakeholder_group(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `adoption_metric_link_initiative_fkey` (FK): `FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `adoption_metric_link_kpi_fkey` (FK): `FOREIGN KEY (transformation_id, kpi_definition_id) REFERENCES kpi_definition(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `adoption_metric_link_outcome_fkey` (FK): `FOREIGN KEY (transformation_id, outcome_id) REFERENCES outcome(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `adoption_metric_link_removed_complete` (CHECK): `CHECK ((((status = 'removed') = (removed_at IS NOT NULL)) AND ((removed_at IS NULL) = (removed_by IS NULL))))`
- `adoption_metric_link_target` (CHECK): `CHECK ((((target_kind = 'outcome') = (outcome_id IS NOT NULL)) AND ((target_kind = 'initiative') = (initiative_id IS NOT NULL)) AND ((target_kind = 'stakeholder_group') = (stakeholder_group_id IS NOT NULL))))`
- `adoption_metric_link_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `adoption_metric_link_active_key`: `UNIQUE (transformation_id, template_key, target_kind, COALESCE(outcome_id, initiative_id, stakeholder_group_id, transformation_id)) WHERE (status = 'active')`
- `adoption_metric_link_kpi_idx`: `(kpi_definition_id) WHERE (kpi_definition_id IS NOT NULL)`

**Triggers:**

- `adoption_metric_link_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `adoption_metric_link_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `adoption_metric_link_guard()`
- `adoption_metric_link_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## adoption_intervention

- **Purpose:** An adoption intervention: planned by a person (comms, training, involvement, incentive) or created by the worker exactly once per indicator, scope and period below trajectory (REQ-PB-069, REQ-S11-001; REQ-S16-020 AdoptionIntervention; ADR-0033 §4).
- **Migration:** `0047_p4_adoption.sql`. **API module:** `adoption`. **Who writes:** `adoption.edit` (TL, BO, WL); the `adoption.indicator_evaluated` consumer (actor service). **Lifecycle:** planned → in_progress → done; planned → done; planned | in_progress → cancelled (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| code | text | NOT NULL |  | `CHECK ((code ~ '^AI-[0-9]{2,6}$'))` |
| stakeholder_group_id | uuid | NULL |  |  |
| intervention_type | text | NOT NULL |  | `CHECK ((intervention_type = ANY (ARRAY['comms', 'training', 'involvement', 'incentive', 'corrective'])))` |
| title | text | NOT NULL |  | `CHECK (((char_length(title) >= 1) AND (char_length(title) <= 500)))` |
| description | text | NULL |  | `CHECK (((description IS NULL) OR ((char_length(description) >= 1) AND (char_length(description) <= 8000))))` |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| due_date | date | NULL |  |  |
| status | text | NOT NULL | `'planned'` | `CHECK ((status = ANY (ARRAY['planned', 'in_progress', 'done', 'cancelled'])))` |
| origin | text | NOT NULL |  | `CHECK ((origin = ANY (ARRAY['manual', 'below_trajectory'])))` |
| metric_link_id | uuid | NULL |  |  |
| kpi_evaluation_id | uuid | NULL |  | FK → kpi_evaluation(id) |
| reporting_period_id | uuid | NULL |  | FK → reporting_period(id) |
| scope_kind | text | NULL |  | `CHECK (((scope_kind IS NULL) OR (scope_kind = ANY (ARRAY['transformation', 'business_unit', 'initiative']))))` |
| scope_id | uuid | NULL |  |  |
| trigger_key | text | NULL |  | `CHECK (((trigger_key IS NULL) OR ((char_length(trigger_key) >= 1) AND (char_length(trigger_key) <= 200))))` |
| outcome_note | text | NULL |  | `CHECK (((outcome_note IS NULL) OR ((char_length(outcome_note) >= 3) AND (char_length(outcome_note) <= 2000))))` |
| completed_at | timestamp with time zone | NULL |  |  |
| completed_by | uuid | NULL |  | FK → app_user(id) |
| created_source | text | NOT NULL |  | `CHECK ((created_source = ANY (ARRAY['api', 'worker'])))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `adoption_intervention_code_key` (UNIQUE): `UNIQUE (transformation_id, code)`
- `adoption_intervention_done_complete` (CHECK): `CHECK ((((status = 'done') = (completed_at IS NOT NULL)) AND ((completed_at IS NULL) = (completed_by IS NULL)) AND ((status <> ALL (ARRAY['done', 'cancelled'])) OR (outcome_note IS NOT NULL))))`
- `adoption_intervention_group_fkey` (FK): `FOREIGN KEY (transformation_id, stakeholder_group_id) REFERENCES stakeholder_group(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `adoption_intervention_link_fkey` (FK): `FOREIGN KEY (transformation_id, metric_link_id) REFERENCES adoption_metric_link(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `adoption_intervention_origin_shape` (CHECK): `CHECK ((((origin = 'manual') = (created_source = 'api')) AND ((origin <> 'manual') OR ((created_by IS NOT NULL) AND (updated_by IS NOT NULL) AND (owner_user_id IS NOT NULL) AND (due_date IS NOT NULL) AND (intervention_type <> 'corrective'))) AND ((origin <> 'below_trajectory') OR ((created_by IS NULL) AND (intervention_type = 'corrective') AND (metric_link_id IS NOT NULL) AND (kpi_evaluation_id IS NOT NULL) AND (reporting_period_id IS NOT NULL) AND (scope_kind IS NOT NULL) AND (scope_id IS NOT NULL) AND (trigger_key IS NOT NULL))) AND ((origin = 'below_trajectory') OR ((metric_link_id IS NULL) AND (kpi_evaluation_id IS NULL) AND (reporting_period_id IS NULL) AND (scope_kind IS NULL) AND (scope_id IS NULL) AND (trigger_key IS NULL)))))`
- `adoption_intervention_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `adoption_intervention_group_idx`: `(stakeholder_group_id) WHERE (stakeholder_group_id IS NOT NULL)`
- `adoption_intervention_owner_idx`: `(owner_user_id, due_date) WHERE (status = ANY (ARRAY['planned', 'in_progress']))`
- `adoption_intervention_trigger_key`: `UNIQUE (transformation_id, trigger_key) WHERE (trigger_key IS NOT NULL)`

**Triggers:**

- `adoption_intervention_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `adoption_intervention_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `adoption_intervention_guard()`
- `adoption_intervention_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## assessment_form

- **Purpose:** A short native feedback or proficiency-assessment form (REQ-S11-002; ADR-0033 §5).
- **Migration:** `0047_p4_adoption.sql`. **API module:** `adoption`. **Who writes:** `assessment_form.manage` (BO, WL). **Lifecycle:** draft → published → retired (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| kind | text | NOT NULL |  | `CHECK ((kind = ANY (ARRAY['feedback', 'proficiency_assessment'])))` |
| name | text | NOT NULL |  | `CHECK (((char_length(name) >= 1) AND (char_length(name) <= 200)))` |
| description | text | NULL |  | `CHECK (((description IS NULL) OR ((char_length(description) >= 1) AND (char_length(description) <= 2000))))` |
| stakeholder_group_id | uuid | NULL |  |  |
| status | text | NOT NULL | `'draft'` | `CHECK ((status = ANY (ARRAY['draft', 'published', 'retired'])))` |
| current_version_no | integer | NOT NULL | `0` | `CHECK ((current_version_no >= 0))` |
| published_version_no | integer | NULL |  | `CHECK (((published_version_no IS NULL) OR (published_version_no >= 1)))` |
| published_at | timestamp with time zone | NULL |  |  |
| published_by | uuid | NULL |  | FK → app_user(id) |
| retired_at | timestamp with time zone | NULL |  |  |
| retired_by | uuid | NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `assessment_form_group_fkey` (FK): `FOREIGN KEY (transformation_id, stakeholder_group_id) REFERENCES stakeholder_group(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `assessment_form_published_complete` (CHECK): `CHECK ((((status = 'draft') = (published_at IS NULL)) AND ((published_at IS NULL) = (published_by IS NULL)) AND ((published_at IS NULL) = (published_version_no IS NULL)) AND ((published_version_no IS NULL) OR (published_version_no <= current_version_no))))`
- `assessment_form_retired_complete` (CHECK): `CHECK ((((status = 'retired') = (retired_at IS NOT NULL)) AND ((retired_at IS NULL) = (retired_by IS NULL))))`
- `assessment_form_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Triggers:**

- `assessment_form_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `assessment_form_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `assessment_form_guard()`
- `assessment_form_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## assessment_form_version

- **Purpose:** The validated, versioned question set of a form (validated form JSON; ADR-0014; ADR-0033 §5).
- **Migration:** `0047_p4_adoption.sql`. **API module:** `adoption`. **Who writes:** `assessment_form.manage` (BO, WL). **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| form_id | uuid | NOT NULL |  |  |
| version_no | integer | NOT NULL |  | `CHECK ((version_no >= 1))` |
| schema | jsonb | NOT NULL |  |  |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `assessment_form_version_form_fkey` (FK): `FOREIGN KEY (transformation_id, form_id) REFERENCES assessment_form(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `assessment_form_version_no_key` (UNIQUE): `UNIQUE (form_id, version_no)`
- `assessment_form_version_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Triggers:**

- `assessment_form_version_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `assessment_form_version_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `assessment_form_version_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `assessment_form_version_guard`: BEFORE INSERT FOR EACH ROW → `assessment_form_version_guard()`
- `assessment_form_version_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## assessment_invitation

- **Purpose:** An invited respondent of a published form, for a stakeholder group and optionally an observed person (REQ-S11-002 respond:invited users; ADR-0033 §5).
- **Migration:** `0047_p4_adoption.sql`. **API module:** `adoption`. **Who writes:** `assessment_form.manage` (BO, WL); the response marks it responded. **Lifecycle:** open → responded | cancelled (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| form_id | uuid | NOT NULL |  |  |
| user_id | uuid | NOT NULL |  | FK → app_user(id) |
| stakeholder_group_id | uuid | NOT NULL |  |  |
| subject_user_id | uuid | NULL |  | FK → app_user(id) |
| due_date | date | NULL |  |  |
| status | text | NOT NULL | `'open'` | `CHECK ((status = ANY (ARRAY['open', 'responded', 'cancelled'])))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `assessment_invitation_form_fkey` (FK): `FOREIGN KEY (transformation_id, form_id) REFERENCES assessment_form(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `assessment_invitation_group_fkey` (FK): `FOREIGN KEY (transformation_id, stakeholder_group_id) REFERENCES stakeholder_group(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `assessment_invitation_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `assessment_invitation_open_key`: `UNIQUE (form_id, user_id, COALESCE(subject_user_id, user_id)) WHERE (status = 'open')`

**Triggers:**

- `assessment_invitation_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `assessment_invitation_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `assessment_invitation_guard()`
- `assessment_invitation_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## training_record

- **Purpose:** One participant's training attendance; completion is attendance, never adoption (REQ-PB-072; REQ-S16-020 Training/AssessmentRecord, training half; ADR-0033 §6).
- **Migration:** `0047_p4_adoption.sql`. **API module:** `adoption`. **Who writes:** `proficiency.record` (BO, WL). **Lifecycle:** enrolled → completed | no_show | withdrawn (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| stakeholder_group_id | uuid | NOT NULL |  |  |
| intervention_id | uuid | NULL |  |  |
| participant_user_id | uuid | NULL |  | FK → app_user(id) |
| participant_label | text | NULL |  | `CHECK (((participant_label IS NULL) OR ((char_length(participant_label) >= 1) AND (char_length(participant_label) <= 200))))` |
| training_title | text | NOT NULL |  | `CHECK (((char_length(training_title) >= 1) AND (char_length(training_title) <= 300)))` |
| scheduled_on | date | NULL |  |  |
| status | text | NOT NULL | `'enrolled'` | `CHECK ((status = ANY (ARRAY['enrolled', 'completed', 'no_show', 'withdrawn'])))` |
| completed_on | date | NULL |  |  |
| recorded_by | uuid | NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `training_record_completed_complete` (CHECK): `CHECK ((((status = 'completed') = (completed_on IS NOT NULL)) AND ((status = 'enrolled') = (recorded_by IS NULL))))`
- `training_record_group_fkey` (FK): `FOREIGN KEY (transformation_id, stakeholder_group_id) REFERENCES stakeholder_group(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `training_record_intervention_fkey` (FK): `FOREIGN KEY (transformation_id, intervention_id) REFERENCES adoption_intervention(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `training_record_participant` (CHECK): `CHECK (((participant_user_id IS NULL) <> (participant_label IS NULL)))`
- `training_record_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `training_record_group_idx`: `(stakeholder_group_id, status)`

**Triggers:**

- `training_record_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `training_record_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `training_record_guard()`
- `training_record_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## assessment_record

- **Purpose:** A submitted feedback response or proficiency observation, linked to its stakeholder group; observations count in the observed-proficiency measure until withdrawn (REQ-S11-002, REQ-PB-072; REQ-S16-020 Training/AssessmentRecord, assessment half; ADR-0033 §5, §6).
- **Migration:** `0047_p4_adoption.sql`. **API module:** `adoption`. **Who writes:** `assessment.respond` (the respondent); review `assessment.review` (BO). **Lifecycle:** submitted → reviewed | withdrawn; reviewed → withdrawn (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| form_id | uuid | NOT NULL |  |  |
| form_version_id | uuid | NOT NULL |  |  |
| invitation_id | uuid | NULL |  |  |
| stakeholder_group_id | uuid | NOT NULL |  |  |
| kind | text | NOT NULL |  | `CHECK ((kind = ANY (ARRAY['feedback', 'proficiency_observation'])))` |
| respondent_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| subject_user_id | uuid | NULL |  | FK → app_user(id) |
| subject_label | text | NULL |  | `CHECK (((subject_label IS NULL) OR ((char_length(subject_label) >= 1) AND (char_length(subject_label) <= 200))))` |
| observed_on | date | NOT NULL |  |  |
| answers | jsonb | NOT NULL |  | `CHECK ((jsonb_typeof(answers) = 'object'))` |
| proficiency_result | text | NULL |  | `CHECK (((proficiency_result IS NULL) OR (proficiency_result = ANY (ARRAY['proficient', 'not_yet_proficient']))))` |
| status | text | NOT NULL | `'submitted'` | `CHECK ((status = ANY (ARRAY['submitted', 'reviewed', 'withdrawn'])))` |
| reviewed_at | timestamp with time zone | NULL |  |  |
| reviewed_by | uuid | NULL |  | FK → app_user(id) |
| review_note | text | NULL |  | `CHECK (((review_note IS NULL) OR ((char_length(review_note) >= 1) AND (char_length(review_note) <= 2000))))` |
| withdrawn_at | timestamp with time zone | NULL |  |  |
| withdrawn_by | uuid | NULL |  | FK → app_user(id) |
| withdraw_reason | text | NULL |  | `CHECK (((withdraw_reason IS NULL) OR ((char_length(withdraw_reason) >= 3) AND (char_length(withdraw_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `assessment_record_form_fkey` (FK): `FOREIGN KEY (transformation_id, form_id) REFERENCES assessment_form(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `assessment_record_group_fkey` (FK): `FOREIGN KEY (transformation_id, stakeholder_group_id) REFERENCES stakeholder_group(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `assessment_record_invitation_fkey` (FK): `FOREIGN KEY (transformation_id, invitation_id) REFERENCES assessment_invitation(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `assessment_record_proficiency_shape` (CHECK): `CHECK ((((kind = 'proficiency_observation') = (proficiency_result IS NOT NULL)) AND ((kind = 'feedback') OR ((subject_user_id IS NULL) <> (subject_label IS NULL))) AND ((kind = 'proficiency_observation') OR ((subject_user_id IS NULL) AND (subject_label IS NULL)))))`
- `assessment_record_respondent_is_creator` (CHECK): `CHECK ((respondent_user_id = created_by))`
- `assessment_record_reviewed_complete` (CHECK): `CHECK ((((reviewed_at IS NULL) = (reviewed_by IS NULL)) AND ((status <> 'reviewed') OR (reviewed_at IS NOT NULL)) AND ((status <> 'submitted') OR (reviewed_at IS NULL))))`
- `assessment_record_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`
- `assessment_record_version_fkey` (FK): `FOREIGN KEY (transformation_id, form_version_id) REFERENCES assessment_form_version(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `assessment_record_withdrawn_complete` (CHECK): `CHECK ((((status = 'withdrawn') = (withdrawn_at IS NOT NULL)) AND ((withdrawn_at IS NULL) = (withdrawn_by IS NULL)) AND ((withdrawn_at IS NULL) = (withdraw_reason IS NULL))))`

**Indexes:**

- `assessment_record_group_idx`: `(stakeholder_group_id, kind, observed_on) WHERE (status <> 'withdrawn')`
- `assessment_record_invitation_key`: `UNIQUE (invitation_id) WHERE (invitation_id IS NOT NULL)`

**Triggers:**

- `assessment_record_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `assessment_record_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `assessment_record_guard()`
- `assessment_record_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## stakeholder_involvement

- **Purpose:** An impacted group's involvement in a design workshop or a T04 design decision; corrections are withdrawal rows (REQ-PB-073; ADR-0033 §7).
- **Migration:** `0047_p4_adoption.sql`. **API module:** `adoption`. **Who writes:** `adoption.edit` (TL, BO, WL). **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| stakeholder_group_id | uuid | NOT NULL |  |  |
| involvement_kind | text | NOT NULL |  | `CHECK ((involvement_kind = ANY (ARRAY['workshop', 'decision'])))` |
| workshop_id | uuid | NULL |  |  |
| decision_id | uuid | NULL |  |  |
| note | text | NULL |  | `CHECK (((note IS NULL) OR ((char_length(note) >= 1) AND (char_length(note) <= 2000))))` |
| withdraws_involvement_id | uuid | NULL |  |  |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `stakeholder_involvement_decision_fkey` (FK): `FOREIGN KEY (transformation_id, decision_id) REFERENCES decision(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `stakeholder_involvement_group_fkey` (FK): `FOREIGN KEY (transformation_id, stakeholder_group_id) REFERENCES stakeholder_group(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `stakeholder_involvement_target` (CHECK): `CHECK ((((involvement_kind = 'workshop') = (workshop_id IS NOT NULL)) AND ((involvement_kind = 'decision') = (decision_id IS NOT NULL))))`
- `stakeholder_involvement_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`
- `stakeholder_involvement_withdraws_fkey` (FK): `FOREIGN KEY (transformation_id, withdraws_involvement_id) REFERENCES stakeholder_involvement(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `stakeholder_involvement_workshop_fkey` (FK): `FOREIGN KEY (transformation_id, workshop_id) REFERENCES tom_workshop(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Indexes:**

- `stakeholder_involvement_withdraws_key`: `UNIQUE (withdraws_involvement_id) WHERE (withdraws_involvement_id IS NOT NULL)`

**Triggers:**

- `stakeholder_involvement_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `stakeholder_involvement_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `stakeholder_involvement_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `stakeholder_involvement_guard`: BEFORE INSERT FOR EACH ROW → `stakeholder_involvement_guard()`
- `stakeholder_involvement_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## champion_constraint

- **Purpose:** A constraint raised in person by an active champion on a T04 design decision, shown on that decision (REQ-PB-073; ADR-0033 §7).
- **Migration:** `0047_p4_adoption.sql`. **API module:** `adoption`. **Who writes:** `champion_constraint.raise` (BO, WL; the champion); address `decision.edit`; withdraw the champion. **Lifecycle:** open → addressed | withdrawn (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| champion_id | uuid | NOT NULL |  |  |
| stakeholder_group_id | uuid | NOT NULL |  |  |
| decision_id | uuid | NOT NULL |  |  |
| constraint_text | text | NOT NULL |  | `CHECK (((char_length(constraint_text) >= 3) AND (char_length(constraint_text) <= 4000)))` |
| status | text | NOT NULL | `'open'` | `CHECK ((status = ANY (ARRAY['open', 'addressed', 'withdrawn'])))` |
| response_text | text | NULL |  | `CHECK (((response_text IS NULL) OR ((char_length(response_text) >= 3) AND (char_length(response_text) <= 4000))))` |
| resolved_at | timestamp with time zone | NULL |  |  |
| resolved_by | uuid | NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `champion_constraint_champion_fkey` (FK): `FOREIGN KEY (transformation_id, champion_id) REFERENCES stakeholder_champion(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `champion_constraint_decision_fkey` (FK): `FOREIGN KEY (transformation_id, decision_id) REFERENCES decision(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `champion_constraint_group_fkey` (FK): `FOREIGN KEY (transformation_id, stakeholder_group_id) REFERENCES stakeholder_group(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `champion_constraint_resolved_complete` (CHECK): `CHECK ((((status = 'open') = (resolved_at IS NULL)) AND ((resolved_at IS NULL) = (resolved_by IS NULL)) AND ((status = 'addressed') = (response_text IS NOT NULL))))`
- `champion_constraint_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `champion_constraint_decision_idx`: `(decision_id, status)`

**Triggers:**

- `champion_constraint_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `champion_constraint_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `champion_constraint_guard()`
- `champion_constraint_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## performance_area

- **Purpose:** A performance area that continues after its origin transformation closes; BAU owner, KPI owner, review cadence and cycle (REQ-S03-002, REQ-S11-004, REQ-S11-009; ADR-0034 §4).
- **Migration:** `0048_p4_sustainment.sql`. **API module:** `sustainment`. **Who writes:** `performance_area.manage` (BO, TO); `performance_area.reopen` (BO, TL); handover acceptance; the review scan advances next_review_date. **Lifecycle:** establishing → bau → reopened → bau; any non-retired → retired (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| code | text | NOT NULL |  | `CHECK ((code ~ '^PA-[0-9]{2,6}$'))` |
| name | text | NOT NULL |  | `CHECK (((char_length(name) >= 1) AND (char_length(name) <= 200)))` |
| description | text | NULL |  | `CHECK (((description IS NULL) OR ((char_length(description) >= 1) AND (char_length(description) <= 4000))))` |
| business_unit_id | uuid | NULL |  | FK → business_unit(id) |
| sponsor_user_id | uuid | NULL |  | FK → app_user(id) |
| bau_owner_user_id | uuid | NULL |  | FK → app_user(id) |
| kpi_owner_user_id | uuid | NULL |  | FK → app_user(id) |
| review_frequency | text | NOT NULL | `'monthly'` |  |
| review_interval | smallint | NOT NULL | `1` | `CHECK (((review_interval >= 1) AND (review_interval <= 12)))` |
| next_review_date | date | NULL |  |  |
| cycle_no | integer | NOT NULL | `1` | `CHECK ((cycle_no >= 1))` |
| status | text | NOT NULL | `'establishing'` | `CHECK ((status = ANY (ARRAY['establishing', 'bau', 'reopened', 'retired'])))` |
| current_handover_id | uuid | NULL |  |  |
| retired_at | timestamp with time zone | NULL |  |  |
| retired_by | uuid | NULL |  | FK → app_user(id) |
| retire_reason | text | NULL |  | `CHECK (((retire_reason IS NULL) OR ((char_length(retire_reason) >= 3) AND (char_length(retire_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `performance_area_bau_complete` (CHECK): `CHECK (((status <> 'bau') OR ((bau_owner_user_id IS NOT NULL) AND (current_handover_id IS NOT NULL) AND (next_review_date IS NOT NULL))))`
- `performance_area_code_key` (UNIQUE): `UNIQUE (transformation_id, code)`
- `performance_area_current_handover_fkey` (FK): `FOREIGN KEY (transformation_id, current_handover_id) REFERENCES bau_handover(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `performance_area_retired_complete` (CHECK): `CHECK ((((status = 'retired') = (retired_at IS NOT NULL)) AND ((retired_at IS NULL) = (retired_by IS NULL)) AND ((retired_at IS NULL) = (retire_reason IS NULL))))`
- `performance_area_review_frequency_valid` (CHECK): `CHECK (p4_sustain_frequency_valid(review_frequency))`
- `performance_area_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `performance_area_org_idx`: `(organization_id, status, code)`
- `performance_area_review_due_idx`: `(next_review_date) WHERE (status = ANY (ARRAY['bau', 'reopened']))`

**Triggers:**

- `performance_area_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `performance_area_cycle_present`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `performance_area_cycle_present()`
- `performance_area_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `performance_area_guard()`
- `performance_area_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## performance_area_cycle

- **Purpose:** The append-only cycle history of an area: each reopening's reason and the prior accepted handover and closure, as they were (REQ-S11-009; ADR-0034 §4).
- **Migration:** `0048_p4_sustainment.sql`. **API module:** `sustainment`. **Who writes:** `performance_area.manage` (cycle 1, with the area); `performance_area.reopen`. **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| performance_area_id | uuid | NOT NULL |  |  |
| cycle_no | integer | NOT NULL |  | `CHECK ((cycle_no >= 1))` |
| opened_at | timestamp with time zone | NOT NULL | `now()` |  |
| opened_by | uuid | NOT NULL |  | FK → app_user(id) |
| reopen_reason | text | NULL |  | `CHECK (((reopen_reason IS NULL) OR ((char_length(reopen_reason) >= 3) AND (char_length(reopen_reason) <= 2000))))` |
| prior_handover_id | uuid | NULL |  |  |
| prior_handover_accepted_at | timestamp with time zone | NULL |  |  |
| prior_handover_accepted_by | uuid | NULL |  | FK → app_user(id) |
| prior_closure_record_id | uuid | NULL |  |  |
| prior_closed_at | timestamp with time zone | NULL |  |  |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `performance_area_cycle_area_fkey` (FK): `FOREIGN KEY (transformation_id, performance_area_id) REFERENCES performance_area(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `performance_area_cycle_first` (CHECK): `CHECK ((((cycle_no = 1) = (reopen_reason IS NULL)) AND ((cycle_no > 1) OR (prior_handover_id IS NULL)) AND ((cycle_no = 1) OR (prior_handover_id IS NOT NULL))))`
- `performance_area_cycle_no_key` (UNIQUE): `UNIQUE (performance_area_id, cycle_no)`
- `performance_area_cycle_prior_closure_fkey` (FK): `FOREIGN KEY (transformation_id, prior_closure_record_id) REFERENCES closure_record(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `performance_area_cycle_prior_handover_fkey` (FK): `FOREIGN KEY (transformation_id, prior_handover_id) REFERENCES bau_handover(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `performance_area_cycle_prior_stamps` (CHECK): `CHECK ((((prior_handover_id IS NULL) = (prior_handover_accepted_at IS NULL)) AND ((prior_handover_accepted_at IS NULL) = (prior_handover_accepted_by IS NULL)) AND ((prior_closure_record_id IS NULL) = (prior_closed_at IS NULL))))`
- `performance_area_cycle_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Triggers:**

- `performance_area_cycle_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `performance_area_cycle_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `performance_area_cycle_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `performance_area_cycle_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## performance_area_link

- **Purpose:** A KPI or benefit an area carries on after closure (REQ-S03-002; ADR-0034 §4).
- **Migration:** `0048_p4_sustainment.sql`. **API module:** `sustainment`. **Who writes:** `performance_area.manage` (BO, TO). **Lifecycle:** active → removed (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| performance_area_id | uuid | NOT NULL |  |  |
| link_kind | text | NOT NULL |  | `CHECK ((link_kind = ANY (ARRAY['kpi', 'benefit'])))` |
| kpi_definition_id | uuid | NULL |  |  |
| benefit_id | uuid | NULL |  |  |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'removed'])))` |
| removed_at | timestamp with time zone | NULL |  |  |
| removed_by | uuid | NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `performance_area_link_area_fkey` (FK): `FOREIGN KEY (transformation_id, performance_area_id) REFERENCES performance_area(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `performance_area_link_benefit_fkey` (FK): `FOREIGN KEY (transformation_id, benefit_id) REFERENCES benefit(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `performance_area_link_kpi_fkey` (FK): `FOREIGN KEY (transformation_id, kpi_definition_id) REFERENCES kpi_definition(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `performance_area_link_removed_complete` (CHECK): `CHECK ((((status = 'removed') = (removed_at IS NOT NULL)) AND ((removed_at IS NULL) = (removed_by IS NULL))))`
- `performance_area_link_target` (CHECK): `CHECK ((((link_kind = 'kpi') = (kpi_definition_id IS NOT NULL)) AND ((link_kind = 'benefit') = (benefit_id IS NOT NULL))))`
- `performance_area_link_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `performance_area_link_active_key`: `UNIQUE (performance_area_id, link_kind, COALESCE(kpi_definition_id, benefit_id)) WHERE (status = 'active')`

**Triggers:**

- `performance_area_link_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `performance_area_link_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `performance_area_link_guard()`
- `performance_area_link_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## control

- **Purpose:** A BAU control of a performance area and its check cadence (REQ-PB-083, REQ-S11-008; ADR-0034 §6).
- **Migration:** `0048_p4_sustainment.sql`. **API module:** `sustainment`. **Who writes:** `control.manage` (BO, TO); handover acceptance (owner); the check scan advances next_check_date. **Lifecycle:** active → retired (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| performance_area_id | uuid | NOT NULL |  |  |
| code | text | NOT NULL |  | `CHECK ((code ~ '^CTL-[0-9]{2,6}$'))` |
| name | text | NOT NULL |  | `CHECK (((char_length(name) >= 1) AND (char_length(name) <= 300)))` |
| description | text | NULL |  | `CHECK (((description IS NULL) OR ((char_length(description) >= 1) AND (char_length(description) <= 4000))))` |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| frequency | text | NOT NULL |  |  |
| frequency_interval | smallint | NOT NULL | `1` | `CHECK (((frequency_interval >= 1) AND (frequency_interval <= 12)))` |
| next_check_date | date | NULL |  |  |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'retired'])))` |
| retired_at | timestamp with time zone | NULL |  |  |
| retired_by | uuid | NULL |  | FK → app_user(id) |
| retire_reason | text | NULL |  | `CHECK (((retire_reason IS NULL) OR ((char_length(retire_reason) >= 3) AND (char_length(retire_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `control_area_fkey` (FK): `FOREIGN KEY (transformation_id, performance_area_id) REFERENCES performance_area(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `control_code_key` (UNIQUE): `UNIQUE (transformation_id, code)`
- `control_frequency_valid` (CHECK): `CHECK (p4_sustain_frequency_valid(frequency))`
- `control_retired_complete` (CHECK): `CHECK ((((status = 'retired') = (retired_at IS NOT NULL)) AND ((retired_at IS NULL) = (retired_by IS NULL)) AND ((retired_at IS NULL) = (retire_reason IS NULL))))`
- `control_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `control_area_idx`: `(performance_area_id, status)`
- `control_check_due_idx`: `(next_check_date) WHERE (status = 'active')`

**Triggers:**

- `control_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `control_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `control_guard()`
- `control_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## control_check

- **Purpose:** One periodic check of a control for one due date; a failed check emits control_check.failed (REQ-S11-008; ADR-0034 §6).
- **Migration:** `0048_p4_sustainment.sql`. **API module:** `sustainment`. **Who writes:** the `sustainment.control_check_scan` job (actor service); `control_check.record` (BO, TO). **Lifecycle:** due → passed | failed | cancelled (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| control_id | uuid | NOT NULL |  |  |
| performance_area_id | uuid | NOT NULL |  |  |
| due_date | date | NOT NULL |  |  |
| assignee_user_id | uuid | NULL |  | FK → app_user(id) |
| status | text | NOT NULL | `'due'` | `CHECK ((status = ANY (ARRAY['due', 'passed', 'failed', 'cancelled'])))` |
| performed_at | timestamp with time zone | NULL |  |  |
| performed_by | uuid | NULL |  | FK → app_user(id) |
| result_note | text | NULL |  | `CHECK (((result_note IS NULL) OR ((char_length(result_note) >= 3) AND (char_length(result_note) <= 4000))))` |
| created_source | text | NOT NULL |  | `CHECK ((created_source = ANY (ARRAY['api', 'worker'])))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `control_check_area_fkey` (FK): `FOREIGN KEY (transformation_id, performance_area_id) REFERENCES performance_area(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `control_check_control_fkey` (FK): `FOREIGN KEY (transformation_id, control_id) REFERENCES control(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `control_check_created_source` (CHECK): `CHECK (((created_source = 'api') = (created_by IS NOT NULL)))`
- `control_check_due_key` (UNIQUE): `UNIQUE (control_id, due_date)`
- `control_check_performed_complete` (CHECK): `CHECK ((((status = ANY (ARRAY['passed', 'failed'])) = (performed_at IS NOT NULL)) AND ((performed_at IS NULL) = (performed_by IS NULL)) AND ((status <> 'failed') OR (result_note IS NOT NULL))))`
- `control_check_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `control_check_open_idx`: `(assignee_user_id, due_date) WHERE (status = 'due')`

**Triggers:**

- `control_check_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `control_check_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `control_check_guard()`
- `control_check_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## bau_handover

- **Purpose:** The BAU handover of one area cycle with the M0217 content and receiving-owner acceptance (REQ-PB-083, REQ-S11-005; REQ-S16-021 BAUHandover; ADR-0034 §5).
- **Migration:** `0048_p4_sustainment.sql`. **API module:** `sustainment`. **Who writes:** `bau_handover.prepare` (WL, TL); accept / return `bau_handover.accept` (BO, the receiving owner only). **Lifecycle:** draft → submitted → accepted (final) | returned; returned → submitted.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| performance_area_id | uuid | NOT NULL |  |  |
| cycle_no | integer | NOT NULL |  | `CHECK ((cycle_no >= 1))` |
| code | text | NOT NULL |  | `CHECK ((code ~ '^HO-[0-9]{2,6}$'))` |
| receiving_owner_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| kpi_owner_user_id | uuid | NULL |  | FK → app_user(id) |
| operating_procedures | text | NULL |  | `CHECK (((operating_procedures IS NULL) OR ((char_length(operating_procedures) >= 1) AND (char_length(operating_procedures) <= 8000))))` |
| capability_readiness | text | NULL |  | `CHECK (((capability_readiness IS NULL) OR ((char_length(capability_readiness) >= 1) AND (char_length(capability_readiness) <= 8000))))` |
| unresolved_accepted_risks | text | NULL |  | `CHECK (((unresolved_accepted_risks IS NULL) OR ((char_length(unresolved_accepted_risks) >= 1) AND (char_length(unresolved_accepted_risks) <= 8000))))` |
| benefit_monitoring_cadence | text | NULL |  |  |
| data_access | text | NULL |  | `CHECK (((data_access IS NULL) OR ((char_length(data_access) >= 1) AND (char_length(data_access) <= 8000))))` |
| improvement_backlog_summary | text | NULL |  | `CHECK (((improvement_backlog_summary IS NULL) OR ((char_length(improvement_backlog_summary) >= 1) AND (char_length(improvement_backlog_summary) <= 8000))))` |
| status | text | NOT NULL | `'draft'` | `CHECK ((status = ANY (ARRAY['draft', 'submitted', 'accepted', 'returned'])))` |
| submitted_at | timestamp with time zone | NULL |  |  |
| submitted_by | uuid | NULL |  | FK → app_user(id) |
| accepted_at | timestamp with time zone | NULL |  |  |
| accepted_by | uuid | NULL |  | FK → app_user(id) |
| acceptance_note | text | NULL |  | `CHECK (((acceptance_note IS NULL) OR ((char_length(acceptance_note) >= 1) AND (char_length(acceptance_note) <= 2000))))` |
| returned_at | timestamp with time zone | NULL |  |  |
| returned_by | uuid | NULL |  | FK → app_user(id) |
| return_reason | text | NULL |  | `CHECK (((return_reason IS NULL) OR ((char_length(return_reason) >= 3) AND (char_length(return_reason) <= 2000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `bau_handover_accepted_complete` (CHECK): `CHECK ((((status = 'accepted') = (accepted_at IS NOT NULL)) AND ((accepted_at IS NULL) = (accepted_by IS NULL)) AND ((accepted_by IS NULL) OR (accepted_by = receiving_owner_user_id))))`
- `bau_handover_area_fkey` (FK): `FOREIGN KEY (transformation_id, performance_area_id) REFERENCES performance_area(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `bau_handover_cadence_valid` (CHECK): `CHECK (((benefit_monitoring_cadence IS NULL) OR p4_sustain_frequency_valid(benefit_monitoring_cadence)))`
- `bau_handover_code_key` (UNIQUE): `UNIQUE (transformation_id, code)`
- `bau_handover_content_complete` (CHECK): `CHECK (((status = 'draft') OR ((kpi_owner_user_id IS NOT NULL) AND (operating_procedures IS NOT NULL) AND (capability_readiness IS NOT NULL) AND (unresolved_accepted_risks IS NOT NULL) AND (benefit_monitoring_cadence IS NOT NULL) AND (data_access IS NOT NULL) AND (improvement_backlog_summary IS NOT NULL))))`
- `bau_handover_returned_stamps` (CHECK): `CHECK ((((returned_at IS NULL) = (returned_by IS NULL)) AND ((returned_at IS NULL) = (return_reason IS NULL)) AND ((status <> 'returned') OR (returned_at IS NOT NULL)) AND ((returned_by IS NULL) OR (returned_by = receiving_owner_user_id))))`
- `bau_handover_submitted_stamps` (CHECK): `CHECK ((((submitted_at IS NULL) = (submitted_by IS NULL)) AND ((status = 'draft') = (submitted_at IS NULL))))`
- `bau_handover_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `bau_handover_accepted_key`: `UNIQUE (performance_area_id, cycle_no) WHERE (status = 'accepted')`
- `bau_handover_open_key`: `UNIQUE (performance_area_id, cycle_no) WHERE (status = ANY (ARRAY['draft', 'submitted', 'returned']))`

**Triggers:**

- `bau_handover_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `bau_handover_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `bau_handover_guard()`
- `bau_handover_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## bau_handover_evidence

- **Purpose:** The evidence items of a handover (M0217 evidence; ADR-0034 §5).
- **Migration:** `0048_p4_sustainment.sql`. **API module:** `sustainment`. **Who writes:** `bau_handover.prepare` (WL, TL). **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| handover_id | uuid | NOT NULL |  |  |
| evidence_id | uuid | NOT NULL |  |  |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `bau_handover_evidence_evidence_fkey` (FK): `FOREIGN KEY (transformation_id, evidence_id) REFERENCES evidence(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `bau_handover_evidence_handover_fkey` (FK): `FOREIGN KEY (transformation_id, handover_id) REFERENCES bau_handover(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `bau_handover_evidence_key` (UNIQUE): `UNIQUE (handover_id, evidence_id)`

**Triggers:**

- `bau_handover_evidence_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `bau_handover_evidence_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `bau_handover_evidence_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `bau_handover_evidence_guard`: BEFORE INSERT FOR EACH ROW → `bau_handover_evidence_guard()`
- `bau_handover_evidence_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## transition_decision

- **Purpose:** A documented transition decision for a long-realization benefit: residual owner and scheduled monitoring; decided through the canonical approval; writes no benefit value (REQ-S11-007; ADR-0034 §3).
- **Migration:** `0048_p4_sustainment.sql`. **API module:** `sustainment`. **Who writes:** `transition_decision.propose` (BO, FIN); the approval provider (approve, reject, changes requested); the review scan advances next_monitoring_date. **Lifecycle:** draft → submitted → approved | rejected; submitted → draft; draft | submitted → withdrawn (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| code | text | NOT NULL |  | `CHECK ((code ~ '^TD-[0-9]{2,6}$'))` |
| benefit_id | uuid | NOT NULL |  |  |
| residual_owner_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| rationale | text | NOT NULL |  | `CHECK (((char_length(rationale) >= 3) AND (char_length(rationale) <= 4000)))` |
| expected_realization_end | date | NOT NULL |  |  |
| monitoring_frequency | text | NOT NULL |  |  |
| monitoring_interval | smallint | NOT NULL | `1` | `CHECK (((monitoring_interval >= 1) AND (monitoring_interval <= 12)))` |
| first_monitoring_date | date | NOT NULL |  |  |
| next_monitoring_date | date | NULL |  |  |
| status | text | NOT NULL | `'draft'` | `CHECK ((status = ANY (ARRAY['draft', 'submitted', 'approved', 'rejected', 'withdrawn'])))` |
| approval_id | uuid | NULL |  | FK → approval(id) |
| decided_at | timestamp with time zone | NULL |  |  |
| decided_by | uuid | NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `transition_decision_benefit_fkey` (FK): `FOREIGN KEY (transformation_id, benefit_id) REFERENCES benefit(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `transition_decision_code_key` (UNIQUE): `UNIQUE (transformation_id, code)`
- `transition_decision_decided_complete` (CHECK): `CHECK ((((status = ANY (ARRAY['approved', 'rejected'])) = (decided_at IS NOT NULL)) AND ((decided_at IS NULL) = (decided_by IS NULL)) AND ((status <> ALL (ARRAY['submitted', 'approved', 'rejected'])) OR (approval_id IS NOT NULL))))`
- `transition_decision_frequency_valid` (CHECK): `CHECK (p4_sustain_frequency_valid(monitoring_frequency))`
- `transition_decision_monitoring_dates` (CHECK): `CHECK (((first_monitoring_date <= expected_realization_end) AND ((status <> 'approved') OR (next_monitoring_date IS NOT NULL))))`
- `transition_decision_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `transition_decision_live_key`: `UNIQUE (benefit_id) WHERE (status = ANY (ARRAY['draft', 'submitted', 'approved']))`
- `transition_decision_monitoring_idx`: `(next_monitoring_date) WHERE (status = 'approved')`

**Triggers:**

- `transition_decision_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `transition_decision_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `transition_decision_guard()`
- `transition_decision_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## sustainment_review

- **Purpose:** One recurring review task: a performance-area review in BAU, or a benefit-monitoring review for a transition decision's residual owner; once per subject and due date (REQ-PB-083, REQ-S11-004, REQ-S11-007; ADR-0034 §5, §6).
- **Migration:** `0048_p4_sustainment.sql`. **API module:** `sustainment`. **Who writes:** handover acceptance (first review); the `sustainment.review_scan` job (actor service); `sustainment_review.complete` (the assignee). **Lifecycle:** due → done | cancelled (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| subject_kind | text | NOT NULL |  | `CHECK ((subject_kind = ANY (ARRAY['performance_area', 'transition_decision'])))` |
| performance_area_id | uuid | NULL |  |  |
| cycle_no | integer | NULL |  | `CHECK (((cycle_no IS NULL) OR (cycle_no >= 1)))` |
| transition_decision_id | uuid | NULL |  |  |
| due_date | date | NOT NULL |  |  |
| assignee_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| status | text | NOT NULL | `'due'` | `CHECK ((status = ANY (ARRAY['due', 'done', 'cancelled'])))` |
| completed_at | timestamp with time zone | NULL |  |  |
| completed_by | uuid | NULL |  | FK → app_user(id) |
| outcome_note | text | NULL |  | `CHECK (((outcome_note IS NULL) OR ((char_length(outcome_note) >= 3) AND (char_length(outcome_note) <= 4000))))` |
| performance_signal | text | NULL |  | `CHECK (((performance_signal IS NULL) OR (performance_signal = ANY (ARRAY['on_track', 'deteriorating', 'unknown']))))` |
| created_source | text | NOT NULL |  | `CHECK ((created_source = ANY (ARRAY['api', 'worker'])))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `sustainment_review_area_fkey` (FK): `FOREIGN KEY (transformation_id, performance_area_id) REFERENCES performance_area(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `sustainment_review_created_source` (CHECK): `CHECK (((created_source = 'api') = (created_by IS NOT NULL)))`
- `sustainment_review_decision_fkey` (FK): `FOREIGN KEY (transformation_id, transition_decision_id) REFERENCES transition_decision(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `sustainment_review_done_complete` (CHECK): `CHECK ((((status = 'done') = (completed_at IS NOT NULL)) AND ((completed_at IS NULL) = (completed_by IS NULL)) AND ((status <> 'done') OR ((outcome_note IS NOT NULL) AND (performance_signal IS NOT NULL)))))`
- `sustainment_review_subject` (CHECK): `CHECK ((((subject_kind = 'performance_area') = (performance_area_id IS NOT NULL)) AND ((performance_area_id IS NULL) = (cycle_no IS NULL)) AND ((subject_kind = 'transition_decision') = (transition_decision_id IS NOT NULL))))`
- `sustainment_review_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `sustainment_review_assignee_idx`: `(assignee_user_id, due_date) WHERE (status = 'due')`
- `sustainment_review_due_key`: `UNIQUE (subject_kind, COALESCE(performance_area_id, transition_decision_id), due_date)`

**Triggers:**

- `sustainment_review_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `sustainment_review_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `sustainment_review_guard()`
- `sustainment_review_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## lesson

- **Purpose:** A lesson; published lessons are searchable across the organization's transformations in the caller's scope (REQ-S11-008; REQ-S16-021 Lesson; ADR-0034 §8).
- **Migration:** `0048_p4_sustainment.sql`. **API module:** `sustainment`. **Who writes:** `lesson.edit` (BO, TO). **Lifecycle:** draft → published → archived; draft → archived (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| code | text | NOT NULL |  | `CHECK ((code ~ '^LL-[0-9]{2,6}$'))` |
| performance_area_id | uuid | NULL |  |  |
| title | text | NOT NULL |  | `CHECK (((char_length(title) >= 1) AND (char_length(title) <= 300)))` |
| context | text | NULL |  | `CHECK (((context IS NULL) OR ((char_length(context) >= 1) AND (char_length(context) <= 4000))))` |
| lesson_text | text | NOT NULL |  | `CHECK (((char_length(lesson_text) >= 3) AND (char_length(lesson_text) <= 8000)))` |
| recommendation | text | NULL |  | `CHECK (((recommendation IS NULL) OR ((char_length(recommendation) >= 1) AND (char_length(recommendation) <= 4000))))` |
| tags | text[] | NOT NULL | `'{}'[]` |  |
| status | text | NOT NULL | `'draft'` | `CHECK ((status = ANY (ARRAY['draft', 'published', 'archived'])))` |
| published_at | timestamp with time zone | NULL |  |  |
| published_by | uuid | NULL |  | FK → app_user(id) |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| search_document | tsvector | NULL | `p4_lesson_document(title, context, lesson_text, recommendation, tags)` |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `lesson_archived_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL))))`
- `lesson_area_fkey` (FK): `FOREIGN KEY (transformation_id, performance_area_id) REFERENCES performance_area(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `lesson_code_key` (UNIQUE): `UNIQUE (transformation_id, code)`
- `lesson_published_complete` (CHECK): `CHECK ((((status = 'draft') = (published_at IS NULL)) AND ((published_at IS NULL) = (published_by IS NULL))))`
- `lesson_tags_valid` (CHECK): `CHECK (((cardinality(tags) <= 10) AND p4_tags_valid(tags)))`
- `lesson_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `lesson_org_published_idx`: `(organization_id, published_at DESC, id DESC) WHERE (status = 'published')`
- `lesson_search_idx`: `CREATE INDEX lesson_search_idx ON public.lesson USING gin (search_document) WHERE (status = 'published')`

**Triggers:**

- `lesson_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `lesson_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `lesson_guard()`
- `lesson_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## improvement_item

- **Purpose:** A continuous-improvement backlog item with its source; persists after closure (REQ-PB-084, REQ-S11-008; REQ-S16-021 ImprovementItem; ADR-0034 §8).
- **Migration:** `0048_p4_sustainment.sql`. **API module:** `sustainment`. **Who writes:** `improvement.edit` (BO, TO). **Lifecycle:** open ⇄ in_progress → done | rejected (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| code | text | NOT NULL |  | `CHECK ((code ~ '^CI-[0-9]{2,6}$'))` |
| performance_area_id | uuid | NULL |  |  |
| title | text | NOT NULL |  | `CHECK (((char_length(title) >= 1) AND (char_length(title) <= 300)))` |
| description | text | NULL |  | `CHECK (((description IS NULL) OR ((char_length(description) >= 1) AND (char_length(description) <= 8000))))` |
| source_kind | text | NOT NULL |  | `CHECK ((source_kind = ANY (ARRAY['manual', 'lesson', 'control_check', 'review', 'handover'])))` |
| lesson_id | uuid | NULL |  |  |
| control_check_id | uuid | NULL |  |  |
| review_id | uuid | NULL |  |  |
| handover_id | uuid | NULL |  |  |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| priority | text | NULL |  | `CHECK (((priority IS NULL) OR (priority = ANY (ARRAY['H', 'M', 'L']))))` |
| target_date | date | NULL |  |  |
| status | text | NOT NULL | `'open'` | `CHECK ((status = ANY (ARRAY['open', 'in_progress', 'done', 'rejected'])))` |
| resolution_note | text | NULL |  | `CHECK (((resolution_note IS NULL) OR ((char_length(resolution_note) >= 3) AND (char_length(resolution_note) <= 2000))))` |
| resolved_at | timestamp with time zone | NULL |  |  |
| resolved_by | uuid | NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `improvement_item_area_fkey` (FK): `FOREIGN KEY (transformation_id, performance_area_id) REFERENCES performance_area(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `improvement_item_check_fkey` (FK): `FOREIGN KEY (transformation_id, control_check_id) REFERENCES control_check(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `improvement_item_code_key` (UNIQUE): `UNIQUE (transformation_id, code)`
- `improvement_item_handover_fkey` (FK): `FOREIGN KEY (transformation_id, handover_id) REFERENCES bau_handover(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `improvement_item_lesson_fkey` (FK): `FOREIGN KEY (transformation_id, lesson_id) REFERENCES lesson(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `improvement_item_resolved_complete` (CHECK): `CHECK ((((status = ANY (ARRAY['done', 'rejected'])) = (resolved_at IS NOT NULL)) AND ((resolved_at IS NULL) = (resolved_by IS NULL)) AND ((resolved_at IS NULL) = (resolution_note IS NULL))))`
- `improvement_item_review_fkey` (FK): `FOREIGN KEY (transformation_id, review_id) REFERENCES sustainment_review(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `improvement_item_source_fields` (CHECK): `CHECK ((((source_kind = 'lesson') = (lesson_id IS NOT NULL)) AND ((source_kind = 'control_check') = (control_check_id IS NOT NULL)) AND ((source_kind = 'review') = (review_id IS NOT NULL)) AND ((source_kind = 'handover') = (handover_id IS NOT NULL))))`
- `improvement_item_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `improvement_item_area_idx`: `(performance_area_id, status) WHERE (performance_area_id IS NOT NULL)`
- `improvement_item_transformation_idx`: `(transformation_id, status, code)`

**Triggers:**

- `improvement_item_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `improvement_item_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `improvement_item_guard()`
- `improvement_item_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## closure_record

- **Purpose:** The governed closure of an initiative or a transformation with the basis checked (validated value and/or transition decisions; G6 for a transformation) (REQ-PB-009, REQ-S03-003; ADR-0034 §7).
- **Migration:** `0048_p4_sustainment.sql`. **API module:** `sustainment`. **Who writes:** `initiative.close`, `transformation.close` (TL). **Lifecycle:** append-only; one per subject.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| subject_kind | text | NOT NULL |  | `CHECK ((subject_kind = ANY (ARRAY['initiative', 'transformation'])))` |
| initiative_id | uuid | NULL |  |  |
| basis | text | NOT NULL |  | `CHECK ((basis = ANY (ARRAY['validated_value', 'transition_decision', 'validated_value_and_transition_decision'])))` |
| snapshot | jsonb | NOT NULL |  | `CHECK ((jsonb_typeof(snapshot) = 'object'))` |
| closure_note | text | NULL |  | `CHECK (((closure_note IS NULL) OR ((char_length(closure_note) >= 3) AND (char_length(closure_note) <= 2000))))` |
| closed_at | timestamp with time zone | NOT NULL | `now()` |  |
| closed_by | uuid | NOT NULL |  | FK → app_user(id) |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `closure_record_closer_is_creator` (CHECK): `CHECK ((closed_by = created_by))`
- `closure_record_initiative_fkey` (FK): `FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `closure_record_subject` (CHECK): `CHECK (((subject_kind = 'initiative') = (initiative_id IS NOT NULL)))`
- `closure_record_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `closure_record_initiative_key`: `UNIQUE (initiative_id) WHERE (subject_kind = 'initiative')`
- `closure_record_transformation_key`: `UNIQUE (transformation_id) WHERE (subject_kind = 'transformation')`

**Triggers:**

- `closure_record_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `closure_record_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `closure_record_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `closure_record_guard`: BEFORE INSERT FOR EACH ROW → `closure_record_guard()`
- `closure_record_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## P4 seeds (0047, 0049, 0050, slices F and G)

- `adoption_indicator_template`: 8 measure rows for the seven B0109–B0115 indicators, verbatim English indicator names, Arabic marked provisional (`ar_provisional = true`).
- `approval_type` `benefit_transition_decision` (subject `transition_decision`, SoD `requester_excluded`, owner module `sustainment`, M0218).
- `work_item_kind` `adoption_intervention_due` (M0215), `assessment_invitation` (M0215), `assessment_to_review` (M0215) — owner module `adoption`; `bau_handover_to_accept` (M0217), `performance_review_due` (M0217), `benefit_monitoring_due` (M0218), `control_check_due` (M0219) — owner module `sustainment` (label_ar provisional wording).
- `permission` (21 rows: 19 write, `bau_handover.accept` business_approval, `lesson.search` read) and `role_permission` (56 rows): exactly `P4_ADOPTION_SUSTAINMENT_PERMISSIONS` / `P4_ADOPTION_SUSTAINMENT_ROLE_PERMISSIONS` in `packages/shared/src/permissions.ts` (`packages/db/src/seed.test.ts`). No technical-admin role holds any; AUD holds only `lesson.search`; `bau_handover.accept` is held by BO only.
- No stakeholder group, intervention, form, area, handover, control, review, lesson, CI item, transition decision or closure is seeded. The recurring-job schedules (`sustainment.review_scan`, daily 00:20, and `sustainment.control_check_scan`, daily 00:25, both `Asia/Riyadh`) are seeded by `0050_p4_sustainment_schedules.sql`, audited `system`; the worker reports them `unhandled` and schedules nothing until BE-I2 registers the handlers.

## P4 functions (slices F and G)

| Function | Migration | Purpose | Callable by `mth_app` |
|---|---|---|---|
| `p4_text_array_distinct(text[])` | 0047 | no repeated element (a CHECK cannot hold a subquery) | via CHECK |
| `p4_assessment_form_schema_valid(text, jsonb)` | 0047 | the validated form JSON of ADR-0033 §5 | via trigger |
| `stakeholder_group_guard()`, `stakeholder_champion_guard()`, `adoption_metric_link_guard()`, `adoption_intervention_guard()`, `assessment_form_guard()`, `assessment_form_version_guard()`, `assessment_invitation_guard()`, `training_record_guard()`, `assessment_record_guard()`, `stakeholder_involvement_guard()`, `champion_constraint_guard()` | 0047 | starting states, legal transitions, final states, immutable identity and source fields, the cross-row rules of ADR-0033 | via trigger |
| `p4_sustain_frequency_valid(text)` | 0048 | the recurrence vocabulary (weekly, monthly, quarterly, semi_annual, annual) | via CHECK |
| `p4_tags_valid(text[])` | 0048 | lesson tags: distinct, 1–50 characters | via CHECK |
| `p4_lesson_document(text, text, text, text, text[])` | 0048 | the lesson search document (`simple` tsvector), IMMUTABLE for the stored generated column | via generated column |
| `initiative_delivery_complete_guard()`, `transformation_closure_guard()` | 0048 | delivery stamps with `completed`; `closed` needs a closure record | via trigger |
| `performance_area_guard()`, `performance_area_cycle_present()` (deferred), `performance_area_link_guard()`, `control_guard()`, `control_check_guard()`, `bau_handover_guard()`, `bau_handover_evidence_guard()`, `transition_decision_guard()`, `sustainment_review_guard()`, `lesson_guard()`, `improvement_item_guard()`, `closure_record_guard()` | 0048 | starting states, legal transitions, final states, the M0217 submission content, receiving-owner acceptance, the cycle history, the closure preconditions of ADR-0034 | via trigger / constraint trigger |

## P4 validation rules summary (slices F and G)

| Layer | What it checks |
|---|---|
| Database | The P2 record guards (version step, identity, organization = transformation's, deferred audit coverage; append-only form versions, involvement, area cycles, handover evidence and closure records); closed sets (H/M/L, stances, intervention types, statuses, kinds, frequencies, signals, bases); a T13 stance of 'hostile' refused; one intervention per indicator, scope and period below trajectory; validated form JSON; responses only to the published version of a published form; proficiency result exactly for observations; constraints raised only by the champion on a design decision; the cycle row of every area cycle; BAU only with the current cycle's accepted handover; the M0217 content, a control and evidence before submission; acceptance only by the receiving owner; accepted handovers final; one review per subject and due date; one check per control and due date; one live transition decision per benefit; one closure per subject; G6 approved for a transformation closure; `closed` only with a closure record |
| API (`@mth/shared/schemas`) | Shapes (OpenAPI slice F and G schemas), the form schema and answers, free-text rules, strict UTF-8, request media types, `If-Match` |
| Service | Permissions and record-level rules (ADR-0033 §9, ADR-0034 §9: invitation or assessor; the champion; the receiving owner; the review assignee), commit-time re-authorization, the exact refusal codes and English texts (ADR-0033 §10, ADR-0034 §12), the value-status and closure checks, ownership transfer on acceptance, the record-fed measures with Unknown |
| Worker | `adoption.indicator_evaluated` (below trajectory → one intervention, lock 730242, `adoption.check_failed`); `sustainment.review_scan` and `sustainment.control_check_scan` (once per due date; `control_check.failed` from `recordControlCheck`) |

# P4 tables, slice H (migrations 0051–0054, DG4)

Slice H of `docs/architecture/p4-plan.md` (T-DG4-ARCH-07; ADR-0035 phases, G5/G6, criterion reviews, exceptions, scale scope, risk dispositions; ADR-0036 change control). The per-table sections below are generated from the catalogue of a freshly migrated database by `docs/delivery/handbacks/DG4/T-DG4-ARCH-07-evidence/gen-dictionary.ts`, so they match `0051` and `0052` exactly. Every mutable table carries the P2 guards (`p2_attach_guards`: version starts at 1 and steps by 1, identity immutable, organization = the transformation's, deferred audit coverage); append-only tables also carry `p2_attach_append_only`. G1–G6 are business approvals inside the product; nothing here touches DG0–DG7.

## Changes to existing tables (slice H)

- `gate_submission_criterion` (DG2 `0017`; D-089 Q2 reopen): new column `gate_exception_id uuid NULL` (FK `(transformation_id, gate_exception_id)` → `gate_exception (transformation_id, id)`); CHECK `gate_submission_criterion_mandatory_complete` replaced by `NOT mandatory OR completeness = 'complete' OR gate_exception_id IS NOT NULL`; new CHECK `gate_submission_criterion_exception_only_incomplete` (`gate_exception_id IS NULL OR (mandatory AND completeness = 'incomplete')`); new BEFORE INSERT trigger `gate_submission_criterion_exception_valid` (the exception is accepted, of the same gate instance and criterion, and `expires_on` ≥ the submission's business date in the transformation's timezone). Existing rows keep their values (`gate_exception_id` NULL).
- `gate_criterion_definition` (seed): 8 rows `g5.performance_evidence`, `g5.adoption`, `g5.risk_closure`, `g5.decision_log`, `g6.benefits_evidence`, `g6.ownership_transfer`, `g6.controls`, `g6.improvement_backlog` (labels verbatim from B0023; all mandatory). G1–G4 rows unchanged; G5/G6 stay `submission_enabled = false` (enabled by BE-K's migration).
- `record_code_counter`: the prefix CHECK gains `CR` (change requests, `CR-nn`); every earlier prefix stays.

## phase_definition

- **Purpose:** The six phases with name, title, purpose and key outputs (B0021, verbatim) and the phase objective (B0027, B0046, B0054, B0068, B0091, B0119), provisional Arabic (REQ-PB-014; ADR-0035 §1).
- **Migration:** `0051_p4_phases_gates_g5_g6_exceptions.sql`. **API module:** `workflows`. **Who writes:** none (seed, read-only). **Lifecycle:** seed.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| code | text | NOT NULL |  | `CHECK ((code = ANY (ARRAY['diagnose', 'define', 'design', 'mobilize', 'transform', 'realize'])))` |
| methodology_version_id | uuid | NOT NULL |  | FK → methodology_version(id) |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 6)))` |
| gate_code | text | NOT NULL |  | FK → gate_definition(code) |
| source_name_en | text | NOT NULL |  | `CHECK (((char_length(source_name_en) >= 1) AND (char_length(source_name_en) <= 50)))` |
| name_ar | text | NOT NULL |  | `CHECK (((char_length(name_ar) >= 1) AND (char_length(name_ar) <= 100)))` |
| source_title_en | text | NOT NULL |  | `CHECK (((char_length(source_title_en) >= 1) AND (char_length(source_title_en) <= 200)))` |
| title_ar | text | NOT NULL |  | `CHECK (((char_length(title_ar) >= 1) AND (char_length(title_ar) <= 200)))` |
| source_purpose_en | text | NOT NULL |  | `CHECK (((char_length(source_purpose_en) >= 1) AND (char_length(source_purpose_en) <= 200)))` |
| purpose_ar | text | NOT NULL |  | `CHECK (((char_length(purpose_ar) >= 1) AND (char_length(purpose_ar) <= 200)))` |
| source_key_outputs_en | text | NOT NULL |  | `CHECK (((char_length(source_key_outputs_en) >= 1) AND (char_length(source_key_outputs_en) <= 500)))` |
| key_outputs_ar | text | NOT NULL |  | `CHECK (((char_length(key_outputs_ar) >= 1) AND (char_length(key_outputs_ar) <= 500)))` |
| source_objective_en | text | NOT NULL |  | `CHECK (((char_length(source_objective_en) >= 1) AND (char_length(source_objective_en) <= 1000)))` |
| objective_ar | text | NOT NULL |  | `CHECK (((char_length(objective_ar) >= 1) AND (char_length(objective_ar) <= 1000)))` |
| source_ref | text | NOT NULL |  | `CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 100)))` |
| ar_provisional | boolean | NOT NULL | `true` |  |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `phase_definition_code_key` (UNIQUE): `UNIQUE (code)`
- `phase_definition_gate_code_key` (UNIQUE): `UNIQUE (gate_code)`
- `phase_definition_ordinal_key` (UNIQUE): `UNIQUE (ordinal)`

## phase_step_definition

- **Purpose:** The guided procedure of each phase: one verbatim M0118-M0123 procedure clause per step, required evidence, default owner and reviewer roles and the completion rule (architect interpretation) (REQ-S04-001; ADR-0035 §1).
- **Migration:** `0051_p4_phases_gates_g5_g6_exceptions.sql`. **API module:** `workflows`. **Who writes:** none (seed, read-only). **Lifecycle:** seed.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| key | text | NOT NULL |  | `CHECK ((key ~ '^(diagnose|define|design|mobilize|transform|realize)\.[a-z_]{1,48}$'))` |
| phase_code | text | NOT NULL |  | FK → phase_definition(code) |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 10)))` |
| source_procedure_en | text | NOT NULL |  | `CHECK (((char_length(source_procedure_en) >= 1) AND (char_length(source_procedure_en) <= 500)))` |
| procedure_ar | text | NOT NULL |  | `CHECK (((char_length(procedure_ar) >= 1) AND (char_length(procedure_ar) <= 500)))` |
| required_evidence_en | text | NOT NULL |  | `CHECK (((char_length(required_evidence_en) >= 1) AND (char_length(required_evidence_en) <= 500)))` |
| required_evidence_ar | text | NOT NULL |  | `CHECK (((char_length(required_evidence_ar) >= 1) AND (char_length(required_evidence_ar) <= 500)))` |
| default_owner_role_code | text | NOT NULL |  | FK → role(code) |
| reviewer_role_code | text | NOT NULL |  | FK → role(code) |
| completion_rule | text | NOT NULL |  | `CHECK ((completion_rule = ANY (ARRAY['evidence_linked', 'meeting_held', 'kpi_actual_accepted', 'raid_register_present', 'benefit_validated', 'corrective_cases_owned', 'handover_accepted', 'improvement_backlog_present'])))` |
| source_ref | text | NOT NULL |  | `CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 50)))` |
| ar_provisional | boolean | NOT NULL | `true` |  |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `phase_step_definition_key_key` (UNIQUE): `UNIQUE (key)`
- `phase_step_definition_key_phase_key` (UNIQUE): `UNIQUE (key, phase_code)`
- `phase_step_definition_key_prefix` (CHECK): `CHECK ((split_part(key, '.', 1) = phase_code))`
- `phase_step_definition_ordinal_key` (UNIQUE): `UNIQUE (phase_code, ordinal)`
- `phase_step_definition_reviewer_not_owner_role` (CHECK): `CHECK ((reviewer_role_code <> default_owner_role_code))`

## phase_step

- **Purpose:** One transformation's progress on one phase step: named owner, status, frozen completion check, separate reviewer (REQ-S04-001; ADR-0035 §1). No row = not started, owner Unknown.
- **Migration:** `0051_p4_phases_gates_g5_g6_exceptions.sql`. **API module:** `workflows`. **Who writes:** `phase_step.manage` (TL, TO); `phase_step.progress` (the owner); `phase_step.review` (SP, BO, FIN, TO; not the owner); the `gate.decided` consumer (actor service) enables the next phase's steps. **Lifecycle:** not_started → in_progress → in_review → complete (final) | returned; returned → in_progress | in_review.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| step_key | text | NOT NULL |  |  |
| phase_code | text | NOT NULL |  |  |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| status | text | NOT NULL | `'not_started'` | `CHECK ((status = ANY (ARRAY['not_started', 'in_progress', 'in_review', 'complete', 'returned'])))` |
| enabled_by_gate_decision_id | uuid | NULL |  | FK → gate_decision(id) |
| review_requested_by | uuid | NULL |  | FK → app_user(id) |
| review_requested_at | timestamp with time zone | NULL |  |  |
| completion_check | jsonb | NULL |  | `CHECK (((completion_check IS NULL) OR (jsonb_typeof(completion_check) = 'object')))` |
| reviewed_by | uuid | NULL |  | FK → app_user(id) |
| reviewed_at | timestamp with time zone | NULL |  |  |
| review_outcome | text | NULL |  | `CHECK (((review_outcome IS NULL) OR (review_outcome = ANY (ARRAY['accepted', 'returned']))))` |
| review_note | text | NULL |  | `CHECK (((review_note IS NULL) OR ((char_length(review_note) >= 1) AND (char_length(review_note) <= 2000))))` |
| completed_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `phase_step_complete_shape` (CHECK): `CHECK ((((status = 'complete') = (completed_at IS NOT NULL)) AND ((status <> 'complete') OR ((review_outcome = 'accepted') AND ((completion_check ->> 'met') = 'true') AND (owner_user_id IS NOT NULL)))))`
- `phase_step_definition_fkey` (FK): `FOREIGN KEY (step_key, phase_code) REFERENCES phase_step_definition(key, phase_code) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `phase_step_in_review_checked` (CHECK): `CHECK (((status <> 'in_review') OR ((review_requested_at IS NOT NULL) AND (completion_check IS NOT NULL) AND ((completion_check ->> 'met') = 'true'))))`
- `phase_step_key` (UNIQUE): `UNIQUE (transformation_id, step_key)`
- `phase_step_returned_note` (CHECK): `CHECK (((status <> 'returned') OR ((review_outcome = 'returned') AND (review_note IS NOT NULL))))`
- `phase_step_review_requested_complete` (CHECK): `CHECK (((review_requested_at IS NULL) = (review_requested_by IS NULL)))`
- `phase_step_reviewed_complete` (CHECK): `CHECK ((((reviewed_at IS NULL) = (reviewed_by IS NULL)) AND ((reviewed_at IS NULL) = (review_outcome IS NULL))))`
- `phase_step_reviewer_separate` (CHECK): `CHECK (((reviewed_by IS NULL) OR ((reviewed_by IS DISTINCT FROM owner_user_id) AND (reviewed_by IS DISTINCT FROM review_requested_by))))`
- `phase_step_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `phase_step_owner_idx`: `(owner_user_id) WHERE (status = ANY (ARRAY['not_started', 'in_progress', 'returned']))`
- `phase_step_review_queue_idx`: `(transformation_id, review_requested_at) WHERE (status = 'in_review')`

**Triggers:**

- `phase_step_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `phase_step_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`
- `phase_step_status_step`: BEFORE INSERT OR UPDATE FOR EACH ROW → `phase_step_status_step()`

## phase_step_evidence

- **Purpose:** Evidence linked to a phase step; verified evidence meets the evidence_linked completion rule (REQ-S04-001; ADR-0035 §1).
- **Migration:** `0051_p4_phases_gates_g5_g6_exceptions.sql`. **API module:** `workflows`. **Who writes:** `phase_step.progress` (the step owner). **Lifecycle:** active → removed (final); frozen once the step is complete.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| phase_step_id | uuid | NOT NULL |  |  |
| evidence_id | uuid | NOT NULL |  |  |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'removed'])))` |
| removed_by | uuid | NULL |  | FK → app_user(id) |
| removed_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `phase_step_evidence_evidence_fkey` (FK): `FOREIGN KEY (transformation_id, evidence_id) REFERENCES evidence(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `phase_step_evidence_removed_complete` (CHECK): `CHECK ((((status = 'removed') = (removed_at IS NOT NULL)) AND ((removed_at IS NULL) = (removed_by IS NULL))))`
- `phase_step_evidence_step_fkey` (FK): `FOREIGN KEY (transformation_id, phase_step_id) REFERENCES phase_step(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Indexes:**

- `phase_step_evidence_active_key`: `UNIQUE (phase_step_id, evidence_id) WHERE (status = 'active')`

**Triggers:**

- `phase_step_evidence_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `phase_step_evidence_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `phase_step_evidence_guard()`
- `phase_step_evidence_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## gate_criterion_review

- **Purpose:** A per-criterion review of a pending gate submission: reviewer, finding, open condition, risk, recommendation (the criterion decision) and rationale; with the criterion, required evidence and completeness, the nine M0124 fields (REQ-S04-009, REQ-S04-010; ADR-0035 §3).
- **Migration:** `0051_p4_phases_gates_g5_g6_exceptions.sql`. **API module:** `workflows`. **Who writes:** `gate.review` (SP, BO, FIN, TO; not the submitter). **Lifecycle:** append-only; review_no 1, 2, … per submission and criterion.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| gate_submission_id | uuid | NOT NULL |  | FK → gate_submission(id) |
| criterion_key | text | NOT NULL |  | FK → gate_criterion_definition(key) |
| review_no | integer | NOT NULL |  | `CHECK ((review_no >= 1))` |
| reviewer_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| finding | text | NOT NULL |  | `CHECK (((char_length(finding) >= 1) AND (char_length(finding) <= 4000)))` |
| open_condition | text | NULL |  | `CHECK (((open_condition IS NULL) OR ((char_length(open_condition) >= 1) AND (char_length(open_condition) <= 2000))))` |
| risk_note | text | NULL |  | `CHECK (((risk_note IS NULL) OR ((char_length(risk_note) >= 1) AND (char_length(risk_note) <= 2000))))` |
| raid_entry_id | uuid | NULL |  |  |
| recommendation | text | NOT NULL |  | `CHECK ((recommendation = ANY (ARRAY['meets', 'meets_with_conditions', 'does_not_meet'])))` |
| rationale | text | NOT NULL |  | `CHECK (((char_length(rationale) >= 3) AND (char_length(rationale) <= 4000)))` |
| reviewed_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `gate_criterion_review_condition_required` (CHECK): `CHECK (((recommendation <> 'meets_with_conditions') OR (open_condition IS NOT NULL)))`
- `gate_criterion_review_no_key` (UNIQUE): `UNIQUE (gate_submission_id, criterion_key, review_no)`
- `gate_criterion_review_raid_fkey` (FK): `FOREIGN KEY (transformation_id, raid_entry_id) REFERENCES raid_entry(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Triggers:**

- `gate_criterion_review_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `gate_criterion_review_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `gate_criterion_review_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `gate_criterion_review_guard`: BEFORE INSERT FOR EACH ROW → `gate_criterion_review_guard()`
- `gate_criterion_review_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## gate_exception

- **Purpose:** A specifically authorized exception (waiver) for one mandatory criterion of one gate instance: reason, scope, approver, expiry and compensating action (REQ-S04-012, REQ-S04-013; ADR-0035 §4). Covers its criterion while accepted and the business date is on or before expires_on.
- **Migration:** `0051_p4_phases_gates_g5_g6_exceptions.sql`. **API module:** `workflows`. **Who writes:** `gate_exception.request` (TL); `gate_exception.decide` (SP, BO; the gate's configured approver, not the requester); the `gate.exception_expiry_scan` job sets expiry_notified_at once. **Lifecycle:** pending → accepted | rejected | withdrawn; accepted → revoked (final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| gate_instance_id | uuid | NOT NULL |  |  |
| gate_code | text | NOT NULL |  | FK → gate_definition(code) |
| criterion_key | text | NOT NULL |  | FK → gate_criterion_definition(key) |
| reason | text | NOT NULL |  | `CHECK (((char_length(reason) >= 3) AND (char_length(reason) <= 4000)))` |
| scope | text | NOT NULL |  | `CHECK (((char_length(scope) >= 3) AND (char_length(scope) <= 2000)))` |
| compensating_action | text | NOT NULL |  | `CHECK (((char_length(compensating_action) >= 3) AND (char_length(compensating_action) <= 4000)))` |
| compensating_owner_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| expires_on | date | NOT NULL |  |  |
| status | text | NOT NULL | `'pending'` | `CHECK ((status = ANY (ARRAY['pending', 'accepted', 'rejected', 'withdrawn', 'revoked'])))` |
| requested_by | uuid | NOT NULL |  | FK → app_user(id) |
| requested_at | timestamp with time zone | NOT NULL | `now()` |  |
| decided_by | uuid | NULL |  | FK → app_user(id) |
| decided_on_behalf_of | uuid | NULL |  | FK → app_user(id) |
| decided_at | timestamp with time zone | NULL |  |  |
| decision_note | text | NULL |  | `CHECK (((decision_note IS NULL) OR ((char_length(decision_note) >= 3) AND (char_length(decision_note) <= 2000))))` |
| revoked_by | uuid | NULL |  | FK → app_user(id) |
| revoked_at | timestamp with time zone | NULL |  |  |
| revoke_reason | text | NULL |  | `CHECK (((revoke_reason IS NULL) OR ((char_length(revoke_reason) >= 3) AND (char_length(revoke_reason) <= 1000))))` |
| expiry_notified_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `gate_exception_decided_complete` (CHECK): `CHECK ((((status = ANY (ARRAY['accepted', 'rejected', 'revoked'])) = (decided_at IS NOT NULL)) AND ((decided_at IS NULL) = (decided_by IS NULL)) AND ((decided_on_behalf_of IS NULL) OR (decided_by IS NOT NULL))))`
- `gate_exception_decider_not_requester` (CHECK): `CHECK (((decided_by IS NULL) OR ((decided_by <> requested_by) AND (decided_on_behalf_of IS DISTINCT FROM requested_by))))`
- `gate_exception_gate_instance_fkey` (FK): `FOREIGN KEY (transformation_id, gate_instance_id) REFERENCES gate_instance(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `gate_exception_revoked_complete` (CHECK): `CHECK ((((status = 'revoked') = (revoked_at IS NOT NULL)) AND ((revoked_at IS NULL) = (revoked_by IS NULL)) AND ((revoked_at IS NULL) = (revoke_reason IS NULL))))`
- `gate_exception_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `gate_exception_cover_idx`: `(gate_instance_id, criterion_key, expires_on DESC) WHERE (status = 'accepted')`
- `gate_exception_expiry_scan_idx`: `(expires_on) WHERE ((status = 'accepted') AND (expiry_notified_at IS NULL))`
- `gate_exception_one_pending_key`: `UNIQUE (gate_instance_id, criterion_key) WHERE (status = 'pending')`

**Triggers:**

- `gate_exception_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `gate_exception_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `gate_exception_guard()`
- `gate_exception_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## gate_decision_scale_scope

- **Purpose:** The approved scale scope of a G5 approval: one initiative in one business unit per row, so a scope is never unrestricted (REQ-S04-007, REQ-S12-010, M0124; ADR-0035 §5).
- **Migration:** `0051_p4_phases_gates_g5_g6_exceptions.sql`. **API module:** `workflows`. **Who writes:** the G5 decision (`gate.decide`, the configured approver). **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| gate_decision_id | uuid | NOT NULL |  | FK → gate_decision(id) |
| initiative_id | uuid | NOT NULL |  |  |
| business_unit_id | uuid | NOT NULL |  | FK → business_unit(id) |
| note | text | NULL |  | `CHECK (((note IS NULL) OR ((char_length(note) >= 1) AND (char_length(note) <= 1000))))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `gate_decision_scale_scope_initiative_fkey` (FK): `FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `gate_decision_scale_scope_key` (UNIQUE): `UNIQUE (gate_decision_id, initiative_id, business_unit_id)`

**Triggers:**

- `gate_decision_scale_scope_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `gate_decision_scale_scope_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `gate_decision_scale_scope_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `gate_decision_scale_scope_guard`: BEFORE INSERT FOR EACH ROW → `gate_decision_scope_guard()`
- `gate_decision_scale_scope_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## gate_decision_condition

- **Purpose:** A condition of a G5 approval with owner and deadline (M0124; ADR-0035 §5).
- **Migration:** `0051_p4_phases_gates_g5_g6_exceptions.sql`. **API module:** `workflows`. **Who writes:** the G5 decision (`gate.decide`). **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| gate_decision_id | uuid | NOT NULL |  | FK → gate_decision(id) |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 20)))` |
| condition_text | text | NOT NULL |  | `CHECK (((char_length(condition_text) >= 3) AND (char_length(condition_text) <= 2000)))` |
| owner_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| due_date | date | NOT NULL |  |  |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `gate_decision_condition_ordinal_key` (UNIQUE): `UNIQUE (gate_decision_id, ordinal)`

**Triggers:**

- `gate_decision_condition_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `gate_decision_condition_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `gate_decision_condition_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `gate_decision_condition_guard`: BEFORE INSERT FOR EACH ROW → `gate_decision_scope_guard()`
- `gate_decision_condition_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## scale_transition

- **Purpose:** Scaling one initiative into one business unit, only inside the scope of an approved G5 decision (REQ-S03-004, REQ-S04-007; ADR-0035 §5).
- **Migration:** `0051_p4_phases_gates_g5_g6_exceptions.sql`. **API module:** `workflows`. **Who writes:** `scale.transition` (TL). **Lifecycle:** append-only; once per initiative and business unit.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| initiative_id | uuid | NOT NULL |  |  |
| business_unit_id | uuid | NOT NULL |  | FK → business_unit(id) |
| gate_decision_id | uuid | NOT NULL |  | FK → gate_decision(id) |
| note | text | NULL |  | `CHECK (((note IS NULL) OR ((char_length(note) >= 1) AND (char_length(note) <= 2000))))` |
| transitioned_by | uuid | NOT NULL |  | FK → app_user(id) |
| transitioned_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `scale_transition_initiative_fkey` (FK): `FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `scale_transition_key` (UNIQUE): `UNIQUE (initiative_id, business_unit_id)`

**Triggers:**

- `scale_transition_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `scale_transition_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `scale_transition_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `scale_transition_guard`: BEFORE INSERT FOR EACH ROW → `scale_transition_guard()`
- `scale_transition_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## risk_disposition

- **Purpose:** A proposed disposition of an open RAID risk (accept, transfer, carry into BAU) with rationale and residual owner; approved through the canonical approval of type risk_disposition, it counts for G5 Risk closure (REQ-PB-020, REQ-S04-007; ADR-0035 §6).
- **Migration:** `0051_p4_phases_gates_g5_g6_exceptions.sql`. **API module:** `workflows`. **Who writes:** `risk_disposition.propose` (TL, BO, WL); decided with `approval.decide` (SP, BO, FIN). **Lifecycle:** append-only; status = its approval's status.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| raid_entry_id | uuid | NOT NULL |  |  |
| disposition | text | NOT NULL |  | `CHECK ((disposition = ANY (ARRAY['accept', 'transfer', 'carry_into_bau'])))` |
| rationale | text | NOT NULL |  | `CHECK (((char_length(rationale) >= 3) AND (char_length(rationale) <= 4000)))` |
| residual_owner_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version = 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `risk_disposition_raid_fkey` (FK): `FOREIGN KEY (transformation_id, raid_entry_id) REFERENCES raid_entry(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `risk_disposition_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `risk_disposition_raid_idx`: `(raid_entry_id)`

**Triggers:**

- `risk_disposition_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `risk_disposition_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `risk_disposition_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `risk_disposition_guard`: BEFORE INSERT FOR EACH ROW → `risk_disposition_guard()`
- `risk_disposition_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## change_control_policy

- **Purpose:** The materiality thresholds of one transformation; NULL = every change of that kind is material; no threshold is seeded (REQ-S09-010; ADR-0036 §3).
- **Migration:** `0052_p4_change_control.sql`. **API module:** `workflows`. **Who writes:** `change_control.configure` (TL, TO). **Lifecycle:** one row per transformation; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| material_date_shift_working_days | integer | NULL |  | `CHECK (((material_date_shift_working_days IS NULL) OR ((material_date_shift_working_days >= 0) AND (material_date_shift_working_days <= 250))))` |
| material_budget_change_ratio | numeric(9,6) | NULL |  | `CHECK (((material_budget_change_ratio IS NULL) OR ((material_budget_change_ratio >= (0)::numeric) AND (material_budget_change_ratio <= (10)::numeric))))` |
| note | text | NULL |  | `CHECK (((note IS NULL) OR ((char_length(note) >= 1) AND (char_length(note) <= 2000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `change_control_policy_transformation_key` (UNIQUE): `UNIQUE (transformation_id)`

**Triggers:**

- `change_control_policy_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `change_control_policy_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## change_request

- **Purpose:** A change request to an approved record (scope, baseline, target, TOM, cost, benefit logic, KPI definition, schedule or budget rebaseline) with reason, proposed change, materiality, route and frozen impact assessment; decided through the canonical approval (REQ-S04-014, REQ-S07-015, REQ-S09-010; REQ-S16-018 ChangeRequest; ADR-0036 §1).
- **Migration:** `0052_p4_change_control.sql`. **API module:** `workflows`. **Who writes:** `change_request.raise` (TL, BO, WL, FIN, TO, KDS; the requester); the `change_request` approval subject provider (outcomes); the material-change hook (origin automatic). **Lifecycle:** draft → submitted | withdrawn; submitted → approved | rejected | changes_requested | withdrawn; changes_requested → submitted | withdrawn (approved, rejected, withdrawn final).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| code | text | NOT NULL |  | `CHECK ((code ~ '^CR-[0-9]{2,}$'))` |
| change_kind | text | NOT NULL |  | `CHECK ((change_kind = ANY (ARRAY['business_scope', 'baseline', 'target', 'tom', 'cost', 'benefit_logic', 'kpi_definition', 'schedule_rebaseline', 'budget_rebaseline'])))` |
| subject_type | text | NOT NULL |  | `CHECK ((subject_type = ANY (ARRAY['charter', 'kpi_definition', 'outcome_kpi', 'tom_canvas_cell', 'initiative', 'benefit_formula', 'milestone', 'budget_line'])))` |
| subject_id | uuid | NOT NULL |  |  |
| subject_version | integer | NOT NULL |  | `CHECK ((subject_version >= 1))` |
| proposed_record_type | text | NULL |  | `CHECK (((proposed_record_type IS NULL) OR (proposed_record_type = ANY (ARRAY['kpi_version', 'benefit_formula_version']))))` |
| proposed_record_id | uuid | NULL |  |  |
| proposed_change | jsonb | NOT NULL |  | `CHECK ((jsonb_typeof(proposed_change) = 'object'))` |
| reason | text | NOT NULL |  | `CHECK (((char_length(reason) >= 3) AND (char_length(reason) <= 4000)))` |
| origin | text | NOT NULL | `'manual'` | `CHECK ((origin = ANY (ARRAY['manual', 'automatic'])))` |
| materiality | text | NULL |  | `CHECK (((materiality IS NULL) OR (materiality = ANY (ARRAY['material', 'not_material']))))` |
| materiality_basis | jsonb | NULL |  | `CHECK (((materiality_basis IS NULL) OR (jsonb_typeof(materiality_basis) = 'object')))` |
| route_party_code | text | NULL |  | FK → governance_party(code) |
| decision_right_id | uuid | NULL |  |  |
| status | text | NOT NULL | `'draft'` | `CHECK ((status = ANY (ARRAY['draft', 'submitted', 'changes_requested', 'approved', 'rejected', 'withdrawn'])))` |
| raised_by | uuid | NOT NULL |  | FK → app_user(id) |
| submitted_by | uuid | NULL |  | FK → app_user(id) |
| submitted_at | timestamp with time zone | NULL |  |  |
| current_impact_assessment_id | uuid | NULL |  |  |
| decided_at | timestamp with time zone | NULL |  |  |
| applied_at | timestamp with time zone | NULL |  |  |
| applied_record_type | text | NULL |  | `CHECK (((applied_record_type IS NULL) OR (applied_record_type ~ '^[a-z_]+$')))` |
| applied_record_id | uuid | NULL |  |  |
| applied_version | integer | NULL |  | `CHECK (((applied_version IS NULL) OR (applied_version >= 1)))` |
| withdrawn_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `change_request_applied_complete` (CHECK): `CHECK ((((status = 'approved') = (applied_at IS NOT NULL)) AND ((applied_at IS NULL) = (applied_record_type IS NULL)) AND ((applied_record_type IS NULL) = (applied_record_id IS NULL)) AND ((applied_record_id IS NULL) = (applied_version IS NULL))))`
- `change_request_code_key` (UNIQUE): `UNIQUE (transformation_id, code)`
- `change_request_current_impact_assessment_fkey` (FK): `FOREIGN KEY (transformation_id, current_impact_assessment_id) REFERENCES impact_assessment(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `change_request_decided_complete` (CHECK): `CHECK (((status = ANY (ARRAY['approved', 'rejected'])) = (decided_at IS NOT NULL)))`
- `change_request_decision_right_fkey` (FK): `FOREIGN KEY (transformation_id, decision_right_id) REFERENCES transformation_decision_right(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `change_request_kind_subject` (CHECK): `CHECK (
CASE change_kind
    WHEN 'business_scope' THEN (subject_type = ANY (ARRAY['charter', 'initiative']))
    WHEN 'baseline' THEN (subject_type = ANY (ARRAY['kpi_definition', 'outcome_kpi']))
    WHEN 'target' THEN (subject_type = ANY (ARRAY['kpi_definition', 'outcome_kpi']))
    WHEN 'kpi_definition' THEN (subject_type = 'kpi_definition')
    WHEN 'tom' THEN (subject_type = 'tom_canvas_cell')
    WHEN 'cost' THEN (subject_type = ANY (ARRAY['initiative', 'budget_line']))
    WHEN 'benefit_logic' THEN (subject_type = 'benefit_formula')
    WHEN 'schedule_rebaseline' THEN (subject_type = 'milestone')
    WHEN 'budget_rebaseline' THEN (subject_type = 'budget_line')
    ELSE false
END)`
- `change_request_proposed_kind` (CHECK): `CHECK (((proposed_record_type IS NULL) OR ((proposed_record_type = 'kpi_version') AND (change_kind = ANY (ARRAY['baseline', 'target', 'kpi_definition'])) AND (subject_type = 'kpi_definition')) OR ((proposed_record_type = 'benefit_formula_version') AND (change_kind = 'benefit_logic'))))`
- `change_request_proposed_pair` (CHECK): `CHECK (((proposed_record_type IS NULL) = (proposed_record_id IS NULL)))`
- `change_request_submitted_complete` (CHECK): `CHECK (((status = ANY (ARRAY['draft', 'withdrawn'])) OR ((submitted_at IS NOT NULL) AND (submitted_by IS NOT NULL) AND (materiality IS NOT NULL) AND (route_party_code IS NOT NULL) AND (current_impact_assessment_id IS NOT NULL))))`
- `change_request_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`
- `change_request_withdrawn_complete` (CHECK): `CHECK (((status = 'withdrawn') = (withdrawn_at IS NOT NULL)))`

**Indexes:**

- `change_request_one_open_per_subject`: `UNIQUE (subject_type, subject_id) WHERE (status = ANY (ARRAY['draft', 'submitted', 'changes_requested']))`
- `change_request_transformation_idx`: `(transformation_id, status, created_at DESC, id DESC)`

**Triggers:**

- `change_request_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `change_request_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `change_request_guard()`
- `change_request_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## impact_assessment

- **Purpose:** The impact assessment frozen for one submitted change-request version, with the SHA-256 of its items (REQ-S04-014, REQ-S07-015; ADR-0036 §5).
- **Migration:** `0052_p4_change_control.sql`. **API module:** `workflows`. **Who writes:** `submitChangeRequest`. **Lifecycle:** append-only; one per request version.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| change_request_id | uuid | NOT NULL |  |  |
| change_request_version | integer | NOT NULL |  | `CHECK ((change_request_version >= 1))` |
| item_count | integer | NOT NULL |  | `CHECK ((item_count >= 0))` |
| content_sha256 | character(64) | NOT NULL |  | `CHECK ((content_sha256 ~ '^[0-9a-f]{64}$'))` |
| assessed_at | timestamp with time zone | NOT NULL | `now()` |  |
| assessed_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `impact_assessment_change_request_fkey` (FK): `FOREIGN KEY (transformation_id, change_request_id) REFERENCES change_request(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `impact_assessment_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`
- `impact_assessment_version_key` (UNIQUE): `UNIQUE (change_request_id, change_request_version)`

**Triggers:**

- `impact_assessment_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `impact_assessment_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `impact_assessment_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `impact_assessment_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## impact_assessment_item

- **Purpose:** One affected record of an impact assessment: outcome, KPI, benefit, gate (naming the preserved submission and decision), report (T10 area), formula, initiative, milestone, business case or budget line (ADR-0036 §5).
- **Migration:** `0052_p4_change_control.sql`. **API module:** `workflows`. **Who writes:** `submitChangeRequest`. **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| impact_assessment_id | uuid | NOT NULL |  |  |
| ordinal | integer | NOT NULL |  | `CHECK ((ordinal >= 1))` |
| item_type | text | NOT NULL |  | `CHECK ((item_type = ANY (ARRAY['outcome', 'kpi', 'benefit', 'gate', 'report', 'formula', 'initiative', 'milestone', 'business_case', 'budget_line'])))` |
| record_type | text | NULL |  | `CHECK (((record_type IS NULL) OR (record_type ~ '^[a-z_]+$')))` |
| record_id | uuid | NULL |  |  |
| record_code | text | NULL |  | `CHECK (((record_code IS NULL) OR ((char_length(record_code) >= 1) AND (char_length(record_code) <= 50))))` |
| label | text | NOT NULL |  | `CHECK (((char_length(label) >= 1) AND (char_length(label) <= 300)))` |
| effect | text | NOT NULL |  | `CHECK ((effect = ANY (ARRAY['value_changes', 'recalculation', 'reapproval_required', 'informational'])))` |
| gate_submission_id | uuid | NULL |  | FK → gate_submission(id) |
| gate_decision_id | uuid | NULL |  | FK → gate_decision(id) |
| detail | jsonb | NOT NULL | `'{}'::jsonb` | `CHECK ((jsonb_typeof(detail) = 'object'))` |

**Table constraints:**

- `impact_assessment_item_assessment_fkey` (FK): `FOREIGN KEY (transformation_id, impact_assessment_id) REFERENCES impact_assessment(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `impact_assessment_item_gate_shape` (CHECK): `CHECK ((((item_type = 'gate') = (gate_submission_id IS NOT NULL)) AND ((gate_decision_id IS NULL) OR (item_type = 'gate'))))`
- `impact_assessment_item_ordinal_key` (UNIQUE): `UNIQUE (impact_assessment_id, ordinal)`
- `impact_assessment_item_record_pair` (CHECK): `CHECK (((record_type IS NULL) = (record_id IS NULL)))`

**Indexes:**

- `impact_assessment_item_record_idx`: `(record_type, record_id)`

**Triggers:**

- `impact_assessment_item_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `impact_assessment_item_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `impact_assessment_item_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## P4 seeds (0051, 0053, 0054, slice H)

- `phase_definition`: 6 rows (B0021 names, purposes, key outputs; phase titles; objectives), `ar_provisional = true`.
- `phase_step_definition`: 25 rows (Diagnose 5, Define 3, Design 4, Mobilize 5, Transform 4, Realize 4); `source_procedure_en` verbatim from M0118–M0123; required evidence, role defaults and completion rules are an architect interpretation (ADR-0035 §1); `ar_provisional = true`.
- `gate_criterion_definition`: the 8 G5/G6 rows above.
- `approval_type` `change_request` (subject `change_request`) and `risk_disposition` (subject `risk_disposition`), SoD `requester_excluded`, owner module `workflows`.
- `work_item_kind` `gate_decision_due` (M0229), `gate_exception_to_decide`, `gate_exception_expired` (M0125), `gate_condition_due` (M0124), `phase_step_enabled` (M0230), `phase_step_review` (M0116), `scale_scope_enabled` (M0230) — owner module `workflows`.
- `permission` (10 rows: 8 write, `change_control.configure` configure, `gate_exception.decide` business_approval) and `role_permission` (31 rows): exactly `P4_GATES_CHANGE_PERMISSIONS` / `P4_GATES_CHANGE_ROLE_PERMISSIONS` (`packages/db/src/seed.test.ts`). No technical-admin role and no AUD holds any; `gate_exception.decide` is held by SP and BO only.
- `job_schedule` `gate.exception_expiry_scan` (daily 00:30 `Asia/Riyadh`, owner `workflows`), audited `system` (`0054`); reported `unhandled` until BE-K registers the handler.
- No phase step, review, exception, scale scope, transition, disposition, policy or change request is seeded, and no threshold value.

## P4 functions (slice H)

| Function | Migration | Purpose | Callable by `mth_app` |
|---|---|---|---|
| `phase_step_status_step()`, `phase_step_evidence_guard()` | 0051 | the step state machine, final `complete`, owner locked in review, evidence frozen on a complete step | via trigger |
| `gate_criterion_review_guard()` | 0051 | review of a pending submission's own criterion, not by the submitter, sequential `review_no` | via trigger |
| `gate_exception_guard()` | 0051 | pending start, mandatory criterion of the same gate, content immutable, legal transitions, final decisions, expiry notified once | via trigger |
| `gate_submission_criterion_exception_valid()` | 0051 | an exception recorded on a criterion row covers it on the submission's business date | via trigger |
| `p4_g5_approved_decision(uuid, uuid)` | 0051 | is the gate decision an approved G5 decision of the transformation | via triggers |
| `gate_decision_scope_guard()`, `scale_transition_guard()` | 0051 | scope and conditions only on an approved G5 decision, business unit of the same organization; scaling only inside the approved scope | via trigger |
| `risk_disposition_guard()` | 0051 | a disposition names an open risk | via trigger |
| `change_request_guard()` | 0052 | draft start, immutable identity, content frozen outside draft/changes requested, legal transitions, outcomes only with a person's decision on the change_request approval, the assessment frozen for the current version | via trigger |

## P4 validation rules summary (slice H)

| Layer | What it checks |
|---|---|
| Database | The P2 record guards (version step, identity, organization = transformation's, deferred audit coverage; append-only reviews, scale scope, conditions, transitions, dispositions, assessments and items); closed sets (phase codes, step statuses, completion rules, recommendations, exception and change-request statuses, change kinds and subjects, item types and effects, dispositions); step state machine and separate reviewer; exception content immutable and decider ≠ requester; a mandatory criterion incomplete only with a covering exception; scale scope only on an approved G5 decision; scaling only inside it, once; change-request outcomes only with a person's approval decision; one open change request per subject; thresholds in range (decimal ratio) |
| API (`@mth/shared/schemas`) | Shapes (OpenAPI slice H schemas, `GateDecisionCreate.scaleScope`), `proposedChange` per kind, free-text rules, strict UTF-8, request media types, `If-Match` |
| Service | Permissions and record-level rules (ADR-0035 §8, ADR-0036 §7: step owner; reviewer ≠ owner/requester; gate's configured approver; requester), commit-time re-authorization, the completion rules, the G5/G6 evaluators, the exact refusal codes and English texts (ADR-0035 §11, ADR-0036 §10), materiality, T11 routing, impact derivation, apply-on-approval |
| Worker | `gate.submitted` (one task per required approver, referencing the snapshot), `gate.decided` (next-phase steps and scope tasks once), `gate.exception_expiry_scan` (notify once) |

# P4 tables, slices J and K (migrations 0055–0057, DG4)

Slices J and K of `docs/architecture/p4-plan.md` (T-DG4-ARCH-08; ADR-0037 dashboards, My Work, Executive Overview, workspace header; ADR-0038 traceability, allocation, impact, Modular entry, portfolios and workstreams). The per-table sections below are generated from the catalogue of a freshly migrated database by `docs/delivery/handbacks/DG4/T-DG4-ARCH-08-evidence/gen-dictionary.ts`, so they match `0055` and `0056` exactly. Every mutable table carries the P2 guards (`p2_attach_guards`: version starts at 1 and steps by 1, identity immutable, organization = the transformation's, deferred audit coverage). No table here stores a dashboard figure or a RAG status: the dashboards are read models (ADR-0037 §1). G1–G6 are business approvals inside the product; nothing here touches DG0–DG7.

## Changes to existing tables (slices J and K)

- `initiative_outcome_contribution` (DG3 `0020`; additive): new columns `allocation_share numeric(7,6) NULL` (CHECK `initiative_outcome_contribution_allocation_share_check`: NULL or 0 < share ≤ 1) and `allocation_basis text NULL` (1–1000); CHECK `initiative_outcome_contribution_allocation_needs_kpi` (a share needs `outcome_kpi_id`) and `initiative_outcome_contribution_basis_needs_share`; BEFORE INSERT OR UPDATE trigger `initiative_outcome_contribution_allocation_guard` → `trace_allocation_guard()`. Existing rows keep NULL; the DG3 routes never write the columns (written by `setOutcomeContributionAllocation`, ADR-0038 §3).
- `record_code_counter`: CHECK `record_code_counter_prefix_check` gains `WS` (workstream codes `WS-nn`).

## portfolio

- **Purpose:** An organization-level grouping of transformations (REQ-S03-001; ADR-0038 §9). Code unique per organization.
- **Migration:** `0055_p4_traceability_modular_structure.sql`. **API module:** `portfolio`. **Who writes:** `portfolio.manage` (TO). **Lifecycle:** active → archived (final); versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| code | text | NOT NULL |  | `CHECK ((code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'))` |
| name | text | NOT NULL |  | `CHECK (((char_length(name) >= 1) AND (char_length(name) <= 300)))` |
| description | text | NULL |  | `CHECK (((description IS NULL) OR ((char_length(description) >= 1) AND (char_length(description) <= 4000))))` |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `portfolio_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `portfolio_org_code_key` (UNIQUE): `UNIQUE (organization_id, code)`
- `portfolio_org_id_key` (UNIQUE): `UNIQUE (organization_id, id)`

**Triggers:**

- `portfolio_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `portfolio_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## portfolio_transformation

- **Purpose:** A transformation's place in a portfolio; at most one active portfolio per transformation; the portfolio is of the transformation's organization (REQ-S03-001; ADR-0038 §9).
- **Migration:** `0055_p4_traceability_modular_structure.sql`. **API module:** `portfolio`. **Who writes:** `portfolio.manage` (TO). **Lifecycle:** active → removed (final, with reason); never deleted.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| portfolio_id | uuid | NOT NULL |  |  |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'removed'])))` |
| removed_at | timestamp with time zone | NULL |  |  |
| removed_by | uuid | NULL |  | FK → app_user(id) |
| remove_reason | text | NULL |  | `CHECK (((remove_reason IS NULL) OR ((char_length(remove_reason) >= 3) AND (char_length(remove_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `portfolio_transformation_portfolio_fkey` (FK): `FOREIGN KEY (organization_id, portfolio_id) REFERENCES portfolio(organization_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `portfolio_transformation_removal_complete` (CHECK): `CHECK ((((status = 'removed') = (removed_at IS NOT NULL)) AND ((removed_at IS NULL) = (removed_by IS NULL)) AND ((removed_at IS NULL) = (remove_reason IS NULL))))`

**Indexes:**

- `portfolio_transformation_one_active_key`: `UNIQUE (transformation_id) WHERE (status = 'active')`
- `portfolio_transformation_portfolio_idx`: `(portfolio_id) WHERE (status = 'active')`

**Triggers:**

- `portfolio_transformation_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `portfolio_transformation_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## workstream

- **Purpose:** A workstream grouping initiatives of one transformation, code WS-nn; the scope of the workstream dashboard (REQ-S03-001, REQ-S13-001; ADR-0038 §9).
- **Migration:** `0055_p4_traceability_modular_structure.sql`. **API module:** `portfolio`. **Who writes:** `workstream.manage` (TL, TO). **Lifecycle:** active → archived (final); versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| code | text | NOT NULL |  | `CHECK ((code ~ '^WS-[0-9]{2,6}$'))` |
| name | text | NOT NULL |  | `CHECK (((char_length(name) >= 1) AND (char_length(name) <= 300)))` |
| description | text | NULL |  | `CHECK (((description IS NULL) OR ((char_length(description) >= 1) AND (char_length(description) <= 4000))))` |
| lead_user_id | uuid | NULL |  | FK → app_user(id) |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'archived'])))` |
| archived_at | timestamp with time zone | NULL |  |  |
| archived_by | uuid | NULL |  | FK → app_user(id) |
| archive_reason | text | NULL |  | `CHECK (((archive_reason IS NULL) OR ((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `workstream_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `workstream_code_key` (UNIQUE): `UNIQUE (transformation_id, code)`
- `workstream_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Triggers:**

- `workstream_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `workstream_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## workstream_initiative

- **Purpose:** An initiative's membership of a workstream; at most one active workstream per initiative, same transformation (REQ-S03-001; ADR-0038 §9).
- **Migration:** `0055_p4_traceability_modular_structure.sql`. **API module:** `portfolio`. **Who writes:** `workstream.manage` (TL, TO). **Lifecycle:** active → removed (final, with reason); never deleted.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| workstream_id | uuid | NOT NULL |  |  |
| initiative_id | uuid | NOT NULL |  |  |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'removed'])))` |
| removed_at | timestamp with time zone | NULL |  |  |
| removed_by | uuid | NULL |  | FK → app_user(id) |
| remove_reason | text | NULL |  | `CHECK (((remove_reason IS NULL) OR ((char_length(remove_reason) >= 3) AND (char_length(remove_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `workstream_initiative_initiative_fkey` (FK): `FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `workstream_initiative_removal_complete` (CHECK): `CHECK ((((status = 'removed') = (removed_at IS NOT NULL)) AND ((removed_at IS NULL) = (removed_by IS NULL)) AND ((removed_at IS NULL) = (remove_reason IS NULL))))`
- `workstream_initiative_workstream_fkey` (FK): `FOREIGN KEY (transformation_id, workstream_id) REFERENCES workstream(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Indexes:**

- `workstream_initiative_one_active_key`: `UNIQUE (initiative_id) WHERE (status = 'active')`
- `workstream_initiative_workstream_idx`: `(workstream_id) WHERE (status = 'active')`

**Triggers:**

- `workstream_initiative_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `workstream_initiative_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## trace_link

- **Purpose:** A chain link that no typed table records (issue → gap, deliverable → capability change, capability change → KPI movement, KPI movement → benefit) with its contribution statement and, into a KPI or benefit, an optional share; the shares into one target total at most 1 (REQ-S03-006, REQ-PB-044; ADR-0038 §2, §3).
- **Migration:** `0055_p4_traceability_modular_structure.sql`. **API module:** `reporting`. **Who writes:** `traceability.link` (TL, BO, WL, TO). **Lifecycle:** active → removed (final, with reason); never deleted.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| link_kind | text | NOT NULL |  | `CHECK ((link_kind = ANY (ARRAY['issue_gap', 'deliverable_capability', 'capability_kpi', 'kpi_benefit'])))` |
| diagnostic_finding_id | uuid | NULL |  |  |
| tom_gap_id | uuid | NULL |  |  |
| deliverable_id | uuid | NULL |  |  |
| capability_id | uuid | NULL |  |  |
| outcome_kpi_id | uuid | NULL |  |  |
| benefit_id | uuid | NULL |  |  |
| contribution_statement | text | NOT NULL |  | `CHECK (((char_length(contribution_statement) >= 1) AND (char_length(contribution_statement) <= 2000)))` |
| allocation_share | numeric(7,6) | NULL |  | `CHECK (((allocation_share IS NULL) OR ((allocation_share > (0)::numeric) AND (allocation_share <= (1)::numeric))))` |
| allocation_basis | text | NULL |  | `CHECK (((allocation_basis IS NULL) OR ((char_length(allocation_basis) >= 1) AND (char_length(allocation_basis) <= 1000))))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'removed'])))` |
| removed_at | timestamp with time zone | NULL |  |  |
| removed_by | uuid | NULL |  | FK → app_user(id) |
| remove_reason | text | NULL |  | `CHECK (((remove_reason IS NULL) OR ((char_length(remove_reason) >= 3) AND (char_length(remove_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `trace_link_allocation_kind` (CHECK): `CHECK (((allocation_share IS NULL) OR (link_kind = ANY (ARRAY['capability_kpi', 'kpi_benefit']))))`
- `trace_link_basis_needs_share` (CHECK): `CHECK (((allocation_basis IS NULL) OR (allocation_share IS NOT NULL)))`
- `trace_link_benefit_fkey` (FK): `FOREIGN KEY (transformation_id, benefit_id) REFERENCES benefit(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `trace_link_capability_fkey` (FK): `FOREIGN KEY (transformation_id, capability_id) REFERENCES capability(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `trace_link_deliverable_fkey` (FK): `FOREIGN KEY (transformation_id, deliverable_id) REFERENCES deliverable(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `trace_link_finding_fkey` (FK): `FOREIGN KEY (transformation_id, diagnostic_finding_id) REFERENCES diagnostic_finding(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `trace_link_kind_shape` (CHECK): `CHECK ((((link_kind = 'issue_gap') = (diagnostic_finding_id IS NOT NULL)) AND ((link_kind = 'deliverable_capability') = (deliverable_id IS NOT NULL)) AND ((link_kind = 'kpi_benefit') = (benefit_id IS NOT NULL)) AND ((tom_gap_id IS NOT NULL) = (link_kind = 'issue_gap')) AND ((capability_id IS NOT NULL) = (link_kind = ANY (ARRAY['deliverable_capability', 'capability_kpi']))) AND ((outcome_kpi_id IS NOT NULL) = (link_kind = ANY (ARRAY['capability_kpi', 'kpi_benefit'])))))`
- `trace_link_outcome_kpi_fkey` (FK): `FOREIGN KEY (transformation_id, outcome_kpi_id) REFERENCES outcome_kpi(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `trace_link_removal_complete` (CHECK): `CHECK ((((status = 'removed') = (removed_at IS NOT NULL)) AND ((removed_at IS NULL) = (removed_by IS NULL)) AND ((removed_at IS NULL) = (remove_reason IS NULL))))`
- `trace_link_tom_gap_fkey` (FK): `FOREIGN KEY (transformation_id, tom_gap_id) REFERENCES tom_gap(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `trace_link_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `trace_link_benefit_idx`: `(benefit_id) WHERE (status = 'active')`
- `trace_link_one_active_key`: `UNIQUE (transformation_id, link_kind, diagnostic_finding_id, tom_gap_id, deliverable_id, capability_id, outcome_kpi_id, benefit_id) NULLS NOT DISTINCT WHERE (status = 'active')`
- `trace_link_outcome_kpi_idx`: `(outcome_kpi_id) WHERE (status = 'active')`

**Triggers:**

- `trace_link_allocation_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `trace_allocation_guard()`
- `trace_link_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `trace_link_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## inherited_record

- **Purpose:** Inherited evidence or an inherited baseline of a Modular entry, labelled inherited with its provenance; references the canonical row, never copies it; prior approvals stay gate_dispensation rows (REQ-S03-005, REQ-PB-005; ADR-0038 §7).
- **Migration:** `0055_p4_traceability_modular_structure.sql`. **API module:** `reporting`. **Who writes:** `inherited_record.record` (TL, TO); Modular transformations only. **Lifecycle:** active → withdrawn (final, with reason); provenance immutable.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| kind | text | NOT NULL |  | `CHECK ((kind = ANY (ARRAY['evidence', 'baseline'])))` |
| evidence_id | uuid | NULL |  |  |
| baseline_id | uuid | NULL |  |  |
| source_description | text | NOT NULL |  | `CHECK (((char_length(source_description) >= 3) AND (char_length(source_description) <= 2000)))` |
| original_owner | text | NULL |  | `CHECK (((original_owner IS NULL) OR ((char_length(original_owner) >= 1) AND (char_length(original_owner) <= 300))))` |
| original_date | date | NULL |  |  |
| recorded_by | uuid | NOT NULL |  | FK → app_user(id) |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'withdrawn'])))` |
| withdrawn_at | timestamp with time zone | NULL |  |  |
| withdrawn_by | uuid | NULL |  | FK → app_user(id) |
| withdraw_reason | text | NULL |  | `CHECK (((withdraw_reason IS NULL) OR ((char_length(withdraw_reason) >= 3) AND (char_length(withdraw_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `inherited_record_baseline_fkey` (FK): `FOREIGN KEY (transformation_id, baseline_id) REFERENCES baseline(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `inherited_record_evidence_fkey` (FK): `FOREIGN KEY (transformation_id, evidence_id) REFERENCES evidence(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `inherited_record_kind_shape` (CHECK): `CHECK ((((kind = 'evidence') = (evidence_id IS NOT NULL)) AND ((kind = 'baseline') = (baseline_id IS NOT NULL))))`
- `inherited_record_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`
- `inherited_record_withdrawal_complete` (CHECK): `CHECK ((((status = 'withdrawn') = (withdrawn_at IS NOT NULL)) AND ((withdrawn_at IS NULL) = (withdrawn_by IS NULL)) AND ((withdrawn_at IS NULL) = (withdraw_reason IS NULL))))`

**Indexes:**

- `inherited_record_one_active_key`: `UNIQUE (transformation_id, kind, evidence_id, baseline_id) NULLS NOT DISTINCT WHERE (status = 'active')`

**Triggers:**

- `inherited_record_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `inherited_record_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `inherited_record_guard()`
- `inherited_record_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## t10_area_definition

- **Purpose:** The six Template 10 areas: area, what to show and RAG logic verbatim from B0095, required presentation and status basis verbatim from M0247-M0252, provisional Arabic (REQ-PB-062; ADR-0037 §2).
- **Migration:** `0056_p4_dashboards_t10.sql`. **API module:** `reporting`. **Who writes:** none (seed, read-only). **Lifecycle:** seed.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| code | text | NOT NULL |  | `CHECK ((code = ANY (ARRAY['outcomes', 'value', 'portfolio', 'dependencies', 'decisions', 'people_adoption'])))` |
| methodology_version_id | uuid | NOT NULL |  | FK → methodology_version(id) |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 6)))` |
| source_area_en | text | NOT NULL |  | `CHECK (((char_length(source_area_en) >= 1) AND (char_length(source_area_en) <= 50)))` |
| area_ar | text | NOT NULL |  | `CHECK (((char_length(area_ar) >= 1) AND (char_length(area_ar) <= 100)))` |
| source_what_to_show_en | text | NOT NULL |  | `CHECK (((char_length(source_what_to_show_en) >= 1) AND (char_length(source_what_to_show_en) <= 200)))` |
| what_to_show_ar | text | NOT NULL |  | `CHECK (((char_length(what_to_show_ar) >= 1) AND (char_length(what_to_show_ar) <= 300)))` |
| source_rag_logic_en | text | NOT NULL |  | `CHECK (((char_length(source_rag_logic_en) >= 1) AND (char_length(source_rag_logic_en) <= 200)))` |
| rag_logic_ar | text | NOT NULL |  | `CHECK (((char_length(rag_logic_ar) >= 1) AND (char_length(rag_logic_ar) <= 300)))` |
| source_presentation_en | text | NOT NULL |  | `CHECK (((char_length(source_presentation_en) >= 1) AND (char_length(source_presentation_en) <= 200)))` |
| presentation_ar | text | NOT NULL |  | `CHECK (((char_length(presentation_ar) >= 1) AND (char_length(presentation_ar) <= 300)))` |
| source_status_basis_en | text | NOT NULL |  | `CHECK (((char_length(source_status_basis_en) >= 1) AND (char_length(source_status_basis_en) <= 200)))` |
| status_basis_ar | text | NOT NULL |  | `CHECK (((char_length(status_basis_ar) >= 1) AND (char_length(status_basis_ar) <= 300)))` |
| source_ref | text | NOT NULL |  | `CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 100)))` |
| ar_provisional | boolean | NOT NULL | `true` |  |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `t10_area_definition_code_key` (UNIQUE): `UNIQUE (code)`
- `t10_area_definition_ordinal_key` (UNIQUE): `UNIQUE (ordinal)`

## dashboard_rag_policy

- **Purpose:** The T10 RAG thresholds of one organization; NULL = the documented ADR-0037 §3 default; no value is seeded (REQ-PB-063; ADR-0037 §3).
- **Migration:** `0056_p4_dashboards_t10.sql`. **API module:** `reporting`. **Who writes:** `dashboard.configure` (TO, KDS). **Lifecycle:** one row per organization; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| value_gap_amber_ratio | numeric(9,6) | NULL |  | `CHECK (((value_gap_amber_ratio IS NULL) OR ((value_gap_amber_ratio >= (0)::numeric) AND (value_gap_amber_ratio <= (1)::numeric))))` |
| value_gap_red_ratio | numeric(9,6) | NULL |  | `CHECK (((value_gap_red_ratio IS NULL) OR ((value_gap_red_ratio >= (0)::numeric) AND (value_gap_red_ratio <= (1)::numeric))))` |
| milestone_slip_amber_working_days | integer | NULL |  | `CHECK (((milestone_slip_amber_working_days IS NULL) OR ((milestone_slip_amber_working_days >= 0) AND (milestone_slip_amber_working_days <= 250))))` |
| milestone_slip_red_working_days | integer | NULL |  | `CHECK (((milestone_slip_red_working_days IS NULL) OR ((milestone_slip_red_working_days >= 0) AND (milestone_slip_red_working_days <= 250))))` |
| dependency_due_soon_working_days | integer | NULL |  | `CHECK (((dependency_due_soon_working_days IS NULL) OR ((dependency_due_soon_working_days >= 0) AND (dependency_due_soon_working_days <= 250))))` |
| decision_due_soon_working_days | integer | NULL |  | `CHECK (((decision_due_soon_working_days IS NULL) OR ((decision_due_soon_working_days >= 0) AND (decision_due_soon_working_days <= 250))))` |
| top_initiative_count | smallint | NULL |  | `CHECK (((top_initiative_count IS NULL) OR ((top_initiative_count >= 1) AND (top_initiative_count <= 50))))` |
| deadline_horizon_working_days | integer | NULL |  | `CHECK (((deadline_horizon_working_days IS NULL) OR ((deadline_horizon_working_days >= 1) AND (deadline_horizon_working_days <= 250))))` |
| note | text | NULL |  | `CHECK (((note IS NULL) OR ((char_length(note) >= 1) AND (char_length(note) <= 2000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `dashboard_rag_policy_milestone_slip_order` (CHECK): `CHECK (((milestone_slip_amber_working_days IS NULL) OR (milestone_slip_red_working_days IS NULL) OR (milestone_slip_amber_working_days <= milestone_slip_red_working_days)))`
- `dashboard_rag_policy_organization_key` (UNIQUE): `UNIQUE (organization_id)`
- `dashboard_rag_policy_value_gap_order` (CHECK): `CHECK (((value_gap_amber_ratio IS NULL) OR (value_gap_red_ratio IS NULL) OR (value_gap_amber_ratio <= value_gap_red_ratio)))`

**Triggers:**

- `dashboard_rag_policy_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `dashboard_rag_policy_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## traceability_edge (view)

- **Purpose:** one read model of every active chain edge, reading each canonical table in place (ADR-0038 §1; REQ-PB-044, REQ-S03-006, REQ-PB-010). **Migration:** `0055`. **`mth_app` privileges:** SELECT.
- **Columns:** `organization_id`, `transformation_id`, `edge_kind` (`issue_gap`, `gap_initiative`, `initiative_deliverable`, `deliverable_capability`, `capability_kpi`, `initiative_kpi`, `outcome_kpi_of`, `kpi_benefit`, `kpi_benefit_measure`, `initiative_benefit`), `from_type`, `from_id`, `to_type`, `to_id`, `link_table`, `link_id`, `contribution_statement`, `allocation_share`.
- **Branches:** `trace_link` (active; four kinds), `initiative_gap_link` (active), `deliverable` (active; initiative → deliverable), `initiative_outcome_contribution` (active; to the outcome KPI, or the outcome when none), `outcome_kpi` (active; outcome → KPI row), `benefit` joined to the active outcome KPIs of its `measurement_kpi_definition_id` (active benefits), `benefit_allocation` rows of the benefit's current set (active benefits).

## my_work_draft (view)

- **Purpose:** the Drafts section of My Work: records in status `draft` of 18 record types with their author (ADR-0037 §7; REQ-S03-008). **Migration:** `0056`. **`mth_app` privileges:** SELECT.
- **Columns:** `organization_id`, `transformation_id`, `record_type`, `record_id`, `code`, `label`, `parent_type`, `parent_id`, `created_by`, `updated_at`.
- **Record types:** `agenda_item`, `assessment_form`, `bau_handover`, `benefit_measurement`, `business_case`, `change_request`, `diagnostic_finding`, `initiative`, `journey`, `kpi_actual`, `kpi_definition`, `kpi_version`, `lesson`, `meeting_minutes`, `outcome`, `target_trajectory`, `tom_canvas_cell`, `transition_decision`.

## P4 seeds (0056, 0057, slices J and K)

- `t10_area_definition`: 6 rows (`outcomes`, `value`, `portfolio`, `dependencies`, `decisions`, `people_adoption`); `source_area_en`, `source_what_to_show_en`, `source_rag_logic_en` verbatim from B0095; `source_presentation_en`, `source_status_basis_en` verbatim from M0247–M0252; `ar_provisional = true`.
- `permission` (5 rows: `traceability.link`, `inherited_record.record`, `workstream.manage` write; `portfolio.manage`, `dashboard.configure` configure) and `role_permission` (11 rows): exactly `P4_DASHBOARD_TRACE_PERMISSIONS` / `P4_DASHBOARD_TRACE_ROLE_PERMISSIONS` (`packages/db/src/seed.test.ts`). No business-approval or Finance-validation code; no technical-admin role and no AUD holds any.
- No dashboard figure, RAG status, threshold value, trace link, inherited record, portfolio or workstream is seeded.

## P4 functions (slices J and K)

| Function | Migration | Purpose | Callable by `mth_app` |
|---|---|---|---|
| `trace_allocation_guard()` | 0055 | the allocation set into one outcome KPI (capability → KPI links and contribution shares) or one benefit (KPI → benefit links) totals at most 1; serialized by advisory-lock class 730249 | via triggers on `trace_link` and `initiative_outcome_contribution` |
| `inherited_record_guard()` | 0055 | Modular transformations only; new rows active; provenance immutable; only `active → withdrawn` | via trigger |

## P4 validation rules summary (slices J and K)

| Layer | What it checks |
|---|---|
| Database | The P2 record guards (version step, identity, organization = transformation's, deferred audit coverage); closed sets (link kinds, statuses, T10 area codes); the two records a link kind names, in the link's transformation (composite FKs); one active link per (kind, from, to); shares 0 < share ≤ 1 only into a KPI or benefit, and an allocation set total ≤ 1; one active portfolio per transformation and one active workstream per initiative; portfolio of the transformation's organization; inherited records only on Modular transformations, provenance immutable, one active per evidence item or baseline; RAG thresholds in range with amber ≤ red; one policy per organization; the T10 seed read-only for the application role |
| API (`@mth/shared/schemas`) | Shapes (OpenAPI slices J and K schemas), filters, free-text rules, strict UTF-8, request media types, `If-Match` |
| Service | Permissions and record-level rules (ADR-0037 §10, ADR-0038 §10), the readable-transformation scope of every read (404 outside it), the area RAG rules and defaults, the drill-down sum invariant, the My Work kind map and own-items rule, the missing-link and orphan rules, the impact walk, commit-time re-authorization, the exact refusal codes and English texts (ADR-0037 §13, ADR-0038 §12) |
| Worker | none (slices J and K have no job) |
