-- 0038 P4 benefit values, measurements, Finance validation, corrections and overlap warnings (T-DG4-ARCH-03; ADR-0030;
-- REQ-PB-013, REQ-S07-014, REQ-S08-001, REQ-S08-006, REQ-S08-008, REQ-S08-014, REQ-S08-015, REQ-S08-016,
-- REQ-S08-017, REQ-S12-014, REQ-S16-017, REQ-S16-025). Authored by solution-architect. Contract:
-- docs/architecture/data-dictionary.md ("P4 tables, slice B"). Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16. Decimal only (numeric).
-- A measurement never becomes validated value without a Finance decision row by a person other than its submitter
-- (deferred check benefit_measurement_decision_present). No trigger, seed or job decides a Finance validation.

-- -----------------------------------------------------------------------------------------------------------------
-- benefit_plan_value: the planned and forecast value series of a benefit per period (REQ-S08-001). Kept apart from
-- measurements and validated values; never read by a validated or realized total.
CREATE TABLE benefit_plan_value (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  benefit_id        uuid NOT NULL,
  value_kind        text NOT NULL CHECK (value_kind IN ('planned', 'forecast')),
  period_start      date NOT NULL,
  period_end        date NOT NULL,
  amount            numeric(20,4) NULL,
  kpi_value         numeric(24,6) NULL,
  currency          char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  note              text NULL CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_plan_value_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT benefit_plan_value_benefit_fkey FOREIGN KEY (transformation_id, benefit_id) REFERENCES benefit (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_plan_value_period_key UNIQUE (benefit_id, value_kind, period_start),
  CONSTRAINT benefit_plan_value_period_range CHECK (period_end >= period_start),
  CONSTRAINT benefit_plan_value_present CHECK (num_nonnulls(amount, kpi_value) >= 1)
);
CREATE FUNCTION benefit_plan_value_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.benefit_id, NEW.value_kind) IS DISTINCT FROM (OLD.benefit_id, OLD.value_kind) THEN
    RAISE EXCEPTION 'benefit_plan_value: the benefit and kind of a value are fixed'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_plan_value_frozen';
  END IF;
  PERFORM p4_benefit_value_row_valid(NEW.benefit_id, NEW.currency, NEW.amount, 'benefit_plan_value');
  RETURN NEW;
END $$;
CREATE TRIGGER benefit_plan_value_guard BEFORE INSERT OR UPDATE ON benefit_plan_value
  FOR EACH ROW EXECUTE FUNCTION benefit_plan_value_guard();
SELECT p2_attach_guards('benefit_plan_value', true);
GRANT SELECT, INSERT, UPDATE ON benefit_plan_value TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- benefit_measurement: BenefitMeasurement (REQ-S16-017). One measured value of a benefit for one measurement period,
-- with its lineage (formula version, benefit_calculation row, input KPI actual versions, assumptions). Status:
--   draft -> draft (edit) | submitted;  submitted -> validated | rejected | superseded;  validated, rejected and
--   superseded are final (a validated row is never edited: corrections are new rows, REQ-S08-017).
-- kind 'amendment' / 'reversal' rows are Finance corrections linked to the original validated measurement; they are
-- validated on creation (by the Finance author) and carry their signed contribution in amount = validated_amount.
-- sustain_phase is set by the trigger from the benefit's step: validated rows measured in Sustain form the 'sustained'
-- series (REQ-S08-001). At most one live measurement per benefit and period (benefit_measurement_period_key).
CREATE TABLE benefit_measurement (
  id                      uuid PRIMARY KEY,
  organization_id         uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id       uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  benefit_id              uuid NOT NULL,
  measurement_no          integer NOT NULL CHECK (measurement_no >= 1),
  kind                    text NOT NULL DEFAULT 'measurement' CHECK (kind IN ('measurement', 'amendment', 'reversal')),
  corrects_measurement_id uuid NULL,
  source                  text NOT NULL CHECK (source IN ('manual', 'kpi_recalculation', 'correction')),
  calculation_run_id      uuid NULL,
  benefit_calculation_id  uuid NULL REFERENCES benefit_calculation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  formula_version_id      uuid NULL,
  period_start            date NULL,
  period_end              date NULL,
  amount                  numeric(20,4) NULL,
  kpi_value               numeric(24,6) NULL,
  currency                char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  missing_reason          text NULL CHECK (missing_reason IS NULL OR char_length(missing_reason) BETWEEN 3 AND 1000),
  attribution             text NULL CHECK (attribution IS NULL OR char_length(attribution) BETWEEN 1 AND 4000),
  assumptions             text NULL CHECK (assumptions IS NULL OR char_length(assumptions) BETWEEN 1 AND 8000),
  status                  text NOT NULL CHECK (status IN ('draft', 'submitted', 'validated', 'rejected', 'superseded')),
  sustain_phase           boolean NOT NULL DEFAULT false,
  validated_amount        numeric(20,4) NULL,
  submitted_by            uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  submitted_at            timestamptz NULL,
  decided_by              uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_at              timestamptz NULL,
  reason                  text NULL CHECK (reason IS NULL OR char_length(reason) BETWEEN 3 AND 2000),
  version                 integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_measurement_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT benefit_measurement_no_key UNIQUE (benefit_id, measurement_no),
  CONSTRAINT benefit_measurement_benefit_fkey FOREIGN KEY (transformation_id, benefit_id) REFERENCES benefit (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_measurement_corrects_fkey FOREIGN KEY (transformation_id, corrects_measurement_id) REFERENCES benefit_measurement (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_measurement_run_fkey FOREIGN KEY (transformation_id, calculation_run_id) REFERENCES calculation_run (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_measurement_formula_version_fkey FOREIGN KEY (transformation_id, formula_version_id) REFERENCES benefit_formula_version (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_measurement_kind_shape CHECK (
    (kind = 'measurement') = (corrects_measurement_id IS NULL) AND (kind = 'measurement') = (source <> 'correction')),
  CONSTRAINT benefit_measurement_correction_shape CHECK (
    kind = 'measurement' OR (status = 'validated' AND reason IS NOT NULL AND amount IS NOT NULL AND validated_amount = amount)),
  CONSTRAINT benefit_measurement_period_range CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start),
  -- REQ-S08-015: nothing leaves draft without its measurement period.
  CONSTRAINT benefit_measurement_period_required CHECK (status = 'draft' OR (period_start IS NOT NULL AND period_end IS NOT NULL)),
  CONSTRAINT benefit_measurement_value_present CHECK (kind <> 'measurement' OR num_nonnulls(amount, kpi_value) >= 1 OR missing_reason IS NOT NULL),
  -- Unknown is NULL with a reason, never 0, and an Unknown value is never validated.
  CONSTRAINT benefit_measurement_missing_shape CHECK (missing_reason IS NULL OR (amount IS NULL AND kpi_value IS NULL AND status <> 'validated')),
  CONSTRAINT benefit_measurement_validated_amount CHECK ((status = 'validated' AND amount IS NOT NULL) = (validated_amount IS NOT NULL)),
  CONSTRAINT benefit_measurement_submitted_stamps CHECK (
    (status = 'draft') = (submitted_at IS NULL) AND (submitted_at IS NULL OR submitted_by IS NOT NULL OR source = 'kpi_recalculation')
    AND (submitted_at IS NOT NULL OR submitted_by IS NULL)),
  CONSTRAINT benefit_measurement_decided_stamps CHECK ((status IN ('validated', 'rejected')) = (decided_at IS NOT NULL) AND (decided_at IS NULL) = (decided_by IS NULL)),
  CONSTRAINT benefit_measurement_validator_not_submitter CHECK (kind <> 'measurement' OR decided_by IS NULL OR submitted_by IS NULL OR decided_by <> submitted_by)
);
-- Counted once: one live measurement per benefit and period (a rejected or superseded one can be measured again).
CREATE UNIQUE INDEX benefit_measurement_period_key ON benefit_measurement (benefit_id, period_start, period_end)
  WHERE kind = 'measurement' AND status IN ('draft', 'submitted', 'validated');
-- REQ-S12-006 / REQ-S07-014: at most one pending value per benefit and KPI calculation run.
CREATE UNIQUE INDEX benefit_measurement_run_key ON benefit_measurement (benefit_id, calculation_run_id) WHERE calculation_run_id IS NOT NULL;
-- A validated measurement is reversed at most once.
CREATE UNIQUE INDEX benefit_measurement_one_reversal_key ON benefit_measurement (corrects_measurement_id) WHERE kind = 'reversal';
CREATE INDEX benefit_measurement_benefit_idx ON benefit_measurement (benefit_id, measurement_no DESC);

CREATE FUNCTION benefit_measurement_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  b record;
  o record;
  net numeric;
  next_no integer;
  movable text[] := ARRAY['status', 'decided_by', 'decided_at', 'validated_amount', 'reason', 'version', 'updated_at', 'updated_by'];
BEGIN
  SELECT x.lifecycle_step, x.baseline_validation_status INTO b FROM benefit x WHERE x.id = NEW.benefit_id;
  IF TG_OP = 'INSERT' THEN
    PERFORM p4_benefit_value_row_valid(NEW.benefit_id, NEW.currency, NEW.amount, 'benefit_measurement');
    SELECT coalesce(max(m.measurement_no), 0) + 1 INTO next_no FROM benefit_measurement m WHERE m.benefit_id = NEW.benefit_id;
    IF NEW.measurement_no <> next_no THEN
      RAISE EXCEPTION 'benefit_measurement: the next measurement number of this benefit is %', next_no
        USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_measurement_no_step';
    END IF;
    IF NEW.kind = 'measurement' THEN
      -- REQ-PB-074: actuals belong to the Measure step and later (a delivered enabler is not realized value, REQ-S08-002).
      IF b.lifecycle_step NOT IN ('measure', 'correct', 'sustain') THEN
        RAISE EXCEPTION 'benefit_measurement: the benefit is at the % step; measurements start at Measure', b.lifecycle_step
          USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_measurement_step';
      END IF;
      IF NEW.status NOT IN ('draft', 'submitted') THEN
        RAISE EXCEPTION 'benefit_measurement: a new measurement is a draft or submitted'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_measurement_status_step';
      END IF;
      NEW.sustain_phase := (b.lifecycle_step = 'sustain');
    ELSE
      SELECT m.* INTO o FROM benefit_measurement m WHERE m.id = NEW.corrects_measurement_id;
      IF o.benefit_id IS DISTINCT FROM NEW.benefit_id OR o.kind <> 'measurement' OR o.status <> 'validated' OR o.validated_amount IS NULL THEN
        RAISE EXCEPTION 'benefit_measurement: a correction targets a validated financial measurement of the same benefit'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_measurement_correction_target';
      END IF;
      IF EXISTS (SELECT 1 FROM benefit_measurement r WHERE r.corrects_measurement_id = o.id AND r.kind = 'reversal') THEN
        RAISE EXCEPTION 'benefit_measurement: the original measurement is already reversed'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_measurement_already_reversed';
      END IF;
      IF (NEW.period_start, NEW.period_end) IS DISTINCT FROM (o.period_start, o.period_end) THEN
        RAISE EXCEPTION 'benefit_measurement: a correction has the period of the original measurement'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_measurement_correction_period';
      END IF;
      IF NEW.kind = 'reversal' THEN
        SELECT o.validated_amount + coalesce(sum(a.amount), 0) INTO net FROM benefit_measurement a
        WHERE a.corrects_measurement_id = o.id AND a.kind = 'amendment';
        IF NEW.amount <> -net THEN
          RAISE EXCEPTION 'benefit_measurement: a reversal nets the original to zero (amount %)', -net
            USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_measurement_reversal_amount';
        END IF;
      END IF;
      NEW.sustain_phase := o.sustain_phase;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF (NEW.benefit_id, NEW.measurement_no, NEW.kind, NEW.source) IS DISTINCT FROM (OLD.benefit_id, OLD.measurement_no, OLD.kind, OLD.source)
     OR NEW.corrects_measurement_id IS DISTINCT FROM OLD.corrects_measurement_id
     OR NEW.calculation_run_id IS DISTINCT FROM OLD.calculation_run_id OR NEW.sustain_phase IS DISTINCT FROM OLD.sustain_phase THEN
    RAISE EXCEPTION 'benefit_measurement: benefit, number, kind, source, run and phase are fixed'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_measurement_identity_fixed';
  END IF;
  IF OLD.status = 'validated' THEN
    RAISE EXCEPTION 'benefit_measurement %: a validated value is never edited in place; record an amendment or a reversal', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_measurement_validated_immutable';
  END IF;
  IF OLD.status IN ('rejected', 'superseded') THEN
    RAISE EXCEPTION 'benefit_measurement %: a % measurement is final', OLD.id, OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_measurement_final';
  END IF;
  IF OLD.status = 'submitted' THEN
    IF NEW.status NOT IN ('submitted', 'validated', 'rejected', 'superseded')
       OR (to_jsonb(NEW) - movable) IS DISTINCT FROM (to_jsonb(OLD) - movable) THEN
      RAISE EXCEPTION 'benefit_measurement %: a submitted measurement is frozen until Finance decides it', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_measurement_submitted_frozen';
    END IF;
  ELSIF NEW.status NOT IN ('draft', 'submitted') THEN
    RAISE EXCEPTION 'benefit_measurement: draft -> % is not an allowed transition', NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_measurement_status_step';
  END IF;
  IF OLD.status = 'draft' THEN
    PERFORM p4_benefit_value_row_valid(NEW.benefit_id, NEW.currency, NEW.amount, 'benefit_measurement');
  END IF;
  -- REQ-S08-008: a value is validated only against a Finance-validated comparison basis (the benefit's baseline) and,
  -- when a formula version was used, a Finance-validated formula version. Otherwise it stays provisional.
  IF NEW.status = 'validated' AND OLD.status <> 'validated' AND (b.baseline_validation_status <> 'validated'
     OR (NEW.formula_version_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM benefit_formula_version v WHERE v.id = NEW.formula_version_id AND v.validation_status = 'validated'))) THEN
    RAISE EXCEPTION 'benefit_measurement %: the comparison basis is not Finance-validated; the value is provisional', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_measurement_basis_validated';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER benefit_measurement_guard BEFORE INSERT OR UPDATE ON benefit_measurement
  FOR EACH ROW EXECUTE FUNCTION benefit_measurement_guard();
SELECT p2_attach_guards('benefit_measurement', true);
GRANT SELECT, INSERT, UPDATE ON benefit_measurement TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- benefit_measurement_input: calculation lineage of a measurement (REQ-S08-006): each formula variable bound to an
-- accepted KPI actual VALUE VERSION, with the value used. Same period as the measurement (REQ-S08-008). Append-only.
CREATE TABLE benefit_measurement_input (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id  uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  measurement_id     uuid NOT NULL,
  variable_name      text NOT NULL CHECK (variable_name ~ '^[a-z][a-z0-9_]{0,47}$'),
  kpi_actual_id      uuid NULL,
  kpi_value_no       smallint NULL,
  value              numeric(24,6) NOT NULL,
  period_start       date NOT NULL,
  period_end         date NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_measurement_input_measurement_fkey FOREIGN KEY (transformation_id, measurement_id) REFERENCES benefit_measurement (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_measurement_input_actual_fkey FOREIGN KEY (kpi_actual_id, kpi_value_no) REFERENCES kpi_actual_value (kpi_actual_id, value_no) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_measurement_input_name_key UNIQUE (measurement_id, variable_name),
  CONSTRAINT benefit_measurement_input_actual_pair CHECK ((kpi_actual_id IS NULL) = (kpi_value_no IS NULL))
);
CREATE FUNCTION benefit_measurement_input_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  m record;
BEGIN
  SELECT x.status, x.period_start, x.period_end INTO m FROM benefit_measurement x WHERE x.id = NEW.measurement_id;
  IF m.status NOT IN ('draft', 'submitted') THEN
    RAISE EXCEPTION 'benefit_measurement_input: inputs are recorded only with a draft or submitted measurement'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_measurement_input_open';
  END IF;
  IF (NEW.period_start, NEW.period_end) IS DISTINCT FROM (m.period_start, m.period_end)
     OR (NEW.kpi_actual_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM kpi_actual a WHERE a.id = NEW.kpi_actual_id AND a.period_start = NEW.period_start AND a.period_end = NEW.period_end)) THEN
    RAISE EXCEPTION 'benefit_measurement_input: every input is for the same period as the measurement'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_measurement_input_same_period';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER benefit_measurement_input_guard BEFORE INSERT ON benefit_measurement_input
  FOR EACH ROW EXECUTE FUNCTION benefit_measurement_input_guard();
SELECT p2_attach_append_only('benefit_measurement_input');
SELECT p2_attach_guards('benefit_measurement_input', false);
GRANT SELECT, INSERT ON benefit_measurement_input TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- benefit_evidence: evidence linked to a benefit (T14 Evidence) or to one of its measurements. Append-only; a link to
-- a measurement is added only while it is a draft or submitted.
CREATE TABLE benefit_evidence (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  benefit_id        uuid NOT NULL,
  measurement_id    uuid NULL,
  evidence_id       uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_evidence_benefit_fkey FOREIGN KEY (transformation_id, benefit_id) REFERENCES benefit (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_evidence_measurement_fkey FOREIGN KEY (transformation_id, measurement_id) REFERENCES benefit_measurement (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_evidence_evidence_fkey FOREIGN KEY (transformation_id, evidence_id) REFERENCES evidence (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX benefit_evidence_link_key ON benefit_evidence (benefit_id, coalesce(measurement_id, '00000000-0000-0000-0000-000000000000'::uuid), evidence_id);
CREATE FUNCTION benefit_evidence_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.measurement_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM benefit_measurement m WHERE m.id = NEW.measurement_id AND m.benefit_id = NEW.benefit_id AND m.status IN ('draft', 'submitted')) THEN
    RAISE EXCEPTION 'benefit_evidence: evidence is linked to a draft or submitted measurement of the same benefit'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_evidence_measurement_open';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER benefit_evidence_guard BEFORE INSERT ON benefit_evidence
  FOR EACH ROW EXECUTE FUNCTION benefit_evidence_guard();
SELECT p2_attach_append_only('benefit_evidence');
SELECT p2_attach_guards('benefit_evidence', false);
GRANT SELECT, INSERT ON benefit_evidence TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- finance_validation: FinanceValidation (REQ-S16-017). kind 'validation' = the Finance queue item of one submitted
-- measurement (exactly one per measurement and idempotency key: a replayed submission event creates none, REQ-S12-014)
-- and, once decided, the decision with the six REQ-S08-015 items (baseline, attribution/counterfactual, calculation,
-- evidence, measurement period, assumptions). Status: queued -> approved | rejected | withdrawn (final).
-- kind 'amendment' / 'reversal' = a Finance correction of an approved validation, approved on creation by its author,
-- linked to the original (REQ-S08-017). content is the immutable snapshot presented to the validator (validated JSON
-- with the six keys).
CREATE TABLE finance_validation (
  id                      uuid PRIMARY KEY,
  organization_id         uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id       uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  benefit_id              uuid NOT NULL,
  benefit_measurement_id  uuid NOT NULL,
  kind                    text NOT NULL DEFAULT 'validation' CHECK (kind IN ('validation', 'amendment', 'reversal')),
  corrects_validation_id  uuid NULL,
  idempotency_key         text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  assignee_user_id        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status                  text NOT NULL CHECK (status IN ('queued', 'approved', 'rejected', 'withdrawn')),
  content                 jsonb NOT NULL,
  measurement_period_start date NULL,
  measurement_period_end   date NULL,
  baseline_decision       text NULL CHECK (baseline_decision IS NULL OR baseline_decision IN ('accepted', 'rejected')),
  attribution_decision    text NULL CHECK (attribution_decision IS NULL OR attribution_decision IN ('accepted', 'rejected')),
  calculation_decision    text NULL CHECK (calculation_decision IS NULL OR calculation_decision IN ('accepted', 'rejected')),
  evidence_decision       text NULL CHECK (evidence_decision IS NULL OR evidence_decision IN ('accepted', 'rejected')),
  period_decision         text NULL CHECK (period_decision IS NULL OR period_decision IN ('accepted', 'rejected')),
  assumptions_decision    text NULL CHECK (assumptions_decision IS NULL OR assumptions_decision IN ('accepted', 'rejected')),
  baseline_note           text NULL CHECK (baseline_note IS NULL OR char_length(baseline_note) BETWEEN 1 AND 2000),
  attribution_note        text NULL CHECK (attribution_note IS NULL OR char_length(attribution_note) BETWEEN 1 AND 2000),
  calculation_note        text NULL CHECK (calculation_note IS NULL OR char_length(calculation_note) BETWEEN 1 AND 2000),
  evidence_note           text NULL CHECK (evidence_note IS NULL OR char_length(evidence_note) BETWEEN 1 AND 2000),
  period_note             text NULL CHECK (period_note IS NULL OR char_length(period_note) BETWEEN 1 AND 2000),
  assumptions_note        text NULL CHECK (assumptions_note IS NULL OR char_length(assumptions_note) BETWEEN 1 AND 2000),
  approved_amount         numeric(20,4) NULL,
  decision_note           text NULL CHECK (decision_note IS NULL OR char_length(decision_note) BETWEEN 1 AND 2000),
  decided_by              uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_at              timestamptz NULL,
  reason                  text NULL CHECK (reason IS NULL OR char_length(reason) BETWEEN 3 AND 2000),
  version                 integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT finance_validation_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT finance_validation_idempotency_key UNIQUE (idempotency_key),
  CONSTRAINT finance_validation_benefit_fkey FOREIGN KEY (transformation_id, benefit_id) REFERENCES benefit (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT finance_validation_measurement_fkey FOREIGN KEY (transformation_id, benefit_measurement_id) REFERENCES benefit_measurement (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT finance_validation_corrects_fkey FOREIGN KEY (transformation_id, corrects_validation_id) REFERENCES finance_validation (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT finance_validation_kind_shape CHECK (
    (kind = 'validation') = (corrects_validation_id IS NULL) AND (kind = 'validation' OR (status = 'approved' AND reason IS NOT NULL))),
  CONSTRAINT finance_validation_content_complete CHECK (jsonb_typeof(content) = 'object'
    AND content ?& ARRAY['baseline', 'attribution', 'calculation', 'evidence', 'measurementPeriod', 'assumptions']),
  -- REQ-S08-015: a validation without a measurement period is refused.
  CONSTRAINT finance_validation_period_required CHECK (measurement_period_start IS NOT NULL AND measurement_period_end IS NOT NULL
    AND measurement_period_end >= measurement_period_start),
  CONSTRAINT finance_validation_decided_stamps CHECK ((status IN ('approved', 'rejected')) = (decided_by IS NOT NULL) AND (decided_by IS NULL) = (decided_at IS NULL)),
  CONSTRAINT finance_validation_items_open CHECK (status NOT IN ('queued', 'withdrawn') OR num_nonnulls(baseline_decision, attribution_decision,
    calculation_decision, evidence_decision, period_decision, assumptions_decision, approved_amount) = 0),
  CONSTRAINT finance_validation_all_items_accepted CHECK (kind <> 'validation' OR status <> 'approved' OR (
    baseline_decision = 'accepted' AND attribution_decision = 'accepted' AND calculation_decision = 'accepted'
    AND evidence_decision = 'accepted' AND period_decision = 'accepted' AND assumptions_decision = 'accepted')),
  CONSTRAINT finance_validation_rejection_reason CHECK (status <> 'rejected' OR (decision_note IS NOT NULL AND num_nonnulls(baseline_decision,
    attribution_decision, calculation_decision, evidence_decision, period_decision, assumptions_decision) = 6 AND 'rejected' IN (
    baseline_decision, attribution_decision, calculation_decision, evidence_decision, period_decision, assumptions_decision)))
);
-- Exactly one queue item per submitted measurement (REQ-S12-014).
CREATE UNIQUE INDEX finance_validation_one_per_measurement ON finance_validation (benefit_measurement_id) WHERE kind = 'validation';
CREATE INDEX finance_validation_queue_idx ON finance_validation (transformation_id, created_at) WHERE status = 'queued';

CREATE FUNCTION finance_validation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  m record;
  movable text[] := ARRAY['status', 'baseline_decision', 'attribution_decision', 'calculation_decision', 'evidence_decision',
    'period_decision', 'assumptions_decision', 'baseline_note', 'attribution_note', 'calculation_note', 'evidence_note',
    'period_note', 'assumptions_note', 'approved_amount', 'decision_note', 'decided_by', 'decided_at', 'version',
    'updated_at', 'updated_by'];
BEGIN
  SELECT x.benefit_id, x.kind, x.status, x.amount, x.submitted_by, x.period_start, x.period_end INTO m
  FROM benefit_measurement x WHERE x.id = NEW.benefit_measurement_id;
  IF m.benefit_id IS DISTINCT FROM NEW.benefit_id THEN
    RAISE EXCEPTION 'finance_validation: the measurement belongs to another benefit'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'finance_validation_subject';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.kind = 'validation' AND (m.kind <> 'measurement' OR m.status <> 'submitted' OR NEW.status <> 'queued') THEN
      RAISE EXCEPTION 'finance_validation: a queue item is created queued, for a submitted measurement'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'finance_validation_subject';
    END IF;
    IF NEW.kind <> 'validation' AND (m.kind <> NEW.kind OR NOT EXISTS (
        SELECT 1 FROM finance_validation v WHERE v.id = NEW.corrects_validation_id AND v.kind = 'validation' AND v.status = 'approved'
          AND v.benefit_id = NEW.benefit_id)) THEN
      RAISE EXCEPTION 'finance_validation: a correction links its own % row to an approved validation of the same benefit', NEW.kind
        USING ERRCODE = 'check_violation', CONSTRAINT = 'finance_validation_subject';
    END IF;
    IF (NEW.measurement_period_start, NEW.measurement_period_end) IS DISTINCT FROM (m.period_start, m.period_end) THEN
      RAISE EXCEPTION 'finance_validation: the measurement period is the measurement''s own'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'finance_validation_period_required';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'queued' OR NEW.status NOT IN ('queued', 'approved', 'rejected', 'withdrawn') THEN
    RAISE EXCEPTION 'finance_validation %: % is final', OLD.id, OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'finance_validation_status_step';
  END IF;
  IF (to_jsonb(NEW) - movable) IS DISTINCT FROM (to_jsonb(OLD) - movable) THEN
    RAISE EXCEPTION 'finance_validation %: the queued content is an immutable snapshot', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'finance_validation_frozen';
  END IF;
  -- REQ-PB-013 / SoD: the validator is never the person who submitted the value.
  IF NEW.decided_by IS NOT NULL AND NEW.decided_by = m.submitted_by THEN
    RAISE EXCEPTION 'finance_validation %: the submitter cannot validate their own submission', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'finance_validation_sod';
  END IF;
  IF NEW.status = 'approved' AND (NEW.approved_amount IS NULL) <> (m.amount IS NULL) THEN
    RAISE EXCEPTION 'finance_validation %: an approved financial value states its approved amount; a non-financial one has none', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'finance_validation_amount_shape';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_validation_guard BEFORE INSERT OR UPDATE ON finance_validation
  FOR EACH ROW EXECUTE FUNCTION finance_validation_guard();
SELECT p2_attach_guards('finance_validation', true);
GRANT SELECT, INSERT, UPDATE ON finance_validation TO mth_app;

-- At COMMIT: a validated or rejected measurement has the matching Finance decision by the same person, with the
-- approved amount; a superseded one has no queued item left. A measurement therefore never becomes validated value
-- without a Finance validation row (REQ-S07-014, REQ-S08-016).
CREATE FUNCTION benefit_measurement_decision_present() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  cur record;
BEGIN
  SELECT * INTO cur FROM benefit_measurement m WHERE m.id = NEW.id;
  IF cur.kind = 'measurement' AND cur.status IN ('validated', 'rejected') AND NOT EXISTS (
      SELECT 1 FROM finance_validation v WHERE v.benefit_measurement_id = cur.id AND v.kind = 'validation'
        AND v.status = CASE cur.status WHEN 'validated' THEN 'approved' ELSE 'rejected' END
        AND v.decided_by = cur.decided_by
        AND v.approved_amount IS NOT DISTINCT FROM cur.validated_amount) THEN
    RAISE EXCEPTION 'benefit_measurement %: % without the matching Finance validation decision', cur.id, cur.status
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'benefit_measurement_decision_present';
  END IF;
  IF cur.kind <> 'measurement' AND NOT EXISTS (
      SELECT 1 FROM finance_validation v WHERE v.benefit_measurement_id = cur.id AND v.kind = cur.kind AND v.status = 'approved'
        AND v.decided_by = cur.decided_by) THEN
    RAISE EXCEPTION 'benefit_measurement %: a % needs its Finance correction record', cur.id, cur.kind
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'benefit_measurement_decision_present';
  END IF;
  IF cur.status = 'superseded' AND EXISTS (
      SELECT 1 FROM finance_validation v WHERE v.benefit_measurement_id = cur.id AND v.status = 'queued') THEN
    RAISE EXCEPTION 'benefit_measurement %: withdraw its queue item when it is superseded', cur.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'benefit_measurement_decision_present';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER benefit_measurement_decision_present AFTER INSERT OR UPDATE ON benefit_measurement
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION benefit_measurement_decision_present();

-- -----------------------------------------------------------------------------------------------------------------
-- benefit_overlap: an overlap warning between two benefits of one transformation (REQ-S08-014): same driver,
-- population or period. Raised by the API's rule (lock 730234, key "<transformationId>:<driverKey>") or by a user.
-- While open, both benefits are excluded from validated totals. Only Finance resolves it (finance.validate), and not
-- the owner of either benefit: 'no_economic_overlap' (both count) or 'duplicate' (excluded_benefit_id is never
-- counted). Status: open -> resolved (final).
CREATE TABLE benefit_overlap (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id   uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  benefit_a_id        uuid NOT NULL,
  benefit_b_id        uuid NOT NULL,
  dimensions          text[] NOT NULL CHECK (cardinality(dimensions) >= 1 AND dimensions <@ ARRAY['driver', 'population', 'period']::text[]),
  driver_key          text NULL CHECK (driver_key IS NULL OR driver_key ~ '^[a-z0-9][a-z0-9_.:-]{0,99}$'),
  population_key      text NULL CHECK (population_key IS NULL OR population_key ~ '^[a-z0-9][a-z0-9_.:-]{0,99}$'),
  overlap_start       date NULL,
  overlap_end         date NULL,
  detected_by         text NOT NULL CHECK (detected_by IN ('rule', 'user')),
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution          text NULL CHECK (resolution IS NULL OR resolution IN ('no_economic_overlap', 'duplicate')),
  excluded_benefit_id uuid NULL,
  resolution_note     text NULL CHECK (resolution_note IS NULL OR char_length(resolution_note) BETWEEN 3 AND 4000),
  resolved_by         uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  resolved_at         timestamptz NULL,
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_overlap_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT benefit_overlap_a_fkey FOREIGN KEY (transformation_id, benefit_a_id) REFERENCES benefit (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_overlap_b_fkey FOREIGN KEY (transformation_id, benefit_b_id) REFERENCES benefit (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_overlap_pair_order CHECK (benefit_a_id < benefit_b_id),
  CONSTRAINT benefit_overlap_period_range CHECK (overlap_end IS NULL OR overlap_start IS NULL OR overlap_end >= overlap_start),
  CONSTRAINT benefit_overlap_resolution_complete CHECK (
    (status = 'resolved') = (resolution IS NOT NULL) AND (resolution IS NULL) = (resolved_by IS NULL)
    AND (resolved_by IS NULL) = (resolved_at IS NULL) AND (resolution IS NULL) = (resolution_note IS NULL)
    AND (resolution = 'duplicate') = (excluded_benefit_id IS NOT NULL)
    AND (excluded_benefit_id IS NULL OR excluded_benefit_id IN (benefit_a_id, benefit_b_id)))
);
CREATE UNIQUE INDEX benefit_overlap_one_open_key ON benefit_overlap (benefit_a_id, benefit_b_id) WHERE status = 'open';
CREATE INDEX benefit_overlap_transformation_idx ON benefit_overlap (transformation_id, status, created_at DESC);
CREATE FUNCTION benefit_overlap_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' THEN
      RAISE EXCEPTION 'benefit_overlap: a warning starts open'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_overlap_status_step';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'open'
     OR (to_jsonb(NEW) - ARRAY['status', 'resolution', 'excluded_benefit_id', 'resolution_note', 'resolved_by', 'resolved_at', 'version', 'updated_at', 'updated_by'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'resolution', 'excluded_benefit_id', 'resolution_note', 'resolved_by', 'resolved_at', 'version', 'updated_at', 'updated_by']) THEN
    RAISE EXCEPTION 'benefit_overlap %: only an open warning is resolved, once', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_overlap_status_step';
  END IF;
  IF NEW.resolved_by IS NOT NULL AND EXISTS (
      SELECT 1 FROM benefit b WHERE b.id IN (NEW.benefit_a_id, NEW.benefit_b_id) AND b.owner_user_id = NEW.resolved_by) THEN
    RAISE EXCEPTION 'benefit_overlap %: the owner of an overlapping benefit cannot resolve the overlap', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_overlap_resolver_not_owner';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER benefit_overlap_guard BEFORE INSERT OR UPDATE ON benefit_overlap
  FOR EACH ROW EXECUTE FUNCTION benefit_overlap_guard();
SELECT p2_attach_guards('benefit_overlap', true);
GRANT SELECT, INSERT, UPDATE ON benefit_overlap TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- Benefit rules that need the value tables: once a benefit has values, its type, class and currency are fixed
-- (stored values depend on them); a benefit with values cannot become a parent (a parent carries no values).
CREATE FUNCTION benefit_value_lock_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.benefit_type, NEW.value_class, NEW.currency) IS DISTINCT FROM (OLD.benefit_type, OLD.value_class, OLD.currency)
     AND (EXISTS (SELECT 1 FROM benefit_measurement m WHERE m.benefit_id = NEW.id)
          OR EXISTS (SELECT 1 FROM benefit_plan_value p WHERE p.benefit_id = NEW.id)
          OR EXISTS (SELECT 1 FROM benefit_scenario_value s WHERE s.benefit_id = NEW.id)) THEN
    RAISE EXCEPTION 'benefit %: it has values, so its type, class and currency are fixed', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_measure_locked';
  END IF;
  IF NEW.parent_benefit_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.parent_benefit_id IS DISTINCT FROM OLD.parent_benefit_id)
     AND (EXISTS (SELECT 1 FROM benefit_measurement m WHERE m.benefit_id = NEW.parent_benefit_id)
          OR EXISTS (SELECT 1 FROM benefit_plan_value p WHERE p.benefit_id = NEW.parent_benefit_id)
          OR EXISTS (SELECT 1 FROM benefit_scenario_value s WHERE s.benefit_id = NEW.parent_benefit_id)) THEN
    RAISE EXCEPTION 'benefit: the parent benefit already has values of its own; a parent is a roll-up of its children'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_parent_has_values';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER benefit_value_lock_guard BEFORE INSERT OR UPDATE ON benefit
  FOR EACH ROW EXECUTE FUNCTION benefit_value_lock_guard();
