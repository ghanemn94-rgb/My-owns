-- 0134 P7 slice D: configuration transfer bundles, their exports, uploaded imports, validated items and commits
-- (T-DG7-ARCH-02; ADR-0065). Authored by solution-architect. Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- REQ-S19-008 (acceptance "A06;A18: a bundle exported from the demo installation imports into a clean one, and its
-- published versions behave identically; a bundle with an unknown schema version is rejected").
--   config_bundle_export       one exported bundle (createConfigBundleExport): the organization, the kinds, the item
--                              count, the bundle's SHA-256 and size. The bytes are an object of the EvidenceStore
--                              (ADR-0065 §6). Written once in the request; append-only; audited (config_bundle.exported).
--   config_bundle_import       one uploaded bundle (uploadConfigBundleImport) into one organization. A bundle whose
--                              bundleSchemaVersion is unknown is refused at upload and never stored. States
--                              uploaded -> validated | invalid; validated -> validated (re-validated) | invalid |
--                              committed; invalid and committed are terminal. Versioned and audited.
--   config_bundle_import_item  one row per bundle item per validation run (validation_no), with the planned action:
--                              'create_draft' (the key does not exist), 'new_draft' (the key exists, the content
--                              differs: a new draft based on the latest published version), 'identical' (the content
--                              equals the latest published version: nothing is written), 'conflict' (an open draft of
--                              the key exists: nothing is written) or 'refused' (problem_code says why). Append-only.
--   config_bundle_import_commit one row per item the commit wrote, naming the record it created. For the seven kinds
--                              with drafts, a DRAFT that is never published by the commit: it goes through the kind's
--                              existing review and publish pipeline (ADR-0065 §5; seam 2). For the five kinds without a
--                              draft stage, the record the kind's own write path created (job schedules disabled).
--                              Append-only.
-- Nothing here reads or writes DG0-DG7. No code grants a business, Finance or IT approval.

CREATE TABLE config_bundle_export (
  id                     uuid PRIMARY KEY,
  organization_id        uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  bundle_schema_version  text NOT NULL CHECK (bundle_schema_version = 'mth-config-bundle/1'),
  source_environment     text NOT NULL CHECK (source_environment IN ('production', 'demo', 'unmarked')),
  kinds                  text[] NOT NULL CHECK (cardinality(kinds) BETWEEN 1 AND 12
                           AND array_position(kinds, NULL) IS NULL
                           AND kinds <@ ARRAY['methodology', 'scoring_defaults', 'form_schema', 'procedure',
                             'automation_rule_set', 'health_check_scheme', 'automation_rule', 'branding',
                             'notification_policy', 'job_schedule', 'config_review_policy', 'upload_policy']::text[]),
  item_count             integer NOT NULL CHECK (item_count >= 0),
  byte_size              bigint NOT NULL CHECK (byte_size > 0),
  sha256                 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX config_bundle_export_org_idx ON config_bundle_export (organization_id, created_at DESC, id);
SELECT p2_attach_guards('config_bundle_export', true);
SELECT p2_attach_append_only('config_bundle_export');
GRANT SELECT, INSERT ON config_bundle_export TO mth_app;

CREATE TABLE config_bundle_import (
  id                     uuid PRIMARY KEY,
  organization_id        uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  bundle_schema_version  text NOT NULL CHECK (bundle_schema_version = 'mth-config-bundle/1'),
  source_environment     text NOT NULL CHECK (source_environment IN ('production', 'demo', 'unmarked')),
  file_name              text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  byte_size              bigint NOT NULL CHECK (byte_size > 0),
  sha256                 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  item_count             integer NOT NULL CHECK (item_count >= 0),
  status                 text NOT NULL DEFAULT 'uploaded'
                           CHECK (status IN ('uploaded', 'validated', 'invalid', 'committed')),
  validation_no          integer NOT NULL DEFAULT 0 CHECK (validation_no >= 0),
  items_create           integer NULL CHECK (items_create IS NULL OR items_create >= 0),
  items_new_draft        integer NULL CHECK (items_new_draft IS NULL OR items_new_draft >= 0),
  items_identical        integer NULL CHECK (items_identical IS NULL OR items_identical >= 0),
  items_conflict         integer NULL CHECK (items_conflict IS NULL OR items_conflict >= 0),
  items_refused          integer NULL CHECK (items_refused IS NULL OR items_refused >= 0),
  validated_at           timestamptz NULL,
  validated_by           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  committed_at           timestamptz NULL,
  committed_by           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT config_bundle_import_validated_shape CHECK ((status = 'uploaded') = (validation_no = 0)
    AND (validation_no = 0) = (validated_at IS NULL) AND (validated_at IS NULL) = (validated_by IS NULL)
    AND (validated_at IS NULL) = (items_create IS NULL) AND (items_create IS NULL) = (items_new_draft IS NULL)
    AND (items_create IS NULL) = (items_identical IS NULL) AND (items_create IS NULL) = (items_conflict IS NULL)
    AND (items_create IS NULL) = (items_refused IS NULL)),
  CONSTRAINT config_bundle_import_committed_shape CHECK ((status = 'committed')
    = (committed_at IS NOT NULL AND committed_by IS NOT NULL) AND (committed_at IS NULL) = (committed_by IS NULL)),
  -- A bundle with a conflict or a refused item is 'invalid', never committable (ADR-0065 §4).
  CONSTRAINT config_bundle_import_committable CHECK (status NOT IN ('validated', 'committed')
    OR (items_conflict = 0 AND items_refused = 0))
);
CREATE INDEX config_bundle_import_org_idx ON config_bundle_import (organization_id, created_at DESC, id);
SELECT p2_attach_guards('config_bundle_import', true);
GRANT SELECT, INSERT ON config_bundle_import TO mth_app;
GRANT UPDATE (status, validation_no, items_create, items_new_draft, items_identical, items_conflict, items_refused,
  validated_at, validated_by, committed_at, committed_by, version, updated_at, updated_by) ON config_bundle_import
  TO mth_app;

CREATE FUNCTION config_bundle_import_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'uploaded' THEN
      RAISE EXCEPTION 'config_bundle_import: an import starts uploaded'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'config_bundle_import_transition';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('invalid', 'committed') THEN
    RAISE EXCEPTION 'config_bundle_import: an % import is immutable', OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'config_bundle_import_terminal_immutable';
  END IF;
  IF NOT ((OLD.status = 'uploaded' AND NEW.status IN ('validated', 'invalid'))
       OR (OLD.status = 'validated' AND NEW.status IN ('validated', 'invalid', 'committed'))) THEN
    RAISE EXCEPTION 'config_bundle_import: % -> % is not a transition', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'config_bundle_import_transition';
  END IF;
  IF NEW.status IN ('validated', 'invalid') AND NEW.validation_no <> OLD.validation_no + 1 THEN
    RAISE EXCEPTION 'config_bundle_import: every validation run increments validation_no by exactly 1'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'config_bundle_import_validation_step';
  END IF;
  IF NEW.status = 'committed' AND NEW.validation_no <> OLD.validation_no THEN
    RAISE EXCEPTION 'config_bundle_import: a commit uses the latest validation run'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'config_bundle_import_validation_step';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER config_bundle_import_guard BEFORE INSERT OR UPDATE ON config_bundle_import
  FOR EACH ROW EXECUTE FUNCTION config_bundle_import_guard();

CREATE TABLE config_bundle_import_item (
  id                      uuid PRIMARY KEY,
  config_bundle_import_id uuid NOT NULL REFERENCES config_bundle_import (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  validation_no           integer NOT NULL CHECK (validation_no >= 1),
  ordinal                 integer NOT NULL CHECK (ordinal >= 1),
  kind                    text NOT NULL CHECK (kind IN ('methodology', 'scoring_defaults', 'form_schema', 'procedure',
                            'automation_rule_set', 'health_check_scheme', 'automation_rule', 'branding',
                            'notification_policy', 'job_schedule', 'config_review_policy', 'upload_policy')),
  item_code               text NOT NULL CHECK (char_length(item_code) BETWEEN 1 AND 200
                            AND item_code ~ '^[a-z0-9][a-z0-9_.:-]*$'),
  source_version_no       integer NULL CHECK (source_version_no IS NULL OR source_version_no >= 1),
  content_sha256          text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  action                  text NOT NULL CHECK (action IN ('create_draft', 'new_draft', 'identical', 'conflict',
                            'refused')),
  problem_code            text NULL CHECK (problem_code IS NULL OR problem_code ~ '^config_bundle\.[a-z_]+$'),
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT config_bundle_import_item_order UNIQUE (config_bundle_import_id, validation_no, ordinal),
  CONSTRAINT config_bundle_import_item_code UNIQUE (config_bundle_import_id, validation_no, kind, item_code),
  CONSTRAINT config_bundle_import_item_problem CHECK ((action IN ('conflict', 'refused')) = (problem_code IS NOT NULL))
);
SELECT p2_attach_append_only('config_bundle_import_item');
GRANT SELECT, INSERT ON config_bundle_import_item TO mth_app;

CREATE TABLE config_bundle_import_commit (
  config_bundle_import_item_id uuid PRIMARY KEY
                                 REFERENCES config_bundle_import_item (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  target_record_type           text NOT NULL CHECK (target_record_type IN ('methodology_version',
                                 'automation_rule_version', 'branding_version', 'notification_policy', 'job_schedule',
                                 'config_review_policy', 'upload_policy')),
  target_record_id             uuid NOT NULL,
  created_at                   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX config_bundle_import_commit_target_idx ON config_bundle_import_commit (target_record_type, target_record_id);
SELECT p2_attach_append_only('config_bundle_import_commit');
GRANT SELECT, INSERT ON config_bundle_import_commit TO mth_app;

-- Only actions that write something are committed.
CREATE FUNCTION config_bundle_import_commit_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  a text;
BEGIN
  SELECT i.action INTO a FROM config_bundle_import_item i WHERE i.id = NEW.config_bundle_import_item_id;
  IF a IS DISTINCT FROM 'create_draft' AND a IS DISTINCT FROM 'new_draft' THEN
    RAISE EXCEPTION 'config_bundle_import_commit: only a create_draft or new_draft item is committed (got %)', a
      USING ERRCODE = 'check_violation', CONSTRAINT = 'config_bundle_import_commit_action';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER config_bundle_import_commit_guard BEFORE INSERT ON config_bundle_import_commit
  FOR EACH ROW EXECUTE FUNCTION config_bundle_import_commit_guard();
