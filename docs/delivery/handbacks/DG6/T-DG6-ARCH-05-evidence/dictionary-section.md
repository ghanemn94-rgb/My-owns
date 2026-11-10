### assistant_setting

- **Purpose:** At most one row: whether the optional assistant is on, its provider (http_endpoint | test_adapter), the IT-provided endpoint, API style and model, the credential as a SecretRef (never a value), the company authorization reference, the limits, and who turned it on and when (REQ-S17-009; ADR-0059 §3). No row = disabled.
- **Migration:** `0111_p6_assistant.sql`. **API module:** `assistant`. **Who writes:** ADM_TECH holding `assistant.configure`, through putAssistantSetting, enableAssistant, disableAssistant (lock 730323). **Lifecycle:** created disabled; disabled <-> enabled; while enabled the provider, endpoint, API style, model, credential and authorization reference are fixed; versioned and audited.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| singleton | boolean | NOT NULL | `true` |  |
| enabled | boolean | NOT NULL | `false` |  |
| provider_kind | text | NULL |  | `CHECK (((provider_kind IS NULL) OR (provider_kind = ANY (ARRAY['http_endpoint', 'test_adapter']))))` |
| endpoint_url | text | NULL |  |  |
| api_style | text | NULL |  | `CHECK (((api_style IS NULL) OR (api_style = 'openai_chat_completions')))` |
| model_name | text | NULL |  | `CHECK (((model_name IS NULL) OR (model_name ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$')))` |
| credential_ref | jsonb | NULL |  |  |
| authorization_reference | text | NULL |  | `CHECK (((authorization_reference IS NULL) OR ((char_length(authorization_reference) >= 3) AND (char_length(authorization_reference) <= 200))))` |
| request_timeout_ms | integer | NOT NULL | `30000` | `CHECK (((request_timeout_ms >= 1000) AND (request_timeout_ms <= 120000)))` |
| max_output_tokens | integer | NOT NULL | `1024` | `CHECK (((max_output_tokens >= 64) AND (max_output_tokens <= 8192)))` |
| max_context_records | smallint | NOT NULL | `8` | `CHECK (((max_context_records >= 1) AND (max_context_records <= 20)))` |
| enabled_at | timestamp with time zone | NULL |  |  |
| enabled_by | uuid | NULL |  | FK → app_user(id) |
| reason | text | NOT NULL |  | `CHECK (((char_length(reason) >= 3) AND (char_length(reason) <= 1000)))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `assistant_setting_credential_ref` (CHECK): `CHECK (p6_secret_ref_valid(credential_ref))`
- `assistant_setting_enable_complete` (CHECK): `CHECK (((NOT enabled) OR ((provider_kind IS NOT NULL) AND (authorization_reference IS NOT NULL) AND ((provider_kind = 'test_adapter') OR ((endpoint_url IS NOT NULL) AND (api_style IS NOT NULL) AND (model_name IS NOT NULL))))))`
- `assistant_setting_enabled_stamp` (CHECK): `CHECK (((enabled = (enabled_at IS NOT NULL)) AND ((enabled_at IS NULL) = (enabled_by IS NULL))))`
- `assistant_setting_endpoint_url` (CHECK): `CHECK (((endpoint_url IS NULL) OR ((char_length(endpoint_url) <= 2048) AND (endpoint_url ~ '^https?://[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?(:[0-9]{1,5})?(/[^?#[:space:]]*)?$'))))`
- `assistant_setting_singleton` (CHECK): `CHECK (singleton)`
- `assistant_setting_singleton_key` (UNIQUE): `UNIQUE (singleton)`
- `assistant_setting_test_adapter_shape` (CHECK): `CHECK (((provider_kind IS DISTINCT FROM 'test_adapter') OR ((endpoint_url IS NULL) AND (api_style IS NULL) AND (credential_ref IS NULL))))`

**Triggers:**

- `assistant_setting_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `assistant_setting_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `assistant_setting_guard()`
- `assistant_setting_history`: AFTER INSERT OR UPDATE FOR EACH ROW → `assistant_setting_history()`
- `assistant_setting_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

### assistant_setting_change

- **Purpose:** Append-only history of every version of the assistant setting (the audited enable and disable trail with their reasons).
- **Migration:** `0111_p6_assistant.sql`. **API module:** `assistant`. **Who writes:** the SECURITY DEFINER trigger `assistant_setting_history` only. **Lifecycle:** append-only; one row per assistant_setting version.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| assistant_setting_id | uuid | NOT NULL |  | FK → assistant_setting(id) |
| record_version | integer | NOT NULL |  | `CHECK ((record_version >= 1))` |
| enabled | boolean | NOT NULL |  |  |
| provider_kind | text | NULL |  |  |
| endpoint_url | text | NULL |  |  |
| api_style | text | NULL |  |  |
| model_name | text | NULL |  |  |
| credential_ref | jsonb | NULL |  |  |
| authorization_reference | text | NULL |  |  |
| request_timeout_ms | integer | NOT NULL |  |  |
| max_output_tokens | integer | NOT NULL |  |  |
| max_context_records | smallint | NOT NULL |  |  |
| enabled_at | timestamp with time zone | NULL |  |  |
| enabled_by | uuid | NULL |  | FK → app_user(id) |
| reason | text | NOT NULL |  |  |
| changed_by | uuid | NOT NULL |  | FK → app_user(id) |
| changed_at | timestamp with time zone | NOT NULL |  |  |

**Table constraints:**

- `assistant_setting_change_version_key` (UNIQUE): `UNIQUE (assistant_setting_id, record_version)`

**Triggers:**

- `assistant_setting_change_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `assistant_setting_change_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

### assistant_conversation

- **Purpose:** A user's own assistant conversation, optionally focused on one transformation: title, message count (at most 100), whether a reply is awaited (REQ-S17-007; ADR-0059 §5).
- **Migration:** `0111_p6_assistant.sql`. **API module:** `assistant`. **Who writes:** its owner, holding `assistant.use` (every role except AUD), through createAssistantConversation and postAssistantMessage. **Lifecycle:** every update appends exactly one message and flips awaiting_reply; owner, transformation and title fixed; versioned and audited (the audit event of each update covers the message appended with it).
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| owner_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| transformation_id | uuid | NULL |  | FK → transformation(id) |
| title | text | NOT NULL |  | `CHECK (((char_length(title) >= 1) AND (char_length(title) <= 200)))` |
| message_count | smallint | NOT NULL | `0` | `CHECK (((message_count >= 0) AND (message_count <= 100)))` |
| awaiting_reply | boolean | NOT NULL | `false` |  |
| awaiting_since | timestamp with time zone | NULL |  |  |
| last_message_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `assistant_conversation_awaiting_shape` (CHECK): `CHECK ((awaiting_reply = (awaiting_since IS NOT NULL)))`
- `assistant_conversation_last_message_shape` (CHECK): `CHECK (((message_count = 0) = (last_message_at IS NULL)))`
- `assistant_conversation_owner_is_creator` (CHECK): `CHECK ((owner_user_id = created_by))`
- `assistant_conversation_starts_empty` (CHECK): `CHECK (((version > 1) OR ((message_count = 0) AND (NOT awaiting_reply))))`

**Indexes:**

- `assistant_conversation_owner_idx`: `(owner_user_id, updated_at DESC, id DESC)`

**Triggers:**

- `assistant_conversation_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `assistant_conversation_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `assistant_conversation_guard()`
- `assistant_conversation_messages_match`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `assistant_conversation_messages_match()`
- `assistant_conversation_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

### assistant_message

- **Purpose:** One message of a conversation: the user's prompt as typed, or the assistant's reply (answer with content and at least one citation; refusal with its code; no_sources; unavailable with an error code; interrupted). Citations are record ids and versions or playbook block references; retrieved record text is never stored (REQ-S17-007, REQ-S17-008, REQ-S17-011; ADR-0059 §5, §8).
- **Migration:** `0111_p6_assistant.sql`. **API module:** `assistant`. **Who writes:** postAssistantMessage only, in the transaction of the conversation update that counts it (the owner is the row's created_by). **Lifecycle:** append-only.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| conversation_id | uuid | NOT NULL |  | FK → assistant_conversation(id) |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| seq | smallint | NOT NULL |  | `CHECK (((seq >= 1) AND (seq <= 100)))` |
| author | text | NOT NULL |  | `CHECK ((author = ANY (ARRAY['user', 'assistant'])))` |
| reply_kind | text | NULL |  | `CHECK (((reply_kind IS NULL) OR (reply_kind = ANY (ARRAY['answer', 'refusal', 'no_sources', 'unavailable', 'interrupted']))))` |
| refusal_code | text | NULL |  | `CHECK (((refusal_code IS NULL) OR (refusal_code = ANY (ARRAY['assistant.refused.approval', 'assistant.refused.benefit_validation', 'assistant.refused.value_change', 'assistant.refused.evidence']))))` |
| error_code | text | NULL |  | `CHECK (((error_code IS NULL) OR (error_code = ANY (ARRAY['assistant.provider_timeout', 'assistant.provider_unreachable', 'assistant.provider_error', 'assistant.provider_response_invalid']))))` |
| content | text | NULL |  | `CHECK (((content IS NULL) OR ((char_length(content) >= 1) AND (char_length(content) <= 8000))))` |
| citations | jsonb | NOT NULL | `'[]'::jsonb` |  |
| provider_kind | text | NULL |  | `CHECK (((provider_kind IS NULL) OR (provider_kind = ANY (ARRAY['http_endpoint', 'test_adapter']))))` |
| model_name | text | NULL |  | `CHECK (((model_name IS NULL) OR ((char_length(model_name) >= 1) AND (char_length(model_name) <= 200))))` |
| setting_version | integer | NULL |  | `CHECK (((setting_version IS NULL) OR (setting_version >= 1)))` |
| latency_ms | integer | NULL |  | `CHECK (((latency_ms IS NULL) OR ((latency_ms >= 0) AND (latency_ms <= 600000))))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `assistant_message_citations_valid` (CHECK): `CHECK (p6_assistant_citations_valid(citations))`
- `assistant_message_conversation_id_id_key` (UNIQUE): `UNIQUE (conversation_id, id)`
- `assistant_message_reply_shape` (CHECK): `CHECK (((author <> 'assistant') OR
CASE reply_kind
    WHEN 'answer' THEN ((content IS NOT NULL) AND (jsonb_array_length(citations) >= 1) AND (provider_kind IS NOT NULL) AND (setting_version IS NOT NULL) AND (latency_ms IS NOT NULL) AND (refusal_code IS NULL) AND (error_code IS NULL) AND ((model_name IS NOT NULL) OR (provider_kind = 'test_adapter')))
    WHEN 'refusal' THEN ((refusal_code IS NOT NULL) AND (content IS NULL) AND (citations = '[]'::jsonb) AND (error_code IS NULL) AND (provider_kind IS NULL) AND (model_name IS NULL) AND (setting_version IS NULL) AND (latency_ms IS NULL))
    WHEN 'no_sources' THEN ((content IS NULL) AND (citations = '[]'::jsonb) AND (refusal_code IS NULL) AND (error_code IS NULL) AND (provider_kind IS NULL) AND (model_name IS NULL) AND (latency_ms IS NULL))
    WHEN 'unavailable' THEN ((error_code IS NOT NULL) AND (content IS NULL) AND (citations = '[]'::jsonb) AND (refusal_code IS NULL) AND (provider_kind IS NOT NULL) AND (setting_version IS NOT NULL))
    WHEN 'interrupted' THEN ((content IS NULL) AND (citations = '[]'::jsonb) AND (refusal_code IS NULL) AND (error_code IS NULL) AND (provider_kind IS NULL) AND (model_name IS NULL) AND (setting_version IS NULL) AND (latency_ms IS NULL))
    ELSE false
END))`
- `assistant_message_seq_key` (UNIQUE): `UNIQUE (conversation_id, seq)`
- `assistant_message_user_shape` (CHECK): `CHECK (((author <> 'user') OR ((reply_kind IS NULL) AND (refusal_code IS NULL) AND (error_code IS NULL) AND (provider_kind IS NULL) AND (model_name IS NULL) AND (setting_version IS NULL) AND (latency_ms IS NULL) AND (citations = '[]'::jsonb) AND (content IS NOT NULL) AND (char_length(content) <= 4000))))`

**Triggers:**

- `assistant_message_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `assistant_message_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `assistant_message_counted`: CONSTRAINT AFTER INSERT DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `assistant_conversation_messages_match()`
- `assistant_message_guard`: BEFORE INSERT FOR EACH ROW → `assistant_message_guard()`

### assistant_suggestion

- **Purpose:** A labelled suggestion on an answer: a charter or T16 decision-brief draft (text fields only) or advice (a recovery action, missing evidence), with its citations (REQ-S17-007, REQ-S17-008; ADR-0059 §6).
- **Migration:** `0111_p6_assistant.sql`. **API module:** `assistant`. **Who writes:** postAssistantMessage (created proposed with the answer); the owner through takeAssistantSuggestionToDraft (proposed -> taken_to_draft). **Lifecycle:** proposed -> taken_to_draft (final; draft kinds only); content never changes; versioned and audited.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| conversation_id | uuid | NOT NULL |  | FK → assistant_conversation(id) |
| message_id | uuid | NOT NULL |  |  |
| owner_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 5)))` |
| kind | text | NOT NULL |  | `CHECK ((kind = ANY (ARRAY['charter_draft', 'decision_brief_draft', 'recovery_action', 'missing_evidence'])))` |
| target_record_type | text | NULL |  | `CHECK (((target_record_type IS NULL) OR (target_record_type = ANY (ARRAY['charter', 'T16']))))` |
| fields | jsonb | NULL |  |  |
| text_content | text | NULL |  | `CHECK (((text_content IS NULL) OR ((char_length(text_content) >= 1) AND (char_length(text_content) <= 4000))))` |
| citations | jsonb | NOT NULL |  |  |
| status | text | NOT NULL | `'proposed'` | `CHECK ((status = ANY (ARRAY['proposed', 'taken_to_draft'])))` |
| taken_at | timestamp with time zone | NULL |  |  |
| taken_by | uuid | NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `assistant_suggestion_citations_valid` (CHECK): `CHECK ((p6_assistant_citations_valid(citations) AND (jsonb_array_length(citations) >= 1)))`
- `assistant_suggestion_draftable` (CHECK): `CHECK (((status = 'proposed') OR (kind = ANY (ARRAY['charter_draft', 'decision_brief_draft']))))`
- `assistant_suggestion_kind_shape` (CHECK): `CHECK (
CASE kind
    WHEN 'charter_draft' THEN ((target_record_type = 'charter') AND (fields IS NOT NULL) AND p6_assistant_draft_fields_valid('charter', fields) AND (text_content IS NULL))
    WHEN 'decision_brief_draft' THEN ((target_record_type = 'T16') AND (fields IS NOT NULL) AND p6_assistant_draft_fields_valid('T16', fields) AND (text_content IS NULL))
    ELSE ((target_record_type IS NULL) AND (fields IS NULL) AND (text_content IS NOT NULL))
END)`
- `assistant_suggestion_message_fk` (FK): `FOREIGN KEY (conversation_id, message_id) REFERENCES assistant_message(conversation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `assistant_suggestion_ordinal_key` (UNIQUE): `UNIQUE (message_id, ordinal)`
- `assistant_suggestion_owner_is_creator` (CHECK): `CHECK ((owner_user_id = created_by))`
- `assistant_suggestion_taken_shape` (CHECK): `CHECK ((((status = 'taken_to_draft') = (taken_at IS NOT NULL)) AND ((taken_at IS NULL) = (taken_by IS NULL))))`

**Indexes:**

- `assistant_suggestion_conversation_idx`: `(conversation_id, message_id, ordinal)`

**Triggers:**

- `assistant_suggestion_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `assistant_suggestion_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `assistant_suggestion_guard()`
- `assistant_suggestion_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

