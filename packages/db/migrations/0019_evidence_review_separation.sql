-- 0019 evidence review separation of duties (T-DG2-BE3; F-DG2-140, REQ-S13-012; ADR-0018 §3, ADR-0020 §3).
-- Authored by backend-workflow-engineer. Runs as mth_owner inside one transaction opened by `mth-db migrate`.
-- Forward-only. SQL floor: PostgreSQL 16.
--
-- 0012's CHECK evidence_verified_rule compares the reviewer only with the row's created_by. Anybody who replaced the
-- content of another user's evidence (a new note text or URL, or a new file revision) could then verify their own
-- content. This migration binds the review to the CONTENT AUTHOR as well:
--   * evidence.content_authored_by: who supplied the current content. Maintained ONLY by the trigger below (any value
--     the application sends is overwritten): the creator on insert; the updating user whenever the note text, the URL,
--     the stored file revision or (for a bare filename reference) the filename changes. NULL on rows that existed
--     before this migration; it then means "the creator" (nothing else was knowable).
--   * evidence_review_separation: a review (verified or rejected) recorded or changed by an UPDATE or INSERT is refused
--     when the reviewer is the creator, the content author, or the uploader of the reviewed / current file revision.
-- Rows already reviewed are not rewritten (no backfill UPDATE: the record guards would demand a version step and an
-- audit event per row); the rule applies to every review from now on.

ALTER TABLE evidence ADD COLUMN content_authored_by uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
COMMENT ON COLUMN evidence.content_authored_by IS
  'Who supplied the current content (note text, URL, file revision, filename reference); trigger-maintained. NULL = the creator (rows from before 0019).';

CREATE FUNCTION evidence_review_separation() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  content_changed boolean;
  review_changed  boolean;
  author          uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.content_authored_by := NEW.created_by;
    review_changed := NEW.reviewed_by IS NOT NULL;
  ELSE
    content_changed := NEW.note_body IS DISTINCT FROM OLD.note_body
      OR NEW.url IS DISTINCT FROM OLD.url
      OR NEW.current_content_id IS DISTINCT FROM OLD.current_content_id
      OR (NEW.kind = 'file_reference' AND NEW.file_name IS DISTINCT FROM OLD.file_name);
    NEW.content_authored_by := CASE WHEN content_changed THEN NEW.updated_by ELSE OLD.content_authored_by END;
    review_changed := NEW.reviewed_by IS NOT NULL AND (
      NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
      OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
      OR NEW.review_status IS DISTINCT FROM OLD.review_status
      OR NEW.reviewed_content_id IS DISTINCT FROM OLD.reviewed_content_id);
  END IF;

  IF review_changed THEN
    author := coalesce(NEW.content_authored_by, NEW.created_by);
    IF NEW.reviewed_by = NEW.created_by
       OR NEW.reviewed_by = author
       OR EXISTS (
         SELECT 1 FROM evidence_content c
          WHERE c.evidence_id = NEW.id
            AND c.id IN (NEW.reviewed_content_id, NEW.current_content_id)
            AND c.uploaded_by = NEW.reviewed_by) THEN
      RAISE EXCEPTION 'evidence %: the reviewer supplied this evidence or its current content (separation of duties)', NEW.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'evidence_review_separation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION evidence_review_separation() IS
  'F-DG2-140: maintains evidence.content_authored_by and refuses a review by the creator, the content author or the uploader of the reviewed/current revision.';

-- BEFORE trigger; it neither reads nor changes version/identity, so its order relative to evidence_row_guard is irrelevant.
CREATE TRIGGER evidence_review_separation BEFORE INSERT OR UPDATE ON evidence
  FOR EACH ROW EXECUTE FUNCTION evidence_review_separation();
REVOKE ALL ON FUNCTION evidence_review_separation() FROM PUBLIC;
