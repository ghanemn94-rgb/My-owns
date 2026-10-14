qa disposable cluster: PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0, 64-bit; server_encoding UTF8, lc_collate C, lc_ctype C
## form_record_type

- **Purpose:** The native forms (ADR-0041 §1): 15 templates (T10 is the dashboard read model), 3 source deliverables, the 12 M0149 extension record types (extension badge) and 3 product records, with the typed table, write permission, extension-field and bulk-edit flags and feature status (REQ-S05-001, REQ-S05-006).
- **Migration:** `0068_p5_form_schemas_framework.sql`. **API module:** `forms`. **Who writes:** migrations only. **Lifecycle:** seeded catalogue.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| code | text | NOT NULL |  | `CHECK ((code ~ '^[a-z][a-z0-9_]{1,39}$|^T(0[1-9]|1[0-6])$'))`; PK |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 99)))` |
| kind | text | NOT NULL |  | `CHECK ((kind = ANY (ARRAY['template', 'source_deliverable', 'extension', 'product'])))` |
| title_en | text | NOT NULL |  | `CHECK (((char_length(title_en) >= 1) AND (char_length(title_en) <= 200)))` |
| title_ar | text | NOT NULL |  | `CHECK (((char_length(title_ar) >= 1) AND (char_length(title_ar) <= 200)))` |
| source_ref | text | NOT NULL |  | `CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 50)))` |
| table_name | text | NULL |  | `CHECK (((table_name IS NULL) OR (table_name ~ '^[a-z][a-z0-9_]{1,62}$')))` |
| discriminator_column | text | NULL |  | `CHECK (((discriminator_column IS NULL) OR (discriminator_column ~ '^[a-z][a-z0-9_]{1,62}$')))` |
| discriminator_value | text | NULL |  | `CHECK (((discriminator_value IS NULL) OR ((char_length(discriminator_value) >= 1) AND (char_length(discriminator_value) <= 50))))` |
| write_permission_code | text | NULL |  | FK → permission(code) |
| extension_badge | boolean | NOT NULL |  |  |
| custom_fields_allowed | boolean | NOT NULL |  |  |
| bulk_edit_allowed | boolean | NOT NULL |  |  |
| feature_status | text | NOT NULL |  | `CHECK ((feature_status = ANY (ARRAY['working', 'planned'])))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `form_record_type_badge_is_extension` (CHECK): `CHECK ((extension_badge = (kind = 'extension')))`
- `form_record_type_discriminator_complete` (CHECK): `CHECK (((discriminator_column IS NULL) = (discriminator_value IS NULL)))`
- `form_record_type_ordinal_key` (UNIQUE): `UNIQUE (ordinal)`
- `form_record_type_storage_complete` (CHECK): `CHECK ((((table_name IS NULL) = (feature_status = 'planned')) AND ((table_name IS NOT NULL) OR (NOT custom_fields_allowed)) AND ((NOT custom_fields_allowed) OR (write_permission_code IS NOT NULL))))`
- `form_record_type_template_code` (CHECK): `CHECK (((kind = 'template') = (code ~ '^T(0[1-9]|1[0-6])$')))`

## form_source_field

- **Purpose:** The protected source columns (REQ-S05-002): one row per minimum field of M0129–M0144, verbatim English label, provisional Arabic label, fixed Studio field type and storage reference (ADR-0041 §2).
- **Migration:** `0068_p5_form_schemas_framework.sql`. **API module:** `forms`. **Who writes:** migrations only. **Lifecycle:** seeded catalogue.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| record_type | text | NOT NULL |  | FK → form_record_type(code) |
| field_key | text | NOT NULL |  | `CHECK ((field_key ~ '^[a-z][a-z0-9_]{0,39}$'))` |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 99)))` |
| label_en | text | NOT NULL |  | `CHECK (((char_length(label_en) >= 1) AND (char_length(label_en) <= 200)))` |
| label_ar | text | NOT NULL |  | `CHECK (((char_length(label_ar) >= 1) AND (char_length(label_ar) <= 200)))` |
| field_type | text | NOT NULL |  | `CHECK ((field_type = ANY (ARRAY['text', 'rich_text', 'number', 'currency', 'percentage', 'date', 'reference', 'attachment', 'lookup', 'choice', 'calculated'])))` |
| storage_kind | text | NOT NULL |  | `CHECK ((storage_kind = ANY (ARRAY['column', 'composite', 'computed'])))` |
| storage_ref | text | NOT NULL |  | `CHECK (((char_length(storage_ref) >= 1) AND (char_length(storage_ref) <= 200)))` |
| bulk_editable | boolean | NOT NULL | `false` |  |
| source_ref | text | NOT NULL |  | `CHECK ((source_ref ~ '^M01(29|3[0-9]|4[0-4])$'))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `form_source_field_bulk_column` (CHECK): `CHECK (((NOT bulk_editable) OR (storage_kind = 'column')))`
- `form_source_field_column_ref` (CHECK): `CHECK (((storage_kind <> 'column') OR (storage_ref ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')))`
- `form_source_field_key` (UNIQUE): `UNIQUE (record_type, field_key)`
- `form_source_field_ordinal_key` (UNIQUE): `UNIQUE (record_type, ordinal)`

## form_custom_value

- **Purpose:** The extension-field values of one record, validated against the form_schema version the transformation is pinned to (REQ-S16-010, REQ-S06-005; ADR-0041 §4); decimals as strings, percentages as fractions, currency as amount + code.
- **Migration:** `0068_p5_form_schemas_framework.sql`. **API module:** `forms`. **Who writes:** the record type's write permission (`form_record_type.write_permission_code`). **Lifecycle:** one row per record; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| record_type | text | NOT NULL |  | FK → form_record_type(code) |
| record_id | uuid | NOT NULL |  |  |
| form_schema_version_id | uuid | NOT NULL |  | FK → methodology_version(id) |
| field_values | jsonb | NOT NULL | `'{}'::jsonb` | `CHECK ((jsonb_typeof(field_values) = 'object'))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `form_custom_value_record_key` (UNIQUE): `UNIQUE (record_type, record_id)`
- `form_custom_value_size` (CHECK): `CHECK ((pg_column_size(field_values) <= 65536))`

**Indexes:**

- `form_custom_value_transformation_idx`: `(transformation_id, record_type)`

**Triggers:**

- `form_custom_value_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `form_custom_value_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `form_custom_value_guard()`
- `form_custom_value_record_ref`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p5_form_record_ref_guard()`
- `form_custom_value_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## form_draft

- **Purpose:** A saved, not yet submitted form of one user (REQ-S05-001 draft saving; ADR-0041 §5).
- **Migration:** `0068_p5_form_schemas_framework.sql`. **API module:** `forms`. **Who writes:** the record type's write permission (owner only). **Lifecycle:** open → closed (saved | discarded); versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| record_type | text | NOT NULL |  | FK → form_record_type(code) |
| record_id | uuid | NULL |  |  |
| base_record_version | integer | NULL |  | `CHECK (((base_record_version IS NULL) OR (base_record_version >= 1)))` |
| owner_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| payload | jsonb | NOT NULL |  | `CHECK (((jsonb_typeof(payload) = 'object') AND (pg_column_size(payload) <= 262144)))` |
| status | text | NOT NULL | `'open'` | `CHECK ((status = ANY (ARRAY['open', 'closed'])))` |
| closed_reason | text | NULL |  | `CHECK (((closed_reason IS NULL) OR (closed_reason = ANY (ARRAY['saved', 'discarded']))))` |
| closed_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `form_draft_base_version` (CHECK): `CHECK (((record_id IS NULL) = (base_record_version IS NULL)))`
- `form_draft_closed_complete` (CHECK): `CHECK ((((status = 'closed') = (closed_reason IS NOT NULL)) AND ((closed_reason IS NULL) = (closed_at IS NULL))))`
- `form_draft_owner_is_creator` (CHECK): `CHECK ((owner_user_id = created_by))`

**Indexes:**

- `form_draft_open_record_key`: `UNIQUE (owner_user_id, record_type, record_id) WHERE ((status = 'open') AND (record_id IS NOT NULL))`
- `form_draft_owner_idx`: `(owner_user_id, transformation_id, status, updated_at DESC)`

**Triggers:**

- `form_draft_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `form_draft_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `form_draft_guard()`
- `form_draft_record_ref`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p5_form_record_ref_guard()`
- `form_draft_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## form_record_comment

- **Purpose:** Comments on a record, one reply level (REQ-S05-001; ADR-0041 §5).
- **Migration:** `0068_p5_form_schemas_framework.sql`. **API module:** `forms`. **Who writes:** `form_record.comment`. **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| record_type | text | NOT NULL |  | FK → form_record_type(code) |
| record_id | uuid | NOT NULL |  |  |
| parent_comment_id | uuid | NULL |  | FK → form_record_comment(id) |
| body | text | NOT NULL |  | `CHECK (((char_length(body) >= 1) AND (char_length(body) <= 4000)))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Indexes:**

- `form_record_comment_record_idx`: `(record_type, record_id, created_at, id)`

**Triggers:**

- `form_record_comment_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `form_record_comment_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `form_record_comment_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `form_record_comment_parent`: BEFORE INSERT FOR EACH ROW → `form_record_comment_parent()`
- `form_record_comment_record_ref`: BEFORE INSERT FOR EACH ROW → `p5_form_record_ref_guard()`
- `form_record_comment_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## form_record_attachment

- **Purpose:** Evidence attached to a record of a type the DG2 evidence_link does not cover (REQ-S05-001; ADR-0041 §5); one attachment place per record type.
- **Migration:** `0068_p5_form_schemas_framework.sql`. **API module:** `forms`. **Who writes:** the record type's write permission. **Lifecycle:** active → removed; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| record_type | text | NOT NULL |  | FK → form_record_type(code) |
| record_id | uuid | NOT NULL |  |  |
| evidence_id | uuid | NOT NULL |  |  |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'removed'])))` |
| removed_at | timestamp with time zone | NULL |  |  |
| removed_by | uuid | NULL |  | FK → app_user(id) |
| remove_reason | text | NULL |  | `CHECK (((remove_reason IS NULL) OR ((char_length(remove_reason) >= 3) AND (char_length(remove_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `form_record_attachment_evidence_fkey` (FK): `FOREIGN KEY (transformation_id, evidence_id) REFERENCES evidence(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `form_record_attachment_removal_complete` (CHECK): `CHECK ((((status = 'removed') = (removed_at IS NOT NULL)) AND ((removed_at IS NULL) = (removed_by IS NULL)) AND ((removed_at IS NULL) = (remove_reason IS NULL))))`

**Indexes:**

- `form_record_attachment_active_key`: `UNIQUE (evidence_id, record_type, record_id) WHERE (status = 'active')`
- `form_record_attachment_record_idx`: `(record_type, record_id) WHERE (status = 'active')`

**Triggers:**

- `form_record_attachment_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `form_record_attachment_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `form_record_attachment_guard()`
- `form_record_attachment_record_ref`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p5_form_record_ref_guard()`
- `form_record_attachment_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## procedure_definition

- **Purpose:** One procedure in one version of the 'procedures' configuration with every M0152 part (REQ-S06-001, REQ-S16-015; ADR-0042 §1); the ten seeded procedures are product defaults (REQ-S06-003).
- **Migration:** `0069_p5_procedures.sql`. **API module:** `procedures`. **Who writes:** `methodology.configure` (drafts only); seeds by migration. **Lifecycle:** written only while its version is a draft being edited; frozen with the version; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| methodology_version_id | uuid | NOT NULL |  | FK → methodology_version(id) |
| code | text | NOT NULL |  | `CHECK ((code ~ '^[a-z][a-z0-9_]{2,47}$'))` |
| origin | text | NOT NULL |  | `CHECK ((origin = ANY (ARRAY['source', 'admin'])))` |
| removed | boolean | NOT NULL | `false` |  |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 999)))` |
| name_en | text | NOT NULL |  | `CHECK (((char_length(name_en) >= 1) AND (char_length(name_en) <= 200)))` |
| name_ar | text | NOT NULL |  | `CHECK (((char_length(name_ar) >= 1) AND (char_length(name_ar) <= 200)))` |
| purpose_en | text | NOT NULL |  | `CHECK (((char_length(purpose_en) >= 1) AND (char_length(purpose_en) <= 2000)))` |
| purpose_ar | text | NOT NULL |  | `CHECK (((char_length(purpose_ar) >= 1) AND (char_length(purpose_ar) <= 2000)))` |
| trigger_kind | text | NOT NULL |  | `CHECK ((trigger_kind = ANY (ARRAY['manual', 'event', 'schedule'])))` |
| trigger_event | text | NULL |  | `CHECK (((trigger_event IS NULL) OR (trigger_event ~ '^[a-z_]+\.[a-z_.]+$')))` |
| trigger_en | text | NOT NULL |  | `CHECK (((char_length(trigger_en) >= 1) AND (char_length(trigger_en) <= 1000)))` |
| trigger_ar | text | NOT NULL |  | `CHECK (((char_length(trigger_ar) >= 1) AND (char_length(trigger_ar) <= 1000)))` |
| scope_level | text | NOT NULL |  | `CHECK ((scope_level = ANY (ARRAY['organization', 'transformation'])))` |
| scope_en | text | NOT NULL |  | `CHECK (((char_length(scope_en) >= 1) AND (char_length(scope_en) <= 1000)))` |
| scope_ar | text | NOT NULL |  | `CHECK (((char_length(scope_ar) >= 1) AND (char_length(scope_ar) <= 1000)))` |
| prerequisites_en | text | NULL |  | `CHECK (((prerequisites_en IS NULL) OR ((char_length(prerequisites_en) >= 1) AND (char_length(prerequisites_en) <= 2000))))` |
| prerequisites_ar | text | NULL |  | `CHECK (((prerequisites_ar IS NULL) OR ((char_length(prerequisites_ar) >= 1) AND (char_length(prerequisites_ar) <= 2000))))` |
| input_schema | jsonb | NOT NULL | `'[]'::jsonb` | `CHECK (((jsonb_typeof(input_schema) = 'array') AND (jsonb_array_length(input_schema) <= 50)))` |
| launch_role_codes | text[] | NOT NULL |  | `CHECK (((cardinality(launch_role_codes) >= 1) AND (cardinality(launch_role_codes) <= 14)))` |
| responsible_role_codes | text[] | NOT NULL |  | `CHECK (((cardinality(responsible_role_codes) >= 1) AND (cardinality(responsible_role_codes) <= 14)))` |
| sla_working_days | smallint | NOT NULL |  | `CHECK (((sla_working_days >= 1) AND (sla_working_days <= 250)))` |
| validation_rules_en | text | NOT NULL |  | `CHECK (((char_length(validation_rules_en) >= 1) AND (char_length(validation_rules_en) <= 2000)))` |
| validation_rules_ar | text | NOT NULL |  | `CHECK (((char_length(validation_rules_ar) >= 1) AND (char_length(validation_rules_ar) <= 2000)))` |
| approval_mode | text | NOT NULL |  | `CHECK ((approval_mode = ANY (ARRAY['none', 'any', 'sequential', 'parallel'])))` |
| approval_role_codes | text[] | NOT NULL | `'{}'[]` | `CHECK ((cardinality(approval_role_codes) <= 6))` |
| escalation_role_code | text | NULL |  | FK → role(code) |
| escalation_after_working_days | smallint | NULL |  | `CHECK (((escalation_after_working_days IS NULL) OR ((escalation_after_working_days >= 1) AND (escalation_after_working_days <= 250))))` |
| expected_outputs_en | text | NOT NULL |  | `CHECK (((char_length(expected_outputs_en) >= 1) AND (char_length(expected_outputs_en) <= 2000)))` |
| expected_outputs_ar | text | NOT NULL |  | `CHECK (((char_length(expected_outputs_ar) >= 1) AND (char_length(expected_outputs_ar) <= 2000)))` |
| completion_rule | text | NOT NULL |  | `CHECK ((completion_rule = ANY (ARRAY['all_steps_closed', 'all_steps_closed_and_outputs_linked'])))` |
| completion_en | text | NOT NULL |  | `CHECK (((char_length(completion_en) >= 1) AND (char_length(completion_en) <= 1000)))` |
| completion_ar | text | NOT NULL |  | `CHECK (((char_length(completion_ar) >= 1) AND (char_length(completion_ar) <= 1000)))` |
| exceptions_en | text | NULL |  | `CHECK (((exceptions_en IS NULL) OR ((char_length(exceptions_en) >= 1) AND (char_length(exceptions_en) <= 2000))))` |
| exceptions_ar | text | NULL |  | `CHECK (((exceptions_ar IS NULL) OR ((char_length(exceptions_ar) >= 1) AND (char_length(exceptions_ar) <= 2000))))` |
| effective_from | date | NOT NULL |  |  |
| source_ref | text | NULL |  | `CHECK (((source_ref IS NULL) OR ((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 50))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `procedure_definition_approval_complete` (CHECK): `CHECK (((approval_mode = 'none') = (cardinality(approval_role_codes) = 0)))`
- `procedure_definition_bilingual` (CHECK): `CHECK ((((prerequisites_en IS NULL) = (prerequisites_ar IS NULL)) AND ((exceptions_en IS NULL) = (exceptions_ar IS NULL))))`
- `procedure_definition_code_key` (UNIQUE): `UNIQUE (methodology_version_id, code)`
- `procedure_definition_escalation_complete` (CHECK): `CHECK (((escalation_role_code IS NULL) = (escalation_after_working_days IS NULL)))`
- `procedure_definition_id_version_key` (UNIQUE): `UNIQUE (id, methodology_version_id)`
- `procedure_definition_source_kept` (CHECK): `CHECK (((origin <> 'source') OR (NOT removed)))`
- `procedure_definition_trigger_event` (CHECK): `CHECK (((trigger_kind = 'event') = (trigger_event IS NOT NULL)))`

**Indexes:**

- `procedure_definition_version_idx`: `(methodology_version_id, ordinal)`

**Triggers:**

- `procedure_definition_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `procedure_definition_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `procedure_definition_guard()`
- `procedure_definition_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## procedure_step_definition

- **Purpose:** One step of a definition: ordered by ordinal, parallel by shared ordinal and group, conditional on an input, task or approval, with SLA, inputs, evidence and output (ADR-0042 §2).
- **Migration:** `0069_p5_procedures.sql`. **API module:** `procedures`. **Who writes:** `methodology.configure` (drafts only); seeds by migration. **Lifecycle:** as procedure_definition; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| procedure_definition_id | uuid | NOT NULL |  | FK → procedure_definition(id) |
| step_key | text | NOT NULL |  | `CHECK ((step_key ~ '^[a-z][a-z0-9_]{1,47}$'))` |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 99)))` |
| parallel_group | text | NULL |  | `CHECK (((parallel_group IS NULL) OR (parallel_group ~ '^[a-z][a-z0-9_]{0,31}$')))` |
| step_kind | text | NOT NULL |  | `CHECK ((step_kind = ANY (ARRAY['task', 'approval'])))` |
| name_en | text | NOT NULL |  | `CHECK (((char_length(name_en) >= 1) AND (char_length(name_en) <= 200)))` |
| name_ar | text | NOT NULL |  | `CHECK (((char_length(name_ar) >= 1) AND (char_length(name_ar) <= 200)))` |
| instructions_en | text | NULL |  | `CHECK (((instructions_en IS NULL) OR ((char_length(instructions_en) >= 1) AND (char_length(instructions_en) <= 2000))))` |
| instructions_ar | text | NULL |  | `CHECK (((instructions_ar IS NULL) OR ((char_length(instructions_ar) >= 1) AND (char_length(instructions_ar) <= 2000))))` |
| responsible_role_code | text | NOT NULL |  | FK → role(code) |
| approval_role_code | text | NULL |  | FK → role(code) |
| sla_working_days | smallint | NOT NULL |  | `CHECK (((sla_working_days >= 1) AND (sla_working_days <= 250)))` |
| condition_input_key | text | NULL |  | `CHECK (((condition_input_key IS NULL) OR (condition_input_key ~ '^[a-z][a-zA-Z0-9_]{0,39}$')))` |
| condition_operator | text | NULL |  | `CHECK (((condition_operator IS NULL) OR (condition_operator = ANY (ARRAY['eq', 'neq', 'in', 'gt', 'gte', 'lt', 'lte', 'present', 'absent']))))` |
| condition_value | jsonb | NULL |  |  |
| required_input_keys | text[] | NOT NULL | `'{}'[]` | `CHECK ((cardinality(required_input_keys) <= 50))` |
| evidence_required | boolean | NOT NULL | `false` |  |
| output_record_type | text | NULL |  | `CHECK (((output_record_type IS NULL) OR (output_record_type = ANY (ARRAY['transformation', 'charter', 'baseline', 'kpi_actual', 'tom_canvas_cell', 'approval', 'ranking_snapshot', 'gate_submission', 'change_request', 'finance_validation', 'decision', 'bau_handover', 'evidence']))))` |
| output_mode | text | NULL |  | `CHECK (((output_mode IS NULL) OR (output_mode = ANY (ARRAY['create', 'advance', 'link']))))` |
| skippable | boolean | NOT NULL | `false` |  |
| removed | boolean | NOT NULL | `false` |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `procedure_step_definition_approval_complete` (CHECK): `CHECK ((((step_kind = 'approval') = (approval_role_code IS NOT NULL)) AND ((step_kind <> 'approval') OR (NOT skippable))))`
- `procedure_step_definition_condition_complete` (CHECK): `CHECK ((((condition_input_key IS NULL) = (condition_operator IS NULL)) AND ((condition_operator IS NULL) OR (condition_operator = ANY (ARRAY['present', 'absent'])) OR (condition_value IS NOT NULL))))`
- `procedure_step_definition_key` (UNIQUE): `UNIQUE (procedure_definition_id, step_key)`
- `procedure_step_definition_output_complete` (CHECK): `CHECK (((output_record_type IS NULL) = (output_mode IS NULL)))`

**Indexes:**

- `procedure_step_definition_order_idx`: `(procedure_definition_id, ordinal)`

**Triggers:**

- `procedure_step_definition_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `procedure_step_definition_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `procedure_step_definition_guard()`
- `procedure_step_definition_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## procedure_instance

- **Purpose:** A launched procedure pinned to the exact published definition row (REQ-S06-002, REQ-S16-015; ADR-0042 §3).
- **Migration:** `0069_p5_procedures.sql`. **API module:** `procedures`. **Who writes:** `procedure.launch` (create), `procedure.act` (inputs), `procedure.manage` (cancel); completion by the step flow. **Lifecycle:** active → completed | cancelled; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NULL |  | FK → transformation(id) |
| procedure_definition_id | uuid | NOT NULL |  |  |
| methodology_version_id | uuid | NOT NULL |  |  |
| procedure_code | text | NOT NULL |  | `CHECK ((procedure_code ~ '^[a-z][a-z0-9_]{2,47}$'))` |
| status | text | NOT NULL | `'active'` | `CHECK ((status = ANY (ARRAY['active', 'completed', 'cancelled'])))` |
| subject_record_type | text | NULL |  | `CHECK (((subject_record_type IS NULL) OR (subject_record_type ~ '^[a-z][a-z0-9_]{1,62}$')))` |
| subject_record_id | uuid | NULL |  |  |
| input_values | jsonb | NOT NULL | `'{}'::jsonb` | `CHECK (((jsonb_typeof(input_values) = 'object') AND (pg_column_size(input_values) <= 65536)))` |
| due_date | date | NULL |  |  |
| launch_key | text | NULL |  | `CHECK (((launch_key IS NULL) OR ((char_length(launch_key) >= 1) AND (char_length(launch_key) <= 200))))` |
| launched_by | uuid | NOT NULL |  | FK → app_user(id) |
| launched_at | timestamp with time zone | NOT NULL | `now()` |  |
| completed_at | timestamp with time zone | NULL |  |  |
| cancelled_at | timestamp with time zone | NULL |  |  |
| cancelled_by | uuid | NULL |  | FK → app_user(id) |
| cancel_reason | text | NULL |  | `CHECK (((cancel_reason IS NULL) OR ((char_length(cancel_reason) >= 3) AND (char_length(cancel_reason) <= 2000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `procedure_instance_cancelled_complete` (CHECK): `CHECK ((((status = 'cancelled') = (cancelled_at IS NOT NULL)) AND ((cancelled_at IS NULL) = (cancelled_by IS NULL)) AND ((cancelled_at IS NULL) = (cancel_reason IS NULL))))`
- `procedure_instance_completed_complete` (CHECK): `CHECK (((status = 'completed') = (completed_at IS NOT NULL)))`
- `procedure_instance_definition_fkey` (FK): `FOREIGN KEY (procedure_definition_id, methodology_version_id) REFERENCES procedure_definition(id, methodology_version_id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `procedure_instance_launch_key` (UNIQUE): `UNIQUE (launch_key)`
- `procedure_instance_launcher` (CHECK): `CHECK ((launched_by = created_by))`
- `procedure_instance_subject_complete` (CHECK): `CHECK (((subject_record_type IS NULL) = (subject_record_id IS NULL)))`

**Indexes:**

- `procedure_instance_org_idx`: `(organization_id, status, launched_at DESC)`
- `procedure_instance_transformation_idx`: `(transformation_id, status, launched_at DESC)`

**Triggers:**

- `procedure_instance_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `procedure_instance_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `procedure_instance_guard()`
- `procedure_instance_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## procedure_step_instance

- **Purpose:** One step of an instance, copied from the pinned definition at launch: status, assignee, due date, completion, skip, approval (ADR-0042 §3-§4).
- **Migration:** `0069_p5_procedures.sql`. **API module:** `procedures`. **Who writes:** `procedure.act`, `procedure.manage`; the canonical approval decision for approval steps. **Lifecycle:** pending → active | not_applicable | cancelled; active → completed | skipped | cancelled; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NULL |  | FK → transformation(id) |
| procedure_instance_id | uuid | NOT NULL |  | FK → procedure_instance(id) |
| step_definition_id | uuid | NOT NULL |  | FK → procedure_step_definition(id) |
| step_key | text | NOT NULL |  | `CHECK ((step_key ~ '^[a-z][a-z0-9_]{1,47}$'))` |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 99)))` |
| status | text | NOT NULL | `'pending'` | `CHECK ((status = ANY (ARRAY['pending', 'active', 'completed', 'skipped', 'not_applicable', 'cancelled'])))` |
| assignee_role_code | text | NOT NULL |  | FK → role(code) |
| assignee_user_id | uuid | NULL |  | FK → app_user(id) |
| due_date | date | NULL |  |  |
| activated_at | timestamp with time zone | NULL |  |  |
| completed_at | timestamp with time zone | NULL |  |  |
| completed_by | uuid | NULL |  | FK → app_user(id) |
| skipped_by | uuid | NULL |  | FK → app_user(id) |
| skip_reason | text | NULL |  | `CHECK (((skip_reason IS NULL) OR ((char_length(skip_reason) >= 3) AND (char_length(skip_reason) <= 2000))))` |
| completion_note | text | NULL |  | `CHECK (((completion_note IS NULL) OR ((char_length(completion_note) >= 1) AND (char_length(completion_note) <= 4000))))` |
| approval_id | uuid | NULL |  | FK → approval(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `procedure_step_instance_activated` (CHECK): `CHECK (((status <> ALL (ARRAY['active', 'completed', 'skipped'])) OR (activated_at IS NOT NULL)))`
- `procedure_step_instance_completed_complete` (CHECK): `CHECK ((((status = 'completed') = (completed_at IS NOT NULL)) AND ((completed_at IS NULL) = (completed_by IS NULL))))`
- `procedure_step_instance_key` (UNIQUE): `UNIQUE (procedure_instance_id, step_key)`
- `procedure_step_instance_skipped_complete` (CHECK): `CHECK ((((status = 'skipped') = (skip_reason IS NOT NULL)) AND ((skip_reason IS NULL) = (skipped_by IS NULL))))`

**Indexes:**

- `procedure_step_instance_assignee_idx`: `(assignee_user_id, status, due_date)`
- `procedure_step_instance_instance_idx`: `(procedure_instance_id, ordinal)`

**Triggers:**

- `procedure_step_instance_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `procedure_step_instance_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `procedure_step_instance_guard()`
- `procedure_step_instance_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## procedure_instance_link

- **Purpose:** The real records an instance produced (output) or used (evidence) (REQ-S06-002 'outputs are real linked records'; ADR-0042 §3).
- **Migration:** `0069_p5_procedures.sql`. **API module:** `procedures`. **Who writes:** `procedure.act` (through the output adapters and evidence linking). **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NULL |  | FK → transformation(id) |
| procedure_instance_id | uuid | NOT NULL |  | FK → procedure_instance(id) |
| step_instance_id | uuid | NULL |  | FK → procedure_step_instance(id) |
| link_kind | text | NOT NULL |  | `CHECK ((link_kind = ANY (ARRAY['output', 'evidence'])))` |
| record_type | text | NOT NULL |  | `CHECK ((record_type = ANY (ARRAY['transformation', 'charter', 'baseline', 'kpi_actual', 'tom_canvas_cell', 'approval', 'ranking_snapshot', 'gate_submission', 'change_request', 'finance_validation', 'decision', 'bau_handover', 'evidence'])))` |
| record_id | uuid | NOT NULL |  |  |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `procedure_instance_link_evidence_kind` (CHECK): `CHECK (((link_kind <> 'evidence') OR (record_type = 'evidence')))`
- `procedure_instance_link_key` (UNIQUE): `UNIQUE (procedure_instance_id, link_kind, record_type, record_id)`

**Indexes:**

- `procedure_instance_link_record_idx`: `(record_type, record_id)`

**Triggers:**

- `procedure_instance_link_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `procedure_instance_link_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `procedure_instance_link_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `procedure_instance_link_guard`: BEFORE INSERT FOR EACH ROW → `procedure_instance_link_guard()`
- `procedure_instance_link_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## methodology_coverage_link

- **Purpose:** Which native forms and procedures implement each counted source element (REQ-S01-003; ADR-0042 §6).
- **Migration:** `0070_p5_forms_procedures_permissions_coverage.sql`. **API module:** `procedures`. **Who writes:** migrations only. **Lifecycle:** seeded catalogue.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| source_element_id | uuid | NOT NULL |  | FK → source_element(id) |
| target_kind | text | NOT NULL |  | `CHECK ((target_kind = ANY (ARRAY['form', 'procedure'])))` |
| target_code | text | NOT NULL |  | `CHECK ((target_code ~ '^[A-Za-z][A-Za-z0-9_]{1,47}$'))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `methodology_coverage_link_key` (UNIQUE): `UNIQUE (source_element_id, target_kind, target_code)`

**Triggers:**

- `methodology_coverage_link_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `methodology_coverage_link_guard()`

