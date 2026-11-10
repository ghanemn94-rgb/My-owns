-- 0111 P6 slice D: the optional in-app assistant (T-DG6-ARCH-05; ADR-0059). Authored by solution-architect. Runs as
-- mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor:
-- PostgreSQL 16.
--
-- REQ-S17-007 ("The assistant retrieves only records the user may read, cites them, and labels outputs as
-- suggestions"), REQ-S17-008 ("The assistant has no write tools for approvals, validations, evidence or financial
-- fields; drafts require a human to save and submit"), REQ-S17-009 ("The default install has AI and telemetry off;
-- enabling requires an admin to enter an endpoint and an authorization reference, which is audited"), REQ-S17-010,
-- REQ-S17-011.
--   assistant_setting         at most one row (installation-wide, the storage_setting precedent of 0102). NO ROW = the
--                             assistant is DISABLED: this migration seeds nothing, so a fresh install has AI off. A row
--                             is created disabled; enabling is its own audited transition that needs a provider, an
--                             authorization reference and (for the HTTP adapter) an endpoint, an API style and a model
--                             name. While enabled, the provider, endpoint, API style, model, credential reference and
--                             authorization reference cannot change (turn it off first). The credential is a SecretRef
--                             (p6_secret_ref_valid, 0102): no secret value can be stored. The endpoint URL can carry no
--                             user information, query or fragment, so no key can travel in it. Versioned, audited;
--                             trigger-written append-only history assistant_setting_change.
--   assistant_conversation    a user's own conversation, optionally focused on one transformation. Only its owner
--                             changes it; every UPDATE appends exactly one message and flips awaiting_reply; at most 100
--                             messages. Versioned and audited: the conversation's audit event covers the message
--                             appended with it (deferred check assistant_conversation_messages_match).
--   assistant_message         append-only. A user message (the prompt as typed, 1-4000 characters) or an assistant
--                             reply of kind answer (content plus at least one citation), refusal (a refusal code, no
--                             content), no_sources (nothing readable matched; nothing was sent to a model),
--                             unavailable (an error code) or interrupted (a turn that never got a reply). Citations
--                             are record ids and versions or playbook block references; retrieved record TEXT is never
--                             stored (ADR-0059 §8 logging rules).
--   assistant_suggestion      a labelled suggestion attached to an answer: a charter draft or a decision brief (text
--                             fields only, never a money, rate, date, owner or option field) or advice (a recovery
--                             action, missing evidence). 'proposed' -> 'taken_to_draft' (final) by the owner only;
--                             taking it to a draft writes NOTHING outside this table: the API returns a draft prefill
--                             that the human saves through the P5 form-draft operations. Versioned and audited.
-- The assistant has no write path into any business table: no grant, trigger or function here writes outside these
-- four tables and the history table. Nothing here reads or writes DG0-DG7. The assistant approves nothing.

-- ------------------------------------------------------------------------------------------------ validation functions
-- Citations: a JSON array of 0-20 distinct objects, each EXACTLY
--   {"source": "record", "recordType": <one of the 12 search record types, 0108>, "recordId": <uuid>, "recordVersion": >= 1}
--   {"source": "playbook", "blockRef": "B0001".."B0165", "playbookVersion": "1.0"}
CREATE FUNCTION p6_assistant_citations_valid(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_catalog, pg_temp AS $$
  SELECT jsonb_typeof(p) = 'array'
     AND jsonb_array_length(p) <= 20
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(p) e
        WHERE jsonb_typeof(e) <> 'object'
           OR NOT CASE e ->> 'source'
                WHEN 'record' THEN
                  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e) k) = ARRAY['recordId', 'recordType', 'recordVersion', 'source']
                  AND jsonb_typeof(e -> 'recordType') = 'string' AND p6_search_record_type_valid(e ->> 'recordType')
                  AND jsonb_typeof(e -> 'recordId') = 'string'
                  AND (e ->> 'recordId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  AND jsonb_typeof(e -> 'recordVersion') = 'number'
                  AND (e ->> 'recordVersion') ~ '^[1-9][0-9]{0,8}$'
                WHEN 'playbook' THEN
                  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e) k) = ARRAY['blockRef', 'playbookVersion', 'source']
                  AND jsonb_typeof(e -> 'blockRef') = 'string' AND (e ->> 'blockRef') ~ '^B0[0-9]{3}$'
                  AND substring(e ->> 'blockRef' FROM 2)::integer BETWEEN 1 AND 165
                  AND e -> 'playbookVersion' = '"1.0"'::jsonb
                ELSE false END)
     AND (SELECT count(DISTINCT e) FROM jsonb_array_elements(p) e) = jsonb_array_length(p)
$$;
COMMENT ON FUNCTION p6_assistant_citations_valid(jsonb) IS
  'Assistant citations (ADR-0059 §5): at most 20 distinct {source: record, recordType, recordId, recordVersion} or {source: playbook, blockRef, playbookVersion: "1.0"}.';

-- Draft fields of a suggestion: a JSON object of 1..n string values, keys from the TEXT fields of the target only.
--   charter (0013 charter columns): case_for_change, in_scope, out_of_scope, governance_forum, decision_rights,
--            success_definition, thesis_change, thesis_outcomes, thesis_benefits, thesis_because
--   T16 (the executive decision brief; M0212 "decision, why now, options, recommendation, delay impact, decision owner
--            and required date"): decision, why_now, recommendation, impact_if_delayed. Options, owner and dates are
--            left to the human: they are not text fields.
-- Each value 1-4000 characters (decision and governance_forum 1-500), within every target column's own limit. No key
-- names a money, rate, FTE, KPI, date, owner or option field, so a suggestion cannot carry a financial value.
CREATE FUNCTION p6_assistant_draft_fields_valid(target text, p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_typeof(p) = 'object'
     AND (SELECT count(*) FROM jsonb_object_keys(p)) >= 1
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each(p) kv
        WHERE jsonb_typeof(kv.value) <> 'string'
           OR NOT CASE target
                WHEN 'charter' THEN kv.key IN ('case_for_change', 'in_scope', 'out_of_scope', 'governance_forum',
                  'decision_rights', 'success_definition', 'thesis_change', 'thesis_outcomes', 'thesis_benefits', 'thesis_because')
                WHEN 'T16' THEN kv.key IN ('decision', 'why_now', 'recommendation', 'impact_if_delayed')
                ELSE false END
           OR char_length(kv.value #>> '{}') NOT BETWEEN 1 AND
                CASE WHEN kv.key IN ('decision', 'governance_forum') THEN 500 ELSE 4000 END)
$$;
COMMENT ON FUNCTION p6_assistant_draft_fields_valid(text, jsonb) IS
  'Suggestion draft fields (ADR-0059 §6): text fields of the charter or the T16 decision brief only; never a financial field.';

-- ------------------------------------------------------------------------------------------------ assistant_setting
CREATE TABLE assistant_setting (
  id                      uuid PRIMARY KEY,
  singleton               boolean NOT NULL DEFAULT true CONSTRAINT assistant_setting_singleton_key UNIQUE
                            CONSTRAINT assistant_setting_singleton CHECK (singleton),
  enabled                 boolean NOT NULL DEFAULT false,
  provider_kind           text NULL CHECK (provider_kind IS NULL OR provider_kind IN ('http_endpoint', 'test_adapter')),
  endpoint_url            text NULL CONSTRAINT assistant_setting_endpoint_url CHECK (endpoint_url IS NULL OR (
                            char_length(endpoint_url) <= 2048
                            AND endpoint_url ~ '^https?://[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?(:[0-9]{1,5})?(/[^?#[:space:]]*)?$')),
  api_style               text NULL CHECK (api_style IS NULL OR api_style IN ('openai_chat_completions')),
  model_name              text NULL CHECK (model_name IS NULL OR model_name ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  credential_ref          jsonb NULL CONSTRAINT assistant_setting_credential_ref CHECK (p6_secret_ref_valid(credential_ref)),
  authorization_reference text NULL CHECK (authorization_reference IS NULL OR char_length(authorization_reference) BETWEEN 3 AND 200),
  request_timeout_ms      integer NOT NULL DEFAULT 30000 CHECK (request_timeout_ms BETWEEN 1000 AND 120000),
  max_output_tokens       integer NOT NULL DEFAULT 1024 CHECK (max_output_tokens BETWEEN 64 AND 8192),
  max_context_records     smallint NOT NULL DEFAULT 8 CHECK (max_context_records BETWEEN 1 AND 20),
  enabled_at              timestamptz NULL,
  enabled_by              uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  reason                  text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 1000),
  version                 integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT assistant_setting_enabled_stamp CHECK (enabled = (enabled_at IS NOT NULL)
                                                    AND (enabled_at IS NULL) = (enabled_by IS NULL)),
  CONSTRAINT assistant_setting_enable_complete CHECK (NOT enabled OR (provider_kind IS NOT NULL
    AND authorization_reference IS NOT NULL
    AND (provider_kind = 'test_adapter' OR (endpoint_url IS NOT NULL AND api_style IS NOT NULL AND model_name IS NOT NULL)))),
  CONSTRAINT assistant_setting_test_adapter_shape CHECK (provider_kind IS DISTINCT FROM 'test_adapter'
    OR (endpoint_url IS NULL AND api_style IS NULL AND credential_ref IS NULL))
);
SELECT p2_attach_guards('assistant_setting', true);
GRANT SELECT, INSERT, UPDATE ON assistant_setting TO mth_app;

-- A row starts disabled (enabling is always its own audited transition); while enabled, what decides where company
-- data goes cannot change; the enabling actor is the stamped enabler.
CREATE FUNCTION assistant_setting_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.enabled THEN
      RAISE EXCEPTION 'assistant_setting: the setting is created disabled; enabling is a separate step'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'assistant_setting_starts_disabled';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.enabled AND NEW.enabled AND (
       NEW.provider_kind IS DISTINCT FROM OLD.provider_kind OR NEW.endpoint_url IS DISTINCT FROM OLD.endpoint_url
       OR NEW.api_style IS DISTINCT FROM OLD.api_style OR NEW.model_name IS DISTINCT FROM OLD.model_name
       OR NEW.credential_ref IS DISTINCT FROM OLD.credential_ref
       OR NEW.authorization_reference IS DISTINCT FROM OLD.authorization_reference) THEN
    RAISE EXCEPTION 'assistant_setting: turn the assistant off before changing its provider, endpoint, model, credential or authorization reference'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assistant_setting_locked_while_enabled';
  END IF;
  IF NEW.enabled AND NOT OLD.enabled AND NEW.enabled_by IS DISTINCT FROM NEW.updated_by THEN
    RAISE EXCEPTION 'assistant_setting: the enabler is the actor of the enabling change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assistant_setting_enabled_by_actor';
  END IF;
  IF NEW.enabled AND OLD.enabled AND (NEW.enabled_at IS DISTINCT FROM OLD.enabled_at OR NEW.enabled_by IS DISTINCT FROM OLD.enabled_by) THEN
    RAISE EXCEPTION 'assistant_setting: the enabling stamp never changes while enabled'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assistant_setting_enabled_by_actor';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assistant_setting_guard BEFORE INSERT OR UPDATE ON assistant_setting
  FOR EACH ROW EXECUTE FUNCTION assistant_setting_guard();

CREATE TABLE assistant_setting_change (
  id                      uuid PRIMARY KEY,
  assistant_setting_id    uuid NOT NULL REFERENCES assistant_setting (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_version          integer NOT NULL CHECK (record_version >= 1),
  enabled                 boolean NOT NULL,
  provider_kind           text NULL,
  endpoint_url            text NULL,
  api_style               text NULL,
  model_name              text NULL,
  credential_ref          jsonb NULL,
  authorization_reference text NULL,
  request_timeout_ms      integer NOT NULL,
  max_output_tokens       integer NOT NULL,
  max_context_records     smallint NOT NULL,
  enabled_at              timestamptz NULL,
  enabled_by              uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  reason                  text NOT NULL,
  changed_by              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  changed_at              timestamptz NOT NULL,
  CONSTRAINT assistant_setting_change_version_key UNIQUE (assistant_setting_id, record_version)
);
SELECT p2_attach_append_only('assistant_setting_change');
GRANT SELECT ON assistant_setting_change TO mth_app;

CREATE FUNCTION assistant_setting_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO assistant_setting_change (id, assistant_setting_id, record_version, enabled, provider_kind, endpoint_url,
    api_style, model_name, credential_ref, authorization_reference, request_timeout_ms, max_output_tokens,
    max_context_records, enabled_at, enabled_by, reason, changed_by, changed_at)
  VALUES (mth_uuid_v7(), NEW.id, NEW.version, NEW.enabled, NEW.provider_kind, NEW.endpoint_url, NEW.api_style,
    NEW.model_name, NEW.credential_ref, NEW.authorization_reference, NEW.request_timeout_ms, NEW.max_output_tokens,
    NEW.max_context_records, NEW.enabled_at, NEW.enabled_by, NEW.reason, NEW.updated_by, NEW.updated_at);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION assistant_setting_history() FROM PUBLIC;
CREATE TRIGGER assistant_setting_history AFTER INSERT OR UPDATE ON assistant_setting
  FOR EACH ROW EXECUTE FUNCTION assistant_setting_history();

-- ------------------------------------------------------------------------------------------------ assistant_conversation
CREATE TABLE assistant_conversation (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  owner_user_id     uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  title             text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  message_count     smallint NOT NULL DEFAULT 0 CHECK (message_count BETWEEN 0 AND 100),
  awaiting_reply    boolean NOT NULL DEFAULT false,
  awaiting_since    timestamptz NULL,
  last_message_at   timestamptz NULL,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT assistant_conversation_owner_is_creator CHECK (owner_user_id = created_by),
  CONSTRAINT assistant_conversation_awaiting_shape CHECK (awaiting_reply = (awaiting_since IS NOT NULL)),
  CONSTRAINT assistant_conversation_last_message_shape CHECK ((message_count = 0) = (last_message_at IS NULL)),
  CONSTRAINT assistant_conversation_starts_empty CHECK (version > 1 OR (message_count = 0 AND NOT awaiting_reply))
);
CREATE INDEX assistant_conversation_owner_idx ON assistant_conversation (owner_user_id, updated_at DESC, id DESC);
SELECT p2_attach_guards('assistant_conversation', true);
GRANT SELECT, INSERT, UPDATE ON assistant_conversation TO mth_app;

-- Owner only; the owner's and the transformation's organization; every UPDATE appends exactly one message and flips
-- awaiting_reply (a user message sets it, a reply clears it); owner, transformation and title never change.
CREATE FUNCTION assistant_conversation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  u_org uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT organization_id INTO u_org FROM app_user WHERE id = NEW.owner_user_id;
    IF u_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'assistant_conversation: the conversation belongs to its owner''s organization'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'assistant_conversation_organization_matches';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.title IS DISTINCT FROM OLD.title THEN
    RAISE EXCEPTION 'assistant_conversation: owner and title never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assistant_conversation_identity_fixed';
  END IF;
  IF NEW.updated_by IS DISTINCT FROM OLD.owner_user_id THEN
    RAISE EXCEPTION 'assistant_conversation: only the owner adds to a conversation'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assistant_conversation_owner_only';
  END IF;
  IF NEW.message_count <> OLD.message_count + 1 OR NEW.awaiting_reply = OLD.awaiting_reply THEN
    RAISE EXCEPTION 'assistant_conversation: every change appends exactly one message and flips awaiting_reply'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assistant_conversation_message_step';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assistant_conversation_guard BEFORE INSERT OR UPDATE ON assistant_conversation
  FOR EACH ROW EXECUTE FUNCTION assistant_conversation_guard();

-- ------------------------------------------------------------------------------------------------ assistant_message
CREATE TABLE assistant_message (
  id                uuid PRIMARY KEY,
  conversation_id   uuid NOT NULL REFERENCES assistant_conversation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  seq               smallint NOT NULL CHECK (seq BETWEEN 1 AND 100),
  author            text NOT NULL CHECK (author IN ('user', 'assistant')),
  reply_kind        text NULL CHECK (reply_kind IS NULL OR reply_kind IN ('answer', 'refusal', 'no_sources', 'unavailable', 'interrupted')),
  refusal_code      text NULL CHECK (refusal_code IS NULL OR refusal_code IN ('assistant.refused.approval',
                      'assistant.refused.benefit_validation', 'assistant.refused.value_change', 'assistant.refused.evidence')),
  error_code        text NULL CHECK (error_code IS NULL OR error_code IN ('assistant.provider_timeout',
                      'assistant.provider_unreachable', 'assistant.provider_error', 'assistant.provider_response_invalid')),
  content           text NULL CHECK (content IS NULL OR char_length(content) BETWEEN 1 AND 8000),
  citations         jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT assistant_message_citations_valid
                      CHECK (p6_assistant_citations_valid(citations)),
  provider_kind     text NULL CHECK (provider_kind IS NULL OR provider_kind IN ('http_endpoint', 'test_adapter')),
  model_name        text NULL CHECK (model_name IS NULL OR char_length(model_name) BETWEEN 1 AND 200),
  setting_version   integer NULL CHECK (setting_version IS NULL OR setting_version >= 1),
  latency_ms        integer NULL CHECK (latency_ms IS NULL OR latency_ms BETWEEN 0 AND 600000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT assistant_message_seq_key UNIQUE (conversation_id, seq),
  CONSTRAINT assistant_message_conversation_id_id_key UNIQUE (conversation_id, id),
  CONSTRAINT assistant_message_user_shape CHECK (author <> 'user' OR (reply_kind IS NULL AND refusal_code IS NULL
    AND error_code IS NULL AND provider_kind IS NULL AND model_name IS NULL AND setting_version IS NULL
    AND latency_ms IS NULL AND citations = '[]'::jsonb AND content IS NOT NULL AND char_length(content) <= 4000)),
  CONSTRAINT assistant_message_reply_shape CHECK (author <> 'assistant' OR CASE reply_kind
    WHEN 'answer' THEN content IS NOT NULL AND jsonb_array_length(citations) >= 1 AND provider_kind IS NOT NULL
      AND setting_version IS NOT NULL AND latency_ms IS NOT NULL AND refusal_code IS NULL AND error_code IS NULL
      AND (model_name IS NOT NULL OR provider_kind = 'test_adapter')
    WHEN 'refusal' THEN refusal_code IS NOT NULL AND content IS NULL AND citations = '[]'::jsonb AND error_code IS NULL
      AND provider_kind IS NULL AND model_name IS NULL AND setting_version IS NULL AND latency_ms IS NULL
    WHEN 'no_sources' THEN content IS NULL AND citations = '[]'::jsonb AND refusal_code IS NULL AND error_code IS NULL
      AND provider_kind IS NULL AND model_name IS NULL AND latency_ms IS NULL
    WHEN 'unavailable' THEN error_code IS NOT NULL AND content IS NULL AND citations = '[]'::jsonb AND refusal_code IS NULL
      AND provider_kind IS NOT NULL AND setting_version IS NOT NULL
    WHEN 'interrupted' THEN content IS NULL AND citations = '[]'::jsonb AND refusal_code IS NULL AND error_code IS NULL
      AND provider_kind IS NULL AND model_name IS NULL AND setting_version IS NULL AND latency_ms IS NULL
    ELSE false END)
);
SELECT p2_attach_append_only('assistant_message');
GRANT SELECT, INSERT ON assistant_message TO mth_app;

-- A message is appended in the same transaction as the conversation update that counts it: its seq equals the
-- conversation's new message_count; a user message is appended when the conversation starts awaiting a reply, a reply
-- when it stops; the author of the row is the conversation's owner (the assistant writes nothing on its own).
CREATE FUNCTION assistant_message_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  c record;
BEGIN
  SELECT organization_id, owner_user_id, message_count, awaiting_reply INTO c
    FROM assistant_conversation WHERE id = NEW.conversation_id;
  IF NOT FOUND THEN
    RETURN NEW; -- the foreign key reports it
  END IF;
  IF c.organization_id IS DISTINCT FROM NEW.organization_id OR c.owner_user_id IS DISTINCT FROM NEW.created_by THEN
    RAISE EXCEPTION 'assistant_message: a message belongs to its conversation''s organization and owner'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assistant_message_conversation_matches';
  END IF;
  IF NEW.seq IS DISTINCT FROM c.message_count
     OR (NEW.author = 'user') IS DISTINCT FROM c.awaiting_reply THEN
    RAISE EXCEPTION 'assistant_message: appended with the conversation update that counts it (seq %, count %)', NEW.seq, c.message_count
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assistant_message_sequence';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assistant_message_guard BEFORE INSERT ON assistant_message
  FOR EACH ROW EXECUTE FUNCTION assistant_message_guard();

-- At COMMIT, a conversation's message_count equals its number of messages (a counted message was appended, and no
-- message exists that was not counted).
CREATE FUNCTION assistant_conversation_messages_match() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  cid uuid := (to_jsonb(NEW) ->> CASE WHEN TG_TABLE_NAME = 'assistant_message' THEN 'conversation_id' ELSE 'id' END)::uuid;
  n integer;
  m integer;
BEGIN
  SELECT message_count INTO n FROM assistant_conversation WHERE id = cid;
  SELECT count(*) INTO m FROM assistant_message WHERE conversation_id = cid;
  IF n IS DISTINCT FROM m THEN
    RAISE EXCEPTION 'assistant_conversation %: message_count % but % messages', cid, n, m
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'assistant_conversation_messages_match';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER assistant_conversation_messages_match AFTER INSERT OR UPDATE ON assistant_conversation
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assistant_conversation_messages_match();
CREATE CONSTRAINT TRIGGER assistant_message_counted AFTER INSERT ON assistant_message
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assistant_conversation_messages_match();

-- ------------------------------------------------------------------------------------------------ assistant_suggestion
CREATE TABLE assistant_suggestion (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id  uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  conversation_id    uuid NOT NULL REFERENCES assistant_conversation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  message_id         uuid NOT NULL,
  owner_user_id      uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ordinal            smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 5),
  kind               text NOT NULL CHECK (kind IN ('charter_draft', 'decision_brief_draft', 'recovery_action', 'missing_evidence')),
  target_record_type text NULL CHECK (target_record_type IS NULL OR target_record_type IN ('charter', 'T16')),
  fields             jsonb NULL,
  text_content       text NULL CHECK (text_content IS NULL OR char_length(text_content) BETWEEN 1 AND 4000),
  citations          jsonb NOT NULL CONSTRAINT assistant_suggestion_citations_valid
                       CHECK (p6_assistant_citations_valid(citations) AND jsonb_array_length(citations) >= 1),
  status             text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'taken_to_draft')),
  taken_at           timestamptz NULL,
  taken_by           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version            integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT assistant_suggestion_message_fk FOREIGN KEY (conversation_id, message_id)
    REFERENCES assistant_message (conversation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT assistant_suggestion_ordinal_key UNIQUE (message_id, ordinal),
  CONSTRAINT assistant_suggestion_owner_is_creator CHECK (owner_user_id = created_by),
  CONSTRAINT assistant_suggestion_kind_shape CHECK (CASE kind
    WHEN 'charter_draft' THEN target_record_type = 'charter' AND fields IS NOT NULL
      AND p6_assistant_draft_fields_valid('charter', fields) AND text_content IS NULL
    WHEN 'decision_brief_draft' THEN target_record_type = 'T16' AND fields IS NOT NULL
      AND p6_assistant_draft_fields_valid('T16', fields) AND text_content IS NULL
    ELSE target_record_type IS NULL AND fields IS NULL AND text_content IS NOT NULL END),
  CONSTRAINT assistant_suggestion_taken_shape CHECK ((status = 'taken_to_draft') = (taken_at IS NOT NULL)
                                                    AND (taken_at IS NULL) = (taken_by IS NULL)),
  CONSTRAINT assistant_suggestion_draftable CHECK (status = 'proposed' OR kind IN ('charter_draft', 'decision_brief_draft'))
);
CREATE INDEX assistant_suggestion_conversation_idx ON assistant_suggestion (conversation_id, message_id, ordinal);
SELECT p2_attach_guards('assistant_suggestion', true);
GRANT SELECT, INSERT, UPDATE ON assistant_suggestion TO mth_app;

-- A suggestion is created 'proposed' on an ANSWER of a conversation focused on its transformation, by that
-- conversation's owner; the only change is the owner taking a draft suggestion to a draft, once (final); its content
-- never changes.
CREATE FUNCTION assistant_suggestion_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  c record;
  m record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'proposed' THEN
      RAISE EXCEPTION 'assistant_suggestion: a suggestion starts proposed'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'assistant_suggestion_transition';
    END IF;
    SELECT organization_id, owner_user_id, transformation_id INTO c FROM assistant_conversation WHERE id = NEW.conversation_id;
    SELECT author, reply_kind INTO m FROM assistant_message WHERE id = NEW.message_id AND conversation_id = NEW.conversation_id;
    IF c.organization_id IS DISTINCT FROM NEW.organization_id OR c.owner_user_id IS DISTINCT FROM NEW.owner_user_id
       OR c.transformation_id IS DISTINCT FROM NEW.transformation_id THEN
      RAISE EXCEPTION 'assistant_suggestion: the conversation''s organization, owner and transformation'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'assistant_suggestion_conversation_matches';
    END IF;
    IF m.author IS DISTINCT FROM 'assistant' OR m.reply_kind IS DISTINCT FROM 'answer' THEN
      RAISE EXCEPTION 'assistant_suggestion: a suggestion belongs to an assistant answer'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'assistant_suggestion_on_answer';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'taken_to_draft' THEN
    RAISE EXCEPTION 'assistant_suggestion: a suggestion taken to a draft is final'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assistant_suggestion_final';
  END IF;
  IF (NEW.conversation_id, NEW.message_id, NEW.owner_user_id, NEW.ordinal, NEW.kind, NEW.target_record_type,
      NEW.fields, NEW.text_content, NEW.citations)
     IS DISTINCT FROM (OLD.conversation_id, OLD.message_id, OLD.owner_user_id, OLD.ordinal, OLD.kind,
      OLD.target_record_type, OLD.fields, OLD.text_content, OLD.citations) THEN
    RAISE EXCEPTION 'assistant_suggestion: the content of a suggestion never changes'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assistant_suggestion_immutable';
  END IF;
  IF NEW.status <> 'taken_to_draft' OR NEW.updated_by IS DISTINCT FROM OLD.owner_user_id
     OR NEW.taken_by IS DISTINCT FROM OLD.owner_user_id THEN
    RAISE EXCEPTION 'assistant_suggestion: only its owner takes a suggestion to a draft'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assistant_suggestion_transition';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assistant_suggestion_guard BEFORE INSERT OR UPDATE ON assistant_suggestion
  FOR EACH ROW EXECUTE FUNCTION assistant_suggestion_guard();
