-- 0013 direction and charter: North Star, strategic guardrails, outcomes, charter and charter versions
-- (T-DG2-ARCH-01; ADR-0016, ADR-0017). Authored by solution-architect.
-- Contract: docs/architecture/data-dictionary.md ("P2" section). Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged; later P2 changes go into new migrations (0019+, owned by
-- backend-workflow-engineer). SQL floor: PostgreSQL 16. Ids are UUIDv7 from the application; seed rows use fixed
-- literal UUIDs.

-- -----------------------------------------------------------------------------------------------------------------
-- north_star: The transformation's North Star: one concise sentence; exactly one current (REQ-PB-033).
CREATE TABLE north_star (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  statement         text NOT NULL CHECK (char_length(statement) BETWEEN 1 AND 300 AND statement !~ '[\r\n]'),
  status            text NOT NULL DEFAULT 'current' CHECK (status IN ('current', 'superseded')),
  superseded_at     timestamptz NULL,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT north_star_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT north_star_superseded_complete CHECK ((status = 'superseded') = (superseded_at IS NOT NULL))
);
CREATE UNIQUE INDEX north_star_one_current_key ON north_star (transformation_id) WHERE status = 'current';
SELECT p2_attach_guards('north_star', true);
GRANT SELECT, INSERT, UPDATE ON north_star TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- strategic_guardrail: Strategic guardrails: non-negotiables (B0035, REQ-PB-037); G2 evidence.
CREATE TABLE strategic_guardrail (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  title             text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  category          text NOT NULL CHECK (category IN ('regulatory', 'cx', 'capex', 'risk', 'brand', 'other')),
  statement         text NOT NULL CHECK (char_length(statement) BETWEEN 1 AND 4000),
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
  CONSTRAINT strategic_guardrail_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT strategic_guardrail_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL) AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
CREATE INDEX strategic_guardrail_transformation_updated_idx ON strategic_guardrail (transformation_id, updated_at DESC, id DESC);
SELECT p2_attach_guards('strategic_guardrail', true);
GRANT SELECT, INSERT, UPDATE ON strategic_guardrail TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- outcome: Strategic outcomes under the North Star, as a tree (B0048); top outcomes are the charter's 3-5.
CREATE TABLE outcome (
  id                               uuid PRIMARY KEY,
  organization_id                  uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id                uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  parent_outcome_id                uuid NULL,
  statement                        text NOT NULL CHECK (char_length(statement) BETWEEN 1 AND 500),
  description                      text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 4000),
  owner_user_id                    uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  is_top_outcome                   boolean NOT NULL DEFAULT false,
  top_rank                         smallint NULL CHECK (top_rank IS NULL OR top_rank BETWEEN 1 AND 99),
  specific_confirmed               boolean NULL,
  strategically_relevant_confirmed boolean NULL,
  causal_chain                     text NULL CHECK (causal_chain IS NULL OR char_length(causal_chain) BETWEEN 1 AND 4000),
  status                           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  archived_at                      timestamptz NULL,
  archived_by                      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason                   text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version                          integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                       timestamptz NOT NULL DEFAULT now(),
  created_by                       uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                       timestamptz NOT NULL DEFAULT now(),
  updated_by                       uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT outcome_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT outcome_parent_outcome_id_fkey FOREIGN KEY (transformation_id, parent_outcome_id) REFERENCES outcome (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT outcome_not_own_parent CHECK (parent_outcome_id IS DISTINCT FROM id),
  CONSTRAINT outcome_rank_only_top CHECK (top_rank IS NULL OR is_top_outcome),
  CONSTRAINT outcome_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL) AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
CREATE INDEX outcome_transformation_updated_idx ON outcome (transformation_id, updated_at DESC, id DESC);
CREATE INDEX outcome_parent_idx ON outcome (parent_outcome_id) WHERE parent_outcome_id IS NOT NULL;
-- Outcome tree: acyclic and at most 6 levels below the North Star. Serialized per transformation by an advisory lock,
-- re-checked after the write (same pattern as 0009's business_unit_hierarchy_guard).
CREATE FUNCTION outcome_hierarchy_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  outcome_lock_class CONSTANT integer := 730220;
  max_levels CONSTANT integer := 6;
  cur uuid;
  levels integer := 0;
BEGIN
  IF NEW.parent_outcome_id IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock(outcome_lock_class, hashtext(NEW.transformation_id::text));
  cur := NEW.parent_outcome_id;
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION 'outcome % cannot be placed under its own descendant', NEW.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'outcome_acyclic', TABLE = 'outcome';
    END IF;
    levels := levels + 1;
    IF levels >= max_levels THEN
      RAISE EXCEPTION 'outcome % would be nested deeper than % levels', NEW.id, max_levels
        USING ERRCODE = 'check_violation', CONSTRAINT = 'outcome_max_depth', TABLE = 'outcome';
    END IF;
    SELECT o.parent_outcome_id INTO cur FROM outcome o WHERE o.id = cur FOR SHARE;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER outcome_hierarchy_guard AFTER INSERT OR UPDATE OF parent_outcome_id ON outcome
  FOR EACH ROW EXECUTE FUNCTION outcome_hierarchy_guard();
SELECT p2_attach_guards('outcome', true);
GRANT SELECT, INSERT, UPDATE ON outcome TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- charter: Transformation Charter: first-class record with the 14 source fields (B0035), the thesis (B0037) and the five scope sanity check responses (B0038-B0043). Current state; every saved change appends a charter_version.
CREATE TABLE charter (
  id                                      uuid PRIMARY KEY,
  organization_id                         uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id                       uuid NOT NULL CONSTRAINT charter_transformation_id_key UNIQUE REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_name                     text NULL CHECK (transformation_name IS NULL OR char_length(transformation_name) BETWEEN 1 AND 200),
  executive_sponsor_user_id               uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_lead_user_id             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  case_for_change                         text NULL CHECK (case_for_change IS NULL OR char_length(case_for_change) BETWEEN 1 AND 20000),
  north_star_id                           uuid NULL,
  in_scope                                text NULL CHECK (in_scope IS NULL OR char_length(in_scope) BETWEEN 1 AND 20000),
  out_of_scope                            text NULL CHECK (out_of_scope IS NULL OR char_length(out_of_scope) BETWEEN 1 AND 20000),
  baseline_date                           date NULL,
  target_horizon_value                    integer NULL CHECK (target_horizon_value IS NULL OR target_horizon_value BETWEEN 1 AND 600),
  target_horizon_unit                     text NULL CHECK (target_horizon_unit IS NULL OR target_horizon_unit IN ('months', 'quarters', 'years')),
  governance_forum                        text NULL CHECK (governance_forum IS NULL OR char_length(governance_forum) BETWEEN 1 AND 500),
  decision_rights                         text NULL CHECK (decision_rights IS NULL OR char_length(decision_rights) BETWEEN 1 AND 20000),
  success_definition                      text NULL CHECK (success_definition IS NULL OR char_length(success_definition) BETWEEN 1 AND 20000),
  thesis_change                           text NULL CHECK (thesis_change IS NULL OR char_length(thesis_change) BETWEEN 1 AND 4000),
  thesis_outcomes                         text NULL CHECK (thesis_outcomes IS NULL OR char_length(thesis_outcomes) BETWEEN 1 AND 4000),
  thesis_benefits                         text NULL CHECK (thesis_benefits IS NULL OR char_length(thesis_benefits) BETWEEN 1 AND 4000),
  thesis_because                          text NULL CHECK (thesis_because IS NULL OR char_length(thesis_because) BETWEEN 1 AND 8000),
  sc_outcome_linkage                      text NULL CHECK (sc_outcome_linkage IS NULL OR sc_outcome_linkage IN ('yes', 'partly', 'no')),
  sc_outcome_linkage_evidence             text NULL CHECK (sc_outcome_linkage_evidence IS NULL OR char_length(sc_outcome_linkage_evidence) BETWEEN 1 AND 4000),
  sc_problem_traceability                 text NULL CHECK (sc_problem_traceability IS NULL OR sc_problem_traceability IN ('yes', 'partly', 'no')),
  sc_problem_traceability_evidence        text NULL CHECK (sc_problem_traceability_evidence IS NULL OR char_length(sc_problem_traceability_evidence) BETWEEN 1 AND 4000),
  sc_exclusions_documented                text NULL CHECK (sc_exclusions_documented IS NULL OR sc_exclusions_documented IN ('yes', 'partly', 'no')),
  sc_exclusions_documented_evidence       text NULL CHECK (sc_exclusions_documented_evidence IS NULL OR char_length(sc_exclusions_documented_evidence) BETWEEN 1 AND 4000),
  sc_baseline_measurable                  text NULL CHECK (sc_baseline_measurable IS NULL OR sc_baseline_measurable IN ('yes', 'partly', 'no')),
  sc_baseline_measurable_evidence         text NULL CHECK (sc_baseline_measurable_evidence IS NULL OR char_length(sc_baseline_measurable_evidence) BETWEEN 1 AND 4000),
  sc_executive_decisions_visible          text NULL CHECK (sc_executive_decisions_visible IS NULL OR sc_executive_decisions_visible IN ('yes', 'partly', 'no')),
  sc_executive_decisions_visible_evidence text NULL CHECK (sc_executive_decisions_visible_evidence IS NULL OR char_length(sc_executive_decisions_visible_evidence) BETWEEN 1 AND 4000),
  version                                 integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                              timestamptz NOT NULL DEFAULT now(),
  created_by                              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                              timestamptz NOT NULL DEFAULT now(),
  updated_by                              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT charter_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT charter_north_star_id_fkey FOREIGN KEY (transformation_id, north_star_id) REFERENCES north_star (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT charter_target_horizon_pair CHECK ((target_horizon_value IS NULL) = (target_horizon_unit IS NULL))
);
-- History retained (REQ-PB-029): every committed charter row version has its immutable charter_version snapshot.
CREATE FUNCTION charter_version_required() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM charter_version v WHERE v.charter_id = NEW.id AND v.version_no = NEW.version) THEN
    RAISE EXCEPTION 'charter % version % has no charter_version snapshot', NEW.id, NEW.version
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'charter_version_required';
  END IF;
  RETURN NULL;
END $$;
SELECT p2_attach_guards('charter', true);
GRANT SELECT, INSERT, UPDATE ON charter TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- charter_version: Immutable snapshot of the charter at each saved change (version_no = charter.version).
CREATE TABLE charter_version (
  id                                      uuid PRIMARY KEY,
  organization_id                         uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id                       uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  charter_id                              uuid NOT NULL,
  version_no                              integer NOT NULL CHECK (version_no >= 1),
  transformation_name                     text NULL CHECK (transformation_name IS NULL OR char_length(transformation_name) BETWEEN 1 AND 200),
  executive_sponsor_user_id               uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_lead_user_id             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  case_for_change                         text NULL CHECK (case_for_change IS NULL OR char_length(case_for_change) BETWEEN 1 AND 20000),
  north_star_id                           uuid NULL,
  in_scope                                text NULL CHECK (in_scope IS NULL OR char_length(in_scope) BETWEEN 1 AND 20000),
  out_of_scope                            text NULL CHECK (out_of_scope IS NULL OR char_length(out_of_scope) BETWEEN 1 AND 20000),
  baseline_date                           date NULL,
  target_horizon_value                    integer NULL CHECK (target_horizon_value IS NULL OR target_horizon_value BETWEEN 1 AND 600),
  target_horizon_unit                     text NULL CHECK (target_horizon_unit IS NULL OR target_horizon_unit IN ('months', 'quarters', 'years')),
  governance_forum                        text NULL CHECK (governance_forum IS NULL OR char_length(governance_forum) BETWEEN 1 AND 500),
  decision_rights                         text NULL CHECK (decision_rights IS NULL OR char_length(decision_rights) BETWEEN 1 AND 20000),
  success_definition                      text NULL CHECK (success_definition IS NULL OR char_length(success_definition) BETWEEN 1 AND 20000),
  thesis_change                           text NULL CHECK (thesis_change IS NULL OR char_length(thesis_change) BETWEEN 1 AND 4000),
  thesis_outcomes                         text NULL CHECK (thesis_outcomes IS NULL OR char_length(thesis_outcomes) BETWEEN 1 AND 4000),
  thesis_benefits                         text NULL CHECK (thesis_benefits IS NULL OR char_length(thesis_benefits) BETWEEN 1 AND 4000),
  thesis_because                          text NULL CHECK (thesis_because IS NULL OR char_length(thesis_because) BETWEEN 1 AND 8000),
  sc_outcome_linkage                      text NULL CHECK (sc_outcome_linkage IS NULL OR sc_outcome_linkage IN ('yes', 'partly', 'no')),
  sc_outcome_linkage_evidence             text NULL CHECK (sc_outcome_linkage_evidence IS NULL OR char_length(sc_outcome_linkage_evidence) BETWEEN 1 AND 4000),
  sc_problem_traceability                 text NULL CHECK (sc_problem_traceability IS NULL OR sc_problem_traceability IN ('yes', 'partly', 'no')),
  sc_problem_traceability_evidence        text NULL CHECK (sc_problem_traceability_evidence IS NULL OR char_length(sc_problem_traceability_evidence) BETWEEN 1 AND 4000),
  sc_exclusions_documented                text NULL CHECK (sc_exclusions_documented IS NULL OR sc_exclusions_documented IN ('yes', 'partly', 'no')),
  sc_exclusions_documented_evidence       text NULL CHECK (sc_exclusions_documented_evidence IS NULL OR char_length(sc_exclusions_documented_evidence) BETWEEN 1 AND 4000),
  sc_baseline_measurable                  text NULL CHECK (sc_baseline_measurable IS NULL OR sc_baseline_measurable IN ('yes', 'partly', 'no')),
  sc_baseline_measurable_evidence         text NULL CHECK (sc_baseline_measurable_evidence IS NULL OR char_length(sc_baseline_measurable_evidence) BETWEEN 1 AND 4000),
  sc_executive_decisions_visible          text NULL CHECK (sc_executive_decisions_visible IS NULL OR sc_executive_decisions_visible IN ('yes', 'partly', 'no')),
  sc_executive_decisions_visible_evidence text NULL CHECK (sc_executive_decisions_visible_evidence IS NULL OR char_length(sc_executive_decisions_visible_evidence) BETWEEN 1 AND 4000),
  north_star_statement                    text NULL CHECK (north_star_statement IS NULL OR char_length(north_star_statement) BETWEEN 1 AND 300),
  top_outcomes_snapshot                   jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(top_outcomes_snapshot) = 'array'),
  guardrails_snapshot                     jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(guardrails_snapshot) = 'array'),
  change_summary                          text NULL CHECK (change_summary IS NULL OR char_length(change_summary) BETWEEN 1 AND 1000),
  saved_by                                uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  saved_at                                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT charter_version_charter_id_fkey FOREIGN KEY (transformation_id, charter_id) REFERENCES charter (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT charter_version_no_key UNIQUE (charter_id, version_no),
  CONSTRAINT charter_version_target_horizon_pair CHECK ((target_horizon_value IS NULL) = (target_horizon_unit IS NULL))
);
SELECT p2_attach_append_only('charter_version');
CREATE CONSTRAINT TRIGGER charter_version_required AFTER INSERT OR UPDATE ON charter DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION charter_version_required();
SELECT p2_attach_guards('charter_version', false);
GRANT SELECT, INSERT ON charter_version TO mth_app;
