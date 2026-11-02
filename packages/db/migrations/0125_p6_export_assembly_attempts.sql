-- 0125 P6 DG6 round-1 follow-up: export assembly guard and persisted assembly attempts (T-DG6-BE-Y6; F-DG6-sa12-1,
-- F-DG6-sa12-3; ADR-0046 R2 and R4; D-207). Authored by backend-workflow-engineer. Runs as mth_owner inside one
-- transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16. Id: the next
-- above the highest shipped file on this branch (0124, D-196 item 2); the orchestrator renumbers at merge if another
-- task shipped a higher id first.
--
-- F-DG6-sa12-1 (defence in depth, ADR-0046 H4 as reconciled by R2): the snapshot assigned to a job that carries a
-- stored live selection must be of that selection's definition. The application already inserts the snapshot from the
-- stored selection in the same transaction that assigns it (apps/api reporting/exports/assembly.ts); the database now
-- refuses a mismatch too (`export_job_snapshot_selection`).
--
-- F-DG6-sa12-3 (bounded retry across restarts, ADR-0046 R4): the export assembly watch counted its unexpected errors
-- in memory per process, so a job whose assembly killed the process was retried after every restart without bound.
-- The count now lives on the job:
--   * export_job.assembly_attempt_count integer NOT NULL DEFAULT 0 (>= 0): the assembly attempts of a pending live
--     selection that were started. The watch counts an attempt in its own committed transaction (version + 1, audited
--     `export_job.assembly_attempt`) BEFORE it assembles, so a crash in the middle of the assembly still leaves the
--     attempt counted; a job whose count reached EXPORT_ASSEMBLY_MAX_ERRORS fails `export.assembly_failed` at the
--     next claim instead of being assembled again;
--   * export_job_guard: a job is created with no assembly attempt; the count moves only by + 1, only while the job is
--     pending (queued with no snapshot, before and after), and never with a status or snapshot change.
-- `attempt_count` (the worker's render attempts) is unchanged and separate. Existing rows get 0 (the default): a job
-- created before 0125 that is still pending starts its count now. No other row changes. Nothing here approves anything
-- (no business approval, G1-G6), and nothing reads or writes DG0-DG7.

ALTER TABLE export_job ADD COLUMN assembly_attempt_count integer NOT NULL DEFAULT 0
  CONSTRAINT export_job_assembly_attempt_count_check CHECK (assembly_attempt_count >= 0);

CREATE OR REPLACE FUNCTION export_job_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  s report_snapshot%ROWTYPE;
  fmts text[];
  def_code text;
  check_snapshot boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'queued' OR NEW.attempt_count <> 0 OR NEW.assembly_attempt_count <> 0 THEN
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
    -- 0125: an assembly attempt is counted on its own (+ 1) while the job is pending, and only then.
    IF NEW.assembly_attempt_count IS DISTINCT FROM OLD.assembly_attempt_count AND NOT (
         NEW.assembly_attempt_count = OLD.assembly_attempt_count + 1
         AND OLD.status = 'queued' AND NEW.status = 'queued'
         AND OLD.snapshot_id IS NULL AND NEW.snapshot_id IS NULL) THEN
      RAISE EXCEPTION 'export_job: the assembly attempt count steps by 1 only while the job is pending'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'export_job_assembly_attempt_step';
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
      -- 0125 (F-DG6-sa12-1): a job with a stored selection gets a snapshot of that selection's definition only.
      IF NEW.selection IS NOT NULL AND s.definition_code IS DISTINCT FROM NEW.selection ->> 'definitionCode' THEN
        RAISE EXCEPTION 'export_job: snapshot of % assigned to a selection of %', s.definition_code,
          NEW.selection ->> 'definitionCode'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'export_job_snapshot_selection';
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
