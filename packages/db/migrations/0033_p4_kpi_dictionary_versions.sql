-- 0033 P4 KPI dictionary v2: reporting periods, KPI versions (measure semantics, aggregation rule, data-quality rule,
-- submission route and approval policy), KPI formula inputs with the cycle guard, and versioned RAG thresholds
-- (T-DG4-ARCH-02; ADR-0027 §1-§4, ADR-0028 §1, §5, §7; REQ-S07-001, -002, -007, -010, -011, -012, REQ-S16-014).
-- Authored by solution-architect. Contract: docs/architecture/data-dictionary.md ("P4 tables, slice A"). Runs as
-- mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor:
-- PostgreSQL 16. Ids come from the application (UUIDv7).
-- The DG2 kpi_definition table and its contract are unchanged except for one additive trigger
-- (kpi_definition_measure_lock): once a KPI has a P4 version, its unit, currency, polarity and frequency are fixed
-- (no row created before P4 has a version, so no DG2 behaviour on existing data changes).

-- -----------------------------------------------------------------------------------------------------------------
-- reporting_period: the observation periods actuals are reported for (ADR-0025 §2 "observation period"). One row per
-- organization, frequency and label; periods of one frequency never overlap (guard, under lock 730230). basis 'weeks'
-- marks a week-based period (e.g. a 4-4-5 calendar); two week-based periods with different week counts are not
-- comparable (REQ-S07-005). Status machine: scheduled -> open -> closed (closed is final in P4; a correction of a closed
-- period is a restatement through change control, M0163, slice H).
CREATE TABLE reporting_period (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  frequency       text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'annual', 'ad_hoc')),
  period_label    text NOT NULL CHECK (period_label ~ '^[0-9A-Za-z][0-9A-Za-z_.-]{0,31}$'),
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  length_days     integer GENERATED ALWAYS AS (period_end - period_start + 1) STORED,
  basis           text NOT NULL DEFAULT 'calendar' CHECK (basis IN ('calendar', 'weeks')),
  week_count      smallint NULL CHECK (week_count IS NULL OR week_count BETWEEN 1 AND 53),
  update_due_date date NULL,
  status          text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'open', 'closed')),
  opened_at       timestamptz NULL,
  closed_at       timestamptz NULL,
  version         integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT reporting_period_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT reporting_period_label_key UNIQUE (organization_id, frequency, period_label),
  CONSTRAINT reporting_period_range CHECK (period_end >= period_start AND period_end - period_start <= 366),
  CONSTRAINT reporting_period_weeks CHECK ((basis = 'weeks') = (week_count IS NOT NULL)
                                           AND (week_count IS NULL OR period_end - period_start + 1 = week_count * 7)),
  CONSTRAINT reporting_period_due_after_end CHECK (update_due_date IS NULL OR update_due_date > period_end),
  CONSTRAINT reporting_period_status_stamps CHECK ((status = 'scheduled') = (opened_at IS NULL)
                                                   AND (status = 'closed') = (closed_at IS NOT NULL))
);
CREATE INDEX reporting_period_org_freq_idx ON reporting_period (organization_id, frequency, period_start DESC);

CREATE FUNCTION reporting_period_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  reporting_period_lock_class CONSTANT integer := 730230;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.frequency IS DISTINCT FROM OLD.frequency OR NEW.period_label IS DISTINCT FROM OLD.period_label
       OR NEW.basis IS DISTINCT FROM OLD.basis OR NEW.week_count IS DISTINCT FROM OLD.week_count
       OR (OLD.status <> 'scheduled' AND (NEW.period_start IS DISTINCT FROM OLD.period_start OR NEW.period_end IS DISTINCT FROM OLD.period_end)) THEN
      RAISE EXCEPTION 'reporting_period: frequency, label and basis are fixed, and the dates are fixed once the period opens'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'reporting_period_identity_fixed';
    END IF;
    IF NOT (NEW.status = OLD.status
            OR (OLD.status = 'scheduled' AND NEW.status = 'open')
            OR (OLD.status = 'open' AND NEW.status = 'closed')) THEN
      RAISE EXCEPTION 'reporting_period: % -> % is not an allowed transition', OLD.status, NEW.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'reporting_period_status_step';
    END IF;
    IF OLD.status = 'closed' THEN
      RAISE EXCEPTION 'reporting_period: a closed period is final'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'reporting_period_status_step';
    END IF;
  END IF;
  -- Periods of one organization and frequency never overlap (lock: per organization and frequency).
  PERFORM pg_advisory_xact_lock(reporting_period_lock_class, hashtext(NEW.organization_id::text || ':' || NEW.frequency));
  IF EXISTS (SELECT 1 FROM reporting_period p
             WHERE p.organization_id = NEW.organization_id AND p.frequency = NEW.frequency AND p.id <> NEW.id
               AND p.period_start <= NEW.period_end AND NEW.period_start <= p.period_end) THEN
    RAISE EXCEPTION 'reporting_period: % % overlaps another % period', NEW.frequency, NEW.period_label, NEW.frequency
      USING ERRCODE = 'check_violation', CONSTRAINT = 'reporting_period_no_overlap';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reporting_period_guard BEFORE INSERT OR UPDATE ON reporting_period
  FOR EACH ROW EXECUTE FUNCTION reporting_period_guard();
SELECT p2_attach_guards('reporting_period', true);
GRANT SELECT, INSERT, UPDATE ON reporting_period TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- kpi_version: the versioned P4 measurement definition of a KPI (KPIVersion, REQ-S16-014). Together with the DG2
-- kpi_definition row (name, description, business purpose, owner, steward, unit, frequency, polarity, leading/lagging,
-- source) it holds every REQ-S07-001 field. Status machine (ADR-0027 §2):
--   draft -> active | withdrawn;  active -> superseded;  superseded, withdrawn: final.
-- Content is editable only while draft. At most one draft and one active version per KPI. Activation needs the KPI
-- definition to be active, the version complete (CHECK kpi_version_complete_when_active), no formula cycle (lock
-- 730228) and, under definition_approval = 'business_approval', an approved P4 approval of this version.
CREATE TABLE kpi_version (
  id                           uuid PRIMARY KEY,
  organization_id              uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id            uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kpi_definition_id            uuid NOT NULL,
  version_no                   smallint NOT NULL CHECK (version_no >= 1),
  status                       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'superseded', 'withdrawn')),
  measure_type                 text NOT NULL CHECK (measure_type IN ('higher_is_better', 'lower_is_better', 'acceptable_band', 'binary_milestone')),
  value_nature                 text NOT NULL CHECK (value_nature IN ('flow', 'stock', 'ratio', 'milestone')),
  entry_scope_kind             text NOT NULL DEFAULT 'transformation' CHECK (entry_scope_kind IN ('transformation', 'business_unit', 'initiative')),
  unit_kind                    text NOT NULL CHECK (unit_kind IN ('currency', 'percentage', 'count', 'ratio', 'duration', 'score', 'other')),
  unit_label                   text NULL CHECK (unit_label IS NULL OR char_length(unit_label) BETWEEN 1 AND 50),
  currency                     char(3) NULL CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  frequency                    text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'annual', 'ad_hoc')),
  numerator_label              text NULL CHECK (numerator_label IS NULL OR char_length(numerator_label) BETWEEN 1 AND 200),
  denominator_label            text NULL CHECK (denominator_label IS NULL OR char_length(denominator_label) BETWEEN 1 AND 200),
  calculation_method           text NOT NULL DEFAULT 'entered' CHECK (calculation_method IN ('entered', 'formula')),
  calculation_description      text NULL CHECK (calculation_description IS NULL OR char_length(calculation_description) BETWEEN 1 AND 4000),
  formula_expression           text NULL CHECK (formula_expression IS NULL OR char_length(formula_expression) BETWEEN 1 AND 2000),
  formula_engine_version       text NULL CHECK (formula_engine_version IS NULL OR char_length(formula_engine_version) BETWEEN 1 AND 50),
  aggregation_rule             text NULL CHECK (aggregation_rule IS NULL OR aggregation_rule IN ('sum', 'last_value', 'weighted_ratio', 'custom_formula', 'none')),
  stock_additive_across_scopes boolean NOT NULL DEFAULT false,
  ytd_start_month              smallint NOT NULL DEFAULT 1 CHECK (ytd_start_month BETWEEN 1 AND 12),
  baseline_id                  uuid NULL,
  baseline_value               numeric(24,6) NULL,
  baseline_date                date NULL,
  target_value                 numeric(24,6) NULL,
  target_date                  date NULL,
  band_lower                   numeric(24,6) NULL,
  band_upper                   numeric(24,6) NULL,
  milestone_due_date           date NULL,
  dq_stale_after_days          smallint NOT NULL DEFAULT 45 CHECK (dq_stale_after_days BETWEEN 1 AND 3660),
  dq_valid_min                 numeric(24,6) NULL,
  dq_valid_max                 numeric(24,6) NULL,
  dq_evidence_required         boolean NOT NULL DEFAULT false,
  submission_route             text NOT NULL DEFAULT 'review' CHECK (submission_route IN ('review', 'direct_accept')),
  reviewer_party_code          text NULL REFERENCES governance_party (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  definition_approval          text NOT NULL DEFAULT 'direct' CHECK (definition_approval IN ('direct', 'business_approval')),
  approval_id                  uuid NULL,
  change_reason                text NULL CHECK (change_reason IS NULL OR char_length(change_reason) BETWEEN 3 AND 2000),
  activated_at                 timestamptz NULL,
  activated_by                 uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  superseded_at                timestamptz NULL,
  withdrawn_at                 timestamptz NULL,
  withdrawn_by                 uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  withdraw_reason              text NULL CHECK (withdraw_reason IS NULL OR char_length(withdraw_reason) BETWEEN 3 AND 1000),
  version                      integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                   timestamptz NOT NULL DEFAULT now(),
  created_by                   uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  updated_by                   uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_version_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT kpi_version_no_key UNIQUE (kpi_definition_id, version_no),
  CONSTRAINT kpi_version_kpi_definition_fkey FOREIGN KEY (transformation_id, kpi_definition_id)
    REFERENCES kpi_definition (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_version_baseline_fkey FOREIGN KEY (transformation_id, baseline_id)
    REFERENCES baseline (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_version_approval_fkey FOREIGN KEY (transformation_id, approval_id)
    REFERENCES approval (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_version_currency_unit CHECK ((unit_kind = 'currency') = (currency IS NOT NULL)),
  -- REQ-S07-002: the four measure types and their parameters.
  CONSTRAINT kpi_version_band CHECK (
    (measure_type = 'acceptable_band') = (band_lower IS NOT NULL AND band_upper IS NOT NULL)
    AND (band_lower IS NULL) = (band_upper IS NULL) AND (band_lower IS NULL OR band_lower <= band_upper)),
  CONSTRAINT kpi_version_milestone CHECK ((measure_type = 'binary_milestone') = (value_nature = 'milestone')
                                          AND (milestone_due_date IS NULL OR measure_type = 'binary_milestone')),
  -- REQ-S07-010: explicit aggregation per value nature; no 'average' rule exists, so percentages are never averaged.
  CONSTRAINT kpi_version_aggregation_fits_nature CHECK (aggregation_rule IS NULL OR aggregation_rule = 'custom_formula' OR
    (value_nature = 'flow' AND aggregation_rule = 'sum') OR (value_nature = 'stock' AND aggregation_rule = 'last_value')
    OR (value_nature = 'ratio' AND aggregation_rule = 'weighted_ratio') OR (value_nature = 'milestone' AND aggregation_rule = 'none')),
  CONSTRAINT kpi_version_custom_formula_approved CHECK (aggregation_rule IS DISTINCT FROM 'custom_formula'
    OR (calculation_method = 'formula' AND definition_approval = 'business_approval')),
  CONSTRAINT kpi_version_formula_shape CHECK ((calculation_method = 'formula') = (formula_expression IS NOT NULL)
                                              AND (formula_expression IS NULL) = (formula_engine_version IS NULL)),
  CONSTRAINT kpi_version_ratio_labels CHECK (value_nature = 'ratio' OR (numerator_label IS NULL AND denominator_label IS NULL)),
  CONSTRAINT kpi_version_dq_range CHECK (dq_valid_min IS NULL OR dq_valid_max IS NULL OR dq_valid_min <= dq_valid_max),
  CONSTRAINT kpi_version_route_reviewer CHECK ((submission_route = 'review') = (reviewer_party_code IS NOT NULL)),
  CONSTRAINT kpi_version_change_reason CHECK (version_no = 1 OR change_reason IS NOT NULL),
  CONSTRAINT kpi_version_baseline_one_source CHECK (baseline_id IS NULL OR baseline_value IS NULL),
  -- REQ-S07-001 / D-089 Q1: an active (or superseded) version is complete: aggregation rule, ratio labels, milestone
  -- due date; the unit and polarity are NOT NULL columns.
  CONSTRAINT kpi_version_complete_when_active CHECK (status IN ('draft', 'withdrawn') OR (
    aggregation_rule IS NOT NULL
    AND (value_nature <> 'ratio' OR (numerator_label IS NOT NULL AND denominator_label IS NOT NULL))
    AND (measure_type <> 'binary_milestone' OR milestone_due_date IS NOT NULL)
    AND activated_at IS NOT NULL AND activated_by IS NOT NULL)),
  CONSTRAINT kpi_version_status_stamps CHECK (
    (status = 'superseded') = (superseded_at IS NOT NULL)
    AND (status = 'withdrawn') = (withdrawn_at IS NOT NULL)
    AND (withdrawn_at IS NULL) = (withdrawn_by IS NULL) AND (withdrawn_at IS NULL) = (withdraw_reason IS NULL)
    AND (status IN ('draft', 'withdrawn') OR activated_at IS NOT NULL))
);
CREATE UNIQUE INDEX kpi_version_one_active ON kpi_version (kpi_definition_id) WHERE status = 'active';
CREATE UNIQUE INDEX kpi_version_one_draft ON kpi_version (kpi_definition_id) WHERE status = 'draft';
CREATE INDEX kpi_version_transformation_idx ON kpi_version (transformation_id, updated_at DESC, id DESC);

-- kpi_formula_input: a formula variable bound to another KPI of the same transformation (REQ-S07-011). Inserted only
-- while the version is a draft; never updated or deleted (a changed formula is a new version).
CREATE TABLE kpi_formula_input (
  id                       uuid PRIMARY KEY,
  organization_id          uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id        uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kpi_version_id           uuid NOT NULL,
  variable_name            text NOT NULL CHECK (variable_name ~ '^[a-z][a-z0-9_]{0,47}$'),
  source_kpi_definition_id uuid NOT NULL,
  input_basis              text NOT NULL DEFAULT 'period' CHECK (input_basis IN ('period', 'cumulative')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_formula_input_version_fkey FOREIGN KEY (transformation_id, kpi_version_id)
    REFERENCES kpi_version (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_formula_input_source_fkey FOREIGN KEY (transformation_id, source_kpi_definition_id)
    REFERENCES kpi_definition (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_formula_input_variable_key UNIQUE (kpi_version_id, variable_name)
);
CREATE INDEX kpi_formula_input_source_idx ON kpi_formula_input (source_kpi_definition_id);

-- Does p_from reach p_target through the formula inputs of ACTIVE versions, ignoring p_skip's active version (the one
-- being replaced)? Used under lock 730228 (per transformation).
CREATE FUNCTION p4_kpi_formula_reaches(p_from uuid, p_target uuid, p_skip uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH RECURSIVE walk(def_id) AS (
    SELECT p_from
    UNION
    SELECT i.source_kpi_definition_id
    FROM walk w
    JOIN kpi_version v ON v.kpi_definition_id = w.def_id AND v.status = 'active' AND v.kpi_definition_id <> p_skip
    JOIN kpi_formula_input i ON i.kpi_version_id = v.id
  )
  SELECT EXISTS (SELECT 1 FROM walk WHERE def_id = p_target)
$$;

CREATE FUNCTION kpi_formula_input_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  kpi_formula_graph_lock_class CONSTANT integer := 730228;
  v record;
BEGIN
  SELECT x.status, x.kpi_definition_id, x.calculation_method INTO v FROM kpi_version x
  WHERE x.id = NEW.kpi_version_id AND x.transformation_id = NEW.transformation_id;
  IF NOT FOUND THEN
    RETURN NEW; -- the foreign key reports it
  END IF;
  IF v.status <> 'draft' OR v.calculation_method <> 'formula' THEN
    RAISE EXCEPTION 'kpi_formula_input: inputs are added only to a draft formula version'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_formula_input_draft_only';
  END IF;
  PERFORM pg_advisory_xact_lock(kpi_formula_graph_lock_class, hashtext(NEW.transformation_id::text));
  IF NEW.source_kpi_definition_id = v.kpi_definition_id
     OR p4_kpi_formula_reaches(NEW.source_kpi_definition_id, v.kpi_definition_id, v.kpi_definition_id) THEN
    RAISE EXCEPTION 'kpi_formula_input: % would make a circular reference', NEW.variable_name
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_formula_no_cycle';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kpi_formula_input_guard BEFORE INSERT ON kpi_formula_input
  FOR EACH ROW EXECUTE FUNCTION kpi_formula_input_guard();
SELECT p2_attach_append_only('kpi_formula_input');
SELECT p2_attach_guards('kpi_formula_input', false);
GRANT SELECT, INSERT ON kpi_formula_input TO mth_app;

CREATE FUNCTION kpi_version_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  kpi_formula_graph_lock_class CONSTANT integer := 730228;
  d record;
  i record;
  next_no integer;
BEGIN
  SELECT k.unit_kind, k.currency, k.polarity, k.frequency, k.status INTO d FROM kpi_definition k
  WHERE k.id = NEW.kpi_definition_id AND k.transformation_id = NEW.transformation_id;
  IF NOT FOUND THEN
    RETURN NEW; -- the foreign key reports it
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'kpi_version: a new version starts as a draft'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_version_initial_draft';
    END IF;
    SELECT coalesce(max(x.version_no), 0) + 1 INTO next_no FROM kpi_version x WHERE x.kpi_definition_id = NEW.kpi_definition_id;
    IF NEW.version_no <> next_no THEN
      RAISE EXCEPTION 'kpi_version: the next version number of this KPI is %', next_no
        USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_version_no_step';
    END IF;
  ELSE
    IF NEW.kpi_definition_id IS DISTINCT FROM OLD.kpi_definition_id OR NEW.version_no IS DISTINCT FROM OLD.version_no THEN
      RAISE EXCEPTION 'kpi_version: the KPI and the version number are immutable'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_version_identity_immutable';
    END IF;
    IF NOT (NEW.status = OLD.status
            OR (OLD.status = 'draft' AND NEW.status IN ('active', 'withdrawn'))
            OR (OLD.status = 'active' AND NEW.status = 'superseded')) THEN
      RAISE EXCEPTION 'kpi_version: % -> % is not an allowed transition', OLD.status, NEW.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_version_status_step';
    END IF;
    -- Content is frozen once the version leaves draft (only the status stamps and the row stamps may change).
    IF OLD.status <> 'draft' AND (to_jsonb(NEW) - ARRAY['status', 'superseded_at', 'version', 'updated_at', 'updated_by'])
                                  IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'superseded_at', 'version', 'updated_at', 'updated_by']) THEN
      RAISE EXCEPTION 'kpi_version: an % version is immutable; create a new version', OLD.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_version_frozen';
    END IF;
  END IF;
  -- Unit, currency and frequency are the KPI's; a unit change is a new KPI (REQ-S07-011 "invalid units").
  IF NEW.unit_kind IS DISTINCT FROM d.unit_kind OR NEW.currency IS DISTINCT FROM d.currency OR NEW.frequency IS DISTINCT FROM d.frequency THEN
    RAISE EXCEPTION 'kpi_version: unit %/% and frequency % must equal the KPI definition''s %/% and %',
      NEW.unit_kind, NEW.currency, NEW.frequency, d.unit_kind, d.currency, d.frequency
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_version_matches_definition';
  END IF;
  -- The measure type must fit the DG2 polarity: higher -> higher or binary milestone, lower -> lower, band -> band.
  IF NOT ((d.polarity = 'higher_is_better' AND NEW.measure_type IN ('higher_is_better', 'binary_milestone'))
          OR (d.polarity = 'lower_is_better' AND NEW.measure_type = 'lower_is_better')
          OR (d.polarity = 'within_band' AND NEW.measure_type = 'acceptable_band')) THEN
    RAISE EXCEPTION 'kpi_version: measure type % does not fit the KPI polarity %', NEW.measure_type, d.polarity
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_version_measure_fits_polarity';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status = 'active' THEN
    IF d.status <> 'active' THEN
      RAISE EXCEPTION 'kpi_version: the KPI definition must be active before a version is activated'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_version_definition_active';
    END IF;
    IF NEW.definition_approval = 'business_approval' AND NOT EXISTS (
         SELECT 1 FROM approval a WHERE a.id = NEW.approval_id AND a.approval_type = 'kpi_version_activation'
           AND a.subject_id = NEW.id AND a.status = 'approved') THEN
      RAISE EXCEPTION 'kpi_version: this version needs an approved business approval before activation'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_version_approval_required';
    END IF;
    IF NEW.calculation_method = 'formula' THEN
      PERFORM pg_advisory_xact_lock(kpi_formula_graph_lock_class, hashtext(NEW.transformation_id::text));
      FOR i IN SELECT f.source_kpi_definition_id, f.variable_name FROM kpi_formula_input f WHERE f.kpi_version_id = NEW.id LOOP
        IF i.source_kpi_definition_id = NEW.kpi_definition_id
           OR p4_kpi_formula_reaches(i.source_kpi_definition_id, NEW.kpi_definition_id, NEW.kpi_definition_id) THEN
          RAISE EXCEPTION 'kpi_version: input % makes a circular reference', i.variable_name
            USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_formula_no_cycle';
        END IF;
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kpi_version_guard BEFORE INSERT OR UPDATE ON kpi_version FOR EACH ROW EXECUTE FUNCTION kpi_version_guard();
SELECT p2_attach_guards('kpi_version', true);
GRANT SELECT, INSERT, UPDATE ON kpi_version TO mth_app;

-- kpi_definition_measure_lock: additive trigger on the DG2 table. Once any kpi_version exists for a KPI, its unit,
-- currency, polarity and frequency cannot change (the versions and every stored actual depend on them).
CREATE FUNCTION kpi_definition_measure_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF (NEW.unit_kind IS DISTINCT FROM OLD.unit_kind OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.polarity IS DISTINCT FROM OLD.polarity OR NEW.frequency IS DISTINCT FROM OLD.frequency)
     AND EXISTS (SELECT 1 FROM kpi_version v WHERE v.kpi_definition_id = NEW.id) THEN
    RAISE EXCEPTION 'kpi_definition: unit, currency, polarity and frequency are fixed once the KPI has a version'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_definition_measure_locked';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kpi_definition_measure_lock BEFORE UPDATE ON kpi_definition
  FOR EACH ROW EXECUTE FUNCTION kpi_definition_measure_lock();

-- -----------------------------------------------------------------------------------------------------------------
-- kpi_rag_threshold: versioned RAG thresholds per KPI (REQ-S07-007 "changing the threshold version recomputes RAG").
-- A new row is inserted active; the previous active row becomes superseded in the same transaction. tolerance_mode
-- 'relative': thresholds are fractions of |expected-to-date|; 'absolute': in the KPI's unit. The adverse deviation d
-- (ADR-0028 §5) is Green when d <= amber_threshold, Amber when amber_threshold < d <= red_threshold, Red when
-- d > red_threshold. A KPI without a row uses the documented defaults (relative 0.05 / 0.10), recorded as 'default'.
CREATE TABLE kpi_rag_threshold (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kpi_definition_id uuid NOT NULL,
  version_no        smallint NOT NULL CHECK (version_no >= 1),
  tolerance_mode    text NOT NULL CHECK (tolerance_mode IN ('relative', 'absolute')),
  amber_threshold   numeric(24,6) NOT NULL CHECK (amber_threshold >= 0),
  red_threshold     numeric(24,6) NOT NULL,
  reason            text NOT NULL CHECK (char_length(btrim(reason)) >= 3 AND char_length(reason) <= 2000),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded')),
  superseded_at     timestamptz NULL,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_rag_threshold_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT kpi_rag_threshold_no_key UNIQUE (kpi_definition_id, version_no),
  CONSTRAINT kpi_rag_threshold_kpi_fkey FOREIGN KEY (transformation_id, kpi_definition_id)
    REFERENCES kpi_definition (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_rag_threshold_order CHECK (red_threshold >= amber_threshold),
  CONSTRAINT kpi_rag_threshold_superseded CHECK ((status = 'superseded') = (superseded_at IS NOT NULL))
);
CREATE UNIQUE INDEX kpi_rag_threshold_one_active ON kpi_rag_threshold (kpi_definition_id) WHERE status = 'active';

CREATE FUNCTION kpi_rag_threshold_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  next_no integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT coalesce(max(x.version_no), 0) + 1 INTO next_no FROM kpi_rag_threshold x WHERE x.kpi_definition_id = NEW.kpi_definition_id;
    IF NEW.version_no <> next_no OR NEW.status <> 'active' THEN
      RAISE EXCEPTION 'kpi_rag_threshold: a new threshold version is active and numbered %', next_no
        USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_rag_threshold_no_step';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'active' OR NEW.status <> 'superseded'
     OR (to_jsonb(NEW) - ARRAY['status', 'superseded_at', 'version', 'updated_at', 'updated_by'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'superseded_at', 'version', 'updated_at', 'updated_by']) THEN
    RAISE EXCEPTION 'kpi_rag_threshold: a threshold version is immutable; the only change is active -> superseded'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_rag_threshold_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kpi_rag_threshold_guard BEFORE INSERT OR UPDATE ON kpi_rag_threshold
  FOR EACH ROW EXECUTE FUNCTION kpi_rag_threshold_guard();
SELECT p2_attach_guards('kpi_rag_threshold', true);
GRANT SELECT, INSERT, UPDATE ON kpi_rag_threshold TO mth_app;
