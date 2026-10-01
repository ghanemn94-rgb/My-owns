# Read-only BI views (Power BI or another BI tool)

- Requirement: REQ-RPT-011 (spec §11 "BI-ready views or a documented API for Power BI within the approved architecture,
  using a restricted service account"); access-matrix §9 `bi_reader`; threat model DF-09, C-36, T-17.
- Implementation: `packages/db/sql/post-migrate.sql` §25 (views, role privileges, row-level security),
  `packages/db/src/schema/reporting.ts` (`bi_access_grant`), `apps/api/src/modules/reporting/bi-access.service.ts`
  (grant / revoke API), test `apps/api/test/reporting/bi-views.spec.ts`.
- Status: **Implemented and tested against PostgreSQL in this environment. No BI tool is connected** — the platform does
  not see the BI tool and never reports a BI connection as working (`connection: not_verified` in the API). Where the BI
  tool runs and how it reaches the database (gateway, network path) is a Mobily decision (threat model MQ-13).

## What a BI tool can read

A dedicated PostgreSQL login role, `hub_bi`, reads seven views in the schema `bi`. All views are
`security_invoker = true`: they run with `hub_bi`'s own privileges and row-level security, never the owner's.

| View | Columns | Rows |
|---|---|---|
| `bi.projects` | project_id, code, name, status, classification, planned_start, timezone | listed projects |
| `bi.status_dimensions` | project_id, dimension, state, computed_at | the four status dimensions of listed projects |
| `bi.milestones` | project_id, code, title, status, planned_date, forecast_date, actual_date, is_critical, gate_key, verification_status | milestones of listed projects |
| `bi.tasks` | project_id, wbs_code, title, status, planned_start, planned_finish, forecast_finish, actual_finish, gate_key, verification_status | tasks of listed projects |
| `bi.risks` | project_id, code, title, status, probability, impact, due_date, escalation_level | risks of listed projects |
| `bi.decisions` | project_id, code, title, status, authority_outcome, latest_safe_date, classification, outcome_recorded_at | decisions up to the grant's classification |
| `bi.report_snapshots` | project_id, snapshot_id, kind, title, as_of, as_of_local_date, classification, content_hash | report snapshot metadata (never the content) up to the grant's classification |

Records without their own classification (milestones, tasks, risks, status dimensions) take their project's
classification, as in the application.

## Who decides what is readable

- A project is readable only while it has an **active BI grant** (`bi_access_grant`), recorded by the project's
  **sponsor** through `POST /api/v1/projects/:projectId/bi-access` (permission `admin.clearance.grant`), with a
  **maximum classification** (`internal`, `confidential` or `restricted`) that can never exceed the sponsor's own clearance,
  and a reason. One active grant per project; a change is a revoke (`POST …/bi-access/:grantId/revoke`) and a new grant.
  Both are audited (`reports.bi_access.grant`, `reports.bi_access.revoke`).
- **Demo projects and demo rows are never readable**, whatever the grant.
- Partner-room and clean-team material is not in any view.
- A revoke takes effect on the next BI query (the rules are evaluated per query; nothing is cached on the platform side).

## How it is enforced in the database (defence in depth)

1. `hub_bi` is `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE` (post-migrate refuses to run if it is not).
2. Privileges: `USAGE` on schemas `public` and `bi`, `SELECT` on the `bi` views, and column-level `SELECT` on exactly the
   columns the views read (plus the grant / project columns the row filters need). `select * from decision`, any other
   table, and `report_snapshot.payload` are refused with "permission denied".
3. Row-level security on every table a view reads, for `hub_bi` only: a PERMISSIVE policy (so the role sees rows at all)
   AND a RESTRICTIVE policy with the same rule — `hub_bi_cleared(project_id, classification)`: an active grant, a
   non-demo project, a classification at or below the grant's. The RESTRICTIVE policy is what makes the application's
   session settings (`app.project_ids` …), which the application's own policies trust, useless to the BI role: setting them
   widens nothing (tested).
4. The application role `hub_app` has no privilege on the `bi` schema.

## Provisioning

- Development / test: `scripts/dev/pg-init-roles.sh` creates `hub_bi` with the development password.
- CI / production: `scripts/ops/db-init-roles.sh` creates `hub_bi` only when `HUB_BI_DB_PASSWORD` is set (the DBA keeps
  the password in the secret manager; it is never in the repository). Then run the migrations (post-migrate applies the
  privileges and policies); without the role, the views exist but nobody can read them.
- The BI tool connects with `hub_bi` to the database, read-only, ideally to a read replica, through the network path
  Mobily approves. Power BI connects with its PostgreSQL connector (or an on-premises data gateway for the service).

## Limits

- No API (OData / REST) for BI is offered; the views are the interface. An API would need a non-interactive service
  credential, which the platform does not issue yet (service accounts never hold an interactive session, I-R5).
- KPI values are computed by the application (`GET /api/v1/projects/:projectId/kpi-catalogue`) and are not in the views;
  a BI tool reads the registers and the report snapshot metadata.
- Not verified against a real Power BI tenant (no BI tool exists in this environment).
