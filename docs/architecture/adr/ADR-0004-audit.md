# ADR-0004: Append-only audit

- **Status:** Proposed for DG1. **Date:** 2026-09-30. **Author:** solution-architect.
- **Requirements:** REQ-S16-032, REQ-S16-023, REQ-DLV-033 (audit baseline), REQ-S10-010 (delegated identity).

## Decision

1. **One table, `audit_event`**, written in the **same transaction** as the mutation it describes. If the audit insert fails, the mutation rolls back. Columns (full definition in `data-dictionary.md`):
   - `id` (UUIDv7) and `seq bigint GENERATED ALWAYS AS IDENTITY` (total order);
   - `occurred_at timestamptz`;
   - `organization_id`, plus `transformation_id` for scoped audit reads;
   - actor: `actor_type` (user | service | system), `actor_user_id`, `on_behalf_of_user_id` (delegation: "B on behalf of A");
   - `action` (e.g. `transformation.update`), `record_type`, `record_id`;
   - `prior_version`, `new_version`;
   - `reason` (mandatory for archive, revoke and similar actions);
   - `request_id`;
   - `source` (api | worker | migration | cli);
   - `changes jsonb`: a validated field diff `{field: {from, to}}`. Secrets and session tokens are never included; a per-record-type allow-list defines the fields.
2. **Protection from ordinary modification**:
   - A trigger `audit_event_immutable` runs `BEFORE UPDATE OR DELETE` (row-level) and `BEFORE TRUNCATE` (statement-level) and raises an exception.
   - **Privileges:** `mth_app` has only `INSERT, SELECT` on `audit_event` and `USAGE` on its sequence. `REVOKE UPDATE, DELETE, TRUNCATE … FROM PUBLIC, mth_app`.
   - The table owner (`mth_owner`) is used only by migrations. It could technically drop the trigger, which is why owner credentials are an IT-held secret, separate from the app's. This is documented as residual risk. Tamper evidence such as a hash chain is a later option for P6 if IT requires it.
   - Integration tests prove that, as `mth_app`, `UPDATE`, `DELETE` and `TRUNCATE` on `audit_event` fail, and that the trigger also blocks them for the owner.
3. **Coverage rule:** every mutation (create, update, archive, revoke, assign, login/logout, dev-login, failed authorization of a *mutation*) writes exactly one audit event. Reads are not audited in P1; audited reads of sensitive records come later.
   - Security events (login success or failure, session revocation) use `record_type = 'session'` or `'app_user'`.
4. **Reading:**
   - `GET /api/v1/transformations/{id}/audit` needs `audit.read` on that transformation. It returns events where `transformation_id = id`, newest first, with cursor pagination on `seq`.
   - Technical admins do not get business audit trails (permissions matrix: ADM sees technical events only).
5. **Writer API:** `audit.record(tx, event)` in the `audit` module is the only insert path. It takes the transaction handle, so it cannot be called outside one.

## Alternatives

- **Trigger-generated audit (row triggers on every table).** It cannot capture the actor, reason or request ID without session variables, and it logs noise. Rejected in favour of explicit application events. A DB trigger is still used for *protection*.
- **External log store.** An extra mandatory service; the audit must be restorable with the database (§19 item 9).

## Consequences

- Every repository function that mutates takes a transaction and an audit context `{actor, onBehalfOf, requestId, reason}`.
- Tests assert one audit row per mutation with the right versions (CLAUDE.md engineering conventions).

## Verification evidence

This is a design decision with no third-party dependency. Verification is by the integration tests listed in point 2 (T-DG1-BE) and by QA's A14/A12 suites.
