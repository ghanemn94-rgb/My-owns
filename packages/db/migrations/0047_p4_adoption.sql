-- 0047 P4 slice F: people, adoption and change. The seven leading adoption indicators seeded verbatim (B0108-B0115)
-- as KPI templates, the T13 Stakeholder & Adoption Plan as a native register (stakeholder groups), champions, adoption
-- interventions (person-planned, or exactly one per indicator, scope and period when an actual is below trajectory),
-- adoption metric links, versioned feedback/assessment forms (validated form JSON), invitations, training records
-- (completion) and assessment records (feedback and observed proficiency), impacted-team involvement in design and
-- champion constraints linked to T04 design decisions
-- (T-DG4-ARCH-06; ADR-0033; REQ-PB-069, REQ-PB-070, REQ-PB-071, REQ-PB-072, REQ-PB-073, REQ-S11-001, REQ-S11-002,
-- REQ-S16-020). Authored by solution-architect. Contract: docs/architecture/data-dictionary.md ("P4 tables, slice F").
-- Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged.
-- SQL floor: PostgreSQL 16. Nothing here approves anything, and nothing touches DG0-DG7.

-- Human-readable codes: SG-01 (stakeholder groups) and AI-01 (adoption interventions). Widening the closed prefix set
-- is the 0020/0037/0041 precedent (every existing prefix stays).
ALTER TABLE record_code_counter DROP CONSTRAINT record_code_counter_prefix_check;
ALTER TABLE record_code_counter ADD CONSTRAINT record_code_counter_prefix_check
  CHECK (prefix IN ('D', 'DEC', 'GD', 'DEP', 'INI', 'BC', 'BF', 'B', 'BG', 'VM', 'R', 'A', 'I', 'CA', 'SG', 'AI'));

-- True when no element of the array repeats (a CHECK cannot hold a subquery, so this is an IMMUTABLE helper).
CREATE FUNCTION p4_text_array_distinct(p_values text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT cardinality(p_values) = (SELECT count(DISTINCT v) FROM unnest(p_values) v)
$$;

-- -----------------------------------------------------------------------------------------------------------------
-- adoption_indicator_template: the seven leading adoption indicators of B0108-B0115, verbatim, as KPI templates
-- (REQ-PB-071). Read-only. One row per MEASURE: the fourth indicator, "Training completion + observed proficiency"
-- (B0112), has two measures, because completion and observed proficiency are recorded separately (REQ-PB-072, M0216
-- "Distinguish training attendance from successful adoption"). The indicator name is the verbatim source text; the
-- measure names, unit, polarity, value nature and value source are the platform's reading (ADR-0033 §2). Arabic is
-- PROVISIONAL (ar_provisional = true) until a Mobily reviewer confirms it.
CREATE TABLE adoption_indicator_template (
  key                   text PRIMARY KEY CHECK (key ~ '^[a-z_]+$'),
  indicator_key         text NOT NULL CHECK (indicator_key ~ '^[a-z_]+$'),
  indicator_ordinal     smallint NOT NULL CHECK (indicator_ordinal BETWEEN 1 AND 7),
  measure_ordinal       smallint NOT NULL CHECK (measure_ordinal BETWEEN 1 AND 2),
  source_indicator_en   text NOT NULL CHECK (char_length(source_indicator_en) BETWEEN 1 AND 200),
  indicator_ar          text NOT NULL CHECK (char_length(indicator_ar) BETWEEN 1 AND 200),
  measure_en            text NOT NULL CHECK (char_length(measure_en) BETWEEN 1 AND 200),
  measure_ar            text NOT NULL CHECK (char_length(measure_ar) BETWEEN 1 AND 200),
  ar_provisional        boolean NOT NULL DEFAULT true,
  unit_kind             text NOT NULL CHECK (unit_kind IN ('percentage', 'duration')),
  polarity              text NOT NULL CHECK (polarity IN ('higher_is_better', 'lower_is_better')),
  value_nature          text NOT NULL CHECK (value_nature IN ('ratio', 'stock')),
  aggregation_rule      text NOT NULL CHECK (aggregation_rule IN ('weighted_ratio', 'last_value')),
  value_source          text NOT NULL CHECK (value_source IN ('kpi_actuals', 'training_records', 'assessment_records')),
  source_ref            text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 50),
  CONSTRAINT adoption_indicator_template_measure_key UNIQUE (indicator_ordinal, measure_ordinal),
  CONSTRAINT adoption_indicator_template_nature_rule CHECK ((value_nature = 'ratio') = (aggregation_rule = 'weighted_ratio'))
);
GRANT SELECT ON adoption_indicator_template TO mth_app;
INSERT INTO adoption_indicator_template (key, indicator_key, indicator_ordinal, measure_ordinal, source_indicator_en, indicator_ar, measure_en, measure_ar, unit_kind, polarity, value_nature, aggregation_rule, value_source, source_ref) VALUES
  ('usage_activation_rate', 'usage_activation', 1, 1, 'Usage / activation rate', 'معدل الاستخدام / التفعيل', 'Usage / activation rate', 'معدل الاستخدام / التفعيل', 'percentage', 'higher_is_better', 'ratio', 'weighted_ratio', 'kpi_actuals', 'B0109;M0216'),
  ('process_compliance_rate', 'process_compliance', 2, 1, 'Compliance with new process', 'الامتثال للعملية الجديدة', 'Compliance with new process', 'الامتثال للعملية الجديدة', 'percentage', 'higher_is_better', 'ratio', 'weighted_ratio', 'kpi_actuals', 'B0110;M0216'),
  ('cycle_time_shift', 'cycle_time_shift', 3, 1, 'Cycle-time shift', 'التحول في زمن الدورة', 'Cycle-time shift', 'التحول في زمن الدورة', 'duration', 'lower_is_better', 'stock', 'last_value', 'kpi_actuals', 'B0111;M0216'),
  ('training_completion', 'training_proficiency', 4, 1, 'Training completion + observed proficiency', 'إتمام التدريب + الكفاءة المُلاحَظة', 'Training completion', 'إتمام التدريب', 'percentage', 'higher_is_better', 'ratio', 'weighted_ratio', 'training_records', 'B0112;M0216'),
  ('observed_proficiency', 'training_proficiency', 4, 2, 'Training completion + observed proficiency', 'إتمام التدريب + الكفاءة المُلاحَظة', 'Observed proficiency', 'الكفاءة المُلاحَظة', 'percentage', 'higher_is_better', 'ratio', 'weighted_ratio', 'assessment_records', 'B0112;M0216;M0159'),
  ('decision_turnaround_time', 'decision_turnaround', 5, 1, 'Decision turnaround time', 'زمن إنجاز القرار', 'Decision turnaround time', 'زمن إنجاز القرار', 'duration', 'lower_is_better', 'stock', 'last_value', 'kpi_actuals', 'B0113;M0216'),
  ('new_journey_share', 'new_journey_share', 6, 1, 'Percentage of transactions handled through the new journey', 'نسبة المعاملات المنجزة عبر الرحلة الجديدة', 'Percentage of transactions handled through the new journey', 'نسبة المعاملات المنجزة عبر الرحلة الجديدة', 'percentage', 'higher_is_better', 'ratio', 'weighted_ratio', 'kpi_actuals', 'B0114;M0216'),
  ('exception_workaround_rate', 'exception_workaround', 7, 1, 'Exception / workaround rate', 'معدل الاستثناءات / الحلول الالتفافية', 'Exception / workaround rate', 'معدل الاستثناءات / الحلول الالتفافية', 'percentage', 'lower_is_better', 'ratio', 'weighted_ratio', 'kpi_actuals', 'B0115;M0216');

-- -----------------------------------------------------------------------------------------------------------------
-- stakeholder_group: one row of T13 (B0107; REQ-PB-070) extended by M0215 (REQ-S11-001): influence and impact are two
-- separate H/M/L columns; stance, the intervention types and the impact value lists are closed (a stance of 'Hostile'
-- is refused by the CHECK). The T13 "Adoption KPI" column is adoption_kpi_definition_id (a KPI of the same
-- transformation); further indicator attachments are adoption_metric_link rows.
CREATE TABLE stakeholder_group (
  id                         uuid PRIMARY KEY,
  organization_id            uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id          uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code                       text NOT NULL CHECK (code ~ '^SG-[0-9]{2,6}$'),
  name                       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description                text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 4000),
  influence                  text NULL CHECK (influence IS NULL OR influence IN ('H', 'M', 'L')),
  impact                     text NOT NULL CHECK (impact IN ('H', 'M', 'L')),
  current_stance             text NOT NULL CHECK (current_stance IN ('support', 'neutral', 'resist')),
  required_behavior          text NOT NULL CHECK (char_length(required_behavior) BETWEEN 1 AND 2000),
  intervention_types         text[] NOT NULL CONSTRAINT stakeholder_group_intervention_types_valid
                             CHECK (cardinality(intervention_types) BETWEEN 1 AND 4
                                    AND intervention_types <@ ARRAY['comms', 'training', 'involvement', 'incentive']::text[]),
  intervention_plan          text NULL CHECK (intervention_plan IS NULL OR char_length(intervention_plan) BETWEEN 1 AND 8000),
  owner_user_id              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  adoption_kpi_definition_id uuid NULL,
  headcount                  integer NULL CHECK (headcount IS NULL OR headcount BETWEEN 1 AND 10000000),
  status                     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at                timestamptz NULL,
  archived_by                uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason             text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version                    integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  updated_by                 uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT stakeholder_group_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT stakeholder_group_code_key UNIQUE (transformation_id, code),
  CONSTRAINT stakeholder_group_kpi_fkey FOREIGN KEY (transformation_id, adoption_kpi_definition_id) REFERENCES kpi_definition (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT stakeholder_group_intervention_types_distinct CHECK (p4_text_array_distinct(intervention_types)),
  CONSTRAINT stakeholder_group_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL) AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
CREATE UNIQUE INDEX stakeholder_group_name_key ON stakeholder_group (transformation_id, lower(name)) WHERE status = 'active';
CREATE INDEX stakeholder_group_transformation_idx ON stakeholder_group (transformation_id, code);
CREATE FUNCTION stakeholder_group_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'active' THEN
    RAISE EXCEPTION 'stakeholder_group: a new group is active'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'stakeholder_group_starts_active';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'archived' THEN
    RAISE EXCEPTION 'stakeholder_group %: an archived group is read-only', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'stakeholder_group_archived_final';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'stakeholder_group %: the code is immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'stakeholder_group_code_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stakeholder_group_guard BEFORE INSERT OR UPDATE ON stakeholder_group FOR EACH ROW EXECUTE FUNCTION stakeholder_group_guard();
SELECT p2_attach_guards('stakeholder_group', true);
GRANT SELECT, INSERT, UPDATE ON stakeholder_group TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- stakeholder_champion: a named champion of a stakeholder group (M0215 "champions"; B0116). Removal is a status
-- change, never a DELETE. Only an active champion raises constraints (champion_constraint below).
CREATE TABLE stakeholder_champion (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id    uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  stakeholder_group_id uuid NOT NULL,
  user_id              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  note                 text NULL CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 1000),
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  removed_at           timestamptz NULL,
  removed_by           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT stakeholder_champion_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT stakeholder_champion_group_fkey FOREIGN KEY (transformation_id, stakeholder_group_id) REFERENCES stakeholder_group (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT stakeholder_champion_removed_complete CHECK ((status = 'removed') = (removed_at IS NOT NULL) AND (removed_at IS NULL) = (removed_by IS NULL))
);
CREATE UNIQUE INDEX stakeholder_champion_active_key ON stakeholder_champion (stakeholder_group_id, user_id) WHERE status = 'active';
CREATE FUNCTION stakeholder_champion_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'active' THEN
    RAISE EXCEPTION 'stakeholder_champion: a new champion is active'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'stakeholder_champion_starts_active';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'removed' THEN
      RAISE EXCEPTION 'stakeholder_champion %: a removed champion is final', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'stakeholder_champion_removed_final';
    END IF;
    IF NEW.stakeholder_group_id IS DISTINCT FROM OLD.stakeholder_group_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'stakeholder_champion %: group and user are immutable', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'stakeholder_champion_identity';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_user u WHERE u.id = NEW.user_id AND u.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'stakeholder_champion: the champion belongs to another organization'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'stakeholder_champion_same_org';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stakeholder_champion_guard BEFORE INSERT OR UPDATE ON stakeholder_champion FOR EACH ROW EXECUTE FUNCTION stakeholder_champion_guard();
SELECT p2_attach_guards('stakeholder_champion', true);
GRANT SELECT, INSERT, UPDATE ON stakeholder_champion TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- adoption_metric_link (REQ-S16-020 "AdoptionMetricLink"; REQ-PB-071 "attachable to adoption outcomes"): attaches one
-- indicator measure to its target (an outcome, an initiative, a stakeholder group, or the transformation itself). A
-- measure fed by KPI actuals names its KPI; the two record-fed measures (training completion, observed proficiency)
-- are computed from training_record / assessment_record and name no KPI.
CREATE TABLE adoption_metric_link (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id    uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  template_key         text NOT NULL REFERENCES adoption_indicator_template (key) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kpi_definition_id    uuid NULL,
  target_kind          text NOT NULL CHECK (target_kind IN ('transformation', 'outcome', 'initiative', 'stakeholder_group')),
  outcome_id           uuid NULL,
  initiative_id        uuid NULL,
  stakeholder_group_id uuid NULL,
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  removed_at           timestamptz NULL,
  removed_by           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT adoption_metric_link_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT adoption_metric_link_kpi_fkey FOREIGN KEY (transformation_id, kpi_definition_id) REFERENCES kpi_definition (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT adoption_metric_link_outcome_fkey FOREIGN KEY (transformation_id, outcome_id) REFERENCES outcome (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT adoption_metric_link_initiative_fkey FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT adoption_metric_link_group_fkey FOREIGN KEY (transformation_id, stakeholder_group_id) REFERENCES stakeholder_group (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- Exactly the target named by target_kind.
  CONSTRAINT adoption_metric_link_target CHECK (
    (target_kind = 'outcome') = (outcome_id IS NOT NULL)
    AND (target_kind = 'initiative') = (initiative_id IS NOT NULL)
    AND (target_kind = 'stakeholder_group') = (stakeholder_group_id IS NOT NULL)),
  CONSTRAINT adoption_metric_link_removed_complete CHECK ((status = 'removed') = (removed_at IS NOT NULL) AND (removed_at IS NULL) = (removed_by IS NULL))
);
CREATE UNIQUE INDEX adoption_metric_link_active_key ON adoption_metric_link (
  transformation_id, template_key, target_kind,
  coalesce(outcome_id, initiative_id, stakeholder_group_id, transformation_id)) WHERE status = 'active';
CREATE INDEX adoption_metric_link_kpi_idx ON adoption_metric_link (kpi_definition_id) WHERE kpi_definition_id IS NOT NULL;
CREATE FUNCTION adoption_metric_link_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  src text;
BEGIN
  SELECT t.value_source INTO src FROM adoption_indicator_template t WHERE t.key = NEW.template_key;
  IF (src = 'kpi_actuals') <> (NEW.kpi_definition_id IS NOT NULL) THEN
    RAISE EXCEPTION 'adoption_metric_link: a KPI-fed measure names its KPI; a record-fed measure (%) names none', NEW.template_key
      USING ERRCODE = 'check_violation', CONSTRAINT = 'adoption_metric_link_kpi_matches_source';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'active' THEN
    RAISE EXCEPTION 'adoption_metric_link: a new link is active'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'adoption_metric_link_starts_active';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'removed' THEN
      RAISE EXCEPTION 'adoption_metric_link %: a removed link is final', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'adoption_metric_link_removed_final';
    END IF;
    IF NEW.template_key IS DISTINCT FROM OLD.template_key OR NEW.kpi_definition_id IS DISTINCT FROM OLD.kpi_definition_id
       OR NEW.target_kind IS DISTINCT FROM OLD.target_kind OR NEW.outcome_id IS DISTINCT FROM OLD.outcome_id
       OR NEW.initiative_id IS DISTINCT FROM OLD.initiative_id OR NEW.stakeholder_group_id IS DISTINCT FROM OLD.stakeholder_group_id THEN
      RAISE EXCEPTION 'adoption_metric_link %: measure, KPI and target are immutable', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'adoption_metric_link_identity';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER adoption_metric_link_guard BEFORE INSERT OR UPDATE ON adoption_metric_link FOR EACH ROW EXECUTE FUNCTION adoption_metric_link_guard();
SELECT p2_attach_guards('adoption_metric_link', true);
GRANT SELECT, INSERT, UPDATE ON adoption_metric_link TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- adoption_intervention (REQ-S16-020 "AdoptionIntervention"; M0215 "intervention plans ... communication/training
-- actions"; REQ-PB-069). Two origins:
--   manual          a person plans it (created_source 'api', created_by NOT NULL);
--   below_trajectory the worker creates it when an adoption KPI's evaluation for a scope and reporting period is below
--                    trajectory (created_source 'worker', created_by NULL). trigger_key = '<linkId>:<scopeKind>:
--                    <scopeId>:<reportingPeriodId>' is UNIQUE: exactly one intervention per indicator, scope and period.
-- Status: planned -> in_progress -> done; planned | in_progress -> cancelled; done and cancelled are final.
CREATE TABLE adoption_intervention (
  id                    uuid PRIMARY KEY,
  organization_id       uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id     uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code                  text NOT NULL CHECK (code ~ '^AI-[0-9]{2,6}$'),
  stakeholder_group_id  uuid NULL,
  intervention_type     text NOT NULL CHECK (intervention_type IN ('comms', 'training', 'involvement', 'incentive', 'corrective')),
  title                 text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  description           text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 8000),
  owner_user_id         uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  due_date              date NULL,
  status                text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'done', 'cancelled')),
  origin                text NOT NULL CHECK (origin IN ('manual', 'below_trajectory')),
  metric_link_id        uuid NULL,
  kpi_evaluation_id     uuid NULL REFERENCES kpi_evaluation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  reporting_period_id   uuid NULL REFERENCES reporting_period (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  scope_kind            text NULL CHECK (scope_kind IS NULL OR scope_kind IN ('transformation', 'business_unit', 'initiative')),
  scope_id              uuid NULL,
  trigger_key           text NULL CHECK (trigger_key IS NULL OR char_length(trigger_key) BETWEEN 1 AND 200),
  outcome_note          text NULL CHECK (outcome_note IS NULL OR char_length(outcome_note) BETWEEN 3 AND 2000),
  completed_at          timestamptz NULL,
  completed_by          uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_source        text NOT NULL CHECK (created_source IN ('api', 'worker')),
  version               integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT adoption_intervention_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT adoption_intervention_code_key UNIQUE (transformation_id, code),
  CONSTRAINT adoption_intervention_group_fkey FOREIGN KEY (transformation_id, stakeholder_group_id) REFERENCES stakeholder_group (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT adoption_intervention_link_fkey FOREIGN KEY (transformation_id, metric_link_id) REFERENCES adoption_metric_link (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- A manual intervention is a person's plan with an owner and a due date (REQ-S11-001 "an intervention with owner and
  -- due date appears in My Work"); a below-trajectory one is the worker's and names its trigger completely.
  CONSTRAINT adoption_intervention_origin_shape CHECK (
    (origin = 'manual') = (created_source = 'api')
    AND (origin <> 'manual' OR (created_by IS NOT NULL AND updated_by IS NOT NULL AND owner_user_id IS NOT NULL AND due_date IS NOT NULL
                                AND intervention_type <> 'corrective'))
    AND (origin <> 'below_trajectory' OR (created_by IS NULL AND intervention_type = 'corrective' AND metric_link_id IS NOT NULL
                                          AND kpi_evaluation_id IS NOT NULL AND reporting_period_id IS NOT NULL
                                          AND scope_kind IS NOT NULL AND scope_id IS NOT NULL AND trigger_key IS NOT NULL))
    AND (origin = 'below_trajectory' OR (metric_link_id IS NULL AND kpi_evaluation_id IS NULL AND reporting_period_id IS NULL
                                         AND scope_kind IS NULL AND scope_id IS NULL AND trigger_key IS NULL))),
  CONSTRAINT adoption_intervention_done_complete CHECK ((status = 'done') = (completed_at IS NOT NULL)
                                                       AND (completed_at IS NULL) = (completed_by IS NULL)
                                                       AND (status NOT IN ('done', 'cancelled') OR outcome_note IS NOT NULL))
);
-- REQ-PB-069 "an adoption actual below trajectory creates exactly one intervention".
CREATE UNIQUE INDEX adoption_intervention_trigger_key ON adoption_intervention (transformation_id, trigger_key) WHERE trigger_key IS NOT NULL;
CREATE INDEX adoption_intervention_owner_idx ON adoption_intervention (owner_user_id, due_date) WHERE status IN ('planned', 'in_progress');
CREATE INDEX adoption_intervention_group_idx ON adoption_intervention (stakeholder_group_id) WHERE stakeholder_group_id IS NOT NULL;
CREATE FUNCTION adoption_intervention_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'planned' THEN
      RAISE EXCEPTION 'adoption_intervention: a new intervention is planned'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'adoption_intervention_starts_planned';
    END IF;
    IF NEW.kpi_evaluation_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM kpi_evaluation e JOIN adoption_metric_link l ON l.id = NEW.metric_link_id
        WHERE e.id = NEW.kpi_evaluation_id AND e.transformation_id = NEW.transformation_id
          AND e.kpi_definition_id = l.kpi_definition_id AND e.reporting_period_id = NEW.reporting_period_id
          AND e.scope_kind = NEW.scope_kind AND e.scope_id = NEW.scope_id) THEN
      RAISE EXCEPTION 'adoption_intervention: the evaluation must be of the link''s KPI for the same scope and period'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'adoption_intervention_evaluation_matches';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('done', 'cancelled') THEN
    RAISE EXCEPTION 'adoption_intervention %: a % intervention is final', OLD.id, OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'adoption_intervention_final';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY[
      'planned>in_progress', 'planned>done', 'planned>cancelled', 'in_progress>done', 'in_progress>cancelled']) THEN
    RAISE EXCEPTION 'adoption_intervention %: % -> % is not a legal transition', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'adoption_intervention_transition';
  END IF;
  IF NEW.origin IS DISTINCT FROM OLD.origin OR NEW.created_source IS DISTINCT FROM OLD.created_source
     OR NEW.metric_link_id IS DISTINCT FROM OLD.metric_link_id OR NEW.kpi_evaluation_id IS DISTINCT FROM OLD.kpi_evaluation_id
     OR NEW.reporting_period_id IS DISTINCT FROM OLD.reporting_period_id OR NEW.scope_kind IS DISTINCT FROM OLD.scope_kind
     OR NEW.scope_id IS DISTINCT FROM OLD.scope_id OR NEW.trigger_key IS DISTINCT FROM OLD.trigger_key
     OR NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'adoption_intervention %: code, origin and trigger fields are immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'adoption_intervention_origin_immutable';
  END IF;
  -- A person's update names the person; a worker-created intervention must get an owner before it can be done.
  IF NEW.status = 'done' AND NEW.owner_user_id IS NULL THEN
    RAISE EXCEPTION 'adoption_intervention %: an intervention without an owner cannot be completed', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'adoption_intervention_owner_required';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER adoption_intervention_guard BEFORE INSERT OR UPDATE ON adoption_intervention FOR EACH ROW EXECUTE FUNCTION adoption_intervention_guard();
SELECT p2_attach_guards('adoption_intervention', true);
GRANT SELECT, INSERT, UPDATE ON adoption_intervention TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- Validated, versioned form JSON (REQ-S11-002; ADR-0014 "validated JSON only for extensible custom fields and
-- versioned forms"). A form schema is an object {"questions": [...]} with 1-20 questions; each question is an object
-- with a unique key (^[a-z][a-z0-9_]{0,39}$), a type in {single_choice, scale, yes_no, text}, label_en and label_ar
-- (1-500 characters), required (boolean), options (single_choice only: 2-10 objects {value, label_en, label_ar}) and
-- scale bounds (scale only: integers min < max within 0..10). A proficiency_assessment form has exactly one question
-- with "proficiency": true, of type yes_no or scale; a scale proficiency question names pass_min within its bounds.
-- No other member is allowed. The API validates the same shape with zod before it writes (S-2).
CREATE FUNCTION p4_assessment_form_schema_valid(p_kind text, p_schema jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
  q jsonb;
  o jsonb;
  keys text[] := '{}';
  prof integer := 0;
  t text;
BEGIN
  IF jsonb_typeof(p_schema) <> 'object' OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_schema) k) <> ARRAY['questions'] THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(p_schema->'questions') <> 'array' OR jsonb_array_length(p_schema->'questions') NOT BETWEEN 1 AND 20 THEN
    RETURN false;
  END IF;
  FOR q IN SELECT value FROM jsonb_array_elements(p_schema->'questions') LOOP
    IF jsonb_typeof(q) <> 'object' THEN RETURN false; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(q) k
               WHERE k NOT IN ('key', 'type', 'label_en', 'label_ar', 'required', 'options', 'min', 'max', 'proficiency', 'pass_min')) THEN
      RETURN false;
    END IF;
    IF jsonb_typeof(q->'key') IS DISTINCT FROM 'string' OR NOT (q->>'key') ~ '^[a-z][a-z0-9_]{0,39}$' OR (q->>'key') = ANY (keys) THEN
      RETURN false;
    END IF;
    keys := keys || (q->>'key');
    t := q->>'type';
    IF jsonb_typeof(q->'type') IS DISTINCT FROM 'string' OR t NOT IN ('single_choice', 'scale', 'yes_no', 'text') THEN RETURN false; END IF;
    IF jsonb_typeof(q->'label_en') IS DISTINCT FROM 'string' OR char_length(q->>'label_en') NOT BETWEEN 1 AND 500
       OR jsonb_typeof(q->'label_ar') IS DISTINCT FROM 'string' OR char_length(q->>'label_ar') NOT BETWEEN 1 AND 500 THEN
      RETURN false;
    END IF;
    IF jsonb_typeof(q->'required') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
    IF (t = 'single_choice') <> (q ? 'options') THEN RETURN false; END IF;
    IF t = 'single_choice' THEN
      IF jsonb_typeof(q->'options') <> 'array' OR jsonb_array_length(q->'options') NOT BETWEEN 2 AND 10 THEN RETURN false; END IF;
      FOR o IN SELECT value FROM jsonb_array_elements(q->'options') LOOP
        IF jsonb_typeof(o) <> 'object' OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(o) k) <> ARRAY['label_ar', 'label_en', 'value']
           OR jsonb_typeof(o->'value') <> 'string' OR NOT (o->>'value') ~ '^[a-z0-9_]{1,40}$'
           OR jsonb_typeof(o->'label_en') <> 'string' OR char_length(o->>'label_en') NOT BETWEEN 1 AND 200
           OR jsonb_typeof(o->'label_ar') <> 'string' OR char_length(o->>'label_ar') NOT BETWEEN 1 AND 200 THEN
          RETURN false;
        END IF;
      END LOOP;
      IF (SELECT count(DISTINCT x->>'value') FROM jsonb_array_elements(q->'options') x) <> jsonb_array_length(q->'options') THEN RETURN false; END IF;
    END IF;
    IF (t = 'scale') <> (q ? 'min' AND q ? 'max') OR (t <> 'scale' AND (q ? 'min' OR q ? 'max')) THEN RETURN false; END IF;
    IF t = 'scale' THEN
      IF jsonb_typeof(q->'min') <> 'number' OR jsonb_typeof(q->'max') <> 'number'
         OR (q->>'min') !~ '^[0-9]+$' OR (q->>'max') !~ '^[0-9]+$'
         OR (q->>'min')::int < 0 OR (q->>'max')::int > 10 OR (q->>'min')::int >= (q->>'max')::int THEN
        RETURN false;
      END IF;
    END IF;
    IF q ? 'proficiency' THEN
      IF jsonb_typeof(q->'proficiency') <> 'boolean' THEN RETURN false; END IF;
      IF (q->>'proficiency')::boolean THEN
        prof := prof + 1;
        IF t NOT IN ('yes_no', 'scale') OR NOT (q->>'required')::boolean THEN RETURN false; END IF;
      END IF;
    END IF;
    IF (q ? 'pass_min') <> (t = 'scale' AND coalesce((q->>'proficiency')::boolean, false)) THEN RETURN false; END IF;
    IF q ? 'pass_min' AND (jsonb_typeof(q->'pass_min') <> 'number' OR (q->>'pass_min') !~ '^[0-9]+$'
                           OR (q->>'pass_min')::int NOT BETWEEN (q->>'min')::int AND (q->>'max')::int) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN (p_kind = 'proficiency_assessment') = (prof = 1) AND prof <= 1;
END $$;

-- assessment_form: a short native form (REQ-S11-002). kind 'feedback' collects feedback; kind
-- 'proficiency_assessment' records observed proficiency and counts in the observed-proficiency measure (REQ-PB-072).
-- Status: draft -> published -> retired; retired is final. The questions live in assessment_form_version.
CREATE TABLE assessment_form (
  id                     uuid PRIMARY KEY,
  organization_id        uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id      uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kind                   text NOT NULL CHECK (kind IN ('feedback', 'proficiency_assessment')),
  name                   text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description            text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 2000),
  stakeholder_group_id   uuid NULL,
  status                 text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  current_version_no     integer NOT NULL DEFAULT 0 CHECK (current_version_no >= 0),
  published_version_no   integer NULL CHECK (published_version_no IS NULL OR published_version_no >= 1),
  published_at           timestamptz NULL,
  published_by           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  retired_at             timestamptz NULL,
  retired_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT assessment_form_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT assessment_form_group_fkey FOREIGN KEY (transformation_id, stakeholder_group_id) REFERENCES stakeholder_group (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT assessment_form_published_complete CHECK ((status = 'draft') = (published_at IS NULL)
                                                       AND (published_at IS NULL) = (published_by IS NULL)
                                                       AND (published_at IS NULL) = (published_version_no IS NULL)
                                                       AND (published_version_no IS NULL OR published_version_no <= current_version_no)),
  CONSTRAINT assessment_form_retired_complete CHECK ((status = 'retired') = (retired_at IS NOT NULL) AND (retired_at IS NULL) = (retired_by IS NULL))
);
CREATE FUNCTION assessment_form_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR NEW.current_version_no <> 0 THEN
      RAISE EXCEPTION 'assessment_form: a new form is a draft without versions'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'assessment_form_starts_draft';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'retired' THEN
    RAISE EXCEPTION 'assessment_form %: a retired form is final', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assessment_form_retired_final';
  END IF;
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'assessment_form %: the kind is immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assessment_form_kind_immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY['draft>published', 'published>retired']) THEN
    RAISE EXCEPTION 'assessment_form %: % -> % is not a legal transition', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assessment_form_transition';
  END IF;
  IF NEW.current_version_no < OLD.current_version_no OR NEW.current_version_no > OLD.current_version_no + 1 THEN
    RAISE EXCEPTION 'assessment_form %: current_version_no steps by 0 or 1', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assessment_form_version_no_step';
  END IF;
  IF NEW.published_version_no IS NOT NULL AND (NEW.published_version_no < coalesce(OLD.published_version_no, 0)
      OR NOT EXISTS (SELECT 1 FROM assessment_form_version v WHERE v.form_id = NEW.id AND v.version_no = NEW.published_version_no)) THEN
    RAISE EXCEPTION 'assessment_form %: the published version must exist and never moves back', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assessment_form_published_version';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assessment_form_guard BEFORE INSERT OR UPDATE ON assessment_form FOR EACH ROW EXECUTE FUNCTION assessment_form_guard();
SELECT p2_attach_guards('assessment_form', true);
GRANT SELECT, INSERT, UPDATE ON assessment_form TO mth_app;

-- assessment_form_version: append-only question sets. version_no = the form's current_version_no + 1 at insert (the
-- service steps current_version_no in the same transaction). A version is never edited; responses name the version
-- they answered.
CREATE TABLE assessment_form_version (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  form_id           uuid NOT NULL,
  version_no        integer NOT NULL CHECK (version_no >= 1),
  schema            jsonb NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT assessment_form_version_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT assessment_form_version_no_key UNIQUE (form_id, version_no),
  CONSTRAINT assessment_form_version_form_fkey FOREIGN KEY (transformation_id, form_id) REFERENCES assessment_form (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE FUNCTION assessment_form_version_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  f record;
BEGIN
  SELECT kind, status, current_version_no INTO f FROM assessment_form WHERE id = NEW.form_id;
  IF f.status = 'retired' THEN
    RAISE EXCEPTION 'assessment_form_version: a retired form takes no new version'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assessment_form_version_form_open';
  END IF;
  IF NEW.version_no <> f.current_version_no + 1 THEN
    RAISE EXCEPTION 'assessment_form_version: version_no must be % (the form''s current version + 1)', f.current_version_no + 1
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assessment_form_version_step';
  END IF;
  IF NOT p4_assessment_form_schema_valid(f.kind, NEW.schema) THEN
    RAISE EXCEPTION 'assessment_form_version: the form schema is not valid for a % form (ADR-0033 §5)', f.kind
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assessment_form_version_schema_valid';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assessment_form_version_guard BEFORE INSERT ON assessment_form_version FOR EACH ROW EXECUTE FUNCTION assessment_form_version_guard();
SELECT p2_attach_append_only('assessment_form_version');
SELECT p2_attach_guards('assessment_form_version', true);
GRANT SELECT, INSERT ON assessment_form_version TO mth_app;

-- assessment_invitation: an invited respondent of a published form (REQ-S11-002 "respond: invited users"). One open
-- invitation per form and user. Status: open -> responded | cancelled (both final).
CREATE TABLE assessment_invitation (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id    uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  form_id              uuid NOT NULL,
  user_id              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  stakeholder_group_id uuid NOT NULL,
  subject_user_id      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  due_date             date NULL,
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'responded', 'cancelled')),
  version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT assessment_invitation_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT assessment_invitation_form_fkey FOREIGN KEY (transformation_id, form_id) REFERENCES assessment_form (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT assessment_invitation_group_fkey FOREIGN KEY (transformation_id, stakeholder_group_id) REFERENCES stakeholder_group (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX assessment_invitation_open_key ON assessment_invitation (form_id, user_id, coalesce(subject_user_id, user_id)) WHERE status = 'open';
CREATE FUNCTION assessment_invitation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' THEN
      RAISE EXCEPTION 'assessment_invitation: a new invitation is open'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'assessment_invitation_starts_open';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM assessment_form f WHERE f.id = NEW.form_id AND f.status = 'published') THEN
      RAISE EXCEPTION 'assessment_invitation: only a published form takes invitations'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'assessment_invitation_form_published';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'assessment_invitation %: a % invitation is final', OLD.id, OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assessment_invitation_final';
  END IF;
  IF NEW.form_id IS DISTINCT FROM OLD.form_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.stakeholder_group_id IS DISTINCT FROM OLD.stakeholder_group_id OR NEW.subject_user_id IS DISTINCT FROM OLD.subject_user_id THEN
    RAISE EXCEPTION 'assessment_invitation %: form, invitee, group and subject are immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assessment_invitation_identity';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assessment_invitation_guard BEFORE INSERT OR UPDATE ON assessment_invitation FOR EACH ROW EXECUTE FUNCTION assessment_invitation_guard();
SELECT p2_attach_guards('assessment_invitation', true);
GRANT SELECT, INSERT, UPDATE ON assessment_invitation TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- training_record (REQ-S16-020 "Training/AssessmentRecord", the training half; REQ-PB-072 "Training completion"):
-- one participant's attendance of one training. Completion is attendance, never adoption: nothing here counts in the
-- observed-proficiency measure. Status: enrolled -> completed | no_show | withdrawn (all final).
CREATE TABLE training_record (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id    uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  stakeholder_group_id uuid NOT NULL,
  intervention_id      uuid NULL,
  participant_user_id  uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  participant_label    text NULL CHECK (participant_label IS NULL OR char_length(participant_label) BETWEEN 1 AND 200),
  training_title       text NOT NULL CHECK (char_length(training_title) BETWEEN 1 AND 300),
  scheduled_on         date NULL,
  status               text NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled', 'completed', 'no_show', 'withdrawn')),
  completed_on         date NULL,
  recorded_by          uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT training_record_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT training_record_group_fkey FOREIGN KEY (transformation_id, stakeholder_group_id) REFERENCES stakeholder_group (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT training_record_intervention_fkey FOREIGN KEY (transformation_id, intervention_id) REFERENCES adoption_intervention (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT training_record_participant CHECK ((participant_user_id IS NULL) <> (participant_label IS NULL)),
  CONSTRAINT training_record_completed_complete CHECK ((status = 'completed') = (completed_on IS NOT NULL)
                                                       AND (status = 'enrolled') = (recorded_by IS NULL))
);
CREATE INDEX training_record_group_idx ON training_record (stakeholder_group_id, status);
CREATE FUNCTION training_record_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'enrolled' THEN
      RAISE EXCEPTION 'training_record %: a % record is final', OLD.id, OLD.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'training_record_final';
    END IF;
    IF NEW.stakeholder_group_id IS DISTINCT FROM OLD.stakeholder_group_id OR NEW.participant_user_id IS DISTINCT FROM OLD.participant_user_id
       OR NEW.participant_label IS DISTINCT FROM OLD.participant_label THEN
      RAISE EXCEPTION 'training_record %: group and participant are immutable', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'training_record_identity';
    END IF;
  END IF;
  IF NEW.intervention_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM adoption_intervention i WHERE i.id = NEW.intervention_id AND i.intervention_type = 'training') THEN
    RAISE EXCEPTION 'training_record: the linked intervention must be a training intervention'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'training_record_intervention_training';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER training_record_guard BEFORE INSERT OR UPDATE ON training_record FOR EACH ROW EXECUTE FUNCTION training_record_guard();
SELECT p2_attach_guards('training_record', true);
GRANT SELECT, INSERT, UPDATE ON training_record TO mth_app;

-- assessment_record (REQ-S16-020 "Training/AssessmentRecord", the assessment half; REQ-S11-002; REQ-PB-072): one
-- submitted response to a published form version, linked to its stakeholder group. A proficiency observation names
-- the observed person (or a label), the assessor (respondent), the observation date and the result; it counts in the
-- observed-proficiency measure from submission until it is withdrawn. Answers are a JSON object keyed by question
-- key; the API checks them against the version's schema. Status: submitted -> reviewed | withdrawn; reviewed ->
-- withdrawn. The answers, the result and the identity fields never change.
CREATE TABLE assessment_record (
  id                     uuid PRIMARY KEY,
  organization_id        uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id      uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  form_id                uuid NOT NULL,
  form_version_id        uuid NOT NULL,
  invitation_id          uuid NULL,
  stakeholder_group_id   uuid NOT NULL,
  kind                   text NOT NULL CHECK (kind IN ('feedback', 'proficiency_observation')),
  respondent_user_id     uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  subject_user_id        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  subject_label          text NULL CHECK (subject_label IS NULL OR char_length(subject_label) BETWEEN 1 AND 200),
  observed_on            date NOT NULL,
  answers                jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'object'),
  proficiency_result     text NULL CHECK (proficiency_result IS NULL OR proficiency_result IN ('proficient', 'not_yet_proficient')),
  status                 text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'reviewed', 'withdrawn')),
  reviewed_at            timestamptz NULL,
  reviewed_by            uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  review_note            text NULL CHECK (review_note IS NULL OR char_length(review_note) BETWEEN 1 AND 2000),
  withdrawn_at           timestamptz NULL,
  withdrawn_by           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  withdraw_reason        text NULL CHECK (withdraw_reason IS NULL OR char_length(withdraw_reason) BETWEEN 3 AND 1000),
  version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT assessment_record_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT assessment_record_form_fkey FOREIGN KEY (transformation_id, form_id) REFERENCES assessment_form (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT assessment_record_version_fkey FOREIGN KEY (transformation_id, form_version_id) REFERENCES assessment_form_version (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT assessment_record_invitation_fkey FOREIGN KEY (transformation_id, invitation_id) REFERENCES assessment_invitation (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT assessment_record_group_fkey FOREIGN KEY (transformation_id, stakeholder_group_id) REFERENCES stakeholder_group (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT assessment_record_respondent_is_creator CHECK (respondent_user_id = created_by),
  CONSTRAINT assessment_record_proficiency_shape CHECK (
    (kind = 'proficiency_observation') = (proficiency_result IS NOT NULL)
    AND (kind = 'feedback' OR (subject_user_id IS NULL) <> (subject_label IS NULL))
    AND (kind = 'proficiency_observation' OR (subject_user_id IS NULL AND subject_label IS NULL))),
  CONSTRAINT assessment_record_reviewed_complete CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL)
                                                       AND (status <> 'reviewed' OR reviewed_at IS NOT NULL)
                                                       AND (status <> 'submitted' OR reviewed_at IS NULL)),
  CONSTRAINT assessment_record_withdrawn_complete CHECK ((status = 'withdrawn') = (withdrawn_at IS NOT NULL)
                                                        AND (withdrawn_at IS NULL) = (withdrawn_by IS NULL)
                                                        AND (withdrawn_at IS NULL) = (withdraw_reason IS NULL))
);
CREATE INDEX assessment_record_group_idx ON assessment_record (stakeholder_group_id, kind, observed_on) WHERE status <> 'withdrawn';
CREATE UNIQUE INDEX assessment_record_invitation_key ON assessment_record (invitation_id) WHERE invitation_id IS NOT NULL;
CREATE FUNCTION assessment_record_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  f record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'submitted' THEN
      RAISE EXCEPTION 'assessment_record: a new record is submitted'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'assessment_record_starts_submitted';
    END IF;
    SELECT af.kind, af.status, af.published_version_no, v.version_no INTO f
      FROM assessment_form af JOIN assessment_form_version v ON v.form_id = af.id
      WHERE af.id = NEW.form_id AND v.id = NEW.form_version_id;
    IF NOT FOUND OR f.status <> 'published' OR f.version_no <> f.published_version_no THEN
      RAISE EXCEPTION 'assessment_record: a response answers the published version of a published form'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'assessment_record_form_published';
    END IF;
    IF (f.kind = 'proficiency_assessment') <> (NEW.kind = 'proficiency_observation') THEN
      RAISE EXCEPTION 'assessment_record: a proficiency assessment form records proficiency observations; a feedback form records feedback'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'assessment_record_kind_matches_form';
    END IF;
    IF NEW.invitation_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM assessment_invitation i WHERE i.id = NEW.invitation_id AND i.form_id = NEW.form_id AND i.status = 'open'
          AND i.user_id = NEW.respondent_user_id AND i.stakeholder_group_id = NEW.stakeholder_group_id
          AND i.subject_user_id IS NOT DISTINCT FROM NEW.subject_user_id) THEN
      RAISE EXCEPTION 'assessment_record: the invitation must be open and match the form, respondent, group and subject'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'assessment_record_invitation_matches';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'withdrawn' THEN
    RAISE EXCEPTION 'assessment_record %: a withdrawn record is final', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assessment_record_withdrawn_final';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY[
      'submitted>reviewed', 'submitted>withdrawn', 'reviewed>withdrawn']) THEN
    RAISE EXCEPTION 'assessment_record %: % -> % is not a legal transition', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assessment_record_transition';
  END IF;
  IF NEW.answers IS DISTINCT FROM OLD.answers OR NEW.proficiency_result IS DISTINCT FROM OLD.proficiency_result
     OR NEW.form_id IS DISTINCT FROM OLD.form_id OR NEW.form_version_id IS DISTINCT FROM OLD.form_version_id
     OR NEW.invitation_id IS DISTINCT FROM OLD.invitation_id OR NEW.stakeholder_group_id IS DISTINCT FROM OLD.stakeholder_group_id
     OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.respondent_user_id IS DISTINCT FROM OLD.respondent_user_id
     OR NEW.subject_user_id IS DISTINCT FROM OLD.subject_user_id OR NEW.subject_label IS DISTINCT FROM OLD.subject_label
     OR NEW.observed_on IS DISTINCT FROM OLD.observed_on THEN
    RAISE EXCEPTION 'assessment_record %: a submitted response is immutable (only review and withdrawal change it)', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assessment_record_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assessment_record_guard BEFORE INSERT OR UPDATE ON assessment_record FOR EACH ROW EXECUTE FUNCTION assessment_record_guard();
SELECT p2_attach_guards('assessment_record', true);
GRANT SELECT, INSERT, UPDATE ON assessment_record TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- stakeholder_involvement (REQ-PB-073 "record which impacted teams participated" in design workshops and decisions;
-- B0116 "Involve impacted teams early in design"): one row per (group, workshop) or (group, T04 design decision).
-- Append-only: a correction is a new row with status 'withdrawn' semantics expressed by withdrawn_involvement_id.
CREATE TABLE stakeholder_involvement (
  id                         uuid PRIMARY KEY,
  organization_id            uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id          uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  stakeholder_group_id       uuid NOT NULL,
  involvement_kind           text NOT NULL CHECK (involvement_kind IN ('workshop', 'decision')),
  workshop_id                uuid NULL,
  decision_id                uuid NULL,
  note                       text NULL CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000),
  withdraws_involvement_id   uuid NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT stakeholder_involvement_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT stakeholder_involvement_group_fkey FOREIGN KEY (transformation_id, stakeholder_group_id) REFERENCES stakeholder_group (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT stakeholder_involvement_workshop_fkey FOREIGN KEY (transformation_id, workshop_id) REFERENCES tom_workshop (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT stakeholder_involvement_decision_fkey FOREIGN KEY (transformation_id, decision_id) REFERENCES decision (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT stakeholder_involvement_withdraws_fkey FOREIGN KEY (transformation_id, withdraws_involvement_id) REFERENCES stakeholder_involvement (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT stakeholder_involvement_target CHECK ((involvement_kind = 'workshop') = (workshop_id IS NOT NULL)
                                                  AND (involvement_kind = 'decision') = (decision_id IS NOT NULL))
);
CREATE UNIQUE INDEX stakeholder_involvement_withdraws_key ON stakeholder_involvement (withdraws_involvement_id) WHERE withdraws_involvement_id IS NOT NULL;
CREATE FUNCTION stakeholder_involvement_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.decision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM decision d WHERE d.id = NEW.decision_id AND d.kind = 'design') THEN
    RAISE EXCEPTION 'stakeholder_involvement: involvement is recorded on a T04 design decision'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'stakeholder_involvement_design_decision';
  END IF;
  IF NEW.withdraws_involvement_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM stakeholder_involvement s WHERE s.id = NEW.withdraws_involvement_id AND s.withdraws_involvement_id IS NULL
        AND s.stakeholder_group_id = NEW.stakeholder_group_id AND s.involvement_kind = NEW.involvement_kind
        AND s.workshop_id IS NOT DISTINCT FROM NEW.workshop_id AND s.decision_id IS NOT DISTINCT FROM NEW.decision_id) THEN
    RAISE EXCEPTION 'stakeholder_involvement: a withdrawal names an original row with the same group and target'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'stakeholder_involvement_withdraw_matches';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stakeholder_involvement_guard BEFORE INSERT ON stakeholder_involvement FOR EACH ROW EXECUTE FUNCTION stakeholder_involvement_guard();
SELECT p2_attach_append_only('stakeholder_involvement');
SELECT p2_attach_guards('stakeholder_involvement', true);
GRANT SELECT, INSERT ON stakeholder_involvement TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- champion_constraint (REQ-PB-073 "a champion's constraint links to a T04 decision and is visible on that decision";
-- B0116 "Champions ... surface constraints and shape decisions"). Raised by an active champion of the group, about a T04
-- design decision of the same transformation. Status: open -> addressed | withdrawn (both final); addressed records
-- the response. The link never moves to another decision.
CREATE TABLE champion_constraint (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id    uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  champion_id          uuid NOT NULL,
  stakeholder_group_id uuid NOT NULL,
  decision_id          uuid NOT NULL,
  constraint_text      text NOT NULL CHECK (char_length(constraint_text) BETWEEN 3 AND 4000),
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'addressed', 'withdrawn')),
  response_text        text NULL CHECK (response_text IS NULL OR char_length(response_text) BETWEEN 3 AND 4000),
  resolved_at          timestamptz NULL,
  resolved_by          uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT champion_constraint_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT champion_constraint_champion_fkey FOREIGN KEY (transformation_id, champion_id) REFERENCES stakeholder_champion (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT champion_constraint_group_fkey FOREIGN KEY (transformation_id, stakeholder_group_id) REFERENCES stakeholder_group (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT champion_constraint_decision_fkey FOREIGN KEY (transformation_id, decision_id) REFERENCES decision (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT champion_constraint_resolved_complete CHECK ((status = 'open') = (resolved_at IS NULL)
                                                         AND (resolved_at IS NULL) = (resolved_by IS NULL)
                                                         AND (status = 'addressed') = (response_text IS NOT NULL))
);
CREATE INDEX champion_constraint_decision_idx ON champion_constraint (decision_id, status);
CREATE FUNCTION champion_constraint_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' THEN
      RAISE EXCEPTION 'champion_constraint: a new constraint is open'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'champion_constraint_starts_open';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM stakeholder_champion c WHERE c.id = NEW.champion_id AND c.status = 'active'
                     AND c.stakeholder_group_id = NEW.stakeholder_group_id AND c.user_id = NEW.created_by) THEN
      RAISE EXCEPTION 'champion_constraint: only an active champion of the group raises a constraint, in person'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'champion_constraint_raised_by_champion';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM decision d WHERE d.id = NEW.decision_id AND d.kind = 'design') THEN
      RAISE EXCEPTION 'champion_constraint: a constraint links to a T04 design decision'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'champion_constraint_design_decision';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'champion_constraint %: a % constraint is final', OLD.id, OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'champion_constraint_final';
  END IF;
  IF NEW.champion_id IS DISTINCT FROM OLD.champion_id OR NEW.stakeholder_group_id IS DISTINCT FROM OLD.stakeholder_group_id
     OR NEW.decision_id IS DISTINCT FROM OLD.decision_id OR NEW.constraint_text IS DISTINCT FROM OLD.constraint_text THEN
    RAISE EXCEPTION 'champion_constraint %: champion, group, decision and text are immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'champion_constraint_identity';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER champion_constraint_guard BEFORE INSERT OR UPDATE ON champion_constraint FOR EACH ROW EXECUTE FUNCTION champion_constraint_guard();
SELECT p2_attach_guards('champion_constraint', true);
GRANT SELECT, INSERT, UPDATE ON champion_constraint TO mth_app;
