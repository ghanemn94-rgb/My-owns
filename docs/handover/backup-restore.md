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
# 1. snapshot, table counts, pg_dump in the same snapshot, config/ (secret values removed)
docker compose -f deploy/compose/compose.yaml --profile backup run --rm backup --label "$LABEL" --phase database
# 2. evidence copy-out (after the dump) and the store-side verify, in the pinned app image
ID=$(cat "$MTH_BACKUP_ROOT/$LABEL/.backup-state/id")
docker compose -f deploy/compose/compose.yaml run --rm --no-deps -v "$MTH_BACKUP_ROOT:/backups" \
  -e DATABASE_URL_FILE=/run/secrets/database_url --entrypoint node api \
  /app/apps/api/dist/cli/transfer-attachments.js copy-out --to "/backups/$LABEL/evidence" \
  --out "/backups/$LABEL/evidence/attachments.json" --export-id "$ID"
# 3. retention sets, checks, manifest (written last), backup_set_record()
docker compose -f deploy/compose/compose.yaml --profile backup run --rm backup --label "$LABEL" --phase finish
```

Step 2 passes the set's own id with `--export-id`, so `attachments.json` names the backup set. The paths inside the app image are those of `deploy/docker/Dockerfile`. The Compose sequence runs on the orchestrator's host (D-243 Q1). Its result is recorded there, not here.

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
- every listed file is re-read and matches.

## 5. Restore (into a fresh database and an empty evidence store)

Preconditions:

- **Target cluster.** A PostgreSQL cluster of the **same major** as the set's `server.major` (D-243 Q14), with the roles `mth_owner` and `mth_app` (`deploy/compose/db-init`).
- **Target database.** An **empty** database owned by `mth_owner` (UTF8).
- **Target evidence root.** An **empty** evidence root.
- **Secrets.** The secrets of §6 are provided again by IT.

```bash
deploy/scripts/restore.sh --from /srv/mth-backups/<label> \
  --target-database-url "$(cat /run/secrets/database_owner_url)" \
  --target-evidence-path /var/lib/mth/evidence --out /srv/mth-restore-reports/<label> \
  --manifest-sha256 <hex recorded by backup.sh or in backup_set.manifest_sha256> \
  [--readyz-url http://127.0.0.1:3000/readyz]
```

| Step | What happens | On failure |
| --- | --- | --- |
| 1 Package checks (R1) | `schemaVersion` = `mth-backup/1`. Every listed file exists and matches its SHA-256, and no unlisted file is present. When `--manifest-sha256` is given, the manifest matches it. | exit 2: `restore: refused: unsupported backup schema version '<v>'` or `restore: refused: checksum mismatch for <file>` |
| 2 Same major | The target server's major equals `server.major`. | exit 2: `restore: refused: backup is from PostgreSQL <m>, target is <n>; a cross-major restore is an upgrade (dump with the newer client), see upgrades.md` |
| 3 Fresh target | No table in `public`, no `pgboss` schema and an empty evidence root. A restore never overwrites. | exit 2: `restore: refused: the target database is not empty` / `restore: refused: the target evidence store is not empty` |
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
| R7 evidence | `transfer-attachments verify` on the target reports no mismatch over every `attachments.json` entry, and every retention set file is equal | evidence bytes |
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

The logs are in `docs/delivery/handbacks/DG7/T-DG7-DO-F-evidence/`. The Compose half runs on the orchestrator's host and is recorded there: the `backup` profile on `postgres:18`, a second Compose project with new volumes, and `/readyz` over HTTP.

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

## ملخص باللغة العربية (Arabic summary)

- **المحتوى:** تحتوي مجموعة النسخ الاحتياطي على قاعدة البيانات كاملة، بما فيها سجل التدقيق ولقطات التقارير وحالة المهام. وتحتوي كذلك على ملفات الأدلة، ومجموعات أرشيف الاحتفاظ، وإعدادات النشر بعد حذف كل قيمة سرية.
- **الأسرار:** لا تُحفظ الأسرار في النسخة. توفرها تقنية المعلومات من جديد عند الاستعادة.
- **شروط الاستعادة:** تتم الاستعادة إلى قاعدة بيانات فارغة ومخزن أدلة فارغ فقط، وبنفس الإصدار الرئيسي من PostgreSQL. ترفض أداة الاستعادة أي ملف تغيّر، أو إصدار مخطط غير مدعوم، أو هدف غير فارغ (رمز الخروج 2).
- **التحققات:** بعد الاستعادة تُجرى التحققات من R1 إلى R8: سلامة الملفات، ومستوى الترحيل، وعدد الصفوف، والتدقيق، واللقطات، وحالة المهام، والأدلة، والجاهزية. ويضيف التمرين التحقق R9 (مجموع التحقق للبيانات التجريبية). يُكتب تقرير `restore-report.json` بالقيم المتوقعة والفعلية وبزمن كل خطوة.
- **الأزمنة المقاسة:** الأزمنة المذكورة مقاسة على بيانات تجريبية اصطناعية، وليست أهدافاً للتعافي.
- **أهداف التعافي:** أهداف نقطة الاستعادة (RPO) وزمن الاستعادة (RTO) يُتفق عليها مع تقنية المعلومات في موبايلي.
- **حدود العرض:** هذا العرض المحلي لا يثبت جاهزية الإنتاج عالية التوافر.

(The Arabic summary is provisional until a qualified reviewer checks it, D-243 Q7.)
