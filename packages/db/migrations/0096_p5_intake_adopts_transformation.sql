-- 0096 P5 repair (T-DG5-BE-T4; D-166 Rule A; D-QA-E-2; REQ-S06-003): the intake adopts the transformation it
-- produced. Authored by backend-workflow-engineer. Forward-only and additive: never edit once merged. Runs as mth_owner
-- inside one transaction opened by `mth-db migrate`. SQL floor: PostgreSQL 16.
--
-- Why: the steps of an organization-scope `new_transformation_intake` instance carry no transformation, so its approval
-- step (`confirm_sponsor`) can never be requested: the DG4 approval guard (0031 p4_approval_subject_version) needs the
-- subject's transformation. The P2 identity guard (0010 p2_row_guard, attached to procedure_step_instance by 0069)
-- makes `procedure_step_instance.transformation_id` immutable.
--
-- What (D-166 Rule A, exactly): the trigger `procedure_step_instance_row_guard` keeps its name and every P2 rule
-- (INSERT: version 1 and the organization of its transformation; UPDATE: id, organization_id, created_at and
-- created_by immutable, version + 1), and replaces p2_row_guard on THIS table only with a function that allows ONE
-- change of `transformation_id`, the adoption:
--   - from NULL to T (never from a transformation, so once and never to another one);
--   - of a step that has not started: `pending` before and after, and nothing else of the row changes except
--     version (+ 1), updated_at and updated_by;
--   - of an ACTIVE instance whose own transformation_id is NULL (organization scope; it keeps that scope) and whose
--     procedure is `new_transformation_intake`;
--   - only to the transformation T named by that instance's `capture_intake` output link (link_kind 'output',
--     record_type 'transformation', on the instance's COMPLETED `capture_intake` step), in the instance's organization.
-- Every other change of transformation_id is refused as before, with the same constraint name
-- (procedure_step_instance_identity_immutable). The deferred audit guard (procedure_step_instance_audit_required) is
-- unchanged, so every adoption has its audit event. p2_row_guard itself is unchanged for every other table.
--
-- Nothing here grants a business, Finance or IT approval, and nothing reads or writes the engineering gates DG0-DG7.

CREATE FUNCTION procedure_step_instance_row_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  t_org uuid;
  adoptable boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 THEN
      RAISE EXCEPTION '%: a new row starts at version 1', TG_TABLE_NAME
        USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_version_step';
    END IF;
    IF NEW.transformation_id IS NOT NULL THEN
      SELECT t.organization_id INTO t_org FROM transformation t WHERE t.id = NEW.transformation_id;
      -- A missing transformation is left to the foreign key, which reports it precisely.
      IF FOUND AND t_org IS DISTINCT FROM NEW.organization_id THEN
        RAISE EXCEPTION '%: organization_id must equal the transformation''s organization', TG_TABLE_NAME
          USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_organization_matches';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION '%: id, organization_id, transformation_id, created_at and created_by are immutable', TG_TABLE_NAME
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_identity_immutable';
  END IF;

  IF NEW.transformation_id IS DISTINCT FROM OLD.transformation_id THEN
    -- D-166 Rule A: the only allowed change (see the header).
    adoptable := OLD.transformation_id IS NULL
      AND NEW.transformation_id IS NOT NULL
      AND OLD.status = 'pending' AND NEW.status = 'pending'
      AND (to_jsonb(NEW) - ARRAY['transformation_id', 'version', 'updated_at', 'updated_by'])
          = (to_jsonb(OLD) - ARRAY['transformation_id', 'version', 'updated_at', 'updated_by'])
      AND EXISTS (
        SELECT 1 FROM procedure_instance pi
         WHERE pi.id = NEW.procedure_instance_id
           AND pi.transformation_id IS NULL
           AND pi.status = 'active'
           AND pi.procedure_code = 'new_transformation_intake'
           AND pi.organization_id = NEW.organization_id)
      AND EXISTS (
        SELECT 1 FROM procedure_instance_link l
          JOIN procedure_step_instance c ON c.id = l.step_instance_id
          JOIN transformation t ON t.id = l.record_id
         WHERE l.procedure_instance_id = NEW.procedure_instance_id
           AND l.link_kind = 'output'
           AND l.record_type = 'transformation'
           AND l.record_id = NEW.transformation_id
           AND c.procedure_instance_id = NEW.procedure_instance_id
           AND c.step_key = 'capture_intake'
           AND c.status = 'completed'
           AND t.organization_id = NEW.organization_id);
    IF NOT coalesce(adoptable, false) THEN
      RAISE EXCEPTION '%: id, organization_id, transformation_id, created_at and created_by are immutable', TG_TABLE_NAME
        USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_identity_immutable';
    END IF;
  END IF;

  IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
    RAISE EXCEPTION '%: version must increase by exactly 1 on every update (optimistic concurrency, ADR-0003)', TG_TABLE_NAME
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_version_step';
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION procedure_step_instance_row_guard() IS
  'p2_row_guard for procedure_step_instance, with the one D-166 Rule A exception: a pending step of an active organization-scope new_transformation_intake instance adopts, once, the transformation its completed capture_intake step linked.';
REVOKE ALL ON FUNCTION procedure_step_instance_row_guard() FROM PUBLIC;

DROP TRIGGER procedure_step_instance_row_guard ON procedure_step_instance;
CREATE TRIGGER procedure_step_instance_row_guard BEFORE INSERT OR UPDATE ON procedure_step_instance
  FOR EACH ROW EXECUTE FUNCTION procedure_step_instance_row_guard();
