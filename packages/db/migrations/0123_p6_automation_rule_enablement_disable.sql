-- 0123 P6 pre-freeze repair: the automation rule version in force at an event's occurrence (T-DG6-BE-X10; D-204,
-- extending D-203; ADR-0043 §2). Authored by backend-workflow-engineer. Runs as mth_owner inside one transaction opened
-- by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16. Id: the next above the highest
-- shipped file on this branch (0122, D-196 item 2); the orchestrator renumbers at merge if another task shipped a higher
-- id first.
--
-- D-204: "evaluate a late event against the version that was effective and enabled at its occurrence time, found from
-- the automation_rule_enablement ledger (0122). An event that occurred while the rule was disabled is never acted on
-- (D-203 unchanged)." The 0122 ledger records when a rule BECOMES enabled (enable) and when the effective version of an
-- enabled rule changes (a publish while enabled), but not when it is DISABLED, so the state at an arbitrary past
-- instant cannot be read from it. This migration completes the ledger so that its rows form the full interval history
-- of (enabled version | disabled) per rule:
--   * the trigger also writes a row when an enabled rule is disabled (source 'disable'; the version is the one that
--     stopped, OLD.effective_version_id, never NULL because automation_rule_enabled_needs_version holds for OLD);
--   * past disables after the rule's first ledger row are backfilled from their own audit events (source
--     'backfill_disable'; automation_rule.disable is written by apps/api rules.ts setEnabled in the same transaction as
--     the disabling update, and audit_event.occurred_at defaults to that transaction's now(), the same instant the
--     trigger would have stored). Nothing uses the migration's own clock.
-- The engine (apps/worker/src/automation/engine.ts `candidates`) takes, per rule, the newest ledger row at or before the
-- event's stored occurrence time (outbox_event.created_at), ordered by (enabled_from, id): a disable row, or no row
-- (before the first enablement), means no candidate; otherwise that row's version is the version that evaluates the
-- event, whether it is still published or superseded since (0074 automation_execution_guard accepts both).
--
-- The ledger stays append-only (p2_attach_append_only from 0122), written only by the SECURITY DEFINER trigger, readable
-- (SELECT) by mth_app. Changing the CHECK and adding an index writes no row. No automation_rule row changes (no version
-- step, no audit event). Nothing here approves anything (no business approval, G1-G6), and nothing reads or writes
-- DG0-DG7.

ALTER TABLE automation_rule_enablement DROP CONSTRAINT automation_rule_enablement_source;
ALTER TABLE automation_rule_enablement ADD CONSTRAINT automation_rule_enablement_source
  CHECK (source IN ('enable', 'effective_version', 'backfill', 'disable', 'backfill_disable'));

-- The engine's lookup: the newest row of a rule at or before an instant.
CREATE INDEX automation_rule_enablement_rule_time_idx
  ON automation_rule_enablement (automation_rule_id, enabled_from DESC, id DESC);

-- Backfill: every recorded disable that follows a ledger row of the same rule (a disable before the rule's first ledger
-- row changes nothing: no row at an instant already means "not enabled"). The version is that of the newest row before
-- it; a disable that follows a disable (impossible through setEnabled, which writes nothing for a no-op) is skipped.
INSERT INTO automation_rule_enablement (id, automation_rule_id, automation_rule_version_id, enabled_from, source)
SELECT mth_uuid_v7(), a.record_id, prior.automation_rule_version_id, a.occurred_at, 'backfill_disable'
  FROM audit_event a
  CROSS JOIN LATERAL (
    SELECT e.automation_rule_version_id, e.source
      FROM automation_rule_enablement e
     WHERE e.automation_rule_id = a.record_id AND e.enabled_from <= a.occurred_at
     ORDER BY e.enabled_from DESC, e.id DESC
     LIMIT 1) prior
 WHERE a.record_type = 'automation_rule' AND a.action = 'automation_rule.disable'
   AND prior.source NOT IN ('disable', 'backfill_disable')
 ORDER BY a.occurred_at, a.seq;

CREATE OR REPLACE FUNCTION automation_rule_enablement_record() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.enabled AND NEW.effective_version_id IS NOT NULL AND (
       TG_OP = 'INSERT' OR NOT OLD.enabled OR NEW.effective_version_id IS DISTINCT FROM OLD.effective_version_id) THEN
    INSERT INTO automation_rule_enablement (id, automation_rule_id, automation_rule_version_id, enabled_from, source)
    VALUES (mth_uuid_v7(), NEW.id, NEW.effective_version_id, now(),
            CASE WHEN TG_OP = 'INSERT' OR NOT OLD.enabled THEN 'enable' ELSE 'effective_version' END);
  ELSIF TG_OP = 'UPDATE' AND OLD.enabled AND NOT NEW.enabled THEN
    INSERT INTO automation_rule_enablement (id, automation_rule_id, automation_rule_version_id, enabled_from, source)
    VALUES (mth_uuid_v7(), NEW.id, OLD.effective_version_id, now(), 'disable');
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION automation_rule_enablement_record() FROM PUBLIC;
