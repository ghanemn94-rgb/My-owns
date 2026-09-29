# Module implementation guide (read before implementing any module)

This guide is binding for every implementation agent. Reference implementation: `apps/api/src/modules/portfolio/*`
(+ `identity`). Platform code in `apps/api/src/platform/*` is owned by the lead — do not modify it; ask the lead.

## 1. File ownership

| Module | API folder | Contracts | DB schema file | Domain rules | Web routes (under `apps/web/src/app/(app)/projects/[projectId]/`) | i18n namespace |
|---|---|---|---|---|---|---|
| documents | `modules/documents` | `documents.ts` | `documents.ts` | `packages/domain/src/documents.ts` (new) | `documents/` | `documents` |
| governance | `modules/governance` | `governance.ts` | `governance.ts` | `governance.ts` (+ `workflows.ts` DECISION/ACTION machines) | `committee/` | `governance` |
| planning | `modules/planning` | `planning.ts` | `planning.ts` | `schedule.ts`, `measurement.ts`, `workflows.ts` (TASK…) | `plan/`, `raid/`, `workstreams/[id]` tasks tab, `/inbox` | `planning` |
| gates | `modules/gates` | `gates.ts` | `gates.ts` | `gates.ts`, `carveout.ts#computeStatusDimensions` | cockpit gate panels, `gates/` | `gates` |
| carveout | `modules/carveout` | `carveout.ts` | `carveout.ts` (perimeter/transfer/agreement/consent) | `carveout.ts` | `perimeter/` | `carveout` |
| newco | `modules/newco` | `newco.ts` | `carveout.ts#regulatoryRequirement`, `portfolio.ts#legalEntity` (coordinate) | — | `newco/` | `newco` |
| readiness | `modules/readiness` | `readiness.ts` | `carveout.ts` (readiness/cutover/tsa tables) | `carveout.ts` (go/no-go, TSA) | `readiness/` | `readiness` |
| finance | `modules/finance` | `finance.ts` | `finance.ts` | `money.ts` | `finance/` | `finance` |
| jv | `modules/jv` | `jv.ts` | `jv.ts` | `carveout.ts` (closing/partner) | `jv/` | `jv` |
| ai | `modules/ai` | `ai.ts` | `ai.ts` | `ai.ts` | `ai/` | `ai` |
| reporting / imports / integrations / notifications / config | `modules/<m>` | `<m>.ts` | `reporting.ts`, `platform.ts` | — | `reports/`, `/admin` tabs | `<m>` |

Shared files you must NOT edit (lead-owned): `apps/api/src/{app.module,jobs,bootstrap,main,worker}.ts`,
`apps/api/src/platform/**`, `apps/api/src/cli/seed-demo.ts`, `seed-modules.ts`, `packages/contracts/src/{index,route,common}.ts`,
`packages/db/migrations/**`, `packages/db/sql/**`, `packages/domain/src/{index,enums,errors}.ts`, root `package.json`,
`pnpm-lock.yaml`. If you need a change there (new enum value, new shared helper, new permission, new outbox type), put
the exact proposed diff in your final report — the lead applies it. Exception: you MAY add `export * from './<yourfile>';`
lines to `packages/domain/src/index.ts` for new domain files you create (the lead resolves trivial merge conflicts).

Enum values already exist in `packages/domain/src/enums.ts` for all modules — read it first.

## 2. Backend pattern (NestJS)

- **Contract first** (`packages/contracts/src/<module>.ts`): `export const <module>Routes = registerRoutes({ ... defineRoute({...}) })`.
  Every route has `access` = a permission key from `packages/domain/src/policy/policy-matrix.json` (project routes) or
  `{ org: '<perm>' }`. Lists use `PageQuery` + `paged(Item)`. Mutations that change status are **commands**
  (`POST .../:id/<verb>`, `command: true`) with body `{ expectedVersion, note? , ...}`. Generic PATCH routes may only
  change descriptive fields and must never touch `status`/approval fields.
- **Controller**: thin; `@ApiRoute(R.x) handler(@Ctx() ctx, @Input() i: RouteInput<typeof R.x>)` → service.
- **Service methods** (in the request transaction via `DbService.tx()`):
  1. load the target with `loadInProject(db, table, projectId, id)` (404 if not in project),
  2. `policy.assert(ctx, '<perm>', { projectId, classification, roomId, requesterUserId, workstreamId, withinAuthority })`
     — pass every attribute the permission's conditions need (see policy JSON `conditions`). Visibility failures become 404.
  3. validate cross-references are in the same project (composite FKs also enforce this; still check to return 422/404 cleanly),
  4. apply the pure domain rule / state machine from `@hub/domain` (`transition('decision', DECISION_MACHINE, cur, 'submit')`),
  5. write with optimistic concurrency: `updateVersioned(db, table, { id, projectId, expectedVersion }, values)`,
  6. `audit.record({ action: '<perm or verb>', entityType, entityId, projectId, before, after, reason })`,
  7. `outbox.emit({ type, projectId, aggregateType, aggregateId, payload })` when other modules must react,
  8. `recordVersions.snapshot(...)` for versioned business records (perimeter items, agreements, charters, matrices…).
- **Lists**: filter by `projectId` AND visibility (`policy.canSee(ctx, {projectId, classification, roomId})`) *in SQL where
  possible*; totals only over visible rows. Never return titles of invisible rows.
- **Errors**: throw `ruleViolation(code, message, details)` (422), `conflict` (409), `notFound()` (404), `forbidden` (403),
  `invalid` (400) from `@hub/domain`. Never return stack traces.
- Money: decimal strings + currency + unitScale (`MoneySchema`), aggregation only via `sumMoney` (rejects mixed currencies).
- Dates: business dates `YYYY-MM-DD` (project timezone); "today" = `clock.today(project.timezone)` (inject `Clock`).
- Helpers: `apps/api/src/platform/helpers.ts` (`pageOf`, `offsetOf`, `updateVersioned`, `loadInProject`, `nextCode`,
  `activeEvidenceCount`, `RecordVersionService`), `JobQueue`, `OutboxService`, `AuditService`, `PolicyService`, `Clock`.
- Register your controller/providers in your own `<module>.module.ts`; job handlers in `<module>.jobs.ts`; demo scenario
  data in `<module>.seed.ts` (use your services via `args.asUser('<persona>', ctx => svc.method(ctx, ...))`; idempotent;
  every record `isDemo: true` — services should set `isDemo` from `project.isDemo`).

### Outbox events (from `OUTBOX_EVENT_TYPES`)
`task.overdue, source.updated, approval.pending, cp.changed, tsa.expiring, gate.blocked, decision.status_changed,
evidence.changed, perimeter.changed, permission.changed, document.changed, report.generated`. Emit them from your
commands; subscribe in `<module>.jobs.ts` (`registry.subscribe(eventType, jobKind)`; `registry.register(jobKind, handler)`).
Job handlers receive ids only and must open their own context: `db.run(serviceCtx, ...)` with
`scopes.servicePrincipal(orgId, projectId, 'svc-<module>')`; anything user-facing must be re-authorized for the human
principal at execution time (AT-19).

### Cross-module contracts
- Evidence: the documents module owns `evidence_link` writes (`POST /api/v1/projects/:pid/evidence`); other modules read
  counts with `activeEvidenceCount(db, projectId, targetType, targetId)`. Target types used: `gate_criterion`,
  `closing_condition`, `perimeter_item`, `transfer`, `readiness_check`, `tsa_service`, `decision`, `action_item`,
  `task`, `deliverable`, `milestone`, `legal_entity`, `regulatory_requirement`, `agreement`, `benefit`,
  `financial_snapshot`, `post_close_obligation`, `closing_deliverable`.
- Status dimensions: the gates module owns `status_dimension` recomputation (job `gates.recompute_dimensions`, triggered
  by `perimeter.changed`, `evidence.changed`, `cp.changed`, `tsa.expiring`, readiness/closing changes). Other modules just
  emit events.
- Approvals: use the `approval_request` / `approval_record` tables for approvals that are not committee votes (gate decision
  support, waivers, baselines, TSA exit, closing confirmation). Bind to `subjectVersion` + `payloadHash`.

### Mandatory patterns added after the P0 architecture review (read carefully)
- **Every submitted id** (path, body, query) is loaded with `loadInProject(db, table, projectId, id)` before use — the DB
  also enforces composite FKs and the polymorphic same-project trigger (allowed polymorphic target types are listed in
  `hub_target_table()` in `packages/db/sql/post-migrate.sql`; ask the lead to add a type).
- **Lists and counts** must use `policy.visibilitySql(ctx, projectId, { classification: table.classification, room: table.roomId })`
  in the WHERE clause (room-only principals — clean team / external partner — see only their rooms).
- **Responses must match the route's `response` schema exactly** — in test mode a mismatch fails with
  `500 contract.response_mismatch` (ResponseContractInterceptor). Return plain JSON (ISO strings for dates).
- **Jobs:** use `JobContextFactory` — `forService(job, 'svc-<module>', [permissions...])` for maintenance (explicit
  permission allowlist), `forUser(userId, projectId)` for anything user-facing (returns null if access was revoked → skip
  and record). Long jobs call `queue.extendLease(job, ms)`. External deliveries go through `DeliveryService`.
- Denied/rejected mutations are audited automatically by the problem filter; do not swallow domain errors.

## 3. Database changes
Edit only your schema file. For local testing run, in your worktree:
`pnpm --filter @hub/db build && (cd packages/db && rm -rf migrations/* && npx drizzle-kit generate --name initial_schema)`
— this regenerates the single pre-release migration (no production database exists yet). The lead regenerates it again on
merge; conflicts in `packages/db/migrations/**` are resolved by regeneration, never by hand-editing.
RLS applies automatically to any new table with `project_id` (see `packages/db/sql/post-migrate.sql`).

## 4. Tests (evidence)
- Integration tests: `apps/api/test/<module>/*.spec.ts`; acceptance tests named `at-XX-<slug>.spec.ts` with the AT id and
  REQ ids in the `describe` title. Use `test/helpers.ts` (`loginAs('<persona>')`, `owner()`, `runtimePool()`,
  `projectIdByCode(DC)`). Personas: see `DEMO_USERS` in `apps/api/src/cli/seed-demo.ts` (`pm`, `sponsor`, `chair`,
  `secretary`, `finance`, `legal`, `approver`, `tech.lead`, `ops.lead`, `contributor`, `auditor`, `portfolio.admin`,
  `platform.admin`, `pm.b`, `contributor.b`, `cleanteam`, `partner.alpha`).
- Use YOUR OWN test database so parallel agents don't collide: `createdb` is done by the lead —
  `TEST_DATABASE_URL=postgres://hub_app:hub_dev_only@127.0.0.1:5432/hub_test_<module>` and
  `TEST_DATABASE_MIGRATION_URL=postgres://hub_owner:hub_dev_only@127.0.0.1:5432/hub_test_<module>`.
  Run: `cd apps/api && TEST_DATABASE_URL=... TEST_DATABASE_MIGRATION_URL=... pnpm test` (builds, resets that DB, seeds, runs).
- Unit tests for pure rules: `packages/domain/src/<file>.test.ts` (`cd packages/domain && npx vitest run`).
- Tests must fail if the rule is removed (assert the server rejects the bypass, check the DB state didn't change, check
  an audit row with outcome `denied`/`rejected` exists for rejected mutations).
- Never weaken an assertion to pass; report defects.

## 5. Web pattern (after the web foundation lands)
See `docs/user-guide/web-foundation-notes.md` and existing pages. Use `api(route, {...})` from `apps/web/src/lib/api.ts`,
shared components from `apps/web/src/components`, i18n namespace `<module>` in both `en` and `ar`, `DemoBadge`,
`StatusBadge`, `VerificationBadge`, `RestrictedState`, `ActivityHistory`, `ConfirmCommandDialog` (sends
`expectedVersion`). Hide actions the user lacks permission for (`useProjectPermissions(projectId)`), but rely on the
server. No fake data: sections without a backend show `NotImplementedYet`.

## 6. Definition of done (per feature)
Contract → service with policy/validation/rules/tx/audit/outbox → controller → unit + integration tests (incl. negative
paths) → demo seed scenario → web screen with loading/empty/error/restricted states and bilingual text → OpenAPI builds
(`cd apps/api && npx tsc -p tsconfig.build.json && node dist/cli/openapi.js /tmp/openapi.json`) → report with real test
output and requirement IDs covered.
