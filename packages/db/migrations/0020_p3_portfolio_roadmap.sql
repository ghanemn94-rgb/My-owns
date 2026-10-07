-- 0020 P3 portfolio and roadmap: initiatives (T05) and their links, roadmap waves (T07), deliverables, milestones,
-- gate dispensations (Modular inherited approvals and End-to-End waivers) (T-DG3-ARCH-01; ADR-0021, ADR-0023).
-- Authored by solution-architect. Contract: docs/architecture/data-dictionary.md ("P3" section).
-- Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged.
-- SQL floor: PostgreSQL 16. Ids are UUIDv7 from the application; seed rows use fixed literal UUIDs.
-- Every mutable table attaches the P2 guards from 0010 (row guard, version step, deferred audit coverage).

-- Human-readable codes for P3 records come from the same per-transformation counter as D/DEC/GD/DEP.
ALTER TABLE record_code_counter DROP CONSTRAINT record_code_counter_prefix_check;
ALTER TABLE record_code_counter ADD CONSTRAINT record_code_counter_prefix_check
  CHECK (prefix IN ('D', 'DEC', 'GD', 'DEP', 'INI', 'BC', 'BF'));

-- -----------------------------------------------------------------------------------------------------------------
-- roadmap_wave: T07 waves of one transformation (B0079). The four source waves are instantiated per transformation by
-- p3_instantiate_transformation() (0024) with their text VERBATIM; horizons may overlap (planning horizons).
CREATE TABLE roadmap_wave (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id  uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code               text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{0,47}$'),
  ordinal            smallint NOT NULL CHECK (ordinal BETWEEN 0 AND 99),
  is_source_seeded   boolean NOT NULL DEFAULT false,
  source_ref         text NULL CHECK (source_ref IS NULL OR char_length(source_ref) BETWEEN 1 AND 50),
  name_en            text NOT NULL CHECK (char_length(name_en) BETWEEN 1 AND 200),
  name_ar            text NOT NULL CHECK (char_length(name_ar) BETWEEN 1 AND 200),
  purpose_en         text NOT NULL CHECK (char_length(purpose_en) BETWEEN 1 AND 500),
  purpose_ar         text NOT NULL CHECK (char_length(purpose_ar) BETWEEN 1 AND 500),
  horizon_en         text NOT NULL CHECK (char_length(horizon_en) BETWEEN 1 AND 100),
  horizon_ar         text NOT NULL CHECK (char_length(horizon_ar) BETWEEN 1 AND 100),
  entry_criteria_en  text NOT NULL CHECK (char_length(entry_criteria_en) BETWEEN 1 AND 500),
  entry_criteria_ar  text NOT NULL CHECK (char_length(entry_criteria_ar) BETWEEN 1 AND 500),
  exit_evidence_en   text NOT NULL CHECK (char_length(exit_evidence_en) BETWEEN 1 AND 500),
  exit_evidence_ar   text NOT NULL CHECK (char_length(exit_evidence_ar) BETWEEN 1 AND 500),
  horizon_from_weeks smallint NOT NULL CHECK (horizon_from_weeks BETWEEN 0 AND 520),
  horizon_to_weeks   smallint NOT NULL CHECK (horizon_to_weeks BETWEEN 0 AND 520),
  planned_start      date NULL,
  planned_end        date NULL,
  owner_user_id      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  notes              text NULL CHECK (notes IS NULL OR char_length(notes) BETWEEN 1 AND 4000),
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version            integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT roadmap_wave_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT roadmap_wave_code_key UNIQUE (transformation_id, code),
  CONSTRAINT roadmap_wave_horizon_range CHECK (horizon_to_weeks >= horizon_from_weeks),
  CONSTRAINT roadmap_wave_planned_range CHECK (planned_end IS NULL OR planned_start IS NULL OR planned_end >= planned_start),
  CONSTRAINT roadmap_wave_seeded_not_archived CHECK (NOT (is_source_seeded AND status = 'archived')),
  CONSTRAINT roadmap_wave_seeded_has_source CHECK (NOT is_source_seeded OR source_ref IS NOT NULL)
);
CREATE INDEX roadmap_wave_transformation_idx ON roadmap_wave (transformation_id, ordinal);
-- The verbatim source text of a seeded wave never changes (like tom_dimension in 0011).
CREATE FUNCTION roadmap_wave_source_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.is_source_seeded AND (NEW.is_source_seeded IS DISTINCT FROM OLD.is_source_seeded
      OR NEW.code IS DISTINCT FROM OLD.code OR NEW.ordinal IS DISTINCT FROM OLD.ordinal
      OR NEW.source_ref IS DISTINCT FROM OLD.source_ref
      OR NEW.name_en IS DISTINCT FROM OLD.name_en OR NEW.name_ar IS DISTINCT FROM OLD.name_ar
      OR NEW.purpose_en IS DISTINCT FROM OLD.purpose_en OR NEW.purpose_ar IS DISTINCT FROM OLD.purpose_ar
      OR NEW.horizon_en IS DISTINCT FROM OLD.horizon_en OR NEW.horizon_ar IS DISTINCT FROM OLD.horizon_ar
      OR NEW.entry_criteria_en IS DISTINCT FROM OLD.entry_criteria_en OR NEW.entry_criteria_ar IS DISTINCT FROM OLD.entry_criteria_ar
      OR NEW.exit_evidence_en IS DISTINCT FROM OLD.exit_evidence_en OR NEW.exit_evidence_ar IS DISTINCT FROM OLD.exit_evidence_ar
      OR NEW.horizon_from_weeks IS DISTINCT FROM OLD.horizon_from_weeks OR NEW.horizon_to_weeks IS DISTINCT FROM OLD.horizon_to_weeks) THEN
    RAISE EXCEPTION 'roadmap_wave %: the source text of a seeded wave is immutable (B0079)', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'roadmap_wave_source_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER roadmap_wave_source_immutable BEFORE UPDATE ON roadmap_wave
  FOR EACH ROW EXECUTE FUNCTION roadmap_wave_source_immutable();
SELECT p2_attach_guards('roadmap_wave', true);
GRANT SELECT, INSERT, UPDATE ON roadmap_wave TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- initiative: T05 Initiative Card (B0072) and the portfolio lifecycle (ADR-0021 §3). A vehicle towards the target
-- state, never part of the TOM (B0059).
CREATE TABLE initiative (
  id                        uuid PRIMARY KEY,
  organization_id           uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id         uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code                      text NOT NULL CHECK (code ~ '^INI-[0-9]{2,6}$'),
  name                      text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 300),
  executive_owner_user_id   uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  workstream_lead_user_id   uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  problem_statement         text NULL CHECK (problem_statement IS NULL OR char_length(problem_statement) BETWEEN 1 AND 8000),
  objective                 text NULL CHECK (objective IS NULL OR char_length(objective) BETWEEN 1 AND 4000),
  scope_in                  text NULL CHECK (scope_in IS NULL OR char_length(scope_in) BETWEEN 1 AND 8000),
  scope_out                 text NULL CHECK (scope_out IS NULL OR char_length(scope_out) BETWEEN 1 AND 8000),
  financial_benefit_summary text NULL CHECK (financial_benefit_summary IS NULL OR char_length(financial_benefit_summary) BETWEEN 1 AND 4000),
  customer_benefit_summary  text NULL CHECK (customer_benefit_summary IS NULL OR char_length(customer_benefit_summary) BETWEEN 1 AND 4000),
  risks_summary             text NULL CHECK (risks_summary IS NULL OR char_length(risks_summary) BETWEEN 1 AND 4000),
  wave_id                   uuid NULL,
  planned_start             date NULL,
  planned_end               date NULL,
  status                    text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'ranked', 'selected', 'funded', 'launched', 'completed', 'cancelled')),
  launched_at               timestamptz NULL,
  launched_by               uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  cancelled_at              timestamptz NULL,
  cancelled_by              uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  cancel_reason             text NULL CHECK (cancel_reason IS NULL OR char_length(cancel_reason) BETWEEN 3 AND 1000),
  version                   integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT initiative_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT initiative_code_key UNIQUE (transformation_id, code),
  CONSTRAINT initiative_wave_id_fkey FOREIGN KEY (transformation_id, wave_id) REFERENCES roadmap_wave (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT initiative_planned_range CHECK (planned_end IS NULL OR planned_start IS NULL OR planned_end >= planned_start),
  CONSTRAINT initiative_launched_complete CHECK ((status IN ('launched', 'completed')) = (launched_at IS NOT NULL) AND (launched_at IS NULL) = (launched_by IS NULL)),
  CONSTRAINT initiative_cancelled_complete CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL) AND (cancelled_at IS NULL) = (cancelled_by IS NULL) AND (cancelled_at IS NULL) = (cancel_reason IS NULL))
);
CREATE INDEX initiative_transformation_updated_idx ON initiative (transformation_id, updated_at DESC, id DESC);
CREATE INDEX initiative_status_idx ON initiative (transformation_id, status);
CREATE INDEX initiative_wave_idx ON initiative (wave_id) WHERE wave_id IS NOT NULL;
-- ADR-0021 §3: the only legal status edges. Gate preconditions are API rules; the database guarantees the edge set.
CREATE FUNCTION initiative_status_step() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY[
      'draft>submitted', 'draft>cancelled',
      'submitted>draft', 'submitted>ranked', 'submitted>cancelled',
      'ranked>draft', 'ranked>submitted', 'ranked>selected', 'ranked>cancelled',
      'selected>ranked', 'selected>funded', 'selected>cancelled',
      'funded>selected', 'funded>ranked', 'funded>launched', 'funded>cancelled',
      'launched>completed']) THEN
    RAISE EXCEPTION 'initiative %: % -> % is not a legal transition (ADR-0021)', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'initiative_status_transition';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER initiative_status_step BEFORE UPDATE OF status ON initiative
  FOR EACH ROW EXECUTE FUNCTION initiative_status_step();
SELECT p2_attach_guards('initiative', true);
GRANT SELECT, INSERT, UPDATE ON initiative TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- initiative_gap_link: T05 "Problem / gap addressed": the initiative is a vehicle for a TOM gap (T03) or a diagnosed
-- finding (B0070). Never TOM evidence (REQ-PB-040).
CREATE TABLE initiative_gap_link (
  id                    uuid PRIMARY KEY,
  organization_id       uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id     uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  initiative_id         uuid NOT NULL,
  target_type           text NOT NULL CHECK (target_type IN ('tom_gap', 'diagnostic_finding')),
  tom_gap_id            uuid NULL,
  diagnostic_finding_id uuid NULL,
  note                  text NULL CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000),
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  removed_at            timestamptz NULL,
  removed_by            uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  remove_reason         text NULL CHECK (remove_reason IS NULL OR char_length(remove_reason) BETWEEN 3 AND 1000),
  version               integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT initiative_gap_link_initiative_id_fkey FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT initiative_gap_link_tom_gap_id_fkey FOREIGN KEY (transformation_id, tom_gap_id) REFERENCES tom_gap (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT initiative_gap_link_diagnostic_finding_id_fkey FOREIGN KEY (transformation_id, diagnostic_finding_id) REFERENCES diagnostic_finding (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT initiative_gap_link_one_target CHECK ((target_type = 'tom_gap') = (tom_gap_id IS NOT NULL) AND (target_type = 'diagnostic_finding') = (diagnostic_finding_id IS NOT NULL)),
  CONSTRAINT initiative_gap_link_removal_complete CHECK ((status = 'removed') = (removed_at IS NOT NULL) AND (removed_at IS NULL) = (removed_by IS NULL) AND (removed_at IS NULL) = (remove_reason IS NULL))
);
CREATE UNIQUE INDEX initiative_gap_link_tom_gap_active_key ON initiative_gap_link (initiative_id, tom_gap_id) WHERE status = 'active' AND tom_gap_id IS NOT NULL;
CREATE UNIQUE INDEX initiative_gap_link_finding_active_key ON initiative_gap_link (initiative_id, diagnostic_finding_id) WHERE status = 'active' AND diagnostic_finding_id IS NOT NULL;
CREATE INDEX initiative_gap_link_initiative_idx ON initiative_gap_link (initiative_id) WHERE status = 'active';
SELECT p2_attach_guards('initiative_gap_link', true);
GRANT SELECT, INSERT, UPDATE ON initiative_gap_link TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- initiative_outcome_contribution: T05 "Outcome/KPI contribution", the fifth level of the outcome hierarchy (B0048):
-- how the initiative moves an outcome, optionally through a T02 row (KPI + target). outcome_id is mandatory.
CREATE TABLE initiative_outcome_contribution (
  id                     uuid PRIMARY KEY,
  organization_id        uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id      uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  initiative_id          uuid NOT NULL,
  outcome_id             uuid NOT NULL,
  outcome_kpi_id         uuid NULL,
  contribution_statement text NOT NULL CHECK (char_length(contribution_statement) BETWEEN 1 AND 2000),
  expected_kpi_movement  text NULL CHECK (expected_kpi_movement IS NULL OR char_length(expected_kpi_movement) BETWEEN 1 AND 500),
  status                 text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  removed_at             timestamptz NULL,
  removed_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  remove_reason          text NULL CHECK (remove_reason IS NULL OR char_length(remove_reason) BETWEEN 3 AND 1000),
  version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT initiative_outcome_contribution_initiative_id_fkey FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT initiative_outcome_contribution_outcome_id_fkey FOREIGN KEY (transformation_id, outcome_id) REFERENCES outcome (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT initiative_outcome_contribution_outcome_kpi_id_fkey FOREIGN KEY (transformation_id, outcome_kpi_id) REFERENCES outcome_kpi (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT initiative_outcome_contribution_removal_complete CHECK ((status = 'removed') = (removed_at IS NOT NULL) AND (removed_at IS NULL) = (removed_by IS NULL) AND (removed_at IS NULL) = (remove_reason IS NULL))
);
CREATE INDEX initiative_outcome_contribution_initiative_idx ON initiative_outcome_contribution (initiative_id) WHERE status = 'active';
CREATE INDEX initiative_outcome_contribution_outcome_idx ON initiative_outcome_contribution (outcome_id) WHERE status = 'active';
-- The T02 row (KPI) named by a contribution must belong to the contribution's outcome.
CREATE FUNCTION initiative_contribution_kpi_matches_outcome() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.outcome_kpi_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM outcome_kpi k WHERE k.id = NEW.outcome_kpi_id AND k.outcome_id = NEW.outcome_id) THEN
    RAISE EXCEPTION 'initiative_outcome_contribution %: outcome_kpi % does not belong to outcome %', NEW.id, NEW.outcome_kpi_id, NEW.outcome_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'initiative_contribution_kpi_matches_outcome';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER initiative_contribution_kpi_matches_outcome BEFORE INSERT OR UPDATE OF outcome_id, outcome_kpi_id ON initiative_outcome_contribution
  FOR EACH ROW EXECUTE FUNCTION initiative_contribution_kpi_matches_outcome();
SELECT p2_attach_guards('initiative_outcome_contribution', true);
GRANT SELECT, INSERT, UPDATE ON initiative_outcome_contribution TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- initiative_decision_link: T05 "Required decisions": references to canonical decision rows (one decision model).
CREATE TABLE initiative_decision_link (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  initiative_id     uuid NOT NULL,
  decision_id       uuid NOT NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  removed_at        timestamptz NULL,
  removed_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  remove_reason     text NULL CHECK (remove_reason IS NULL OR char_length(remove_reason) BETWEEN 3 AND 1000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT initiative_decision_link_initiative_id_fkey FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT initiative_decision_link_decision_id_fkey FOREIGN KEY (transformation_id, decision_id) REFERENCES decision (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT initiative_decision_link_removal_complete CHECK ((status = 'removed') = (removed_at IS NOT NULL) AND (removed_at IS NULL) = (removed_by IS NULL) AND (removed_at IS NULL) = (remove_reason IS NULL))
);
CREATE UNIQUE INDEX initiative_decision_link_active_key ON initiative_decision_link (initiative_id, decision_id) WHERE status = 'active';
SELECT p2_attach_guards('initiative_decision_link', true);
GRANT SELECT, INSERT, UPDATE ON initiative_decision_link TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- deliverable: T05 "Key deliverables" (3-7 is a warning, not a rule) with acceptance status (ADR-0023 §2).
CREATE TABLE deliverable (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  initiative_id     uuid NOT NULL,
  ordinal           smallint NOT NULL DEFAULT 1 CHECK (ordinal BETWEEN 1 AND 999),
  title             text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  description       text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 4000),
  owner_user_id     uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  due_date          date NULL,
  acceptance_status text NOT NULL DEFAULT 'pending' CHECK (acceptance_status IN ('pending', 'submitted', 'accepted', 'rejected')),
  submitted_by      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  submitted_at      timestamptz NULL,
  decided_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_at        timestamptz NULL,
  acceptance_note   text NULL CHECK (acceptance_note IS NULL OR char_length(acceptance_note) BETWEEN 1 AND 2000),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at       timestamptz NULL,
  archived_by       uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason    text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT deliverable_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT deliverable_initiative_id_fkey FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT deliverable_submitted_complete CHECK ((acceptance_status IN ('submitted', 'accepted', 'rejected')) = (submitted_at IS NOT NULL) AND (submitted_at IS NULL) = (submitted_by IS NULL)),
  CONSTRAINT deliverable_decided_complete CHECK ((acceptance_status IN ('accepted', 'rejected')) = (decided_at IS NOT NULL) AND (decided_at IS NULL) = (decided_by IS NULL)),
  CONSTRAINT deliverable_acceptor_not_submitter CHECK (decided_by IS NULL OR decided_by <> submitted_by),
  CONSTRAINT deliverable_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL) AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
CREATE INDEX deliverable_initiative_idx ON deliverable (initiative_id, ordinal) WHERE status = 'active';
SELECT p2_attach_guards('deliverable', true);
GRANT SELECT, INSERT, UPDATE ON deliverable TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- milestone: T05 "Milestones" / T07 dates: approved (baseline) vs forecast date (ADR-0023 §2).
CREATE TABLE milestone (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  initiative_id     uuid NOT NULL,
  wave_id           uuid NULL,
  title             text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  description       text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 4000),
  owner_user_id     uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  approved_date     date NULL,
  approved_by       uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  approved_at       timestamptz NULL,
  approval_reason   text NULL CHECK (approval_reason IS NULL OR char_length(approval_reason) BETWEEN 3 AND 1000),
  forecast_date     date NULL,
  actual_date       date NULL,
  status            text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'achieved', 'missed', 'cancelled')),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT milestone_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT milestone_initiative_id_fkey FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT milestone_wave_id_fkey FOREIGN KEY (transformation_id, wave_id) REFERENCES roadmap_wave (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT milestone_approved_complete CHECK ((approved_date IS NULL) = (approved_by IS NULL) AND (approved_by IS NULL) = (approved_at IS NULL)),
  CONSTRAINT milestone_achieved_actual CHECK ((status = 'achieved') = (actual_date IS NOT NULL))
);
CREATE INDEX milestone_initiative_idx ON milestone (initiative_id);
CREATE INDEX milestone_transformation_forecast_idx ON milestone (transformation_id, forecast_date);
SELECT p2_attach_guards('milestone', true);
GRANT SELECT, INSERT, UPDATE ON milestone TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- gate_dispensation: Modular inherited approvals (captured as evidence, never a gate decision) and End-to-End waivers
-- (ADR-0021 §5). Recorded by one person, accepted or rejected by another (a gate.decide holder); revocable.
CREATE TABLE gate_dispensation (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kind              text NOT NULL CHECK (kind IN ('inherited_approval', 'waiver')),
  gate_code         text NOT NULL REFERENCES gate_definition (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  initiative_id     uuid NULL,
  reason            text NULL CHECK (reason IS NULL OR char_length(reason) BETWEEN 3 AND 4000),
  approving_body    text NULL CHECK (approving_body IS NULL OR char_length(approving_body) BETWEEN 1 AND 300),
  approved_on       date NULL,
  evidence_id       uuid NULL,
  expires_on        date NULL,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'revoked')),
  recorded_by       uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_at        timestamptz NULL,
  decision_note     text NULL CHECK (decision_note IS NULL OR char_length(decision_note) BETWEEN 1 AND 2000),
  revoked_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  revoked_at        timestamptz NULL,
  revoke_reason     text NULL CHECK (revoke_reason IS NULL OR char_length(revoke_reason) BETWEEN 3 AND 1000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT gate_dispensation_initiative_id_fkey FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT gate_dispensation_evidence_id_fkey FOREIGN KEY (transformation_id, evidence_id) REFERENCES evidence (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT gate_dispensation_gate CHECK (gate_code IN ('G1', 'G2', 'G3')),
  CONSTRAINT gate_dispensation_inherited_shape CHECK (kind <> 'inherited_approval' OR (evidence_id IS NOT NULL AND approving_body IS NOT NULL AND approved_on IS NOT NULL AND initiative_id IS NULL)),
  CONSTRAINT gate_dispensation_waiver_shape CHECK (kind <> 'waiver' OR (reason IS NOT NULL AND evidence_id IS NULL AND approving_body IS NULL AND approved_on IS NULL)),
  CONSTRAINT gate_dispensation_decided_complete CHECK ((status IN ('accepted', 'rejected', 'revoked')) = (decided_at IS NOT NULL) AND (decided_at IS NULL) = (decided_by IS NULL)),
  CONSTRAINT gate_dispensation_revoked_complete CHECK ((status = 'revoked') = (revoked_at IS NOT NULL) AND (revoked_at IS NULL) = (revoked_by IS NULL) AND (revoked_at IS NULL) = (revoke_reason IS NULL)),
  CONSTRAINT gate_dispensation_decider_not_recorder CHECK (decided_by IS NULL OR decided_by <> recorded_by)
);
CREATE INDEX gate_dispensation_transformation_idx ON gate_dispensation (transformation_id, gate_code, status);
SELECT p2_attach_guards('gate_dispensation', true);
GRANT SELECT, INSERT, UPDATE ON gate_dispensation TO mth_app;
