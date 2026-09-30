# P1 stack discovery (T-DG1-ARCH-01)

- **Author:** solution-architect.
- **Run:** `DG1-T-DG1-ARCH-01-solution-architect-20260930T195632Z-5b270fa9`.
- **Date checked:** 2026-09-30.
- **Purpose:** the evidence behind the version pins in ADR-0001…0014 and the resolution of conflicts CF-1, T-1, CF-2, T-3 and the L-flags.

## 1. Method and limits (read first)

- **Network: not available in this run.** The architect's shell runs inside the nested bubblewrap sandbox (agent-protocol "Write scopes": *the sandbox has no network access*).
  - `npm view typescript version` failed with `getaddrinfo EAI_AGAIN registry.npmjs.org`.
  - `curl` to registry.npmjs.org, nodejs.org, endoflife.date, postgresql.org, GitHub and quay.io all returned `000` (no connection).
  - An attempt to route through the sandbox's local HTTP proxy was **refused by the permission system** and was not pursued further.
  - The orchestrator's note that the registry is reachable holds for the orchestrator's environment, not for this nested sandbox.
- **Consequence:** only facts that could be read first-hand from the machine are tagged **[V-LOCAL]**. They came from:
  - the installed toolchain under `/opt/node22`;
  - the pre-installed browsers under `/opt/pw-browsers`;
  - registry tarballs present in the npm cache (`~/.npm/_cacache`, cached 2026-03-31T13:31Z), whose `package.json` files were extracted and read in the run's scratch directory.

  Every other version, support window and licence is **[UNVERIFIED]**, from the architect's prior knowledge (which ends before this date). They **must** be confirmed before the DG1 candidate freezes by running, where the registry is reachable:
  ```
  node scripts/verify-dependency-pins.mjs > docs/architecture/discovery/p1-pin-verification.md
  ```
  plus the official pages listed in §3. The script fails on non-existent, deprecated or non-exact pins, licences outside the allow-list, and peer-range conflicts.
- **Not run:** `pnpm install`, lockfile generation, and `pnpm -r typecheck`/`build` of the full workspace. These are BLOCKED here for the same reason. §4 lists the substitute offline checks that did run. None of them replaces an acceptance check.

## 2. First-hand facts [V-LOCAL, 2026-09-30]

| Fact | Command / source | Result |
|---|---|---|
| Node.js | `node --version` | v22.22.2 |
| npm | `/opt/node22/lib/node_modules/npm/package.json` | 10.9.7 (Artistic-2.0) |
| pnpm | `pnpm --version`; package.json | 10.33.0 (MIT) |
| Corepack | `/opt/node22/lib/node_modules/corepack` | present |
| TypeScript | `/opt/node22/bin/tsc -v`; cached tarball `typescript-6.0.2.tgz` package.json | 6.0.2, Apache-2.0, engines `>=14.17` |
| ESLint | cached tarball `eslint-10.1.0.tgz`; global install | 10.1.0, MIT, engines `^20.19.0 \|\| ^22.13.0 \|\| >=24`, `"type":"commonjs"` |
| Prettier | cached tarball `prettier-3.8.1.tgz`; global install | 3.8.1, MIT |
| @types/node | cached tarball `node-25.5.0.tgz` | 25.5.0 exists, MIT. **Not pinned:** we pin the 22.x types to match the runtime floor. |
| Playwright | `/opt/node22/lib/node_modules/playwright/package.json`; cached tarball | 1.56.1, Apache-2.0, engines `>=18` |
| playwright-core browser map | `…/playwright/node_modules/playwright-core/browsers.json` | chromium **1194** (141.0.7390.37); chromium-headless-shell 1194 |
| Pre-installed browsers | `ls /opt/pw-browsers` | `chromium-1194`, `chromium_headless_shell-1194`, `ffmpeg-1011`, `chromium` symlink; `INSTALLATION_COMPLETE` and `DEPENDENCIES_VALIDATED` markers present |
| PostgreSQL | `psql --version`; `ls /usr/lib/postgresql` | 16.13 (Ubuntu 24.04 build), server binaries for 16 only |
| Docker | `docker version` | CLI present; **permission denied** on `/var/run/docker.sock`, so containers cannot be run in this sandbox |
| Python YAML | `python3 -c "import yaml"` | PyYAML 6.0.1 (used only for an offline OpenAPI structural check) |
| Gate pipeline | `node tools/gates/validate.mjs --pipeline` | `PASS pipeline (active stage: DG1 BUILDING)`; uses git only (no bubblewrap), so the CI gate job only needs `fetch-depth: 0` |
| DG0 historical gate | `node tools/gates/validate.mjs --stage DG0 --historical` | `PASS gate DG0 (historical)`, exit 0 |

## 3. Conflict resolutions

### CF-1: Node.js LTS line

- **Evidence:**
  - The sandbox has v22.22.2 [V-LOCAL].
  - Node release schedule [UNVERIFIED, source https://github.com/nodejs/Release]:
    - 22 "Jod": Maintenance LTS, end of life 2027-04-30;
    - 24 "Krypton": Active LTS since 2025-10-28, Maintenance from about 2026-10-20, end of life 2028-04-30;
    - 26: current, LTS expected from October 2026.
- **Resolution (ADR-0001):**
  - Target runtime **Node 24 LTS** in images, pinned by digest by devops.
  - Supported floor **≥22.18.0** (the sandbox's line), `engines.node ">=22.18.0 <25"`.
  - CI tests both 24 and 22.
  - Rationale: 22 reaches end of life before the likely handover, and 26 is not LTS on the decision date.
  - Node 26 will be re-assessed at P6/P7.

### T-1: ESM only vs CommonJS

- **Evidence:**
  - Node 22.12+ supports `require(esm)` [UNVERIFIED]; a local dynamic import of built ESM output and type-stripped `.ts` source worked on 22.22.2 [V-LOCAL, §4].
  - openid-client 6, uuid 13 and Vite 7 are ESM-first or ESM-only [UNVERIFIED].
- **Resolution (ADR-0001):**
  - All workspace packages are `"type":"module"`, with `module/moduleResolution: NodeNext` (the web app uses `Bundler`).
  - Relative imports use `.ts`, rewritten to `.js` by `rewriteRelativeImportExtensions` (verified in the emitted `dist/index.js` [V-LOCAL]).
  - Custom export condition `@mth/source` for source resolution.

### CF-2: Playwright/Chromium browser path

- **Evidence:** Playwright 1.56.1 expects chromium r1194, and exactly r1194 is installed at `/opt/pw-browsers` [V-LOCAL, §2].
- **Resolution (ADR-0012):**
  - Pin `@playwright/test` **exactly 1.56.1**. It is released in lockstep with `playwright`/`playwright-core` 1.56.1 [UNVERIFIED package existence; the lockstep versioning is Playwright's standard practice].
  - Set `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` in the sandbox and `/ms-playwright` in CI's version-matched image `mcr.microsoft.com/playwright:v1.56.1-noble` [UNVERIFIED tag].
  - **`playwright install` is never run.** Any Playwright upgrade must come with matching browsers and an ADR update.

### T-3: Rate-limiting library

- **Options:**
  - `@fastify/rate-limit` (MIT, first-party Fastify plugin);
  - `rate-limiter-flexible` (ISC, has a Postgres store);
  - `express-rate-limit` (Express-only);
  - proxy-only limiting.
- **Resolution (ADR-0007):**
  - `@fastify/rate-limit` 10.3.0 [UNVERIFIED] with an in-memory store while P1 runs one API instance.
  - A PostgreSQL-backed custom store if IT scales horizontally (P6).
  - Stricter limits on the auth endpoints.
  - No Redis.

### L-flags: evidence-storage licences (ADR-0010)

| Flag | Component | Licence | Decision |
|---|---|---|---|
| L-1 | MinIO server | AGPL-3.0 [UNVERIFIED current status; MinIO changed its community distribution in 2025] | Do **not** bundle it. Connect only to an IT-provided S3-compatible store. |
| L-2 | `minio` JS SDK | Apache-2.0 [UNVERIFIED] | Acceptable, but not chosen |
| L-2 | `@aws-sdk/client-s3` | Apache-2.0 [UNVERIFIED] | Preferred for the optional P6 adapter; **not added in P1** |
| L-3 | Cloud object stores (S3, Azure Blob, GCS) | commercial SaaS | Only with explicit Mobily IT approval; never mandatory |
| L-4 | Local S3 test double | SeaweedFS Apache-2.0 / Ceph LGPL / Garage AGPL-3.0 [UNVERIFIED] | Choose at P6 after licence review |

## 4. Offline checks actually run in this run

| Check | Command (in `$TMPDIR/offline`, a scratch copy with hand-made workspace symlinks and the cached `@types/node` 25.5.0 types) | Result |
|---|---|---|
| Typecheck and build: `@mth/shared` (constants only; zod schemas excluded because zod is not installed), `@mth/config`, `@mth/db`, `@mth/design-tokens`, `@mth/api`, `@mth/worker` | `/opt/node22/bin/tsc -p tsconfig.json` and `-p tsconfig.build.json` per package | all 12 invocations exit 0, no diagnostics; `dist/` emitted |
| ESM runtime of built output | `node -e 'import("./packages/shared/dist/index.js")…'`; the same for design-tokens | `dist ok 6 14` (6 phases, 14 roles); `tokens ok --mth-brand-primary #0078FF` |
| Native type stripping with the source condition | `node --conditions=@mth/source -e 'import("./src/index.ts")'` (apps/api) | `strip ok /api/v1 8` |
| DB CLI skeleton | `node --conditions=@mth/source packages/db/src/cli.ts status` | prints the not-implemented message and exits 2, as designed |
| No-CDN scan | `node scripts/check-no-cdn.mjs` (repository) | `PASS no-cdn: scanned apps, packages` |
| OpenAPI structural | PyYAML script: parse, resolve every `$ref`, unique operationIds, path params declared, CSRF on unsafe methods, 409/428 with If-Match, problem+json errors | `openapi 3.1.1 operations 32 schemas 52`, no problems |
| Token contrast | WCAG relative-luminance calculation (node one-liner) | `#0078FF`/white 4.09:1 (fails small text); other results in ADR-0009 |

**Not covered offline:**
- `@mth/web` (needs React and Vite types);
- `@mth/shared/schemas` (needs zod);
- lint (needs typescript-eslint);
- OpenAPI schema validation (needs swagger-parser);
- the offline check used @types/node **25.5.0** instead of the pinned 22.18.0.

## 5. Licence inventory (pinned direct dependencies)

Transitive dependencies are covered by the SBOM that devops generates from the lockfile, later.

| Package | Pin | Licence | Verified | Flag |
|---|---|---|---|---|
| typescript | 6.0.2 | Apache-2.0 | V-LOCAL | — |
| eslint | 10.1.0 | MIT | V-LOCAL | — |
| prettier | 3.8.1 | MIT | V-LOCAL | — |
| @playwright/test | 1.56.1 | Apache-2.0 | V-LOCAL (playwright 1.56.1) | — |
| typescript-eslint | 8.46.0 | MIT | UNVERIFIED | peer range may exclude TS 6 / ESLint 10 |
| eslint-plugin-react-hooks | 5.2.0 | MIT | UNVERIFIED | peer range may exclude ESLint 10 |
| @types/node | 22.18.0 | MIT | UNVERIFIED | — |
| vitest | 3.2.4 | MIT | UNVERIFIED | — |
| @apidevtools/swagger-parser | 10.1.1 | MIT | UNVERIFIED | confirm OAS 3.1 support |
| @axe-core/playwright | 4.10.2 | MPL-2.0 (axe-core) | UNVERIFIED | **MPL-2.0**: file-level copyleft; dev-only and unmodified, so acceptable; listed for procurement |
| fastify | 5.6.1 | MIT | UNVERIFIED | — |
| @fastify/cookie | 11.0.2 | MIT | UNVERIFIED | — |
| @fastify/helmet | 13.0.2 | MIT | UNVERIFIED | — |
| @fastify/rate-limit | 10.3.0 | MIT | UNVERIFIED | — |
| @fastify/static | 8.2.0 | MIT | UNVERIFIED | — |
| openid-client | 6.8.1 | MIT | UNVERIFIED | — |
| zod | 4.1.12 | MIT | UNVERIFIED | — |
| ajv / ajv-formats | 8.17.1 / 3.0.1 | MIT | UNVERIFIED | — |
| yaml | 2.8.1 | ISC | UNVERIFIED | — |
| kysely | 0.28.7 | MIT | UNVERIFIED | — |
| pg / @types/pg | 8.16.3 / 8.15.5 | MIT | UNVERIFIED | — |
| uuid | 13.0.0 | MIT | UNVERIFIED | — |
| decimal.js | 10.6.0 | MIT | UNVERIFIED | — |
| pg-boss | 11.0.0 | MIT | UNVERIFIED | — |
| react / react-dom | 19.2.0 | MIT | UNVERIFIED | — |
| @types/react / @types/react-dom | 19.2.2 / 19.2.1 | MIT | UNVERIFIED | — |
| vite | 7.1.11 | MIT | UNVERIFIED | check advisories for the 7.1 line |
| @vitejs/plugin-react | 5.0.4 | MIT | UNVERIFIED | — |
| react-router | 7.9.0 | MIT | UNVERIFIED | check advisories; raise to the latest 7.x patch |
| @tanstack/react-query / react-table | 5.90.2 / 8.21.3 | MIT | UNVERIFIED | — |
| react-hook-form / @hookform/resolvers | 7.62.0 / 5.2.1 | MIT | UNVERIFIED | — |
| i18next / react-i18next | 25.5.2 / 16.0.0 | MIT | UNVERIFIED | — |
| @fontsource/ibm-plex-sans(-arabic) | 5.2.6 | MIT (package), **OFL-1.1** (fonts) | UNVERIFIED | ship OFL text in the image |
| jsdom | 27.0.0 | MIT | UNVERIFIED | — |
| @testing-library/react / dom | 16.3.0 / 10.4.1 | MIT | UNVERIFIED | — |

**Runtime services and images** (devops pins the digests):

| Component | Licence | Verified | Note |
|---|---|---|---|
| Node.js 24 | MIT | UNVERIFIED | — |
| PostgreSQL 18 | PostgreSQL Licence | UNVERIFIED | — |
| Keycloak 26.x | Apache-2.0 | UNVERIFIED | test IdP only |
| Playwright image v1.56.1-noble | Apache-2.0 | UNVERIFIED | CI only |

**Procurement flags:** none for the mandatory runtime. MPL-2.0 (axe-core, dev-only) and OFL-1.1 (fonts) carry notice obligations only.

## 6. What the orchestrator must do next (registry-enabled environment)

1. Run `node scripts/verify-dependency-pins.mjs`. For every FAIL, raise the pin to the newest non-deprecated patch that satisfies peers. Record the output as `docs/architecture/discovery/p1-pin-verification.md`, and update the ADR tables from [UNVERIFIED] to verified, with the date.
2. Run `pnpm install` (under the REQ-DLV-042 install sandbox) to generate and commit `pnpm-lock.yaml`.
3. Run `pnpm install --frozen-lockfile && pnpm -r typecheck && pnpm -r build && pnpm lint && pnpm openapi:lint` on a clean clone and record the results.
4. Confirm the Node, PostgreSQL, Keycloak and Playwright image support windows on their official pages and record them with the date.
