# Handback T-DG6-BE-E: `SecretProvider`, rate-limit classes, the security view, the global audit API (backend-workflow-engineer)

- **Stage:** P6 "Integration and system hardening", gate DG6 (BUILDING). Section: `docs/architecture/p6-work-split.md` §E/F.7.
- **Invocation:** run `DG6-T-DG6-BE-E-backend-workflow-engineer-20261026T195909Z-e2d8bc34`, session `e2d8bc34-6dea-4668-af9b-9a1fb856ecbf`. That run was stopped by a container restart, and its record is kept as `…-orphaned` (D-198).
- **Continuation (T-DG6-BE-EB):** run `DG6-T-DG6-BE-EB-backend-workflow-engineer-20261026T213401Z-bd01601b`, session `bd01601b-88f7-4d3e-9e0f-17780dd34e96`. Assignment `docs/delivery/assignments/DG6/T-DG6-BE-EB.md`, sha256 `606049be3558e620f672ff4391da256c42be32c41da6fa773a1da4d882991fb0` (verified). **Everything marked [EB] in this file was changed or re-run in the continuation.**
- **Assignment (original):** `docs/delivery/assignments/DG6/T-DG6-BE-E.md`, sha256 `f4196fb0c9447628264491a925b022914838b6c3b60b488ef449da4e6aaa4c5e` (verified by the original run).
- **Working tree:** worktree `/home/user/wt/dg6-be-e`, branch `dg6/be-e`. The original run's work is in the orchestrator's salvage commit `5a9887f` (WIP) on top of base `1c061ab8b9dae8ae5fce31dd261299024d014f56`. [EB] The continuation's changes are **uncommitted** on top of `5a9887f`, as the assignment requires.
- **Time:** the original run started `Mon Oct 26 19:59:21 UTC 2026`. [EB] The continuation started `Mon Oct 26 21:44:09 UTC 2026`; its end is in §0.
- **Two gate systems.** Nothing here reads or writes DG0–DG7. Reading the audit trail or the rate-limit matrix approves nothing. No agent, seed or test grants a G1–G6 business, Finance or IT approval. All test data is synthetic.

## 0. Checks actually run ([EB]; logs in `T-DG6-BE-E-evidence/eb-*.log`)

[EB] Every command below was run by the continuation in `/home/user/wt/dg6-be-e`. Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline; harness ports 23850–23899 only. Each exit code is the `EXIT=` line its log ends with. No `.claude/.cc-writes` directory existed in the source folders.

**Tree states.**
- **T0** is the salvage commit `5a9887f` as found.
- **T1** is T0 plus the two continuation test-file changes (§2 [EB]), the final tree.
- The T1 change touches only `apps/api/test/support/harness.ts` and `apps/api/test/integration/admin/security.test.ts`. Neither file is in the include globs of any `pnpm test` project (`unit-node`: `apps/*/src/**`, `packages/*/src/**`, `tests/qa/unit/**`; `unit-web`; `unit-formula-nocodegen`). That is why the two `pnpm test` runs on T0 stand for T1. The static checks were re-run on T1.

| # | Command | Tree | Exit | Result | Log |
|---|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (at the start) | T0 | 0 | `PASS gate DG5 (historical)` | — (output quoted here) |
| 1a | `pnpm -r typecheck` | T1 | 0 | every package `Done` | `eb-typecheck.log` |
| 1b | `pnpm -r build` | T0 | 0 | every package `Done` | `eb-build.log` |
| 1c | `pnpm lint` (`eslint . --max-warnings=0`) | T1 | 0 | no output | `eb-lint.log` |
| 1d | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | T1 (re-run at the end) | 0 | "All matched files use Prettier code style!" | `eb-prettier.log` |
| 1e | `pnpm openapi:lint` | T0 | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 876 operations` | `eb-openapi-lint.log` |
| 2a | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` (locale unset) | T0 | 0 | unit-node **154 files / 2413 passed**; unit-web **94 / 1746 passed**; unit-formula-nocodegen **3 / 259 passed, 2 skipped** (the existing `fuzz.test.ts` skips) | `eb-test-locale-unset.log` |
| 2b | `env -u LANG -u LC_CTYPE LC_ALL=C.UTF-8 pnpm test` | T0 | 0 | the same counts in all three invocations | `eb-test-c-utf8.log` |
| 3a | `QA_PG_PORT=23850 MTH_PORT_POOL=23851-23899 tests/qa/support/with-pg.sh pnpm test:integration` (run 1) | T0 at the start; T1 for every file loaded after the fix at about 22:47 (mixed) | **1** | **324 files: 323 passed, 1 failed (`media-types.test.ts`); 3131 passed, 4 failed, 1 skipped, 1 todo.** The 4 failures are the defect of §4.7: `429 rate_limited` from the default upload budget (lines 343–351). The skip is the existing one in `governance/presentation.test.ts`; the todo is the BE-B pending test (§4.1). Duration 3308 s | `eb-test-integration.log` |
| 3b | the same command on `QA_PG_PORT=23860 MTH_PORT_POOL=23861-23899` (run 2) | T1 | **1** | **Crashed, not a test failure.** After 10 files passed (0 failed), Vitest's fork worker channel closed: `Error: Channel closed … ERR_IPC_CHANNEL_CLOSED` (tinypool), at 22:55. It ran beside run 1 and a concurrent `pnpm -r typecheck` + `pnpm lint` on a 4-CPU, 16 GB, no-swap host. The child was most likely killed for memory; that is not confirmed from inside the sandbox | `eb-test-integration-run2-crashed.log` |
| 3c | `…/with-pg.sh npx vitest run --project integration` with `media-types`, `admin/security`, `audit/audit-events` and `contract/contract` (targeted, on 23860) | T1 | 0 | **4 files passed; 144 passed, 1 todo.** `media-types` 21/21 (the 4 failures of 3a pass) | `eb-test-integration-targeted.log` |
| 3d | `QA_PG_PORT=23860 MTH_PORT_POOL=23861-23899 tests/qa/support/with-pg.sh pnpm test:integration` (run 3, the acceptance run) | T1 | **0** | **324 files passed (324); 3135 passed, 1 skipped, 1 todo (3137); 0 failed.** `media-types` 21/21; `admin/security` 8/8; `audit/audit-events` 14 + 1 todo; `contract` 101/101. The skip is the existing one in `governance/presentation.test.ts`. 23:01:19–23:49:11 UTC, duration 2868 s. It ran beside run 1 until about 23:20, and no flaky or retried test appears in its log | `eb-test-integration-run3.log` |
| 4 | `node tools/gates/validate.mjs --historical --stage DG5` (at the end) | T1 | 0 | `PASS gate DG5 (historical)` | `eb-validate-dg5-end.log` |

**Pinned counts in `contract.test.ts`:** no change. 101 tests passed in 3a, 3c and 3d; 876 operations.

**Time:** the continuation started `Mon Oct 26 21:44:09 UTC 2026` and ended `Mon Oct 26 23:51:08 UTC 2026` (the last `date -u`; about 2 h 10 min, so past the 2-hour limit. The extra time went to the full integration run on the fixed tree, which this assignment requires).

## 1. Behaviour delivered, per requirement row

BE-E's rows (p6-work-split §E/F.14) are **REQ-S16-030** (shared with BE-E2, BE-D and DO-A) and **REQ-S16-032** (shared with FE-B and BE-F). Neither row is complete with BE-E alone. Here is what BE-E delivers against each acceptance text.

### REQ-S16-030

> Acceptance (quoted): "A12: security tests cover CSRF, SQL injection, XSS in rich text, disallowed upload type, oversized upload and rate limiting, and all pass"

The suite that covers those six clauses one by one is **BE-E2** (§E/F.8, after BE-E and BE-D). BE-E delivers the controls and the configuration that suite tests, plus their own tests:

- **The secret-management interface** (ADR-0052 §5): `platform/secrets.ts`.
  - The built-in `env` provider reads `NAME` or `NAME_FILE` exactly as ADR-0011 does. It goes through `packages/config`'s new `readSecretVariable`, which is the loader's own `readRaw`. When both are set, it raises a `ConfigError` "`NAME and NAME_FILE are both set; set only one`" that names the variable only.
  - The built-in `file` provider reads a plain file name under `SECRETS_DIR`. It refuses paths, `..` and dot names. With no `SECRETS_DIR` it is a configuration error, never a silent empty value.
  - `SecretValue` keeps its value in a private class field. `String()`, template literals, `JSON.stringify` (so JSON responses and pino) and `util.inspect` all print `[secret]`.
  - Both providers are registered on the `server.ts` registry line. Nothing in DG1–DG5 resolves a secret through the registry, so with no new variable set the installation behaves exactly as DG5.
  - The product ships no vault adapter and claims no vault integration.
- **The rate-limit classes** (ADR-0052 §4):
  - `packages/config` adds `UPLOAD_`, `SEARCH_`, `ASSISTANT_`, `WEBHOOK_` and `EXPORT_RATE_LIMIT_PER_MINUTE`. Each is a `positiveInt` with the ADR's default (30, 120, 20, 600, 10) and an `ENV_VARS` entry.
  - `platform/hooks.ts` adds `rateLimitClass(name)` (a route-config fragment), `RATE_LIMIT_CLASSES` (the §4 matrix) and `registerRateLimitClasses`.
  - A class route gets a **second** limiter, with the class's own budget and store, keyed like the global limit (user, else IP; `webhook` by endpoint key). It runs after the global limiter, so whichever limit is reached first answers 429 `rate_limited` with `Retry-After`. Details in §4.2.
  - `uploadEvidenceContent` is in the `upload` class (the one-line route-config change in `evidence/routes.ts`).
- **The security view** `getSecurityRateLimits` (`admin/security.ts`):
  - It needs `security.read` on the organization (ADM_TECH, AUD). Everyone else gets 403. An unknown organization is also 403, because the contract declares no 404.
  - It returns the effective budget, variable, key and operation ids of the seven classes, from configuration only. It reports no counters, no IPs and no user ids.

**Tests:**
- `platform/secrets.test.ts` (unit, 15): `[secret]` in `String()`, `JSON.stringify` (also nested), `util.inspect` and a **pino log line** (Fastify's logger: a field, a nested field and the message); `NAME`; `NAME_FILE`; unset or empty; **both set → the error names the variable only** (neither the value nor the file path); an unreadable file; invalid names; the `file` provider and its traversal refusals; registration and resolution.
- `apps/api/test/integration/admin/security.test.ts` (integration, 8):
  - the exact matrix for ADM_TECH and AUD, with no leak of IPs, user ids or counters;
  - 403 for TO, a user with no role, another organization's TO, ADM on another organization and an unknown organization; 400 for bad input; 401 with no session;
  - read-only (no write in the contract or on the server);
  - the defaults and the variables are read, and a non-positive or non-integer budget is a `ConfigError` naming the variable;
  - **the routes that declare each class map exactly to the matrix's operation ids**;
  - **with `UPLOAD_RATE_LIMIT_PER_MINUTE=1`, the second upload is 429 `rate_limited` with `Retry-After` and stores nothing**, while the same user's `GET /me` still answers 200, another user is not counted, and the matrix shows 1;
  - **with `RATE_LIMIT_PER_MINUTE=2`, an upload is 429 from the global limit before its class budget is reached** (the class is in addition to the global limit, never a bypass).

**Status:** not complete as a row. BE-E2 (the six-clause suite), BE-D (the type and size refusals) and DO-A (the CI dependency audit) remain.

### REQ-S16-032

> Acceptance (quoted): "A07;A12: each mutation test asserts one audit event with prior and new version; an UPDATE on the audit table by the application role fails"

- **Global audit API** (ADR-0052 §8): `listAuditEvents` `GET /api/v1/audit-events` and `getAuditEvent` `GET /api/v1/audit-events/{auditEventId}`. The routes are in `audit/routes.ts` and the queries in `audit/index.ts`.
  - The list is newest first by `seq`, with every filter of the contract (transformation, record type, record id, actor, action, from, to) and cursor pagination bound to the filter hash.
  - **Scope.** An event with a `transformation_id` targets that transformation (in its business unit). An event without one targets its organization at organization level. Visibility is the ADR-0006 `scopeFilter` for `audit_event.read` over that target, so:
    - AUD (inherits downward) sees its organizations, units and transformations;
    - AUD at a business unit sees only the transformations under it;
    - ADM_TECH and ADM_ACCESS (non-inheriting; `audit_event.read` is not structural) see organization-level events, and a transformation's events only with an assignment at that transformation.
  - **Refusals.** On the list: 403 without `audit_event.read` in the organization; 404 for an unknown organization; 400 for bad input. On one event: 404 for an event outside the caller's scope, the same as a missing one (existence not disclosed).
  - **Sensitive records** (ADR-0051 §2): an event about a record that is sensitive and not admitted to the caller is listed with `changes: null`, `reason: null` and `redacted: true`. Actor, action, time, record id and versions remain. See §4.1 for the interim redaction rule until BE-B is wired.
  - **No write operation exists:** the contract has only GETs on both paths, the server registers only GET/HEAD, and a POST is 404.
- **The access port** (D-197 item 5, BE-A §4.1): `AuditRouteAccess` declares `organizationAccess`, `readFilter` and `restrictedRecords`. `server.ts` fills them on the `registerAuditRoutes` line with `access`'s `principalOf`, `resolveTarget` and `scopeFilter`. audit imports no access module, and `architecture.test.ts` is green.
- **Tests:** `apps/api/test/integration/audit/audit-events.test.ts` (integration: 14 tests plus 1 todo):
  - AUD at the organization sees every event of the organization, its units and its transformations, newest first;
  - ADM sees organization-level events only;
  - ADM_TECH with an assignment at a transformation sees that transformation too;
  - AUD at a BU sees only its transformation;
  - another organization's events never appear;
  - 403, 404, 400 and 401 refusals, including the SQL-injection-like `action=' OR 1=1 --` → 400;
  - every filter, and paging by cursor (a cursor reused with another filter is 400);
  - the full `GlobalAuditEvent` shape;
  - `getAuditEvent` inside and outside the scope;
  - **redaction** of a sensitive evidence item's event (in the list and in GET, with no confidential text anywhere in the body), and visibility again after unmarking;
  - **"an UPDATE on the audit table by the application role fails"**: as `mth_app` (asserted with `current_user`), UPDATE, DELETE and TRUNCATE are all rejected and the row is unchanged;
  - no write operation exists;
  - AUD gets 200 on the reads (the list, GET, and the contract exercises).
- **"each mutation test asserts one audit event with prior and new version":** BE-E adds no mutation, because the audit API is read-only. The P6 mutation rows belong to their owners and to BE-F's integrity sweep (ADR-0052 §8, §9).

**Status:** BE-E's part is delivered, except the admitted-caller redaction case (see §7). FE-B (Administration > Audit) and BE-F (the cross-entity assertion) remain.

## 2. Changed files

| File | Purpose |
|---|---|
| `packages/config/src/index.ts` | `ENV_VARS`: the five class budget variables (defaults 30/120/20/600/10) and `SECRETS_DIR`; the export block of the new loader symbols |
| `packages/config/src/load.ts` | `RATE_LIMIT_CLASS_VARIABLES`, `RateLimitClassBudgets`, `AppConfig.rateLimitClasses` and `secretsDir`, and `readSecretVariable` (the ADR-0011 `NAME`/`NAME_FILE` read, for the `env` provider) |
| `apps/api/src/modules/platform/secrets.ts` | `secretValue`, `SECRET_PLACEHOLDER`, `envSecretProvider`, `fileSecretProvider`, `SecretProviderError`, `registerBuiltInSecretProviders` (BE-A's port and registry unchanged) |
| `apps/api/src/modules/platform/hooks.ts` | `rateLimitClass(name)`, `RATE_LIMIT_CLASSES`, `registerRateLimitClasses`, `config.rateLimitClass` typing |
| `apps/api/src/modules/platform/index.ts` | exports for the above |
| `apps/api/src/modules/evidence/routes.ts` | **one route-config property:** `rateLimitClass: "upload"` on `uploadConfig` (prettier wraps it to five lines) |
| `apps/api/src/modules/admin/security.ts` | `getSecurityRateLimits` and `rateLimitMatrix(config)` |
| `apps/api/src/modules/audit/index.ts` | `queryAuditEvents`, `findAuditEvent`, `AuditEventTargetColumns`, `AuditScopePredicate`; the export line of the routes |
| `apps/api/src/modules/audit/routes.ts` | `listAuditEvents`, `getAuditEvent`; the `AuditRouteAccess` port members; `sensitiveRecordsRedactedForEveryone` (the interim, see §4.1) |
| `apps/api/src/server.ts` | see §4.3: the rate-limit key extracted to a const plus the `registerRateLimitClasses` line; the `registerBuiltInSecretProviders` line; the audit port members on the `registerAuditRoutes` line; `RouteRecord.rateLimitClass` |
| `packages/shared/src/schemas/security.ts` | zod mirrors `rateLimitMatrix`, `rateLimitClass` |
| `packages/shared/src/schemas/audit-events.ts` | zod mirrors `globalAuditEvent`, `globalAuditEventPage`, `auditEventListQuery` |
| `apps/api/src/modules/platform/secrets.test.ts` | new unit suite |
| `apps/api/test/integration/admin/security.test.ts` | new integration suite. **[EB]** This file's API starts with distinct class budgets (`CLASS_BUDGETS`: 301/1201/201/6001/101). The matrix test now expects those values, so it still proves each class reports its own configured value |
| `apps/api/test/integration/audit/audit-events.test.ts` | new integration suite |
| `apps/api/test/support/p6-pending-be-e.ts` | emptied (all 3 routed) |
| `apps/api/test/support/harness.ts` | **[EB]** `testConfig` raises the five class budgets to 100000, as it already does for `RATE_LIMIT_PER_MINUTE` and `AUTH_RATE_LIMIT_PER_MINUTE` (see §4.7). This shared test-support file is outside §E/F.7's file list; it is disclosed here for the orchestrator |
| `apps/api/test/integration/contract/p6-exercises-be-e.ts` | the three operations, with their mirrors and refusals |
| `docs/delivery/handbacks/DG6/T-DG6-BE-E-*` | this handback and its logs |

- **No migration.** No id was taken.
- **No dependency.** `@fastify/rate-limit` 10.3.0 is already a dependency; its `createRateLimit` decorator is used.
- **No contract change.**

## 3. Operations routed (delta to the pending lists)

- `p6-pending-be-e.ts`: `getSecurityRateLimits`, `listAuditEvents` and `getAuditEvent` were **removed (3 → 0)**. Each is exercised in `p6-exercises-be-e.ts` through `ctx.mirrored`:
  - `getSecurityRateLimits`: 200 (ADM_TECH, AUD), 400, 401, 403;
  - `listAuditEvents`: 200 (AUD and ADM, paged), 400, 401, 403, 404;
  - `getAuditEvent`: 200, 400, 401, 404 (missing and out of scope).
- **Pinned counts in `contract.test.ts` (for the D-079 reconciliation):** **no change.**
  - The operation count is 876, as at `HEAD`. It counts contract operations, not routed ones.
  - The media types are unchanged: every new route is a bodiless GET with no `consumes`.
  - No CSRF-exempt route was added.
  - The rate-limit sweep's floor `>= 285` is unchanged; its live count grows by 3.
  - The contract test stays at 101 `it` blocks, all passing.

## 4. Decisions and readings (for reviewers and the orchestrator)

1. **The audit redaction before BE-B (§E/F.7 "if BE-B has not merged").** BE-B's sensitivity clause (`sensitiveAdmits`, ADR-0051 §2) does not exist on this branch. The port member `restrictedRecords` is therefore filled with `sensitiveRecordsRedactedForEveryone(db)`, a fail-closed interim:
   - every record currently marked sensitive (`record_sensitivity.is_sensitive`) has its events redacted for **every** caller;
   - it never under-redacts, but it over-redacts for the callers ADR-0051 §2 admits;
   - **merge action:** replace that one member on the `server.ts` line with an adapter over BE-B's clause (batch: return the `auditRecordKey`s of the refs the caller is not admitted to);
   - the admitted-caller test is an explicit `it.todo("PENDING T-DG6-BE-B: …")` in `audit-events.test.ts`, never skipped silently.
2. **"In addition to the global limit".** `@fastify/rate-limit` replaces the global limiter when a route sets `config.rateLimit`. Its `app.rateLimit()` handler also shares the global handler's per-request "ran" flag, so a second one would be skipped.
   - The class limiter therefore uses the plugin's documented `createRateLimit` (its own child store) in an onRequest hook that is added after the global one.
   - Both limits are proven by the two rate tests above.
   - The `auth` class stays identity's own per-route limit (ADR-0007 §5b, "unchanged"). It still replaces the global limit for those three routes, exactly as in DG5.
3. **`server.ts` lines (BE-A's file):**
   - `rateLimitKey` was extracted from the inline `keyGenerator` without changing its behaviour, so that the classes reuse the global key;
   - one `registerRateLimitClasses(...)` line after the not-found handler (before any route);
   - one `registerBuiltInSecretProviders(...)` line below the registry;
   - the audit port members on the `registerAuditRoutes` line (D-197 item 5);
   - `RouteRecord.rateLimitClass`, which is additive and used by the class-pin test.
4. **`global` lists no operation ids.** It is "every operation without a class" (ADR-0052 §4). Listing ~870 ids would add nothing. FE-B can label it so.
5. **`listAuditEvents` 403 vs 404.** An unknown organization is 404, which the contract declares. An existing organization in which the caller holds `audit_event.read` at no scope is 403. `getAuditEvent` declares no 403, so out of scope is 404.
6. **The `export` class is configured but no operation is wired to it.** ADR-0052 §4 assigns it to the export start operations (ADR-0046), which already exist in `reporting/exports/**`. That file is outside BE-E's ownership, and §E/F.13 names BE-E's only route-file line, the upload one. The owner adds `...rateLimitClass("export")` (or `rateLimitClass: "export"`) to those routes, plus the ids in `RATE_LIMIT_CLASSES`. The class-pin test then enforces it. `search`, `assistant`, `webhook` and the import upload are wired by their owners (ADR-0052 §4).

7. **[EB] A defect in the original run, found and fixed in the continuation.** The default `upload` budget (30 per minute per user) throttled an existing DG2 suite.
   - **What failed:** `apps/api/test/integration/media-types.test.ts` uploads more than 30 times a minute as one user. In the first continuation integration run, 4 of its 21 tests got `429 rate_limited` instead of 400/200 (log `eb-test-integration.log`, lines 343–351).
   - **Why:** the shared `testConfig` lifts only the global and auth limits for functional suites; it left the new class budgets at their production defaults.
   - **The fix:** the same lift for the five class variables in `harness.ts`. The defaults stay pinned by `loadConfig` in `security.test.ts` ("defaults to ADR-0052 §4"). The 429 behaviour stays tested with budgets of 1 (class) and 2 (global).
   - **Production defaults are unchanged.**
   - **e2e:** the e2e stacks (`apps/web/e2e/support/with-stack.sh`, `e2e/support/{with-demo-stack,qa-stack}.sh`, `deploy/scripts/ci-e2e-stack.mjs`) do not set the class variables, so they run with the defaults. I found two upload call sites in the e2e specs (`p2-journeys.spec.ts`, `session-end.spec.ts`), far below 30 a minute, so I did not edit those files (they are not mine). **The e2e suite was not run in this task.**

8. **[EB] Review of the original run's work.** I re-read the salvaged diff (`git diff 1c061ab 5a9887f`) against ADR-0052 §4, §5, §8 and p6-work-split §E/F.7.
   - **Found and fixed:** the harness defect in item 7. I found no other defect in BE-E's scope.
   - **Its prior evidence was not clean.** The original `test-locale-unset.log` ends `EXIT=1`. The cause was a Vitest infrastructure error, `[vitest-worker]: Timeout calling "onTaskUpdate"` (an RPC timeout under load), not a failed assertion. Its `test-c-utf8.log` stops before the end of the run. Its integration run never happened: there is no integration log.
   - Those original logs (`build.log`, `env-example-check.log`, `lint.log`, `openapi-lint.log`, `prettier.log`, `test-*.log`, `typecheck.log`) are kept unchanged as the original run's record. **Every result in §0 comes from the `eb-*.log` files of this continuation.**
   - **Deviations I checked and kept, each disclosed above:**
     - The class limiter uses `createRateLimit` rather than a per-route `config.rateLimit` (§4.2). ADR-0052 §4's literal mechanism would replace the global limit, not add to it.
     - Redaction uses the fail-closed interim until BE-B lands (§4.1).
     - No worker `SecretProvider` line yet (§5).

## 5. Contract, schema or dependency needs (for the orchestrator)

- **None blocking.** No contract change, no migration, no dependency.
- **`.env.example`** (DO-A, §E/F.11) needs regenerating. `node deploy/scripts/generate-env-example.mjs --check` exits 1 and lists the 6 new names. It **already failed at `HEAD`**, for `MTH_ENV` and `MTH_DEMO_ADMIN_DATABASE_URL` (P5). Log: `env-example-check.log`.
- **`docs/operations/configuration.md`** (devops owner): document `SECRETS_DIR` and the five class budget variables.
- **The worker's SecretProvider registration** (ADR-0052 §5 names `apps/worker/src/main.ts`). It is outside §E/F.7's file list, and BE-A §4.6 leaves it to BE-E or BE-J. No worker job resolves a secret yet. The line is `registerBuiltInSecretProviders(createSecretProviderRegistry(), { secretsDir: config.secretsDir })`, where the first job that needs a secret gets it (BE-J or BE-I).
- **Problem codes:** none new. Every refusal uses the standard `validation`, `forbidden`, `not_found`, `unauthenticated` and `rate_limited`.

## 6. User-facing texts made untrue

**None.** BE-E ships API routes and configuration; the screens are FE-B's. I searched `apps/web/src/i18n/en/*.json` for audit, security, rate-limit and secret texts that call something planned or later:
- `admin.json` `plannedSections` lists what *is* available and names no Audit or Security screen, so it stays true until FE-B ships them.
- No string calls the audit API or the rate limits planned.

## 7. What remains

- **BE-B integration** (§4.1): replace the interim `restrictedRecords` with BE-B's clause, and turn the `it.todo` into a test of the admitted caller (grantee, named party, `sensitive_record.grant` holder) seeing the event unredacted.
- **Wiring other classes:** the `export` class onto the export start operations (the owner of `reporting/exports/**`, §4.6). `search`, `assistant`, `webhook` and the import upload go onto their routes as they are built.
- **Not BE-E's:** `.env.example` (DO-A), `configuration.md` (devops) and the worker registration (§5).
- **BE-E2** (§E/F.8): the six-clause security suite, which uses these controls.
- **Merge notes:**
  - `evidence/routes.ts`: BE-E changed only the `uploadConfig` object (lines 475–479). If BE-D lands first, keep its upload lines and re-add `rateLimitClass: "upload"` (§E/F.13: "if BE-E runs before BE-D, BE-D keeps that line").
  - `server.ts` is BE-A's file. My hunks are listed in §4.3.
  - **[EB]** `apps/api/test/support/harness.ts` is shared. My only hunk is the five class-budget lines in `testConfig` (§4.7). If another task edits `testConfig`, keep both.
  - **[EB]** The continuation's two test-file changes are uncommitted on top of the salvage commit `5a9887f`. Squash or merge them together with it.
- **[EB] Every later task that wires a class** (`search`, `assistant`, `webhook`, `export`, the import upload) must check that its own suites stay under the class budget with the harness's 100000. Any suite that builds its own config with `loadConfig` instead of `testConfig` gets the production defaults (30/120/20/600/10).
