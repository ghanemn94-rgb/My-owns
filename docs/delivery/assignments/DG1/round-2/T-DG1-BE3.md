# Assignment T-DG1-BE3: backend round-2 repairs (backend-workflow-engineer)

- **Stage:** P1 / gate DG1 (round-2 repair). **Base revision:** current `HEAD` of branch `claude/mobily-transformation-platform-kwcc4i` (≥ `c433078`). You run in a dedicated git worktree; `node_modules` is present, so `pnpm` runs **offline**. Do **not** run `pnpm install`; dependency changes go in your handback (name + exact version + why), never applied yourself (you have no network).
- **Preceding gate:** DG0 APPROVED. DG1 round-1 reviews BLOCKED the gate. You are fixing **only** the findings listed below — do not widen scope, do not refactor unrelated code, keep `docs/api/openapi.yaml` and `packages/shared/src/schemas/**` in exact lockstep.
- Read `docs/delivery/findings.json` for the full text of each finding before you start. Read `docs/delivery/decisions.md` D-048 (module scaffolds) — it authorizes the module work below.

## Scope — write ONLY within your areas (p1-work-split §2)
`apps/api/**` (incl. `src/modules/**`, `src/modules.ts`, `src/architecture.test.ts`, `src/server.ts`, `src/index.ts`, `test/**`), `apps/worker/**`, `packages/db/**`, `packages/config/src/**` — all **except** any `package.json` dependency block and `pnpm-lock.yaml` (frozen). Do **not** touch `apps/web/**`, `packages/design-tokens/**`, `deploy/**`, `.github/**`, `docs/**`, `tools/**`, `docs/api/openapi.yaml`, root build config, `scripts/**`, or `packages/shared/src/{constants,permissions,problem,index}.ts`.

## Findings to fix (each: reproduce → fix → prove with a test that fails on the old code)

### High (mandatory)
- **F-DG1-101 / F-DG1-201 — the contract/integration suite is red: `getBrandingTokens` (the 33rd operation, `GET /api/v1/branding/tokens`) is never exercised.** Add contract coverage so the route's response is validated against `docs/api/openapi.yaml` (`getBrandingTokens` + `BrandingTokens` schema) exactly like the other P1 operations, and the route-coverage test shows **no** unmatched P1 operation (now 33/33). Run the contract integration test and include its real output in the handback. The route itself already exists (`apps/api/src/modules/admin/branding.ts`); this is about **test coverage**, not new routes.

### Medium (mandatory)
- **F-DG1-001 — a transformation can be CLOSED (terminal, irreversible) by a plain status edit, with no G6 approval, no validated value, no reason.** In the transition logic (`isAllowedTransition` / the transformation update route), make the **closure / terminal** transition unreachable through the ordinary P1 status edit: closure requires the business approval gate (G6) that does not exist in P1, so P1 must **refuse** a direct client-driven close (problem+json, 409/422 per the existing contract) rather than silently allow it. Keep the engineering gate (DG) vs business gate (G) separation (CLAUDE.md): nothing in P1 may let an API edit grant a G6 business approval. Document the refused transition and cover it with a test (a close attempt is rejected; the record stays in its prior state with an audit event of the *rejected* attempt if that is the existing pattern, else no state change).
- **F-DG1-103 — OIDC login CSRF: the `state` is not bound to the browser that started the login.** Bind `state` (and the PKCE verifier) to the initiating browser — store them in a short-lived, HttpOnly, `SameSite` pre-session cookie (or server-side session keyed by a cookie), and on callback reject the request unless the returned `state` matches the value bound to *this* browser. A callback URL captured by one user must not sign another browser in. Cover with a test: a callback whose `state` does not match the browser's bound value is rejected.

### Medium
- **F-DG1-106 — a Transformation/BU Lead granted at business-unit scope can create a transformation (201) but then gets 404 on read/update/archive of what it just created.** Fix the scope resolution so a creator with a BU-scoped grant can read/update/archive the transformation it legitimately created within that BU (the create and the subsequent reads must resolve the *same* scope). Add tests: create→read→update→archive all succeed for a BU-scoped Lead on a transformation in its BU, and are still denied cross-BU. (The frontend side is F-DG1-004, handled separately — coordinate only through the contract.)

### Medium (mandatory) — module scaffolds, per D-048
- **F-DG1-105 / F-DG1-002 — build the three missing §16 business modules so all six exist with their own test suites (A12 literal reading; D-048 supersedes D-047 part 1).** Promote `workflows`, `kpi` (formulas/KPI) and `reporting` from reserved names to **active P1 module scaffolds**:
  - create `apps/api/src/modules/{workflows,kpi,reporting}/index.ts`, each a typed **public interface** for the module plus a `register<Module>` wiring hook that registers **no mutating routes yet** (business behaviour lands in P2/P4/P5 — document that in the file header, as the existing reserved entries in `modules.ts` note). A read-only placeholder is fine; a mutating route is **not** (it would owe the full authz+validation+concurrency+audit+tests invariant and is out of P1 scope);
  - add the three to `P1_MODULES` in `apps/api/src/modules.ts` (keep the `dependsOn` rules already declared there);
  - give each its **own** test suite `apps/api/src/modules/<m>/<m>.test.ts` asserting the module is mapped, has a public `index.ts`, its `register` hook runs without error, and its declared boundary holds;
  - keep `apps/api/src/architecture.test.ts` green, including its planted-violation check; confirm it still fails on a cross-module import that bypasses an interface.
  After this, the six §16 modules (identity/access, transformations, workflows, formulas/KPI, reporting, admin) all exist with separate suites. `methodology` and `evidence` may remain reserved.

### Low
- **F-DG1-109 — the module dependency-lint misses `createRequire()` and computed `import()` specifiers.** Extend `architecture.test.ts` to also detect `createRequire(...)(...)` requires and dynamic `import(` with a string-literal specifier, so a module cannot bypass the interface check through them. Add a planted case proving it now fails.
- **F-DG1-110 — flaky integration tests:** a global audit-count assertion fails intermittently, and a worker test leaves a connection the DB drop terminates. Make the audit assertion scope-local (assert the delta for the entity under test, not a global count), and ensure the worker test closes its pool/connection in teardown before the disposable DB is dropped.
- **F-DG1-112 — `NODE_ENV=production` accepts an `http` `APP_BASE_URL`, silently dropping the cookie `Secure` flag and the `__Host-` prefix.** In the config loader / session setup, **reject** a non-`https` `APP_BASE_URL` when `NODE_ENV=production` (fail closed at startup with a clear error), so the secure-cookie guarantees cannot be silently lost. Cover with a test.

## Self-verification (offline, in your worktree)
- `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint` (max-warnings=0) — all green.
- `pnpm test` (unit) green, including the new module suites and `architecture.test.ts`.
- The focused **contract** integration test for `getBrandingTokens` against a **real disposable PostgreSQL** (`packages/db/test/global-setup.ts`; set `QA_E2E_PG_PORT`/`TEST_DATABASE_ADMIN_URL` to a **unique** port, e.g. `5440`, so you don't collide with other workers). Record the real output.
- You need not run the full e2e/stack suite — the independent reviewers re-run everything authoritatively on the frozen candidate. But every test you add must pass, and anything you cannot run is **BLOCKED** (never a silent pass).

## Handback
`docs/delivery/handbacks/DG1/round-2/T-DG1-BE3-backend-workflow-engineer.md` — per finding: what was wrong, the fix, the test that now covers it (and that it failed on the old code), with real command output. List changed files, any dependency requests (name + exact version + why), and anything BLOCKED.
