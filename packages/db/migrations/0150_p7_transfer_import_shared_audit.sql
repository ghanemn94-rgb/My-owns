-- 0150 P7 slice C repair 2: carried audit events already present in the target's migration baseline, and the recheck
-- delta bases of the mode 2 allowance (T-DG7-BE-R2; ADR-0064 Amendment 2 §A2.4; D-259; p7-work-split §C.13;
-- REQ-S19-014, REQ-S19-016). Authored by backend-workflow-engineer. Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16. Id: the next above the highest
-- shipped file on this branch (0149; D-245 O9).
--
--   migration_import                 audit_already_present_rows (bigint NULL): the number of carried audit events
--                                    that the load found already present, as identical migration baseline events
--                                    (same id and the 13 content columns of A2.1), and therefore did not insert.
--                                    CHECK migration_import_audit_present: NULL, or 0 <= n <= audit_carried_rows and
--                                    n <= audit_baseline_rows, with audit_carried_rows set.
--   migration_reconciliation_delta   the basis CHECK of 0149 is dropped and re-added with nine values (adds
--                                    audit_already_present, audit_explained and child_of). Existing rows satisfy it.
--
-- NOTHING HERE TOUCHES audit_event: no trigger, grant, column, row or sequence of the trail is created, altered,
-- disabled, updated, deleted or truncated (ADR-0004; D-258, D-259 hard constraints). Nothing here approves anything (no
-- business, Finance or IT approval; G1-G6), and nothing reads or writes DG0-DG7.

ALTER TABLE migration_import
  ADD COLUMN audit_already_present_rows bigint NULL,
  ADD CONSTRAINT migration_import_audit_present CHECK (
    audit_already_present_rows IS NULL
    OR (audit_already_present_rows >= 0 AND audit_carried_rows IS NOT NULL
      AND audit_already_present_rows <= audit_carried_rows
      AND audit_already_present_rows <= audit_baseline_rows));

ALTER TABLE migration_reconciliation_delta DROP CONSTRAINT migration_reconciliation_delta_basis_check;
ALTER TABLE migration_reconciliation_delta ADD CONSTRAINT migration_reconciliation_delta_basis_check
  CHECK (basis IN ('audit_baseline', 'audit_additions', 'audit_already_present', 'rebind', 'exact_ids',
    'audit_explained', 'child_of', 'operational', 'unexplained'));
