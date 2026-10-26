-- 0099 P6 slice F: the organization upload policy and the detected content type of stored evidence files
-- (T-DG6-ARCH-01; ADR-0052 §1, §2). Authored by solution-architect. Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- REQ-S13-011 (M0255 "Support native evidence notes and common documents/images, with file-type/size controls and safe
-- preview/download"), D-195 Q4: the allow-list is PDF, DOCX, XLSX, PPTX, CSV, TXT, PNG, JPEG and GIF by magic bytes plus
-- extension, configurable by IT; SVG is download-only; files stored before P6 are untouched.
--   upload_policy          at most one row per organization (unique). No row = the built-in default of ADR-0052 §1
--                          (all ten types below, 26214400 bytes = 25 MiB, the DG2 EVIDENCE_MAX_BYTES ceiling). A row can
--                          only narrow it: allowed_types is a non-empty subset of the closed set, max_bytes is between
--                          1 and 26214400. Versioned and audited; every insert and update writes one row of the
--                          append-only history upload_policy_change (trigger, SECURITY DEFINER).
--   evidence_content       one nullable column detected_type (the type the magic-byte check found). Rows stored before
--                          P6 keep NULL ("not checked"): they stay downloadable as attachments and are never previewed
--                          inline (ADR-0052 §2). When detected_type is set, content_type must be its canonical media
--                          type (evidence_content_detected_media_type). Requiring detected_type on every NEW row is
--                          BE-D's migration 0101, merged with the upload change, so the DG2 upload path keeps working
--                          until then (p6-work-split §E/F).
-- Nothing here reads or writes DG0-DG7.

CREATE FUNCTION p6_upload_media_type(t text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE t
    WHEN 'pdf'  THEN 'application/pdf'
    WHEN 'docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    WHEN 'xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    WHEN 'pptx' THEN 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    WHEN 'csv'  THEN 'text/csv'
    WHEN 'txt'  THEN 'text/plain'
    WHEN 'png'  THEN 'image/png'
    WHEN 'jpeg' THEN 'image/jpeg'
    WHEN 'gif'  THEN 'image/gif'
    WHEN 'svg'  THEN 'image/svg+xml'
  END
$$;
COMMENT ON FUNCTION p6_upload_media_type(text) IS
  'The canonical media type of each upload type of the closed set (ADR-0052 §1); NULL for anything else.';
GRANT EXECUTE ON FUNCTION p6_upload_media_type(text) TO mth_app;

CREATE TABLE upload_policy (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT
                    CONSTRAINT upload_policy_organization_key UNIQUE,
  allowed_types   text[] NOT NULL CONSTRAINT upload_policy_allowed_types
                    CHECK (cardinality(allowed_types) BETWEEN 1 AND 10
                      AND allowed_types <@ ARRAY['pdf', 'docx', 'xlsx', 'pptx', 'csv', 'txt', 'png', 'jpeg', 'gif', 'svg']::text[]
                      AND array_position(allowed_types, NULL) IS NULL),
  max_bytes       bigint NOT NULL CONSTRAINT upload_policy_max_bytes CHECK (max_bytes BETWEEN 1 AND 26214400),
  reason          text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 1000),
  version         integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
SELECT p2_attach_guards('upload_policy', true);
GRANT SELECT, INSERT, UPDATE ON upload_policy TO mth_app;

CREATE TABLE upload_policy_change (
  id               uuid PRIMARY KEY,
  upload_policy_id uuid NOT NULL REFERENCES upload_policy (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  organization_id  uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_version   integer NOT NULL CHECK (record_version >= 1),
  allowed_types    text[] NOT NULL,
  max_bytes        bigint NOT NULL,
  reason           text NOT NULL,
  changed_by       uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  changed_at       timestamptz NOT NULL,
  CONSTRAINT upload_policy_change_version_key UNIQUE (upload_policy_id, record_version)
);
SELECT p2_attach_append_only('upload_policy_change');
GRANT SELECT ON upload_policy_change TO mth_app;

CREATE FUNCTION upload_policy_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO upload_policy_change (id, upload_policy_id, organization_id, record_version, allowed_types, max_bytes, reason,
    changed_by, changed_at)
  VALUES (mth_uuid_v7(), NEW.id, NEW.organization_id, NEW.version, NEW.allowed_types, NEW.max_bytes, NEW.reason,
    NEW.updated_by, NEW.updated_at);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION upload_policy_history() FROM PUBLIC;
CREATE TRIGGER upload_policy_history AFTER INSERT OR UPDATE ON upload_policy
  FOR EACH ROW EXECUTE FUNCTION upload_policy_history();

ALTER TABLE evidence_content
  ADD COLUMN detected_type text NULL
    CONSTRAINT evidence_content_detected_type CHECK (detected_type IS NULL
      OR detected_type IN ('pdf', 'docx', 'xlsx', 'pptx', 'csv', 'txt', 'png', 'jpeg', 'gif', 'svg')),
  ADD CONSTRAINT evidence_content_detected_media_type CHECK (detected_type IS NULL
    OR content_type = p6_upload_media_type(detected_type));
