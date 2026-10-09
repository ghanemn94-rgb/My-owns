-- 0045 P4 slice D: the T16 Executive Decision Log on the canonical decision record (kind 'executive'), decision-SLA
-- escalation (append-only, once per SLA due date), blocker RAG observations per meeting cycle, the configurable
-- escalation rules, and the T16 read model (T-DG4-ARCH-05; ADR-0032; REQ-PB-068, REQ-PB-081, REQ-PB-082, REQ-S10-012,
-- REQ-S12-011). Authored by solution-architect. Contract: docs/architecture/data-dictionary.md ("P4 tables, slice D").
-- Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged.
-- SQL floor: PostgreSQL 16. Nothing here approves anything, and nothing touches DG0-DG7.

-- -----------------------------------------------------------------------------------------------------------------
-- decision (DG2 0017, THE canonical decision record): the T16 columns of B0130 that the table does not have yet, as
-- nullable columns (additive; ADR-0015 "P4 adds columns and views, not a new table"). T16 maps onto the record:
-- ID = code (DEC-nn), Decision = title, Why now = why_now, Options = decision_option rows, Rec. = recommendation_option_id
-- or recommendation_text, Owner = owner_user_id, Decision date = due_date (the required date, REQ-S10-012 note),
-- Impact if delayed = impact_of_delay, Outcome = outcome_text. ask_origin is NULL on every pre-P4 row and on the DG3
-- funding decisions, so no existing row changes meaning and none of the new CHECKs applies to them.
ALTER TABLE decision
  ADD COLUMN why_now                      text NULL CONSTRAINT decision_why_now_check CHECK (why_now IS NULL OR char_length(why_now) BETWEEN 1 AND 4000),
  ADD COLUMN impact_of_delay              text NULL CONSTRAINT decision_impact_of_delay_check CHECK (impact_of_delay IS NULL OR char_length(impact_of_delay) BETWEEN 1 AND 4000),
  ADD COLUMN ask_origin                   text NULL CONSTRAINT decision_ask_origin_check CHECK (ask_origin IS NULL OR ask_origin IN ('api', 'agenda', 'blocker_escalation')),
  ADD COLUMN created_source               text NULL CONSTRAINT decision_created_source_check CHECK (created_source IS NULL OR created_source IN ('api', 'worker')),
  ADD COLUMN source_agenda_item_id        uuid NULL,
  ADD COLUMN decision_right_id            uuid NULL,
  ADD COLUMN sla_due_date                 date NULL,
  ADD COLUMN sla_unknown_reason           text NULL CONSTRAINT decision_sla_unknown_reason_check CHECK (sla_unknown_reason IS NULL OR sla_unknown_reason IN ('calendar_not_configured', 'no_steerco_scheduled', 'no_release_date')),
  ADD COLUMN decided_on_behalf_of_user_id uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN blocker_record_type          text NULL CONSTRAINT decision_blocker_record_type_check CHECK (blocker_record_type IS NULL OR blocker_record_type IN ('raid_entry', 'dependency', 'corrective_case', 'initiative', 'milestone')),
  ADD COLUMN blocker_record_id            uuid NULL,
  ADD CONSTRAINT decision_source_agenda_item_fkey FOREIGN KEY (transformation_id, source_agenda_item_id) REFERENCES agenda_item (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT decision_decision_right_fkey FOREIGN KEY (transformation_id, decision_right_id) REFERENCES transformation_decision_right (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- Only a T16 executive ask carries the ask columns.
  ADD CONSTRAINT decision_ask_executive_only CHECK (ask_origin IS NULL OR kind = 'executive'),
  ADD CONSTRAINT decision_ask_columns CHECK (ask_origin IS NOT NULL OR (why_now IS NULL AND impact_of_delay IS NULL
    AND created_source IS NULL AND source_agenda_item_id IS NULL AND decision_right_id IS NULL AND sla_due_date IS NULL
    AND sla_unknown_reason IS NULL AND blocker_record_type IS NULL AND blocker_record_id IS NULL)),
  -- REQ-S10-012: an ask raised by a person (API or agenda) states decision, why now, recommendation, delay impact,
  -- decision owner and required date (options: the deferred trigger below).
  ADD CONSTRAINT decision_ask_complete CHECK (ask_origin IS NULL OR ask_origin = 'blocker_escalation'
    OR (why_now IS NOT NULL AND impact_of_delay IS NOT NULL AND due_date IS NOT NULL AND owner_user_id IS NOT NULL
        AND (recommendation_option_id IS NOT NULL OR recommendation_text IS NOT NULL))),
  -- REQ-PB-082: a blocker escalation names the blocker and a deadline, and is created by the worker; only it is.
  ADD CONSTRAINT decision_ask_source CHECK (ask_origin IS NULL
    OR ((ask_origin = 'agenda') = (source_agenda_item_id IS NOT NULL)
        AND (ask_origin = 'blocker_escalation') = (created_source = 'worker')
        AND created_source IS NOT NULL
        AND (ask_origin <> 'blocker_escalation' OR (blocker_record_id IS NOT NULL AND due_date IS NOT NULL)))),
  ADD CONSTRAINT decision_blocker_pair CHECK ((blocker_record_type IS NULL) = (blocker_record_id IS NULL)),
  -- The SLA due date is known or carries its Unknown reason (never a guessed date).
  ADD CONSTRAINT decision_ask_sla_known_or_reason CHECK (ask_origin IS NULL OR ((sla_due_date IS NULL) = (sla_unknown_reason IS NOT NULL))),
  -- REQ-PB-081: a decided T16 ask has its Outcome recorded.
  ADD CONSTRAINT decision_ask_outcome_recorded CHECK (ask_origin IS NULL OR status <> 'decided' OR outcome_text IS NOT NULL);
-- REQ-PB-082 "without duplicating an existing open ask": at most one open (or deferred) executive ask per blocker.
CREATE UNIQUE INDEX decision_one_open_blocker_ask ON decision (transformation_id, blocker_record_type, blocker_record_id)
  WHERE blocker_record_id IS NOT NULL AND status IN ('open', 'deferred');
CREATE INDEX decision_executive_sla_idx ON decision (sla_due_date) WHERE kind = 'executive' AND ask_origin IS NOT NULL AND status IN ('open', 'deferred');

CREATE FUNCTION decision_ask_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  found_it boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.ask_origin, NEW.created_source, NEW.source_agenda_item_id, NEW.blocker_record_type, NEW.blocker_record_id)
     IS DISTINCT FROM (OLD.ask_origin, OLD.created_source, OLD.source_agenda_item_id, OLD.blocker_record_type, OLD.blocker_record_id) THEN
    RAISE EXCEPTION 'decision %: the ask origin and its source are immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'decision_ask_origin_immutable';
  END IF;
  IF NEW.blocker_record_id IS NOT NULL AND (TG_OP = 'INSERT') THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND transformation_id = $2)', NEW.blocker_record_type)
      INTO found_it USING NEW.blocker_record_id, NEW.transformation_id;
    IF NOT found_it THEN
      RAISE EXCEPTION 'decision: blocker % % does not exist in transformation %', NEW.blocker_record_type, NEW.blocker_record_id, NEW.transformation_id
        USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'decision_blocker_ref';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER decision_ask_guard BEFORE INSERT OR UPDATE ON decision FOR EACH ROW EXECUTE FUNCTION decision_ask_guard();

-- Options A/B/C (B0130): a person-raised ask has at least two active options, checked at the commit of every
-- transaction that inserts or updates the ask row.
CREATE FUNCTION decision_ask_options() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  d record;
BEGIN
  SELECT x.id, x.ask_origin INTO d FROM decision x WHERE x.id = NEW.id;
  IF d.ask_origin IN ('api', 'agenda')
     AND (SELECT count(*) FROM decision_option o WHERE o.decision_id = d.id AND o.status = 'active') < 2 THEN
    RAISE EXCEPTION 'decision %: an executive ask states at least two options (A/B/C)', d.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'decision_ask_options';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER decision_ask_options AFTER INSERT OR UPDATE ON decision DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION decision_ask_options();

-- -----------------------------------------------------------------------------------------------------------------
-- governance_escalation_rule: the configured escalation rules per transformation (M0231, M0233; D-089 Q7; R5 "code-
-- defined handlers with configuration values in data"). A transformation without a row uses the code defaults of
-- ADR-0032 §8 (governance/escalation-rules.ts), which the API reports as isDefault.
CREATE TABLE governance_escalation_rule (
  id                    uuid PRIMARY KEY,
  organization_id       uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id     uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  rule_kind             text NOT NULL CHECK (rule_kind IN ('decision_sla', 'blocker_red')),
  enabled               boolean NOT NULL DEFAULT true,
  escalation_chain      text[] NULL CHECK (escalation_chain IS NULL OR (cardinality(escalation_chain) BETWEEN 1 AND 5 AND p4_parties_known(escalation_chain))),
  red_cycles            smallint NULL CHECK (red_cycles IS NULL OR red_cycles BETWEEN 2 AND 12),
  deadline_working_days smallint NULL CHECK (deadline_working_days IS NULL OR deadline_working_days BETWEEN 1 AND 60),
  owner_party_code      text NULL REFERENCES governance_party (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version               integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT governance_escalation_rule_kind_key UNIQUE (transformation_id, rule_kind),
  CONSTRAINT governance_escalation_rule_shape CHECK (
    (rule_kind = 'decision_sla' AND escalation_chain IS NOT NULL AND red_cycles IS NULL AND deadline_working_days IS NULL AND owner_party_code IS NULL)
    OR (rule_kind = 'blocker_red' AND escalation_chain IS NULL AND red_cycles IS NOT NULL AND deadline_working_days IS NOT NULL AND owner_party_code IS NOT NULL))
);
CREATE FUNCTION governance_escalation_rule_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.rule_kind IS DISTINCT FROM OLD.rule_kind THEN
    RAISE EXCEPTION 'governance_escalation_rule %: the rule kind is immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'governance_escalation_rule_kind_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER governance_escalation_rule_guard BEFORE UPDATE ON governance_escalation_rule
  FOR EACH ROW EXECUTE FUNCTION governance_escalation_rule_guard();
SELECT p2_attach_guards('governance_escalation_rule', true);
GRANT SELECT, INSERT, UPDATE ON governance_escalation_rule TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- decision_escalation: one escalation of an executive ask whose SLA expired (REQ-S12-011, M0231 "Escalate to the next
-- configured authority and show delay impact"). Append-only and audited (actor service). At most one per (decision, SLA
-- due date), so a retried or re-run job escalates once; a new due date (a deferral) allows one more. An escalation never
-- decides: it inserts no decision change at all.
CREATE TABLE decision_escalation (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decision_id       uuid NOT NULL,
  sla_due_date      date NOT NULL,
  business_date     date NOT NULL,
  level             smallint NOT NULL CHECK (level BETWEEN 1 AND 5),
  party_code        text NULL REFERENCES governance_party (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  target_user_id    uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  target_group_id   uuid NULL REFERENCES access_group (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  routing_error     text NULL CHECK (routing_error IS NULL OR routing_error IN ('party_unmapped', 'party_not_executive', 'no_next_authority')),
  delay_impact      text NULL CHECK (delay_impact IS NULL OR char_length(delay_impact) BETWEEN 1 AND 4000),
  escalated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT decision_escalation_decision_fkey FOREIGN KEY (transformation_id, decision_id) REFERENCES decision (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT decision_escalation_once UNIQUE (decision_id, sla_due_date),
  CONSTRAINT decision_escalation_expired CHECK (sla_due_date < business_date),
  CONSTRAINT decision_escalation_target CHECK (
    (routing_error IS NULL AND party_code IS NOT NULL AND ((target_user_id IS NULL) <> (target_group_id IS NULL)))
    OR (routing_error IS NOT NULL AND target_user_id IS NULL AND target_group_id IS NULL)),
  CONSTRAINT decision_escalation_party_error CHECK ((routing_error = 'no_next_authority') = (routing_error IS NOT NULL AND party_code IS NULL))
);
CREATE INDEX decision_escalation_decision_idx ON decision_escalation (decision_id, escalated_at, id);
CREATE INDEX decision_escalation_transformation_idx ON decision_escalation (transformation_id, escalated_at DESC, id DESC);
CREATE FUNCTION decision_escalation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  d record;
  prev smallint;
BEGIN
  SELECT x.kind, x.ask_origin, x.status, x.sla_due_date INTO d FROM decision x WHERE x.id = NEW.decision_id;
  IF d.kind IS DISTINCT FROM 'executive' OR d.ask_origin IS NULL OR d.status NOT IN ('open', 'deferred')
     OR d.sla_due_date IS DISTINCT FROM NEW.sla_due_date THEN
    RAISE EXCEPTION 'decision_escalation: only an open executive ask whose current SLA due date expired is escalated'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'decision_escalation_open_ask';
  END IF;
  SELECT max(e.level) INTO prev FROM decision_escalation e WHERE e.decision_id = NEW.decision_id;
  IF NEW.level IS DISTINCT FROM coalesce(prev, 0) + 1 THEN
    RAISE EXCEPTION 'decision_escalation: the level steps by exactly 1 (previous %)', coalesce(prev, 0)
      USING ERRCODE = 'check_violation', CONSTRAINT = 'decision_escalation_level_step';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER decision_escalation_guard BEFORE INSERT ON decision_escalation FOR EACH ROW EXECUTE FUNCTION decision_escalation_guard();
SELECT p2_attach_append_only('decision_escalation');
SELECT p2_attach_guards('decision_escalation', true);
GRANT SELECT, INSERT ON decision_escalation TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- blocker_status: the RAG of one blocker observed in one meeting (one review cycle) (REQ-PB-082 "RAG history by
-- cycle"; B0131). Append-only and audited; one observation per (meeting, blocker). The blocker is a canonical record
-- of the transformation.
CREATE TABLE blocker_status (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id  uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  meeting_id         uuid NOT NULL,
  forum_id           uuid NOT NULL,
  cycle_date         date NOT NULL,
  source_record_type text NOT NULL CHECK (source_record_type IN ('raid_entry', 'dependency', 'corrective_case', 'initiative', 'milestone')),
  source_record_id   uuid NOT NULL,
  rag                text NOT NULL CHECK (rag IN ('red', 'amber', 'green', 'unknown')),
  note               text NULL CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT blocker_status_meeting_fkey FOREIGN KEY (transformation_id, meeting_id) REFERENCES meeting (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT blocker_status_forum_fkey FOREIGN KEY (transformation_id, forum_id) REFERENCES forum (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT blocker_status_once_per_cycle UNIQUE (meeting_id, source_record_type, source_record_id)
);
CREATE INDEX blocker_status_source_idx ON blocker_status (transformation_id, source_record_type, source_record_id, forum_id, cycle_date DESC);
CREATE FUNCTION blocker_status_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  m record;
  found_it boolean;
BEGIN
  SELECT x.status, x.forum_id, x.scheduled_date INTO m FROM meeting x WHERE x.id = NEW.meeting_id;
  IF m.status NOT IN ('in_session', 'held') THEN
    RAISE EXCEPTION 'blocker_status: a blocker RAG is recorded in a meeting that is in session or held'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'blocker_status_meeting_in_session';
  END IF;
  IF NEW.forum_id IS DISTINCT FROM m.forum_id OR NEW.cycle_date IS DISTINCT FROM m.scheduled_date THEN
    RAISE EXCEPTION 'blocker_status: forum and cycle date are the meeting''s own'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'blocker_status_cycle_of_meeting';
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND transformation_id = $2)', NEW.source_record_type)
    INTO found_it USING NEW.source_record_id, NEW.transformation_id;
  IF NOT found_it THEN
    RAISE EXCEPTION 'blocker_status: % % does not exist in transformation %', NEW.source_record_type, NEW.source_record_id, NEW.transformation_id
      USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'blocker_status_record_ref';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER blocker_status_guard BEFORE INSERT ON blocker_status FOR EACH ROW EXECUTE FUNCTION blocker_status_guard();
CREATE TRIGGER blocker_status_meeting_editable BEFORE INSERT ON blocker_status FOR EACH ROW EXECUTE FUNCTION p4_meeting_child_editable();
SELECT p2_attach_append_only('blocker_status');
SELECT p2_attach_guards('blocker_status', true);
GRANT SELECT, INSERT ON blocker_status TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- executive_decision_log: the T16 register (B0130) as ONE read model over the canonical decision rows of kind
-- 'executive' (REQ-PB-081; M0150 "one decision model with appropriate views"). The nine T16 columns, plus status and the
-- ask origin. DG3 funding decisions (kind 'executive', ask_origin NULL) are listed with their own columns; a T16 column
-- they do not have is NULL and shown as Unknown. SELECT-only for mth_app.
CREATE VIEW executive_decision_log AS
SELECT d.id, d.organization_id, d.transformation_id,
       d.code AS t16_id,
       d.title AS decision,
       d.why_now,
       (SELECT string_agg(o.label, '/' ORDER BY o.ordinal) FROM decision_option o
        WHERE o.decision_id = d.id AND o.status = 'active') AS options,
       coalesce((SELECT o.label || ': ' || o.title FROM decision_option o WHERE o.id = d.recommendation_option_id),
                d.recommendation_text) AS recommendation,
       d.owner_user_id AS owner_user_id,
       d.due_date AS decision_date,
       d.impact_of_delay,
       d.outcome_text AS outcome,
       d.status, d.ask_origin, d.sla_due_date, d.sla_unknown_reason, d.decided_at, d.decided_by,
       d.blocker_record_type, d.blocker_record_id, d.version, d.created_at, d.updated_at
FROM decision d
WHERE d.kind = 'executive';
GRANT SELECT ON executive_decision_log TO mth_app;
