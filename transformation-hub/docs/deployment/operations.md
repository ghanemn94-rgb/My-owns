# Operations and monitoring

Incident handling follows `docs/security/incident-response-runbook.md`, which is subordinate to Mobily's CSIRT/SOC
process. This page covers routine operation.

## Health

| Component | Probe | Meaning |
|---|---|---|
| api | `GET /healthz` (liveness, startup) | Process is serving HTTP |
| api | `GET /readyz` (readiness) | PostgreSQL reachable (`select 1`). 503 while the DB is unavailable. Pods leave the Service until it recovers |
| worker | exec `node /app/hub-entrypoint.cjs healthcheck worker` every 60 s | Can connect to PostgreSQL with the runtime role. **Limitation:** this does not prove the loop is ticking. A heartbeat file is proposed (below) |
| web | `GET /login` (readiness/startup), TCP (liveness) | Next.js server responds |
| Containers | Docker `HEALTHCHECK` in both images (the same entrypoint probe; role auto-detected from PID 1) | Compose / plain Docker only. Kubernetes uses the probes above |

`/healthz` and `/readyz` are not routed through the ingress (only `/api` and `/` are).

Verified in the build environment by running the API image layout locally: `healthcheck api` exits 0 on a live API
and 1 on a wrong port; `healthcheck worker` exits 0 with valid credentials and 1 with wrong ones.

## Logs

- The api and worker log to stdout, with correlation id (`x-correlation-id`) on requests and jobs. JSON logs in production are part of ADR-0016 (P7 implementation). Collect stdout with the cluster log agent and forward to Mobily's SIEM (MQ-10).
- Logs must never contain secrets, SQL parameters, tokens or document content (ADR-0016). The ops scripts redact connection URLs.
- Keep `HUB_LOG_LEVEL=info`. Raising it to `debug` needs a change record and a time limit.

## Metrics and tracing

- OpenTelemetry to an **internal** collector only (`otel.enabled`, `otel.endpoint`). The chart sets the standard `OTEL_*` variables. **The Node SDK is not wired in yet (ADR-0016, P7), so no traces or metrics are emitted today.**
- Until then, use the platform's metrics (CPU, memory, restarts, probe failures) and the database's (connections, locks, slow queries — `pg_stat_statements` if enabled by the DBA).

## Queue, jobs and dead letters (ADR-0004)

The queue lives in PostgreSQL. Operators with read access to the infrastructure tables can use:

```sql
-- queue depth and age by kind
select kind, status, count(*), min(run_at) as oldest_run_at from job
 where status in ('queued','running') group by 1,2 order by 3 desc;
-- dead letters (jobs that exhausted retries or had a lease expire after the final attempt)
select id, kind, attempts, last_error, finished_at from job where status = 'dead' order by finished_at desc limit 50;
-- undispatched outbox backlog
select count(*), min(created_at) from outbox_event where dispatched_at is null;
-- deliveries needing reconciliation (never resent automatically, AT-20)
select id, channel, idempotency_key, updated_at from delivery_record where status = 'uncertain';
-- schedules and their last outcome
select kind, name, cron, timezone, next_run_at, last_run_at, last_status, left(last_error, 120) from scheduled_job where enabled;
```

| Signal | Proposed threshold (tune with SOC) | Action |
|---|---|---|
| Oldest `queued` job older than 15 min | alert | Check worker pods and logs; scale the worker (claims use `SKIP LOCKED`, so replicas are safe) |
| `dead` jobs increasing | any new | Inspect `last_error`; fix the cause. Re-queue only after review: `update job set status='queued', attempts=0, run_at=now() where id=…` under a change record |
| `uncertain` deliveries | any | Reconcile with the provider (mail/Teams logs). Mark the outcome. Never blind-resend |
| Outbox backlog older than 5 min | alert | Worker not dispatching |
| `platform.audit.checkpoint` `last_status <> 'succeeded'` | any | Audit tamper-evidence checkpoints are stale. Investigate immediately |
| `/readyz` failing | > 2 min | Database connectivity or capacity |

**Proposed (lead-owned) improvements:**

- a worker heartbeat file (`HUB_WORKER_HEARTBEAT_FILE`, written each tick; the entrypoint probe already honours it);
- a metrics endpoint with queue depth and last tick (ADR-0016);
- `HUB_JOBS_PAUSED` / `HUB_READ_ONLY` switches (IR runbook CA-14 / CA-15);
- a first-class `held` job status in place of the restore-hold convention.

## Audit export to the SIEM

- `audit_event` is append-only and hash-chained. `platform.audit.checkpoint` records the chain head every 15 minutes (created at worker start and by the bootstrap).
- **Export to an independent store is required for stronger guarantees** (ADR-0014). The audit export job is **not implemented yet**. Until it is, the SIEM receives application logs only. Proposed design: a worker job that ships new audit rows (minimised payloads, C-11) plus each checkpoint `(org, chain_pos, hash, row_count)` to the SIEM/WORM store over an approved flow (N-10), so a later `hub_audit_verify` can be compared with the external anchor.
- Integrity check on demand: an auditor calls `audit.chain.verify` in the application, or a DBA runs `select * from hub_audit_verify('<org uuid>')` as the owner. No rows means the chain is intact.

## Capacity housekeeping

- The `job`, `outbox_event` and `delivery_record` tables grow. A retention job is proposed; until then, have the DBA archive `succeeded` jobs and dispatched outbox rows older than 90 days, under the retention policy (MQ-20).
- Database connection budget: (api replicas + worker replicas) × `DATABASE_POOL_MAX` must stay below the role's connection limit.

## Routine tasks

| Task | Frequency | Reference |
|---|---|---|
| Backup verification (`restore.sh` into scratch) | monthly | [backup-restore.md](backup-restore.md) |
| Image rebuild on base-image CVEs; dependency updates | monthly or on advisory | [supply-chain.md](supply-chain.md) |
| Secret rotation | per [secrets.md](secrets.md) | |
| Access review (role assignments, room grants, external users) | quarterly | [user-provisioning.md](user-provisioning.md) |
| Incident-response tabletop and containment test (SEC-T-47) | before P7 gate, then yearly | IR runbook |
