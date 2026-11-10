-- 0118 P6 slice F: a new evidence_content row needs detected_type (T-DG6-BE-D; ADR-0052 §1; REQ-S13-011;
-- p6-work-split §E/F.6 and §E/F.9). Authored by backend-workflow-engineer. Runs as mth_owner inside one transaction
-- opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16. Id: the next above the
-- highest shipped file on this branch (0117, D-196 item 2); the orchestrator renumbers at merge if another task shipped
-- a higher id first. This is the rule ADR-0052 §1 calls "BE-D's migration 0101" (0101 was shipped by T-DG6-ARCH-02).
--
-- Merged with the upload change in apps/api evidence/routes.ts, which now stores the type the magic-byte check found
-- (ADR-0052 §1 table) and its canonical media type on every new row; `0099`'s evidence_content_detected_media_type
-- keeps content_type equal to p6_upload_media_type(detected_type).
--   evidence_content_detected_type_required   BEFORE INSERT, FOR EACH ROW: an INSERT with detected_type NULL raises
--                                             check_violation with constraint evidence_content_detected_type_required.
-- Rows stored before P6 keep detected_type NULL and application/octet-stream (no UPDATE is possible: the table is
-- append-only, probe EC06); they stay downloadable as attachments and are never previewed (ADR-0052 §2). The API never
-- sends a NULL type, so the constraint name stays unmapped in platform/db-errors.ts (500), and a BE-D test proves the
-- trigger directly. Nothing here reads or writes DG0-DG7.

CREATE FUNCTION evidence_content_detected_type_required() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.detected_type IS NULL THEN
    RAISE EXCEPTION 'a new evidence_content row needs detected_type (ADR-0052 §1)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'evidence_content_detected_type_required',
            TABLE = 'evidence_content', COLUMN = 'detected_type';
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION evidence_content_detected_type_required() IS
  'P6 (ADR-0052 §1): refuses a new evidence_content row without the magic-byte detected_type; pre-P6 rows keep NULL.';
REVOKE ALL ON FUNCTION evidence_content_detected_type_required() FROM PUBLIC;

CREATE TRIGGER evidence_content_detected_type_required BEFORE INSERT ON evidence_content
  FOR EACH ROW EXECUTE FUNCTION evidence_content_detected_type_required();
