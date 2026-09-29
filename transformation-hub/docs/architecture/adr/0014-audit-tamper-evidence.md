# ADR-0014 — Append-only audit with a hash chain (tamper-evident, not tamper-proof)

- Status: Accepted · Date: 2026-09-29
- Requirements: spec §14 ("Do not call a table in the same database tamper-proof"), AT-05, AT-27

## Decision
- `audit_event` records actor, time, action, entity, outcome (success/denied/error), reason, before/after,
  correlation id. Denied attempts (e.g. recused vote, non-waivable waiver) are audited too.
- The runtime role has INSERT/SELECT only; a trigger rejects UPDATE/DELETE for every role including the owner unless the
  trigger is dropped (which requires DDL privileges and is itself visible in DDL logs).
- A BEFORE INSERT trigger chains rows per organization (`chain_pos`, `prev_hash`, `hash` = SHA-256 over the row and the
  previous hash) under a transaction-scoped advisory lock; `hub_audit_verify(org)` detects breaks.
- **Limits:** a database superuser can disable triggers and rewrite the chain consistently. Stronger guarantees require
  exporting audit events to an independent, write-once log store (SIEM/WORM storage) — provided as an export job and
  documented for Mobily's SIEM team. The per-org advisory lock serializes audit inserts; acceptable at expected load,
  with asynchronous sealing as the documented alternative if contention appears in load tests.
