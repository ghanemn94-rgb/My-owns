-- 0124 P6 DG6 round-1 repair: asynchronous live-export assembly (T-DG6-BE-Y5; D-207; F-DG6-147; ADR-0046 §2 as
-- amended by D-207). Authored by backend-workflow-engineer. Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16. Id: the next above the highest
-- shipped file on this branch (0123, D-196 item 2); the orchestrator renumbers at merge if another task shipped a
-- higher id first.
--
-- D-207: createExport for a LIVE selection validates, authorizes and runs the restricted-source check synchronously,
-- then writes the job with its stored selection, its progress row and its audit event, and answers 202 with no
-- snapshot yet. The API process's export assembly watch (apps/api reporting/exports/assembly.ts) claims such a pending
-- job FOR UPDATE SKIP LOCKED, re-checks the requester's access, assembles and writes the snapshot, assigns it to the job
-- and only then writes the `export_job.requested` outbox event for the worker. Access lost in between fails the job
-- with an error code (never a file). Exports of an existing snapshot are unchanged.
--
-- Schema:
--   * export_job.snapshot_id becomes nullable: NULL only while a live selection is pending assembly (or after such a
--     job failed or was cancelled before assembly);
--   * export_job.selection (jsonb): the stored live selection (ExportLiveSelection: definitionCode, subjectId,
--     reportingPeriodId, parameters), NULL for an export of an existing snapshot; the idempotent replay compares it;
--   * CHECK export_job_selection_pending: a job without a snapshot carries a selection and is queued, failed or
--     cancelled (never running or succeeded); the selection is a JSON object with a definitionCode;
--   * error_code accepts two more closed codes: `export.includes_restricted_records` (the assembled report includes a
--     record the requester is no longer admitted to, D-199) and `export.assembly_failed` (the report could no longer
--     be assembled from the current records: its subject or period is gone, or it became too large);
--   * export_job_guard: the snapshot is assigned exactly once (NULL -> a snapshot, while queued), and is then immutable
--     as before; the selection never changes; the format of a pending job is checked against its selection's
--     definition; the assigned snapshot is checked as on insert (not discarded, format offered);
--   * a partial index on the pending jobs (the watch's claim query).
-- No row changes (every existing job has a snapshot and no selection). Nothing here approves anything (no business
-- approval, G1-G6), and nothing reads or writes DG0-DG7.

ALTER TABLE export_job ALTER COLUMN snapshot_id DROP NOT NULL;
ALTER TABLE export_job ADD COLUMN selection jsonb NULL;
ALTER TABLE export_job ADD CONSTRAINT export_job_selection_pending CHECK (
  (snapshot_id IS NOT NULL OR (selection IS NOT NULL AND status IN ('queued', 'failed', 'cancelled')))
  AND (selection IS NULL OR (jsonb_typeof(selection) = 'object' AND jsonb_typeof(selection -> 'definitionCode') = 'string'))
);

ALTER TABLE export_job DROP CONSTRAINT export_job_error_code_check;
ALTER TABLE export_job ADD CONSTRAINT export_job_error_code_check CHECK (error_code IS NULL OR error_code IN (
  'export.render_failed', 'export.too_large', 'export.source_unavailable', 'export.retries_exhausted',
  'export.includes_restricted_records', 'export.assembly_failed'));

CREATE INDEX export_job_pending_assembly_idx ON export_job (created_at, id)
  WHERE snapshot_id IS NULL AND status = 'queued';

CREATE OR REPLACE FUNCTION export_job_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  s report_snapshot%ROWTYPE;
  fmts text[];
  def_code text;
  check_snapshot boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'queued' OR NEW.attempt_count <> 0 THEN
      RAISE EXCEPTION 'export_job: a job is created queued with no attempt'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'export_job_created_queued';
    END IF;
    IF NEW.snapshot_id IS NULL THEN
      -- 0124: a pending live selection; its format must be offered by the selected definition.
      def_code := NEW.selection ->> 'definitionCode';
      SELECT d.formats INTO fmts FROM report_definition d WHERE d.code = def_code;
      IF NOT FOUND OR NOT (NEW.format = ANY (fmts)) THEN
        RAISE EXCEPTION 'export_job: % is not offered for %', NEW.format, def_code
          USING ERRCODE = 'check_violation', CONSTRAINT = 'export_job_format_offered';
      END IF;
      RETURN NEW;
    END IF;
    check_snapshot := true;
  ELSE
    IF (NEW.requested_by, NEW.format, NEW.language, NEW.idempotency_key, NEW.selection)
       IS DISTINCT FROM (OLD.requested_by, OLD.format, OLD.language, OLD.idempotency_key, OLD.selection)
       OR (OLD.snapshot_id IS NOT NULL AND NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id)
       OR (OLD.snapshot_id IS NULL AND NEW.snapshot_id IS NOT NULL AND (OLD.status <> 'queued' OR NEW.status <> 'queued'))
    THEN
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
    -- 0124: the snapshot assigned to a pending live selection is checked as on insert.
    check_snapshot := OLD.snapshot_id IS NULL AND NEW.snapshot_id IS NOT NULL;
  END IF;
  IF check_snapshot THEN
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
  END IF;
  RETURN NEW;
END $$;
