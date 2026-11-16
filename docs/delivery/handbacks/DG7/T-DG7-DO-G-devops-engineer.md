# Handback T-DG7-DO-G (devops-engineer): dry run, migration catalogue, upgrade guide

- **Stage:** DG7 (BUILDING). This is p7-work-split §E.3 (ADR-0068 §1–§5).
- **Branch:** `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `HEAD` = `47b32d48dad4f589e3b9edf7c326250167926238`, verified with `git rev-parse HEAD` before writing. The tree was clean apart from this run's own `runs/` folder.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-DO-G-devops-engineer-20261113T022240Z-156dfa18","session_id":"156dfa18-85af-45da-b8c6-f6076dc48ca6"}`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DO-G.md`, sha256 `9fee8598…0648` (checked).
- **Time:** started 2026-11-13T02:22:53Z; checks finished 02:58:23Z.
- **Environment:**
  - Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`, with `MTH_PNPM_OFFLINE=1`.
  - Disposable PostgreSQL 16.15 (Ubuntu) through `tests/qa/support/with-pg.sh`, on port 24351, UTF8 with the C locale.
  - `pg_dump` and `pg_restore` from `/usr/bin`.
  - No Docker daemon (D-243 Q1); none was needed.
  - About 3.8 GB disk free. No extra checkout was made, and every temporary tree was under `$TMPDIR` and removed.
- **Approvals.** This is engineering work. It grants no G1–G6 business approval and no IT approval of an upgrade, and implies nothing about DG7.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `packages/db/src/dry-run.ts` (new) | ADR-0068 §1–§2: `runDryRun` and `runDryRunCommand`. Production-marker refusal, the status refusals, the catalogue snapshot (`captureSnapshot`, `diffSnapshots`), exact row counts, the throw-away database `CREATE DATABASE … TEMPLATE … OWNER mth_owner`, the real `migrate()` timed per file, a `finally` drop, a source-unchanged check, the JSON report `mth-migrate-dry-run/1`, and the exact E.5 lines. |
| `packages/db/src/cli.ts` (modified) | Only the `--dry-run` branch of `migrate`, its import and its usage and header lines (diff: 7 added lines, 0 removed). |
| `packages/db/test/integration/dry-run.test.ts` (new) | T-E30…T-E33 and the ADR-0068 §5 proof, on a DG6-level copy restored with `pg_dump`/`pg_restore` (9 tests). |
| `tools/release/migration-catalogue.mjs` (new) | ADR-0068 §3: the scanner (`stripSql`, `classifySql`), overrides validation, generation of the JSON and of the guide's table, and `--check`. Exit codes 0/1/2. |
| `tools/release/migration-catalogue.overrides.json` (new) | `mth-migration-catalogue-overrides/1`, with an empty `overrides` array (none needed; see §4). |
| `tools/release/tests/migration-catalogue.test.mjs` (new) | T-E34…T-E36 (46 `node --test` cases). |
| `docs/handover/migration-catalogue.json` (generated) | 131 entries: 73 additive, 38 data_rewrite, 20 destructive. sha256 `995aadf7…6321`. |
| `docs/handover/upgrades.md` (new; table generated) | ADR-0068 §4: principles, dry-run usage and exit lines, the maintenance window and rollback by restore, the catalogue classes and the generated table, what was tested with measured timings, and the provisional Arabic summary. |
| `docs/delivery/handbacks/DG7/T-DG7-DO-G-devops-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-DO-G-evidence/*` | Logs and the CLI dry-run report (listed in §3). |

`apps/api/test/support/p7-pending*.ts`: no entry belongs to DO-G (it adds no API operation), so nothing was removed. `grep -n "DO-G\|dry-run\|migration-catalogue" apps/api/test/support/p7-pending*.ts` finds nothing.

## 2. Behaviour delivered, per requirement

**REQ-S19-013 "a dry-run migration on a restored copy reports its changes"** (T-E30, T-E31, T-E32, T-E33)

`mth-db migrate --dry-run [--report FILE] [--catalogue FILE] [--i-confirm-this-is-a-restored-copy]`:

1. **Reads the copy's status.** It uses `migrationStatus` with the `migrate` refusals: changed, unknown and out-of-order files exit 2 and create nothing.
2. **Checks the production marker** (D-248 O9). It refuses a production-marked copy without the flag, with exit 2 and the exact E.5 line. A copy without a `deployment_environment` row counts as production; see open question 2.
3. **Captures the snapshot** of the `public` and `pgboss` schemas:
   - tables and columns (type, nullability, default);
   - constraints (`pg_get_constraintdef`) and indexes (`pg_get_indexdef`);
   - triggers (`pg_get_triggerdef`, enabled state, deferrable);
   - functions (identity, security definer or invoker, result, SHA-256 of `prosrc`);
   - `mth_app` table, column and function grants (`aclexplode`);
   - `schema_migration`.

   Everything is ordered `COLLATE "C"`. It also takes exact row counts as decimal strings (`null` = absent or unreadable, never 0).
4. **Creates the throw-away database:** `CREATE DATABASE <copy>_dryrun_<utc> TEMPLATE <copy> OWNER mth_owner`, with `DRY_RUN_ADMIN_DATABASE_URL`, or the `_FILE` variant read at run time. If the copy has other sessions, exit 2.
5. **Applies the pending files** with the unchanged real `migrate()`, timing each file from the runner's `applying` lines.
6. **Diffs** the snapshot and the row counts: `added`, `removed` and `changed` per category.
7. **Always drops** the throw-away database (`DROP DATABASE … WITH (FORCE)` in a `finally`), then re-reads the copy's `schema_migration` to prove it is unchanged.

The exit codes:

- **0:** every pending file applied.
- **1:** a file failed. The line names it and gives the PostgreSQL error and the count not attempted. Exit 1 is also used when the drop fails, with a warning naming the database.
- **2:** a refusal, or missing input.

Each pending migration's class comes from the catalogue, matched by name **and** SHA-256. When the catalogue is missing or names another version of the file, the class is `unknown`, never `additive`.

**REQ-S19-013 "the guide identifies each irreversible migration and its backup-based recovery"** (T-E34, T-E35, T-E36)

- **The catalogue.** It gives every file `0001`–`0148` its `id`, `name`, `sha256`, `stage`, `class`, `irreversible`, `reasons[]` and `recovery`.
- **What the scanner strips:** comments (nested block comments included), string literals (including `''` and `E''`), and dollar-quoted function bodies of any tag.
- **What it classifies:**
  - `UPDATE`, `DELETE`, `INSERT … SELECT`, `WITH …` DML and backfills `SELECT f(…) FROM t` are `data_rewrite`, as is a `CREATE OR REPLACE` of a function, view or trigger an earlier file created.
  - Any `DROP …` (including `DROP NOT NULL`), `TRUNCATE`, `ALTER … TYPE`, `RENAME` and `REVOKE` are `destructive`. A `REVOKE` on an object the same file creates does not count.
  - `DO` blocks are scanned for DML, DROP and EXECUTE, because they run at migration time.
- **Overrides** raise a class only, with a reason of at least 20 characters. The tool refuses a stale id, an unknown class, a duplicate and an unknown key.
- **`--check`** fails (exit 1) when the JSON or the guide's table differs from a fresh generation.
- **`upgrades.md`** carries the irreversible table (58 rows, each with reasons and the restore-based recovery) and the list of additive ids.

**REQ-S19-013 "tested by upgrading a restored copy from the previous release"** (ADR-0068 §5)

In the integration test and in the CLI drill (§3):

1. A database at the DG6 level (0001–0130; 122 files) was built by the real runner, dumped and restored.
2. The dry run found exactly the 9 P7 files.
3. The real `migrate` then applied those 9 files, and `status` reported "up to date (131 applied)".
4. The upgraded copy's snapshot equals a freshly migrated database's snapshot. The comparison normalises parentheses in expression text; see gap 3.

Measured with the real CLI on that copy:

| Step | Result |
| --- | --- |
| DG6 build | 2.9 s |
| `pg_dump -Fc` | 3,285,935 bytes, sha256 `0614c3f6…ac87`, 0.43 s |
| `pg_restore` | 3.63 s |
| Dry run | 9 migrations in 1.7 s reported (2.18 s wall). Per file 0.002–0.066 s. Diff: +19 tables, +222 columns, +233 constraints, +41 indexes, +57 triggers, +14 functions, +80 grants, +9 migrations. Row counts changed in 26 tables. |
| Real migrate | 0.75 s wall |

The workload held only seed rows (no business or demo data), so these are not production estimates.

## 3. Checks actually run

All commands ran from the repository root with `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH MTH_PNPM_OFFLINE=1`.

| # | Command | Result | Evidence |
| --- | --- | --- | --- |
| 1 | `tests/qa/support/with-pg.sh npx vitest run --project integration packages/db/test/integration/dry-run.test.ts` | **exit 0**: 9/9 passed (T-E30…T-E33, §5), 27.7 s | `T-DG7-DO-G-evidence/dry-run-integration.log` |
| 2 | `tests/qa/support/with-pg.sh bash $TMPDIR/cli-drill.sh`: the real `node --conditions=@mth/source packages/db/src/cli.ts migrate --dry-run …` on a restored DG6 copy (without the flag, with the flag and `--report`, then the real `migrate` and `status`) | **exit 0**. Without the flag: exit 2 and the E.5 line. With the flag: exit 0, `9 pending migration(s) applied to a throw-away copy in 1.7 s; the source is unchanged`. 0 `_dryrun_` databases left; the copy still has 122 applied. `migrate` applied 9; `status` was up to date, exit 0. (The drill's "exit" after `migrate \| tail` is tail's status; `status` exit 0 is the real check.) | `dry-run-cli-drill.log`; `dry-run-report.json` (sha256 `cfa3636e…56f0`) |
| 3 | `node --test tools/release/tests/migration-catalogue.test.mjs` | **exit 0**: 46 pass, 0 fail | `migration-catalogue-test.log` |
| 4 | The same test plus `node tools/release/migration-catalogue.mjs --check`, with the locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE`) and with `LC_ALL=C.UTF-8` | **exit 0 / 0** in both | `catalogue-locales.log` |
| 5 | `node tools/release/migration-catalogue.mjs --check` (after the last guide edit) | **exit 0**: `PASS: … 131 migrations (73 additive, 38 data_rewrite, 20 destructive)` | console |
| 6 | `pnpm -r typecheck` | **exit 0** (2 m 53 s) | `typecheck.log` |
| 7 | `pnpm lint` | **exit 0** | `lint.log` |
| 8 | `pnpm openapi:lint` | **exit 0**: `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` | `openapi-lint.log` |
| 9 | `pnpm test` | **exit 0**: unit-node 201 files / 2973 tests; unit-web 127 / 2133; nocodegen 3 files, 259 passed, 2 skipped (pre-existing skips) | `pnpm-test.log` |
| 10 | `tests/qa/support/with-pg.sh npx vitest run --project integration packages/db/test/integration apps/api/test/integration/contract/contract.test.ts` | **exit 0**: 22 files, 432 tests (the whole db integration suite, because `cli.ts` changed, plus the contract test) | `integration-db-and-contract.log` |
| 11 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0** | `prettier-check.log` |
| 12 | `node tools/gates/validate.mjs --historical --stage DG6` | **exit 0**: `PASS gate DG6 (historical)` | `validate-historical-DG6.log` |
| 13 | `node --test tools/release/tests/*.test.mjs licenses/tests/*.test.mjs` | **exit 1**: 317 pass, **1 fail**, 2 skipped. The failure is T-A5 (`build-from-archive.test.mjs`, DO-A's test). Its `pnpm install` gets `EROFS: read-only file system` writing to the pnpm store at `/root/.local/share/pnpm/store` (HOME is read-only in this sandbox). It does not touch my files: **BLOCKED in this sandbox**, not a pass. Every other release test passes, including the 46 of this task. | `release-tests.log` (l.398–425) |
| 14 | `node tools/release/claims-scan.mjs`; `node tools/release/secret-scan.mjs` | **exit 0 / 0** (`claims-scan: PASS (851 files …)`, `secret-scan: PASS (payload; 3017 files …)`) | console |

## 4. Known gaps / not done

1. **ADR-0066 scripts not used.** `backup.sh` and `restore.sh` (DO-F, W8) are not merged. The test and the drill back up and restore with `pg_dump`/`pg_restore` directly, as ADR-0068 §5 allows. When DO-F lands, the A19/A18 re-run (QA-C) should repeat the upgrade through those scripts.
2. **The restore in my test needs a reordered list** (see open question 1). Its `pg_restore` uses `--use-list` to load `governance_party`'s data first. Without that reordering, a plain restore fails at HEAD.
3. **The §5 "same schema as a fresh database" check normalises parentheses.** `pg_dump` re-prints CHECK and trigger WHEN expressions with flattened parentheses (for example, `((a AND b) AND c)` becomes `(a AND b AND c)`). The comparison is therefore:
   - keys: exact in every category;
   - values: equal once `(` and `)` are removed;
   - `tables`, `grants` and `migrations`: exact.

   The dry run's own diff compares like with like (copy and throw-away copy), so it is unaffected.
4. **The scanner is heuristic** (ADR-0068 Residual 1):
   - A top-level `SELECT f(…)` without `FROM` stays additive.
   - Dynamic SQL is flagged only inside `DO` blocks.
   - No override was needed. I read the 58 irreversible rows and spot-checked the unflagged `DO` blocks (0001, 0009, 0026, 0059, 0060, 0086, 0143), which are read-only guards.

   A reviewer should read the `data_rewrite` rows.
5. **The test is not at the path E.3 names.** The catalogue test is at `tools/release/tests/migration-catalogue.test.mjs`, not `tools/release/migration-catalogue.test.mjs`. §2 rule 3 and the CI command (`node --test tools/release/tests/*.test.mjs`) only run files in `tests/`; at E.3's literal path the test would never run in CI. See open question 3.
6. **No CI job was added.** `--check` runs inside the test, so CI covers it through the existing release-tests job. The CI owner may add an explicit step.
7. **Not measured on production-like volumes**, and not run in containers (no Docker daemon, D-243 Q1). A local measurement is not proof of high-availability production readiness.

## 5. Open questions and merge instructions

**Open questions**

1. **(For the orchestrator, DO-F and the solution-architect; likely High for REQ-S19-012 and A18/A19.)** At HEAD, a plain `pg_dump -Fc` → `pg_restore --single-transaction` of a freshly migrated database fails:

   ```
   COPY failed for table "forum_template": … violates check constraint "forum_template_participant_parties_check"
   ```

   This happens at both the DG6 and the full level. Evidence: `T-DG7-DO-G-evidence/plain-restore-probe.log`, a plain dump and restore with no list reordering, each pass with exactly 1 error. The cause is the CHECK `p4_parties_known(participant_parties)` (0030/0044), which reads `governance_party`, while `pg_dump` loads table data in name order. `forum.participant_parties` has the same CHECK, so a database with forums is affected too. ADR-0066 §7's restore will hit this.

   Options:
   - **(a)** `restore.sh` reorders the list (what my test does);
   - **(b)** restore data in two passes;
   - **(c)** a corrective migration that moves the cross-table check into a trigger. That is an ADR decision, and I did not make it.
2. **A copy with no `deployment_environment` row is treated as production** and needs the flag. ADR-0068 §1 says "when the row marks it production". I chose the product's fail-safe reading (0090's comment and ADR-0050 §3: no row → reported as production), so an unmarked copy never escapes the confirmation. If the architect prefers the literal reading, the change is one condition in `runDryRun`, and T-E33's second loop case must be updated with it.
3. **E.3 names `tools/release/migration-catalogue.test.mjs`.** I placed it in `tools/release/tests/` so that §2 rule 3's command and CI run it (gap 5). Please confirm, or move it and the CI glob together.
4. **The dry run accepts `--catalogue FILE`**, beyond ADR-0068 §1's flags. The runtime image ships no `docs/`, so the catalogue must be passed from the release archive there; without it the classes show `unknown`.
5. **`docs/handover/README.md` (DOC-B):** please add the index line `upgrades.md — upgrades: dry run, maintenance window, rollback by restore, migration catalogue (ADR-0068)` and the line for `migration-catalogue.json`.

**Merge instructions**

- No migration was added and no API operation, so the contract count is unchanged.
- **Every later migration requires regenerating the catalogue:** run `node tools/release/migration-catalogue.mjs` and commit both outputs. Otherwise T-E34 (`--check` in `migration-catalogue.test.mjs`) fails. A later P7 migration also lengthens `LATER` in `dry-run.test.ts` automatically. That test asserts that every file after 0130 has `_p7_` in its name.
- **`cli.ts`:** the only hunk is the `--dry-run` branch and its usage and header lines, after BE-D's lines. Expect no conflict unless another task edits the same usage block.
