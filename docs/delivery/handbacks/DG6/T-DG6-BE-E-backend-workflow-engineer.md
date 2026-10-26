# Handback T-DG6-BE-E: `SecretProvider`, rate-limit classes, the security view, the global audit API (backend-workflow-engineer)

- **Stage:** P6 "Integration and system hardening", gate DG6 (BUILDING). Section: `docs/architecture/p6-work-split.md` §E/F.7.
- **Invocation:** run `DG6-T-DG6-BE-E-backend-workflow-engineer-20261026T195909Z-e2d8bc34`, session `e2d8bc34-6dea-4668-af9b-9a1fb856ecbf`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-E.md`, sha256 `f4196fb0c9447628264491a925b022914838b6c3b60b488ef449da4e6aaa4c5e` (verified).
- **Working tree:** worktree `/home/user/wt/dg6-be-e`, branch `dg6/be-e`, base `HEAD` `1c061ab8b9dae8ae5fce31dd261299024d014f56`. The changes are **uncommitted**, as the assignment requires.
- **Time:** started `Mon Oct 26 19:59:21 UTC 2026`; finished: see §0 (the last `date -u`).
- **Two gate systems.** Nothing here reads or writes DG0–DG7. Reading the audit trail or the rate-limit matrix approves nothing. No agent, seed or test grants a G1–G6 business, Finance or IT approval. All test data is synthetic.

## 0. Checks actually run (final tree; logs in `T-DG6-BE-E-evidence/`)

CHECKS_TABLE_PLACEHOLDER

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
| `apps/api/test/integration/admin/security.test.ts` | new integration suite |
| `apps/api/test/integration/audit/audit-events.test.ts` | new integration suite |
| `apps/api/test/support/p6-pending-be-e.ts` | emptied (all 3 routed) |
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
