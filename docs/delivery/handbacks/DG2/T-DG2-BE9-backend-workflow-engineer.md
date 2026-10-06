# Handback T-DG2-BE9: require a UTF8 database; locale-independent disposable test clusters (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING). Branch `claude/mobily-transformation-platform-regate`.
- **Assignment:** `docs/delivery/assignments/DG2/round-5/T-DG2-BE9.md` (sha256 `a8e0f37f…0d7bbc`, verified before starting).
- **Base:** `HEAD` = `0466813c5a15e2b75f6369d2a364c302e5cdb179`, which includes BE8 `9b4ded0` and FE7 `6946a1e`. The tree was clean apart from untracked sandbox dotfiles.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG2-T-DG2-BE9-backend-workflow-engineer-20261006T083727Z-0deeab0c","session_id":"0deeab0c-1ab4-4a2f-9351-1a39e1b2ffe3"}`
- **Not committed.** The changes are in the working tree for the orchestrator to integrate.
- **Evidence:** logs only, in `docs/delivery/handbacks/DG2/T-DG2-BE9-evidence/`.
- **Scope:** no migration was added. Migrations 0001–0019, `docs/api/openapi.yaml`, `tools/**`, `.claude/**`, `docs/source/**`, reviews and gate records were not edited.
- **Approvals:** I granted no business, Finance or IT approval. This is engineering work for DG2 only.

## Root cause (reproduced before any change)

The disposable clusters ran `initdb` with no `--encoding`/`--locale`, so the shell locale decided the cluster encoding.

| Shell locale | Command | Result |
|---|---|---|
| None set (`env -u LANG -u LC_ALL -u LC_CTYPE -u LC_COLLATE -u LC_MESSAGES`) | old `tests/qa/support/with-pg.sh psql -c "show server_encoding"` | `SQL_ASCII`, `template1` C/C |
| `LANG=C.UTF-8` | same | `UTF8`, `template1` C.UTF-8/C.UTF-8 |

**Note on the locale settings:** this sandbox exports `LC_CTYPE=C.UTF-8`. initdb takes its encoding from `LC_CTYPE`, so `env -u LANG -u LC_ALL` alone would still produce a UTF8 cluster here and would **not** reproduce the orchestrator's failure. For the "unset" mode I therefore also unset `LC_CTYPE`, `LC_COLLATE`, `LC_MESSAGES`, `LC_NUMERIC`, `LC_TIME` and `LC_MONETARY`. Every log header prints the effective `LANG`, `LC_ALL` and `LC_CTYPE`.

## Fix

### 1. Fail closed in the product

**New module `packages/db/src/encoding.ts`**

- It exports `REQUIRED_SERVER_ENCODING = "UTF8"`, `readServerEncoding(q)` (`SHOW server_encoding`), `assertUtf8Database(q)` and `DatabaseEncodingError` (with a `.found` field).
- The message is: `the database must use UTF8 encoding (found SQL_ASCII); create it with ENCODING 'UTF8' TEMPLATE template0`.
- All four are exported from `@mth/db`.

**`mth-db migrate`**

- `migrate()` in `packages/db/src/migrate.ts` calls `assertUtf8Database(client)` right after connecting. That is **before** the advisory lock, before `CREATE TABLE IF NOT EXISTS schema_migration`, and before any migration.
- On a non-UTF8 database nothing is created.

**`mth-db status`, `bootstrap` and `seed-dev`**

- In `packages/db/src/cli.ts` these commands call `assertUtf8Database(pool)` on the same pool they then use, before any read, write or argument use.
- The CLI prints `mth-db: <message>` on stderr and exits 1.

**`/readyz`** (`apps/api/src/modules/platform/health.ts`)

- On a non-UTF8 database it answers `503 {"status":"not_ready","checks":{"database":"fail","migrations":"fail"}}` and logs `readiness: the database must use UTF8 encoding (found …)` at error level.
- The contract's `Readiness` schema has no encoding field and `openapi.yaml` was out of scope, so the result is reported as `database: fail`.
- **Cost:** a UTF8 answer is cached for the life of the route, so there is one `SHOW server_encoding` per process (unit-tested). A non-UTF8 answer is not cached, so a corrected database becomes ready without a restart (also unit-tested).

**Documentation**

- ADR-0003 has a new section "Database encoding (amendment, T-DG2-BE9, 2026-10-06)" and a new Consequences bullet.
- `docs/architecture/data-dictionary.md` has a global rule "Encoding".
- `packages/db/README.md` lists UTF8 under Prerequisites.
- `docs/operations/health-readiness.md` covers the `/readyz` and `mth migrate` behaviour.
- `docs/operations/clean-start.md` has a Troubleshooting row.

### 2. Deterministic harnesses: `--encoding=UTF8 --locale=C`

**Why `C` and not `C.UTF-8`:**

- `C` exists on every platform. `C.UTF-8` is missing on some, for example macOS and older glibc.
- `C` sorts by code point, independently of the C library's collation version.
- It is the assignment's default.

**Known difference, documented in ADR-0003:** under a `C` ctype, `lower()`/`upper()` fold only ASCII letters, whereas production's `en_US.utf8` folds all Latin letters. Arabic has no case, so Arabic text is unaffected. The current suites passed under both the old `C.UTF-8` clusters and the new `C` clusters.

**What changed:**

- Every disposable `initdb` now uses `--encoding=UTF8 --locale=C`.
- Every test, demo or e2e `CREATE DATABASE` now uses `ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`.
- The harnesses print `server_encoding`, `lc_collate` and `lc_ctype` in their logs.

### 3. Sweep: every `initdb` / `CREATE DATABASE` in the repository

Searched with `git grep -nE 'initdb|CREATE DATABASE|create database|\bcreatedb\b|server_encoding|POSTGRES_INITDB_ARGS|LC_COLLATE|ENCODING'`. The search excluded `trading_agent/`, `docs/source/` and the delivery records.

| # | Location | Before | After |
|---|---|---|---|
| 1 | `tests/qa/support/with-pg.sh` | `initdb` with no encoding | `--encoding=UTF8 --locale=C`; the startup line prints `server_encoding, lc_collate, lc_ctype` |
| 2 | `apps/web/e2e/support/with-stack.sh` | `initdb` and plain `CREATE DATABASE mth` | `initdb --encoding=UTF8 --locale=C`; `CREATE DATABASE mth … ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`; prints the database encoding |
| 3 | `e2e/support/qa-stack.sh` | same as 2 | same as 2 |
| 4 | `packages/db/test/global-setup.ts` (`createScratchDatabase`, used by the per-run DB and every scratch DB of api, db, worker and qa suites) | plain `CREATE DATABASE` | explicit `ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`; new option `{ encoding: "SQL_ASCII" }` exists **only** for negative tests; the setup line logs `server_encoding` |
| 5 | `e2e/clean-start/a18-clean-start.sh` | `initdb`; `CREATE DATABASE mth` and `mth_empty` | `initdb --encoding=UTF8 --locale=C`; both databases explicit UTF8/C/template0 |
| 6 | `deploy/scripts/clean-start-local.sh` | `initdb`; `CREATE DATABASE mth_dev` | `initdb … --encoding=UTF8 --locale=C`; `mth_dev` explicit UTF8/C/template0 |
| 7 | `deploy/compose/db-init/10-mth-roles.sh` (Compose first start, and also used by #6) | `CREATE DATABASE mth OWNER mth_owner` | `… ENCODING 'UTF8' TEMPLATE template0`. The locale is deliberately **inherited from the cluster**, consistent with its initdb: `en_US.utf8` in the postgres:18 image, `C` in #6. Production collation is a deployment choice, so I did not force it to C |
| 8 | `deploy/compose/compose.yaml` (`db` service) | image default (UTF8 by `en_US.utf8`) | adds `POSTGRES_INITDB_ARGS: "--encoding=UTF8"` (explicit; takes effect on an empty volume only) |
| 9 | `deploy/scripts/ci-e2e-stack.mjs` (CI e2e job) | `CREATE DATABASE ${database} OWNER mth_owner` | explicit UTF8/C/template0 |
| 10 | `.github/workflows/ci.yml`, `deploy/ci/ci.yml`, `docs/architecture/ci/ci.yml` (`postgres:18` service containers) | not changed | The CI databases are created by #4 and #9 with an explicit encoding, so the service cluster's locale no longer matters. `C` with `template0` is accepted on an `en_US.utf8` cluster |
| 11 | `packages/db/README.md` (documented `CREATE DATABASE`) | `CREATE DATABASE mth OWNER mth_owner` | `… ENCODING 'UTF8' TEMPLATE template0` plus the refusal note |

No other `initdb` or `CREATE DATABASE` exists in scripts, tests, deploy or docs. `apps/worker/test/support.ts` and the `tests/qa` suites use #4.

## Changed files

| File | Purpose |
|---|---|
| `packages/db/src/encoding.ts` (new) | UTF8 requirement: `readServerEncoding`, `assertUtf8Database`, `DatabaseEncodingError` |
| `packages/db/src/migrate.ts` | Encoding check before the lock, the bookkeeping table and any migration |
| `packages/db/src/cli.ts` | Encoding check for `status`/`bootstrap`/`seed-dev`; prints `mth-db: <message>`, exit 1 |
| `packages/db/src/index.ts` | Exports the encoding API |
| `apps/api/src/modules/platform/health.ts` | `/readyz`: non-UTF8 gives `database: fail`; positive result cached per process |
| `apps/api/src/modules/platform/health.test.ts` (new) | Unit: one `SHOW` per process on UTF8; SQL_ASCII not cached; recovery |
| `apps/api/test/integration/platform.test.ts` | Integration: `/readyz` on a real SQL_ASCII scratch DB gives 503 `database: fail`; control on a UTF8 scratch DB gives `database: ok`, `migrations: pending` |
| `apps/api/test/support/harness.ts` | `TestApi.close()` also ends the server pool when Kysely never adopted it (see Notes) |
| `packages/db/test/global-setup.ts` | Explicit UTF8/C/template0 scratch databases; opt-in SQL_ASCII for negative tests; logs `server_encoding` |
| `packages/db/test/helpers.ts` | Re-exports `ScratchEncoding` |
| `packages/db/test/integration/encoding.test.ts` (new) | Test DB is UTF8 (C/C); `char_length` counts code points; `migrate`/`status`/`seed-dev`/`bootstrap` CLI and `migrate()` refuse SQL_ASCII with nothing created; UTF8 control migrates |
| `tests/qa/support/with-pg.sh`, `apps/web/e2e/support/with-stack.sh`, `e2e/support/qa-stack.sh` | Harness determinism (sweep #1–3) |
| `e2e/clean-start/a18-clean-start.sh`, `deploy/scripts/clean-start-local.sh`, `deploy/compose/db-init/10-mth-roles.sh`, `deploy/compose/compose.yaml`, `deploy/scripts/ci-e2e-stack.mjs` | Sweep #5–9 |
| `docs/architecture/adr/ADR-0003-persistence.md`, `docs/architecture/data-dictionary.md`, `packages/db/README.md`, `docs/operations/health-readiness.md`, `docs/operations/clean-start.md` | Documentation of the requirement, provisioning and troubleshooting |
| `docs/delivery/handbacks/DG2/T-DG2-BE9-evidence/*.log` | Check logs |

## Behaviour delivered (per assignment item)

**1. Fail closed**

- On a SQL_ASCII database, `mth-db migrate` exits 1 with `mth-db: the database must use UTF8 encoding (found SQL_ASCII); create it with ENCODING 'UTF8' TEMPLATE template0`.
- Nothing is created: `to_regclass('public.schema_migration')` is NULL, and there are no relations and no extra schemas.
- `status`, `seed-dev` and `bootstrap` behave the same way.
- `/readyz` gives 503 `database: fail`, and the positive result is cached.
- The requirement is documented in ADR-0003, the data dictionary, the db README and the operations docs.

**2. Harnesses are UTF8 regardless of locale**

- This is proven in both modes: `server_encoding UTF8, lc_collate C, lc_ctype C` appears in the integration, web e2e and qa-stack logs.

**3. Tests**

- The test DB's `server_encoding` is UTF8.
- `migrate` refusal on `ENCODING 'SQL_ASCII' TEMPLATE template0` is tested for exit status, message, and no table or row.
- Readiness is tested at both unit and integration level.
- The F-DG2-181 astral test passes in both locale modes.

## Checks actually run

Environment: sandbox, offline, `/home/user/My-owns`, PostgreSQL 16.13. Node 24.21.0 unless stated; Node 22.22.2 from `/opt/node22/bin`. Chromium came from `/opt/pw-browsers` (`playwright install` was not run).

- **"unset" mode:** `env -u LANG -u LC_ALL -u LC_CTYPE -u LC_COLLATE -u LC_MESSAGES -u LC_NUMERIC -u LC_TIME -u LC_MONETARY`. Log prefix `nolocale-`.
- **"C.UTF-8" mode:** `env -u LC_ALL LANG=C.UTF-8`. Log prefix `cutf8-`.
- All matrix runs were on the final tree.

| Check | Unset locale | `LANG=C.UTF-8` |
|---|---|---|
| `pnpm -r typecheck` | exit 0 | exit 0 |
| `pnpm -r build` | exit 0 | exit 0 |
| `pnpm lint` | exit 0 | exit 0 |
| `pnpm format:check` | exit 2 (see note 1) | exit 2 (same) |
| `prettier --check . --ignore-path .gitignore --ignore-path <.prettierignore + 12 masked files>` | exit 0, `All matched files use Prettier code style!` | exit 0 |
| `pnpm openapi:lint` | exit 0, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 161 operations` | exit 0 (same) |
| `pnpm test` on Node 22.22.2 | exit 0, `Test Files 34 passed (34)`, `Tests 640 passed (640)` | exit 0, 34/34, 640/640 |
| `pnpm test` on Node 24.21.0 | exit 0, 34/34, 640/640 | exit 0, 34/34, 640/640 |
| `QA_PG_PORT=55471 tests/qa/support/with-pg.sh pnpm test:integration` | exit 0, `Test Files 30 passed (30)`, `Tests 483 passed (483)` (note 2) | exit 0, 30/30, 483/483 |
| Web e2e (note 3) | exit 0, `Running 58 tests using 1 worker`, `58 passed (3.7m)`; log line `e2e database mth: server_encoding UTF8, lc_collate C, lc_ctype C` | exit 0, `58 passed (3.6m)`, same encoding line |
| `QA_E2E_PG_PORT=55491 e2e/support/qa-stack.sh curl -fsS http://localhost:3000/readyz` | exit 0; `qa e2e database mth: server_encoding UTF8, lc_collate C, lc_ctype C`; `readyz: {"status":"ready","checks":{"database":"ok","migrations":"ok"}}` | exit 0, same |
| F-DG2-181, verbose (note 4) | exit 0, `✓ … a name with astral characters at the 200 boundary is cut on a code-point boundary (F-DG2-181)`, `Tests 32 passed (32)` | exit 0, same |

**Note 1, `format:check`:** the failures are only `EACCES` on the 12 sandbox-masked files: `.bash_profile .bashrc .gitconfig .gitmodules .idea .mcp.json .profile .ripgreprc .vscode .zprofile .zshrc CLAUDE.local.md`. There are zero `[warn]` style findings, and the log ends with `All matched files use Prettier code style!`.

- `--ignore-path` patterns resolve relative to the ignore file, so the combined ignore file was placed temporarily at the repository root as `.prettierignore.be9-sandbox` and deleted right after the run.
- `.gitignore` is passed explicitly because an explicit `--ignore-path` replaces Prettier's defaults.

**Note 2, integration:** 483 = the orchestrator's 474 plus my 9 new tests (8 in `encoding.test.ts`, 1 in `platform.test.ts`).

- These files are included and pass: `contract/contract.test.ts` (11 tests; its route-coverage test asserts `toHaveLength(161)` operations), `oidc.test.ts` (24), `blank-text.test.ts` (25), `encoding.test.ts` (8) and `platform.test.ts` (12).
- The cluster line reads `server_encoding UTF8, lc_collate C, lc_ctype C`, and the setup line reads `database mth_test_… (server_encoding UTF8); applied 19 migrations`.

**Note 3, web e2e command:** `E2E_PG_PORT=55481 E2E_API_PORT=3591 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p2-journeys.spec.ts apps/web/e2e/p2-blank-text.spec.ts --project=chromium-en --project=chromium-ar --workers=1`

**Note 4, F-DG2-181 command:** `QA_PG_PORT=55471 with-pg.sh npx vitest run --project integration oidc.test.ts encoding.test.ts --reporter=verbose`

### Other checks

| Check | Result |
|---|---|
| `node tools/gates/validate.mjs --historical --stage DG1` | **exit 0**, `PASS gate DG1 (historical)` (`validate-historical-DG1.log`) |
| `node --test deploy/scripts/tests/check-ci-needs.test.mjs deploy/scripts/tests/pin-images.test.mjs` (the CI command; run because I edited `compose.yaml`) | **exit 0**, `tests 59`, `pass 59`, `fail 0` (`deploy-script-tests.log`). My first attempt passed a directory to `node --test` and errored with `MODULE_NOT_FOUND`; the log was overwritten by the correct run |
| `node deploy/scripts/pin-images.mjs --check` | **exit 1, pre-existing and unrelated.** The Keycloak image `quay.io/keycloak/keycloak:26.4` has no digest (registry was unreachable on 2026-10-01). The same 2 problems and exit 1 occur on an untouched HEAD clone (`pin-images-check-HEAD-baseline.log`). My `compose.yaml` diff only adds the `POSTGRES_INITDB_ARGS` lines |
| `bash -n` on the 6 edited shell scripts | all syntax OK |

### Negative controls: the new tests fail on the old code

Each control ran in the tree with the current files backed up to `$TMPDIR`. Afterwards the files were restored, and `sha256sum -c` printed `OK` for all 5.

**A. Product reverted to HEAD** (`cli.ts`, `migrate.ts`, `health.ts`); new tests and harness kept. Log: `negative-control-A-product-reverted.log`.

- Integration: **exit 1**, `Tests 6 failed | 14 passed (20)`. The `migrate`, `status`, `seed-dev`, `bootstrap` and `migrate()` refusals fail, and so does the readiness SQL_ASCII test.
- The old `mth-db migrate` **exited 0 on the SQL_ASCII database** (`expected +0 to be 1`): it applied every migration.
- Unit `health.test.ts`: **exit 1**, `2 failed`.

**B0. Product and harness both reverted to HEAD**, no locale. Log: `negative-control-B0-old-tree.log`.

- **exit 1**, `Tests 8 failed | 24 passed (32)`.
- The failures include `the per-run test database > is UTF8 …`, `counts characters, not bytes …` and the original **`oidc.test.ts > … astral characters at the 200 boundary … (F-DG2-181)`**. This reproduces the orchestrator's failure.

**B1. Old `with-pg.sh` and old `global-setup.ts`, new product.** Log: `negative-control-B1-harness-reverted.log`.

- **exit 1** at global setup: `mth-db migrate failed on the fresh test database (exit 1): mth-db: the database must use UTF8 encoding (found SQL_ASCII); create it with ENCODING 'UTF8' TEMPLATE template0`.
- The product now refuses a locale-dependent SQL_ASCII test database instead of producing locale-dependent results.

**B2. Old `with-pg.sh` (SQL_ASCII cluster), new `global-setup.ts`.** Log: `negative-control-B2-harness-reverted.log`.

- **exit 0**, `32 passed`, with the test DB `server_encoding UTF8`.
- The explicit `CREATE DATABASE … ENCODING 'UTF8' TEMPLATE template0` alone makes the integration DB independent of the cluster's locale.

### Not run / BLOCKED

- **`deploy/scripts/clean-start-local.sh --include-worktree`** (optional; it would exercise sweep #6 and #7 end to end): **BLOCKED** (`clean-start-local-nolocale.log`).
  - The pnpm store `/root/.local/share/pnpm/store/v10` is on a read-only filesystem in this sandbox. A copy under `$TMPDIR` was writable, but offline install then failed with `ERR_PNPM_NO_OFFLINE_TARBALL` (`@tanstack/react-query-5.90.2` is missing from the store). There is no network.
- **`e2e/clean-start/a18-clean-start.sh`**: **NOT RUN**. It checks out a committed revision (`--commit`, default HEAD) into a fresh clone, and these changes are uncommitted. Its edits are the same two-line pattern verified in #1–3 (`bash -n` OK).
- **Compose with a `postgres:18` container**: **BLOCKED**. The Docker daemon is not accessible (`permission denied … /var/run/docker.sock`). The `POSTGRES_INITDB_ARGS` and `10-mth-roles.sh` changes were not exercised in a container.

## Notes and known gaps

- **Harness change in `apps/api/test/support/harness.ts`.** The readiness integration test at first took about 10 s: `dropScratchDatabase` waited on an idle `api-test` backend.
  - Cause: Kysely's `PostgresDriver` adopts the pool only in `init()` (its first query), so `db.destroy()` is a no-op for an API that served only raw-pool routes such as `/readyz`. The `pg` pool then stayed open until pg's 10 s `idleTimeoutMillis`.
  - Fix: `TestApi.close()` now also calls `pool.end()` when the pool is not already ending.
  - The test now takes about 0.3 s. Existing tests are unaffected (they all ran Kysely queries).
- **The readiness encoding failure is reported as `database: fail`**, and `migrations` is also reported as `fail` because it is not evaluated. A dedicated `checks.encoding` field would need a contract change in `openapi.yaml`, which this assignment excluded. A follow-up could add it.
- **The worker does not check the encoding itself.** In Compose it starts only after `migrate` `completed_successfully`, and `migrate` now refuses non-UTF8, so it is gated in practice. A direct `mth worker` start against a non-UTF8 database would not be refused by the worker itself. This was not in scope.
- **Production locale is not enforced.** Only the encoding is enforced. Test clusters use `C`; production uses the image's `en_US.utf8`. The `lower()` difference for non-ASCII Latin letters is documented in ADR-0003. Arabic is unaffected.
- **Existing non-UTF8 databases** cannot be converted in place. The operations doc says to re-create the database, or dump and restore into a UTF8 database.

## Merge instructions

- No migration, no new dependency and no contract change.
- Integrate the working-tree changes listed above.
- After merging, existing disposable clusters are irrelevant: each harness run creates a fresh one.
- Existing Compose volumes keep their encoding. `POSTGRES_INITDB_ARGS` applies only to an empty volume, and the image default was already UTF8.
- Conflicts are possible only in `apps/api/test/integration/platform.test.ts` (new `describe` block added before "rate limiting") and `packages/db/test/global-setup.ts` (`createScratchDatabase` signature gained an optional third parameter; existing callers are unchanged).
