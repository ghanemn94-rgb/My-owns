# Handback T-DG7-ARCH-03: slice E, backup, restore, upgrades and retention (solution-architect)

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `aaaf9b6034a62b52cea5ddb9d80834ea7b9d1906` (`git rev-parse HEAD` at the start, and unchanged at the end). My work is uncommitted on top of it. At the start, `git status` showed only this run's own `docs/delivery/runs/DG7/…-fa0a0208/` directory.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-ARCH-03-solution-architect-20261112T165815Z-fa0a0208","session_id":"fa0a0208-d6d2-49f1-9a4f-2cf31056087e"}`. The assignment file's SHA-256 was `c7878015…8110`, as given (checked with `sha256sum`).
- **Time:** start `date -u` 16:58:24 UTC; end in §6.
- **`--historical` (start):** `node tools/gates/validate.mjs --historical --stage DG6` printed `PASS gate DG6 (historical)` and exited **0** (`echo EXIT=$?` on a plain run, not through a pipe).
- **Disk:** about 3.8 GB free at the start. No extra checkout was made. Each disposable PostgreSQL cluster ran under this run's `$TMPDIR` and was deleted by `with-pg.sh`.

## 0. Summary

**ADR-0066: backup and restore (REQ-S19-012, REQ-S20-019).**

- **One backup set** holds:
  - a `pg_dump -Fc` of the whole database, including the `pgboss` schema, `job_run` and `job_schedule`;
  - per-table row counts taken in the **same exported snapshot**;
  - the evidence copy, with the ADR-0064 attachment manifest (`mth-attachment-manifest/1`, D-245), plus the retention archive sets;
  - a deployment configuration bundle with no secret value;
  - `backup-manifest.json` (`mth-backup/1`) with every checksum, the migration level, the PostgreSQL major and the step timings.
- **Packaging:** a `backup` Compose profile on the already pinned `postgres:18` image (no new image). The cadence is IT's.
- **Restore** goes into a **fresh** database and storage only.
  - It refuses a different major (D-243 Q14), a non-empty target and any checksum mismatch.
  - Checks R1–R9 cover the database, evidence, audit, snapshots and job state. Every step is timed.
- **RPO/RTO** are placeholders "to agree with Mobily IT".
- **Reporting:** the script reports each set through the owner-only `backup_set_record()` (0145). `listBackupSets` shows the sets read-only.

**ADR-0067: retention and archival (REQ-S16-024).**

- **12 classes**, all shipped as `retain` with period NULL ("Not set (IT to agree)").
- **Every public base table** is in exactly one class. The map is generated from the catalogue by 0143, and a catalogue test enforces it for every later migration.
- **Never archived or purged:** business, audit, snapshot, system and derived classes are database-enforced `retain` (D-243 Q3).
- **Operational classes:**
  - `job_run` and `webhook_receipt`: archive only (append-only);
  - `processed_message`, `worker_heartbeat` and read `inbox_notification`: archive, or archive then purge;
  - sessions, login states and the replay cache stay with the existing DG1 expiry sweep.
- **The IT approval** is a **reference text** only.
- **Guarantees held in the database:**
  - a marker can only be written for a row that is past retention;
  - the only delete path is the `SECURITY DEFINER` `retention_purge_record()`;
  - each `archived`, `purged` and `skipped_referenced` action needs its own audit event at commit;
  - runs are exactly once, there is a dry run, and at most one run is active.

**ADR-0068: upgrades (REQ-S19-013).**

- **`mth-db migrate --dry-run`** runs on a restored copy. It applies the pending migrations in a `CREATE DATABASE … TEMPLATE` throw-away copy, diffs the catalogue, then always drops the copy and leaves the source unchanged.
- **The irreversible-migration catalogue** classifies every file 0001–last as `additive`, `data_rewrite` or `destructive`. It is generated with reasoned overrides and test-checked.
- **The maintenance window** has an explicit rollback-by-restore procedure.

**Also delivered:**

- **Migrations** 0143–0146, written from the low end of the range.
- **Kysely types and catalogue pins.**
- **A guard probe** on real PostgreSQL 16.15: 15 tests.
- **Permissions:** `P7_RETENTION_PERMISSIONS`, with 4 codes.
- **Contract:** 10 operations, all pending for BE-G; the contract has 961 operations.
- **Advisory lock** 730410, with 730411–730415 reserved.
- **Docs:** ERD §1ad, the data dictionary "P7 tables, slice E" (generated), permissions matrix §31 and `p7-work-split.md` §E.

## 1. Changed files

| File | Purpose |
| --- | --- |
| `docs/architecture/adr/ADR-0066-p7-backup-restore-backup-set-manifest-restore-checks-drill.md` | **new.** Backup set, manifest, profile, restore, checks R1–R9, drill, who builds and tests (REQ-S19-012, S20-019) |
| `docs/architecture/adr/ADR-0067-p7-retention-classes-archival-job-dry-run-purge-guard.md` | **new.** Classes, table map, runs, archive, purge, audit per action, seams 5 and 9 (REQ-S16-024) |
| `docs/architecture/adr/ADR-0068-p7-upgrades-migration-dry-run-irreversible-catalogue-maintenance-window-rollback-by-restore.md` | **new.** Dry run, catalogue, maintenance window, rollback by restore (REQ-S19-013) |
| `packages/db/migrations/0143_p7_retention_classes.sql` | **new.** `retention_class` (12 rows), `retention_table_class` (generated plus explicit rows, checked by a `DO` block), `retention_class_guard` |
| `packages/db/migrations/0144_p7_retention_runs.sql` | **new.** `retention_run`, `retention_archived_record`, `retention_run_action`; key and age functions; the purge function; the read-only trigger on `inbox_notification` and `worker_heartbeat`; their `retention_table_class` rows |
| `packages/db/migrations/0145_p7_backup_sets.sql` | **new.** `backup_set` and the owner-only `backup_set_record(jsonb)` |
| `packages/db/migrations/0146_p7_retention_backup_permissions.sql` | **new.** 4 permission codes, 7 role links |
| `packages/db/test/integration/p7-retention-guards.test.ts` | **new.** Guard probe, 15 tests |
| `packages/db/src/schema.ts` | 6 table interfaces in their own `Database` block, `*Row` types, `SCHEMA_COLUMNS` entries (additive; 0 deleted lines) |
| `packages/db/test/integration/catalogue.test.ts` | the 0143–0145 trigger pin; "every public base table has exactly one retention class"; the class-registry test; 2 mutable tables; 6 privilege pins; **one added line in the approved P6 `worker_heartbeat` trigger pin** (O4) |
| `packages/db/src/seed.test.ts` | the 0146 parity block (3 tests); the numbering example moves from 0136 to 0147 |
| `packages/shared/src/permissions.ts` | `P7_RETENTION_PERMISSIONS`, `P7_RETENTION_ROLE_PERMISSIONS`; `P7_PERMISSIONS` and `ROLES` (AUD, ADM_TECH, ADM_ACCESS) extended |
| `docs/api/openapi.yaml` | tag `retention`; 10 operations; 2 path parameters; 15 schemas; 4 `PermissionCode` values (`info.version` stays 1.6.0-p7) |
| `apps/api/test/support/p7-pending-arch-03.ts`, `p7-pending-be-g.ts` | **new.** The slice E pending list (10, owner BE-G) |
| `apps/api/test/support/p7-pending.ts`, `p7-operations.ts` | the ARCH-03 import line and operation block |
| `apps/api/test/integration/contract/contract.test.ts` | operation count pin 951 → 961 |
| `apps/api/test/support/sensitive-reference-inventory.ts` | 4 rows: both `record_key` columns (`cannot-name`, O3) and both `archive_set_key` columns (`code`) |
| `apps/api/src/modules/platform/advisory-locks.ts` (+ `.test.ts`) | 730410 `retentionRun`; 730411–730415 reserved |
| `docs/architecture/adr/ADR-0016-p2-data-model-registers-guards.md` | §6 rows 730410 and 730411–730415, plus the allocation sentence |
| `docs/architecture/p7-work-split.md` | **§E appended**; §1, §2, §A, §G, §C and §D untouched |
| `docs/architecture/erd.md` | §1ad (diagram and entity register), inserted before §2 |
| `docs/architecture/data-dictionary.md` | "P7 tables, slice E", generated from a migrated catalogue, plus the slice E functions and the two triggers on existing tables |
| `docs/analysis/permissions-matrix.md` | §31 |
| `docs/delivery/handbacks/DG7/T-DG7-ARCH-03-evidence/*` | logs, the dictionary generator and its output, migration SHA-256 |

## 2. Behaviour delivered, per requirement

These are architecture deliverables only. No route, job, script, CLI option or screen exists yet, so every row stays SPECIFIED until the implementers land. The pending list keeps the 10 unrouted operations visible to the contract test.

- **REQ-S16-024:** what is delivered:
  - **"Lists every record class"** holds by construction. 0143 maps every table, and the catalogue test fails on any unmapped table.
  - **"Archives only records past retention"** is enforced by the marker trigger and probed.
  - **"Logs each action"** is enforced by the per-action audit trigger and probed.
  - Nothing outside operational classes can be archived or purged: the CHECK and the purge function both enforce it, and the probe covers it.
  - **Not delivered:** the job, routes and screen (BE-G, FE-C).
- **REQ-S19-012:** the set, manifest, restore steps and checks R1–R9 are designed (ADR-0066). `backup_set` and its write path are built and probed.
  - **Not delivered:** the scripts, the profile and the guide (DO-F).
- **REQ-S19-013:** the dry-run mechanism, the catalogue classes and rules, and the window and rollback procedure are designed (ADR-0068).
  - **Not delivered:** `dry-run.ts`, the catalogue tool and `upgrades.md` (DO-G).
- **REQ-S20-019:** the drill, checks and timings are specified (ADR-0066 §9, §E.7, §E.9).
  - **Not delivered:** the harness (QA-A), the drill (DO-F) and the re-run (QA-C, orchestrator).

## 3. Checks actually run

**Environment:**

- Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), pnpm, offline.
- Disposable PostgreSQL **16.15** clusters through `tests/qa/support/with-pg.sh` (ports 24901, 24951, 24801), UTF8 with the C locale.
- `LC_ALL= LANG=` for the vitest runs.

### 3.1 Historical validator (start)

```text
$ node tools/gates/validate.mjs --historical --stage DG6
PASS gate DG6 (historical)
EXIT=0
```

### 3.2 Migrations apply

`with-pg.sh npx vitest run --project integration packages/db/test/integration/migrate.test.ts` exited **0**: "applied 129 migrations to a fresh database", 9/9 passed.

### 3.3 DB integration: probe and catalogue (in order, with the real failures)

- **Run 1: exit 1, 5 failed.**
  - The approved P6 trigger pin for `worker_heartbeat` now saw my `worker_heartbeat_archived_read_only`. I added that one line to the pin (O4).
  - `retention_class_guard` (a BEFORE trigger) fired before the CHECK, so the probe saw `retention_class_action_eligible` where it expected `retention_class_retain_only`. The guard now leaves non-operational classes to the CHECK.
  - `mode` has no `mth_app` grant, so the probe got 42501 rather than the trigger's constraint. The probe now expects 42501 for the app role and checks the trigger through the owner role.
  - The other two failures were consequences: a run was left active.
- **Run 2: exit 1, 2 failed.** The marker's exact-age check refused my test rows. A JavaScript `Date` drops PostgreSQL's microseconds, so `record_age_at` differed. The probe now uses whole-second synthetic ages, and the rule ("read the age as text") is in ADR-0067 §5 and §E.10.
- **Probe re-run:** exit **0**, 15/15.

### 3.4 Targeted integration (migrations and contract), the acceptance set

The command was `with-pg.sh npx vitest run --project integration` over these files:

- `packages/db/test/integration` (all);
- `apps/api/test/integration/contract`;
- `aud-write-deny.test.ts`, `kpi/kpi-aud-write-deny.test.ts`;
- `access/sensitive-reference-inventory.test.ts`, `access/sensitive-reach-sweep.test.ts`;
- `text-scan/seeded-texts.test.ts`, `identity.test.ts`;
- `hardening/route-inventory.test.ts`, `hardening/integrity-sweep.test.ts`.

**First run: exit 1, 6 failed** (`integration-targeted-run1.log`).

- **4 contract failures:** `listRetentionClasses` declared neither `400` nor cursor pagination. The pagination pin `UNPAGINATED_LISTS_AT_HEAD` is the orchestrator's (p7-plan §5.3), so I made the operation cursor-paginated (`RetentionClassPage`) instead of editing the pin.
- **2 inventory failures:** four new reference columns were unclassified. I added 4 rows; the inventory test then exited 0, 2/2.

**Final run: exit 0. 28 files and 705 tests passed** (`integration-targeted.log`). This includes:

- `contract.test.ts` (count 961) and `response-validation.test.ts`;
- `catalogue.test.ts`;
- `p7-retention-guards.test.ts` (15);
- `p7-transfer-guards.test.ts`;
- the AUD sweeps.

**After a Prettier rewrite:** Prettier rewrote three test files (formatting only) while that run was in progress. I re-ran `catalogue.test.ts`, `p7-retention-guards.test.ts` and `sensitive-reference-inventory.test.ts` afterwards: exit **0**, 3 files and 64 tests (`integration-reformatted-rerun.log`).

### 3.5 Typecheck, lint, OpenAPI lint

| Command | Exit | Tail |
| --- | --- | --- |
| `pnpm -r typecheck` (first) | 2 | `TS4111` in my probe (`s.dumpSha256` from an index signature), fixed to `s["dumpSha256"]` |
| `pnpm -r typecheck` (final; `typecheck.log`) | **0** | `apps/api typecheck: Done` |
| `pnpm lint` (`lint.log`) | **0** | `eslint . --max-warnings=0` (no findings) |
| `pnpm openapi:lint` (`openapi-lint.log`) | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 961 operations` |

### 3.6 Unit tests

- **Targeted run: exit 0.** `npx vitest run --project unit-node packages/db/src/seed.test.ts apps/api/src/modules/platform/advisory-locks.test.ts packages/db/src/migrate.test.ts` passed 3 files and 80 tests (`unit-targeted.log`).
- **Full run:** `pnpm test` (`unit-full.log`); the result is in §6.

### 3.7 Data dictionary generation

`with-pg.sh node --conditions=@mth/source docs/delivery/handbacks/DG7/T-DG7-ARCH-03-evidence/gen-dictionary.ts` exited **0**, with 6 table sections (`dictionary-section.md`). That output, minus the first line (the cluster banner), is appended to `data-dictionary.md`.

### Not run

- **Live CI:** not run (D-058).
- **Container drills:** none in this task (D-243 Q1: the orchestrator's host).
- **Implementer tests T-E1…T-E36:** none exist yet. They are specified in §E.4, not run.
- **Full integration suite:** not run in this task. ARCH-02's full run took 36 minutes and the targeted acceptance set above covers migrations and the contract.

## 4. Open questions and deviations (each quotes its source)

- **O1. BE-E needs a `copy-out` subcommand.**
  - ADR-0064 §5 gives BE-E's CLI "`copy-in`, `verify`".
  - ADR-0066 §1 copies evidence **out** for a backup set through the same CLI, so it needs `transfer-attachments copy-out --to <dir> --out <attachments.json>`.
  - I did not edit §C. Please add it to BE-E's assignment (W7, before DO-F in W8). The alternative is for DO-F to write its own copy-out, which would duplicate the port code.
- **O2. A fourth permission code, `backup.read`.**
  - p7-plan §3 seam 6 lists only "`retention.read`, `retention.configure`, `retention.run`" for this slice.
  - Backup status is not retention, so I added `backup.read` (ADM_TECH, AUD), which matches REQ-S19-012's "view:IT". Please confirm. The alternative is to gate `listBackupSets` with `retention.read`.
- **O3. Inbox notification ids in the retention lists.**
  - `listRetentionRunActions` and `listRetentionArchivedRecords` serve `record_key`, the primary key values only, to ADM_TECH, ADM_ACCESS and AUD.
  - For `inbox_read_item`, that includes inbox notification ids, and `apps/api/test/integration/tasks/inbox-restricted-z13.test.ts` restricts inbox items about restricted records. I classified the column `cannot-name`: it holds the notification's own id, never its subject or work item.
  - Please confirm under D-219's reasoning. The alternative is to omit `recordKey` for `inbox_notification` rows from AUD and ADM_ACCESS.
- **O4. Approved tables and an approved pin change additively.**
  - 0144 adds `inbox_notification_archived_read_only` and `worker_heartbeat_archived_read_only` to two DG-approved tables. Both are inert while their classes are `retain`, which is how they ship.
  - The approved P6 trigger pin in `catalogue.test.ts` (the 0101–0102 test) gains one line.
  - p7-plan §3 seam 9 says the first enabled purge class is "a **reopen candidate**, decided per class in ARCH-03's ADR". ADR-0067 §3 decides it: the code change is additive, and **enabling** a class is an operator decision with its effect stated on the screen. Please confirm, or record a DG4/DG6 reopen.
- **O5. The plan's purge candidates, narrowed.**
  - p7-plan seam 9 proposes "expired sessions, completed job history, staged import rows past commit, read inbox items, connection logs".
  - **Sessions:** they stay with the existing `platform.purge-expired` (DG1), so they are never archived; their hashes are credentials (D-243 Q16).
  - **Job history and connection-log tables:** these are append-only (`job_run`, `integration_run_event`, `outbound_write_event`), so they can be archived at most. Only `job_run` and `webhook_receipt` are archivable; the two event tables remain `business_record`.
  - **Staged import rows** (`import_row`) remain `business_record`: their commit lineage is referenced, and no age column states "past commit".
  - All of this is listed in ADR-0067 Residual 3 and §2.
- **O6. The contract shape differs from the plan's.**
  - The plan says "≈ 8 … ≈ 1–2"; the contract has **10** operations, including `listRetentionRunActions` for "logs each action".
  - The dry run is `POST /api/v1/admin/retention/dry-runs`, not `/runs/dry-run`, to avoid a path that collides with `/runs/{retentionRunId}`.
  - `listRetentionClasses` is cursor-paginated (§3.4).
- **O7. The "configuration bundle" of a backup set.**
  - The plan's ARCH-03 row says "configuration bundle".
  - ADR-0066 §3 reads it as the **deployment** configuration: Compose files, image lock, and the env file with secret values removed. Application configuration is in the database dump. It is not the ADR-0065 bundle. Please confirm.
- **O8. Migration ids.**
  - 0143–0146 are taken, and BE-G gets 0147.
  - Slice C/D implementer migrations numbered 0136–0142 that merge **after** 0143–0146 must be renumbered above 0146, because the runner refuses an id below the highest applied one (D-245 O9).
  - Each new table needs its `retention_table_class` row in its own migration. If it runs before 0143 on a fresh database, the generated insert covers it instead; the coverage test catches both cases.
- **O9. The dry run on a production-marked copy.**
  - A restored copy of production keeps the `production` marker.
  - ADR-0068 §1 requires an explicit `--i-confirm-this-is-a-restored-copy`. Please confirm the flag name, or choose another guard.
- **Arabic texts** in §E.5 and §E.6 are marked provisional (D-243 Q7).
- **Not done by design (implementers' work):** every route, the job, the scripts, the profile, `dry-run.ts`, the catalogue tool, the guides, the screen and T-E1…T-E36. The pending list holds the 10 operations, so the DG7 freeze fails until it is empty.

## 5. Merge instructions

1. Apply migrations `0143`, `0144`, `0145`, `0146` in order (`mth-db migrate`). They are additive: new tables, seed rows, functions, and two inert triggers on existing tables.
2. **Shared files** I edited:
   - `openapi.yaml`, `erd.md`, `data-dictionary.md`, `p7-work-split.md`, `permissions-matrix.md`;
   - `permissions.ts`, `schema.ts`, `seed.test.ts`, `catalogue.test.ts`;
   - `contract.test.ts` (count pin), `p7-pending.ts`, `p7-operations.ts`;
   - `advisory-locks.ts` (+ test), ADR-0016, `sensitive-reference-inventory.ts`.

   Every edit is append-only, except:
   - the contract count pin;
   - the seed numbering example (0136 → 0147);
   - the one inserted line in the P6 `worker_heartbeat` trigger pin.

   No conflict is expected, since no other run edits these files in this wave.
3. **After merge,** run: `pnpm test`, `pnpm test:integration` (full), `pnpm openapi:lint`, and `node tools/gates/validate.mjs --historical --stage DG6`.

## 6. End of run

See the lines below, appended after the last edit.

- **Full unit run:** `LC_ALL= LANG= pnpm test` exited **0** (`unit-full.log`). The three projects ran:
  - 191 files, 2,912 tests passed;
  - 125 files, 2,113 tests passed;
  - 3 files, 259 tests passed and 2 skipped. These two skips are pre-existing, not mine.
- **Prettier:** `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exited **0**, after every edit except this section (`format-final.log`). It ran 22 batches, each printing "All matched files use Prettier code style!". This handback is re-checked alone below.
- **End validator:** `node tools/gates/validate.mjs --historical --stage DG6` printed `PASS gate DG6 (historical)` and exited **0** (`validate-historical-DG6-end.log`).
- **HEAD** is still `aaaf9b6034a62b52cea5ddb9d80834ea7b9d1906`. No temporary tree remains outside `$TMPDIR`.
- **End:** `date -u` 17:44:32 UTC. That is 46 minutes from the 16:58:24 start, of the roughly 2 hours budgeted.
