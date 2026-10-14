-- 0063 P5 slice A: configuration pins for every Studio kind, methodology migration of a pinned transformation, and the
-- re-approval markers it creates (T-DG5-ARCH-01; ADR-0039 §3, ADR-0040; REQ-S06-008, REQ-PB-093, REQ-S16-012).
-- Authored by solution-architect. Contract: docs/architecture/data-dictionary.md ("P5 slice A"). Runs as mth_owner
-- inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- Additive on DG2: the transformation_config_pin kind CHECK is widened (the P4 polarity precedent, p5-plan §3 row 2);
-- existing 'methodology' pins are unchanged and stay valid. A migration never edits gate_submission, gate_decision or
-- any other approved record (they are frozen/append-only since 0017): it moves one pin, writes its plan and history,
-- and marks the gates that need a business re-approval (D-142 Q9). Approving a migration is a business approval made
-- by a person through the canonical approval (approval type methodology_migration); nothing here touches DG0-DG7.

-- -----------------------------------------------------------------------------------------------------------------
-- transformation_config_pin: one pin per transformation and configuration kind.
ALTER TABLE transformation_config_pin DROP CONSTRAINT transformation_config_pin_kind_check;
ALTER TABLE transformation_config_pin
  ADD CONSTRAINT transformation_config_pin_kind_check
    CHECK (kind IN ('methodology', 'scoring_defaults', 'form_schema', 'procedure', 'automation_rule_set', 'health_check_scheme')),
  ADD COLUMN last_migration_id uuid NULL;
-- The pinned version has the pin's kind and is published (or retired, for pins that predate a retirement).
-- A pin's version moves only through an approved methodology migration of the same transformation, kind, from and to.
CREATE FUNCTION transformation_config_pin_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v record;
BEGIN
  SELECT m.config_kind, m.status INTO v FROM methodology_version m WHERE m.id = NEW.methodology_version_id;
  IF v.config_kind IS DISTINCT FROM NEW.kind THEN
    RAISE EXCEPTION 'transformation_config_pin %: a % pin must name a % version', NEW.id, NEW.kind, NEW.kind
      USING ERRCODE = 'check_violation', CONSTRAINT = 'transformation_config_pin_kind_matches';
  END IF;
  IF TG_OP = 'INSERT' AND v.status <> 'published' THEN
    RAISE EXCEPTION 'transformation_config_pin %: a new pin names a published version', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'transformation_config_pin_published';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.kind IS DISTINCT FROM OLD.kind THEN
      RAISE EXCEPTION 'transformation_config_pin %: the kind never changes', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'transformation_config_pin_kind_fixed';
    END IF;
    IF NEW.methodology_version_id IS DISTINCT FROM OLD.methodology_version_id AND NOT EXISTS (
         SELECT 1 FROM methodology_migration g
         WHERE g.id = NEW.last_migration_id AND NEW.last_migration_id IS DISTINCT FROM OLD.last_migration_id
           AND g.transformation_id = NEW.transformation_id AND g.config_kind = NEW.kind
           AND g.from_version_id = OLD.methodology_version_id AND g.to_version_id = NEW.methodology_version_id
           AND g.status = 'approved') THEN
      RAISE EXCEPTION 'transformation_config_pin %: a pinned version moves only through its approved migration (REQ-S06-008)', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'transformation_config_pin_moves_by_migration';
    END IF;
    IF NEW.methodology_version_id IS NOT DISTINCT FROM OLD.methodology_version_id
       AND NEW.last_migration_id IS DISTINCT FROM OLD.last_migration_id THEN
      RAISE EXCEPTION 'transformation_config_pin %: last_migration_id changes only with the pinned version', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'transformation_config_pin_moves_by_migration';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transformation_config_pin_guard BEFORE INSERT OR UPDATE ON transformation_config_pin
  FOR EACH ROW EXECUTE FUNCTION transformation_config_pin_guard();

-- -----------------------------------------------------------------------------------------------------------------
-- methodology_migration: the deliberate, approved move of one pin (REQ-S06-008; ADR-0040 §1).
--   draft -> submitted | withdrawn
--   submitted -> approved | rejected | changes_requested | withdrawn
--   changes_requested -> submitted | withdrawn
--   approved -> executed | withdrawn
--   executed, rejected, withdrawn: final.
CREATE TABLE methodology_migration (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id   uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  config_kind         text NOT NULL CHECK (config_kind IN ('methodology', 'scoring_defaults', 'form_schema', 'procedure', 'automation_rule_set', 'health_check_scheme')),
  from_version_id     uuid NOT NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  to_version_id       uuid NOT NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'changes_requested', 'approved', 'rejected', 'withdrawn', 'executed')),
  reason              text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 4000),
  plan_revision       integer NOT NULL DEFAULT 1 CHECK (plan_revision >= 1),
  plan_sha256         char(64) NULL CHECK (plan_sha256 IS NULL OR plan_sha256 ~ '^[0-9a-f]{64}$'),
  plan_ready          boolean NOT NULL DEFAULT false,
  requested_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  submitted_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  submitted_at        timestamptz NULL,
  approval_id         uuid NULL REFERENCES approval (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_by          uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_at          timestamptz NULL,
  executed_by         uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  executed_at         timestamptz NULL,
  withdrawn_at        timestamptz NULL,
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT methodology_migration_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT methodology_migration_versions_differ CHECK (from_version_id <> to_version_id),
  CONSTRAINT methodology_migration_submitted_complete
    CHECK ((status = 'draft') = (submitted_at IS NULL) OR status = 'withdrawn'),
  CONSTRAINT methodology_migration_submitter CHECK ((submitted_by IS NULL) = (submitted_at IS NULL)),
  CONSTRAINT methodology_migration_decided_complete
    CHECK ((status IN ('approved', 'rejected', 'executed')) = (decided_by IS NOT NULL) OR (status = 'withdrawn')),
  CONSTRAINT methodology_migration_decider_not_requester CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT methodology_migration_executed_complete
    CHECK ((status = 'executed') = (executed_at IS NOT NULL) AND (executed_by IS NULL) = (executed_at IS NULL)),
  CONSTRAINT methodology_migration_withdrawn_complete CHECK ((status = 'withdrawn') = (withdrawn_at IS NOT NULL)),
  CONSTRAINT methodology_migration_ready_to_submit CHECK (status IN ('draft', 'withdrawn') OR (plan_ready AND plan_sha256 IS NOT NULL))
);
CREATE UNIQUE INDEX methodology_migration_one_open_key ON methodology_migration (transformation_id, config_kind)
  WHERE status IN ('draft', 'submitted', 'changes_requested', 'approved');
ALTER TABLE transformation_config_pin
  ADD CONSTRAINT transformation_config_pin_last_migration_fkey FOREIGN KEY (transformation_id, last_migration_id)
    REFERENCES methodology_migration (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE FUNCTION methodology_migration_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  fixed text[] := ARRAY['config_kind', 'from_version_id', 'to_version_id', 'requested_by'];
  content text[] := ARRAY['reason', 'plan_revision', 'plan_sha256', 'plan_ready'];
  f text;
  fv record;
  tv record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'methodology_migration %: a migration starts as a draft', NEW.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_migration_status_transition';
    END IF;
    SELECT m.config_kind, m.key, m.status, m.version_no INTO fv FROM methodology_version m WHERE m.id = NEW.from_version_id;
    SELECT m.config_kind, m.key, m.status, m.version_no INTO tv FROM methodology_version m WHERE m.id = NEW.to_version_id;
    IF fv.config_kind <> NEW.config_kind OR tv.config_kind <> NEW.config_kind OR fv.key <> tv.key
       OR tv.status <> 'published' THEN
      RAISE EXCEPTION 'methodology_migration %: from and to are versions of the same kind and key, and the target is published', NEW.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_migration_target_published';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM transformation_config_pin p WHERE p.transformation_id = NEW.transformation_id
                     AND p.kind = NEW.config_kind AND p.methodology_version_id = NEW.from_version_id) THEN
      RAISE EXCEPTION 'methodology_migration %: from_version_id must be the transformation''s current pin', NEW.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_migration_from_is_pin';
    END IF;
    RETURN NEW;
  END IF;
  FOREACH f IN ARRAY fixed LOOP
    IF to_jsonb(NEW)->f IS DISTINCT FROM to_jsonb(OLD)->f THEN
      RAISE EXCEPTION 'methodology_migration %: % never changes', OLD.id, f
        USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_migration_identity_fixed';
    END IF;
  END LOOP;
  IF OLD.status NOT IN ('draft', 'changes_requested') THEN
    FOREACH f IN ARRAY content LOOP
      IF to_jsonb(NEW)->f IS DISTINCT FROM to_jsonb(OLD)->f THEN
        RAISE EXCEPTION 'methodology_migration %: the plan changes only in draft or changes_requested', OLD.id
          USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_migration_plan_frozen';
      END IF;
    END LOOP;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY[
       'draft>submitted', 'draft>withdrawn', 'submitted>approved', 'submitted>rejected', 'submitted>changes_requested',
       'submitted>withdrawn', 'changes_requested>submitted', 'changes_requested>withdrawn', 'approved>executed',
       'approved>withdrawn']) THEN
    RAISE EXCEPTION 'methodology_migration %: % -> % is not a legal transition', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_migration_status_transition';
  END IF;
  -- approved, rejected and changes_requested need a person's matching decision on the migration's canonical approval
  -- (approval_decision.outcome approve / reject / request_changes); no job or trigger decides.
  IF NEW.status IN ('approved', 'rejected', 'changes_requested') AND NEW.status IS DISTINCT FROM OLD.status AND NOT EXISTS (
       SELECT 1 FROM approval a JOIN approval_decision d ON d.approval_id = a.id
       WHERE a.id = NEW.approval_id AND a.approval_type = 'methodology_migration' AND a.subject_id = NEW.id
         AND (NEW.status = 'changes_requested' OR d.decided_by = NEW.decided_by)
         AND d.outcome = CASE NEW.status WHEN 'approved' THEN 'approve' WHEN 'rejected' THEN 'reject'
                                         ELSE 'request_changes' END) THEN
    RAISE EXCEPTION 'methodology_migration %: % needs the decider''s matching approval decision', OLD.id, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_migration_outcome_needs_decision';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER methodology_migration_guard BEFORE INSERT OR UPDATE ON methodology_migration
  FOR EACH ROW EXECUTE FUNCTION methodology_migration_guard();
-- At COMMIT an executed migration has moved its pin: the pin names to_version_id and this migration.
CREATE FUNCTION methodology_migration_executed_moved_pin() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'executed' AND NOT EXISTS (
       SELECT 1 FROM transformation_config_pin p WHERE p.transformation_id = NEW.transformation_id
         AND p.kind = NEW.config_kind AND p.methodology_version_id = NEW.to_version_id AND p.last_migration_id = NEW.id) THEN
    RAISE EXCEPTION 'methodology_migration %: executed, but the % pin does not name the target version and this migration', NEW.id, NEW.config_kind
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'methodology_migration_executed_moved_pin';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER methodology_migration_executed_moved_pin AFTER UPDATE ON methodology_migration
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION methodology_migration_executed_moved_pin();
SELECT p2_attach_guards('methodology_migration', true);
GRANT SELECT, INSERT, UPDATE ON methodology_migration TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- methodology_migration_item: the plan of one revision (append-only; ADR-0040 §2). A new plan revision appends a new
-- set of items; earlier revisions stay readable.
CREATE TABLE methodology_migration_item (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  migration_id      uuid NOT NULL,
  plan_revision     integer NOT NULL CHECK (plan_revision >= 1),
  ordinal           integer NOT NULL CHECK (ordinal BETWEEN 1 AND 10000),
  item_kind         text NOT NULL CHECK (item_kind IN ('mapping', 'new_required_field', 'invalidated_calculation', 'reapproval', 'removed_element', 'unchanged_history')),
  element_type      text NULL CHECK (element_type IS NULL OR char_length(element_type) BETWEEN 1 AND 64),
  stable_key        text NULL CHECK (stable_key IS NULL OR char_length(stable_key) BETWEEN 1 AND 96),
  record_type       text NULL CHECK (record_type IS NULL OR record_type ~ '^[a-z_]{1,64}$'),
  record_id         uuid NULL,
  gate_code         text NULL CHECK (gate_code IS NULL OR gate_code ~ '^G[1-6]$'),
  resolution        text NOT NULL CHECK (resolution IN ('automatic', 'needs_input', 'provided', 'acknowledged')),
  detail            jsonb NOT NULL CHECK (jsonb_typeof(detail) = 'object'),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT methodology_migration_item_migration_fkey FOREIGN KEY (transformation_id, migration_id)
    REFERENCES methodology_migration (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT methodology_migration_item_ordinal_key UNIQUE (migration_id, plan_revision, ordinal),
  CONSTRAINT methodology_migration_item_reapproval_gate CHECK ((item_kind = 'reapproval') = (gate_code IS NOT NULL))
);
SELECT p2_attach_append_only('methodology_migration_item');
SELECT p2_attach_guards('methodology_migration_item', false);
GRANT SELECT, INSERT ON methodology_migration_item TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- transformation_config_pin_history: every move of a pin (append-only). Required at COMMIT for each pin version change.
CREATE TABLE transformation_config_pin_history (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  pin_id            uuid NOT NULL REFERENCES transformation_config_pin (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  pin_version       integer NOT NULL CHECK (pin_version >= 2),
  kind              text NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 64),
  from_version_id   uuid NOT NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  to_version_id     uuid NOT NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  migration_id      uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT transformation_config_pin_history_migration_fkey FOREIGN KEY (transformation_id, migration_id)
    REFERENCES methodology_migration (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT transformation_config_pin_history_version_key UNIQUE (pin_id, pin_version)
);
SELECT p2_attach_append_only('transformation_config_pin_history');
SELECT p2_attach_guards('transformation_config_pin_history', false);
GRANT SELECT, INSERT ON transformation_config_pin_history TO mth_app;
CREATE FUNCTION transformation_config_pin_history_required() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.methodology_version_id IS DISTINCT FROM OLD.methodology_version_id AND NOT EXISTS (
       SELECT 1 FROM transformation_config_pin_history h WHERE h.pin_id = NEW.id AND h.pin_version = NEW.version
         AND h.from_version_id = OLD.methodology_version_id AND h.to_version_id = NEW.methodology_version_id
         AND h.migration_id = NEW.last_migration_id) THEN
    RAISE EXCEPTION 'transformation_config_pin %: a moved pin needs its history row at version %', NEW.id, NEW.version
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'transformation_config_pin_history_required';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER transformation_config_pin_history_required AFTER UPDATE ON transformation_config_pin
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION transformation_config_pin_history_required();

-- -----------------------------------------------------------------------------------------------------------------
-- gate_reapproval: a product gate of a transformation that needs a business re-approval after a migration
-- (D-142 Q9; ADR-0040 §4). The approved gate_instance, its submissions, snapshot and decision stay as they are.
--   required -> satisfied (a later approved gate_decision of the same gate instance) | superseded (a later migration)
CREATE TABLE gate_reapproval (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id    uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  migration_id         uuid NOT NULL,
  gate_instance_id     uuid NOT NULL,
  gate_code            text NOT NULL CHECK (gate_code ~ '^G[1-6]$'),
  approved_decision_id uuid NOT NULL REFERENCES gate_decision (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status               text NOT NULL DEFAULT 'required' CHECK (status IN ('required', 'satisfied', 'superseded')),
  satisfied_decision_id uuid NULL REFERENCES gate_decision (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  work_item_id         uuid NULL REFERENCES work_item (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  resolved_at          timestamptz NULL,
  version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT gate_reapproval_migration_fkey FOREIGN KEY (transformation_id, migration_id)
    REFERENCES methodology_migration (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT gate_reapproval_gate_instance_fkey FOREIGN KEY (transformation_id, gate_instance_id)
    REFERENCES gate_instance (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT gate_reapproval_resolved_complete CHECK ((status = 'required') = (resolved_at IS NULL)),
  CONSTRAINT gate_reapproval_satisfied_complete CHECK ((status = 'satisfied') = (satisfied_decision_id IS NOT NULL)),
  CONSTRAINT gate_reapproval_migration_gate_key UNIQUE (migration_id, gate_code)
);
CREATE UNIQUE INDEX gate_reapproval_one_required_key ON gate_reapproval (gate_instance_id) WHERE status = 'required';
CREATE FUNCTION gate_reapproval_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  movable text[] := ARRAY['status', 'satisfied_decision_id', 'work_item_id', 'resolved_at', 'version', 'updated_at', 'updated_by'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'required' THEN
      RAISE EXCEPTION 'gate_reapproval %: a re-approval starts required', NEW.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_reapproval_status_transition';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM gate_decision d WHERE d.id = NEW.approved_decision_id AND d.outcome = 'approved'
                     AND d.transformation_id = NEW.transformation_id AND d.gate_code = NEW.gate_code) THEN
      RAISE EXCEPTION 'gate_reapproval %: names the approved decision of the same gate', NEW.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_reapproval_names_approved_decision';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - movable) IS DISTINCT FROM (to_jsonb(OLD) - movable) THEN
    RAISE EXCEPTION 'gate_reapproval %: only the resolution columns change', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_reapproval_frozen';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY[
       'required>satisfied', 'required>superseded']) THEN
    RAISE EXCEPTION 'gate_reapproval %: % -> % is not a legal transition', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_reapproval_status_transition';
  END IF;
  IF NEW.status = 'satisfied' AND NOT EXISTS (
       SELECT 1 FROM gate_decision d WHERE d.id = NEW.satisfied_decision_id AND d.outcome = 'approved'
         AND d.transformation_id = NEW.transformation_id AND d.gate_code = NEW.gate_code
         AND d.id <> NEW.approved_decision_id AND d.decided_at > NEW.created_at) THEN
    RAISE EXCEPTION 'gate_reapproval %: satisfied only by a later approved decision of the same gate', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_reapproval_satisfied_by_decision';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gate_reapproval_guard BEFORE INSERT OR UPDATE ON gate_reapproval
  FOR EACH ROW EXECUTE FUNCTION gate_reapproval_guard();
SELECT p2_attach_guards('gate_reapproval', true);
GRANT SELECT, INSERT, UPDATE ON gate_reapproval TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- Canonical approval type and work-item kinds (ADR-0026 catalogues; additive rows).
INSERT INTO approval_type (code, subject_table, default_sod_policy, requires_decision_right, owner_module, label_en, label_ar, source_ref) VALUES
  ('methodology_migration', 'methodology_migration', 'requester_excluded', false, 'methodology',
   'Methodology migration of a pinned transformation', 'ترحيل تحول مثبّت إلى إصدار منهجية أحدث', 'M0155');
INSERT INTO work_item_kind (code, owner_module, label_en, label_ar, source_ref) VALUES
  ('config_review', 'methodology', 'Configuration change to review', 'تغيير في الإعدادات بانتظار المراجعة', 'M0238'),
  ('gate_reapproval', 'workflows', 'Gate re-approval required after a methodology migration', 'إعادة اعتماد البوابة مطلوبة بعد ترحيل المنهجية', 'M0155');
