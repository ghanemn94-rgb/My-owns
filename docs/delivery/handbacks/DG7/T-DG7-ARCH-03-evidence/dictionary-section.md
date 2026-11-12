qa disposable cluster: PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0, 64-bit; server_encoding UTF8, lc_collate C, lc_ctype C
## retention_class

- **Purpose:** One record class with its category, action (retain, archive, archive_then_purge), period (NULL: not set, IT to agree) and the IT approval reference text, which records an approval given outside the platform and approves nothing (REQ-S16-024; ADR-0067 §1-§2; D-243 Q3). 12 classes are seeded, all 'retain'.
- **Migration:** `0143_p7_retention_classes.sql`. **API module:** `retention (classes)`. **Who writes:** migrations (the classes); `retention.configure` (ADM_TECH) through updateRetentionClass (lock 730410). Column-level UPDATE of action, period_days, it_approval_reference and the version columns only. **Lifecycle:** never deleted; only operational classes not managed by an existing job may leave 'retain' (CHECK); 'archive' needs an age column on every table, 'archive_then_purge' every table purge-eligible (trigger); versioned and audited.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| code | text | NOT NULL |  | `CHECK ((code ~ '^[a-z][a-z0-9_]{2,62}$'))` |
| category | text | NOT NULL |  | `CHECK ((category = ANY (ARRAY['business', 'audit', 'snapshot', 'system', 'derived', 'operational'])))` |
| label_en | text | NOT NULL |  | `CHECK (((char_length(label_en) >= 1) AND (char_length(label_en) <= 200)))` |
| label_ar | text | NOT NULL |  | `CHECK (((char_length(label_ar) >= 1) AND (char_length(label_ar) <= 200)))` |
| description_en | text | NOT NULL |  | `CHECK (((char_length(description_en) >= 1) AND (char_length(description_en) <= 1000)))` |
| description_ar | text | NOT NULL |  | `CHECK (((char_length(description_ar) >= 1) AND (char_length(description_ar) <= 1000)))` |
| managed_by_job | text | NULL |  | `CHECK (((managed_by_job IS NULL) OR (managed_by_job ~ '^[a-z_]+\.[a-z_.-]+$')))` |
| action | text | NOT NULL | `'retain'` | `CHECK ((action = ANY (ARRAY['retain', 'archive', 'archive_then_purge'])))` |
| period_days | integer | NULL |  | `CHECK (((period_days IS NULL) OR ((period_days >= 1) AND (period_days <= 36500))))` |
| it_approval_reference | text | NULL |  | `CHECK (((it_approval_reference IS NULL) OR ((char_length(btrim(it_approval_reference)) >= 3) AND (char_length(btrim(it_approval_reference)) <= 500))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `retention_class_code_key` (UNIQUE): `UNIQUE (code)`
- `retention_class_enabled_shape` (CHECK): `CHECK (((action = 'retain') OR ((period_days IS NOT NULL) AND (it_approval_reference IS NOT NULL))))`
- `retention_class_retain_only` (CHECK): `CHECK (((action = 'retain') OR ((category = 'operational') AND (managed_by_job IS NULL))))`

**Triggers:**

- `retention_class_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `retention_class_guard`: BEFORE UPDATE FOR EACH ROW → `retention_class_guard()`
- `retention_class_no_delete`: BEFORE DELETE OR TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `retention_class_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## retention_table_class

- **Purpose:** One row per public base table: its retention class, its primary key columns (the archived record's key), its age column (NULL: never selected) and whether a purge is allowed (ADR-0067 §1, §3). Generated from the catalogue by 0143; explicit rows for audit, snapshot, system, derived and operational tables.
- **Migration:** `0143_p7_retention_classes.sql`. **API module:** `retention (classes)`. **Who writes:** migrations only (`mth_app` reads); every migration that creates a table adds its row. **Lifecycle:** append-only; the catalogue test fails when a public base table has no row.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| table_name | text | NOT NULL |  | PK; `CHECK ((table_name ~ '^[a-z][a-z0-9_]{0,62}$'))` |
| retention_class_id | uuid | NOT NULL |  | FK → retention_class(id) |
| key_columns | text[] | NOT NULL |  | `CHECK ((((cardinality(key_columns) >= 1) AND (cardinality(key_columns) <= 4)) AND (array_position(key_columns, NULL) IS NULL)))` |
| age_column | text | NULL |  | `CHECK (((age_column IS NULL) OR (age_column ~ '^[a-z][a-z0-9_]{0,62}$')))` |
| purge_eligible | boolean | NOT NULL | `false` |  |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `retention_table_class_purge_needs_age` (CHECK): `CHECK (((NOT purge_eligible) OR (age_column IS NOT NULL)))`

**Indexes:**

- `retention_table_class_class_idx`: `(retention_class_id, table_name)`

**Triggers:**

- `retention_table_class_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `retention_table_class_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

## retention_run

- **Purpose:** One retention run or dry run of the retention.archive job: as-of time, counts and the archive set's key and SHA-256 (REQ-S16-024; ADR-0067 §4).
- **Migration:** `0144_p7_retention_runs.sql`. **API module:** `retention (runs)`. **Who writes:** `retention.run` (ADM_TECH) through createRetentionRun / createRetentionDryRun (lock 730410); the worker job `retention.archive`; the disabled schedule (requested_via schedule). Column-level UPDATE of the status, results and version columns only. **Lifecycle:** queued -> running | failed; running -> succeeded | failed; terminal states immutable; at most one queued or running; a dry run never has an archive set; versioned and audited.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| mode | text | NOT NULL |  | `CHECK ((mode = ANY (ARRAY['dry_run', 'run'])))` |
| status | text | NOT NULL | `'queued'` | `CHECK ((status = ANY (ARRAY['queued', 'running', 'succeeded', 'failed'])))` |
| requested_via | text | NOT NULL |  | `CHECK ((requested_via = ANY (ARRAY['api', 'schedule'])))` |
| as_of | timestamp with time zone | NOT NULL |  |  |
| candidate_count | integer | NULL |  | `CHECK (((candidate_count IS NULL) OR (candidate_count >= 0)))` |
| archived_count | integer | NULL |  | `CHECK (((archived_count IS NULL) OR (archived_count >= 0)))` |
| purged_count | integer | NULL |  | `CHECK (((purged_count IS NULL) OR (purged_count >= 0)))` |
| skipped_count | integer | NULL |  | `CHECK (((skipped_count IS NULL) OR (skipped_count >= 0)))` |
| archive_set_key | text | NULL |  | `CHECK (((archive_set_key IS NULL) OR (archive_set_key ~ '^retention/[0-9a-f-]{36}/manifest\.json$')))` |
| archive_set_sha256 | text | NULL |  | `CHECK (((archive_set_sha256 IS NULL) OR (archive_set_sha256 ~ '^[0-9a-f]{64}$')))` |
| archive_set_bytes | bigint | NULL |  | `CHECK (((archive_set_bytes IS NULL) OR (archive_set_bytes >= 0)))` |
| failure_reason | text | NULL |  | `CHECK (((failure_reason IS NULL) OR ((char_length(failure_reason) >= 1) AND (char_length(failure_reason) <= 1000))))` |
| started_at | timestamp with time zone | NULL |  |  |
| finished_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `retention_run_archive_set` (CHECK): `CHECK ((((archive_set_key IS NULL) = (archive_set_sha256 IS NULL)) AND ((archive_set_key IS NULL) = (archive_set_bytes IS NULL)) AND ((archive_set_key IS NULL) OR (archive_set_key = (('retention/' || (id)) || '/manifest.json')))))`
- `retention_run_dry_run_writes_nothing` (CHECK): `CHECK (((mode = 'run') OR ((archive_set_key IS NULL) AND (COALESCE(archived_count, 0) = 0) AND (COALESCE(purged_count, 0) = 0))))`
- `retention_run_failed_shape` (CHECK): `CHECK (((status <> 'failed') OR ((failure_reason IS NOT NULL) AND (finished_at IS NOT NULL))))`
- `retention_run_requester` (CHECK): `CHECK (((requested_via = 'api') = (created_by IS NOT NULL)))`
- `retention_run_succeeded_shape` (CHECK): `CHECK (((status <> 'succeeded') OR ((candidate_count IS NOT NULL) AND (archived_count IS NOT NULL) AND (purged_count IS NOT NULL) AND (skipped_count IS NOT NULL) AND (started_at IS NOT NULL) AND (finished_at IS NOT NULL) AND (failure_reason IS NULL) AND (purged_count <= ((archived_count + skipped_count) + candidate_count)) AND ((mode = 'dry_run') OR (archived_count = 0) OR (archive_set_key IS NOT NULL)))))`

**Indexes:**

- `retention_run_created_idx`: `(created_at DESC, id)`
- `retention_run_one_active`: `UNIQUE ((true)) WHERE (status = ANY (ARRAY['queued', 'running']))`

**Triggers:**

- `retention_run_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `retention_run_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `retention_run_guard()`
- `retention_run_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## retention_archived_record

- **Purpose:** One archived live row: table, primary key as a text-valued object, the run and archive set holding its copy, its age, and when it was purged (NULL: kept, read-only) (ADR-0067 §5).
- **Migration:** `0144_p7_retention_runs.sql`. **API module:** `retention (runs)`. **Who writes:** the job `retention.archive` (INSERT; the trigger re-checks the class, the key and that the row is past retention); `retention_purge_record()` sets the purge marker. **Lifecycle:** one row per record, ever; only purged_at and purge_run_id are set, once; never deleted.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| table_name | text | NOT NULL |  | FK → retention_table_class(table_name) |
| record_key | jsonb | NOT NULL |  | `CHECK ((jsonb_typeof(record_key) = 'object'))` |
| retention_class_id | uuid | NOT NULL |  | FK → retention_class(id) |
| retention_run_id | uuid | NOT NULL |  | FK → retention_run(id) |
| archive_set_key | text | NOT NULL |  | `CHECK ((archive_set_key ~ '^retention/[0-9a-f-]{36}/manifest\.json$'))` |
| record_age_at | timestamp with time zone | NOT NULL |  |  |
| archived_at | timestamp with time zone | NOT NULL | `now()` |  |
| purged_at | timestamp with time zone | NULL |  |  |
| purge_run_id | uuid | NULL |  | FK → retention_run(id) |

**Table constraints:**

- `retention_archived_record_pkey` (PK): `PRIMARY KEY (table_name, record_key)`
- `retention_archived_record_purge_shape` (CHECK): `CHECK (((purged_at IS NULL) = (purge_run_id IS NULL)))`
- `retention_archived_record_set` (CHECK): `CHECK ((archive_set_key = (('retention/' || (retention_run_id)) || '/manifest.json')))`

**Indexes:**

- `retention_archived_record_list_idx`: `(archived_at DESC, table_name)`
- `retention_archived_record_run_idx`: `(retention_run_id)`

**Triggers:**

- `retention_archived_record_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `retention_archived_record_guard()`
- `retention_archived_record_no_delete`: BEFORE DELETE OR TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

## retention_run_action

- **Purpose:** The per-record action log of a run: would_archive, would_purge (dry run), archived, purged, skipped_referenced, with the class, period applied and the record's age (REQ-S16-024 'logs each action'; ADR-0067 §6).
- **Migration:** `0144_p7_retention_runs.sql`. **API module:** `retention (runs)`. **Who writes:** the job `retention.archive`. **Lifecycle:** append-only; unique per (run, table, key, action); every archived, purged and skipped_referenced row needs its audit event in the same transaction.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| retention_run_id | uuid | NOT NULL |  | FK → retention_run(id) |
| retention_class_id | uuid | NOT NULL |  | FK → retention_class(id) |
| table_name | text | NOT NULL |  | FK → retention_table_class(table_name) |
| record_key | jsonb | NOT NULL |  | `CHECK ((jsonb_typeof(record_key) = 'object'))` |
| action | text | NOT NULL |  | `CHECK ((action = ANY (ARRAY['would_archive', 'would_purge', 'archived', 'purged', 'skipped_referenced'])))` |
| period_days | integer | NOT NULL |  | `CHECK (((period_days >= 1) AND (period_days <= 36500)))` |
| record_age_at | timestamp with time zone | NOT NULL |  |  |
| occurred_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `retention_run_action_once` (UNIQUE): `UNIQUE (retention_run_id, table_name, record_key, action)`

**Indexes:**

- `retention_run_action_run_idx`: `(retention_run_id, occurred_at, id)`

**Triggers:**

- `retention_run_action_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `retention_run_action_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `retention_run_action_audit_required`: CONSTRAINT AFTER INSERT DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `retention_run_action_audit_required()`
- `retention_run_action_guard`: BEFORE INSERT FOR EACH ROW → `retention_run_action_guard()`

## backup_set

- **Purpose:** One backup set the backup job produced or failed to produce: timings, migration level, PostgreSQL major, dump, evidence, configuration-bundle and manifest checksums and counts (REQ-S19-012; ADR-0066 §6). No content, no credential.
- **Migration:** `0145_p7_backup_sets.sql`. **API module:** `retention (backups)`. **Who writes:** `backup_set_record(jsonb)` only, called by `deploy/scripts/backup.sh` as mth_owner (`mth_app` reads). **Lifecycle:** append-only; audited (backup.recorded, written by the function).
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| label | text | NOT NULL |  | `CHECK ((label ~ '^[a-z0-9][a-z0-9._-]{0,99}$'))` |
| status | text | NOT NULL |  | `CHECK ((status = ANY (ARRAY['succeeded', 'failed'])))` |
| manifest_schema_version | text | NOT NULL |  | `CHECK ((manifest_schema_version = 'mth-backup/1'))` |
| started_at | timestamp with time zone | NOT NULL |  |  |
| finished_at | timestamp with time zone | NOT NULL |  |  |
| migration_level | text | NULL |  | `CHECK (((migration_level IS NULL) OR (migration_level ~ '^[0-9]{4}_[a-z0-9_]+$')))` |
| server_major | integer | NULL |  | `CHECK (((server_major IS NULL) OR ((server_major >= 16) AND (server_major <= 99))))` |
| dump_format | text | NULL |  | `CHECK (((dump_format IS NULL) OR (dump_format = 'custom')))` |
| dump_bytes | bigint | NULL |  | `CHECK (((dump_bytes IS NULL) OR (dump_bytes > 0)))` |
| dump_sha256 | text | NULL |  | `CHECK (((dump_sha256 IS NULL) OR (dump_sha256 ~ '^[0-9a-f]{64}$')))` |
| evidence_backend | text | NULL |  | `CHECK (((evidence_backend IS NULL) OR (evidence_backend = ANY (ARRAY['filesystem', 's3']))))` |
| evidence_object_count | integer | NULL |  | `CHECK (((evidence_object_count IS NULL) OR (evidence_object_count >= 0)))` |
| evidence_bytes | bigint | NULL |  | `CHECK (((evidence_bytes IS NULL) OR (evidence_bytes >= 0)))` |
| attachment_manifest_sha256 | text | NULL |  | `CHECK (((attachment_manifest_sha256 IS NULL) OR (attachment_manifest_sha256 ~ '^[0-9a-f]{64}$')))` |
| config_bundle_sha256 | text | NULL |  | `CHECK (((config_bundle_sha256 IS NULL) OR (config_bundle_sha256 ~ '^[0-9a-f]{64}$')))` |
| manifest_sha256 | text | NULL |  | `CHECK (((manifest_sha256 IS NULL) OR (manifest_sha256 ~ '^[0-9a-f]{64}$')))` |
| failure_reason | text | NULL |  | `CHECK (((failure_reason IS NULL) OR ((char_length(failure_reason) >= 1) AND (char_length(failure_reason) <= 1000))))` |
| operator_name | text | NOT NULL |  | `CHECK (((char_length(operator_name) >= 1) AND (char_length(operator_name) <= 200)))` |
| recorded_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `backup_set_failed_shape` (CHECK): `CHECK (((status <> 'failed') OR (failure_reason IS NOT NULL)))`
- `backup_set_label_key` (UNIQUE): `UNIQUE (label)`
- `backup_set_succeeded_shape` (CHECK): `CHECK (((status <> 'succeeded') OR ((migration_level IS NOT NULL) AND (server_major IS NOT NULL) AND (dump_format IS NOT NULL) AND (dump_bytes IS NOT NULL) AND (dump_sha256 IS NOT NULL) AND (evidence_backend IS NOT NULL) AND (evidence_object_count IS NOT NULL) AND (evidence_bytes IS NOT NULL) AND (attachment_manifest_sha256 IS NOT NULL) AND (config_bundle_sha256 IS NOT NULL) AND (manifest_sha256 IS NOT NULL) AND (failure_reason IS NULL))))`
- `backup_set_times` (CHECK): `CHECK ((finished_at >= started_at))`

**Indexes:**

- `backup_set_finished_idx`: `(finished_at DESC, id)`

**Triggers:**

- `backup_set_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `backup_set_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `backup_set_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `backup_set_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

