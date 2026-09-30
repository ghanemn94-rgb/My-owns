# @mth/worker

**Responsibility.** The separate background process (ADR-0008): the transactional-outbox relay, pg-boss job
handlers (idempotent, bounded retries with backoff, dead-letter queue `ops.failed`) and the scheduler
(cron with `Asia/Riyadh` time zone). It shares only the PostgreSQL database with the API and never serves HTTP
except an optional internal health port.

P1 delivers the relay and the `transformation.created` handler (starter-automation request, REQ-S12-004 increment)
with the idempotency ledger (`processed_message`), enough for acceptance test A13's first cases.

**Owner from P1:** backend-workflow-engineer.
