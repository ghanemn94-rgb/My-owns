-- 0133 P7 slice C: the data migration manifest's catalogue rules, export requests, imports, reconciliation reports and
-- the identity rebind hold (T-DG7-ARCH-02; ADR-0064). Authored by solution-architect. Runs as mth_owner inside one
-- transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- REQ-S19-014 (acceptance "A18: migrating the demo dataset into a clean installation reports equal record counts and
-- matching attachment checksums") and REQ-S19-016 ("A18: an export and import round-trip preserves IDs, links, audit
-- history and evidence checksums; the package contains no password hashes"; D-243 Q16 widens the exclusion to every
-- credential: sessions, tokens and secret references).
--   transfer_table_rule      the tables the manifest does NOT carry, each with its reason (ADR-0064 §3). Every other
--                            public base table is exported. Rows are written by migrations only (mth_app may only read)
--                            and never change (append-only); a later migration that adds an excluded table adds its row.
--   transfer_column_rule     the columns the export rewrites: every SecretRef column (provider replaced by 'unbound',
--                            ADR-0064 §4). Same write rule as transfer_table_rule.
--   migration_export         one export request (API: createMigrationExport; or the CLI). States queued -> running ->
--                            succeeded | failed; succeeded and failed are terminal and immutable. A succeeded export
--                            carries its counts and both manifest checksums; a demo export carries the ADR-0050 demo
--                            checksum (demo_checksum), and only a demo export does. Versioned and audited.
--   migration_import         one import, written ONCE by `mth-db import-migration` (mth_owner) at the end of the load,
--                            in the load's transaction. mth_app may only read. Append-only, audited (migration.imported).
--   migration_reconciliation one reconciliation run (at import, and every `mth-db reconcile-migration` re-check) with its
--                            totals; migration_reconciliation_table holds one row per manifest table and
--                            migration_reconciliation_attachment one row per attachment that did not match. All three
--                            written by the CLI only, append-only; the run is audited (migration.reconciled).
--   identity_binding_hold    one row per user carried by an import: 'unbound' until IT applies a mapping line
--                            (`mth-db rebind-identity`): 'rebound' (new issuer and subject) or 'retained' (the same
--                            issuer and subject, confirmed by IT). An 'unbound' user cannot sign in (ADR-0064 §8).
--                            Written by the CLI only; versioned and audited (identity.rebound / identity.retained).
--   identity_rebind_event    the append-only history of every applied mapping line.
-- Nothing here reads or writes DG0-DG7. No code grants a business, Finance or IT approval.

-- ---------------------------------------------------------------------------------------------------------------
-- transfer_table_rule / transfer_column_rule
CREATE TABLE transfer_table_rule (
  table_name text PRIMARY KEY CHECK (table_name ~ '^[a-z][a-z0-9_]{0,62}$'),
  rule       text NOT NULL CHECK (rule IN ('exclude_credential', 'exclude_operational', 'exclude_derived',
               'exclude_transfer', 'compare_only')),
  reason     text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
SELECT p2_attach_append_only('transfer_table_rule');
GRANT SELECT ON transfer_table_rule TO mth_app;

CREATE TABLE transfer_column_rule (
  table_name  text NOT NULL CHECK (table_name ~ '^[a-z][a-z0-9_]{0,62}$'),
  column_name text NOT NULL CHECK (column_name ~ '^[a-z][a-z0-9_]{0,62}$'),
  rule        text NOT NULL CHECK (rule IN ('secret_ref_unbind', 'secret_refs_unbind')),
  reason      text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transfer_column_rule_pkey PRIMARY KEY (table_name, column_name)
);
SELECT p2_attach_append_only('transfer_column_rule');
GRANT SELECT ON transfer_column_rule TO mth_app;

-- ADR-0064 §3: what the manifest never carries. 'compare_only' tables are not loaded but must be equal on the target
-- (schema_migration: the same migration level). The rows of this migration's own tables are the installation's own
-- transfer history ('exclude_transfer').
INSERT INTO transfer_table_rule (table_name, rule, reason) VALUES
  ('session', 'exclude_credential', 'Server-side sessions: cookie and CSRF token hashes; credential material is never exported'),
  ('oidc_login_state', 'exclude_credential', 'Single-use OIDC state, nonce and PKCE verifier hashes; credential material is never exported'),
  ('idempotency_record', 'exclude_operational', 'Request replay cache of the source installation; expires after 24 hours'),
  ('worker_heartbeat', 'exclude_operational', 'Telemetry of the source installation''s worker instances'),
  ('search_document', 'exclude_derived', 'Derived search index; rebuilt on the target by the search.reindex job'),
  ('search_index_state', 'exclude_derived', 'State of the derived search index; rebuilt on the target'),
  ('schema_migration', 'compare_only', 'The target must be migrated to the same level; compared, never loaded'),
  ('migration_export', 'exclude_transfer', 'The source installation''s own export requests'),
  ('migration_import', 'exclude_transfer', 'Written by the import on the target'),
  ('migration_reconciliation', 'exclude_transfer', 'Written by the import on the target'),
  ('migration_reconciliation_table', 'exclude_transfer', 'Written by the import on the target'),
  ('migration_reconciliation_attachment', 'exclude_transfer', 'Written by the import on the target'),
  ('identity_binding_hold', 'exclude_transfer', 'Written by the import on the target'),
  ('identity_rebind_event', 'exclude_transfer', 'Written by the rebind command on the target');

-- ADR-0064 §4: every SecretRef column. The export replaces each reference's provider by 'unbound' and keeps its name,
-- so the target resolves no secret until IT binds the reference in its own SecretProvider.
INSERT INTO transfer_column_rule (table_name, column_name, rule, reason) VALUES
  ('storage_setting', 's3_access_key_ref', 'secret_ref_unbind', 'S3 access key reference'),
  ('storage_setting', 's3_secret_key_ref', 'secret_ref_unbind', 'S3 secret key reference'),
  ('storage_setting_change', 's3_access_key_ref', 'secret_ref_unbind', 'History of the S3 access key reference'),
  ('storage_setting_change', 's3_secret_key_ref', 'secret_ref_unbind', 'History of the S3 secret key reference'),
  ('notification_channel', 'smtp_username_ref', 'secret_ref_unbind', 'SMTP user name reference'),
  ('notification_channel', 'smtp_password_ref', 'secret_ref_unbind', 'SMTP password reference'),
  ('notification_channel_change', 'smtp_username_ref', 'secret_ref_unbind', 'History of the SMTP user name reference'),
  ('notification_channel_change', 'smtp_password_ref', 'secret_ref_unbind', 'History of the SMTP password reference'),
  ('connector_config_version', 'credential_refs', 'secret_refs_unbind', 'Named connector credential references'),
  ('webhook_endpoint', 'signing_secret_ref', 'secret_ref_unbind', 'Webhook signing secret reference'),
  ('webhook_endpoint', 'previous_secret_ref', 'secret_ref_unbind', 'Previous webhook signing secret reference'),
  ('webhook_endpoint_change', 'signing_secret_ref', 'secret_ref_unbind', 'History of the webhook signing secret reference'),
  ('webhook_endpoint_change', 'previous_secret_ref', 'secret_ref_unbind', 'History of the previous webhook signing secret reference'),
  ('assistant_setting', 'credential_ref', 'secret_ref_unbind', 'Assistant provider credential reference'),
  ('assistant_setting_change', 'credential_ref', 'secret_ref_unbind', 'History of the assistant provider credential reference');

-- ---------------------------------------------------------------------------------------------------------------
-- migration_export
CREATE TABLE migration_export (
  id                          uuid PRIMARY KEY,
  status                      text NOT NULL DEFAULT 'queued'
                                CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  requested_via               text NOT NULL CHECK (requested_via IN ('api', 'cli')),
  schema_version              text NOT NULL DEFAULT 'mth-migration/1' CHECK (schema_version = 'mth-migration/1'),
  source_environment          text NULL CHECK (source_environment IS NULL
                                OR source_environment IN ('production', 'demo', 'unmarked')),
  migration_level             text NULL CHECK (migration_level IS NULL OR migration_level ~ '^[0-9]{4}_[a-z0-9_]+$'),
  table_count                 integer NULL CHECK (table_count IS NULL OR table_count >= 0),
  row_count                   bigint NULL CHECK (row_count IS NULL OR row_count >= 0),
  attachment_count            integer NULL CHECK (attachment_count IS NULL OR attachment_count >= 0),
  attachment_bytes            bigint NULL CHECK (attachment_bytes IS NULL OR attachment_bytes >= 0),
  manifest_sha256             text NULL CHECK (manifest_sha256 IS NULL OR manifest_sha256 ~ '^[0-9a-f]{64}$'),
  attachment_manifest_sha256  text NULL CHECK (attachment_manifest_sha256 IS NULL
                                OR attachment_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  demo_checksum               text NULL CHECK (demo_checksum IS NULL OR demo_checksum ~ '^[0-9a-f]{64}$'),
  failure_reason              text NULL CHECK (failure_reason IS NULL OR char_length(failure_reason) BETWEEN 1 AND 1000),
  started_at                  timestamptz NULL,
  finished_at                 timestamptz NULL,
  version                     integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT migration_export_requester CHECK ((requested_via = 'api') = (created_by IS NOT NULL)),
  CONSTRAINT migration_export_succeeded_shape CHECK (status <> 'succeeded' OR (source_environment IS NOT NULL
    AND migration_level IS NOT NULL AND table_count IS NOT NULL AND row_count IS NOT NULL
    AND attachment_count IS NOT NULL AND attachment_bytes IS NOT NULL AND manifest_sha256 IS NOT NULL
    AND attachment_manifest_sha256 IS NOT NULL AND started_at IS NOT NULL AND finished_at IS NOT NULL
    AND failure_reason IS NULL)),
  CONSTRAINT migration_export_failed_shape CHECK (status <> 'failed' OR (failure_reason IS NOT NULL
    AND finished_at IS NOT NULL)),
  -- D-244 O2: a demo export carries the ADR-0050 checksum; no other export does.
  CONSTRAINT migration_export_demo_checksum CHECK ((demo_checksum IS NOT NULL) = (status = 'succeeded'
    AND source_environment = 'demo'))
);
CREATE INDEX migration_export_created_idx ON migration_export (created_at DESC, id);
SELECT p2_attach_guards('migration_export', true);
GRANT SELECT, INSERT ON migration_export TO mth_app;
GRANT UPDATE (status, source_environment, migration_level, table_count, row_count, attachment_count, attachment_bytes,
  manifest_sha256, attachment_manifest_sha256, demo_checksum, failure_reason, started_at, finished_at, version,
  updated_at, updated_by) ON migration_export TO mth_app;

CREATE FUNCTION migration_export_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'queued' THEN
      RAISE EXCEPTION 'migration_export: a request starts queued'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'migration_export_transition';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'migration_export: a % export is immutable', OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'migration_export_terminal_immutable';
  END IF;
  IF NOT ((OLD.status = 'queued' AND NEW.status IN ('running', 'failed'))
       OR (OLD.status = 'running' AND NEW.status IN ('running', 'succeeded', 'failed'))) THEN
    RAISE EXCEPTION 'migration_export: % -> % is not a transition', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'migration_export_transition';
  END IF;
  IF (NEW.requested_via, NEW.schema_version) IS DISTINCT FROM (OLD.requested_via, OLD.schema_version) THEN
    RAISE EXCEPTION 'migration_export: the request never changes'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'migration_export_request_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER migration_export_guard BEFORE INSERT OR UPDATE ON migration_export
  FOR EACH ROW EXECUTE FUNCTION migration_export_guard();

-- ---------------------------------------------------------------------------------------------------------------
-- migration_import, migration_reconciliation(+_table, +_attachment): CLI (mth_owner) only
CREATE TABLE migration_import (
  id                          uuid PRIMARY KEY,
  schema_version              text NOT NULL CHECK (schema_version = 'mth-migration/1'),
  source_environment          text NOT NULL CHECK (source_environment IN ('production', 'demo', 'unmarked')),
  source_export_reference     uuid NOT NULL,
  migration_level             text NOT NULL CHECK (migration_level ~ '^[0-9]{4}_[a-z0-9_]+$'),
  manifest_sha256             text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  attachment_manifest_sha256  text NOT NULL CHECK (attachment_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  demo_checksum               text NULL CHECK (demo_checksum IS NULL OR demo_checksum ~ '^[0-9a-f]{64}$'),
  table_count                 integer NOT NULL CHECK (table_count >= 0),
  row_count                   bigint NOT NULL CHECK (row_count >= 0),
  attachment_count            integer NOT NULL CHECK (attachment_count >= 0),
  attachment_bytes            bigint NOT NULL CHECK (attachment_bytes >= 0),
  operator_name               text NOT NULL CHECK (char_length(operator_name) BETWEEN 1 AND 200),
  started_at                  timestamptz NOT NULL,
  imported_at                 timestamptz NOT NULL,
  CONSTRAINT migration_import_demo_checksum CHECK ((demo_checksum IS NOT NULL) = (source_environment = 'demo')),
  CONSTRAINT migration_import_times CHECK (imported_at >= started_at)
);
SELECT p2_attach_guards('migration_import', true);
SELECT p2_attach_append_only('migration_import');
GRANT SELECT ON migration_import TO mth_app;

CREATE TABLE migration_reconciliation (
  id                      uuid PRIMARY KEY,
  migration_import_id     uuid NOT NULL REFERENCES migration_import (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  run_kind                text NOT NULL CHECK (run_kind IN ('import', 'recheck')),
  result                  text NOT NULL CHECK (result IN ('matched', 'mismatched')),
  tables_checked          integer NOT NULL CHECK (tables_checked >= 0),
  tables_mismatched       integer NOT NULL CHECK (tables_mismatched >= 0 AND tables_mismatched <= tables_checked),
  rows_expected           bigint NOT NULL CHECK (rows_expected >= 0),
  rows_actual             bigint NOT NULL CHECK (rows_actual >= 0),
  attachments_checked     integer NOT NULL CHECK (attachments_checked >= 0),
  attachments_mismatched  integer NOT NULL CHECK (attachments_mismatched >= 0
                            AND attachments_mismatched <= attachments_checked),
  operator_name           text NOT NULL CHECK (char_length(operator_name) BETWEEN 1 AND 200),
  run_at                  timestamptz NOT NULL,
  CONSTRAINT migration_reconciliation_result CHECK ((result = 'matched')
    = (tables_mismatched = 0 AND attachments_mismatched = 0 AND rows_expected = rows_actual))
);
CREATE INDEX migration_reconciliation_import_idx ON migration_reconciliation (migration_import_id, run_at DESC);
-- One 'import' run per import (the one written by the load itself).
CREATE UNIQUE INDEX migration_reconciliation_one_import_run ON migration_reconciliation (migration_import_id)
  WHERE run_kind = 'import';
SELECT p2_attach_guards('migration_reconciliation', true);
SELECT p2_attach_append_only('migration_reconciliation');
GRANT SELECT ON migration_reconciliation TO mth_app;

CREATE TABLE migration_reconciliation_table (
  migration_reconciliation_id uuid NOT NULL REFERENCES migration_reconciliation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  table_name                  text NOT NULL CHECK (table_name ~ '^[a-z][a-z0-9_]{0,62}$'),
  expected_rows               bigint NOT NULL CHECK (expected_rows >= 0),
  actual_rows                 bigint NOT NULL CHECK (actual_rows >= 0),
  expected_digest             text NOT NULL CHECK (expected_digest ~ '^[0-9a-f]{64}$'),
  actual_digest               text NOT NULL CHECK (actual_digest ~ '^[0-9a-f]{64}$'),
  matched                     boolean NOT NULL,
  CONSTRAINT migration_reconciliation_table_pkey PRIMARY KEY (migration_reconciliation_id, table_name),
  CONSTRAINT migration_reconciliation_table_matched CHECK (matched
    = (expected_rows = actual_rows AND expected_digest = actual_digest))
);
SELECT p2_attach_append_only('migration_reconciliation_table');
GRANT SELECT ON migration_reconciliation_table TO mth_app;

CREATE TABLE migration_reconciliation_attachment (
  id                          uuid PRIMARY KEY,
  migration_reconciliation_id uuid NOT NULL REFERENCES migration_reconciliation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  parent_table                text NOT NULL CHECK (parent_table ~ '^[a-z][a-z0-9_]{0,62}$'),
  object_name                 text NOT NULL CHECK (char_length(object_name) BETWEEN 1 AND 1024),
  problem                     text NOT NULL CHECK (problem IN ('missing', 'size_mismatch', 'sha256_mismatch')),
  expected_size               bigint NOT NULL CHECK (expected_size >= 0),
  actual_size                 bigint NULL CHECK (actual_size IS NULL OR actual_size >= 0),
  expected_sha256             text NOT NULL CHECK (expected_sha256 ~ '^[0-9a-f]{64}$'),
  actual_sha256               text NULL CHECK (actual_sha256 IS NULL OR actual_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT migration_reconciliation_attachment_shape CHECK ((problem = 'missing')
    = (actual_size IS NULL AND actual_sha256 IS NULL))
);
CREATE INDEX migration_reconciliation_attachment_run_idx ON migration_reconciliation_attachment
  (migration_reconciliation_id, object_name);
SELECT p2_attach_append_only('migration_reconciliation_attachment');
GRANT SELECT ON migration_reconciliation_attachment TO mth_app;

-- ---------------------------------------------------------------------------------------------------------------
-- identity_binding_hold, identity_rebind_event: CLI (mth_owner) only
CREATE TABLE identity_binding_hold (
  id                   uuid PRIMARY KEY,
  user_id              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT
                         CONSTRAINT identity_binding_hold_user_unique UNIQUE,
  migration_import_id  uuid NOT NULL REFERENCES migration_import (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  state                text NOT NULL DEFAULT 'unbound' CHECK (state IN ('unbound', 'rebound', 'retained')),
  mapping_sha256       text NULL CHECK (mapping_sha256 IS NULL OR mapping_sha256 ~ '^[0-9a-f]{64}$'),
  operator_name        text NULL CHECK (operator_name IS NULL OR char_length(operator_name) BETWEEN 1 AND 200),
  resolved_at          timestamptz NULL,
  version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identity_binding_hold_resolution CHECK ((state = 'unbound')
    = (mapping_sha256 IS NULL AND operator_name IS NULL AND resolved_at IS NULL))
);
CREATE INDEX identity_binding_hold_state_idx ON identity_binding_hold (state, user_id);
SELECT p2_attach_guards('identity_binding_hold', true);
GRANT SELECT ON identity_binding_hold TO mth_app;

CREATE FUNCTION identity_binding_hold_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'unbound' THEN
      RAISE EXCEPTION 'identity_binding_hold: a hold starts unbound'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'identity_binding_hold_transition';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state <> 'unbound' OR NEW.state = 'unbound' THEN
    RAISE EXCEPTION 'identity_binding_hold: % -> % is not a transition (rebound and retained are terminal)',
      OLD.state, NEW.state
      USING ERRCODE = 'check_violation', CONSTRAINT = 'identity_binding_hold_transition';
  END IF;
  IF (NEW.user_id, NEW.migration_import_id) IS DISTINCT FROM (OLD.user_id, OLD.migration_import_id) THEN
    RAISE EXCEPTION 'identity_binding_hold: the user and the import never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'identity_binding_hold_subject_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER identity_binding_hold_guard BEFORE INSERT OR UPDATE ON identity_binding_hold
  FOR EACH ROW EXECUTE FUNCTION identity_binding_hold_guard();

CREATE TABLE identity_rebind_event (
  id                        uuid PRIMARY KEY,
  identity_binding_hold_id  uuid NOT NULL REFERENCES identity_binding_hold (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  user_id                   uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  action                    text NOT NULL CHECK (action IN ('rebound', 'retained')),
  old_issuer                text NOT NULL CHECK (char_length(old_issuer) BETWEEN 1 AND 512),
  old_subject               text NOT NULL CHECK (char_length(old_subject) BETWEEN 1 AND 255),
  new_issuer                text NOT NULL CHECK (char_length(new_issuer) BETWEEN 1 AND 512),
  new_subject               text NOT NULL CHECK (char_length(new_subject) BETWEEN 1 AND 255),
  mapping_sha256            text NOT NULL CHECK (mapping_sha256 ~ '^[0-9a-f]{64}$'),
  operator_name             text NOT NULL CHECK (char_length(operator_name) BETWEEN 1 AND 200),
  applied_at                timestamptz NOT NULL,
  CONSTRAINT identity_rebind_event_one_per_hold UNIQUE (identity_binding_hold_id),
  CONSTRAINT identity_rebind_event_retained_same CHECK ((action = 'retained')
    = (old_issuer = new_issuer AND old_subject = new_subject))
);
SELECT p2_attach_append_only('identity_rebind_event');
GRANT SELECT ON identity_rebind_event TO mth_app;
