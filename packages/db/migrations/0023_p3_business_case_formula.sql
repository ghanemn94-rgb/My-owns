-- 0023 P3 business case (ten sections, transformation and initiative levels, classified lines) and the T09 benefit
-- formula foundation (versions, typed variables, calculation lineage, the two seeded source examples)
-- (T-DG3-ARCH-01; ADR-0024). Authored by solution-architect.
-- Contract: docs/architecture/data-dictionary.md ("P3" section). Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16. Decimal only (numeric).

-- -----------------------------------------------------------------------------------------------------------------
-- benefit_formula: T09 row (B0087): benefit, baseline driver, change assumption, formula (= current version), ramp,
-- confidence H/M/L.
CREATE TABLE benefit_formula (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id  uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code               text NOT NULL CHECK (code ~ '^BF-[0-9]{2,6}$'),
  benefit_name       text NOT NULL CHECK (char_length(benefit_name) BETWEEN 1 AND 300),
  baseline_driver    text NULL CHECK (baseline_driver IS NULL OR char_length(baseline_driver) BETWEEN 1 AND 1000),
  change_assumption  text NULL CHECK (change_assumption IS NULL OR char_length(change_assumption) BETWEEN 1 AND 1000),
  ramp               text NULL CHECK (ramp IS NULL OR char_length(ramp) BETWEEN 1 AND 100),
  confidence         char(1) NULL CHECK (confidence IS NULL OR confidence IN ('H', 'M', 'L')),
  owner_user_id      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  current_version_no integer NULL CHECK (current_version_no IS NULL OR current_version_no >= 1),
  is_illustrative    boolean NOT NULL DEFAULT false,
  example_code       text NULL CHECK (example_code IS NULL OR example_code IN ('revenue_uplift', 'cost_reduction')),
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at        timestamptz NULL,
  archived_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason     text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version            integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_formula_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT benefit_formula_code_key UNIQUE (transformation_id, code),
  CONSTRAINT benefit_formula_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL) AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
CREATE INDEX benefit_formula_transformation_updated_idx ON benefit_formula (transformation_id, updated_at DESC, id DESC);
SELECT p2_attach_guards('benefit_formula', true);
GRANT SELECT, INSERT, UPDATE ON benefit_formula TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- benefit_formula_version: an immutable restricted-language expression (ADR-0024 §6) with its Finance validation.
CREATE TABLE benefit_formula_version (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  formula_id        uuid NOT NULL,
  version_no        integer NOT NULL CHECK (version_no >= 1),
  expression        text NOT NULL CHECK (char_length(expression) BETWEEN 1 AND 2000),
  expression_sha256 char(64) NOT NULL CHECK (expression_sha256 ~ '^[0-9a-f]{64}$'),
  result_kind       text NOT NULL CHECK (result_kind IN ('fraction', 'fraction_delta', 'percent_change', 'count', 'currency', 'quantity', 'number')),
  result_unit       text NULL CHECK (result_unit IS NULL OR char_length(result_unit) BETWEEN 1 AND 50),
  result_currency   char(3) NULL CHECK (result_currency IS NULL OR result_currency ~ '^[A-Z]{3}$'),
  result_period     text NOT NULL CHECK (result_period IN ('none', 'month', 'quarter', 'year')),
  preview_result    numeric(24,6) NULL,
  engine_version    text NOT NULL CHECK (char_length(engine_version) BETWEEN 1 AND 50),
  change_note       text NULL CHECK (change_note IS NULL OR char_length(change_note) BETWEEN 1 AND 2000),
  validation_status text NOT NULL DEFAULT 'unvalidated' CHECK (validation_status IN ('unvalidated', 'validated', 'rejected')),
  validated_by      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  validated_at      timestamptz NULL,
  validation_note   text NULL CHECK (validation_note IS NULL OR char_length(validation_note) BETWEEN 1 AND 2000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_formula_version_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT benefit_formula_version_no_key UNIQUE (formula_id, version_no),
  CONSTRAINT benefit_formula_version_formula_id_fkey FOREIGN KEY (transformation_id, formula_id) REFERENCES benefit_formula (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_formula_version_currency_kind CHECK ((result_kind = 'currency') = (result_currency IS NOT NULL)),
  CONSTRAINT benefit_formula_version_validation_complete CHECK ((validation_status = 'unvalidated') = (validated_by IS NULL) AND (validated_by IS NULL) = (validated_at IS NULL)),
  CONSTRAINT benefit_formula_version_validator_not_author CHECK (validated_by IS NULL OR validated_by <> created_by)
);
-- Only the validation columns move, and only once out of 'unvalidated' (a version never goes stale: it is immutable).
CREATE FUNCTION benefit_formula_version_freeze() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  movable text[] := ARRAY['validation_status', 'validated_by', 'validated_at', 'validation_note', 'version', 'updated_at', 'updated_by'];
BEGIN
  IF (to_jsonb(NEW) - movable) IS DISTINCT FROM (to_jsonb(OLD) - movable) THEN
    RAISE EXCEPTION 'benefit_formula_version %: a formula version is immutable; create a new version', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_formula_version_immutable';
  END IF;
  IF NEW.validation_status IS DISTINCT FROM OLD.validation_status AND OLD.validation_status <> 'unvalidated' THEN
    RAISE EXCEPTION 'benefit_formula_version %: the Finance validation (%) is final', OLD.id, OLD.validation_status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'benefit_formula_version_validation_final';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER benefit_formula_version_freeze BEFORE UPDATE ON benefit_formula_version
  FOR EACH ROW EXECUTE FUNCTION benefit_formula_version_freeze();
SELECT p2_attach_guards('benefit_formula_version', true);
GRANT SELECT, INSERT, UPDATE ON benefit_formula_version TO mth_app;
ALTER TABLE benefit_formula ADD CONSTRAINT benefit_formula_current_version_fkey
  FOREIGN KEY (id, current_version_no) REFERENCES benefit_formula_version (formula_id, version_no) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- -----------------------------------------------------------------------------------------------------------------
-- benefit_formula_variable: typed variables of one formula version (append-only).
CREATE TABLE benefit_formula_variable (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id  uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  formula_version_id uuid NOT NULL,
  ordinal            smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 30),
  name               text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]{0,47}$'),
  kind               text NOT NULL CHECK (kind IN ('fraction', 'fraction_delta', 'percent_change', 'count', 'currency', 'quantity', 'number')),
  unit               text NULL CHECK (unit IS NULL OR char_length(unit) BETWEEN 1 AND 50),
  currency           char(3) NULL CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  period             text NOT NULL DEFAULT 'none' CHECK (period IN ('none', 'month', 'quarter', 'year')),
  value              numeric(24,6) NULL,
  description        text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 1000),
  source             text NULL CHECK (source IS NULL OR char_length(source) BETWEEN 1 AND 500),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_formula_variable_version_id_fkey FOREIGN KEY (transformation_id, formula_version_id) REFERENCES benefit_formula_version (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_formula_variable_name_key UNIQUE (formula_version_id, name),
  CONSTRAINT benefit_formula_variable_ordinal_key UNIQUE (formula_version_id, ordinal),
  CONSTRAINT benefit_formula_variable_currency_kind CHECK ((kind = 'currency') = (currency IS NOT NULL)),
  CONSTRAINT benefit_formula_variable_reserved_name CHECK (name NOT IN ('to_period', 'min', 'max', 'abs', 'month', 'quarter', 'year'))
);
SELECT p2_attach_append_only('benefit_formula_variable');
SELECT p2_attach_guards('benefit_formula_variable', false);
GRANT SELECT, INSERT ON benefit_formula_variable TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- benefit_calculation: calculation lineage (inputs, formula version, assumptions, period, result), append-only.
CREATE TABLE benefit_calculation (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id  uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  formula_version_id uuid NOT NULL,
  inputs             jsonb NOT NULL CHECK (jsonb_typeof(inputs) = 'object'),
  assumptions        text NULL CHECK (assumptions IS NULL OR char_length(assumptions) BETWEEN 1 AND 4000),
  period_start       date NULL,
  period_end         date NULL,
  outcome            text NOT NULL CHECK (outcome IN ('ok', 'error')),
  result             numeric(24,6) NULL,
  result_kind        text NOT NULL CHECK (result_kind IN ('fraction', 'fraction_delta', 'percent_change', 'count', 'currency', 'quantity', 'number')),
  result_unit        text NULL CHECK (result_unit IS NULL OR char_length(result_unit) BETWEEN 1 AND 50),
  result_currency    char(3) NULL CHECK (result_currency IS NULL OR result_currency ~ '^[A-Z]{3}$'),
  result_period      text NOT NULL CHECK (result_period IN ('none', 'month', 'quarter', 'year')),
  error_code         text NULL CHECK (error_code IS NULL OR error_code ~ '^formula\.[a-z_]{1,48}$'),
  rounded            boolean NOT NULL DEFAULT false,
  engine_version     text NOT NULL CHECK (char_length(engine_version) BETWEEN 1 AND 50),
  computed_at        timestamptz NOT NULL DEFAULT now(),
  computed_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_calculation_version_id_fkey FOREIGN KEY (transformation_id, formula_version_id) REFERENCES benefit_formula_version (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT benefit_calculation_period_range CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start),
  CONSTRAINT benefit_calculation_outcome_shape CHECK ((outcome = 'error') = (error_code IS NOT NULL) AND (outcome = 'ok' OR result IS NULL))
);
CREATE INDEX benefit_calculation_version_idx ON benefit_calculation (formula_version_id, computed_at DESC);
SELECT p2_attach_append_only('benefit_calculation');
SELECT p2_attach_guards('benefit_calculation', false);
GRANT SELECT, INSERT ON benefit_calculation TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- business_case: the transformation-level case (all ten B0085 sections) and the lighter initiative cases linked to it.
CREATE TABLE business_case (
  id                         uuid PRIMARY KEY,
  organization_id            uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id          uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code                       text NOT NULL CHECK (code ~ '^BC-[0-9]{2,6}$'),
  level                      text NOT NULL CHECK (level IN ('transformation', 'initiative')),
  initiative_id              uuid NULL,
  parent_case_id             uuid NULL,
  title                      text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  currency                   char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  strategic_rationale        text NULL CHECK (strategic_rationale IS NULL OR char_length(strategic_rationale) BETWEEN 1 AND 20000),
  baseline_summary           text NULL CHECK (baseline_summary IS NULL OR char_length(baseline_summary) BETWEEN 1 AND 20000),
  value_pools_summary        text NULL CHECK (value_pools_summary IS NULL OR char_length(value_pools_summary) BETWEEN 1 AND 20000),
  interventions_summary      text NULL CHECK (interventions_summary IS NULL OR char_length(interventions_summary) BETWEEN 1 AND 20000),
  investment_summary         text NULL CHECK (investment_summary IS NULL OR char_length(investment_summary) BETWEEN 1 AND 20000),
  benefits_summary           text NULL CHECK (benefits_summary IS NULL OR char_length(benefits_summary) BETWEEN 1 AND 20000),
  benefit_ramp               text NULL CHECK (benefit_ramp IS NULL OR char_length(benefit_ramp) BETWEEN 1 AND 4000),
  recurrence_summary         text NULL CHECK (recurrence_summary IS NULL OR char_length(recurrence_summary) BETWEEN 1 AND 4000),
  implementation_horizon     text NULL CHECK (implementation_horizon IS NULL OR char_length(implementation_horizon) BETWEEN 1 AND 4000),
  key_assumptions            text NULL CHECK (key_assumptions IS NULL OR char_length(key_assumptions) BETWEEN 1 AND 20000),
  downside_case              text NULL CHECK (downside_case IS NULL OR char_length(downside_case) BETWEEN 1 AND 8000),
  upside_case                text NULL CHECK (upside_case IS NULL OR char_length(upside_case) BETWEEN 1 AND 8000),
  benefit_owner_user_id      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  initiative_owner_user_id   uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  finance_validator_user_id  uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decision_ask_types         text[] NOT NULL DEFAULT '{}'::text[] CHECK (decision_ask_types <@ ARRAY['funding', 'policy', 'resource', 'prioritization']::text[]),
  decision_ask_text          text NULL CHECK (decision_ask_text IS NULL OR char_length(decision_ask_text) BETWEEN 1 AND 8000),
  baseline_validation_status text NOT NULL DEFAULT 'unvalidated' CHECK (baseline_validation_status IN ('unvalidated', 'validated', 'rejected')),
  baseline_validated_by      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  baseline_validated_at      timestamptz NULL,
  baseline_validation_note   text NULL CHECK (baseline_validation_note IS NULL OR char_length(baseline_validation_note) BETWEEN 1 AND 2000),
  baseline_validated_sha256  char(64) NULL CHECK (baseline_validated_sha256 IS NULL OR baseline_validated_sha256 ~ '^[0-9a-f]{64}$'),
  status                     text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'archived')),
  archived_at                timestamptz NULL,
  archived_by                uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason             text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version                    integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  updated_by                 uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT business_case_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT business_case_code_key UNIQUE (transformation_id, code),
  CONSTRAINT business_case_initiative_id_fkey FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT business_case_parent_case_id_fkey FOREIGN KEY (transformation_id, parent_case_id) REFERENCES business_case (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT business_case_level_shape CHECK ((level = 'transformation' AND initiative_id IS NULL AND parent_case_id IS NULL) OR (level = 'initiative' AND initiative_id IS NOT NULL AND parent_case_id IS NOT NULL)),
  CONSTRAINT business_case_baseline_validation_complete CHECK ((baseline_validation_status = 'unvalidated') = (baseline_validated_by IS NULL) AND (baseline_validated_by IS NULL) = (baseline_validated_at IS NULL) AND (baseline_validation_status = 'validated') = (baseline_validated_sha256 IS NOT NULL)),
  CONSTRAINT business_case_validator_not_author CHECK (baseline_validated_by IS NULL OR baseline_validated_by <> created_by),
  CONSTRAINT business_case_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL) AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
CREATE UNIQUE INDEX business_case_one_transformation_case_key ON business_case (transformation_id) WHERE level = 'transformation' AND status <> 'archived';
CREATE UNIQUE INDEX business_case_one_initiative_case_key ON business_case (initiative_id) WHERE level = 'initiative' AND status <> 'archived';
CREATE INDEX business_case_parent_idx ON business_case (parent_case_id) WHERE parent_case_id IS NOT NULL;
-- An initiative case links to exactly one TRANSFORMATION-level case of the same transformation (REQ-PB-054).
CREATE FUNCTION business_case_parent_is_transformation() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.parent_case_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM business_case p WHERE p.id = NEW.parent_case_id AND p.level = 'transformation') THEN
    RAISE EXCEPTION 'business_case %: the parent case must be the transformation-level case', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'business_case_parent_is_transformation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER business_case_parent_is_transformation BEFORE INSERT OR UPDATE OF parent_case_id ON business_case
  FOR EACH ROW EXECUTE FUNCTION business_case_parent_is_transformation();
SELECT p2_attach_guards('business_case', true);
GRANT SELECT, INSERT, UPDATE ON business_case TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- business_case_line: an investment or benefit line with EXACTLY one class (REQ-PB-053, REQ-S05-005).
CREATE TABLE business_case_line (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  business_case_id  uuid NOT NULL,
  line_kind         text NOT NULL CHECK (line_kind IN ('investment', 'benefit')),
  investment_class  text NULL CHECK (investment_class IS NULL OR investment_class IN ('capex', 'opex', 'internal_fte', 'vendor_cost', 'opportunity_cost')),
  benefit_class     text NULL CHECK (benefit_class IS NULL OR benefit_class IN ('revenue', 'cost_reduction', 'cost_avoidance', 'working_capital', 'strategic_non_financial')),
  value_basis       text NOT NULL CHECK (value_basis IN ('revenue_uplift', 'margin_uplift', 'cash_saving', 'avoided_cost', 'working_capital_release', 'non_financial', 'cash', 'non_cash')),
  title             text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  description       text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 4000),
  amount            numeric(20,4) NULL CHECK (amount IS NULL OR amount >= 0),
  currency          char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  fte               numeric(6,2) NULL CHECK (fte IS NULL OR fte > 0),
  period_start      date NULL,
  period_end        date NULL,
  recurrence        text NULL CHECK (recurrence IS NULL OR recurrence IN ('one_off', 'recurring')),
  benefit_formula_id uuid NULL,
  owner_user_id     uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at       timestamptz NULL,
  archived_by       uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason    text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT business_case_line_case_id_fkey FOREIGN KEY (transformation_id, business_case_id) REFERENCES business_case (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT business_case_line_formula_id_fkey FOREIGN KEY (transformation_id, benefit_formula_id) REFERENCES benefit_formula (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT business_case_line_one_class CHECK (num_nonnulls(investment_class, benefit_class) = 1 AND (line_kind = 'investment') = (investment_class IS NOT NULL)),
  CONSTRAINT business_case_line_value_basis CHECK (
    (investment_class IN ('capex', 'opex', 'vendor_cost') AND value_basis = 'cash')
    OR (investment_class IN ('internal_fte', 'opportunity_cost') AND value_basis = 'non_cash')
    OR (benefit_class = 'revenue' AND value_basis IN ('revenue_uplift', 'margin_uplift'))
    OR (benefit_class = 'cost_reduction' AND value_basis = 'cash_saving')
    OR (benefit_class = 'cost_avoidance' AND value_basis = 'avoided_cost')
    OR (benefit_class = 'working_capital' AND value_basis = 'working_capital_release')
    OR (benefit_class = 'strategic_non_financial' AND value_basis = 'non_financial')),
  CONSTRAINT business_case_line_non_financial_unmonetised CHECK (benefit_class IS DISTINCT FROM 'strategic_non_financial' OR amount IS NULL),
  CONSTRAINT business_case_line_fte_only_internal CHECK (fte IS NULL OR investment_class = 'internal_fte'),
  CONSTRAINT business_case_line_formula_only_benefit CHECK (benefit_formula_id IS NULL OR line_kind = 'benefit'),
  CONSTRAINT business_case_line_period_range CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start),
  CONSTRAINT business_case_line_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL) AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
-- One T09 benefit backs at most one active line in the whole transformation: never counted twice.
CREATE UNIQUE INDEX business_case_line_one_formula_key ON business_case_line (benefit_formula_id) WHERE status = 'active' AND benefit_formula_id IS NOT NULL;
CREATE INDEX business_case_line_case_idx ON business_case_line (business_case_id) WHERE status = 'active';
SELECT p2_attach_guards('business_case_line', true);
GRANT SELECT, INSERT, UPDATE ON business_case_line TO mth_app;

ALTER TABLE funding_decision ADD CONSTRAINT funding_decision_business_case_id_fkey
  FOREIGN KEY (transformation_id, business_case_id) REFERENCES business_case (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- -----------------------------------------------------------------------------------------------------------------
-- benefit_formula_example: the two B0087 source examples, ILLUSTRATIVE calculations with synthetic values (REQ-PB-057).
CREATE TABLE benefit_formula_example (
  id                          uuid PRIMARY KEY,
  code                        text NOT NULL CONSTRAINT benefit_formula_example_code_key UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{0,47}$'),
  methodology_version_id      uuid NOT NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ordinal                     smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 99),
  source_benefit_en           text NOT NULL CHECK (char_length(source_benefit_en) BETWEEN 1 AND 200),
  source_baseline_driver_en   text NOT NULL CHECK (char_length(source_baseline_driver_en) BETWEEN 1 AND 300),
  source_change_assumption_en text NOT NULL CHECK (char_length(source_change_assumption_en) BETWEEN 1 AND 300),
  source_formula_en           text NOT NULL CHECK (char_length(source_formula_en) BETWEEN 1 AND 300),
  source_ramp_en              text NOT NULL CHECK (char_length(source_ramp_en) BETWEEN 1 AND 50),
  source_confidence           char(1) NOT NULL CHECK (source_confidence IN ('H', 'M', 'L')),
  benefit_ar                  text NOT NULL CHECK (char_length(benefit_ar) BETWEEN 1 AND 200),
  baseline_driver_ar          text NOT NULL CHECK (char_length(baseline_driver_ar) BETWEEN 1 AND 300),
  change_assumption_ar        text NOT NULL CHECK (char_length(change_assumption_ar) BETWEEN 1 AND 300),
  formula_ar                  text NOT NULL CHECK (char_length(formula_ar) BETWEEN 1 AND 300),
  expression                  text NOT NULL CHECK (char_length(expression) BETWEEN 1 AND 2000),
  result_kind                 text NOT NULL CHECK (result_kind IN ('currency', 'count', 'quantity', 'number')),
  result_currency             char(3) NULL CHECK (result_currency IS NULL OR result_currency ~ '^[A-Z]{3}$'),
  result_period               text NOT NULL CHECK (result_period IN ('none', 'month', 'quarter', 'year')),
  example_result              numeric(24,6) NOT NULL,
  is_illustrative             boolean NOT NULL DEFAULT true CHECK (is_illustrative),
  source_ref                  text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 50),
  version                     integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
GRANT SELECT ON benefit_formula_example TO mth_app;

CREATE TABLE benefit_formula_example_variable (
  id            uuid PRIMARY KEY,
  example_id    uuid NOT NULL REFERENCES benefit_formula_example (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ordinal       smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 30),
  name          text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]{0,47}$'),
  kind          text NOT NULL CHECK (kind IN ('fraction', 'fraction_delta', 'percent_change', 'count', 'currency', 'quantity', 'number')),
  unit          text NULL CHECK (unit IS NULL OR char_length(unit) BETWEEN 1 AND 50),
  currency      char(3) NULL CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  period        text NOT NULL CHECK (period IN ('none', 'month', 'quarter', 'year')),
  example_value numeric(24,6) NOT NULL,
  label_en      text NOT NULL CHECK (char_length(label_en) BETWEEN 1 AND 200),
  label_ar      text NOT NULL CHECK (char_length(label_ar) BETWEEN 1 AND 200),
  CONSTRAINT benefit_formula_example_variable_name_key UNIQUE (example_id, name),
  CONSTRAINT benefit_formula_example_variable_currency_kind CHECK ((kind = 'currency') = (currency IS NOT NULL))
);
GRANT SELECT ON benefit_formula_example_variable TO mth_app;

-- Seed: B0087 text VERBATIM (source_* columns); Arabic is a PROVISIONAL translation needing linguistic review. Values
-- are SYNTHETIC and illustrative only. Revenue: (0.12 - 0.10) x 100000 x 50 SAR = 100000 SAR per year (REQ-PB-057,
-- REQ-S08-007). Cost: 200000 x (12.50 - 10.00) SAR = 500000 SAR per year.
INSERT INTO benefit_formula_example (id, code, methodology_version_id, ordinal, source_benefit_en, source_baseline_driver_en,
                                     source_change_assumption_en, source_formula_en, source_ramp_en, source_confidence,
                                     benefit_ar, baseline_driver_ar, change_assumption_ar, formula_ar, expression,
                                     result_kind, result_currency, result_period, example_result, source_ref) VALUES
  ('01920003-0002-7000-8000-000000000001', 'revenue_uplift', '01920002-0000-7000-8000-000000000001', 1,
   'Revenue uplift', 'Customers × attach rate × ARPU', 'Attach +X pp', 'Δ attach × customers × ARPU', 'Q1-Q4', 'M',
   'زيادة الإيرادات', 'العملاء × معدل الارتباط × متوسط الإيراد لكل مستخدم', 'الارتباط +X نقطة مئوية',
   'Δ الارتباط × العملاء × متوسط الإيراد لكل مستخدم',
   '(target_attach_rate - baseline_attach_rate) * eligible_customers * arpu', 'currency', 'SAR', 'year', 100000, 'B0087'),
  ('01920003-0002-7000-8000-000000000002', 'cost_reduction', '01920002-0000-7000-8000-000000000001', 2,
   'Cost reduction', 'Volume × unit cost', 'Unit cost -X%', 'Volume × Δ unit cost', 'Q2-Q3', 'H',
   'خفض التكاليف', 'الحجم × تكلفة الوحدة', 'تكلفة الوحدة -X%', 'الحجم × Δ تكلفة الوحدة',
   'eligible_volume * (baseline_unit_cost - target_unit_cost)', 'currency', 'SAR', 'year', 500000, 'B0087');

INSERT INTO benefit_formula_example_variable (id, example_id, ordinal, name, kind, unit, currency, period, example_value,
                                              label_en, label_ar) VALUES
  ('01920003-0003-7000-8000-000000000001', '01920003-0002-7000-8000-000000000001', 1, 'baseline_attach_rate', 'fraction', NULL, NULL, 'none', 0.10, 'Baseline attach rate', 'معدل الارتباط الأساسي'),
  ('01920003-0003-7000-8000-000000000002', '01920003-0002-7000-8000-000000000001', 2, 'target_attach_rate', 'fraction', NULL, NULL, 'none', 0.12, 'Target attach rate', 'معدل الارتباط المستهدف'),
  ('01920003-0003-7000-8000-000000000003', '01920003-0002-7000-8000-000000000001', 3, 'eligible_customers', 'count', 'customers', NULL, 'year', 100000, 'Eligible customers', 'العملاء المؤهلون'),
  ('01920003-0003-7000-8000-000000000004', '01920003-0002-7000-8000-000000000001', 4, 'arpu', 'currency', 'per customer', 'SAR', 'year', 50, 'ARPU', 'متوسط الإيراد لكل مستخدم'),
  ('01920003-0003-7000-8000-000000000005', '01920003-0002-7000-8000-000000000002', 1, 'eligible_volume', 'count', 'transactions', NULL, 'year', 200000, 'Eligible volume', 'الحجم المؤهل'),
  ('01920003-0003-7000-8000-000000000006', '01920003-0002-7000-8000-000000000002', 2, 'baseline_unit_cost', 'currency', 'per transaction', 'SAR', 'none', 12.50, 'Baseline unit cost', 'تكلفة الوحدة الأساسية'),
  ('01920003-0003-7000-8000-000000000007', '01920003-0002-7000-8000-000000000002', 3, 'target_unit_cost', 'currency', 'per transaction', 'SAR', 'none', 10.00, 'Target unit cost', 'تكلفة الوحدة المستهدفة');
