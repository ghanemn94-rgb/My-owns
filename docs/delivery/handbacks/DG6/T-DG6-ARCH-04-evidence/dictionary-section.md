### search_document

- **Purpose:** One DERIVED search document per indexed record (12 record types): scope keys, code, title, text summary, record status, the record version and the audit sequence it reflects, and stored generated tsvectors over the english, arabic and simple configurations (REQ-S15-010, REQ-S10-004; ADR-0057 §1-§2). No money, rate, KPI or FTE value is indexed.
- **Migration:** `0108_p6_search_saved_views_help.sql`. **API module:** `search`. **Who writes:** the worker search handlers only (`search.index_feed`, `search.reindex`; BE-P), as the search service identity (ADR-0053); never a user request. **Lifecycle:** upserted from the audit-event feed; never goes back to an older audit sequence or record version; deleted when its record no longer exists; version-stepped, not audited (a derived copy).
- **`mth_app` privileges:** DELETE, INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| record_type | text | NOT NULL |  |  |
| record_id | uuid | NOT NULL |  |  |
| record_version | integer | NOT NULL |  | `CHECK ((record_version >= 1))` |
| code | text | NULL |  | `CHECK (((code IS NULL) OR ((char_length(code) >= 1) AND (char_length(code) <= 40))))` |
| title | text | NOT NULL |  | `CHECK (((char_length(title) >= 1) AND (char_length(title) <= 500)))` |
| summary | text | NULL |  | `CHECK (((summary IS NULL) OR ((char_length(summary) >= 1) AND (char_length(summary) <= 1000))))` |
| record_status | text | NULL |  | `CHECK (((record_status IS NULL) OR (record_status ~ '^[a-z][a-z0-9_]{0,39}$')))` |
| is_archived | boolean | NOT NULL | `false` |  |
| source_audit_seq | bigint | NOT NULL |  | `CHECK ((source_audit_seq >= 0))` |
| search_en | tsvector | NULL | `to_tsvector('english'::regconfig, ((((COALESCE(code, '') || ' ') || title) || ' ') || COALESCE(summary, '')))` |  |
| search_ar | tsvector | NULL | `to_tsvector('arabic'::regconfig, ((((COALESCE(code, '') || ' ') || title) || ' ') || COALESCE(summary, '')))` |  |
| search_simple | tsvector | NULL | `to_tsvector('simple'::regconfig, ((((COALESCE(code, '') || ' ') || title) || ' ') || COALESCE(summary, '')))` |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `search_document_record_key` (UNIQUE): `UNIQUE (record_type, record_id)`
- `search_document_record_type` (CHECK): `CHECK (p6_search_record_type_valid(record_type))`
- `search_document_transformation_self` (CHECK): `CHECK (((record_type <> 'transformation') OR (record_id = transformation_id)))`

**Indexes:**

- `search_document_ar_idx`: `CREATE INDEX search_document_ar_idx ON public.search_document USING gin (search_ar)`
- `search_document_en_idx`: `CREATE INDEX search_document_en_idx ON public.search_document USING gin (search_en)`
- `search_document_scope_idx`: `(organization_id, transformation_id, record_type)`
- `search_document_simple_idx`: `CREATE INDEX search_document_simple_idx ON public.search_document USING gin (search_simple)`

**Triggers:**

- `search_document_guard`: BEFORE UPDATE FOR EACH ROW → `search_document_guard()`
- `search_document_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

### search_index_state

- **Purpose:** Per indexed record type: the consumed audit sequence, the last incremental run, the last full reindex, the document count (NULL = Unknown) and the last error code (ADR-0057 §2).
- **Migration:** `0108_p6_search_saved_views_help.sql`. **API module:** `search`. **Who writes:** the worker search handlers only (BE-P); read by getSearchIndexStatus. **Lifecycle:** 12 seeded rows; idle <-> reindexing | failed; the sequence goes back only to 0 when a full reindex starts; version-stepped, not audited (telemetry).
- **`mth_app` privileges:** SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| record_type | text | NOT NULL |  |  |
| status | text | NOT NULL | `'idle'` | `CHECK ((status = ANY (ARRAY['idle', 'reindexing', 'failed'])))` |
| last_audit_seq | bigint | NOT NULL | `0` | `CHECK ((last_audit_seq >= 0))` |
| last_incremental_at | timestamp with time zone | NULL |  |  |
| reindex_started_at | timestamp with time zone | NULL |  |  |
| reindex_finished_at | timestamp with time zone | NULL |  |  |
| documents_count | integer | NULL |  | `CHECK (((documents_count IS NULL) OR (documents_count >= 0)))` |
| last_error_code | text | NULL |  | `CHECK (((last_error_code IS NULL) OR (last_error_code ~ '^[a-z][a-z0-9_.]{2,79}$')))` |
| last_error_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `search_index_state_failed_coded` (CHECK): `CHECK ((((status = 'failed') = (last_error_code IS NOT NULL)) AND ((last_error_code IS NULL) = (last_error_at IS NULL))))`
- `search_index_state_finished_after` (CHECK): `CHECK (((reindex_finished_at IS NULL) OR (reindex_started_at IS NULL) OR (reindex_finished_at >= reindex_started_at)))`
- `search_index_state_record_type` (CHECK): `CHECK (p6_search_record_type_valid(record_type))`
- `search_index_state_record_type_key` (UNIQUE): `UNIQUE (record_type)`
- `search_index_state_reindexing_started` (CHECK): `CHECK (((status <> 'reindexing') OR (reindex_started_at IS NOT NULL)))`

**Triggers:**

- `search_index_state_guard`: BEFORE UPDATE FOR EACH ROW → `search_index_state_guard()`
- `search_index_state_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

### saved_view

- **Purpose:** A user's named configuration of one of 12 lists: visible columns, filters, sort, default flag; personal or shared in the owner's organization (REQ-S15-010, REQ-S15-013; ADR-0057 §4).
- **Migration:** `0108_p6_search_saved_views_help.sql`. **API module:** `search (saved views)`. **Who writes:** the owner, holding `saved_view.manage` (every role except AUD), through createSavedView, putSavedView, deleteSavedView; sharing: the owner holding `saved_view.share` (TL, BO, WL, TO, KDS, TD) through shareSavedView (lock 730319). **Lifecycle:** active -> deleted (final); owner, list and transformation fixed; versioned and audited.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| owner_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| list_key | text | NOT NULL |  | `CHECK ((list_key = ANY (ARRAY['transformations', 'initiatives', 'strategic_guardrails', 'outcomes', 'diagnostic_items', 'diagnostic_findings', 'workstream_outputs', 'tom_gaps', 'capability_heatmap', 'journeys', 'journey_pain_points', 'search'])))` |
| transformation_id | uuid | NULL |  | FK → transformation(id) |
| name | text | NOT NULL |  | `CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120)))` |
| visibility | text | NOT NULL | `'personal'` | `CHECK ((visibility = ANY (ARRAY['personal', 'shared'])))` |
| columns | jsonb | NOT NULL |  |  |
| filters | jsonb | NOT NULL | `'{}'::jsonb` |  |
| sort | jsonb | NOT NULL | `'[]'::jsonb` |  |
| is_default | boolean | NOT NULL | `false` |  |
| shared_at | timestamp with time zone | NULL |  |  |
| shared_by | uuid | NULL |  | FK → app_user(id) |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'deleted'])))` |
| deleted_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `saved_view_columns_valid` (CHECK): `CHECK (p6_saved_view_columns_valid(columns))`
- `saved_view_cross_transformation_lists` (CHECK): `CHECK (((list_key <> 'transformations') OR (transformation_id IS NULL)))`
- `saved_view_deleted_not_default` (CHECK): `CHECK (((status = 'active') OR (NOT is_default)))`
- `saved_view_deleted_shape` (CHECK): `CHECK (((status = 'deleted') = (deleted_at IS NOT NULL)))`
- `saved_view_filters_valid` (CHECK): `CHECK (p6_saved_view_filters_valid(filters))`
- `saved_view_owner_is_creator` (CHECK): `CHECK ((owner_user_id = created_by))`
- `saved_view_shared_shape` (CHECK): `CHECK ((((visibility = 'shared') = (shared_at IS NOT NULL)) AND ((shared_at IS NULL) = (shared_by IS NULL))))`
- `saved_view_sort_valid` (CHECK): `CHECK (p6_saved_view_sort_valid(sort))`

**Indexes:**

- `saved_view_name_key`: `UNIQUE (owner_user_id, list_key, COALESCE(transformation_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) WHERE (status = 'active')`
- `saved_view_one_default_key`: `UNIQUE (owner_user_id, list_key, COALESCE(transformation_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE ((status = 'active') AND is_default)`
- `saved_view_owner_idx`: `(owner_user_id, list_key, updated_at DESC) WHERE (status = 'active')`
- `saved_view_shared_idx`: `(organization_id, list_key) WHERE ((status = 'active') AND (visibility = 'shared'))`

**Triggers:**

- `saved_view_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `saved_view_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `saved_view_guard()`
- `saved_view_history`: AFTER INSERT OR UPDATE FOR EACH ROW → `saved_view_history()`
- `saved_view_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

### saved_view_event

- **Purpose:** Append-only history of every version of a saved view.
- **Migration:** `0108_p6_search_saved_views_help.sql`. **API module:** `search (saved views)`. **Who writes:** the SECURITY DEFINER trigger `saved_view_history` only. **Lifecycle:** append-only; one row per saved_view version.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| saved_view_id | uuid | NOT NULL |  | FK → saved_view(id) |
| record_version | integer | NOT NULL |  | `CHECK ((record_version >= 1))` |
| name | text | NOT NULL |  |  |
| visibility | text | NOT NULL |  |  |
| columns | jsonb | NOT NULL |  |  |
| filters | jsonb | NOT NULL |  |  |
| sort | jsonb | NOT NULL |  |  |
| is_default | boolean | NOT NULL |  |  |
| status | text | NOT NULL |  |  |
| actor_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| occurred_at | timestamp with time zone | NOT NULL |  |  |

**Table constraints:**

- `saved_view_event_version_key` (UNIQUE): `UNIQUE (saved_view_id, record_version)`

**Triggers:**

- `saved_view_event_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `saved_view_event_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

### help_topic

- **Purpose:** The contextual help catalogue: topic and screen keys, English and Arabic title and body (the Arabic labelled provisional), source references (REQ-S15-010; ADR-0057 §8).
- **Migration:** `0108_p6_search_saved_views_help.sql`. **API module:** `search (help topics)`. **Who writes:** migrations only (mth_owner); mth_app reads. **Lifecycle:** seeded; a correction is a later migration.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| topic_key | text | NOT NULL |  | `CHECK (((topic_key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$') AND (char_length(topic_key) <= 80)))` |
| screen_key | text | NOT NULL |  | `CHECK (((screen_key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$') AND (char_length(screen_key) <= 80)))` |
| ordinal | integer | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 999)))` |
| title_en | text | NOT NULL |  | `CHECK (((char_length(title_en) >= 1) AND (char_length(title_en) <= 120)))` |
| title_ar | text | NOT NULL |  | `CHECK (((char_length(title_ar) >= 1) AND (char_length(title_ar) <= 160)))` |
| body_en | text | NOT NULL |  | `CHECK (((char_length(body_en) >= 1) AND (char_length(body_en) <= 2000)))` |
| body_ar | text | NOT NULL |  | `CHECK (((char_length(body_ar) >= 1) AND (char_length(body_ar) <= 2400)))` |
| arabic_provisional | boolean | NOT NULL |  |  |
| source_refs | text[] | NOT NULL |  | `CHECK ((((cardinality(source_refs) >= 1) AND (cardinality(source_refs) <= 6)) AND (array_to_string(source_refs, ',') ~ '^(M0[0-9]{3}\|B0[0-9]{3}\|REQ-S[0-9]{2}-[0-9]{3})(,(M0[0-9]{3}\|B0[0-9]{3}\|REQ-S[0-9]{2}-[0-9]{3}))*$')))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `help_topic_screen_ordinal_key` (UNIQUE): `UNIQUE (screen_key, ordinal)`
- `help_topic_topic_key` (UNIQUE): `UNIQUE (topic_key)`

### load_dataset_marker

- **Purpose:** At most one row naming the synthetic load dataset a database holds: code, generator version, seed and sizes (REQ-S20-029; ADR-0058 §2, §4).
- **Migration:** `0108_p6_search_saved_views_help.sql`. **API module:** `none (deploy/load)`. **Who writes:** deploy/load/generate.mjs (DO-E) as mth_owner, into an empty database without a deployment_environment row. **Lifecycle:** append-only; written once.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| singleton | boolean | NOT NULL | `true` | PK; `CHECK (singleton)` |
| dataset_code | text | NOT NULL |  | `CHECK ((dataset_code = 'mth_load_v1'))` |
| generator_version | text | NOT NULL |  | `CHECK ((generator_version ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'))` |
| random_seed | bigint | NOT NULL |  | `CHECK ((random_seed >= 0))` |
| transformations | integer | NOT NULL |  | `CHECK ((transformations >= 1))` |
| initiatives | integer | NOT NULL |  | `CHECK ((initiatives >= 0))` |
| kpi_actuals | integer | NOT NULL |  | `CHECK ((kpi_actuals >= 0))` |
| audit_events | integer | NOT NULL |  | `CHECK ((audit_events >= 0))` |
| users | integer | NOT NULL |  | `CHECK ((users >= 1))` |
| generated_at | timestamp with time zone | NOT NULL | `now()` |  |

**Triggers:**

- `load_dataset_marker_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `load_dataset_marker_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `load_dataset_marker_guard`: BEFORE INSERT FOR EACH ROW → `load_dataset_marker_guard()`

