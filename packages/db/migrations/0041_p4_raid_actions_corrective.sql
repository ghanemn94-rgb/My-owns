-- 0041 P4 slice E: the T15 RAID register on canonical records (risk, assumption and issue as typed rows; a RAID
-- Dependency entry IS the canonical T08 dependency row), the action extension (source links, follow-up date), and
-- corrective-action cases with their severity-and-persistence rules and append-only signal log
-- (T-DG4-ARCH-04; ADR-0031; REQ-PB-078, REQ-PB-079, REQ-PB-080, REQ-PB-085, REQ-S12-016, REQ-S16-018).
-- Authored by solution-architect. Contract: docs/architecture/data-dictionary.md ("P4 tables, slice E").
-- Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged.
-- SQL floor: PostgreSQL 16. Nothing here approves anything, and nothing touches DG0-DG7.

-- Human-readable codes: R-01 / A-01 / I-01 (T15 IDs, B0128; D-089 Q5: a RAID Dependency entry keeps its DEP-nn code)
-- and CA-01 (corrective-action cases). Widening the closed prefix set is the 0020/0037 precedent (every prefix stays).
ALTER TABLE record_code_counter DROP CONSTRAINT record_code_counter_prefix_check;
ALTER TABLE record_code_counter ADD CONSTRAINT record_code_counter_prefix_check
  CHECK (prefix IN ('D', 'DEC', 'GD', 'DEP', 'INI', 'BC', 'BF', 'B', 'BG', 'VM', 'R', 'A', 'I', 'CA'));

-- -----------------------------------------------------------------------------------------------------------------
-- raid_entry: T15 rows of type Risk, Assumption or Issue (B0128). Dependency entries are NOT stored here: they are the
-- canonical dependency rows (REQ-PB-078, M0150), projected by the raid_register view below.
CREATE TABLE raid_entry (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  entry_type        text NOT NULL CHECK (entry_type IN ('risk', 'assumption', 'issue')),
  code              text NOT NULL,
  description       text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 4000),
  impact            text NOT NULL CHECK (impact IN ('high', 'medium', 'low')),
  probability       text NULL CHECK (probability IS NULL OR probability IN ('high', 'medium', 'low')),
  owner_user_id     uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  due_date          date NULL,
  mitigation        text NULL CHECK (mitigation IS NULL OR char_length(mitigation) BETWEEN 1 AND 4000),
  initiative_id     uuid NULL,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'closed')),
  closed_at         timestamptz NULL,
  closed_by         uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  closure_note      text NULL CHECK (closure_note IS NULL OR char_length(closure_note) BETWEEN 3 AND 2000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT raid_entry_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT raid_entry_code_key UNIQUE (transformation_id, code),
  CONSTRAINT raid_entry_initiative_id_fkey FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT raid_entry_code_format CHECK ((entry_type = 'risk' AND code ~ '^R-[0-9]{2,6}$')
                                           OR (entry_type = 'assumption' AND code ~ '^A-[0-9]{2,6}$')
                                           OR (entry_type = 'issue' AND code ~ '^I-[0-9]{2,6}$')),
  -- REQ-PB-080 (B0128): Probability is H/M/L for a Risk and n/a (absent) for Assumption and Issue.
  CONSTRAINT raid_entry_probability_applicable CHECK ((entry_type = 'risk') = (probability IS NOT NULL)),
  CONSTRAINT raid_entry_closed_complete CHECK ((status = 'closed') = (closed_at IS NOT NULL)
                                               AND (closed_at IS NULL) = (closed_by IS NULL)
                                               AND (closed_at IS NULL) = (closure_note IS NULL))
);
CREATE INDEX raid_entry_transformation_updated_idx ON raid_entry (transformation_id, updated_at DESC, id DESC);
CREATE INDEX raid_entry_type_status_idx ON raid_entry (transformation_id, entry_type, status);
CREATE INDEX raid_entry_open_owner_idx ON raid_entry (owner_user_id) WHERE status <> 'closed';
-- A new entry starts Open (B0128 "Status: Open"); type and code never change; status edges are open <-> in_progress
-- and open | in_progress -> closed; a closed entry is final and frozen (no field changes, no reopening in DG4).
CREATE FUNCTION raid_entry_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' THEN
      RAISE EXCEPTION 'raid_entry %: a new RAID entry starts with status open', NEW.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'raid_entry_starts_open';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'raid_entry %: a closed RAID entry is final', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'raid_entry_closed_final';
  END IF;
  IF NEW.entry_type IS DISTINCT FROM OLD.entry_type OR NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'raid_entry %: the type and code are immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'raid_entry_type_immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY['open>in_progress', 'in_progress>open', 'open>closed', 'in_progress>closed']) THEN
    RAISE EXCEPTION 'raid_entry %: % -> % is not a legal transition (ADR-0031)', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'raid_entry_status_transition';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER raid_entry_guard BEFORE INSERT OR UPDATE ON raid_entry FOR EACH ROW EXECUTE FUNCTION raid_entry_guard();
SELECT p2_attach_guards('raid_entry', true);
GRANT SELECT, INSERT, UPDATE ON raid_entry TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- dependency (DG2 0017, canonical, shared by T08 and RAID; extended by 0022): the T15 Impact column. Additive: a
-- nullable column (NULL = Unknown impact on rows created before P4 or through T08). Probability has no column on a
-- dependency at all: it is n/a by construction (REQ-PB-080). The T08 and DG2 representations do not show it.
ALTER TABLE dependency
  ADD COLUMN impact text NULL CONSTRAINT dependency_impact_check CHECK (impact IS NULL OR impact IN ('high', 'medium', 'low'));

-- -----------------------------------------------------------------------------------------------------------------
-- raid_register: the T15 register as ONE read model over the canonical rows (REQ-PB-078, REQ-PB-079). No copy: a
-- dependency's owner edited through T08 is the same RAID entry's owner (A01). Archived dependencies are not listed.
-- raid_status maps a dependency's status: open and at_risk -> open, resolved -> closed (record_status keeps the raw value).
CREATE VIEW raid_register AS
SELECT r.id, r.organization_id, r.transformation_id, r.entry_type, r.code, r.description, r.impact, r.probability,
       r.owner_user_id, r.due_date, r.mitigation, r.status AS raid_status, r.status AS record_status,
       'raid_entry'::text AS record_table, r.initiative_id, r.version, r.created_at, r.updated_at
FROM raid_entry r
UNION ALL
SELECT d.id, d.organization_id, d.transformation_id, 'dependency'::text, d.code, d.description, d.impact, NULL::text,
       d.owner_user_id, d.needed_by, d.mitigation,
       CASE d.status WHEN 'resolved' THEN 'closed' ELSE 'open' END, d.status,
       'dependency'::text, d.to_initiative_id, d.version, d.created_at, d.updated_at
FROM dependency d
WHERE d.status <> 'archived';
GRANT SELECT ON raid_register TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- corrective_action_rule: the configured severity and persistence rule per transformation and source (M0227). A source
-- without a row uses the code defaults of ADR-0031 §5 (raid/corrective-rules.ts), which the API reports as isDefault.
CREATE TABLE corrective_action_rule (
  id                     uuid PRIMARY KEY,
  organization_id        uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id      uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  source_kind            text NOT NULL CHECK (source_kind IN ('kpi_deviation', 'benefit_variance', 'adoption_check', 'control_check')),
  min_kpi_rag            text NULL CHECK (min_kpi_rag IS NULL OR min_kpi_rag IN ('amber', 'red')),
  persistence_cycles     smallint NOT NULL CHECK (persistence_cycles BETWEEN 1 AND 12),
  follow_up_working_days smallint NOT NULL CHECK (follow_up_working_days BETWEEN 1 AND 60),
  enabled                boolean NOT NULL DEFAULT true,
  version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT corrective_action_rule_source_key UNIQUE (transformation_id, source_kind),
  CONSTRAINT corrective_action_rule_severity_kpi_only CHECK ((source_kind = 'kpi_deviation') = (min_kpi_rag IS NOT NULL)),
  -- A failed check is one event: persistence over cycles applies to KPI deviations and benefit variances only.
  CONSTRAINT corrective_action_rule_persistence_series_only CHECK (source_kind IN ('kpi_deviation', 'benefit_variance') OR persistence_cycles = 1)
);
CREATE FUNCTION corrective_action_rule_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.source_kind IS DISTINCT FROM OLD.source_kind THEN
    RAISE EXCEPTION 'corrective_action_rule %: the source kind is immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'corrective_action_rule_source_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER corrective_action_rule_guard BEFORE UPDATE ON corrective_action_rule
  FOR EACH ROW EXECUTE FUNCTION corrective_action_rule_guard();
SELECT p2_attach_guards('corrective_action_rule', true);
GRANT SELECT, INSERT, UPDATE ON corrective_action_rule TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- corrective_case: one recovery plan / corrective-action case (REQ-PB-085, REQ-S12-016; B0121 Correct, B0093 Value
-- Review). Created by the worker from a source event (kpi.deviation_evaluated, benefit.variance_evaluated,
-- adoption.check_failed, control_check.failed) or by a person from a Value Review finding. At most ONE open case per
-- source scope (KPI + scope, benefit, check): a later off-track signal UPDATES it (never a duplicate), and a failed
-- check gets exactly one case ever. A worker-created case has no human author (created_by NULL, created_source
-- 'worker'; its audit event names the service actor); a service update leaves updated_by NULL.
CREATE TABLE corrective_case (
  id                        uuid PRIMARY KEY,
  organization_id           uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id         uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code                      text NOT NULL CHECK (code ~ '^CA-[0-9]{2,6}$'),
  source_kind               text NOT NULL CHECK (source_kind IN ('kpi_deviation', 'benefit_variance', 'adoption_check', 'control_check', 'value_review')),
  source_scope_key          text NOT NULL CHECK (char_length(source_scope_key) BETWEEN 1 AND 200),
  kpi_definition_id         uuid NULL,
  kpi_scope_kind            text NULL CHECK (kpi_scope_kind IS NULL OR kpi_scope_kind IN ('transformation', 'business_unit', 'initiative')),
  kpi_scope_id              uuid NULL,
  benefit_id                uuid NULL,
  source_record_type        text NULL CHECK (source_record_type IS NULL OR source_record_type ~ '^[a-z][a-z0-9_]{1,62}$'),
  source_record_id          uuid NULL,
  title                     text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  recovery_plan             text NULL CHECK (recovery_plan IS NULL OR char_length(recovery_plan) BETWEEN 1 AND 8000),
  owner_user_id             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  follow_up_date            date NULL,
  follow_up_calendar_id     uuid NULL,
  follow_up_calendar_version integer NULL CHECK (follow_up_calendar_version IS NULL OR follow_up_calendar_version >= 1),
  status                    text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'closed')),
  consecutive_off_track     smallint NULL CHECK (consecutive_off_track IS NULL OR consecutive_off_track >= 0),
  signal_count              integer NOT NULL DEFAULT 0 CHECK (signal_count >= 0),
  last_signal_at            timestamptz NULL,
  closed_at                 timestamptz NULL,
  closed_by                 uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  closure_note              text NULL CHECK (closure_note IS NULL OR char_length(closure_note) BETWEEN 3 AND 2000),
  created_source            text NOT NULL CHECK (created_source IN ('api', 'worker')),
  version                   integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT corrective_case_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT corrective_case_code_key UNIQUE (transformation_id, code),
  CONSTRAINT corrective_case_kpi_fkey FOREIGN KEY (transformation_id, kpi_definition_id) REFERENCES kpi_definition (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT corrective_case_benefit_fkey FOREIGN KEY (transformation_id, benefit_id) REFERENCES benefit (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT corrective_case_calendar_fkey FOREIGN KEY (organization_id, follow_up_calendar_id) REFERENCES business_calendar (organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- Each source kind names exactly its own source fields.
  CONSTRAINT corrective_case_source_fields CHECK (
    (source_kind = 'kpi_deviation') = (kpi_definition_id IS NOT NULL)
    AND (kpi_definition_id IS NULL) = (kpi_scope_kind IS NULL) AND (kpi_definition_id IS NULL) = (kpi_scope_id IS NULL)
    AND (source_kind = 'benefit_variance') = (benefit_id IS NOT NULL)
    AND (source_kind IN ('adoption_check', 'control_check')) = (source_record_id IS NOT NULL)
    AND (source_record_id IS NULL) = (source_record_type IS NULL)),
  -- A person's case (Value Review finding) has a human author, an owner and a follow-up date; only the worker creates
  -- the event-driven kinds. A worker case may lack an owner only when none resolves (shown as unassigned, ADR-0031 §5).
  CONSTRAINT corrective_case_created_source CHECK (
    (created_source = 'api') = (source_kind = 'value_review')
    AND (created_source = 'worker' OR (created_by IS NOT NULL AND updated_by IS NOT NULL
                                       AND owner_user_id IS NOT NULL AND follow_up_date IS NOT NULL))
    AND (created_source = 'api' OR created_by IS NULL)),
  CONSTRAINT corrective_case_follow_up_calendar CHECK ((follow_up_calendar_id IS NULL) = (follow_up_calendar_version IS NULL)),
  CONSTRAINT corrective_case_closed_complete CHECK ((status = 'closed') = (closed_at IS NOT NULL)
                                                    AND (closed_at IS NULL) = (closed_by IS NULL)
                                                    AND (closed_at IS NULL) = (closure_note IS NULL))
);
-- REQ-PB-085 "an existing open case is updated rather than duplicated": at most one case that is not closed per source.
CREATE UNIQUE INDEX corrective_case_one_open_key ON corrective_case (transformation_id, source_kind, source_scope_key)
  WHERE status <> 'closed';
-- REQ-S12-016 "one recovery action per failed check": a failed check (one check record) gets one case, ever.
CREATE UNIQUE INDEX corrective_case_one_per_check_key ON corrective_case (transformation_id, source_kind, source_scope_key)
  WHERE source_kind IN ('adoption_check', 'control_check');
CREATE INDEX corrective_case_transformation_updated_idx ON corrective_case (transformation_id, updated_at DESC, id DESC);
CREATE INDEX corrective_case_open_owner_idx ON corrective_case (owner_user_id) WHERE status <> 'closed';
-- Source fields and the creation source never change; status edges are open <-> in_progress and open | in_progress
-- -> closed; a closed case is final and frozen. A new off-track signal after closure opens a NEW case.
CREATE FUNCTION corrective_case_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' THEN
      RAISE EXCEPTION 'corrective_case %: a new case starts with status open', NEW.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'corrective_case_starts_open';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'corrective_case %: a closed case is final', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'corrective_case_closed_final';
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
     OR NEW.source_scope_key IS DISTINCT FROM OLD.source_scope_key
     OR NEW.kpi_definition_id IS DISTINCT FROM OLD.kpi_definition_id OR NEW.kpi_scope_kind IS DISTINCT FROM OLD.kpi_scope_kind
     OR NEW.kpi_scope_id IS DISTINCT FROM OLD.kpi_scope_id OR NEW.benefit_id IS DISTINCT FROM OLD.benefit_id
     OR NEW.source_record_type IS DISTINCT FROM OLD.source_record_type OR NEW.source_record_id IS DISTINCT FROM OLD.source_record_id
     OR NEW.created_source IS DISTINCT FROM OLD.created_source THEN
    RAISE EXCEPTION 'corrective_case %: the code, source and creation source are immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'corrective_case_source_immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY['open>in_progress', 'in_progress>open', 'open>closed', 'in_progress>closed']) THEN
    RAISE EXCEPTION 'corrective_case %: % -> % is not a legal transition (ADR-0031)', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'corrective_case_status_transition';
  END IF;
  IF NEW.status = 'closed' AND NEW.owner_user_id IS NULL THEN
    RAISE EXCEPTION 'corrective_case %: a case without an owner cannot be closed; assign an owner first', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'corrective_case_owner_required';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER corrective_case_guard BEFORE INSERT OR UPDATE ON corrective_case
  FOR EACH ROW EXECUTE FUNCTION corrective_case_guard();
SELECT p2_attach_guards('corrective_case', true);
GRANT SELECT, INSERT, UPDATE ON corrective_case TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- corrective_signal: the append-only log of every consumed source event (system lineage, the calculation_run
-- precedent: no audit event of its own; the case it creates or updates is audited). source_event_key makes a
-- redelivered event a no-op at the database as well as in the processed_message ledger.
CREATE TABLE corrective_signal (
  id                    uuid PRIMARY KEY,
  organization_id       uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id     uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  source_kind           text NOT NULL CHECK (source_kind IN ('kpi_deviation', 'benefit_variance', 'adoption_check', 'control_check')),
  source_scope_key      text NOT NULL CHECK (char_length(source_scope_key) BETWEEN 1 AND 200),
  source_event_key      text NOT NULL CONSTRAINT corrective_signal_event_key UNIQUE CHECK (char_length(source_event_key) BETWEEN 1 AND 200),
  period_key            text NOT NULL CHECK (char_length(period_key) BETWEEN 1 AND 100),
  period_start          date NULL,
  period_end            date NULL,
  observed_rag          text NULL CHECK (observed_rag IS NULL OR observed_rag IN ('green', 'amber', 'red', 'unknown', 'stale', 'not_computable')),
  off_track             boolean NULL,
  rule_persistence      smallint NULL CHECK (rule_persistence IS NULL OR rule_persistence BETWEEN 1 AND 12),
  consecutive_off_track smallint NULL CHECK (consecutive_off_track IS NULL OR consecutive_off_track >= 0),
  outcome               text NOT NULL CHECK (outcome IN ('recorded', 'case_created', 'case_updated', 'rule_disabled')),
  corrective_case_id    uuid NULL,
  payload               jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  received_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT corrective_signal_case_fkey FOREIGN KEY (transformation_id, corrective_case_id) REFERENCES corrective_case (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT corrective_signal_outcome_case CHECK ((outcome IN ('case_created', 'case_updated')) = (corrective_case_id IS NOT NULL)),
  CONSTRAINT corrective_signal_period_range CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start),
  CONSTRAINT corrective_signal_rag_kpi_only CHECK (source_kind = 'kpi_deviation' OR observed_rag IS NULL)
);
CREATE INDEX corrective_signal_scope_idx ON corrective_signal (transformation_id, source_kind, source_scope_key, period_start DESC, received_at DESC);
CREATE INDEX corrective_signal_case_idx ON corrective_signal (corrective_case_id) WHERE corrective_case_id IS NOT NULL;
SELECT p2_attach_guards('corrective_signal', false);
SELECT p2_attach_append_only('corrective_signal');
GRANT SELECT, INSERT ON corrective_signal TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- action_item (DG2 0017): P4 source links and a follow-up date (p4-plan seam 13, additive). Existing rows keep every
-- value (all new columns are NULL); statuses are unchanged. An action has at most one source. Actions are always
-- person-created (created_by stays NOT NULL); the worker's recovery action is the corrective case itself (ADR-0031 §6).
ALTER TABLE action_item
  ADD COLUMN raid_entry_id      uuid NULL,
  ADD COLUMN dependency_id      uuid NULL,
  ADD COLUMN corrective_case_id uuid NULL,
  ADD COLUMN follow_up_date     date NULL,
  ADD CONSTRAINT action_item_raid_entry_id_fkey FOREIGN KEY (transformation_id, raid_entry_id) REFERENCES raid_entry (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT action_item_dependency_id_fkey FOREIGN KEY (transformation_id, dependency_id) REFERENCES dependency (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT action_item_corrective_case_id_fkey FOREIGN KEY (transformation_id, corrective_case_id) REFERENCES corrective_case (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT action_item_one_source CHECK (num_nonnulls(source_workshop_item_id, raid_entry_id, dependency_id, corrective_case_id) <= 1);
CREATE INDEX action_item_raid_entry_idx ON action_item (raid_entry_id) WHERE raid_entry_id IS NOT NULL;
CREATE INDEX action_item_dependency_idx ON action_item (dependency_id) WHERE dependency_id IS NOT NULL;
CREATE INDEX action_item_corrective_case_idx ON action_item (corrective_case_id) WHERE corrective_case_id IS NOT NULL;
-- The source link is set at creation and never changes (an action is re-linked by creating a new one).
CREATE FUNCTION action_item_source_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.raid_entry_id IS DISTINCT FROM OLD.raid_entry_id OR NEW.dependency_id IS DISTINCT FROM OLD.dependency_id
     OR NEW.corrective_case_id IS DISTINCT FROM OLD.corrective_case_id THEN
    RAISE EXCEPTION 'action_item %: the source link is immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'action_item_source_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER action_item_source_immutable BEFORE UPDATE OF raid_entry_id, dependency_id, corrective_case_id ON action_item
  FOR EACH ROW EXECUTE FUNCTION action_item_source_immutable();
