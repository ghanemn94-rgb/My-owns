qa disposable cluster: PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0, 64-bit; server_encoding UTF8, lc_collate C, lc_ctype C
## transfer_table_rule

- **Purpose:** The tables a migration package never carries, each with its rule and reason (ADR-0064 §3; D-243 Q16). Every other public base table is exported.
- **Migration:** `0133_p7_transfer_migration_manifest.sql`. **API module:** `transfer`. **Who writes:** migrations only (`mth_app` reads). **Lifecycle:** append-only; a migration adding a table that must not travel adds its row.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| table_name | text | NOT NULL |  | PK; `CHECK ((table_name ~ '^[a-z][a-z0-9_]{0,62}$'))` |
| rule | text | NOT NULL |  | `CHECK ((rule = ANY (ARRAY['exclude_credential', 'exclude_operational', 'exclude_derived', 'exclude_transfer', 'compare_only'])))` |
| reason | text | NOT NULL |  | `CHECK (((char_length(reason) >= 3) AND (char_length(reason) <= 500)))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Triggers:**

- `transfer_table_rule_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `transfer_table_rule_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

## transfer_column_rule

- **Purpose:** The SecretRef columns whose provider the export rewrites to `unbound` (ADR-0064 §4).
- **Migration:** `0133_p7_transfer_migration_manifest.sql`. **API module:** `transfer`. **Who writes:** migrations only (`mth_app` reads). **Lifecycle:** append-only; the catalogue test fails when a SecretRef column has no row.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| table_name | text | NOT NULL |  | `CHECK ((table_name ~ '^[a-z][a-z0-9_]{0,62}$'))` |
| column_name | text | NOT NULL |  | `CHECK ((column_name ~ '^[a-z][a-z0-9_]{0,62}$'))` |
| rule | text | NOT NULL |  | `CHECK ((rule = ANY (ARRAY['secret_ref_unbind', 'secret_refs_unbind'])))` |
| reason | text | NOT NULL |  | `CHECK (((char_length(reason) >= 3) AND (char_length(reason) <= 500)))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `transfer_column_rule_pkey` (PK): `PRIMARY KEY (table_name, column_name)`

**Triggers:**

- `transfer_column_rule_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `transfer_column_rule_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

## migration_export

- **Purpose:** One whole-installation migration export request, its counts, the manifest and attachment-manifest SHA-256, the source environment marker and, for a demo source only, the ADR-0050 demo checksum (REQ-S19-016; ADR-0064 §7; D-244 O2).
- **Migration:** `0133_p7_transfer_migration_manifest.sql`. **API module:** `transfer (export)`. **Who writes:** `migration.export` (ADM_TECH) through createMigrationExport; the worker job `transfer.export` (lock 730402); the CLI `mth-db export-migration` (requested_via cli). Column-level UPDATE of the status, results and version columns only. **Lifecycle:** queued -> running | failed; running -> succeeded | failed; succeeded and failed are immutable; versioned and audited.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| status | text | NOT NULL | `'queued'` | `CHECK ((status = ANY (ARRAY['queued', 'running', 'succeeded', 'failed'])))` |
| requested_via | text | NOT NULL |  | `CHECK ((requested_via = ANY (ARRAY['api', 'cli'])))` |
| schema_version | text | NOT NULL | `'mth-migration/1'` | `CHECK ((schema_version = 'mth-migration/1'))` |
| source_environment | text | NULL |  | `CHECK (((source_environment IS NULL) OR (source_environment = ANY (ARRAY['production', 'demo', 'unmarked']))))` |
| migration_level | text | NULL |  | `CHECK (((migration_level IS NULL) OR (migration_level ~ '^[0-9]{4}_[a-z0-9_]+$')))` |
| table_count | integer | NULL |  | `CHECK (((table_count IS NULL) OR (table_count >= 0)))` |
| row_count | bigint | NULL |  | `CHECK (((row_count IS NULL) OR (row_count >= 0)))` |
| attachment_count | integer | NULL |  | `CHECK (((attachment_count IS NULL) OR (attachment_count >= 0)))` |
| attachment_bytes | bigint | NULL |  | `CHECK (((attachment_bytes IS NULL) OR (attachment_bytes >= 0)))` |
| manifest_sha256 | text | NULL |  | `CHECK (((manifest_sha256 IS NULL) OR (manifest_sha256 ~ '^[0-9a-f]{64}$')))` |
| attachment_manifest_sha256 | text | NULL |  | `CHECK (((attachment_manifest_sha256 IS NULL) OR (attachment_manifest_sha256 ~ '^[0-9a-f]{64}$')))` |
| demo_checksum | text | NULL |  | `CHECK (((demo_checksum IS NULL) OR (demo_checksum ~ '^[0-9a-f]{64}$')))` |
| failure_reason | text | NULL |  | `CHECK (((failure_reason IS NULL) OR ((char_length(failure_reason) >= 1) AND (char_length(failure_reason) <= 1000))))` |
| started_at | timestamp with time zone | NULL |  |  |
| finished_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `migration_export_demo_checksum` (CHECK): `CHECK (((demo_checksum IS NOT NULL) = ((status = 'succeeded') AND (source_environment = 'demo'))))`
- `migration_export_failed_shape` (CHECK): `CHECK (((status <> 'failed') OR ((failure_reason IS NOT NULL) AND (finished_at IS NOT NULL))))`
- `migration_export_requester` (CHECK): `CHECK (((requested_via = 'api') = (created_by IS NOT NULL)))`
- `migration_export_succeeded_shape` (CHECK): `CHECK (((status <> 'succeeded') OR ((source_environment IS NOT NULL) AND (migration_level IS NOT NULL) AND (table_count IS NOT NULL) AND (row_count IS NOT NULL) AND (attachment_count IS NOT NULL) AND (attachment_bytes IS NOT NULL) AND (manifest_sha256 IS NOT NULL) AND (attachment_manifest_sha256 IS NOT NULL) AND (started_at IS NOT NULL) AND (finished_at IS NOT NULL) AND (failure_reason IS NULL))))`

**Indexes:**

- `migration_export_created_idx`: `(created_at DESC, id)`

**Triggers:**

- `migration_export_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `migration_export_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `migration_export_guard()`
- `migration_export_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## migration_import

- **Purpose:** The one import of a migration package into this (formerly empty) installation: the manifest it loaded, its checksums, environment marker, demo checksum and counts (REQ-S19-014, REQ-S19-016; ADR-0064 §6).
- **Migration:** `0133_p7_transfer_migration_manifest.sql`. **API module:** `transfer (import)`. **Who writes:** the migration CLI only (`mth-db import-migration` / `reconcile-migration`, as mth_owner; lock 730403). **Lifecycle:** written once at the end of a matched load, in its transaction; append-only; audited (migration.imported).
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| schema_version | text | NOT NULL |  | `CHECK ((schema_version = 'mth-migration/1'))` |
| source_environment | text | NOT NULL |  | `CHECK ((source_environment = ANY (ARRAY['production', 'demo', 'unmarked'])))` |
| source_export_reference | uuid | NOT NULL |  |  |
| migration_level | text | NOT NULL |  | `CHECK ((migration_level ~ '^[0-9]{4}_[a-z0-9_]+$'))` |
| manifest_sha256 | text | NOT NULL |  | `CHECK ((manifest_sha256 ~ '^[0-9a-f]{64}$'))` |
| attachment_manifest_sha256 | text | NOT NULL |  | `CHECK ((attachment_manifest_sha256 ~ '^[0-9a-f]{64}$'))` |
| demo_checksum | text | NULL |  | `CHECK (((demo_checksum IS NULL) OR (demo_checksum ~ '^[0-9a-f]{64}$')))` |
| table_count | integer | NOT NULL |  | `CHECK ((table_count >= 0))` |
| row_count | bigint | NOT NULL |  | `CHECK ((row_count >= 0))` |
| attachment_count | integer | NOT NULL |  | `CHECK ((attachment_count >= 0))` |
| attachment_bytes | bigint | NOT NULL |  | `CHECK ((attachment_bytes >= 0))` |
| operator_name | text | NOT NULL |  | `CHECK (((char_length(operator_name) >= 1) AND (char_length(operator_name) <= 200)))` |
| started_at | timestamp with time zone | NOT NULL |  |  |
| imported_at | timestamp with time zone | NOT NULL |  |  |

**Table constraints:**

- `migration_import_demo_checksum` (CHECK): `CHECK (((demo_checksum IS NOT NULL) = (source_environment = 'demo')))`
- `migration_import_times` (CHECK): `CHECK ((imported_at >= started_at))`

**Triggers:**

- `migration_import_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `migration_import_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `migration_import_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `migration_import_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## migration_reconciliation

- **Purpose:** One reconciliation run of an import: at import, or a re-check; totals and result (REQ-S19-014; ADR-0064 §6 step 8).
- **Migration:** `0133_p7_transfer_migration_manifest.sql`. **API module:** `transfer (import)`. **Who writes:** the migration CLI only (`mth-db import-migration` / `reconcile-migration`, as mth_owner; lock 730403). **Lifecycle:** append-only; one `import` run per import; audited (migration.reconciled).
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| migration_import_id | uuid | NOT NULL |  | FK → migration_import(id) |
| run_kind | text | NOT NULL |  | `CHECK ((run_kind = ANY (ARRAY['import', 'recheck'])))` |
| result | text | NOT NULL |  | `CHECK ((result = ANY (ARRAY['matched', 'mismatched'])))` |
| tables_checked | integer | NOT NULL |  | `CHECK ((tables_checked >= 0))` |
| tables_mismatched | integer | NOT NULL |  |  |
| rows_expected | bigint | NOT NULL |  | `CHECK ((rows_expected >= 0))` |
| rows_actual | bigint | NOT NULL |  | `CHECK ((rows_actual >= 0))` |
| attachments_checked | integer | NOT NULL |  | `CHECK ((attachments_checked >= 0))` |
| attachments_mismatched | integer | NOT NULL |  |  |
| operator_name | text | NOT NULL |  | `CHECK (((char_length(operator_name) >= 1) AND (char_length(operator_name) <= 200)))` |
| run_at | timestamp with time zone | NOT NULL |  |  |

**Table constraints:**

- `migration_reconciliation_check` (CHECK): `CHECK (((tables_mismatched >= 0) AND (tables_mismatched <= tables_checked)))`
- `migration_reconciliation_check1` (CHECK): `CHECK (((attachments_mismatched >= 0) AND (attachments_mismatched <= attachments_checked)))`
- `migration_reconciliation_result` (CHECK): `CHECK (((result = 'matched') = ((tables_mismatched = 0) AND (attachments_mismatched = 0) AND (rows_expected = rows_actual))))`

**Indexes:**

- `migration_reconciliation_import_idx`: `(migration_import_id, run_at DESC)`
- `migration_reconciliation_one_import_run`: `UNIQUE (migration_import_id) WHERE (run_kind = 'import')`

**Triggers:**

- `migration_reconciliation_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `migration_reconciliation_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `migration_reconciliation_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `migration_reconciliation_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## migration_reconciliation_table

- **Purpose:** Per manifest table: expected and actual row counts and content digests of one reconciliation run.
- **Migration:** `0133_p7_transfer_migration_manifest.sql`. **API module:** `transfer (import)`. **Who writes:** the migration CLI only (`mth-db import-migration` / `reconcile-migration`, as mth_owner; lock 730403). **Lifecycle:** append-only; one row per (run, table).
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| migration_reconciliation_id | uuid | NOT NULL |  | FK → migration_reconciliation(id) |
| table_name | text | NOT NULL |  | `CHECK ((table_name ~ '^[a-z][a-z0-9_]{0,62}$'))` |
| expected_rows | bigint | NOT NULL |  | `CHECK ((expected_rows >= 0))` |
| actual_rows | bigint | NOT NULL |  | `CHECK ((actual_rows >= 0))` |
| expected_digest | text | NOT NULL |  | `CHECK ((expected_digest ~ '^[0-9a-f]{64}$'))` |
| actual_digest | text | NOT NULL |  | `CHECK ((actual_digest ~ '^[0-9a-f]{64}$'))` |
| matched | boolean | NOT NULL |  |  |

**Table constraints:**

- `migration_reconciliation_table_matched` (CHECK): `CHECK ((matched = ((expected_rows = actual_rows) AND (expected_digest = actual_digest))))`
- `migration_reconciliation_table_pkey` (PK): `PRIMARY KEY (migration_reconciliation_id, table_name)`

**Triggers:**

- `migration_reconciliation_table_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `migration_reconciliation_table_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

## migration_reconciliation_attachment

- **Purpose:** Each evidence object that was missing or whose size or SHA-256 differed in one reconciliation run (no bytes, no record id).
- **Migration:** `0133_p7_transfer_migration_manifest.sql`. **API module:** `transfer (import)`. **Who writes:** the migration CLI only (`mth-db import-migration` / `reconcile-migration`, as mth_owner; lock 730403). **Lifecycle:** append-only; only mismatches are recorded.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| migration_reconciliation_id | uuid | NOT NULL |  | FK → migration_reconciliation(id) |
| parent_table | text | NOT NULL |  | `CHECK ((parent_table ~ '^[a-z][a-z0-9_]{0,62}$'))` |
| object_name | text | NOT NULL |  | `CHECK (((char_length(object_name) >= 1) AND (char_length(object_name) <= 1024)))` |
| problem | text | NOT NULL |  | `CHECK ((problem = ANY (ARRAY['missing', 'size_mismatch', 'sha256_mismatch'])))` |
| expected_size | bigint | NOT NULL |  | `CHECK ((expected_size >= 0))` |
| actual_size | bigint | NULL |  | `CHECK (((actual_size IS NULL) OR (actual_size >= 0)))` |
| expected_sha256 | text | NOT NULL |  | `CHECK ((expected_sha256 ~ '^[0-9a-f]{64}$'))` |
| actual_sha256 | text | NULL |  | `CHECK (((actual_sha256 IS NULL) OR (actual_sha256 ~ '^[0-9a-f]{64}$')))` |

**Table constraints:**

- `migration_reconciliation_attachment_shape` (CHECK): `CHECK (((problem = 'missing') = ((actual_size IS NULL) AND (actual_sha256 IS NULL))))`

**Indexes:**

- `migration_reconciliation_attachment_run_idx`: `(migration_reconciliation_id, object_name)`

**Triggers:**

- `migration_reconciliation_attachment_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `migration_reconciliation_attachment_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

## identity_binding_hold

- **Purpose:** The identity binding of a user carried by an import: unbound users cannot sign in until IT applies a mapping line (master prompt l.562; ADR-0064 §8).
- **Migration:** `0133_p7_transfer_migration_manifest.sql`. **API module:** `transfer (identity)`. **Who writes:** the import (one unbound row per user) and `mth-db rebind-identity` (lock 730404), as mth_owner; `mth_app` reads (the sign-in check). **Lifecycle:** unbound -> rebound | retained; both final; versioned and audited.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| user_id | uuid | NOT NULL |  | FK → app_user(id) |
| migration_import_id | uuid | NOT NULL |  | FK → migration_import(id) |
| state | text | NOT NULL | `'unbound'` | `CHECK ((state = ANY (ARRAY['unbound', 'rebound', 'retained'])))` |
| mapping_sha256 | text | NULL |  | `CHECK (((mapping_sha256 IS NULL) OR (mapping_sha256 ~ '^[0-9a-f]{64}$')))` |
| operator_name | text | NULL |  | `CHECK (((operator_name IS NULL) OR ((char_length(operator_name) >= 1) AND (char_length(operator_name) <= 200))))` |
| resolved_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `identity_binding_hold_resolution` (CHECK): `CHECK (((state = 'unbound') = ((mapping_sha256 IS NULL) AND (operator_name IS NULL) AND (resolved_at IS NULL))))`
- `identity_binding_hold_user_unique` (UNIQUE): `UNIQUE (user_id)`

**Indexes:**

- `identity_binding_hold_state_idx`: `(state, user_id)`

**Triggers:**

- `identity_binding_hold_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `identity_binding_hold_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `identity_binding_hold_guard()`
- `identity_binding_hold_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## identity_rebind_event

- **Purpose:** The append-only history of every applied mapping line: the old and new issuer and subject and the mapping file's SHA-256.
- **Migration:** `0133_p7_transfer_migration_manifest.sql`. **API module:** `transfer (identity)`. **Who writes:** `mth-db rebind-identity` only (mth_owner). **Lifecycle:** append-only; one row per hold.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| identity_binding_hold_id | uuid | NOT NULL |  | FK → identity_binding_hold(id) |
| user_id | uuid | NOT NULL |  | FK → app_user(id) |
| action | text | NOT NULL |  | `CHECK ((action = ANY (ARRAY['rebound', 'retained'])))` |
| old_issuer | text | NOT NULL |  | `CHECK (((char_length(old_issuer) >= 1) AND (char_length(old_issuer) <= 512)))` |
| old_subject | text | NOT NULL |  | `CHECK (((char_length(old_subject) >= 1) AND (char_length(old_subject) <= 255)))` |
| new_issuer | text | NOT NULL |  | `CHECK (((char_length(new_issuer) >= 1) AND (char_length(new_issuer) <= 512)))` |
| new_subject | text | NOT NULL |  | `CHECK (((char_length(new_subject) >= 1) AND (char_length(new_subject) <= 255)))` |
| mapping_sha256 | text | NOT NULL |  | `CHECK ((mapping_sha256 ~ '^[0-9a-f]{64}$'))` |
| operator_name | text | NOT NULL |  | `CHECK (((char_length(operator_name) >= 1) AND (char_length(operator_name) <= 200)))` |
| applied_at | timestamp with time zone | NOT NULL |  |  |

**Table constraints:**

- `identity_rebind_event_one_per_hold` (UNIQUE): `UNIQUE (identity_binding_hold_id)`
- `identity_rebind_event_retained_same` (CHECK): `CHECK (((action = 'retained') = ((old_issuer = new_issuer) AND (old_subject = new_subject))))`

**Triggers:**

- `identity_rebind_event_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `identity_rebind_event_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

## config_bundle_export

- **Purpose:** One exported configuration bundle of an organization: kinds, item count, size and SHA-256; the bytes are an EvidenceStore object (REQ-S19-008; ADR-0065 §3).
- **Migration:** `0134_p7_config_bundles.sql`. **API module:** `transfer (config-bundle)`. **Who writes:** `config_bundle.export` (ADM_TECH, ADM_METHOD) through createConfigBundleExport. **Lifecycle:** written once; append-only; audited.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| bundle_schema_version | text | NOT NULL |  | `CHECK ((bundle_schema_version = 'mth-config-bundle/1'))` |
| source_environment | text | NOT NULL |  | `CHECK ((source_environment = ANY (ARRAY['production', 'demo', 'unmarked'])))` |
| kinds | text[] | NOT NULL |  | `CHECK ((((cardinality(kinds) >= 1) AND (cardinality(kinds) <= 12)) AND (array_position(kinds, NULL) IS NULL) AND (kinds <@ ARRAY['methodology', 'scoring_defaults', 'form_schema', 'procedure', 'automation_rule_set', 'health_check_scheme', 'automation_rule', 'branding', 'notification_policy', 'job_schedule', 'config_review_policy', 'upload_policy'])))` |
| item_count | integer | NOT NULL |  | `CHECK ((item_count >= 0))` |
| byte_size | bigint | NOT NULL |  | `CHECK ((byte_size > 0))` |
| sha256 | text | NOT NULL |  | `CHECK ((sha256 ~ '^[0-9a-f]{64}$'))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Indexes:**

- `config_bundle_export_org_idx`: `(organization_id, created_at DESC, id)`

**Triggers:**

- `config_bundle_export_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `config_bundle_export_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `config_bundle_export_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `config_bundle_export_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## config_bundle_import

- **Purpose:** One uploaded configuration bundle into an organization, its validation counts and commit (REQ-S19-008; ADR-0065 §4). An unknown bundleSchemaVersion is refused and never stored.
- **Migration:** `0134_p7_config_bundles.sql`. **API module:** `transfer (config-bundle)`. **Who writes:** `config_bundle.import` (ADM_TECH, ADM_METHOD) through upload, validate and commit (lock 730405). Column-level UPDATE of the status, counts, validation and commit columns only. **Lifecycle:** uploaded -> validated | invalid; validated -> validated | invalid | committed; invalid and committed are final; versioned and audited.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| bundle_schema_version | text | NOT NULL |  | `CHECK ((bundle_schema_version = 'mth-config-bundle/1'))` |
| source_environment | text | NOT NULL |  | `CHECK ((source_environment = ANY (ARRAY['production', 'demo', 'unmarked'])))` |
| file_name | text | NOT NULL |  | `CHECK (((char_length(file_name) >= 1) AND (char_length(file_name) <= 255)))` |
| byte_size | bigint | NOT NULL |  | `CHECK ((byte_size > 0))` |
| sha256 | text | NOT NULL |  | `CHECK ((sha256 ~ '^[0-9a-f]{64}$'))` |
| item_count | integer | NOT NULL |  | `CHECK ((item_count >= 0))` |
| status | text | NOT NULL | `'uploaded'` | `CHECK ((status = ANY (ARRAY['uploaded', 'validated', 'invalid', 'committed'])))` |
| validation_no | integer | NOT NULL | `0` | `CHECK ((validation_no >= 0))` |
| items_create | integer | NULL |  | `CHECK (((items_create IS NULL) OR (items_create >= 0)))` |
| items_new_draft | integer | NULL |  | `CHECK (((items_new_draft IS NULL) OR (items_new_draft >= 0)))` |
| items_identical | integer | NULL |  | `CHECK (((items_identical IS NULL) OR (items_identical >= 0)))` |
| items_conflict | integer | NULL |  | `CHECK (((items_conflict IS NULL) OR (items_conflict >= 0)))` |
| items_refused | integer | NULL |  | `CHECK (((items_refused IS NULL) OR (items_refused >= 0)))` |
| validated_at | timestamp with time zone | NULL |  |  |
| validated_by | uuid | NULL |  | FK → app_user(id) |
| committed_at | timestamp with time zone | NULL |  |  |
| committed_by | uuid | NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `config_bundle_import_committable` (CHECK): `CHECK (((status <> ALL (ARRAY['validated', 'committed'])) OR ((items_conflict = 0) AND (items_refused = 0))))`
- `config_bundle_import_committed_shape` (CHECK): `CHECK ((((status = 'committed') = ((committed_at IS NOT NULL) AND (committed_by IS NOT NULL))) AND ((committed_at IS NULL) = (committed_by IS NULL))))`
- `config_bundle_import_validated_shape` (CHECK): `CHECK ((((status = 'uploaded') = (validation_no = 0)) AND ((validation_no = 0) = (validated_at IS NULL)) AND ((validated_at IS NULL) = (validated_by IS NULL)) AND ((validated_at IS NULL) = (items_create IS NULL)) AND ((items_create IS NULL) = (items_new_draft IS NULL)) AND ((items_create IS NULL) = (items_identical IS NULL)) AND ((items_create IS NULL) = (items_conflict IS NULL)) AND ((items_create IS NULL) = (items_refused IS NULL))))`

**Indexes:**

- `config_bundle_import_org_idx`: `(organization_id, created_at DESC, id)`

**Triggers:**

- `config_bundle_import_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `config_bundle_import_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `config_bundle_import_guard()`
- `config_bundle_import_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## config_bundle_import_item

- **Purpose:** One bundle item of one validation run with its planned action (create_draft, new_draft, identical, conflict, refused) and problem code (ADR-0065 §4).
- **Migration:** `0134_p7_config_bundles.sql`. **API module:** `transfer (config-bundle)`. **Who writes:** validateConfigBundleImport. **Lifecycle:** append-only; one set per validation run.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| config_bundle_import_id | uuid | NOT NULL |  | FK → config_bundle_import(id) |
| validation_no | integer | NOT NULL |  | `CHECK ((validation_no >= 1))` |
| ordinal | integer | NOT NULL |  | `CHECK ((ordinal >= 1))` |
| kind | text | NOT NULL |  | `CHECK ((kind = ANY (ARRAY['methodology', 'scoring_defaults', 'form_schema', 'procedure', 'automation_rule_set', 'health_check_scheme', 'automation_rule', 'branding', 'notification_policy', 'job_schedule', 'config_review_policy', 'upload_policy'])))` |
| item_code | text | NOT NULL |  | `CHECK ((((char_length(item_code) >= 1) AND (char_length(item_code) <= 200)) AND (item_code ~ '^[a-z0-9][a-z0-9_.:-]*$')))` |
| source_version_no | integer | NULL |  | `CHECK (((source_version_no IS NULL) OR (source_version_no >= 1)))` |
| content_sha256 | text | NOT NULL |  | `CHECK ((content_sha256 ~ '^[0-9a-f]{64}$'))` |
| action | text | NOT NULL |  | `CHECK ((action = ANY (ARRAY['create_draft', 'new_draft', 'identical', 'conflict', 'refused'])))` |
| problem_code | text | NULL |  | `CHECK (((problem_code IS NULL) OR (problem_code ~ '^config_bundle\.[a-z_]+$')))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `config_bundle_import_item_code` (UNIQUE): `UNIQUE (config_bundle_import_id, validation_no, kind, item_code)`
- `config_bundle_import_item_order` (UNIQUE): `UNIQUE (config_bundle_import_id, validation_no, ordinal)`
- `config_bundle_import_item_problem` (CHECK): `CHECK (((action = ANY (ARRAY['conflict', 'refused'])) = (problem_code IS NOT NULL)))`

**Triggers:**

- `config_bundle_import_item_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `config_bundle_import_item_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

## config_bundle_import_commit

- **Purpose:** The record a committed bundle item created: a draft for the seven drafting kinds, the kind's own change for the five others (ADR-0065 §5).
- **Migration:** `0134_p7_config_bundles.sql`. **API module:** `transfer (config-bundle)`. **Who writes:** commitConfigBundleImport. **Lifecycle:** append-only; only create_draft and new_draft items (trigger).
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| config_bundle_import_item_id | uuid | NOT NULL |  | FK → config_bundle_import_item(id); PK |
| target_record_type | text | NOT NULL |  | `CHECK ((target_record_type = ANY (ARRAY['methodology_version', 'automation_rule_version', 'branding_version', 'notification_policy', 'job_schedule', 'config_review_policy', 'upload_policy'])))` |
| target_record_id | uuid | NOT NULL |  |  |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Indexes:**

- `config_bundle_import_commit_target_idx`: `(target_record_type, target_record_id)`

**Triggers:**

- `config_bundle_import_commit_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `config_bundle_import_commit_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `config_bundle_import_commit_guard`: BEFORE INSERT FOR EACH ROW → `config_bundle_import_commit_guard()`

