# Handback T-DG5-BE-S (backend-workflow-engineer): the demo environment, the demo CLI, seed framework, reset, checksum, coverage framework and the in-app reset (p5-work-split §J.1)

- **Stage:** P5, gate DG5 (BUILDING). Wave W12 (D-156).
- **Invocation:** `DG5-T-DG5-BE-S-backend-workflow-engineer-20261015T210620Z-c93f9a08`, session `c93f9a08-8833-4d8a-8c11-61cd6360d199`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-S.md`, sha256 `ae2f71fb…97cb1d` (verified).
- **Base:** branch `dg5/be-s` at `278cd1de67b682d6cc1c477356ceb4983ae235ac`. Changes are **uncommitted**, as instructed.
- **Time:** start `2026-10-15T21:06:32Z` (`date -u`), end `2026-10-15T23:11Z` (`date -u`; integration counts added after the run finished).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, **exit 0** (`T-DG5-BE-S-evidence/validate-historical-DG4.log`).

Product gates G1–G6 are business approvals inside the product. Nothing here grants, records or simulates a real business, Finance or IT approval, and nothing reads or writes DG0–DG7. Everything the demo seed creates is synthetic: an illustrative example, not Mobily actual performance. A demo approval approves nothing real.

## 1. Files changed

**Mine (§J.1 ownership):**

| File | Purpose |
|---|---|
| `packages/db/src/demo/guard.ts` (new) | Reads the environment marker (no row → production, fail-safe). The refusals of ADR-0050 §3/§9 with their exact texts and exit 3 (`DemoRefused`). Dataset constants (code, version 1.0.0, synthetic clock `2026-09-01T06:00:00Z`) and lock 730271/key `demo`. |
| `packages/db/src/demo/seed.ts` (new) | The seed transaction, in order: refusal check, demo marker, dataset modules (sorted by order then key), one audit event and one `demo_seed_record` per row, counts, checksum, coverage, `demo_dataset_run`, and the run's audit event. The `DemoSeedContext` contract for BE-T/KBE-H: `insert` enforces fixed `01995000-…` ids and valid fixture keys; `at`/`date` derive times from the synthetic clock only. `withDemoLock` holds the session lock on the maintenance database. |
| `packages/db/src/demo/reset.ts` (new) | Reset by drop and re-create (ADR-0050 §6). Configuration refusals, then the session lock 730271, then the target marker must be `demo`. Then `DROP … WITH (FORCE)`, `CREATE … OWNER mth_owner ENCODING 'UTF8'` (same collation/ctype, template0), migrate, and seed with `run_kind = 'reset'`. No trigger is disabled and nothing is truncated in place. |
| `packages/db/src/demo/checksum.ts` (new) | Record counts: every public base table except `demo_dataset_run`, in name order. Checksum: the §4 rule. Rows are `to_jsonb(row)` minus the clock-defaulted columns, which are read from `information_schema` at run time. TimeZone, IntervalStyle and extra_float_digits are pinned; lines are in code-point order, then the registry lines. |
| `packages/db/src/demo/coverage.ts` (new) | The coverage framework. Lists the 52 ADR-0050 §5 conditions as named queries (`query: null` until BE-T writes the SQL), plus `DEMO_TRANSFORMATION_ID` (`01995000-0000-7000-8000-000000000001`). A condition without a query is **absent** from the result, never 0, and makes the run incomplete. |
| `packages/db/src/demo/cli.ts` (new) | `seed-demo` / `reset-demo`: prints the synthetic notice, the run number, the counts and the checksum; exit 3 on refusal. |
| `packages/db/src/demo/data/index.ts` (new, **stub for BE-T/KBE-H**) | `DEMO_DATASET_MODULES = []`. The shipped dataset is empty until BE-T and KBE-H fill it (§J.2/§J.3). |
| `packages/db/src/cli.ts` | Adds the `seed-demo` and `reset-demo` lines and the usage text. `DemoRefused` maps to exit 3 with the exact line. |
| `packages/db/src/bootstrap.ts` | The marker and refusal lines: a demo-marked database → `mth-db bootstrap: refused: this database is a demo database` (exit 3). Otherwise it writes the production marker if absent, in the same transaction. |
| `packages/config/src/index.ts`, `load.ts`, `load.test.ts` | `MTH_ENV` (`production\|demo\|development\|test`; default production when `NODE_ENV=production`, else `NODE_ENV`) and `MTH_DEMO_ADMIN_DATABASE_URL` (secret; `_FILE` supported), with tests. |
| `apps/api/src/modules/admin/environment.ts` (BE-A stub filled) | `getEnvironment`, `getDemoEnvironmentStatus`, `requestDemoReset`, and the exported `EnvironmentReadPort` (`environmentReadPort`). The zod shapes of the four slice J components are used as response guards and mirrors. |
| `apps/worker/src/handlers/demo.ts`, `apps/worker/src/queues/demo.ts` (BE-A stubs filled) | Queue `demo.reset` ← event `demo.reset_requested`. The handler refuses outside a configured demo deployment, **acknowledges** through `runOnce` (the processed_message ledger), then runs `resetDemo` with `requested_via = 'api'` and the requester. |
| `apps/api/src/modules/platform/db-errors.ts` | `mapP5DemoEnvironmentError`: the ten 0090 constraints → 500 (mth_app only reads these tables). Plus its one call line. |
| `apps/api/test/support/p5-pending-be-s.ts` | Now empty (3 operations routed). |
| `apps/api/test/integration/contract/p5-exercises-be-s.ts` | The exercises (§4). |
| Tests (new) | `packages/db/test/integration/demo.test.ts` (9), `packages/db/test/demo-fixture.ts` (a 3-row synthetic test dataset), `packages/db/src/demo/guard.test.ts` (9), `apps/api/test/integration/environment/environment.test.ts` (14), `apps/api/src/modules/platform/db-errors-p5-demo.test.ts` (11), and the config tests (4 new). |

**Outside the listed files (seams; please ratify or move):**

| File | Change | Why |
|---|---|---|
| `packages/shared/src/schemas/events.ts` | `demoResetRequestedV1` plus one registry line, `"demo.reset_requested": { 1: … }` | The outbox refuses an event type without a schema. This is the BE-F2/BE-I/BE-I2/BE-M precedent (each registered its own event here). |
| `packages/db/src/index.ts` | One export block for `./demo/*` | `@mth/db` exports only `.`, and the API and worker need `readDeploymentEnvironment`, `seedDemo` and `resetDemo`. |
| `.env.example` | Regenerated by `node deploy/scripts/generate-env-example.mjs` (+2 names, no values) | `--check` must stay green after the catalogue change. |
| `packages/db/.claude/.cc-writes` | Removed (an empty directory) | Per the assignment's "before tests" instruction. |

## 2. Behaviour per requirement row (acceptance quoted)

### REQ-S18-003 (BE-S owns: refusals, bootstrap marker)

> "A22;A18: after production initialization, a query finds zero demo records and zero demo users; the demo seed command exits with an error in production mode"

- **The production path.** `bootstrap` writes `deployment_environment` = `production`/`bootstrap` and creates only the organization and the two bootstrap users.
- **The literal query, tested.** Afterwards `SELECT count(*) FROM demo_seed_record` = 0 and no registered `app_user`. The only identity is the administrator's IdP identity; there is no demo issuer and no credential.
- **`seed-demo` in production mode exits 3 and changes nothing** (whole-database counts, marker and runs compared before and after):
  - with `MTH_ENV=production`, on an empty and on a production-marked database;
  - with `NODE_ENV=production` and no `MTH_ENV` (the default);
  - on a production-marked database even with `MTH_ENV=demo`;
  - on an unmarked, non-empty database.
- **The other refusals.** A second `seed-demo` → "already a demo database; use reset-demo". `bootstrap` on a demo database → exit 3. All texts are exactly ADR-0050 §9's.

### REQ-S18-001 (BE-S owns: isolation, flag, reset, counts and checksum)

> "A22;A01: running the reset twice yields identical record counts and checksums; every demo screen, record and export shows the synthetic label in en and ar"

**Reset twice, identical counts and checksums**, tested in two ways on scratch databases of the disposable cluster:
- **(a) Library, with the synthetic 3-row test dataset.** Seed, then a demo user adds a row, then reset, reset.
  - Both resets give run 1 (`reset`) with `recordCounts` and `checksumSha256` equal to the seed's, and the checksum lines are identical.
  - The added row is gone.
  - The synthetic-clock time is in the checksum; `created_at` (`now()` default) is not.
  - The append-only protections still raise after the reset (UPDATE/DELETE/TRUNCATE on the demo tables and `audit_event`).
  - Encoding UTF8, collation C.
- **(b) Through the real CLI with the shipped (still empty) dataset.** `seed-demo`, then `reset-demo` twice: the printed counts and checksums are identical.

**Isolation and flag.**
- `GET /environment` returns `synthetic: true` (with dataset `international_roaming` 1.0.0 and clock `2026-09-01T06:00:00.000Z`) in the demo database.
- It returns `false` in a production-marked database, and also in an unmarked one (fail-safe).

**In-app reset (admin; `requestDemoReset`).**
- 202 `queued`, with one audit event (`demo_environment.reset_requested`) and one `demo.reset_requested` outbox event in the same transaction.
- 409 `environment.not_demo` in production; 403 for AUD and TL; 428 when `If-Match` is missing, 400 when malformed, 409 when stale.
- 409 `demo_reset.not_configured`; 409 `demo_reset.in_progress`.
- Commit-time revocation → 403, nothing written.
- **Worker, end to end:**
  - the processed_message ledger row is committed **before** the drop (asserted from inside the reset);
  - the real reset re-creates and re-seeds the database (run 1, `reset`, `api`, `requested_by` = the requester, same counts and checksum);
  - a redelivery is a `duplicate` and never resets twice.

**Not completed here:** "every demo screen … shows the synthetic label" is FE-G's (§J.7). "Every … export shows the synthetic label" needs BE-S's label line in `reporting/exports/layout/**`, which §J.1 sequences **after BE-N**. BE-N runs concurrently in W12 and that directory doesn't exist in this tree. See §7.

### REQ-PB-089 (BE-S owns: environment flag, export label line)

> "A01;A15: every demo record and exported demo report shows the illustrative label in en and ar"

- **Delivered:** the environment flag (`GET /environment`) and `EnvironmentReadPort`, the source the layout reads at generation time (ADR-0050 §2 (d)).
- **Not delivered (dependency):**
  - the export label line in `reporting/exports/layout/**`;
  - `synthetic: true` in the snapshot content.

  Both are "named lines, after BE-N" (§J.1), with BE-N's layout. See §7.

### REQ-PB-088 (BE-S owns: the production path)

> "A01: the demo transformation's North Star equals 'Make international roaming effortless, trusted and economically accretive.'; the production initialization contains no demo records"

- The second clause is delivered and tested: the same query as REQ-S18-003 gives 0.
- The North Star is BE-T's dataset (§J.2).

## 3. Checks (real commands, exit codes, counts)

Environment: Node 24.21.0, offline. PostgreSQL 16.13 disposable cluster via `tests/qa/support/with-pg.sh`, ports 24450 (start) and 24451–24499 (pool).

Logs are in `T-DG5-BE-S-evidence/`.

| # | Command | Exit | Result |
|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` | **0** | `PASS gate DG4 (historical)` (`validate-historical-DG4.log`) |
| 1a | `pnpm -r typecheck` | **0** | 8 projects (`typecheck.log`; final tree) |
| 1b | `pnpm -r build` | **0** | (`build.log`; final tree) |
| 1c | `pnpm lint` | **0** | `--max-warnings=0` (`lint.log`) |
| 1d | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | "All matched files use Prettier code style!" (`prettier.log`) |
| 1e | `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` (`openapi-lint.log`) |
| — | `node deploy/scripts/generate-env-example.mjs --check` | **0** | (`env-example-check.log`) |
| 2a | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | **0** | unit-node **2033/2033**; unit-web **1429/1429**; unit-formula-nocodegen **259 passed, 2 skipped** (`unit-locale-unset.log`) |
| 2b | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1** (see below) | unit-node **2032/2033** (1 timeout, see below); unit-web **1429/1429**; nocodegen **259 + 2 skipped** (`unit-c-utf8.attempt3-architecture-timeout-under-load.log`) |
| 2b' | `LANG=C.UTF-8 LC_ALL=C.UTF-8 npx vitest run --project unit-node apps/api/src/architecture.test.ts` | **0** | **139/139**; the boundary test took 20.7 s of its 30 s budget (`unit-c-utf8-architecture-alone.log`) |
| 3 | `QA_PG_PORT=24460 MTH_PORT_POOL=24461-24499 tests/qa/support/with-pg.sh pnpm test:integration` | **1** | Finished 23:10Z, after the handback was first written: **254 files, 2457/2458 passed, 1 failed** (`integration.log`). The one failure is the expected contract case of §5.1: `contract.test.ts` "every operation: an undeclared request media type …" → `header ETag="0" violates …`. It passes with the proposed patch (3'). No other failure. |
| 3' | Same harness (ports 24455/24456-24459) in a **disposable copy of this tree with the proposed `ETagOrZero` patch applied**: `contract.test.ts` + `environment/` + `packages/db/test/integration/demo.test.ts` | **0** | **100/100** (77 contract + 14 environment + 9 demo) (`contract-with-proposed-patch.log`) |
| — | Focused runs during development: `demo.test.ts` | **0** | 9/9 |

**Disclosed non-zero exits and flaky runs (none of them is an assertion failure in my code):**
- **First run of 2a and 2b** (`unit-*.attempt1-failed.log`), exit 1, 2 failures each, both in my code and fixed:
  - `architecture.test.ts`: `admin/environment.ts` imported `../jobs/outbox.ts` instead of the public `jobs/index.ts`;
  - `advisory-locks.test.ts`: my file's comment spelled the class number 730271.
- **Second run of 2b** (`unit-c-utf8.attempt2-timeouts-under-load.log`): 3 timeouts in `architecture.test.ts` (30 s), `p3-seams.test.tsx` and `closure.test.tsx` (20 s). I had started the integration suite and `pnpm -r build` at the same time; the CPU contention was self-inflicted.
- **Third run of 2b**: one timeout, again `architecture.test.ts` at 30 s, while the integration suite and the patched-copy run were going. Alone it passes (2b'), and in 2a it passed.
- **Net:** I don't have a single clean, fully green C.UTF-8 `pnpm test` run on a quiet machine. Every C.UTF-8 test passed in at least one run, and every failure there was a timeout under my own load. Please re-run 2b on a quiet machine at integration.
- **The full integration run (3)** exits 1 only because of the contract defect of §5.1; the patch is proven in 3'.

**Pinned counts:** no change needed. `contract.test.ts`'s media-type and rate-limiter cases passed with the current pins, both in run 3 (before the cutoff) and in 3'.

## 4. Operations routed (delta to `p5-pending-be-s.ts`)

`P5_PENDING_BE_S`: `["getEnvironment", "getDemoEnvironmentStatus", "requestDemoReset"]` → `[]`.

**Exercises (`p5-exercises-be-s.ts`).**
- **In the shared contract database (unmarked, so production), through `mirrored`:**
  - `getEnvironment`: 200, 400, 401;
  - `getDemoEnvironmentStatus`: 200, 400, 401, 403 (AUD, TL);
  - `requestDemoReset`: 409 `environment.not_demo` (exact text), 400, 401, 403 (AUD), 428.
- **On a scratch demo database, through the contract-asserting `call`:**
  - `getDemoEnvironmentStatus` 200 with `ETag "1"`;
  - `requestDemoReset` 202, 409 stale, 409 `demo_reset.in_progress` and 409 `demo_reset.not_configured`.
- **Mirrors:** `P5_MIRRORS_BE_S` holds `getEnvironment` and `getDemoEnvironmentStatus`. `requestDemoReset`'s 202 body is parsed with its mirror inside the exercise, because `mirrored` only serves the shared (production) database.

**Pinned counts.** In my run, `contract.test.ts`'s media-type triple and rate-limit floor needed **no change**: the media-type and rate-limiter cases pass with the current pins (see §3). All three operations are bodiless GETs or a bodiless POST.

## 5. Contract, schema and dependency needs (for the orchestrator)

1. **Contract defect, the D-153/D-156 precedent (blocks one shared `contract.test.ts` case until applied).**
   - `getDemoEnvironmentStatus`'s summary says "ETag = the latest run number, \"0\" when none", and `requestDemoReset` takes `IfMatchOrZero`. But the 200 response declares `ETag` (pattern ≥ 1) instead of `ETagOrZero`.
   - In a production database (no run) no response can satisfy the contract: `"0"` breaks the pattern, and omitting the header breaks "must send header ETag". I tried both in development runs (`contract: header ETag="0" violates …` and `contract: getDemoEnvironmentStatus 200 must send header ETag`). I didn't keep those runs' output. The `"0"` case is reproduced in this handback's `integration.log` (the media-type sweep).
   - **Implemented:** the operation's own rule, `"0"` with no run.
   - **Proposed one-line patch:** `T-DG5-BE-S-evidence/proposed-openapi-etag-or-zero.patch`. `node scripts/openapi-lint.mjs` on the patched copy gives `PASS …, 846 operations`.
   - **Workaround until it lands:** my own version-0 reads use `contract: false` (`VERSION_ZERO_READ` in `environment.test.ts`, and `contract: false` on the one shared-database read in the exercises), and the contract-validated 200 is the demo database's.
   - **Effect on `contract.test.ts`:** the shared sweep "every operation: an undeclared request media type …" calls this GET as ADM_TECH in the production database and stays red until the patch is applied (§3 shows it). With the patch applied, the full contract file is green (§3).
2. **No `@mth/shared` zod mirror exists for slice J** (`EnvironmentInfo`, `DemoDatasetRun`, `DemoEnvironmentStatus`, `DemoResetRequest`). I wrote them in `admin/environment.ts` and use them as response guards and test mirrors. If the orchestrator wants them in `packages/shared/src/schemas/`, they can move as they are.
3. **The two seams in §1** (`events.ts`, `packages/db/src/index.ts`) need ratification.
4. **Interpretations, listed for review:**
   - **(a) `resetConfigured`.** The API reads only whether **its own** `MTH_DEMO_ADMIN_DATABASE_URL` is set; it never connects with it. So the demo profile should give the URL to both the API and the worker (catalogue `usedBy: api, worker, db-cli`). It is reported `false` outside a demo database.
   - **(b) In-progress detection.** The outbox key is `demo.reset_requested:<latest run id>`. The reset re-creates the database, so the key disappears once the reset ran. The `outbox_event` unique key is the backstop. A 202 request with no run uses key `…:none` and the organization as the audit record.
   - **(c) Seed audit ids.** The seeded rows' audit events come from the single audit insert path (`insertAuditEvent`, random v7 ids and `now()`). ADR-0050 §4 says "fixed ids". Those rows are not registered records, so they are outside the checksum, and their **number** is fixed (one per row), so counts and checksums are identical. Fixed audit ids would need an optional `id` in `packages/db/src/audit.ts` (not mine). Ask if wanted.
   - **(d) Run id.** `demo_dataset_run.id` is a v7 id (not registered, not in the checksum). Run numbering restarts at 1 after each reset ("recorded in the new database's run 1"), so the ETag is `"1"` in a seeded demo database.
   - **(e) Worker reset target.** The worker resets the database named by its `DATABASE_URL`. It reaches it as `mth_owner` through the admin URL (`options=-c role=mth_owner`), so the admin role must be a member of `mth_owner`, or a superuser. The CLI uses `DATABASE_OWNER_URL` directly.
5. **No new dependency, no migration, no new problem code.** All codes and texts are ADR-0050 §9's.
6. **Devops (via the orchestrator, D-142 Q7).** The compose `demo` profile needs `MTH_ENV=demo` and `MTH_DEMO_ADMIN_DATABASE_URL` on the API and worker, and the demo IdP issuer.

## 6. User-facing texts

- **Made untrue: none.** The en/ar `nav.p5.demo` and `nav.p5.walkthrough` strings ("The separate demonstration environment with synthetic data, and its reset.") describe FE-G's screens, which are still not built. They and `nav.p5.notAvailableBody` stay true.
- **For FE-G / FE-A (web owners):**
  - en/ar `problems.json` keys for `environment.not_demo`, `demo_reset.in_progress` and `demo_reset.not_configured` (not present yet; the English texts are ADR-0050 §9's);
  - an audit label for `demo_environment.reset_requested` (organization-level), and for `demo_dataset_run.seed`/`.reset` (CLI/worker, organization null);
  - the banner, badge and approval labels of ADR-0050 §2 (a)–(c).

## 7. What remains

- **The separable second half of §J.1 (after BE-N):**
  - the synthetic-label line in `reporting/exports/layout/**`, reading `environmentReadPort` at generation time;
  - `synthetic: true` in the report snapshot content;
  - the test "the export of a demo report carries the illustrative label in en and ar".

  BE-N's layout doesn't exist in this tree (W12 concurrent). When it merges, the label line is about 10 lines plus one test, using `GET /environment`'s source.
- **The orchestrator:**
  - apply the `ETagOrZero` patch (§5.1), then drop `VERSION_ZERO_READ` / `contract: false` from my test and exercises;
  - ratify the seams (§1, §5.3).
- **BE-T / KBE-H:** fill `demo/data/**` through `DemoSeedContext` (create the roaming transformation with `DEMO_TRANSFORMATION_ID`) and the `query` of each `DEMO_COVERAGE_CONDITIONS` entry (named lines). The coverage then becomes complete.

## 8. Merge instructions

- **No migration.** Uses 0090/0091 as delivered.
- **Expect additive conflicts** with other W12 tasks only in the named lines:
  - `platform/db-errors.ts` (one function plus one call line after `p5FinancialMetric`);
  - `packages/shared/src/schemas/events.ts` (one schema plus one registry line after `export_job.requested`);
  - `packages/db/src/index.ts` (one export block).
- **Regenerate `.env.example`** if another task also changes `ENV_VARS`.

