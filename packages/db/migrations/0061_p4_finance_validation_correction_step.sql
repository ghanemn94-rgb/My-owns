-- 0061 P4 repair: a Finance correction steps the original validation's version (T-DG4-KBE-R5; F-DG4-101; D-117
-- "Every amendment or reversal bumps the original finance_validation row's version, in the same transaction under lock
-- 730233"). Repair range (D-089: 0058-0069 held for repairs). The number 0061 is PROPOSED by kpi-benefits-engineer as
-- the next free repair number; the orchestrator confirms or renumbers it at integration (p4-work-split §B: a schema
-- need goes to the orchestrator). Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only:
-- never edit once merged. SQL floor: PostgreSQL 16.
--
-- 0038's finance_validation_guard makes a decided validation final: any UPDATE of a row that is not queued raised
-- finance_validation_status_step. ADR-0030 §4 corrections never edit the original (an amendment or reversal is a NEW
-- pair of rows), but the original's version must step with each correction, or a correction made from a stale view is
-- accepted (F-DG4-101). This replaces the function with ONE added branch: an approved `validation` row that already
-- has a correction may step its version by exactly one, with every other column (decision, items, amounts, decider,
-- content) unchanged. Every other path of the function is 0038's, verbatim. The trigger itself is unchanged.
-- A Finance correction is a decision by a named Finance user inside the product; nothing here approves anything, and
-- nothing touches the engineering delivery gates DG0-DG7.
CREATE OR REPLACE FUNCTION finance_validation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  m record;
  movable text[] := ARRAY['status', 'baseline_decision', 'attribution_decision', 'calculation_decision', 'evidence_decision',
    'period_decision', 'assumptions_decision', 'baseline_note', 'attribution_note', 'calculation_note', 'evidence_note',
    'period_note', 'assumptions_note', 'approved_amount', 'decision_note', 'decided_by', 'decided_at', 'version',
    'updated_at', 'updated_by'];
BEGIN
  SELECT x.benefit_id, x.kind, x.status, x.amount, x.submitted_by, x.period_start, x.period_end INTO m
  FROM benefit_measurement x WHERE x.id = NEW.benefit_measurement_id;
  IF m.benefit_id IS DISTINCT FROM NEW.benefit_id THEN
    RAISE EXCEPTION 'finance_validation: the measurement belongs to another benefit'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'finance_validation_subject';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.kind = 'validation' AND (m.kind <> 'measurement' OR m.status <> 'submitted' OR NEW.status <> 'queued') THEN
      RAISE EXCEPTION 'finance_validation: a queue item is created queued, for a submitted measurement'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'finance_validation_subject';
    END IF;
    IF NEW.kind <> 'validation' AND (m.kind <> NEW.kind OR NOT EXISTS (
        SELECT 1 FROM finance_validation v WHERE v.id = NEW.corrects_validation_id AND v.kind = 'validation' AND v.status = 'approved'
          AND v.benefit_id = NEW.benefit_id)) THEN
      RAISE EXCEPTION 'finance_validation: a correction links its own % row to an approved validation of the same benefit', NEW.kind
        USING ERRCODE = 'check_violation', CONSTRAINT = 'finance_validation_subject';
    END IF;
    IF (NEW.measurement_period_start, NEW.measurement_period_end) IS DISTINCT FROM (m.period_start, m.period_end) THEN
      RAISE EXCEPTION 'finance_validation: the measurement period is the measurement''s own'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'finance_validation_period_required';
    END IF;
    RETURN NEW;
  END IF;
  -- 0061 (F-DG4-101): a correction steps the ORIGINAL approved validation's version and nothing else, so If-Match on
  -- the original names the chain's current state. Allowed only for an approved validation that already has a
  -- correction row, by exactly one version, with every other column unchanged.
  IF OLD.kind = 'validation' AND OLD.status = 'approved' AND NEW.version = OLD.version + 1
     AND (to_jsonb(NEW) - ARRAY['version', 'updated_at', 'updated_by']) = (to_jsonb(OLD) - ARRAY['version', 'updated_at', 'updated_by'])
     AND EXISTS (SELECT 1 FROM finance_validation c WHERE c.corrects_validation_id = OLD.id) THEN
    RETURN NEW;
  END IF;
  IF OLD.status <> 'queued' OR NEW.status NOT IN ('queued', 'approved', 'rejected', 'withdrawn') THEN
    RAISE EXCEPTION 'finance_validation %: % is final', OLD.id, OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'finance_validation_status_step';
  END IF;
  IF (to_jsonb(NEW) - movable) IS DISTINCT FROM (to_jsonb(OLD) - movable) THEN
    RAISE EXCEPTION 'finance_validation %: the queued content is an immutable snapshot', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'finance_validation_frozen';
  END IF;
  -- REQ-PB-013 / SoD: the validator is never the person who submitted the value.
  IF NEW.decided_by IS NOT NULL AND NEW.decided_by = m.submitted_by THEN
    RAISE EXCEPTION 'finance_validation %: the submitter cannot validate their own submission', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'finance_validation_sod';
  END IF;
  IF NEW.status = 'approved' AND (NEW.approved_amount IS NULL) <> (m.amount IS NULL) THEN
    RAISE EXCEPTION 'finance_validation %: an approved financial value states its approved amount; a non-financial one has none', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'finance_validation_amount_shape';
  END IF;
  RETURN NEW;
END $$;
