# ADR-0068: P7 upgrades: `mth-db migrate --dry-run` on a restored copy (apply inside a throw-away database and diff the catalogue), the irreversible-migration catalogue (every migration classified, generated and test-checked), and the maintenance-window and rollback-by-restore procedure

- **Status:** Proposed for P7 (DG7). Author: solution-architect (T-DG7-ARCH-03), 2026-11-12. Base `aaaf9b6034a62b52cea5ddb9d80834ea7b9d1906` on `claude/mobily-transformation-platform-dg6-regate`.
- **Requirement (slice E of `docs/architecture/p7-plan.md`):** REQ-S19-013. Backup and restore is ADR-0066; retention is ADR-0067.
- **Sources (quoted where a design point has one):**
  - M0361 (§19 item 10): "Versioned upgrades, migration dry-runs, maintenance windows and rollback/recovery procedures. Do not assume every schema migration is reversibly down-migratable; explain backup-based recovery when needed."
  - REQ-S19-013 (binding): acceptance "A19;A18: a dry-run migration on a restored copy reports its changes; the guide identifies each irreversible migration and its backup-based recovery"; columns "The upgrade guide is tested by upgrading a restored copy from the previous release", "accept:Mobily IT (external)".
  - p7-plan §1.2 REQ-S19-013: "Proof: DO-G (a dry-run of the newest P7 migrations against a restored DG6-schema copy; the catalogue lists every migration `0001`–last)."
  - Playbook: no block concerns software upgrades. Nothing below is attributed to it.
- **Decisions applied:** D-243 Q14 (same-major restore; a cross-major move is an IT upgrade procedure), D-243 Q1 (container halves on the orchestrator's host), D-245 O9 (implementer migrations renumber at merge; the runner refuses an id below the highest applied).
- **Builds on:** ADR-0003 (migrations are forward-only, "recovery by backup"), `packages/db/src/migrate.ts` (`listMigrationFiles`, `migrationStatus`, checksum and out-of-order refusals, the `dir` option), ADR-0062 (release archive and versions), ADR-0066 (backup set and restore).
- **Two gate systems.** A dry-run report and the catalogue are engineering artefacts. An upgrade of a Mobily installation is an IT change that Mobily IT authorizes; nothing here authorizes one. Nothing here reads or writes DG0–DG7.

## Context

1. **Forward-only migrations.** There is no down migration (ADR-0003). `mth-db migrate` applies every pending file in id order, one transaction per file, refuses a changed applied file, an unknown applied file and an id below the highest applied one.
2. **Upgrade today** is "new images, then the `migrate` service, then `api` and `worker`" (`deploy/compose/compose.yaml`). No dry run, no catalogue, no maintenance-window guide.
3. **Most migrations are additive** (tables, columns, functions, grants, seeds). Some rewrite data or drop objects (for example the P6 repairs that backfill or replace triggers). Which ones is not recorded anywhere.

## Decision

### 1. `mth-db migrate --dry-run` (DO-G; `packages/db/src/dry-run.ts` and one `cli.ts` line)

- **Target:** a **restored copy** (ADR-0066 §7) of the installation to upgrade, never the live database. The command refuses (exit 2) when the target database's `deployment_environment` row marks it `production` **and** `--i-confirm-this-is-a-restored-copy` is not given: a restored copy of production keeps the production marker, so IT confirms explicitly.
- **Mechanism (apply inside a throw-away database):**
  1. Read the status of the copy with `migrationStatus` (the same refusals as `migrate`: changed or unknown applied files, out-of-order ids → exit 2, nothing created).
  2. Capture the **catalogue** of the copy (§2).
  3. With an admin connection (`DRY_RUN_ADMIN_DATABASE_URL`, a role with `CREATEDB` on the copy's cluster), `CREATE DATABASE <copy>_dryrun_<utc> TEMPLATE <copy> OWNER mth_owner`. The template must have no other session, which a restored copy satisfies.
  4. Apply the pending migrations to the throw-away database with the existing `migrate()` (same files, same transactions), timing each.
  5. Capture the catalogue again, diff, and count rows per table before and after (data-changing migrations show up here).
  6. `DROP DATABASE` the throw-away database **always** (in a `finally`), and leave the copy unchanged: its `schema_migration` level is the same before and after (tested).
- **Report** (`--report <file>`, JSON; and a text summary on stdout): source level, target level, the pending migrations with their catalogue class (§3) and seconds, the catalogue diff (added, removed and changed tables, columns, types and nullability, constraints, indexes, triggers, functions, grants), row-count changes per table, and the result. Exit 0 when every pending migration applied, 1 when one failed (the report names it and the PostgreSQL error, and the remaining ones are listed as not attempted), 2 on a refusal.
- **Why not one transaction and a rollback:** the runner commits per file and some statements cannot run in a caller's transaction block; a template copy runs the real path unchanged.

### 2. The catalogue snapshot used by the diff

Read from `pg_catalog` and `information_schema` for the `public` and `pgboss` schemas: tables; columns (type, nullability, default); constraints (`pg_get_constraintdef`); indexes (`pg_get_indexdef`); triggers (name, table, deferrable); functions (signature, `SECURITY DEFINER`, a SHA-256 of the body); table and column grants to `mth_app`; and `schema_migration`. Output is sorted with `COLLATE "C"`, so two equal schemas give equal snapshots.

### 3. The irreversible-migration catalogue (DO-G; `tools/release/migration-catalogue.mjs` + test)

- **Every file** `0001`–last in `packages/db/migrations/` gets one entry: `id`, `name`, `sha256`, `stage` (from the `_pN_` part of the name; `p1` for the unprefixed P1 files), `class`, `reasons[]`, `recovery`.
- **Classes:**
  - `additive`: creates or adds only (tables, columns, indexes, functions, triggers, grants, seed `INSERT … VALUES`).
  - `data_rewrite`: changes existing rows (`UPDATE`, `DELETE`, `INSERT … SELECT` over existing data, backfills), or replaces the body of an existing function or trigger (`CREATE OR REPLACE FUNCTION` of a function an earlier file created).
  - `destructive`: `DROP TABLE`/`COLUMN`/`FUNCTION`/`TRIGGER`/`CONSTRAINT`, `TRUNCATE`, `ALTER … TYPE`, `RENAME`, `REVOKE`.
- **Irreversible** = `data_rewrite` or `destructive`. **Every** migration is forward-only; `additive` ones are only "irreversible without harm" in the sense that the previous release ignores what they add, which the guide does **not** promise: the supported rollback for any upgrade is the restore of the pre-upgrade backup set.
- **Generation.** The scanner strips comments and dollar-quoted bodies (`$$ … $$`, so trigger code that contains `UPDATE` does not count), then matches the statement patterns above. A checked-in `tools/release/migration-catalogue.overrides.json` may raise a class (never lower one without a reason), each override with a `reason` of at least 20 characters.
- **Output:** `docs/handover/migration-catalogue.json` and the table in `docs/handover/upgrades.md`, both generated.
- **Test-checked:** the test fails when a migration file has no entry, an entry names no file, an id or SHA-256 differs from the file, the committed output differs from a fresh generation, or an override lacks its reason. The scanner itself is tested on fixtures for each pattern, including an `UPDATE` inside a `$$` body that must not count.
- **The recovery column** says, for every irreversible migration, "restore the pre-upgrade backup set (ADR-0066 §7) and run the previous release", plus any data note the override gives.

### 4. Maintenance window and rollback by restore (`docs/handover/upgrades.md`, DO-G)

1. **Before the window:** take a backup set (ADR-0066) of production; restore it into a staging database; run `mth-db migrate --dry-run` on the restored copy; read the report and the catalogue rows of every pending migration; IT approves the change outside the platform.
2. **Open the window:** announce it; stop `api` and `worker` (`docker compose stop api worker`); wait until the worker has stopped (its heartbeat goes stale; pg-boss keeps queued jobs in the database).
3. **Take the pre-upgrade backup set** with the services stopped (a quiet set) and record its label and manifest SHA-256.
4. **Upgrade:** load the new images (ADR-0062 image bundle), run the `migrate` service, start `api` and `worker`, check `/readyz` and the smoke test (`deploy/scripts/smoke.mjs`).
5. **Rollback by restore** (when step 4 fails or the smoke fails): stop the services; restore the pre-upgrade set into a **fresh** database and storage (ADR-0066 §7; a restore never overwrites); point the stack at it; start the **previous** images; check `/readyz`. Data written between step 3 and the rollback is lost; with the services stopped there is none.
6. **Close the window** and record timings for each step.

- **Cross-major PostgreSQL** (D-243 Q14) is a separate IT procedure: dump with the newer client, restore into the new major, run the restore checks. It is never combined with an application upgrade in one window.

### 5. Proof (REQ-S19-013 "tested by upgrading a restored copy from the previous release")

DO-G's integration test builds a database at the DG6 level (0001–0130, applied from a temporary directory holding only those files, through `migrate({ dir })`), backs it up and restores it with ADR-0066's scripts (or `pg_dump`/`pg_restore` directly when the scripts are not merged yet, stated in its handback), runs the dry run, and asserts: the report lists exactly the P7 files after 0130; the diff shows the P7 tables (for example `retention_class`, `backup_set`); the copy is still at 0130 afterwards; the throw-away database is gone. Then it runs the real `migrate` on the restored copy and asserts "up to date" and the catalogue test passes there.

### 6. Who builds it, and how it is tested

| Task | Builds | Tests (§E.4) |
| --- | --- | --- |
| DO-G | `packages/db/src/dry-run.ts`, its `cli.ts` line (`--dry-run`, after BE-D's lines, W7), `tools/release/migration-catalogue.mjs` (+ overrides file, + test), `docs/handover/migration-catalogue.json`, `docs/handover/upgrades.md` | T-E30…T-E36 |
| QA-C | A19 re-run includes the upgrade of a restored copy | timings recorded |

## Consequences

- Positive: IT sees exactly what an upgrade will change on a copy of its own data before the window, and which migrations cannot be undone except by restore.
- Negative: the dry run needs a role with `CREATEDB` and enough disk for one more copy of the database.

## Residuals (honest)

1. **The scanner is heuristic.** It errs towards "irreversible" (any `UPDATE` outside a function body counts), and the overrides need human reasons. A reviewer should read the `data_rewrite` rows.
2. **Run times on production volumes are unknown**; the dry run measures them on the copy, which is the point.
3. **No online (zero-downtime) upgrade.** Every upgrade is a maintenance window.

## Alternatives considered

1. **Down migrations.** Rejected (ADR-0003, M0361 "do not assume every schema migration is reversibly down-migratable").
2. **Dry run inside one transaction with ROLLBACK.** Rejected (§1, last bullet).
3. **A hand-maintained catalogue.** Rejected: it would drift; the generated one is checked against every file.

## Version evidence (M0314)

No new dependency. `CREATE DATABASE … TEMPLATE`, `pg_get_constraintdef`, `pg_get_indexdef` and `pg_get_functiondef` are PostgreSQL features in the SQL floor (16). The scanner and the report use Node built-ins.
