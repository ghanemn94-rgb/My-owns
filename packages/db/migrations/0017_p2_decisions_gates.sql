-- 0017 one decision model (T04 design decisions), TOM workshops, actions, canonical dependency, product gate engine
-- G1-G6 (T-DG2-ARCH-01; ADR-0015, ADR-0016). Authored by solution-architect.
-- Contract: docs/architecture/data-dictionary.md ("P2" section). Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged; later P2 changes go into new migrations (0019+, owned by
-- backend-workflow-engineer). SQL floor: PostgreSQL 16. Ids are UUIDv7 from the application; seed rows use fixed
-- literal UUIDs.

-- -----------------------------------------------------------------------------------------------------------------
-- decision: THE canonical decision record (one decision model): T04 design decisions (kind = design) in P2, gate decisions (kind = gate, specialised by gate_decision), T16 executive decisions (kind = executive, P4).
CREATE TABLE decision (
  id                       uuid PRIMARY KEY,
  organization_id          uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id        uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kind                     text NOT NULL CHECK (kind IN ('design', 'executive', 'gate')),
  code                     text NOT NULL,
  title                    text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  context                  text NULL CHECK (context IS NULL OR char_length(context) BETWEEN 1 AND 20000),
  owner_user_id            uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  due_date                 date NULL,
  status                   text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'decided', 'deferred', 'cancelled')),
  recommendation_option_id uuid NULL,
  recommendation_text      text NULL CHECK (recommendation_text IS NULL OR char_length(recommendation_text) BETWEEN 1 AND 4000),
  chosen_option_id         uuid NULL,
  outcome_text             text NULL CHECK (outcome_text IS NULL OR char_length(outcome_text) BETWEEN 1 AND 8000),
  decided_by               uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_at               timestamptz NULL,
  tom_dimension_code       text NULL REFERENCES tom_dimension (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  source_workshop_item_id  uuid NULL,
  version                  integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT decision_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT decision_code_key UNIQUE (transformation_id, code),
  CONSTRAINT decision_id_kind_key UNIQUE (id, kind),
  CONSTRAINT decision_code_format CHECK ((kind = 'design' AND code ~ '^D-[0-9]{2,6}$') OR (kind = 'executive' AND code ~ '^DEC-[0-9]{2,6}$') OR (kind = 'gate' AND code ~ '^GD-[0-9]{2,6}$')),
  CONSTRAINT decision_decided_complete CHECK ((status = 'decided') = (decided_at IS NOT NULL) AND (decided_at IS NULL) = (decided_by IS NULL)),
  CONSTRAINT decision_gate_is_decided CHECK (kind <> 'gate' OR status = 'decided'),
  CONSTRAINT decision_design_choice CHECK (kind <> 'design' OR status <> 'decided' OR chosen_option_id IS NOT NULL),
  CONSTRAINT decision_design_only_links CHECK (kind = 'design' OR (tom_dimension_code IS NULL AND source_workshop_item_id IS NULL))
);
CREATE INDEX decision_transformation_updated_idx ON decision (transformation_id, updated_at DESC, id DESC);
CREATE INDEX decision_kind_status_idx ON decision (transformation_id, kind, status);
CREATE INDEX decision_open_owner_idx ON decision (owner_user_id) WHERE status = 'open';
SELECT p2_attach_guards('decision', true);
GRANT SELECT, INSERT, UPDATE ON decision TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- decision_option: Options A / B / C… of a decision (B0065); also used by T16 in P4.
CREATE TABLE decision_option (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decision_id       uuid NOT NULL,
  label             text NOT NULL CHECK (label ~ '^[A-Z]$'),
  title             text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  description       text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 4000),
  ordinal           smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 26),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT decision_option_decision_id_fkey FOREIGN KEY (transformation_id, decision_id) REFERENCES decision (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT decision_option_label_key UNIQUE (decision_id, label),
  CONSTRAINT decision_option_decision_id_id_key UNIQUE (decision_id, id)
);
ALTER TABLE decision
  ADD CONSTRAINT decision_recommendation_option_fkey FOREIGN KEY (id, recommendation_option_id) REFERENCES decision_option (decision_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT decision_chosen_option_fkey FOREIGN KEY (id, chosen_option_id) REFERENCES decision_option (decision_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT;
SELECT p2_attach_guards('decision_option', true);
GRANT SELECT, INSERT, UPDATE ON decision_option TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- record_code_counter: Per-transformation counters for human-readable codes (D-01, DEC-01, GD-01, DEP-01).
CREATE TABLE record_code_counter (
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  prefix            text NOT NULL CHECK (prefix IN ('D', 'DEC', 'GD', 'DEP')),
  last_value        integer NOT NULL CHECK (last_value >= 0),
  PRIMARY KEY (transformation_id, prefix)
);
GRANT SELECT, INSERT, UPDATE ON record_code_counter TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- tom_workshop: TOM canvas workshop (B0063): 90-120 minute session with business owners.
CREATE TABLE tom_workshop (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id   uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  title               text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  workshop_date       date NOT NULL,
  duration_minutes    integer NOT NULL CHECK (duration_minutes BETWEEN 15 AND 480),
  agenda              text NULL CHECK (agenda IS NULL OR char_length(agenda) BETWEEN 1 AND 20000),
  facilitator_user_id uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status              text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'closed')),
  closed_at           timestamptz NULL,
  closed_by           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tom_workshop_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT tom_workshop_closed_complete CHECK ((status = 'closed') = (closed_at IS NOT NULL) AND (closed_at IS NULL) = (closed_by IS NULL))
);
CREATE INDEX tom_workshop_transformation_updated_idx ON tom_workshop (transformation_id, updated_at DESC, id DESC);
SELECT p2_attach_guards('tom_workshop', true);
GRANT SELECT, INSERT, UPDATE ON tom_workshop TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- tom_workshop_participant: Participants of a TOM workshop (business owners flagged).
CREATE TABLE tom_workshop_participant (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  workshop_id       uuid NOT NULL,
  user_id           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  is_business_owner boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tom_workshop_participant_workshop_id_fkey FOREIGN KEY (transformation_id, workshop_id) REFERENCES tom_workshop (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX tom_workshop_participant_active_key ON tom_workshop_participant (workshop_id, user_id) WHERE status = 'active';
SELECT p2_attach_guards('tom_workshop_participant', true);
GRANT SELECT, INSERT, UPDATE ON tom_workshop_participant TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- tom_workshop_item: A workshop contribution, or an unresolved item that must be converted into a design decision or an owned action.
CREATE TABLE tom_workshop_item (
  id                    uuid PRIMARY KEY,
  organization_id       uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id     uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  workshop_id           uuid NOT NULL,
  dimension_code        text NULL REFERENCES tom_dimension (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kind                  text NOT NULL CHECK (kind IN ('contribution', 'unresolved')),
  body                  text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  owner_user_id         uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status                text NOT NULL CHECK (status IN ('recorded', 'open', 'converted')),
  converted_decision_id uuid NULL,
  converted_action_id   uuid NULL,
  converted_at          timestamptz NULL,
  converted_by          uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version               integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tom_workshop_item_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT tom_workshop_item_workshop_id_fkey FOREIGN KEY (transformation_id, workshop_id) REFERENCES tom_workshop (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tom_workshop_item_converted_decision_id_fkey FOREIGN KEY (transformation_id, converted_decision_id) REFERENCES decision (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tom_workshop_item_kind_status CHECK ((kind = 'contribution') = (status = 'recorded')),
  CONSTRAINT tom_workshop_item_conversion CHECK ((status = 'converted') = (converted_at IS NOT NULL) AND (converted_at IS NULL) = (converted_by IS NULL) AND (status <> 'converted' OR (owner_user_id IS NOT NULL AND ((converted_decision_id IS NULL) <> (converted_action_id IS NULL)))) AND (status = 'converted' OR (converted_decision_id IS NULL AND converted_action_id IS NULL)))
);
CREATE INDEX tom_workshop_item_workshop_idx ON tom_workshop_item (workshop_id, status);
-- REQ-PB-042: a workshop cannot be closed while unresolved items remain unconverted.
CREATE FUNCTION tom_workshop_close_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status <> 'closed' AND EXISTS (
      SELECT 1 FROM tom_workshop_item i WHERE i.workshop_id = NEW.id AND i.kind = 'unresolved' AND i.status = 'open') THEN
    RAISE EXCEPTION 'tom_workshop %: unresolved items must be converted before closing', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tom_workshop_close_unresolved';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tom_workshop_close_guard BEFORE UPDATE OF status ON tom_workshop
  FOR EACH ROW EXECUTE FUNCTION tom_workshop_close_guard();
ALTER TABLE decision ADD CONSTRAINT decision_source_workshop_item_fkey
  FOREIGN KEY (transformation_id, source_workshop_item_id) REFERENCES tom_workshop_item (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT;
SELECT p2_attach_guards('tom_workshop_item', true);
GRANT SELECT, INSERT, UPDATE ON tom_workshop_item TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- action_item: An owned action (P2: from workshop conversion; P4 extends it for RAID, meetings and corrective actions).
CREATE TABLE action_item (
  id                      uuid PRIMARY KEY,
  organization_id         uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id       uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  title                   text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  description             text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 4000),
  owner_user_id           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  due_date                date NULL,
  status                  text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
  source_workshop_item_id uuid NULL,
  version                 integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT action_item_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT action_item_source_workshop_item_id_fkey FOREIGN KEY (transformation_id, source_workshop_item_id) REFERENCES tom_workshop_item (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX action_item_transformation_updated_idx ON action_item (transformation_id, updated_at DESC, id DESC);
ALTER TABLE tom_workshop_item ADD CONSTRAINT tom_workshop_item_converted_action_id_fkey
  FOREIGN KEY (transformation_id, converted_action_id) REFERENCES action_item (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT;
SELECT p2_attach_guards('action_item', true);
GRANT SELECT, INSERT, UPDATE ON action_item TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- dependency: THE canonical dependency record shared by T08 and RAID (P2 subset: TOM-level dependencies; P3 adds initiative endpoints and cycle checks).
CREATE TABLE dependency (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id  uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code               text NOT NULL CHECK (code ~ '^DEP-[0-9]{2,6}$'),
  description        text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 2000),
  from_kind          text NOT NULL CHECK (from_kind IN ('initiative', 'external', 'tom_dimension', 'decision', 'other')),
  from_label         text NULL CHECK (from_label IS NULL OR char_length(from_label) BETWEEN 1 AND 300),
  to_kind            text NOT NULL CHECK (to_kind IN ('initiative', 'external', 'tom_dimension', 'decision', 'other')),
  to_label           text NULL CHECK (to_label IS NULL OR char_length(to_label) BETWEEN 1 AND 300),
  dependency_type    text NOT NULL CHECK (dependency_type IN ('decision', 'tech', 'data', 'vendor', 'other')),
  needed_by          date NULL,
  owner_user_id      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'at_risk', 'resolved', 'archived')),
  mitigation         text NULL CHECK (mitigation IS NULL OR char_length(mitigation) BETWEEN 1 AND 4000),
  tom_dimension_code text NULL REFERENCES tom_dimension (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decision_id        uuid NULL,
  archived_at        timestamptz NULL,
  archived_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason     text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version            integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT dependency_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT dependency_decision_id_fkey FOREIGN KEY (transformation_id, decision_id) REFERENCES decision (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT dependency_code_key UNIQUE (transformation_id, code),
  CONSTRAINT dependency_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL) AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
CREATE INDEX dependency_transformation_updated_idx ON dependency (transformation_id, updated_at DESC, id DESC);
CREATE INDEX dependency_dimension_idx ON dependency (transformation_id, tom_dimension_code) WHERE status <> 'archived';
SELECT p2_attach_guards('dependency', true);
GRANT SELECT, INSERT, UPDATE ON dependency TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- gate_instance: A product gate (G1-G6) of one transformation: status, configured approver, current submission. Business approval inside the product; unrelated to engineering gates DG0-DG7.
CREATE TABLE gate_instance (
  id                    uuid PRIMARY KEY,
  organization_id       uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id     uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  gate_code             text NOT NULL REFERENCES gate_definition (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'under_review', 'changes_requested', 'approved', 'rejected', 'deferred')),
  approver_role_code    text NOT NULL REFERENCES role (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  approver_user_id      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  current_submission_id uuid NULL,
  latest_submission_no  integer NOT NULL DEFAULT 0 CHECK (latest_submission_no >= 0),
  approved_at           timestamptz NULL,
  version               integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT gate_instance_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT gate_instance_gate_key UNIQUE (transformation_id, gate_code),
  CONSTRAINT gate_instance_approved_complete CHECK ((status = 'approved') = (approved_at IS NOT NULL)),
  CONSTRAINT gate_instance_draft_unsubmitted CHECK ((status = 'draft') = (latest_submission_no = 0) AND (current_submission_id IS NULL) = (latest_submission_no = 0))
);
CREATE FUNCTION gate_instance_approver_allowed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM gate_definition d
                 WHERE d.code = NEW.gate_code AND NEW.approver_role_code = ANY (d.allowed_approver_role_codes)) THEN
    RAISE EXCEPTION 'gate %: role % is not an allowed approver', NEW.gate_code, NEW.approver_role_code
      USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_instance_approver_allowed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gate_instance_approver_allowed BEFORE INSERT OR UPDATE OF approver_role_code ON gate_instance
  FOR EACH ROW EXECUTE FUNCTION gate_instance_approver_allowed();
SELECT p2_attach_guards('gate_instance', true);
GRANT SELECT, INSERT, UPDATE ON gate_instance TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- gate_submission: A versioned submission of a gate with its immutable evidence snapshot (REQ-S04-002).
CREATE TABLE gate_submission (
  id                          uuid PRIMARY KEY,
  organization_id             uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id           uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  gate_instance_id            uuid NOT NULL,
  gate_code                   text NOT NULL REFERENCES gate_definition (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  submission_no               integer NOT NULL CHECK (submission_no >= 1),
  status                      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'superseded', 'decided', 'withdrawn')),
  submitted_by                uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  submitted_at                timestamptz NOT NULL DEFAULT now(),
  submission_note             text NULL CHECK (submission_note IS NULL OR char_length(submission_note) BETWEEN 1 AND 4000),
  approver_role_code          text NOT NULL REFERENCES role (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  approver_user_id            uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  due_date                    date NULL,
  charter_id                  uuid NULL,
  charter_version_no          integer NULL,
  snapshot                    jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  snapshot_sha256             char(64) NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  superseded_at               timestamptz NULL,
  superseded_by_submission_id uuid NULL REFERENCES gate_submission (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version                     integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT gate_submission_gate_instance_id_fkey FOREIGN KEY (transformation_id, gate_instance_id) REFERENCES gate_instance (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT gate_submission_no_key UNIQUE (gate_instance_id, submission_no),
  CONSTRAINT gate_submission_instance_id_key UNIQUE (gate_instance_id, id),
  CONSTRAINT gate_submission_superseded_complete CHECK ((status = 'superseded') = (superseded_at IS NOT NULL) AND (superseded_at IS NULL) = (superseded_by_submission_id IS NULL)),
  CONSTRAINT gate_submission_charter_pair CHECK ((charter_id IS NULL) = (charter_version_no IS NULL)),
  CONSTRAINT gate_submission_charter_version_fkey FOREIGN KEY (charter_id, charter_version_no) REFERENCES charter_version (charter_id, version_no) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX gate_submission_one_pending_key ON gate_submission (gate_instance_id) WHERE status = 'pending';
-- The snapshot and every submission fact are frozen; only the lifecycle columns move, and only out of 'pending'.
CREATE FUNCTION gate_submission_freeze() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status', 'superseded_at', 'superseded_by_submission_id', 'version', 'updated_at', 'updated_by'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'superseded_at', 'superseded_by_submission_id', 'version', 'updated_at', 'updated_by']) THEN
    RAISE EXCEPTION 'gate_submission %: the submission and its evidence snapshot are immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_submission_immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'gate_submission %: % is final', OLD.id, OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_submission_status_final';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gate_submission_freeze BEFORE UPDATE ON gate_submission
  FOR EACH ROW EXECUTE FUNCTION gate_submission_freeze();
ALTER TABLE gate_instance ADD CONSTRAINT gate_instance_current_submission_fkey
  FOREIGN KEY (id, current_submission_id) REFERENCES gate_submission (gate_instance_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT;
SELECT p2_attach_guards('gate_submission', true);
GRANT SELECT, INSERT, UPDATE ON gate_submission TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- gate_submission_criterion: Per-criterion completeness frozen at submission (§4: criterion, required evidence, completeness).
CREATE TABLE gate_submission_criterion (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id  uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  gate_submission_id uuid NOT NULL REFERENCES gate_submission (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  criterion_key      text NOT NULL REFERENCES gate_criterion_definition (key) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ordinal            smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 20),
  mandatory          boolean NOT NULL,
  completeness       text NOT NULL CHECK (completeness IN ('complete', 'incomplete')),
  detail             jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  evaluated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gate_submission_criterion_key UNIQUE (gate_submission_id, criterion_key),
  CONSTRAINT gate_submission_criterion_mandatory_complete CHECK (NOT mandatory OR completeness = 'complete')
);
SELECT p2_attach_append_only('gate_submission_criterion');
SELECT p2_attach_guards('gate_submission_criterion', false);
GRANT SELECT, INSERT ON gate_submission_criterion TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- gate_decision: The approval record of a gate submission (assignee basis, request version, rationale, timestamp); specialises a canonical decision row of kind gate.
CREATE TABLE gate_decision (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id    uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  gate_submission_id   uuid NOT NULL CONSTRAINT gate_decision_gate_submission_id_key UNIQUE REFERENCES gate_submission (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decision_id          uuid NOT NULL CONSTRAINT gate_decision_decision_id_key UNIQUE,
  decision_kind        text NOT NULL DEFAULT 'gate' CHECK (decision_kind = 'gate'),
  gate_code            text NOT NULL REFERENCES gate_definition (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  submission_no        integer NOT NULL CHECK (submission_no >= 1),
  outcome              text NOT NULL CHECK (outcome IN ('approved', 'rejected', 'changes_requested', 'deferred')),
  rationale            text NOT NULL CHECK (char_length(rationale) BETWEEN 3 AND 8000),
  comments             text NULL CHECK (comments IS NULL OR char_length(comments) BETWEEN 1 AND 8000),
  decided_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  on_behalf_of_user_id uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_at           timestamptz NOT NULL DEFAULT now(),
  approver_basis       text NOT NULL CHECK (approver_basis IN ('configured_user', 'configured_role', 'default_role')),
  approver_role_code   text NOT NULL REFERENCES role (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT gate_decision_decision_fkey FOREIGN KEY (decision_id, decision_kind) REFERENCES decision (id, kind) ON DELETE RESTRICT ON UPDATE RESTRICT
);
-- Separation of duties and staleness, enforced again in the database (ADR-0015): the submitter (or someone acting on the
-- submitter's behalf) never decides, and only the current pending submission can be decided.
CREATE FUNCTION gate_decision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  s gate_submission%ROWTYPE;
BEGIN
  SELECT * INTO s FROM gate_submission WHERE id = NEW.gate_submission_id FOR UPDATE;
  IF NEW.decided_by = s.submitted_by OR NEW.on_behalf_of_user_id = s.submitted_by THEN
    RAISE EXCEPTION 'gate submission %: the submitter cannot decide it (separation of duties)', s.id
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'gate_decision_not_submitter';
  END IF;
  IF s.status <> 'pending' OR NEW.submission_no <> s.submission_no OR NEW.gate_code <> s.gate_code THEN
    RAISE EXCEPTION 'gate submission % (no %) is not the current pending submission', s.id, s.submission_no
      USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_decision_current_submission';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gate_decision_guard BEFORE INSERT ON gate_decision FOR EACH ROW EXECUTE FUNCTION gate_decision_guard();
SELECT p2_attach_append_only('gate_decision');
SELECT p2_attach_guards('gate_decision', true);
GRANT SELECT, INSERT ON gate_decision TO mth_app;

ALTER TABLE tom_gap ADD CONSTRAINT tom_gap_design_decision_fkey
  FOREIGN KEY (transformation_id, design_decision_id) REFERENCES decision (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT;
