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
- The service's set is owned by root. Step 2 of the Compose sequence therefore runs the app image as root (`--user 0:0`) for the copy-out command only, so that it can write into the set (DO-D11 §4 item 2).
- **Verification status.** T-DG7-DO-D11's static test in `tools/release/tests/service-list.test.mjs` pins the mount's shape: one `/backups` bind, `create_host_path: false`, no `/tmp` and no `:?`. The Compose run itself was not executed in an agent sandbox, because there is no Docker daemon (D-243 Q1). This covers the refusal of an unset root, the root-owned `0700`/`0600` set, and step 2 with `--user 0:0`. It is the orchestrator's host run (D-283; F-DG7-1031/1051), and this amendment claims no result for it.

### A1.5 Residuals added (extends the Residuals section)

7. **The ancestors of the backup root are not checked** (A1.3 item 4). An account that can write a parent directory could rename the root and put another in its place between runs. IT owns the host's directory tree, so the guide gives `/srv/mth-backups`, created by root.
8. **The `ownerOnly` check covers modes, not ACLs or the owner's identity.** A POSIX ACL that grants another account access, or a root owned by a different account, is not detected. Keeping the set's permissions when it is copied off the host is IT's (`backup-restore.md` §3.3).
9. **The Compose half of the owner-only and root rules is unverified here** (A1.4). It depends on the orchestrator's host run.
