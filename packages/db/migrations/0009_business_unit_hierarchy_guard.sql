-- 0009 database-level guard for the business-unit hierarchy (T-DG1-BE-R2, F-DG1-140; REQ-S19-004, ADR-0006).
-- Until now "no cycles, depth <= 10" was only an API check (0001 business_unit comment). It ran under READ COMMITTED
-- with no serialization, so two concurrent re-parents (A under C while B moves under A, with C under B) each passed
-- the check against the committed hierarchy and together committed the cycle A -> C -> B -> A.
--
-- This trigger makes the database refuse such a row, whatever the client and however the writes interleave:
--  1. SERIALIZE: every INSERT with a parent, and every change of parent_business_unit_id / organization_id, takes the
--     transaction-scoped advisory lock (HIERARCHY_LOCK_CLASS, hashtext(organization_id)). The API takes the SAME lock
--     before its own (friendly, 422) checks (organization/repository.ts lockBusinessUnitHierarchy), so in the
--     application the checks and the write are serialized per organization. A hash collision between two
--     organizations only serializes them more than needed; it never weakens the guard.
--  2. RE-CHECK after the write is applied (AFTER ROW, so a multi-row statement is checked on its final state) and
--     after the lock is held. Under READ COMMITTED every query below takes a fresh snapshot, so it sees what the
--     previous lock holder committed.
--  3. LOCKING WALK: the parent chain is walked with SELECT ... FOR SHARE. Under REPEATABLE READ / SERIALIZABLE (whose
--     snapshot may predate the lock) a chain row that a concurrent transaction changed raises a serialization failure
--     (40001) instead of being read stale, so the cycle check fails closed at every isolation level. The walk stops
--     after 10 levels, so even a pre-existing loop cannot make it spin.
--  Depth: parent levels + 1 + height of the moved subtree must stay <= 10 (MAX_BU_DEPTH = 9 below the organization in
--  organization/routes.ts). The subtree height is read without row locks: under READ COMMITTED it is serialized by the
--  lock (every insert with a parent takes it too); under REPEATABLE READ a concurrent child insert into the moved
--  subtree is a stated residual for DEPTH only (no cycle is possible through an insert: the FK is not deferrable, so
--  a new row can never be anyone's parent yet). The application uses READ COMMITTED.
-- Errors: SQLSTATE 23514 (check_violation) with constraint name business_unit_acyclic or business_unit_max_depth; the
-- API maps both to its existing business_unit.cycle / business_unit.depth_exceeded problems.

-- Refuse to install over a hierarchy that is already broken (fail loudly; an operator must repair the data first).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM business_unit_closure WHERE ancestor_id = descendant_id AND depth > 0) THEN
    RAISE EXCEPTION 'business_unit hierarchy already contains a cycle; repair it before applying 0009';
  END IF;
  IF EXISTS (SELECT 1 FROM business_unit_closure WHERE depth > 9) THEN
    RAISE EXCEPTION 'business_unit hierarchy is already deeper than 10 levels; repair it before applying 0009';
  END IF;
END $$;

CREATE FUNCTION business_unit_hierarchy_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- Advisory-lock class shared with the API (organization/repository.ts HIERARCHY_LOCK_CLASS).
  hierarchy_lock_class CONSTANT integer := 730219;
  max_levels CONSTANT integer := 10;
  cur uuid;
  parent_levels integer := 0;
  height integer;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.parent_business_unit_id IS NOT DISTINCT FROM OLD.parent_business_unit_id
     AND NEW.organization_id = OLD.organization_id THEN
    RETURN NULL;
  END IF;
  -- A root unit cannot close a cycle, and its depth (1 + height) cannot exceed what it already had below a parent.
  IF NEW.parent_business_unit_id IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hierarchy_lock_class, hashtext(NEW.organization_id::text));

  cur := NEW.parent_business_unit_id;
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION 'business unit % cannot be placed under its own descendant %', NEW.id, NEW.parent_business_unit_id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'business_unit_acyclic', TABLE = 'business_unit';
    END IF;
    parent_levels := parent_levels + 1;
    IF parent_levels >= max_levels THEN
      RAISE EXCEPTION 'business unit % would be nested deeper than % levels', NEW.id, max_levels
        USING ERRCODE = 'check_violation', CONSTRAINT = 'business_unit_max_depth', TABLE = 'business_unit';
    END IF;
    SELECT b.parent_business_unit_id INTO cur FROM business_unit b WHERE b.id = cur FOR SHARE;
  END LOOP;

  WITH RECURSIVE sub (id, d) AS (
    SELECT NEW.id, 0
    UNION ALL
    SELECT c.id, s.d + 1 FROM business_unit c JOIN sub s ON c.parent_business_unit_id = s.id WHERE s.d < max_levels
  )
  SELECT max(d) INTO height FROM sub;

  IF parent_levels + 1 + height > max_levels THEN
    RAISE EXCEPTION 'business unit % would be nested deeper than % levels', NEW.id, max_levels
      USING ERRCODE = 'check_violation', CONSTRAINT = 'business_unit_max_depth', TABLE = 'business_unit';
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER business_unit_hierarchy_guard
  AFTER INSERT OR UPDATE OF parent_business_unit_id, organization_id ON business_unit
  FOR EACH ROW EXECUTE FUNCTION business_unit_hierarchy_guard();

COMMENT ON FUNCTION business_unit_hierarchy_guard() IS
  'F-DG1-140: refuses a business_unit row that would close a cycle or nest deeper than 10 levels; serialized per organization by an advisory lock shared with the API.';
