# Data dictionary: P1 and P2 tables and views

- **Task:** T-DG1-ARCH-01 (solution-architect), 2026-09-30.
- **Contract for:** backend-workflow-engineer's P1 migrations (`packages/db/migrations/**`).
- **Governed by:** ADR-0003 (types, IDs, time, concurrency, retention), ADR-0004 (audit), ADR-0005 (sessions), ADR-0006 (access) and ADR-0008 (outbox/jobs).
- **Changes:** changes to this contract after DG1 approval go through the orchestrator.
- **P2 (DG2):** the P2 tables (migrations 0010–0018) are in the section "P2 tables" at the end of this file (T-DG2-ARCH-01B). The P1 sections are unchanged.

## Global rules

- **Schema:** `public`, owned by `mth_owner`. `mth_app` gets `SELECT, INSERT, UPDATE` on business tables, **no `DELETE`** unless a row says otherwise below, and only `INSERT, SELECT` on `audit_event`.
- **SQL floor:** SQL must run on PostgreSQL 16 and 18 (ADR-0003).
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

- **Purpose:** Per-transformation counters for human-readable codes (D-01, DEC-01, GD-01, DEP-01).
- **Migration:** `0017_p2_decisions_gates.sql`. **API module:** `workflows`. **Who writes:** system (code generation). **Lifecycle:** —.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| prefix | text | NOT NULL |  | `CHECK ((prefix = ANY (ARRAY['D', 'DEC', 'GD', 'DEP'])))` |
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

- **Purpose:** THE canonical dependency record shared by T08 and RAID (P2 subset: TOM-level dependencies; P3 adds initiative endpoints and cycle checks).
- **Migration:** `0017_p2_decisions_gates.sql`. **API module:** `workflows`. **Who writes:** dependency.edit (TL, WL, TO, TD). **Lifecycle:** open ↔ at_risk → resolved; → archived.
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
| dependency_type | text | NOT NULL |  | `CHECK ((dependency_type = ANY (ARRAY['decision', 'tech', 'data', 'vendor', 'other'])))` |
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

**Table constraints:**

- `dependency_archive_complete` (CHECK): `CHECK ((((status = 'archived') = (archived_at IS NOT NULL)) AND ((archived_at IS NULL) = (archived_by IS NULL)) AND ((archived_at IS NULL) = (archive_reason IS NULL))))`
- `dependency_code_key` (UNIQUE): `UNIQUE (transformation_id, code)`
- `dependency_decision_id_fkey` (FK): `FOREIGN KEY (transformation_id, decision_id) REFERENCES decision(transformation_id, id)`
- `dependency_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `dependency_dimension_idx`: `(transformation_id, tom_dimension_code) WHERE (status <> 'archived'::text)`
- `dependency_transformation_updated_idx`: `(transformation_id, updated_at DESC, id DESC)`

**Triggers:**

- `dependency_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `dependency_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

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
