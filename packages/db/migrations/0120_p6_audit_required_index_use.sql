-- 0120 P6 slice G: the deferred audit check uses audit_event_record_idx again (T-DG6-BE-S; ADR-0058 §6 "BE-S adds
-- only indexes or query fixes that evidence names"; REQ-S20-029; p6-work-split §H/G.9 and §H/G.11). Authored by
-- backend-workflow-engineer. Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never
-- edit once merged. SQL floor: PostgreSQL 16. Id: the next above the highest shipped file on this branch (0118,
-- D-196 item 2); the orchestrator renumbers at merge if another task shipped a higher id first.
--
-- Evidence (DO-F run-1, docs/delivery/handbacks/DG6/T-DG6-DO-F-evidence/load/run-1/explain/
-- createExport.explain-digest-all-statements.md, statement 3): the NOT EXISTS of 0010's p2_audit_required compares the
-- text column audit_event.record_type with TG_TABLE_NAME, whose type is `name` (collation "C"). Neither that text = name
-- comparison nor a plain TG_TABLE_NAME::text (which keeps the "C" collation of `name`) matches the column's default
-- collation, so the planner cannot use record_type as the leading key of audit_event_record_idx (record_type,
-- record_id, seq DESC; 0003): it scanned the WHOLE index with record_id as a non-leading condition (1,123 shared buffers
-- and 64.5 ms for one check on the 100,000-event load dataset). The check runs once per audited row write (deferred
-- constraint trigger), so its cost grows with the audit trail.
--
-- This replaces the function with ONE change: the comparison is TG_TABLE_NAME::text COLLATE "default", so it is
-- text = text in the column's collation and both leading keys of the index are index conditions (proved by
-- packages/db/test/integration/audit-required-index.test.ts). TG_TABLE_NAME's value is unchanged (a table name is at
-- most 63 bytes, and equality under a deterministic collation is byte equality), so the check accepts and refuses
-- exactly the same rows as before; the message, error code and constraint name are 0010's, verbatim. The triggers are unchanged
-- (CREATE OR REPLACE keeps the function's owner, privileges and every trigger that uses it). Nothing here reads or
-- writes DG0-DG7 or any business approval.
CREATE OR REPLACE FUNCTION p2_audit_required() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  n jsonb := to_jsonb(NEW);
  rid uuid := (n->>'id')::uuid;
  v integer := (n->>'version')::integer; -- NULL for tables without a version column
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM audit_event a
    WHERE a.record_type = TG_TABLE_NAME::text COLLATE "default" AND a.record_id = rid AND (v IS NULL OR a.new_version = v)
  ) THEN
    RAISE EXCEPTION 'no audit_event for % % at version % (ADR-0004: every mutation writes its audit event in the same transaction)',
      TG_TABLE_NAME, rid, coalesce(v::text, '-')
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = TG_TABLE_NAME || '_audit_required';
  END IF;
  RETURN NULL;
END $$;
