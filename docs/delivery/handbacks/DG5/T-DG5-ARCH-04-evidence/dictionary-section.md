qa disposable cluster: PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0, 64-bit; server_encoding UTF8, lc_collate C, lc_ctype C
## report_definition

- **Purpose:** The generated outputs (REQ-S13-004): the ten M0253 outputs, the executive pack (M0185) and the meeting pack (M0212), with subject type, period need, export formats and playbook template (ADR-0045 §1).
- **Migration:** `0080_p5_reports_snapshots_updates.sql`. **API module:** `reporting`. **Who writes:** migrations only. **Lifecycle:** seeded catalogue (12 rows).
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| code | text | NOT NULL |  | `CHECK ((code = ANY (ARRAY['charter', 'diagnostic', 'tom', 'business_cases', 'roadmap', 'registers', 'meeting_minutes', 'gate_pack', 'executive_dashboard', 'handover', 'executive_pack', 'meeting_pack'])))`; PK |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 99)))` |
| output_kind | text | NOT NULL |  | `CHECK ((output_kind = ANY (ARRAY['generated_output', 'executive_pack', 'meeting_pack'])))` |
| subject_type | text | NOT NULL |  | `CHECK ((subject_type = ANY (ARRAY['transformation', 'meeting', 'gate_instance', 'business_case', 'bau_handover'])))` |
| needs_reporting_period | boolean | NOT NULL |  |  |
| formats | text[] | NOT NULL |  | `CHECK ((((cardinality(formats) >= 1) AND (cardinality(formats) <= 5)) AND (formats <@ ARRAY['pdf', 'docx', 'xlsx', 'pptx', 'csv'])))` |
| label_en | text | NOT NULL |  | `CHECK (((char_length(label_en) >= 1) AND (char_length(label_en) <= 200)))` |
| label_ar | text | NOT NULL |  | `CHECK (((char_length(label_ar) >= 1) AND (char_length(label_ar) <= 200)))` |
| description_en | text | NOT NULL |  | `CHECK (((char_length(description_en) >= 1) AND (char_length(description_en) <= 500)))` |
| description_ar | text | NOT NULL |  | `CHECK (((char_length(description_ar) >= 1) AND (char_length(description_ar) <= 500)))` |
| source_ref | text | NOT NULL |  | `CHECK ((source_ref ~ '^M[0-9]{4}$'))` |
| playbook_ref | text | NULL |  | `CHECK (((playbook_ref IS NULL) OR (playbook_ref ~ '^B[0-9]{4}( B[0-9]{4})*$')))` |

**Table constraints:**

- `report_definition_ordinal_key` (UNIQUE): `UNIQUE (ordinal)`

## report_snapshot

- **Purpose:** One assembled output with its as-of time, reporting period, content, methodology version, approval state and provisional/unknown counts; issue, reissue as a new version, discard (REQ-S13-007, REQ-S13-008; ADR-0045 §2-§5).
- **Migration:** `0080_p5_reports_snapshots_updates.sql`. **API module:** `reporting`. **Who writes:** `report.generate` (generate, reissue's assembly), `report.issue` (issue, reissue, discard). **Lifecycle:** generated → issued | discarded; issued → superseded by a reissue; content immutable after INSERT; never deleted; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| definition_code | text | NOT NULL |  | FK → report_definition(code) |
| subject_type | text | NOT NULL |  | `CHECK ((subject_type = ANY (ARRAY['transformation', 'meeting', 'gate_instance', 'business_case', 'bau_handover'])))` |
| subject_id | uuid | NOT NULL |  |  |
| reporting_period_id | uuid | NULL |  | FK → reporting_period(id) |
| period_label | text | NULL |  | `CHECK (((period_label IS NULL) OR ((char_length(period_label) >= 1) AND (char_length(period_label) <= 32))))` |
| period_start | date | NULL |  |  |
| period_end | date | NULL |  |  |
| parameters | jsonb | NOT NULL | `'{}'::jsonb` | `CHECK (((jsonb_typeof(parameters) = 'object') AND (octet_length((parameters)) <= 8192)))` |
| as_of | timestamp with time zone | NOT NULL |  |  |
| content_schema_version | smallint | NOT NULL |  | `CHECK ((content_schema_version = 1))` |
| content | jsonb | NOT NULL |  | `CHECK ((jsonb_typeof(content) = 'object'))` |
| content_sha256 | character(64) | NOT NULL |  | `CHECK ((content_sha256 ~ '^[0-9a-f]{64}$'))` |
| methodology_version_id | uuid | NOT NULL |  | FK → methodology_version(id) |
| approval_state | text | NOT NULL |  | `CHECK ((approval_state = ANY (ARRAY['approved', 'pending', 'not_submitted', 'changes_requested', 'rejected', 'mixed', 'not_applicable'])))` |
| provisional_value_count | integer | NOT NULL |  | `CHECK ((provisional_value_count >= 0))` |
| unknown_value_count | integer | NOT NULL |  | `CHECK ((unknown_value_count >= 0))` |
| series_id | uuid | NOT NULL |  |  |
| reissue_of_id | uuid | NULL |  | FK → report_snapshot(id) |
| reissue_reason | text | NULL |  | `CHECK (((reissue_reason IS NULL) OR ((char_length(reissue_reason) >= 3) AND (char_length(reissue_reason) <= 1000))))` |
| status | text | NOT NULL | `'generated'` | `CHECK ((status = ANY (ARRAY['generated', 'issued', 'superseded', 'discarded'])))` |
| issue_version | integer | NULL |  | `CHECK (((issue_version IS NULL) OR (issue_version >= 1)))` |
| issued_at | timestamp with time zone | NULL |  |  |
| issued_by | uuid | NULL |  | FK → app_user(id) |
| issue_note | text | NULL |  | `CHECK (((issue_note IS NULL) OR ((char_length(issue_note) >= 1) AND (char_length(issue_note) <= 1000))))` |
| superseded_at | timestamp with time zone | NULL |  |  |
| superseded_by_id | uuid | NULL |  | FK → report_snapshot(id) |
| discarded_at | timestamp with time zone | NULL |  |  |
| discarded_by | uuid | NULL |  | FK → app_user(id) |
| discard_reason | text | NULL |  | `CHECK (((discard_reason IS NULL) OR ((char_length(discard_reason) >= 3) AND (char_length(discard_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `report_snapshot_discard_complete` (CHECK): `CHECK ((((status = 'discarded') = (discarded_at IS NOT NULL)) AND ((discarded_at IS NULL) = (discarded_by IS NULL)) AND ((discarded_at IS NULL) = (discard_reason IS NULL))))`
- `report_snapshot_issue_complete` (CHECK): `CHECK ((((status = ANY (ARRAY['issued', 'superseded'])) = (issue_version IS NOT NULL)) AND ((issue_version IS NULL) = (issued_at IS NULL)) AND ((issued_at IS NULL) = (issued_by IS NULL)) AND ((issue_note IS NULL) OR (issued_at IS NOT NULL))))`
- `report_snapshot_period_copy` (CHECK): `CHECK ((((reporting_period_id IS NULL) = (period_label IS NULL)) AND ((reporting_period_id IS NULL) = (period_start IS NULL)) AND ((reporting_period_id IS NULL) = (period_end IS NULL))))`
- `report_snapshot_reissue_shape` (CHECK): `CHECK ((((reissue_of_id IS NULL) = (reissue_reason IS NULL)) AND ((reissue_of_id IS NOT NULL) OR (series_id = id)) AND ((reissue_of_id IS NULL) OR (series_id <> id))))`
- `report_snapshot_series_issue_key` (UNIQUE): `UNIQUE (series_id, issue_version)`
- `report_snapshot_subject_transformation` (CHECK): `CHECK (((subject_type <> 'transformation') OR (subject_id = transformation_id)))`
- `report_snapshot_supersede_complete` (CHECK): `CHECK ((((status = 'superseded') = (superseded_at IS NOT NULL)) AND ((superseded_at IS NULL) = (superseded_by_id IS NULL))))`
- `report_snapshot_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `report_snapshot_list_idx`: `(transformation_id, definition_code, created_at DESC, id DESC)`
- `report_snapshot_one_issued_key`: `UNIQUE (series_id) WHERE (status = 'issued')`

**Triggers:**

- `report_snapshot_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `report_snapshot_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `report_snapshot_guard()`
- `report_snapshot_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`
- `report_snapshot_supersede_check`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `report_snapshot_supersede_check()`

## report_snapshot_source

- **Purpose:** The revision, approval state and validation state of each source record a snapshot used (REQ-S13-007 'source record revisions'; ADR-0045 §3).
- **Migration:** `0080_p5_reports_snapshots_updates.sql`. **API module:** `reporting`. **Who writes:** the snapshot's creating transaction only. **Lifecycle:** append-only (no audit event of its own; covered by report_snapshot.generate).
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| snapshot_id | uuid | NOT NULL |  |  |
| section_key | text | NOT NULL |  | `CHECK ((section_key ~ '^[a-z][a-z0-9_]{0,63}$'))` |
| record_type | text | NOT NULL |  | `CHECK ((record_type ~ '^[a-z][a-z0-9_]{1,63}$'))` |
| record_id | uuid | NOT NULL |  |  |
| record_version | integer | NOT NULL |  | `CHECK ((record_version >= 1))` |
| record_updated_at | timestamp with time zone | NULL |  |  |
| approval_state | text | NULL |  | `CHECK (((approval_state IS NULL) OR (approval_state = ANY (ARRAY['approved', 'pending', 'not_submitted', 'changes_requested', 'rejected', 'not_applicable']))))` |
| validation_state | text | NOT NULL |  | `CHECK ((validation_state = ANY (ARRAY['validated', 'provisional', 'unknown', 'stale', 'not_applicable'])))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `report_snapshot_source_record_key` (UNIQUE): `UNIQUE (snapshot_id, record_type, record_id)`
- `report_snapshot_source_snapshot_fkey` (FK): `FOREIGN KEY (transformation_id, snapshot_id) REFERENCES report_snapshot(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Triggers:**

- `report_snapshot_source_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `report_snapshot_source_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `report_snapshot_source_guard`: BEFORE INSERT FOR EACH ROW → `report_snapshot_child_guard()`
- `report_snapshot_source_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## report_snapshot_version

- **Purpose:** The methodology, configuration and calculation versions a snapshot used (REQ-S13-007; ADR-0045 §3).
- **Migration:** `0080_p5_reports_snapshots_updates.sql`. **API module:** `reporting`. **Who writes:** the snapshot's creating transaction only. **Lifecycle:** append-only (covered by report_snapshot.generate).
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| snapshot_id | uuid | NOT NULL |  |  |
| version_kind | text | NOT NULL |  | `CHECK ((version_kind = ANY (ARRAY['methodology_version', 'config_version', 'kpi_version', 'formula_version', 'weight_set', 'calculation_engine', 'scoring_scheme'])))` |
| reference_id | uuid | NULL |  |  |
| reference_key | text | NOT NULL |  | `CHECK (((char_length(reference_key) >= 1) AND (char_length(reference_key) <= 120)))` |
| version_label | text | NOT NULL |  | `CHECK (((char_length(version_label) >= 1) AND (char_length(version_label) <= 64)))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `report_snapshot_version_key` (UNIQUE): `UNIQUE (snapshot_id, version_kind, reference_key)`
- `report_snapshot_version_snapshot_fkey` (FK): `FOREIGN KEY (transformation_id, snapshot_id) REFERENCES report_snapshot(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Triggers:**

- `report_snapshot_version_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `report_snapshot_version_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `report_snapshot_version_guard`: BEFORE INSERT FOR EACH ROW → `report_snapshot_child_guard()`
- `report_snapshot_version_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## report_snapshot_evidence

- **Purpose:** The evidence a snapshot cites with the content revision, SHA-256 and review status at the as-of time (REQ-S13-010 report linkage; ADR-0045 §8).
- **Migration:** `0080_p5_reports_snapshots_updates.sql`. **API module:** `reporting`. **Who writes:** the snapshot's creating transaction only. **Lifecycle:** append-only (covered by report_snapshot.generate).
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| snapshot_id | uuid | NOT NULL |  |  |
| section_key | text | NOT NULL |  | `CHECK ((section_key ~ '^[a-z][a-z0-9_]{0,63}$'))` |
| evidence_id | uuid | NOT NULL |  |  |
| content_id | uuid | NULL |  |  |
| content_revision | integer | NULL |  | `CHECK (((content_revision IS NULL) OR (content_revision >= 1)))` |
| content_sha256 | character(64) | NULL |  | `CHECK (((content_sha256 IS NULL) OR (content_sha256 ~ '^[0-9a-f]{64}$')))` |
| review_status | text | NOT NULL |  | `CHECK ((review_status = ANY (ARRAY['unverified', 'verified', 'rejected'])))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `report_snapshot_evidence_content_fkey` (FK): `FOREIGN KEY (evidence_id, content_id) REFERENCES evidence_content(evidence_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `report_snapshot_evidence_content_shape` (CHECK): `CHECK ((((content_id IS NULL) = (content_revision IS NULL)) AND ((content_id IS NULL) = (content_sha256 IS NULL))))`
- `report_snapshot_evidence_evidence_fkey` (FK): `FOREIGN KEY (transformation_id, evidence_id) REFERENCES evidence(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `report_snapshot_evidence_key` (UNIQUE): `UNIQUE (snapshot_id, section_key, evidence_id)`
- `report_snapshot_evidence_snapshot_fkey` (FK): `FOREIGN KEY (transformation_id, snapshot_id) REFERENCES report_snapshot(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Triggers:**

- `report_snapshot_evidence_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `report_snapshot_evidence_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `report_snapshot_evidence_content`: BEFORE INSERT FOR EACH ROW → `report_snapshot_evidence_content_check()`
- `report_snapshot_evidence_guard`: BEFORE INSERT FOR EACH ROW → `report_snapshot_child_guard()`
- `report_snapshot_evidence_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## owner_update

- **Purpose:** The structured owner update of one subject (transformation or workstream) for one reporting period: the eight M0185 fields (REQ-S09-011; ADR-0045 §6).
- **Migration:** `0080_p5_reports_snapshots_updates.sql`. **API module:** `portfolio`. **Who writes:** `owner_update.submit` and the subject owner (workstream lead; TL for the transformation). **Lifecycle:** draft → submitted → draft (reopen with reason); written only while the period is open; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| subject_type | text | NOT NULL |  | `CHECK ((subject_type = ANY (ARRAY['transformation', 'workstream'])))` |
| subject_id | uuid | NOT NULL |  |  |
| reporting_period_id | uuid | NOT NULL |  | FK → reporting_period(id) |
| owner_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| achievements | text | NULL |  | `CHECK (((achievements IS NULL) OR ((char_length(achievements) >= 1) AND (char_length(achievements) <= 2000))))` |
| next_steps | text | NULL |  | `CHECK (((next_steps IS NULL) OR ((char_length(next_steps) >= 1) AND (char_length(next_steps) <= 2000))))` |
| milestones | text | NULL |  | `CHECK (((milestones IS NULL) OR ((char_length(milestones) >= 1) AND (char_length(milestones) <= 2000))))` |
| outcomes | text | NULL |  | `CHECK (((outcomes IS NULL) OR ((char_length(outcomes) >= 1) AND (char_length(outcomes) <= 2000))))` |
| adoption | text | NULL |  | `CHECK (((adoption IS NULL) OR ((char_length(adoption) >= 1) AND (char_length(adoption) <= 2000))))` |
| risks | text | NULL |  | `CHECK (((risks IS NULL) OR ((char_length(risks) >= 1) AND (char_length(risks) <= 2000))))` |
| dependencies | text | NULL |  | `CHECK (((dependencies IS NULL) OR ((char_length(dependencies) >= 1) AND (char_length(dependencies) <= 2000))))` |
| asks | text | NULL |  | `CHECK (((asks IS NULL) OR ((char_length(asks) >= 1) AND (char_length(asks) <= 2000))))` |
| status | text | NOT NULL | `'draft'` | `CHECK ((status = ANY (ARRAY['draft', 'submitted'])))` |
| revision_no | integer | NOT NULL | `0` | `CHECK ((revision_no >= 0))` |
| submitted_at | timestamp with time zone | NULL |  |  |
| submitted_by | uuid | NULL |  | FK → app_user(id) |
| reopen_reason | text | NULL |  | `CHECK (((reopen_reason IS NULL) OR ((char_length(reopen_reason) >= 3) AND (char_length(reopen_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `owner_update_subject_period_key` (UNIQUE): `UNIQUE (transformation_id, subject_type, subject_id, reporting_period_id)`
- `owner_update_subject_transformation` (CHECK): `CHECK (((subject_type <> 'transformation') OR (subject_id = transformation_id)))`
- `owner_update_submit_complete` (CHECK): `CHECK ((((status = 'submitted') = (submitted_at IS NOT NULL)) AND ((submitted_at IS NULL) = (submitted_by IS NULL)) AND ((status = 'draft') OR (revision_no >= 1))))`
- `owner_update_submitted_has_content` (CHECK): `CHECK (((status = 'draft') OR (num_nonnulls(achievements, next_steps, milestones, outcomes, adoption, risks, dependencies, asks) >= 1)))`
- `owner_update_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `owner_update_period_idx`: `(reporting_period_id, transformation_id)`

**Triggers:**

- `owner_update_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `owner_update_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `owner_update_guard()`
- `owner_update_revision_present`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `owner_update_revision_present()`
- `owner_update_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## owner_update_revision

- **Purpose:** The eight fields of each submitted revision of an owner update; the executive pack cites them (REQ-S09-011; ADR-0045 §6).
- **Migration:** `0080_p5_reports_snapshots_updates.sql`. **API module:** `portfolio`. **Who writes:** the submit transaction of owner_update. **Lifecycle:** append-only (covered by owner_update.submit).
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| owner_update_id | uuid | NOT NULL |  |  |
| revision_no | integer | NOT NULL |  | `CHECK ((revision_no >= 1))` |
| achievements | text | NULL |  | `CHECK (((achievements IS NULL) OR ((char_length(achievements) >= 1) AND (char_length(achievements) <= 2000))))` |
| next_steps | text | NULL |  | `CHECK (((next_steps IS NULL) OR ((char_length(next_steps) >= 1) AND (char_length(next_steps) <= 2000))))` |
| milestones | text | NULL |  | `CHECK (((milestones IS NULL) OR ((char_length(milestones) >= 1) AND (char_length(milestones) <= 2000))))` |
| outcomes | text | NULL |  | `CHECK (((outcomes IS NULL) OR ((char_length(outcomes) >= 1) AND (char_length(outcomes) <= 2000))))` |
| adoption | text | NULL |  | `CHECK (((adoption IS NULL) OR ((char_length(adoption) >= 1) AND (char_length(adoption) <= 2000))))` |
| risks | text | NULL |  | `CHECK (((risks IS NULL) OR ((char_length(risks) >= 1) AND (char_length(risks) <= 2000))))` |
| dependencies | text | NULL |  | `CHECK (((dependencies IS NULL) OR ((char_length(dependencies) >= 1) AND (char_length(dependencies) <= 2000))))` |
| asks | text | NULL |  | `CHECK (((asks IS NULL) OR ((char_length(asks) >= 1) AND (char_length(asks) <= 2000))))` |
| submitted_at | timestamp with time zone | NOT NULL |  |  |
| submitted_by | uuid | NOT NULL |  | FK → app_user(id) |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `owner_update_revision_has_content` (CHECK): `CHECK ((num_nonnulls(achievements, next_steps, milestones, outcomes, adoption, risks, dependencies, asks) >= 1))`
- `owner_update_revision_key` (UNIQUE): `UNIQUE (owner_update_id, revision_no)`
- `owner_update_revision_update_fkey` (FK): `FOREIGN KEY (transformation_id, owner_update_id) REFERENCES owner_update(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Triggers:**

- `owner_update_revision_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `owner_update_revision_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `owner_update_revision_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## export_job

- **Purpose:** One export of one snapshot in one format and language, rendered by the worker, with the stored file's name, type, size and SHA-256 (REQ-S13-005, REQ-S13-009; ADR-0046 §5).
- **Migration:** `0081_p5_export_jobs.sql`. **API module:** `reporting`. **Who writes:** `export.create` (create), the requester (cancel), the worker (start, retry, finish). **Lifecycle:** queued → running → succeeded | failed | queued (retry) | cancelled; request immutable; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| snapshot_id | uuid | NOT NULL |  |  |
| requested_by | uuid | NOT NULL |  | FK → app_user(id) |
| format | text | NOT NULL |  | `CHECK ((format = ANY (ARRAY['pdf', 'docx', 'xlsx', 'pptx', 'csv'])))` |
| language | text | NOT NULL |  | `CHECK ((language = ANY (ARRAY['en', 'ar'])))` |
| idempotency_key | text | NOT NULL |  | `CHECK ((idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'))` |
| status | text | NOT NULL | `'queued'` | `CHECK ((status = ANY (ARRAY['queued', 'running', 'succeeded', 'failed', 'cancelled'])))` |
| attempt_count | smallint | NOT NULL | `0` | `CHECK (((attempt_count >= 0) AND (attempt_count <= 20)))` |
| started_at | timestamp with time zone | NULL |  |  |
| finished_at | timestamp with time zone | NULL |  |  |
| storage_key | text | NULL |  | `CHECK (((storage_key IS NULL) OR (storage_key ~ '^exports/[A-Za-z0-9/_.-]{1,190}$')))` |
| file_name | text | NULL |  | `CHECK (((file_name IS NULL) OR (((char_length(file_name) >= 5) AND (char_length(file_name) <= 200)) AND (file_name ~ '^[A-Za-z0-9_.-]+$'))))` |
| content_type | text | NULL |  | `CHECK (((content_type IS NULL) OR (content_type = ANY (ARRAY['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/csv; charset=utf-8']))))` |
| file_sha256 | character(64) | NULL |  | `CHECK (((file_sha256 IS NULL) OR (file_sha256 ~ '^[0-9a-f]{64}$')))` |
| file_size_bytes | bigint | NULL |  | `CHECK (((file_size_bytes IS NULL) OR ((file_size_bytes >= 1) AND (file_size_bytes <= 209715200))))` |
| error_code | text | NULL |  | `CHECK (((error_code IS NULL) OR (error_code = ANY (ARRAY['export.render_failed', 'export.too_large', 'export.source_unavailable', 'export.retries_exhausted']))))` |
| cancelled_at | timestamp with time zone | NULL |  |  |
| cancelled_by | uuid | NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `export_job_cancel_complete` (CHECK): `CHECK ((((status = 'cancelled') = (cancelled_at IS NOT NULL)) AND ((cancelled_at IS NULL) = (cancelled_by IS NULL))))`
- `export_job_content_type_matches` (CHECK): `CHECK (((content_type IS NULL) OR (content_type =
CASE format
    WHEN 'pdf' THEN 'application/pdf'
    WHEN 'docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    WHEN 'xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    WHEN 'pptx' THEN 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ELSE 'text/csv; charset=utf-8'
END)))`
- `export_job_error_complete` (CHECK): `CHECK (((status = 'failed') = (error_code IS NOT NULL)))`
- `export_job_file_complete` (CHECK): `CHECK ((((status = 'succeeded') = (storage_key IS NOT NULL)) AND ((storage_key IS NULL) = (file_name IS NULL)) AND ((storage_key IS NULL) = (content_type IS NULL)) AND ((storage_key IS NULL) = (file_sha256 IS NULL)) AND ((storage_key IS NULL) = (file_size_bytes IS NULL))))`
- `export_job_idempotency_key` (UNIQUE): `UNIQUE (requested_by, idempotency_key)`
- `export_job_requester_creates` (CHECK): `CHECK ((created_by = requested_by))`
- `export_job_snapshot_fkey` (FK): `FOREIGN KEY (transformation_id, snapshot_id) REFERENCES report_snapshot(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `export_job_storage_key_key` (UNIQUE): `UNIQUE (storage_key)`
- `export_job_times` (CHECK): `CHECK ((((status <> ALL (ARRAY['running', 'succeeded'])) OR (started_at IS NOT NULL)) AND ((status = ANY (ARRAY['succeeded', 'failed', 'cancelled'])) = (finished_at IS NOT NULL)) AND ((finished_at IS NULL) OR (started_at IS NULL) OR (finished_at >= started_at))))`

**Indexes:**

- `export_job_requester_idx`: `(requested_by, created_at DESC, id DESC)`

**Triggers:**

- `export_job_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `export_job_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `export_job_guard()`
- `export_job_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## export_job_progress

- **Purpose:** The progress of an export job: stage, percent and sections (REQ-S13-005 'async job with progress'; ADR-0046 §5).
- **Migration:** `0081_p5_export_jobs.sql`. **API module:** `reporting`. **Who writes:** the API (created with the job), the worker (forward only). **Lifecycle:** queued → loading → rendering → storing → done; forward only; versioned; no audit event.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| export_job_id | uuid | NOT NULL |  | FK → export_job(id); PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| stage | text | NOT NULL | `'queued'` | `CHECK ((stage = ANY (ARRAY['queued', 'loading', 'rendering', 'storing', 'done'])))` |
| percent | smallint | NOT NULL | `0` | `CHECK (((percent >= 0) AND (percent <= 100)))` |
| sections_done | integer | NOT NULL | `0` | `CHECK ((sections_done >= 0))` |
| sections_total | integer | NULL |  | `CHECK (((sections_total IS NULL) OR (sections_total >= 0)))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `export_job_progress_done` (CHECK): `CHECK (((stage = 'done') = (percent = 100)))`
- `export_job_progress_sections` (CHECK): `CHECK (((sections_total IS NULL) OR (sections_done <= sections_total)))`

**Triggers:**

- `export_job_progress_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `export_job_progress_guard()`
- `export_job_progress_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

