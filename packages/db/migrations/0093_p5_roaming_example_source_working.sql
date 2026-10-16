-- 0093 (P5 slice J; ADR-0050 §6 step 4; p5-work-split §A rule A-7 and §J.2; T-DG5-BE-T). Forward-only.
--
-- Rule A-7 (source inventory): when a P5 feature ships, the source_element rows it implements move from 'planned' to
-- 'working', so the source-coverage report (ADR-0039 §6) stays true for the release (F-DG4-160). The demo dataset
-- `international_roaming` 1.0.0 has shipped (packages/db/src/demo/data/**: the roaming transformation with the seven
-- B0145 elements verbatim, the three B0147 chains in the DG4 traceability model, and a complete seed-coverage check),
-- so set 'roaming_example' (1 row, B0143 "Example — International Roaming Transformation") moves to 'working'.
--
-- Only that one row changes: the texts stay verbatim, the identity and ordinal stay, and no row is added or removed.
-- This migration writes no demo record, no demo user and no deployment marker (the dataset is written only by
-- `mth-db seed-demo` into a separately initialized demo database, ADR-0050 §1). Nothing here is a business approval,
-- and nothing touches the engineering gates DG0-DG7.

DO $$
DECLARE
  moved integer;
BEGIN
  UPDATE source_element
     SET feature_status = 'working'
   WHERE set_code = 'roaming_example' AND stable_key = 'international_roaming'
     AND feature_status = 'planned';
  GET DIAGNOSTICS moved = ROW_COUNT;
  IF moved <> 1 THEN
    RAISE EXCEPTION '0093: expected to move the roaming example (1 row), moved %', moved;
  END IF;
  IF EXISTS (SELECT 1 FROM source_element WHERE set_code = 'roaming_example' AND feature_status <> 'working') THEN
    RAISE EXCEPTION '0093: a roaming example element is still planned';
  END IF;
END $$;
