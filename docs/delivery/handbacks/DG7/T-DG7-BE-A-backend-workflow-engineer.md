# Handback T-DG7-BE-A: P7 module registry, route and worker stubs, permission wiring (backend-workflow-engineer)

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING). This is engineering delivery work. Nothing here grants a business, Finance or IT approval, no product gate G1–G6 is decided, and nothing reads or writes the DG0–DG7 records. Product G6 never implies DG7.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-BE-A.md`, sha256 `3bea2d2c172864c52b28d13dd2c85f646f47f24db7ff8978d5c086543a5b3666` (verified at start). Scope: the BE-A row of `docs/architecture/p7-plan.md` §5.1, and the "Module registry → BE-A" rows of `p7-work-split.md` §C.7 and §E.7, plus ADR-0065 §6.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-BE-A-backend-workflow-engineer-20261112T190459Z-9f5ff4f0","session_id":"9f5ff4f0-da7b-4d2e-84af-821045b97bc4"}`.
- **Base:** `2f963e26d92e6530e99fc71e131ff51a00f5e20b` on `claude/mobily-transformation-platform-dg6-regate`, worked in the repository root. The tree was clean except this run's own `runs/` directory. All changes are left **uncommitted** for the orchestrator.
- **Time:** start `2026-11-12T19:05:07Z`, end `2026-11-12T19:39:29Z` (before writing this file). About 35 minutes.
- **Data:** no fixture data was added. The tests use only the contract, the permission catalogue and a route-only server.

## 1. Changed files

**New: module `transfer`** (`apps/api/src/modules/transfer/`)
- `index.ts`: the `registerTransferModule` hook, which registers the three route files and reports `scaffold` while none has a route (`deliversIn: "P7"`). Also `TRANSFER_ROUTE_GUARDS`, the union of the three guard tables.
- `guards.ts`: the `P7RouteGuard` shape (method, Fastify path, `Permission`).
- `export/routes.ts`: stub for BE-C, with `MIGRATION_EXPORT_ROUTE_GUARDS` (5 operations, `migration.export`).
- `import/routes.ts`: stub for BE-D, with `MIGRATION_IMPORT_ROUTE_GUARDS` (5 operations, `migration_import.read`).
- `config-bundle/routes.ts`: stub for BE-F, with `CONFIG_BUNDLE_ROUTE_GUARDS` (9 operations, `config_bundle.export` / `config_bundle.import`).
- `transfer.test.ts`: the module suite (3 tests).

**New: module `retention`** (`apps/api/src/modules/retention/`)
- `index.ts`: the `registerRetentionModule` hook and `RETENTION_ROUTE_GUARDS`.
- `guards.ts`: the module's own copy of `P7RouteGuard`. ADR-0002 forbids importing transfer's file.
- `classes/routes.ts`: stub for BE-G (3 operations, `retention.read` / `retention.configure`).
- `runs/routes.ts`: stub for BE-G (6 operations, `retention.read` / `retention.run`).
- `backups/routes.ts`: stub for BE-G (1 operation, `backup.read`).
- `retention.test.ts`: the module suite (3 tests).

**New: module `release`** (`apps/api/src/modules/release/`)
- `index.ts`: the `registerReleaseModule` hook.
- `routes.ts`: stub for BE-H. It has no guard table yet (see §4.3).
- `release.test.ts`: the module suite (2 tests).

**New: cross-cutting test**
- `apps/api/src/p7-wiring.test.ts`: the P7 permission wiring test (3 tests, §2).

**Modified: registry and composition root**
- `apps/api/src/modules.ts`:
  - `transfer`, `retention` and `release` added, each with a documented `dependsOn`;
  - `P7_MODULES`, now included in `IMPLEMENTED_MODULES`;
  - the `SECTION16_MODULES` area `admin` gains the three P7 modules.
- `apps/api/src/architecture.test.ts`:
  - a new P7 block (below);
  - the §16 pin extended: the admin list, the P7 coverage check, and "is a P1, P4, P5, P6 or P7 module".
- `apps/api/src/server.ts`:
  - 3 imports and 3 registration lines;
  - the P7 wiring-point comment block (ConfigBundleKindAdapter registry, RetentionClassRegistry, EvidenceStore hand-off).
- `apps/api/src/server.test.ts`: the module-list pin gains the three modules, and each is pinned to `deliversIn: "P7"` with scaffold/active by route count.

**New and modified: worker**
- `apps/worker/src/handlers/transfer/index.ts` (`TRANSFER_HANDLERS = []`) and `apps/worker/src/handlers/retention/index.ts` (`RETENTION_HANDLERS = []`): the stubs.
- `apps/worker/src/queues/transfer.ts` and `apps/worker/src/queues/retention.ts`: empty `*_QUEUES` and `*_EVENT_QUEUES` stubs (the P6 precedent).
- `apps/worker/src/handlers/index.ts`: one import line and one spread line per new handler directory.
- `apps/worker/src/queues/index.ts`: one import line per new queue file, one line in `DOMAIN_QUEUES` and one in `EVENT_QUEUE_MAPS`.

**Evidence:** `docs/delivery/handbacks/DG7/T-DG7-BE-A-evidence/*.log`.

No migration was written and no id was taken. No dependency was added, and nothing in the contract, `packages/shared`, `test/support/**` or the pending lists changed.

**The P7 block in `architecture.test.ts` pins:**
- each P7 module has its own suite;
- the exact `dependsOn` of each P7 module:
  - `transfer` = `retention` = `{platform, audit, access, evidence, jobs}`;
  - `release` = `{platform, audit, access}`;
- the P7 modules don't import each other;
- no P1–P6 module imports a P7 module;
- no P7 module imports `workflows`, `kpi`, `benefits` or `governance`.

The existing full-tree walk ("every import respects dependsOn …") now also lints the new files.

## 2. Behaviour delivered, per requirement

**No requirement row is assigned to BE-A** (p7-plan §5.1 names BE-A for slices C/E/I infrastructure only). Each row below stays **not complete** until its owners deliver it.

| Row(s) | What BE-A contributes | Owners who complete it |
| --- | --- | --- |
| REQ-S19-014, S19-016 (slice C) | module `transfer`, the `export/` and `import/` stubs with registration lines, the worker stub `handlers/transfer/` and the queue stub, the guard tables for `migration.export` and `migration_import.read` | BE-C, BE-D, BE-E, KBE-A |
| REQ-S19-008 (slice D) | the `config-bundle/` stub with its registration line, the guard table for `config_bundle.export` / `config_bundle.import`, the ConfigBundleKindAdapter wiring point in `server.ts` (ADR-0065 §6: "BE-A adds the registry wiring point") | BE-F |
| REQ-S19-012, S19-013, S16-024 (slice E) | module `retention`, the `classes/`, `runs/` and `backups/` stubs, the worker stub `handlers/retention/` and the queue stub, the guard table for `retention.read`, `retention.configure`, `retention.run` and `backup.read`, the RetentionClassRegistry wiring point (§4.2) | BE-G, FE-C |
| slice I (in-app register, About) | module `release` with a `routes.ts` stub and its registration line | ARCH-05, BE-H |

**The pending mechanism stays honest.** No stub registers a route, so every operation in `p7-pending-be-{c,d,f,g}.ts` is still unrouted. `contract.test.ts` "maps every governed Fastify route …" passed on a real PostgreSQL (§3 row 9). The P7 pending lists are unchanged (BE-A owns no operation).

**The P7 permission wiring** (`p7-wiring.test.ts`) has three tests:
1. The set of permission codes in the transfer and retention guard tables **equals** `Object.keys(P7_PERMISSIONS)`. Every P7 code guards at least one route, and no other code is used.
2. Every guard row is a contract operation with the same method and path, and the permission its summary states. The other direction holds too: every `transfer`- or `retention`-tagged contract operation (29) has a row.
3. A guarded operation is either **not routed** (it is then pending, which the contract test enforces) or routed with **exactly** `{ permission: <row> }`. A stub filled by BE-C/D/F/G cannot drift from the table.

**Negative control (ran):** I changed `listBackupSets` to `retention.read`. Three tests failed (the retention suite's code-set test, wiring test 1 and wiring test 2; exit 1, `negative-control-mutated-guard.log`). The file was restored from a copy before any later check.

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline. The disposable PostgreSQL came from `tests/qa/support/with-pg.sh`, on ports 25410 (PG) and 25411–25449 (pool), inside the 25000–31999 pool.

| # | Command | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| 1 | `node tools/gates/validate.mjs --historical --stage DG6` | 0 | `PASS gate DG6 (historical)` | `validate-historical-DG6.log` |
| 2 | `pnpm -r typecheck` (final tree) | 0 | api and worker done | `typecheck.log` |
| 3 | `pnpm lint` (final tree) | 0 | `eslint . --max-warnings=0` clean | `lint.log` |
| 4 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 962 operations` (contract unchanged) | `openapi-lint.log` |
| 5 | targeted unit: `npx vitest run --project unit-node` on architecture, server, p7-wiring, the 3 module suites and `apps/worker/src` | 0 | 15 files, 210/210 | `unit-targeted.log` |
| 6 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | unit-node 195 files / **2924**; unit-web 125 / **2113**; formula-nocodegen 3 / **259** + 2 skipped (by design, as before) | `unit-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | same counts: 2924; 2113; 259 + 2 skipped | `unit-c-utf8.log` |
| 8 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" in every batch | `prettier-check.log` |
| 9 | `QA_PG_PORT=25410 MTH_PORT_POOL=25411-25449 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts apps/worker/test/integration/{outbox,schedules,restart}.test.ts` | 0 | 4 files, **118/118** (the contract test including route coverage and the pending checks; the worker queue/outbox/restart tests over the extended registries) | `integration-targeted.log` |
| 10 | `node tools/gates/validate.mjs --historical --stage DG6` (end) | 0 | `PASS gate DG6 (historical)` | `validate-historical-DG6-end.log` |

Row 8 ran before this handback existed, so this Markdown file was checked separately afterwards (`npx prettier --check` on it; result in `prettier-handback.log`).

**Disclosed non-zero exits and failures (all fixed before the final runs above):**
- **First targeted unit run: exit 1, 2 of 210 failed**, both mine:
  - **The architecture lint rejected** `retention.test.ts` l.38: "computed member with a non-literal key", from `P7_RETENTION_PERMISSIONS[g.permission]`. I replaced it with a `Map`.
  - **`p7-wiring.test.ts` expected the permission to open the summary's parenthesis**, but `downloadConfigBundleExport` states it later: "(attachment; ETag = its SHA-256; config_bundle.export)". The test now accepts the code as any `;`-separated item of a parenthesis.

  The log of that run was overwritten by the rerun (15 files, 210/210).
- **First full `pnpm test` (locale unset): exit 1, 1 of 2924 failed.** `platform/advisory-locks.test.ts` "no module source outside the registry spells a class number" flagged four of my stubs, whose comments cited lock numbers. I replaced the numbers with the registry names (`migrationExport`, `configBundleImport`, `retentionRun`). The failing log is kept as `unit-locale-unset-run1-failed.log`. Rows 6 and 7 are the reruns.
- **Negative control: exit 1, by design** (§2).

**Not run:**
- **The full `pnpm test:integration`** (about 50 minutes at P6, with 322+ files). It didn't fit the 60–75-minute budget. The assignment names the contract and architecture tests, which ran and passed (rows 5–7 and 9). No other integration file imports a changed file except through `buildServer` (module list) and the worker registries, which rows 9 and 6 cover. A reviewer should still run the full suite on the integrated candidate.
- **The validator before implementation.** CLAUDE.md asks for the `--historical` run before implementation starts. I ran it after writing the stubs but before any check, and again at the end; both runs passed. That's a protocol-order deviation, disclosed here.

## 4. Known gaps and open questions

1. **The assignment's "returns the module's not-implemented problem" contradicts the code and P6.**
   - P6's stubs registered **no** route (T-DG6-BE-A handback §1: "each registers nothing and returns `[]`"). No not-implemented problem exists in `platform/`, and `platform/deps.ts` says "A scaffold registers NO routes".
   - `contract.test.ts` requires `governed routes == contract − pending` and fails when a pending operation is routed, so a stub answering 501 would break it.
   - So I followed P6: an unrouted pending operation gets the platform's existing 404 not-found problem. The orchestrator may want to correct the assignment text.
2. **There's no `RetentionClassRegistry` port.**
   - p7-plan §2 planned one, but ADR-0067 §1 made the class map **data**: 0143 `retention_table_class`, generated from the catalogue and pinned by `catalogue.test.ts`. The ADR defines no port interface, and per-module registrations aren't needed.
   - Following the P6 precedent ("I did not invent their interfaces ahead of their ADRs"), the wiring point is a named slot in `server.ts`'s P7 block, with no behaviour. If BE-G needs a hook, its registry line and one line per owning module go there.
   - **Question:** confirm that BE-G's assignment needs no `RetentionClassRegistry` registrations (p7-plan §5.1 BE-G row and §5.3).
3. **The `release` module has no guard table.** ARCH-05 hasn't designed slice I: no contract operations, no permission codes, no §I in the work split. `release/routes.ts` is a bare stub. Its `dependsOn` (`platform`, `audit`, `access`) is my reading of "imports nothing" (it still needs the policy function for its guards). ARCH-05 or BE-H adds its guard rows to `p7-wiring.test.ts`'s `GUARDS` when its codes exist. The test's rule "equals `P7_PERMISSIONS`" will then fail until they do.
4. **The EvidenceStore port isn't reachable through `evidence/index.ts`.**
   - The work split says transfer and retention import evidence "(the port)", and ADR-0002 allows only another module's `index.ts`. But `evidence/index.ts` doesn't export `EvidenceStore` (it's in `evidence/store.ts`), and that file isn't in my set.
   - **Request (orchestrator merge, one line):** `export type { EvidenceStore } from "./store.ts";` in `apps/api/src/modules/evidence/index.ts`, before BE-C/BE-G need it. Alternatively they receive the store as a parameter on their `server.ts` registration line (the `server.ts` P7 block says so) and declare a structural type.
5. **The dependency choices are proposals**, pinned exactly so any change is deliberate. `jobs` is for the outbox (`enqueueOutboxEvent`) that enqueues `transfer.export` and `retention.archive`. `organization` isn't included; BE-F's per-organization scope goes through `access`. A later task that needs another edge asks the orchestrator for a `modules.ts` line (p7-plan §5.3).
6. **The queue files are outside BE-C's and BE-G's lists.** I created `queues/{transfer,retention}.ts` (the P6 precedent), but the BE-C (§C.1) and BE-G (§E.1) file lists don't name them. Each needs to add its queue spec there (`transfer.export`, `retention.archive`). Please add these to their assignments.
7. **Contract seams.** No `p7-exercises-*.ts` stubs or `contract.test.ts` hooks were added. The work split gives each task its own hook (BE-B §B.1: "the import and the `it(...)` hook … (the P6 pattern)"), unlike P6, where BE-A added them all.
8. **User-facing text:** none. No screen, string or en/ar key changed.

## 5. Merge instructions

- **No migrations.** Nothing to run.
- **Order:** merge BE-A before any other P7 implementer integrates (p7-plan §5.2 W4).
- **Expected conflicts:** none on the base.
  - BE-B later edits `server.ts` (the `registerHealthRoutes` line and one `registerDeploymentRoutes` line) and `server.test.ts` (readiness lines only). Those lines are untouched here.
  - The later named edits in BE-A's files are:
    - BE-F: the registry line plus one line per adapter, below the P7 block in `server.ts`;
    - BE-G: the route registrations in `retention/index.ts` (already wired to the three stubs) and the handler line in `handlers/retention/index.ts`;
    - BE-C/D/F: their route files and the `transfer` handler stub.
- **Before merging:** decide §4.4 (the `evidence/index.ts` type export) and §4.6 (the queue files in the BE-C and BE-G assignments).
