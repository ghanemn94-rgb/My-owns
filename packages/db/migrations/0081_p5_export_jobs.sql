-- 0081 P5 slice F: asynchronous export jobs with progress (T-DG5-ARCH-04; ADR-0046; REQ-S13-005, REQ-S13-006,
-- REQ-S13-009). Authored by solution-architect. Contract: docs/architecture/data-dictionary.md ("P5 tables, slice F").
-- Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged.
-- SQL floor: PostgreSQL 16.
--
-- Additive: new tables only. Every export renders one report snapshot (ADR-0045) in one format and one language.
-- The API creates the job (queued) and sends it after COMMIT; the worker renders it, stores the file through the
-- evidence-storage adapter (ADR-0010) and records the outcome. Progress lives in its own unaudited row so that a
-- progress tick never needs an audit event; every status change of the job itself is audited.

CREATE TABLE export_job (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  snapshot_id       uuid NOT NULL,
  requested_by      uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  format            text NOT NULL CHECK (format IN ('pdf', 'docx', 'xlsx', 'pptx', 'csv')),
  language          text NOT NULL CHECK (language IN ('en', 'ar')),
  idempotency_key   text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  status            text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempt_count     smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
  started_at        timestamptz NULL,
  finished_at       timestamptz NULL,
  storage_key       text NULL CONSTRAINT export_job_storage_key_key UNIQUE CHECK (storage_key IS NULL OR storage_key ~ '^exports/[A-Za-z0-9/_.-]{1,190}$'),
  file_name         text NULL CHECK (file_name IS NULL OR (char_length(file_name) BETWEEN 5 AND 200 AND file_name ~ '^[A-Za-z0-9_.-]+$')),
  content_type      text NULL CHECK (content_type IS NULL OR content_type IN (
                      'application/pdf',
                      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                      'text/csv; charset=utf-8')),
  file_sha256       char(64) NULL CHECK (file_sha256 IS NULL OR file_sha256 ~ '^[0-9a-f]{64}$'),
  file_size_bytes   bigint NULL CHECK (file_size_bytes IS NULL OR file_size_bytes BETWEEN 1 AND 209715200),
  error_code        text NULL CHECK (error_code IS NULL OR error_code IN ('export.render_failed', 'export.too_large', 'export.source_unavailable', 'export.retries_exhausted')),
  cancelled_at      timestamptz NULL,
  cancelled_by      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT export_job_snapshot_fkey FOREIGN KEY (transformation_id, snapshot_id) REFERENCES report_snapshot (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT export_job_idempotency_key UNIQUE (requested_by, idempotency_key),
  CONSTRAINT export_job_requester_creates CHECK (created_by = requested_by),
  CONSTRAINT export_job_file_complete CHECK ((status = 'succeeded') = (storage_key IS NOT NULL)
    AND (storage_key IS NULL) = (file_name IS NULL) AND (storage_key IS NULL) = (content_type IS NULL)
    AND (storage_key IS NULL) = (file_sha256 IS NULL) AND (storage_key IS NULL) = (file_size_bytes IS NULL)),
  CONSTRAINT export_job_error_complete CHECK ((status = 'failed') = (error_code IS NOT NULL)),
  CONSTRAINT export_job_cancel_complete CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)
    AND (cancelled_at IS NULL) = (cancelled_by IS NULL)),
  CONSTRAINT export_job_times CHECK ((status NOT IN ('running', 'succeeded') OR started_at IS NOT NULL)
    AND ((status IN ('succeeded', 'failed', 'cancelled')) = (finished_at IS NOT NULL))
    AND (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)),
  CONSTRAINT export_job_content_type_matches CHECK (content_type IS NULL OR content_type = CASE format
    WHEN 'pdf' THEN 'application/pdf'
    WHEN 'docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    WHEN 'xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    WHEN 'pptx' THEN 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ELSE 'text/csv; charset=utf-8' END)
);
CREATE INDEX export_job_requester_idx ON export_job (requested_by, created_at DESC, id DESC);

CREATE FUNCTION export_job_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  s report_snapshot%ROWTYPE;
  fmts text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'queued' OR NEW.attempt_count <> 0 THEN
      RAISE EXCEPTION 'export_job: a job is created queued with no attempt'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'export_job_created_queued';
    END IF;
    SELECT * INTO s FROM report_snapshot WHERE id = NEW.snapshot_id;
    IF FOUND THEN
      IF s.status = 'discarded' THEN
        RAISE EXCEPTION 'export_job: a discarded snapshot is not exported'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'export_job_snapshot_exportable';
      END IF;
      SELECT d.formats INTO fmts FROM report_definition d WHERE d.code = s.definition_code;
      IF NOT (NEW.format = ANY (fmts)) THEN
        RAISE EXCEPTION 'export_job: % is not offered for %', NEW.format, s.definition_code
          USING ERRCODE = 'check_violation', CONSTRAINT = 'export_job_format_offered';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.snapshot_id, NEW.requested_by, NEW.format, NEW.language, NEW.idempotency_key)
     IS DISTINCT FROM (OLD.snapshot_id, OLD.requested_by, OLD.format, OLD.language, OLD.idempotency_key) THEN
    RAISE EXCEPTION 'export_job: the snapshot, requester, format, language and key never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'export_job_request_immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'queued' AND NEW.status IN ('running', 'failed', 'cancelled'))
    OR (OLD.status = 'running' AND NEW.status IN ('succeeded', 'failed', 'queued', 'cancelled'))) THEN
    RAISE EXCEPTION 'export_job: % -> % is not an export transition', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'export_job_transition';
  END IF;
  IF OLD.status IN ('succeeded', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'export_job: a finished job never changes'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'export_job_finished_frozen';
  END IF;
  IF NEW.status = 'running' AND OLD.status = 'queued' AND NEW.attempt_count <> OLD.attempt_count + 1 THEN
    RAISE EXCEPTION 'export_job: each start is the next attempt'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'export_job_attempt_step';
  END IF;
  IF NOT (NEW.status = 'running' AND OLD.status = 'queued') AND NEW.attempt_count <> OLD.attempt_count THEN
    RAISE EXCEPTION 'export_job: the attempt count moves only when a run starts'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'export_job_attempt_step';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER export_job_guard BEFORE INSERT OR UPDATE ON export_job
  FOR EACH ROW EXECUTE FUNCTION export_job_guard();
SELECT p2_attach_guards('export_job', true);
GRANT SELECT, INSERT, UPDATE ON export_job TO mth_app;

-- export_job_progress: one row per job, created with it; the worker moves it forward (never back). Operational state
-- without an audit event (the job_run precedent, ADR-0043 §6); the job's own transitions are audited.
CREATE TABLE export_job_progress (
  export_job_id   uuid PRIMARY KEY REFERENCES export_job (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  stage           text NOT NULL DEFAULT 'queued' CHECK (stage IN ('queued', 'loading', 'rendering', 'storing', 'done')),
  percent         smallint NOT NULL DEFAULT 0 CHECK (percent BETWEEN 0 AND 100),
  sections_done   integer NOT NULL DEFAULT 0 CHECK (sections_done >= 0),
  sections_total  integer NULL CHECK (sections_total IS NULL OR sections_total >= 0),
  version         integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT export_job_progress_done CHECK ((stage = 'done') = (percent = 100)),
  CONSTRAINT export_job_progress_sections CHECK (sections_total IS NULL OR sections_done <= sections_total)
);
CREATE FUNCTION export_job_progress_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  j export_job%ROWTYPE;
BEGIN
  SELECT * INTO j FROM export_job WHERE id = NEW.export_job_id;
  IF FOUND AND j.organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'export_job_progress: belongs to its job''s organization'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'export_job_progress_organization';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.percent < OLD.percent OR NEW.sections_done < OLD.sections_done
       OR array_position(ARRAY['queued', 'loading', 'rendering', 'storing', 'done'], NEW.stage)
          < array_position(ARRAY['queued', 'loading', 'rendering', 'storing', 'done'], OLD.stage) THEN
      RAISE EXCEPTION 'export_job_progress: progress never moves back'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'export_job_progress_forward';
    END IF;
    IF NEW.stage = 'done' AND j.status IS DISTINCT FROM 'succeeded' THEN
      RAISE EXCEPTION 'export_job_progress: done only for a succeeded job'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'export_job_progress_done_succeeded';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER export_job_progress_guard BEFORE INSERT OR UPDATE ON export_job_progress
  FOR EACH ROW EXECUTE FUNCTION export_job_progress_guard();
SELECT p2_attach_guards('export_job_progress', false);
GRANT SELECT, INSERT, UPDATE ON export_job_progress TO mth_app;
