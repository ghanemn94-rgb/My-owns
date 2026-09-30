# Handback: T-DG1-ARCH-01 (solution-architect)

- **Stage/gate:** P1 / DG1 (BUILDING).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG1-T-DG1-ARCH-01-solution-architect-20260930T195632Z-5b270fa9","session_id":"5b270fa9-46a3-4691-9a74-226f966a1615"}`.
- **Assignment:** `docs/delivery/assignments/DG1/T-DG1-ARCH-01.md`, sha256 `c0fc7b0a…2f79` (verified with `sha256sum`).
- **Starting revision:**
  - HEAD `43157046dd469f502332bab819f57cfc97784008`.
  - `git diff --stat 9315878 HEAD` touches only `docs/delivery/assignments/DG1/T-DG1-ARCH-01.md` and `docs/delivery/stages.json`, so HEAD is the base plus metadata-only commits, as the assignment allows.
  - Working tree: my files are all new and untracked. The untracked root dotfiles (`.bashrc`, `.zshrc`, `.gitconfig`, `.idea`, `.vscode`, `.mcp.json`, `CLAUDE.local.md`, …) and `docs/delivery/runs/DG1/` were already there and are **not mine**. Do not commit them as part of this task.

## Status: PARTIALLY COMPLETE. Three required steps are BLOCKED (no network, read-only paths)

Everything that can be produced without the npm registry is delivered. The assignment's install/lockfile/build step and the verification of most version pins **could not be done in this sandbox**, for these reasons:

1. **No network** in the architect's nested sandbox.
   - `npm view typescript version` → `getaddrinfo EAI_AGAIN registry.npmjs.org`. `curl` to the registry, nodejs.org, postgresql.org, GitHub and quay.io returned no connection.
   - An attempt to reach the registry through the sandbox's local proxy was **denied by the permission system**. I did not try to get around that. The user or orchestrator decides whether this role's sandbox should get registry access.
   - As a result, `pnpm install`, `pnpm-lock.yaml`, `pnpm -r typecheck`/`build` of the full workspace, `pnpm lint` and `pnpm openapi:lint` are **BLOCKED**.
   - Most version pins are therefore **[UNVERIFIED]**: proposed from prior knowledge and clearly tagged in every ADR and in the discovery doc.
2. **`.github/workflows/ci.yml` could not be written.** `.github/` is read-only in this run: the shell got `Read-only file system`, and the Write tool got `EROFS`. The complete intended workflow is at `docs/architecture/ci/ci.yml`, to be installed verbatim.
3. **`.gitignore` could not be edited.** The shell got `Read-only file system`, and the Edit tool got `EBUSY` (bind-mounted). The exact block to append is under "Merge instructions" below.

**Contradiction in the assignment contract, reported as the protocol requires:** the assignment says "run `pnpm install` so `pnpm-lock.yaml` is committed". But agent-protocol states that the agent sandbox has no network, and REQ-DLV-042 puts the install step with the orchestrator, in a registry-only sandbox. I followed the protocol and stopped short of any workaround.

## 1. Changed files (all new)

### Root configuration
| File | Purpose |
|---|---|
| `package.json` | Workspace root: scripts `build`, `typecheck`, `lint`, `format`, `format:check`, `test`, `test:integration`, `e2e`, `openapi:lint`, `check:no-cdn`, `deps:verify`; exact-pinned dev tools; `packageManager: pnpm@10.33.0`; engines; pnpm lifecycle-script allow-list (empty) |
| `pnpm-workspace.yaml` | Members `apps/*` and `packages/*`; `tools/**` deliberately excluded |
| `tsconfig.base.json` | Shared strict TypeScript 6 options (NodeNext, ESM, erasable syntax, `.ts` import rewriting, `@mth/source` condition) |
| `eslint.config.js` | Flat config: typescript-eslint recommended, type-import rule, `parseFloat` ban (decimal rule), react-hooks rules for web |
| `.prettierrc.json`, `.prettierignore` | Formatting; never reformats `docs/`, `tools/`, delivery records or the lockfile |
| `.editorconfig` | Editor defaults (LF, UTF-8, 2 spaces) |
| `.npmrc` | `save-exact`, `engine-strict`, workspace linking |
| `.nvmrc` | `24` (target LTS line, ADR-0001) |
| `vitest.config.ts` | Projects `unit-node`, `unit-web`, `integration` (disposable DB global setup), including `tests/qa/**` |
| `playwright.config.ts` | CF-2: pinned 1.56.1, `PLAYWRIGHT_BROWSERS_PATH` browsers, never `playwright install`; EN and AR projects in Asia/Riyadh; `e2e/**` (QA) plus `apps/web/e2e/**` (frontend) |
| `scripts/openapi-lint.mjs` | OAS 3.1 validation (swagger-parser) plus project rules (CSRF, If-Match 409/428, problem+json, unique operationIds) |
| `scripts/check-no-cdn.mjs` | Dependency-free scan that fails on public CDN or remote font/script hosts |
| `scripts/verify-dependency-pins.mjs` | Needs the registry: checks each pin for existence, licence allow-list, deprecation, engines, peers and latest version; emits a Markdown table |

### Packages (each has `package.json`, `tsconfig.json`, `tsconfig.build.json` unless noted, a minimal compilable source, and a README)
| Path | Purpose |
|---|---|
| `apps/api/src/{index,modules}.ts` | API skeleton; **module map and dependency-direction rules** (ADR-0002) |
| `apps/worker/src/index.ts` | Worker skeleton: queue names, relay and retry constants (ADR-0008) |
| `apps/web/{index.html,vite.config.ts,vitest.config.ts,tsconfig.json,src/main.tsx,public/.gitkeep}` | Vite + React skeleton (`lang="ar" dir="rtl"` default) |
| `packages/shared/src/{index,constants,permissions,problem}.ts` | Phases, modes, statuses and transitions, scope types, defaults (Asia/Riyadh, SAR), **permission catalogue and 14 seeded roles**, RFC 9457 problem types |
| `packages/shared/src/schemas/*.ts` | zod 4 mirrors of every OpenAPI component (subpath `@mth/shared/schemas`) |
| `packages/config/src/index.ts` | **Environment-variable contract** `ENV_VARS` (required, secret, default, usedBy); `AUTH_MODES` |
| `packages/db/src/{index,cli}.ts`, `packages/db/migrations/.gitkeep` | Migration naming, DB roles, CLI skeleton (`mth-db migrate \| status`) |
| `packages/design-tokens/src/{tokens.json,index.ts}` | **The seven provisional §15 tokens** (REQ-S15-002), typed access, CSS variable naming |
| `packages/calc/README.md`, `packages/reporting/README.md` | Reserved directories (P4 and P5); no package.json yet |

### Documentation
| File | Purpose |
|---|---|
| `docs/architecture/README.md` | Index |
| `docs/architecture/adr/ADR-0001…0014-*.md` | 14 ADRs (see "Behaviour delivered") |
| `docs/architecture/erd.md` | P1 physical ERD plus conceptual ERD of all 12 §16 groups (81 entities), with the stage per table |
| `docs/architecture/data-dictionary.md` | P1 tables: columns, types, constraints, indexes, grants, triggers, invariants |
| `docs/architecture/p1-work-split.md` | File ownership, contracts consumed, forbidden paths and integration order for BE, FE, DevOps and QA |
| `docs/architecture/discovery/p1-stack-discovery.md` | Stack discovery: [V-LOCAL] facts with commands, CF-1/T-1/CF-2/T-3/L-flag resolutions, offline checks, licence inventory, next steps |
| `docs/architecture/ci/ci.yml` | The full `ci.yml` for devops to install (REQ-DLV-025) |
| `docs/api/openapi.yaml` | OpenAPI 3.1.1 P1 contract: 32 operations, 52 schemas, security schemes, problem responses |
| `docs/delivery/handbacks/DG1/T-DG1-ARCH-01-solution-architect.md` | This handback |

## 2. Behaviour delivered, per requirement

**Completing at DG1 (my scope):**

| Requirement | Delivered | Status |
|---|---|---|
| REQ-S16-001 | ADR-0002: modular monolith, separate worker process, dependency rules, module map in code | Design delivered; implementation by BE |
| REQ-S16-002 | ADR-0009: React 19 + Vite 7 + TypeScript; web skeleton | Design delivered; web skeleton not compiled (BLOCKED, no React types offline) |
| REQ-S16-003 | ADR-0002 modules (identity/access, transformations, workflows, formulas via kpi/calc, reporting, admin); `modules.ts` | Delivered as design and skeleton |
| REQ-S16-004 | ADR-0003: PostgreSQL 18 (floor 16), data dictionary | Delivered as design |
| REQ-S19-004 | ERD, data dictionary (validation rules, indexes), migration design (forward-only, must run on a fresh DB) | Design delivered; migrations themselves are BE's (T-DG1-BE) |
| REQ-S19-006 | `docs/api/openapi.yaml`, versioned `/api/v1`, authentication described (cookie session, CSRF, OIDC/PKCE flow, dev login) | Delivered; official OAS validation **BLOCKED** (offline structural check passed) |
| REQ-S15-002 | `packages/design-tokens/src/tokens.json`: the seven §15 values, each marked provisional | Delivered |
| REQ-S15-005 | ADR-0009: IBM Plex Sans Arabic + IBM Plex Sans (OFL-1.1) via Fontsource, bundled locally; `check:no-cdn` | Decision and pins delivered (versions UNVERIFIED); bundling by FE |
| REQ-S15-006 | ADR-0009 §5: text wordmark plus a visible "Provisional / مؤقت" badge; no invented logo | Decision delivered; UI by FE |
| REQ-DLV-025 | ADR-0013 plus `docs/architecture/ci/ci.yml`: first job `delivery-gates` runs `validate.mjs --pipeline`; every product job `needs` it | Designed; **not installed** (`.github` read-only) |
| REQ-DLV-033 | Architecture decisions, ERD/API contracts and repo/build skeleton delivered; CI designed; migrations, auth, shell, persistence and audit baseline are the three implementers' work | Partial (my part) |

**P1 increments shaped by this design:**
- REQ-S10-001…004, REQ-S06-010: ADR-0006. Permission catalogue and roles in `permissions.ts`. Technical admins hold no business-record read and no approval rights, backed by a DB trigger.
- REQ-S16-026: ADR-0003 and OpenAPI (`If-Match`, 409 with `currentVersion`, 428).
- REQ-S16-027: versioned API, zod validation, problem+json, cursor pagination.
- REQ-S16-030: sessions, CSRF, rate limits, helmet CSP, secret handling.
- REQ-S16-032: ADR-0004.
- REQ-S16-005: ADR-0008.
- REQ-S16-006: ADR-0010.
- REQ-S16-007: ADR-0005.
- REQ-S16-008: ADR-0011.
- REQ-S16-009: discovery doc, licence inventory, `deps:verify`.
- REQ-S16-010: typed tables, ADR-0014.
- REQ-S16-011/012/022: ERD.
- REQ-S15-003: contrast figures computed; checker assigned to FE.
- REQ-S15-007: RTL/LTR rules, preferences endpoint.
- REQ-S15-008: defaults Asia/Riyadh and SAR; the three time concepts.
- REQ-S15-011: explicit states.
- REQ-S15-013: table and pagination contract.
- REQ-S12-004: outbox `transformation.created`.
- REQ-S01-002: `PRODUCT_NAME`, `/me.productName`.
- REQ-S19-007/009/010/019: auth described, env catalogue, health/readiness, no CDN or egress.
- REQ-PB-003: mode and entry-phase rules in schema and data dictionary.
- REQ-S20-012/013/014/018/020: test hooks defined (ADR-0012).

## 3. Checks actually run

Environment: this sandbox, Node v22.22.2, tsc 6.0.2 (`/opt/node22/bin/tsc`), no network, 2026-09-30.

| # | Command | Result |
|---|---|---|
| 1 | `node tools/gates/validate.mjs --stage DG0 --historical` | `PASS gate DG0 (historical)`, **exit 0** |
| 2 | `node tools/gates/validate.mjs --pipeline` | `PASS pipeline (active stage: DG1 BUILDING)` |
| 3 | Offline typecheck and build: `tsc -p tsconfig.json` and `tsc -p tsconfig.build.json` for `packages/{shared,config,db,design-tokens}` and `apps/{api,worker}`, in a scratch copy (`$TMPDIR/offline2`) with hand-made workspace symlinks, the cached `@types/node` **25.5.0** (not the pinned 22.18.0), and `packages/shared/src/schemas` excluded (zod not installable) | 12/12 exit 0, no diagnostics (`overall=0`) |
| 4 | `node -e 'import("./packages/shared/dist/index.js")…'` and design-tokens | `dist ok 6 14`; `tokens ok --mth-brand-primary #0078FF` |
| 5 | `node --conditions=@mth/source -e 'import("./src/index.ts")…'` (apps/api) | `strip ok /api/v1 8`: native type stripping and source condition work on 22.22.2 |
| 6 | `node --conditions=@mth/source packages/db/src/cli.ts status` | prints the not-implemented message, exit 2 (as designed) |
| 7 | `node scripts/check-no-cdn.mjs` | `PASS no-cdn: scanned apps, packages`, exit 0 |
| 8 | `node --check scripts/openapi-lint.mjs && node --check scripts/verify-dependency-pins.mjs` | syntax OK (not executed: need swagger-parser or network) |
| 9 | PyYAML structural check of `docs/api/openapi.yaml` (scratch script): YAML parse, every `$ref` resolves, unique operationIds, path params declared, CSRF on unsafe methods, 409/428 with If-Match, problem+json on errors | `openapi 3.1.1 operations 32 schemas 52` / `STRUCTURAL CHECK: no problems`. The first run found a YAML scalar error, which I fixed and re-ran. |
| 10 | Python ERD coverage: every entity named in REQ-S16-011…022 titles appears in `erd.md` §2 | `81 entities; missing: []` |
| 11 | PyYAML parse of `docs/architecture/ci/ci.yml` | jobs `delivery-gates, verify, integration, e2e`; `verify` needs `delivery-gates`; integration and e2e need `verify` |
| 12 | WCAG contrast of the provisional tokens (node one-liner) | `#0078FF`/white **4.09:1** (fails small text); `#526174`/white 6.32; `#142438`/`#F5F8FC` 14.72; white/`#003B73` 11.21 |
| 13 | Tarball and toolchain metadata reads (discovery doc §2) | TS 6.0.2 Apache-2.0; ESLint 10.1.0 MIT; Prettier 3.8.1 MIT; Playwright 1.56.1 Apache-2.0 → chromium r1194 = `/opt/pw-browsers/chromium-1194` |

**BLOCKED (not run):**

| Check | Reason |
|---|---|
| `pnpm install --frozen-lockfile` / creating `pnpm-lock.yaml` | No registry access in this sandbox |
| `pnpm -r typecheck`, `pnpm -r build` (acceptance check 1) | No `node_modules`. Only the offline subset in row 3 ran; `@mth/web` and `@mth/shared/schemas` are unchecked. |
| `pnpm lint` | typescript-eslint not installed |
| `pnpm openapi:lint` (acceptance check 3) | swagger-parser not installed; the structural substitute is row 9 |
| `pnpm deps:verify` | No registry; this is the step that turns [UNVERIFIED] pins into verified ones |
| Official support-window and licence pages for Node, PostgreSQL, Keycloak, Playwright image, MinIO | No network |

## 4. Known gaps / not done

1. **No `pnpm-lock.yaml`.** Acceptance check 1 cannot pass until the orchestrator verifies the pins and installs (see the p1-work-split §0 preconditions). The parallel implementers must **not** start before a lockfile is committed, or they will conflict on it.
2. **Most dependency pins are UNVERIFIED** (see the discovery doc §5). Known risks:
   - `typescript-eslint` 8.46.0 and `eslint-plugin-react-hooks` 5.2.0 peer ranges may not admit TypeScript 6.0 or ESLint 10;
   - `@apidevtools/swagger-parser` 10.1.1 OAS 3.1 support needs confirmation;
   - patch levels (e.g. vite 7.1.x, react-router 7.9.x) must be raised to the latest secure patch.

   Documented fallbacks: TypeScript 5.9.3, ESLint 9, or `@redocly/cli` with telemetry off.
3. **`ci.yml` is not installed** in `.github/workflows/`. The upload-artifact action SHA in it must be re-verified by devops, and the image tags must be pinned by digest.
4. **`.gitignore` is not updated.** Until it is, `node_modules/` and `dist/` would show up as untracked after an install.
5. The Arabic role and organization names and the "مؤقت" badge text are provisional translations that need linguistic review.
6. I implemented no business features (by design). Migrations, API, worker, web shell, Docker/Compose and the Keycloak realm belong to the three implementers per `docs/architecture/p1-work-split.md`.
7. The ADR support windows for Node, PostgreSQL and Keycloak are from prior knowledge and must be re-checked on the official pages, with the date recorded.

## 5. Merge instructions (orchestrator)

1. **Commit** the files listed in §1 only. Leave the pre-existing untracked dotfiles and IDE folders out.
2. **Append to `.gitignore`** (I could not write it):
   ```
   # Product workspace (ADR-0001, T-DG1-ARCH-01)
   node_modules/
   dist/
   coverage/
   *.tsbuildinfo
   .env
   .env.*
   !.env.example
   # Test artefacts (published evidence goes under docs/delivery/test-evidence/, never here)
   test-results/
   playwright-report/
   blob-report/
   # Local evidence storage for the filesystem adapter in development (ADR-0010)
   var/
   ```
3. **In the registry-enabled install sandbox (REQ-DLV-042):**
   1. `node scripts/verify-dependency-pins.mjs > docs/architecture/discovery/p1-pin-verification.md`.
   2. Fix FAIL rows by raising pins. Updating the pins is a shared-file change that solution-architect should own. Re-invoke me with registry access, or apply the change and have me update the ADR evidence tables.
   3. `pnpm install` to create and commit `pnpm-lock.yaml`.
   4. Run `pnpm install --frozen-lockfile && pnpm -r typecheck && pnpm -r build && pnpm lint && pnpm openapi:lint` on a clean clone and record the output.
4. **Hand `docs/architecture/ci/ci.yml` to devops-engineer (T-DG1-DEVOPS)** for installation as `.github/workflows/ci.yml` (their ownership per the stage plan).
5. **Only then start** T-DG1-BE, T-DG1-FE and T-DG1-DEVOPS in parallel worktrees, following `docs/architecture/p1-work-split.md`. Integration order: BE → FE → DevOps → apply dependency requests with one lockfile regeneration → QA suites → freeze.
6. There are no migrations to run from this task. There are no expected textual conflicts, because all files are new.

## Notes

- Agent count or agreement doesn't guarantee correctness. These designs need the independent DG1 reviews and executed tests.
- Nothing here claims official PMI status, Mobily brand compliance or regulatory compliance. `#0078FF` is a provisional token.
