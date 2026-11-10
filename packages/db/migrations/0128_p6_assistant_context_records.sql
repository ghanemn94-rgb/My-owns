-- 0128 P6 DG6 re-gate repair: the records an assistant answer was generated from (T-DG6-BE-RG1; F-DG6-920; ADR-0059
-- §5 and §9 amendment of 2026-11-10). Authored by backend-workflow-engineer. Runs as mth_owner inside one transaction
-- opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16. Id: the next above the
-- highest shipped file on this branch (0127, D-196 item 2); the orchestrator renumbers at merge if another task
-- shipped a higher id first.
--
-- The read-time re-check of ADR-0059 §9 withholds an answer (content null, contentWithheld true) when the owner can no
-- longer read a record it was generated from. Until now only the citations were stored, and the citations are the
-- records the MODEL chose to cite (ADR-0059 §5), so a record given to the model but not cited escaped the re-check
-- (F-DG6-920). This migration stores the record keys of EVERY record item given to the model beside the citations:
--
--   * assistant_message.context_records jsonb NULL, assistant_suggestion.context_records jsonb NULL: a JSON array of
--     0-20 distinct objects, each EXACTLY {"recordType": <one of the 12 search record types, 0108>, "recordId": <uuid>}
--     (p6_assistant_context_records_valid). Record keys only: no version, no title, no text (the ADR-0059 §8 logging
--     rule "retrieved record TEXT is never stored" still holds). Playbook blocks are not records and are not listed.
--     Never served by the API: it only feeds the read-time check.
--   * Only an assistant ANSWER holds one (a user message and the other reply kinds keep NULL), and it lists at least
--     every record its citations name (p6_assistant_context_covers), so the check over the context alone is never
--     weaker than the check over the citations.
--   * Required on every NEW answer and suggestion (the NOT VALID CHECKs *_context_records_required, the precedent of
--     0027 benefit_calculation_rounding_required): rows stored before 0128 keep NULL, and the API then falls back to
--     the stored citations (ADR-0059 §9 amendment). No backfill is possible: what the model was given was never stored.
--   * assistant_message is append-only (0111), so its context never changes. A suggestion's context is immutable after
--     insert (assistant_suggestion_context_immutable; 0111's guard covers the other content columns).
-- No existing row changes and no grant changes. Nothing here approves anything (no business approval, G1-G6), and
-- nothing reads or writes DG0-DG7.

CREATE FUNCTION p6_assistant_context_records_valid(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_catalog, pg_temp AS $$
  SELECT jsonb_typeof(p) = 'array'
     AND jsonb_array_length(p) <= 20
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(p) e
        WHERE jsonb_typeof(e) <> 'object'
           OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e) k) IS DISTINCT FROM ARRAY['recordId', 'recordType']
           OR jsonb_typeof(e -> 'recordType') <> 'string' OR NOT p6_search_record_type_valid(e ->> 'recordType')
           OR jsonb_typeof(e -> 'recordId') <> 'string'
           OR (e ->> 'recordId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     AND (SELECT count(DISTINCT e) FROM jsonb_array_elements(p) e) = jsonb_array_length(p)
$$;
COMMENT ON FUNCTION p6_assistant_context_records_valid(jsonb) IS
  'Assistant generation context (ADR-0059 §5, §9; F-DG6-920): at most 20 distinct {recordType, recordId} keys of the record items given to the model.';

-- Every record citation of `citations` is listed in `context` (by recordType and recordId).
CREATE FUNCTION p6_assistant_context_covers(context jsonb, citations jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_catalog, pg_temp AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(citations) c
     WHERE c ->> 'source' = 'record'
       AND NOT context @> jsonb_build_array(jsonb_build_object('recordType', c -> 'recordType', 'recordId', c -> 'recordId')))
$$;
COMMENT ON FUNCTION p6_assistant_context_covers(jsonb, jsonb) IS
  'True when every record citation is listed in the generation context (ADR-0059 §9; F-DG6-920).';

-- ------------------------------------------------------------------------------------------------ assistant_message
ALTER TABLE assistant_message
  ADD COLUMN context_records jsonb NULL,
  ADD CONSTRAINT assistant_message_context_records_valid CHECK (context_records IS NULL OR (
    author = 'assistant' AND reply_kind = 'answer'
    AND p6_assistant_context_records_valid(context_records)
    AND p6_assistant_context_covers(context_records, citations)));
ALTER TABLE assistant_message
  ADD CONSTRAINT assistant_message_context_records_required
    CHECK (author <> 'assistant' OR reply_kind IS DISTINCT FROM 'answer' OR context_records IS NOT NULL) NOT VALID;
COMMENT ON COLUMN assistant_message.context_records IS
  'T-DG6-BE-RG1 (F-DG6-920): record keys of every record item given to the model for this answer; re-checked at read time with the citations. NULL on answers stored before 0128 (the citations are then the fallback). Never served.';

-- ------------------------------------------------------------------------------------------------ assistant_suggestion
ALTER TABLE assistant_suggestion
  ADD COLUMN context_records jsonb NULL,
  ADD CONSTRAINT assistant_suggestion_context_records_valid CHECK (context_records IS NULL OR (
    p6_assistant_context_records_valid(context_records)
    AND p6_assistant_context_covers(context_records, citations)));
ALTER TABLE assistant_suggestion
  ADD CONSTRAINT assistant_suggestion_context_records_required CHECK (context_records IS NOT NULL) NOT VALID;
COMMENT ON COLUMN assistant_suggestion.context_records IS
  'T-DG6-BE-RG1 (F-DG6-920): record keys of every record item given to the model for the answer this suggestion belongs to; re-checked at read time and at take-to-draft with the citations. NULL on suggestions stored before 0128 (the citations are then the fallback). Never served; immutable.';

CREATE FUNCTION assistant_suggestion_context_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.context_records IS DISTINCT FROM OLD.context_records THEN
    RAISE EXCEPTION 'assistant_suggestion: context_records is set when the suggestion is created and never changes'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assistant_suggestion_context_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assistant_suggestion_context_immutable BEFORE UPDATE ON assistant_suggestion
  FOR EACH ROW EXECUTE FUNCTION assistant_suggestion_context_immutable();
