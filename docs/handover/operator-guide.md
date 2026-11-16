# Operator guide (day-two operation)

This guide is for the Mobily IT operators who run the hub after it is deployed. It covers starting and stopping it,
readiness, logs, the entry points for upgrades and backups, and the first steps in an incident. The Arabic summary is
[operator-guide.ar-summary.md](operator-guide.ar-summary.md); it also summarizes [backup-restore.md](backup-restore.md)
and [upgrades.md](upgrades.md). This English guide is the complete text.

Accepting this handover is a decision of Mobily IT, made outside the platform. This package is engineering evidence,
not that acceptance.

Compose is a reproducible install and test configuration, not evidence of high-availability readiness. The commands
below are given for Compose (`deploy/compose/compose.yaml`) and for the image's `mth` entry point. On another
orchestration platform, use its equivalent of each step.

## 1. Start {#start}

1. The database is up and reachable (`db` healthy in Compose).
2. `mth migrate` runs and exits 0. In Compose, the one-shot `migrate` service does this, and `api` and `worker`
   start only after it completed successfully.
3. Start `api` and `worker` (`docker compose up -d`, or `mth api` and `mth worker`).
4. Wait for readiness: `mth health /readyz` exits 0 ([Readiness](#readiness)).

A process that exits 78 at start has invalid configuration. The message names the variable, never its value. Fix the
setting from [deployment.md](deployment.md#configuration-keys) and start again.

## 2. Stop {#stop}

- Stop `api` first, then `worker` (`docker compose stop api worker`). On `SIGTERM` the API stops accepting
  connections, gives requests in flight 5 s to finish, then closes the database pool and exits 0
  ([health-readiness.md](../operations/health-readiness.md), "Shutdown and connection limits").
- Every job is idempotent: a job that runs again after an interruption does not repeat an effect that already
  completed ([automation-operations.md](automation-operations.md#how-jobs-run)).
- **Before a transfer export or an upgrade**, stop the worker and wait until no job is queued or active. Jobs still
  queued on the source do not travel in a migration package (ADR-0064 residual 3).
- Stop the database last, and only after `api`, `worker` and any `backup` run have stopped.

## 3. Readiness {#readiness}

- `/healthz` answers when the process runs. `/readyz` reports `database`, `migrations`, `storage` and `worker`.
- Readiness needs the database, the migrations and the evidence storage. The worker status is shown but does not stop
  the service from being ready.
- A load balancer should send traffic only to an API whose `/readyz` answers 200. A 503 `not_ready` names the failing
  check, never a path, endpoint or secret.
- When the evidence storage stops answering, the API logs
  `readiness: evidence storage (<driver>) did not answer the probe: <error code>` once, and
  `readiness: evidence storage (<driver>) answers again` when it recovers.
- `mth db status` exits 0 when the schema is up to date, 3 when migrations are pending and 4 on drift (a changed or
  unknown applied migration). Details: [health-readiness.md](../operations/health-readiness.md).

## 4. Logs {#logs}

- JSON lines on stdout from `api` and `worker` (`docker compose logs api worker`). Fields, redaction and alert lines
  are in [deployment.md](deployment.md#logging) and [monitoring.md](../operations/monitoring.md) §4.
- Look for `"alert": true` lines: each one is a new operational exception, also listed in Administration >
  Operations.
- The audit trail is in the database (`audit_event`), not in the logs. Read it in the product's audit screens.

## 5. Upgrades {#upgrades}

Every upgrade is a maintenance window; there is no online upgrade. The steps, the dry run on a restored copy
(`mth-db migrate --dry-run`), the migration catalogue (`migration-catalogue.json`) and rollback by restore are in
[upgrades.md](upgrades.md). Take a backup set before the window.

## 6. Backup and restore {#backup}

Backup sets, the restore into a fresh installation, the checks R1–R9 and the measured drill timings are in
[backup-restore.md](backup-restore.md). Secrets are never in a backup set: IT provides them again on restore. Recovery
objectives (RPO and RTO) are to be agreed with Mobily IT.

## 7. Jobs and schedules {#jobs}

Schedules, "run now", the failure queue, the worker heartbeat and the retention job are in
[automation-operations.md](automation-operations.md).

## 8. Incident first steps {#incident}

1. **Is the API ready?** `mth health /readyz`. If not, the body names the failing check:
   - `database: fail`: check the database is up, reachable from the API, and that the `mth_app` password in the
     secret file is current;
   - `migrations: fail`: run `mth db status`; pending migrations need `mth migrate`, drift needs investigation before
     anything else (never edit an applied migration);
   - `storage: fail`: check the evidence volume is mounted and writable, or that the object store answers and its
     credentials are bound ([storage.md](../operations/storage.md)).
2. **Is the worker alive?** The `worker` value of `/readyz`, or the heartbeat in Administration > Operations. `stale`
   or `unknown`: check the worker process, its logs and its database connection, then restart it.
3. **Is a job failing?** Administration > Automation > Failures: retry with the original key, or dismiss with a
   reason ([automation-operations.md](automation-operations.md#failure-queue)).
4. **Sign-in fails for everyone?** Check the identity provider's discovery document from the API host, the client
   secret file and the registered redirect URI `<origin>/api/v1/auth/callback`
   ([deployment.md](deployment.md#corporate-sso-mapping)).
5. **Data loss or corruption?** Stop `api` and `worker`, keep the database as it is, and restore the last good backup
   set into a fresh installation ([backup-restore.md](backup-restore.md)). Never restore over a live database.
6. Record what you did. The product's audit trail records every change made through the product; operating-system
   and database actions are recorded only in IT's own logs.

## Sources {#sources}

`deploy/compose/compose.yaml`; `docs/operations/health-readiness.md`, `monitoring.md` and `storage.md`;
[deployment.md](deployment.md); [backup-restore.md](backup-restore.md); [upgrades.md](upgrades.md);
[automation-operations.md](automation-operations.md); ADR-0064, ADR-0066, ADR-0068 and ADR-0069.
