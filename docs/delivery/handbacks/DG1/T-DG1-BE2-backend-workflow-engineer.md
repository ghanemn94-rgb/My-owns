# Handback T-DG1-BE2: GET /api/v1/branding/tokens (backend-workflow-engineer)

- **Stage / gate:** P1 / DG1. **Requirement:** REQ-S15-002 (A20).
- **Invocation:** `DG1-T-DG1-BE2-backend-workflow-engineer-20261001T060635Z-1c770f00`, session `1c770f00-55cf-4db3-ba0d-a128e116a1a2`.
- **Base revision:** `9d7eab2e279545ed4fb824b38d7f7b8fe85f0f32`. The assignment file sha256 `43e6dd4a…fae136f` was verified.
- **Status: INCOMPLETE (BLOCKED on a contradiction in the assignment).** The endpoint is implemented and unit-tested, but it is **not registered in `server.ts`**. The assignment requires it to read from `@mth/design-tokens`, and `@mth/api` cannot import that package without a dependency change that the assignment forbids. The details and a minimal unblock follow.

## 1. Blocker (contradiction, not guessed around)

The assignment says to "read from `@mth/design-tokens` (`colorTokens`)" and also "**Do not** change any dependency, the lockfile …". In the current tree these can't both hold:

1. `apps/api/package.json` doesn't declare `@mth/design-tokens`, and pnpm has created no link for it. `apps/api/node_modules/@mth/` holds only `config`, `db` and `shared`. Running `node --conditions=@mth/source -e "import('@mth/design-tokens')"` in `apps/api` gives:
   `ERR_MODULE_NOT_FOUND Cannot find package '@mth/design-tokens' imported from /home/user/My-owns/apps/api/[eval]`.
2. `apps/api/src/architecture.test.ts` (ADR-0002) allows modules to import only `@mth/shared`, `@mth/config`, `@mth/db` and the third-party dependencies of `@mth/api`.
3. I rejected the workarounds:
   - A relative import of `../../../packages/design-tokens/src/...` breaks `tsc -p tsconfig.build.json` (`rootDir: src`). It also breaks the runtime `dist`, because `.ts` gets rewritten to a `.js` that doesn't exist, and it violates the module-boundary test.
   - Reading `tokens.json` from the filesystem is an undeclared dependency that may not exist in a deployed image.
   - Copying the values into `@mth/shared` breaks the single token source (ADR-0009).

**Minimal unblock (for the orchestrator or the owner of dependency files):**

1. Add `"@mth/design-tokens": "workspace:*"` to `apps/api/package.json` `dependencies`, then run `pnpm install --offline` so the lockfile and the workspace link update.
2. In `apps/api/src/server.ts` (the composition root; modules stay unchanged, so `architecture.test.ts` needs no change):
   ```ts
   import { colorTokens, tokensAreProvisional } from "@mth/design-tokens";
   import { registerAdminRoutes, registerBrandingRoutes } from "./modules/admin/index.ts";
   // after registerAdminRoutes(app, deps):
   registerBrandingRoutes(app, { colorTokens, tokensAreProvisional });
   ```
   Note: the design-tokens `default` export points at `dist/`, so the production `pnpm -r build` must build `@mth/design-tokens` before `@mth/api`. pnpm's topological order does that once the dependency is declared.
3. Add `getBrandingTokens: brandingTokens` to `ZOD_MIRRORS` in `apps/api/test/integration/contract/contract.test.ts`, plus a 200 and a 401 call. I can do steps 2 and 3 myself (they're in my scope) as soon as step 1 lands. I didn't add them now because step 2 doesn't compile until then.

Consequence: until the route is wired, the integration contract test's route coverage ("every operation has a route") will flag `getBrandingTokens`. That test was not run (see §3).

## 2. Changed files

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/branding.ts` (new) | Zod mirror of OpenAPI `BrandingTokens` (`brandingProvenance`, `brandingToken`, `brandingTokens`), strict objects, in lockstep with the contract. |
| `packages/shared/src/schemas/index.ts` | Re-exports `./branding.ts`. |
| `apps/api/src/modules/admin/branding.ts` (new) | `toBrandingTokens(source)` maps the token source to the contract shape and validates it with the zod mirror. `registerBrandingRoutes(app, source)` registers `GET /api/v1/branding/tokens` with `access: { permission: "authenticated" }`. The source is injected structurally (`BrandingTokenSource` = `{ colorTokens, tokensAreProvisional }`), so the module imports nothing outside the ADR-0002 allow-list. |
| `apps/api/src/modules/admin/index.ts` | Exports `registerBrandingRoutes`, `toBrandingTokens` and `BrandingTokenSource`. |
| `apps/api/src/modules/admin/branding.test.ts` (new) | Unit tests (see §4). |

No migrations. No dependency, lockfile, contract, `modules.ts` or frozen-file changes. I didn't modify `server.ts` (see §1).

## 3. Behaviour delivered (REQ-S15-002)

- **Module placement:** the `admin` module. The contract tags `getBrandingTokens` as `admin`, and Branding Settings (P5) is administrative configuration. This adds no new module boundary.
- **Response:** `{ provenance, tokens: [{ name, value, purpose, provisional }] }`. It contains the seven `colorTokens` entries in source order. Derived and semantic tokens are excluded, because the contract describes "the seeded §15 design tokens".
- **Provenance fails safe:** it is `"provisional"` if `tokensAreProvisional` is true **or** any single token is provisional. It is `"official"` only when neither is true. With today's `tokens.json` (`provisional: true`, every token provisional) the result is `provisional`. No string in the code or response claims official Mobily brand compliance. `#0078FF` stays a provisional token.
- **Access decision:** authenticated-only (`{ permission: "authenticated" }`), the same convention as `GET /api/v1/me`. No catalogue permission fits (none covers branding or settings), the data isn't sensitive, and every signed-in user's UI needs it. So I added **no new permission**. Unauthenticated requests get 401 from the identity hook (`if (!request.session) throw problems.unauthenticated()`), and the contract declares only 200 and 401. The 401 path is exercised end to end only once the route is wired and the integration test runs.
- **Mutation rules:** none apply. This is a read-only GET with no audit event, no If-Match and no CSRF.

## 4. Checks actually run

Environment: local sandbox, Node v22.22.2, pnpm 10.33.0, offline, `node_modules` preinstalled, revision `9d7eab2e` plus the working-tree changes above.

| Command | Exit | Result (tail) |
|---|---|---|
| `pnpm -r typecheck` | 0 | `apps/api typecheck: Done` (all packages Done) |
| `pnpm -r build` | 0 | `apps/api build: Done` (all packages Done) |
| `pnpm lint` | 0 | `eslint . --max-warnings=0`, no output |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 33 operations` |
| `pnpm test` (unit-node + unit-web) | 0 | `Test Files 15 passed (15)` / `Tests 130 passed (130)` |
| `npx vitest run --project unit-node apps/api/src packages/shared` | 0 | `architecture.test.ts (9 tests)` ✓, `server.test.ts (2 tests)` ✓, `admin/branding.test.ts (4 tests)` ✓, `37 passed` |
| `npx prettier --check apps/api packages/shared` | 0 | `All matched files use Prettier code style!` |
| `pnpm format:check` (whole repo) | 2 | Fails **only** on `CLAUDE.local.md: EACCES permission denied`, an untracked file outside my scope that the sandbox can't read. My files are formatted. |
| `pnpm test:integration` | — | **BLOCKED**: `TEST_DATABASE_ADMIN_URL` is unset in this environment, so there is no disposable PostgreSQL. It would also flag `getBrandingTokens` in route coverage until §1 is resolved. |

The `branding.test.ts` cases:

1. A 200 response holds exactly the seven seeded tokens, with values and purposes from master prompt §15 (M0293–M0299) used as an independent oracle: `#0078FF`, `#003B73`, `#F5F8FC`, `#FFFFFF`, `#142438`, `#526174`, `#DCE5EF`. It has `provenance=provisional` and validates against both the shared zod mirror and the `BrandingTokens` schema loaded from `docs/api/openapi.yaml` (ajv 2020). The body contains no "official/compliant/certified".
2. The route declares `{ permission: "authenticated" }`. The contract operation is `getBrandingTokens` with responses `200` and `401`.
3. Provenance is never `official` while the set or any single token is provisional (positive and negative cases).
4. The zod mirror and the contract reject the same malformed shapes: unknown provenance, extra properties, missing `provisional`.

Not covered: the test injects a fixture source, not the real `@mth/design-tokens` module, because the import is blocked (§1). The test against the real package belongs to the wiring step (`server.test.ts` or integration).

## 5. Known gaps / not done

- The route isn't registered in `server.ts` and `@mth/design-tokens` isn't consumed (§1). **Acceptance check 3 isn't met yet**, and the A20 end-to-end check is outstanding.
- The integration contract test (zod mirror entry, and the 200 and 401 calls through the contract-validating harness) isn't added or run: BLOCKED by §1 and by the missing test database.

## 6. Merge instructions

- No migrations and no ordering constraints. The changes are additive and self-contained. They compile, lint and test green on their own, and `toBrandingTokens` is unused until wiring.
- After merging, apply §1 steps 1–3 in that order. Expect no conflicts beyond `server.ts` and `contract.test.ts`.
