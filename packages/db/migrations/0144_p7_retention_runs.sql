-- 0144 P7 slice E: retention runs, their per-record actions, the archived-record markers, the purge function and the
-- read-only rule for archived rows (T-DG7-ARCH-03; ADR-0067 §4-§7). Authored by solution-architect. Runs as mth_owner
-- inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- REQ-S16-024 ("an archival job run on test data archives only records past retention and logs each action"):
--   retention_run             one run of the retention.archive job (API: createRetentionDryRun, createRetentionRun; or
--                             the schedule, which ships disabled). States queued -> running -> succeeded | failed;
--                             terminal states are immutable. mode 'dry_run' writes 'would_*' actions and never an
--                             archive set; mode 'run' archives. At most one run is queued or running at a time.
--                             Versioned and audited.
--   retention_run_action      one row per record a run touched, append-only, unique per (run, table, key, action): the
--                             "exactly once per run" rule. Every 'archived', 'purged' and 'skipped_referenced' row needs
--                             its own audit_event (record_type 'retention_run_action', record_id = id) in the same
--                             transaction (deferred trigger retention_run_action_audit_required).
--   retention_archived_record one row per archived live row (table, primary key as a text-valued jsonb object): which
--                             run archived it, into which archive set, and when it was purged (NULL while it stays).
--                             The INSERT trigger re-checks in the database that the row exists, that its class is
--                             enabled and that its age column is older than the run's as_of minus the class period: a
--                             record that is not past retention can never be marked archived.
--   retention_purge_record()  SECURITY DEFINER: the ONLY delete path the runtime role gets for retention. It refuses
--                             unless the class is operational and 'archive_then_purge', the table is purge-eligible and
--                             not append-only, the row was archived and is still past retention, and the run is a
--                             running 'run'. A row still referenced by a foreign key is not deleted (returns false).
--                             Business, audit, snapshot, system and derived records can therefore never be purged.
--   retention_archived_row_guard()  BEFORE UPDATE on the tables of archivable classes that the runtime may update
--                             (inbox_notification, worker_heartbeat): an archived row that is not purged is read-only.
--                             Inert until an administrator enables a class (every class ships 'retain').
-- Nothing here reads or writes DG0-DG7. No code grants a business, Finance or IT approval.

-- ---------------------------------------------------------------------------------------------------------------
-- retention_run
CREATE TABLE retention_run (
  id                  uuid PRIMARY KEY,
  mode                text NOT NULL CHECK (mode IN ('dry_run', 'run')),
  status              text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  requested_via       text NOT NULL CHECK (requested_via IN ('api', 'schedule')),
  as_of               timestamptz NOT NULL,
  candidate_count     integer NULL CHECK (candidate_count IS NULL OR candidate_count >= 0),
  archived_count      integer NULL CHECK (archived_count IS NULL OR archived_count >= 0),
  purged_count        integer NULL CHECK (purged_count IS NULL OR purged_count >= 0),
  skipped_count       integer NULL CHECK (skipped_count IS NULL OR skipped_count >= 0),
  archive_set_key     text NULL CHECK (archive_set_key IS NULL
                        OR archive_set_key ~ '^retention/[0-9a-f-]{36}/manifest\.json$'),
  archive_set_sha256  text NULL CHECK (archive_set_sha256 IS NULL OR archive_set_sha256 ~ '^[0-9a-f]{64}$'),
  archive_set_bytes   bigint NULL CHECK (archive_set_bytes IS NULL OR archive_set_bytes >= 0),
  failure_reason      text NULL CHECK (failure_reason IS NULL OR char_length(failure_reason) BETWEEN 1 AND 1000),
  started_at          timestamptz NULL,
  finished_at         timestamptz NULL,
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT retention_run_requester CHECK ((requested_via = 'api') = (created_by IS NOT NULL)),
  CONSTRAINT retention_run_archive_set CHECK ((archive_set_key IS NULL) = (archive_set_sha256 IS NULL)
    AND (archive_set_key IS NULL) = (archive_set_bytes IS NULL)
    AND (archive_set_key IS NULL OR archive_set_key = 'retention/' || id::text || '/manifest.json')),
  CONSTRAINT retention_run_dry_run_writes_nothing CHECK (mode = 'run' OR (archive_set_key IS NULL
    AND coalesce(archived_count, 0) = 0 AND coalesce(purged_count, 0) = 0)),
  CONSTRAINT retention_run_succeeded_shape CHECK (status <> 'succeeded' OR (candidate_count IS NOT NULL
    AND archived_count IS NOT NULL AND purged_count IS NOT NULL AND skipped_count IS NOT NULL
    AND started_at IS NOT NULL AND finished_at IS NOT NULL AND failure_reason IS NULL
    AND purged_count <= archived_count + skipped_count + candidate_count
    AND (mode = 'dry_run' OR archived_count = 0 OR archive_set_key IS NOT NULL))),
  CONSTRAINT retention_run_failed_shape CHECK (status <> 'failed' OR (failure_reason IS NOT NULL
    AND finished_at IS NOT NULL))
);
CREATE INDEX retention_run_created_idx ON retention_run (created_at DESC, id);
CREATE UNIQUE INDEX retention_run_one_active ON retention_run ((true)) WHERE status IN ('queued', 'running');
SELECT p2_attach_guards('retention_run', true);
GRANT SELECT, INSERT ON retention_run TO mth_app;
GRANT UPDATE (status, candidate_count, archived_count, purged_count, skipped_count, archive_set_key, archive_set_sha256,
  archive_set_bytes, failure_reason, started_at, finished_at, version, updated_at, updated_by) ON retention_run TO mth_app;

CREATE FUNCTION retention_run_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'queued' THEN
      RAISE EXCEPTION 'retention_run: a run starts queued'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'retention_run_transition';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'retention_run: a % run is immutable', OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'retention_run_terminal_immutable';
  END IF;
  IF NOT ((OLD.status = 'queued' AND NEW.status IN ('running', 'failed'))
       OR (OLD.status = 'running' AND NEW.status IN ('running', 'succeeded', 'failed'))) THEN
    RAISE EXCEPTION 'retention_run: % -> % is not a transition', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'retention_run_transition';
  END IF;
  IF (NEW.mode, NEW.requested_via, NEW.as_of) IS DISTINCT FROM (OLD.mode, OLD.requested_via, OLD.as_of) THEN
    RAISE EXCEPTION 'retention_run: the request (mode, requester, as_of) never changes'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'retention_run_request_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER retention_run_guard BEFORE INSERT OR UPDATE ON retention_run
  FOR EACH ROW EXECUTE FUNCTION retention_run_guard();

-- ---------------------------------------------------------------------------------------------------------------
-- retention_archived_record
CREATE TABLE retention_archived_record (
  table_name          text NOT NULL REFERENCES retention_table_class (table_name) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_key          jsonb NOT NULL CHECK (jsonb_typeof(record_key) = 'object'),
  retention_class_id  uuid NOT NULL REFERENCES retention_class (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  retention_run_id    uuid NOT NULL REFERENCES retention_run (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_set_key     text NOT NULL CHECK (archive_set_key ~ '^retention/[0-9a-f-]{36}/manifest\.json$'),
  record_age_at       timestamptz NOT NULL,
  archived_at         timestamptz NOT NULL DEFAULT now(),
  purged_at           timestamptz NULL,
  purge_run_id        uuid NULL REFERENCES retention_run (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT retention_archived_record_pkey PRIMARY KEY (table_name, record_key),
  CONSTRAINT retention_archived_record_set CHECK (archive_set_key = 'retention/' || retention_run_id::text || '/manifest.json'),
  CONSTRAINT retention_archived_record_purge_shape CHECK ((purged_at IS NULL) = (purge_run_id IS NULL))
);
CREATE INDEX retention_archived_record_run_idx ON retention_archived_record (retention_run_id);
CREATE INDEX retention_archived_record_list_idx ON retention_archived_record (archived_at DESC, table_name);
GRANT SELECT, INSERT ON retention_archived_record TO mth_app;

-- The record key of a row: its primary key columns as a text-valued jsonb object (ADR-0067 §5).
CREATE FUNCTION retention_record_key(p_table text, p_row jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_object_agg(k, p_row ->> k)
    FROM retention_table_class t, unnest(t.key_columns) AS k
   WHERE t.table_name = p_table
$$;

-- The age of a live row (NULL: no such row, or no age yet). Dynamic SQL only over catalogue-checked identifiers.
CREATE FUNCTION retention_row_age(p_table text, p_key jsonb) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  t retention_table_class%ROWTYPE;
  age timestamptz;
BEGIN
  SELECT * INTO t FROM retention_table_class WHERE table_name = p_table;
  IF NOT FOUND OR t.age_column IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE format('SELECT %I FROM %I WHERE %s', t.age_column, t.table_name,
                 (SELECT string_agg(format('%I::text = $1->>%L', k, k), ' AND ') FROM unnest(t.key_columns) AS k))
    INTO age USING p_key;
  RETURN age;
END $$;

CREATE FUNCTION retention_archived_record_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  run retention_run%ROWTYPE;
  cls retention_class%ROWTYPE;
  age timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Only the purge marker, once, and only by retention_purge_record().
    IF OLD.purged_at IS NOT NULL OR NEW.purged_at IS NULL
       OR (NEW.table_name, NEW.record_key, NEW.retention_class_id, NEW.retention_run_id, NEW.archive_set_key,
           NEW.record_age_at, NEW.archived_at)
          IS DISTINCT FROM (OLD.table_name, OLD.record_key, OLD.retention_class_id, OLD.retention_run_id,
           OLD.archive_set_key, OLD.record_age_at, OLD.archived_at) THEN
      RAISE EXCEPTION 'retention_archived_record: only the purge marker is set, once'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'retention_archived_record_immutable';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO run FROM retention_run WHERE id = NEW.retention_run_id;
  IF run.mode <> 'run' OR run.status <> 'running' THEN
    RAISE EXCEPTION 'retention_archived_record: only a running run (mode run) archives'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'retention_archived_record_run';
  END IF;
  SELECT c.* INTO cls FROM retention_class c JOIN retention_table_class t ON t.retention_class_id = c.id
   WHERE t.table_name = NEW.table_name;
  IF cls.id IS DISTINCT FROM NEW.retention_class_id OR cls.action NOT IN ('archive', 'archive_then_purge') THEN
    RAISE EXCEPTION 'retention_archived_record: the class of % is not enabled for archiving', NEW.table_name
      USING ERRCODE = 'check_violation', CONSTRAINT = 'retention_archived_record_class';
  END IF;
  IF NEW.record_key IS DISTINCT FROM retention_record_key(NEW.table_name, NEW.record_key) THEN
    RAISE EXCEPTION 'retention_archived_record: the key must be exactly the primary key of %', NEW.table_name
      USING ERRCODE = 'check_violation', CONSTRAINT = 'retention_archived_record_key';
  END IF;
  age := retention_row_age(NEW.table_name, NEW.record_key);
  IF age IS NULL OR age >= run.as_of - make_interval(days => cls.period_days) OR age <> NEW.record_age_at THEN
    RAISE EXCEPTION 'retention_archived_record: % % is not past retention (age %, as_of %, period % days)',
      NEW.table_name, NEW.record_key, age, run.as_of, cls.period_days
      USING ERRCODE = 'check_violation', CONSTRAINT = 'retention_archived_record_past_retention';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER retention_archived_record_guard BEFORE INSERT OR UPDATE ON retention_archived_record
  FOR EACH ROW EXECUTE FUNCTION retention_archived_record_guard();
CREATE TRIGGER retention_archived_record_no_delete BEFORE DELETE OR TRUNCATE ON retention_archived_record
  FOR EACH STATEMENT EXECUTE FUNCTION p2_append_only();

-- ---------------------------------------------------------------------------------------------------------------
-- retention_run_action
CREATE TABLE retention_run_action (
  id                  uuid PRIMARY KEY,
  retention_run_id    uuid NOT NULL REFERENCES retention_run (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  retention_class_id  uuid NOT NULL REFERENCES retention_class (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  table_name          text NOT NULL REFERENCES retention_table_class (table_name) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_key          jsonb NOT NULL CHECK (jsonb_typeof(record_key) = 'object'),
  action              text NOT NULL CHECK (action IN ('would_archive', 'would_purge', 'archived', 'purged',
                        'skipped_referenced')),
  period_days         integer NOT NULL CHECK (period_days BETWEEN 1 AND 36500),
  record_age_at       timestamptz NOT NULL,
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retention_run_action_once UNIQUE (retention_run_id, table_name, record_key, action)
);
CREATE INDEX retention_run_action_run_idx ON retention_run_action (retention_run_id, occurred_at, id);
SELECT p2_attach_append_only('retention_run_action');
GRANT SELECT, INSERT ON retention_run_action TO mth_app;

CREATE FUNCTION retention_run_action_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  run retention_run%ROWTYPE;
BEGIN
  SELECT * INTO run FROM retention_run WHERE id = NEW.retention_run_id;
  IF run.status <> 'running' THEN
    RAISE EXCEPTION 'retention_run_action: the run is not running'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'retention_run_action_run';
  END IF;
  IF (run.mode = 'dry_run') <> (NEW.action IN ('would_archive', 'would_purge')) THEN
    RAISE EXCEPTION 'retention_run_action: % is not an action of a % run', NEW.action, run.mode
      USING ERRCODE = 'check_violation', CONSTRAINT = 'retention_run_action_mode';
  END IF;
  IF NEW.action = 'archived' AND NOT EXISTS (
       SELECT 1 FROM retention_archived_record a WHERE a.table_name = NEW.table_name
          AND a.record_key = NEW.record_key AND a.retention_run_id = NEW.retention_run_id) THEN
    RAISE EXCEPTION 'retention_run_action: archived needs the archived-record marker of this run'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'retention_run_action_marker';
  END IF;
  IF NEW.action = 'purged' AND NOT EXISTS (
       SELECT 1 FROM retention_archived_record a WHERE a.table_name = NEW.table_name
          AND a.record_key = NEW.record_key AND a.purge_run_id = NEW.retention_run_id) THEN
    RAISE EXCEPTION 'retention_run_action: purged needs the purge marker of this run'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'retention_run_action_marker';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER retention_run_action_guard BEFORE INSERT ON retention_run_action
  FOR EACH ROW EXECUTE FUNCTION retention_run_action_guard();

-- One audit event per real action (ADR-0004; the dry run is audited once, on its run row).
CREATE FUNCTION retention_run_action_audit_required() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.action IN ('archived', 'purged', 'skipped_referenced') AND NOT EXISTS (
       SELECT 1 FROM audit_event a WHERE a.record_type = 'retention_run_action' AND a.record_id = NEW.id) THEN
    RAISE EXCEPTION 'no audit_event for retention_run_action % (ADR-0067 §6: one audit event per action)', NEW.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'retention_run_action_audit_required';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER retention_run_action_audit_required AFTER INSERT ON retention_run_action
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retention_run_action_audit_required();

-- ---------------------------------------------------------------------------------------------------------------
-- retention_purge_record(): the only retention delete path (SECURITY DEFINER, owned by mth_owner)
CREATE FUNCTION retention_purge_record(p_run_id uuid, p_table text, p_key jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  run retention_run%ROWTYPE;
  t retention_table_class%ROWTYPE;
  cls retention_class%ROWTYPE;
  marker retention_archived_record%ROWTYPE;
  age timestamptz;
  n integer;
BEGIN
  SELECT * INTO run FROM retention_run WHERE id = p_run_id FOR SHARE;
  IF NOT FOUND OR run.mode <> 'run' OR run.status <> 'running' THEN
    RAISE EXCEPTION 'retention_purge_record: run % is not a running run', p_run_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'retention_purge_run';
  END IF;
  SELECT * INTO t FROM retention_table_class WHERE table_name = p_table;
  SELECT * INTO cls FROM retention_class WHERE id = t.retention_class_id;
  IF t.table_name IS NULL OR NOT t.purge_eligible OR cls.category <> 'operational'
     OR cls.action <> 'archive_then_purge' THEN
    RAISE EXCEPTION 'retention_purge_record: % is not purge-eligible (D-243 Q3: business, audit and snapshot records are never purged)', p_table
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'retention_purge_eligible';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = format('public.%I', p_table)::regclass
               AND g.tgname = p_table || '_append_only') THEN
    RAISE EXCEPTION 'retention_purge_record: % is append-only', p_table
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'retention_purge_eligible';
  END IF;
  SELECT * INTO marker FROM retention_archived_record WHERE table_name = p_table AND record_key = p_key FOR UPDATE;
  IF NOT FOUND OR marker.purged_at IS NOT NULL THEN
    RAISE EXCEPTION 'retention_purge_record: % % was not archived (or is already purged)', p_table, p_key
      USING ERRCODE = 'check_violation', CONSTRAINT = 'retention_purge_archived_first';
  END IF;
  age := retention_row_age(p_table, p_key);
  IF age IS NULL OR age >= run.as_of - make_interval(days => cls.period_days) THEN
    RAISE EXCEPTION 'retention_purge_record: % % is not past retention', p_table, p_key
      USING ERRCODE = 'check_violation', CONSTRAINT = 'retention_purge_past_retention';
  END IF;
  BEGIN
    EXECUTE format('DELETE FROM %I WHERE %s', t.table_name,
                   (SELECT string_agg(format('%I::text = $1->>%L', k, k), ' AND ') FROM unnest(t.key_columns) AS k))
      USING p_key;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN foreign_key_violation THEN
    RETURN false; -- still referenced (for example an inbox item with a delivery record): kept, archived, read-only
  END;
  IF n <> 1 THEN
    RAISE EXCEPTION 'retention_purge_record: % % matched % rows', p_table, p_key, n
      USING ERRCODE = 'check_violation', CONSTRAINT = 'retention_purge_one_row';
  END IF;
  UPDATE retention_archived_record SET purged_at = now(), purge_run_id = p_run_id
   WHERE table_name = p_table AND record_key = p_key;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION retention_purge_record(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retention_purge_record(uuid, text, jsonb) TO mth_app;
REVOKE ALL ON FUNCTION retention_row_age(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retention_row_age(text, jsonb) TO mth_app; -- the archived-record trigger runs as the invoker
REVOKE ALL ON FUNCTION retention_record_key(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retention_record_key(text, jsonb) TO mth_app;

-- ---------------------------------------------------------------------------------------------------------------
-- An archived, not purged row is read-only (D-243 Q3). Attached to the archivable tables the runtime may update.
CREATE FUNCTION retention_archived_row_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM retention_archived_record a
              WHERE a.table_name = TG_TABLE_NAME AND a.purged_at IS NULL
                AND a.record_key = retention_record_key(TG_TABLE_NAME, to_jsonb(OLD))) THEN
    RAISE EXCEPTION '%: an archived record is read-only (ADR-0067 §5)', TG_TABLE_NAME
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_archived_read_only';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inbox_notification_archived_read_only BEFORE UPDATE ON inbox_notification
  FOR EACH ROW EXECUTE FUNCTION retention_archived_row_guard();
CREATE TRIGGER worker_heartbeat_archived_read_only BEFORE UPDATE ON worker_heartbeat
  FOR EACH ROW EXECUTE FUNCTION retention_archived_row_guard();

-- This migration's tables are retention history (ADR-0067 §3).
INSERT INTO retention_table_class (table_name, retention_class_id, key_columns) VALUES
  ('retention_run', '01930000-0000-7000-8000-000000143006', '{id}'),
  ('retention_archived_record', '01930000-0000-7000-8000-000000143006', '{table_name,record_key}'),
  ('retention_run_action', '01930000-0000-7000-8000-000000143006', '{id}');
