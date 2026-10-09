-- 0052 P4 slice H: change control. Change requests for material changes to approved scope, baseline, target, TOM, cost,
-- benefit logic, KPI definitions and schedule/budget rebaselines, their impact assessments (affected outcomes, KPIs,
-- benefits, gates, reports, formulas, initiatives, milestones), and the per-transformation materiality policy
-- (T-DG4-ARCH-07; ADR-0036; REQ-S04-014, REQ-S07-015, REQ-S09-010; REQ-S16-018 ChangeRequest; REQ-PB-065 routing).
-- Authored by solution-architect. Contract: docs/architecture/data-dictionary.md ("P4 tables, slice H").
-- Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged.
-- SQL floor: PostgreSQL 16. A change request is approved only by a person through the canonical P4 approval
-- (ADR-0026 §4, approval type 'change_request', seeded in 0053): change_request_guard refuses 'approved'/'rejected'
-- without that person's decision row. Approving a change never edits an earlier approval or evidence snapshot
-- (gate_decision and gate_submission are append-only/frozen since 0017). Nothing here touches DG0-DG7.

-- Human-readable code CR-01, CR-02, ... per transformation.
ALTER TABLE record_code_counter DROP CONSTRAINT record_code_counter_prefix_check;
ALTER TABLE record_code_counter ADD CONSTRAINT record_code_counter_prefix_check
  CHECK (prefix IN ('D', 'DEC', 'GD', 'DEP', 'INI', 'BC', 'BF', 'B', 'BG', 'VM', 'R', 'A', 'I', 'CA', 'SG', 'AI',
                    'PA', 'HO', 'CTL', 'CI', 'LL', 'TD', 'CR'));

-- -----------------------------------------------------------------------------------------------------------------
-- change_control_policy: the materiality thresholds of one transformation (REQ-S09-010 "beyond the material threshold").
-- The sources give no threshold, so NULL means "every change is material" (the safe default) and a configured value is
-- a team's decision, never a seeded figure. Ratios are decimal fractions (0.05 = 5 %), compared with decimal arithmetic.
CREATE TABLE change_control_policy (
  id                               uuid PRIMARY KEY,
  organization_id                  uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id                uuid NOT NULL CONSTRAINT change_control_policy_transformation_key UNIQUE
                                   REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  material_date_shift_working_days integer NULL CHECK (material_date_shift_working_days IS NULL OR material_date_shift_working_days BETWEEN 0 AND 250),
  material_budget_change_ratio     numeric(9,6) NULL CHECK (material_budget_change_ratio IS NULL OR material_budget_change_ratio BETWEEN 0 AND 10),
  note                             text NULL CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000),
  version                          integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                       timestamptz NOT NULL DEFAULT now(),
  created_by                       uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                       timestamptz NOT NULL DEFAULT now(),
  updated_by                       uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
SELECT p2_attach_guards('change_control_policy', true);
GRANT SELECT, INSERT, UPDATE ON change_control_policy TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- change_request: one proposed change to an approved record (REQ-S04-014, REQ-S07-015, REQ-S09-010). Status machine
-- (change_request_guard):
--   draft -> submitted | withdrawn
--   submitted -> approved | rejected | changes_requested | withdrawn
--   changes_requested -> submitted | withdrawn
--   approved, rejected, withdrawn: final.
-- Content is editable only in draft and changes_requested. Submitting freezes an impact assessment of exactly the
-- submitted version (current_impact_assessment_id). 'approved' records the application (applied_*), done in the same
-- transaction as the approval decision; the subject's earlier versions and approvals stay unchanged.
CREATE TABLE change_request (
  id                           uuid PRIMARY KEY,
  organization_id              uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id            uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code                         text NOT NULL CHECK (code ~ '^CR-[0-9]{2,}$'),
  change_kind                  text NOT NULL CHECK (change_kind IN ('business_scope', 'baseline', 'target', 'tom', 'cost',
                                 'benefit_logic', 'kpi_definition', 'schedule_rebaseline', 'budget_rebaseline')),
  subject_type                 text NOT NULL CHECK (subject_type IN ('charter', 'kpi_definition', 'outcome_kpi',
                                 'tom_canvas_cell', 'initiative', 'benefit_formula', 'milestone', 'budget_line')),
  subject_id                   uuid NOT NULL,
  subject_version              integer NOT NULL CHECK (subject_version >= 1),
  proposed_record_type         text NULL CHECK (proposed_record_type IS NULL OR proposed_record_type IN ('kpi_version', 'benefit_formula_version')),
  proposed_record_id           uuid NULL,
  proposed_change              jsonb NOT NULL CHECK (jsonb_typeof(proposed_change) = 'object'),
  reason                       text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 4000),
  origin                       text NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'automatic')),
  materiality                  text NULL CHECK (materiality IS NULL OR materiality IN ('material', 'not_material')),
  materiality_basis            jsonb NULL CHECK (materiality_basis IS NULL OR jsonb_typeof(materiality_basis) = 'object'),
  route_party_code             text NULL REFERENCES governance_party (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decision_right_id            uuid NULL,
  status                       text NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft', 'submitted', 'changes_requested', 'approved', 'rejected', 'withdrawn')),
  raised_by                    uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  submitted_by                 uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  submitted_at                 timestamptz NULL,
  current_impact_assessment_id uuid NULL,
  decided_at                   timestamptz NULL,
  applied_at                   timestamptz NULL,
  applied_record_type          text NULL CHECK (applied_record_type IS NULL OR applied_record_type ~ '^[a-z_]+$'),
  applied_record_id            uuid NULL,
  applied_version              integer NULL CHECK (applied_version IS NULL OR applied_version >= 1),
  withdrawn_at                 timestamptz NULL,
  version                      integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                   timestamptz NOT NULL DEFAULT now(),
  created_by                   uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  updated_by                   uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT change_request_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT change_request_code_key UNIQUE (transformation_id, code),
  CONSTRAINT change_request_decision_right_fkey FOREIGN KEY (transformation_id, decision_right_id)
    REFERENCES transformation_decision_right (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT change_request_kind_subject CHECK (CASE change_kind
      WHEN 'business_scope' THEN subject_type IN ('charter', 'initiative')
      WHEN 'baseline' THEN subject_type IN ('kpi_definition', 'outcome_kpi')
      WHEN 'target' THEN subject_type IN ('kpi_definition', 'outcome_kpi')
      WHEN 'kpi_definition' THEN subject_type = 'kpi_definition'
      WHEN 'tom' THEN subject_type = 'tom_canvas_cell'
      WHEN 'cost' THEN subject_type IN ('initiative', 'budget_line')
      WHEN 'benefit_logic' THEN subject_type = 'benefit_formula'
      WHEN 'schedule_rebaseline' THEN subject_type = 'milestone'
      WHEN 'budget_rebaseline' THEN subject_type = 'budget_line'
      ELSE false END),
  CONSTRAINT change_request_proposed_pair CHECK ((proposed_record_type IS NULL) = (proposed_record_id IS NULL)),
  CONSTRAINT change_request_proposed_kind CHECK (proposed_record_type IS NULL
    OR (proposed_record_type = 'kpi_version' AND change_kind IN ('baseline', 'target', 'kpi_definition') AND subject_type = 'kpi_definition')
    OR (proposed_record_type = 'benefit_formula_version' AND change_kind = 'benefit_logic')),
  CONSTRAINT change_request_submitted_complete CHECK (
    status IN ('draft', 'withdrawn')
    OR (submitted_at IS NOT NULL AND submitted_by IS NOT NULL AND materiality IS NOT NULL AND route_party_code IS NOT NULL
        AND current_impact_assessment_id IS NOT NULL)),
  CONSTRAINT change_request_decided_complete CHECK ((status IN ('approved', 'rejected')) = (decided_at IS NOT NULL)),
  CONSTRAINT change_request_applied_complete CHECK ((status = 'approved') = (applied_at IS NOT NULL)
    AND (applied_at IS NULL) = (applied_record_type IS NULL) AND (applied_record_type IS NULL) = (applied_record_id IS NULL)
    AND (applied_record_id IS NULL) = (applied_version IS NULL)),
  CONSTRAINT change_request_withdrawn_complete CHECK ((status = 'withdrawn') = (withdrawn_at IS NOT NULL))
);
-- One open change request per subject record (lock class 730246 serialises the check in the API).
CREATE UNIQUE INDEX change_request_one_open_per_subject ON change_request (subject_type, subject_id)
  WHERE status IN ('draft', 'submitted', 'changes_requested');
CREATE INDEX change_request_transformation_idx ON change_request (transformation_id, status, created_at DESC, id DESC);

-- -----------------------------------------------------------------------------------------------------------------
-- impact_assessment: the frozen impact preview of one submitted change-request version (REQ-S04-014, REQ-S07-015).
-- Append-only; its items are listed in impact_assessment_item. content_sha256 is the SHA-256 of the canonical JSON of
-- the items, so the assessment the approver saw can be proven unchanged.
CREATE TABLE impact_assessment (
  id                     uuid PRIMARY KEY,
  organization_id        uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id      uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  change_request_id      uuid NOT NULL,
  change_request_version integer NOT NULL CHECK (change_request_version >= 1),
  item_count             integer NOT NULL CHECK (item_count >= 0),
  content_sha256         char(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  assessed_at            timestamptz NOT NULL DEFAULT now(),
  assessed_by            uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT impact_assessment_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT impact_assessment_version_key UNIQUE (change_request_id, change_request_version),
  CONSTRAINT impact_assessment_change_request_fkey FOREIGN KEY (transformation_id, change_request_id)
    REFERENCES change_request (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
SELECT p2_attach_append_only('impact_assessment');
SELECT p2_attach_guards('impact_assessment', true);
GRANT SELECT, INSERT ON impact_assessment TO mth_app;

CREATE TABLE impact_assessment_item (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id    uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  impact_assessment_id uuid NOT NULL,
  ordinal              integer NOT NULL CHECK (ordinal >= 1),
  item_type            text NOT NULL CHECK (item_type IN ('outcome', 'kpi', 'benefit', 'gate', 'report', 'formula', 'initiative',
                         'milestone', 'business_case', 'budget_line')),
  record_type          text NULL CHECK (record_type IS NULL OR record_type ~ '^[a-z_]+$'),
  record_id            uuid NULL,
  record_code          text NULL CHECK (record_code IS NULL OR char_length(record_code) BETWEEN 1 AND 50),
  label                text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 300),
  effect               text NOT NULL CHECK (effect IN ('value_changes', 'recalculation', 'reapproval_required', 'informational')),
  gate_submission_id   uuid NULL REFERENCES gate_submission (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  gate_decision_id     uuid NULL REFERENCES gate_decision (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  detail               jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  CONSTRAINT impact_assessment_item_ordinal_key UNIQUE (impact_assessment_id, ordinal),
  CONSTRAINT impact_assessment_item_assessment_fkey FOREIGN KEY (transformation_id, impact_assessment_id)
    REFERENCES impact_assessment (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT impact_assessment_item_record_pair CHECK ((record_type IS NULL) = (record_id IS NULL)),
  -- A gate item names the submission whose snapshot is affected; an approved one also names the preserved decision.
  CONSTRAINT impact_assessment_item_gate_shape CHECK ((item_type = 'gate') = (gate_submission_id IS NOT NULL)
                                                     AND (gate_decision_id IS NULL OR item_type = 'gate'))
);
CREATE INDEX impact_assessment_item_record_idx ON impact_assessment_item (record_type, record_id);
SELECT p2_attach_append_only('impact_assessment_item');
SELECT p2_attach_guards('impact_assessment_item', false);
GRANT SELECT, INSERT ON impact_assessment_item TO mth_app;

ALTER TABLE change_request ADD CONSTRAINT change_request_current_impact_assessment_fkey
  FOREIGN KEY (transformation_id, current_impact_assessment_id) REFERENCES impact_assessment (transformation_id, id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION change_request_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  ok boolean;
  content_cols text[] := ARRAY['change_kind', 'subject_type', 'subject_id', 'subject_version', 'proposed_record_type',
                               'proposed_record_id', 'proposed_change', 'reason'];
  c text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'change_request: a new change request starts draft'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'change_request_status_step';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code OR NEW.origin IS DISTINCT FROM OLD.origin OR NEW.raised_by IS DISTINCT FROM OLD.raised_by
     OR NEW.change_kind IS DISTINCT FROM OLD.change_kind OR NEW.subject_type IS DISTINCT FROM OLD.subject_type
     OR NEW.subject_id IS DISTINCT FROM OLD.subject_id THEN
    RAISE EXCEPTION 'change_request %: code, origin, requester, kind and subject are immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'change_request_identity';
  END IF;
  IF OLD.status NOT IN ('draft', 'changes_requested') THEN
    FOREACH c IN ARRAY content_cols LOOP
      IF to_jsonb(NEW)->c IS DISTINCT FROM to_jsonb(OLD)->c THEN
        RAISE EXCEPTION 'change_request %: % is fixed while %', OLD.id, c, OLD.status
          USING ERRCODE = 'check_violation', CONSTRAINT = 'change_request_content_frozen';
      END IF;
    END LOOP;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    ok := CASE OLD.status
            WHEN 'draft' THEN NEW.status IN ('submitted', 'withdrawn')
            WHEN 'submitted' THEN NEW.status IN ('approved', 'rejected', 'changes_requested', 'withdrawn')
            WHEN 'changes_requested' THEN NEW.status IN ('submitted', 'withdrawn')
            ELSE false END;
    IF NOT ok THEN
      RAISE EXCEPTION 'change_request: % -> % is not an allowed transition', OLD.status, NEW.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'change_request_status_step';
    END IF;
    -- Only a person decides (ADR-0026 §4): an outcome needs that person's decision row on the change-request approval.
    IF NEW.status IN ('approved', 'rejected', 'changes_requested') AND NOT EXISTS (
         SELECT 1 FROM approval a JOIN approval_decision d ON d.approval_id = a.id AND d.round_no = a.round_no
         WHERE a.approval_type = 'change_request' AND a.subject_id = NEW.id
           AND d.outcome = CASE NEW.status WHEN 'approved' THEN 'approve' WHEN 'rejected' THEN 'reject' ELSE 'request_changes' END) THEN
      RAISE EXCEPTION 'change_request %: % needs a person''s decision on its change_request approval', OLD.id, NEW.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'change_request_outcome_needs_decision';
    END IF;
  ELSIF OLD.status IN ('approved', 'rejected', 'withdrawn') THEN
    RAISE EXCEPTION 'change_request %: a % change request is final', OLD.id, OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'change_request_final';
  END IF;
  -- The current impact assessment is the one frozen for exactly this version of the request.
  IF NEW.current_impact_assessment_id IS DISTINCT FROM OLD.current_impact_assessment_id AND NEW.current_impact_assessment_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM impact_assessment i WHERE i.id = NEW.current_impact_assessment_id
                       AND i.change_request_id = NEW.id AND i.change_request_version = NEW.version) THEN
    RAISE EXCEPTION 'change_request %: the impact assessment must be the one frozen for version %', OLD.id, NEW.version
      USING ERRCODE = 'check_violation', CONSTRAINT = 'change_request_assessment_current';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER change_request_guard BEFORE INSERT OR UPDATE ON change_request
  FOR EACH ROW EXECUTE FUNCTION change_request_guard();
SELECT p2_attach_guards('change_request', true);
GRANT SELECT, INSERT, UPDATE ON change_request TO mth_app;
