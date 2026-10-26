-- 0105 P6 slice A: staged import batches and rows, commit lineage, signed webhook endpoints and their accepted receipts
-- (T-DG6-ARCH-03; ADR-0056). Authored by solution-architect. Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- REQ-S17-002 (M0334 "stage and validate imports before commit, detect duplicate source/period records, show row-level
-- errors and preserve source lineage") and REQ-S17-003 (M0334 "approved CSV/XLSX imports, documented APIs and
-- webhooks").
--   import_batch       one staged import into ONE transformation and ONE target kind ('kpi_actual' in P6). Pins the
--                      form schema version the transformation uses at staging time (p5_form_schema_version_for, ADR-0039
--                      §3 "never the latest"). States: staging -> staged | failed; staged -> committed | cancelled;
--                      committed, cancelled and failed never change. Counts are NULL until staged (Unknown, never 0),
--                      then valid + invalid + duplicates = total. Versioned and audited; trigger-written append-only
--                      history import_batch_event.
--   import_row         one row per source row (row_number = the source row; header row 1 for files). raw holds the
--                      cells as TEXT only (never a spreadsheet double). Exactly one of valid | invalid |
--                      duplicate_in_batch | duplicate_committed. At most one VALID row per (batch, duplicate key)
--                      (unique index). The only change after staging is commit_status pending -> committed |
--                      not_committed; 'committed' needs the row's lineage record first. Rows are covered by the
--                      batch's audit events (not audited one by one); DELETE is refused.
--   import_row_commit  lineage, append-only: the committed row -> the target record it created (kpi_actual and its
--                      value number). One per row.
--   webhook_endpoint   one signed endpoint per key, owned by a 'webhook' connector. The signing secret is a SecretRef
--                      (never a value); a rotation keeps the previous reference valid until previous_valid_until.
--                      active -> disabled (terminal). Versioned and audited; trigger-written append-only history
--                      webhook_endpoint_change.
--   webhook_receipt    append-only: one row per ACCEPTED delivery (signature valid, inside the timestamp window).
--                      UNIQUE (endpoint, delivery id) is the replay and idempotency backstop. Rejected requests are not
--                      stored (401 and a redacted log line, ADR-0056 §7).
--   integration_run.import_batch_id gets its foreign key here.
-- Nothing here reads or writes DG0-DG7. No code grants a business approval.

-- ---------------------------------------------------------------------------------------------------------------
-- webhook_endpoint
CREATE TABLE webhook_endpoint (
  id                    uuid PRIMARY KEY,
  organization_id       uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  connector_id          uuid NOT NULL,
  endpoint_key          text NOT NULL CONSTRAINT webhook_endpoint_key_key UNIQUE
                          CHECK (endpoint_key ~ '^[A-Za-z0-9_-]{32,64}$'),
  label                 text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  signing_secret_ref    jsonb NOT NULL CONSTRAINT webhook_endpoint_secret_ref
                          CHECK (signing_secret_ref IS NOT NULL AND p6_secret_ref_valid(signing_secret_ref)),
  previous_secret_ref   jsonb NULL CONSTRAINT webhook_endpoint_previous_secret_ref CHECK (p6_secret_ref_valid(previous_secret_ref)),
  previous_valid_until  timestamptz NULL,
  secret_rotated_at     timestamptz NULL,
  tolerance_seconds     integer NOT NULL DEFAULT 300 CHECK (tolerance_seconds BETWEEN 30 AND 900),
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  disabled_at           timestamptz NULL,
  disabled_by           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  disable_reason        text NULL CHECK (disable_reason IS NULL OR char_length(disable_reason) BETWEEN 3 AND 1000),
  version               integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT webhook_endpoint_connector_org_fkey FOREIGN KEY (organization_id, connector_id)
    REFERENCES connector (organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT webhook_endpoint_previous_shape CHECK ((previous_secret_ref IS NULL) = (previous_valid_until IS NULL)
    AND (previous_secret_ref IS NULL OR secret_rotated_at IS NOT NULL)
    AND (previous_secret_ref IS NULL OR previous_secret_ref <> signing_secret_ref)),
  CONSTRAINT webhook_endpoint_disabled_shape CHECK ((status = 'disabled') = (disabled_at IS NOT NULL)
    AND (disabled_at IS NULL) = (disabled_by IS NULL) AND (disabled_at IS NULL) = (disable_reason IS NULL))
);
CREATE INDEX webhook_endpoint_list_idx ON webhook_endpoint (organization_id, status, created_at DESC, id DESC);
SELECT p2_attach_guards('webhook_endpoint', true);
GRANT SELECT, INSERT, UPDATE ON webhook_endpoint TO mth_app;

CREATE FUNCTION webhook_endpoint_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'active' OR NEW.previous_secret_ref IS NOT NULL THEN
      RAISE EXCEPTION 'webhook_endpoint: an endpoint is created active, with one secret reference'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'webhook_endpoint_transition';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM connector c WHERE c.id = NEW.connector_id AND c.adapter_kind = 'webhook') THEN
      RAISE EXCEPTION 'webhook_endpoint: the owning connector must be a webhook connector'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'webhook_endpoint_connector_kind';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'disabled' THEN
    RAISE EXCEPTION 'webhook_endpoint: a disabled endpoint never changes (create a new endpoint)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'webhook_endpoint_final';
  END IF;
  IF (NEW.connector_id, NEW.endpoint_key) IS DISTINCT FROM (OLD.connector_id, OLD.endpoint_key) THEN
    RAISE EXCEPTION 'webhook_endpoint: the connector and the endpoint key never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'webhook_endpoint_identity_fixed';
  END IF;
  IF NEW.signing_secret_ref IS DISTINCT FROM OLD.signing_secret_ref
     AND (NEW.previous_secret_ref IS DISTINCT FROM OLD.signing_secret_ref
          OR NEW.secret_rotated_at IS NULL OR NEW.secret_rotated_at IS NOT DISTINCT FROM OLD.secret_rotated_at
          OR NEW.previous_valid_until > NEW.secret_rotated_at + interval '7 days') THEN
    RAISE EXCEPTION 'webhook_endpoint: a rotation keeps the old reference as the previous one, valid for at most 7 days'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'webhook_endpoint_rotation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER webhook_endpoint_guard BEFORE INSERT OR UPDATE ON webhook_endpoint
  FOR EACH ROW EXECUTE FUNCTION webhook_endpoint_guard();

CREATE TABLE webhook_endpoint_change (
  id                   uuid PRIMARY KEY,
  webhook_endpoint_id  uuid NOT NULL REFERENCES webhook_endpoint (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_version       integer NOT NULL CHECK (record_version >= 1),
  status               text NOT NULL,
  signing_secret_ref   jsonb NOT NULL,
  previous_secret_ref  jsonb NULL,
  previous_valid_until timestamptz NULL,
  tolerance_seconds    integer NOT NULL,
  changed_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  changed_at           timestamptz NOT NULL,
  CONSTRAINT webhook_endpoint_change_version_key UNIQUE (webhook_endpoint_id, record_version)
);
SELECT p2_attach_append_only('webhook_endpoint_change');
GRANT SELECT ON webhook_endpoint_change TO mth_app;

CREATE FUNCTION webhook_endpoint_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO webhook_endpoint_change (id, webhook_endpoint_id, record_version, status, signing_secret_ref,
    previous_secret_ref, previous_valid_until, tolerance_seconds, changed_by, changed_at)
  VALUES (mth_uuid_v7(), NEW.id, NEW.version, NEW.status, NEW.signing_secret_ref, NEW.previous_secret_ref,
    NEW.previous_valid_until, NEW.tolerance_seconds, NEW.updated_by, NEW.updated_at);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION webhook_endpoint_history() FROM PUBLIC;
CREATE TRIGGER webhook_endpoint_history AFTER INSERT OR UPDATE ON webhook_endpoint
  FOR EACH ROW EXECUTE FUNCTION webhook_endpoint_history();

-- ---------------------------------------------------------------------------------------------------------------
-- webhook_receipt (accepted deliveries only)
CREATE TABLE webhook_receipt (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  webhook_endpoint_id uuid NOT NULL REFERENCES webhook_endpoint (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  delivery_id         text NOT NULL CHECK (delivery_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  signed_at           timestamptz NOT NULL,
  received_at         timestamptz NOT NULL,
  secret_slot         text NOT NULL CHECK (secret_slot IN ('current', 'previous')),
  body_sha256         char(64) NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  body_bytes          integer NOT NULL CHECK (body_bytes BETWEEN 2 AND 1048576),
  item_count          integer NOT NULL CHECK (item_count BETWEEN 0 AND 5000),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_receipt_delivery_key UNIQUE (webhook_endpoint_id, delivery_id),
  CONSTRAINT webhook_receipt_window CHECK (received_at - signed_at BETWEEN interval '-900 seconds' AND interval '900 seconds')
);
CREATE INDEX webhook_receipt_list_idx ON webhook_receipt (webhook_endpoint_id, received_at DESC, id DESC);
SELECT p2_attach_append_only('webhook_receipt');
GRANT SELECT, INSERT ON webhook_receipt TO mth_app;

CREATE FUNCTION webhook_receipt_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  e record;
BEGIN
  SELECT * INTO e FROM webhook_endpoint WHERE id = NEW.webhook_endpoint_id;
  IF NOT FOUND OR e.status <> 'active' OR e.organization_id <> NEW.organization_id
     OR abs(extract(epoch FROM NEW.received_at - NEW.signed_at)) > e.tolerance_seconds
     OR (NEW.secret_slot = 'previous' AND (e.previous_valid_until IS NULL OR NEW.received_at > e.previous_valid_until)) THEN
    RAISE EXCEPTION 'webhook_receipt: only an active endpoint accepts a delivery, inside its time window and with a valid secret slot'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'webhook_receipt_accepted_only';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER webhook_receipt_guard BEFORE INSERT ON webhook_receipt
  FOR EACH ROW EXECUTE FUNCTION webhook_receipt_guard();

-- ---------------------------------------------------------------------------------------------------------------
-- import_batch
CREATE TABLE import_batch (
  id                     uuid PRIMARY KEY,
  organization_id        uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id      uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  target_kind            text NOT NULL CHECK (target_kind IN ('kpi_actual')),
  template_version       text NOT NULL CHECK (template_version ~ '^[a-z][a-z0-9_]*\.v[1-9][0-9]*$'),
  form_schema_version_id uuid NOT NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  source_kind            text NOT NULL CHECK (source_kind IN ('csv_upload', 'xlsx_upload', 'webhook', 'connector')),
  connector_id           uuid NULL REFERENCES connector (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  integration_run_id     uuid NULL REFERENCES integration_run (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  webhook_receipt_id     uuid NULL CONSTRAINT import_batch_webhook_receipt_key UNIQUE
                           REFERENCES webhook_receipt (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  file_name              text NULL CHECK (file_name IS NULL OR char_length(file_name) BETWEEN 1 AND 255),
  media_type             text NULL CHECK (media_type IS NULL OR media_type IN ('text/csv',
                           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/json')),
  byte_size              integer NULL CHECK (byte_size IS NULL OR byte_size BETWEEN 1 AND 10485760),
  content_sha256         char(64) NULL CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'),
  status                 text NOT NULL DEFAULT 'staging' CHECK (status IN ('staging', 'staged', 'committed', 'cancelled', 'failed')),
  rows_total             integer NULL CHECK (rows_total IS NULL OR rows_total BETWEEN 0 AND 5000),
  rows_valid             integer NULL CHECK (rows_valid IS NULL OR rows_valid >= 0),
  rows_invalid           integer NULL CHECK (rows_invalid IS NULL OR rows_invalid >= 0),
  rows_duplicate         integer NULL CHECK (rows_duplicate IS NULL OR rows_duplicate >= 0),
  rows_committed         integer NULL CHECK (rows_committed IS NULL OR rows_committed >= 0),
  failure_code           text NULL CHECK (failure_code IS NULL OR (char_length(failure_code) BETWEEN 1 AND 100
                           AND failure_code ~ '^[a-z][a-z0-9_.]*$')),
  commit_mode            text NOT NULL DEFAULT 'manual' CHECK (commit_mode IN ('manual', 'auto')),
  on_behalf_of_user_id   uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  committed_at           timestamptz NULL,
  committed_by           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  cancelled_at           timestamptz NULL,
  cancelled_by           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  cancel_reason          text NULL CHECK (cancel_reason IS NULL OR char_length(cancel_reason) BETWEEN 3 AND 1000),
  version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT import_batch_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT import_batch_source_shape CHECK (
    (source_kind IN ('csv_upload', 'xlsx_upload') AND file_name IS NOT NULL AND media_type IS NOT NULL
      AND byte_size IS NOT NULL AND content_sha256 IS NOT NULL AND connector_id IS NULL AND integration_run_id IS NULL
      AND webhook_receipt_id IS NULL AND created_by IS NOT NULL AND commit_mode = 'manual'
      AND media_type = CASE source_kind WHEN 'csv_upload' THEN 'text/csv'
                       ELSE 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' END)
    OR (source_kind = 'webhook' AND webhook_receipt_id IS NOT NULL AND connector_id IS NOT NULL
      AND integration_run_id IS NULL AND file_name IS NULL AND media_type = 'application/json' AND created_by IS NULL)
    OR (source_kind = 'connector' AND connector_id IS NOT NULL AND integration_run_id IS NOT NULL
      AND webhook_receipt_id IS NULL AND file_name IS NULL AND created_by IS NULL)),
  CONSTRAINT import_batch_commit_mode CHECK ((commit_mode = 'auto') = (on_behalf_of_user_id IS NOT NULL)),
  CONSTRAINT import_batch_counts CHECK (
    (status = 'staging' AND rows_total IS NULL AND rows_valid IS NULL AND rows_invalid IS NULL AND rows_duplicate IS NULL)
    OR (status = 'failed' AND rows_total IS NULL)
    OR (status IN ('staged', 'committed', 'cancelled') AND rows_total IS NOT NULL
        AND rows_valid + rows_invalid + rows_duplicate = rows_total)),
  CONSTRAINT import_batch_committed_shape CHECK ((status = 'committed') = (committed_at IS NOT NULL)
    AND (status = 'committed') = (rows_committed IS NOT NULL)
    AND (rows_committed IS NULL OR rows_committed <= rows_valid)
    AND (committed_by IS NULL OR committed_at IS NOT NULL)
    AND (status <> 'committed' OR committed_by IS NOT NULL OR commit_mode = 'auto')),
  CONSTRAINT import_batch_cancelled_shape CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)
    AND (cancelled_at IS NULL) = (cancel_reason IS NULL) AND (cancelled_by IS NULL OR cancelled_at IS NOT NULL)),
  CONSTRAINT import_batch_failed_shape CHECK ((status = 'failed') = (failure_code IS NOT NULL))
);
CREATE INDEX import_batch_list_idx ON import_batch (transformation_id, created_at DESC, id DESC);
CREATE INDEX import_batch_connector_idx ON import_batch (connector_id, created_at DESC) WHERE connector_id IS NOT NULL;
SELECT p2_attach_guards('import_batch', true);
GRANT SELECT, INSERT, UPDATE ON import_batch TO mth_app;

ALTER TABLE integration_run
  ADD CONSTRAINT integration_run_import_batch_fkey FOREIGN KEY (import_batch_id) REFERENCES import_batch (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION import_batch_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'staging' THEN
      RAISE EXCEPTION 'import_batch: a batch is created staging'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'import_batch_transition';
    END IF;
    IF NEW.form_schema_version_id <> p5_form_schema_version_for(NEW.transformation_id) THEN
      RAISE EXCEPTION 'import_batch: the batch pins the form schema version the transformation uses (ADR-0039 §3)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'import_batch_form_schema_pinned';
    END IF;
    IF NEW.connector_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM connector c WHERE c.id = NEW.connector_id AND c.organization_id = NEW.organization_id
           AND c.target_kind = NEW.target_kind
           AND c.adapter_kind = CASE NEW.source_kind WHEN 'webhook' THEN 'webhook' ELSE c.adapter_kind END) THEN
      RAISE EXCEPTION 'import_batch: the connector belongs to the organization and stages this target kind'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'import_batch_connector_matches';
    END IF;
    IF NEW.webhook_receipt_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM webhook_receipt r JOIN webhook_endpoint e ON e.id = r.webhook_endpoint_id
          WHERE r.id = NEW.webhook_receipt_id AND e.connector_id = NEW.connector_id) THEN
      RAISE EXCEPTION 'import_batch: the webhook receipt belongs to an endpoint of the batch''s connector'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'import_batch_connector_matches';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('committed', 'cancelled', 'failed') THEN
    RAISE EXCEPTION 'import_batch: a committed, cancelled or failed batch never changes'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'import_batch_final';
  END IF;
  IF (NEW.target_kind, NEW.template_version, NEW.form_schema_version_id, NEW.source_kind, NEW.connector_id,
      NEW.integration_run_id, NEW.webhook_receipt_id, NEW.file_name, NEW.media_type, NEW.byte_size, NEW.content_sha256,
      NEW.commit_mode, NEW.on_behalf_of_user_id)
     IS DISTINCT FROM (OLD.target_kind, OLD.template_version, OLD.form_schema_version_id, OLD.source_kind, OLD.connector_id,
      OLD.integration_run_id, OLD.webhook_receipt_id, OLD.file_name, OLD.media_type, OLD.byte_size, OLD.content_sha256,
      OLD.commit_mode, OLD.on_behalf_of_user_id) THEN
    RAISE EXCEPTION 'import_batch: the target, pinned schema, source and commit mode never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'import_batch_identity_fixed';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'staging' AND NEW.status IN ('staged', 'failed'))
       OR (OLD.status = 'staged' AND NEW.status IN ('committed', 'cancelled'))) THEN
    RAISE EXCEPTION 'import_batch: % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'import_batch_transition';
  END IF;
  IF OLD.status = 'staged' AND (NEW.rows_total, NEW.rows_valid, NEW.rows_invalid, NEW.rows_duplicate)
     IS DISTINCT FROM (OLD.rows_total, OLD.rows_valid, OLD.rows_invalid, OLD.rows_duplicate) THEN
    RAISE EXCEPTION 'import_batch: the staged counts never change after staging'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'import_batch_identity_fixed';
  END IF;
  IF NEW.status = 'staged' AND OLD.status = 'staging' AND NEW.rows_total <> (SELECT count(*) FROM import_row r WHERE r.import_batch_id = NEW.id) THEN
    RAISE EXCEPTION 'import_batch: the staged total equals the number of staged rows'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'import_batch_counts_match_rows';
  END IF;
  IF NEW.status = 'committed' AND NEW.rows_committed <> (SELECT count(*) FROM import_row r
       WHERE r.import_batch_id = NEW.id AND r.commit_status = 'committed') THEN
    RAISE EXCEPTION 'import_batch: the committed count equals the number of committed rows'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'import_batch_counts_match_rows';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER import_batch_guard BEFORE INSERT OR UPDATE ON import_batch
  FOR EACH ROW EXECUTE FUNCTION import_batch_guard();

CREATE TABLE import_batch_event (
  id              uuid PRIMARY KEY,
  import_batch_id uuid NOT NULL REFERENCES import_batch (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_version  integer NOT NULL CHECK (record_version >= 1),
  status          text NOT NULL,
  rows_total      integer NULL,
  rows_valid      integer NULL,
  rows_invalid    integer NULL,
  rows_duplicate  integer NULL,
  rows_committed  integer NULL,
  failure_code    text NULL,
  actor_user_id   uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  occurred_at     timestamptz NOT NULL,
  CONSTRAINT import_batch_event_version_key UNIQUE (import_batch_id, record_version)
);
SELECT p2_attach_append_only('import_batch_event');
GRANT SELECT ON import_batch_event TO mth_app;

CREATE FUNCTION import_batch_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO import_batch_event (id, import_batch_id, record_version, status, rows_total, rows_valid, rows_invalid,
    rows_duplicate, rows_committed, failure_code, actor_user_id, occurred_at)
  VALUES (mth_uuid_v7(), NEW.id, NEW.version, NEW.status, NEW.rows_total, NEW.rows_valid, NEW.rows_invalid,
    NEW.rows_duplicate, NEW.rows_committed, NEW.failure_code, NEW.updated_by, NEW.updated_at);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION import_batch_history() FROM PUBLIC;
CREATE TRIGGER import_batch_history AFTER INSERT OR UPDATE ON import_batch
  FOR EACH ROW EXECUTE FUNCTION import_batch_history();

-- ---------------------------------------------------------------------------------------------------------------
-- import_row
CREATE FUNCTION p6_import_raw_valid(r jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_typeof(r) = 'object'
    AND (SELECT count(*) FROM jsonb_object_keys(r)) <= 50
    AND octet_length(r::text) <= 32768
    AND NOT EXISTS (SELECT 1 FROM jsonb_each(r) AS e(k, v)
                    WHERE char_length(e.k) NOT BETWEEN 1 AND 100 OR jsonb_typeof(e.v) NOT IN ('string', 'null'))
$$;
COMMENT ON FUNCTION p6_import_raw_valid(jsonb) IS
  'Raw import cells (ADR-0056 §3): at most 50 columns, every value a string or null (never a number parsed from a spreadsheet double).';
GRANT EXECUTE ON FUNCTION p6_import_raw_valid(jsonb) TO mth_app;

CREATE FUNCTION p6_import_reasons_valid(r jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_typeof(r) = 'array' AND jsonb_array_length(r) <= 20
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r) AS e(v)
                    WHERE jsonb_typeof(e.v) <> 'object' OR jsonb_typeof(e.v->'code') <> 'string'
                       OR (e.v->>'code') !~ '^import\.row\.[a-z_]+$'
                       OR (e.v ? 'field' AND jsonb_typeof(e.v->'field') NOT IN ('string', 'null'))
                       OR (e.v ? 'params' AND jsonb_typeof(e.v->'params') <> 'object')
                       OR EXISTS (SELECT 1 FROM jsonb_object_keys(e.v) AS k WHERE k NOT IN ('code', 'field', 'params')))
$$;
COMMENT ON FUNCTION p6_import_reasons_valid(jsonb) IS
  'Row-level reasons (ADR-0056 §5): at most 20 {code, field?, params?}; codes import.row.*, rendered in en or ar at render time.';
GRANT EXECUTE ON FUNCTION p6_import_reasons_valid(jsonb) TO mth_app;

CREATE TABLE import_row (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id   uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  import_batch_id     uuid NOT NULL,
  row_number          integer NOT NULL CHECK (row_number BETWEEN 1 AND 100000),
  source_record_id    text NULL CHECK (source_record_id IS NULL OR char_length(source_record_id) BETWEEN 1 AND 200),
  raw                 jsonb NOT NULL CONSTRAINT import_row_raw CHECK (p6_import_raw_valid(raw)),
  normalized          jsonb NULL CHECK (normalized IS NULL OR jsonb_typeof(normalized) = 'object'),
  duplicate_key       text NULL CHECK (duplicate_key IS NULL OR char_length(duplicate_key) BETWEEN 1 AND 400),
  validation_status   text NOT NULL CHECK (validation_status IN ('valid', 'invalid', 'duplicate_in_batch', 'duplicate_committed')),
  duplicate_of_row_id uuid NULL REFERENCES import_row (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  reasons             jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT import_row_reasons CHECK (p6_import_reasons_valid(reasons)),
  commit_status       text NOT NULL DEFAULT 'pending' CHECK (commit_status IN ('pending', 'committed', 'not_committed')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_row_batch_fkey FOREIGN KEY (transformation_id, import_batch_id)
    REFERENCES import_batch (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT import_row_number_key UNIQUE (import_batch_id, row_number),
  CONSTRAINT import_row_valid_shape CHECK ((validation_status = 'valid') = (normalized IS NOT NULL)
    AND (validation_status = 'valid') = (jsonb_array_length(reasons) = 0)
    AND (validation_status = 'valid' OR commit_status <> 'committed')
    AND (validation_status NOT IN ('valid', 'duplicate_in_batch', 'duplicate_committed') OR duplicate_key IS NOT NULL)),
  CONSTRAINT import_row_duplicate_shape CHECK ((validation_status = 'duplicate_in_batch') = (duplicate_of_row_id IS NOT NULL))
);
-- At most one VALID row per duplicate key in a batch: the in-batch duplicate rule as a database invariant.
CREATE UNIQUE INDEX import_row_one_valid_per_key ON import_row (import_batch_id, duplicate_key) WHERE validation_status = 'valid';
CREATE INDEX import_row_status_idx ON import_row (import_batch_id, validation_status, row_number);
SELECT p2_attach_guards('import_row', false);
GRANT SELECT, INSERT, UPDATE (commit_status, updated_at) ON import_row TO mth_app;

CREATE FUNCTION import_row_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  b record;
  first_row record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO b FROM import_batch WHERE id = NEW.import_batch_id;
    IF NOT FOUND OR b.status <> 'staging' THEN
      RAISE EXCEPTION 'import_row: rows are added only while the batch is staging'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'import_row_batch_staging';
    END IF;
    IF NEW.commit_status <> 'pending' THEN
      RAISE EXCEPTION 'import_row: a row is staged pending'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'import_row_commit_transition';
    END IF;
    IF NEW.duplicate_of_row_id IS NOT NULL THEN
      SELECT * INTO first_row FROM import_row WHERE id = NEW.duplicate_of_row_id;
      IF NOT FOUND OR first_row.import_batch_id <> NEW.import_batch_id OR first_row.validation_status <> 'valid'
         OR first_row.duplicate_key IS DISTINCT FROM NEW.duplicate_key THEN
        RAISE EXCEPTION 'import_row: an in-batch duplicate points at the valid row of the same batch with the same key'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'import_row_duplicate_of';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: the column grant allows commit_status and updated_at only; the owner is held to the same rule.
  IF (NEW.import_batch_id, NEW.row_number, NEW.source_record_id, NEW.raw, NEW.normalized, NEW.duplicate_key,
      NEW.validation_status, NEW.duplicate_of_row_id, NEW.reasons)
     IS DISTINCT FROM (OLD.import_batch_id, OLD.row_number, OLD.source_record_id, OLD.raw, OLD.normalized, OLD.duplicate_key,
      OLD.validation_status, OLD.duplicate_of_row_id, OLD.reasons) THEN
    RAISE EXCEPTION 'import_row: a staged row never changes; only its commit status moves'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'import_row_staged_fixed';
  END IF;
  IF NEW.commit_status IS DISTINCT FROM OLD.commit_status AND NOT (
       OLD.commit_status = 'pending' AND NEW.commit_status IN ('committed', 'not_committed')) THEN
    RAISE EXCEPTION 'import_row: commit status % -> % is not allowed', OLD.commit_status, NEW.commit_status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'import_row_commit_transition';
  END IF;
  IF NEW.commit_status = 'committed' AND OLD.commit_status = 'pending'
     AND NOT EXISTS (SELECT 1 FROM import_row_commit l WHERE l.import_row_id = NEW.id) THEN
    RAISE EXCEPTION 'import_row: a row is committed only with its lineage record'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'import_row_lineage_required';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER import_row_guard BEFORE INSERT OR UPDATE ON import_row
  FOR EACH ROW EXECUTE FUNCTION import_row_guard();

CREATE FUNCTION import_row_no_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'import_row: staged rows are never deleted (a cancelled batch keeps them)'
    USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER import_row_no_delete BEFORE DELETE ON import_row
  FOR EACH ROW EXECUTE FUNCTION import_row_no_delete();
CREATE TRIGGER import_row_no_truncate BEFORE TRUNCATE ON import_row
  FOR EACH STATEMENT EXECUTE FUNCTION import_row_no_delete();

-- ---------------------------------------------------------------------------------------------------------------
-- import_row_commit (lineage)
CREATE TABLE import_row_commit (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id  uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  import_batch_id    uuid NOT NULL,
  import_row_id      uuid NOT NULL CONSTRAINT import_row_commit_row_key UNIQUE
                       REFERENCES import_row (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  target_record_type text NOT NULL CHECK (target_record_type IN ('kpi_actual')),
  target_record_id   uuid NOT NULL,
  target_value_no    smallint NULL CHECK (target_value_no IS NULL OR target_value_no >= 1),
  committed_at       timestamptz NOT NULL,
  CONSTRAINT import_row_commit_batch_fkey FOREIGN KEY (transformation_id, import_batch_id)
    REFERENCES import_batch (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX import_row_commit_target_idx ON import_row_commit (target_record_type, target_record_id);
SELECT p2_attach_append_only('import_row_commit');
GRANT SELECT, INSERT ON import_row_commit TO mth_app;

CREATE FUNCTION import_row_commit_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM import_row WHERE id = NEW.import_row_id;
  IF NOT FOUND OR r.import_batch_id <> NEW.import_batch_id OR r.validation_status <> 'valid' OR r.commit_status <> 'pending'
     OR NOT EXISTS (SELECT 1 FROM import_batch b WHERE b.id = NEW.import_batch_id AND b.status = 'staged') THEN
    RAISE EXCEPTION 'import_row_commit: only a valid, pending row of a staged batch is committed'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'import_row_commit_valid_only';
  END IF;
  IF NEW.target_record_type = 'kpi_actual' AND (NEW.target_value_no IS NULL OR NOT EXISTS (
       SELECT 1 FROM kpi_actual_value v WHERE v.kpi_actual_id = NEW.target_record_id
         AND v.transformation_id = NEW.transformation_id AND v.value_no = NEW.target_value_no)) THEN
    RAISE EXCEPTION 'import_row_commit: the lineage names an existing KPI actual value of the same transformation'
      USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'import_row_commit_target_exists';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER import_row_commit_guard BEFORE INSERT ON import_row_commit
  FOR EACH ROW EXECUTE FUNCTION import_row_commit_guard();
