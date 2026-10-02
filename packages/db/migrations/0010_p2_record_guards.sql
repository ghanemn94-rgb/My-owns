-- 0010 P2 record guards (T-DG2-ARCH-01; ADR-0016, ADR-0003, ADR-0004). Authored by solution-architect.
-- Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged.
-- SQL floor: PostgreSQL 16 (no uuidv7(), no virtual generated columns).
--
-- Table-agnostic guards that every P2 business table attaches (p2_attach_guards below) in its own migration:
--   p2_row_guard()        BEFORE INSERT OR UPDATE, row level:
--                           INSERT: version must be 1, and organization_id must equal the parent transformation's;
--                           UPDATE: id, organization_id, transformation_id, created_at and created_by are immutable,
--                                   and version must step by exactly 1 (ADR-0003 optimistic concurrency).
--   p2_audit_required()   deferred CONSTRAINT trigger AFTER INSERT OR UPDATE: at COMMIT, an audit_event for
--                         (record_type = the table name, record_id = id, new_version = version) must exist. A P2
--                         mutation without its audit event therefore cannot commit (ADR-0004 coverage rule, enforced
--                         by the database as well as by the tests). Tables without a version column need an event
--                         for the record id.
--   p2_append_only()      history and snapshot tables: UPDATE, DELETE and TRUNCATE raise (like audit_event).
--   p2_record_ref_guard() polymorphic (record_type, record_id) references must name an existing row of that table in
--                         the same transformation (evidence links, workstream outputs).
--   mth_uuid_v7()         UUIDv7 in SQL. Used ONLY by p2_instantiate_transformation() (0018) and migration backfills;
--                         columns never get it as a default (ADR-0003: ids come from the application).
-- None of these replace the API checks; they are the last line of defence (REQ-S16-023, REQ-S16-026, REQ-S16-032).

CREATE FUNCTION mth_uuid_v7() RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  unix_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000);
  b bytea := uuid_send(gen_random_uuid()); -- 122 random bits, RFC 9562 variant already set
BEGIN
  b := overlay(b PLACING substring(int8send(unix_ms) FROM 3) FROM 1 FOR 6); -- 48-bit big-endian millisecond timestamp
  b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112);                          -- version 7
  RETURN encode(b, 'hex')::uuid;
END $$;
COMMENT ON FUNCTION mth_uuid_v7() IS
  'RFC 9562 UUIDv7 for rows created inside SQL (p2_instantiate_transformation, backfills). Never a column default.';

CREATE FUNCTION p2_row_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  n jsonb := to_jsonb(NEW);
  o jsonb;
  t_org uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF n ? 'version' AND (n->>'version')::integer <> 1 THEN
      RAISE EXCEPTION '%: a new row starts at version 1', TG_TABLE_NAME
        USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_version_step';
    END IF;
    IF n ? 'transformation_id' AND n ? 'organization_id' THEN
      SELECT t.organization_id INTO t_org FROM transformation t WHERE t.id = (n->>'transformation_id')::uuid;
      -- A missing transformation is left to the foreign key, which reports it precisely.
      IF FOUND AND t_org IS DISTINCT FROM (n->>'organization_id')::uuid THEN
        RAISE EXCEPTION '%: organization_id must equal the transformation''s organization', TG_TABLE_NAME
          USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_organization_matches';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  o := to_jsonb(OLD);
  IF n->'id' IS DISTINCT FROM o->'id'
     OR n->'organization_id' IS DISTINCT FROM o->'organization_id'
     OR n->'transformation_id' IS DISTINCT FROM o->'transformation_id'
     OR n->'created_at' IS DISTINCT FROM o->'created_at'
     OR n->'created_by' IS DISTINCT FROM o->'created_by' THEN
    RAISE EXCEPTION '%: id, organization_id, transformation_id, created_at and created_by are immutable', TG_TABLE_NAME
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_identity_immutable';
  END IF;
  IF o ? 'version' AND (n->>'version')::integer IS DISTINCT FROM (o->>'version')::integer + 1 THEN
    RAISE EXCEPTION '%: version must increase by exactly 1 on every update (optimistic concurrency, ADR-0003)', TG_TABLE_NAME
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_version_step';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION p2_audit_required() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  n jsonb := to_jsonb(NEW);
  rid uuid := (n->>'id')::uuid;
  v integer := (n->>'version')::integer; -- NULL for tables without a version column
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM audit_event a
    WHERE a.record_type = TG_TABLE_NAME AND a.record_id = rid AND (v IS NULL OR a.new_version = v)
  ) THEN
    RAISE EXCEPTION 'no audit_event for % % at version % (ADR-0004: every mutation writes its audit event in the same transaction)',
      TG_TABLE_NAME, rid, coalesce(v::text, '-')
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = TG_TABLE_NAME || '_audit_required';
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION p2_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

-- The polymorphic targets. Every listed table has (id uuid, transformation_id uuid). Each referencing table narrows
-- the list further with its own CHECK on record_type.
CREATE FUNCTION p2_record_ref_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  n jsonb := to_jsonb(NEW);
  rtype text := n->>'record_type';
  found_it boolean;
BEGIN
  IF n->>'record_id' IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT rtype = ANY (ARRAY[
      'charter', 'north_star', 'strategic_guardrail', 'outcome', 'kpi_definition', 'baseline', 'outcome_kpi',
      'value_pool', 'diagnostic_item', 'diagnostic_finding', 'diagnostic_workstream_output', 'tom_canvas_cell',
      'tom_gap', 'capability', 'journey', 'journey_pain_point', 'decision', 'dependency', 'tom_workshop',
      'action_item']) THEN
    RAISE EXCEPTION '%: record_type % cannot be linked', TG_TABLE_NAME, rtype
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_record_type';
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND transformation_id = $2)', rtype)
    INTO found_it USING (n->>'record_id')::uuid, (n->>'transformation_id')::uuid;
  IF NOT found_it THEN
    RAISE EXCEPTION '%: % % does not exist in transformation %', TG_TABLE_NAME, rtype, n->>'record_id', n->>'transformation_id'
      USING ERRCODE = 'foreign_key_violation', CONSTRAINT = TG_TABLE_NAME || '_record_ref';
  END IF;
  RETURN NEW;
END $$;

-- Attaches p2_row_guard (always) and the deferred p2_audit_required constraint trigger (when audited) to a table.
-- Owner-only: used by migrations.
CREATE FUNCTION p2_attach_guards(tbl regclass, audited boolean) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  t text := (SELECT c.relname FROM pg_class c WHERE c.oid = tbl);
BEGIN
  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION p2_row_guard()',
                 t || '_row_guard', t);
  IF audited THEN
    EXECUTE format('CREATE CONSTRAINT TRIGGER %I AFTER INSERT OR UPDATE ON %I DEFERRABLE INITIALLY DEFERRED '
                   'FOR EACH ROW EXECUTE FUNCTION p2_audit_required()', t || '_audit_required', t);
  END IF;
END $$;

-- Attaches p2_append_only to a history/snapshot table (row-level UPDATE/DELETE and statement-level TRUNCATE).
CREATE FUNCTION p2_attach_append_only(tbl regclass) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  t text := (SELECT c.relname FROM pg_class c WHERE c.oid = tbl);
BEGIN
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION p2_append_only()',
                 t || '_append_only', t);
  EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION p2_append_only()',
                 t || '_append_only_truncate', t);
END $$;

REVOKE ALL ON FUNCTION p2_attach_guards(regclass, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION p2_attach_append_only(regclass) FROM PUBLIC;
REVOKE ALL ON FUNCTION mth_uuid_v7() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mth_uuid_v7() TO mth_app;
