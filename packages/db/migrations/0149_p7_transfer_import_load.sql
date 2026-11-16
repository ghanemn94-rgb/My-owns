-- 0149 P7 slice C repair: the import load on a freshly migrated target, the recheck deltas (T-DG7-BE-R1; ADR-0064
-- Amendment 1 §A1.6; D-258; p7-work-split §C.12; REQ-S19-014, REQ-S19-016). Authored by backend-workflow-engineer.
-- Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor:
-- PostgreSQL 16. Id: the next above the highest shipped file on this branch (0148; D-245 O9).
--
--   migration_import                 seven NULL-able columns recording the audit ranges of the load (A1.6): the
--                                    carried rows and their highest seq M, the target's migration baseline (rows,
--                                    min/max seq, digest) and the seed rows the load replaced. CHECK
--                                    migration_import_audit_ranges: all seven NULL, or all set with a baseline
--                                    strictly above M.
--   migration_reconciliation         run_kind gains `recheck_after_use`; the result CHECK is replaced so that a
--                                    recheck after use may count unequal rows (its differences are explained by delta
--                                    rows). Existing rows satisfy the looser rule.
--   migration_reconciliation_delta   append-only, written by the CLI (mth_owner); mth_app has SELECT only.
--   transfer_table_rule              one row: migration_reconciliation_delta never travels.
--   retention_table_class            one row: the delta table's retention class (ADR-0067 §3).
--
-- NOTHING HERE TOUCHES audit_event: no trigger, grant, column, row or sequence of the trail is created, altered,
-- disabled, updated, deleted or truncated (ADR-0004; D-258 hard constraints). Nothing here approves anything (no
-- business, Finance or IT approval; G1-G6), and nothing reads or writes DG0-DG7.

ALTER TABLE migration_import
  ADD COLUMN audit_carried_rows     bigint NULL CHECK (audit_carried_rows IS NULL OR audit_carried_rows >= 0),
  ADD COLUMN audit_carried_seq_max  bigint NULL CHECK (audit_carried_seq_max IS NULL OR audit_carried_seq_max >= 0),
  ADD COLUMN audit_baseline_rows    bigint NULL CHECK (audit_baseline_rows IS NULL OR audit_baseline_rows >= 0),
  ADD COLUMN audit_baseline_seq_min bigint NULL,
  ADD COLUMN audit_baseline_seq_max bigint NULL,
  ADD COLUMN audit_baseline_digest  text NULL CHECK (audit_baseline_digest IS NULL
                                      OR audit_baseline_digest ~ '^[0-9a-f]{64}$'),
  ADD COLUMN seed_rows_replaced     bigint NULL CHECK (seed_rows_replaced IS NULL OR seed_rows_replaced >= 0),
  ADD CONSTRAINT migration_import_audit_ranges CHECK (
    (audit_carried_rows IS NULL AND audit_carried_seq_max IS NULL AND audit_baseline_rows IS NULL
      AND audit_baseline_seq_min IS NULL AND audit_baseline_seq_max IS NULL AND audit_baseline_digest IS NULL
      AND seed_rows_replaced IS NULL)
    OR (audit_carried_rows IS NOT NULL AND audit_carried_seq_max IS NOT NULL AND audit_baseline_rows IS NOT NULL
      AND audit_baseline_digest IS NOT NULL AND seed_rows_replaced IS NOT NULL
      AND (audit_baseline_rows = 0) = (audit_baseline_seq_min IS NULL)
      AND (audit_baseline_rows = 0) = (audit_baseline_seq_max IS NULL)
      AND (audit_baseline_rows = 0
        OR (audit_baseline_seq_min > audit_carried_seq_max AND audit_baseline_seq_max >= audit_baseline_seq_min))));

ALTER TABLE migration_reconciliation DROP CONSTRAINT migration_reconciliation_run_kind_check;
ALTER TABLE migration_reconciliation ADD CONSTRAINT migration_reconciliation_run_kind_check
  CHECK (run_kind IN ('import', 'recheck', 'recheck_after_use'));
ALTER TABLE migration_reconciliation DROP CONSTRAINT migration_reconciliation_result;
ALTER TABLE migration_reconciliation ADD CONSTRAINT migration_reconciliation_result CHECK ((result = 'matched')
  = (tables_mismatched = 0 AND attachments_mismatched = 0
     AND (run_kind = 'recheck_after_use' OR rows_expected = rows_actual)));

CREATE TABLE migration_reconciliation_delta (
  migration_reconciliation_id uuid NOT NULL REFERENCES migration_reconciliation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  table_name                  text NOT NULL CHECK (table_name ~ '^[a-z][a-z0-9_]{0,62}$'),
  basis                       text NOT NULL CHECK (basis IN ('audit_baseline', 'audit_additions', 'rebind',
                                'exact_ids', 'operational', 'unexplained')),
  rows_added                  bigint NOT NULL CHECK (rows_added >= 0),
  rows_changed                bigint NOT NULL CHECK (rows_changed >= 0),
  rows_missing                bigint NOT NULL CHECK (rows_missing >= 0),
  allowed                     boolean NOT NULL,
  CONSTRAINT migration_reconciliation_delta_pkey PRIMARY KEY (migration_reconciliation_id, table_name, basis),
  CONSTRAINT migration_reconciliation_delta_unexplained CHECK (basis <> 'unexplained' OR NOT allowed)
);
SELECT p2_attach_append_only('migration_reconciliation_delta');
GRANT SELECT ON migration_reconciliation_delta TO mth_app;

INSERT INTO transfer_table_rule (table_name, rule, reason) VALUES
  ('migration_reconciliation_delta', 'exclude_transfer', 'Written by the import and the rechecks on the target');

-- ADR-0067 §3: every public base table has exactly one retention class. The delta rows are business records of the
-- import (the class of the other migration_reconciliation tables), never archived or purged by default.
INSERT INTO retention_table_class (table_name, retention_class_id, key_columns) VALUES
  ('migration_reconciliation_delta', '01930000-0000-7000-8000-000000143001',
   '{migration_reconciliation_id,table_name,basis}');
