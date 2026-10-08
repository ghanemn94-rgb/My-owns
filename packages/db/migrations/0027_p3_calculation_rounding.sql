-- 0027 P3 calculation rounding record on the lineage row (T-DG3-ARCH-04; ADR-0024 §6 item 11; REQ-PB-056,
-- REQ-S08-007). Authored by solution-architect. Runs as mth_owner inside one transaction opened by `mth-db migrate`.
-- Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- ADR-0024 §6 item 11 says the engine's full rounding record
--   {column, scale, mode, precision, exact, stored, rounded, inexactIntermediate}
-- is stored in the benefit_calculation lineage as is. 0023 gave the row only `rounded boolean`; the full record was
-- kept only in the row's audit event (`changes.rounding.to`). This migration adds the column, so the row carries it.
--
-- NULL means only one thing: the row was written BEFORE this migration. Every row written from 0027 on carries the
-- record. That is enforced, not just intended: `benefit_calculation_rounding_required` is a CHECK added NOT VALID, so
-- PostgreSQL enforces it on every new row and does not check the rows that already exist.
--
-- No backfill (decision, ADR-0024 §6 item 11):
--   - benefit_calculation is append-only (0023: p2_attach_append_only). A backfill would have to disable the trigger
--     and rewrite immutable lineage rows. That would weaken the guarantee the table exists to give.
--   - Nothing is lost without one. Each pre-0027 row's record is in its own `benefit_calculation.create` audit event,
--     written in the same transaction as the row, and audit_event is append-only as well.
--   - P3 is not released (DG3 is building), so no production database holds such rows. A fresh database has none.
--     Only development or demo databases migrated through 0023-0026 can have them, and their API answer is
--     `rounding: null` (documented in the contract), never a reconstructed value.
--
-- The CHECKs bind the record to the row's own columns, so the two can never disagree: `rounded` equals the column,
-- and `stored` is the stored result as text (numeric(24,6) prints exactly the engine's 6-digit form) or JSON null
-- when the result is Unknown.

ALTER TABLE benefit_calculation
  ADD COLUMN rounding jsonb NULL CHECK (rounding IS NULL OR jsonb_typeof(rounding) = 'object');

ALTER TABLE benefit_calculation
  ADD CONSTRAINT benefit_calculation_rounding_shape CHECK (
    rounding IS NULL OR (
      rounding ?& ARRAY['column', 'scale', 'mode', 'precision', 'exact', 'stored', 'rounded', 'inexactIntermediate']
      AND rounding -> 'column' = '"numeric(24,6)"'::jsonb
      AND rounding -> 'scale' = '6'::jsonb
      AND rounding -> 'mode' = '"ROUND_HALF_UP"'::jsonb
      AND rounding -> 'precision' = '80'::jsonb
      AND jsonb_typeof(rounding -> 'exact') IN ('string', 'null')
      AND jsonb_typeof(rounding -> 'inexactIntermediate') = 'boolean'
      AND rounding -> 'rounded' = to_jsonb(rounded)
      AND rounding -> 'stored' = CASE WHEN result IS NULL THEN 'null'::jsonb ELSE to_jsonb(result::text) END
    )
  );

ALTER TABLE benefit_calculation
  ADD CONSTRAINT benefit_calculation_rounding_required CHECK (rounding IS NOT NULL) NOT VALID;

COMMENT ON COLUMN benefit_calculation.rounding IS
  'Engine rounding record {column, scale, mode, precision, exact, stored, rounded, inexactIntermediate} (ADR-0024 §6 item 11). NULL only for rows written before migration 0027; their record is in the row''s benefit_calculation.create audit event.';
