-- 0059 P4 enable product gates G5 (Scale) and G6 (Sustain) (T-DG4-BE-K; ADR-0035 §2 "Enabling"; REQ-PB-015,
-- REQ-PB-020, REQ-PB-021, REQ-S04-007, REQ-S04-008). Repair range (D-089: 0058-0069 held for repairs), number 0059
-- assigned to T-DG4-BE-K by the orchestrator. Authored by backend-workflow-engineer. Runs as mth_owner inside one
-- transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- 0051 seeded the eight g5.*/g6.* criteria but left G5 and G6 closed (probe G05), so the DG2 refusal
-- `gate_not_enabled` held until the evaluators existed. They ship with this migration (apps/api workflows/g5.ts and
-- workflows/g6.ts): G5 and G6 become submittable through the existing ADR-0015 gate path. A submission with any
-- mandatory incomplete criterion is still refused (422 gate_criteria_incomplete, naming the criterion labels), and the
-- decision is a person's: the configured approver (SP by default; G5 may be configured to BO), never the submitter.
-- G1-G6 are BUSINESS approvals inside the product. Enabling submission approves nothing, and nothing here touches the
-- engineering delivery gates DG0-DG7 (an approved G6 never implies DG7).

UPDATE gate_definition
   SET submission_enabled = true,
       version = version + 1,
       updated_at = now()
 WHERE code IN ('G5', 'G6')
   AND submission_enabled = false;

DO $$
BEGIN
  IF (SELECT count(*) FROM gate_definition WHERE code IN ('G5', 'G6') AND submission_enabled) <> 2 THEN
    RAISE EXCEPTION '0059: gate_definition G5/G6 are missing or not enabled';
  END IF;
  IF (SELECT count(*) FROM gate_criterion_definition c JOIN gate_definition d ON d.id = c.gate_definition_id
       WHERE d.code = 'G5' AND c.mandatory) <> 4
     OR (SELECT count(*) FROM gate_criterion_definition c JOIN gate_definition d ON d.id = c.gate_definition_id
       WHERE d.code = 'G6' AND c.mandatory) <> 4 THEN
    RAISE EXCEPTION '0059: G5 and G6 must each carry their four mandatory 0051 criteria before they are enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM gate_definition WHERE code = 'G6' AND next_phase IS NOT NULL) THEN
    RAISE EXCEPTION '0059: G6 must have no next phase (its approval changes no phase and closes nothing)';
  END IF;
END $$;

-- risk_disposition is the subject of the canonical approval type `risk_disposition` (0053; ADR-0035 §6). The approval
-- guard (0031 approval_guard -> p4_approval_subject_version) reads the subject's version with SELECT ... FOR SHARE,
-- which PostgreSQL allows only with UPDATE privilege on at least one column. 0051 granted mth_app SELECT, INSERT only,
-- so every approval request on a disposition failed with insufficient_privilege. The column-level grant below lets the
-- row lock be taken; the row stays immutable: the 0051 append-only trigger refuses every UPDATE and `version` is
-- CHECKed = 1. Table-level privileges are unchanged (still INSERT, SELECT).
GRANT UPDATE (version) ON risk_disposition TO mth_app;
