-- 0034 P4 target trajectories and KPI actuals (T-DG4-ARCH-02; ADR-0027 §5-§7; REQ-S07-003, -005, -007, -012, -013,
-- -017, REQ-S15-008, REQ-S16-014). Authored by solution-architect. Contract: docs/architecture/data-dictionary.md
-- ("P4 tables, slice A"). Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit
-- once merged. SQL floor: PostgreSQL 16.
-- KPI actuals: one SLOT row per (KPI, scope, reporting period) (kpi_actual, versioned and audited) and an append-only
-- history of entered values (kpi_actual_value). A second actual for the same slot is a new value version of the same
-- slot, never a second slot (REQ-S07-003; unique kpi_actual_slot_key). Only the slot is audited, so one user action
-- (save, submit, accept, reject) writes exactly one audit event (REQ-S07-013).

-- -----------------------------------------------------------------------------------------------------------------
-- Scope of a KPI value (REQ-S07-003): the transformation itself, one of its organization's business units, or one of
-- its initiatives.
CREATE FUNCTION p4_kpi_scope_valid(p_org uuid, p_transformation uuid, p_kind text, p_scope uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_kind
    WHEN 'transformation' THEN p_scope = p_transformation
    WHEN 'business_unit' THEN EXISTS (SELECT 1 FROM business_unit b WHERE b.id = p_scope AND b.organization_id = p_org)
    WHEN 'initiative' THEN EXISTS (SELECT 1 FROM initiative i WHERE i.id = p_scope AND i.transformation_id = p_transformation)
    ELSE false END
$$;

-- -----------------------------------------------------------------------------------------------------------------
-- target_trajectory: the approved expected path of a KPI for one scope (TargetTrajectory, REQ-S16-014; REQ-S07-007).
-- Status machine: draft -> approved | withdrawn; approved -> superseded. Points change only while draft. Approval is a
-- business approval (kpi_target.approve, SP/BO), never by the creator. At most one approved trajectory per KPI and scope.
CREATE TABLE target_trajectory (
  id                      uuid PRIMARY KEY,
  organization_id         uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id       uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kpi_definition_id       uuid NOT NULL,
  scope_kind              text NOT NULL DEFAULT 'transformation' CHECK (scope_kind IN ('transformation', 'business_unit', 'initiative')),
  scope_id                uuid NOT NULL,
  version_no              smallint NOT NULL CHECK (version_no >= 1),
  basis                   text NOT NULL DEFAULT 'period' CHECK (basis IN ('period', 'cumulative')),
  interpolation           text NOT NULL DEFAULT 'linear' CHECK (interpolation IN ('linear', 'step')),
  source                  text NOT NULL DEFAULT 'api' CHECK (source IN ('api', 'outcome_kpi_import', 'outcome_kpi_backfill')),
  source_outcome_kpi_id   uuid NULL,
  status                  text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'superseded', 'withdrawn')),
  approved_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  approved_at             timestamptz NULL,
  approved_record_version integer NULL CHECK (approved_record_version IS NULL OR approved_record_version >= 1),
  superseded_at           timestamptz NULL,
  withdrawn_at            timestamptz NULL,
  withdraw_reason         text NULL CHECK (withdraw_reason IS NULL OR char_length(withdraw_reason) BETWEEN 3 AND 1000),
  version                 integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT target_trajectory_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT target_trajectory_no_key UNIQUE (kpi_definition_id, scope_kind, scope_id, version_no),
  CONSTRAINT target_trajectory_kpi_fkey FOREIGN KEY (transformation_id, kpi_definition_id)
    REFERENCES kpi_definition (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT target_trajectory_outcome_kpi_fkey FOREIGN KEY (transformation_id, source_outcome_kpi_id)
    REFERENCES outcome_kpi (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT target_trajectory_source_ref CHECK ((source = 'api') = (source_outcome_kpi_id IS NULL)),
  CONSTRAINT target_trajectory_approval_complete CHECK (
    (status IN ('approved', 'superseded')) = (approved_by IS NOT NULL)
    AND (approved_by IS NULL) = (approved_at IS NULL) AND (approved_at IS NULL) = (approved_record_version IS NULL)),
  CONSTRAINT target_trajectory_approver_not_creator CHECK (approved_by IS NULL OR approved_by <> created_by),
  CONSTRAINT target_trajectory_status_stamps CHECK ((status = 'superseded') = (superseded_at IS NOT NULL)
    AND (status = 'withdrawn') = (withdrawn_at IS NOT NULL) AND (withdrawn_at IS NULL) = (withdraw_reason IS NULL))
);
CREATE UNIQUE INDEX target_trajectory_one_approved ON target_trajectory (kpi_definition_id, scope_kind, scope_id) WHERE status = 'approved';
CREATE UNIQUE INDEX target_trajectory_one_draft ON target_trajectory (kpi_definition_id, scope_kind, scope_id) WHERE status = 'draft';
CREATE INDEX target_trajectory_transformation_idx ON target_trajectory (transformation_id, updated_at DESC, id DESC);

-- target_trajectory_point: expected value at a date (the trajectory's basis). Inserted only while the trajectory is a
-- draft; never updated or deleted (append-only). Different points mean a new draft version (withdraw the old draft).
CREATE TABLE target_trajectory_point (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id    uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  target_trajectory_id uuid NOT NULL,
  point_date           date NOT NULL,
  expected_value       numeric(24,6) NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT target_trajectory_point_trajectory_fkey FOREIGN KEY (transformation_id, target_trajectory_id)
    REFERENCES target_trajectory (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT target_trajectory_point_date_key UNIQUE (target_trajectory_id, point_date)
);
CREATE FUNCTION target_trajectory_point_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM target_trajectory t WHERE t.id = NEW.target_trajectory_id AND t.status = 'draft') THEN
    RAISE EXCEPTION 'target_trajectory_point: points are added only while the trajectory is a draft'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'target_trajectory_point_draft_only';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER target_trajectory_point_guard BEFORE INSERT ON target_trajectory_point
  FOR EACH ROW EXECUTE FUNCTION target_trajectory_point_guard();
SELECT p2_attach_append_only('target_trajectory_point');
SELECT p2_attach_guards('target_trajectory_point', false);
GRANT SELECT, INSERT ON target_trajectory_point TO mth_app;

CREATE FUNCTION target_trajectory_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  next_no integer;
BEGIN
  IF NOT p4_kpi_scope_valid(NEW.organization_id, NEW.transformation_id, NEW.scope_kind, NEW.scope_id) THEN
    RAISE EXCEPTION 'target_trajectory: scope % % is not in this transformation', NEW.scope_kind, NEW.scope_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'target_trajectory_scope_valid';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT coalesce(max(x.version_no), 0) + 1 INTO next_no FROM target_trajectory x
    WHERE x.kpi_definition_id = NEW.kpi_definition_id AND x.scope_kind = NEW.scope_kind AND x.scope_id = NEW.scope_id;
    IF NEW.version_no <> next_no THEN
      RAISE EXCEPTION 'target_trajectory: the next version number for this KPI and scope is %', next_no
        USING ERRCODE = 'check_violation', CONSTRAINT = 'target_trajectory_no_step';
    END IF;
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'target_trajectory: a new trajectory starts as a draft'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'target_trajectory_initial_draft';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT (NEW.status = OLD.status
          OR (OLD.status = 'draft' AND NEW.status IN ('approved', 'withdrawn'))
          OR (OLD.status = 'approved' AND NEW.status = 'superseded')) THEN
    RAISE EXCEPTION 'target_trajectory: % -> % is not an allowed transition', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'target_trajectory_status_step';
  END IF;
  IF OLD.status <> 'draft' AND (to_jsonb(NEW) - ARRAY['status', 'superseded_at', 'version', 'updated_at', 'updated_by'])
                                IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'superseded_at', 'version', 'updated_at', 'updated_by']) THEN
    RAISE EXCEPTION 'target_trajectory: an % trajectory is immutable; create a new version', OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'target_trajectory_frozen';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'approved'
     AND NOT EXISTS (SELECT 1 FROM target_trajectory_point p WHERE p.target_trajectory_id = NEW.id) THEN
    RAISE EXCEPTION 'target_trajectory: an approved trajectory has at least one point'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'target_trajectory_points_required';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER target_trajectory_guard BEFORE INSERT OR UPDATE ON target_trajectory
  FOR EACH ROW EXECUTE FUNCTION target_trajectory_guard();
SELECT p2_attach_guards('target_trajectory', true);
GRANT SELECT, INSERT, UPDATE ON target_trajectory TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- kpi_actual: the actual SLOT for one KPI, scope and reporting period (KPIActual, REQ-S16-014). The observation period
-- is copied from the reporting period (ADR-0025 §2). Status of the current value version (ADR-0027 §6):
--   draft -> draft (new value) | submitted | accepted (direct-accept route only)
--   submitted -> submitted (new value) | accepted | rejected
--   accepted -> draft | submitted | accepted (direct) (a correction: a new value; the accepted value stays in force
--               until the new one is accepted)
--   rejected -> draft | submitted | accepted (direct)
-- accepted_value_no is the value in force for calculations; NULL = no accepted value (Unknown, REQ-S07-006).
CREATE TABLE kpi_actual (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id   uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kpi_definition_id   uuid NOT NULL,
  scope_kind          text NOT NULL CHECK (scope_kind IN ('transformation', 'business_unit', 'initiative')),
  scope_id            uuid NOT NULL,
  reporting_period_id uuid NOT NULL,
  period_start        date NOT NULL,
  period_end          date NOT NULL,
  period_label        text NOT NULL,
  current_value_no    smallint NOT NULL DEFAULT 1 CHECK (current_value_no >= 1),
  accepted_value_no   smallint NULL CHECK (accepted_value_no IS NULL OR accepted_value_no >= 1),
  status              text NOT NULL CHECK (status IN ('draft', 'submitted', 'accepted', 'rejected')),
  route               text NOT NULL CHECK (route IN ('review', 'direct_accept')),
  submitted_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  submitted_at        timestamptz NULL,
  decided_by          uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_at          timestamptz NULL,
  decision_reason     text NULL CHECK (decision_reason IS NULL OR char_length(decision_reason) BETWEEN 1 AND 2000),
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_actual_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT kpi_actual_slot_key UNIQUE (kpi_definition_id, scope_kind, scope_id, reporting_period_id),
  CONSTRAINT kpi_actual_kpi_fkey FOREIGN KEY (transformation_id, kpi_definition_id)
    REFERENCES kpi_definition (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_actual_period_fkey FOREIGN KEY (organization_id, reporting_period_id)
    REFERENCES reporting_period (organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_actual_accepted_le_current CHECK (accepted_value_no IS NULL OR accepted_value_no <= current_value_no),
  CONSTRAINT kpi_actual_accepted_pointer CHECK (status <> 'accepted' OR accepted_value_no = current_value_no),
  CONSTRAINT kpi_actual_submitted_stamps CHECK ((status = 'draft') = (submitted_by IS NULL) AND (submitted_by IS NULL) = (submitted_at IS NULL)),
  CONSTRAINT kpi_actual_decided_stamps CHECK ((status IN ('accepted', 'rejected')) = (decided_by IS NOT NULL)
                                              AND (decided_by IS NULL) = (decided_at IS NULL)),
  CONSTRAINT kpi_actual_reject_reason CHECK (status <> 'rejected' OR decision_reason IS NOT NULL),
  -- Separation of duties on the review route: the reviewer is never the submitter.
  CONSTRAINT kpi_actual_review_sod CHECK (route <> 'review' OR decided_by IS NULL OR decided_by <> submitted_by),
  CONSTRAINT kpi_actual_direct_route CHECK (route <> 'direct_accept' OR status <> 'submitted')
);
CREATE INDEX kpi_actual_kpi_period_idx ON kpi_actual (kpi_definition_id, period_end DESC);
CREATE INDEX kpi_actual_review_queue_idx ON kpi_actual (transformation_id, submitted_at) WHERE status = 'submitted';
CREATE INDEX kpi_actual_transformation_idx ON kpi_actual (transformation_id, updated_at DESC, id DESC);

-- kpi_actual_value: every entered value version, append-only (REQ-S07-003). The KPI version in force at entry decides
-- its shape: flow/stock = value; ratio = numerator and denominator (the ratio is computed; a zero denominator gives Not
-- computable, never 0 or an error, REQ-S07-005); milestone = achieved flag (and date). missing_reason states an
-- explicitly unavailable value (Unknown, never 0). business_date and entered_at are kept apart from the observation
-- period (REQ-S15-008).
CREATE TABLE kpi_actual_value (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id  uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kpi_actual_id      uuid NOT NULL,
  value_no           smallint NOT NULL CHECK (value_no >= 1),
  kpi_version_id     uuid NOT NULL,
  value              numeric(24,6) NULL,
  numerator          numeric(24,6) NULL,
  denominator        numeric(24,6) NULL,
  milestone_achieved boolean NULL,
  achieved_on        date NULL,
  currency           char(3) NULL CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  missing_reason     text NULL CHECK (missing_reason IS NULL OR char_length(missing_reason) BETWEEN 1 AND 1000),
  data_as_of         date NOT NULL,
  comment            text NULL CHECK (comment IS NULL OR char_length(comment) BETWEEN 1 AND 4000),
  entered_at         timestamptz NOT NULL DEFAULT now(),
  entered_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  business_date      date NOT NULL,
  CONSTRAINT kpi_actual_value_no_key UNIQUE (kpi_actual_id, value_no),
  CONSTRAINT kpi_actual_value_actual_fkey FOREIGN KEY (transformation_id, kpi_actual_id)
    REFERENCES kpi_actual (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_actual_value_version_fkey FOREIGN KEY (transformation_id, kpi_version_id)
    REFERENCES kpi_version (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_actual_value_achieved_on CHECK (achieved_on IS NULL OR milestone_achieved IS TRUE)
);
CREATE FUNCTION kpi_actual_value_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  a record;
  v record;
  has_value boolean;
BEGIN
  SELECT x.current_value_no, x.kpi_definition_id INTO a FROM kpi_actual x
  WHERE x.id = NEW.kpi_actual_id AND x.transformation_id = NEW.transformation_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF NEW.value_no <> a.current_value_no THEN
    RAISE EXCEPTION 'kpi_actual_value: value % is not the slot''s current value number %', NEW.value_no, a.current_value_no
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_actual_value_no_current';
  END IF;
  SELECT x.status, x.kpi_definition_id, x.value_nature, x.currency INTO v FROM kpi_version x WHERE x.id = NEW.kpi_version_id;
  IF v.status IS DISTINCT FROM 'active' OR v.kpi_definition_id IS DISTINCT FROM a.kpi_definition_id THEN
    RAISE EXCEPTION 'kpi_actual_value: values are entered against the KPI''s active version'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_actual_value_active_version';
  END IF;
  IF NEW.currency IS DISTINCT FROM v.currency THEN
    RAISE EXCEPTION 'kpi_actual_value: currency % does not match the KPI currency %', NEW.currency, v.currency
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_actual_value_currency';
  END IF;
  has_value := CASE v.value_nature
    WHEN 'ratio' THEN NEW.numerator IS NOT NULL AND NEW.denominator IS NOT NULL AND NEW.value IS NULL AND NEW.milestone_achieved IS NULL
    WHEN 'milestone' THEN NEW.milestone_achieved IS NOT NULL AND NEW.value IS NULL AND NEW.numerator IS NULL AND NEW.denominator IS NULL
    ELSE NEW.value IS NOT NULL AND NEW.numerator IS NULL AND NEW.denominator IS NULL AND NEW.milestone_achieved IS NULL END;
  IF NOT ((has_value AND NEW.missing_reason IS NULL)
          OR (NEW.missing_reason IS NOT NULL AND NEW.value IS NULL AND NEW.numerator IS NULL AND NEW.denominator IS NULL
              AND NEW.milestone_achieved IS NULL)) THEN
    RAISE EXCEPTION 'kpi_actual_value: a % value needs its fields, or a missing_reason and no value', v.value_nature
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_actual_value_shape';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kpi_actual_value_guard BEFORE INSERT ON kpi_actual_value FOR EACH ROW EXECUTE FUNCTION kpi_actual_value_guard();
SELECT p2_attach_append_only('kpi_actual_value');
SELECT p2_attach_guards('kpi_actual_value', false);
GRANT SELECT, INSERT ON kpi_actual_value TO mth_app;

-- kpi_actual_review: the decision on one value version, append-only; at most one per value (REQ-S07-012).
-- 'direct_accept' is written by the direct-accept route in the submitter's own transaction.
CREATE TABLE kpi_actual_review (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id    uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kpi_actual_id        uuid NOT NULL,
  value_no             smallint NOT NULL CHECK (value_no >= 1),
  outcome              text NOT NULL CHECK (outcome IN ('accept', 'reject', 'direct_accept')),
  reason               text NULL CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 2000),
  decided_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  on_behalf_of_user_id uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_at           timestamptz NOT NULL DEFAULT now(),
  business_date        date NOT NULL,
  CONSTRAINT kpi_actual_review_value_key UNIQUE (kpi_actual_id, value_no),
  CONSTRAINT kpi_actual_review_value_fkey FOREIGN KEY (kpi_actual_id, value_no)
    REFERENCES kpi_actual_value (kpi_actual_id, value_no) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_actual_review_actual_fkey FOREIGN KEY (transformation_id, kpi_actual_id)
    REFERENCES kpi_actual (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_actual_review_reject_reason CHECK (outcome <> 'reject' OR reason IS NOT NULL),
  CONSTRAINT kpi_actual_review_not_self_behalf CHECK (on_behalf_of_user_id IS DISTINCT FROM decided_by)
);
SELECT p2_attach_append_only('kpi_actual_review');
SELECT p2_attach_guards('kpi_actual_review', false);
GRANT SELECT, INSERT ON kpi_actual_review TO mth_app;

-- kpi_actual_evidence: evidence attached to a value version (REQ-S07-017 "enter actual and evidence"), append-only.
CREATE TABLE kpi_actual_evidence (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kpi_actual_id     uuid NOT NULL,
  value_no          smallint NOT NULL CHECK (value_no >= 1),
  evidence_id       uuid NOT NULL,
  linked_at         timestamptz NOT NULL DEFAULT now(),
  linked_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_actual_evidence_key UNIQUE (kpi_actual_id, value_no, evidence_id),
  CONSTRAINT kpi_actual_evidence_value_fkey FOREIGN KEY (kpi_actual_id, value_no)
    REFERENCES kpi_actual_value (kpi_actual_id, value_no) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_actual_evidence_actual_fkey FOREIGN KEY (transformation_id, kpi_actual_id)
    REFERENCES kpi_actual (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_actual_evidence_evidence_fkey FOREIGN KEY (transformation_id, evidence_id)
    REFERENCES evidence (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
SELECT p2_attach_append_only('kpi_actual_evidence');
SELECT p2_attach_guards('kpi_actual_evidence', false);
GRANT SELECT, INSERT ON kpi_actual_evidence TO mth_app;

CREATE FUNCTION kpi_actual_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  kpi_actual_slot_lock_class CONSTANT integer := 730229;
  p record;
  d record;
  ok boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(kpi_actual_slot_lock_class,
    hashtext(NEW.kpi_definition_id::text || ':' || NEW.scope_kind || ':' || NEW.scope_id::text || ':' || NEW.reporting_period_id::text));
  SELECT r.period_start, r.period_end, r.period_label, r.status, r.frequency INTO p FROM reporting_period r
  WHERE r.id = NEW.reporting_period_id AND r.organization_id = NEW.organization_id;
  IF TG_OP = 'INSERT' THEN
    IF NOT p4_kpi_scope_valid(NEW.organization_id, NEW.transformation_id, NEW.scope_kind, NEW.scope_id) THEN
      RAISE EXCEPTION 'kpi_actual: scope % % is not in this transformation', NEW.scope_kind, NEW.scope_id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_actual_scope_valid';
    END IF;
    SELECT k.frequency INTO d FROM kpi_definition k WHERE k.id = NEW.kpi_definition_id;
    IF FOUND AND p.frequency IS DISTINCT FROM d.frequency THEN
      RAISE EXCEPTION 'kpi_actual: a % KPI is reported for % periods, not %', d.frequency, d.frequency, p.frequency
        USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_actual_period_frequency';
    END IF;
    IF NEW.period_start IS DISTINCT FROM p.period_start OR NEW.period_end IS DISTINCT FROM p.period_end
       OR NEW.period_label IS DISTINCT FROM p.period_label THEN
      RAISE EXCEPTION 'kpi_actual: the observation period is copied from the reporting period'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_actual_period_copy';
    END IF;
    IF NEW.current_value_no <> 1 OR NEW.status = 'rejected' OR (NEW.status = 'accepted' AND NEW.route <> 'direct_accept') THEN
      RAISE EXCEPTION 'kpi_actual: a new slot starts with value 1 as a draft, submitted, or accepted on the direct route'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_actual_initial_state';
    END IF;
    IF p.status IS DISTINCT FROM 'open' THEN
      RAISE EXCEPTION 'kpi_actual: reporting period % is %', p.period_label, coalesce(p.status, 'missing')
        USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_actual_period_open';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.kpi_definition_id IS DISTINCT FROM OLD.kpi_definition_id OR NEW.scope_kind IS DISTINCT FROM OLD.scope_kind
     OR NEW.scope_id IS DISTINCT FROM OLD.scope_id OR NEW.reporting_period_id IS DISTINCT FROM OLD.reporting_period_id
     OR NEW.period_start IS DISTINCT FROM OLD.period_start OR NEW.period_end IS DISTINCT FROM OLD.period_end
     OR NEW.period_label IS DISTINCT FROM OLD.period_label THEN
    RAISE EXCEPTION 'kpi_actual: the slot (KPI, scope, period) is immutable'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_actual_slot_immutable';
  END IF;
  IF NEW.current_value_no NOT IN (OLD.current_value_no, OLD.current_value_no + 1) THEN
    RAISE EXCEPTION 'kpi_actual: the value number steps by one'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_actual_value_step';
  END IF;
  IF NEW.current_value_no = OLD.current_value_no + 1 THEN
    -- A new value version: allowed only in an open period, into draft, submitted or (direct route) accepted.
    IF p.status IS DISTINCT FROM 'open' THEN
      RAISE EXCEPTION 'kpi_actual: reporting period % is %', p.period_label, coalesce(p.status, 'missing')
        USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_actual_period_open';
    END IF;
    ok := NEW.status IN ('draft', 'submitted') OR (NEW.status = 'accepted' AND NEW.route = 'direct_accept');
  ELSE
    ok := CASE OLD.status
            WHEN 'draft' THEN NEW.status IN ('draft', 'submitted') OR (NEW.status = 'accepted' AND NEW.route = 'direct_accept')
            WHEN 'submitted' THEN NEW.status IN ('submitted', 'accepted', 'rejected')
            ELSE NEW.status = OLD.status END;
    IF OLD.status IN ('accepted', 'rejected') AND (to_jsonb(NEW) - ARRAY['version', 'updated_at', 'updated_by'])
                                                  IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['version', 'updated_at', 'updated_by']) THEN
      ok := false;
    END IF;
  END IF;
  IF NOT ok THEN
    RAISE EXCEPTION 'kpi_actual: % -> % (value % -> %) is not an allowed transition', OLD.status, NEW.status,
      OLD.current_value_no, NEW.current_value_no
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_actual_status_step';
  END IF;
  IF NEW.accepted_value_no IS DISTINCT FROM OLD.accepted_value_no
     AND NOT (NEW.status = 'accepted' AND NEW.accepted_value_no = NEW.current_value_no) THEN
    RAISE EXCEPTION 'kpi_actual: the accepted value changes only by accepting the current value'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_actual_accepted_pointer';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kpi_actual_guard BEFORE INSERT OR UPDATE ON kpi_actual FOR EACH ROW EXECUTE FUNCTION kpi_actual_guard();

-- At COMMIT: the current value row exists; an accepted or rejected status has the matching review row of that value.
CREATE FUNCTION kpi_actual_consistency() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  cur record;
BEGIN
  SELECT x.* INTO cur FROM kpi_actual x WHERE x.id = NEW.id;
  IF NOT EXISTS (SELECT 1 FROM kpi_actual_value v WHERE v.kpi_actual_id = cur.id AND v.value_no = cur.current_value_no) THEN
    RAISE EXCEPTION 'kpi_actual %: value % has no value row', cur.id, cur.current_value_no
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'kpi_actual_value_present';
  END IF;
  IF cur.status IN ('accepted', 'rejected') AND NOT EXISTS (
       SELECT 1 FROM kpi_actual_review r WHERE r.kpi_actual_id = cur.id AND r.value_no = cur.current_value_no
         AND r.decided_by = cur.decided_by
         AND r.outcome = CASE WHEN cur.status = 'rejected' THEN 'reject'
                              WHEN cur.route = 'direct_accept' THEN 'direct_accept' ELSE 'accept' END) THEN
    RAISE EXCEPTION 'kpi_actual %: status % needs the matching review of value %', cur.id, cur.status, cur.current_value_no
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'kpi_actual_review_present';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER kpi_actual_consistency AFTER INSERT OR UPDATE ON kpi_actual DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION kpi_actual_consistency();
SELECT p2_attach_guards('kpi_actual', true);
GRANT SELECT, INSERT, UPDATE ON kpi_actual TO mth_app;
