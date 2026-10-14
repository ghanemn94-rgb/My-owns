-- 0062 P5 slice A: Playbook Studio configuration model (T-DG5-ARCH-01; ADR-0039; REQ-S06-004, REQ-S06-006,
-- REQ-S06-007, REQ-S06-009, REQ-S12-018, REQ-S16-012). Authored by solution-architect.
-- Contract: docs/architecture/data-dictionary.md ("P5 slice A" section). Runs as mth_owner inside one transaction opened
-- by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16. Ids come from the application;
-- seed rows use fixed literal UUIDs.
--
-- D-142 Q1: the DG2 catalogue rows (gate_definition, phase_definition, tom_dimension, ...) stay the stable-identity
-- registry and are not changed here. Versioned attributes live in methodology_element rows keyed
-- (methodology_version_id, element_type, stable_key) and are resolved through the transformation's pin (ADR-0039 §2).
-- Every change below to a DG2 table is additive: new nullable/defaulted columns, a widened CHECK, new triggers that
-- only constrain rows written from now on, and an extra privilege. The DG2 immutability trigger
-- methodology_version_published_immutable and the DG2 CHECK methodology_version_published_complete are kept as they are.
-- Nothing here reads or writes the engineering gates DG0-DG7; no row here is a business approval.

-- -----------------------------------------------------------------------------------------------------------------
-- methodology_version: now the version header of every Studio configuration kind (ADR-0039 §1).
ALTER TABLE methodology_version
  ADD COLUMN config_kind text NOT NULL DEFAULT 'methodology'
    CONSTRAINT methodology_version_config_kind_check
    CHECK (config_kind IN ('methodology', 'scoring_defaults', 'form_schema', 'procedure', 'automation_rule_set', 'health_check_scheme')),
  ADD COLUMN draft_stage text NULL
    CONSTRAINT methodology_version_draft_stage_check
    CHECK (draft_stage IS NULL OR draft_stage IN ('editing', 'preview', 'review', 'approved', 'discarded')),
  ADD COLUMN origin text NOT NULL DEFAULT 'seed'
    CONSTRAINT methodology_version_origin_check CHECK (origin IN ('seed', 'draft', 'rollback')),
  ADD COLUMN based_on_version_id uuid NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN rollback_of_version_id uuid NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN change_summary text NULL
    CONSTRAINT methodology_version_change_summary_check
    CHECK (change_summary IS NULL OR char_length(change_summary) BETWEEN 1 AND 4000),
  ADD COLUMN discarded_at timestamptz NULL,
  ADD CONSTRAINT methodology_version_draft_stage_complete CHECK ((status = 'draft') = (draft_stage IS NOT NULL)),
  ADD CONSTRAINT methodology_version_rollback_complete
    CHECK ((origin = 'rollback') = (rollback_of_version_id IS NOT NULL)
           AND (origin <> 'rollback' OR change_summary IS NOT NULL)),
  ADD CONSTRAINT methodology_version_draft_lineage
    CHECK (origin = 'seed' OR (based_on_version_id IS NOT NULL AND created_by IS NOT NULL)),
  ADD CONSTRAINT methodology_version_discarded_complete CHECK (coalesce(draft_stage = 'discarded', false) = (discarded_at IS NOT NULL)),
  ADD CONSTRAINT methodology_version_publisher CHECK (status = 'draft' OR origin = 'seed' OR published_by IS NOT NULL);

-- One open (not discarded) draft per configuration kind and key: drafts never fork (ADR-0039 §4).
CREATE UNIQUE INDEX methodology_version_one_open_draft_key ON methodology_version (config_kind, key)
  WHERE status = 'draft' AND draft_stage <> 'discarded';
-- A key belongs to exactly one configuration kind.
CREATE FUNCTION methodology_version_kind_key() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM methodology_version m WHERE m.key = NEW.key AND m.config_kind <> NEW.config_kind) THEN
    RAISE EXCEPTION 'methodology_version %: key % already belongs to another configuration kind', NEW.id, NEW.key
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_version_kind_key';
  END IF;
  IF NEW.based_on_version_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM methodology_version b WHERE b.id = NEW.based_on_version_id AND b.config_kind = NEW.config_kind
         AND b.key = NEW.key AND b.status IN ('published', 'retired')) THEN
    RAISE EXCEPTION 'methodology_version %: a draft is based on a published version of the same kind and key', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_version_draft_lineage';
  END IF;
  IF NEW.rollback_of_version_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM methodology_version b WHERE b.id = NEW.rollback_of_version_id AND b.config_kind = NEW.config_kind
         AND b.key = NEW.key AND b.status IN ('published', 'retired')) THEN
    RAISE EXCEPTION 'methodology_version %: a rollback restores a published version of the same kind and key', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_version_rollback_complete';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER methodology_version_kind_key BEFORE INSERT ON methodology_version
  FOR EACH ROW EXECUTE FUNCTION methodology_version_kind_key();

-- The Studio lifecycle (ADR-0039 §4). Status: draft -> published -> retired (DG2 values). Draft stage:
--   editing -> preview | discarded            (preview = a passing preview run recorded for the current content)
--   preview -> editing | review | approved | discarded   (approved directly only when no review is required)
--   review  -> editing | approved | discarded (approved needs an approved config_review_request for the content)
--   approved -> editing | discarded           (publish: status -> published, draft_stage -> NULL)
-- Content (definition, content_sha256, title_en/ar, change_summary) changes only in editing or preview, and a content
-- change in preview must return the stage to editing. Kind, key, version_no, origin and lineage never change.
-- Publishing needs: draft_stage = approved; for exactly content_sha256 a 'pass' preview run and a 'pass' or 'warn'
-- compatibility run and (methodology kind) source_coverage run ('warn' = publishable with findings, e.g. a new
-- required field that a migration must map, or a source element whose feature is still planned); and, when the kind's review policy requires review, an approved review request for
-- exactly content_sha256.
CREATE FUNCTION methodology_version_studio_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  fixed text[] := ARRAY['config_kind', 'key', 'version_no', 'origin', 'based_on_version_id', 'rollback_of_version_id',
                        'source_document', 'source_sha256'];
  f text;
  content_changed boolean;
  needs_review boolean;
BEGIN
  FOREACH f IN ARRAY fixed LOOP
    IF to_jsonb(NEW)->f IS DISTINCT FROM to_jsonb(OLD)->f THEN
      RAISE EXCEPTION 'methodology_version %: % never changes (ADR-0039 §4)', OLD.id, f
        USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_version_identity_fixed';
    END IF;
  END LOOP;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY['draft>published', 'published>retired']) THEN
    RAISE EXCEPTION 'methodology_version %: % -> % is not a legal transition', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_version_status_transition';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'draft' AND NEW.draft_stage IS DISTINCT FROM OLD.draft_stage
     AND NOT (OLD.draft_stage || '>' || NEW.draft_stage) = ANY (ARRAY[
       'editing>preview', 'editing>discarded', 'preview>editing', 'preview>review', 'preview>approved',
       'preview>discarded', 'review>editing', 'review>approved', 'review>discarded', 'approved>editing',
       'approved>discarded']) THEN
    RAISE EXCEPTION 'methodology_version %: draft stage % -> % is not a legal transition', OLD.id, OLD.draft_stage, NEW.draft_stage
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_version_stage_transition';
  END IF;
  content_changed := NEW.definition IS DISTINCT FROM OLD.definition OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
                     OR NEW.title_en IS DISTINCT FROM OLD.title_en OR NEW.title_ar IS DISTINCT FROM OLD.title_ar
                     OR NEW.change_summary IS DISTINCT FROM OLD.change_summary;
  IF content_changed AND NOT (OLD.status = 'draft' AND OLD.draft_stage IN ('editing', 'preview')
                              AND NEW.status = 'draft' AND NEW.draft_stage = 'editing') THEN
    RAISE EXCEPTION 'methodology_version %: content changes only in a draft being edited (ADR-0039 §4)', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_version_content_frozen';
  END IF;
  IF NEW.draft_stage IN ('preview', 'review', 'approved') AND NEW.draft_stage IS DISTINCT FROM OLD.draft_stage THEN
    IF NOT EXISTS (SELECT 1 FROM config_check_run r WHERE r.methodology_version_id = NEW.id AND r.check_kind = 'preview'
                     AND r.content_sha256 = NEW.content_sha256 AND r.result = 'pass') THEN
      RAISE EXCEPTION 'methodology_version %: a passing preview run for the current content is required', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_version_preview_required';
    END IF;
  END IF;
  IF NEW.draft_stage = 'approved' AND OLD.draft_stage IS DISTINCT FROM 'approved' THEN
    SELECT coalesce((SELECT p.review_required FROM config_review_policy p WHERE p.config_kind = NEW.config_kind), true)
      INTO needs_review;
    IF needs_review AND NOT EXISTS (SELECT 1 FROM config_review_request q WHERE q.methodology_version_id = NEW.id
                                      AND q.content_sha256 = NEW.content_sha256 AND q.status = 'approved') THEN
      RAISE EXCEPTION 'methodology_version %: the configured review has not approved this content', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_version_review_required';
    END IF;
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'published' THEN
    IF NEW.config_kind = 'scoring_defaults' AND NOT EXISTS (
         SELECT 1 FROM methodology_element e WHERE e.methodology_version_id = NEW.id AND e.element_type = 'scoring_weight'
           AND NOT e.removed
         HAVING count(*) BETWEEN 2 AND 6 AND sum((e.attributes->>'weightPercent')::numeric) = 100) THEN
      RAISE EXCEPTION 'methodology_version %: default weights must total 100%% over 2-6 criteria (REQ-PB-093)', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_version_weights_total';
    END IF;
    IF OLD.draft_stage <> 'approved' OR NEW.draft_stage IS NOT NULL OR NEW.published_by IS NULL THEN
      RAISE EXCEPTION 'methodology_version %: only an approved draft is published, by a named person', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_version_publish_ready';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(CASE WHEN NEW.config_kind = 'methodology'
                                         THEN ARRAY['preview', 'compatibility', 'source_coverage']
                                         ELSE ARRAY['preview', 'compatibility'] END) AS k(kind)
               WHERE NOT EXISTS (SELECT 1 FROM config_check_run r WHERE r.methodology_version_id = NEW.id
                                   AND r.check_kind = k.kind AND r.content_sha256 = NEW.content_sha256
                                   AND (r.result = 'pass' OR (k.kind <> 'preview' AND r.result = 'warn')))) THEN
      RAISE EXCEPTION 'methodology_version %: publishing needs passing preview, compatibility and (methodology) source-coverage runs for the current content', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_version_checks_required';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER methodology_version_studio_guard BEFORE UPDATE ON methodology_version
  FOR EACH ROW EXECUTE FUNCTION methodology_version_studio_guard();
-- New rows start as Studio drafts (editing). The seeded rows are inserted by migrations as owner before this trigger
-- matters (the guard below lets the migration role through only while no row of the key exists).
CREATE FUNCTION methodology_version_new_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.origin = 'seed' THEN
    IF current_user <> 'mth_owner' AND current_user NOT IN (SELECT rolname FROM pg_roles WHERE rolsuper) THEN
      RAISE EXCEPTION 'methodology_version %: seeded versions are inserted by migrations only', NEW.id
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'methodology_version_seed_only';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status <> 'draft' OR NEW.draft_stage <> 'editing' OR NEW.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'methodology_version %: a Studio version is created as a draft being edited', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_version_created_as_draft';
  END IF;
  IF NEW.version_no <> coalesce((SELECT max(m.version_no) FROM methodology_version m WHERE m.key = NEW.key), 0) + 1 THEN
    RAISE EXCEPTION 'methodology_version %: version_no must be the next number of key %', NEW.id, NEW.key
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_version_next_number';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER methodology_version_new_draft BEFORE INSERT ON methodology_version
  FOR EACH ROW EXECUTE FUNCTION methodology_version_new_draft();
GRANT INSERT, UPDATE ON methodology_version TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- config_review_policy: whether a configuration kind needs a review before publish, and by which role (REQ-S06-007
-- "Review where configured"). One row per kind, seeded "review required", reviewer TO (FIN for benefit_formula) (ADR-0039 §5). Reviewer roles
-- never include AUD (read-only). The benefit_formula row is not a version kind: it names the reviewer of S12-018 tasks. A missing row reads as review required (the guard above uses coalesce(..., true)).
CREATE TABLE config_review_policy (
  id                 uuid PRIMARY KEY,
  config_kind        text NOT NULL CONSTRAINT config_review_policy_kind_key UNIQUE
                     CHECK (config_kind IN ('methodology', 'scoring_defaults', 'form_schema', 'procedure', 'automation_rule_set', 'health_check_scheme', 'benefit_formula')),
  review_required    boolean NOT NULL,
  reviewer_role_code text NOT NULL REFERENCES role (code) ON DELETE RESTRICT ON UPDATE RESTRICT
                     CONSTRAINT config_review_policy_reviewer_not_auditor CHECK (reviewer_role_code <> 'AUD'),
  version            integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
INSERT INTO config_review_policy (id, config_kind, review_required, reviewer_role_code) VALUES
  ('01920005-0001-7000-8000-000000000001', 'methodology', true, 'TO'),
  ('01920005-0001-7000-8000-000000000002', 'scoring_defaults', true, 'TO'),
  ('01920005-0001-7000-8000-000000000003', 'form_schema', true, 'TO'),
  ('01920005-0001-7000-8000-000000000004', 'procedure', true, 'TO'),
  ('01920005-0001-7000-8000-000000000005', 'automation_rule_set', true, 'TO'),
  ('01920005-0001-7000-8000-000000000006', 'health_check_scheme', true, 'TO'),
  -- A benefit formula revision is reviewed by the DG3 Finance validation (validateBenefitFormulaVersion, finance.validate);
  -- this row only names who receives the S12-018 review task (ADR-0039 §8).
  ('01920005-0001-7000-8000-000000000007', 'benefit_formula', true, 'FIN');
-- Guards attach after the seed (the seed has no audit event; every later write needs one).
SELECT p2_attach_guards('config_review_policy', true);
CREATE FUNCTION config_review_policy_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.config_kind IS DISTINCT FROM OLD.config_kind THEN
    RAISE EXCEPTION 'config_review_policy %: the kind never changes', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'config_review_policy_kind_fixed';
  END IF;
  IF (SELECT r.kind FROM role r WHERE r.code = NEW.reviewer_role_code) = 'technical_admin' THEN
    RAISE EXCEPTION 'config_review_policy %: a technical administrator role cannot be the reviewer of its own configuration', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'config_review_policy_reviewer_not_admin';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER config_review_policy_guard BEFORE UPDATE ON config_review_policy
  FOR EACH ROW EXECUTE FUNCTION config_review_policy_guard();
GRANT SELECT, UPDATE ON config_review_policy TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- source_element: the source-inventory registry of REQ-S02-001 (ADR-0039 §6): every counted source element with its
-- stable key, verbatim source label, the set it belongs to and the working feature that implements it. Seeded in 0064;
-- read-only for the application. feature_status is moved to 'working' by the migration of the task that ships the
-- feature (p5-work-split §A rule A-7), never by the API.
CREATE TABLE source_element (
  id              uuid PRIMARY KEY,
  set_code        text NOT NULL CHECK (set_code IN ('mode', 'phase', 'gate', 'template', 'tom_dimension', 'forum',
                                                   'benefit_lifecycle_step', 'launch_window', 'roaming_example', 'health_question')),
  stable_key      text NOT NULL CHECK (stable_key ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$'),
  ordinal         smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 99),
  source_label_en text NOT NULL CHECK (char_length(source_label_en) BETWEEN 1 AND 300),
  label_ar        text NOT NULL CHECK (char_length(label_ar) BETWEEN 1 AND 300),
  source_ref      text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 50),
  feature_ref     text NOT NULL CHECK (char_length(feature_ref) BETWEEN 1 AND 200),
  feature_status  text NOT NULL CHECK (feature_status IN ('working', 'planned')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_element_key UNIQUE (set_code, stable_key),
  CONSTRAINT source_element_ordinal_key UNIQUE (set_code, ordinal)
);
GRANT SELECT ON source_element TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- methodology_element: version-scoped attributes of one stable element (D-142 Q1; ADR-0039 §2). A row exists only
-- where a version differs from, or adds to, the DG2 catalogue; ConfigResolver reads the row, else the catalogue.
CREATE TABLE methodology_element (
  id                     uuid PRIMARY KEY,
  methodology_version_id uuid NOT NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  element_type           text NOT NULL CHECK (element_type IN (
                           'methodology_text', 'phase', 'gate', 'gate_criterion', 'mandatory_artifact', 'checklist_item',
                           'template', 'tom_dimension', 'approver_route', 'reminder', 'escalation_rule', 'dashboard',
                           'report_layout', 'source_element', 'scoring_weight', 'scoring_rubric')),
  stable_key             text NOT NULL CHECK (stable_key ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$'),
  origin                 text NOT NULL CHECK (origin IN ('source', 'admin')),
  removed                boolean NOT NULL DEFAULT false,
  ordinal                smallint NULL CHECK (ordinal IS NULL OR ordinal BETWEEN 1 AND 999),
  attributes             jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT methodology_element_key UNIQUE (methodology_version_id, element_type, stable_key),
  -- Fixed identity sets (REQ-S02-001, REQ-S06-006, D-142 Q4): phases, gates and TOM dimensions are never added by an
  -- admin and never removed.
  CONSTRAINT methodology_element_fixed_sets
    CHECK (element_type NOT IN ('phase', 'gate', 'tom_dimension') OR (origin = 'source' AND NOT removed))
);
CREATE INDEX methodology_element_version_idx ON methodology_element (methodology_version_id, element_type, ordinal);
-- Writes only into a draft being edited; identity columns never change; the element type must belong to the kind; a
-- source element names an existing catalogue identity; no approver attribute names a technical_admin role or AUD.
CREATE FUNCTION methodology_element_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v record;
  allowed text[];
  roles text[];
BEGIN
  SELECT m.status, m.draft_stage, m.config_kind INTO v FROM methodology_version m WHERE m.id = NEW.methodology_version_id;
  IF NOT (v.status = 'draft' AND v.draft_stage IN ('editing', 'preview'))
     AND current_user <> 'mth_owner' AND current_user NOT IN (SELECT rolname FROM pg_roles WHERE rolsuper) THEN
    RAISE EXCEPTION 'methodology_element %: elements change only in a draft being edited; a published version is immutable', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_element_draft_only';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.methodology_version_id IS DISTINCT FROM OLD.methodology_version_id
      OR NEW.element_type IS DISTINCT FROM OLD.element_type OR NEW.stable_key IS DISTINCT FROM OLD.stable_key
      OR NEW.origin IS DISTINCT FROM OLD.origin) THEN
    RAISE EXCEPTION 'methodology_element %: version, type, stable key and origin never change (REQ-S06-006)', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_element_identity_fixed';
  END IF;
  allowed := CASE v.config_kind
    WHEN 'methodology' THEN ARRAY['methodology_text', 'phase', 'gate', 'gate_criterion', 'mandatory_artifact',
                                  'checklist_item', 'template', 'tom_dimension', 'approver_route', 'reminder',
                                  'escalation_rule', 'dashboard', 'report_layout', 'source_element']
    WHEN 'scoring_defaults' THEN ARRAY['scoring_weight', 'scoring_rubric']
    ELSE ARRAY[]::text[] END;
  IF NOT NEW.element_type = ANY (allowed) THEN
    RAISE EXCEPTION 'methodology_element %: type % does not belong to configuration kind %', NEW.id, NEW.element_type, v.config_kind
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_element_kind_type';
  END IF;
  IF (NEW.origin = 'source' AND NOT (CASE NEW.element_type
       WHEN 'phase' THEN EXISTS (SELECT 1 FROM phase_definition d WHERE d.code = NEW.stable_key)
       WHEN 'gate' THEN EXISTS (SELECT 1 FROM gate_definition d WHERE d.code = NEW.stable_key)
       WHEN 'tom_dimension' THEN EXISTS (SELECT 1 FROM tom_dimension d WHERE d.code = NEW.stable_key)
       WHEN 'gate_criterion' THEN EXISTS (SELECT 1 FROM gate_criterion_definition d WHERE d.key = NEW.stable_key)
       WHEN 'template' THEN EXISTS (SELECT 1 FROM source_element s WHERE s.set_code = 'template' AND s.stable_key = NEW.stable_key)
       WHEN 'source_element' THEN EXISTS (SELECT 1 FROM source_element s WHERE s.set_code || '.' || s.stable_key = NEW.stable_key)
       ELSE true END))
     OR (NEW.element_type IN ('scoring_weight', 'scoring_rubric') AND NOT NEW.stable_key = ANY (ARRAY[
           'strategic_fit', 'financial_value', 'customer_impact', 'feasibility', 'time_to_value', 'risk_compliance'])) THEN
    RAISE EXCEPTION 'methodology_element %: % % is not a stable source identity', NEW.id, NEW.element_type, NEW.stable_key
      USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'methodology_element_source_identity';
  END IF;
  IF NEW.element_type = 'scoring_weight' AND NOT (jsonb_typeof(NEW.attributes->'weightPercent') = 'string'
       AND NEW.attributes->>'weightPercent' ~ '^(100(\.0{1,2})?|[0-9]{1,2}(\.[0-9]{1,2})?)$'
       AND (NEW.attributes->>'weightPercent')::numeric > 0) THEN
    RAISE EXCEPTION 'methodology_element %: weightPercent is a decimal string in (0, 100] with at most 2 decimals', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_element_weight_decimal';
  END IF;
  roles := ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(NEW.attributes->'approverRoleCodes') = 'array'
                                                        THEN NEW.attributes->'approverRoleCodes' ELSE '[]'::jsonb END))
           || ARRAY(SELECT NEW.attributes->>k FROM unnest(ARRAY['approverRoleCode', 'defaultApproverRoleCode']) AS k
                    WHERE NEW.attributes ? k);
  IF EXISTS (SELECT 1 FROM unnest(roles) AS c(code) LEFT JOIN role r ON r.code = c.code
             WHERE r.code IS NULL OR r.kind = 'technical_admin' OR r.code = 'AUD') THEN
    RAISE EXCEPTION 'methodology_element %: an approver must be an existing business role, never a technical administrator or AUD (REQ-S06-006, REQ-S10-003)', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_element_no_admin_approver';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER methodology_element_guard BEFORE INSERT OR UPDATE ON methodology_element
  FOR EACH ROW EXECUTE FUNCTION methodology_element_guard();
GRANT SELECT, INSERT, UPDATE ON methodology_element TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- config_check_run: one preview/test, compatibility, source-coverage or invariant run over exactly one content hash
-- of a version (append-only; ADR-0039 §5-§7). The report is a JSON object validated by the API (Zod).
CREATE TABLE config_check_run (
  id                     uuid PRIMARY KEY,
  methodology_version_id uuid NOT NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  check_kind             text NOT NULL CHECK (check_kind IN ('preview', 'compatibility', 'source_coverage', 'invariants')),
  content_sha256         char(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  result                 text NOT NULL CHECK (result IN ('pass', 'warn', 'fail')),
  report                 jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object'),
  run_by                 uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX config_check_run_version_idx ON config_check_run (methodology_version_id, check_kind, created_at DESC);
SELECT p2_attach_append_only('config_check_run');
SELECT p2_attach_guards('config_check_run', true);
GRANT SELECT, INSERT ON config_check_run TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- revision_proposal: the S12-018 starter's record (append-only; ADR-0039 §8): when a methodology/configuration revision
-- (a Studio draft submitted for review) or a formula revision (a new benefit_formula_version, DG3) is proposed, the
-- validation result, the impact (affected transformations, records and benefits) and the review routing, exactly once
-- per subject and content (dedupe_key UNIQUE; a replay inserts nothing).
CREATE TABLE revision_proposal (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id   uuid NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  subject_type        text NOT NULL CHECK (subject_type IN ('methodology_version', 'benefit_formula_version')),
  subject_id          uuid NOT NULL,
  subject_version     integer NOT NULL CHECK (subject_version >= 1),
  content_sha256      char(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  validation_result   text NOT NULL CHECK (validation_result IN ('pass', 'fail')),
  validation_report   jsonb NOT NULL CHECK (jsonb_typeof(validation_report) = 'object'),
  impact              jsonb NOT NULL CHECK (jsonb_typeof(impact) = 'object'),
  reviewer_role_code  text NOT NULL REFERENCES role (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  review_task_count   integer NOT NULL CHECK (review_task_count >= 0),
  dedupe_key          text NOT NULL CONSTRAINT revision_proposal_dedupe_key UNIQUE CHECK (char_length(dedupe_key) BETWEEN 1 AND 200),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT revision_proposal_scope CHECK ((subject_type = 'benefit_formula_version') = (transformation_id IS NOT NULL)),
  CONSTRAINT revision_proposal_dedupe_shape CHECK (dedupe_key = subject_type || ':' || subject_id::text || ':' || content_sha256)
);
CREATE INDEX revision_proposal_subject_idx ON revision_proposal (subject_type, subject_id, created_at DESC);
SELECT p2_attach_append_only('revision_proposal');
SELECT p2_attach_guards('revision_proposal', true);
GRANT SELECT, INSERT ON revision_proposal TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- config_review_request: the configured review of exactly one content hash of a draft (REQ-S06-007, REQ-S12-018).
--   pending -> approved | changes_requested | withdrawn; final otherwise.
-- The reviewer is never the requester nor the draft's author (SoD, ADR-0039 §5).
CREATE TABLE config_review_request (
  id                     uuid PRIMARY KEY,
  methodology_version_id uuid NOT NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  content_sha256         char(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  reviewer_role_code     text NOT NULL REFERENCES role (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status                 text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'changes_requested', 'withdrawn')),
  request_note           text NULL CHECK (request_note IS NULL OR char_length(request_note) BETWEEN 1 AND 4000),
  revision_proposal_id   uuid NULL REFERENCES revision_proposal (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  requested_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  requested_at           timestamptz NOT NULL DEFAULT now(),
  decided_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_at             timestamptz NULL,
  decision_note          text NULL CHECK (decision_note IS NULL OR char_length(decision_note) BETWEEN 1 AND 4000),
  version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT config_review_request_decided_complete
    CHECK ((status IN ('approved', 'changes_requested')) = (decided_by IS NOT NULL) AND (decided_by IS NULL) = (decided_at IS NULL)),
  CONSTRAINT config_review_request_reviewer_not_requester CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT config_review_request_changes_noted CHECK (status <> 'changes_requested' OR decision_note IS NOT NULL)
);
CREATE UNIQUE INDEX config_review_request_one_pending_key ON config_review_request (methodology_version_id) WHERE status = 'pending';
CREATE FUNCTION config_review_request_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  movable text[] := ARRAY['status', 'decided_by', 'decided_at', 'decision_note', 'version', 'updated_at', 'updated_by'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'config_review_request %: a review request starts pending', NEW.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'config_review_request_status_transition';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - movable) IS DISTINCT FROM (to_jsonb(OLD) - movable) THEN
    RAISE EXCEPTION 'config_review_request %: only the decision columns change', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'config_review_request_frozen';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY[
       'pending>approved', 'pending>changes_requested', 'pending>withdrawn']) THEN
    RAISE EXCEPTION 'config_review_request %: % -> % is not a legal transition', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'config_review_request_status_transition';
  END IF;
  IF NEW.decided_by IS NOT NULL AND NEW.decided_by = (SELECT m.created_by FROM methodology_version m WHERE m.id = NEW.methodology_version_id) THEN
    RAISE EXCEPTION 'config_review_request %: the author of a draft cannot review it (SoD)', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'config_review_request_reviewer_not_author';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER config_review_request_guard BEFORE INSERT OR UPDATE ON config_review_request
  FOR EACH ROW EXECUTE FUNCTION config_review_request_guard();
SELECT p2_attach_guards('config_review_request', true);
GRANT SELECT, INSERT, UPDATE ON config_review_request TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- Seed: the T06 scoring defaults v1 (REQ-PB-093, D-142 Q12). Weights VERBATIM from docs/source/playbook.md B0076
-- (25/25/20/15/15); B0077 names the optional risk/compliance criterion, which is not in the default set. The source
-- gives the 1-5 scale only and no descriptor text, so every rubric level is seeded with descriptor null, shown as
-- "No descriptor defined" (never invented). Arabic labels are PROVISIONAL translations needing review. content_sha256
-- of a seeded version is an opaque identity computed here; the API never recomputes it (ADR-0039 §3).
INSERT INTO methodology_version (id, key, version_no, status, title_en, title_ar, source_document, source_sha256,
                                 definition, content_sha256, published_at, config_kind, origin) VALUES
  ('01920005-0000-7000-8000-000000000001', 'scoring-defaults', 1, 'published',
   'T06 default weights and scoring rubric v1', 'الأوزان الافتراضية ومعايير التقييم للنموذج 6 — الإصدار 1 (ترجمة مؤقتة)',
   'docs/source/playbook.md (B0076, B0077)', NULL,
   '{"scale": {"min": 1, "max": 5}, "sourceRefs": ["B0076", "B0077"]}'::jsonb,
   encode(sha256(convert_to('scoring-defaults/1:B0076:25,25,20,15,15:descriptors-null', 'UTF8')), 'hex'),
   now(), 'scoring_defaults', 'seed');
INSERT INTO methodology_element (id, methodology_version_id, element_type, stable_key, origin, ordinal, attributes) VALUES
  ('01920005-0002-7000-8000-000000000001', '01920005-0000-7000-8000-000000000001', 'scoring_weight', 'strategic_fit', 'source', 1,
   '{"weightPercent": "25.00", "sourceLabelEn": "Strategic fit", "labelAr": "الملاءمة الاستراتيجية", "sourceRef": "B0076"}'),
  ('01920005-0002-7000-8000-000000000002', '01920005-0000-7000-8000-000000000001', 'scoring_weight', 'financial_value', 'source', 2,
   '{"weightPercent": "25.00", "sourceLabelEn": "Financial value", "labelAr": "القيمة المالية", "sourceRef": "B0076"}'),
  ('01920005-0002-7000-8000-000000000003', '01920005-0000-7000-8000-000000000001', 'scoring_weight', 'customer_impact', 'source', 3,
   '{"weightPercent": "20.00", "sourceLabelEn": "Customer impact", "labelAr": "الأثر على العملاء", "sourceRef": "B0076"}'),
  ('01920005-0002-7000-8000-000000000004', '01920005-0000-7000-8000-000000000001', 'scoring_weight', 'feasibility', 'source', 4,
   '{"weightPercent": "15.00", "sourceLabelEn": "Feasibility", "labelAr": "قابلية التنفيذ", "sourceRef": "B0076"}'),
  ('01920005-0002-7000-8000-000000000005', '01920005-0000-7000-8000-000000000001', 'scoring_weight', 'time_to_value', 'source', 5,
   '{"weightPercent": "15.00", "sourceLabelEn": "Time-to-value", "labelAr": "سرعة تحقيق القيمة", "sourceRef": "B0076"}'),
  ('01920005-0003-7000-8000-000000000001', '01920005-0000-7000-8000-000000000001', 'scoring_rubric', 'strategic_fit', 'source', 1,
   '{"levels": [{"score": 1, "descriptorEn": null, "descriptorAr": null}, {"score": 2, "descriptorEn": null, "descriptorAr": null}, {"score": 3, "descriptorEn": null, "descriptorAr": null}, {"score": 4, "descriptorEn": null, "descriptorAr": null}, {"score": 5, "descriptorEn": null, "descriptorAr": null}], "sourceRef": "B0076"}'),
  ('01920005-0003-7000-8000-000000000002', '01920005-0000-7000-8000-000000000001', 'scoring_rubric', 'financial_value', 'source', 2,
   '{"levels": [{"score": 1, "descriptorEn": null, "descriptorAr": null}, {"score": 2, "descriptorEn": null, "descriptorAr": null}, {"score": 3, "descriptorEn": null, "descriptorAr": null}, {"score": 4, "descriptorEn": null, "descriptorAr": null}, {"score": 5, "descriptorEn": null, "descriptorAr": null}], "sourceRef": "B0076"}'),
  ('01920005-0003-7000-8000-000000000003', '01920005-0000-7000-8000-000000000001', 'scoring_rubric', 'customer_impact', 'source', 3,
   '{"levels": [{"score": 1, "descriptorEn": null, "descriptorAr": null}, {"score": 2, "descriptorEn": null, "descriptorAr": null}, {"score": 3, "descriptorEn": null, "descriptorAr": null}, {"score": 4, "descriptorEn": null, "descriptorAr": null}, {"score": 5, "descriptorEn": null, "descriptorAr": null}], "sourceRef": "B0076"}'),
  ('01920005-0003-7000-8000-000000000004', '01920005-0000-7000-8000-000000000001', 'scoring_rubric', 'feasibility', 'source', 4,
   '{"levels": [{"score": 1, "descriptorEn": null, "descriptorAr": null}, {"score": 2, "descriptorEn": null, "descriptorAr": null}, {"score": 3, "descriptorEn": null, "descriptorAr": null}, {"score": 4, "descriptorEn": null, "descriptorAr": null}, {"score": 5, "descriptorEn": null, "descriptorAr": null}], "sourceRef": "B0076"}'),
  ('01920005-0003-7000-8000-000000000005', '01920005-0000-7000-8000-000000000001', 'scoring_rubric', 'time_to_value', 'source', 5,
   '{"levels": [{"score": 1, "descriptorEn": null, "descriptorAr": null}, {"score": 2, "descriptorEn": null, "descriptorAr": null}, {"score": 3, "descriptorEn": null, "descriptorAr": null}, {"score": 4, "descriptorEn": null, "descriptorAr": null}, {"score": 5, "descriptorEn": null, "descriptorAr": null}], "sourceRef": "B0076"}'),
  ('01920005-0003-7000-8000-000000000006', '01920005-0000-7000-8000-000000000001', 'scoring_rubric', 'risk_compliance', 'source', 6,
   '{"levels": [{"score": 1, "descriptorEn": null, "descriptorAr": null}, {"score": 2, "descriptorEn": null, "descriptorAr": null}, {"score": 3, "descriptorEn": null, "descriptorAr": null}, {"score": 4, "descriptorEn": null, "descriptorAr": null}, {"score": 5, "descriptorEn": null, "descriptorAr": null}], "sourceRef": "B0077", "optional": true}');

-- methodology_version and methodology_element are audited from now on (every Studio insert and update). The seeded
-- rows (0011 and above) predate the guards.
SELECT p2_attach_guards('methodology_version', true);
SELECT p2_attach_guards('methodology_element', true);
