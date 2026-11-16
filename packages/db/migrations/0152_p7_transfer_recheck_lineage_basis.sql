-- 0152 P7 slice C repair 4: the `lineage` basis of the mode 2 recheck (T-DG7-BE-R4; ADR-0064 Amendment 4 §A4.5;
-- D-263; p7-work-split §C.15; REQ-S19-014, REQ-S19-017). Authored by backend-workflow-engineer. Runs as mth_owner
-- inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
-- Id: the next above the highest shipped file on this branch (0151; D-245 O9).
--
--   migration_reconciliation_delta   the basis CHECK of 0151 is dropped and re-added with eleven values (adds lineage:
--                                    a worker system-lineage row explained only through its recorded link to an
--                                    explained outbox row or run, with exact counts, A4.2-A4.4). Existing rows satisfy
--                                    it. The CHECK migration_reconciliation_delta_unexplained is unchanged.
--
-- NOTHING HERE TOUCHES audit_event: no trigger, grant, column, row or sequence of the trail is created, altered,
-- disabled, updated, deleted or truncated (ADR-0004; D-258 to D-263 hard constraints). Nothing here approves
-- anything (no business, Finance or IT approval; G1-G6), and nothing reads or writes DG0-DG7.

ALTER TABLE migration_reconciliation_delta DROP CONSTRAINT migration_reconciliation_delta_basis_check;
ALTER TABLE migration_reconciliation_delta ADD CONSTRAINT migration_reconciliation_delta_basis_check
  CHECK (basis IN ('audit_baseline', 'audit_additions', 'audit_already_present', 'rebind', 'exact_ids',
    'audit_explained', 'child_of', 'counter', 'operational', 'lineage', 'unexplained'));
