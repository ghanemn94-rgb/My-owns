qa disposable cluster: PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0, 64-bit; server_encoding UTF8, lc_collate C, lc_ctype C
## service_identity

- **Purpose:** The constrained service identity of one job queue or connector: the declared permission ceiling, the effective grant, the scope and sensitive access (REQ-S16-029; ADR-0053 §1).
- **Migration:** `0101_p6_operations_service_identities.sql`. **API module:** `operations (access)`. **Who writes:** job rows: a migration only (owner check); connector rows: the connector's creation (ADR-0055); the grant: `service_identity.configure` (ADM_TECH) through putServiceIdentity (column-level UPDATE). **Lifecycle:** one per code; declaration fixed outside migrations; grant narrowed or restored; versioned and audited.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| code | text | NOT NULL |  |  |
| subject_kind | text | NOT NULL |  | `CHECK ((subject_kind = ANY (ARRAY['job', 'connector'])))` |
| queue_name | text | NULL |  | `CHECK (((queue_name IS NULL) OR ((queue_name ~ '^[a-z_]+\.[a-z_.]+$') AND (char_length(queue_name) <= 100))))` |
| connector_id | uuid | NULL |  |  |
| scope_level | text | NOT NULL |  | `CHECK ((scope_level = ANY (ARRAY['platform', 'organization'])))` |
| organization_id | uuid | NULL |  | FK → organization(id) |
| declared_permission_codes | text[] | NOT NULL |  | `CHECK (((cardinality(declared_permission_codes) <= 40) AND (array_position(declared_permission_codes, NULL) IS NULL)))` |
| granted_permission_codes | text[] | NOT NULL |  | `CHECK ((array_position(granted_permission_codes, NULL) IS NULL))` |
| sensitive_access | text | NOT NULL | `'none'` | `CHECK ((sensitive_access = ANY (ARRAY['none', 'aggregate_only'])))` |
| label_en | text | NOT NULL |  | `CHECK (((char_length(label_en) >= 1) AND (char_length(label_en) <= 200)))` |
| label_ar | text | NOT NULL |  | `CHECK (((char_length(label_ar) >= 1) AND (char_length(label_ar) <= 200)))` |
| reason | text | NOT NULL |  | `CHECK (((char_length(reason) >= 3) AND (char_length(reason) <= 1000)))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `service_identity_code_format` (CHECK): `CHECK ((code ~ '^(job|connector):[a-z0-9][a-z0-9_.:-]{0,119}$'))`
- `service_identity_code_key` (UNIQUE): `UNIQUE (code)`
- `service_identity_grant_within_declaration` (CHECK): `CHECK ((granted_permission_codes <@ declared_permission_codes))`
- `service_identity_scope_shape` (CHECK): `CHECK (((scope_level = 'platform') = (organization_id IS NULL)))`
- `service_identity_subject_shape` (CHECK): `CHECK ((((subject_kind = 'job') AND (queue_name IS NOT NULL) AND (connector_id IS NULL) AND (code = ('job:' || queue_name))) OR ((subject_kind = 'connector') AND (connector_id IS NOT NULL) AND (queue_name IS NULL) AND (scope_level = 'organization') AND (code = ('connector:' || (connector_id))))))`

**Indexes:**

- `service_identity_organization_idx`: `(organization_id, code)`

**Triggers:**

- `service_identity_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `service_identity_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `service_identity_guard()`
- `service_identity_history`: AFTER INSERT OR UPDATE FOR EACH ROW → `service_identity_history()`
- `service_identity_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## service_identity_change

- **Purpose:** Append-only history of every version of a service identity (ADR-0053 §1).
- **Migration:** `0101_p6_operations_service_identities.sql`. **API module:** `operations (access)`. **Who writes:** the SECURITY DEFINER trigger `service_identity_history` only. **Lifecycle:** append-only; one row per service_identity version.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| service_identity_id | uuid | NOT NULL |  | FK → service_identity(id) |
| record_version | integer | NOT NULL |  | `CHECK ((record_version >= 1))` |
| declared_permission_codes | text[] | NOT NULL |  |  |
| granted_permission_codes | text[] | NOT NULL |  |  |
| sensitive_access | text | NOT NULL |  |  |
| reason | text | NOT NULL |  |  |
| changed_by | uuid | NULL |  | FK → app_user(id) |
| changed_at | timestamp with time zone | NOT NULL |  |  |

**Table constraints:**

- `service_identity_change_version_key` (UNIQUE): `UNIQUE (service_identity_id, record_version)`

**Triggers:**

- `service_identity_change_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `service_identity_change_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

## operational_exception

- **Purpose:** One visible operational exception per source and failure class while active (REQ-S12-019, M0239; ADR-0053 §2).
- **Migration:** `0101_p6_operations_service_identities.sql`. **API module:** `operations`. **Who writes:** the worker failure hook, the connector run, the freshness scan and the API heartbeat watch (actor service; lock 730305); acknowledge and resolve: `operations.acknowledge` (ADM_TECH, KDS). **Lifecycle:** open -> acknowledged | resolved; acknowledged -> resolved; resolved is final; one active row per (organization, dedup key); versioned and audited.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NULL |  | FK → organization(id) |
| source_kind | text | NOT NULL |  | `CHECK ((source_kind = ANY (ARRAY['job', 'connector', 'data_freshness', 'worker'])))` |
| source_code | text | NOT NULL |  | `CHECK ((((char_length(source_code) >= 1) AND (char_length(source_code) <= 200)) AND (source_code ~ '^[a-z0-9][a-z0-9_.:-]*$')))` |
| failure_class | text | NOT NULL |  | `CHECK ((failure_class = ANY (ARRAY['job_failed', 'connector_run_failed', 'connector_unreachable', 'connector_credentials_rejected', 'data_stale', 'heartbeat_missed'])))` |
| dedup_key | text | NOT NULL |  |  |
| service_identity_id | uuid | NULL |  | FK → service_identity(id) |
| operational_failure_id | uuid | NULL |  | FK → operational_failure(id) |
| status | text | NOT NULL | `'open'` | `CHECK ((status = ANY (ARRAY['open', 'acknowledged', 'resolved'])))` |
| occurrence_count | integer | NOT NULL | `1` | `CHECK ((occurrence_count >= 1))` |
| first_occurred_at | timestamp with time zone | NOT NULL |  |  |
| last_occurred_at | timestamp with time zone | NOT NULL |  |  |
| last_error_code | text | NOT NULL |  | `CHECK ((((char_length(last_error_code) >= 1) AND (char_length(last_error_code) <= 100)) AND (last_error_code ~ '^[a-z][a-z0-9_.]*$')))` |
| last_error_message | text | NOT NULL |  | `CHECK (((char_length(last_error_message) >= 1) AND (char_length(last_error_message) <= 2000)))` |
| acknowledged_at | timestamp with time zone | NULL |  |  |
| acknowledged_by | uuid | NULL |  | FK → app_user(id) |
| acknowledge_note | text | NULL |  | `CHECK (((acknowledge_note IS NULL) OR ((char_length(acknowledge_note) >= 3) AND (char_length(acknowledge_note) <= 1000))))` |
| resolved_at | timestamp with time zone | NULL |  |  |
| resolved_by | uuid | NULL |  | FK → app_user(id) |
| resolution | text | NULL |  | `CHECK (((resolution IS NULL) OR (resolution = ANY (ARRAY['manual', 'recovered']))))` |
| resolution_note | text | NULL |  | `CHECK (((resolution_note IS NULL) OR ((char_length(resolution_note) >= 3) AND (char_length(resolution_note) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `operational_exception_ack_complete` (CHECK): `CHECK ((((acknowledged_at IS NULL) = (acknowledged_by IS NULL)) AND ((acknowledge_note IS NULL) OR (acknowledged_at IS NOT NULL)) AND ((status <> 'acknowledged') OR (acknowledged_at IS NOT NULL)) AND ((status <> 'open') OR (acknowledged_at IS NULL))))`
- `operational_exception_class_shape` (CHECK): `CHECK ((((source_kind = 'job') AND (failure_class = 'job_failed')) OR ((source_kind = 'connector') AND (failure_class = ANY (ARRAY['connector_run_failed', 'connector_unreachable', 'connector_credentials_rejected'])) AND (organization_id IS NOT NULL)) OR ((source_kind = 'data_freshness') AND (failure_class = 'data_stale') AND (organization_id IS NOT NULL)) OR ((source_kind = 'worker') AND (failure_class = 'heartbeat_missed') AND (organization_id IS NULL))))`
- `operational_exception_dedup_key` (CHECK): `CHECK ((dedup_key = ((((source_kind || ':') || source_code) || ':') || failure_class)))`
- `operational_exception_resolved_complete` (CHECK): `CHECK ((((status = 'resolved') = (resolved_at IS NOT NULL)) AND ((resolved_at IS NULL) = (resolution IS NULL)) AND ((resolution IS DISTINCT FROM 'manual') OR ((resolved_by IS NOT NULL) AND (resolution_note IS NOT NULL))) AND ((resolution IS DISTINCT FROM 'recovered') OR (resolved_by IS NULL)) AND ((resolved_at IS NOT NULL) OR ((resolved_by IS NULL) AND (resolution_note IS NULL)))))`
- `operational_exception_times` (CHECK): `CHECK ((last_occurred_at >= first_occurred_at))`

**Indexes:**

- `operational_exception_list_idx`: `(organization_id, status, last_occurred_at DESC, id DESC)`
- `operational_exception_one_active_key`: `UNIQUE (organization_id, dedup_key) NULLS NOT DISTINCT WHERE (status = ANY (ARRAY['open', 'acknowledged']))`

**Triggers:**

- `operational_exception_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `operational_exception_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `operational_exception_guard()`
- `operational_exception_history`: AFTER INSERT OR UPDATE FOR EACH ROW → `operational_exception_history()`
- `operational_exception_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## operational_exception_event

- **Purpose:** Append-only event history of an operational exception: opened, recurred, acknowledged, resolved, updated (ADR-0053 §2).
- **Migration:** `0101_p6_operations_service_identities.sql`. **API module:** `operations`. **Who writes:** the SECURITY DEFINER trigger `operational_exception_history` only. **Lifecycle:** append-only; one row per operational_exception version.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| operational_exception_id | uuid | NOT NULL |  | FK → operational_exception(id) |
| record_version | integer | NOT NULL |  | `CHECK ((record_version >= 1))` |
| event_kind | text | NOT NULL |  | `CHECK ((event_kind = ANY (ARRAY['opened', 'recurred', 'acknowledged', 'resolved', 'updated'])))` |
| status | text | NOT NULL |  |  |
| occurrence_count | integer | NOT NULL |  |  |
| error_code | text | NOT NULL |  |  |
| actor_user_id | uuid | NULL |  | FK → app_user(id) |
| note | text | NULL |  |  |
| occurred_at | timestamp with time zone | NOT NULL |  |  |

**Table constraints:**

- `operational_exception_event_version_key` (UNIQUE): `UNIQUE (operational_exception_id, record_version)`

**Triggers:**

- `operational_exception_event_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `operational_exception_event_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

## operational_exception_kpi

- **Purpose:** Which KPI definitions an operational exception makes stale (same organization and transformation; ADR-0053 §2).
- **Migration:** `0101_p6_operations_service_identities.sql`. **API module:** `operations`. **Who writes:** the exception's raising code, in its open or recur transaction (whose audit event lists the KPI ids). **Lifecycle:** append-only; at most one link per exception and KPI.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| operational_exception_id | uuid | NOT NULL |  | FK → operational_exception(id) |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| kpi_definition_id | uuid | NOT NULL |  | FK → kpi_definition(id) |
| linked_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `operational_exception_kpi_key` (UNIQUE): `UNIQUE (operational_exception_id, kpi_definition_id)`

**Indexes:**

- `operational_exception_kpi_transformation_idx`: `(transformation_id, kpi_definition_id)`

**Triggers:**

- `operational_exception_kpi_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `operational_exception_kpi_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `operational_exception_kpi_guard`: BEFORE INSERT FOR EACH ROW → `operational_exception_kpi_guard()`

## worker_heartbeat

- **Purpose:** The liveness beat of one worker process (A22; ADR-0053 §6). Telemetry, not a business record.
- **Migration:** `0101_p6_operations_service_identities.sql`. **API module:** `operations`. **Who writes:** the worker every WORKER_HEARTBEAT_SECONDS (default 30). **Lifecycle:** one per worker instance key; each beat advances beat_count by exactly 1; version-stepped, NOT audited.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| instance_key | text | NOT NULL |  | `CHECK ((instance_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'))` |
| app_version | text | NOT NULL |  | `CHECK (((char_length(app_version) >= 1) AND (char_length(app_version) <= 50)))` |
| started_at | timestamp with time zone | NOT NULL |  |  |
| last_beat_at | timestamp with time zone | NOT NULL |  |  |
| beat_count | bigint | NOT NULL | `1` | `CHECK ((beat_count >= 1))` |
| queue_count | integer | NOT NULL |  | `CHECK (((queue_count >= 0) AND (queue_count <= 1000)))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `worker_heartbeat_instance_key` (UNIQUE): `UNIQUE (instance_key)`
- `worker_heartbeat_times` (CHECK): `CHECK ((last_beat_at >= started_at))`

**Triggers:**

- `worker_heartbeat_guard`: BEFORE UPDATE FOR EACH ROW → `worker_heartbeat_guard()`
- `worker_heartbeat_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## storage_setting

- **Purpose:** The installation's evidence-storage setting: driver and, for s3, endpoint, region, bucket, prefix and credential references (REQ-S16-006; ADR-0054 §2). No row = the environment default.
- **Migration:** `0102_p6_storage_notification_channels.sql`. **API module:** `evidence (admin)`. **Who writes:** `storage.configure` (ADM_TECH) through putStorageSetting (after a passing testStorageSetting; lock 730307). **Lifecycle:** at most one row (singleton); created by If-Match "0"; versioned and audited.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| singleton | boolean | NOT NULL | `true` |  |
| driver | text | NOT NULL |  | `CHECK ((driver = ANY (ARRAY['filesystem', 's3'])))` |
| s3_endpoint | text | NULL |  | `CHECK (((s3_endpoint IS NULL) OR ((s3_endpoint ~ '^https?://[^/?#@[:space:]]+(:[0-9]{1,5})?/?$') AND (char_length(s3_endpoint) <= 300))))` |
| s3_region | text | NULL |  | `CHECK (((s3_region IS NULL) OR (s3_region ~ '^[a-z0-9][a-z0-9-]{0,62}$')))` |
| s3_bucket | text | NULL |  | `CHECK (((s3_bucket IS NULL) OR (s3_bucket ~ '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$')))` |
| s3_key_prefix | text | NULL |  | `CHECK (((s3_key_prefix IS NULL) OR (s3_key_prefix ~ '^[a-z0-9][a-z0-9_/-]{0,99}$')))` |
| s3_force_path_style | boolean | NOT NULL | `true` |  |
| s3_access_key_ref | jsonb | NULL |  |  |
| s3_secret_key_ref | jsonb | NULL |  |  |
| reason | text | NOT NULL |  | `CHECK (((char_length(reason) >= 3) AND (char_length(reason) <= 1000)))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `storage_setting_access_key_ref` (CHECK): `CHECK (p6_secret_ref_valid(s3_access_key_ref))`
- `storage_setting_s3_complete` (CHECK): `CHECK (((driver <> 's3') OR ((s3_endpoint IS NOT NULL) AND (s3_region IS NOT NULL) AND (s3_bucket IS NOT NULL) AND (s3_access_key_ref IS NOT NULL) AND (s3_secret_key_ref IS NOT NULL))))`
- `storage_setting_secret_key_ref` (CHECK): `CHECK (p6_secret_ref_valid(s3_secret_key_ref))`
- `storage_setting_singleton` (CHECK): `CHECK (singleton)`
- `storage_setting_singleton_key` (UNIQUE): `UNIQUE (singleton)`

**Triggers:**

- `storage_setting_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `storage_setting_history`: AFTER INSERT OR UPDATE FOR EACH ROW → `storage_setting_history()`
- `storage_setting_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## storage_setting_change

- **Purpose:** Append-only history of every version of the storage setting (ADR-0054 §2).
- **Migration:** `0102_p6_storage_notification_channels.sql`. **API module:** `evidence (admin)`. **Who writes:** the SECURITY DEFINER trigger `storage_setting_history` only. **Lifecycle:** append-only; one row per storage_setting version.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| storage_setting_id | uuid | NOT NULL |  | FK → storage_setting(id) |
| record_version | integer | NOT NULL |  | `CHECK ((record_version >= 1))` |
| driver | text | NOT NULL |  |  |
| s3_endpoint | text | NULL |  |  |
| s3_region | text | NULL |  |  |
| s3_bucket | text | NULL |  |  |
| s3_key_prefix | text | NULL |  |  |
| s3_force_path_style | boolean | NOT NULL |  |  |
| s3_access_key_ref | jsonb | NULL |  |  |
| s3_secret_key_ref | jsonb | NULL |  |  |
| reason | text | NOT NULL |  |  |
| changed_by | uuid | NOT NULL |  | FK → app_user(id) |
| changed_at | timestamp with time zone | NOT NULL |  |  |

**Table constraints:**

- `storage_setting_change_version_key` (UNIQUE): `UNIQUE (storage_setting_id, record_version)`

**Triggers:**

- `storage_setting_change_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `storage_setting_change_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

## notification_channel

- **Purpose:** One optional external notification channel of an organization: email (SMTP with credential references) or enterprise messaging (port only, never enabled in P6) (REQ-S12-023; ADR-0054 §3). No row = in-app only.
- **Migration:** `0102_p6_storage_notification_channels.sql`. **API module:** `tasks (channels)`. **Who writes:** `notification_channel.configure` (ADM_TECH) through putNotificationChannel. **Lifecycle:** one per (organization, channel kind); created by If-Match "0"; kind never changes; versioned and audited.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| channel_kind | text | NOT NULL |  | `CHECK ((channel_kind = ANY (ARRAY['email', 'enterprise_messaging'])))` |
| enabled | boolean | NOT NULL | `false` |  |
| smtp_host | text | NULL |  | `CHECK (((smtp_host IS NULL) OR (smtp_host ~ '^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$')))` |
| smtp_port | integer | NULL |  | `CHECK (((smtp_port IS NULL) OR ((smtp_port >= 1) AND (smtp_port <= 65535))))` |
| smtp_security | text | NULL |  | `CHECK (((smtp_security IS NULL) OR (smtp_security = ANY (ARRAY['starttls', 'tls', 'none']))))` |
| smtp_username_ref | jsonb | NULL |  |  |
| smtp_password_ref | jsonb | NULL |  |  |
| from_address | text | NULL |  | `CHECK (((from_address IS NULL) OR ((char_length(from_address) <= 254) AND (from_address ~ '^[^@[:space:]<>]+@[^@[:space:]<>]+\.[^@[:space:]<>]+$'))))` |
| reason | text | NOT NULL |  | `CHECK (((char_length(reason) >= 3) AND (char_length(reason) <= 1000)))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `notification_channel_credentials_pair` (CHECK): `CHECK (((smtp_username_ref IS NULL) = (smtp_password_ref IS NULL)))`
- `notification_channel_email_complete` (CHECK): `CHECK (((channel_kind <> 'email') OR (NOT enabled) OR ((smtp_host IS NOT NULL) AND (smtp_port IS NOT NULL) AND (smtp_security IS NOT NULL) AND (from_address IS NOT NULL))))`
- `notification_channel_kind_key` (UNIQUE): `UNIQUE (organization_id, channel_kind)`
- `notification_channel_no_messaging_adapter` (CHECK): `CHECK (((channel_kind <> 'enterprise_messaging') OR ((NOT enabled) AND (smtp_host IS NULL) AND (smtp_port IS NULL) AND (smtp_security IS NULL) AND (smtp_username_ref IS NULL) AND (smtp_password_ref IS NULL) AND (from_address IS NULL))))`
- `notification_channel_password_ref` (CHECK): `CHECK (p6_secret_ref_valid(smtp_password_ref))`
- `notification_channel_username_ref` (CHECK): `CHECK (p6_secret_ref_valid(smtp_username_ref))`

**Triggers:**

- `notification_channel_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `notification_channel_history`: AFTER INSERT OR UPDATE FOR EACH ROW → `notification_channel_history()`
- `notification_channel_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## notification_channel_change

- **Purpose:** Append-only history of every version of a notification channel (ADR-0054 §3).
- **Migration:** `0102_p6_storage_notification_channels.sql`. **API module:** `tasks (channels)`. **Who writes:** the SECURITY DEFINER trigger `notification_channel_history` only. **Lifecycle:** append-only; one row per notification_channel version.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| notification_channel_id | uuid | NOT NULL |  | FK → notification_channel(id) |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| record_version | integer | NOT NULL |  | `CHECK ((record_version >= 1))` |
| channel_kind | text | NOT NULL |  |  |
| enabled | boolean | NOT NULL |  |  |
| smtp_host | text | NULL |  |  |
| smtp_port | integer | NULL |  |  |
| smtp_security | text | NULL |  |  |
| smtp_username_ref | jsonb | NULL |  |  |
| smtp_password_ref | jsonb | NULL |  |  |
| from_address | text | NULL |  |  |
| reason | text | NOT NULL |  |  |
| changed_by | uuid | NOT NULL |  | FK → app_user(id) |
| changed_at | timestamp with time zone | NOT NULL |  |  |

**Table constraints:**

- `notification_channel_change_version_key` (UNIQUE): `UNIQUE (notification_channel_id, record_version)`

**Triggers:**

- `notification_channel_change_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `notification_channel_change_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

## notification_delivery

- **Purpose:** One external delivery of one inbox notification on one channel: the idempotency backstop of the fan-out (ADR-0054 §3). No message text or address is stored.
- **Migration:** `0102_p6_storage_notification_channels.sql`. **API module:** `tasks (channels)`. **Who writes:** the worker fan-out handler (actor service; lock 730306). **Lifecycle:** pending -> sent | failed | skipped; failed -> pending (retry); sent and skipped are final; one per (notification, channel); versioned and audited.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| inbox_notification_id | uuid | NOT NULL |  | FK → inbox_notification(id) |
| channel_kind | text | NOT NULL |  | `CHECK ((channel_kind = ANY (ARRAY['email', 'enterprise_messaging'])))` |
| status | text | NOT NULL | `'pending'` | `CHECK ((status = ANY (ARRAY['pending', 'sent', 'failed', 'skipped'])))` |
| attempts | smallint | NOT NULL | `0` | `CHECK (((attempts >= 0) AND (attempts <= 20)))` |
| last_attempt_at | timestamp with time zone | NULL |  |  |
| sent_at | timestamp with time zone | NULL |  |  |
| skip_reason | text | NULL |  | `CHECK (((skip_reason IS NULL) OR (skip_reason = ANY (ARRAY['no_address', 'recipient_restricted', 'channel_disabled', 'recipient_disabled']))))` |
| error_code | text | NULL |  | `CHECK (((error_code IS NULL) OR (((char_length(error_code) >= 1) AND (char_length(error_code) <= 100)) AND (error_code ~ '^[a-z][a-z0-9_.]*$'))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `notification_delivery_attempted` (CHECK): `CHECK (((attempts = 0) = (last_attempt_at IS NULL)))`
- `notification_delivery_failed_complete` (CHECK): `CHECK (((status <> 'failed') OR ((error_code IS NOT NULL) AND (last_attempt_at IS NOT NULL))))`
- `notification_delivery_once_key` (UNIQUE): `UNIQUE (inbox_notification_id, channel_kind)`
- `notification_delivery_sent_complete` (CHECK): `CHECK (((status = 'sent') = (sent_at IS NOT NULL)))`
- `notification_delivery_skipped_complete` (CHECK): `CHECK (((status = 'skipped') = (skip_reason IS NOT NULL)))`

**Indexes:**

- `notification_delivery_status_idx`: `(status, updated_at, id)`

**Triggers:**

- `notification_delivery_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `notification_delivery_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `notification_delivery_guard()`
- `notification_delivery_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

