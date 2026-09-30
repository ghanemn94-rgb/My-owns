# P1 work split: file ownership, contracts and integration order

- **Task:** T-DG1-ARCH-01 (solution-architect), 2026-09-30.
- **Scope:** the three parallel P1 implementation tasks, each in its own git worktree. qa-verifier writes test-first acceptance suites in its own areas.
- **Rule:** two agents never edit the same file (REQ-DLV-008). Anything not listed under an owner below is **frozen**, and changes go through the orchestrator.

## 0. Preconditions before the parallel tasks start

These are orchestrator actions. They could not be completed in the architect's sandbox, which has no network and a read-only `.github/` and `.gitignore`:

1. Run `node scripts/verify-dependency-pins.mjs`, fix any failing pins, then `pnpm install` to create **`pnpm-lock.yaml`**. Commit both.
2. Apply the `.gitignore` block from the architect's handback (node_modules, dist, coverage, .env, test artefacts).
3. Confirm `pnpm install --frozen-lockfile && pnpm -r typecheck && pnpm -r build` on a clean clone.

Starting implementers without a committed lockfile would make every worktree generate its own lockfile, which is a guaranteed conflict.

## 1. Frozen shared files (owner: solution-architect; changes only via the orchestrator)

| Path | Why frozen |
|---|---|
| `docs/api/openapi.yaml` | The API contract (ADR-0007). Frontend and backend both code against it. |
| `docs/architecture/**` (ADRs, ERD, data dictionary, this file, `ci/ci.yml`, discovery) | Architecture decisions |
| `package.json` (root), `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.editorconfig`, `.npmrc`, `.nvmrc`, `vitest.config.ts`, `playwright.config.ts` | Shared build configuration |
| `scripts/**` (`openapi-lint.mjs`, `check-no-cdn.mjs`, `verify-dependency-pins.mjs`) | Shared checks |
| `packages/shared/src/constants.ts`, `permissions.ts`, `problem.ts`, `index.ts` | Consumed by API, worker and web alike |
| `packages/design-tokens/src/tokens.json` **values** | Provisional §15 seed (REQ-S15-002). Changes only via Branding Settings (P5) or an orchestrator decision. frontend-ux-engineer may **add** derived and semantic tokens (see §3). |
| **`dependencies`/`devDependencies` in every `package.json`, and `pnpm-lock.yaml`** | One lockfile. Dependency changes are requested in the handback; the orchestrator applies them all at once at integration and regenerates the lockfile. |

Each package owner **may edit the `scripts` field** of the package.json files they own.

## 2. backend-workflow-engineer (T-DG1-BE)

**Owns (writes):**
- `apps/api/**` except `package.json` dependencies:
  - `src/modules/{platform,audit,identity,access,organization,transformations,jobs,admin}/**`;
  - `src/server.ts`, `src/index.ts`;
  - `test/**`, including `test/integration/contract/**`.
- `apps/worker/**` except `package.json` dependencies.
- `packages/db/**` except `package.json` dependencies:
  - `migrations/**`: **the only writer of migrations**;
  - `src/**` (Kysely types, pool, transaction helper, runner, CLI including `bootstrap`);
  - `test/**`, including `test/global-setup.ts`;
  - `seeds/dev/**`: synthetic dev-login users only, clearly marked synthetic and never run in production.
- `packages/config/src/**` except `index.ts`'s `ENV_VARS` names, which are frozen. The loader goes in `src/load.ts`; adding a variable is a request via the orchestrator.
- `packages/shared/src/schemas/**`: keep it in lockstep with `docs/api/openapi.yaml`. A drift is a bug in the schemas, never a contract change.

**Consumes:**
- `docs/api/openapi.yaml` (all P1 operations);
- `docs/architecture/data-dictionary.md` (exact P1 tables, constraints, indexes, grants, triggers);
- ADR-0002 (module map in `apps/api/src/modules.ts` plus the architecture test);
- ADR-0003, ADR-0004, ADR-0005, ADR-0006, ADR-0007, ADR-0008;
- `@mth/shared` constants and permissions.

**Delivers (P1):**
- migrations 0001+ that apply to a fresh DB, with roles, grants, the audit trigger and the SoD trigger;
- the role and permission seed equal to `permissions.ts`;
- the migrate/status/bootstrap CLI;
- config loader;
- OIDC login and callback, dev login (AUTH_MODE guard), sessions, CSRF, `/me`, preferences;
- policy function and scope filter;
- org/BU/user/role/assignment admin endpoints;
- transformation CRUD with `If-Match`/409/428, archive, Idempotency-Key, audit on every mutation, outbox event;
- `GET …/audit`;
- `/healthz`, `/readyz`;
- rate limits and request IDs;
- the worker's outbox relay, `transformation.created` handler with ledger, dead-letter queue and session purge;
- unit and integration tests, contract tests and the route-coverage test.

**Must not touch:** `apps/web/**`, `packages/design-tokens/**`, `deploy/**`, `.github/**`, `e2e/**`, `tests/qa/**`, or the frozen files above.

## 3. frontend-ux-engineer (T-DG1-FE)

**Owns (writes):**
- `apps/web/**` except `package.json` dependencies:
  - `index.html`, `vite.config.ts`, `vitest.config.ts`;
  - `src/**`: shell, router, API client, i18n catalogues `src/i18n/{ar,en}/**`, pages, components, styles;
  - `e2e/**`: the frontend's own Playwright journeys and EN/AR visual screenshots, at `apps/web/e2e/`;
  - `public/**`.
- `packages/design-tokens/**` except the seven seeded values in `src/tokens.json`:
  - generator (`src/generate.ts` → `dist/tokens.css`);
  - derived action shade and semantic status tokens (added to `tokens.json` under new keys);
  - contrast checker (`src/contrast.ts` plus the `check:contrast` script);
  - tests.

**Consumes:**
- `docs/api/openapi.yaml`;
- `@mth/shared` (constants, permissions, problem types) and `@mth/shared/schemas` (zod forms);
- ADR-0009 (stack, i18n/RTL, tokens, fonts, wordmark, a11y, explicit states);
- ADR-0005 (cookie session, CSRF header from `/me`, dev login only when `/me.authMode = dev`);
- ADR-0007 (problem `code` → translated message; 409 conflict state; cursor pagination).

**Delivers (P1):**
- the bilingual shell: AR RTL default and EN LTR, persisted language switch, `dir`/`lang` on `<html>`, logical CSS;
- navigation placeholders for the 14 areas (REQ-S03-007 increment);
- a provisional text wordmark with a "Provisional" badge (REQ-S15-006);
- bundled IBM Plex fonts with no CDN (REQ-S15-005);
- tokens CSS and the contrast gate (REQ-S15-002/003);
- sign-in page (OIDC button, plus the dev-login form only in dev mode);
- transformations list (sorting, filters, cursor pagination, column selection), create (mode + entry phase), detail with workspace header, edit with conflict handling, archive with a reason;
- admin screens for organizations, BUs, users and role assignments;
- empty, loading, error, stale, conflict and no-permission states;
- axe checks and EN/AR screenshots;
- unit tests, including i18n key parity.

**Must not touch:** `apps/api/**`, `apps/worker/**`, `packages/db/**`, `packages/config/**`, `packages/shared/**`, `deploy/**`, `.github/**`, root `e2e/**`, `tests/qa/**`, or the frozen files.

## 4. devops-engineer (T-DG1-DEVOPS)

**Owns (writes):**
- `.github/workflows/ci.yml`: install `docs/architecture/ci/ci.yml` verbatim first, then add the image job and digest pins. **Never** touch `delivery-gates.yml`.
- `deploy/**`:
  - `docker/Dockerfile`, `.dockerignore` handling;
  - `compose/compose.yaml`, with an internal-network variant for the no-egress smoke test;
  - `keycloak/realm-mth-test.json`, with synthetic users and no real credentials;
  - `scripts/` for startup and smoke tests.
- `.dockerignore`.
- `.env.example`: generated from `packages/config/src/index.ts` `ENV_VARS`; no secret values.
- `docs/operations/**`: local/clean-VM startup, health/readiness, restricted-network preparation (§19 items 6–7, P1 increments).
- `licenses/`: collection script for third-party notices and SBOM generation from the lockfile.

**Consumes:**
- ADR-0011 (images, Compose, no egress, config);
- ADR-0013 (CI);
- ADR-0012 (Playwright image and `PLAYWRIGHT_BROWSERS_PATH`, Postgres service);
- ADR-0003 (PostgreSQL 18, roles `mth_owner`/`mth_app`, migrate as a one-shot);
- ADR-0005 (Keycloak test IdP; `AUTH_MODE=oidc` in production images);
- the start commands in `apps/api/package.json` and `apps/worker/package.json`, and `mth-db migrate`.

**Delivers (P1):**
- one application image with api, worker and migrate commands, non-root;
- Compose with db, migrate, api, worker and a `test-idp` profile;
- health checks;
- CI with `needs: delivery-gates` semantics;
- the Keycloak realm;
- `.env.example`;
- a clean-start runbook and smoke test;
- an A18 first-case clean start, together with qa-verifier.

**Must not touch:** `apps/**` source, `packages/**`, `e2e/**`, `tests/qa/**`, `tools/**`, `.github/workflows/delivery-gates.yml`, or the frozen files.

## 5. qa-verifier (test-first, before freeze)

- **Owns:** `tests/qa/**` (Vitest projects `unit-node`/`integration` pick up `tests/qa/unit/**` and `tests/qa/integration/**`) and root `e2e/**` (Playwright).
- **Suites:** the first cases of A12 (cross-scope read/write), A13 (job idempotency), A14 (409 conflict), A20 (bilingual shell, token change) and A18 (clean start, with devops), all against the OpenAPI contract.

## 6. Integration order (orchestrator)

1. **Preconditions (§0):** pins verified, lockfile committed, `.gitignore` applied, clean-clone typecheck/build.
2. **backend-workflow-engineer** merges first: migrations, API and worker. After this the API contract is live, so frontend and QA can run against it.
3. **frontend-ux-engineer** merges second. Only `apps/web/**` and `packages/design-tokens/**` change, so there is no textual conflict with step 2.
4. **devops-engineer** merges third. Only `deploy/**`, `.github/workflows/ci.yml`, `.env.example`, `.dockerignore`, `docs/operations/**` and `licenses/**` change. The Compose and CI runs now exercise the merged app.
5. **Dependency requests** from all three handbacks are applied together, followed by one lockfile regeneration and a re-run of the full checks.
6. **qa-verifier** suites (already in the tree) run on the integrated candidate. Then the candidate is frozen.

**Expected conflicts:** none textual, by construction. Semantic risks to check at integration:
- the web client vs the live API responses: covered by contract tests and e2e;
- CI job commands vs package scripts.
