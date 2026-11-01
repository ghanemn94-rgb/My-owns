-- 0122 P6 pre-freeze repair: the moment an automation rule's effective version became enabled (T-DG6-BE-X9; D-203
-- O-2; ADR-0043 §2). Authored by backend-workflow-engineer. Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16. Id: the next above the highest
-- shipped file on this branch (0121, D-196 item 2); the orchestrator renumbers at merge if another task shipped a higher
-- id first.
--
-- D-203: "an automation rule applies only to events that occurred at or after the moment its effective version became
-- enabled". An event that is evaluated late (a backlog, a worker outage, a retry) is therefore never acted on by a rule
-- that was enabled after it occurred, so enabling a rule never acts on history. The engine
-- (apps/worker/src/automation/engine.ts `candidates`) compares the event's STORED occurrence time
-- (outbox_event.created_at) with the newest row of this table for the rule's current effective version.
--
-- automation_rule_enablement is an append-only ledger derived from automation_rule, written ONLY by the trigger below
-- (SECURITY DEFINER; the application role may only read it), in the same transaction as the audited rule update that
-- causes it (the enable, or the publish that moves effective_version_id of an enabled rule; that update already writes
-- its own audit event, so the ledger row is not audited separately: the 0098 record_sensitivity_change pattern). A row
-- is written when a rule becomes enabled (INSERT of an enabled rule, or enabled false -> true) and when the effective
-- version of an enabled rule changes. A disabled rule writes nothing; re-enabling writes a new row, so the newest row of
-- the current effective version is always the moment it last became enabled.
--
-- Backfill (one row per rule enabled now; source 'backfill'): the latest of the effective version's published_at, the
-- newest automation_rule.enable audit event of the rule, and the rule's created_at (a seeded starter is created
-- enabled). Every such time is stored; nothing uses the migration's own clock. No automation_rule row changes (no
-- version step, no audit event), and nothing here approves anything (no business approval, G1-G6), and nothing reads or
-- writes DG0-DG7.

CREATE TABLE automation_rule_enablement (
  id                         uuid PRIMARY KEY,
  automation_rule_id         uuid NOT NULL REFERENCES automation_rule (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  automation_rule_version_id uuid NOT NULL,
  enabled_from               timestamptz NOT NULL,
  source                     text NOT NULL CONSTRAINT automation_rule_enablement_source
                               CHECK (source IN ('enable', 'effective_version', 'backfill')),
  -- Deferred like automation_rule's own effective-version key: a seeded starter and its version 1 reference each other.
  CONSTRAINT automation_rule_enablement_version_fkey FOREIGN KEY (automation_rule_id, automation_rule_version_id)
    REFERENCES automation_rule_version (automation_rule_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
    DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX automation_rule_enablement_rule_idx
  ON automation_rule_enablement (automation_rule_id, automation_rule_version_id, enabled_from DESC);

INSERT INTO automation_rule_enablement (id, automation_rule_id, automation_rule_version_id, enabled_from, source)
SELECT mth_uuid_v7(), r.id, r.effective_version_id,
       GREATEST(v.published_at,
                (SELECT max(a.occurred_at) FROM audit_event a
                  WHERE a.record_type = 'automation_rule' AND a.record_id = r.id AND a.action = 'automation_rule.enable'),
                r.created_at),
       'backfill'
  FROM automation_rule r
  JOIN automation_rule_version v ON v.id = r.effective_version_id
 WHERE r.enabled;

SELECT p2_attach_append_only('automation_rule_enablement');
GRANT SELECT ON automation_rule_enablement TO mth_app;

CREATE FUNCTION automation_rule_enablement_record() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.enabled AND NEW.effective_version_id IS NOT NULL AND (
       TG_OP = 'INSERT' OR NOT OLD.enabled OR NEW.effective_version_id IS DISTINCT FROM OLD.effective_version_id) THEN
    INSERT INTO automation_rule_enablement (id, automation_rule_id, automation_rule_version_id, enabled_from, source)
    VALUES (mth_uuid_v7(), NEW.id, NEW.effective_version_id, now(),
            CASE WHEN TG_OP = 'INSERT' OR NOT OLD.enabled THEN 'enable' ELSE 'effective_version' END);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION automation_rule_enablement_record() FROM PUBLIC;
CREATE TRIGGER automation_rule_enablement_record AFTER INSERT OR UPDATE ON automation_rule
  FOR EACH ROW EXECUTE FUNCTION automation_rule_enablement_record();
