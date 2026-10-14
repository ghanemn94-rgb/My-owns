qa disposable cluster: PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0, 64-bit; server_encoding UTF8, lc_collate C, lc_ctype C
## automation_trigger

- **Purpose:** The triggers a rule can use (M0221): outbox event types, job schedules and (starters only) in-request evaluation, with the payload fields conditions may test and the initiating-user field (ADR-0043 §2).
- **Migration:** `0074_p5_automation_engine.sql`. **API module:** `automation`. **Who writes:** migrations only. **Lifecycle:** seeded catalogue (22 rows in 0074, 9 in 0075).
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| code | text | NOT NULL |  | `CHECK (((code ~ '^[a-z_]+\.[a-z_.]+$') AND (char_length(code) <= 100)))`; PK |
| trigger_kind | text | NOT NULL |  | `CHECK ((trigger_kind = ANY (ARRAY['event', 'schedule', 'request'])))` |
| owner_module | text | NOT NULL |  | `CHECK ((owner_module ~ '^[a-z_]+$'))` |
| label_en | text | NOT NULL |  | `CHECK (((char_length(label_en) >= 1) AND (char_length(label_en) <= 200)))` |
| label_ar | text | NOT NULL |  | `CHECK (((char_length(label_ar) >= 1) AND (char_length(label_ar) <= 200)))` |
| condition_fields | text[] | NOT NULL | `'{}'[]` | `CHECK ((cardinality(condition_fields) <= 30))` |
| initiating_user_field | text | NULL |  | `CHECK (((initiating_user_field IS NULL) OR (initiating_user_field ~ '^[a-z][a-zA-Z0-9]{0,39}$')))` |
| admin_selectable | boolean | NOT NULL |  |  |
| source_ref | text | NOT NULL |  | `CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 50)))` |

**Table constraints:**

- `automation_trigger_request_starter_only` (CHECK): `CHECK (((trigger_kind <> 'request') OR (NOT admin_selectable)))`
- `automation_trigger_schedule_no_user` (CHECK): `CHECK (((trigger_kind <> 'schedule') OR (initiating_user_field IS NULL)))`

## automation_action_type

- **Purpose:** The action registry's catalogue (ADR-0043 §2): automatic actions with their required permission, and the six human-only decisions listed only to be refused (REQ-S12-026, M0242).
- **Migration:** `0074_p5_automation_engine.sql`. **API module:** `automation`. **Who writes:** migrations only. **Lifecycle:** seeded catalogue (11 rows).
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| code | text | NOT NULL |  | `CHECK ((code ~ '^[a-z][a-z0-9_]{2,63}$'))`; PK |
| action_class | text | NOT NULL |  | `CHECK ((action_class = ANY (ARRAY['automatic', 'human_only'])))` |
| owner_module | text | NOT NULL |  | `CHECK ((owner_module ~ '^[a-z_]+$'))` |
| label_en | text | NOT NULL |  | `CHECK (((char_length(label_en) >= 1) AND (char_length(label_en) <= 200)))` |
| label_ar | text | NOT NULL |  | `CHECK (((char_length(label_ar) >= 1) AND (char_length(label_ar) <= 200)))` |
| required_permission_code | text | NULL |  | FK → permission(code) |
| admin_selectable | boolean | NOT NULL |  |  |
| source_ref | text | NOT NULL |  | `CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 50)))` |

**Table constraints:**

- `automation_action_type_human_never_selectable` (CHECK): `CHECK (((action_class = 'automatic') OR (NOT admin_selectable)))`

## automation_rule

- **Purpose:** A rule's identity (REQ-S12-001): code, origin (starter | admin), scope, owner, enabled state, whether it may be disabled (D-142 Q3) and its effective version.
- **Migration:** `0074_p5_automation_engine.sql`. **API module:** `automation`. **Who writes:** `automation.configure`; starters by migration (0075). **Lifecycle:** disabled ⇄ enabled (guarantee starters always enabled); versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| code | text | NOT NULL |  | `CHECK ((code ~ '^[a-z][a-z0-9_.]{2,63}$'))` |
| origin | text | NOT NULL |  | `CHECK ((origin = ANY (ARRAY['starter', 'admin'])))` |
| source_ref | text | NULL |  | `CHECK (((source_ref IS NULL) OR (source_ref ~ '^M0[0-9]{3}$')))` |
| name_en | text | NOT NULL |  | `CHECK (((char_length(name_en) >= 1) AND (char_length(name_en) <= 200)))` |
| name_ar | text | NOT NULL |  | `CHECK (((char_length(name_ar) >= 1) AND (char_length(name_ar) <= 200)))` |
| description_en | text | NULL |  | `CHECK (((description_en IS NULL) OR ((char_length(description_en) >= 1) AND (char_length(description_en) <= 2000))))` |
| description_ar | text | NULL |  | `CHECK (((description_ar IS NULL) OR ((char_length(description_ar) >= 1) AND (char_length(description_ar) <= 2000))))` |
| scope_level | text | NOT NULL |  | `CHECK ((scope_level = ANY (ARRAY['platform', 'organization', 'transformation'])))` |
| organization_id | uuid | NULL |  | FK → organization(id) |
| transformation_id | uuid | NULL |  | FK → transformation(id) |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| owner_role_code | text | NULL |  | FK → role(code) |
| enabled | boolean | NOT NULL | `false` |  |
| disable_allowed | boolean | NOT NULL |  |  |
| disabled_reason | text | NULL |  | `CHECK (((disabled_reason IS NULL) OR ((char_length(disabled_reason) >= 3) AND (char_length(disabled_reason) <= 1000))))` |
| effective_version_id | uuid | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `automation_rule_code_key` (UNIQUE): `UNIQUE (code)`
- `automation_rule_disabled_reason` (CHECK): `CHECK (((NOT enabled) OR (disabled_reason IS NULL)))`
- `automation_rule_effective_version_fkey` (FK): `FOREIGN KEY (id, effective_version_id) REFERENCES automation_rule_version(automation_rule_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED`
- `automation_rule_enabled_needs_version` (CHECK): `CHECK (((NOT enabled) OR (effective_version_id IS NOT NULL)))`
- `automation_rule_guarantee_kept` (CHECK): `CHECK ((disable_allowed OR enabled))`
- `automation_rule_one_owner` (CHECK): `CHECK (((owner_user_id IS NULL) <> (owner_role_code IS NULL)))`
- `automation_rule_origin_shape` (CHECK): `CHECK ((((origin = 'starter') AND (source_ref IS NOT NULL) AND (scope_level = 'platform') AND (owner_role_code IS NOT NULL)) OR ((origin = 'admin') AND (source_ref IS NULL) AND (scope_level <> 'platform') AND (owner_user_id IS NOT NULL) AND disable_allowed)))`
- `automation_rule_scope_complete` (CHECK): `CHECK ((((scope_level = 'platform') AND (organization_id IS NULL) AND (transformation_id IS NULL)) OR ((scope_level = 'organization') AND (organization_id IS NOT NULL) AND (transformation_id IS NULL)) OR ((scope_level = 'transformation') AND (organization_id IS NOT NULL) AND (transformation_id IS NOT NULL))))`

**Indexes:**

- `automation_rule_scope_idx`: `(organization_id, transformation_id)`

**Triggers:**

- `automation_rule_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `automation_rule_effective_check`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `automation_rule_effective_check()`
- `automation_rule_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `automation_rule_guard()`
- `automation_rule_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## automation_rule_version

- **Purpose:** One version of a rule: triggers, conditions, actions, identity, service permissions, parameters, content hash, review and publication (REQ-S12-001, REQ-S12-002; ADR-0043 §1, §4).
- **Migration:** `0074_p5_automation_engine.sql`. **API module:** `automation`. **Who writes:** `automation.configure` (content, submit, publish, discard), `automation.review` (review); starter v1 by migration. **Lifecycle:** draft → in_review → approved → published → superseded; discarded; content frozen outside draft; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| automation_rule_id | uuid | NOT NULL |  | FK → automation_rule(id) |
| version_no | integer | NOT NULL |  | `CHECK ((version_no >= 1))` |
| status | text | NOT NULL | `'draft'` | `CHECK ((status = ANY (ARRAY['draft', 'in_review', 'approved', 'published', 'superseded', 'discarded'])))` |
| trigger_codes | text[] | NOT NULL |  | `CHECK (((cardinality(trigger_codes) >= 1) AND (cardinality(trigger_codes) <= 6)))` |
| conditions | jsonb | NOT NULL | `'[]'::jsonb` | `CHECK (((jsonb_typeof(conditions) = 'array') AND (jsonb_array_length(conditions) <= 20)))` |
| actions | jsonb | NOT NULL |  | `CHECK (((jsonb_typeof(actions) = 'array') AND ((jsonb_array_length(actions) >= 1) AND (jsonb_array_length(actions) <= 10))))` |
| action_types | text[] | NOT NULL |  | `CHECK (((cardinality(action_types) >= 1) AND (cardinality(action_types) <= 10)))` |
| run_as | text | NOT NULL |  | `CHECK ((run_as = ANY (ARRAY['initiating_user', 'service'])))` |
| service_permission_codes | text[] | NOT NULL | `'{}'[]` | `CHECK ((cardinality(service_permission_codes) <= 20))` |
| parameters | jsonb | NOT NULL | `'{}'::jsonb` | `CHECK ((jsonb_typeof(parameters) = 'object'))` |
| content_sha256 | text | NOT NULL |  | `CHECK ((content_sha256 ~ '^[0-9a-f]{64}$'))` |
| change_summary | text | NULL |  | `CHECK (((change_summary IS NULL) OR ((char_length(change_summary) >= 3) AND (char_length(change_summary) <= 2000))))` |
| authored_by | uuid | NULL |  | FK → app_user(id) |
| submitted_at | timestamp with time zone | NULL |  |  |
| reviewed_by | uuid | NULL |  | FK → app_user(id) |
| reviewed_at | timestamp with time zone | NULL |  |  |
| review_note | text | NULL |  | `CHECK (((review_note IS NULL) OR ((char_length(review_note) >= 3) AND (char_length(review_note) <= 2000))))` |
| published_by | uuid | NULL |  | FK → app_user(id) |
| published_at | timestamp with time zone | NULL |  |  |
| superseded_at | timestamp with time zone | NULL |  |  |
| discarded_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `automation_rule_version_actions_match` (CHECK): `CHECK ((jsonb_array_length(actions) = cardinality(action_types)))`
- `automation_rule_version_discarded_complete` (CHECK): `CHECK (((status = 'discarded') = (discarded_at IS NOT NULL)))`
- `automation_rule_version_no_key` (UNIQUE): `UNIQUE (automation_rule_id, version_no)`
- `automation_rule_version_one_published` (EXCLUDE): `EXCLUDE USING btree (automation_rule_id WITH =) WHERE ((status = 'published')) DEFERRABLE INITIALLY DEFERRED`
- `automation_rule_version_published_complete` (CHECK): `CHECK ((((status = ANY (ARRAY['published', 'superseded'])) = (published_at IS NOT NULL)) AND ((published_by IS NULL) OR (published_at IS NOT NULL))))`
- `automation_rule_version_review_sod` (CHECK): `CHECK (((reviewed_by IS NULL) OR (authored_by IS NULL) OR (reviewed_by <> authored_by)))`
- `automation_rule_version_reviewed_complete` (CHECK): `CHECK (((reviewed_at IS NULL) = (reviewed_by IS NULL)))`
- `automation_rule_version_rule_id_key` (UNIQUE): `UNIQUE (automation_rule_id, id)`
- `automation_rule_version_service_permissions` (CHECK): `CHECK (((run_as = 'service') OR (cardinality(service_permission_codes) = 0)))`
- `automation_rule_version_superseded_complete` (CHECK): `CHECK (((status = 'superseded') = (superseded_at IS NOT NULL)))`

**Indexes:**

- `automation_rule_version_one_open_key`: `UNIQUE (automation_rule_id) WHERE (status = ANY (ARRAY['draft', 'in_review', 'approved']))`

**Triggers:**

- `automation_rule_version_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `automation_rule_version_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `automation_rule_version_guard()`
- `automation_rule_version_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## automation_dry_run

- **Purpose:** A dry run of a draft against a sample event: conditions, planned actions, findings; writes nothing else (REQ-S12-002; ADR-0043 §4).
- **Migration:** `0074_p5_automation_engine.sql`. **API module:** `automation`. **Who writes:** `automation.configure`. **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| automation_rule_version_id | uuid | NOT NULL |  | FK → automation_rule_version(id) |
| content_sha256 | text | NOT NULL |  | `CHECK ((content_sha256 ~ '^[0-9a-f]{64}$'))` |
| sample_event | jsonb | NOT NULL |  | `CHECK ((jsonb_typeof(sample_event) = 'object'))` |
| outcome | text | NOT NULL |  | `CHECK ((outcome = ANY (ARRAY['pass', 'fail'])))` |
| conditions_met | boolean | NULL |  |  |
| planned_actions | jsonb | NOT NULL | `'[]'::jsonb` | `CHECK (((jsonb_typeof(planned_actions) = 'array') AND (jsonb_array_length(planned_actions) <= 10)))` |
| findings | jsonb | NOT NULL | `'[]'::jsonb` | `CHECK (((jsonb_typeof(findings) = 'array') AND (jsonb_array_length(findings) <= 50)))` |
| run_by | uuid | NOT NULL |  | FK → app_user(id) |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `automation_dry_run_fail_has_finding` (CHECK): `CHECK (((outcome = 'pass') OR (jsonb_array_length(findings) >= 1)))`

**Indexes:**

- `automation_dry_run_version_idx`: `(automation_rule_version_id, created_at DESC, id DESC)`

**Triggers:**

- `automation_dry_run_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `automation_dry_run_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `automation_dry_run_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `automation_dry_run_guard`: BEFORE INSERT FOR EACH ROW → `automation_dry_run_guard()`
- `automation_dry_run_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## automation_execution

- **Purpose:** One evaluation of one rule version for one trigger occurrence: identity, outcome, attempt, error (REQ-S12-001, REQ-S12-021; ADR-0043 §5).
- **Migration:** `0074_p5_automation_engine.sql`. **API module:** `automation`. **Who writes:** the worker (service identity); retry by `automation.repair`. **Lifecycle:** running → succeeded | skipped | failed; failed → running (retry); versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| automation_rule_id | uuid | NOT NULL |  |  |
| automation_rule_version_id | uuid | NOT NULL |  |  |
| trigger_code | text | NOT NULL |  | FK → automation_trigger(code) |
| trigger_key | text | NOT NULL |  | `CHECK (((char_length(trigger_key) >= 1) AND (char_length(trigger_key) <= 200)))` |
| trigger_payload | jsonb | NOT NULL | `'{}'::jsonb` | `CHECK ((jsonb_typeof(trigger_payload) = 'object'))` |
| organization_id | uuid | NULL |  | FK → organization(id) |
| transformation_id | uuid | NULL |  | FK → transformation(id) |
| run_as | text | NOT NULL |  | `CHECK ((run_as = ANY (ARRAY['initiating_user', 'service'])))` |
| initiating_user_id | uuid | NULL |  | FK → app_user(id) |
| status | text | NOT NULL | `'running'` | `CHECK ((status = ANY (ARRAY['running', 'succeeded', 'skipped', 'failed'])))` |
| conditions_met | boolean | NULL |  |  |
| attempt_no | smallint | NOT NULL | `1` | `CHECK (((attempt_no >= 1) AND (attempt_no <= 100)))` |
| error_code | text | NULL |  | `CHECK (((error_code IS NULL) OR (error_code ~ '^[a-z_]+\.[a-z_.]+$')))` |
| error_detail | text | NULL |  | `CHECK (((error_detail IS NULL) OR ((char_length(error_detail) >= 1) AND (char_length(error_detail) <= 2000))))` |
| started_at | timestamp with time zone | NOT NULL | `now()` |  |
| finished_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `automation_execution_failed_complete` (CHECK): `CHECK (((status = 'failed') = (error_code IS NOT NULL)))`
- `automation_execution_finished_complete` (CHECK): `CHECK (((status = 'running') = (finished_at IS NULL)))`
- `automation_execution_identity` (CHECK): `CHECK (((run_as = 'initiating_user') = (initiating_user_id IS NOT NULL)))`
- `automation_execution_once_key` (UNIQUE): `UNIQUE (automation_rule_version_id, trigger_key)`
- `automation_execution_rule_version_fkey` (FK): `FOREIGN KEY (automation_rule_id, automation_rule_version_id) REFERENCES automation_rule_version(automation_rule_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `automation_execution_scope` (CHECK): `CHECK (((transformation_id IS NULL) OR (organization_id IS NOT NULL)))`
- `automation_execution_skipped_complete` (CHECK): `CHECK (((status <> 'skipped') OR (conditions_met IS FALSE)))`

**Indexes:**

- `automation_execution_rule_idx`: `(automation_rule_id, started_at DESC, id DESC)`
- `automation_execution_status_idx`: `(status, started_at DESC) WHERE (status = ANY (ARRAY['running', 'failed']))`

**Triggers:**

- `automation_execution_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `automation_execution_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `automation_execution_guard()`
- `automation_execution_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## automation_action_result

- **Purpose:** The outcome of one action of one execution attempt with its idempotency key and produced record (REQ-S12-021; ADR-0043 §5).
- **Migration:** `0074_p5_automation_engine.sql`. **API module:** `automation`. **Who writes:** the worker. **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| automation_execution_id | uuid | NOT NULL |  | FK → automation_execution(id) |
| attempt_no | smallint | NOT NULL |  | `CHECK (((attempt_no >= 1) AND (attempt_no <= 100)))` |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 10)))` |
| action_type | text | NOT NULL |  | FK → automation_action_type(code) |
| idempotency_key | text | NOT NULL |  | `CHECK (((char_length(idempotency_key) >= 1) AND (char_length(idempotency_key) <= 200)))` |
| outcome | text | NOT NULL |  | `CHECK ((outcome = ANY (ARRAY['done', 'existing', 'skipped', 'failed', 'forbidden'])))` |
| result_record_type | text | NULL |  | `CHECK (((result_record_type IS NULL) OR (result_record_type ~ '^[a-z_]+$')))` |
| result_record_id | uuid | NULL |  |  |
| error_code | text | NULL |  | `CHECK (((error_code IS NULL) OR (error_code ~ '^[a-z_]+\.[a-z_.]+$')))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `automation_action_result_attempt_key` (UNIQUE): `UNIQUE (automation_execution_id, attempt_no, ordinal)`
- `automation_action_result_error_complete` (CHECK): `CHECK (((outcome = ANY (ARRAY['failed', 'forbidden'])) = (error_code IS NOT NULL)))`
- `automation_action_result_record_complete` (CHECK): `CHECK (((result_record_type IS NULL) = (result_record_id IS NULL)))`

**Indexes:**

- `automation_action_result_effect_once_key`: `UNIQUE (idempotency_key) WHERE (outcome = 'done')`

**Triggers:**

- `automation_action_result_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `automation_action_result_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `automation_action_result_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `automation_action_result_guard`: BEFORE INSERT FOR EACH ROW → `automation_action_result_guard()`
- `automation_action_result_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## job_run

- **Purpose:** One finished attempt of a scheduled job (REQ-S12-022 'store scheduled runs and execution outcomes'; ADR-0043 §6).
- **Migration:** `0074_p5_automation_engine.sql`. **API module:** `jobs`. **Who writes:** the worker. **Lifecycle:** append-only operational log (no audit event).
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| job_schedule_code | text | NOT NULL |  | FK → job_schedule(code) |
| job_id | text | NOT NULL |  | `CHECK (((char_length(job_id) >= 1) AND (char_length(job_id) <= 100)))` |
| attempt_no | smallint | NOT NULL |  | `CHECK (((attempt_no >= 1) AND (attempt_no <= 100)))` |
| outcome | text | NOT NULL |  | `CHECK ((outcome = ANY (ARRAY['succeeded', 'failed'])))` |
| started_at | timestamp with time zone | NOT NULL |  |  |
| finished_at | timestamp with time zone | NOT NULL |  |  |
| error_code | text | NULL |  | `CHECK (((error_code IS NULL) OR ((char_length(error_code) >= 1) AND (char_length(error_code) <= 100))))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `job_run_error_complete` (CHECK): `CHECK (((outcome = 'failed') = (error_code IS NOT NULL)))`
- `job_run_job_attempt_key` (UNIQUE): `UNIQUE (job_id, attempt_no)`
- `job_run_times` (CHECK): `CHECK ((finished_at >= started_at))`

**Indexes:**

- `job_run_last_success_idx`: `(job_schedule_code, finished_at DESC) WHERE (outcome = 'succeeded')`
- `job_run_schedule_idx`: `(job_schedule_code, finished_at DESC, id DESC)`

**Triggers:**

- `job_run_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `job_run_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `job_run_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## operational_failure

- **Purpose:** The failure queue: failed rule executions and jobs with the original idempotency key and job data, retries and dismissal (REQ-S12-002, REQ-S12-020, REQ-S12-022; M0239; ADR-0043 §5).
- **Migration:** `0074_p5_automation_engine.sql`. **API module:** `automation`. **Who writes:** the worker (capture, retry outcome); `automation.repair` / `job.repair` (retry, dismiss). **Lifecycle:** open → retrying → resolved | open; open → dismissed; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| source | text | NOT NULL |  | `CHECK ((source = ANY (ARRAY['rule_execution', 'job'])))` |
| organization_id | uuid | NULL |  | FK → organization(id) |
| automation_execution_id | uuid | NULL |  | FK → automation_execution(id) |
| job_schedule_code | text | NULL |  | FK → job_schedule(code) |
| queue_name | text | NOT NULL |  | `CHECK (((queue_name ~ '^[a-z_]+\.[a-z_.]+$') AND (char_length(queue_name) <= 100)))` |
| job_id | text | NULL |  | `CHECK (((job_id IS NULL) OR ((char_length(job_id) >= 1) AND (char_length(job_id) <= 100))))` |
| idempotency_key | text | NOT NULL |  | `CHECK (((char_length(idempotency_key) >= 1) AND (char_length(idempotency_key) <= 200)))` |
| job_data | jsonb | NOT NULL | `'{}'::jsonb` | `CHECK ((jsonb_typeof(job_data) = 'object'))` |
| error_code | text | NOT NULL |  | `CHECK (((char_length(error_code) >= 1) AND (char_length(error_code) <= 100)))` |
| error_message | text | NOT NULL |  | `CHECK (((char_length(error_message) >= 1) AND (char_length(error_message) <= 2000)))` |
| attempts | smallint | NOT NULL |  | `CHECK (((attempts >= 1) AND (attempts <= 100)))` |
| first_failed_at | timestamp with time zone | NOT NULL |  |  |
| last_failed_at | timestamp with time zone | NOT NULL |  |  |
| status | text | NOT NULL | `'open'` | `CHECK ((status = ANY (ARRAY['open', 'retrying', 'resolved', 'dismissed'])))` |
| retry_count | smallint | NOT NULL | `0` | `CHECK (((retry_count >= 0) AND (retry_count <= 20)))` |
| last_retry_by | uuid | NULL |  | FK → app_user(id) |
| last_retry_at | timestamp with time zone | NULL |  |  |
| resolved_at | timestamp with time zone | NULL |  |  |
| dismissed_by | uuid | NULL |  | FK → app_user(id) |
| dismissed_at | timestamp with time zone | NULL |  |  |
| dismiss_reason | text | NULL |  | `CHECK (((dismiss_reason IS NULL) OR ((char_length(dismiss_reason) >= 3) AND (char_length(dismiss_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `operational_failure_dismissed_complete` (CHECK): `CHECK ((((status = 'dismissed') = (dismissed_at IS NOT NULL)) AND ((dismissed_at IS NULL) = (dismissed_by IS NULL)) AND ((dismissed_at IS NULL) = (dismiss_reason IS NULL))))`
- `operational_failure_resolved_complete` (CHECK): `CHECK (((status = 'resolved') = (resolved_at IS NOT NULL)))`
- `operational_failure_retry_complete` (CHECK): `CHECK ((((last_retry_at IS NULL) = (last_retry_by IS NULL)) AND ((retry_count = 0) = (last_retry_at IS NULL))))`
- `operational_failure_source_shape` (CHECK): `CHECK ((((source = 'rule_execution') AND (automation_execution_id IS NOT NULL) AND (organization_id IS NOT NULL)) OR ((source = 'job') AND (automation_execution_id IS NULL))))`
- `operational_failure_times` (CHECK): `CHECK ((last_failed_at >= first_failed_at))`

**Indexes:**

- `operational_failure_one_open_key`: `UNIQUE (source, queue_name, idempotency_key) WHERE (status = ANY (ARRAY['open', 'retrying']))`
- `operational_failure_schedule_idx`: `(job_schedule_code, status)`
- `operational_failure_status_idx`: `(status, last_failed_at DESC, id DESC)`

**Triggers:**

- `operational_failure_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `operational_failure_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `operational_failure_guard()`
- `operational_failure_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## approval_route_step

- **Purpose:** One step of a sequential or parallel approval route of a canonical approval, per round (REQ-S10-015; ADR-0044 §4).
- **Migration:** `0075_p5_starters_routes_policies.sql`. **API module:** `workflows`. **Who writes:** the route instantiation of `approval.request`; `approval.decide` (step decisions). **Lifecycle:** waiting → active → approved | rejected | changes_requested; cancelled; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| approval_id | uuid | NOT NULL |  |  |
| round_no | smallint | NOT NULL |  | `CHECK ((round_no >= 1))` |
| route_key | text | NOT NULL |  | `CHECK (((route_key ~ '^[a-z0-9_]+\.[a-zA-Z0-9_.]+$') AND (char_length(route_key) <= 100)))` |
| route_mode | text | NOT NULL |  | `CHECK ((route_mode = ANY (ARRAY['sequential', 'parallel'])))` |
| step_no | smallint | NOT NULL |  | `CHECK (((step_no >= 1) AND (step_no <= 6)))` |
| approver_role_code | text | NOT NULL |  | FK → role(code) |
| assignee_user_id | uuid | NULL |  | FK → app_user(id) |
| status | text | NOT NULL |  | `CHECK ((status = ANY (ARRAY['waiting', 'active', 'approved', 'rejected', 'changes_requested', 'cancelled'])))` |
| activated_at | timestamp with time zone | NULL |  |  |
| decided_by | uuid | NULL |  | FK → app_user(id) |
| decided_on_behalf_of | uuid | NULL |  | FK → app_user(id) |
| decided_at | timestamp with time zone | NULL |  |  |
| decision_note | text | NULL |  | `CHECK (((decision_note IS NULL) OR ((char_length(decision_note) >= 3) AND (char_length(decision_note) <= 4000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `approval_route_step_activated_complete` (CHECK): `CHECK ((((status = 'waiting') AND (activated_at IS NULL)) OR ((status = ANY (ARRAY['active', 'approved', 'rejected', 'changes_requested'])) AND (activated_at IS NOT NULL)) OR (status = 'cancelled')))`
- `approval_route_step_approval_fkey` (FK): `FOREIGN KEY (transformation_id, approval_id) REFERENCES approval(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `approval_route_step_decided_complete` (CHECK): `CHECK ((((status = ANY (ARRAY['approved', 'rejected', 'changes_requested'])) = (decided_at IS NOT NULL)) AND ((decided_at IS NULL) = (decided_by IS NULL)) AND ((decided_on_behalf_of IS NULL) OR (decided_by IS NOT NULL))))`
- `approval_route_step_no_key` (UNIQUE): `UNIQUE (approval_id, round_no, step_no)`

**Indexes:**

- `approval_route_step_active_idx`: `(approver_role_code, status) WHERE (status = 'active')`

**Triggers:**

- `approval_route_step_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `approval_route_step_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `approval_route_step_guard()`
- `approval_route_step_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## gate_condition_closure

- **Purpose:** The closure of one condition of a conditional approval by its owner (REQ-S04-011; ADR-0044 §3).
- **Migration:** `0075_p5_starters_routes_policies.sql`. **API module:** `workflows`. **Who writes:** `gate_condition.close` (the condition owner). **Lifecycle:** append-only; one per condition.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| gate_decision_condition_id | uuid | NOT NULL |  | FK → gate_decision_condition(id) |
| closure_note | text | NOT NULL |  | `CHECK (((char_length(closure_note) >= 3) AND (char_length(closure_note) <= 2000)))` |
| evidence_id | uuid | NULL |  | FK → evidence(id) |
| closed_by | uuid | NOT NULL |  | FK → app_user(id) |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `gate_condition_closure_once_key` (UNIQUE): `UNIQUE (gate_decision_condition_id)`

**Triggers:**

- `gate_condition_closure_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `gate_condition_closure_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `gate_condition_closure_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `gate_condition_closure_guard`: BEFORE INSERT FOR EACH ROW → `gate_condition_record_guard()`
- `gate_condition_closure_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## gate_condition_escalation

- **Purpose:** The single escalation of an overdue open condition to the approver (REQ-S04-011; ADR-0044 §3).
- **Migration:** `0075_p5_starters_routes_policies.sql`. **API module:** `workflows`. **Who writes:** the worker (gate.condition_escalation_scan). **Lifecycle:** append-only; one per condition.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| gate_decision_condition_id | uuid | NOT NULL |  | FK → gate_decision_condition(id) |
| overdue_since | date | NOT NULL |  |  |
| escalated_to_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| work_item_id | uuid | NULL |  | FK → work_item(id) |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `gate_condition_escalation_once_key` (UNIQUE): `UNIQUE (gate_decision_condition_id)`

**Triggers:**

- `gate_condition_escalation_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `gate_condition_escalation_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `gate_condition_escalation_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `gate_condition_escalation_guard`: BEFORE INSERT FOR EACH ROW → `gate_condition_record_guard()`
- `gate_condition_escalation_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## notification_policy

- **Purpose:** An organization's notification policy: working-day timing, default quiet hours and digest, urgent delivery (REQ-S12-025; ADR-0044 §5).
- **Migration:** `0075_p5_starters_routes_policies.sql`. **API module:** `tasks`. **Who writes:** `notification_policy.configure`. **Lifecycle:** one per organization; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| non_urgent_working_days_only | boolean | NOT NULL | `false` |  |
| default_quiet_hours_start | time without time zone | NULL |  |  |
| default_quiet_hours_end | time without time zone | NULL |  |  |
| default_digest_mode | text | NOT NULL | `'off'` | `CHECK ((default_digest_mode = ANY (ARRAY['off', 'daily', 'twice_daily'])))` |
| urgent_delivery | text | NOT NULL | `'immediate'` | `CHECK ((urgent_delivery = 'immediate'))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `notification_policy_organization_key` (UNIQUE): `UNIQUE (organization_id)`
- `notification_policy_quiet_complete` (CHECK): `CHECK ((((default_quiet_hours_start IS NULL) = (default_quiet_hours_end IS NULL)) AND ((default_quiet_hours_start IS NULL) OR (default_quiet_hours_start <> default_quiet_hours_end))))`

**Triggers:**

- `notification_policy_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `notification_policy_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## notification_preference

- **Purpose:** A user's quiet hours, time zone and digest preference (REQ-S12-025; ADR-0044 §5).
- **Migration:** `0075_p5_starters_routes_policies.sql`. **API module:** `tasks`. **Who writes:** `notification.preferences` (own row only). **Lifecycle:** one per user; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| user_id | uuid | NOT NULL |  | FK → app_user(id) |
| quiet_hours_start | time without time zone | NULL |  |  |
| quiet_hours_end | time without time zone | NULL |  |  |
| timezone | text | NOT NULL | `'Asia/Riyadh'` | `CHECK (((char_length(timezone) >= 1) AND (char_length(timezone) <= 64)))` |
| digest_mode | text | NOT NULL | `'off'` | `CHECK ((digest_mode = ANY (ARRAY['off', 'daily', 'twice_daily'])))` |
| digest_time | time without time zone | NOT NULL | `'08:00:00'::time without time zone` |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `notification_preference_minutes` (CHECK): `CHECK ((date_part('second', digest_time) = (0)::double precision))`
- `notification_preference_quiet_complete` (CHECK): `CHECK ((((quiet_hours_start IS NULL) = (quiet_hours_end IS NULL)) AND ((quiet_hours_start IS NULL) OR (quiet_hours_start <> quiet_hours_end))))`
- `notification_preference_user_key` (UNIQUE): `UNIQUE (user_id)`

**Triggers:**

- `notification_preference_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `notification_preference_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `notification_preference_guard()`
- `notification_preference_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`
- `notification_preference_timezone_known`: BEFORE INSERT OR UPDATE OF timezone FOR EACH ROW → `p4_timezone_known()`

## notification_digest

- **Purpose:** One digest per user and 15-minute window delivering the held non-urgent notifications (REQ-S12-025; ADR-0044 §5).
- **Migration:** `0075_p5_starters_routes_policies.sql`. **API module:** `tasks`. **Who writes:** the worker (notification.digest). **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| recipient_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| window_start | timestamp with time zone | NOT NULL |  |  |
| window_end | timestamp with time zone | NOT NULL |  |  |
| notification_count | integer | NOT NULL |  | `CHECK (((notification_count >= 1) AND (notification_count <= 10000)))` |
| inbox_notification_id | uuid | NOT NULL |  | FK → inbox_notification(id) |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `notification_digest_window` (CHECK): `CHECK ((window_end > window_start))`
- `notification_digest_window_key` (UNIQUE): `UNIQUE (recipient_user_id, window_start)`

**Triggers:**

- `notification_digest_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `notification_digest_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `notification_digest_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `notification_digest_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## meeting_cutoff_pack

- **Purpose:** The draft agenda and pack generated once at a meeting's cut-off from current open asks, reviewed by the chair or secretary before its items can be published (REQ-S12-015; ADR-0044 §6).
- **Migration:** `0075_p5_starters_routes_policies.sql`. **API module:** `governance`. **Who writes:** the worker (generation); the chair (`meeting.chair`) or secretary (`meeting.prepare`) (review). **Lifecycle:** draft → reviewed; content fixed; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| meeting_id | uuid | NOT NULL |  |  |
| cutoff_date | date | NOT NULL |  |  |
| as_of | timestamp with time zone | NOT NULL |  |  |
| open_asks | jsonb | NOT NULL |  | `CHECK (((jsonb_typeof(open_asks) = 'array') AND (jsonb_array_length(open_asks) <= 200)))` |
| agenda_item_ids | uuid[] | NOT NULL | `'{}'::uuid[]` | `CHECK ((cardinality(agenda_item_ids) <= 200))` |
| automation_execution_id | uuid | NULL |  | FK → automation_execution(id) |
| status | text | NOT NULL | `'draft'` | `CHECK ((status = ANY (ARRAY['draft', 'reviewed'])))` |
| reviewed_by | uuid | NULL |  | FK → app_user(id) |
| reviewed_at | timestamp with time zone | NULL |  |  |
| review_note | text | NULL |  | `CHECK (((review_note IS NULL) OR ((char_length(review_note) >= 3) AND (char_length(review_note) <= 2000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `meeting_cutoff_pack_meeting_fkey` (FK): `FOREIGN KEY (transformation_id, meeting_id) REFERENCES meeting(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `meeting_cutoff_pack_once_key` (UNIQUE): `UNIQUE (meeting_id)`
- `meeting_cutoff_pack_reviewed_complete` (CHECK): `CHECK ((((status = 'reviewed') = (reviewed_at IS NOT NULL)) AND ((reviewed_at IS NULL) = (reviewed_by IS NULL))))`

**Triggers:**

- `meeting_cutoff_pack_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `meeting_cutoff_pack_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `meeting_cutoff_pack_guard()`
- `meeting_cutoff_pack_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## dependency_slip

- **Purpose:** One critical dependency slip with its affected initiatives, owners and forecast finishes before and after (REQ-S12-012; ADR-0044 §7).
- **Migration:** `0075_p5_starters_routes_policies.sql`. **API module:** `portfolio`. **Who writes:** the API, inside the milestone change that causes it. **Lifecycle:** append-only; one per (dependency, slip key).
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| dependency_id | uuid | NOT NULL |  |  |
| slip_key | text | NOT NULL |  | `CHECK (((char_length(slip_key) >= 1) AND (char_length(slip_key) <= 200)))` |
| predecessor_finish_before | date | NOT NULL |  |  |
| predecessor_finish_after | date | NOT NULL |  |  |
| slip_days | integer | NOT NULL |  | `CHECK (((slip_days >= 1) AND (slip_days <= 3650)))` |
| needed_by | date | NULL |  |  |
| critical_reason | text | NOT NULL |  | `CHECK ((critical_reason = ANY (ARRAY['critical_path', 'needed_by_breached'])))` |
| affected | jsonb | NOT NULL |  | `CHECK (((jsonb_typeof(affected) = 'array') AND (jsonb_array_length(affected) <= 200)))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NULL |  | FK → app_user(id) |

**Table constraints:**

- `dependency_slip_days` (CHECK): `CHECK ((slip_days = (predecessor_finish_after - predecessor_finish_before)))`
- `dependency_slip_dependency_fkey` (FK): `FOREIGN KEY (transformation_id, dependency_id) REFERENCES dependency(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `dependency_slip_needed_by` (CHECK): `CHECK (((critical_reason <> 'needed_by_breached') OR ((needed_by IS NOT NULL) AND (predecessor_finish_after > needed_by))))`
- `dependency_slip_once_key` (UNIQUE): `UNIQUE (dependency_id, slip_key)`

**Triggers:**

- `dependency_slip_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `dependency_slip_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `dependency_slip_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `dependency_slip_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

