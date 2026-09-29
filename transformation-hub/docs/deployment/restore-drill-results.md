# Restore drill results (AT-23)

| Field | Value |
|---|---|
| Date (UTC) | 2026-09-29, runs `20260929T162943Z` (standard) and `20260929T163004Z` (synthetic volume) |
| Executed by | devops-platform-engineer agent, build environment |
| Command | `bash scripts/ops/restore-drill.sh` and `HUB_DRILL_BULK_ROWS=200000 HUB_DRILL_OBJECT_FILES=400 bash scripts/ops/restore-drill.sh` |
| Code | merge commit `75e0ea4` plus the uncommitted devops changes that this document is committed with |
| Host | Linux 6.18 x86_64 sandbox, 4 vCPU, 15 GiB RAM, local disk. PostgreSQL 16.13 and the client tools run on the **same host** |
| Databases | `hub_drill_src` and `hub_drill_dst` (local scratch databases, created by `scripts/dev/pg-init-roles.sh`) |
| Data | Demo sandbox seed (synthetic, `is_demo`), plus simulated in-flight work. The second run adds **synthetic** volume: 200,000 dispatched `outbox_event` rows with ~1 KiB payloads and 400 random object files |
| Result | **PASS** for both runs. Every check below passed |

> **Scope of this evidence.** These numbers come from a small sandbox with the database, the backup files and the
> restore on one local disk. They show that the procedure is correct and repeatable. They do **not** establish the
> restore time for a Mobily production database, storage system or network. The RTO proposal in
> [backup-restore.md](backup-restore.md) must be re-measured on Mobily's infrastructure with production-like volumes.

## What the drill does

1. Recreates both scratch databases and the `hub_owner` and `hub_app` roles.
2. Migrates `src` through the **container entrypoint** (`node deploy/docker/api-entrypoint.cjs migrate`), then loads the Demo seed. The seed writes real document objects through the local storage adapter.
3. Simulates in-flight state in the infrastructure tables:
   - one `running` job and two `queued` jobs;
   - one `sending` delivery and one `sent` delivery;
   - an overdue schedule;
   - an undispatched outbox event;
   - an active session;
   - an audit checkpoint.
4. Adds synthetic object files under `drill-synthetic/`, kept separate from the document objects.
5. Runs `scripts/ops/backup.sh`, then `scripts/ops/restore.sh` into `dst` with the runtime-role verification URL. The restore step is **timed**.
6. Runs independent cross-checks against the live `src` and `dst`, then demonstrates the post-review `--release-held` step.

## Measured durations

| Phase (seconds) | Standard dataset | Synthetic volume |
|---|---|---|
| Rows / tables | 1,020 rows / 105 tables | 201,020 rows / 105 tables (database 284 MB) |
| Objects | 44 files, 4.7 MB (4 document versions + 40 synthetic) | 404 files, 52.8 MB |
| Backup size (`-Fc` dump + objects) | 5.5 MB (dump 812 KB) | 171 MB (dump 120 MB) |
| `backup.sh` wall time | 0.66 | 14.69 (`pg_dump` 13.50) |
| `pg_restore` (single transaction) | 1.03 | 6.07 |
| Post-migrate SQL re-applied | 0.23 | 0.20 |
| Quiesce (hold jobs/outbox/schedules, revoke sessions) | 0.05 | 0.07 |
| Objects copy + sha256 | 0.15 | 0.30 |
| Verification | 0.80 | 0.71 |
| **Total, start to verified** (`restore.sh` report) | **2.85** | **8.26** |
| `restore.sh` wall time measured by the drill | 2.96 | 8.39 |


## Verification results (standard run, verbatim from `restore.sh`)

```
PASS  backup checksums (SHA256SUMS)                9 files
PASS  target empty + roles (runtime NOBYPASSRLS)   db=hub_drill_dst as hub_owner; hub_app super/bypassrls=false,false
PASS  extensions present                           citext pgcrypto
restore: pg_restore done in 1.03s
PASS  post-migrate SQL re-applied (RLS/grants)     0.23s
PASS  quiesce: deliveries sending->uncertain       1
PASS  quiesce: running jobs held                   1
PASS  quiesce: queued jobs held                    2
PASS  quiesce: outbox events held                  47
PASS  quiesce: schedules pushed to now()+hold      1
PASS  quiesce: sessions revoked                    1
PASS  objects restored, sha256 verified            44/44 files match
PASS  document_version <-> object store            4 versions: file present, sha256 = recorded
PASS  row counts per table = backup snapshot       105 tables, 1020 rows
PASS  indexes/constraints/triggers/RLS/policies    tables=105 indexes=264 constraints=673 triggers=145 rls_tables=99 policies=101 functions=26 runtime_role_table_grants=387
PASS  audit chain org 86dd9a3d…                    hub_audit_verify: 0 breaks; head pos=99 hash=82d9fe5805c9… rows=99 = backup
PASS  runtime grants (audit append-only)           audit_event UPDATE/DELETE denied, INSERT allowed; project SELECT allowed
PASS  RLS as runtime role, no context              hub_app sees 0 organization/project/app_user/audit_event/project_membership rows
PASS  RLS as runtime role, with org context        2/2 projects visible only inside the org/project context
PASS  nothing claimable/redeliverable after restore sending=0 runnable_jobs=0 due_schedules=0 active_sessions=0 undispatched_outbox=0
RESULT: PASS (all checks passed)
```

The restore also produced a reconciliation review list. The operator works through it before anything is released:

```
# Held jobs (review each: did its effect already happen after the backup point?)
job  469a955a-…  drill.notify  running  1  drill:running-1
job  a35036c6-…  drill.report  queued   0  drill:queued-due-1
job  4f84a2c4-…  drill.report  queued   0  drill:queued-future-1
# Uncertain deliveries (reconcile with the provider/recipient; never resend blindly)
delivery  dc24fade-…  email  drill:delivery-sending-1
# Held outbox events: 47
```

The platform maintenance schedules and jobs (`platform.audit.checkpoint`, `platform.delivery.reconcile`) are
deliberately **not** held. Neither has an external effect, and both keep tamper-evidence and `sending`→`uncertain`
reconciliation running.

## Independent cross-checks (live `src` vs `dst`, synthetic-volume run, verbatim)

```
PASS  row counts src = dst (every table)                   105 tables (50 non-empty), 201020 rows
PASS  audit chain intact on dst (org 6af618b5…)            hub_audit_verify rows=0, checkpoints=1, head 99/657961de41f816e80f012… = src
PASS  hub_app without context sees nothing (dst)           organization/project/app_user/audit_event/workstream = 0/0/0/0/0
PASS  hub_app NOBYPASSRLS; append-only grants (dst)        bypassrls/super/audit UPDATE/vote DELETE = false/false/false/false
PASS  RLS policies / RLS tables src = dst                  101/99
PASS  indexes src = dst                                    263
PASS  object files sha256 src = dst                        404 files
PASS  no mass redelivery: held/uncertain/pushed/revoked    running:restore-hold:true queued:true uncertain sent true 0 true
PASS  reviewed job released back to queued                 queued:true:true
DRILL RESULT: PASS
```

## Backup manifest (standard run, excerpt)

```json
"app": { "version": "0.1.0", "gitCommit": "75e0ea461b4e249517cc016f92d770a532bfc80d" },
"database": { "serverVersion": "16.13", "dumpedAs": "hub_owner", "migrationsApplied": 1,
  "schemaHead": "d36a8f69…", "tables": 105, "rows": 1020,
  "dump": { "format": "custom", "bytes": 828776, "sha256": "a26830d1…" },
  "auditChainHeads": [ { "orgId": "86dd9a3d-…", "chainPos": 99, "headHash": "82d9fe58…", "rows": 99 } ] },
"objects": { "source": "local-dir", "files": 44, "bytes": 4700695, "checksums": "objects.sha256" },
"config": [ { "path": "config/.env.example", "sha256": "9297211c…" } ],
"secretsIncluded": false
```

## Defects found and fixed while building the drill

- `restore.sh` compared PostgreSQL booleans as `t`/`f`. Concatenating a boolean with `||` yields `true`/`false`. The first drill run failed at the role check; the comparisons were corrected.
- Holding `platform.*` schedules would have paused the audit checkpoint and delivery reconciliation for the hold period. These kinds are now exempt (`--hold-exempt-prefix`, default `platform.`).

## Not covered by this drill (open)

| Gap | Why | Operator action |
|---|---|---|
| S3-compatible object storage | The S3 adapter is *Not configured* at this commit. `backup.sh --s3-uri` (mc/aws) was **not executed** | Re-run the drill with MinIO/Ceph once the adapter exists: `backup.sh --s3-uri s3://<bucket>` |
| PITR (base backup + WAL) | Logical dumps only. PITR belongs to Mobily's PostgreSQL platform or operator | Test PITR with the DBA team; the quiesce/verify steps of `restore.sh` still apply afterwards |
| Re-applying access revocations made after the backup point | Needs the external audit export (SIEM). The audit export job is not implemented | Procedure in [backup-restore.md](backup-restore.md) §Reconciliation |
| Production volumes, network storage, encryption at rest | Sandbox only | Measure on Mobily infrastructure (sizing-and-load-test.md) |
