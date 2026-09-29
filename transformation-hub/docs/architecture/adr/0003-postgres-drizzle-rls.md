# ADR-0003 — PostgreSQL as source of truth, Drizzle ORM, row-level security for isolation

- Status: Accepted · Date: 2026-09-29
- Requirements: spec §13–15 (isolation "in APIs, appropriate database/row policies…"), AT-03

## Decision
- PostgreSQL 16 is the single source of truth. Drizzle ORM defines the schema (`packages/db/src/schema/*`), drizzle-kit
  generates SQL migrations (`packages/db/migrations`), and `sql/post-migrate.sql` applies idempotent security DDL.
- **The ORM does not enforce isolation.** Isolation is layered:
  1. API: every query is filtered by `project_id` and authorized by `PolicyService` (deny by default).
  2. Schema: composite FKs `(project_id, x) → target(project_id, id)` on every concrete intra-project reference, and a
     `BEFORE INSERT/UPDATE` trigger `hub_assert_same_project(type_col, id_col)` (allowlisted type→table map) on every
     polymorphic reference (evidence links, waivers, approval requests, schedule dependencies, RACI, overrides, change
     requests, source claims, escalations, import rows, AI proposals). Denormalized ACL columns on `document_chunk` are
     derived from the parent document by trigger. Services additionally load every submitted id with `loadInProject`.
  3. Database: RLS policies on every table with `project_id` (and `org_id`-only tables) use transaction-local settings
     `app.org_id`, `app.user_id`, `app.project_ids` set by the API/worker at the start of each transaction.
- Roles: `hub_owner` owns objects and runs migrations; `hub_app` is the runtime role — not owner, `NOBYPASSRLS`, no DDL,
  INSERT/SELECT only on append-only tables.
- RLS bypasses are limited to narrow `SECURITY DEFINER` functions (all with `search_path = pg_catalog, public, pg_temp`
  and TEMP revoked from the runtime role): `hub_auth_session`, `hub_auth_org_by_slug`, `hub_auth_user_by_email`,
  `hub_auth_user_by_subject`, `hub_auth_user_by_id`, `hub_auth_user_scope`, `hub_audit_chain` (trigger),
  `hub_audit_verify` (own org only), `hub_audit_checkpoint`.
- **Room model (ARCH-02):** three GUCs — `app.project_ids` (all projects in scope), `app.full_project_ids` (projects with a
  project/workstream role) and `app.room_ids` (granted partner/clean-team rooms). Tables with `room_id` allow full members
  or in-room rows for room-only principals; `partner_room` allows the granted rooms; every other project table requires
  full membership, so clean-team and external-partner users see nothing outside their rooms at the database level.
  `PolicyService.canSee` / `visibilitySql` apply the same rule in the API.

## Consequences
- Every request runs inside one transaction (needed to scope `set_config(..., true)`), which also gives atomic
  business change + audit + outbox.
- Tables exempt from RLS (infrastructure): `job`, `outbox_event`, `scheduled_job`, `delivery_record`, `session` — see ADR-0004.
- Row policies are defense in depth; application authorization remains mandatory and tested separately.

## Limits (stated honestly — P0 architecture review ARCH-04)
- The RLS context is set by the application with `set_config`; any code running as `hub_app` can set it. RLS therefore
  protects against **missing filters and ID tampering through the API**, not against SQL injection or compromised
  application code. Parameterized queries (Drizzle) and code review are the controls for those.
- Foreign-key and trigger checks run with the privileges of the table owner/invoker as PostgreSQL defines; FK checks are
  not subject to RLS.
- The owner role (`hub_owner`) bypasses RLS (it is not used at runtime) and can disable triggers; see ADR-0014.

## Amendments after the P0 architecture RE-review (ARCH-21, ARCH-22, ARCH-23, ARCH-15b)
- `project_id` and `org_id` are immutable on every table (trigger `hub_scope_immutable`); moving a record between
  projects is a re-create, so existing references can never silently become cross-project links.
- `(org_id, project_id)` on every project table references `project(org_id, id)`; every user reference (`*_user_id`,
  `*_by`) references `app_user(org_id, id)` — generated in `post-migrate.sql`, so new module columns are covered.
- `document.current_version_id` is checked by a deferred constraint trigger (INSERT and UPDATE);
  `diligence_request.evidence_document_ids` elements must be same-project documents; votes are bound to the member of
  the deciding committee; notification sources are same-project.
- Exceptions to "project tables require full membership": `project_membership` (everyone sees their OWN rows; full
  members see the team) and `room_grant` (room-only principals see their own grants; only full members write grants).
- The API refuses to start in production when its database role is superuser, BYPASSRLS or owns tables (`DbService`
  self-check); elsewhere it logs a security warning.
