# ADR-0004 — Durable jobs, schedules and outbox in PostgreSQL (no Redis dependency)

- Status: Accepted · Date: 2026-09-29
- Requirements: spec §12.4, §13 ("Redis/BullMQ or an approved reliable internal alternative documented in an ADR"), AT-19, AT-20, AT-23

## Decision
Use PostgreSQL tables instead of Redis/BullMQ:
- `outbox_event` — written in the same transaction as the business change (transactional outbox).
- `job` — durable queue; workers claim with `FOR UPDATE SKIP LOCKED`, lease via `locked_until`, retry with exponential
  backoff, `dead` after `max_attempts`; `idempotency_key` unique.
- `scheduled_job` — cron + IANA timezone (e.g. 07:30 Asia/Riyadh); the scheduler enqueues one job per due slot using an
  idempotency key `schedule:<id>:<slot>` so restarts/replicas never double-enqueue.
- `delivery_record` — side-effect ledger. A row with status `sending` is written and committed *before* an external
  side effect; after a crash, `sending` rows become `uncertain` and are reconciled, never blindly re-sent (AT-20).

## Rationale
One fewer stateful component to host, secure, back up and restore inside Mobily; enqueue is atomic with the business
change; backup/restore of one database restores queue state consistently (AT-23: restore marks in-flight jobs for
reconciliation rather than mass redelivery).

## Consequences
- Throughput ceiling far above expected load (committee/program management: tens–hundreds of users). If needed later,
  a BullMQ adapter can replace the queue behind the `JobQueue` interface.
- These infrastructure tables are exempt from RLS; payloads contain ids only and every job re-enters a project-scoped
  context (with fresh authorization of the human principal) before reading business data.

## Amendments after the P0 architecture review
- **Fencing (ARCH-08):** `complete`/`fail`/`extendLease` update only `WHERE id = ? AND locked_by = ? AND attempts = ?`; a
  worker whose lease expired and was taken over cannot overwrite the new owner's state. Long jobs call `extendLease`
  (heartbeat). Expired leases of jobs with no attempts left are dead-lettered instead of re-run; backoff has ±25% jitter.
- **Authorization in jobs (ARCH-09):** `JobContextFactory.forUser(userId, projectId)` re-resolves the human principal at
  execution time (null → skip the user-facing effect); `forService(...)` gives a service principal with an explicit
  permission allowlist (deny by default).
- **Deliveries (AT-20):** `DeliveryService` ledger (`sending` committed before the external call → `sent`/`failed`;
  crash leaves `sending` → reconciled to `uncertain`, never blindly re-sent).
- **Outbox events with no subscriber** are marked dispatched (not replayed for subscribers added later) — acceptable
  because subscribers are code-defined; replay is an operator action (re-emit) if a new subscriber needs history.
- **Missed schedule slots:** the next run is computed from "now" after an outage (no burst catch-up); the catch-up
  decision is left to the job (e.g. the daily briefing covers the whole period since its last successful run).
- **Shutdown:** the worker drains the in-flight iteration before closing.
