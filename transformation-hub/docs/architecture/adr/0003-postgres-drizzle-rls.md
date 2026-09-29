# ADR-0003 — PostgreSQL as source of truth, Drizzle ORM, row-level security for isolation

- Status: Accepted · Date: 2026-09-29
- Requirements: spec §13–15 (isolation "in APIs, appropriate database/row policies…"), AT-03

## Decision
- PostgreSQL 16 is the single source of truth. Drizzle ORM defines the schema (`packages/db/src/schema/*`), drizzle-kit
  generates SQL migrations (`packages/db/migrations`), and `sql/post-migrate.sql` applies idempotent security DDL.
- **The ORM does not enforce isolation.** Isolation is layered:
  1. API: every query is filtered by `project_id` and authorized by `PolicyService` (deny by default).
  2. Schema: composite FKs `(project_id, x) → target(project_id, id)` make cross-project links impossible even if a
     foreign id is submitted.
  3. Database: RLS policies on every table with `project_id` (and `org_id`-only tables) use transaction-local settings
     `app.org_id`, `app.user_id`, `app.project_ids` set by the API/worker at the start of each transaction.
- Roles: `hub_owner` owns objects and runs migrations; `hub_app` is the runtime role — not owner, `NOBYPASSRLS`, no DDL,
  INSERT/SELECT only on append-only tables.
- The only RLS bypasses are two narrow `SECURITY DEFINER` functions for authentication (session lookup, org by slug) and
  the audit chain trigger/verifier.

## Consequences
- Every request runs inside one transaction (needed to scope `set_config(..., true)`), which also gives atomic
  business change + audit + outbox.
- Tables exempt from RLS (infrastructure): `job`, `outbox_event`, `scheduled_job`, `delivery_record`, `session` — see ADR-0004.
- Row policies are defense in depth; application authorization remains mandatory and tested separately.
