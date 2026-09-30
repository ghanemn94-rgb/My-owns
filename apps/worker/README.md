# @mth/worker

**Responsibility.** The separate background process (ADR-0008): the transactional-outbox relay, pg-boss job
handlers (idempotent, bounded retries with backoff, dead-letter queue `ops.failed`) and the scheduler
(cron in the configured business time zone, default `Asia/Riyadh`). It shares only the PostgreSQL database with the
API and never serves HTTP.

## P1 behaviour

- **Relay** (`src/relay.ts`): one transaction per event — `SELECT … FOR UPDATE SKIP LOCKED` on the oldest
  unpublished `outbox_event`, `boss.send` **inside the same transaction** (job id = outbox event id, `singletonKey` =
  idempotency key), then `published_at`. A replayed send is a no-op; concurrent relays never double-publish.
  An unroutable event gets `publish_attempts`/`last_error` and is parked after 10 attempts for an operator.
- **`transformation.created`** (`src/handlers.ts`): records the starter-automation request (REQ-S12-004 increment)
  as a `processed_message` ledger row plus one audit event (`actor_type = service`, on behalf of the creator), in one
  transaction. A duplicate delivery conflicts on the ledger key and does nothing. Methodology/forms/checklist
  instantiation arrives with the P2/P5 content.
- **Retry policy:** 5 retries from 10 s with exponential backoff, then `ops.failed` (kept 30 days).
- **Maintenance:** `maintenance.purge_expired` every 15 minutes (cron, business time zone) deletes expired or
  revoked sessions, expired OIDC login states and expired Idempotency-Key records. Not a business automation.

## Run

`node apps/worker/dist/main.js` (`pnpm --filter @mth/worker start`). Needs `NODE_ENV`, `DATABASE_URL` (as `mth_app`)
and optionally `DEFAULT_TIMEZONE`, `LOG_LEVEL`. pg-boss starts with `migrate=false`: run `mth-db migrate` first
(migration `0006` installs pg-boss schema version 25 as the owner role).

## Tests

`test/integration/**` (real PostgreSQL, one fresh database per file): relay idempotency, crash-between-send-and-mark,
concurrent relays, duplicate delivery, restart without job loss, dead-lettering, purge and schedule.

**Owner from P1:** backend-workflow-engineer.
