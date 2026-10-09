-- 0048 P4 slice G: sustainment, BAU and closure. Performance areas that outlive their transformation (with an
-- append-only cycle history so a reopening preserves the earlier handover and closure), their KPI and benefit links,
-- BAU handovers with the M0217 content and receiving-owner acceptance, controls and periodic control checks, recurring
-- sustainment reviews (performance-area reviews and transition-decision monitoring), the continuous-improvement
-- backlog, lessons (searchable across transformations), benefit transition decisions for long-realization benefits,
-- governed closure records, and the separate delivery and adoption status columns on initiative
-- (T-DG4-ARCH-06; ADR-0034; REQ-PB-009, REQ-PB-083, REQ-PB-084, REQ-S03-002, REQ-S03-003, REQ-S11-004, REQ-S11-005,
-- REQ-S11-006, REQ-S11-007, REQ-S11-008, REQ-S11-009). Authored by solution-architect.
-- Contract: docs/architecture/data-dictionary.md ("P4 tables, slice G").
-- Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged.
-- SQL floor: PostgreSQL 16. Nothing here approves anything, and nothing touches DG0-DG7. Product gate G6 is read
-- (gate_instance) and never written here.

-- Human-readable codes: PA-01 (performance areas), HO-01 (handovers), CTL-01 (controls), CI-01 (improvement items),
-- LL-01 (lessons), TD-01 (transition decisions).
ALTER TABLE record_code_counter DROP CONSTRAINT record_code_counter_prefix_check;
ALTER TABLE record_code_counter ADD CONSTRAINT record_code_counter_prefix_check
  CHECK (prefix IN ('D', 'DEC', 'GD', 'DEP', 'INI', 'BC', 'BF', 'B', 'BG', 'VM', 'R', 'A', 'I', 'CA', 'SG', 'AI',
                    'PA', 'HO', 'CTL', 'CI', 'LL', 'TD'));

-- The recurrence vocabulary shared by reviews, controls and monitoring.
CREATE FUNCTION p4_sustain_frequency_valid(p_frequency text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_frequency IN ('weekly', 'monthly', 'quarterly', 'semi_annual', 'annual')
$$;

-- Lesson tags: each 1-50 characters, none repeated (IMMUTABLE helper, because a CHECK cannot hold a subquery).
CREATE FUNCTION p4_tags_valid(p_tags text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p4_text_array_distinct(p_tags) AND NOT EXISTS (SELECT 1 FROM unnest(p_tags) t WHERE t IS NULL OR char_length(t) NOT BETWEEN 1 AND 50)
$$;

-- -----------------------------------------------------------------------------------------------------------------
-- initiative: separate delivery and adoption statuses (REQ-S03-003, REQ-PB-009, REQ-S11-006). initiative.status keeps
-- its DG3 meaning and edges; 'completed' is "delivery complete" and now records who completed delivery and when.
-- adoption_status is the Business Owner's assessment and is never derived from delivery. Closure is a closure_record
-- row (below), not a status value. Every existing row keeps its values: the new columns are NULL or default.
ALTER TABLE initiative
  ADD COLUMN delivery_completed_at  timestamptz NULL,
  ADD COLUMN delivery_completed_by  uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN adoption_status        text NOT NULL DEFAULT 'not_assessed'
             CONSTRAINT initiative_adoption_status_valid CHECK (adoption_status IN ('not_assessed', 'on_track', 'at_risk', 'adopted')),
  ADD COLUMN adoption_status_note   text NULL CHECK (adoption_status_note IS NULL OR char_length(adoption_status_note) BETWEEN 1 AND 2000),
  ADD COLUMN adoption_status_set_at timestamptz NULL,
  ADD COLUMN adoption_status_set_by uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT initiative_delivery_completed_stamps CHECK ((delivery_completed_at IS NULL) = (delivery_completed_by IS NULL)),
  ADD CONSTRAINT initiative_adoption_status_stamps CHECK ((adoption_status_set_at IS NULL) = (adoption_status_set_by IS NULL)
                                                         AND (adoption_status = 'not_assessed' OR adoption_status_set_at IS NOT NULL));
CREATE FUNCTION initiative_delivery_complete_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status <> 'completed' AND NEW.delivery_completed_at IS NULL THEN
    RAISE EXCEPTION 'initiative %: delivery completion records who completed it and when', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'initiative_delivery_completed_recorded';
  END IF;
  IF NEW.delivery_completed_at IS DISTINCT FROM OLD.delivery_completed_at
     AND (OLD.delivery_completed_at IS NOT NULL OR NEW.status <> 'completed') THEN
    RAISE EXCEPTION 'initiative %: delivery completion is set once, with the move to completed', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'initiative_delivery_completed_once';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER initiative_delivery_complete_guard BEFORE UPDATE ON initiative
  FOR EACH ROW EXECUTE FUNCTION initiative_delivery_complete_guard();

-- -----------------------------------------------------------------------------------------------------------------
-- performance_area (REQ-S03-002, REQ-S11-004, REQ-S11-009; M0092 "performance areas and BAU ownership can continue
-- indefinitely"). transformation_id is the ORIGIN transformation (its scope and audit trail); the area's status never
-- depends on that transformation's status, and no guard here reads it. Status machine:
--   establishing -> bau            (a BAU handover of the current cycle is accepted)
--   bau          -> reopened       (deteriorating performance; cycle_no + 1, a new performance_area_cycle row)
--   reopened     -> bau            (a handover of the new cycle is accepted)
--   any non-retired -> retired     (final)
CREATE TABLE performance_area (
  id                       uuid PRIMARY KEY,
  organization_id          uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id        uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code                     text NOT NULL CHECK (code ~ '^PA-[0-9]{2,6}$'),
  name                     text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description              text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 4000),
  business_unit_id         uuid NULL REFERENCES business_unit (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  sponsor_user_id          uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  bau_owner_user_id        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kpi_owner_user_id        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  review_frequency         text NOT NULL DEFAULT 'monthly' CONSTRAINT performance_area_review_frequency_valid CHECK (p4_sustain_frequency_valid(review_frequency)),
  review_interval          smallint NOT NULL DEFAULT 1 CHECK (review_interval BETWEEN 1 AND 12),
  next_review_date         date NULL,
  cycle_no                 integer NOT NULL DEFAULT 1 CHECK (cycle_no >= 1),
  status                   text NOT NULL DEFAULT 'establishing' CHECK (status IN ('establishing', 'bau', 'reopened', 'retired')),
  current_handover_id      uuid NULL,
  retired_at               timestamptz NULL,
  retired_by               uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  retire_reason            text NULL CHECK (retire_reason IS NULL OR char_length(retire_reason) BETWEEN 3 AND 1000),
  version                  integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT performance_area_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT performance_area_code_key UNIQUE (transformation_id, code),
  CONSTRAINT performance_area_retired_complete CHECK ((status = 'retired') = (retired_at IS NOT NULL) AND (retired_at IS NULL) = (retired_by IS NULL) AND (retired_at IS NULL) = (retire_reason IS NULL)),
  -- In BAU the area has a BAU owner, an accepted handover and a next review date.
  CONSTRAINT performance_area_bau_complete CHECK (status <> 'bau' OR (bau_owner_user_id IS NOT NULL AND current_handover_id IS NOT NULL AND next_review_date IS NOT NULL))
);
CREATE INDEX performance_area_org_idx ON performance_area (organization_id, status, code);
CREATE INDEX performance_area_review_due_idx ON performance_area (next_review_date) WHERE status IN ('bau', 'reopened');

-- performance_area_cycle: the append-only history of an area's cycles (REQ-S11-009 "Reopening creates a new cycle
-- linked to the prior closure; nothing is overwritten"). Cycle 1 is written when the area is created; each reopening
-- writes the next cycle with its reason and copies the prior cycle's accepted handover, its acceptance time and the
-- origin transformation's closure (if any) as they were. UPDATE, DELETE and TRUNCATE are refused.
CREATE TABLE performance_area_cycle (
  id                        uuid PRIMARY KEY,
  organization_id           uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id         uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  performance_area_id       uuid NOT NULL,
  cycle_no                  integer NOT NULL CHECK (cycle_no >= 1),
  opened_at                 timestamptz NOT NULL DEFAULT now(),
  opened_by                 uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  reopen_reason             text NULL CHECK (reopen_reason IS NULL OR char_length(reopen_reason) BETWEEN 3 AND 2000),
  prior_handover_id         uuid NULL,
  prior_handover_accepted_at timestamptz NULL,
  prior_handover_accepted_by uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  prior_closure_record_id   uuid NULL,
  prior_closed_at           timestamptz NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT performance_area_cycle_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT performance_area_cycle_no_key UNIQUE (performance_area_id, cycle_no),
  CONSTRAINT performance_area_cycle_area_fkey FOREIGN KEY (transformation_id, performance_area_id) REFERENCES performance_area (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT performance_area_cycle_first CHECK ((cycle_no = 1) = (reopen_reason IS NULL)
                                                AND (cycle_no > 1 OR prior_handover_id IS NULL)
                                                AND (cycle_no = 1 OR prior_handover_id IS NOT NULL)),
  CONSTRAINT performance_area_cycle_prior_stamps CHECK ((prior_handover_id IS NULL) = (prior_handover_accepted_at IS NULL)
                                                       AND (prior_handover_accepted_at IS NULL) = (prior_handover_accepted_by IS NULL)
                                                       AND (prior_closure_record_id IS NULL) = (prior_closed_at IS NULL))
);
SELECT p2_attach_append_only('performance_area_cycle');
SELECT p2_attach_guards('performance_area_cycle', true);
GRANT SELECT, INSERT ON performance_area_cycle TO mth_app;

-- performance_area_link: the KPIs and benefits an area carries on (REQ-S03-002 "their KPIs, owners and review cadence
-- remain active"; REQ-PB-083 "transfers routine ownership of KPIs, controls and benefits"). Removal is a status change.
CREATE TABLE performance_area_link (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id   uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  performance_area_id uuid NOT NULL,
  link_kind           text NOT NULL CHECK (link_kind IN ('kpi', 'benefit')),
  kpi_definition_id   uuid NULL,
  benefit_id          uuid NULL,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  removed_at          timestamptz NULL,
  removed_by          uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT performance_area_link_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT performance_area_link_area_fkey FOREIGN KEY (transformation_id, performance_area_id) REFERENCES performance_area (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT performance_area_link_kpi_fkey FOREIGN KEY (transformation_id, kpi_definition_id) REFERENCES kpi_definition (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT performance_area_link_benefit_fkey FOREIGN KEY (transformation_id, benefit_id) REFERENCES benefit (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT performance_area_link_target CHECK ((link_kind = 'kpi') = (kpi_definition_id IS NOT NULL) AND (link_kind = 'benefit') = (benefit_id IS NOT NULL)),
  CONSTRAINT performance_area_link_removed_complete CHECK ((status = 'removed') = (removed_at IS NOT NULL) AND (removed_at IS NULL) = (removed_by IS NULL))
);
CREATE UNIQUE INDEX performance_area_link_active_key ON performance_area_link (performance_area_id, link_kind, coalesce(kpi_definition_id, benefit_id)) WHERE status = 'active';
CREATE FUNCTION performance_area_link_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'active' THEN
    RAISE EXCEPTION 'performance_area_link: a new link is active'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'performance_area_link_starts_active';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'removed' THEN
      RAISE EXCEPTION 'performance_area_link %: a removed link is final', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'performance_area_link_removed_final';
    END IF;
    IF NEW.performance_area_id IS DISTINCT FROM OLD.performance_area_id OR NEW.link_kind IS DISTINCT FROM OLD.link_kind
       OR NEW.kpi_definition_id IS DISTINCT FROM OLD.kpi_definition_id OR NEW.benefit_id IS DISTINCT FROM OLD.benefit_id THEN
      RAISE EXCEPTION 'performance_area_link %: area and target are immutable', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'performance_area_link_identity';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER performance_area_link_guard BEFORE INSERT OR UPDATE ON performance_area_link FOR EACH ROW EXECUTE FUNCTION performance_area_link_guard();
SELECT p2_attach_guards('performance_area_link', true);
GRANT SELECT, INSERT, UPDATE ON performance_area_link TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- control (REQ-PB-083 "controls and control cadence"; REQ-S11-008 "Controls generate periodic checks"): a BAU control
-- of a performance area with its check frequency. Status: active -> retired (final).
CREATE TABLE control (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id   uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  performance_area_id uuid NOT NULL,
  code                text NOT NULL CHECK (code ~ '^CTL-[0-9]{2,6}$'),
  name                text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 300),
  description         text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 4000),
  owner_user_id       uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  frequency           text NOT NULL CONSTRAINT control_frequency_valid CHECK (p4_sustain_frequency_valid(frequency)),
  frequency_interval  smallint NOT NULL DEFAULT 1 CHECK (frequency_interval BETWEEN 1 AND 12),
  next_check_date     date NULL,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  retired_at          timestamptz NULL,
  retired_by          uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  retire_reason       text NULL CHECK (retire_reason IS NULL OR char_length(retire_reason) BETWEEN 3 AND 1000),
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT control_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT control_code_key UNIQUE (transformation_id, code),
  CONSTRAINT control_area_fkey FOREIGN KEY (transformation_id, performance_area_id) REFERENCES performance_area (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT control_retired_complete CHECK ((status = 'retired') = (retired_at IS NOT NULL) AND (retired_at IS NULL) = (retired_by IS NULL) AND (retired_at IS NULL) = (retire_reason IS NULL))
);
CREATE INDEX control_area_idx ON control (performance_area_id, status);
CREATE INDEX control_check_due_idx ON control (next_check_date) WHERE status = 'active';
CREATE FUNCTION control_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'active' THEN
    RAISE EXCEPTION 'control: a new control is active'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'control_starts_active';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'retired' THEN
      RAISE EXCEPTION 'control %: a retired control is final', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'control_retired_final';
    END IF;
    IF NEW.performance_area_id IS DISTINCT FROM OLD.performance_area_id OR NEW.code IS DISTINCT FROM OLD.code THEN
      RAISE EXCEPTION 'control %: area and code are immutable', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'control_identity';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER control_guard BEFORE INSERT OR UPDATE ON control FOR EACH ROW EXECUTE FUNCTION control_guard();
SELECT p2_attach_guards('control', true);
GRANT SELECT, INSERT, UPDATE ON control TO mth_app;

-- control_check (REQ-S11-008 "periodic control checks"; "a failed control check creates a recovery action"): one
-- check of one control for one due date (UNIQUE: a worker restart cannot duplicate it). Status: due -> passed | failed
-- | cancelled (all final). A failed check carries its result note; its service writes the outbox event
-- control_check.failed (ADR-0031 §5.4 payload) in the same transaction, and slice E opens exactly one corrective case.
CREATE TABLE control_check (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id   uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  control_id          uuid NOT NULL,
  performance_area_id uuid NOT NULL,
  due_date            date NOT NULL,
  assignee_user_id    uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status              text NOT NULL DEFAULT 'due' CHECK (status IN ('due', 'passed', 'failed', 'cancelled')),
  performed_at        timestamptz NULL,
  performed_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  result_note         text NULL CHECK (result_note IS NULL OR char_length(result_note) BETWEEN 3 AND 4000),
  created_source      text NOT NULL CHECK (created_source IN ('api', 'worker')),
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT control_check_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT control_check_due_key UNIQUE (control_id, due_date),
  CONSTRAINT control_check_control_fkey FOREIGN KEY (transformation_id, control_id) REFERENCES control (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT control_check_area_fkey FOREIGN KEY (transformation_id, performance_area_id) REFERENCES performance_area (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT control_check_created_source CHECK ((created_source = 'api') = (created_by IS NOT NULL)),
  CONSTRAINT control_check_performed_complete CHECK ((status IN ('passed', 'failed')) = (performed_at IS NOT NULL)
                                                    AND (performed_at IS NULL) = (performed_by IS NULL)
                                                    AND (status <> 'failed' OR result_note IS NOT NULL))
);
CREATE INDEX control_check_open_idx ON control_check (assignee_user_id, due_date) WHERE status = 'due';
CREATE FUNCTION control_check_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'due' THEN
      RAISE EXCEPTION 'control_check: a new check is due'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'control_check_starts_due';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM control c WHERE c.id = NEW.control_id AND c.performance_area_id = NEW.performance_area_id AND c.status = 'active') THEN
      RAISE EXCEPTION 'control_check: a check belongs to an active control of the same performance area'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'control_check_control_active';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'due' THEN
    RAISE EXCEPTION 'control_check %: a % check is final', OLD.id, OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'control_check_final';
  END IF;
  IF NEW.control_id IS DISTINCT FROM OLD.control_id OR NEW.performance_area_id IS DISTINCT FROM OLD.performance_area_id
     OR NEW.due_date IS DISTINCT FROM OLD.due_date OR NEW.created_source IS DISTINCT FROM OLD.created_source THEN
    RAISE EXCEPTION 'control_check %: control, area, due date and source are immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'control_check_identity';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER control_check_guard BEFORE INSERT OR UPDATE ON control_check FOR EACH ROW EXECUTE FUNCTION control_check_guard();
SELECT p2_attach_guards('control_check', true);
GRANT SELECT, INSERT, UPDATE ON control_check TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- bau_handover (REQ-PB-083, REQ-S11-005; M0217): the handover of one performance-area cycle to its receiving Business
-- Owner. Status machine:
--   draft -> submitted              (every M0217 item present: trigger bau_handover_complete_on_submit)
--   submitted -> accepted           (ONLY by the receiving owner: accepted_by = receiving_owner_user_id)
--   submitted -> returned           (by the receiving owner, with a reason)
--   returned -> submitted           (resubmission after edits)
--   accepted is final and immutable; content is editable only in draft or returned.
CREATE TABLE bau_handover (
  id                          uuid PRIMARY KEY,
  organization_id             uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id           uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  performance_area_id         uuid NOT NULL,
  cycle_no                    integer NOT NULL CHECK (cycle_no >= 1),
  code                        text NOT NULL CHECK (code ~ '^HO-[0-9]{2,6}$'),
  receiving_owner_user_id     uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kpi_owner_user_id           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  operating_procedures        text NULL CHECK (operating_procedures IS NULL OR char_length(operating_procedures) BETWEEN 1 AND 8000),
  capability_readiness        text NULL CHECK (capability_readiness IS NULL OR char_length(capability_readiness) BETWEEN 1 AND 8000),
  unresolved_accepted_risks   text NULL CHECK (unresolved_accepted_risks IS NULL OR char_length(unresolved_accepted_risks) BETWEEN 1 AND 8000),
  benefit_monitoring_cadence  text NULL CONSTRAINT bau_handover_cadence_valid CHECK (benefit_monitoring_cadence IS NULL OR p4_sustain_frequency_valid(benefit_monitoring_cadence)),
  data_access                 text NULL CHECK (data_access IS NULL OR char_length(data_access) BETWEEN 1 AND 8000),
  improvement_backlog_summary text NULL CHECK (improvement_backlog_summary IS NULL OR char_length(improvement_backlog_summary) BETWEEN 1 AND 8000),
  status                      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'accepted', 'returned')),
  submitted_at                timestamptz NULL,
  submitted_by                uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  accepted_at                 timestamptz NULL,
  accepted_by                 uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  acceptance_note             text NULL CHECK (acceptance_note IS NULL OR char_length(acceptance_note) BETWEEN 1 AND 2000),
  returned_at                 timestamptz NULL,
  returned_by                 uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  return_reason               text NULL CHECK (return_reason IS NULL OR char_length(return_reason) BETWEEN 3 AND 2000),
  version                     integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT bau_handover_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT bau_handover_code_key UNIQUE (transformation_id, code),
  CONSTRAINT bau_handover_area_fkey FOREIGN KEY (transformation_id, performance_area_id) REFERENCES performance_area (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT bau_handover_submitted_stamps CHECK ((submitted_at IS NULL) = (submitted_by IS NULL) AND (status = 'draft') = (submitted_at IS NULL)),
  CONSTRAINT bau_handover_accepted_complete CHECK ((status = 'accepted') = (accepted_at IS NOT NULL)
                                                  AND (accepted_at IS NULL) = (accepted_by IS NULL)
                                                  AND (accepted_by IS NULL OR accepted_by = receiving_owner_user_id)),
  CONSTRAINT bau_handover_returned_stamps CHECK ((returned_at IS NULL) = (returned_by IS NULL) AND (returned_at IS NULL) = (return_reason IS NULL)
                                                AND (status <> 'returned' OR returned_at IS NOT NULL)
                                                AND (returned_by IS NULL OR returned_by = receiving_owner_user_id)),
  -- Every item of M0217 is present once the handover leaves draft (controls and evidence are counted by the trigger).
  CONSTRAINT bau_handover_content_complete CHECK (status = 'draft' OR (kpi_owner_user_id IS NOT NULL AND operating_procedures IS NOT NULL
                                                  AND capability_readiness IS NOT NULL AND unresolved_accepted_risks IS NOT NULL
                                                  AND benefit_monitoring_cadence IS NOT NULL AND data_access IS NOT NULL
                                                  AND improvement_backlog_summary IS NOT NULL))
);
-- One handover in progress and at most one accepted handover per area and cycle.
CREATE UNIQUE INDEX bau_handover_open_key ON bau_handover (performance_area_id, cycle_no) WHERE status IN ('draft', 'submitted', 'returned');
CREATE UNIQUE INDEX bau_handover_accepted_key ON bau_handover (performance_area_id, cycle_no) WHERE status = 'accepted';
ALTER TABLE performance_area ADD CONSTRAINT performance_area_current_handover_fkey
  FOREIGN KEY (transformation_id, current_handover_id) REFERENCES bau_handover (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE performance_area_cycle ADD CONSTRAINT performance_area_cycle_prior_handover_fkey
  FOREIGN KEY (transformation_id, prior_handover_id) REFERENCES bau_handover (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- bau_handover_evidence: the evidence items of a handover (M0217 "evidence"). Append-only; a handover in draft or
-- returned takes new links.
CREATE TABLE bau_handover_evidence (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  handover_id       uuid NOT NULL,
  evidence_id       uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT bau_handover_evidence_key UNIQUE (handover_id, evidence_id),
  CONSTRAINT bau_handover_evidence_handover_fkey FOREIGN KEY (transformation_id, handover_id) REFERENCES bau_handover (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT bau_handover_evidence_evidence_fkey FOREIGN KEY (transformation_id, evidence_id) REFERENCES evidence (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE FUNCTION bau_handover_evidence_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM bau_handover h WHERE h.id = NEW.handover_id AND h.status IN ('draft', 'returned')) THEN
    RAISE EXCEPTION 'bau_handover_evidence: evidence is linked while the handover is in draft or returned'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bau_handover_evidence_editable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bau_handover_evidence_guard BEFORE INSERT ON bau_handover_evidence FOR EACH ROW EXECUTE FUNCTION bau_handover_evidence_guard();
SELECT p2_attach_append_only('bau_handover_evidence');
SELECT p2_attach_guards('bau_handover_evidence', true);
GRANT SELECT, INSERT ON bau_handover_evidence TO mth_app;

CREATE FUNCTION bau_handover_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT status, cycle_no INTO a FROM performance_area WHERE id = NEW.performance_area_id;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'bau_handover: a new handover is a draft'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'bau_handover_starts_draft';
    END IF;
    IF a.status NOT IN ('establishing', 'reopened') OR NEW.cycle_no <> a.cycle_no THEN
      RAISE EXCEPTION 'bau_handover: a handover is prepared for the current cycle of an establishing or reopened area'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'bau_handover_area_open';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'accepted' THEN
    RAISE EXCEPTION 'bau_handover %: an accepted handover is final and immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bau_handover_accepted_final';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY[
      'draft>submitted', 'submitted>accepted', 'submitted>returned', 'returned>submitted']) THEN
    RAISE EXCEPTION 'bau_handover %: % -> % is not a legal transition', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bau_handover_transition';
  END IF;
  IF NEW.performance_area_id IS DISTINCT FROM OLD.performance_area_id OR NEW.cycle_no IS DISTINCT FROM OLD.cycle_no
     OR NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'bau_handover %: area, cycle and code are immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bau_handover_identity';
  END IF;
  -- Content changes only in draft or returned (a submitted handover is what the receiving owner reviews).
  IF OLD.status = 'submitted' AND (NEW.receiving_owner_user_id IS DISTINCT FROM OLD.receiving_owner_user_id
     OR NEW.kpi_owner_user_id IS DISTINCT FROM OLD.kpi_owner_user_id OR NEW.operating_procedures IS DISTINCT FROM OLD.operating_procedures
     OR NEW.capability_readiness IS DISTINCT FROM OLD.capability_readiness OR NEW.unresolved_accepted_risks IS DISTINCT FROM OLD.unresolved_accepted_risks
     OR NEW.benefit_monitoring_cadence IS DISTINCT FROM OLD.benefit_monitoring_cadence OR NEW.data_access IS DISTINCT FROM OLD.data_access
     OR NEW.improvement_backlog_summary IS DISTINCT FROM OLD.improvement_backlog_summary) THEN
    RAISE EXCEPTION 'bau_handover %: a submitted handover''s content is frozen until it is returned', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bau_handover_content_frozen';
  END IF;
  IF NEW.status = 'submitted' AND OLD.status <> 'submitted' THEN
    IF NOT EXISTS (SELECT 1 FROM control c WHERE c.performance_area_id = NEW.performance_area_id AND c.status = 'active') THEN
      RAISE EXCEPTION 'bau_handover %: a handover names at least one active control of the area', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'bau_handover_controls_required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM bau_handover_evidence e WHERE e.handover_id = NEW.id) THEN
      RAISE EXCEPTION 'bau_handover %: a handover carries at least one evidence item', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'bau_handover_evidence_required';
    END IF;
  END IF;
  IF NEW.status = 'accepted' AND a.cycle_no <> NEW.cycle_no THEN
    RAISE EXCEPTION 'bau_handover %: only a handover of the area''s current cycle can be accepted', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bau_handover_current_cycle';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bau_handover_guard BEFORE INSERT OR UPDATE ON bau_handover FOR EACH ROW EXECUTE FUNCTION bau_handover_guard();
SELECT p2_attach_guards('bau_handover', true);
GRANT SELECT, INSERT, UPDATE ON bau_handover TO mth_app;

-- The area's status machine (defined after bau_handover, which it reads).
CREATE FUNCTION performance_area_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'establishing' OR NEW.cycle_no <> 1 OR NEW.current_handover_id IS NOT NULL THEN
      RAISE EXCEPTION 'performance_area: a new area is establishing, in cycle 1, without a handover'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'performance_area_starts_establishing';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'retired' THEN
    RAISE EXCEPTION 'performance_area %: a retired area is final', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'performance_area_retired_final';
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'performance_area %: the code is immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'performance_area_code_immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY[
      'establishing>bau', 'bau>reopened', 'reopened>bau', 'establishing>retired', 'bau>retired', 'reopened>retired']) THEN
    RAISE EXCEPTION 'performance_area %: % -> % is not a legal transition', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'performance_area_transition';
  END IF;
  -- The cycle steps by exactly 1, and only with a reopening (which writes its performance_area_cycle row).
  IF NEW.cycle_no IS DISTINCT FROM OLD.cycle_no AND NOT (NEW.cycle_no = OLD.cycle_no + 1 AND OLD.status = 'bau' AND NEW.status = 'reopened') THEN
    RAISE EXCEPTION 'performance_area %: the cycle steps by 1 only when the area is reopened', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'performance_area_cycle_step';
  END IF;
  IF NEW.status = 'reopened' AND OLD.status = 'bau' AND NEW.cycle_no <> OLD.cycle_no + 1 THEN
    RAISE EXCEPTION 'performance_area %: a reopening starts the next cycle', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'performance_area_cycle_step';
  END IF;
  -- Entering BAU names the accepted handover of the current cycle.
  IF NEW.status = 'bau' AND (NEW.current_handover_id IS DISTINCT FROM OLD.current_handover_id OR OLD.status <> 'bau')
     AND NOT EXISTS (SELECT 1 FROM bau_handover h WHERE h.id = NEW.current_handover_id AND h.performance_area_id = NEW.id
                       AND h.cycle_no = NEW.cycle_no AND h.status = 'accepted') THEN
    RAISE EXCEPTION 'performance_area %: BAU requires the accepted handover of the current cycle', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'performance_area_bau_handover_accepted';
  END IF;
  IF NEW.status = 'reopened' AND OLD.status = 'bau' AND NEW.current_handover_id IS DISTINCT FROM OLD.current_handover_id THEN
    RAISE EXCEPTION 'performance_area %: a reopening keeps the prior accepted handover visible', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'performance_area_reopen_keeps_handover';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER performance_area_guard BEFORE INSERT OR UPDATE ON performance_area FOR EACH ROW EXECUTE FUNCTION performance_area_guard();
SELECT p2_attach_guards('performance_area', true);
GRANT SELECT, INSERT, UPDATE ON performance_area TO mth_app;

-- A reopening is only complete with its cycle row: at COMMIT, every area has a cycle row for its current cycle.
CREATE FUNCTION performance_area_cycle_present() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM performance_area_cycle c WHERE c.performance_area_id = NEW.id AND c.cycle_no = NEW.cycle_no) THEN
    RAISE EXCEPTION 'performance_area %: no performance_area_cycle row for cycle %', NEW.id, NEW.cycle_no
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'performance_area_cycle_present';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER performance_area_cycle_present AFTER INSERT OR UPDATE ON performance_area DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION performance_area_cycle_present();

-- -----------------------------------------------------------------------------------------------------------------
-- transition_decision (REQ-S11-007; M0218 "allow a documented transition decision with residual benefit ownership and
-- scheduled monitoring; do not label forecast future value as already sustained"). One decision per benefit at a time.
-- It is decided through the canonical approval (ADR-0026; approval type benefit_transition_decision, assignee party SP
-- by default). Status: draft -> submitted -> approved | rejected; submitted -> draft (changes requested);
-- draft | submitted -> withdrawn. approved, rejected and withdrawn are final. NOTHING here writes a benefit value:
-- the benefit's forecast stays forecast.
CREATE TABLE transition_decision (
  id                       uuid PRIMARY KEY,
  organization_id          uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id        uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code                     text NOT NULL CHECK (code ~ '^TD-[0-9]{2,6}$'),
  benefit_id               uuid NOT NULL,
  residual_owner_user_id   uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  rationale                text NOT NULL CHECK (char_length(rationale) BETWEEN 3 AND 4000),
  expected_realization_end date NOT NULL,
  monitoring_frequency     text NOT NULL CONSTRAINT transition_decision_frequency_valid CHECK (p4_sustain_frequency_valid(monitoring_frequency)),
  monitoring_interval      smallint NOT NULL DEFAULT 1 CHECK (monitoring_interval BETWEEN 1 AND 12),
  first_monitoring_date    date NOT NULL,
  next_monitoring_date     date NULL,
  status                   text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'withdrawn')),
  approval_id              uuid NULL REFERENCES approval (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_at               timestamptz NULL,
  decided_by               uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version                  integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT transition_decision_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT transition_decision_code_key UNIQUE (transformation_id, code),
  CONSTRAINT transition_decision_benefit_fkey FOREIGN KEY (transformation_id, benefit_id) REFERENCES benefit (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT transition_decision_decided_complete CHECK ((status IN ('approved', 'rejected')) = (decided_at IS NOT NULL)
                                                        AND (decided_at IS NULL) = (decided_by IS NULL)
                                                        AND (status NOT IN ('submitted', 'approved', 'rejected') OR approval_id IS NOT NULL)),
  CONSTRAINT transition_decision_monitoring_dates CHECK (first_monitoring_date <= expected_realization_end
                                                        AND (status <> 'approved' OR next_monitoring_date IS NOT NULL))
);
CREATE UNIQUE INDEX transition_decision_live_key ON transition_decision (benefit_id) WHERE status IN ('draft', 'submitted', 'approved');
CREATE INDEX transition_decision_monitoring_idx ON transition_decision (next_monitoring_date) WHERE status = 'approved';
CREATE FUNCTION transition_decision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'transition_decision: a new decision is a draft'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'transition_decision_starts_draft';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('approved', 'rejected', 'withdrawn') AND (NEW.status IS DISTINCT FROM OLD.status
     OR NEW.residual_owner_user_id IS DISTINCT FROM OLD.residual_owner_user_id OR NEW.rationale IS DISTINCT FROM OLD.rationale
     OR NEW.expected_realization_end IS DISTINCT FROM OLD.expected_realization_end OR NEW.monitoring_frequency IS DISTINCT FROM OLD.monitoring_frequency
     OR NEW.monitoring_interval IS DISTINCT FROM OLD.monitoring_interval OR NEW.first_monitoring_date IS DISTINCT FROM OLD.first_monitoring_date
     OR NEW.approval_id IS DISTINCT FROM OLD.approval_id OR NEW.decided_at IS DISTINCT FROM OLD.decided_at) THEN
    -- An approved decision keeps its content; only next_monitoring_date advances as reviews are scheduled.
    RAISE EXCEPTION 'transition_decision %: a % decision is final (only its next monitoring date advances)', OLD.id, OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'transition_decision_final';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY[
      'draft>submitted', 'submitted>approved', 'submitted>rejected', 'submitted>draft', 'draft>withdrawn', 'submitted>withdrawn']) THEN
    RAISE EXCEPTION 'transition_decision %: % -> % is not a legal transition', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'transition_decision_transition';
  END IF;
  IF NEW.benefit_id IS DISTINCT FROM OLD.benefit_id OR NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'transition_decision %: benefit and code are immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'transition_decision_identity';
  END IF;
  IF OLD.status = 'submitted' AND NEW.status = 'submitted' AND (NEW.residual_owner_user_id IS DISTINCT FROM OLD.residual_owner_user_id
     OR NEW.rationale IS DISTINCT FROM OLD.rationale OR NEW.expected_realization_end IS DISTINCT FROM OLD.expected_realization_end
     OR NEW.monitoring_frequency IS DISTINCT FROM OLD.monitoring_frequency OR NEW.monitoring_interval IS DISTINCT FROM OLD.monitoring_interval
     OR NEW.first_monitoring_date IS DISTINCT FROM OLD.first_monitoring_date) THEN
    RAISE EXCEPTION 'transition_decision %: a submitted decision''s content is frozen', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'transition_decision_content_frozen';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transition_decision_guard BEFORE INSERT OR UPDATE ON transition_decision FOR EACH ROW EXECUTE FUNCTION transition_decision_guard();
SELECT p2_attach_guards('transition_decision', true);
GRANT SELECT, INSERT, UPDATE ON transition_decision TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- sustainment_review: one recurring review task (REQ-S11-004 "after closure, the next scheduled review task is created
-- on time"; REQ-PB-083 "accepting a handover creates recurring BAU review tasks for the BAU owner exactly once";
-- REQ-S11-007 "monitoring tasks appear for the residual owner"). UNIQUE per subject and due date, so a redelivered job,
-- a worker restart or a repeated acceptance cannot duplicate a review. Status: due -> done | cancelled (final).
CREATE TABLE sustainment_review (
  id                     uuid PRIMARY KEY,
  organization_id        uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id      uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  subject_kind           text NOT NULL CHECK (subject_kind IN ('performance_area', 'transition_decision')),
  performance_area_id    uuid NULL,
  cycle_no               integer NULL CHECK (cycle_no IS NULL OR cycle_no >= 1),
  transition_decision_id uuid NULL,
  due_date               date NOT NULL,
  assignee_user_id       uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status                 text NOT NULL DEFAULT 'due' CHECK (status IN ('due', 'done', 'cancelled')),
  completed_at           timestamptz NULL,
  completed_by           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  outcome_note           text NULL CHECK (outcome_note IS NULL OR char_length(outcome_note) BETWEEN 3 AND 4000),
  performance_signal     text NULL CHECK (performance_signal IS NULL OR performance_signal IN ('on_track', 'deteriorating', 'unknown')),
  created_source         text NOT NULL CHECK (created_source IN ('api', 'worker')),
  version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT sustainment_review_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT sustainment_review_area_fkey FOREIGN KEY (transformation_id, performance_area_id) REFERENCES performance_area (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT sustainment_review_decision_fkey FOREIGN KEY (transformation_id, transition_decision_id) REFERENCES transition_decision (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT sustainment_review_subject CHECK ((subject_kind = 'performance_area') = (performance_area_id IS NOT NULL)
                                              AND (performance_area_id IS NULL) = (cycle_no IS NULL)
                                              AND (subject_kind = 'transition_decision') = (transition_decision_id IS NOT NULL)),
  CONSTRAINT sustainment_review_created_source CHECK ((created_source = 'api') = (created_by IS NOT NULL)),
  CONSTRAINT sustainment_review_done_complete CHECK ((status = 'done') = (completed_at IS NOT NULL)
                                                    AND (completed_at IS NULL) = (completed_by IS NULL)
                                                    AND (status <> 'done' OR (outcome_note IS NOT NULL AND performance_signal IS NOT NULL)))
);
CREATE UNIQUE INDEX sustainment_review_due_key ON sustainment_review (subject_kind, coalesce(performance_area_id, transition_decision_id), due_date);
CREATE INDEX sustainment_review_assignee_idx ON sustainment_review (assignee_user_id, due_date) WHERE status = 'due';
CREATE FUNCTION sustainment_review_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'due' THEN
      RAISE EXCEPTION 'sustainment_review: a new review is due'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'sustainment_review_starts_due';
    END IF;
    IF NEW.performance_area_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM performance_area a WHERE a.id = NEW.performance_area_id AND a.status = 'bau' AND a.cycle_no = NEW.cycle_no) THEN
      RAISE EXCEPTION 'sustainment_review: a performance-area review is scheduled for an area in BAU, in its current cycle'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'sustainment_review_area_bau';
    END IF;
    IF NEW.transition_decision_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM transition_decision d WHERE d.id = NEW.transition_decision_id AND d.status = 'approved'
          AND d.residual_owner_user_id = NEW.assignee_user_id) THEN
      RAISE EXCEPTION 'sustainment_review: monitoring is scheduled for an approved transition decision, for its residual owner'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'sustainment_review_decision_approved';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'due' THEN
    RAISE EXCEPTION 'sustainment_review %: a % review is final', OLD.id, OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'sustainment_review_final';
  END IF;
  IF NEW.subject_kind IS DISTINCT FROM OLD.subject_kind OR NEW.performance_area_id IS DISTINCT FROM OLD.performance_area_id
     OR NEW.cycle_no IS DISTINCT FROM OLD.cycle_no OR NEW.transition_decision_id IS DISTINCT FROM OLD.transition_decision_id
     OR NEW.due_date IS DISTINCT FROM OLD.due_date OR NEW.created_source IS DISTINCT FROM OLD.created_source THEN
    RAISE EXCEPTION 'sustainment_review %: subject, cycle, due date and source are immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'sustainment_review_identity';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sustainment_review_guard BEFORE INSERT OR UPDATE ON sustainment_review FOR EACH ROW EXECUTE FUNCTION sustainment_review_guard();
SELECT p2_attach_guards('sustainment_review', true);
GRANT SELECT, INSERT, UPDATE ON sustainment_review TO mth_app;

-- The lesson search document: title, context, lesson, recommendation and tags in the 'simple' configuration. Declared
-- IMMUTABLE so it can feed a stored generated column (array_to_string is only STABLE in the catalogue; for text[] it
-- has no locale or setting dependence).
CREATE FUNCTION p4_lesson_document(p_title text, p_context text, p_lesson text, p_recommendation text, p_tags text[]) RETURNS tsvector
LANGUAGE sql IMMUTABLE AS $$
  SELECT to_tsvector('simple'::regconfig, p_title || ' ' || coalesce(p_context, '') || ' ' || p_lesson || ' '
                     || coalesce(p_recommendation, '') || ' ' || coalesce(array_to_string(p_tags, ' '), ''))
$$;

-- -----------------------------------------------------------------------------------------------------------------
-- lesson (REQ-S11-008 "a lesson is searchable from another transformation"). transformation_id is the transformation it
-- was learned in. A published lesson is readable by every user with lesson.search in the organization (ADR-0034 §8),
-- across transformations; a draft is visible in its own transformation only. Status: draft -> published -> archived;
-- archived is final. search_document is a generated tsvector ('simple' configuration: no language stemming, so Arabic
-- and English text are both tokenised the same way).
CREATE TABLE lesson (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id   uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code                text NOT NULL CHECK (code ~ '^LL-[0-9]{2,6}$'),
  performance_area_id uuid NULL,
  title               text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  context             text NULL CHECK (context IS NULL OR char_length(context) BETWEEN 1 AND 4000),
  lesson_text         text NOT NULL CHECK (char_length(lesson_text) BETWEEN 3 AND 8000),
  recommendation      text NULL CHECK (recommendation IS NULL OR char_length(recommendation) BETWEEN 1 AND 4000),
  tags                text[] NOT NULL DEFAULT '{}' CONSTRAINT lesson_tags_valid
                      CHECK (cardinality(tags) <= 10 AND p4_tags_valid(tags)),
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_at        timestamptz NULL,
  published_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archived_at         timestamptz NULL,
  archived_by         uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  search_document     tsvector GENERATED ALWAYS AS (
                        p4_lesson_document(title, context, lesson_text, recommendation, tags)) STORED,
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT lesson_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT lesson_code_key UNIQUE (transformation_id, code),
  CONSTRAINT lesson_area_fkey FOREIGN KEY (transformation_id, performance_area_id) REFERENCES performance_area (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT lesson_published_complete CHECK ((status = 'draft') = (published_at IS NULL) AND (published_at IS NULL) = (published_by IS NULL)),
  CONSTRAINT lesson_archived_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL) AND (archived_at IS NULL) = (archived_by IS NULL))
);
CREATE INDEX lesson_search_idx ON lesson USING gin (search_document) WHERE status = 'published';
CREATE INDEX lesson_org_published_idx ON lesson (organization_id, published_at DESC, id DESC) WHERE status = 'published';
CREATE FUNCTION lesson_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'lesson: a new lesson is a draft'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'lesson_starts_draft';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'archived' THEN
    RAISE EXCEPTION 'lesson %: an archived lesson is final', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'lesson_archived_final';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY['draft>published', 'published>archived', 'draft>archived']) THEN
    RAISE EXCEPTION 'lesson %: % -> % is not a legal transition', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'lesson_transition';
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'lesson %: the code is immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'lesson_code_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lesson_guard BEFORE INSERT OR UPDATE ON lesson FOR EACH ROW EXECUTE FUNCTION lesson_guard();
SELECT p2_attach_guards('lesson', true);
GRANT SELECT, INSERT, UPDATE ON lesson TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- improvement_item (REQ-PB-084 "the backlog persists after closure"; REQ-S11-008): one continuous-improvement item of a
-- transformation, optionally of a performance area, with its source. No guard reads the transformation's status, so
-- closing the transformation leaves the backlog visible and editable. Status: open -> in_progress -> done; open |
-- in_progress -> rejected; done and rejected are final and carry a resolution note.
CREATE TABLE improvement_item (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id   uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code                text NOT NULL CHECK (code ~ '^CI-[0-9]{2,6}$'),
  performance_area_id uuid NULL,
  title               text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  description         text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 8000),
  source_kind         text NOT NULL CHECK (source_kind IN ('manual', 'lesson', 'control_check', 'review', 'handover')),
  lesson_id           uuid NULL,
  control_check_id    uuid NULL,
  review_id           uuid NULL,
  handover_id         uuid NULL,
  owner_user_id       uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  priority            text NULL CHECK (priority IS NULL OR priority IN ('H', 'M', 'L')),
  target_date         date NULL,
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'rejected')),
  resolution_note     text NULL CHECK (resolution_note IS NULL OR char_length(resolution_note) BETWEEN 3 AND 2000),
  resolved_at         timestamptz NULL,
  resolved_by         uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT improvement_item_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT improvement_item_code_key UNIQUE (transformation_id, code),
  CONSTRAINT improvement_item_area_fkey FOREIGN KEY (transformation_id, performance_area_id) REFERENCES performance_area (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT improvement_item_lesson_fkey FOREIGN KEY (transformation_id, lesson_id) REFERENCES lesson (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT improvement_item_check_fkey FOREIGN KEY (transformation_id, control_check_id) REFERENCES control_check (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT improvement_item_review_fkey FOREIGN KEY (transformation_id, review_id) REFERENCES sustainment_review (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT improvement_item_handover_fkey FOREIGN KEY (transformation_id, handover_id) REFERENCES bau_handover (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT improvement_item_source_fields CHECK ((source_kind = 'lesson') = (lesson_id IS NOT NULL)
                                                  AND (source_kind = 'control_check') = (control_check_id IS NOT NULL)
                                                  AND (source_kind = 'review') = (review_id IS NOT NULL)
                                                  AND (source_kind = 'handover') = (handover_id IS NOT NULL)),
  CONSTRAINT improvement_item_resolved_complete CHECK ((status IN ('done', 'rejected')) = (resolved_at IS NOT NULL)
                                                      AND (resolved_at IS NULL) = (resolved_by IS NULL)
                                                      AND (resolved_at IS NULL) = (resolution_note IS NULL))
);
CREATE INDEX improvement_item_area_idx ON improvement_item (performance_area_id, status) WHERE performance_area_id IS NOT NULL;
CREATE INDEX improvement_item_transformation_idx ON improvement_item (transformation_id, status, code);
CREATE FUNCTION improvement_item_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' THEN
      RAISE EXCEPTION 'improvement_item: a new item is open'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'improvement_item_starts_open';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('done', 'rejected') THEN
    RAISE EXCEPTION 'improvement_item %: a % item is final', OLD.id, OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'improvement_item_final';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY[
      'open>in_progress', 'open>done', 'open>rejected', 'in_progress>done', 'in_progress>rejected', 'in_progress>open']) THEN
    RAISE EXCEPTION 'improvement_item %: % -> % is not a legal transition', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'improvement_item_transition';
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code OR NEW.source_kind IS DISTINCT FROM OLD.source_kind OR NEW.lesson_id IS DISTINCT FROM OLD.lesson_id
     OR NEW.control_check_id IS DISTINCT FROM OLD.control_check_id OR NEW.review_id IS DISTINCT FROM OLD.review_id
     OR NEW.handover_id IS DISTINCT FROM OLD.handover_id THEN
    RAISE EXCEPTION 'improvement_item %: code and source are immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'improvement_item_source_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER improvement_item_guard BEFORE INSERT OR UPDATE ON improvement_item FOR EACH ROW EXECUTE FUNCTION improvement_item_guard();
SELECT p2_attach_guards('improvement_item', true);
GRANT SELECT, INSERT, UPDATE ON improvement_item TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- closure_record (REQ-PB-009, REQ-S03-003, REQ-S11-006, REQ-S11-007): the governed closure of an initiative or of a
-- transformation, with the basis the service checked (a JSON snapshot: per benefit the validated measurement ids or
-- the approved transition decision; for a transformation the approved G6 gate decision and the accepted handovers).
-- One closure per subject, append-only. The service writes it in the transaction that closes the subject.
CREATE TABLE closure_record (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  subject_kind      text NOT NULL CHECK (subject_kind IN ('initiative', 'transformation')),
  initiative_id     uuid NULL,
  basis             text NOT NULL CHECK (basis IN ('validated_value', 'transition_decision', 'validated_value_and_transition_decision')),
  snapshot          jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  closure_note      text NULL CHECK (closure_note IS NULL OR char_length(closure_note) BETWEEN 3 AND 2000),
  closed_at         timestamptz NOT NULL DEFAULT now(),
  closed_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT closure_record_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT closure_record_initiative_fkey FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT closure_record_subject CHECK ((subject_kind = 'initiative') = (initiative_id IS NOT NULL)),
  CONSTRAINT closure_record_closer_is_creator CHECK (closed_by = created_by)
);
CREATE UNIQUE INDEX closure_record_initiative_key ON closure_record (initiative_id) WHERE subject_kind = 'initiative';
CREATE UNIQUE INDEX closure_record_transformation_key ON closure_record (transformation_id) WHERE subject_kind = 'transformation';
CREATE FUNCTION closure_record_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.subject_kind = 'initiative' AND NOT EXISTS (
      SELECT 1 FROM initiative i WHERE i.id = NEW.initiative_id AND i.status = 'completed') THEN
    RAISE EXCEPTION 'closure_record: only a delivery-complete initiative can be closed (REQ-PB-009)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'closure_record_initiative_completed';
  END IF;
  IF NEW.subject_kind = 'transformation' AND NOT EXISTS (
      SELECT 1 FROM gate_instance g WHERE g.transformation_id = NEW.transformation_id AND g.gate_code = 'G6' AND g.status = 'approved') THEN
    RAISE EXCEPTION 'closure_record: a transformation closes only after its G6 (Sustain) business approval'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'closure_record_g6_approved';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER closure_record_guard BEFORE INSERT ON closure_record FOR EACH ROW EXECUTE FUNCTION closure_record_guard();
SELECT p2_attach_append_only('closure_record');
SELECT p2_attach_guards('closure_record', true);
GRANT SELECT, INSERT ON closure_record TO mth_app;
ALTER TABLE performance_area_cycle ADD CONSTRAINT performance_area_cycle_prior_closure_fkey
  FOREIGN KEY (transformation_id, prior_closure_record_id) REFERENCES closure_record (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- transformation: a status of 'closed' needs its closure record (the governed closure action writes the record first,
-- in the same transaction). The DG1 PATCH keeps refusing closure in the API; this adds the database invariant beside it.
CREATE FUNCTION transformation_closure_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' AND NOT EXISTS (
      SELECT 1 FROM closure_record c WHERE c.transformation_id = NEW.id AND c.subject_kind = 'transformation') THEN
    RAISE EXCEPTION 'transformation %: closure requires the governed closure record (ADR-0034 §7)', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'transformation_closure_recorded';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transformation_closure_guard BEFORE UPDATE OF status ON transformation
  FOR EACH ROW EXECUTE FUNCTION transformation_closure_guard();
