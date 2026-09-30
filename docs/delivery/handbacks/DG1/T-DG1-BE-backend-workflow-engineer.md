# Handback: T-DG1-BE (backend-workflow-engineer)

- **Stage/gate:** P1 / DG1 (BUILDING). Engineering gate only: nothing here grants or implies a product G1–G6 business
  approval, and no real business, Finance or IT approval was given.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG1-T-DG1-BE-backend-workflow-engineer-20260930T210222Z-bcf310c1","session_id":"bcf310c1-2156-4c3c-be49-422ec170781b"}`.
- **Assignment:** `docs/delivery/assignments/DG1/T-DG1-BE.md`, sha256 `55a331750b2f245bf5f96cc7bb2e87ac98ba5794a30f35acaf68766a534f3a54` (verified with `sha256sum`).
- **Starting revision:** HEAD `8d9bc78e9ed6381f7a034c69927b21e4e623f262`. `git diff --stat 41be5ca HEAD` touches only
  the four `docs/delivery/assignments/DG1/*.md` files, so HEAD is the base plus assignment metadata. Pre-existing
  untracked root dotfiles, `CLAUDE.local.md` and `docs/delivery/runs/DG1/` are **not mine**.
- **State of my work:** all changes are **uncommitted** in the working tree (I commit only when asked; the
  orchestrator integrates).

## Status: COMPLETE for the assigned P1 scope, with 1 frozen-file request that affects how tests resolve packages

Every "Deliver (P1)" item is implemented and covered by tests that ran against a real, disposable PostgreSQL. Please
read **Requests to the orchestrator** before integrating: R-1 changes how `vitest` resolves workspace packages (a
frozen root file), and R-2 lists contract gaps that the contract tests surfaced.

## 1. Changed files

### `packages/db` (migrations, runner, CLI, types, test DB)
| File | Purpose |
|---|---|
| `migrations/0001_identity_access.sql` | organization, business_unit (+ `business_unit_closure` view), app_user (+ `actor_display` view), user_identity, session, oidc_login_state, role, permission, role_permission with **SoD trigger** `role_permission_no_admin_approver` (also on `role.kind` and `permission.category` updates), scoped_assignment, delegation; owner/role guard; grants |
| `migrations/0002_transformation.sql` | transformation (all dictionary CHECKs, composite BU FK) + `scope_node` view for the policy function; grants |
| `migrations/0003_audit_event.sql` | audit_event + **append-only trigger** `audit_event_immutable` (row UPDATE/DELETE, statement TRUNCATE); `mth_app`: INSERT, SELECT only |
| `migrations/0004_outbox_jobs.sql` | outbox_event, processed_message, idempotency_record; grants |
| `migrations/0005_seed_roles_permissions.sql` | 16 permissions, 14 roles (fixed UUIDs), 72 links, generated from `permissions.ts` (Arabic names provisional) |
| `migrations/0006_pgboss_schema_v25.sql` | pg-boss 11.0.0 schema v25, generated from `PgBoss.getConstructionPlans("pgboss")` minus its own transaction wrapper; runtime grants for `mth_app` (no DDL) |
| `src/schema.ts` | Kysely `Database` interface + `SCHEMA_COLUMNS` runtime catalogue (compile-time complete; test-compared with `information_schema`) |
| `src/pool.ts` | pool (UTC sessions, statement timeout), Kysely factory, `withTransaction`, URL `options` merge |
| `src/migrate.ts` | forward-only runner: advisory lock, one tx per file, checksum lock, refuses DB-newer-than-build; `migrationStatus` (used by `/readyz`) |
| `src/audit.ts` | the single `audit_event` insert path (`insertAuditEvent`, tx-only) + allow-listed `diffFields` |
| `src/bootstrap.ts` | `mth-db bootstrap`: first organization + admin (ADM_ACCESS + ADM_TECH, **no business role**), audited, refuses when an organization exists |
| `src/dev-seed.ts`, `seeds/dev/synthetic-dev-users.json` | `mth-db seed-dev`: **synthetic** dev-login users (issuer `urn:mth:dev-local`), refused with `NODE_ENV=production` or `AUTH_MODE≠dev`; `seeds/` is not in `files` |
| `src/cli.ts` | `mth-db migrate | status | bootstrap | seed-dev` (status exit 0 up to date / 3 pending / 4 drift) |
| `src/constants.ts`, `src/index.ts` | constants moved out of index; public surface |
| `src/seed.test.ts` | unit: seed SQL == `permissions.ts`; migration file rules |
| `test/global-setup.ts`, `test/helpers.ts` | disposable DB per run (roles created NOLOGIN if missing; DB owned by `mth_owner`; migrations applied by the **real CLI**); "BLOCKED: no database" when `TEST_DATABASE_ADMIN_URL` is absent |
| `test/integration/{migrate,catalogue,protection,bootstrap}.test.ts` | runner, schema drift, privileges, audit immutability, SoD trigger, seeded catalogue, bootstrap/seed-dev |
| `README.md` | usage, migration table, prerequisites, CLI |

### `packages/config`
| File | Purpose |
|---|---|
| `src/load.ts` | zod loader over the frozen `ENV_VARS`: per-service requirements, `*_FILE` secrets, dev-in-production refusal, OIDC all-or-nothing, https issuer in production; errors name variables, never values |
| `src/index.ts` | **appended one re-export line only**; `ENV_VARS` untouched |
| `src/load.test.ts`, `README.md` | unit tests; usage |

### `packages/shared/src/schemas` (lockstep with `docs/api/openapi.yaml`)
| File | Purpose |
|---|---|
| `access.ts` | **bug fix**: `roleAssignmentCreate` compared timestamps as strings (wrong across offsets); `uniqueItems` mirrored for `Role.permissions` and `Me.effectivePermissions[].permissions` |
| `common.ts` | `uniqueArray` helper |
| `events.ts`, `index.ts` | outbox payload schema `transformation.created` v1 + envelope (internal API→worker messages, **not** an OpenAPI component) |
| `schemas.test.ts` | unit tests for the two fixes |

### `apps/api`
| File | Purpose |
|---|---|
| `src/server.ts` | composition root `buildServer` (helmet strict same-origin CSP, cookies, rate limits, modules, optional SPA) |
| `src/main.ts` | process entry (`node dist/main.js`); exit 78 on invalid configuration; graceful shutdown |
| `src/index.ts` | public surface (no side effects) |
| `src/modules/platform/*` | problem+json, request IDs, zod validation → pointers, ETag/If-Match, cursors bound to filters, Idempotency-Key, `/healthz`, `/readyz`, route-access declaration guard (startup) and fail-closed response guard |
| `src/modules/audit/index.ts` | API audit writer (request ID, source api) + transformation audit query |
| `src/modules/access/*` | **the policy function** (`rules.ts` pure, `policy.ts` DB: `authorize`, `requireRead` 404, `requireAction` 403, `scopeFilter` in SQL), assignments service, role catalogue, denied-mutation audit hook, request principal |
| `src/modules/identity/*` | sessions (hash only), CSRF token, OIDC (PKCE/state/nonce, subject binding, JIT), dev login, logout, `/me`, preferences, user repository |
| `src/modules/organization/*` | organizations and business units (cycle/depth checks) |
| `src/modules/transformations/*` | CRUD, archive, audit trail endpoint, transitions, code generation, outbox write |
| `src/modules/jobs/index.ts` | transactional outbox writer (payload validated) |
| `src/modules/admin/*` | users, roles, permissions, role assignments |
| `src/**/*.test.ts` | unit: policy rules, platform, transitions, **architecture test** (ADR-0002), route registration |
| `test/support/{harness,contract,fake-idp}.ts` | integration harness; OpenAPI validator (responses + accepted requests); local fake OpenID Provider |
| `test/integration/*.test.ts`, `test/integration/contract/contract.test.ts` | access scope (A12 first cases), transformations (A14 first cases), identity, OIDC, organizations, admin, platform, contract + route coverage |
| `package.json` | **`scripts` only**: `dev`/`start` → `src/main.ts` / `dist/main.js` |
| `README.md` | usage |

### `apps/worker`
| File | Purpose |
|---|---|
| `src/queues.ts` | queue names, retry policy (5 × from 10 s, backoff), `ops.failed`, pg-boss factory (`migrate:false`), `ensureQueues`, purge schedule |
| `src/relay.ts` | outbox relay: per-event tx, `FOR UPDATE SKIP LOCKED`, send **in the same tx** (job id = event id), mark published |
| `src/handlers.ts` | `transformation.created` handler with `processed_message` ledger + service-actor audit; `purgeExpired` |
| `src/worker.ts`, `src/main.ts`, `src/index.ts` | runtime loop, entry point, public surface |
| `test/support.ts`, `test/integration/{outbox,maintenance}.test.ts` | A13 first cases, DLQ, restart, purge, schedule |
| `package.json` | **`scripts` only**: `dev`/`start` → `src/main.ts` / `dist/main.js` |
| `README.md` | usage |

## 2. Migrations and API endpoints

**Migrations** (apply in order with `mth-db migrate`; sha256 at handback time):
`0001_identity_access.sql` (bf5707da…bbd55), `0002_transformation.sql` (acd0ff65…18e1), `0003_audit_event.sql`
(f565243d…195b), `0004_outbox_jobs.sql` (747085fb…11da), `0005_seed_roles_permissions.sql` (1624ae8e…f416),
`0006_pgboss_schema_v25.sql` (6b83d3f0…b1e).

**Endpoints** — all 32 operations of `docs/api/openapi.yaml`, nothing more (route coverage test, both directions):
`GET /healthz`, `GET /readyz`; `GET /api/v1/auth/login`, `GET /api/v1/auth/callback` (only with OIDC configured),
`POST /api/v1/auth/dev-login` (only with `AUTH_MODE=dev`), `POST /api/v1/auth/logout`; `GET /api/v1/me`,
`PUT /api/v1/me/preferences`; `GET|POST /api/v1/organizations`, `GET|PATCH /api/v1/organizations/{id}`,
`GET|POST /api/v1/organizations/{id}/business-units`, `GET|PATCH /api/v1/business-units/{id}`;
`GET|POST /api/v1/users`, `GET|PATCH /api/v1/users/{id}`; `GET /api/v1/roles`, `GET /api/v1/permissions`;
`GET|POST /api/v1/role-assignments`, `GET /api/v1/role-assignments/{id}`, `POST /api/v1/role-assignments/{id}/revoke`;
`GET|POST /api/v1/transformations`, `GET|PATCH /api/v1/transformations/{id}`,
`POST /api/v1/transformations/{id}/archive`, `GET /api/v1/transformations/{id}/audit`.

## 3. Behaviour delivered, per requirement

**DG1-completing rows**
| Requirement | Delivered |
|---|---|
| REQ-S16-001 | Modular monolith: one API process + a **separate worker process** sharing only PostgreSQL; module map enforced by `apps/api/src/architecture.test.ts` (imports, public surfaces, acyclic graph, package direction). |
| REQ-S16-003 | TypeScript API with explicit modules platform/audit/identity/access/organization/transformations/jobs/admin (P1); reserved names untouched. |
| REQ-S16-004 | PostgreSQL for records, configuration (roles/permissions), durable workflow state (outbox, ledger, pg-boss). |
| REQ-S19-004 | Migrations 0001–0006 apply to a **fresh database** (global setup via the real CLI + dedicated tests + built-CLI smoke); constraints, indexes, grants and triggers per the data dictionary; schema types test-compared with `information_schema`. |

**P1 increments touched**
| Requirement | Increment delivered |
|---|---|
| REQ-S10-001/002/004, REQ-S20-012 (A12) | Scoped RBAC through one policy function + SQL scope filter; 404/403 rule; per-request grant loading (revocation effective next request); cross-org, sibling, inheritance and technical-admin tests. |
| REQ-S10-003, REQ-S06-010 | SoD trigger (admin role ↔ approval permission, three paths); API defence (422 `sod.admin_approver`); technical admins hold no `transformation.read`; bootstrap admin gets no business role; self-grant refused (422 `access.self_grant`). |
| REQ-S16-005, REQ-S20-013 (A13), REQ-S12-004 | Outbox + relay + idempotent handler + ledger + bounded retries + `ops.failed` + purge cron in `Asia/Riyadh`; restart without job loss. |
| REQ-S16-026, REQ-S20-014 (A14) | `version`/ETag/If-Match on every mutable resource; 428 missing, 409 stale with `currentVersion`, nothing written or audited on 409; concurrent-writer test. |
| REQ-S16-032 (via S16-022 group) | Audit event on every mutation (incl. login/logout/dev-login/failures and denied mutations), same transaction, append-only by privilege and trigger. |
| REQ-S16-011, S16-012 (Transformation) | Identity/access entity tables (Group deferred to P6 per ADR-0006) and the Transformation table. |
| REQ-S16-023 | Canonical FKs (`ON DELETE RESTRICT`), uniqueness, explicit status transitions (422), archive instead of delete, archived read-only. |
| REQ-S16-027 | Versioned `/api/v1`, zod validation, RFC 9457 problems with `code`/`requestId`, cursor pagination bound to filters. |
| REQ-S16-030 | Server-side sessions (hash only, idle/absolute expiry, rotation), CSRF token + Origin, rate limits, strict CSP, parameterised SQL, log redaction. |
| REQ-S16-007 | OIDC code + PKCE + state + nonce with `openid-client`; (issuer, subject) binding; verified-email binding; JIT without roles. |
| REQ-S16-010 | Typed relational tables; JSON only for validated outbox payloads and allow-listed audit diffs. |
| REQ-S19-002/003/005/010, REQ-S01-002 | Worker/shared schemas in the repo; `/healthz` + `/readyz` (DB + migrations incl. checksums); safe initialization (`bootstrap`, dev seed separated); `productName` from config in `/me`. |
| REQ-S15-008 | Organization defaults Asia/Riyadh + SAR (from `DEFAULT_TIMEZONE`/`DEFAULT_CURRENCY`), copied into transformations; UTC DB sessions; `timestamptz` only (tested). |
| REQ-PB-003 | Create with End-to-End/Modular + entry phase + optional standalone deliverable; current phase = Diagnose / entry phase. |
| REQ-S20-031 | Unit/integration/contract tests at the right level; the integration project reports **BLOCKED: no database** instead of skipping. |
| REQ-DLV-005/008/011/012/024 | Own scope only (verified by `git status`), starting revision verified, `--historical` validation run first, this handback. |

Not touched (other owners or later stages): REQ-DLV-025/042 (orchestrator/devops), REQ-S15-00x UI rows, REQ-S16-006
(evidence storage), REQ-S16-008 (images/Compose), REQ-S18-001 demo environment (only the dev seed exists), and the
remaining REQ-DLV rows, which are process rules for the orchestrator.

## 4. Checks actually run

Environment: this sandbox, Node v22.22.2, pnpm 10.33.0, TypeScript 6.0.2, Vitest 3.2.4, **PostgreSQL 16.13** (the ADR-0003
floor; PG 18 is not installed here, so CI must run the same suites on 18). No network. Date 2026-09-30.

**How PostgreSQL was run:** the sandbox is uid 0 and Postgres refuses root; unix sockets are blocked and every shell
command has its own network namespace. A scratch wrapper (not in the candidate) therefore runs, **inside one command**:
`unshare --user --map-user=1000 --map-group=1000 initdb …` and `postgres … -c unix_socket_directories='' -c
listen_addresses=127.0.0.1 -p 54329 -c fsync=off`, exports
`TEST_DATABASE_ADMIN_URL=postgresql://postgres@127.0.0.1:54329/postgres`, runs the given command, and deletes the
cluster. Reviewers in the same sandbox need the same approach.

| # | Command | Result |
|---|---|---|
| 1 | `node tools/gates/validate.mjs --stage DG0 --historical` (before starting, and again at the end) | `PASS gate DG0 (historical)`, exit 0 (also `--pipeline`: `PASS pipeline (active stage: DG1 BUILDING)`) |
| 2 | `pnpm -r typecheck` | 7 projects `Done`, exit 0 |
| 3 | `pnpm -r build` | 7 projects `Done`, exit 0 |
| 4 | `pnpm lint` | no findings, exit 0 |
| 5 | `pnpm openapi:lint` | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 32 operations`, exit 0 |
| 6 | `pnpm check:no-cdn` | `PASS no-cdn: scanned apps, packages`, exit 0 |
| 7 | `pnpm test` (unit-node + unit-web, root config) | `Test Files 8 passed (8)`, `Tests 45 passed (45)`, exit 0 |
| 8 | `<pg-wrapper> pnpm test:integration` (root config, after #3) | `[integration] PostgreSQL 16.13 …; applied 6 migrations to a fresh database`, `Test Files 14 passed (14)`, `Tests 157 passed (157)`, exit 0 |
| 9 | `npx vitest run --project integration` **without** `TEST_DATABASE_ADMIN_URL` | `Error: BLOCKED: no database. …`, exit 1 (negative check, as designed) |
| 10 | Built-artefact smoke on a fresh DB (`<pg-wrapper> e2e-smoke.sh`, scratch) | see below, exit 0 |
| 11 | Architecture test negative probe: planted `import "../access/policy.ts"` in a transformations file | test failed with `…only access/index.ts is public`; import removed afterwards |
| 12 | `npx prettier --check` on my files | clean (pre-existing unformatted frozen/architect files, e.g. `packages/shared/src/constants.ts`, `schemas/transformation.ts`, were left untouched) |

Output tail of #10 (built `dist/` artefacts, AUTH_MODE=dev, synthetic users):
```
== mth-db status (before)   -> 6 pending, exit=3
== mth-db migrate           -> applying 0001 … 0006; applied 6 migration(s), exit=0
== mth-db status (after)    -> mth-db status: up to date (6 applied), exit=0
== mth-db seed-dev (AUTH_MODE unset) -> refusing to seed synthetic dev users unless AUTH_MODE=dev, exit=1
== mth-db seed-dev          -> seeded SYNTHETIC dev users: dev.admin, dev.office, dev.lead, dev.auditor, dev.nobody
== api with NODE_ENV=production AUTH_MODE=dev -> "AUTH_MODE=dev is refused when NODE_ENV=production", exit=78
healthz: {"status":"ok"}
readyz:  {"status":"ready","checks":{"database":"ok","migrations":"ok"}}
dev-login: 204
create: {"id":"…","code":"TR-0001","name":"Synthetic e2e",…}
worker ledger rows for the new transformation: 1
audit trail: transformation.starter_automation_requested@service, transformation.create@user
{"level":"info","msg":"job handled","queue":"transformation.created",…,"outcome":"done"}
```

**Acceptance checks of the assignment**
1. Build + migrate a fresh DB + `mth-db status` up to date: #3, #8 (global setup via the CLI), #10.
2. `pnpm -r typecheck` and `pnpm -r build`: #2, #3.
3. Integration on real PostgreSQL; every response validated against the OpenAPI document (every integration request,
   plus `contract.test.ts` covering all 32 operations with at least one success each, and zod mirrors); route
   coverage shows no unmatched operation in either direction: #8.
4. Cross-scope read/write denied (`access-scope.test.ts`); 409 with `currentVersion` (`transformations.test.ts`
   "update with optimistic concurrency (A14)"); relay idempotent (`outbox.test.ts` "outbox relay idempotency"): #8.
5. Audit on every mutation (per-suite `auditOf` assertions); UPDATE/DELETE/TRUNCATE rejected for `mth_app` and the
   owner; SoD trigger rejects every technical-admin role × approval permission (`protection.test.ts`): #8.

**Not run / BLOCKED**
| Check | Reason |
|---|---|
| Tests on PostgreSQL **18** | Only PG 16.13 is installed here (ADR-0003 floor). CI must run `test:integration` on 18. |
| OIDC against **Keycloak** | No Keycloak offline. OIDC ran against a local fake OpenID Provider with the real `openid-client` doing all validation. The Keycloak realm and e2e belong to devops/QA. |
| `pnpm deps:verify` | Needs the registry. I made **no dependency changes**, so there is nothing new to verify. |

## 5. Requests to the orchestrator (frozen files; I did not edit them)

- **R-1 (important) `vitest.config.ts`:** under Vite 7.1.11, `resolve.conditions: ["@mth/source"]` does not apply to
  Vitest's server-side (SSR) resolution. Workspace packages (`@mth/config`, `@mth/db`, `@mth/shared`) therefore load
  from **`dist/`**, not `src/`. Stale `dist/` folders from the skeleton build made the first run fail with
  `loadConfig is not a function`. **Today the suites are correct only after `pnpm -r build`** (that is how #7/#8 were
  run). Proposed fix: add
  `ssr: { resolve: { conditions: ["@mth/source"], externalConditions: ["@mth/source"] } }` to the `unit-node` and
  `integration` projects. I verified it with a scratch config (same projects + this block) on the final tree:
  `Test Files 22 passed (22)`, `Tests 202 passed (202)` (= #7 + #8), and `@mth/config` resolves to `src/`. CI should also build before testing until this is applied.
- **R-2 contract gaps** found by the contract tests (`docs/api/openapi.yaml`, solution-architect):
  - `createBusinessUnit` declares no **422**, although parent-in-same-organization and depth are business rules
    (`updateBusinessUnit` declares 422). **Implemented:** 400 with field errors on `/parentBusinessUnitId` (codes
    `business_unit.parent_invalid`, `business_unit.depth_exceeded`).
  - `updateUser` declares no **422**. **Implemented:** disabling yourself is **403** with code `user.cannot_disable_self`.
  - `createUser` accepts an empty `identity.issuer` (no `minLength`), but the database requires 1–512.
    **Implemented:** 400 on `/identity/issuer`.
  - **429** is declared only on the auth routes, but the global rate limit (ADR-0007) can return 429 on every
    operation. Suggest adding 429 (and `Retry-After`) to all operations.
- **R-3 policy location for the worker:** ADR-0006 says the worker calls the same policy function with a service
  principal. It lives in `apps/api/src/modules/access/`, which the worker must not import. The P1 handler needs no
  authorization decision. From P2, the pure rules (`rules.ts`) should move to a shared package; that is an architect
  decision.
- **R-4 interpretations to confirm** (solution-architect / domain):
  1. **Structural permissions apply downward.** `organization.*`, `business_unit.*`, `user.*`, `access.*` and
     `role.read` granted at a scope cover everything inside it, even for non-inheriting roles. For example, ADM_TECH
     at organization scope may update any BU in it, and ADM_ACCESS may assign at BU/transformation scope.
     Business-record permissions (`transformation.*`, `audit.read`, approvals) follow `inherits_downward` strictly.
  2. **Organization creation.** The creator receives, in the new organization, only the **technical-admin** roles they
     hold at organization scope (audited, reason recorded). Otherwise nobody could ever administer the new
     organization.
  3. **Session revocation on assignment changes.** Revoking an assignment also revokes the user's sessions (audited
     `session.revoke`). Granting does not, because grants are re-read on every request.
  4. **JIT OIDC provisioning** happens only when exactly one active organization exists; otherwise users must be
     pre-provisioned (`login?error=not_provisioned`).
  5. **Failed authorization of a mutation** on an existing record is audited as `authorization.denied`, in a separate
     transaction.
- **Dependency requests:** none.

## 6. Known gaps / not done

- `delegation` exists as a table only (logic P2/P4, per the assignment). Groups (`app_group`) are P6.
- The rate-limit store is in-process memory (ADR-0007 T-3), which is correct for one API instance; P6 adds a
  PostgreSQL store.
- An outbox event that fails to publish ten times stays unpublished with `last_error` for an operator. An operator
  view and retry action come later (ADR-0008 §4).
- Arabic role names and permission descriptions in `0005` are **provisional translations** that need linguistic
  review. The seeded role and permission defaults are a configurable starting point, **not** a Mobily-approved
  access policy.
- All demo/dev data is **synthetic** (`SYN-DEV`, `example.invalid` e-mail addresses).
- `pgboss.job.singleton_on` is `timestamp without time zone` by pg-boss design. The timestamptz-only rule is enforced
  (and tested) for the application schema `public`.

## 7. Merge instructions

1. Integrate first (p1-work-split §6). There are no textual conflicts with FE/DevOps paths.
2. **Deployment prerequisites (devops):** create the roles `mth_owner` and `mth_app`, create the database with
   `OWNER mth_owner`, then run `node packages/db/dist/cli.js migrate` with `DATABASE_OWNER_URL` (a one-shot before
   api/worker). Migration 0001 refuses any role other than `mth_owner`. The API and worker connect as `mth_app`.
3. **Start commands changed:** API `node apps/api/dist/main.js`, worker `node apps/worker/dist/main.js` (package
   `start` scripts). The first organization comes from
   `mth-db bootstrap --org-code … --org-name-en … --org-name-ar … --admin-name … --admin-issuer … --admin-subject …`.
4. Dev only: `AUTH_MODE=dev node packages/db/dist/cli.js seed-dev` (synthetic users `dev.admin`, `dev.office`,
   `dev.lead`, `dev.auditor`, `dev.nobody`).
5. **Tests:** run `pnpm -r build` first (see R-1), then `pnpm test` and `pnpm test:integration` with
   `TEST_DATABASE_ADMIN_URL` pointing to a superuser of a disposable PostgreSQL 16+ (CI: 18).
   QA can reuse `apps/api/test/support/harness.ts` (`startApi`, `seedWorld`, `signIn`, `call`). The `call` helper
   validates against the contract automatically.
6. Frontend: the session cookie is `mth_session` on `http://localhost` and `__Host-mth_session` on https. The CSRF
   token comes from `GET /api/v1/me` (`csrfToken`), sent as `X-CSRF-Token` with a same-origin `Origin`. The replay
   header `Idempotent-Replayed: true` marks a replayed create.

Agent count or agreement does not guarantee correctness. What counts is the independent review of this candidate, the
executed tests and reproducible evidence.
