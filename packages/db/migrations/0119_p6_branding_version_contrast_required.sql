-- 0119 P6 slice I: a new branding version needs its contrast report (T-DG6-BE-W; ADR-0061 §1.3, §2; REQ-S15-003;
-- p6-work-split §I/K.1 and §I/K.7). Authored by backend-workflow-engineer. Runs as mth_owner inside one transaction
-- opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16. Id: the next above the
-- highest shipped file on this branch (0118, D-196 item 2; shared rule 18); the orchestrator renumbers at merge if
-- another task shipped a higher id first.
--
-- Merged with the API change in apps/api admin/branding.ts, whose publish transaction now writes, after the
-- branding_version insert, one branding_contrast_report (0113) with its pairs and its audit event.
--   branding_version_contrast_required   CONSTRAINT TRIGGER AFTER INSERT ON branding_version, DEFERRABLE INITIALLY
--                                        DEFERRED, FOR EACH ROW: at COMMIT, the inserted version has its report
--                                        (branding_contrast_report with the same organization_id and
--                                        branding_version_no); otherwise integrity_constraint_violation with constraint
--                                        branding_version_contrast_required.
-- Versions published before this migration are not read, changed, re-checked or backfilled (ADR-0061 §1.4, §I/K.11
-- item 3): the trigger fires only for rows inserted after it exists. GET .../contrast shows them as not_recorded. The
-- API always writes the report, so the constraint maps to the generic 500 in platform/db-errors.ts (a broken invariant,
-- never a user error). Branding is configuration, never a business approval; nothing here reads or writes DG0-DG7.
-- #0078FF is a provisional brand token, not a verified Mobily colour.

CREATE FUNCTION branding_version_contrast_required() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM branding_contrast_report r
    WHERE r.organization_id = NEW.organization_id AND r.branding_version_no = NEW.version_no
  ) THEN
    RAISE EXCEPTION 'branding_version % of organization % has no contrast report (ADR-0061 §1.3)',
      NEW.version_no, NEW.organization_id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'branding_version_contrast_required',
            TABLE = 'branding_version';
  END IF;
  RETURN NULL;
END $$;
COMMENT ON FUNCTION branding_version_contrast_required() IS
  'P6 (ADR-0061 §2): at COMMIT a branding version inserted after 0119 has its branding_contrast_report; earlier versions are untouched.';
REVOKE ALL ON FUNCTION branding_version_contrast_required() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER branding_version_contrast_required AFTER INSERT ON branding_version
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION branding_version_contrast_required();
