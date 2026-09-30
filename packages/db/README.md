# @mth/db

**Responsibility.** Everything about the PostgreSQL schema (ADR-0003):
- `migrations/NNNN_description.sql`: forward-only, plain SQL, applied in order, each in its own transaction under
  `pg_advisory_lock`, recorded with a SHA-256 checksum in `schema_migration`. An applied migration is never edited.
  There are no down migrations; recovery is by backup/restore (§19 item 10).
- `src/cli.ts` (`mth-db`): runs as the owner role (`DATABASE_OWNER_URL`).
- `src/` Kysely `Database` types (`schema.ts`, checked against `information_schema` by a test), the pool factory and
  transaction helper, the migration runner, the single audit insert path (`audit.ts`), bootstrap and the dev seed.
- `test/global-setup.ts`: creates and drops one disposable database per integration test run.

## Migrations (P1)

| File | Content |
|---|---|
| `0001_identity_access.sql` | organization, business_unit (+ `business_unit_closure` view), app_user (+ `actor_display` view), user_identity, session, oidc_login_state, role, permission, role_permission (+ **SoD trigger**), scoped_assignment, delegation; grants |
| `0002_transformation.sql` | transformation (+ `scope_node` view used by the policy function); grants |
| `0003_audit_event.sql` | audit_event, **append-only trigger** (UPDATE/DELETE/TRUNCATE raise, even for the owner); INSERT/SELECT for mth_app |
| `0004_outbox_jobs.sql` | outbox_event, processed_message, idempotency_record; grants |
| `0005_seed_roles_permissions.sql` | 16 permissions, 14 roles, 72 links = `packages/shared/src/permissions.ts` (unit + integration tested) |
| `0006_pgboss_schema_v25.sql` | pg-boss 11.0.0 schema v25 (generated; compared with pg-boss's plan by a worker test); runtime grants for mth_app |

## Prerequisites (deployment, not migrations)

Roles `mth_owner` and `mth_app` exist, and the database is **owned by `mth_owner`**
(`CREATE DATABASE mth OWNER mth_owner`). Migration 0001 refuses to run as any other role.

## CLI

| Command | Effect | Exit |
|---|---|---|
| `mth-db migrate` | apply pending migrations; refuses on checksum drift or on a migration the build does not ship | 0 / 1 |
| `mth-db status` | list applied/pending | 0 up to date, 3 pending, 4 drift |
| `mth-db bootstrap --org-code C --org-name-en N --org-name-ar N --admin-name N [--admin-email E] --admin-issuer ISS --admin-subject SUB` | first organization + first administrator (ADM_ACCESS + ADM_TECH, **no business role**), bound to an IdP (issuer, subject); refuses when any organization exists | 0 / 1 |
| `mth-db seed-dev` | SYNTHETIC dev-login users from `seeds/dev/` (refused with `NODE_ENV=production` or `AUTH_MODE` ≠ `dev`; `seeds/` is not published) | 0 / 1 |

Run from source with `node --conditions=@mth/source packages/db/src/cli.ts <command>` or built with
`node packages/db/dist/cli.js <command>`.

## Tests

- Unit: `src/seed.test.ts` (seed file = `permissions.ts`; migration file rules).
- Integration (`TEST_DATABASE_ADMIN_URL` = superuser URL of a disposable PostgreSQL 16+ cluster): fresh-database
  migrate, idempotent re-run, checksum lock, atomic failure, owner-only; schema/catalogue/privileges; audit
  immutability; SoD trigger; seeded catalogue; bootstrap and dev seed. Missing `TEST_DATABASE_ADMIN_URL` fails the
  whole project with "BLOCKED: no database".

**Owner from P1:** backend-workflow-engineer (the only writer of `migrations/**`).
