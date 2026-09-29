# ADR-0014 — Append-only audit with a hash chain (tamper-evident, not tamper-proof)

- Status: Accepted · Date: 2026-09-29
- Requirements: spec §14 ("Do not call a table in the same database tamper-proof"), AT-05, AT-27

## Decision
- `audit_event` records actor, time, action, entity, outcome (success/denied/error), reason, before/after,
  correlation id. Denied attempts (e.g. recused vote, non-waivable waiver) are audited too.
- The runtime role has INSERT/SELECT only; a trigger rejects UPDATE/DELETE for every role including the owner unless the
  trigger is dropped or disabled (`ALTER TABLE … DISABLE TRIGGER`, which requires owner/DDL privileges and is visible in
  DDL/statement logs).
- A BEFORE INSERT trigger chains rows per organization (`chain_pos`, `prev_hash`, `hash` = SHA-256 over the row and the
  previous hash) under a transaction-scoped advisory lock; `hub_audit_verify(org)` detects breaks.
- The trigger sets `created_at` itself and rejects rows whose `actor_user_id` differs from the session user or whose
  organization differs from the session organization (ARCH-05). A statement-level trigger rejects `TRUNCATE`.
- `hub_audit_checkpoint(org)` records the chain head every 15 minutes (worker job `platform.audit.checkpoint`, scheduled
  per organization at worker start / bootstrap / demo seed); `hub_audit_verify` also fails when a
  checkpointed row is missing or altered, so truncating the tail back past a checkpoint is detectable. Checkpoints
  should be exported to the external log store (P7) — a checkpoint table in the same database can itself be altered
  by the owner.
- **Limits:** the owner role can `ALTER TABLE … DISABLE TRIGGER` and a database superuser can rewrite the chain and the
  checkpoints consistently. Stronger guarantees require
  exporting audit events to an independent, write-once log store (SIEM/WORM storage) — provided as an export job and
  documented for Mobily's SIEM team. The per-org advisory lock serializes audit inserts; acceptable at expected load,
  with asynchronous sealing as the documented alternative if contention appears in load tests.

## Amendments after the P0 architecture RE-review (ARCH-05 residual, ARCH-16)
- Checkpoints are written only through `hub_audit_checkpoint()` (SECURITY DEFINER); the runtime role has no
  INSERT/UPDATE/DELETE on `audit_checkpoint`, so it cannot forge checkpoints to raise false alarms.
- `hub_audit_checkpoint` / `hub_audit_verify` act only on the session organization for the runtime role; operators
  (owner role, no session context) may run them for any organization.
- Rows with `actor_kind` `service`/`system` may not name a human actor other than the session user.
- Residual window: rows appended after the most recent checkpoint (≤ 15 min) can be removed by the owner role without
  detection inside this database — the external export (P7) closes that window.
