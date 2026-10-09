-- 0037 P4 benefit register: T14 benefits with the REQ-S08-003 profile, the six-step lifecycle and its history, enabler
-- links, contribution allocations, shared-benefit groups, valuation methods and base/upside/downside scenarios
-- (T-DG4-ARCH-03; ADR-0029; REQ-PB-058, REQ-PB-074, REQ-PB-075, REQ-PB-076, REQ-S08-002, REQ-S08-003, REQ-S08-009,
-- REQ-S08-010, REQ-S08-013, REQ-S08-018, REQ-S16-017). Authored by solution-architect. Contract:
-- docs/architecture/data-dictionary.md ("P4 tables, slice B"). Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16. Decimal only (numeric).
-- Nothing here validates or approves anything: Finance validation and valuation-method approval are decisions of named
-- Finance users through the API (finance.validate). Nothing touches DG0-DG7.

-- Human-readable codes: B01 (T14 IDs, B0123), BG-01 (shared-benefit groups), VM-01 (valuation methods). Widening the
-- closed prefix set is the 0020 precedent (additive: every existing prefix stays).
ALTER TABLE record_code_counter DROP CONSTRAINT record_code_counter_prefix_check;
ALTER TABLE record_code_counter ADD CONSTRAINT record_code_counter_prefix_check
  CHECK (prefix IN ('D', 'DEC', 'GD', 'DEP', 'INI', 'BC', 'BF', 'B', 'BG', 'VM'));

-- -----------------------------------------------------------------------------------------------------------------
-- benefit_lifecycle_step_definition: the six B0121 steps with their question and output, seeded VERBATIM (English).
-- Arabic is a PROVISIONAL translation needing linguistic review. Reference data: read-only for the application.
CREATE TABLE benefit_lifecycle_step_definition (
  code        text PRIMARY KEY CHECK (code IN ('identify', 'plan', 'enable', 'measure', 'correct', 'sustain')),
  ordinal     smallint NOT NULL UNIQUE CHECK (ordinal BETWEEN 1 AND 6),
  step_en     text NOT NULL CHECK (char_length(step_en) BETWEEN 1 AND 50),
  question_en text NOT NULL CHECK (char_length(question_en) BETWEEN 1 AND 200),
  output_en   text NOT NULL CHECK (char_length(output_en) BETWEEN 1 AND 200),
  step_ar     text NOT NULL CHECK (char_length(step_ar) BETWEEN 1 AND 50),
  question_ar text NOT NULL CHECK (char_length(question_ar) BETWEEN 1 AND 200),
  output_ar   text NOT NULL CHECK (char_length(output_ar) BETWEEN 1 AND 200),
  ar_is_provisional boolean NOT NULL DEFAULT true,
  source_ref  text NOT NULL CHECK (source_ref = 'B0121')
);
INSERT INTO benefit_lifecycle_step_definition (code, ordinal, step_en, question_en, output_en, step_ar, question_ar, output_ar, source_ref) VALUES
  ('identify', 1, 'Identify', 'What benefit should this change create?', 'Benefit profile', 'التحديد', 'ما المنفعة التي ينبغي أن يحققها هذا التغيير؟', 'ملف المنفعة', 'B0121'),
  ('plan', 2, 'Plan', 'How will it be measured, when, and by whom?', 'Baseline, formula, target, owner', 'التخطيط', 'كيف ستُقاس، ومتى، ومن سيقيسها؟', 'خط الأساس، المعادلة، المستهدف، المالك', 'B0121'),
  ('enable', 3, 'Enable', 'What capability/deliverable must exist first?', 'Benefit dependency chain', 'التمكين', 'ما القدرة أو المُخرَج الذي يجب أن يتوفر أولاً؟', 'سلسلة اعتماديات المنفعة', 'B0121'),
  ('measure', 4, 'Measure', 'Is the benefit appearing in actual performance?', 'Evidence / actuals', 'القياس', 'هل تظهر المنفعة في الأداء الفعلي؟', 'الأدلة / القيم الفعلية', 'B0121'),
  ('correct', 5, 'Correct', 'What action is needed if benefit is off track?', 'Recovery plan', 'التصحيح', 'ما الإجراء المطلوب إذا انحرفت المنفعة عن مسارها؟', 'خطة التعافي', 'B0121'),
  ('sustain', 6, 'Sustain', 'Who owns the metric after transformation closure?', 'BAU owner + control cadence', 'الاستدامة', 'من يملك المؤشر بعد إغلاق التحول؟', 'مالك العمليات الاعتيادية + وتيرة الرقابة', 'B0121');
GRANT SELECT ON benefit_lifecycle_step_definition TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- benefit_valuation_method: a method that puts a SAR value on a non-financial benefit (REQ-S08-010). Proposed by a
-- benefit editor; approved or rejected by Finance (finance.validate), never by its proposer. Content is fixed once
-- proposed; a different method is a new row. Status: proposed -> approved | rejected; approved -> retired.
CREATE TABLE benefit_valuation_method (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code              text NOT NULL CHECK (code ~ '^VM-[0-9]{2,6}$'),
  name              text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 300),
  method            text NOT NULL CHECK (char_length(method) BETWEEN 1 AND 8000),
  applies_to_type   text NOT NULL CHECK (applies_to_type IN ('cx', 'risk', 'strategic', 'other')),
  kpi_definition_id uuid NULL,
  unit_value        numeric(20,4) NULL CHECK (unit_value IS NULL OR unit_value >= 0),
  currency          char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status            text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected', 'retired')),
  decided_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_at        timestamptz NULL,
  decision_note     text NULL CHECK (decision_note IS NULL OR char_length(decision_note) BETWEEN 1 AND 2000),
  retired_at        timestamptz NULL,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_valuation_method_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT benefit_valuation_method_code_key UNIQUE (transformation_id, code),
  CONSTRAINT benefit_valuation_method_kpi_fkey FOREIGN KEY (transformation_id, kpi_definition_id)
    REFERENCES kpi_definition (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_valuation_method_decision_complete CHECK (
    (status IN ('approved', 'rejected', 'retired')) = (decided_by IS NOT NULL) AND (decided_by IS NULL) = (decided_at IS NULL)
    AND (status <> 'rejected' OR decision_note IS NOT NULL) AND (status = 'retired') = (retired_at IS NOT NULL)),
  CONSTRAINT benefit_valuation_method_decider_not_proposer CHECK (decided_by IS NULL OR decided_by <> created_by)
);
CREATE FUNCTION benefit_valuation_method_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  movable text[] := ARRAY['status', 'decided_by', 'decided_at', 'decision_note', 'retired_at', 'version', 'updated_at', 'updated_by'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'proposed' THEN
      RAISE EXCEPTION 'benefit_valuation_method: a new method starts as proposed'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_valuation_method_status_step';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - movable) IS DISTINCT FROM (to_jsonb(OLD) - movable) THEN
    RAISE EXCEPTION 'benefit_valuation_method %: a method is fixed once proposed; propose a new one', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_valuation_method_frozen';
  END IF;
  IF NOT (NEW.status = OLD.status AND NEW.decided_by IS NOT DISTINCT FROM OLD.decided_by
          OR (OLD.status = 'proposed' AND NEW.status IN ('approved', 'rejected'))
          OR (OLD.status = 'approved' AND NEW.status = 'retired' AND NEW.decided_by = OLD.decided_by AND NEW.decided_at = OLD.decided_at)) THEN
    RAISE EXCEPTION 'benefit_valuation_method: % -> % is not an allowed transition', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_valuation_method_status_step';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER benefit_valuation_method_guard BEFORE INSERT OR UPDATE ON benefit_valuation_method
  FOR EACH ROW EXECUTE FUNCTION benefit_valuation_method_guard();
SELECT p2_attach_guards('benefit_valuation_method', true);
GRANT SELECT, INSERT, UPDATE ON benefit_valuation_method TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- benefit_group: a shared-benefit group (REQ-PB-058, M0173): benefits of one transformation that claim one economic
-- pool. Exactly the member named counted_benefit_id is counted in totals; the other members are shown, never counted
-- (ADR-0029 §6). counted_benefit_id is set by a benefit editor or by a Finance overlap resolution.
CREATE TABLE benefit_group (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id  uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code               text NOT NULL CHECK (code ~ '^BG-[0-9]{2,6}$'),
  title              text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  description        text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 4000),
  counted_benefit_id uuid NULL,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at        timestamptz NULL,
  archived_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason     text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version            integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_group_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT benefit_group_code_key UNIQUE (transformation_id, code),
  CONSTRAINT benefit_group_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL) AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
SELECT p2_attach_guards('benefit_group', true);
GRANT SELECT, INSERT, UPDATE ON benefit_group TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- benefit: one canonical T14 register row (B0123) with the REQ-S08-003 profile. One accountable owner (one column),
-- one class, one currency. Lifecycle (B0121): identify -> plan -> enable -> measure <-> correct; measure -> sustain.
-- The CHECKs below make each step's source output a precondition (REQ-PB-074): enable and later need the Plan outputs
-- (baseline, formula, target, owner); correct needs a recovery plan; sustain needs a BAU owner and a control cadence.
-- Measure also needs at least one active enabler link (the Enable output; trigger benefit_guard).
CREATE TABLE benefit (
  id                            uuid PRIMARY KEY,
  organization_id               uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id             uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code                          text NOT NULL CHECK (code ~ '^B[0-9]{2,6}$'),
  title                         text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  description                   text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 8000),
  benefit_type                  text NOT NULL CHECK (benefit_type IN ('revenue', 'cost', 'working_capital', 'cx', 'risk', 'strategic', 'other')),
  value_class                   text NOT NULL CHECK (value_class IN ('revenue_uplift', 'margin_uplift', 'cash_saving', 'avoided_cost', 'working_capital_release', 'non_financial')),
  owner_user_id                 uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  finance_validator_user_id     uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  finance_validation_required   boolean NOT NULL DEFAULT true,
  financial_statement_line      text NULL CHECK (financial_statement_line IS NULL OR char_length(financial_statement_line) BETWEEN 1 AND 200),
  measurement_kpi_definition_id uuid NULL,
  measurement_kpi_variable      text NULL CHECK (measurement_kpi_variable IS NULL OR measurement_kpi_variable ~ '^[a-z][a-z0-9_]{0,47}$'),
  business_case_line_id         uuid NULL REFERENCES business_case_line (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  benefit_formula_id            uuid NULL,
  baseline_id                   uuid NULL,
  baseline_value                numeric(24,6) NULL,
  baseline_unit                 text NULL CHECK (baseline_unit IS NULL OR char_length(baseline_unit) BETWEEN 1 AND 50),
  baseline_date                 date NULL,
  counterfactual                text NULL CHECK (counterfactual IS NULL OR char_length(counterfactual) BETWEEN 1 AND 4000),
  baseline_validation_status    text NOT NULL DEFAULT 'unvalidated' CHECK (baseline_validation_status IN ('unvalidated', 'validated', 'rejected')),
  baseline_validated_by         uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  baseline_validated_at         timestamptz NULL,
  baseline_validation_note      text NULL CHECK (baseline_validation_note IS NULL OR char_length(baseline_validation_note) BETWEEN 1 AND 2000),
  driver_key                    text NULL CHECK (driver_key IS NULL OR driver_key ~ '^[a-z0-9][a-z0-9_.:-]{0,99}$'),
  driver_units                  text NULL CHECK (driver_units IS NULL OR char_length(driver_units) BETWEEN 1 AND 100),
  population_key                text NULL CHECK (population_key IS NULL OR population_key ~ '^[a-z0-9][a-z0-9_.:-]{0,99}$'),
  target_value                  numeric(24,6) NULL,
  target_date                   date NULL,
  realization_start             date NULL,
  realization_end               date NULL,
  recurrence                    text NULL CHECK (recurrence IS NULL OR recurrence IN ('one_off', 'recurring')),
  currency                      char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  planned_value                 numeric(20,4) NULL,
  valuation_method_id           uuid NULL,
  measurement_source            text NULL CHECK (measurement_source IS NULL OR char_length(measurement_source) BETWEEN 1 AND 500),
  confidence                    char(1) NULL CHECK (confidence IS NULL OR confidence IN ('H', 'M', 'L')),
  assumptions                   text NULL CHECK (assumptions IS NULL OR char_length(assumptions) BETWEEN 1 AND 8000),
  parent_benefit_id             uuid NULL,
  benefit_group_id              uuid NULL,
  allocation_set_no             smallint NOT NULL DEFAULT 0 CHECK (allocation_set_no >= 0),
  lifecycle_step                text NOT NULL DEFAULT 'identify' CHECK (lifecycle_step IN ('identify', 'plan', 'enable', 'measure', 'correct', 'sustain')),
  recovery_plan                 text NULL CHECK (recovery_plan IS NULL OR char_length(recovery_plan) BETWEEN 1 AND 8000),
  bau_owner_user_id             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  control_cadence               text NULL CHECK (control_cadence IS NULL OR control_cadence IN ('monthly', 'quarterly', 'semiannual', 'annual')),
  status_rag                    text NULL CHECK (status_rag IS NULL OR status_rag IN ('green', 'amber', 'red')),
  status_rag_note               text NULL CHECK (status_rag_note IS NULL OR char_length(status_rag_note) BETWEEN 1 AND 2000),
  status                        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at                   timestamptz NULL,
  archived_by                   uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason                text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version                       integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                    timestamptz NOT NULL DEFAULT now(),
  created_by                    uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  updated_by                    uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT benefit_code_key UNIQUE (transformation_id, code),
  CONSTRAINT benefit_kpi_fkey FOREIGN KEY (transformation_id, measurement_kpi_definition_id)
    REFERENCES kpi_definition (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_formula_fkey FOREIGN KEY (transformation_id, benefit_formula_id)
    REFERENCES benefit_formula (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_baseline_fkey FOREIGN KEY (transformation_id, baseline_id)
    REFERENCES baseline (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_valuation_method_fkey FOREIGN KEY (transformation_id, valuation_method_id)
    REFERENCES benefit_valuation_method (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_parent_fkey FOREIGN KEY (transformation_id, parent_benefit_id)
    REFERENCES benefit (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_group_fkey FOREIGN KEY (transformation_id, benefit_group_id)
    REFERENCES benefit_group (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- REQ-S08-009: each T14 type maps to its value classes; revenue uplift vs margin and avoided cost vs cash savings
  -- are different classes, never converted into each other.
  CONSTRAINT benefit_type_fits_class CHECK (
    (benefit_type = 'revenue' AND value_class IN ('revenue_uplift', 'margin_uplift'))
    OR (benefit_type = 'cost' AND value_class IN ('cash_saving', 'avoided_cost'))
    OR (benefit_type = 'working_capital' AND value_class = 'working_capital_release')
    OR (benefit_type = 'risk' AND value_class IN ('avoided_cost', 'non_financial'))
    OR (benefit_type IN ('cx', 'strategic', 'other') AND value_class = 'non_financial')),
  -- REQ-S08-003 / REQ-PB-058: a financial benefit maps to a financial-statement line; a non-financial one has an agreed KPI.
  CONSTRAINT benefit_mapping_required CHECK (value_class = 'non_financial' OR financial_statement_line IS NOT NULL),
  CONSTRAINT benefit_kpi_required CHECK (value_class <> 'non_financial' OR measurement_kpi_definition_id IS NOT NULL),
  -- REQ-PB-076 / REQ-S08-010: a non-financial benefit has Value (SAR) n/a (NULL) unless an approved valuation method
  -- is referenced (approval checked by benefit_guard).
  CONSTRAINT benefit_non_financial_unmonetised CHECK (value_class <> 'non_financial' OR planned_value IS NULL OR valuation_method_id IS NOT NULL),
  CONSTRAINT benefit_valuation_only_non_financial CHECK (valuation_method_id IS NULL OR value_class = 'non_financial'),
  -- REQ-S07-014: Finance validation is always required for a financial benefit.
  CONSTRAINT benefit_financial_needs_validation CHECK (value_class = 'non_financial' OR finance_validation_required),
  CONSTRAINT benefit_plan_outputs_present CHECK (
    lifecycle_step IN ('identify', 'plan')
    OR ((baseline_value IS NOT NULL OR baseline_id IS NOT NULL) AND target_value IS NOT NULL
        AND (benefit_formula_id IS NOT NULL OR value_class = 'non_financial'))),
  CONSTRAINT benefit_correct_output_present CHECK (lifecycle_step <> 'correct' OR recovery_plan IS NOT NULL),
  CONSTRAINT benefit_sustain_outputs_present CHECK (lifecycle_step <> 'sustain' OR (bau_owner_user_id IS NOT NULL AND control_cadence IS NOT NULL)),
  -- REQ-S07-014: the one formula variable fed by the measurement KPI's accepted actuals (the other variables keep their
  -- stored formula-version values).
  CONSTRAINT benefit_kpi_variable_bound CHECK (measurement_kpi_variable IS NULL OR (measurement_kpi_definition_id IS NOT NULL AND benefit_formula_id IS NOT NULL)),
  CONSTRAINT benefit_validator_not_owner CHECK (finance_validator_user_id IS NULL OR finance_validator_user_id <> owner_user_id),
  CONSTRAINT benefit_baseline_validation_complete CHECK (
    (baseline_validation_status = 'unvalidated') = (baseline_validated_by IS NULL) AND (baseline_validated_by IS NULL) = (baseline_validated_at IS NULL)
    AND (baseline_validation_status <> 'rejected' OR baseline_validation_note IS NOT NULL)
    AND (baseline_validation_status = 'unvalidated' OR baseline_value IS NOT NULL OR baseline_id IS NOT NULL)),
  CONSTRAINT benefit_baseline_validator_not_owner CHECK (baseline_validated_by IS NULL OR baseline_validated_by <> owner_user_id),
  CONSTRAINT benefit_realization_range CHECK (realization_end IS NULL OR realization_start IS NULL OR realization_end >= realization_start),
  CONSTRAINT benefit_not_own_parent CHECK (parent_benefit_id IS NULL OR parent_benefit_id <> id),
  CONSTRAINT benefit_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL) AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
-- One P3 business-case benefit line backs at most one register benefit (never counted twice).
CREATE UNIQUE INDEX benefit_one_case_line_key ON benefit (business_case_line_id) WHERE business_case_line_id IS NOT NULL AND status = 'active';
CREATE INDEX benefit_transformation_updated_idx ON benefit (transformation_id, updated_at DESC, id DESC);
CREATE INDEX benefit_parent_idx ON benefit (parent_benefit_id) WHERE parent_benefit_id IS NOT NULL;
CREATE INDEX benefit_group_idx ON benefit (benefit_group_id) WHERE benefit_group_id IS NOT NULL;
CREATE INDEX benefit_driver_idx ON benefit (transformation_id, driver_key) WHERE driver_key IS NOT NULL AND status = 'active';

ALTER TABLE benefit_group ADD CONSTRAINT benefit_group_counted_fkey FOREIGN KEY (transformation_id, counted_benefit_id)
  REFERENCES benefit (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- -----------------------------------------------------------------------------------------------------------------
-- benefit_enabler: the Enable output, the benefit dependency chain (B0121): the initiative, and optionally its
-- deliverable or a capability, that must exist before the benefit can appear. A delivered enabler is never realized
-- value (REQ-S08-002); it only allows the Measure step.
CREATE TABLE benefit_enabler (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  benefit_id        uuid NOT NULL,
  initiative_id     uuid NOT NULL,
  deliverable_id    uuid NULL,
  capability_id     uuid NULL,
  note              text NULL CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  removed_at        timestamptz NULL,
  removed_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  remove_reason     text NULL CHECK (remove_reason IS NULL OR char_length(remove_reason) BETWEEN 3 AND 1000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_enabler_benefit_fkey FOREIGN KEY (transformation_id, benefit_id) REFERENCES benefit (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_enabler_initiative_fkey FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_enabler_deliverable_fkey FOREIGN KEY (transformation_id, deliverable_id) REFERENCES deliverable (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_enabler_capability_fkey FOREIGN KEY (transformation_id, capability_id) REFERENCES capability (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_enabler_removal_complete CHECK ((status = 'removed') = (removed_at IS NOT NULL) AND (removed_at IS NULL) = (removed_by IS NULL) AND (removed_at IS NULL) = (remove_reason IS NULL))
);
CREATE UNIQUE INDEX benefit_enabler_active_key ON benefit_enabler (benefit_id, initiative_id, coalesce(deliverable_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(capability_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE status = 'active';
CREATE FUNCTION benefit_enabler_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.deliverable_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM deliverable d WHERE d.id = NEW.deliverable_id AND d.initiative_id = NEW.initiative_id) THEN
    RAISE EXCEPTION 'benefit_enabler: the deliverable must belong to the enabling initiative'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_enabler_deliverable_initiative';
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.status = 'removed'
      OR (to_jsonb(NEW) - ARRAY['status', 'removed_at', 'removed_by', 'remove_reason', 'note', 'version', 'updated_at', 'updated_by'])
         IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'removed_at', 'removed_by', 'remove_reason', 'note', 'version', 'updated_at', 'updated_by'])) THEN
    RAISE EXCEPTION 'benefit_enabler: only the note changes, and a removed link stays removed'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_enabler_frozen';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER benefit_enabler_guard BEFORE INSERT OR UPDATE ON benefit_enabler
  FOR EACH ROW EXECUTE FUNCTION benefit_enabler_guard();
SELECT p2_attach_guards('benefit_enabler', true);
GRANT SELECT, INSERT, UPDATE ON benefit_enabler TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- benefit_lifecycle_event: append-only history of lifecycle steps. Written ONLY by the trigger
-- benefit_lifecycle_history on every step change of benefit (actor = the benefit's updated_by), so the history cannot
-- diverge from the row. Covered by the benefit's audit event.
CREATE TABLE benefit_lifecycle_event (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  benefit_id        uuid NOT NULL,
  from_step         text NULL CHECK (from_step IS NULL OR from_step IN ('identify', 'plan', 'enable', 'measure', 'correct', 'sustain')),
  to_step           text NOT NULL CHECK (to_step IN ('identify', 'plan', 'enable', 'measure', 'correct', 'sustain')),
  benefit_version   integer NOT NULL CHECK (benefit_version >= 1),
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  actor_user_id     uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_lifecycle_event_benefit_fkey FOREIGN KEY (transformation_id, benefit_id) REFERENCES benefit (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_lifecycle_event_version_key UNIQUE (benefit_id, benefit_version)
);
SELECT p2_attach_append_only('benefit_lifecycle_event');
SELECT p2_attach_guards('benefit_lifecycle_event', false);
GRANT SELECT, INSERT ON benefit_lifecycle_event TO mth_app;

CREATE FUNCTION benefit_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  par record;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.lifecycle_step <> 'identify' THEN
    RAISE EXCEPTION 'benefit: a new benefit starts at the Identify step'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_lifecycle_step';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.allocation_set_no <> 0 THEN
    RAISE EXCEPTION 'benefit: a new benefit has no allocation set yet'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_allocation_set_step';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.lifecycle_step IS DISTINCT FROM OLD.lifecycle_step AND NOT (
         (OLD.lifecycle_step = 'identify' AND NEW.lifecycle_step = 'plan')
      OR (OLD.lifecycle_step = 'plan' AND NEW.lifecycle_step = 'enable')
      OR (OLD.lifecycle_step = 'enable' AND NEW.lifecycle_step = 'measure')
      OR (OLD.lifecycle_step = 'measure' AND NEW.lifecycle_step IN ('correct', 'sustain'))
      OR (OLD.lifecycle_step = 'correct' AND NEW.lifecycle_step = 'measure')) THEN
      RAISE EXCEPTION 'benefit: % -> % is not an allowed lifecycle step', OLD.lifecycle_step, NEW.lifecycle_step
        USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_lifecycle_step';
    END IF;
    IF NEW.lifecycle_step = 'measure' AND OLD.lifecycle_step = 'enable' AND NOT EXISTS (
        SELECT 1 FROM benefit_enabler e WHERE e.benefit_id = NEW.id AND e.status = 'active') THEN
      RAISE EXCEPTION 'benefit: the Measure step needs the Enable output (at least one enabler link)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_enablers_required';
    END IF;
    IF NEW.allocation_set_no NOT IN (OLD.allocation_set_no, OLD.allocation_set_no + 1) THEN
      RAISE EXCEPTION 'benefit: the allocation set number steps by one'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_allocation_set_step';
    END IF;
    -- A validated baseline changes only together with resetting its validation (REQ-PB-013: Finance validates it again).
    IF OLD.baseline_validation_status <> 'unvalidated' AND NEW.baseline_validation_status = OLD.baseline_validation_status
       AND (NEW.baseline_value IS DISTINCT FROM OLD.baseline_value OR NEW.baseline_id IS DISTINCT FROM OLD.baseline_id
            OR NEW.baseline_date IS DISTINCT FROM OLD.baseline_date OR NEW.counterfactual IS DISTINCT FROM OLD.counterfactual) THEN
      RAISE EXCEPTION 'benefit: a % baseline cannot change; reset it to unvalidated with the change', OLD.baseline_validation_status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_baseline_validated_frozen';
    END IF;
    IF OLD.status = 'archived' AND NEW.status = 'archived' THEN
      RAISE EXCEPTION 'benefit: an archived benefit is read-only'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_archived_frozen';
    END IF;
  END IF;
  -- Parent/child: one level only. A parent is a roll-up container; a child never has children of its own.
  IF NEW.parent_benefit_id IS NOT NULL THEN
    SELECT b.parent_benefit_id, b.currency INTO par FROM benefit b WHERE b.id = NEW.parent_benefit_id;
    IF par.parent_benefit_id IS NOT NULL OR EXISTS (SELECT 1 FROM benefit c WHERE c.parent_benefit_id = NEW.id) THEN
      RAISE EXCEPTION 'benefit: parent/child benefits are one level deep'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_parent_depth';
    END IF;
    IF par.currency IS DISTINCT FROM NEW.currency THEN
      RAISE EXCEPTION 'benefit: a child benefit uses its parent''s currency'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_parent_currency';
    END IF;
  END IF;
  IF NEW.valuation_method_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM benefit_valuation_method m WHERE m.id = NEW.valuation_method_id AND m.status = 'approved' AND m.currency = NEW.currency)
     AND (TG_OP = 'INSERT' OR NEW.valuation_method_id IS DISTINCT FROM OLD.valuation_method_id OR NEW.planned_value IS DISTINCT FROM OLD.planned_value) THEN
    RAISE EXCEPTION 'benefit: the valuation method must be approved by Finance and in the benefit''s currency'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_valuation_method_approved';
  END IF;
  IF NEW.business_case_line_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM business_case_line l WHERE l.id = NEW.business_case_line_id AND l.transformation_id = NEW.transformation_id
        AND l.line_kind = 'benefit') THEN
    RAISE EXCEPTION 'benefit: the business-case line must be a benefit line of this transformation'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_case_line_valid';
  END IF;
  -- The counted member of a shared-benefit group stays in its group.
  IF TG_OP = 'UPDATE' AND OLD.benefit_group_id IS NOT NULL AND NEW.benefit_group_id IS DISTINCT FROM OLD.benefit_group_id
     AND EXISTS (SELECT 1 FROM benefit_group g WHERE g.id = OLD.benefit_group_id AND g.counted_benefit_id = NEW.id) THEN
    RAISE EXCEPTION 'benefit: the counted member cannot leave its shared-benefit group; name another counted member first'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_group_counted_member';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER benefit_guard BEFORE INSERT OR UPDATE ON benefit
  FOR EACH ROW EXECUTE FUNCTION benefit_guard();

CREATE FUNCTION benefit_lifecycle_history() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.lifecycle_step IS DISTINCT FROM OLD.lifecycle_step THEN
    INSERT INTO benefit_lifecycle_event (id, organization_id, transformation_id, benefit_id, from_step, to_step, benefit_version, actor_user_id)
    VALUES (mth_uuid_v7(), NEW.organization_id, NEW.transformation_id, NEW.id,
            CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.lifecycle_step END, NEW.lifecycle_step, NEW.version, NEW.updated_by);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER benefit_lifecycle_history AFTER INSERT OR UPDATE OF lifecycle_step ON benefit
  FOR EACH ROW EXECUTE FUNCTION benefit_lifecycle_history();
SELECT p2_attach_guards('benefit', true);
GRANT SELECT, INSERT, UPDATE ON benefit TO mth_app;

CREATE FUNCTION benefit_group_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.counted_benefit_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM benefit b WHERE b.id = NEW.counted_benefit_id AND b.benefit_group_id = NEW.id) THEN
    RAISE EXCEPTION 'benefit_group: the counted benefit must be a member of the group'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_group_counted_member';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER benefit_group_guard BEFORE INSERT OR UPDATE ON benefit_group
  FOR EACH ROW EXECUTE FUNCTION benefit_group_guard();

-- -----------------------------------------------------------------------------------------------------------------
-- benefit_allocation: contribution allocations of one canonical benefit to initiatives (REQ-PB-058, REQ-S08-013).
-- A PUT replaces the whole set: the API steps benefit.allocation_set_no by one (benefit version + audit event) and
-- inserts the new set's rows. Rows are append-only; the set in force is benefit.allocation_set_no. Shares are
-- fractions (0.6 = 60 %); a set above 1 (100 %) is refused under lock 730232 (key: benefit id); below 1 the rest is
-- shown as unallocated. Totals sum the benefit once, never its allocations.
CREATE TABLE benefit_allocation (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  benefit_id        uuid NOT NULL,
  set_no            smallint NOT NULL CHECK (set_no >= 1),
  initiative_id     uuid NOT NULL,
  share             numeric(7,6) NOT NULL CHECK (share > 0 AND share <= 1),
  basis             text NULL CHECK (basis IS NULL OR char_length(basis) BETWEEN 1 AND 1000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_allocation_benefit_fkey FOREIGN KEY (transformation_id, benefit_id) REFERENCES benefit (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_allocation_initiative_fkey FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_allocation_initiative_key UNIQUE (benefit_id, set_no, initiative_id)
);
CREATE FUNCTION benefit_allocation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  benefit_allocation_lock_class CONSTANT integer := 730232;
  cur smallint;
  total numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(benefit_allocation_lock_class, hashtext(NEW.benefit_id::text));
  SELECT b.allocation_set_no INTO cur FROM benefit b WHERE b.id = NEW.benefit_id AND b.status = 'active';
  IF cur IS NULL OR NEW.set_no <> cur THEN
    RAISE EXCEPTION 'benefit_allocation: rows are added only to the active benefit''s current set (%)', cur
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_allocation_current_set';
  END IF;
  SELECT coalesce(sum(a.share), 0) + NEW.share INTO total FROM benefit_allocation a
  WHERE a.benefit_id = NEW.benefit_id AND a.set_no = NEW.set_no;
  IF total > 1 THEN
    RAISE EXCEPTION 'benefit_allocation: the allocations of a benefit total % (above 100 %%)', total
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_allocation_total';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER benefit_allocation_guard BEFORE INSERT ON benefit_allocation
  FOR EACH ROW EXECUTE FUNCTION benefit_allocation_guard();
SELECT p2_attach_append_only('benefit_allocation');
SELECT p2_attach_guards('benefit_allocation', false);
GRANT SELECT, INSERT ON benefit_allocation TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- benefit_scenario: Scenario (REQ-S16-017, REQ-S08-018): base, upside or downside of one transformation. Scenario
-- values live only in benefit_scenario_value and are never read by actual, realized or validated totals.
CREATE TABLE benefit_scenario (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  business_case_id  uuid NULL,
  kind              text NOT NULL CHECK (kind IN ('base', 'upside', 'downside')),
  title             text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  assumptions       text NULL CHECK (assumptions IS NULL OR char_length(assumptions) BETWEEN 1 AND 8000),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at       timestamptz NULL,
  archived_by       uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason    text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_scenario_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT benefit_scenario_case_fkey FOREIGN KEY (transformation_id, business_case_id) REFERENCES business_case (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_scenario_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL) AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
CREATE UNIQUE INDEX benefit_scenario_one_kind_key ON benefit_scenario (transformation_id, kind) WHERE status = 'active';
SELECT p2_attach_guards('benefit_scenario', true);
GRANT SELECT, INSERT, UPDATE ON benefit_scenario TO mth_app;

CREATE TABLE benefit_scenario_value (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  scenario_id       uuid NOT NULL,
  benefit_id        uuid NOT NULL,
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
  CONSTRAINT benefit_scenario_value_scenario_fkey FOREIGN KEY (transformation_id, scenario_id) REFERENCES benefit_scenario (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_scenario_value_benefit_fkey FOREIGN KEY (transformation_id, benefit_id) REFERENCES benefit (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_scenario_value_period_key UNIQUE (scenario_id, benefit_id, period_start),
  CONSTRAINT benefit_scenario_value_period_range CHECK (period_end >= period_start),
  CONSTRAINT benefit_scenario_value_present CHECK (num_nonnulls(amount, kpi_value) >= 1)
);
-- Shared by the scenario, plan and measurement value tables (0037, 0038): the row's currency is the benefit's, a
-- non-financial benefit carries a SAR amount only with an approved valuation method (REQ-S08-010), and a parent
-- benefit (a roll-up container) carries no values of its own (counted once, REQ-PB-058).
CREATE FUNCTION p4_benefit_value_row_valid(p_benefit uuid, p_currency char(3), p_amount numeric, p_table text) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  b record;
BEGIN
  SELECT x.currency, x.value_class, x.valuation_method_id, x.status INTO b FROM benefit x WHERE x.id = p_benefit;
  IF b.currency IS DISTINCT FROM p_currency THEN
    RAISE EXCEPTION '%: the value is in %, but the benefit is in %; values are never converted', p_table, p_currency, b.currency
      USING ERRCODE = 'check_violation', CONSTRAINT = p_table || '_currency';
  END IF;
  IF p_amount IS NOT NULL AND b.value_class = 'non_financial' AND NOT EXISTS (
      SELECT 1 FROM benefit_valuation_method m WHERE m.id = b.valuation_method_id AND m.status = 'approved') THEN
    RAISE EXCEPTION '%: a non-financial benefit has no SAR value without an approved valuation method', p_table
      USING ERRCODE = 'check_violation', CONSTRAINT = p_table || '_unmonetised';
  END IF;
  IF EXISTS (SELECT 1 FROM benefit c WHERE c.parent_benefit_id = p_benefit) THEN
    RAISE EXCEPTION '%: a parent benefit is a roll-up of its children and carries no values of its own', p_table
      USING ERRCODE = 'check_violation', CONSTRAINT = p_table || '_leaf_only';
  END IF;
  IF b.status <> 'active' THEN
    RAISE EXCEPTION '%: the benefit is archived', p_table
      USING ERRCODE = 'check_violation', CONSTRAINT = p_table || '_benefit_active';
  END IF;
END $$;
CREATE FUNCTION benefit_scenario_value_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.scenario_id, NEW.benefit_id) IS DISTINCT FROM (OLD.scenario_id, OLD.benefit_id) THEN
    RAISE EXCEPTION 'benefit_scenario_value: the scenario and benefit of a value are fixed'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_scenario_value_frozen';
  END IF;
  PERFORM p4_benefit_value_row_valid(NEW.benefit_id, NEW.currency, NEW.amount, 'benefit_scenario_value');
  RETURN NEW;
END $$;
CREATE TRIGGER benefit_scenario_value_guard BEFORE INSERT OR UPDATE ON benefit_scenario_value
  FOR EACH ROW EXECUTE FUNCTION benefit_scenario_value_guard();
SELECT p2_attach_guards('benefit_scenario_value', true);
GRANT SELECT, INSERT, UPDATE ON benefit_scenario_value TO mth_app;
