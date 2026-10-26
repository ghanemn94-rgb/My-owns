### connector

- **Purpose:** One connector of an organization: adapter kind (test_adapter, webhook, http_pull), target kind (kpi_actual, none), status and its current configuration version (REQ-S17-001, M0334; ADR-0055 §1).
- **Migration:** `0104_p6_connectors_runs_outbound_writes.sql`. **API module:** `integrations`. **Who writes:** `connector.configure` (ADM_TECH) through createConnector, putConnector, enableConnector, disableConnector; creation also writes configuration version 1 and the connector's service identity (ADR-0053 §1) in the same transaction. **Lifecycle:** created disabled at configuration version 1; disabled <-> enabled; code, adapter kind and target kind fixed; versioned and audited.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| code | text | NOT NULL |  | `CHECK ((code ~ '^[a-z][a-z0-9_-]{1,62}$'))` |
| name_en | text | NOT NULL |  | `CHECK (((char_length(name_en) >= 1) AND (char_length(name_en) <= 200)))` |
| name_ar | text | NOT NULL |  | `CHECK (((char_length(name_ar) >= 1) AND (char_length(name_ar) <= 200)))` |
| adapter_kind | text | NOT NULL |  | `CHECK ((adapter_kind = ANY (ARRAY['test_adapter', 'webhook', 'http_pull'])))` |
| target_kind | text | NOT NULL |  | `CHECK ((target_kind = ANY (ARRAY['kpi_actual', 'none'])))` |
| status | text | NOT NULL | `'disabled'` | `CHECK ((status = ANY (ARRAY['disabled', 'enabled'])))` |
| config_version_no | integer | NOT NULL |  | `CHECK ((config_version_no >= 1))` |
| status_reason | text | NULL |  | `CHECK (((status_reason IS NULL) OR ((char_length(status_reason) >= 3) AND (char_length(status_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `connector_current_config_fkey` (FK): `FOREIGN KEY (id, config_version_no) REFERENCES connector_config_version(connector_id, version_no) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED`
- `connector_organization_code_key` (UNIQUE): `UNIQUE (organization_id, code)`
- `connector_organization_id_id_key` (UNIQUE): `UNIQUE (organization_id, id)`
- `connector_webhook_target` (CHECK): `CHECK (((adapter_kind <> 'webhook') OR (target_kind = 'kpi_actual')))`

**Indexes:**

- `connector_list_idx`: `(organization_id, status, code)`

**Triggers:**

- `connector_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `connector_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `connector_guard()`
- `connector_history`: AFTER INSERT OR UPDATE FOR EACH ROW → `connector_history()`
- `connector_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

### connector_config_version

- **Purpose:** One immutable configuration version of a connector: source system id, credential REFERENCES, field mappings, target transformation, cadence, retry bound, commit mode, outbound actions, reconciliation rule, adapter settings (ADR-0055 §1).
- **Migration:** `0104_p6_connectors_runs_outbound_writes.sql`. **API module:** `integrations`. **Who writes:** `connector.configure` (ADM_TECH) through createConnector, putConnector and putConnectorMappings (each change is a new version). **Lifecycle:** append-only; numbered 1, 2, 3 … per connector without gaps.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| connector_id | uuid | NOT NULL |  | FK → connector(id) |
| version_no | integer | NOT NULL |  | `CHECK ((version_no >= 1))` |
| source_system_id | text | NOT NULL |  | `CHECK ((((char_length(source_system_id) >= 1) AND (char_length(source_system_id) <= 200)) AND (source_system_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]*$')))` |
| endpoint_url | text | NULL |  | `CHECK (((endpoint_url IS NULL) OR ((endpoint_url ~ '^https://[^/?#@[:space:]]+') AND (char_length(endpoint_url) <= 500))))` |
| credential_refs | jsonb | NOT NULL | `'{}'::jsonb` |  |
| field_mappings | jsonb | NOT NULL | `'[]'::jsonb` |  |
| target_transformation_id | uuid | NULL |  | FK → transformation(id) |
| cadence | text | NOT NULL |  | `CHECK ((cadence = ANY (ARRAY['manual', 'hourly', 'daily', 'weekly'])))` |
| retry_max_attempts | smallint | NOT NULL | `3` | `CHECK (((retry_max_attempts >= 0) AND (retry_max_attempts <= 5)))` |
| retry_backoff_seconds | integer | NOT NULL | `60` | `CHECK (((retry_backoff_seconds >= 10) AND (retry_backoff_seconds <= 3600)))` |
| commit_mode | text | NOT NULL | `'manual'` | `CHECK ((commit_mode = ANY (ARRAY['manual', 'auto'])))` |
| commit_on_behalf_of | uuid | NULL |  | FK → app_user(id) |
| outbound_actions | text[] | NOT NULL | `'{}'[]` | `CHECK ((outbound_actions <@ ARRAY['deliverable_status_push']))` |
| reconciliation_rule | text | NOT NULL | `'row_count'` | `CHECK ((reconciliation_rule = ANY (ARRAY['none', 'row_count', 'row_count_and_total'])))` |
| adapter_settings | jsonb | NOT NULL | `'{}'::jsonb` | `CHECK (((jsonb_typeof(adapter_settings) = 'object') AND (octet_length((adapter_settings)) <= 4096)))` |
| reason | text | NOT NULL |  | `CHECK (((char_length(reason) >= 3) AND (char_length(reason) <= 1000)))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `connector_config_version_commit_mode` (CHECK): `CHECK (((commit_mode = 'auto') = (commit_on_behalf_of IS NOT NULL)))`
- `connector_config_version_credential_refs` (CHECK): `CHECK (p6_credential_refs_valid(credential_refs))`
- `connector_config_version_field_mappings` (CHECK): `CHECK (p6_field_mappings_valid(field_mappings))`
- `connector_config_version_no_key` (UNIQUE): `UNIQUE (connector_id, version_no)`
- `connector_config_version_no_secret_settings` (CHECK): `CHECK (p6_settings_without_secret_keys(adapter_settings))`

**Triggers:**

- `connector_config_version_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `connector_config_version_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `connector_config_version_guard`: BEFORE INSERT FOR EACH ROW → `connector_config_version_guard()`

### connector_change

- **Purpose:** Append-only history of every version of a connector (status, current configuration, names).
- **Migration:** `0104_p6_connectors_runs_outbound_writes.sql`. **API module:** `integrations`. **Who writes:** the SECURITY DEFINER trigger `connector_history` only. **Lifecycle:** append-only; one row per connector version.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| connector_id | uuid | NOT NULL |  | FK → connector(id) |
| record_version | integer | NOT NULL |  | `CHECK ((record_version >= 1))` |
| status | text | NOT NULL |  |  |
| config_version_no | integer | NOT NULL |  |  |
| status_reason | text | NULL |  |  |
| name_en | text | NOT NULL |  |  |
| name_ar | text | NOT NULL |  |  |
| changed_by | uuid | NOT NULL |  | FK → app_user(id) |
| changed_at | timestamp with time zone | NOT NULL |  |  |

**Table constraints:**

- `connector_change_version_key` (UNIQUE): `UNIQUE (connector_id, record_version)`

**Triggers:**

- `connector_change_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `connector_change_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

### integration_run

- **Purpose:** IntegrationRun (REQ-S16-022): one run of a connector with its trigger, attempt, counts (read, staged, committed, rejected, duplicates, errors), error code and redacted message, and reconciliation (REQ-S17-001; ADR-0055 §2).
- **Migration:** `0104_p6_connectors_runs_outbound_writes.sql`. **API module:** `integrations`. **Who writes:** the worker connector-run handler (actor service, as the connector's service identity; lock 730310); runConnector, retryIntegrationRun, testConnector and the webhook receipt create it queued. **Lifecycle:** queued -> running | cancelled; running -> succeeded | failed; finished rows never change; one active run per connector; at most one retry per failed run; versioned and audited.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| connector_id | uuid | NOT NULL |  | FK → connector(id) |
| config_version_no | integer | NOT NULL |  |  |
| trigger_kind | text | NOT NULL |  | `CHECK ((trigger_kind = ANY (ARRAY['schedule', 'manual', 'retry', 'test', 'webhook'])))` |
| status | text | NOT NULL | `'queued'` | `CHECK ((status = ANY (ARRAY['queued', 'running', 'succeeded', 'failed', 'cancelled'])))` |
| attempt_no | smallint | NOT NULL | `1` | `CHECK (((attempt_no >= 1) AND (attempt_no <= 6)))` |
| retry_of_run_id | uuid | NULL |  | FK → integration_run(id) |
| idempotency_key | text | NOT NULL |  | `CHECK ((((char_length(idempotency_key) >= 8) AND (char_length(idempotency_key) <= 200)) AND (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$')))` |
| requested_by | uuid | NULL |  | FK → app_user(id) |
| service_identity_id | uuid | NOT NULL |  | FK → service_identity(id) |
| queued_at | timestamp with time zone | NOT NULL |  |  |
| started_at | timestamp with time zone | NULL |  |  |
| finished_at | timestamp with time zone | NULL |  |  |
| rows_read | integer | NULL |  | `CHECK (((rows_read IS NULL) OR (rows_read >= 0)))` |
| rows_staged | integer | NULL |  | `CHECK (((rows_staged IS NULL) OR (rows_staged >= 0)))` |
| rows_committed | integer | NULL |  | `CHECK (((rows_committed IS NULL) OR (rows_committed >= 0)))` |
| rows_rejected | integer | NULL |  | `CHECK (((rows_rejected IS NULL) OR (rows_rejected >= 0)))` |
| rows_duplicate | integer | NULL |  | `CHECK (((rows_duplicate IS NULL) OR (rows_duplicate >= 0)))` |
| error_count | integer | NULL |  | `CHECK (((error_count IS NULL) OR (error_count >= 0)))` |
| error_code | text | NULL |  | `CHECK (((error_code IS NULL) OR (((char_length(error_code) >= 1) AND (char_length(error_code) <= 100)) AND (error_code ~ '^[a-z][a-z0-9_.]*$'))))` |
| error_message | text | NULL |  | `CHECK (((error_message IS NULL) OR ((char_length(error_message) >= 1) AND (char_length(error_message) <= 2000))))` |
| reconciliation_status | text | NOT NULL | `'not_checked'` | `CHECK ((reconciliation_status = ANY (ARRAY['not_checked', 'matched', 'mismatched', 'not_applicable'])))` |
| source_row_count | integer | NULL |  | `CHECK (((source_row_count IS NULL) OR (source_row_count >= 0)))` |
| source_control_total | numeric(24,6) | NULL |  |  |
| staged_control_total | numeric(24,6) | NULL |  |  |
| import_batch_id | uuid | NULL |  | FK → import_batch(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `integration_run_config_fkey` (FK): `FOREIGN KEY (connector_id, config_version_no) REFERENCES connector_config_version(connector_id, version_no) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `integration_run_connector_org_fkey` (FK): `FOREIGN KEY (organization_id, connector_id) REFERENCES connector(organization_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `integration_run_count_order` (CHECK): `CHECK ((((rows_staged IS NULL) OR (rows_read IS NULL) OR (rows_staged <= rows_read)) AND ((rows_staged IS NULL) OR (((COALESCE(rows_committed, 0) + COALESCE(rows_rejected, 0)) + COALESCE(rows_duplicate, 0)) <= rows_staged))))`
- `integration_run_failure_shape` (CHECK): `CHECK ((((status = 'failed') = (error_code IS NOT NULL)) AND ((error_message IS NULL) OR (error_code IS NOT NULL))))`
- `integration_run_idempotency_key` (UNIQUE): `UNIQUE (connector_id, idempotency_key)`
- `integration_run_one_retry_key` (UNIQUE): `UNIQUE (retry_of_run_id)`
- `integration_run_reconciliation_shape` (CHECK): `CHECK ((((reconciliation_status = ANY (ARRAY['matched', 'mismatched'])) = (source_row_count IS NOT NULL)) AND ((staged_control_total IS NULL) OR (source_control_total IS NOT NULL))))`
- `integration_run_requester` (CHECK): `CHECK (((trigger_kind <> ALL (ARRAY['manual', 'test'])) OR (requested_by IS NOT NULL)))`
- `integration_run_retry_shape` (CHECK): `CHECK ((((trigger_kind = 'retry') = (retry_of_run_id IS NOT NULL)) AND ((retry_of_run_id IS NULL) = (attempt_no = 1))))`
- `integration_run_status_shape` (CHECK): `CHECK ((((status = 'queued') AND (started_at IS NULL) AND (finished_at IS NULL)) OR ((status = 'running') AND (started_at IS NOT NULL) AND (finished_at IS NULL)) OR ((status = 'cancelled') AND (started_at IS NULL) AND (finished_at IS NULL)) OR ((status = ANY (ARRAY['succeeded', 'failed'])) AND (finished_at IS NOT NULL))))`
- `integration_run_success_counts` (CHECK): `CHECK (((status <> 'succeeded') OR ((rows_read IS NOT NULL) AND (rows_staged IS NOT NULL) AND (rows_rejected IS NOT NULL) AND (rows_duplicate IS NOT NULL) AND (error_count IS NOT NULL))))`
- `integration_run_times` (CHECK): `CHECK ((((started_at IS NULL) OR (started_at >= queued_at)) AND ((finished_at IS NULL) OR ((started_at IS NOT NULL) AND (finished_at >= started_at)))))`

**Indexes:**

- `integration_run_last_success_idx`: `(connector_id, finished_at DESC) WHERE (status = 'succeeded')`
- `integration_run_list_idx`: `(connector_id, queued_at DESC, id DESC)`
- `integration_run_one_active`: `UNIQUE (connector_id) WHERE (status = ANY (ARRAY['queued', 'running']))`

**Triggers:**

- `integration_run_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `integration_run_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `integration_run_guard()`
- `integration_run_history`: AFTER INSERT OR UPDATE FOR EACH ROW → `integration_run_history()`
- `integration_run_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

### integration_run_event

- **Purpose:** Append-only status history of an integration run.
- **Migration:** `0104_p6_connectors_runs_outbound_writes.sql`. **API module:** `integrations`. **Who writes:** the SECURITY DEFINER trigger `integration_run_history` only. **Lifecycle:** append-only; one row per integration_run version.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| integration_run_id | uuid | NOT NULL |  | FK → integration_run(id) |
| record_version | integer | NOT NULL |  | `CHECK ((record_version >= 1))` |
| status | text | NOT NULL |  |  |
| rows_read | integer | NULL |  |  |
| rows_staged | integer | NULL |  |  |
| rows_committed | integer | NULL |  |  |
| rows_rejected | integer | NULL |  |  |
| rows_duplicate | integer | NULL |  |  |
| error_count | integer | NULL |  |  |
| error_code | text | NULL |  |  |
| occurred_at | timestamp with time zone | NOT NULL |  |  |

**Table constraints:**

- `integration_run_event_version_key` (UNIQUE): `UNIQUE (integration_run_id, record_version)`

**Triggers:**

- `integration_run_event_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `integration_run_event_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

### outbound_write

- **Purpose:** One guarded downstream write (REQ-S17-006, M0335): a connector-defined action on a deliverable with an idempotency key, marked confirmed only with the reference of a confirmed response (ADR-0055 §5).
- **Migration:** `0104_p6_connectors_runs_outbound_writes.sql`. **API module:** `integrations`. **Who writes:** `outbound_write.execute` (TD) through executeOutboundWrite and confirmOutboundWrite; the dispatch result by the same request after the transaction (lock 730313). **Lifecycle:** requested -> pending_confirmation | confirmed | failed; pending_confirmation -> confirmed | failed; confirmed and failed final; one per (connector, idempotency key); versioned and audited.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| connector_id | uuid | NOT NULL |  | FK → connector(id) |
| config_version_no | integer | NOT NULL |  |  |
| action_code | text | NOT NULL |  | `CHECK ((action_code = 'deliverable_status_push'))` |
| deliverable_id | uuid | NOT NULL |  |  |
| idempotency_key | text | NOT NULL |  | `CHECK ((((char_length(idempotency_key) >= 8) AND (char_length(idempotency_key) <= 200)) AND (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$')))` |
| payload | jsonb | NOT NULL |  | `CHECK (((jsonb_typeof(payload) = 'object') AND (octet_length((payload)) <= 16384)))` |
| payload_sha256 | character(64) | NOT NULL |  | `CHECK ((payload_sha256 ~ '^[0-9a-f]{64}$'))` |
| status | text | NOT NULL | `'requested'` | `CHECK ((status = ANY (ARRAY['requested', 'pending_confirmation', 'confirmed', 'failed'])))` |
| attempt_count | smallint | NOT NULL | `0` | `CHECK (((attempt_count >= 0) AND (attempt_count <= 10)))` |
| last_attempt_at | timestamp with time zone | NULL |  |  |
| external_reference | text | NULL |  | `CHECK (((external_reference IS NULL) OR ((char_length(external_reference) >= 1) AND (char_length(external_reference) <= 200))))` |
| confirmed_at | timestamp with time zone | NULL |  |  |
| failure_code | text | NULL |  | `CHECK (((failure_code IS NULL) OR (((char_length(failure_code) >= 1) AND (char_length(failure_code) <= 100)) AND (failure_code ~ '^[a-z][a-z0-9_.]*$'))))` |
| failure_message | text | NULL |  | `CHECK (((failure_message IS NULL) OR ((char_length(failure_message) >= 1) AND (char_length(failure_message) <= 2000))))` |
| requested_by | uuid | NOT NULL |  | FK → app_user(id) |
| service_identity_id | uuid | NOT NULL |  | FK → service_identity(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `outbound_write_attempt_shape` (CHECK): `CHECK ((((attempt_count = 0) = (last_attempt_at IS NULL)) AND ((status = 'requested') OR (attempt_count >= 1))))`
- `outbound_write_config_fkey` (FK): `FOREIGN KEY (connector_id, config_version_no) REFERENCES connector_config_version(connector_id, version_no) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `outbound_write_confirmed_shape` (CHECK): `CHECK ((((status = 'confirmed') = (confirmed_at IS NOT NULL)) AND ((status <> 'confirmed') OR (external_reference IS NOT NULL))))`
- `outbound_write_connector_org_fkey` (FK): `FOREIGN KEY (organization_id, connector_id) REFERENCES connector(organization_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `outbound_write_deliverable_fkey` (FK): `FOREIGN KEY (transformation_id, deliverable_id) REFERENCES deliverable(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `outbound_write_failed_shape` (CHECK): `CHECK ((((status = 'failed') = (failure_code IS NOT NULL)) AND ((failure_message IS NULL) OR (failure_code IS NOT NULL))))`
- `outbound_write_idempotency_key` (UNIQUE): `UNIQUE (connector_id, idempotency_key)`

**Indexes:**

- `outbound_write_deliverable_idx`: `(deliverable_id, created_at DESC)`
- `outbound_write_list_idx`: `(transformation_id, created_at DESC, id DESC)`

**Triggers:**

- `outbound_write_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `outbound_write_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `outbound_write_guard()`
- `outbound_write_history`: AFTER INSERT OR UPDATE FOR EACH ROW → `outbound_write_history()`
- `outbound_write_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

### outbound_write_event

- **Purpose:** Append-only status history of an outbound write.
- **Migration:** `0104_p6_connectors_runs_outbound_writes.sql`. **API module:** `integrations`. **Who writes:** the SECURITY DEFINER trigger `outbound_write_history` only. **Lifecycle:** append-only; one row per outbound_write version.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| outbound_write_id | uuid | NOT NULL |  | FK → outbound_write(id) |
| record_version | integer | NOT NULL |  | `CHECK ((record_version >= 1))` |
| status | text | NOT NULL |  |  |
| attempt_count | smallint | NOT NULL |  |  |
| external_reference | text | NULL |  |  |
| failure_code | text | NULL |  |  |
| actor_user_id | uuid | NULL |  | FK → app_user(id) |
| occurred_at | timestamp with time zone | NOT NULL |  |  |

**Table constraints:**

- `outbound_write_event_version_key` (UNIQUE): `UNIQUE (outbound_write_id, record_version)`

**Triggers:**

- `outbound_write_event_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `outbound_write_event_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

### webhook_endpoint

- **Purpose:** One signed webhook endpoint of a webhook connector: the endpoint key, the signing secret REFERENCE (and the previous one during a rotation), the timestamp tolerance (REQ-S17-003; ADR-0056 §7).
- **Migration:** `0105_p6_imports_lineage_webhooks.sql`. **API module:** `integrations`. **Who writes:** `webhook.configure` (ADM_TECH) through createWebhookEndpoint, rotateWebhookSecret, disableWebhookEndpoint. **Lifecycle:** active -> disabled (final); a rotation keeps the old reference for at most 7 days; versioned and audited.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| connector_id | uuid | NOT NULL |  |  |
| endpoint_key | text | NOT NULL |  | `CHECK ((endpoint_key ~ '^[A-Za-z0-9_-]{32,64}$'))` |
| label | text | NOT NULL |  | `CHECK (((char_length(label) >= 1) AND (char_length(label) <= 200)))` |
| signing_secret_ref | jsonb | NOT NULL |  |  |
| previous_secret_ref | jsonb | NULL |  |  |
| previous_valid_until | timestamp with time zone | NULL |  |  |
| secret_rotated_at | timestamp with time zone | NULL |  |  |
| tolerance_seconds | integer | NOT NULL | `300` | `CHECK (((tolerance_seconds >= 30) AND (tolerance_seconds <= 900)))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'disabled'])))` |
| disabled_at | timestamp with time zone | NULL |  |  |
| disabled_by | uuid | NULL |  | FK → app_user(id) |
| disable_reason | text | NULL |  | `CHECK (((disable_reason IS NULL) OR ((char_length(disable_reason) >= 3) AND (char_length(disable_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `webhook_endpoint_connector_org_fkey` (FK): `FOREIGN KEY (organization_id, connector_id) REFERENCES connector(organization_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `webhook_endpoint_disabled_shape` (CHECK): `CHECK ((((status = 'disabled') = (disabled_at IS NOT NULL)) AND ((disabled_at IS NULL) = (disabled_by IS NULL)) AND ((disabled_at IS NULL) = (disable_reason IS NULL))))`
- `webhook_endpoint_key_key` (UNIQUE): `UNIQUE (endpoint_key)`
- `webhook_endpoint_previous_secret_ref` (CHECK): `CHECK (p6_secret_ref_valid(previous_secret_ref))`
- `webhook_endpoint_previous_shape` (CHECK): `CHECK ((((previous_secret_ref IS NULL) = (previous_valid_until IS NULL)) AND ((previous_secret_ref IS NULL) OR (secret_rotated_at IS NOT NULL)) AND ((previous_secret_ref IS NULL) OR (previous_secret_ref <> signing_secret_ref))))`
- `webhook_endpoint_secret_ref` (CHECK): `CHECK (((signing_secret_ref IS NOT NULL) AND p6_secret_ref_valid(signing_secret_ref)))`

**Indexes:**

- `webhook_endpoint_list_idx`: `(organization_id, status, created_at DESC, id DESC)`

**Triggers:**

- `webhook_endpoint_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `webhook_endpoint_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `webhook_endpoint_guard()`
- `webhook_endpoint_history`: AFTER INSERT OR UPDATE FOR EACH ROW → `webhook_endpoint_history()`
- `webhook_endpoint_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

### webhook_endpoint_change

- **Purpose:** Append-only history of every version of a webhook endpoint.
- **Migration:** `0105_p6_imports_lineage_webhooks.sql`. **API module:** `integrations`. **Who writes:** the SECURITY DEFINER trigger `webhook_endpoint_history` only. **Lifecycle:** append-only; one row per webhook_endpoint version.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| webhook_endpoint_id | uuid | NOT NULL |  | FK → webhook_endpoint(id) |
| record_version | integer | NOT NULL |  | `CHECK ((record_version >= 1))` |
| status | text | NOT NULL |  |  |
| signing_secret_ref | jsonb | NOT NULL |  |  |
| previous_secret_ref | jsonb | NULL |  |  |
| previous_valid_until | timestamp with time zone | NULL |  |  |
| tolerance_seconds | integer | NOT NULL |  |  |
| changed_by | uuid | NOT NULL |  | FK → app_user(id) |
| changed_at | timestamp with time zone | NOT NULL |  |  |

**Table constraints:**

- `webhook_endpoint_change_version_key` (UNIQUE): `UNIQUE (webhook_endpoint_id, record_version)`

**Triggers:**

- `webhook_endpoint_change_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `webhook_endpoint_change_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

### webhook_receipt

- **Purpose:** One ACCEPTED webhook delivery (signature valid, inside the window): the replay and idempotency backstop (ADR-0056 §7). Rejected requests are not stored.
- **Migration:** `0105_p6_imports_lineage_webhooks.sql`. **API module:** `integrations`. **Who writes:** receiveWebhook (no session; signature-authenticated; lock 730312), in the transaction that creates its staged batch. **Lifecycle:** append-only; one per (endpoint, delivery id).
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| webhook_endpoint_id | uuid | NOT NULL |  | FK → webhook_endpoint(id) |
| delivery_id | text | NOT NULL |  | `CHECK ((delivery_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'))` |
| signed_at | timestamp with time zone | NOT NULL |  |  |
| received_at | timestamp with time zone | NOT NULL |  |  |
| secret_slot | text | NOT NULL |  | `CHECK ((secret_slot = ANY (ARRAY['current', 'previous'])))` |
| body_sha256 | character(64) | NOT NULL |  | `CHECK ((body_sha256 ~ '^[0-9a-f]{64}$'))` |
| body_bytes | integer | NOT NULL |  | `CHECK (((body_bytes >= 2) AND (body_bytes <= 1048576)))` |
| item_count | integer | NOT NULL |  | `CHECK (((item_count >= 0) AND (item_count <= 5000)))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `webhook_receipt_delivery_key` (UNIQUE): `UNIQUE (webhook_endpoint_id, delivery_id)`
- `webhook_receipt_window` (CHECK): `CHECK ((((received_at - signed_at) >= '-00:15:00'::interval) AND ((received_at - signed_at) <= '00:15:00'::interval)))`

**Indexes:**

- `webhook_receipt_list_idx`: `(webhook_endpoint_id, received_at DESC, id DESC)`

**Triggers:**

- `webhook_receipt_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `webhook_receipt_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `webhook_receipt_guard`: BEFORE INSERT FOR EACH ROW → `webhook_receipt_guard()`

### import_batch

- **Purpose:** One staged import into one transformation and target kind, pinned to the transformation's form schema version (REQ-S17-002; ADR-0056 §2).
- **Migration:** `0105_p6_imports_lineage_webhooks.sql`. **API module:** `integrations (imports)`. **Who writes:** `import.create` (KDS) through createImport; the webhook receipt and the connector run (service); commit and cancel: `import.commit` (KDS) through commitImport and cancelImport, or the auto commit on behalf of the configured user (lock 730311). **Lifecycle:** staging -> staged | failed; staged -> committed | cancelled; final states never change; versioned and audited.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| target_kind | text | NOT NULL |  | `CHECK ((target_kind = 'kpi_actual'))` |
| template_version | text | NOT NULL |  | `CHECK ((template_version ~ '^[a-z][a-z0-9_]*\.v[1-9][0-9]*$'))` |
| form_schema_version_id | uuid | NOT NULL |  | FK → methodology_version(id) |
| source_kind | text | NOT NULL |  | `CHECK ((source_kind = ANY (ARRAY['csv_upload', 'xlsx_upload', 'webhook', 'connector'])))` |
| connector_id | uuid | NULL |  | FK → connector(id) |
| integration_run_id | uuid | NULL |  | FK → integration_run(id) |
| webhook_receipt_id | uuid | NULL |  | FK → webhook_receipt(id) |
| file_name | text | NULL |  | `CHECK (((file_name IS NULL) OR ((char_length(file_name) >= 1) AND (char_length(file_name) <= 255))))` |
| media_type | text | NULL |  | `CHECK (((media_type IS NULL) OR (media_type = ANY (ARRAY['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/json']))))` |
| byte_size | integer | NULL |  | `CHECK (((byte_size IS NULL) OR ((byte_size >= 1) AND (byte_size <= 10485760))))` |
| content_sha256 | character(64) | NULL |  | `CHECK (((content_sha256 IS NULL) OR (content_sha256 ~ '^[0-9a-f]{64}$')))` |
| status | text | NOT NULL | `'staging'` | `CHECK ((status = ANY (ARRAY['staging', 'staged', 'committed', 'cancelled', 'failed'])))` |
| rows_total | integer | NULL |  | `CHECK (((rows_total IS NULL) OR ((rows_total >= 0) AND (rows_total <= 5000))))` |
| rows_valid | integer | NULL |  | `CHECK (((rows_valid IS NULL) OR (rows_valid >= 0)))` |
| rows_invalid | integer | NULL |  | `CHECK (((rows_invalid IS NULL) OR (rows_invalid >= 0)))` |
| rows_duplicate | integer | NULL |  | `CHECK (((rows_duplicate IS NULL) OR (rows_duplicate >= 0)))` |
| rows_committed | integer | NULL |  | `CHECK (((rows_committed IS NULL) OR (rows_committed >= 0)))` |
| failure_code | text | NULL |  | `CHECK (((failure_code IS NULL) OR (((char_length(failure_code) >= 1) AND (char_length(failure_code) <= 100)) AND (failure_code ~ '^[a-z][a-z0-9_.]*$'))))` |
| commit_mode | text | NOT NULL | `'manual'` | `CHECK ((commit_mode = ANY (ARRAY['manual', 'auto'])))` |
| on_behalf_of_user_id | uuid | NULL |  | FK → app_user(id) |
| committed_at | timestamp with time zone | NULL |  |  |
| committed_by | uuid | NULL |  | FK → app_user(id) |
| cancelled_at | timestamp with time zone | NULL |  |  |
| cancelled_by | uuid | NULL |  | FK → app_user(id) |
| cancel_reason | text | NULL |  | `CHECK (((cancel_reason IS NULL) OR ((char_length(cancel_reason) >= 3) AND (char_length(cancel_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `import_batch_cancelled_shape` (CHECK): `CHECK ((((status = 'cancelled') = (cancelled_at IS NOT NULL)) AND ((cancelled_at IS NULL) = (cancel_reason IS NULL)) AND ((cancelled_by IS NULL) OR (cancelled_at IS NOT NULL))))`
- `import_batch_commit_mode` (CHECK): `CHECK (((commit_mode = 'auto') = (on_behalf_of_user_id IS NOT NULL)))`
- `import_batch_committed_shape` (CHECK): `CHECK ((((status = 'committed') = (committed_at IS NOT NULL)) AND ((status = 'committed') = (rows_committed IS NOT NULL)) AND ((rows_committed IS NULL) OR (rows_committed <= rows_valid)) AND ((committed_by IS NULL) OR (committed_at IS NOT NULL)) AND ((status <> 'committed') OR (committed_by IS NOT NULL) OR (commit_mode = 'auto'))))`
- `import_batch_counts` (CHECK): `CHECK ((((status = 'staging') AND (rows_total IS NULL) AND (rows_valid IS NULL) AND (rows_invalid IS NULL) AND (rows_duplicate IS NULL)) OR ((status = 'failed') AND (rows_total IS NULL)) OR ((status = ANY (ARRAY['staged', 'committed', 'cancelled'])) AND (rows_total IS NOT NULL) AND (((rows_valid + rows_invalid) + rows_duplicate) = rows_total))))`
- `import_batch_failed_shape` (CHECK): `CHECK (((status = 'failed') = (failure_code IS NOT NULL)))`
- `import_batch_source_shape` (CHECK): `CHECK ((((source_kind = ANY (ARRAY['csv_upload', 'xlsx_upload'])) AND (file_name IS NOT NULL) AND (media_type IS NOT NULL) AND (byte_size IS NOT NULL) AND (content_sha256 IS NOT NULL) AND (connector_id IS NULL) AND (integration_run_id IS NULL) AND (webhook_receipt_id IS NULL) AND (created_by IS NOT NULL) AND (commit_mode = 'manual') AND (media_type =
CASE source_kind
    WHEN 'csv_upload' THEN 'text/csv'
    ELSE 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
END)) OR ((source_kind = 'webhook') AND (webhook_receipt_id IS NOT NULL) AND (connector_id IS NOT NULL) AND (integration_run_id IS NULL) AND (file_name IS NULL) AND (media_type = 'application/json') AND (created_by IS NULL)) OR ((source_kind = 'connector') AND (connector_id IS NOT NULL) AND (integration_run_id IS NOT NULL) AND (webhook_receipt_id IS NULL) AND (file_name IS NULL) AND (created_by IS NULL))))`
- `import_batch_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`
- `import_batch_webhook_receipt_key` (UNIQUE): `UNIQUE (webhook_receipt_id)`

**Indexes:**

- `import_batch_connector_idx`: `(connector_id, created_at DESC) WHERE (connector_id IS NOT NULL)`
- `import_batch_list_idx`: `(transformation_id, created_at DESC, id DESC)`

**Triggers:**

- `import_batch_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `import_batch_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `import_batch_guard()`
- `import_batch_history`: AFTER INSERT OR UPDATE FOR EACH ROW → `import_batch_history()`
- `import_batch_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

### import_batch_event

- **Purpose:** Append-only status and count history of an import batch.
- **Migration:** `0105_p6_imports_lineage_webhooks.sql`. **API module:** `integrations (imports)`. **Who writes:** the SECURITY DEFINER trigger `import_batch_history` only. **Lifecycle:** append-only; one row per import_batch version.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| import_batch_id | uuid | NOT NULL |  | FK → import_batch(id) |
| record_version | integer | NOT NULL |  | `CHECK ((record_version >= 1))` |
| status | text | NOT NULL |  |  |
| rows_total | integer | NULL |  |  |
| rows_valid | integer | NULL |  |  |
| rows_invalid | integer | NULL |  |  |
| rows_duplicate | integer | NULL |  |  |
| rows_committed | integer | NULL |  |  |
| failure_code | text | NULL |  |  |
| actor_user_id | uuid | NULL |  | FK → app_user(id) |
| occurred_at | timestamp with time zone | NOT NULL |  |  |

**Table constraints:**

- `import_batch_event_version_key` (UNIQUE): `UNIQUE (import_batch_id, record_version)`

**Triggers:**

- `import_batch_event_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `import_batch_event_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

### import_row

- **Purpose:** One staged source row: raw cells as text, normalized values, duplicate key, validation status and row-level reason codes (REQ-S17-002; ADR-0056 §3–§5).
- **Migration:** `0105_p6_imports_lineage_webhooks.sql`. **API module:** `integrations (imports)`. **Who writes:** the staging step of createImport, the webhook receipt and the connector run; the commit moves commit_status (column-level UPDATE). **Lifecycle:** inserted while the batch is staging; then only commit_status pending -> committed | not_committed; never deleted; covered by the batch's audit events.
- **`mth_app` privileges:** INSERT, SELECT; UPDATE on (commit_status, updated_at) only.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| import_batch_id | uuid | NOT NULL |  |  |
| row_number | integer | NOT NULL |  | `CHECK (((row_number >= 1) AND (row_number <= 100000)))` |
| source_record_id | text | NULL |  | `CHECK (((source_record_id IS NULL) OR ((char_length(source_record_id) >= 1) AND (char_length(source_record_id) <= 200))))` |
| raw | jsonb | NOT NULL |  |  |
| normalized | jsonb | NULL |  | `CHECK (((normalized IS NULL) OR (jsonb_typeof(normalized) = 'object')))` |
| duplicate_key | text | NULL |  | `CHECK (((duplicate_key IS NULL) OR ((char_length(duplicate_key) >= 1) AND (char_length(duplicate_key) <= 400))))` |
| validation_status | text | NOT NULL |  | `CHECK ((validation_status = ANY (ARRAY['valid', 'invalid', 'duplicate_in_batch', 'duplicate_committed'])))` |
| duplicate_of_row_id | uuid | NULL |  | FK → import_row(id) |
| reasons | jsonb | NOT NULL | `'[]'::jsonb` |  |
| commit_status | text | NOT NULL | `'pending'` | `CHECK ((commit_status = ANY (ARRAY['pending', 'committed', 'not_committed'])))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `import_row_batch_fkey` (FK): `FOREIGN KEY (transformation_id, import_batch_id) REFERENCES import_batch(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `import_row_duplicate_shape` (CHECK): `CHECK (((validation_status = 'duplicate_in_batch') = (duplicate_of_row_id IS NOT NULL)))`
- `import_row_number_key` (UNIQUE): `UNIQUE (import_batch_id, row_number)`
- `import_row_raw` (CHECK): `CHECK (p6_import_raw_valid(raw))`
- `import_row_reasons` (CHECK): `CHECK (p6_import_reasons_valid(reasons))`
- `import_row_valid_shape` (CHECK): `CHECK ((((validation_status = 'valid') = (normalized IS NOT NULL)) AND ((validation_status = 'valid') = (jsonb_array_length(reasons) = 0)) AND ((validation_status = 'valid') OR (commit_status <> 'committed')) AND ((validation_status <> ALL (ARRAY['valid', 'duplicate_in_batch', 'duplicate_committed'])) OR (duplicate_key IS NOT NULL))))`

**Indexes:**

- `import_row_one_valid_per_key`: `UNIQUE (import_batch_id, duplicate_key) WHERE (validation_status = 'valid')`
- `import_row_status_idx`: `(import_batch_id, validation_status, row_number)`

**Triggers:**

- `import_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `import_row_guard()`
- `import_row_no_delete`: BEFORE DELETE FOR EACH ROW → `import_row_no_delete()`
- `import_row_no_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `import_row_no_delete()`
- `import_row_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

### import_row_commit

- **Purpose:** Lineage: a committed row -> the KPI actual (and value number) it created through the DG4 submission path (REQ-S17-002; ADR-0056 §6).
- **Migration:** `0105_p6_imports_lineage_webhooks.sql`. **API module:** `integrations (imports)`. **Who writes:** commitImport through the `ImportTargetRegistry` target (KBE-A), in the commit transaction. **Lifecycle:** append-only; one per committed row.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| import_batch_id | uuid | NOT NULL |  |  |
| import_row_id | uuid | NOT NULL |  | FK → import_row(id) |
| target_record_type | text | NOT NULL |  | `CHECK ((target_record_type = 'kpi_actual'))` |
| target_record_id | uuid | NOT NULL |  |  |
| target_value_no | smallint | NULL |  | `CHECK (((target_value_no IS NULL) OR (target_value_no >= 1)))` |
| committed_at | timestamp with time zone | NOT NULL |  |  |

**Table constraints:**

- `import_row_commit_batch_fkey` (FK): `FOREIGN KEY (transformation_id, import_batch_id) REFERENCES import_batch(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `import_row_commit_row_key` (UNIQUE): `UNIQUE (import_row_id)`

**Indexes:**

- `import_row_commit_target_idx`: `(target_record_type, target_record_id)`

**Triggers:**

- `import_row_commit_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `import_row_commit_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `import_row_commit_guard`: BEFORE INSERT FOR EACH ROW → `import_row_commit_guard()`

### deliverable_external_change

- **Purpose:** The external-change flag of a deliverable and its separate confirmation state with provenance (REQ-S01-005, M0080; ADR-0055 §6).
- **Migration:** `0106_p6_deliverable_external_change.sql`. **API module:** `portfolio`. **Who writes:** flag and withdraw: `external_change.flag` (TL, BO, WL, TO); confirm with reviewed evidence: `external_change.confirm` (BO, TD); confirm with a connector result: the confirmOutboundWrite path as the connector's service identity (lock 730314). **Lifecycle:** unconfirmed -> confirmed (final); one per deliverable; versioned and audited.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| deliverable_id | uuid | NOT NULL |  |  |
| is_external_change | boolean | NOT NULL | `true` |  |
| change_type | text | NOT NULL |  | `CHECK ((change_type = ANY (ARRAY['customer_system', 'network_upgrade', 'procurement_transaction', 'other'])))` |
| description | text | NULL |  | `CHECK (((description IS NULL) OR ((char_length(description) >= 1) AND (char_length(description) <= 2000))))` |
| confirmation_status | text | NOT NULL | `'unconfirmed'` | `CHECK ((confirmation_status = ANY (ARRAY['unconfirmed', 'confirmed'])))` |
| confirmation_source | text | NULL |  | `CHECK (((confirmation_source IS NULL) OR (confirmation_source = ANY (ARRAY['reviewed_evidence', 'connector_result']))))` |
| evidence_id | uuid | NULL |  |  |
| outbound_write_id | uuid | NULL |  | FK → outbound_write(id) |
| connector_id | uuid | NULL |  | FK → connector(id) |
| source_system_id | text | NULL |  | `CHECK (((source_system_id IS NULL) OR ((char_length(source_system_id) >= 1) AND (char_length(source_system_id) <= 200))))` |
| source_reference | text | NULL |  | `CHECK (((source_reference IS NULL) OR ((char_length(source_reference) >= 1) AND (char_length(source_reference) <= 200))))` |
| source_confirmed_at | timestamp with time zone | NULL |  |  |
| service_identity_id | uuid | NULL |  | FK → service_identity(id) |
| confirmed_at | timestamp with time zone | NULL |  |  |
| confirmed_by | uuid | NULL |  | FK → app_user(id) |
| confirmation_note | text | NULL |  | `CHECK (((confirmation_note IS NULL) OR ((char_length(confirmation_note) >= 3) AND (char_length(confirmation_note) <= 2000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `deliverable_external_change_confirmed_flagged` (CHECK): `CHECK (((confirmation_status = 'unconfirmed') OR is_external_change))`
- `deliverable_external_change_deliverable_fkey` (FK): `FOREIGN KEY (transformation_id, deliverable_id) REFERENCES deliverable(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `deliverable_external_change_deliverable_key` (UNIQUE): `UNIQUE (deliverable_id)`
- `deliverable_external_change_evidence_fkey` (FK): `FOREIGN KEY (transformation_id, evidence_id) REFERENCES evidence(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `deliverable_external_change_other_described` (CHECK): `CHECK (((change_type <> 'other') OR (description IS NOT NULL)))`
- `deliverable_external_change_source_shape` (CHECK): `CHECK ((((confirmation_status = 'unconfirmed') AND (confirmation_source IS NULL) AND (evidence_id IS NULL) AND (outbound_write_id IS NULL) AND (connector_id IS NULL) AND (source_system_id IS NULL) AND (source_reference IS NULL) AND (source_confirmed_at IS NULL) AND (service_identity_id IS NULL) AND (confirmed_at IS NULL) AND (confirmed_by IS NULL) AND (confirmation_note IS NULL)) OR ((confirmation_status = 'confirmed') AND (confirmation_source = 'reviewed_evidence') AND (evidence_id IS NOT NULL) AND (confirmed_by IS NOT NULL) AND (confirmed_at IS NOT NULL) AND (outbound_write_id IS NULL) AND (connector_id IS NULL) AND (source_system_id IS NULL) AND (source_reference IS NULL) AND (source_confirmed_at IS NULL) AND (service_identity_id IS NULL)) OR ((confirmation_status = 'confirmed') AND (confirmation_source = 'connector_result') AND (outbound_write_id IS NOT NULL) AND (connector_id IS NOT NULL) AND (source_system_id IS NOT NULL) AND (source_reference IS NOT NULL) AND (source_confirmed_at IS NOT NULL) AND (service_identity_id IS NOT NULL) AND (confirmed_at IS NOT NULL) AND (confirmed_by IS NULL) AND (evidence_id IS NULL))))`

**Indexes:**

- `deliverable_external_change_list_idx`: `(transformation_id, confirmation_status) WHERE is_external_change`

**Triggers:**

- `deliverable_external_change_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `deliverable_external_change_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `deliverable_external_change_guard()`
- `deliverable_external_change_history`: AFTER INSERT OR UPDATE FOR EACH ROW → `deliverable_external_change_history()`
- `deliverable_external_change_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

### deliverable_external_change_event

- **Purpose:** Append-only history of the flag and its confirmation.
- **Migration:** `0106_p6_deliverable_external_change.sql`. **API module:** `portfolio`. **Who writes:** the SECURITY DEFINER trigger `deliverable_external_change_history` only. **Lifecycle:** append-only; one row per deliverable_external_change version.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| deliverable_external_change_id | uuid | NOT NULL |  | FK → deliverable_external_change(id) |
| record_version | integer | NOT NULL |  | `CHECK ((record_version >= 1))` |
| is_external_change | boolean | NOT NULL |  |  |
| change_type | text | NOT NULL |  |  |
| confirmation_status | text | NOT NULL |  |  |
| confirmation_source | text | NULL |  |  |
| evidence_id | uuid | NULL |  |  |
| outbound_write_id | uuid | NULL |  |  |
| source_reference | text | NULL |  |  |
| actor_user_id | uuid | NULL |  | FK → app_user(id) |
| occurred_at | timestamp with time zone | NOT NULL |  |  |

**Table constraints:**

- `deliverable_external_change_event_version_key` (UNIQUE): `UNIQUE (deliverable_external_change_id, record_version)`

**Triggers:**

- `deliverable_external_change_event_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `deliverable_external_change_event_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

