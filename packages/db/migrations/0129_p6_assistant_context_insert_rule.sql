-- 0129 P6 DG6 re-gate repair (round 2): the "context required" rule of 0128 applies to NEW rows only, and a stored
-- generation context may hold the inherited context of the history (T-DG6-BE-RG2; F-DG6-971, F-DG6-960, F-DG6-970,
-- F-DG6-980; ADR-0059 §5 and §9, amendment of 2026-11-10 and its RG2 addendum). Authored by backend-workflow-engineer.
-- Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor:
-- PostgreSQL 16. Id: the next above the highest shipped file on this branch (0128, D-196 item 2); the orchestrator
-- renumbers at merge if another task shipped a higher id first.
--
-- 1. F-DG6-971. 0128 required a context on every new answer and suggestion with NOT VALID CHECKs, meaning to leave rows
--    stored before 0128 (context NULL; the API falls back to their citations) untouched. But PostgreSQL enforces a NOT
--    VALID CHECK on every later INSERT AND UPDATE of a row; only the scan of existing rows is skipped. A suggestion is
--    UPDATEd when it is taken to a draft (proposed -> taken_to_draft), so every pre-0128 suggestion was refused there
--    (422 validation.constraint). Both CHECKs are replaced by BEFORE INSERT triggers of the SAME names, raising the same
--    SQLSTATE (23514 check_violation) with the same constraint name, so a NEW row without a context is refused exactly
--    as before, while an UPDATE of an old row (only a suggestion is ever updated; assistant_message is append-only,
--    0111) passes. The two tables keep one rule and one mechanism.
--      * assistant_message: an assistant `answer` needs a context (user messages and the other reply kinds keep NULL;
--        assistant_message_context_records_valid, 0128, still refuses a context on them).
--      * assistant_suggestion: every suggestion needs a context.
--    The immutability of a suggestion's context (assistant_suggestion_context_immutable, 0128) is unchanged, so an old
--    row can never be given a context later, and a new row's context can never be removed.
-- 2. F-DG6-960/970/980. A new answer's context now also lists the context of every earlier answer it was given as
--    history (inherited, transitively). The bound of one context is raised from 20 to 1,000 keys, the largest union one
--    conversation can produce: at most 100 messages, hence at most 50 answers, each given at most 20 record items
--    (0111 max_context_records <= 20), all of the same conversation. So a context is never truncated, and the read-time
--    re-check always sees every record an answer was generated from. The API also drops a history answer whose context
--    would not fit (fail closed), so the bound holds if those limits ever change. Every other rule of the shape is
--    unchanged (distinct {recordType, recordId} keys only; no version, title or text).
-- Rows stored before 0128 keep NULL. No existing row changes and no grant changes. Nothing here approves anything (no
-- business approval, G1-G6), and nothing reads or writes DG0-DG7.

-- ------------------------------------------------------------------------------------------------ the shape (bound)
CREATE OR REPLACE FUNCTION p6_assistant_context_records_valid(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_catalog, pg_temp AS $$
  SELECT jsonb_typeof(p) = 'array'
     AND jsonb_array_length(p) <= 1000
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
  'Assistant generation context (ADR-0059 §5, §9; F-DG6-920, F-DG6-960/970/980): at most 1,000 distinct {recordType, recordId} keys of the records given to the model, its own data block and the inherited context of the history answers given (0129).';

-- ------------------------------------------------------------------------------------------------ assistant_message
ALTER TABLE assistant_message DROP CONSTRAINT assistant_message_context_records_required;

CREATE FUNCTION assistant_message_context_records_required() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.author = 'assistant' AND NEW.reply_kind = 'answer' AND NEW.context_records IS NULL THEN
    RAISE EXCEPTION 'assistant_message: a new answer stores the records it was generated from (context_records)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assistant_message_context_records_required';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assistant_message_context_records_required BEFORE INSERT ON assistant_message
  FOR EACH ROW EXECUTE FUNCTION assistant_message_context_records_required();

-- ------------------------------------------------------------------------------------------------ assistant_suggestion
ALTER TABLE assistant_suggestion DROP CONSTRAINT assistant_suggestion_context_records_required;

CREATE FUNCTION assistant_suggestion_context_records_required() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.context_records IS NULL THEN
    RAISE EXCEPTION 'assistant_suggestion: a new suggestion stores the records its answer was generated from (context_records)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'assistant_suggestion_context_records_required';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assistant_suggestion_context_records_required BEFORE INSERT ON assistant_suggestion
  FOR EACH ROW EXECUTE FUNCTION assistant_suggestion_context_records_required();

COMMENT ON COLUMN assistant_message.context_records IS
  'T-DG6-BE-RG1/RG2 (F-DG6-920, F-DG6-960/970/980): record keys of every record the answer was generated from: each record item given to the model, then the inherited context of the history answers given; re-checked at read time with the citations. Required on every new answer (0129 BEFORE INSERT trigger); NULL on answers stored before 0128 (the citations are then the fallback). Never served.';
COMMENT ON COLUMN assistant_suggestion.context_records IS
  'T-DG6-BE-RG1/RG2 (F-DG6-920, F-DG6-960/970/980): the context of the answer this suggestion belongs to; re-checked at read time and at take-to-draft with the citations. Required on every new suggestion (0129 BEFORE INSERT trigger); NULL on suggestions stored before 0128 (the citations are then the fallback; such a row can still be taken to a draft). Never served; immutable.';
