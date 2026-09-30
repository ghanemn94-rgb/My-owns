# ADR-0003: Persistence: PostgreSQL, query layer, migrations, IDs, time, decimals, concurrency, retention

- **Status:** Proposed for DG1. **Date:** 2026-09-30. **Author:** solution-architect.
- **Requirements:** REQ-S16-004, REQ-S16-010, REQ-S16-023, REQ-S16-026, REQ-S15-008, REQ-S19-004/005.

## Decision

### PostgreSQL major version

- **PostgreSQL 18** is the product database in Compose, CI and production guidance [UNVERIFIED]. It was released in Sept 2025 and has community support until Nov 2030, under the PostgreSQL Licence (permissive). Source: https://www.postgresql.org/support/versioning/.
- **Portability floor: PostgreSQL 16.** The build sandbox has only a PG **16.13** client and server [V-LOCAL: `psql --version`, `/usr/lib/postgresql/16`].
- Migrations therefore use only SQL that PG 16 supports. In particular we do **not** use PG 18's native `uuidv7()` or virtual generated columns. CI integration tests run on 18; local sandbox runs on 16 state their server version in the evidence.
- PostgreSQL 19 may be released around this date. It is not chosen until it has had at least one minor release.

### Query layer

- **Kysely 0.28.7** (MIT) over **node-postgres `pg` 8.16.3** (MIT) [both UNVERIFIED].
  - Type-safe SQL builder, no ORM identity map and no hidden lazy loading.
  - Raw SQL is available where needed (the policy scope filter, recursive BU queries).
- The `Database` interface is hand-written in `packages/db/src/schema.ts` from the data dictionary. A test compares it with `information_schema` after migrations.
- `numeric` is returned as **string** (pg default) and `bigint` as string. `timestamptz` is parsed to `Date` at the edge and serialised as ISO-8601 UTC.

### Migrations

- **Plain SQL files** in `packages/db/migrations/NNNN_description.sql`, applied by a small runner in `@mth/db` (`mth-db migrate`). The runner:
  - takes `pg_advisory_lock`;
  - applies each pending file in lexical order, in its own transaction;
  - records `(id, name, sha256, applied_at, applied_by)` in `schema_migration`;
  - **refuses to start if an applied file's checksum changed**.
- **Forward-only.** There are no down migrations. Recovery is by backup and restore plus a new corrective migration, as §19 item 10 anticipates.
- The runner must pass on a **fresh, empty database** and is idempotent on an up-to-date one. Both are integration-tested.
- Migrations run as the **owner role** (`mth_owner`, `DATABASE_OWNER_URL`). The API and worker connect as **`mth_app`**, which has DML on business tables and only `INSERT`/`SELECT` on `audit_event` (ADR-0004), and no DDL.
- Deployment creates both roles; migrations only `GRANT` to them. The integration-test global setup creates them in the disposable cluster if they are missing.
- pg-boss manages its own schema (`pgboss`) with its own versioned migrations. The same CLI installs or upgrades it as the owner role, so the app role never needs DDL.
- *Alternatives:*
  - node-pg-migrate and graphile-migrate: an extra dependency that encourages down migrations or has its own workflow.
  - Kysely `Migrator`: TypeScript migrations are harder for IT DBAs to review than SQL.
  - Prisma: generated client, engine binaries, and weaker control over SQL, triggers and roles.

### Identifiers

- **UUIDv7**, generated in the application with `uuid` 13.0.0 (MIT) `v7()` [UNVERIFIED].
- Columns are `uuid PRIMARY KEY` **without** a database default, so every row gets a time-ordered ID from the application. Seed migrations use literal UUIDs.
- *Why v7:* index locality for append-heavy tables (audit, outbox), and it is still globally unique for migration and export (§19 export preserves IDs).
- Human-readable `code` columns (e.g. `TR-0001`, BU codes) are separate, unique per parent, and stable (REQ-S15-007: readable technical identifiers).

### Time

- Every instant is **`timestamptz`**; `timestamp` without time zone is banned (a review checklist item plus a catalogue test).
- The DB session time zone is `UTC`.
- The business time zone (default `Asia/Riyadh`, configurable per organization and transformation) is applied only when deriving **business dates** (`date` columns) or presenting. §15 keeps three concepts distinct:
  - *observation period*: `daterange` or `(period_start date, period_end date)`, from P4;
  - *business date*: `date`;
  - *event timestamp*: `timestamptz`.

### Money and rates

- The column type is `numeric(20,4)` for money amounts, `numeric(12,8)` for rates and percentages (stored as fractions), and `numeric` with an explicit scale for KPI values (P4). There are no floats.
- Every money value has a `currency char(3)` next to it (default `SAR`).
- In TypeScript, use **decimal.js 10.6.0** (MIT) [UNVERIFIED] through helpers in `@mth/shared`.
- Money travels over the API as **decimal strings**.
- Lint bans `parseFloat`. Unknown or stale values are `null` plus a status, never `0` (CLAUDE.md).

### Optimistic concurrency

- Every mutable table has `version integer NOT NULL DEFAULT 1 CHECK (version >= 1)`.
- Update pattern: `UPDATE … SET …, version = version + 1, updated_at = now(), updated_by = $actor WHERE id = $id AND version = $expected RETURNING *`.
  - Zero rows returned → re-select. If the row is missing or invisible the answer is 404; otherwise **409**.
- API contract (ADR-0007):
  - `ETag: "<version>"` on reads and writes.
  - `If-Match` is required on updates. Without it: **428**. With a stale value: **409** problem `urn:mth:problem:version-conflict` with `currentVersion`.
  - Nothing is written and no audit event is recorded on 409.
- *Why 409 and not 412:* the UI treats this as a business edit conflict, showing "someone else changed this; review and re-apply" (REQ-S15-011 conflict state). A single well-typed problem body is simpler for the client than two status codes. We document this deliberate deviation from the RFC 9110 recommendation.

### Deletion, archive and retention

- **The API never hard-deletes business records.**
  - A lifecycle end is a state: `archived_at`/`archive_reason` on transformations, `revoked_at` on assignments, `status = disabled` on users.
  - Archived records are read-only (422 on update) and stay visible with `includeArchived=true`.
- Foreign keys use `ON DELETE RESTRICT`, which protects finalized records and evidence from destructive deletion (REQ-S16-023).
- **Retention is not soft delete.** Purging data after a retention period needs an **IT/business-approved retention policy** (§16, §19 item 9). It would be implemented as an explicit, audited retention job in a later stage. Until then nothing is purged. `audit_event` is never purged by the application.
- Personal-data erasure requests (if applicable) are an open question for Mobily IT/legal and are recorded as a later-stage item.

## Consequences

- The migration runner is ~150 lines of project code that backend-workflow-engineer must test. In return it has no extra dependency and produces SQL that a DBA can review.
- Local PG 16 and target PG 18 differ in version. Mitigation: the PG 16 SQL floor plus CI on 18.

## Verification evidence

| Item | Pinned | Licence | Support | Evidence |
|---|---|---|---|---|
| PostgreSQL | 18 (image digest pinned by devops); floor 16 | PostgreSQL | 18: until Nov 2030; 16: until Nov 2028 | [UNVERIFIED] postgresql.org versioning page; PG 16.13 present locally [V-LOCAL] |
| kysely | 0.28.7 | MIT | 0.x, active | [UNVERIFIED] |
| pg | 8.16.3 | MIT | active | [UNVERIFIED] |
| @types/pg | 8.15.5 | MIT | — | [UNVERIFIED] |
| uuid | 13.0.0 | MIT | active | [UNVERIFIED] |
| decimal.js | 10.6.0 | MIT | active | [UNVERIFIED] |
