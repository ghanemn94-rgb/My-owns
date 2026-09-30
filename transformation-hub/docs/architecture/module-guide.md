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
  `{ org: '<perm>' }`. Lists use `PageQuery` + `paged(Item)` and declare their sort keys (`sort: SortParam([...])`, see "List sorting" below). Mutations that change status are **commands**
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
evidence.changed, perimeter.changed, permission.changed, document.changed, report.generated, baseline.approved,
change_request.decided, readiness.changed, legal_entity.changed`. Emit them from your
commands; subscribe in `<module>.jobs.ts` (`registry.subscribe(eventType, jobKind)`; `registry.register(jobKind, handler)`).
Job handlers receive ids only and must open their own context through `JobContextFactory` (never build a principal by
hand): `db.run(jobs.forService(job, 'svc-<module>', ['<permission>', ...]), ...)` — a service principal is **deny-all
except the listed permissions** — or `jobs.forUser(userId, projectId)` for anything user-facing, which re-authorizes the
human principal at execution time and returns `null` when access was revoked (AT-19).

### Cross-module contracts
- Evidence: the documents module owns `evidence_link` writes (`POST /api/v1/projects/:pid/evidence`); other modules read
  counts with `activeEvidenceCount(db, projectId, targetType, targetId)` **for rules** (gates, sign-off, verification: every
  link counts) and with `visibleEvidenceCounts(db, policy, ctx, projectId, targetType, ids)` **for display** (register rows,
  detail views): the same visibility as the evidence list — links to documents above the caller's clearance or in rooms
  they are not granted are not counted (SEC-P1R-05). Reading evidence of a record (list, link commands, document
  counters) requires the target's READ permission (`EVIDENCE_TARGET_READ_PERMISSION` in `@hub/domain`, e.g. `jv.deal.read`
  for a closing condition) plus the target's own visibility (classification, workstream reach); otherwise 404
  (SEC-P1R-04). A new target type needs an entry in both `EVIDENCE_TARGET_PERMISSION` and `EVIDENCE_TARGET_READ_PERMISSION`. Target types used: `gate_criterion`,
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
- **Workstream-scoped reach:** when a list or count is structured by workstream, filter it with
  `policy.reachSql(ctx, '<permission>', projectId, table.workstreamId)` — a workstream-only role (e.g. a lead without a
  project role) sees only its workstreams; `policy.permissionReach(...)` tells you whether the grant is project-wide.
- **Raw SQL inside a request** goes through `db.query(text, params)` (runs on the request transaction) or `db.tx()`;
  never `db.pool` (that is autocommit, outside the RLS context and outside the atomic change + audit + outbox unit).
  Do not keep a `tx` handle beyond the request: it throws once the transaction has finished.
- **Response contracts are strict:** fields not declared in the route's `response` schema are stripped in every mode
  and fail tests (`contract.response_mismatch: undeclared field(s) …`). Declare what the screen needs; nothing more.
- **List sorting is an allow-list (QA-P1-13):** every list route declares its sort keys in its contract —
  `PageQuery.extend({ sort: SortParam(['code', 'title', 'dueDate', 'updatedAt']) })` accepts `key` (ascending) and
  `-key` (descending) and rejects anything else with 400 `validation_failed`. A list without a meaningful order
  (relevance ranking, audit feed) declares none (`sort: NoSort`, the `PageQuery` default) and rejects every `sort`.
  The service maps each key to its column(s) with `orderBySort(q.sort, { code: T.code, … }, T.id, defaultOrder)`
  (`apps/api/src/platform/sort.ts`; the compiler requires every declared key): NULLs last, the row id in the same
  direction as tiebreaker, `defaultOrder` when no sort is given. Only the ORDER BY changes — never the WHERE clause,
  so scope, visibility, reach and totals are unaffected. `packages/contracts/src/sort.test.ts` checks every list route.
- **Bilingual server strings (QA-P1-14, REQ-UX-001/002):** the API returns both languages and the web picks by locale;
  the server never selects a language for data and never machine-translates.
  - *Bilingual data* (template-seeded names/titles, bilingual user input): `<field>` = English/primary text,
    `<field>Ar: string | null` = Arabic text (null when there is no Arabic source). Examples: `name`/`nameAr`
    (templates, gates, workstreams, phases, next gate), `title`/`titleAr` (tasks, milestones, deliverables, schedule
    nodes, readiness checks), `description`/`descriptionAr` (criteria), `purpose`/`purposeAr` (gates — from the pinned
    template version while the stored purpose is still the template's). Web: `useLocalized()` / `localized(locale, x, xAr)`
    from `apps/web/src/lib/i18n-data.ts`; with no Arabic text the primary text is shown as-is.
  - *Server-computed explanations*: the rule returns codes + parameters (`ServerMessage { code, params }`, see
    `packages/domain/src/messages.ts`) and renders the English sentence from the same messages with its code → English
    template table (e.g. `DIMENSION_MESSAGES_EN`, `GATE_MESSAGES_EN`). The API returns `<field>` (English — kept for
    audit rows, record history, AI context) plus `<field>I18n: ServerMessage[]` (e.g. `explanation`/`explanationI18n`,
    `message`/`messageI18n`, `blocker`/`blockerI18n`). Parameters are numbers, record keys or enum values (the web
    translates enum values; register them in `ENUM_PARAMS` of `i18n-data.ts`). Web: `useServerMessages()(xI18n, x)`
    translates `gates.messages.<code>` (en + ar); `node apps/web/scripts/check-i18n.mjs` fails when a domain code has no
    translation, when placeholders differ, or when the catalogue keeps a stale code. Adding a code = domain template +
    en/ar catalogue entry in the same change.

- **Separation of duties and authority fail CLOSED (I-R3).** For a permission with `not_self`, pass the subject's
  requester / submitter / recorder id; a missing (undefined or null) id is **403 `policy.sod_subject_unknown`** — nobody
  may approve a record whose requester is unknown. For a permission with `authority`, pass `withinAuthority` explicitly
  (`true` only when the authority is the role grant itself, with the reason at the call site); `undefined` is 403
  `policy.authority_unknown`. `NO_HUMAN_REQUESTER` (from `@hub/domain`) states that NO human requester exists — only when
  the data proves it (a system-generated escalation; a criterion reviewed with no evidence linked). Approvals check in the
  order **role → state → separation of duties** with `policy.assertApproval(ctx, perm, res, () => transition(...))`, so a
  command in the wrong state is still 422; pre-checks before a per-subject loop use `policy.assertGranted` (never the only
  check of an approval).
- **Activity feed visibility (SEC-P1-03, SEC-P1R-02):** an event is listed only when the caller can see the record itself.
  `apps/api/src/platform/record-visibility.ts` (`RecordVisibility`) holds one rule per entity type — own classification /
  room, visibility INHERITED from the parent (meeting / agenda item / membership / authority matrix → committee; action /
  escalation → decision; source claim → source record; document version → document; evidence link → document + target;
  AI proposal / approval request / waiver / RAG override → target) and, for non-auditors, the workstream reach of the
  type's read permission. **A new audited entity type whose visibility is not just its type permission must get a rule
  there** (and an entry in `ACTIVITY_ENTITY_PERMISSION` to appear for non-auditors).
- **Shared legal entities have ONE owning project (SEC-P1R-03).** `legal_entity` is organization-level and can be linked
  to several projects (`project_entity`). Only the project that created it (`legal_entity.owner_project_id`, set by
  `LegalEntitiesService.create` / project creation, immutable) changes it: descriptive edits (`PATCH …/legal-entities/:id`),
  incorporation record / verify and the setup-wizard NewCo step. Linked projects read it (`ownedByThisProject: false`) and
  get **403 `newco.legal_entity.not_owner`** for those commands (the owning project is not named). The database enforces
  the same rule (restrictive RLS on UPDATE for full members of the owner; owner column immutable). Each change in the owning
  project emits `legal_entity.changed` once per OTHER linked project (ids via the SECURITY DEFINER function
  `hub_legal_entity_linked_projects`, callable by owner members only): the NewCo job records
  `newco.legal_entity.changed_in_owning_project` in that project's activity (ids, change kind, version — no notes or
  people) and the gates job recomputes its status dimensions. Apply the same single-writer model to any future
  organization-level record shared by projects.

### Conventions the DATABASE enforces (post-migrate.sql — your tests will fail if you ignore them)
- `project_id` and `org_id` are **immutable** after insert (`immutable_scope`). Moving a record between projects is a
  re-create command, never an UPDATE.
- A uuid column named `*_user_id` or `*_by` **is a user reference**: it automatically gets a composite FK
  `(org_id, col) → app_user(org_id, id)`. Tests must use real user ids (e.g. `demoUserId('pm')`), not random uuids.
  Name record references `*_id` (e.g. `superseded_by_id` is a record, `superseded_by` would be treated as a user).
- Every `(org_id, project_id)` must match the project's organization (composite FK to `project(org_id, id)`).
- Avoid id lists (jsonb / uuid[]); use a child table with composite FKs. If unavoidable, ask the lead to register the
  column in section 16 of `post-migrate.sql` (every element must be a same-project record).
- `document.current_version_id` must be a version of the same document (deferred check at COMMIT, so insert order
  inside one transaction does not matter).
- `vote.user_id` must be the user of `vote.membership_id`, and the membership must belong to the decision's committee.
- Room-only principals (clean team / external partner) see only their own `project_membership` and `room_grant` rows
  and can never write grants; full membership is required to administer rooms.
- An account holding internal roles or grants cannot be switched to `account_type = 'external'` (I-R1): revoke them first.
- `legal_entity.owner_project_id` is immutable; only full members of the owning project UPDATE a legal entity (SEC-P1R-03).
- Service / non-person accounts (`is_service_account`) never hold an interactive session: `hub_auth_session` reports them
  inactive and OIDC login refuses them (`oidc.service_account`, I-R5).

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
