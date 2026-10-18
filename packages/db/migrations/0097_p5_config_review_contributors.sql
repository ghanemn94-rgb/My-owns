-- 0097 P5 repair (T-DG5-BE-V1; D-170; F-DG5-100; REQ-S06-007; ADR-0039 §5, §9; ADR-0043 §4): the contributors of a
-- configuration draft never decide its configured review. Authored by backend-workflow-engineer. Forward-only and
-- additive: never edit once merged. Runs as mth_owner inside one transaction opened by `mth-db migrate`. SQL floor:
-- PostgreSQL 16.
--
-- Why (F-DG5-100): any `methodology.configure` holder may write another admin's Studio draft (updateConfigDraft, the
-- element PUT/remove, the procedure definition writes), and any `automation.configure` holder may write another
-- admin's rule-version draft (updateAutomationRuleVersion). The configured-review separation of duties compared the
-- decider only with the draft's creator (0062 trigger config_review_request_reviewer_not_author; 0074 CHECK
-- automation_rule_version_review_sod on authored_by) and the requester (0062 CHECK). A co-author could therefore
-- approve the review of content they wrote.
--
-- Decided (D-170): a person who wrote any part of a configuration draft is one of its authors, and an author never
-- decides its review.
--
-- What:
--   1. methodology_version_contributor (methodology_version_id, user_id, first_written_at) and
--      automation_rule_version_contributor (automation_rule_version_id, user_id, first_written_at): append-only
--      (p2_append_only on UPDATE, DELETE, TRUNCATE), one row per person per draft, the time of their first write.
--   2. The mechanism: database triggers on every table that holds a draft's content, so no write path (the Studio
--      routes, the kind providers' own writers, a future one) can skip the record. A Studio draft's content is its
--      methodology_version row (titles, definition, change summary, content hash), its methodology_element rows (every
--      element kind: methodology, scoring defaults, form schemas, health-check schemes) and the procedure kind's rows
--      that its diff covers (procedure_definition, procedure_step_definition). A rule version's content is its own row
--      (trigger, conditions, actions, run-as, permissions, parameters, change summary). There is no session-actor
--      setting in this database, so each write's actor is read twice, both in the writer's own transaction:
--        (a) immediately (AFTER ROW): the row's own actor column, `updated_by` (the INSERT's `created_by` when no
--            `updated_by` is given). Every API writer stamps it with the acting user.
--        (b) at COMMIT (deferred constraint trigger, AFTER ROW): the actor and on-behalf-of user of the write's own
--            audit_event (record_type = the table, record_id = the row, new_version = the row's version). The deferred
--            P2 guard (p2_audit_required) already makes that event mandatory for every write to these tables, so a
--            writer that forgot to stamp `updated_by` is still recorded under the person its audit event names.
--      Only content writes of a draft count: on methodology_version and automation_rule_version an UPDATE that only
--      moves the stage or status (submit, decide, withdraw, publish, discard) records nobody, so a reviewer who
--      requested changes does not become an author of the draft by deciding.
--   3. The refusal: a review decision whose decider is a recorded contributor is refused under a named constraint
--      (config_review_request_reviewer_not_contributor; automation_rule_version_reviewer_not_contributor), which
--      db-errors.ts maps to the same 403 as the API refusal (config_review.self_review;
--      automation_rule_version.self_review). The 0062/0074 creator, requester and author checks are unchanged.
--   4. Backfill of the drafts open at migration time: their created_by and updated_by (D-170 scope), plus every actor
--      named by the audit trail of a content write of the draft or of its content rows. This errs towards refusing a
--      reviewer (an updated_by stamped by a stage step counts), never towards allowing an author. One audit_event per
--      backfilled draft (source 'migration', actor 'system', action `<table>.contributors_backfill`), on the version's
--      own record, naming the recorded users. The version rows themselves are not written, so their versions, ETags
--      and audit histories do not move.
--
-- Nothing here grants a business, Finance or IT approval, and nothing reads or writes the engineering gates DG0-DG7.

-- -----------------------------------------------------------------------------------------------------------------
-- 1. The contributor tables.
CREATE TABLE methodology_version_contributor (
  methodology_version_id uuid NOT NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  user_id                uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  first_written_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT methodology_version_contributor_pkey PRIMARY KEY (methodology_version_id, user_id)
);
CREATE INDEX methodology_version_contributor_user_idx ON methodology_version_contributor (user_id);
SELECT p2_attach_append_only('methodology_version_contributor');
GRANT SELECT, INSERT ON methodology_version_contributor TO mth_app;
COMMENT ON TABLE methodology_version_contributor IS
  'Every person who wrote content of a Studio configuration draft (D-170; ADR-0039 §5). Append-only; maintained by triggers. A contributor never decides the draft''s configured review.';

CREATE TABLE automation_rule_version_contributor (
  automation_rule_version_id uuid NOT NULL REFERENCES automation_rule_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  user_id                    uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  first_written_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_rule_version_contributor_pkey PRIMARY KEY (automation_rule_version_id, user_id)
);
CREATE INDEX automation_rule_version_contributor_user_idx ON automation_rule_version_contributor (user_id);
SELECT p2_attach_append_only('automation_rule_version_contributor');
GRANT SELECT, INSERT ON automation_rule_version_contributor TO mth_app;
COMMENT ON TABLE automation_rule_version_contributor IS
  'Every person who wrote content of an automation rule version draft (D-170; ADR-0043 §4). Append-only; maintained by triggers. A contributor never decides the version''s configured review.';

-- -----------------------------------------------------------------------------------------------------------------
-- 2. Recording. Helpers: add a person to a draft (idempotent; a NULL person or a non-draft version records nothing).
CREATE FUNCTION p5_add_config_contributor(p_version_id uuid, p_user_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF p_version_id IS NULL OR p_user_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM methodology_version m WHERE m.id = p_version_id AND m.status = 'draft') THEN
    RETURN;
  END IF;
  INSERT INTO methodology_version_contributor (methodology_version_id, user_id) VALUES (p_version_id, p_user_id)
    ON CONFLICT ON CONSTRAINT methodology_version_contributor_pkey DO NOTHING;
END $$;

CREATE FUNCTION p5_add_rule_contributor(p_version_id uuid, p_user_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF p_version_id IS NULL OR p_user_id IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO automation_rule_version_contributor (automation_rule_version_id, user_id) VALUES (p_version_id, p_user_id)
    ON CONFLICT ON CONSTRAINT automation_rule_version_contributor_pkey DO NOTHING;
END $$;

-- The draft (methodology_version id) whose content a row of TG_TABLE_NAME is.
CREATE FUNCTION p5_config_content_version(p_table text, p_row jsonb) RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
BEGIN
  RETURN CASE p_table
    WHEN 'methodology_version' THEN (p_row->>'id')::uuid
    WHEN 'methodology_element' THEN (p_row->>'methodology_version_id')::uuid
    WHEN 'procedure_definition' THEN (p_row->>'methodology_version_id')::uuid
    WHEN 'procedure_step_definition' THEN
      (SELECT d.methodology_version_id FROM procedure_definition d WHERE d.id = (p_row->>'procedure_definition_id')::uuid)
    ELSE NULL END;
END $$;

-- (a) Immediately: the row's own actor column.
CREATE FUNCTION p5_config_contributor_from_row() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  n jsonb := to_jsonb(NEW);
  who uuid := coalesce((n->>'updated_by')::uuid, CASE WHEN TG_OP = 'INSERT' THEN (n->>'created_by')::uuid END);
BEGIN
  IF TG_TABLE_NAME = 'automation_rule_version' THEN
    IF NEW.status = 'draft' THEN
      PERFORM p5_add_rule_contributor(NEW.id, who);
    END IF;
  ELSE
    PERFORM p5_add_config_contributor(p5_config_content_version(TG_TABLE_NAME, n), who);
  END IF;
  RETURN NULL;
END $$;

-- (b) At COMMIT: the people the write's own audit event names.
CREATE FUNCTION p5_config_contributor_from_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  n jsonb := to_jsonb(NEW);
  target uuid;
  a record;
BEGIN
  target := CASE WHEN TG_TABLE_NAME = 'automation_rule_version' THEN NEW.id
                 ELSE p5_config_content_version(TG_TABLE_NAME, n) END;
  FOR a IN SELECT e.actor_user_id, e.on_behalf_of_user_id FROM audit_event e
            WHERE e.record_type = TG_TABLE_NAME AND e.record_id = (n->>'id')::uuid
              AND e.new_version = (n->>'version')::integer LOOP
    IF TG_TABLE_NAME = 'automation_rule_version' THEN
      PERFORM p5_add_rule_contributor(target, a.actor_user_id);
      PERFORM p5_add_rule_contributor(target, a.on_behalf_of_user_id);
    ELSE
      PERFORM p5_add_config_contributor(target, a.actor_user_id);
      PERFORM p5_add_config_contributor(target, a.on_behalf_of_user_id);
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

-- methodology_version: the draft's creation, and any write that changes its content.
CREATE TRIGGER methodology_version_contributor_insert AFTER INSERT ON methodology_version
  FOR EACH ROW WHEN (NEW.status = 'draft') EXECUTE FUNCTION p5_config_contributor_from_row();
CREATE TRIGGER methodology_version_contributor_update AFTER UPDATE ON methodology_version
  FOR EACH ROW WHEN (NEW.status = 'draft' AND (NEW.title_en, NEW.title_ar, NEW.definition, NEW.change_summary, NEW.content_sha256)
                     IS DISTINCT FROM (OLD.title_en, OLD.title_ar, OLD.definition, OLD.change_summary, OLD.content_sha256))
  EXECUTE FUNCTION p5_config_contributor_from_row();
CREATE CONSTRAINT TRIGGER methodology_version_contributor_audit_insert AFTER INSERT ON methodology_version
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.status = 'draft') EXECUTE FUNCTION p5_config_contributor_from_audit();
CREATE CONSTRAINT TRIGGER methodology_version_contributor_audit_update AFTER UPDATE ON methodology_version
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.status = 'draft' AND (NEW.title_en, NEW.title_ar, NEW.definition, NEW.change_summary, NEW.content_sha256)
                     IS DISTINCT FROM (OLD.title_en, OLD.title_ar, OLD.definition, OLD.change_summary, OLD.content_sha256))
  EXECUTE FUNCTION p5_config_contributor_from_audit();

-- The content rows of a draft: every insert and update (the 0062/0069 guards already allow them only in a draft).
CREATE TRIGGER methodology_element_contributor AFTER INSERT OR UPDATE ON methodology_element
  FOR EACH ROW EXECUTE FUNCTION p5_config_contributor_from_row();
CREATE CONSTRAINT TRIGGER methodology_element_contributor_audit AFTER INSERT OR UPDATE ON methodology_element
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION p5_config_contributor_from_audit();
CREATE TRIGGER procedure_definition_contributor AFTER INSERT OR UPDATE ON procedure_definition
  FOR EACH ROW EXECUTE FUNCTION p5_config_contributor_from_row();
CREATE CONSTRAINT TRIGGER procedure_definition_contributor_audit AFTER INSERT OR UPDATE ON procedure_definition
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION p5_config_contributor_from_audit();
CREATE TRIGGER procedure_step_definition_contributor AFTER INSERT OR UPDATE ON procedure_step_definition
  FOR EACH ROW EXECUTE FUNCTION p5_config_contributor_from_row();
CREATE CONSTRAINT TRIGGER procedure_step_definition_contributor_audit AFTER INSERT OR UPDATE ON procedure_step_definition
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION p5_config_contributor_from_audit();

-- automation_rule_version: the draft's creation, and any write that changes its content while it is a draft.
CREATE TRIGGER automation_rule_version_contributor_insert AFTER INSERT ON automation_rule_version
  FOR EACH ROW WHEN (NEW.status = 'draft') EXECUTE FUNCTION p5_config_contributor_from_row();
CREATE TRIGGER automation_rule_version_contributor_update AFTER UPDATE ON automation_rule_version
  FOR EACH ROW WHEN (NEW.status = 'draft' AND (NEW.trigger_codes, NEW.conditions, NEW.actions, NEW.action_types, NEW.run_as,
                       NEW.service_permission_codes, NEW.parameters, NEW.content_sha256, NEW.change_summary)
                     IS DISTINCT FROM (OLD.trigger_codes, OLD.conditions, OLD.actions, OLD.action_types, OLD.run_as,
                       OLD.service_permission_codes, OLD.parameters, OLD.content_sha256, OLD.change_summary))
  EXECUTE FUNCTION p5_config_contributor_from_row();
CREATE CONSTRAINT TRIGGER automation_rule_version_contributor_audit_insert AFTER INSERT ON automation_rule_version
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.status = 'draft') EXECUTE FUNCTION p5_config_contributor_from_audit();
CREATE CONSTRAINT TRIGGER automation_rule_version_contributor_audit_update AFTER UPDATE ON automation_rule_version
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.status = 'draft' AND (NEW.trigger_codes, NEW.conditions, NEW.actions, NEW.action_types, NEW.run_as,
                       NEW.service_permission_codes, NEW.parameters, NEW.content_sha256, NEW.change_summary)
                     IS DISTINCT FROM (OLD.trigger_codes, OLD.conditions, OLD.actions, OLD.action_types, OLD.run_as,
                       OLD.service_permission_codes, OLD.parameters, OLD.content_sha256, OLD.change_summary))
  EXECUTE FUNCTION p5_config_contributor_from_audit();

-- -----------------------------------------------------------------------------------------------------------------
-- 3. The refusals: a contributor never decides the review (D-170). Checked when the decision is recorded. The trigger
--    names sort after the 0062/0074 guard triggers (BEFORE triggers fire in name order), so a direct write by the
--    draft's creator still reports config_review_request_reviewer_not_author. CHECK constraints are evaluated after
--    every BEFORE trigger, so a direct decision by a rule version's author (always a contributor) now reports
--    automation_rule_version_reviewer_not_contributor before the 0074 CHECK automation_rule_version_review_sod; both
--    are the same refusal.
CREATE FUNCTION config_review_request_contributor_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.decided_by IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.decided_by IS DISTINCT FROM OLD.decided_by)
     AND EXISTS (SELECT 1 FROM methodology_version_contributor c
                 WHERE c.methodology_version_id = NEW.methodology_version_id AND c.user_id = NEW.decided_by) THEN
    RAISE EXCEPTION 'config_review_request %: a contributor of a draft cannot review it (SoD, D-170)', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'config_review_request_reviewer_not_contributor';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER config_review_request_sod_contributor BEFORE INSERT OR UPDATE ON config_review_request
  FOR EACH ROW EXECUTE FUNCTION config_review_request_contributor_guard();

-- The rule-version decision: in_review -> approved | draft, or any change of reviewed_by to a person.
CREATE FUNCTION automation_rule_version_contributor_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.reviewed_by IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
          OR (OLD.status = 'in_review' AND NEW.status IN ('approved', 'draft')))
     AND EXISTS (SELECT 1 FROM automation_rule_version_contributor c
                 WHERE c.automation_rule_version_id = NEW.id AND c.user_id = NEW.reviewed_by) THEN
    RAISE EXCEPTION 'automation_rule_version %: a contributor of a version cannot review it (SoD, D-170)', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_reviewer_not_contributor';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER automation_rule_version_sod_contributor BEFORE INSERT OR UPDATE ON automation_rule_version
  FOR EACH ROW EXECUTE FUNCTION automation_rule_version_contributor_guard();

REVOKE ALL ON FUNCTION p5_add_config_contributor(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION p5_add_rule_contributor(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION p5_config_content_version(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p5_add_config_contributor(uuid, uuid) TO mth_app;
GRANT EXECUTE ON FUNCTION p5_add_rule_contributor(uuid, uuid) TO mth_app;
GRANT EXECUTE ON FUNCTION p5_config_content_version(text, jsonb) TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- 4. Backfill of the drafts open now (guarded: only drafts, only users that exist; idempotent by the primary key).
INSERT INTO methodology_version_contributor (methodology_version_id, user_id)
SELECT DISTINCT x.version_id, x.user_id
FROM (
  SELECT m.id AS version_id, m.created_by AS user_id FROM methodology_version m
   WHERE m.status = 'draft' AND m.draft_stage <> 'discarded'
  UNION ALL
  SELECT m.id, m.updated_by FROM methodology_version m WHERE m.status = 'draft' AND m.draft_stage <> 'discarded'
  UNION ALL
  -- the version row's own content writes (their audit event names a content column)
  SELECT m.id, u.user_id FROM methodology_version m
    JOIN audit_event e ON e.record_type = 'methodology_version' AND e.record_id = m.id
    CROSS JOIN LATERAL (VALUES (e.actor_user_id), (e.on_behalf_of_user_id)) AS u(user_id)
   WHERE m.status = 'draft' AND m.draft_stage <> 'discarded' AND e.changes IS NOT NULL
     AND e.changes ?| ARRAY['title_en', 'title_ar', 'definition', 'change_summary', 'content_sha256', 'based_on_version_id']
  UNION ALL
  -- every write of the draft's content rows
  SELECT r.version_id, u.user_id
  FROM (SELECT el.id, el.methodology_version_id AS version_id, 'methodology_element' AS t FROM methodology_element el
        UNION ALL SELECT d.id, d.methodology_version_id, 'procedure_definition' FROM procedure_definition d
        UNION ALL SELECT s.id, d.methodology_version_id, 'procedure_step_definition'
                    FROM procedure_step_definition s JOIN procedure_definition d ON d.id = s.procedure_definition_id) r
    JOIN methodology_version m ON m.id = r.version_id AND m.status = 'draft' AND m.draft_stage <> 'discarded'
    JOIN audit_event e ON e.record_type = r.t AND e.record_id = r.id
    CROSS JOIN LATERAL (VALUES (e.actor_user_id), (e.on_behalf_of_user_id)) AS u(user_id)
) x
JOIN app_user au ON au.id = x.user_id
ON CONFLICT ON CONSTRAINT methodology_version_contributor_pkey DO NOTHING;

INSERT INTO automation_rule_version_contributor (automation_rule_version_id, user_id)
SELECT DISTINCT x.version_id, x.user_id
FROM (
  SELECT v.id AS version_id, u.user_id FROM automation_rule_version v
    CROSS JOIN LATERAL (VALUES (v.authored_by), (v.created_by), (v.updated_by)) AS u(user_id)
   WHERE v.status IN ('draft', 'in_review', 'approved')
  UNION ALL
  SELECT v.id, u.user_id FROM automation_rule_version v
    JOIN audit_event e ON e.record_type = 'automation_rule_version' AND e.record_id = v.id
                      AND e.action IN ('automation_rule_version.create', 'automation_rule_version.update')
    CROSS JOIN LATERAL (VALUES (e.actor_user_id), (e.on_behalf_of_user_id)) AS u(user_id)
   WHERE v.status IN ('draft', 'in_review', 'approved')
) x
JOIN app_user au ON au.id = x.user_id
ON CONFLICT ON CONSTRAINT automation_rule_version_contributor_pkey DO NOTHING;

-- One audit event per backfilled draft, on the version's own record (the version row itself is not written).
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, reason, source, changes)
SELECT mth_uuid_v7(), 'system', 'methodology_version.contributors_backfill', 'methodology_version', c.methodology_version_id,
       'Recorded the contributors of an open draft (0097; D-170; F-DG5-100)', 'migration',
       jsonb_build_object('contributors', jsonb_build_object('from', NULL, 'to', jsonb_agg(c.user_id::text ORDER BY c.user_id)))
FROM methodology_version_contributor c GROUP BY c.methodology_version_id;
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, reason, source, changes)
SELECT mth_uuid_v7(), 'system', 'automation_rule_version.contributors_backfill', 'automation_rule_version',
       c.automation_rule_version_id, 'Recorded the contributors of an open version (0097; D-170; F-DG5-100)', 'migration',
       jsonb_build_object('contributors', jsonb_build_object('from', NULL, 'to', jsonb_agg(c.user_id::text ORDER BY c.user_id)))
FROM automation_rule_version_contributor c GROUP BY c.automation_rule_version_id;
