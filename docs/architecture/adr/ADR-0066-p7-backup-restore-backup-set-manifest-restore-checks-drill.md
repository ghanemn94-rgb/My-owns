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

The script fails the set (status `failed`, reason given) unless all hold. _Amended by Amendment 1 (A1.1, A1.2): the checks as built, their manifest ids, the new seventh check `ownerOnly`, and where item 3 runs in the Compose sequence._

1. `pg_dump` exited 0 and `pg_restore --list db/database.dump` reads the archive.
2. The `pg_dump` major is at least the server's major (a newer client can dump an older server; never the reverse).
3. `transfer-attachments verify` over the copied set reports 0 missing, 0 size and 0 SHA-256 mismatches.
4. Every retention set file matches its SHA-256.
5. Every file listed in the manifest exists and matches its SHA-256.

### 5. The `backup` Compose profile (seam 14)

- A service `backup` in `deploy/compose/compose.yaml` under `profiles: ["backup"]`, on the **already pinned** `postgres:18` image (same digest; no new image). It runs `deploy/scripts/backup.sh` mounted read-only, with the owner database URL as a Compose secret and `<backup-root>` as a bind mount the operator chooses. _Amended by Amendment 1 (A1.3, A1.4): the set is owner-only; a root that group or others can write is refused, and a symbolic link is judged by its target; `MTH_BACKUP_ROOT` is required, with no `/tmp` fallback._
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

## Amendment 1 (2026-11-17, T-DG7-SA-ADR72): §4 the backup-time checks as built and the `ownerOnly` check; §5 the owner-only set, the refused shared backup root (a symbolic link judged by its target) and the required `MTH_BACKUP_ROOT` (F-DG7-1032, F-DG7-1041, F-DG7-1052; F-DG7-1012, F-DG7-1053)

- **Author:** solution-architect (T-DG7-SA-ADR72). Base `faa1154ca9d15e160bf39f5a2a0df575ec1bf133` on `claude/mobily-transformation-platform-dg7-regate`.
- **Why.**
  - T-DG7-DO-D11 repaired F-DG7-1012. A backup set was written world-readable, and the Compose `backup` profile fell back to the host's `/tmp`.
    - The repair added a sixth backup-time check, `ownerOnly`.
    - It refuses a backup root that group or others can write.
    - It requires `MTH_BACKUP_ROOT` in Compose.
  - DO-D11 asked whether §4 should list the new check (`docs/delivery/handbacks/DG7/T-DG7-DO-D11-devops-engineer.md` §5 Q2).
  - In round 2 of the clean re-gate, all three reviewers raised the drift: F-DG7-1032 (domain), F-DG7-1041 (code-security) and F-DG7-1052 (qa).
  - The qa-verifier also raised F-DG7-1053. A backup root given as a symbolic link to an owner-only directory was refused, because the script tested the link's own mode. T-DG7-DO-D12 repairs it. The rule in A1.3 item 3 is the rule DO-D12 implements.
  - The carried rule "ADR claims enumerated and exactly true" (p7-work-split §2 rule 2) requires §4 and §5 to state the behaviour as built.
- **What this amendment does.**
  - It records the following as built:
    - `deploy/scripts/backup.sh` (`backup_main`, `backup_owner_only`, `backup_finish_phase`, `backup_fail`);
    - the `backup` service of `deploy/compose/compose.yaml`;
    - `deploy/scripts/tests/backup-restore.test.mjs` (T-E1 to T-E13).
  - It changes no code, no test and no guide text.
  - **The dependency on DO-D12.** At this amendment's base, `backup.sh` still judged a symbolic-link root by the link's own mode (F-DG7-1053). DO-D12 changes this in the same integration. Its tests are T-E13a to T-E13d, and `docs/handover/backup-restore.md` §3.3 already describes the change. A1.3 item 3 is exact only when DO-D12's change is merged. If DO-D12 is not merged, A1.3 item 3 is the open rule F-DG7-1053 requires, and the code does not meet it.
- **What it replaces.** Each replaced place carries a pointer here:
  - the five-item list of §4 (A1.1, A1.2);
  - the `<backup-root>` sentence of §5, which A1.3 and A1.4 extend.
- **Unchanged.**
  - The set layout (§1), the manifest fields (§2), the configuration bundle (§3), `backup_set_record` and its 19 keys (§6), the restore and its checks R1–R9 (§7, §8), the drill (§9), the migrations, the OpenAPI contract and the image lock. No new dependency and no new image.
  - The restore checks do **not** gain an `ownerOnly` check. Restore reads a set and does not judge its modes. Keeping the modes when a set is copied is IT's (`backup-restore.md` §3.3, last item). This answers the second half of DO-D11 §5 Q2: §7 of the guide stays as it is.
- **Two gate systems.** A backup set, its checks and this amendment are engineering artefacts. None of them is a business, Finance or IT approval. Recovery objectives stay IT placeholders (§9).

### A1.1 The backup-time checks as built (replaces the §4 list)

The script runs the checks in `--phase finish`, which is also the last part of `--phase all`. The manifest's `checks` lists them in this order, each as `{ "id", "result": "PASS" }`:

| # | `id` | Check | §4 item |
| --- | --- | --- | --- |
| 1 | `dumpReadable` | `pg_dump` exited 0 in the database phase, and `pg_restore --list db/database.dump` reads the archive | 1 |
| 2 | `clientMajorAtLeastServer` | the `pg_dump` major is at least the server's major | 2 |
| 3 | `evidenceVerified` | `transfer-attachments verify` over the copied set reports no mismatch. **Recorded only when `backup.sh` can run `transfer-attachments` itself** (A1.2) | 3 |
| 4 | `evidenceFilesMatchNames` | every file under `evidence/attachments/` has the SHA-256 that is its name | 3 (the script's own half) |
| 5 | `retentionSetsMatch` | every retention archive set named by `retention_run.archive_set_key` exists in the store, and its manifest matches `retention_run.archive_set_sha256`. Every one of its files matches the store copy | 4 |
| 6 | `everyFileMatches` | every file of the set except the manifest and `.backup-state/` is hashed, then re-read, and each SHA-256 still matches | 5 |
| 7 | **`ownerOnly`** (new, F-DG7-1012) | the script first removes every group and other permission bit from the set (`chmod -R go-rwx`). The check then fails if any path in the set, `.backup-state/` included, still has a group or other bit (`find -perm /077`) | — (new) |

- **A failed check fails the set.** The script calls `backup_fail`, which:
  - records the set as `failed` with the reason through `backup_set_record`, when the database answers (§6; T-E8);
  - prints `backup: set <label> failed: <reason>`;
  - exits 1.

  The manifest is written only after all the checks pass (§2: "written last"). A failed set therefore has no `backup-manifest.json`, and a manifest never lists a failed check.
- The `ownerOnly` failure reason is `the set is readable by group or others: <paths>`. In practice it fires only when a bit survives the `chmod`, for example on a file system that ignores modes, or when a file is added to the set after the `chmod` by another process. The `chmod` failure has its own reason: `cannot make the set owner-only: <error>`.

### A1.2 Where the store-side evidence verification runs

- **`--phase all`, outside Compose.** `backup.sh` runs `transfer-attachments` itself, either `node` on the repository's CLI or the command in `MTH_TRANSFER_ATTACHMENTS`. It does the copy-out and then the `verify` of check 3.
- **The Compose sequence.** The `backup` service runs on `postgres:18`, which has no `node`, so the service sets `MTH_TRANSFER_ATTACHMENTS=none`.
  - The evidence copy-out is step 2 of `backup-restore.md` §3.2. It runs in the pinned app image, and it fails on any object that is missing or differs from the store.
  - `--phase finish` then records checks 4 to 7 but **not** check 3.
  - So in this sequence, §4 item 3 is met by the copy-out of step 2 together with check 4, not by an `evidenceVerified` entry. A manifest from the Compose sequence has six entries in `checks`, and one from `--phase all` has seven.

### A1.3 Owner-only set and backup root (extends §5)

1. **The set is owner-only.** `backup_main` sets `umask 077`. It does this in `backup_main` and not at the top of the file, so `restore.sh`, which sources the helpers, keeps its own umask.
   - The set's directories are created and then set to `0700`, and every file is written `0600`. This covers `db/database.dump`, `.backup-state/` and the `--record-out` file.
   - `backup_owner_only` removes every group and other bit after the database phase. It does so again in `--phase finish`, because the Compose copy-out of step 2 runs in another container with its own umask.
   - Tests: T-E10, a set taken under umask 022 is owner-only, and T-E11, the three-step sequence with a copy-out under umask 022 ends owner-only. Both check `ownerOnly` in the manifest.
2. **A shared backup root is refused.** The script checks this before it reads `DATABASE_URL`, so the refusal needs no database.
   - The script refuses (exit 2) an existing root that group or others can write (`find -perm /022`), such as `/tmp` (mode `1777`), with `BLOCKED: the backup root <root> is writable by group or others; use an owner-only directory (chmod 0700)`. Nothing is written in the root.
   - It refuses an existing root that is not a directory (exit 2).
   - It creates a missing root with mode `0700`, because of the umask.
   - Test T-E12 covers modes `1777` and `0770`.
   - A root that only group or others can **read** (for example `0755`) is accepted. The set inside it is `0700`.
3. **A root given as a symbolic link is judged by its target** (F-DG7-1053, built by T-DG7-DO-D12).
   - When the root is a symbolic link, the script resolves it with `readlink -e`, through a chain of links too. It applies item 2 to the **resolved target**, not to the link's own mode, which is always `lrwxrwxrwx` on Linux.
   - An owner-only target directory is accepted, and the set is then written through the resolved path. So the directory that was checked is the one written to, even if the link is re-pointed during the run.
   - These targets are refused with exit 2, and nothing is created:
     - a target that group or others can write, with `BLOCKED: the backup root <link> is a symbolic link to <target>, which is writable by group or others; use an owner-only directory (chmod 0700)`;
     - a target that does not exist or cannot be resolved (a dangling link);
     - a target that is not a directory.
   - Tests: T-E13a (a link and a chain of two links to a `0700` directory are accepted), T-E13b (links to `1777` and `0770` targets are refused, naming the target), T-E13c (a dangling link) and T-E13d (a link to a regular file).
4. **Only the root is judged, not its ancestors.** Item 2 is checked on the root, or on its resolved target, only. A path whose parent directories are links is resolved by the operating system as usual. A parent directory that others can write is not detected. This is residual 7 (A1.5).

### A1.4 The Compose `backup` service: `MTH_BACKUP_ROOT` is required (replaces "a bind mount the operator chooses" in §5)

- `/backups` is a long-syntax bind mount with `source: "${MTH_BACKUP_ROOT:-/MTH_BACKUP_ROOT-is-not-set}"` and `bind: { create_host_path: false }`. There is no fallback to the host's `/tmp`.
- An unset `MTH_BACKUP_ROOT` names a host path that does not exist, and so does a missing directory. Docker then refuses the mount, so the run stops before any backup.
- `${MTH_BACKUP_ROOT:?}` is deliberately not used. Compose interpolates the whole file, so it would also stop `up` for every other profile.
- The guide tells IT to create the root once, owner-only: `install -d -m 0700 -o root -g root <root>` (`backup-restore.md` §3.2, §3.3).
- The service's set is owned by root. Step 2 of the Compose sequence therefore runs the app image as root (`--user 0:0`) for the copy-out command only, so that it can write into the set (DO-D11 §4 item 2). _Amended by Amendment 2 (A2.2): step 2 also adds `--cap-add DAC_READ_SEARCH` and reads the URL through `DATABASE_URL_FILE`; the `backup` service mounts the repository layout under `/mth/deploy` (A2.1)._
- **Verification status.** T-DG7-DO-D11's static test in `tools/release/tests/service-list.test.mjs` pins the mount's shape: one `/backups` bind, `create_host_path: false`, no `/tmp` and no `:?`. The Compose run itself was not executed in an agent sandbox, because there is no Docker daemon (D-243 Q1). This covers the refusal of an unset root, the root-owned `0700`/`0600` set, and step 2 with `--user 0:0`. It is the orchestrator's host run (D-283; F-DG7-1031/1051), and this amendment claims no result for it. _Superseded by Amendment 2 (A2.6): the orchestrator ran the Compose sequence on its host; rg3 failed at C3 and rg3b passed C0 to C11, with the limits A2.6 states._

### A1.5 Residuals added (extends the Residuals section)

7. **The ancestors of the backup root are not checked** (A1.3 item 4). An account that can write a parent directory could rename the root and put another in its place between runs. IT owns the host's directory tree, so the guide gives `/srv/mth-backups`, created by root.
8. **The `ownerOnly` check covers modes, not ACLs or the owner's identity.** A POSIX ACL that grants another account access, or a root owned by a different account, is not detected. Keeping the set's permissions when it is copied off the host is IT's (`backup-restore.md` §3.3).
9. **The Compose half of the owner-only and root rules is unverified here** (A1.4). It depends on the orchestrator's host run. _Replaced by residual 9 of Amendment 2 (A2.8)._

## Amendment 2 (2026-11-24, T-DG7-SA-ADR73): the Compose sequence as built after T-DG7-DO-D13 (the `/mth/deploy` layout of the `backup` service, the step-2 `CAP_DAC_READ_SEARCH` grant and `DATABASE_URL_FILE` read), the answer to DO-D13 Q2, and the Compose run's real status (F-DG7-1073, F-DG7-1083)

- **Author:** solution-architect (T-DG7-SA-ADR73). Base `ef91b97d7068206aa4e1f0473b9671d1973b2afa` on `claude/mobily-transformation-platform-dg6-regate`.
- **Why.**
  - Amendment 1 (SA-ADR72, `bf5bf82a7`) was written before T-DG7-DO-D13 (`ebe11c378`). DO-D13 changed the Compose sequence in three places that A1.4 does not state. Its handback says so itself (`docs/delivery/handbacks/DG7/T-DG7-DO-D13-devops-engineer.md` §4 gap 3) and asks the architect a question (§5 Q2).
  - In round 3 of the re-gate, two reviewers raised the drift: F-DG7-1073 (code-security) and F-DG7-1083 (qa). The rule is the one Amendment 1 applied: ADR claims enumerated and exactly true (p7-work-split §2 rule 2).
  - A1.4 "Verification status" says the Compose run "was not executed". It was executed later, by the orchestrator on its host (D-284): run `compose-backup-rg3` failed and run `compose-backup-rg3b` passed. A1.4 is therefore out of date.
- **What this amendment does.**
  - A2.1 to A2.3 record as built: the `backup` service of `deploy/compose/compose.yaml`, the preflight in `deploy/scripts/backup.sh`, §3.2 step 2 of `docs/handover/backup-restore.md`, step C4 of `deploy/scripts/drill/compose-backup-drill.sh` and the `copy-out` database URL rule of `apps/api/src/cli/transfer-attachments.ts`.
  - A2.4 answers DO-D13 Q2, and A2.5 answers DO-D13 Q3.
  - A2.6 replaces the "Verification status" bullet of A1.4 with what the two host runs prove and what they do not prove.
  - A2.7 records the follow-on change that T-DG7-DO-D14 is assigned to make. This amendment claims no result for it.
  - It changes no code, no test, no guide text, no migration, no OpenAPI contract and no image lock. No new dependency and no new image.
- **What it replaces.** Each replaced place carries a pointer here:
  - in A1.4, the bullet "The service's set is owned by root. Step 2 … runs the app image as root (`--user 0:0`) for the copy-out command only" (A2.2 adds the capability and the URL rule);
  - in A1.4, the "Verification status" bullet (A2.6);
  - residual 9 of A1.5 (A2.8).
- **Unchanged.** The set layout (§1), the manifest fields (§2), the restore and its checks R1 to R9 (§7, §8), the container-free drill (§9), Amendment 1's checks (A1.1, A1.2) and the owner-only rules (A1.3).
- **Two gate systems.** These are engineering artefacts. A local Compose drill on synthetic data approves nothing. None of this is a business, Finance or IT approval, and recovery objectives stay IT placeholders (§9).

### A2.1 Where the `backup` service finds its files (extends §5 and A1.4)

- `backup.sh` derives the repository root from its own path, two directories up (`MTH_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"`). It reads `$MTH_REPO/deploy/compose/compose.yaml`, `$MTH_REPO/deploy/compose/.env` (when present) and `$MTH_REPO/deploy/images.lock.json` for `config/` (§3).
- The service therefore mounts the repository's files read-only in the repository's own layout under `/mth`, so that `MTH_REPO` is `/mth`:

  | Host path (relative to `deploy/compose/`) | Container path | Mode |
  | --- | --- | --- |
  | `../scripts/backup.sh` | `/mth/deploy/scripts/backup.sh` (also the entrypoint: `bash /mth/deploy/scripts/backup.sh --out /backups`) | `ro` |
  | `.` (the whole Compose directory) | `/mth/deploy/compose` | `ro` |
  | `../images.lock.json` | `/mth/deploy/images.lock.json` | `ro` |
  | volume `evidence` | `/var/lib/mth/evidence` | `ro` |
  | `${MTH_BACKUP_ROOT}` (A1.4) | `/backups` | read-write, `create_host_path: false` |

- The whole Compose directory is mounted, not single files. A single-file bind of a missing `.env` would make Docker create a directory in its place.
- **Preflight.** In `--phase all` and `--phase database`, a missing Compose file or `--env-file` is refused **before anything is written**, with `BLOCKED: the Compose file <path> does not exist (repository root resolved to <MTH_REPO> from <script>; …)` (exit 2). No half set is left behind, and the label stays free for the next run. The check inside the database phase is kept as a backstop.
- **The defect this fixes** (rg3, A2.6): the script was mounted at `/mth/scripts/backup.sh`, one level too shallow. The root resolved to `/`, the database phase failed on `//deploy/compose/compose.yaml`, and `images.lock.json` would have been left out of `config/` without an error, because its copy is guarded by a file test.
- **Tests:** `deploy/scripts/tests/backup-compose-layout.vitest.mjs` (12 Docker-free tests in `pnpm test`). It rebuilds the service's binds from `compose.yaml` in a temporary container root and checks that `MTH_REPO` is `/mth` and that the Compose and lock files are found. It checks the preflight against the old layout (exit 2, nothing written). DO-D13 log 03: the same file fails 8 of 12 against the files before the fix.

### A2.2 Step 2 of the Compose sequence as built (replaces the A1.4 bullet on `--user 0:0`)

Step 2 (`backup-restore.md` §3.2; drill step C4) is one `docker compose run` of the `api` service:

```text
docker compose -f deploy/compose/compose.yaml run --rm --no-deps -v "$MTH_BACKUP_ROOT:/backups" --user 0:0 \
  --cap-add DAC_READ_SEARCH -e DATABASE_URL_FILE=/run/secrets/database_url --entrypoint node api \
  /app/apps/api/dist/cli/transfer-attachments.js copy-out --to "/backups/$LABEL/evidence" \
  --out "/backups/$LABEL/evidence/attachments.json" --export-id "$ID"
```

- **`--user 0:0`** (unchanged from A1.4): the set is root-owned and `0700` (A1.3), so only root can write into it.
- **`--cap-add DAC_READ_SEARCH`** (new, DO-D13): the `api` service keeps `cap_drop: ["ALL"]`, `read_only: true` and `no-new-privileges:true`. The image creates the evidence store `/var/lib/mth/evidence` as `mth:mth` (uid 10001) with mode `0700` (`deploy/docker/Dockerfile`). Root with no capability cannot list or read that directory, so before DO-D13 the copy-out would have failed with `EACCES` on the store. The added capability gives back only the right to read files and to list and search directories the account does not own. It is **not** `CAP_DAC_OVERRIDE`, so this command cannot write into the store or change it. Root writes into its own set as the owner, which needs no capability.
- **`-e DATABASE_URL_FILE=/run/secrets/database_url`** with **`--entrypoint node`**: the entrypoint bypasses the image's `mth` dispatcher, so the CLI must read the URL from the Compose secret file itself (A2.3).
- The flags are scoped to this one command. The long-running `api` and `worker` services are unchanged: no capability, uid 10001.
- **Tests:** `backup-compose-layout.vitest.mjs` checks that the guide and drill step C4 carry the same flags (`--user 0:0`, `--cap-add DAC_READ_SEARCH`, `DATABASE_URL_FILE`) and that the Dockerfile and `cap_drop` facts above hold.

### A2.3 `transfer-attachments copy-out` reads `DATABASE_URL` or `DATABASE_URL_FILE`

- `copy-out` reads the database URL through `@mth/config` `readSecretVariable("DATABASE_URL")`. This is the ADR-0011 `<NAME>_FILE` rule the API already follows. Before DO-D13 it read only `DATABASE_URL`, so step 2 would have stopped with `BLOCKED: transfer-attachments copy-out: DATABASE_URL is not set` (exit 2).
- Both variables set, or a file that cannot be read, is BLOCKED with exit 2. The message names the variable and never the value. With neither set, the message is still `DATABASE_URL is not set` (exit 2).
- The rule covers `copy-out` only, the one subcommand that reads the database. `copy-in` and `verify` read the store and a manifest.
- **Tests:** `apps/api/test/integration/transfer/attachments.test.ts` covers an unreadable file and both forms set (exit 2), and T-C16 (copy-out through `DATABASE_URL_FILE`, the same manifest items). In `deploy/scripts/tests/backup-restore.test.mjs`, T-E11 runs the three-step sequence with `DATABASE_URL_FILE` (a `0600` file) and an empty `DATABASE_URL`.

### A2.4 DO-D13 Q2: is `CAP_DAC_READ_SEARCH` the least privilege for step 2? Accepted, with one disclosed residual

**Decision.** `--user 0:0` plus `--cap-add DAC_READ_SEARCH`, for the one-off copy-out command only, is accepted as the least privilege that meets both needs of step 2 without changing the ownership model of A1.3:

- (a) write into a root-owned `0700` set;
- (b) read a store owned by uid 10001 with mode `0700`.

**Alternatives judged.**

| # | Alternative | Why not |
| --- | --- | --- |
| 1 | Run as uid 10001 with no capability | It meets (b) but not (a). Meeting (a) would mean making the set, or a directory inside it, writable by the application account. Then a compromised API or worker, which runs as that account, could read or alter backups. A1.3 keeps the set away from the application account on purpose. |
| 2 | `--cap-add DAC_OVERRIDE` (or root with Docker's default capabilities) | Strictly broader: it also lets the command write, replace and delete any file in the store. Step 2 only reads the store. |
| 3 | A store-readable group (store `0750` with a shared group, and `--group-add` on step 2) | The image has no such group today (DO-D13 Q2). It is a lasting change: the store's mode would widen for every container that joins the group, and the adapter's file modes would have to follow. Step 2's capability lasts for one command. This needs an image and adapter change, which is out of scope for this release's repair. |
| 4 | Copy out as uid 10001 into a staging directory outside the set, then move it into the set as root | It avoids the capability, but adds a second copy and a directory the application account can write on the backup host. That breaks the guarantee of A1.3 that only the set's owner has touched its content. DO-D13 §4 gap 2 keeps it as the fallback in case a Compose version rejects `--cap-add` on `run`. The host's Compose accepted the flag in rg3b (A2.6), so the fallback is not needed. |
| 5 | Run the copy-out in the `backup` service, which already mounts the store read-only as root | `postgres:18` has no Node, and the copy-out and its manifest are the API's CLI (ADR-0064 §5). A new image is rejected by Alternative 4 of this ADR. |
| 6 | `CAP_FOWNER` or `CAP_CHOWN` | Neither grants read access to another account's files. They do not meet (b). |

**Residual disclosed with the decision (residual 10, A2.8).**

- Granting `CAP_DAC_READ_SEARCH` to a container also lets it call `open_by_handle_at(2)`. Docker's default seccomp profile allows that system call only when this capability is granted.
- With the capability, a process that holds a file descriptor on a bind-mounted host file system can, in principle, open other files on that file system by handle. That is the known 2014 "shocker" escape class. In step 2 the bind mounts are `/backups` (the backup root) and the Compose secret files.
- **Why it is accepted here:**
  - the container runs one fixed command from the pinned, locally built app image, with `--rm`, a read-only root file system and `no-new-privileges`;
  - it runs no operator- or user-supplied code;
  - it lives for seconds (C4 took 1.26 s in rg3b).
- **How IT can narrow it further.** Put the backup root on a dedicated file system, so that the handle reach of the `/backups` mount is limited to the backups. Choose `MTH_SECRETS_DIR` with the same care. This advice is not yet in `backup-restore.md`; the guide is the devops-engineer's (open question 1 of this task's handback).
- **Not verified online.** This environment is offline. The `open_by_handle_at` and seccomp facts above come from the Docker and Linux documentation as the author knows it. They were not re-checked against the current official pages in this run. The orchestrator or the devops-engineer should check them before the guide cites them.

**If Alternative 3 is ever adopted** (an image change), the capability can be dropped. That needs a new amendment of this ADR.

### A2.5 DO-D13 Q3: the extra read-only files in the `backup` service

- Mounting the whole Compose directory also exposes `db-init/`, `compose.load.yaml`, `compose.no-egress.yaml` and `.env` (which holds only `MTH_SECRETS_DIR`) to the `backup` container, read-only.
- None of them holds a secret value, and only `compose.yaml` and `.env` (as `environment.env`, secret values removed, §3) are copied into `config/`.
- **Accepted.** The secret files themselves stay Compose secrets (`/run/secrets`) and are never copied (§3, D-243 Q16).

### A2.6 Verification status of the Compose sequence (replaces the A1.4 "Verification status" bullet)

The Compose half **was executed**, by the orchestrator on its host's Docker daemon (D-284; the D-267 precedent; D-243 Q1 still holds for agent sandboxes). The evidence is under `docs/delivery/test-evidence/DG7/orchestrator/`.

| Run | Source | Result | What happened |
| --- | --- | --- | --- |
| `compose-backup-rg3` | `bf5bf82a736dbdafffa89551158ef835b3ccf108` | **FAIL**: image build exit 0, drill exit 1 | C3 (`--phase database`) failed: `backup: set rg3 failed: the Compose file //deploy/compose/compose.yaml does not exist`. C4 to C10 were NOT_RUN. This confirmed F-DG7-1031/1051 as a product defect, which DO-D13 repaired (A2.1). |
| `compose-backup-rg3b` | `ebe11c378687f3ff48ee269e5bfa4971d6addcbc` (image rebuilt from it) | **PASS**: build exit 0, drill exit 0, C0 to C11 PASS in 46.34 s | The backup profile on `postgres:18` (C3), the copy-out with `--user 0:0` and `DAC_READ_SEARCH` (C4), the finish phase (C5), a set with no group or other bit (C6), a restore into a second project with new volumes (C7, C8), migrate "up to date" and `GET /readyz` (C10). |

**What rg3b proves:**

- the `/mth/deploy` layout of A2.1 works in a container;
- the host's Compose accepts `--cap-add` on `run`, which closes DO-D13 §4 gap 2;
- `DATABASE_URL_FILE` reaches the CLI (C4 exit 0);
- the three-step sequence produces a set that restores and starts.

**What rg3b does not prove** (stated so that nothing above is read as more than it is):

- **The capability's read path was not exercised.** C4 logged `copied 0 objects (0 distinct files, 0 bytes)`. The source had no evidence object, so the read of the uid-10001 store under `DAC_READ_SEARCH` was never tested on a real file. The source had no job either, so the job-state leg is vacuous too (F-DG7-1072, open).
- **The restored evidence's ownership was set by the drill, not by the documented restore.** C9 runs `chown -R` to the evidence root's owner, and `backup-restore.md` does not document that step (F-DG7-1082, open).
- **The manifest's config list was empty.** The finish phase printed `cat: …/config.sha: No such file or directory`, and the manifest's `config.files` was empty (F-DG7-1061, open). The `config/` files were still hashed in the top-level `files` and checked by R1 on restore.
- **No refusal case ran in Compose.** The unset or missing `MTH_BACKUP_ROOT` refusal (A1.4) was not run as a drill step. Its shape is pinned only by the static test in `tools/release/tests/service-list.test.mjs`.

### A2.7 The follow-on change assigned to T-DG7-DO-D14 (not built at this amendment's base)

T-DG7-DO-D14 is assigned (2026-11-24) to repair F-DG7-1061/1071/1081 and F-DG7-1072/1082. At this amendment's base none of it is merged, and this amendment states no rule for it. The assignment's scope, as given:

1. **Split-phase config list.** `--phase finish` records `config.files`. The config listing survives from the database phase to the finish phase through the shared backup root, never through a per-process temporary directory. No stray `cat` error. A test fails on an empty `config.files` and on any stderr noise.
2. **Restored evidence ownership.** A Compose restore that follows `backup-restore.md` leaves the evidence readable by uid 10001, with its intended owner and modes, and with no undocumented `chown`. This changes the restore design of §7 step 5 for Compose. Today `copy-in` writes as the account that runs `restore.sh` (root in the Compose runner), and only the drill's C9 corrects the owner.
3. **A Compose drill that moves real data.** The drill seeds and moves real evidence objects and job state. It verifies ownership, count and hashes after the restore, which also exercises A2.4's read path. DO-D14 is to run the drill itself on the host's Docker daemon and record the log.

When DO-D14 is merged, the ownership rule as built (who owns the restored store, how it is set, and its test) must be recorded by a further amendment of §7. The same amendment should restate A2.6 from DO-D14's drill log. Until then, items 1 to 3 are open findings, not behaviour.

### A2.8 Residuals (replaces residual 9; extends the Residuals section)

9. **The Compose half has run, but only the database, audit and snapshot legs carry data** (A2.6). The evidence and job-state legs and the `DAC_READ_SEARCH` read path moved zero items in rg3b. The restored ownership depends on an undocumented drill step. These stay open until DO-D14's drill (A2.7) or a later host run shows them with real objects.
10. **Step 2 grants `CAP_DAC_READ_SEARCH`, which re-enables `open_by_handle_at(2)` for one short-lived command** (A2.4). It is bounded by the fixed, pinned command, the read-only root file system, `no-new-privileges` and `--rm`. IT can narrow it by putting the backup root on a dedicated file system. The guide does not yet say so.
