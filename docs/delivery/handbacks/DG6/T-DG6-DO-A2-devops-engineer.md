# Handback T-DG6-DO-A2: dependency upgrades for the 20 High advisories, new pinned dependencies (devops-engineer)

- **Stage:** DG6 (BUILDING), P6 "Integration and system hardening". Scope: D-199 "DO-A §0 (security)", plus D-197.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-DO-A2-devops-engineer-20261027T032151Z-9360d697","session_id":"9360d697-77a1-4d54-bcdd-49cb78cea152"}`. Assignment sha256 `a4926403…b7cfb1` (verified with `sha256sum`).
- **Tree:** worktree `/home/user/wt/dg6-do-a2`, branch `dg6/do-a2`, base `HEAD` `af13bd6168e3a77485d95133f0a9ada7f0783735`. The changes are **uncommitted**, as the assignment asks.
- **Time:** started 2026-10-27 03:22:04 UTC (`date -u`); ended at the `date -u` in §9.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` printed `PASS gate DG5 (historical)` and exited **0** at 03:22:21 (`T-DG6-DO-A2-evidence/validate-dg5-historical-start.log`). It was re-run at the end (§9).

## 0. Headline

- **The 20 High advisories on shipped packages are gone.** The live audit and the offline check now agree.
  - Live `pnpm audit --audit-level high --prod` exits **0**: 10 vulnerabilities, 4 low and 6 moderate, **0 high, 0 critical**.
  - Including dev packages, `pnpm audit --audit-level high` exits **0**: 14 vulnerabilities, 4 low and 10 moderate, 0 high or critical. So the vitest/tinypool Criticals and the vite Highs are gone too.
  - Offline `node deploy/scripts/dep-audit.mjs` exits **0**: `PASS: no High/Critical advisory in the snapshot matches a shipped component`.
- **Two zod 4.6 behaviour changes surfaced.** Both are adapted, and each adaptation keeps the DG5 results; details in §2.
  - string `min`/`max`/`length` now count code points;
  - an object key declared `z.unknown()` is now required.
- **`pnpm test` on the final code:** locale unset **exit 0**. C.UTF-8: every test passes, but the run **exits 1** on Vitest's unhandled worker RPC timeout (`onTaskUpdate`), taken under host load 13–20. A C.UTF-8 re-run is needed (§4.2). Integration: 3301 passed and 8 failed, all explained (§4.4).
- **e2e evidence is partial.** I invalidated part of my own e2e run by rebuilding `dist` while its stack was serving it (§4.3). That part is reported as void, not as passed or failed.

## 1. Versions changed, and the release notes / breaking changes checked

| Package | Where | Locked → new | Why this version | What I checked (sources) | Breaking for us? |
|---|---|---|---|---|---|
| `fastify` | apps/api | 5.6.1 → **5.12.7** | ≥ 5.12.2 (6 High); latest 5.x | Diff of the `docs/` shipped in the 5.6.1 and 5.12.7 tarballs (Reference + Guides), the type definitions, and `LogController` in `fastify.js`. | New deprecation **FSTDEP024**: the top-level `requestIdLogLabel` (we used it). Adapted (§2.3). Also: `QUERY` added to the default methods; `FST_ERR_ROUTE_MISSING_CONTENT` no longer thrown (unused here); `FSTDEP023`/`FSTDEP025` options are unused here. FSTDEP022 (routerOptions constraints access) was already printed at base. |
| `@fastify/static` | apps/api | 8.2.0 → **10.1.7** (major) | ≥ 10.1.1 (GHSA-83w8-p2f5-377r) | Diff of `index.js` and `types/index.d.ts` between 8.2.0 and 10.1.7. | No code change needed. Our registration (`{ root, wildcard: false, index: ["index.html"] }`) and the SPA fallback `reply.sendFile("index.html")` are unchanged API. Changes: options become a union type `RootOptions` (`serve: true` needs `root`; ours passes `root`); `setHeaders` now receives the reply (unused); non-canonical paths (`..`, `//`, `/./`) and case-alias spellings are now refused with 403 (the advisory fix); `content-disposition` 3 for `download` (unused); `glob` 11 → 13 (BlueOak-1.0.0, as before); new option `suppressWarning`. The SPA, static assets and the fallback are exercised by the e2e that passed (§4). |
| `kysely` | apps/api, apps/worker, packages/db | 0.28.7 → **0.28.18** | ≥ 0.28.17; latest on `release-0.28` (0.29 is a new 0.x minor, so not taken) | Diff of the `dist/esm/*.d.ts` (253 files differ, mostly doc comments and `export type` markers). | No: typecheck exit 0, all DB-backed tests green. |
| `zod` | api, web, worker, config, shared | 4.1.12 → **4.6.7** | ≥ 4.6.6 (GHSA-mrhx-c7xc-m3w5) | Source diff of `v4/core/checks.js`, `util.js`; behaviour probed on both versions (`$TMPDIR` probe, output in §2.1/§2.2). | **Yes, two changes** (§2.1, §2.2). Both adapted; both pinned by a new test. The web `vendor-forms` chunk grew 112.6 → 152.3 kB (no bundle budget exists; the >500 kB warning on `index-*.js` was already there at base). |
| `react-router` | apps/web | 7.9.0 → **7.18.4** | ≥ 7.18.0 (7 High); latest `version-7` (8.x is a new major, not taken) | `CHANGELOG.md` in the 7.18.4 tarball, every entry 7.9.1–7.18.4 (`$TMPDIR/rr-changes.md`, 797 lines). | No. The "breaking" entries are for `unstable_*` APIs (not used: `grep unstable_ apps/web/src` finds none) or framework/RSC/SSR mode (we are a data-mode SPA: `createBrowserRouter`/`RouterProvider`). The `matchPath` optional-segment fix doesn't apply: there's no `matchPath` with `:x?` in `apps/web/src`. |
| `image-size` | via `pptxgenjs@4.0.1` (packages/reporting) | 1.2.1 → **2.0.4** by root `pnpm.overrides` | ≥ 2.0.3; no patched 1.x exists | `pptxgenjs@4.0.1/dist/pptxgen.es.js` and `.cjs.js`: the only `sizeOf` use is inside a commented-out function (`getSizeFromImage`, "FIXME: TODO: currently unused"), and `image-size` is never `require`d or imported. | No: pptxgenjs never calls it. Verified by a new test that embeds a PNG and a JPEG (§3), and the 5 existing PPTX tests pass. |
| `vitest` | root (dev) | 3.2.4 → **3.2.7** | ≥ 3.2.6 (Critical GHSA-5xrq-8626-4rwp); latest `V3` | `npm view vitest@3.2.7 dependencies` (still `tinypool ^1.1.1`, `vite-node 3.2.4`); 4.x/5.x are new majors (4.x drops tinypool). | No; the whole suite runs on it. |
| `tinypool` | via vitest (dev) | 1.1.1 → **2.2.0** by root `pnpm.overrides` | ≥ 2.1.2 (Criticals GHSA-85c8-ppgw-ccpr, GHSA-5gmw-xhrv-c9v3); no patched 1.x | `npm view tinypool` (versions, engines `^20 || >=22`). The GitHub release notes were **not reachable** (403 from `github.com` / `api.github.com` in this session). Compatibility was established by running every Vitest invocation of `pnpm test` and `pnpm test:integration` on it. | No failure attributable to it. |
| `vite` | apps/web (dev) | 7.1.11 → **7.3.7** | > 7.3.6 (the 4 High); latest 7.x | `packages/vite/CHANGELOG.md` at tag `v7.3.7` (raw.githubusercontent.com), every entry 7.2.0-beta.0 to 7.3.7. | No: fixes and `server.fs` security backports only; the build is unchanged apart from chunk hashes. |
| `@aws-sdk/client-s3` | apps/api | new, **3.1156.0** exact (D-197; ADR-0054 §2 Option A) | as decided | `npm view`: Apache-2.0, engines `>=20.0.0`, own types. | n/a (not imported yet; BE-H) |
| `nodemailer` | apps/api, apps/worker | new, **10.2.1** exact (D-197; ADR-0054 §3; the API adapter and its worker twin, work split J/C.10) | as decided | `npm view`: MIT-0, ships its own types (`dist/cjs/nodemailer.d.ts`), so **no `@types/nodemailer` is needed**. | n/a (not imported yet; BE-I) |

- **Where the release notes were unreachable:** fastify, zod, kysely, vitest, tinypool and @fastify/static publish their release notes as GitHub Releases. `github.com` and `api.github.com` answered 403 in this session. For those packages I read the published tarballs instead: their shipped docs, types and the code paths we use. That substitute is disclosed, not hidden.
- **Lockfile delta:** 465 → 483 package entries. **53 removed, 71 added**, every one being a listed package or its dependency tree (`@aws-sdk/*`, `@smithy/*`, `bowser`, `esbuild` 0.25.12 → 0.28.2 via vite, `fastify-plugin` 6, `content-disposition` 3, `glob` 13, the `@vitest/*` 3.2.7 set). No other version moved. The list is in the install comparison above (computed from `pnpm-lock.yaml` before and after).

## 2. Code adaptations the upgrades required (each with its reason)

### 2.1 zod 4.6 counts string length in code points (`packages/shared/src/schemas/common.ts`)

**The library change.** `$ZodCheckMinLength`, `$ZodCheckMaxLength` and `$ZodCheckLengthEquals` use `util.codePointLength` (4.6.7 `v4/core/checks.js`), where 4.1.12 used `input.length` (UTF-16 units).

**The effect here.** The `trimmedText` guard "skip the blank check when `min` already failed" measured `v.length` (units). So `"\u{E0100}\u{E0100}"` (2 code points, 4 units) on `reason` (min 3) got **two** errors, `too_small` and `validation.blank`. That breaks the F-DG2-160 "one error, never two" rule (unit test `schemas.test.ts > name and reason …` failed: `test-locale-unset-run1-before-repairs.log`).

**The repair:**

- The guard now counts code points (`codePointCount`, `Array.from(v).length`; a lone surrogate counts as one, as in zod).
- The test's invisible-only value became 3 code points.
- Two assertions were added: `reason("\u{E0100}\u{E0100}")` → `too_small` only, and `name(…)` → `validation.blank` only.

**Consequence, for the reviewers.** Every zod string bound in the product (`min`, `max`, `length`) now counts characters as the OpenAPI/JSON Schema `minLength`/`maxLength` (Ajv) and PostgreSQL `char_length`/`varchar(n)` do. Before, a text of emoji could be refused by zod below its documented maximum. Server-side truncation (`truncateText`, units) still yields ≤ max code points. I didn't find any test or text that depended on the unit count other than the one above.

### 2.2 zod 4.6 makes a bare `z.unknown()` object key required

**Probe on both versions:**

- `z.strictObject({ q: z.unknown(), a: z.any() }).safeParse({})` → 4.1.12 `{}` (accepted), 4.6.7 `invalid_type` with `expected: "nonoptional"` for both keys.
- `.optional()` → accepted on both versions.

**The effect.** The methodology search's missing `q` returned `400 validation.invalid_type` instead of `validation.search_query`. Integration failures:

- `reader-search-provenance.test.ts > q of 1 character …`;
- `p5-exercises-be-q2.ts` (in `contract.test.ts` and `response-validation.test.ts`);
- the aggregate "covers every operation …".

**The repair (behaviour-preserving):** `.optional()` on the six object keys of the code base that were bare `z.unknown()`, so an absent key is accepted again exactly as at DG5:

- `apps/api/src/modules/methodology/search.ts` (`q`);
- `packages/shared/src/schemas/{change-control (fromTo), studio-checks (from, to), audit (changes.from/to), audit-events (from, to), methodology-migrations (value)}.ts`.

(An audit diff for an added field has no `from`; `JSON.stringify` drops an `undefined` side.)

**The type ripple.** The inferred type became `from?: unknown`. `apps/web/src/lib/auditChanges.ts` `describeAuditChange`/`describeAuditChanges` now accept `{ readonly from?: unknown; readonly to?: unknown }`. That is a type-only change: an absent side reads as `undefined`, as before.

**Pinned by** the new `packages/shared/src/schemas/zod-upgrade.test.ts` (3 tests: the library behaviour; audit changes with only `to`, only `from`, or neither, accepted, and an extra key refused; the code-point length).

### 2.3 fastify FSTDEP024 (`apps/api/src/server.ts`)

- **Before:** `requestIdLogLabel: "requestId"`.
- **After:** `logController: new LogController({ requestIdLogLabel: "requestId" })`, the replacement fastify's docs name.
- **Verified** with a scratch Fastify 5.12.7 instance: the log lines still carry `requestId` (not `reqId`), and no warning is printed.

### 2.4 No other code change

`@fastify/static` 10 needed none (§1). No migration, no contract change, no new route, no OpenAPI change.

## 3. Changed files

| File | Purpose |
|---|---|
| `package.json` | `vitest` 3.2.7; `pnpm.overrides` adds `image-size: 2.0.4` and `tinypool: 2.2.0` (exact; no patched 1.x lines exist). |
| `apps/api/package.json` | `fastify` 5.12.7, `@fastify/static` 10.1.7, `kysely` 0.28.18, `zod` 4.6.7; **new** `@aws-sdk/client-s3` 3.1156.0, `nodemailer` 10.2.1 (exact). |
| `apps/worker/package.json` | `kysely` 0.28.18, `zod` 4.6.7; **new** `nodemailer` 10.2.1 (the worker twin of the email adapter, work split J/C.10). |
| `apps/web/package.json` | `react-router` 7.18.4, `zod` 4.6.7, `vite` 7.3.7. |
| `packages/{config,shared}/package.json`, `packages/db/package.json` | `zod` 4.6.7; `kysely` 0.28.18. |
| `pnpm-lock.yaml` | Regenerated by `pnpm install` (sha256 `4dd7e22dedf2640216767b594af3d1765aa966bb0f229edeac84ba544364ba65`). |
| `apps/api/src/server.ts` | §2.3. |
| `apps/api/src/modules/methodology/search.ts` | §2.2 (`q`). |
| `packages/shared/src/schemas/common.ts` | §2.1. |
| `packages/shared/src/schemas/{audit,audit-events,change-control,studio-checks,methodology-migrations}.ts` | §2.2. |
| `apps/web/src/lib/auditChanges.ts` | §2.2, the type-only ripple. |
| `packages/shared/src/schemas/schemas.test.ts` | §2.1: the invisible value gets 3 code points; 2 new assertions. |
| `packages/shared/src/schemas/zod-upgrade.test.ts` (new) | §2.2: 3 tests. |
| `packages/reporting/src/pptx-images.test.ts` (new) | The assignment's PPTX test. pptxgenjs (with `image-size` overridden to 2.0.4) embeds a generated 3×2 PNG and an 8×8 baseline JPEG. It checks: both `ppt/media/*` parts are byte-identical to the input; `[Content_Types].xml` has `png` and `jpeg` defaults; `slide1.xml.rels` and `<a:blip r:embed>` reference both; every XML part is well-formed (`malformedParts` = []). Independently, image-size 2.0.4 reads both (3×2 png, 8×8 jpg) and Chromium decodes both (pixel `0,120,255` and `128,128,128`): `pptx-image-decode-check.log`. |
| `licenses/sbom.cdx.json`, `licenses/inventory.csv` | `node licenses/generate-sbom.mjs`: 483 packages (171 runtime, 15 bundled, 297 development), 4 containers, 0 shipped without a licence id. sha256 `998b2eeb…19dd39` / `f726ab2b…a17cb`. |
| `licenses/README.md` | The DG6 state after DO-A2 (new shipped trees and their licences; the two overrides). |
| `deploy/advisories/snapshot-2026-10-27.json` | `node deploy/scripts/dep-audit.mjs --refresh` (retrieved 2026-10-27T03:36:41.571Z; 483 package versions / 468 names queried; 14 advisories on 6 packages); prettier-formatted. Same dated file name as DO-A's (same day), overwritten. sha256 `d4e8aa98…361a99`. |
| `docs/operations/dependency-audit.md` | "Recorded runs" points at this handback too. |
| `docs/delivery/handbacks/DG6/T-DG6-DO-A2-devops-engineer.md`, `…/T-DG6-DO-A2-evidence/*` | This handback and its logs. |

**New shipped licences** (inventory rows that were added or changed):

- `@aws-sdk/*` and `@smithy/*`: Apache-2.0;
- `bowser`: MIT;
- `nodemailer`: MIT-0;
- `fastify-plugin` 6 and `content-disposition` 3: MIT;
- `glob` 13: BlueOak-1.0.0 (glob 11 already was).

The `@esbuild/*` 0.28.2 binaries are development-only `NOASSERTION`, as the 0.25.12 ones were.

## 4. Checks actually run

**Environment:**

- Linux 6.18.44 (sandboxed agent run); 4 CPUs.
- **Host load average 12–16 throughout**, from the concurrent W5 runs.
- Node 24.21.0; pnpm 10.33.0.
- PostgreSQL from `with-pg.sh` / `with-stack.sh` (newest `/usr/lib/postgresql/*/bin`); Chromium from `/opt/pw-browsers`; harness ports 23900–23949 only.
- No Docker used (none needed).

**Network** (this task only, through the egress proxy):

- `registry.npmjs.org` was used for the install, `npm view`/`npm pack` and the audit. npm's `noproxy` (which lists the registry) was overridden with `npm_config_noproxy=localhost,127.0.0.1`, plus `npm_config_https_proxy=$HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`/`npm_config_cafile=/root/.ccr/ca-bundle.crt` and `NODE_USE_ENV_PROXY=1`.
- `raw.githubusercontent.com` (vite CHANGELOG) and a reachability probe of `fastify.dev`, `zod.dev` and `kysely.dev`.
- `github.com` and `api.github.com`: **403**.

**Install:**

- `~/.npm/_cacache` and the pnpm store `/root/.local/share/pnpm/store/v10` are **read-only** in this sandbox.
- So `pnpm install --no-frozen-lockfile --store-dir $TMPDIR/pnpm-store --config.confirmModulesPurge=false` was used (exit 0, 27 s, 432 packages downloaded; `pnpm-install.log`). This worktree's `node_modules/.modules.yaml` therefore names a store under the run's `$TMPDIR`. The files are hardlinked on the same filesystem and stay valid, but the next `pnpm install` in this worktree will purge and relink.
- The lockfile is store-independent; the orchestrator's merge-time install is unaffected.

### 4.1 Results

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | 0 | `PASS gate DG5 (historical)` | `validate-dg5-historical-start.log` |
| 1 | `pnpm -r typecheck` (after all edits) | 0 | all packages Done | `typecheck.log` |
| 2 | `pnpm -r build` (after all edits, 04:29–04:31) | 0 | all packages Done | `build-2.log` (an intermediate run failed at `apps/web` tsc with the §2.2 type ripple, then fixed; `build.log` is the earlier, pre-§2.2 green build) |
| 3 | `pnpm lint` | 0 | `eslint . --max-warnings=0`, clean | `lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| 5 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 922 operations` | `openapi-lint.log` |
| 6 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` (final code) | see §4.2 | | `test-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` (final code) | see §4.2 | | `test-c-utf8.log` |
| 8 | `QA_PG_PORT=23900 MTH_PORT_POOL=23901-23919 tests/qa/support/with-pg.sh pnpm test:integration` | see §4.4 | | `test-integration.log` |
| 9 | `pnpm audit --audit-level high --prod` (live) | **0** | 10 vulnerabilities: 4 low, 6 moderate; **0 high/critical** | `pnpm-audit-live-prod.txt`, `.json` (the `--json` run exits 1 by design: it uses the default level `low`) |
| 9b | `pnpm audit --audit-level high` (live, including dev) | 0 | 14: 4 low, 10 moderate | `pnpm-audit-live-all.txt` |
| 10 | `node licenses/generate-sbom.mjs` then `--check` | 0 / 0 | `packages=483 runtime=171 bundled=15 development=297 containers=4 shipped-without-licence-id=0 lockfile-sha256=4dd7e22d…` | `sbom-generate.log` |
| 11 | `node deploy/scripts/dep-audit.mjs --refresh` | 0 | 483 versions queried, 14 advisories on 6 packages | `dep-audit-refresh.log` |
| 12 | `node deploy/scripts/dep-audit.mjs` (offline) | **0** | `PASS: no High/Critical advisory in the snapshot matches a shipped component`; listed, not failing: 6 moderate/runtime, 4 low/runtime, 4 moderate/development | `dep-audit-offline.log` |
| 13 | `pnpm vitest run --project unit-node packages/reporting/src/pptx-images.test.ts packages/reporting/src/pptx.test.ts` | 0 | 6/6 (1 new + 5 existing PPTX) | in rows 6/7 too |
| 14 | image check (`$TMPDIR` script: image-size 2.0.4 + Chromium decode of the test's PNG and JPEG) | 0 | png 3×2, jpg 8×8; decoded | `pptx-image-decode-check.log` |
| 15 | demo suite: `E2E_PG_PORT=23930 E2E_API_PORT=23931 MTH_PORT_POOL=23932-23934 e2e/support/with-demo-stack.sh npx playwright test e2e/a02-guided-walkthrough.spec.ts e2e/a02-demo-users-walkthrough.spec.ts e2e/a02-demo-labels.spec.ts e2e/a21-no-ai-operation.spec.ts --workers=1` (locale unset, final build) | **0** | **12 passed** (6 × chromium-en, chromium-ar), 5.4 min | `e2e-demo-locale-unset.log` |
| 16 | C.UTF-8 e2e subset: `LANG=C.UTF-8 LC_ALL=C.UTF-8 E2E_PG_PORT=23935 E2E_API_PORT=23936 MTH_PORT_POOL=23937-23949 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p5-shell.spec.ts apps/web/e2e/p6-shell.spec.ts apps/web/e2e/p5-reports-exports.spec.ts e2e/a20-bilingual-shell.spec.ts e2e/a15-reporting.spec.ts --workers=1` (final build) | **0** | **76 passed**, 0 failed, 7.4 min (SPA served by @fastify/static 10, sign-in, shells in en/ar, report exports incl. PPTX, the bilingual-shell A20 and A15 reporting) | `e2e-c-utf8-subset.log` |
| 17 | full web + root e2e, locale unset (§4.3) | — | **partially void** | `e2e-locale-unset.log` |
| 18 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | see §9 | | `validate-dg5-historical-end.log` |

### 4.2 `pnpm test` counts

| Run | unit-node | unit-web | unit-formula-nocodegen | Exit |
|---|---|---|---|---|
| run 1, locale unset, before the repairs (03:32) | 2 failed \| 2458 passed (156 files): the dep-audit check (snapshot not yet refreshed) and the §2.1 zod failure | 1768 passed (96) | 259 passed \| 2 skipped (261) | 1 (`test-locale-unset-run1-before-repairs.log`) |
| run 2, locale unset, after §2.1 + refresh, before §2.2/§2.3 | 2461 passed (157) | 1768 passed (96) | 259 \| 2 skipped | 0 (`test-locale-unset-run2.log`) |
| run 2, C.UTF-8 | 2461 passed (157) | 1768 passed (96) | 259 \| 2 skipped | 0 (`test-c-utf8-run2.log`) |
| **run 3 (final code), locale unset** (04:36–04:49) | **2464 passed (158 files)**, but **1 unhandled error**: `[vitest-worker]: Timeout calling "onTaskUpdate"` | 1768 passed (96) | 259 passed \| 2 skipped (261) | **1** (`test-locale-unset-run3-rpc-timeout.log`) |
| **run 3 (final code), C.UTF-8** (04:49–05:05) | **2464 passed (158 files)**, but **2 unhandled errors**, the same `onTaskUpdate` timeout | 1768 passed (96) | 259 passed \| 2 skipped (261) | **1** (`test-c-utf8.log`) |
| **run 4 (final code), locale unset** (05:05–05:14; started at load 12, after the other suites had finished) | **2464 passed (158 files)**, no error | **1768 passed (96)** | **259 passed \| 2 skipped (261)** | **0** (`test-locale-unset.log`) |

**Acceptance item 2:**
- **Locale unset: met.** Run 4 exits 0 on the final code.
- **C.UTF-8: every test passes, but the final-code run (run 3) exits 1.** Vitest counted 2 unhandled `[vitest-worker]: Timeout calling "onTaskUpdate"` errors (birpc's 60 s timeout on a worker's progress message to the main process; no assertion failed).
  - The locale-unset run 3 had the same single error.
  - Both runs 3 ran at load 13–20, with the integration suite and two e2e stacks running concurrently.
  - Run 2, in both locales, had the same package versions including the tinypool 2.2.0 override and lacked only §2.2/§2.3 and `zod-upgrade.test.ts`. It had no such error, and neither has run 4.
  - This points to host load, not the upgrade, but a clean C.UTF-8 run on the final code was **not obtained** within the time limit.
- **For the orchestrator:** run `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` once on the merged tree. If the timeout recurs on a quiet host, the `vitest` 3.2.7 + `tinypool` 2.2.0 pairing (an override outside vitest's declared `^1.1.1`) is the suspect, and the fallback is vitest 4.x (no tinypool), which is a major upgrade needing a decision.

The 2 skips are the pre-existing ones in `packages/shared/src/formula/fuzz.test.ts`. unit-node grew by +3 (`zod-upgrade.test.ts`) and +1 (`pptx-images.test.ts`) relative to DO-A's 2455; the rest of the difference comes from W4 merges on the base.

### 4.3 Full e2e with the locale unset: partially void, through my own mistake

**The run:** `E2E_PG_PORT=23920 E2E_API_PORT=23921 MTH_PORT_POOL=23922-23929 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e <the 10 non-demo root specs> --workers=1`. It held 518 tests (apps/web/e2e plus root a03–a22 without a02/a21, × en/ar) and started at ≈03:41 on the first green build.

- **Tests 1–197 passed, 0 failed.** These include `journeys.spec.ts` and every P2–P4 spec of chromium-en, run on the upgraded stack.
- **Test 198 onwards is void.** At 04:29 I re-ran `pnpm -r build` for the §2.2 repair while that stack was serving `apps/web/dist`. Vite empties `dist` and writes new hashed asset names. `@fastify/static` with `wildcard: false` registers routes only for the files present at start-up, so every page load after that requested assets that answer 404, and the specs failed at their first locator ("element(s) not found" for the sign-in field or `main#main h1`).
- **The timing matches.** The first failure (test 198, `p5-procedures-automation.spec.ts:492`) falls at the `dist/index.html` mtime `04:29:23`.
- **The diagnosis was checked by a re-run.** Two of the "failed" specs were re-run on a fresh stack after the build: `apps/web/e2e/p5-procedures-automation.spec.ts` and `p5-reader-branding-demo.spec.ts`, locale unset, ports 23940–23949. Result: **exit 0, 20 passed** (10 tests × chromium-en, chromium-ar) in 4.1 min, 04:48–04:53 UTC. So the specs pass, and the void part of the run was caused by the rebuild, not by the upgrade (`e2e-locale-unset-rerun-invalidated.log`).
- **I couldn't stop the void run.** Each sandboxed command has its own process namespace, so I could not see or stop it. It ended at 05:05 with **208 passed, 161 failed, 149 did not run** (exit 1). Its log is kept as it is; none of its results after test 197 counts as a pass or a failure.
- **The full e2e in both locales is therefore NOT COMPLETE** (§8). The C.UTF-8 evidence is the 76-test subset (row 16).

### 4.4 Integration

**Full run:** `QA_PG_PORT=23900 MTH_PORT_POOL=23901-23919 tests/qa/support/with-pg.sh pnpm test:integration`, started 03:38 UTC at load 13. It ran on the tree **before** the §2.2/§2.3 repairs; Vitest runs the integration suite from source, but my 04:29 rebuild also swapped `dist` under any test that spawns the built worker. Result: **exit 1** after 82.7 min (03:38:30–05:01:30): **4 failed | 326 passed (330 files); 8 failed | 3301 passed | 1 skipped | 1 todo (3311 tests)**. All 8 are analysed below. None is an unexplained failure caused by the upgrade: 4 come from §2.2 (fixed and re-run green), 2 are load timeouts or aggregates, and 1 is pre-existing.

**Files with failures in the full run** (every other reported file passed):
- `contract/contract.test.ts` (101 tests, 2 failed): `P5 BE-Q2 operations` (§2.2) and the aggregate "covers every operation …" that follows from it.
- `contract/response-validation.test.ts` (109 tests, 4 failed): `P5 BE-Q2 operations` (§2.2), the aggregate, `P5 BE-J operations` (passes in isolation) and `… an undeclared request media type …` (30 s timeout under load).
- `hardening/integrity-sweep.test.ts` (19 tests, 1 failed): the pre-existing `deleteSavedView` pin (below).
- `methodology/reader-search-provenance.test.ts` (15 tests, 1 failed): §2.2.

**Isolated reruns after the repairs** (`QA_PG_PORT=23940 MTH_PORT_POOL=23941-23945 tests/qa/support/with-pg.sh pnpm vitest run --project integration …`, `test-integration-iso-3-after-fix.log`):

- `reader-search-provenance.test.ts`, `integrity-sweep.test.ts` and `response-validation.test.ts -t "searchMethodology|REQ-S16-023|BE-J operations|BE-Q2 operations"` gave **27 passed, 1 failed**.
- **The one failure is pre-existing and not mine:** `integrity-sweep.test.ts > every DELETE operation of the contract is listed …` expects `["retireDependencyType"]` but the contract at base `af13bd6` also has `deleteSavedView` (ARCH-04's W4 contract). Neither `docs/api/openapi.yaml` nor the test is changed by this task (`git diff --quiet HEAD -- …` → unchanged). It is deterministic, independent of the dependencies, and for the orchestrator or the BE-F owner (§6).

**Before the repairs** (`test-integration-iso-1.log`, `-iso-2.log`): the same files showed the §2.2 failure (`validation.invalid_type`). `response-validation > P5 BE-J operations`, which failed in the loaded full run, **passed in isolation**.

**Two more failures in the loaded full run were timeouts:**

- `contract.test.ts > … an undeclared request media type …` timed out at 30 s. It is the same timeout DO-A saw under load; it isn't reproduced in isolation.
- The aggregate "covers every operation" follows from the BE-Q2 failure.

**Pinned-count change from this task: none.** Operation count, media types, rate-limit floor and CSRF-exempt routes are untouched.

## 5. Behaviour delivered, per requirement row

**REQ-S16-030** (owners backend-workflow-engineer; devops-engineer). Acceptance text, quoted: *"A12: security tests cover CSRF, SQL injection, XSS in rich text, disallowed upload type, oversized upload and rate limiting, and all pass"*. This task delivers the row's "Dependency audit" part ("dependency audits run in CI").

- **Delivered:** the shipped components have no High/Critical advisory, live (row 9) and offline (row 12). The offline check in `pnpm test` (`deploy/scripts/tests/dep-audit.vitest.mjs > the committed tree …`) now **passes** in both locales. DO-A's designed failure is resolved by upgrade, not by any waiver.
- **The A12 clauses themselves** (CSRF, SQL injection, XSS, upload type and size, rate limiting) are BE-E2's security suite, and were not changed here. Their integration tests run within row 8.

**D-197:** `@aws-sdk/client-s3@3.1156.0` and `nodemailer@10.2.1` are exact-pinned in the packages ADR-0054 names. The SBOM, inventory and snapshot cover them (both `runtime`, not "uncovered").

## 6. Operations routed; contract, schema and dependency needs (for the orchestrator)

- **Operations routed:** none. DO-A2 has no `p6-pending-*`/`p6-exercises-*` list. Contract-test pinned counts are unchanged.
- **No migration** (the highest on the branch stays `0110`). No OpenAPI change.
- **No dependency beyond D-199/D-197.** `@types/nodemailer` is not needed (nodemailer 10 ships types).
- **Pre-existing failure, needs an owner:** `apps/api/test/integration/hardening/integrity-sweep.test.ts:195` pins the contract's DELETE list as `["retireDependencyType"]`, but the base contract also has `deleteSavedView` (ADR-0057, W4). A BE-F2 or ARCH-04 decision is needed: list it with its finalized-record rationale, or change the contract.
- **Remaining non-High advisories (not in D-199's scope; for a decision):**
  - shipped `ajv` 8.17.1 (moderate GHSA-2g4f-4pwh-qvx6, `$data` ReDoS; fixed 8.18.0);
  - `uuid` 13.0.0 (moderate GHSA-w5hq-g745-h8pq; fixed 13.0.1);
  - `fast-uri` 3.1.8 and 4.2.1 (3 moderate + 4 low; fixed 3.1.9 / 4.2.3; via ajv / fastify's json-schema stack).
  - The gate rule (ADR-0052 §6) fails only on High/Critical, so these don't block. `uuid` and `ajv` are direct pins, a one-line bump each if wanted.
- **For reviewers (the zod change in §2.1):** string bounds are now counted in code points product-wide. That aligns zod with the contract (Ajv) and PostgreSQL. If any frontend `maxLength` attribute (which counts UTF-16 units) is expected to equal the zod bound exactly, it is now stricter than the server for astral characters. That is not a defect, but worth knowing.

## 7. User-facing texts made untrue

None. No en/ar UI string mentions dependency versions, advisories or the SBOM. The operations docs I touched (`licenses/README.md`, `docs/operations/dependency-audit.md`) now state the post-upgrade state. `configuration.md`'s "The optional S3-compatible adapter is a later-stage item (P6)" stays true: the client is pinned, but the adapter is BE-H's.

## 8. What remains

1. **`LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` on a quiet host** (§4.2): it must confirm that the `onTaskUpdate` RPC timeout is load, not the tinypool 2 override.
2. **The full product e2e in both locales**, on the integrated tree, on a quieter host:
   - locale unset: only tests 1–197 of 518 are valid evidence (§4.3);
   - C.UTF-8: only the 76-test subset ran.
   The orchestrator should run `with-stack.sh npx playwright test apps/web/e2e <root non-demo specs> --workers=1` once per locale **without rebuilding during the run**.
3. **Integration:** see §4.4. Its full run started before the §2.2/§2.3 repairs; the repaired paths were re-run in isolation. The pre-existing `deleteSavedView` sweep failure needs its owner (§6).
4. The non-High advisories (§6), if the orchestrator wants them.

## 9. End

- Ended at 2026-10-27 **05:16 UTC** (`date -u`), about 114 minutes after the 03:22:04 start. I stopped after the ~100-minute mark, as the assignment requires.
- At that point the tree typechecks, builds, lints, is prettier-clean and passes `openapi:lint` (§4.1 rows 1–5). Since those runs, nothing has changed except this handback and its evidence logs.
- `node tools/gates/validate.mjs --historical --stage DG5` was re-run at 04:48:32 and printed `PASS gate DG5 (historical)`, **exit 0** (`validate-dg5-historical-end.log`).

**Acceptance summary:**

| Item | Result |
|---|---|
| 1. typecheck, build, lint, prettier, openapi lint | all exit 0 |
| 2. `pnpm test`, locale unset and C.UTF-8 | locale unset: **exit 0** (run 4: 2464 + 1768 + 259/2 skipped). C.UTF-8: all tests pass, but **exit 1** on the final code (2 Vitest `onTaskUpdate` RPC timeouts under load, §4.2), so **C.UTF-8 is not met** and needs a re-run. The previous code state exited 0 in both locales (run 2). |
| 3. Integration | exit 1: 8 of 3311 failed, all explained (§4.4); the 4 §2.2 failures re-run green after the fix; 1 pre-existing failure needs its owner; 2 load timeouts or aggregates; pinned counts unchanged |
| 4. `validate --historical --stage DG5` | exit 0 at start and end |
| Extra: e2e | demo suite **12/12**; C.UTF-8 subset **76/76**; locale unset: 197/197 valid before my rebuild invalidated the rest, and the 2 specs re-run 20/20. **Full e2e in both locales: not complete** (§8). |
| Dependency audit | live and offline: **0 High/Critical on shipped packages** |
