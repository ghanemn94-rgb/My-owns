# ADR-0008: Background jobs, transactional outbox, idempotency, retries, failure queue, scheduler

- **Status:** Proposed for DG1. **Date:** 2026-09-30. **Author:** solution-architect.
- **Requirements:** REQ-S16-005, REQ-S12-004 (P1 increment), REQ-S20-013 (A13 increment), master prompt §12.

## Decision

1. **Queue: pg-boss 11.0.0** (MIT) [UNVERIFIED; confirm the latest 11.x patch and its PostgreSQL/Node floor], running on the product PostgreSQL. There is **no separate queue service** (§16: add one only if justified). The features we use:
   - retry limit and exponential backoff (bounded retries);
   - **dead-letter queue** (`ops.failed`, the operational failure queue);
   - `singletonKey` (de-duplication by idempotency key);
   - job expiry and retention of completed/failed jobs (execution history in the DB);
   - **cron schedules with a time zone** (`Asia/Riyadh` by default).
2. **Transactional outbox.**
   - Business writes insert an `outbox_event` row in the same transaction as the record and its audit event: `event_type`, `schema_version`, a `payload` validated by the zod schema for that event type, and a unique `idempotency_key`.
   - The worker's **relay** runs `SELECT … FOR UPDATE SKIP LOCKED` on unpublished rows in `seq` order, then `boss.send(queue, payload, { singletonKey: idempotency_key, retryLimit, retryBackoff, deadLetter })`, then sets `published_at`.
   - A crash between send and mark is safe, because of the singleton key and the consumer ledger below.
3. **Idempotent consumers.** Each handler runs its effects and inserts `(consumer, idempotency_key)` into **`processed_message`** in one transaction. The primary key conflict makes a redelivery a no-op. This prevents duplicate reminders, actions and approvals after retries or restarts (§12).
4. **Bounded retry:** 5 attempts, starting at a 10 s delay with exponential backoff. After that the job goes to `ops.failed`, with the error and attempt history retained. The admin UI (P4/P6) shows the last success, next run and failures, and offers a retry action. Retrying is audited.
5. **Scheduler.**
   - pg-boss `schedule(name, cron, data, { tz })`. The schedule rows live in the DB, so restarts keep them.
   - P1 registers one maintenance schedule: purge expired sessions and login states. It is not a business automation.
   - **Working-day calendar (later, P3/P4):** SLA and "business-day" timing use an organization calendar (workweek, holidays, from configuration) in `Asia/Riyadh`. Holidays are never hard-coded, and elapsed calendar days are never used where working days are specified (§10). Cron handles *when to wake up*; the calendar service computes *due dates*.
6. **Service identity.** Jobs run as a constrained service principal (`actor_type = 'service'`) scoped to the rule. Business-originated jobs carry the initiating user as `on_behalf_of`. Service principals can never approve or validate (ADR-0006).
7. **P1 scope:**
   - the relay;
   - the queue `transformation.created`, whose handler records a starter-automation request (idempotently) and the audit event. The actual instantiation of methodology, forms, checklist and tasks arrives with the P2/P5 content;
   - the dead-letter queue;
   - the session-purge schedule.

   This gives QA A13's first cases: a duplicate delivery produces no duplicate effect, a restart loses no jobs, and a forced failure lands in `ops.failed`.

## Alternatives

- **graphile-worker (MIT).** Excellent throughput and job keys, but no dead-letter queue built in, and cron time-zone handling is less direct. Either would work; pg-boss maps more directly onto the §12 vocabulary.
- **BullMQ.** Needs Redis, an extra mandatory service. Rejected.
- **A hand-written queue.** More code to maintain and prove.

## Consequences

- pg-boss owns the `pgboss` schema and upgrades it itself. Our migration CLI installs it as the owner role (ADR-0003), and upgrades are tested in CI on a fresh DB and on a DB at the previous version.
- The outbox and ledger tables are ours (see the data dictionary).

## Verification evidence

| Item | Pinned | Licence | Evidence |
|---|---|---|---|
| pg-boss | 11.0.0 | MIT | [UNVERIFIED] |
