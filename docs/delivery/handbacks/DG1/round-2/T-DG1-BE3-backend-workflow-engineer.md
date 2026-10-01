# Handback T-DG1-BE3: backend round-2 repairs (backend-workflow-engineer)

- **Stage / gate:** P1 / DG1, round-2 repair. **Assignment:** `docs/delivery/assignments/DG1/round-2/T-DG1-BE3.md` (sha256 `f951cf64…9bcd9`, verified before starting).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG1-T-DG1-BE3-backend-workflow-engineer-20261001T071338Z-b29d2c64","session_id":"b29d2c64-f139-4524-bc5c-79a36137c3ea"}`
- **Base revision:** `868ebb6c44c1b89709234e3db4e8dfd2d7672233` (branch `dg1r2-be`, a worktree at or above `c433078`). HEAD did not move during the run. **Nothing is committed.** The changes are in the worktree for the orchestrator to integrate.
- **Scope kept:** only `apps/api/**`, `apps/worker/**`, `packages/db/**`, `packages/config/src/**`, plus this handback. I did not change `docs/api/openapi.yaml`, `packages/shared/**`, any `package.json` dependency block or `pnpm-lock.yaml`. No dependency was added.
- **Engineering vs business gates:** none of these changes grants or simulates a G1–G6 business approval. F-DG1-001 *removes* a path that acted like one. Product G6 is unrelated to DG7.

## Findings fixed

### F-DG1-101 / F-DG1-201 (High, mandatory): contract suite red, `getBrandingTokens` never exercised

- **What was wrong:** `apps/api/test/integration/contract/contract.test.ts` never called `GET /api/v1/branding/tokens`, so the coverage test failed with `expected [ 'getBrandingTokens' ] to deeply equal []`. I reproduced this on the base revision before changing anything (baseline `pnpm test:integration`: `Tests 2 failed | 179 passed (181)`; the other failure was the F-DG1-110 flake, `expected 12 to be 11`).
- **Fix (tests only, no route change):** a new case `branding tokens (getBrandingTokens)` covers:
  - 401 unauthenticated (problem body checked against the contract and the problem mirror);
  - 200 signed in, with the body validated by the harness against `docs/api/openapi.yaml` (`BrandingTokens`) and against the zod mirror `brandingTokens` (added to `ZOD_MIRRORS`);
  - `provenance = "provisional"`, and `#0078FF` present and flagged provisional.
  The operation count assertion is now `33`.
- **While here:** the contract test's OIDC callback now presents the browser-binding cookie, so it performs a real sign-in (302 to `/`, session cookie issued) instead of an accidental `state_invalid` redirect. The IdP subject is pre-bound to a seeded user, so the result no longer depends on how many organizations the shared run database holds.
- **Result:** route coverage passes, with all 33 operations exercised and no unmatched operation (output below).

### F-DG1-001 (Medium, mandatory): CLOSED reachable by a plain status edit

- **What was wrong:** `isAllowedTransition` followed `TRANSFORMATION_STATUS_TRANSITIONS`, which lists `active→closed` and `on_hold→closed`. Any holder of `transformation.update` could therefore close a record permanently, with no G6, no validated value and no reason.
- **Fix (`apps/api/src/modules/transformations/routes.ts`):**
  - New `GOVERNED_TARGET_STATUSES = {"closed"}`.
  - `isAllowedTransition(from, to)` returns `false` for every `to = closed` unless it is a no-op.
  - The PATCH route answers **422 `urn:mth:problem:invalid-transition`** (`code: invalid_transition`, already declared for `updateTransformation`), with a detail naming G6. Nothing is written: same version, same status, no audit row.
  - Following the existing pattern, a 422 business-rule refusal is **not** audited; only authorization denials are. So the outcome is "no state change, no audit row", as the assignment's fallback clause specifies.
  - The governed close arrives with the G6 workflow (P2+/P4). `workflows` exports `CLOSURE_GATE = "G6"` as the documented pointer.
  - `packages/shared/src/constants.ts` (outside my scope) is unchanged. The refusal is enforced in the API, the single writer.
- **Tests:**
  - Unit (`transitions.test.ts`): the allowed set is now exactly `draft→active, active→on_hold, on_hold→active`, and every `x→closed` is refused.
  - Integration (`transformations.test.ts` › "closure is not a status edit"):
    - `active→closed` and `on_hold→closed`: 422, state/version/name unchanged, audit trail unchanged.
    - A close bundled with a valid rename is still rejected and nothing is written.
    - `draft→closed`: 422.
  - Contract test: the PATCH to `closed` is asserted as 422 `invalid_transition`.
- **Follow-up for the contract owner (not mine to edit):** the *description* of `updateTransformation` in `docs/api/openapi.yaml` (lines 741–742) still says `active→on_hold|closed, on_hold→active|closed`. The schemas and status codes are unchanged and still correct (422 was already declared), but that prose should say closure is refused until G6. The web edit form offering "Closed" is F-DG1-004's area.

### F-DG1-103 (Medium, mandatory): OIDC login CSRF, `state` not bound to the browser

- **What was wrong:** `/auth/login` stored state, nonce and verifier server-side but bound nothing to the browser. `/auth/callback` accepted any request carrying a live state, revoked the presenting browser's session, and signed it in as whoever had authenticated at the IdP.
- **Fix:**
  - **Migration `0007_oidc_login_browser_binding.sql`:** `oidc_login_state.browser_binding_hash bytea NOT NULL CHECK (octet_length = 32)`. In-flight login states (at most 10 minutes old, unbound) are deleted first; those users simply start the login again.
  - **`GET /auth/login`:** generates a 32-byte random binding and sets it as a pre-session cookie:
    - name `mth_login`, or `__Host-mth_login` on https;
    - `HttpOnly; SameSite=Lax; Path=/; Max-Age=600`, plus `Secure` on https;
    - the cookie is set only after the state row is written;
    - only `sha256(binding)` is stored, next to the state, nonce and PKCE verifier.
    `SameSite=Lax` is required because the IdP returns with a top-level cross-site GET, which `Strict` would drop.
  - **`GET /auth/callback`:**
    - reads the cookie and clears it on every outcome;
    - `OidcService.consumeState(tx, state, binding)` deletes the state **only when** `state_hash` and `browser_binding_hash` both match (single use, and expiry still enforced);
    - a live state presented by a browser without the cookie, or with a different one, returns `browser_mismatch`. That becomes a redirect to `/login?error=state_invalid` (an existing error code, so the web needs no new string), and a `session.login_failed` audit event is written with the reason;
    - the refused state is **not consumed**, so a leaked URL can't burn the legitimate login. The refusal happens **before** `startSession`, so the presenting browser's existing session is **not revoked**;
    - the PKCE verifier and nonce are released only to the bound browser.
- **Tests (`oidc.test.ts` › "login CSRF…"):**
  - The attacker's live callback opened in the victim's browser is refused in both variants: (a) no login cookie, (b) the victim's own different pending binding. In both cases:
    - no session cookie is issued and no identity is created for `csrf-attacker`;
    - the victim's `/me` is still 200 as "Synthetic victim";
    - both refusals are audited with the exact reasons;
    - the attacker's own browser can still finish its login.
  - Cookie attributes and hash-only storage.
  - The cookie is cleared at the callback.
  - On an https origin the cookie is `__Host-` prefixed, `Secure` and has no `Domain`.
  - All existing OIDC tests now present the cookie like a real browser.
- **Note:** a browser that starts two logins in parallel tabs keeps only the latest binding, so the older tab gets `state_invalid` and must restart. This is the usual trade-off of a single binding cookie.

### F-DG1-106 (Medium): BU-scoped Lead creates (201) but then gets 404 on its own record

- **What was wrong:** TL does not inherit downward. A TL grant at BU a1 satisfied `transformation.create` on the BU target but never matched the new transformation target, so read, update and archive returned 404.
- **Fix (explicit, audited grant; the policy rules are unchanged):**
  - `access.grantCreatorTransformationRoles` (exported from `access/index.ts`) runs inside the create transaction, right after the `transformation.create` audit event.
  - It acts **only when** none of the creator's grants can read the new record.
  - For each BU-scope grant that authorized the create, it inserts a **transformation-scope `scoped_assignment` of the same role**:
    - with the source grant's `effective_to`;
    - with reason `Creator of transformation <code>: <role> carried over from business-unit assignment <id>`;
    - with one `scoped_assignment.create` audit event each;
    - linked through `derived_from_assignment_id`.
  - It **never** carries over a role that holds an approval permission (`gate.decide`, `finance.validate`, …), a `technical_admin` role, or a revoked grant. A create therefore can never manufacture a G1–G6 or Finance approver.
  - Grants still come only from `scoped_assignment` rows; a job title still implies nothing.
  - **Migration `0008_scoped_assignment_derived_from.sql`:** `scoped_assignment.derived_from_assignment_id uuid NULL REFERENCES scoped_assignment(id)`, with these CHECKs:
    - a derived row is transformation-scope only;
    - a row is never derived from itself.
    It also adds a partial index.
  - **`revokeAssignment`:** revoking the source BU grant also revokes its active derived assignments, in the same transaction, with one `scoped_assignment.revoke` audit event each. A derived grant never outlives its source.
  - An idempotent create replay does not repeat the grant, because `run()` is not re-executed on a replay.
- **Tests (`access-scope.test.ts` › "a business-unit-scoped creator…"):**
  - A TL at BU a1 can create, read, list, update (incl. `draft→active`), read the audit trail and archive its own record. There is exactly one derived assignment, it is audited in the same request as the create, and it carries `effective_to: null`.
  - Still denied: every *other* transformation in a1, a1x (child), a2 (sibling) and org B, for read, update and archive (all 404), and create in a2 and b1 (404).
  - TO, which inherits downward, gets no extra assignment.
  - With TL temporarily given `gate.decide`, nothing is carried over and the record stays 404. The test restores the seed in `finally`.
  - Revoking the source grant via the API revokes the derived grant (audited, version 1→2). After signing in again the record is 404.

### F-DG1-105 / F-DG1-002 (Medium, mandatory): the three missing §16 modules (per D-048)

- **What was wrong:** `workflows`, `kpi` and `reporting` existed only as names in `modules.ts`, with no directory, interface or suite.
- **Fix:**
  - **`apps/api/src/modules/{workflows,kpi,reporting}/index.ts`:** each is a typed public interface (a frozen `ModuleRegistration` descriptor with `status: "scaffold"` and `deliversIn: P2 | P4 | P5`) plus a `register<M>Module(app, deps)` wiring hook. Each hook registers **no route**, so there is no mutating route.
    - `workflows` also exports `PRODUCT_GATES` (G1–G6, explicitly *not* DG0–DG7) and `CLOSURE_GATE = "G6"`.
    - `kpi` exports `VALUE_FRESHNESS = unknown | stale | current` (never zero or green).
    - Each file header documents that business behaviour lands in P2, P4 or P5.
  - **`ModuleRegistration`:** a new type in `platform/deps.ts`, exported from `platform/index.ts`.
  - **`apps/api/src/modules.ts`:**
    - the three modules are added to `P1_MODULES` (now eleven), with the existing `dependsOn` rules unchanged;
    - new `SECTION16_MODULES` (the six §16 areas mapped to modules) and `P1_SCAFFOLD_MODULES`;
    - `methodology` and `evidence` stay reserved.
  - **`apps/api/src/server.ts`:** the composition root calls the three hooks. `buildServer` also returns `modules` (the scaffold registrations).
  - **Own suites, `apps/api/src/modules/<m>/<m>.test.ts`:** each asserts that the module is mapped as a P1 scaffold with its declared `dependsOn`, has a public `index.ts` with the expected exports, and that its hook runs on a bare Fastify instance and registers zero routes. It also asserts that `moduleViolations(m)` is empty and that a planted bypass or undeclared dependency is caught: deep import (workflows), `createRequire` (kpi), computed `import()` (reporting), plus an undeclared module import for each.
  - **`architecture.test.ts`:**
    - a new check that the six §16 modules all exist, each with its own suite;
    - the module directory list must equal `P1_MODULES`;
    - `server.test.ts` checks that the server wires the three scaffolds and that they add no routes.
- **Lint carve-out:** a module's **own `*.test.ts`** may import exactly `../../modules.ts` and `../../architecture.testkit.ts`. Runtime files still may not, and any other composition-root import from a test is still a violation; the planted test proves both.

### F-DG1-109 (Low): the lint misses `createRequire()` and computed `import()`

- **Fix:** the lint moved into `apps/api/src/architecture.testkit.ts` (test-only; excluded from the build by `tsconfig.build.json` `src/**/*.testkit.ts`, and `dist/` contains no testkit). It walks the TypeScript **AST** instead of using `ts.preProcessFile`.
  - **Checked like static imports:** literal `import()`, `require()`, `import x = require()` and `import("…")` types.
  - **Violations in their own right:**
    - computed `import(expr)` and `require(expr)`;
    - any `createRequire` (identifier or `.createRequire`);
    - importing `module` / `node:module`.
- **Planted cases in `architecture.test.ts`** (17 must-fail cases plus a must-stay-clean case): A/A2 deep static and type-only, B/B2 dynamic literal and template, C re-export, D/D2/D3 `createRequire` and `node:module`, E/E2 computed `import()`, F/F2 `require` literal and computed, G import-equals, H `import()` type, I composition root, J undeclared module, K unknown package.
- **On-disk plant** of the finding's exact D+E forms in `modules/transformations/planted.ts`, removed afterwards:

```text
### NEW lint (this change) with planted D (createRequire) + E (computed import):
   × API module boundaries (ADR-0002) > every import respects dependsOn, public surfaces and allowed packages
+   "modules/transformations/planted.ts: createRequire (line 1) bypasses the module-interface check",
+   "modules/transformations/planted.ts: createRequire (line 2) bypasses the module-interface check",
+   "modules/transformations/planted.ts: computed import() specifier (line 4) bypasses the module-interface check",
+   "modules/transformations/planted.ts: imports package node:module",
      Tests  1 failed | 29 passed (30)

### OLD lint (HEAD architecture.test.ts) + same plant, with the three new scaffold suites set aside (isolates F-DG1-109):
[withold] HEAD versions of: apps/api/src/architecture.test.ts apps/api/src/modules/workflows/workflows.test.ts apps/api/src/modules/kpi/kpi.test.ts apps/api/src/modules/reporting/reporting.test.ts
      Tests  9 passed (9)          <- the old lint did NOT detect D/E (finding reproduced)
```

The new lint still fails on an interface-bypassing static import (planted cases A, C and J, all green).

### F-DG1-110 (Low): flaky integration tests

- **Audit count:** the "rolls back record, audit and outbox together" test compared the global `auditCount()`. I reproduced the flake on the base revision (`expected 12 to be 11`). It now asserts scope-locally:
  - zero audit rows with the duplicate request's own `requestId`, using the new harness helper `auditOfRequest`;
  - exactly one transformation with code `SYN-DUP-1`, with a single `transformation.create` event;
  - no orphan outbox event in the organization.
  `auditCount` stays exported (`tests/qa/support/api.ts` re-exports it) but is documented as not to be used for "nothing written" assertions.
- **Worker 57P01:** `apps/worker/test/support.ts`:
  - `bossFor()` tracks every pg-boss instance per database, and `workerEnv().close()` stops any a test left running;
  - the env's pools are ended, then the teardown **waits until `pg_stat_activity` shows no client on the scratch DB** before `DROP … WITH (FORCE)`;
  - a connection still present after 10 s **fails the teardown, naming its `application_name`**, instead of surfacing later as an unhandled 57P01;
  - the owner pool gets an idle-error listener, as `createPool` already has, and every pool has an `application_name`.
  Proven with a throwaway planted-leak test (not committed): `PLANTED: a leaked client makes the teardown fail loudly instead of a later 57P01` passed (the teardown rejected with `still open before the drop: planted-leak`).
- **Result:** three consecutive full integration runs on fresh clusters, all green with zero unhandled or 57P01 errors (below). Three runs can't prove the absence of a rare flake, but both root causes are removed.

### F-DG1-112 (Low): production accepts an `http` APP_BASE_URL

- **Fix:** `packages/config/src/load.ts` refuses, at startup, `NODE_ENV=production` with a non-https `APP_BASE_URL`, with the error `APP_BASE_URL must use https when NODE_ENV=production (plain http is accepted only for a loopback host: localhost, 127.0.0.1 or [::1])`.
  - **Loopback exception:** it follows the finding's expected behaviour, and it keeps the local Compose stack (`deploy/compose`, production mode on `http://localhost:3000`, not my scope) starting. A loopback origin is reachable only from the same machine.
  - **New exports:** `secureOriginAllowed` and `isLoopbackHost`.
  - **Defence in depth:** `registerIdentity` refuses to start with a hand-built config that bypassed the loader.
  - **Unchanged:** the `ENV_VARS` catalogue descriptions (`.env.example` is generated from them).
- **Tests:**
  - `load.test.ts`: refuses `http://hub.example.internal`, `http://10.0.0.5:3000` and `http://hub.localhost.example.com`; accepts https and the three loopback forms; non-production unchanged; helper semantics (`localhost.evil.example` is not loopback).
  - `server.test.ts`: the loader fails closed; `buildServer` rejects a bypassing config; an https production origin starts.

## Migrations (new, forward-only; apply in order after 0006)

| File | Purpose |
|---|---|
| `packages/db/migrations/0007_oidc_login_browser_binding.sql` | Deletes in-flight (≤10 min, unbound) login states; adds `oidc_login_state.browser_binding_hash bytea NOT NULL` (32 bytes) |
| `packages/db/migrations/0008_scoped_assignment_derived_from.sql` | Adds `scoped_assignment.derived_from_assignment_id` (FK to itself, nullable) with two CHECKs and a partial index |

`packages/db/src/schema.ts` (Kysely types and `SCHEMA_COLUMNS`) matches both; `catalogue.test.ts` is green. **Data dictionary follow-up (docs/** is not mine):** `docs/architecture/data-dictionary.md` should gain the two columns.

## API endpoints added

**None.** No route was added or removed: the route-coverage test still maps 33 routes to 33 operations. Behaviour changed on existing endpoints:

- `PATCH /api/v1/transformations/{id}`: refuses `status: closed` with 422.
- `GET /api/v1/auth/login`: sets the login cookie.
- `GET /api/v1/auth/callback`: requires the login cookie.
- `POST /api/v1/transformations`: may add a derived assignment.
- `POST /api/v1/role-assignments/{id}/revoke`: cascades to derived assignments.

None of these needs a schema change in `openapi.yaml`. The only contract follow-up is the prose for `updateTransformation` noted under F-DG1-001.

## Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/transformations/routes.ts` | F-DG1-001 `GOVERNED_TARGET_STATUSES`, refusing closure; F-DG1-106 calls `grantCreatorTransformationRoles` in the create transaction |
| `apps/api/src/modules/transformations/index.ts` | Exports `GOVERNED_TARGET_STATUSES` |
| `apps/api/src/modules/transformations/transitions.test.ts` | Unit tests: no client-driven close |
| `apps/api/src/modules/access/assignments.ts` | F-DG1-106 `grantCreatorTransformationRoles`; cascade revocation of derived assignments |
| `apps/api/src/modules/access/index.ts` | Exports `grantCreatorTransformationRoles` |
| `apps/api/src/modules/identity/oidc.ts` | F-DG1-103 binding hash in `startLogin`; bound `consumeState` result (`ConsumedLoginState`); `loginCookieName` |
| `apps/api/src/modules/identity/routes.ts` | F-DG1-103 login cookie set and cleared, refusal and audit on mismatch; F-DG1-112 startup guard |
| `apps/api/src/modules/identity/index.ts` | Exports `loginCookieName` |
| `apps/api/src/modules/platform/deps.ts`, `platform/index.ts` | `ModuleRegistration` type |
| `apps/api/src/modules/workflows/index.ts`, `workflows.test.ts` | New P1 scaffold and its own suite (D-048) |
| `apps/api/src/modules/kpi/index.ts`, `kpi.test.ts` | New P1 scaffold and its own suite (D-048) |
| `apps/api/src/modules/reporting/index.ts`, `reporting.test.ts` | New P1 scaffold and its own suite (D-048) |
| `apps/api/src/modules.ts` | `P1_MODULES` (11), `SECTION16_MODULES`, `P1_SCAFFOLD_MODULES` |
| `apps/api/src/server.ts` | Wires the three scaffold hooks; `buildServer` returns `modules` |
| `apps/api/src/server.test.ts` | F-DG1-112 startup tests; scaffold composition test |
| `apps/api/src/architecture.testkit.ts` (new) | AST dependency-lint shared by the architecture test and the module suites (F-DG1-109) |
| `apps/api/src/architecture.test.ts` | Uses the testkit; §16 suite check; 17 planted must-fail cases plus a clean case; test-file carve-out cases |
| `apps/api/tsconfig.build.json` | Excludes `src/**/*.testkit.ts` from the build |
| `apps/api/test/integration/contract/contract.test.ts` | getBrandingTokens 200 + 401 with zod mirror; 33 operations; real bound OIDC sign-in; close → 422 |
| `apps/api/test/integration/transformations.test.ts` | Closure-refusal tests; scope-local rollback assertions (F-DG1-110) |
| `apps/api/test/integration/oidc.test.ts` | Browser-carried login cookie in helpers; login-CSRF, cookie-attribute and `__Host-` tests |
| `apps/api/test/integration/access-scope.test.ts` | F-DG1-106 positive and negative suite |
| `apps/api/test/support/harness.ts` | `auditOfRequest` helper; `auditCount` documented as global |
| `apps/worker/test/support.ts` | Boss tracking, wait-for-no-connections before drop, owner-pool error listener (F-DG1-110) |
| `apps/worker/test/integration/maintenance.test.ts` | Login-state fixtures include `browser_binding_hash` |
| `packages/config/src/load.ts`, `index.ts`, `load.test.ts` | F-DG1-112 production https rule; `secureOriginAllowed` and `isLoopbackHost` |
| `packages/db/migrations/0007_…sql`, `0008_…sql` (new) | See Migrations |
| `packages/db/src/schema.ts` | Types and column lists for both new columns |

## Checks actually run

**Environment:** worktree `/home/user/mth-wt-be` at base `868ebb6` plus the changes above; Node from the repo toolchain; `pnpm` offline. A disposable **PostgreSQL 16.13** cluster was created fresh for every integration command, by `initdb` under `$TMPDIR` on `127.0.0.1:5440`, TCP only. Because the sandbox maps only uid 0, the cluster ran under `unshare --user --map-user=1000` and was destroyed afterwards. `TEST_DATABASE_ADMIN_URL=postgresql://postgres@127.0.0.1:5440/postgres`, `QA_E2E_PG_PORT=5440`, and the global setup applied **8 migrations** to a fresh database.

| Command | Result |
|---|---|
| `pnpm -r typecheck` | exit 0 |
| `pnpm -r build` | exit 0 (`apps/api/dist` contains no `*.testkit*`) |
| `pnpm lint` (`eslint . --max-warnings=0`) | exit 0, no output |
| `pnpm test` (unit-node + unit-web) | exit 0: `Test Files 18 passed (18)`, `Tests 179 passed (179)` (baseline before changes: 15 files / 130 tests) |
| `npx prettier --check <every changed .ts/.json file>` | `All matched files use Prettier code style!` |
| `pnpm format:check` (repo-wide) | **BLOCKED** (exit 2): the sandbox denies reading `/home/user/mth-wt-be/CLAUDE.local.md` (`EACCES`), a file outside this change. Every matched file it could read passed. |
| Focused contract test: `vitest run --project integration apps/api/test/integration/contract --reporter=verbose` | exit 0, 9/9 (output below) |
| Full `pnpm test:integration`, 3 consecutive runs, fresh cluster each | run 1: `17 passed (17)`, `193 passed (193)`, unhandled/57P01: 0, exit 0; run 2: same; run 3: same. Baseline at `868ebb6`: `Tests 2 failed | 179 passed (181)`, exit 1 |
| New integration tests against the **old** code (HEAD versions of transformations/identity/access sources, `schema.ts`, migrations 0007/0008 removed) | exit 1: `Tests 22 failed | 54 passed (76)`. Key reasons: closure `expected [ 200, … ] to deeply equal [ 422, … ]`; TL create→read `expected 404 to be 200`; OIDC `GET /auth/login sets the browser-binding login cookie: expected undefined to be truthy`. Two F-DG1-106 guards ("still denies…", "adds no assignment…") fail on old code only because the new column is missing; they are regression guards, not reproductions. "refuses a close from draft" passes on old code too (it already refused `draft→closed`). |
| New unit tests against the old code | `transitions.test.ts` on HEAD `routes.ts`: 2/2 failed; the old architecture lint with the D+E plant: 9/9 **passed** (missed it); the new lint: failed as required (above) |
| Planted worker leak (throwaway test, deleted) | passed: teardown rejected with `still open before the drop: planted-leak` |

Focused contract run (real output, colours stripped):

```text
[integration] PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1); database mth_test_mup7z861_3ae129d7; applied 8 migrations to a fresh database
 ✓ |integration| apps/api/test/integration/contract/contract.test.ts > route coverage > maps every governed Fastify route to an OpenAPI operation with the same method, and back 2ms
 ✓ |integration| apps/api/test/integration/contract/contract.test.ts > route coverage > declares access on every governed route (public or a permission) 1ms
 ✓ |integration| apps/api/test/integration/contract/contract.test.ts > every operation, validated against the contract and the zod mirrors > health 20ms
 ✓ |integration| apps/api/test/integration/contract/contract.test.ts > every operation, validated against the contract and the zod mirrors > auth + me 163ms
 ✓ |integration| apps/api/test/integration/contract/contract.test.ts > every operation, validated against the contract and the zod mirrors > organizations and business units 120ms
 ✓ |integration| apps/api/test/integration/contract/contract.test.ts > every operation, validated against the contract and the zod mirrors > users, roles, permissions and assignments 135ms
 ✓ |integration| apps/api/test/integration/contract/contract.test.ts > every operation, validated against the contract and the zod mirrors > transformations and audit 137ms
 ✓ |integration| apps/api/test/integration/contract/contract.test.ts > every operation, validated against the contract and the zod mirrors > branding tokens (getBrandingTokens): authenticated-only, provisional provenance, contract + zod valid 8ms
 ✓ |integration| apps/api/test/integration/contract/contract.test.ts > every operation, validated against the contract and the zod mirrors > covers every operation with at least one success and every successful body with its zod mirror 1ms
 Test Files  1 passed (1)
      Tests  9 passed (9)
[withpg] exit=0
```

The run logs live in this run's private `$TMPDIR` scratch directory, which is removed when the run ends. The outputs above are copied from them verbatim. I have no write scope for `docs/delivery/test-evidence/`; reviewers should re-run on the frozen candidate.

## Known gaps / not done

- **Not done (outside my scope, needs another owner):**
  - The `docs/api/openapi.yaml` prose for `updateTransformation` still lists `→closed`, and `data-dictionary.md` needs the two new columns.
  - The web form still offers "Closed" (F-DG1-004 / frontend). The API refuses it with an existing, already-translated problem code.
- **Not run by me:** e2e / Playwright and the full Compose stack (the assignment allows this; reviewers re-run them). `pnpm format:check` repo-wide is **BLOCKED** (sandbox read denial on `CLAUDE.local.md`); the changed files pass Prettier.
- **Behavioural notes for reviewers:**
  - **Parallel-tab OIDC logins:** only the latest binding survives.
  - **Derived assignment revocation:** a derived creator assignment follows its source on **revocation** (cascade) and on `effective_to` (copied at creation). A *later edit* of the source's `effective_to` is not propagated; in P1 there is no API to edit it.
  - **Failed OIDC login start:** the binding cookie is set only after the login state is written, so a failed start sets no cookie.
- **Not committed:** see Merge instructions.

## Merge instructions

1. The changes are uncommitted in the worktree (`dg1r2-be`, base `868ebb6`). I left committing to the orchestrator because the assignment doesn't ask me to commit. Untracked files to include: `apps/api/src/architecture.testkit.ts`, `apps/api/src/modules/{workflows,kpi,reporting}/**`, `packages/db/migrations/0007_oidc_login_browser_binding.sql`, `packages/db/migrations/0008_scoped_assignment_derived_from.sql`. The untracked dotfiles at the worktree root (`.bashrc`, `.idea`, …) are not mine; don't commit them.
2. Migrations: `mth-db migrate` applies 0007 then 0008 after 0006. 0007 deletes pending login states (any user mid-login restarts it). No backfill is needed: every existing assignment is direct, so `derived_from_assignment_id` stays NULL.
3. Expected conflicts:
   - **QA suites (`tests/qa/**`):** any that drive `/auth/callback` without the `mth_login` cookie now get `state_invalid`. Carry the cookie from `/auth/login`, as `apps/api/test/integration/oidc.test.ts` does.
   - **Integration and e2e tests:** any that close a transformation via PATCH now get 422.
   - **QA unit tests that call `OidcService.startLogin` / `consumeState` directly:** they need the new `browserBinding` argument. None exist in the repo today.
   - **The frontend task (F-DG1-004):** this touches no web file.
4. Dependency requests: **none.**
