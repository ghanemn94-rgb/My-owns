# Backup and restore (AT-23, threat model C-34 / DF-11)

Scripts (all in `scripts/ops/`):

| Script | Purpose |
|---|---|
| `backup.sh` | Consistent logical backup of the database, object storage and non-secret configuration, with a manifest |
| `restore.sh` | Restore into an **empty** database; quiesce side effects; verify |
| `restore-drill.sh` | End-to-end drill against local scratch databases |

The drill was executed in the build environment. Results: [restore-drill-results.md](restore-drill-results.md).

## 1. RPO / RTO — PROPOSALS pending Mobily approval (MQ-09)

| Target | Proposal | Basis | Requires |
|---|---|---|---|
| **RPO** (data loss) | ≤ 15 minutes for the database; ≤ 24 hours for objects without replication, ≤ 15 minutes with bucket versioning/replication | Continuous WAL archiving (PITR) on Mobily's PostgreSQL platform, plus nightly `backup.sh` logical dumps as an independent, portable copy | DBA platform with WAL archiving; object-storage versioning; backup store |
| **RTO** (time to a verified, usable service) | ≤ 4 hours for a full environment rebuild; ≤ 1 hour for a database-only restore | Measured drill: 2.85 s (1,020 rows) and 8.26 s (201,020 rows / 171 MB backup) from start to verified on a 4-vCPU sandbox. That is **far below** the proposal, but production volume, network storage, decryption, approvals and reconciliation dominate | A timed drill on Mobily infrastructure with production-like volume, repeated after major data growth |
| Retention | Daily × 35, monthly × 12. Legal hold follows Records Management (MQ-20) | Proposal | Records Management / Legal |
| Immutability | At least one copy immutable (object lock / WORM) or offline, against ransomware (T-49) | Proposal | Storage / Cybersecurity |

These are **proposals, not commitments**. They become targets only after approval by IT Operations and
Cybersecurity, with measured evidence from Mobily's environment.

## 2. What is backed up (consistently)

| Asset | How | Consistency |
|---|---|---|
| Database (everything: business data, permissions, approval evidence, audit hash chain, history, indexes, RLS policies, grants, triggers, functions) | `pg_dump -Fc` from an **exported REPEATABLE READ snapshot**. Row counts, schema-object counts and audit chain heads are computed **in the same snapshot** | Transactionally consistent |
| Object storage (document versions, quarantine) | Local directory copy or `aws s3 sync` / `mc mirror` (`--s3-uri`), plus `objects.sha256` | Taken **after** the dump. Objects are immutable and never hard-deleted (ADR-0010), so every object referenced by the dump exists in the copy |
| Configuration | `--config` copies of the non-secret deployed values (for example `helm get values hub -o yaml`), with checksums | Secrets are excluded (refused if detected); the Secret **names** are in the values |
| Post-migrate SQL | Copied from the release that produced the schema | Re-applied on restore (grants, RLS and database-level ACLs are not fully in `pg_dump`) |
| Roles | `roles.txt` documents the security attributes of `hub_owner`/`hub_app` (no passwords) | Roles are cluster-global. The DBA recreates them; `restore.sh` verifies `hub_app` is `NOSUPERUSER NOBYPASSRLS` |

`manifest.json` records: app version and git commit, schema head (last migration hash), PostgreSQL and pg_dump
versions, snapshot id, tables and rows, dump size and sha256, object count and bytes, config checksums,
`secretsIncluded: false`, and durations. `SHA256SUMS` covers every file.

### Nightly backup (example Job, NOT EXECUTED)

Run `backup.sh` from a hardened ops image, or from the DBA's backup host, containing `postgresql-client-16`,
`bash`, `coreutils` and `mc`/`aws`. The connection comes from a Secret, **without the password in the URL**
(`PGPASSWORD`/`PGPASSFILE`). Write the output to an encrypted, access-controlled volume or pipe it to the approved
backup platform:

```bash
DATABASE_BACKUP_URL="postgres://hub_owner@db.internal:5432/hub?sslmode=verify-full" PGPASSFILE=/secrets/pgpass \
  scripts/ops/backup.sh --out /backups/hub-$(date -u +%Y%m%dT%H%MZ) --s3-uri s3://hub-objects \
  --config /config/values-prod-inputs.yaml --label nightly
```

The role must own the tables (`hub_owner`) or be a DBA backup role with `BYPASSRLS`. With any other role the dump
**fails** rather than silently exporting an RLS-filtered subset (`row_security=off`).

## 3. Restore procedure

Only a named operator performs a restore, under an approved change or incident record (IR runbook §6).

1. **Decide the restore point** and record why. Take a forensic snapshot of the current state first if this is an incident (IR runbook §1).
2. **Stop writers.** Scale api and worker to 0: `kubectl scale deploy/hub-api deploy/hub-worker --replicas=0`. Keep the worker at 0 until step 7.
3. **Prepare an empty target database** owned by `hub_owner` (a new database, or drop and recreate), with the extensions and both roles present. `restore.sh` refuses a non-empty target.
4. **Restore and verify:**
   ```bash
   DATABASE_RESTORE_URL="postgres://hub_owner@db.internal:5432/hub_restored" \
     scripts/ops/restore.sh --from /backups/hub-… --objects-dir /restore/objects \
     --verify-app-url "postgres://hub_app@db.internal:5432/hub_restored" --report restore-report.txt
   ```
   The script:
   1. verifies `SHA256SUMS`, then checks the target is empty and that the extensions and roles are present (`hub_app` must be NOBYPASSRLS);
   2. runs `pg_restore` (single transaction; `--jobs N` for large databases);
   3. re-applies the post-migrate SQL;
   4. quiesces side effects (below);
   5. restores and verifies objects, and cross-checks `document_version.sha256`;
   6. verifies per-table row counts against the backup snapshot, schema-object counts, the audit chain (`hub_audit_verify` = 0 breaks and chain heads = backup), the runtime-role grants, and RLS as the runtime role (0 rows without context);
   7. writes a report with **measured durations**.

   It exits non-zero if any check fails.

   For S3 storage, copy the backup's `objects/` into the (new, empty) bucket with `mc mirror`/`aws s3 sync` and verify against `objects.sha256`.
5. **Point the release at the restored database** (update the Secrets if the database name changed) and start **api only**. Sessions were revoked, so every user signs in again at the IdP.
6. **Reconcile** (next section) before any job is released.
7. **Start the worker** after the review. Release held jobs as decided.

### Quiesce: how mass redelivery is avoided (ADR-0004, T-48)

| Item at the backup point | Action by `restore.sh` | Why |
|---|---|---|
| `delivery_record.status = 'sending'` | → `uncertain`, with a note | The external send may or may not have happened. It is reconciled with the provider/recipient and **never resent blindly** (AT-20) |
| `job.status = 'running'` | **Held**: `locked_by='restore-hold'`, `locked_until='infinity'`; the original state is kept in `result.restoreHold` | The worker cannot claim it (lease never expires) and does not dead-letter it. It goes back to `queued` **only after review** |
| `job.status = 'queued'` | **Held**: `run_at='infinity'`; the original `run_at` is kept in `result.restoreHold` | Work queued before the backup may already have run in the lost window |
| `outbox_event` undispatched | **Held**: `dispatched_at='infinity'`, marker `[restore-hold]` in `last_error` | Dispatch would create new jobs for events whose effects may already have happened |
| `scheduled_job` due before now + hold | `next_run_at = now() + --schedule-hold-minutes` (default 60) | No burst of catch-up runs at start-up |
| `session` active | Revoked (`revoked_reason='restore <id>'`) | A restore must not resurrect sessions (C-34) |
| Kinds `platform.*` (audit checkpoint, delivery reconcile) | **Not held** (`--hold-exempt-prefix`) | No external effect. They keep tamper-evidence and `sending`→`uncertain` reconciliation running |

### Reconciliation (before users and the worker return)

1. **Access revocations after the backup point** (residual risk RR-10). From the external audit export/SIEM, list every access revocation, role removal, room lock, disclosure withdrawal and user deactivation recorded between the backup point and the incident, and re-apply them in the application. *The audit export job is not implemented yet. Until it exists, use the SIEM copy of the application logs and the IdP's own records.*
2. **Held jobs** (the review list is in the restore report). For each job, decide whether its effect already happened after the backup point (check delivery logs, recipients, the SIEM):
   - release it: `scripts/ops/restore.sh --release-held --job-ids <id,…>`, or `--all` after a full review;
   - or cancel it: `scripts/ops/restore.sh --cancel-held --job-ids <id,…>`.
3. **Uncertain deliveries.** Confirm with the mail/Teams provider logs. Record the outcome. Never resend automatically.
4. **Outbox:** `--release-held --outbox` (or `--all`) once the business owner accepts re-dispatching the listed events.
5. **Business changes lost after the backup point** (decisions, approvals, evidence) are re-entered by their owners from source records. The audit trail shows the gap.

## 4. Drill schedule (proposal)

- Monthly: `restore.sh` of the latest nightly backup into a scratch database in the **test** environment, with the report archived.
- Quarterly: a full-environment restore (DB + objects + configuration) timed against the RTO proposal, including the reconciliation steps.
- CI runs `scripts/ops/restore-drill.sh` on every change to the scripts, against a PostgreSQL 16 service container (job `restore-drill`).

## 5. Known limits

- Logical dumps do not give point-in-time recovery. PITR must come from the PostgreSQL platform. After a PITR restore, still run `restore.sh`'s quiesce and verification, or the equivalent SQL.
- The audit chain is tamper-*evident* within the database only. A consistent rewrite by a superuser before a backup is not detectable without the external checkpoint export (ADR-0014).
- The S3 path (`--s3-uri`) was **NOT EXECUTED** (no S3 endpoint; the adapter is not implemented).
