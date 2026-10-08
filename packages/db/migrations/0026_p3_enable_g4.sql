-- 0026 P3 enable product gate G4 (T-DG3-BE-E; ADR-0021 §7; REQ-PB-019, REQ-S04-006). Authored by
-- backend-workflow-engineer. Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never
-- edit once merged. SQL floor: PostgreSQL 16.
--
-- 0024 seeded the eight g4.* criteria but left G4 closed, so the DG2 API stayed unchanged until the G4 evaluators
-- (apps/api workflows/g4.ts) existed. They ship with this migration: G4 becomes submittable through the existing
-- ADR-0015 gate path. A submission with any incomplete criterion is still refused (422 gate_criteria_incomplete), and
-- the decision is a person's: the configured approver (SP by default), never the submitter.
-- G1-G6 are BUSINESS approvals inside the product. Enabling submission approves nothing, and nothing here touches the
-- engineering delivery gates DG0-DG7. G5 and G6 stay closed (later stages).

UPDATE gate_definition
   SET submission_enabled = true,
       version = version + 1,
       updated_at = now()
 WHERE code = 'G4'
   AND submission_enabled = false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM gate_definition WHERE code = 'G4' AND submission_enabled) THEN
    RAISE EXCEPTION '0026: gate_definition G4 is missing or not enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM gate_definition WHERE code IN ('G5', 'G6') AND submission_enabled) THEN
    RAISE EXCEPTION '0026: G5/G6 must stay closed in P3';
  END IF;
END $$;
