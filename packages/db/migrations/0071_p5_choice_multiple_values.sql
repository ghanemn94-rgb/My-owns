-- 0071 P5 slice B: a `choice` extension field with `multiple: true` stores a list of options (T-DG5-BE-D; D-145 item 1;
-- ADR-0041 §3 "`choice` ... one `value` (or an array when `multiple: true`)"; REQ-S06-005, REQ-S16-010).
-- Authored by backend-workflow-engineer. Runs as mth_owner inside one transaction opened by `mth-db migrate`.
-- Forward-only: never edit once merged; 0068 is not edited. SQL floor: PostgreSQL 16.
--
-- 0068's last-line-of-defence guard form_custom_value_guard() accepted only a string for a `choice` value, so the
-- validated array of a multiple-choice field (packages/shared/src/forms/validate.ts, KBE-B) could not be stored. This
-- migration redefines the function, keeping every 0068 rule verbatim except the `choice` clause, which becomes:
--   * the field's settings say `multiple: true`  -> a non-empty JSON array of unique strings of 1-100 characters;
--   * otherwise (absent or false)                -> a string of 1-100 characters (unchanged).
-- The trigger form_custom_value_guard (0068) keeps calling the function; no table, column, CHECK or trigger changes.
-- Nothing here reads or writes the engineering gates DG0-DG7; no row here is a business approval.
CREATE OR REPLACE FUNCTION form_custom_value_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  k text;
  val jsonb;
  ftype text;
  fmultiple boolean;
  dec text := '^-?[0-9]{1,15}(\.[0-9]{1,6})?$';
BEGIN
  IF NOT (SELECT f.custom_fields_allowed FROM form_record_type f WHERE f.code = NEW.record_type) THEN
    RAISE EXCEPTION 'form_custom_value %: record type % takes no extension fields', NEW.id, NEW.record_type
      USING ERRCODE = 'check_violation', CONSTRAINT = 'form_custom_value_record_type';
  END IF;
  IF NEW.form_schema_version_id IS DISTINCT FROM p5_form_schema_version_for(NEW.transformation_id) THEN
    RAISE EXCEPTION 'form_custom_value %: values are validated against the form schema version the transformation is pinned to', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'form_custom_value_pinned_version';
  END IF;
  FOR k, val IN SELECT e.key, e.value FROM jsonb_each(NEW.field_values) AS e LOOP
    ftype := NULL;
    fmultiple := false;
    -- 0071: the field's `multiple` setting is read with its type (a JSON true only; anything else is single).
    SELECT m.attributes->>'fieldType', coalesce(m.attributes->'multiple' = 'true'::jsonb, false) INTO ftype, fmultiple
      FROM methodology_element m
     WHERE m.methodology_version_id = NEW.form_schema_version_id AND m.element_type = 'form_field'
       AND m.stable_key = NEW.record_type || '.' || k AND m.origin = 'admin' AND NOT m.removed;
    IF ftype IS NULL THEN
      RAISE EXCEPTION 'form_custom_value %: % is not an extension field of % in the pinned form schema version', NEW.id, k, NEW.record_type
        USING ERRCODE = 'check_violation', CONSTRAINT = 'form_custom_value_unknown_field';
    END IF;
    IF jsonb_typeof(val) <> 'null' AND NOT (CASE ftype
         WHEN 'text' THEN jsonb_typeof(val) = 'string' AND char_length(val #>> '{}') BETWEEN 1 AND 2000
         WHEN 'rich_text' THEN jsonb_typeof(val) = 'string' AND char_length(val #>> '{}') BETWEEN 1 AND 20000
         WHEN 'number' THEN jsonb_typeof(val) = 'string' AND (val #>> '{}') ~ dec
         WHEN 'percentage' THEN jsonb_typeof(val) = 'string' AND (val #>> '{}') ~ dec
         WHEN 'currency' THEN jsonb_typeof(val) = 'object' AND jsonb_typeof(val->'amount') = 'string'
                              AND (val->>'amount') ~ dec AND coalesce(val->>'currencyCode', '') ~ '^[A-Z]{3}$'
                              AND (SELECT count(*) FROM jsonb_object_keys(val)) = 2
         WHEN 'date' THEN jsonb_typeof(val) = 'string' AND (val #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         WHEN 'reference' THEN jsonb_typeof(val) = 'string'
                               AND (val #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         WHEN 'attachment' THEN jsonb_typeof(val) = 'array' AND jsonb_array_length(val) <= 20
         WHEN 'lookup' THEN jsonb_typeof(val) = 'string' AND char_length(val #>> '{}') BETWEEN 1 AND 100
         -- 0071: single choice = one string; multiple choice = a non-empty array of unique strings of 1-100 characters.
         WHEN 'choice' THEN CASE WHEN fmultiple THEN
                                   jsonb_typeof(val) = 'array' AND jsonb_array_length(val) >= 1
                                   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(val) AS x(item)
                                                    WHERE jsonb_typeof(x.item) <> 'string'
                                                       OR char_length(x.item #>> '{}') NOT BETWEEN 1 AND 100)
                                   AND (SELECT count(DISTINCT x.item) FROM jsonb_array_elements(val) AS x(item))
                                       = jsonb_array_length(val)
                                 ELSE jsonb_typeof(val) = 'string' AND char_length(val #>> '{}') BETWEEN 1 AND 100 END
         ELSE false END) THEN
      RAISE EXCEPTION 'form_custom_value %: the value of % does not have the shape of a % field (ADR-0041 §3)', NEW.id, k, ftype
        USING ERRCODE = 'check_violation', CONSTRAINT = 'form_custom_value_type_shape';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
