# ADR-0066: P7 backup and restore: what one backup set holds, its manifest, the `backup` Compose profile on the pinned `postgres:18` image, restore into a fresh database and storage, the restore checks and timings, and recovery objectives as IT placeholders

- **Status:** Proposed for P7 (DG7). Author: solution-architect (T-DG7-ARCH-03), 2026-11-12. Base `aaaf9b6034a62b52cea5ddb9d80834ea7b9d1906` on `claude/mobily-transformation-platform-dg6-regate`.
- **Requirements (slice E of `docs/architecture/p7-plan.md`):** REQ-S19-012, REQ-S20-019. Retention (REQ-S16-024) is ADR-0067; upgrades (REQ-S19-013) are ADR-0068.
- **Sources (quoted where a design point has one):**
  - M0360 (§19 item 9): "Backup/restore procedures covering database, evidence bytes, configuration, audit and reporting snapshots; retention, restore drills and recovery objectives to be agreed with IT."
  - M0388 (§20, A19): "Restore drill recovers database, evidence, audit, snapshots and job state with documented checks and timings".
  - Acceptance texts (binding, `docs/delivery/requirements.csv`):
    - REQ-S19-012: "A19: the restore drill recovers the database, evidence, audit, snapshots and job state, with documented checks and timings". Its columns: "Backup scope;Schedule;Retention;Restore steps;RPO/RTO (to agree with IT)" and "accept:Mobily IT (external)".
    - REQ-S20-019: "A19: Restore drill recovers database, evidence, audit, snapshots and job state with documented checks and timings" (test level "ops drill").
  - Playbook: no block concerns backups. Nothing below is attributed to it.
- **Decisions applied:**
  - D-243 **Q1**: the container halves are run by the orchestrator on its host; agents build and test the container-free halves;
  - D-243 **Q14**: "same-major restore" (a cross-major restore is an IT upgrade procedure);
  - D-243 **Q16**: no credential material in any artefact;
  - D-245: the backup set reuses the ADR-0064 attachment manifest (`mth-attachment-manifest/1`, ADR-0064 §5) and its row-free manifest style;
  - p7-plan §3 seams 10 (evidence storage) and 14 (packaging: "a `backup` profile (uses the pinned `postgres:18` image already in the lock, so no new image)").
- **Builds on:** ADR-0003 ("forward-only; recovery by backup"), ADR-0004 (append-only audit), ADR-0008 (pg-boss in its own schema), ADR-0010 l.34 ("back up database and evidence"), ADR-0011 (readiness), ADR-0045 (report snapshots and their checksums), ADR-0054 (storage settings), ADR-0064 §5 (attachment manifest, BE-E's byte copy).
- **Two gate systems.** A backup set, a restore and a drill report are engineering artefacts. None of them is a business, Finance or IT approval. Recovery objectives are **placeholders for Mobily IT**: nothing here claims that IT accepted them. Nothing here reads or writes DG0–DG7.

## Context

What exists at `aaaf9b60` (read from the tree):

1. **No backup tooling.** `deploy/scripts/` has no backup, restore or drill script. `docs/handover/backup-restore.md` does not exist.
2. **State lives in two places.** The database volume `pgdata` (PostgreSQL 18 in Compose, `deploy/images.lock.json` entry `postgres`, tag `18`, digest `sha256:5a5a84b1…`) and the evidence volume `evidence` (`EVIDENCE_STORAGE_PATH=/var/lib/mth/evidence`), or an S3-compatible bucket when the storage setting says so (ADR-0054).
3. **Job state is in the database.** pg-boss keeps its queue in the `pgboss` schema (0006, ADR-0008). `job_run`, `job_schedule`, `operational_exception` and `worker_heartbeat` are public tables.
4. **Audit and snapshots are in the database.** `audit_event` is append-only (0003). Report snapshots (`report_snapshot*`, 0080, 0126) and `ranking_snapshot` carry their own content checksums.
5. **Evidence objects are immutable once written** and are never deleted by the application (ADR-0010: `delete(key)` is "reserved for an approved retention job only", and ADR-0067 never purges an evidence-bearing class).
6. **Local verification uses PostgreSQL 16** (`/usr/lib/postgresql/16`, `tests/qa/support/with-pg.sh`). Compose pins 18.

## Decision

### 1. One backup set

```text
<backup-root>/<label>/
  backup-manifest.json        the set's manifest (§2), schemaVersion "mth-backup/1"
  db/database.dump            pg_dump custom format (-Fc) of the whole database, including the pgboss schema
  db/table-counts.tsv         "<schema>.<table>\t<rows>" for every base table, taken in the dump's snapshot
  evidence/attachments.json   the ADR-0064 attachment manifest (mth-attachment-manifest/1)
  evidence/attachments/<sha256>   one file per distinct evidence object (ADR-0064 §5)
  evidence/retention/<runId>/...  the retention archive sets of ADR-0067 §5 (objects outside evidence_content)
  config/                     the deployment configuration bundle (§3), never a secret value
```

- `<label>` is `mth-<UTC yyyymmddThhmmssZ>` unless the operator gives one (`^[a-z0-9][a-z0-9._-]{0,99}$`, 0145 CHECK).
- **Database.** `pg_dump --format=custom --no-password` of the whole database as the owner role. It covers every business record, `audit_event`, the snapshots, the configuration tables and the job state (`pgboss.*`, `job_run`, `job_schedule`). The row counts in `table-counts.tsv` are taken in the same snapshot: the script opens a `REPEATABLE READ` transaction, calls `pg_export_snapshot()`, runs the counts in it and passes the id to `pg_dump --snapshot=<id>`. So counts and dump are consistent.
- **Evidence.** The dump comes first, then the evidence copy. Evidence objects are immutable and never deleted (Context 5), so every object a dumped row names still exists when it is copied. The copy can be a superset (objects written after the snapshot), never a subset. The copy and the manifest use BE-E's `apps/api/src/cli/transfer-attachments.ts` (ADR-0064 §5) through the port, so both adapters (filesystem, S3) work the same way. It needs a `copy-out` subcommand beside `copy-in` and `verify` (§9 and handback O1). Retention archive sets (ADR-0067 §5) live in the store but no `storage_key` column names them, so they are copied from the `retention_run.archive_set_key` rows and the files listed in each set's manifest, each verified by SHA-256.
- **Migration exports** (`transfer/migration-exports/**`, ADR-0064 §1) are not copied. They are regenerable packages, not state.

### 2. The manifest (`backup-manifest.json`, `mth-backup/1`)

| Field | Content |
| --- | --- |
| `schemaVersion` | `mth-backup/1`. A restore refuses any other value. |
| `label`, `startedAt`, `finishedAt` | UTC ISO 8601 |
| `release` | the release version from the archive manifest of the running images (ADR-0062 §2), passed by the operator with `--release`; `"unknown"` when not given (never guessed) |
| `migrationLevel` | the last applied migration (`<id>_<name>`), from `schema_migration` |
| `server` | `{ "version": "18.x", "major": 18 }` from `server_version` / `server_version_num` |
| `client` | `{ "pgDump": "<pg_dump --version>" }` |
| `database` | `{ "file": "db/database.dump", "format": "custom", "bytes", "sha256", "tableCounts": { "file": "db/table-counts.tsv", "sha256" }, "auditEvents": { "count", "maxSeq" }, "snapshotDigest", "pgbossJobsByState": { "<state>": n } }`. `snapshotDigest` is the SHA-256 of the text output of `SELECT t::text FROM <table> t ORDER BY <primary key>` over the six snapshot tables of ADR-0067 §3, in that order, taken in the dump snapshot |
| `evidence` | `{ "backend": "filesystem" \| "s3", "attachmentManifest": { "file", "sha256", "count", "bytes" }, "retentionSets": [{ "runId", "manifestSha256", "files", "bytes" }] }` |
| `config` | `{ "files": [{ "path", "sha256" }], "sha256" }` (§3) |
| `checks` | the backup-time checks (§4) and their results |
| `timings` | seconds per step: `snapshot`, `dump`, `evidence`, `config`, `verify` |

- Every `sha256` is lowercase hex over the file bytes. The manifest itself is written last, and its own SHA-256 is printed and recorded in `backup_set.manifest_sha256` (§6). It never contains its own hash.
- The manifest holds counts and checksums only: no row data, no evidence content, no credential.

### 3. The deployment configuration bundle (`config/`)

- The Compose files in use, `deploy/images.lock.json` and the environment file **with every secret value removed**. Keys are kept; `*_FILE` pointers are kept (they are paths); any other value of a key the ADR-0063 secret scan classifies as a secret is replaced by `<removed>`.
- It is distinct from the ADR-0065 configuration bundle. Application configuration (methodology, forms, formulas, branding, schedules) is in the database dump.
- Secrets (database passwords, the session key, OIDC client secret, S3 keys) are **not** in a backup set (D-243 Q16). They are IT's, in IT's secret store. The restore guide lists them by name as preconditions.

### 4. Backup-time checks

The script fails the set (status `failed`, reason given) unless all hold:

1. `pg_dump` exited 0 and `pg_restore --list db/database.dump` reads the archive.
2. The `pg_dump` major is at least the server's major (a newer client can dump an older server; never the reverse).
3. `transfer-attachments verify` over the copied set reports 0 missing, 0 size and 0 SHA-256 mismatches.
4. Every retention set file matches its SHA-256.
5. Every file listed in the manifest exists and matches its SHA-256.

### 5. The `backup` Compose profile (seam 14)

- A service `backup` in `deploy/compose/compose.yaml` under `profiles: ["backup"]`, on the **already pinned** `postgres:18` image (same digest; no new image). It runs `deploy/scripts/backup.sh` mounted read-only, with the owner database URL as a Compose secret and `<backup-root>` as a bind mount the operator chooses.
- The evidence step runs `transfer-attachments` in the API image (already pinned) as a one-off `docker compose run --rm --no-deps api node …`, with the evidence volume and `<backup-root>` mounted.
- **Schedule.** The platform does not schedule its own backup: a backup must run outside the system it protects. The guide gives a host cron or IT-scheduler example (`docker compose --profile backup run --rm backup`). The cadence is IT's.
- **Retention of backup sets** is IT's. The script never deletes a set; the guide shows how to prune by label age.
- The production service set is unchanged; the profile is off by default.

### 6. Reporting a set to the installation (`backup_set`, 0145)

- After the checks, the script calls `SELECT backup_set_record($1::jsonb)` as the owner role with the set's summary: the fields `id, label, status, manifestSchemaVersion, startedAt, finishedAt, migrationLevel, serverMajor, dumpFormat, dumpBytes, dumpSha256, evidenceBackend, evidenceObjectCount, evidenceBytes, attachmentManifestSha256, configBundleSha256, manifestSha256, failureReason, operatorName`. Unknown keys are refused. The function inserts the row and its `backup.recorded` audit event in one transaction. A failed set is recorded too, with its reason.
- `mth_app` cannot call the function and has SELECT only. `listBackupSets` (`backup.read`; ADM_TECH, AUD) shows the sets. The API never starts a backup or a restore.
- The row is written after the dump, so a set never lists itself. Restoring an older set restores the `backup_set` rows as they were then (Residual 2).

### 7. Restore into a fresh database and storage

`deploy/scripts/restore.sh --from <backup-root>/<label> --target <fresh project>`:

1. **Package checks.** `schemaVersion` = `mth-backup/1`, else exit 2. Every file SHA-256 matches the manifest, and the manifest SHA-256 matches the value IT gives with `--manifest-sha256` (or the `backup_set` row it reads from the source when reachable), else exit 2 naming the file.
2. **Same major (D-243 Q14).** The target server's major must equal `server.major`, else exit 2 with `restore: refused: backup is from PostgreSQL <m>, target is <n>; a cross-major restore is an upgrade (dump with the newer client), see upgrades.md`.
3. **Fresh target only.** The target database must have no table in `public` and no `pgboss` schema, and the target evidence store must be empty, else exit 2. A restore never overwrites.
4. **Roles first.** The target cluster has `mth_owner` and `mth_app` (the existing `deploy/compose/db-init`). `pg_restore --exit-on-error --single-transaction --no-owner --role=mth_owner` keeps every GRANT, so `mth_app` has exactly the dumped privileges.
5. **Evidence.** `transfer-attachments copy-in` writes every object under its **same name** and verifies it (ADR-0064 §5); the retention sets are copied back under `retention/<runId>/`.
6. **Checks** (§8). Any failed check exits 1 and leaves the target for inspection; nothing is started.
7. **Start.** `migrate` (reports "up to date"; it never runs a migration on a restore), then `api` and `worker`. `/readyz` must be ready.
8. **Report.** `restore-report.json` with every check, its expected and actual value, and the seconds of every step.

### 8. Restore checks (A19 "documented checks")

| Check | Expected | Proves |
| --- | --- | --- |
| R1 manifest and file SHA-256 | all equal | the set is intact |
| R2 migration level | equals `migrationLevel`; `mth-db status` up to date | database schema |
| R3 per-table row counts | every line of `table-counts.tsv` equal | database |
| R4 audit | `audit_event` count and `max(seq)` equal `database.auditEvents` | audit |
| R5 snapshots | `report_snapshot*` and `ranking_snapshot` counts equal (in R3), and `snapshotDigest` recomputed on the target is equal, so every snapshot row (including `report_snapshot_version.content_sha256`) is byte-equal | snapshots |
| R6 job state | `pgboss.job` counts by state equal `pgbossJobsByState`; `job_schedule` rows (including `enabled`) and `job_run` counts equal | job state |
| R7 evidence | `transfer-attachments verify` on the target: 0 missing, 0 size and 0 SHA-256 mismatches against `attachments.json`; every retention set file matches | evidence bytes |
| R8 readiness | `/readyz` ready (database and storage; ADR-0011 as extended by seam 1) | the restored installation runs |
| R9 demo checksum (drill only) | the ADR-0050 demo checksum of the restored demo equals the source's | business content, end to end |

### 9. The A19 drill (`deploy/scripts/restore-drill.sh`) and its timings

- **Steps:** start the demo installation (synthetic data) → `backup.sh` → a fresh Compose project (new project name, new volumes) → `restore.sh` → checks R1–R9 → `drill-report.json`.
- **Timings:** seconds for backup (per step), transfer of the set, restore (per step), checks and time to ready. These are **measured drill timings**, not recovery objectives.
- **Recovery objectives (RPO/RTO).** Placeholders: "to agree with Mobily IT". The guide shows the measured drill timings beside them and states that the RPO equals the backup cadence IT chooses.
- **Where it runs (D-243 Q1).** The container half (Compose backup, restore and the full drill) runs on the orchestrator's host, with logs committed as orchestrator evidence. The container-free half runs in an agent sandbox: `backup.sh` and `restore.sh` against a disposable local PostgreSQL 16 cluster (`with-pg.sh`) and a filesystem evidence directory, backing up and restoring into the **same major** (Q14). QA-A writes the A19 harness test-first; QA-C re-runs it on the DG7 candidate.

### 10. Who builds it, and how it is tested

| Task | Builds | Tests (each proves) |
| --- | --- | --- |
| DO-F | `deploy/scripts/{backup,restore,restore-drill}.sh` (+ `deploy/scripts/tests/`), the `backup` profile, `docs/handover/backup-restore.md` | §E.4 T-E1…T-E9: set layout and manifest; snapshot-consistent counts; secret values absent from `config/`; corrupted file → exit 2; cross-major → exit 2; non-empty target → exit 2; R1–R8 on a local restore; failed set recorded with reason; `backup_set_record` call shape |
| BE-E | `transfer-attachments copy-out` (beside `copy-in`, `verify`) | copy-out then copy-in round-trip on both adapters; missing and altered objects reported, never skipped |
| BE-G | `listBackupSets` | §E.4 T-E20: 403 for every role without `backup.read`; no content, newest first |
| QA-A / QA-C | `tests/qa/integration/a19-*.test.ts` | A19 on the candidate, with timings |
| orchestrator | the container drill on its host | R1–R9 in Compose with the pinned images |

The database half is already probed: `packages/db/test/integration/p7-retention-guards.test.ts` "0145 backup_set" (owner-only write, audited, unknown key refused, incomplete set refused).

## Consequences

- Positive: one documented set that covers every scope M0360 names, checked on restore against counts and checksums taken at backup time. It reuses the pinned images and the ADR-0064 attachment manifest.
- Positive: a restore never overwrites, never crosses majors silently and never starts an installation that failed a check.
- Negative: `pg_dump` takes a consistent snapshot but the application keeps running; evidence written after the snapshot is copied as a harmless superset. For a strictly quiet set, the guide offers stopping `api` and `worker` first.
- Negative: an S3 bucket's own versioning or replication is IT's. The script copies objects out through the port; for large buckets this is slow.

## Residuals (honest)

1. **RPO/RTO are not set.** They are placeholders for IT; only measured drill timings exist.
2. **`backup_set` after a restore** shows the sets known when the restored set was taken, not later ones. The guide says so.
3. **Scale is unproven** beyond the demo and the P6 fixtures; no timing is claimed for production volumes.
4. **Secrets are not backed up** by design. A restore needs IT to provide them again; the guide lists them by name.
5. **Point-in-time recovery** (WAL archiving) is not built. It is an IT database-platform option, noted in the guide.
6. **The S3 path of the drill** is proven against the fake S3 of the P6 contract kit only (D-049/D-057 live residuals).

## Alternatives considered

1. **A file-level copy of the `pgdata` volume.** Rejected: it needs the database stopped, ties the set to the exact server build, and cannot be checked table by table.
2. **The ADR-0064 migration package as the backup.** Rejected: it excludes sessions and the replay cache (fine) but also needs the same release and an empty target, and it rewrites SecretRefs to `unbound`, so a restored installation would not run. It stays the transfer tool; the backup reuses its attachment manifest.
3. **An in-app backup job.** Rejected: a backup must run outside the system it protects, and the app role must not read the whole database.
4. **A new backup image** (for example a dedicated backup tool). Rejected: no new runtime dependency; `postgres:18` already has `pg_dump`, `pg_restore`, `psql` and `sha256sum`.

## Version evidence (M0314)

No new dependency and no new image. `pg_dump`/`pg_restore` custom format, `pg_export_snapshot()` with `pg_dump --snapshot` and `--single-transaction` restores are PostgreSQL features present in the SQL floor (16) and in the pinned `postgres:18` image (lock digest `sha256:5a5a84b1…`, verified 2026-10-01 by `pin-images.mjs`). The guard probe of `backup_set` ran on PostgreSQL 16.15 (handback §3).
