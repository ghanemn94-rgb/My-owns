-- 0151 P7 slice C repair 3: the `counter` basis of the mode 2 recheck (T-DG7-BE-R3; ADR-0064 Amendment 3 §A3.3, §A3.5;
-- D-260; p7-work-split §C.14; REQ-S19-014, REQ-S19-017). Authored by backend-workflow-engineer. Runs as mth_owner
-- inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
-- Id: the next above the highest shipped file on this branch (0150; D-245 O9).
--
--   migration_reconciliation_delta   the basis CHECK of 0150 is dropped and re-added with ten values (adds counter:
--                                    a code counter row explained only when it moved by exactly the explained new
--                                    coded rows of its scope, A3.3). Existing rows satisfy it. The CHECK
--                                    migration_reconciliation_delta_unexplained is unchanged.
--
-- NOTHING HERE TOUCHES audit_event: no trigger, grant, column, row or sequence of the trail is created, altered,
-- disabled, updated, deleted or truncated (ADR-0004; D-258, D-259, D-260 hard constraints). Nothing here approves
-- anything (no business, Finance or IT approval; G1-G6), and nothing reads or writes DG0-DG7.

ALTER TABLE migration_reconciliation_delta DROP CONSTRAINT migration_reconciliation_delta_basis_check;
ALTER TABLE migration_reconciliation_delta ADD CONSTRAINT migration_reconciliation_delta_basis_check
  CHECK (basis IN ('audit_baseline', 'audit_additions', 'audit_already_present', 'rebind', 'exact_ids',
    'audit_explained', 'child_of', 'counter', 'operational', 'unexplained'));
