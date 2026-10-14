qa disposable cluster: PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0, 64-bit; server_encoding UTF8, lc_collate C, lc_ctype C
## guiding_question

- **Purpose:** The four B0016 guiding questions, English verbatim, Arabic provisional (REQ-PB-011; ADR-0049 §2).
- **Migration:** `0089_p5_reader_provenance_branding.sql`. **API module:** `methodology`. **Who writes:** migrations only. **Lifecycle:** seeded catalogue (4 rows); append-only.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| code | text | NOT NULL |  | `CHECK ((code = ANY (ARRAY['why_change', 'what_different', 'how_execute', 'how_prove_value'])))`; PK |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 4)))` |
| text_en | text | NOT NULL |  | `CHECK (((char_length(text_en) >= 1) AND (char_length(text_en) <= 100)))` |
| text_ar | text | NOT NULL |  | `CHECK (((char_length(text_ar) >= 1) AND (char_length(text_ar) <= 200)))` |
| source_ref | text | NOT NULL |  | `CHECK ((source_ref = 'B0016'))` |

**Table constraints:**

- `guiding_question_ordinal_key` (UNIQUE): `UNIQUE (ordinal)`

**Triggers:**

- `guiding_question_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `guiding_question_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

## playbook_block

- **Purpose:** The 165 blocks of the playbook v1.0 (B0001-B0165): English verbatim from docs/source/playbook.md, provisional Arabic, section and phase, and the stored English and Arabic full-text vectors (REQ-S03-010, REQ-PB-001; ADR-0049 §1, §3).
- **Migration:** `0089_p5_reader_provenance_branding.sql`. **API module:** `methodology`. **Who writes:** migrations only (BE-Q's 0092 seed; later Arabic corrections). **Lifecycle:** seeded catalogue (165 rows); verbatim text, position and section immutable; only text_ar/ar_provisional correctable; never deleted.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| block_ref | text | NOT NULL |  | `CHECK (((block_ref ~ '^B0[0-9]{3}$') AND (((SUBSTRING(block_ref FROM 2))::integer >= 1) AND ((SUBSTRING(block_ref FROM 2))::integer <= 165))))`; PK |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 165)))` |
| block_kind | text | NOT NULL |  | `CHECK ((block_kind = ANY (ARRAY['text', 'table'])))` |
| is_heading | boolean | NOT NULL | `false` |  |
| section_block_ref | text | NULL |  | FK → playbook_block(block_ref) |
| phase_code | text | NULL |  | FK → phase_definition(code) |
| text_en | text | NOT NULL |  | `CHECK (((char_length(text_en) >= 1) AND (char_length(text_en) <= 20000)))` |
| text_ar | text | NOT NULL |  | `CHECK (((char_length(text_ar) >= 1) AND (char_length(text_ar) <= 40000)))` |
| ar_provisional | boolean | NOT NULL | `true` |  |
| source_document | text | NOT NULL | `'docs/source/playbook.md'` | `CHECK ((source_document = 'docs/source/playbook.md'))` |
| search_en | tsvector | NULL | `to_tsvector('english'::regconfig, text_en)` |  |
| search_ar | tsvector | NULL | `to_tsvector('arabic'::regconfig, text_ar)` |  |

**Table constraints:**

- `playbook_block_ordinal_key` (UNIQUE): `UNIQUE (ordinal)`
- `playbook_block_ordinal_matches` (CHECK): `CHECK ((ordinal = (SUBSTRING(block_ref FROM 2))::integer))`
- `playbook_block_section_before` (CHECK): `CHECK (((section_block_ref IS NULL) OR (section_block_ref < block_ref)))`

**Indexes:**

- `playbook_block_phase_idx`: `(phase_code, ordinal)`
- `playbook_block_search_ar_idx`: `CREATE INDEX playbook_block_search_ar_idx ON public.playbook_block USING gin (search_ar)`
- `playbook_block_search_en_idx`: `CREATE INDEX playbook_block_search_en_idx ON public.playbook_block USING gin (search_en)`

**Triggers:**

- `playbook_block_guard`: BEFORE DELETE OR UPDATE FOR EACH ROW → `playbook_block_guard()`
- `playbook_block_guard_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `playbook_block_guard()`

## playbook_block_link

- **Purpose:** A seeded link of a block to the template (form), procedure or requirement ID that implements it (REQ-S02-004; ADR-0049 §4).
- **Migration:** `0089_p5_reader_provenance_branding.sql`. **API module:** `methodology`. **Who writes:** migrations only (BE-Q's 0092 seed); version additions/removals are Studio methodology_text elements. **Lifecycle:** seeded catalogue; append-only.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| block_ref | text | NOT NULL |  | FK → playbook_block(block_ref) |
| target_kind | text | NOT NULL |  | `CHECK ((target_kind = ANY (ARRAY['template', 'procedure', 'requirement'])))` |
| target_key | text | NOT NULL |  | `CHECK (((char_length(target_key) >= 1) AND (char_length(target_key) <= 100)))` |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 99)))` |

**Table constraints:**

- `playbook_block_link_ordinal_key` (UNIQUE): `UNIQUE (block_ref, ordinal)`
- `playbook_block_link_pkey` (PK): `PRIMARY KEY (block_ref, target_kind, target_key)`
- `playbook_block_link_target_shape` (CHECK): `CHECK (
CASE target_kind
    WHEN 'template' THEN (target_key ~ '^T(0[1-9]|1[0-6])$')
    WHEN 'requirement' THEN (target_key ~ '^REQ-[A-Z0-9]+-[0-9]{3}$')
    ELSE (target_key ~ '^[a-z][a-z0-9_]{0,62}$')
END)`

**Indexes:**

- `playbook_block_link_target_idx`: `(target_kind, target_key)`

**Triggers:**

- `playbook_block_link_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `playbook_block_link_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

## source_foundation

- **Purpose:** The B0156 source-foundations table (Source / Used for), verbatim, shown read-only in the reader (REQ-PB-001; ADR-0049 §5).
- **Migration:** `0089_p5_reader_provenance_branding.sql`. **API module:** `methodology`. **Who writes:** migrations only. **Lifecycle:** seeded catalogue (3 rows); append-only.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| code | text | NOT NULL |  | `CHECK ((code = ANY (ARRAY['pmi_organizational_transformation', 'brightline_transformation_compass', 'pmi_benefits_realization_management'])))`; PK |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 3)))` |
| source_en | text | NOT NULL |  | `CHECK (((char_length(source_en) >= 1) AND (char_length(source_en) <= 200)))` |
| source_ar | text | NOT NULL |  | `CHECK (((char_length(source_ar) >= 1) AND (char_length(source_ar) <= 300)))` |
| used_for_en | text | NOT NULL |  | `CHECK (((char_length(used_for_en) >= 1) AND (char_length(used_for_en) <= 500)))` |
| used_for_ar | text | NOT NULL |  | `CHECK (((char_length(used_for_ar) >= 1) AND (char_length(used_for_ar) <= 800)))` |
| source_ref | text | NOT NULL |  | `CHECK ((source_ref = 'B0156'))` |

**Table constraints:**

- `source_foundation_ordinal_key` (UNIQUE): `UNIQUE (ordinal)`

**Triggers:**

- `source_foundation_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `source_foundation_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

## methodology_element_profile

- **Purpose:** The default provenance (custom_extension per B0158-B0162, foundation_inspired per B0156) and, for templates, the one guiding-question tag of every seeded methodology element (REQ-PB-002, REQ-PB-011; ADR-0049 §2).
- **Migration:** `0089_p5_reader_provenance_branding.sql`. **API module:** `methodology`. **Who writes:** migrations only; version overrides are Studio methodology_text elements 'profile.<element_ref>'. **Lifecycle:** seeded catalogue (56 rows); append-only.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| element_ref | text | NOT NULL |  | PK |
| element_kind | text | NOT NULL |  | `CHECK ((element_kind = ANY (ARRAY['phase', 'gate', 'tom_dimension', 'template', 'scoring_model', 'forum', 'launch_window', 'health_check', 'roaming_example', 'traceability_chain', 'benefit_lifecycle_step'])))` |
| stable_key | text | NOT NULL |  | `CHECK ((stable_key ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$'))` |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 99)))` |
| source_element_id | uuid | NULL |  | FK → source_element(id) |
| label_en | text | NULL |  | `CHECK (((label_en IS NULL) OR ((char_length(label_en) >= 1) AND (char_length(label_en) <= 300))))` |
| label_ar | text | NULL |  | `CHECK (((label_ar IS NULL) OR ((char_length(label_ar) >= 1) AND (char_length(label_ar) <= 300))))` |
| provenance | text | NOT NULL |  | `CHECK ((provenance = ANY (ARRAY['custom_extension', 'foundation_inspired'])))` |
| provenance_source_ref | text | NOT NULL |  | `CHECK ((provenance_source_ref = ANY (ARRAY['B0156', 'B0158', 'B0159', 'B0160', 'B0161', 'B0162'])))` |
| question_tag | text | NULL |  | FK → guiding_question(code) |
| source_refs | text[] | NOT NULL |  | `CHECK (((cardinality(source_refs) >= 1) AND (cardinality(source_refs) <= 10)))` |

**Table constraints:**

- `methodology_element_profile_kind_ordinal_key` (UNIQUE): `UNIQUE (element_kind, ordinal)`
- `methodology_element_profile_kind_source` (CHECK): `CHECK ((provenance_source_ref =
CASE element_kind
    WHEN 'phase' THEN 'B0158'
    WHEN 'tom_dimension' THEN 'B0159'
    WHEN 'gate' THEN 'B0160'
    WHEN 'template' THEN 'B0160'
    WHEN 'benefit_lifecycle_step' THEN 'B0156'
    WHEN 'roaming_example' THEN 'B0162'
    WHEN 'traceability_chain' THEN 'B0162'
    ELSE 'B0161'
END))`
- `methodology_element_profile_label` (CHECK): `CHECK ((((source_element_id IS NULL) = ((label_en IS NOT NULL) AND (label_ar IS NOT NULL))) AND ((label_en IS NULL) = (label_ar IS NULL))))`
- `methodology_element_profile_provenance` (CHECK): `CHECK (((provenance = 'foundation_inspired') = (provenance_source_ref = 'B0156')))`
- `methodology_element_profile_question_tag` (CHECK): `CHECK (((element_kind = 'template') = (question_tag IS NOT NULL)))`
- `methodology_element_profile_ref` (CHECK): `CHECK ((element_ref = ((element_kind || '.') || stable_key)))`
- `methodology_element_profile_source_refs` (CHECK): `CHECK ((array_to_string(source_refs, ',') ~ '^B0(00[1-9]|0[1-9][0-9]|1[0-5][0-9]|16[0-5])(,B0(00[1-9]|0[1-9][0-9]|1[0-5][0-9]|16[0-5]))*$'))`

**Triggers:**

- `methodology_element_profile_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `methodology_element_profile_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `methodology_element_profile_guard`: BEFORE INSERT FOR EACH ROW → `methodology_element_profile_guard()`

## branding_version

- **Purpose:** One immutable branding version of an organization: product name (en, ar), primary and secondary colours with their provisional flag and approval reference, bundled fonts, PNG logo, report header and footer (REQ-S15-004, REQ-S01-002; ADR-0049 §8).
- **Migration:** `0089_p5_reader_provenance_branding.sql`. **API module:** `admin`. **Who writes:** `branding.configure` (ADM_TECH) through putBrandingSettings. **Lifecycle:** append-only; numbered 1, 2, … per organization under lock 730270.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| version_no | integer | NOT NULL |  | `CHECK ((version_no >= 1))` |
| product_name_en | text | NOT NULL |  | `CHECK (((char_length(product_name_en) >= 1) AND (char_length(product_name_en) <= 80)))` |
| product_name_ar | text | NOT NULL |  | `CHECK (((char_length(product_name_ar) >= 1) AND (char_length(product_name_ar) <= 80)))` |
| primary_colour | text | NOT NULL |  | `CHECK ((primary_colour ~ '^#[0-9A-F]{6}$'))` |
| secondary_colour | text | NOT NULL |  | `CHECK ((secondary_colour ~ '^#[0-9A-F]{6}$'))` |
| colours_provisional | boolean | NOT NULL |  |  |
| colour_approval_reference | text | NULL |  | `CHECK (((colour_approval_reference IS NULL) OR ((char_length(colour_approval_reference) >= 1) AND (char_length(colour_approval_reference) <= 300))))` |
| font_latin | text | NOT NULL |  | `CHECK ((font_latin = 'IBM Plex Sans'))` |
| font_arabic | text | NOT NULL |  | `CHECK ((font_arabic = 'IBM Plex Sans Arabic'))` |
| logo_png | bytea | NULL |  | `CHECK (((logo_png IS NULL) OR (((octet_length(logo_png) >= 67) AND (octet_length(logo_png) <= 262144)) AND (SUBSTRING(logo_png FROM 1 FOR 8) = '\x89504e470d0a1a0a'::bytea))))` |
| logo_sha256 | text | NULL |  | `CHECK (((logo_sha256 IS NULL) OR (logo_sha256 ~ '^[0-9a-f]{64}$')))` |
| logo_alt_en | text | NULL |  | `CHECK (((logo_alt_en IS NULL) OR ((char_length(logo_alt_en) >= 1) AND (char_length(logo_alt_en) <= 200))))` |
| logo_alt_ar | text | NULL |  | `CHECK (((logo_alt_ar IS NULL) OR ((char_length(logo_alt_ar) >= 1) AND (char_length(logo_alt_ar) <= 200))))` |
| report_header_en | text | NULL |  | `CHECK (((report_header_en IS NULL) OR ((char_length(report_header_en) >= 1) AND (char_length(report_header_en) <= 300))))` |
| report_header_ar | text | NULL |  | `CHECK (((report_header_ar IS NULL) OR ((char_length(report_header_ar) >= 1) AND (char_length(report_header_ar) <= 300))))` |
| report_footer_en | text | NULL |  | `CHECK (((report_footer_en IS NULL) OR ((char_length(report_footer_en) >= 1) AND (char_length(report_footer_en) <= 300))))` |
| report_footer_ar | text | NULL |  | `CHECK (((report_footer_ar IS NULL) OR ((char_length(report_footer_ar) >= 1) AND (char_length(report_footer_ar) <= 300))))` |
| change_note | text | NULL |  | `CHECK (((change_note IS NULL) OR ((char_length(change_note) >= 1) AND (char_length(change_note) <= 1000))))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `branding_version_colour_approval` (CHECK): `CHECK ((colours_provisional = (colour_approval_reference IS NULL)))`
- `branding_version_footer_pair` (CHECK): `CHECK (((report_footer_en IS NULL) = (report_footer_ar IS NULL)))`
- `branding_version_header_pair` (CHECK): `CHECK (((report_header_en IS NULL) = (report_header_ar IS NULL)))`
- `branding_version_logo_complete` (CHECK): `CHECK ((((logo_png IS NULL) = (logo_sha256 IS NULL)) AND ((logo_png IS NULL) = (logo_alt_en IS NULL)) AND ((logo_png IS NULL) = (logo_alt_ar IS NULL)) AND ((logo_png IS NULL) OR (logo_sha256 = encode(sha256(logo_png), 'hex')))))`
- `branding_version_no_engineering_gate` (CHECK): `CHECK ((NOT (p5_mentions_engineering_gate(product_name_en) OR p5_mentions_engineering_gate(product_name_ar) OR p5_mentions_engineering_gate(report_header_en) OR p5_mentions_engineering_gate(report_header_ar) OR p5_mentions_engineering_gate(report_footer_en) OR p5_mentions_engineering_gate(report_footer_ar))))`
- `branding_version_no_pmi_claim` (CHECK): `CHECK ((NOT (p5_claims_official_pmi(product_name_en) OR p5_claims_official_pmi(product_name_ar) OR p5_claims_official_pmi(report_header_en) OR p5_claims_official_pmi(report_header_ar) OR p5_claims_official_pmi(report_footer_en) OR p5_claims_official_pmi(report_footer_ar))))`
- `branding_version_organization_version_key` (UNIQUE): `UNIQUE (organization_id, version_no)`

**Triggers:**

- `branding_version_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `branding_version_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `branding_version_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `branding_version_guard`: BEFORE INSERT FOR EACH ROW → `branding_version_guard()`
- `branding_version_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## branding_setting

- **Purpose:** The organization's branding head row naming its current (latest) branding version; its version is the If-Match of putBrandingSettings (ADR-0049 §8).
- **Migration:** `0089_p5_reader_provenance_branding.sql`. **API module:** `admin`. **Who writes:** `branding.configure`. **Lifecycle:** one per organization, created on the first save; current_version_no = version = the latest branding version; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| current_version_no | integer | NOT NULL |  | `CHECK ((current_version_no >= 1))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `branding_setting_current_fkey` (FK): `FOREIGN KEY (organization_id, current_version_no) REFERENCES branding_version(organization_id, version_no) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `branding_setting_organization_key` (UNIQUE): `UNIQUE (organization_id)`
- `branding_setting_version_matches` (CHECK): `CHECK ((current_version_no = version))`

**Triggers:**

- `branding_setting_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `branding_setting_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `branding_setting_guard()`
- `branding_setting_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## deployment_environment

- **Purpose:** The environment marker of this database: production (bootstrap) or demo (seed-demo, with dataset, version and synthetic clock) (REQ-S18-001, REQ-S18-003; ADR-0050 §1).
- **Migration:** `0090_p5_demo_environment_walkthrough.sql`. **API module:** `admin`. **Who writes:** the initializing CLI command (owner) only. **Lifecycle:** at most one row, written once; append-only (a production database never becomes a demo database).
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| singleton | boolean | NOT NULL | `true` | PK; `CHECK (singleton)` |
| environment_kind | text | NOT NULL |  | `CHECK ((environment_kind = ANY (ARRAY['production', 'demo'])))` |
| initialized_via | text | NOT NULL |  | `CHECK ((initialized_via = ANY (ARRAY['bootstrap', 'seed_demo'])))` |
| dataset_code | text | NULL |  | `CHECK (((dataset_code IS NULL) OR (dataset_code = 'international_roaming')))` |
| dataset_version | text | NULL |  | `CHECK (((dataset_version IS NULL) OR (dataset_version ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$')))` |
| synthetic_clock_at | timestamp with time zone | NULL |  |  |
| initialized_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `deployment_environment_demo_dataset` (CHECK): `CHECK ((((environment_kind = 'demo') = ((dataset_code IS NOT NULL) AND (dataset_version IS NOT NULL) AND (synthetic_clock_at IS NOT NULL))) AND ((dataset_code IS NULL) = (dataset_version IS NULL)) AND ((dataset_code IS NULL) = (synthetic_clock_at IS NULL))))`
- `deployment_environment_kind_via` (CHECK): `CHECK (((environment_kind = 'demo') = (initialized_via = 'seed_demo')))`

**Triggers:**

- `deployment_environment_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `deployment_environment_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

## demo_seed_record

- **Purpose:** Every record the demo seed created, with its stable fixture key; read by the coverage check and the checksum (REQ-S18-001, REQ-S18-002; ADR-0050 §2, §4).
- **Migration:** `0090_p5_demo_environment_walkthrough.sql`. **API module:** `admin (demo)`. **Who writes:** the demo seed (owner) only; refused outside a demo database. **Lifecycle:** append-only; empty in production.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| record_type | text | NOT NULL |  | `CHECK ((record_type ~ '^[a-z][a-z0-9_]{0,62}$'))` |
| record_id | uuid | NOT NULL |  |  |
| fixture_key | text | NOT NULL |  | `CHECK ((fixture_key ~ '^[a-z0-9][a-z0-9_.-]{0,119}$'))` |

**Table constraints:**

- `demo_seed_record_fixture_key` (UNIQUE): `UNIQUE (fixture_key)`
- `demo_seed_record_pkey` (PK): `PRIMARY KEY (record_type, record_id)`

**Triggers:**

- `demo_seed_record_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `demo_seed_record_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `demo_seed_record_guard`: BEFORE INSERT FOR EACH ROW → `demo_seed_record_guard()`

## demo_dataset_run

- **Purpose:** The outcome of a demo seed or reset: record counts per table, the SHA-256 checksum, the seed coverage and who requested it (REQ-S18-001, REQ-S18-002; ADR-0050 §4-§6).
- **Migration:** `0090_p5_demo_environment_walkthrough.sql`. **API module:** `admin (demo)`. **Who writes:** the demo seed/reset (owner) only; only in a demo database. **Lifecycle:** append-only; numbered 1, 2, ….
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| run_no | integer | NOT NULL |  | `CHECK ((run_no >= 1))` |
| run_kind | text | NOT NULL |  | `CHECK ((run_kind = ANY (ARRAY['seed', 'reset'])))` |
| requested_via | text | NOT NULL |  | `CHECK ((requested_via = ANY (ARRAY['cli', 'api'])))` |
| requested_by | uuid | NULL |  |  |
| dataset_code | text | NOT NULL |  | `CHECK ((dataset_code = 'international_roaming'))` |
| dataset_version | text | NOT NULL |  | `CHECK ((dataset_version ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'))` |
| synthetic_clock_at | timestamp with time zone | NOT NULL |  |  |
| record_counts | jsonb | NOT NULL |  | `CHECK ((jsonb_typeof(record_counts) = 'object'))` |
| checksum_sha256 | text | NOT NULL |  | `CHECK ((checksum_sha256 ~ '^[0-9a-f]{64}$'))` |
| coverage | jsonb | NOT NULL |  | `CHECK ((jsonb_typeof(coverage) = 'object'))` |
| coverage_complete | boolean | NOT NULL |  |  |
| completed_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `demo_dataset_run_api_reset` (CHECK): `CHECK (((requested_via = 'cli') OR (run_kind = 'reset')))`
- `demo_dataset_run_requester` (CHECK): `CHECK (((requested_via = 'cli') OR (requested_by IS NOT NULL)))`
- `demo_dataset_run_run_no_key` (UNIQUE): `UNIQUE (run_no)`

**Triggers:**

- `demo_dataset_run_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `demo_dataset_run_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `demo_dataset_run_guard`: BEFORE INSERT FOR EACH ROW → `demo_dataset_run_guard()`

## walkthrough_step

- **Purpose:** The twelve M0349 steps of the guided walkthrough, verbatim titles, provisional Arabic, area and completion rule (REQ-S18-004; ADR-0050 §7).
- **Migration:** `0090_p5_demo_environment_walkthrough.sql`. **API module:** `admin (demo)`. **Who writes:** migrations only. **Lifecycle:** seeded catalogue (12 rows); append-only.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| code | text | NOT NULL |  | `CHECK ((code ~ '^[a-z][a-z_]{0,47}$'))`; PK |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 12)))` |
| title_en | text | NOT NULL |  | `CHECK (((char_length(title_en) >= 1) AND (char_length(title_en) <= 100)))` |
| title_ar | text | NOT NULL |  | `CHECK (((char_length(title_ar) >= 1) AND (char_length(title_ar) <= 200)))` |
| area_code | text | NOT NULL |  | `CHECK ((area_code = ANY (ARRAY['my_work', 'executive_overview', 'transformations', 'playbook_procedures', 'strategy_kpis', 'target_operating_model', 'initiatives_roadmaps', 'governance', 'risks_actions', 'benefits_finance', 'change_adoption', 'evidence_reports', 'bau_improvement', 'administration'])))` |
| completion_rule | text | NOT NULL |  | `CHECK ((completion_rule ~ '^[a-z][a-z_]{0,63}$'))` |
| source_ref | text | NOT NULL |  | `CHECK ((source_ref = 'M0349'))` |

**Table constraints:**

- `walkthrough_step_completion_rule_key` (UNIQUE): `UNIQUE (completion_rule)`
- `walkthrough_step_ordinal_key` (UNIQUE): `UNIQUE (ordinal)`

**Triggers:**

- `walkthrough_step_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `walkthrough_step_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

