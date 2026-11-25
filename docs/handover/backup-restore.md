# Backup and restore (handover guide)

- **For:** Mobily IT operators of the Mobily Transformation Hub.
- **Design:** ADR-0066 (backup set, manifest, restore checks, drill). Upgrades and cross-major moves: `docs/handover/upgrades.md` (ADR-0068). Retention of business records: ADR-0067.
- **Requirements:** REQ-S19-012 and REQ-S20-019 (A19: "Restore drill recovers database, evidence, audit, snapshots and job state with documented checks and timings").
- **Scripts:** `deploy/scripts/backup.sh`, `deploy/scripts/restore.sh` and `deploy/scripts/restore-drill.sh`. Tests: `deploy/scripts/tests/backup-restore.test.mjs` (T-E1…T-E9) and `tests/qa/integration/a19-backup-restore-drill.test.ts` (QA).

A backup set, a restore and a drill report are engineering artefacts. None of them is a business, Finance or IT approval. **Recovery objectives (RPO/RTO) are to agree with Mobily IT**: this guide proposes none. The Compose stack in this repository is **not** a high-availability production deployment. A successful local drill does not show that production is ready for high availability.

## 1. Scope: what one set covers

| Scope (M0360, A19) | Where it is in the set | Checked on restore by |
| --- | --- | --- |
| Database: every business record and the configuration tables (methodology, forms, formulas, branding, schedules) | `db/database.dump` (`pg_dump -Fc` of the whole database) | R2, R3 |
| Audit (`audit_event`, append-only) | in the dump; count and `max(seq)` in the manifest | R4 |
| Reporting snapshots (`report_snapshot*`, `ranking_snapshot`) | in the dump; a digest of every row in the manifest | R5 |
| Job state (`pgboss.*`, `job_run`, `job_schedule`) | in the dump; pg-boss jobs by state, the `job_schedule` digest and the `job_run` count in the manifest | R6 |
| Evidence bytes | `evidence/attachments.json` (`mth-attachment-manifest/1`) and `evidence/attachments/<sha256>`, copied with `transfer-attachments copy-out` | R7 |
| Retention archive sets (ADR-0067) | `evidence/retention/<runId>/…` | R7 |
| Deployment configuration | `config/`: the Compose file(s), `images.lock.json` and the environment file **with every secret value removed** | R1 (checksums) |

**Not in a set:**

- **Secrets.** No secret is in a set (D-243 Q16): database passwords, the session key, the OIDC client secret and S3 keys stay in IT's secret store. See §6.
- **Migration exports** (`transfer/migration-exports/**`). They can be regenerated.
- **Point-in-time recovery** (WAL archiving). This is a database-platform option for IT and is not built here.

## 2. Schedule (an example: the cadence is IT's)

The platform does not schedule its own backup, because a backup must run outside the system it protects. The RPO equals the cadence IT chooses. Example host cron entry for a nightly set at 01:30 Asia/Riyadh, for a host whose clock runs on Asia/Riyadh:

```cron
30 1 * * * cd /opt/mth && deploy/scripts/backup.sh --out /srv/mth-backups --operator "IT scheduler" >>/var/log/mth-backup.log 2>&1
```

- **Retention of sets is IT's.** The script never deletes a set. To prune by label age, for example, keep 30 days: `find /srv/mth-backups -maxdepth 1 -name 'mth-*' -mtime +30 -exec rm -rf {} +`. Run this only after you have checked that a newer set succeeded.
- **Quiet set.** `pg_dump` takes a consistent snapshot while the application keeps running. Evidence written after the snapshot is copied as a harmless superset. For a strictly quiet set, stop `api` and `worker` first.

## 3. Taking a backup

### 3.1 Host with Node 24 and PostgreSQL client tools (one command)

```bash
DATABASE_URL_FILE=/run/secrets/database_owner_url \
EVIDENCE_STORAGE_DRIVER=filesystem EVIDENCE_STORAGE_PATH=/var/lib/mth/evidence \
deploy/scripts/backup.sh --out /srv/mth-backups [--label <label>] --operator "<name>" \
  [--release <version>] [--env-file deploy/compose/.env] [--compose-file deploy/compose/compose.yaml]
```

- **Database URL.** `DATABASE_URL` (or `DATABASE_URL_FILE`) is the **owner** role (`mth_owner`). The script calls `backup_set_record()`, which the runtime role `mth_app` cannot call.
- **Label.** The default is `mth-<UTC yyyymmddThhmmssZ>`. A label must match `^[a-z0-9][a-z0-9._-]{0,99}$`.
- **`--release`.** Takes the release version from the archive manifest of the running images. It is `"unknown"` when not given and is never guessed.
- **`PGBIN`.** Selects the client tools (default: `PATH`). The `pg_dump` major must be **at least** the server's major.
- **Output.** Success: `backup: set <label> succeeded: <bytes> database bytes, <n> evidence objects; manifest sha256 <hex>` (exit 0). Failure: `backup: set <label> failed: <reason>` (exit 1). A failed set is also recorded, with its reason.
- **S3 evidence store.** `EVIDENCE_STORAGE_DRIVER=s3` is **BLOCKED** (exit 3) in this release, because BE-E's `transfer-attachments` CLI has no S3 target. Back up the bucket with IT's S3 tooling (versioning or replication). The database half still needs this script.

### 3.2 Compose (`backup` profile, on the pinned `postgres:18` image: no new image)

The `postgres:18` image has no Node, so the set is taken in three steps. Run them from the repository root, with `MTH_SECRETS_DIR` set as for the stack:

```bash
export MTH_BACKUP_ROOT=/srv/mth-backups LABEL=mth-$(date -u +%Y%m%dt%H%M%Sz)
sudo install -d -m 0700 -o root -g root "$MTH_BACKUP_ROOT"   # once: it must exist, owner-only (§3.3)
# 1. snapshot, table counts, pg_dump in the same snapshot, config/ (secret values removed)
docker compose -f deploy/compose/compose.yaml --profile backup run --rm backup --label "$LABEL" --phase database
# 2. evidence copy-out (after the dump) and the store-side verify, in the pinned app image
ID=$(cat "$MTH_BACKUP_ROOT/$LABEL/.backup-state/id")
docker compose -f deploy/compose/compose.yaml run --rm --no-deps -v "$MTH_BACKUP_ROOT:/backups" --user 0:0 \
  --cap-add DAC_READ_SEARCH -e DATABASE_URL_FILE=/run/secrets/database_url --entrypoint node api \
  /app/apps/api/dist/cli/transfer-attachments.js copy-out --to "/backups/$LABEL/evidence" \
  --out "/backups/$LABEL/evidence/attachments.json" --export-id "$ID"
# 3. retention sets, checks, manifest (written last), backup_set_record()
docker compose -f deploy/compose/compose.yaml --profile backup run --rm backup --label "$LABEL" --phase finish
```

Step 2 passes the set's own id with `--export-id`, so `attachments.json` names the backup set. The paths inside the app image are those of `deploy/docker/Dockerfile`.

- **The configuration listing survives between the steps.** Step 1 keeps the `config/` listing (every file with its SHA-256) in the set's own `.backup-state/`, on the shared backup root. Step 3 checks that the listing still matches `config/` and its recorded digest, and writes it as the manifest's `config.files`, exactly as `--phase all` does. If the listing is missing or `config/` changed between the steps, step 3 fails the set: `backup: set <label> failed: the config/ listing of the database phase is missing from .backup-state` or `… config/ changed after the database phase` (exit 1). No step prints anything on standard error when it succeeds.

- **Why root, and why one capability.** Step 2 runs as root (`--user 0:0`) for this one command only. The `backup` service runs as root and creates the set owner-only (§3.3), so the image's own user (uid 10001) could not write into it. The `api` service drops every capability (`cap_drop: ALL`), and the evidence store belongs to uid 10001 with mode `0700`. So root could write into the set but could not read the store. `--cap-add DAC_READ_SEARCH` gives back only the right to read and list files the account does not own, for this one command. It does not give the right to write them (no `DAC_OVERRIDE`).
- **The database URL.** The command reads the URL from the Compose secret file (`DATABASE_URL_FILE`). `transfer-attachments` reads `DATABASE_URL` or `DATABASE_URL_FILE` (never both).
- **Where the `backup` service finds its files.** The service mounts the repository's files read-only under `/mth`, in the repository's own layout: `/mth/deploy/scripts/backup.sh`, the Compose directory at `/mth/deploy/compose` and `/mth/deploy/images.lock.json`. The script finds the repository root from its own path, two directories up, so `config/` gets `compose.yaml`, `images.lock.json` and, when `deploy/compose/.env` exists, `environment.env` with its secret values removed. A missing Compose file or a missing `--env-file` is refused before anything is written: `BLOCKED: the Compose file <path> does not exist (repository root resolved to <dir> …)` (exit 2), and the label stays free for the next run.
- **Where it was run.** The Compose sequence runs on the orchestrator's host (D-243 Q1). Its result is recorded there, not here.

### 3.3 Permissions of the backup root and the set

A set holds the whole installation: user accounts, sessions, the audit trail, every business and Finance record and the evidence bytes. Protect it like the database itself.

- **The set is owner-only.** `backup.sh` runs with `umask 077`. Every directory of the set is `0700` and every file `0600`, including `db/database.dump`, `.backup-state/` and the `--record-out` file. The owner is the account that ran the script (root in the Compose `backup` service). Run `restore.sh`, copies and pruning as that account.
- **The evidence copy-out is repaired.** Compose step 2 runs in another container with its own umask. `--phase finish` removes every group and other permission bit from the set again. It then fails the set if anything is still readable by group or others (check `ownerOnly` in the manifest's `checks`).
- **The backup root must not be shared.** `backup.sh` refuses a root that group or others can write, such as `/tmp` (mode `1777`): `BLOCKED: the backup root <path> is writable by group or others; use an owner-only directory (chmod 0700)` (exit 2). Nothing is written. A missing root is created with mode `0700`. Create it yourself, for example `install -d -m 0700 -o root -g root /srv/mth-backups`.
- **A root given as a symbolic link is judged by its target.** For example `/srv/mth-backups -> /data/backups`: the script resolves the link (a chain of links too) and checks the target directory. An owner-only target is accepted, and the set is written through the resolved path. A target that group or others can write is refused with `BLOCKED: the backup root <link> is a symbolic link to <target>, which is writable by group or others; use an owner-only directory (chmod 0700)` (exit 2). A link whose target does not exist, or is not a directory, is refused too (exit 2), and nothing is created. The Compose `backup` service is not affected: its bind mount resolves the link on the host.
- **Compose requires `MTH_BACKUP_ROOT`.** There is no fallback to the host's `/tmp`. The `backup` service mounts it with `create_host_path: false`, so an unset or missing directory stops the run before any backup (`bind source path does not exist`). The other profiles are unaffected.
- **Copies elsewhere are IT's.** Keep the modes when you copy a set off the host (for example `tar -p` or `rsync -a`), and encrypt it at rest and in transit as for the database (a hosting function, [deployment guide](deployment.md)).

## 4. The set (`<backup-root>/<label>/`)

```text
backup-manifest.json        mth-backup/1, written last; its own SHA-256 is printed and recorded in backup_set
db/database.dump            pg_dump custom format (-Fc) of the whole database, pgboss schema included
db/table-counts.tsv         "<schema>.<table>\t<rows>" for every base table, taken in the dump's snapshot
evidence/attachments.json   mth-attachment-manifest/1 (ADR-0064 §5)
evidence/attachments/<sha256>   one file per distinct evidence object
evidence/retention/<runId>/...  retention archive sets (ADR-0067 §5)
config/                     compose.yaml, images.lock.json, environment.env (secret values replaced by <removed>)
```

**The manifest holds counts and checksums only**: no row data, no evidence content and no credential. Its fields:

- `label`, `startedAt`, `finishedAt`, `release`, `migrationLevel` (`<id>_<name>`);
- `server` (`version`, `major`) and `client.pgDump`;
- `database`: the dump's `bytes` and `sha256`, the `tableCounts` file and hash, `auditEvents` (`count`, `maxSeq`), `snapshotDigest`, `pgbossJobsByState`, `jobScheduleDigest`, `jobScheduleRows` and `jobRunCount`;
- `evidence`: `backend`, `attachmentManifest` (`sha256`, `count` = distinct files, `entries` = rows, `bytes`) and `retentionSets`;
- `config` (`files`, `sha256`);
- `files`: every file with its `sha256` and `bytes`;
- `checks` and `timings` (`snapshot`, `dump`, `evidence`, `config` and `verify`, in seconds).

**How the counts and the dump agree.** The script opens one `REPEATABLE READ, READ ONLY` transaction and exports its snapshot with `pg_export_snapshot()`. It takes every count and digest in that snapshot, then runs `pg_dump --snapshot=<id>`. A row committed while the dump runs is in neither the counts nor the dump (test T-E2).

**Checks before a set is reported as succeeded (ADR-0066 §4):**

- `pg_restore --list` reads the dump;
- the `pg_dump` major is at least the server's major;
- `transfer-attachments verify` reports no mismatch;
- every evidence file equals its name's SHA-256;
- every retention set equals the store and its `archive_set_sha256`;
- every listed file is re-read and matches;
- the set is owner-only: no directory or file is readable or writable by group or others (§3.3).

## 5. Restore (into a fresh database and an empty evidence store)

Preconditions:

- **Target cluster.** A PostgreSQL cluster of the **same major** as the set's `server.major` (D-243 Q14), with the roles `mth_owner` and `mth_app` (`deploy/compose/db-init`).
- **Target database.** An **empty** database owned by `mth_owner` (UTF8).
- **Target evidence root.** An **empty** evidence root. When it already exists, its owner is taken as the account of the API and the worker (see "Ownership of the restored evidence" below). A symbolic link to an existing directory (for example `/var/lib/mth/evidence` pointing at a data disk) is accepted. It is resolved once, and the restore, the owner, the modes and R7 then apply to the directory it points to, never to the link itself. A link whose target does not exist, or points at something other than a directory, is refused before the database is touched (exit 2): `restore: refused: the target evidence path <path> is a symbolic link whose target does not exist (<target>); …` / `… is a symbolic link to <target>, which is not a directory`.
- **Secrets.** The secrets of §6 are provided again by IT.

```bash
deploy/scripts/restore.sh --from /srv/mth-backups/<label> \
  --target-database-url "$(cat /run/secrets/database_owner_url)" \
  --target-evidence-path /var/lib/mth/evidence --out /srv/mth-restore-reports/<label> \
  --manifest-sha256 <hex recorded by backup.sh or in backup_set.manifest_sha256> \
  [--readyz-url http://127.0.0.1:3000/readyz] [--evidence-owner <uid>:<gid>]
```

**Ownership of the restored evidence.** The API and the worker run without any capability (`cap_drop: ALL`), so they can read and remove only the evidence files their own account owns. `restore.sh` therefore gives every restored evidence directory and file to that account, with mode `0700` for directories and `0600` for files, the modes the filesystem store writes itself. You do **not** need a separate `chown` step.

- **Which account.** By default, the owner of the existing, empty target evidence root. In Compose this is the image's app user, uid `10001`, which owns the evidence volume. If the root does not exist yet, the account that runs `restore.sh` creates it and keeps it. `--evidence-owner <uid>:<gid>` names the account explicitly, for example `--evidence-owner 10001:10001`. Any other value is refused: `BLOCKED: --evidence-owner must be <uid>:<gid> (numbers), for example 10001:10001` (exit 2).
- **Who runs it.** Handing files to another account needs root. Run `restore.sh` as root when the API's account differs from yours, as in the Compose restore below. Without root, an evidence owner other than your own uid (and one of your groups), or an existing evidence root you cannot write, is refused at step 3, before the database is touched (exit 2): `restore: refused: the evidence owner <uid>:<gid> is not the account running restore.sh (<uid>:<gid>); run the restore as that account or as root`. If the change of owner still fails, the restore stops: `restore: check R7 failed: expected the evidence owned by <uid>:<gid>, got: <error>` (exit 1).
- **Check.** R7 also reports the owner of the evidence root, the number of paths with another owner and the number of paths with a group or other permission bit. It passes only when the owner is the expected account and both numbers are 0 (§7).

**Compose restore.** The `postgres:18` image has the PostgreSQL client tools of the same major. Run `restore.sh` from the repository in a one-off root container of that image, on the target project's network, with the target's evidence volume mounted. Initialize the empty evidence volume from the app image first, so it belongs to uid `10001` (for example `docker compose -p <target> run --rm --no-deps --entrypoint true api`). `deploy/scripts/drill/compose-backup-drill.sh` steps C7 and C8 run exactly this sequence. `restore.sh` then hands the evidence to uid `10001`, and the drill's step C9 only verifies the result.

| Step | What happens | On failure |
| --- | --- | --- |
| 1 Package checks (R1) | `schemaVersion` = `mth-backup/1`. Every listed file exists and matches its SHA-256, and no unlisted file is present. When `--manifest-sha256` is given, the manifest matches it. | exit 2: `restore: refused: unsupported backup schema version '<v>'` or `restore: refused: checksum mismatch for <file>` |
| 2 Same major | The target server's major equals `server.major`. | exit 2: `restore: refused: backup is from PostgreSQL <m>, target is <n>; a cross-major restore is an upgrade (dump with the newer client), see upgrades.md` |
| 3 Fresh target | No table in `public`, no `pgboss` schema and an empty evidence root (a symbolic link is resolved to its directory). Without root, the evidence owner must be the runner's account. A restore never overwrites. | exit 2: `restore: refused: the target database is not empty` / `restore: refused: the target evidence store is not empty` / `restore: refused: the target evidence path <path> is a symbolic link …` / `restore: refused: the evidence owner <uid>:<gid> is not the account running restore.sh …` |
| 4 Database | `pg_restore --exit-on-error --single-transaction --no-owner --role=mth_owner`. GRANTs are kept, so `mth_app` has exactly the dumped privileges. Table data loads in table-creation order, because some CHECK constraints read another table. | exit 1; the transaction rolls back, so the target stays empty |
| 5 Evidence | `transfer-attachments copy-in` writes every object under its same name and verifies it. The retention sets are copied back under `retention/<runId>/`. | exit 1 |
| 6 Checks R1–R8 | See §7. | exit 1: `restore: check <R#> failed: expected <x>, got <y>`. The target is left for inspection and nothing is started. |
| 7 Start | `migrate` (it reports "up to date"; a restore never runs a migration), then `api` and `worker`. `/readyz` must be ready. | do not start traffic |
| 8 Report | `restore-report.json`: every check with its expected and actual values, and the seconds of every step. | – |

On success: `restore: <label> restored and ready in <s> s; all checks passed` (exit 0).

**Cross-major.** A set from PostgreSQL 16 cannot be restored into 18 by this script. Moving to a newer major is an upgrade: dump with the newer client and follow `docs/handover/upgrades.md`.

**After a restore.** `backup_set` lists only the sets that were known when the restored set was taken, not later ones (ADR-0066 Residual 2).

## 6. Secrets to provide (by name; never in a set)

- `pg_superuser_password`, `mth_owner_db_password` and `mth_app_db_password` (database roles);
- `database_url` and `database_owner_url` (connection URLs with the role passwords);
- `oidc_client_secret` (the corporate IdP client) and the session key of the API;
- the S3 access key and secret, when the evidence store is S3 (SecretRefs of the storage setting, ADR-0054);
- TLS material of the IdP trust anchor, when not in the base image (`MTH_EXTRA_CA_CERTS_FILE`).

## 7. Restore checks (A19 "documented checks")

| Check | Expected | Proves |
| --- | --- | --- |
| R1 manifest and file SHA-256 | every listed file equal; no unlisted file; the manifest equal to `--manifest-sha256` when given | the set is intact |
| R2 migration level | `migrationLevel` equal; `mth-db status: up to date` | database schema |
| R3 per-table row counts | every line of `table-counts.tsv` equal to a recount in one snapshot on the target | database |
| R4 audit | `audit_event` count and `max(seq)` equal `database.auditEvents` | audit |
| R5 snapshots | `snapshotDigest` recomputed on the target is equal, so every row of the six snapshot tables (including `report_snapshot_version.content_sha256`) is byte-equal | snapshots |
| R6 job state | pg-boss jobs by state, the `job_schedule` digest (every column, `enabled` included) and the `job_run` count are equal | job state |
| R7 evidence | `transfer-attachments verify` on the target reports no mismatch over every `attachments.json` entry, and every retention set file is equal. Every path of the evidence root belongs to the API's account (`owner`, `otherOwner` 0) with no group or other bit (`groupOrOtherBits` 0) | evidence bytes, readable by the API |
| R8 readiness | `/readyz` reports `ready` (with `--readyz-url`). Without it, the script evaluates the same rule offline: a UTF8 database, `mth-db status` up to date, and an evidence root that is readable and writable. The report says which mode was used. | the restored installation runs |
| R9 demo checksum (drill only) | the ADR-0050 demo checksum of the restored demo equals the source's | business content, end to end |

## 8. The A19 drill and its measured timings

`deploy/scripts/restore-drill.sh --admin-url <disposable cluster> --work <dir>` runs the drill:

1. demo (synthetic) installation;
2. `backup.sh`;
3. a fresh database and an empty evidence root;
4. `restore.sh`;
5. R9;
6. `drill-report.json`.

To run it locally: `tests/qa/support/with-pg.sh bash -c 'deploy/scripts/restore-drill.sh --admin-url "$TEST_DATABASE_ADMIN_URL" --work "$TMPDIR/a19-drill"'`.

**Measured drill timings (container-free half, D-243 Q1)**

- **Environment:** PostgreSQL 16.15 on both sides (same major), filesystem evidence, the agent sandbox.
- **Workload:** the **synthetic demo** dataset: 355 base tables, 923 audit events and the demo snapshots, plus the synthetic objects of each run.
- **Status:** these are drill measurements on that dataset. **They are not recovery objectives, and no timing is claimed for production volumes.**

| Run | Backup (s) | Restore (s) | Notes |
| --- | --- | --- | --- |
| `restore-drill.sh`, 2026-11-13 04:39 UTC (T-DG7-DO-F; `drill-report.json`) | 2.2 (snapshot 0.13, dump 0.41, evidence 0.67, config 0.10, verify 0.65) | 5.9 (restore.sh 5.6: package checks 0.17, target checks 0.10, database 3.11, evidence 0.63, checks 1.63); R9 0.71; R1–R9 PASS | demo only: 0 evidence objects, 0 pg-boss jobs |
| QA A19 harness, 2026-11-13 04:41 UTC (T-DG7-DO-F run) | 2.5 (snapshot 0.15, dump 0.46, evidence 0.82, config 0.10, verify 0.78) | 5.1 (database 2.70, evidence 0.69, checks 1.49); first `/readyz` after start 0.15 | demo + 3 evidence rows (2 objects) + 1 queued job |
| Compose drill `compose-backup-rg4c`, 2026-11-24 11:56 UTC (orchestrator; source commit `389482803fd5e338bb83e9078cfc944bda1890ed`; PostgreSQL 18 `postgres:18@sha256:5a5a84b1…2da9722`, Docker 29.9.2, Compose v5.6.1) | 7.1 (C3 `--phase database` 3.02, C4 evidence copy-out 1.81, C5 `--phase finish` 2.24) | 9.8 (C8; `restore.sh` 9.1: package checks 0.16, target checks 0.08, database 4.89, evidence 1.06, checks 2.85); C9 verify 1.24; C10 start and `/readyz` HTTP 200 8.11; whole drill C0–C11 65.95 | demo + 2 evidence files (146 bytes) + 1 queued synthetic job; owner `10001:10001` |

The logs are in `docs/delivery/handbacks/DG7/T-DG7-DO-F-evidence/`. The Compose half runs on the orchestrator's host and is recorded there: the `backup` profile on `postgres:18`, a second Compose project with new volumes, and `/readyz` over HTTP. `deploy/scripts/drill/compose-backup-drill.sh --log <file>` performs that sequence, timing every step. It needs a Docker daemon and runs as root. Its steps:

1. A new source project with synthetic demo data.
2. Two synthetic evidence files uploaded through a one-off dev-auth API of the app image (as uid `10001`, the API's own write path), and one queued synthetic job.
3. The three commands of §3.2. The copy-out must copy at least 2 files. The finish step must print no error line, and the manifest must list `config.files`, the evidence objects and the queued job.
4. `restore.sh` into a second new project.
5. A verification only, with no `chown`: R6 and R7 with non-zero counts and owner `10001:10001`. In the app image as uid `10001` without capabilities, every restored object is read and its SHA-256 compared with the source's. Every path is `10001:10001` with `0700`/`0600`, and the queued job is still queued.
6. `GET /readyz`.

**Compose runs.** All were run by the orchestrator on a host with a Docker daemon, on synthetic data only. The agent sandbox has no Docker daemon, so no agent has run this drill itself. The logs are in `docs/delivery/test-evidence/DG7/orchestrator/compose-backup-<run>/`.

- **`compose-backup-rg3b`** (round 3, PASS). It moved **0 evidence objects and 0 jobs**, so it did not exercise the evidence and job-state legs. It also carried the `cat: …/config.sha` error line, which was repaired afterwards (T-DG7-DO-D14).
- **`compose-backup-rg4` and `compose-backup-rg4b`** (2026-11-24, source commit `b2864f2abf2397c27bbb73d3535b8b7c1f30fc6b`, both **FAILED** at C2b, drill exit 1). The drill's own seeding was at fault: the users seeded in dev mode saw none of the demo data, so the evidence uploads found no transformation (`no transformation readable by the signed-in user`). C3–C10 did not run. The orchestrator repaired the seeding in `compose-backup-drill.sh` (D-285). These runs are kept as evidence and are not counted as passes.
- **`compose-backup-rg4c`** (2026-11-24, source commit `389482803fd5e338bb83e9078cfc944bda1890ed`, **PASS**, C0–C11, drill exit 0 in 65.95 s). This is the extended drill above:
  - C4 copied out 2 evidence files (146 bytes).
  - C5 printed no error line. The manifest lists `config.files` (`config/compose.yaml`, `config/environment.env`, `config/images.lock.json`), 2 evidence files and 2 entries, and the queued job.
  - C8 `restore.sh` passed R1–R8 in 9.1 s.
  - C9 verified without any `chown`: R7 owner `10001:10001`, 2 verified, 0 mismatches, `otherOwner` 0, `groupOrOtherBits` 0. uid `10001` read the same 2 files with the same SHA-256 as the source, and the 1 queued synthetic job was still queued.
  - C10 `/readyz` returned HTTP 200 `ready` on the restored project.

The rg4c run measures one local Compose drill on synthetic data. It is not proof of high-availability production readiness, and it is not a recovery objective (§9). It predates the change of `restore.sh` for a symlinked evidence root (T-DG7-DO-D15, F-DG7-1101). The Compose sequence passes a named volume, never a link, so that change does not alter its path. A re-run on the release candidate is the orchestrator's.

## 9. Recovery objectives (RPO/RTO): to agree with Mobily IT

| Objective | Value | Note |
| --- | --- | --- |
| RPO | **to agree with Mobily IT** | equals the backup cadence IT chooses (§2); point-in-time recovery would need WAL archiving (not built) |
| RTO | **to agree with Mobily IT** | the drill timings in §8 are on the synthetic demo only; production volumes are unmeasured |

## 10. Known limits

- **S3 evidence.** The S3 evidence store is not copied by the scripts in this release (BLOCKED, exit 3). The S3 path is proven only against the P6 fake S3 at module level (BE-E).
- **PostgreSQL major.** The container-free drill ran on PostgreSQL 16. The pinned Compose image is PostgreSQL 18, and that half is the orchestrator's.
- **Scale.** Scale beyond the demo and the P6 fixtures is unproven.
- **Availability.** This is not a high-availability design: one database, no replication, no off-site copy. Those are IT's.
- **Permissions in Compose.** The owner-only modes, the refused shared root and the split-phase repair are tested with the scripts on a disposable PostgreSQL (T-E10 to T-E12; the `config.files` of the split sequence and no standard-error output: T-E11 and T-E11b; a root given as a symbolic link: T-E13). The owner and modes of the restored evidence are tested for the account that runs the test (T-E14), also through a target evidence root given as a symbolic link, and a dangling link or a link to a file is refused before the database is touched (T-E15a, T-E15c). The hand-over to uid `10001` as root (T-E14c), and the default owner taken from a link's target rather than the link (T-E15b), need a mapped uid `10001` and are skipped, with their reason, in a user namespace without one. The refusal of another owner by a non-root runner (T-E15d) needs a non-root runner and is skipped when the test runs as root. The Compose sequence of §3.2 and §5 (root `backup` service, `--user 0:0` copy-out, `create_host_path: false`, the root restore to uid `10001`) cannot run in the agent sandbox, because it has no Docker daemon (D-243 Q1). The orchestrator ran it on its host: run `compose-backup-rg4c` passed (§8).

## ملخص باللغة العربية (Arabic summary)

- **المحتوى:** تحتوي مجموعة النسخ الاحتياطي على قاعدة البيانات كاملة، بما فيها سجل التدقيق ولقطات التقارير وحالة المهام. وتحتوي كذلك على ملفات الأدلة، ومجموعات أرشيف الاحتفاظ، وإعدادات النشر بعد حذف كل قيمة سرية.
- **الأسرار:** لا تُحفظ الأسرار في النسخة. توفرها تقنية المعلومات من جديد عند الاستعادة.
- **الصلاحيات:** تُكتب النسخة لمالكها فقط (المجلدات 0700 والملفات 0600). ترفض الأداة مجلداً جذرياً يمكن للمجموعة أو للآخرين الكتابة فيه، مثل `/tmp`. وإذا كان المجلد الجذري رابطاً رمزياً فإن الأداة تفحص المجلد الذي يشير إليه: تقبله إذا كان لمالكه فقط، وترفضه إذا كان قابلاً للكتابة من المجموعة أو من الآخرين أو إذا لم يكن موجوداً. ويجب تعيين `MTH_BACKUP_ROOT` في Compose لمجلد موجود.
- **شروط الاستعادة:** تتم الاستعادة إلى قاعدة بيانات فارغة ومخزن أدلة فارغ فقط، وبنفس الإصدار الرئيسي من PostgreSQL. ترفض أداة الاستعادة أي ملف تغيّر، أو إصدار مخطط غير مدعوم، أو هدف غير فارغ (رمز الخروج 2).
- **ملكية ملفات الأدلة بعد الاستعادة:** تنقل أداة الاستعادة ملكية كل ملفات الأدلة المستعادة إلى الحساب الذي تعمل به الواجهة البرمجية والعامل، وهو مالك مجلد الأدلة الفارغ (في Compose المستخدم 10001)، أو الحساب المحدد في `--evidence-owner`. وتضبط صلاحيات المجلدات على 0700 والملفات على 0600. لا حاجة إلى خطوة `chown` منفصلة، ويفشل التحقق R7 إذا بقي أي مسار بمالك آخر. وإذا كان مجلد الأدلة الهدف رابطاً رمزياً فإن الأداة تعمل على المجلد الذي يشير إليه، وترفض الرابط المعلّق أو الرابط إلى غير مجلد قبل المساس بقاعدة البيانات (رمز الخروج 2).
- **التحققات:** بعد الاستعادة تُجرى التحققات من R1 إلى R8: سلامة الملفات، ومستوى الترحيل، وعدد الصفوف، والتدقيق، واللقطات، وحالة المهام، والأدلة، والجاهزية. ويضيف التمرين التحقق R9 (مجموع التحقق للبيانات التجريبية). يُكتب تقرير `restore-report.json` بالقيم المتوقعة والفعلية وبزمن كل خطوة.
- **الأزمنة المقاسة:** الأزمنة المذكورة مقاسة على بيانات تجريبية اصطناعية، وليست أهدافاً للتعافي. نجح تمرين Compose الذي أجراه منسّق التسليم (`compose-backup-rg4c`) في كل الخطوات من C0 إلى C11، ونقل ملفَّي أدلة ومهمة واحدة في الانتظار، بمالك 10001. وفشلت المحاولتان السابقتان `rg4` و`rg4b` في الخطوة C2b بسبب تهيئة بيانات التمرين نفسه.
- **أهداف التعافي:** أهداف نقطة الاستعادة (RPO) وزمن الاستعادة (RTO) يُتفق عليها مع تقنية المعلومات في موبايلي.
- **حدود العرض:** هذا العرض المحلي لا يثبت جاهزية الإنتاج عالية التوافر.

(The Arabic summary is provisional until a qualified reviewer checks it, D-243 Q7.)
