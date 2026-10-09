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
