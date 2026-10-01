# Data dictionary: P1 tables

- **Task:** T-DG1-ARCH-01 (solution-architect), 2026-09-30.
- **Contract for:** backend-workflow-engineer's P1 migrations (`packages/db/migrations/**`).
- **Governed by:** ADR-0003 (types, IDs, time, concurrency, retention), ADR-0004 (audit), ADR-0005 (sessions), ADR-0006 (access) and ADR-0008 (outbox/jobs).
- **Changes:** changes to this contract after DG1 approval go through the orchestrator.

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
- No cycles: the API checks with a recursive CTE on update (422), and depth is limited to 10.
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

## pg-boss schema (`pgboss.*`)

- Owned, created and migrated by pg-boss 11 itself (ADR-0008), installed by `mth-db migrate` as `mth_owner`.
- `mth_app` receives the grants pg-boss documents for a non-owner runtime role.
- The tables are not described here; pg-boss's own documentation applies. These are the P1 "job tables as required by the queue choice".

## Validation rules summary (REQ-S19-004)

| Layer | What it checks |
|---|---|
| Database | Type, NOT NULL, CHECK, FK and UNIQUE constraints above. These are the last line of defence. |
| API (`@mth/shared/schemas`) | Shapes, lengths, formats and the mode/entry-phase rule |
| Service | Existence and scope of referenced IDs, status transitions, archived read-only, BU in the same organization, no BU cycles, SoD |
