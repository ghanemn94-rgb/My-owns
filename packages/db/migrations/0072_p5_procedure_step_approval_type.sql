-- 0072 P5 slice C: the canonical approval type of a procedure approval step (T-DG5-BE-F2; p5-work-split §B.5 as
-- renumbered by D-145 (BE-F2 -> 0072); ADR-0042 §2 "an approval step ... is completed only through an approved canonical
-- approval (ADR-0026) created for the step"; REQ-S06-002). Authored by backend-workflow-engineer. Runs as mth_owner
-- inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- The 0069 guard procedure_step_instance_approval lets an approval step complete only with `approval_id` naming an
-- APPROVED row of `approval`, and an `approval` row needs an `approval_type` whose `subject_table` holds the subject's
-- (id, transformation_id, version) (0031 p4_approval_subject_version). No migration declared one for procedure steps, so
-- this adds it: the subject is the step instance itself, at the version it had when the step activated. The step row
-- does not change while its approval is open (the API refuses to reassign an active approval step, and `approval_id`
-- is written by the same update that completes the step after the approval is approved), so the 0031 stale rules apply
-- unchanged: a step cancelled in the meantime makes its undecided approval stale, and it can no longer be decided.
--
-- requester_excluded: the person whose action activated the approval step (the requester) never decides it
-- (REQ-S10-016 separation of duties, ADR-0026 §4). requires_decision_right false: a procedure approval step names its
-- business approver role (procedure_step_definition.approval_role_code), routed through the transformation's party
-- mapping (ADR-0026 §2). Additive row only: no table, column, CHECK or trigger changes. The approval is a BUSINESS
-- approval decided by a person inside the product; nothing here approves anything and nothing touches DG0-DG7.
INSERT INTO approval_type (code, subject_table, default_sod_policy, requires_decision_right, owner_module, label_en, label_ar, source_ref) VALUES
  ('procedure_step', 'procedure_step_instance', 'requester_excluded', false, 'procedures',
   'Business approval step of a procedure', 'خطوة موافقة عمل في إجراء', 'M0152;M0153');

-- -----------------------------------------------------------------------------------------------------------------
-- The completion rule of an `advance` output (ADR-0042 §3 "advance performs the owning module's existing action on the
-- record the instance already produced"; REQ-S06-002 "completing it creates a validated baseline record linked to the
-- instance"). 0069 requires every completed step with an expected output to have a link of its own
-- (l.step_instance_id = s.id), but procedure_instance_link is UNIQUE (procedure_instance_id, link_kind, record_type,
-- record_id): the `advance` step of baseline_validation (validate_baseline, on the baseline record_baseline created)
-- can never get a second link to the same record, so the instance could never complete. This redefines the guard
-- function, keeping every 0069 rule verbatim except that clause: a completed `advance` step is satisfied by the
-- instance's output link of its record type. The trigger procedure_instance_guard (0069) keeps calling the function;
-- no table, column, CHECK or trigger changes. 0069 is not edited.
CREATE OR REPLACE FUNCTION procedure_instance_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  d record;
  frozen text[] := ARRAY['procedure_definition_id', 'methodology_version_id', 'procedure_code', 'subject_record_type',
                         'subject_record_id', 'launch_key', 'launched_by', 'launched_at'];
  f text;
BEGIN
  SELECT pd.code, pd.scope_level, pd.removed, pd.input_schema, pd.completion_rule, m.status AS version_status
    INTO d FROM procedure_definition pd JOIN methodology_version m ON m.id = pd.methodology_version_id
   WHERE pd.id = NEW.procedure_definition_id;
  IF TG_OP = 'INSERT' THEN
    IF d.version_status <> 'published' OR d.removed OR NEW.status <> 'active' OR NEW.procedure_code <> d.code THEN
      RAISE EXCEPTION 'procedure_instance %: an instance starts active, from a published, not removed definition (its code)', NEW.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_instance_launch';
    END IF;
    IF (d.scope_level = 'organization') <> (NEW.transformation_id IS NULL) THEN
      RAISE EXCEPTION 'procedure_instance %: a transformation-scope procedure runs in a transformation; an organization-scope one does not', NEW.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_instance_scope';
    END IF;
  ELSE
    FOREACH f IN ARRAY frozen LOOP
      IF to_jsonb(NEW)->f IS DISTINCT FROM to_jsonb(OLD)->f THEN
        RAISE EXCEPTION 'procedure_instance %: % never changes (the instance stays pinned)', OLD.id, f
          USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_instance_pinned';
      END IF;
    END LOOP;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY['active>completed', 'active>cancelled']) THEN
      RAISE EXCEPTION 'procedure_instance %: % -> % is not a legal transition', OLD.id, OLD.status, NEW.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_instance_status_transition';
    END IF;
    IF OLD.status <> 'active' AND NEW.input_values IS DISTINCT FROM OLD.input_values THEN
      RAISE EXCEPTION 'procedure_instance %: inputs change only while the instance is active', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_instance_status_transition';
    END IF;
    IF NEW.status = 'completed' AND OLD.status = 'active' THEN
      IF EXISTS (SELECT 1 FROM procedure_step_instance s WHERE s.procedure_instance_id = NEW.id AND s.status IN ('pending', 'active')) THEN
        RAISE EXCEPTION 'procedure_instance %: every step must be closed before the instance completes', OLD.id
          USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_instance_completion';
      END IF;
      IF d.completion_rule = 'all_steps_closed_and_outputs_linked' AND EXISTS (
           SELECT 1 FROM procedure_step_instance s JOIN procedure_step_definition sd ON sd.id = s.step_definition_id
            WHERE s.procedure_instance_id = NEW.id AND s.status = 'completed' AND sd.output_record_type IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM procedure_instance_link l WHERE l.step_instance_id = s.id AND l.record_type = sd.output_record_type)
              -- 0072: an `advance` step acts on the record an earlier step of the instance produced; that record's
              -- output link (UNIQUE per instance, kind, type and record) is its output.
              AND NOT (sd.output_mode = 'advance' AND EXISTS (SELECT 1 FROM procedure_instance_link l
                         WHERE l.procedure_instance_id = NEW.id AND l.link_kind = 'output' AND l.record_type = sd.output_record_type))) THEN
        RAISE EXCEPTION 'procedure_instance %: every completed step with an expected output must link its output record', OLD.id
          USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_instance_completion';
      END IF;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(NEW.input_values) AS k(key)
             WHERE NOT k.key = ANY (ARRAY(SELECT f2->>'key' FROM jsonb_array_elements(d.input_schema) AS f2))) THEN
    RAISE EXCEPTION 'procedure_instance %: an input value names an input the pinned definition does not declare', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_instance_inputs';
  END IF;
  RETURN NEW;
END $$;
