-- 0104 P6 slice B: connectors, their append-only configuration versions, integration runs and guarded outbound writes
-- (T-DG6-ARCH-03; ADR-0055). Authored by solution-architect. Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- REQ-S17-001 (M0334 "connector framework recording credentials, field mappings, source IDs, cadence, last success,
-- reconciliation, errors and retry history"), REQ-S17-005 (M0335 graceful degradation), REQ-S17-006 (M0335 "Require
-- explicit permission, idempotency and confirmed results for downstream operational write actions"), REQ-S16-022
-- (IntegrationRun).
--   p6_credential_refs_valid(jsonb)  an object of at most 8 named SecretRefs (p6_secret_ref_valid, 0102). Credentials
--                               are stored ONLY as references, never as values.
--   p6_field_mappings_valid(jsonb)   an array of at most 100 {"source", "target"} string pairs, targets unique.
--   connector                   one per (organization, code). adapter_kind test_adapter | webhook | http_pull;
--                               target_kind kpi_actual | none. status disabled -> enabled -> disabled (created
--                               disabled). config_version_no names the CURRENT configuration version (deferred FK).
--                               Versioned and audited; trigger-written append-only history connector_change.
--   connector_config_version    append-only, numbered 1, 2, 3 ... per connector: source system id, credential
--                               references, field mappings, cadence, retry bound, commit mode, outbound actions,
--                               reconciliation rule, adapter settings (no secret-like key). The import mappings are
--                               versioned here, outside Studio (p6-plan §3 row 24).
--   integration_run             one row per run (schedule | manual | retry | test | webhook). queued -> running |
--                               cancelled; running -> succeeded | failed; terminal rows never change. Counts are NULL
--                               until known (Unknown, never 0). Idempotency: UNIQUE (connector_id, idempotency_key);
--                               at most one active (queued or running) run per connector; at most one retry per failed
--                               run, attempt_no = the retried run's + 1. Versioned and audited (service actor);
--                               trigger-written append-only history integration_run_event.
--   outbound_write              one row per downstream write request (Q14: only connector-defined actions; P6 ships
--                               'deliverable_status_push' on the test adapter). requested -> pending_confirmation |
--                               confirmed | failed; pending_confirmation -> confirmed | failed. 'confirmed' needs the
--                               downstream reference of a confirmed response. UNIQUE (connector_id, idempotency_key).
--                               Versioned and audited; trigger-written append-only history outbound_write_event.
--   service_identity.connector_id gets its foreign key here (announced in 0101).
-- Nothing here reads or writes DG0-DG7. No code grants a business approval.

CREATE FUNCTION p6_credential_refs_valid(r jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_catalog, pg_temp AS $$
  SELECT jsonb_typeof(r) = 'object'
    AND (SELECT count(*) FROM jsonb_object_keys(r)) <= 8
    AND NOT EXISTS (SELECT 1 FROM jsonb_each(r) AS e(k, v)
                    WHERE e.k !~ '^[a-z][a-z0-9_]{0,31}$' OR e.v IS NULL OR jsonb_typeof(e.v) <> 'object'
                       OR NOT p6_secret_ref_valid(e.v))
$$;
COMMENT ON FUNCTION p6_credential_refs_valid(jsonb) IS
  'At most 8 named SecretRefs {provider, name} (ADR-0055 §1): a credential is a reference, never a value.';
GRANT EXECUTE ON FUNCTION p6_credential_refs_valid(jsonb) TO mth_app;

CREATE FUNCTION p6_field_mappings_valid(m jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_typeof(m) = 'array'
    AND jsonb_array_length(m) <= 100
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(m) AS e(v)
                    WHERE jsonb_typeof(e.v) <> 'object'
                       OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e.v) AS k) <> ARRAY['source', 'target']
                       OR jsonb_typeof(e.v->'source') <> 'string' OR jsonb_typeof(e.v->'target') <> 'string'
                       OR char_length(e.v->>'source') NOT BETWEEN 1 AND 100
                       OR (e.v->>'target') !~ '^[a-z][a-zA-Z0-9_]{0,63}$')
    AND (SELECT count(DISTINCT e.v->>'target') FROM jsonb_array_elements(m) AS e(v)) = jsonb_array_length(m)
$$;
COMMENT ON FUNCTION p6_field_mappings_valid(jsonb) IS
  'Field mappings (ADR-0055 §1): at most 100 {source, target} pairs; each target named once.';
GRANT EXECUTE ON FUNCTION p6_field_mappings_valid(jsonb) TO mth_app;

CREATE FUNCTION p6_settings_without_secret_keys(o jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_typeof(o) = 'object' AND NOT EXISTS (
    SELECT 1 FROM jsonb_object_keys(o) AS k WHERE lower(k) ~ '(secret|password|passwd|token|apikey|api_key|credential)')
$$;
COMMENT ON FUNCTION p6_settings_without_secret_keys(jsonb) IS
  'Adapter settings carry no key named like a secret (secret, password, passwd, token, apikey, api_key, credential); credentials are SecretRefs (ADR-0055 §1).';
GRANT EXECUTE ON FUNCTION p6_settings_without_secret_keys(jsonb) TO mth_app;

-- ---------------------------------------------------------------------------------------------------------------
-- connector
CREATE TABLE connector (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code              text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_-]{1,62}$'),
  name_en           text NOT NULL CHECK (char_length(name_en) BETWEEN 1 AND 200),
  name_ar           text NOT NULL CHECK (char_length(name_ar) BETWEEN 1 AND 200),
  adapter_kind      text NOT NULL CHECK (adapter_kind IN ('test_adapter', 'webhook', 'http_pull')),
  target_kind       text NOT NULL CHECK (target_kind IN ('kpi_actual', 'none')),
  status            text NOT NULL DEFAULT 'disabled' CHECK (status IN ('disabled', 'enabled')),
  config_version_no integer NOT NULL CHECK (config_version_no >= 1),
  status_reason     text NULL CHECK (status_reason IS NULL OR char_length(status_reason) BETWEEN 3 AND 1000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT connector_organization_code_key UNIQUE (organization_id, code),
  CONSTRAINT connector_organization_id_id_key UNIQUE (organization_id, id),
  CONSTRAINT connector_webhook_target CHECK (adapter_kind <> 'webhook' OR target_kind = 'kpi_actual')
);
CREATE INDEX connector_list_idx ON connector (organization_id, status, code);
SELECT p2_attach_guards('connector', true);
GRANT SELECT, INSERT, UPDATE ON connector TO mth_app;

ALTER TABLE service_identity
  ADD CONSTRAINT service_identity_connector_fkey FOREIGN KEY (connector_id) REFERENCES connector (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE connector_config_version (
  id                       uuid PRIMARY KEY,
  organization_id          uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  connector_id             uuid NOT NULL REFERENCES connector (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version_no               integer NOT NULL CHECK (version_no >= 1),
  source_system_id         text NOT NULL CHECK (char_length(source_system_id) BETWEEN 1 AND 200
                             AND source_system_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]*$'),
  endpoint_url             text NULL CHECK (endpoint_url IS NULL OR (endpoint_url ~ '^https://[^/?#@[:space:]]+'
                             AND char_length(endpoint_url) <= 500)),
  credential_refs          jsonb NOT NULL DEFAULT '{}'::jsonb
                             CONSTRAINT connector_config_version_credential_refs CHECK (p6_credential_refs_valid(credential_refs)),
  field_mappings           jsonb NOT NULL DEFAULT '[]'::jsonb
                             CONSTRAINT connector_config_version_field_mappings CHECK (p6_field_mappings_valid(field_mappings)),
  target_transformation_id uuid NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  cadence                  text NOT NULL CHECK (cadence IN ('manual', 'hourly', 'daily', 'weekly')),
  retry_max_attempts       smallint NOT NULL DEFAULT 3 CHECK (retry_max_attempts BETWEEN 0 AND 5),
  retry_backoff_seconds    integer NOT NULL DEFAULT 60 CHECK (retry_backoff_seconds BETWEEN 10 AND 3600),
  commit_mode              text NOT NULL DEFAULT 'manual' CHECK (commit_mode IN ('manual', 'auto')),
  commit_on_behalf_of      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  outbound_actions         text[] NOT NULL DEFAULT '{}'
                             CHECK (outbound_actions <@ ARRAY['deliverable_status_push']::text[]),
  reconciliation_rule      text NOT NULL DEFAULT 'row_count'
                             CHECK (reconciliation_rule IN ('none', 'row_count', 'row_count_and_total')),
  adapter_settings         jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(adapter_settings) = 'object'
                             AND octet_length(adapter_settings::text) <= 4096),
  reason                   text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 1000),
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT connector_config_version_no_key UNIQUE (connector_id, version_no),
  CONSTRAINT connector_config_version_commit_mode CHECK ((commit_mode = 'auto') = (commit_on_behalf_of IS NOT NULL)),
  CONSTRAINT connector_config_version_no_secret_settings CHECK (p6_settings_without_secret_keys(adapter_settings))
);
SELECT p2_attach_append_only('connector_config_version');
GRANT SELECT, INSERT ON connector_config_version TO mth_app;

ALTER TABLE connector
  ADD CONSTRAINT connector_current_config_fkey FOREIGN KEY (id, config_version_no)
    REFERENCES connector_config_version (connector_id, version_no) ON DELETE RESTRICT ON UPDATE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION connector_config_version_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  c record;
  has_connector boolean;
  prev integer;
BEGIN
  SELECT * INTO c FROM connector WHERE id = NEW.connector_id;
  has_connector := FOUND;
  -- A missing connector is left to the foreign key (the API inserts the connector first, then its version 1; the
  -- connector's own foreign key to its current version is deferred to COMMIT).
  IF has_connector AND c.organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'connector_config_version: organization_id must equal the connector''s'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'connector_config_version_organization_matches';
  END IF;
  SELECT max(version_no) INTO prev FROM connector_config_version WHERE connector_id = NEW.connector_id;
  IF NEW.version_no <> coalesce(prev, 0) + 1 THEN
    RAISE EXCEPTION 'connector_config_version: versions are numbered 1, 2, 3 ... without gaps (expected %)', coalesce(prev, 0) + 1
      USING ERRCODE = 'check_violation', CONSTRAINT = 'connector_config_version_sequence';
  END IF;
  IF has_connector THEN
    IF c.adapter_kind = 'test_adapter' AND coalesce(NEW.adapter_settings->>'mode', '') NOT IN ('healthy', 'failing', 'stopped') THEN
      RAISE EXCEPTION 'connector_config_version: a test adapter needs adapter_settings.mode healthy, failing or stopped'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'connector_config_version_adapter_shape';
    END IF;
    IF (c.adapter_kind = 'http_pull') <> (NEW.endpoint_url IS NOT NULL) THEN
      RAISE EXCEPTION 'connector_config_version: an endpoint URL is set exactly for an http_pull adapter'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'connector_config_version_adapter_shape';
    END IF;
    IF (c.target_kind = 'kpi_actual') <> (NEW.target_transformation_id IS NOT NULL) THEN
      RAISE EXCEPTION 'connector_config_version: a target transformation is set exactly for a kpi_actual connector'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'connector_config_version_target_shape';
    END IF;
    IF c.target_kind = 'none' AND (NEW.commit_mode <> 'manual' OR jsonb_array_length(NEW.field_mappings) > 0) THEN
      RAISE EXCEPTION 'connector_config_version: an action-only connector has no mappings and no commit mode'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'connector_config_version_target_shape';
    END IF;
    IF c.adapter_kind <> 'test_adapter' AND cardinality(NEW.outbound_actions) > 0 THEN
      RAISE EXCEPTION 'connector_config_version: outbound actions exist only on the test adapter in this release (D-195 Q14)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'connector_config_version_outbound_test_only';
    END IF;
  END IF;
  IF NEW.target_transformation_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM transformation t WHERE t.id = NEW.target_transformation_id AND t.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'connector_config_version: the target transformation belongs to another organization'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'connector_config_version_target_shape';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER connector_config_version_guard BEFORE INSERT ON connector_config_version
  FOR EACH ROW EXECUTE FUNCTION connector_config_version_guard();

CREATE FUNCTION connector_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'disabled' OR NEW.config_version_no <> 1 THEN
      RAISE EXCEPTION 'connector: a connector is created disabled, at configuration version 1'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'connector_transition';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.code, NEW.adapter_kind, NEW.target_kind) IS DISTINCT FROM (OLD.code, OLD.adapter_kind, OLD.target_kind) THEN
    RAISE EXCEPTION 'connector: code, adapter kind and target kind never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'connector_identity_fixed';
  END IF;
  IF NEW.config_version_no <> OLD.config_version_no AND NEW.config_version_no <> OLD.config_version_no + 1 THEN
    RAISE EXCEPTION 'connector: the current configuration moves forward one version at a time'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'connector_config_forward';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER connector_guard BEFORE INSERT OR UPDATE ON connector
  FOR EACH ROW EXECUTE FUNCTION connector_guard();

CREATE TABLE connector_change (
  id                uuid PRIMARY KEY,
  connector_id      uuid NOT NULL REFERENCES connector (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_version    integer NOT NULL CHECK (record_version >= 1),
  status            text NOT NULL,
  config_version_no integer NOT NULL,
  status_reason     text NULL,
  name_en           text NOT NULL,
  name_ar           text NOT NULL,
  changed_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  changed_at        timestamptz NOT NULL,
  CONSTRAINT connector_change_version_key UNIQUE (connector_id, record_version)
);
SELECT p2_attach_append_only('connector_change');
GRANT SELECT ON connector_change TO mth_app;

CREATE FUNCTION connector_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO connector_change (id, connector_id, record_version, status, config_version_no, status_reason, name_en,
    name_ar, changed_by, changed_at)
  VALUES (mth_uuid_v7(), NEW.id, NEW.version, NEW.status, NEW.config_version_no, NEW.status_reason, NEW.name_en,
    NEW.name_ar, NEW.updated_by, NEW.updated_at);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION connector_history() FROM PUBLIC;
CREATE TRIGGER connector_history AFTER INSERT OR UPDATE ON connector
  FOR EACH ROW EXECUTE FUNCTION connector_history();

-- ---------------------------------------------------------------------------------------------------------------
-- integration_run
CREATE TABLE integration_run (
  id                     uuid PRIMARY KEY,
  organization_id        uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  connector_id           uuid NOT NULL REFERENCES connector (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  config_version_no      integer NOT NULL,
  trigger_kind           text NOT NULL CHECK (trigger_kind IN ('schedule', 'manual', 'retry', 'test', 'webhook')),
  status                 text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempt_no             smallint NOT NULL DEFAULT 1 CHECK (attempt_no BETWEEN 1 AND 6),
  retry_of_run_id        uuid NULL REFERENCES integration_run (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  idempotency_key        text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200
                           AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'),
  requested_by           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  service_identity_id    uuid NOT NULL REFERENCES service_identity (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  queued_at              timestamptz NOT NULL,
  started_at             timestamptz NULL,
  finished_at            timestamptz NULL,
  rows_read              integer NULL CHECK (rows_read IS NULL OR rows_read >= 0),
  rows_staged            integer NULL CHECK (rows_staged IS NULL OR rows_staged >= 0),
  rows_committed         integer NULL CHECK (rows_committed IS NULL OR rows_committed >= 0),
  rows_rejected          integer NULL CHECK (rows_rejected IS NULL OR rows_rejected >= 0),
  rows_duplicate         integer NULL CHECK (rows_duplicate IS NULL OR rows_duplicate >= 0),
  error_count            integer NULL CHECK (error_count IS NULL OR error_count >= 0),
  error_code             text NULL CHECK (error_code IS NULL OR (char_length(error_code) BETWEEN 1 AND 100
                           AND error_code ~ '^[a-z][a-z0-9_.]*$')),
  error_message          text NULL CHECK (error_message IS NULL OR char_length(error_message) BETWEEN 1 AND 2000),
  reconciliation_status  text NOT NULL DEFAULT 'not_checked'
                           CHECK (reconciliation_status IN ('not_checked', 'matched', 'mismatched', 'not_applicable')),
  source_row_count       integer NULL CHECK (source_row_count IS NULL OR source_row_count >= 0),
  source_control_total   numeric(24,6) NULL,
  staged_control_total   numeric(24,6) NULL,
  import_batch_id        uuid NULL,
  version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT integration_run_config_fkey FOREIGN KEY (connector_id, config_version_no)
    REFERENCES connector_config_version (connector_id, version_no) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT integration_run_connector_org_fkey FOREIGN KEY (organization_id, connector_id)
    REFERENCES connector (organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT integration_run_idempotency_key UNIQUE (connector_id, idempotency_key),
  CONSTRAINT integration_run_one_retry_key UNIQUE (retry_of_run_id),
  CONSTRAINT integration_run_retry_shape CHECK ((trigger_kind = 'retry') = (retry_of_run_id IS NOT NULL)
    AND (retry_of_run_id IS NULL) = (attempt_no = 1)),
  CONSTRAINT integration_run_requester CHECK (trigger_kind NOT IN ('manual', 'test') OR requested_by IS NOT NULL),
  CONSTRAINT integration_run_times CHECK ((started_at IS NULL OR started_at >= queued_at)
    AND (finished_at IS NULL OR (started_at IS NOT NULL AND finished_at >= started_at))),
  CONSTRAINT integration_run_status_shape CHECK (
    (status = 'queued' AND started_at IS NULL AND finished_at IS NULL)
    OR (status = 'running' AND started_at IS NOT NULL AND finished_at IS NULL)
    OR (status = 'cancelled' AND started_at IS NULL AND finished_at IS NULL)
    OR (status IN ('succeeded', 'failed') AND finished_at IS NOT NULL)),
  CONSTRAINT integration_run_failure_shape CHECK ((status = 'failed') = (error_code IS NOT NULL)
    AND (error_message IS NULL OR error_code IS NOT NULL)),
  CONSTRAINT integration_run_success_counts CHECK (status <> 'succeeded' OR (rows_read IS NOT NULL
    AND rows_staged IS NOT NULL AND rows_rejected IS NOT NULL AND rows_duplicate IS NOT NULL AND error_count IS NOT NULL)),
  CONSTRAINT integration_run_count_order CHECK (
    (rows_staged IS NULL OR rows_read IS NULL OR rows_staged <= rows_read)
    AND (rows_staged IS NULL OR coalesce(rows_committed, 0) + coalesce(rows_rejected, 0) + coalesce(rows_duplicate, 0) <= rows_staged)),
  CONSTRAINT integration_run_reconciliation_shape CHECK (
    (reconciliation_status IN ('matched', 'mismatched')) = (source_row_count IS NOT NULL)
    AND (staged_control_total IS NULL OR source_control_total IS NOT NULL))
);
CREATE UNIQUE INDEX integration_run_one_active ON integration_run (connector_id) WHERE status IN ('queued', 'running');
CREATE INDEX integration_run_list_idx ON integration_run (connector_id, queued_at DESC, id DESC);
CREATE INDEX integration_run_last_success_idx ON integration_run (connector_id, finished_at DESC) WHERE status = 'succeeded';
SELECT p2_attach_guards('integration_run', true);
GRANT SELECT, INSERT, UPDATE ON integration_run TO mth_app;

CREATE FUNCTION integration_run_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  parent record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'queued' THEN
      RAISE EXCEPTION 'integration_run: a run is created queued'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'integration_run_transition';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM service_identity s WHERE s.id = NEW.service_identity_id
                     AND s.subject_kind = 'connector' AND s.connector_id = NEW.connector_id) THEN
      RAISE EXCEPTION 'integration_run: a run acts as its own connector''s service identity'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'integration_run_service_identity';
    END IF;
    IF NEW.retry_of_run_id IS NOT NULL THEN
      SELECT * INTO parent FROM integration_run WHERE id = NEW.retry_of_run_id;
      IF NOT FOUND OR parent.status <> 'failed' OR parent.connector_id <> NEW.connector_id
         OR NEW.attempt_no <> parent.attempt_no + 1 THEN
        RAISE EXCEPTION 'integration_run: a retry follows a failed run of the same connector, as its next attempt'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'integration_run_retry_chain';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('succeeded', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'integration_run: a finished run never changes (a retry is a new run)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'integration_run_final';
  END IF;
  IF (NEW.connector_id, NEW.config_version_no, NEW.trigger_kind, NEW.attempt_no, NEW.retry_of_run_id,
      NEW.idempotency_key, NEW.requested_by, NEW.service_identity_id, NEW.queued_at)
     IS DISTINCT FROM (OLD.connector_id, OLD.config_version_no, OLD.trigger_kind, OLD.attempt_no, OLD.retry_of_run_id,
      OLD.idempotency_key, OLD.requested_by, OLD.service_identity_id, OLD.queued_at) THEN
    RAISE EXCEPTION 'integration_run: the connector, configuration, trigger, attempt and idempotency key never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'integration_run_identity_fixed';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'queued' AND NEW.status IN ('running', 'cancelled'))
       OR (OLD.status = 'running' AND NEW.status IN ('succeeded', 'failed'))) THEN
    RAISE EXCEPTION 'integration_run: % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'integration_run_transition';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER integration_run_guard BEFORE INSERT OR UPDATE ON integration_run
  FOR EACH ROW EXECUTE FUNCTION integration_run_guard();

CREATE TABLE integration_run_event (
  id                 uuid PRIMARY KEY,
  integration_run_id uuid NOT NULL REFERENCES integration_run (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_version     integer NOT NULL CHECK (record_version >= 1),
  status             text NOT NULL,
  rows_read          integer NULL,
  rows_staged        integer NULL,
  rows_committed     integer NULL,
  rows_rejected      integer NULL,
  rows_duplicate     integer NULL,
  error_count        integer NULL,
  error_code         text NULL,
  occurred_at        timestamptz NOT NULL,
  CONSTRAINT integration_run_event_version_key UNIQUE (integration_run_id, record_version)
);
SELECT p2_attach_append_only('integration_run_event');
GRANT SELECT ON integration_run_event TO mth_app;

CREATE FUNCTION integration_run_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO integration_run_event (id, integration_run_id, record_version, status, rows_read, rows_staged,
    rows_committed, rows_rejected, rows_duplicate, error_count, error_code, occurred_at)
  VALUES (mth_uuid_v7(), NEW.id, NEW.version, NEW.status, NEW.rows_read, NEW.rows_staged, NEW.rows_committed,
    NEW.rows_rejected, NEW.rows_duplicate, NEW.error_count, NEW.error_code, NEW.updated_at);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION integration_run_history() FROM PUBLIC;
CREATE TRIGGER integration_run_history AFTER INSERT OR UPDATE ON integration_run
  FOR EACH ROW EXECUTE FUNCTION integration_run_history();

-- ---------------------------------------------------------------------------------------------------------------
-- outbound_write (REQ-S17-006)
CREATE TABLE outbound_write (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id    uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  connector_id         uuid NOT NULL REFERENCES connector (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  config_version_no    integer NOT NULL,
  action_code          text NOT NULL CHECK (action_code IN ('deliverable_status_push')),
  deliverable_id       uuid NOT NULL,
  idempotency_key      text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200
                         AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'),
  payload              jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 16384),
  payload_sha256       char(64) NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  status               text NOT NULL DEFAULT 'requested'
                         CHECK (status IN ('requested', 'pending_confirmation', 'confirmed', 'failed')),
  attempt_count        smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 10),
  last_attempt_at      timestamptz NULL,
  external_reference   text NULL CHECK (external_reference IS NULL OR char_length(external_reference) BETWEEN 1 AND 200),
  confirmed_at         timestamptz NULL,
  failure_code         text NULL CHECK (failure_code IS NULL OR (char_length(failure_code) BETWEEN 1 AND 100
                         AND failure_code ~ '^[a-z][a-z0-9_.]*$')),
  failure_message      text NULL CHECK (failure_message IS NULL OR char_length(failure_message) BETWEEN 1 AND 2000),
  requested_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  service_identity_id  uuid NOT NULL REFERENCES service_identity (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT outbound_write_idempotency_key UNIQUE (connector_id, idempotency_key),
  CONSTRAINT outbound_write_deliverable_fkey FOREIGN KEY (transformation_id, deliverable_id)
    REFERENCES deliverable (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT outbound_write_config_fkey FOREIGN KEY (connector_id, config_version_no)
    REFERENCES connector_config_version (connector_id, version_no) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT outbound_write_connector_org_fkey FOREIGN KEY (organization_id, connector_id)
    REFERENCES connector (organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT outbound_write_confirmed_shape CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL)
    AND (status <> 'confirmed' OR external_reference IS NOT NULL)),
  CONSTRAINT outbound_write_failed_shape CHECK ((status = 'failed') = (failure_code IS NOT NULL)
    AND (failure_message IS NULL OR failure_code IS NOT NULL)),
  CONSTRAINT outbound_write_attempt_shape CHECK ((attempt_count = 0) = (last_attempt_at IS NULL)
    AND (status = 'requested' OR attempt_count >= 1))
);
CREATE INDEX outbound_write_list_idx ON outbound_write (transformation_id, created_at DESC, id DESC);
CREATE INDEX outbound_write_deliverable_idx ON outbound_write (deliverable_id, created_at DESC);
SELECT p2_attach_guards('outbound_write', true);
GRANT SELECT, INSERT, UPDATE ON outbound_write TO mth_app;

CREATE FUNCTION outbound_write_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  cfg record;
  conn record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'requested' OR NEW.attempt_count <> 0 THEN
      RAISE EXCEPTION 'outbound_write: a write is created requested, with no attempt'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'outbound_write_transition';
    END IF;
    SELECT * INTO conn FROM connector WHERE id = NEW.connector_id;
    SELECT * INTO cfg FROM connector_config_version WHERE connector_id = NEW.connector_id AND version_no = NEW.config_version_no;
    IF NOT FOUND OR conn.status <> 'enabled' OR conn.config_version_no <> NEW.config_version_no
       OR NOT (NEW.action_code = ANY (cfg.outbound_actions)) THEN
      RAISE EXCEPTION 'outbound_write: the connector must be enabled and its current configuration must allow the action'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'outbound_write_action_allowed';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM service_identity s WHERE s.id = NEW.service_identity_id
                     AND s.subject_kind = 'connector' AND s.connector_id = NEW.connector_id) THEN
      RAISE EXCEPTION 'outbound_write: a write acts as its own connector''s service identity'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'outbound_write_service_identity';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('confirmed', 'failed') THEN
    RAISE EXCEPTION 'outbound_write: a confirmed or failed write never changes'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'outbound_write_final';
  END IF;
  IF (NEW.connector_id, NEW.config_version_no, NEW.action_code, NEW.deliverable_id, NEW.idempotency_key, NEW.payload,
      NEW.payload_sha256, NEW.requested_by, NEW.service_identity_id)
     IS DISTINCT FROM (OLD.connector_id, OLD.config_version_no, OLD.action_code, OLD.deliverable_id, OLD.idempotency_key,
      OLD.payload, OLD.payload_sha256, OLD.requested_by, OLD.service_identity_id) THEN
    RAISE EXCEPTION 'outbound_write: the action, subject, payload and idempotency key never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'outbound_write_identity_fixed';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'requested' AND NEW.status IN ('pending_confirmation', 'confirmed', 'failed'))
       OR (OLD.status = 'pending_confirmation' AND NEW.status IN ('confirmed', 'failed'))) THEN
    RAISE EXCEPTION 'outbound_write: % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'outbound_write_transition';
  END IF;
  IF NEW.attempt_count < OLD.attempt_count OR NEW.attempt_count > OLD.attempt_count + 1 THEN
    RAISE EXCEPTION 'outbound_write: each dispatch counts once'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'outbound_write_attempt_step';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outbound_write_guard BEFORE INSERT OR UPDATE ON outbound_write
  FOR EACH ROW EXECUTE FUNCTION outbound_write_guard();

CREATE TABLE outbound_write_event (
  id                 uuid PRIMARY KEY,
  outbound_write_id  uuid NOT NULL REFERENCES outbound_write (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_version     integer NOT NULL CHECK (record_version >= 1),
  status             text NOT NULL,
  attempt_count      smallint NOT NULL,
  external_reference text NULL,
  failure_code       text NULL,
  actor_user_id      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  occurred_at        timestamptz NOT NULL,
  CONSTRAINT outbound_write_event_version_key UNIQUE (outbound_write_id, record_version)
);
SELECT p2_attach_append_only('outbound_write_event');
GRANT SELECT ON outbound_write_event TO mth_app;

CREATE FUNCTION outbound_write_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO outbound_write_event (id, outbound_write_id, record_version, status, attempt_count, external_reference,
    failure_code, actor_user_id, occurred_at)
  VALUES (mth_uuid_v7(), NEW.id, NEW.version, NEW.status, NEW.attempt_count, NEW.external_reference, NEW.failure_code,
    NEW.updated_by, NEW.updated_at);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION outbound_write_history() FROM PUBLIC;
CREATE TRIGGER outbound_write_history AFTER INSERT OR UPDATE ON outbound_write
  FOR EACH ROW EXECUTE FUNCTION outbound_write_history();
