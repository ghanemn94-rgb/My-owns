-- 0101 P6 slice J: service identities of jobs and connectors, operational exceptions with their event history and
-- stale-KPI links, and the worker heartbeat (T-DG6-ARCH-02; ADR-0053). Authored by solution-architect. Runs as
-- mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor:
-- PostgreSQL 16.
--
-- REQ-S16-029 (M0330 "Avoid exposing secrets or private evidence URLs in client code or logs"; acceptance "a job's
-- identity cannot read records outside its scope") and REQ-S12-019 (M0239 "Connector/job fails or data becomes stale |
-- Create a visible operational exception and retain last known values with freshness labels").
--   service_identity           one row per job queue ('job:<queue>') or connector ('connector:<connector id>'). The
--                              DECLARATION (declared_permission_codes, sensitive_access, scope, subject) is written by a
--                              migration (jobs) or by the connector's creation (connectors) and never changed by the
--                              application afterwards; the application may only NARROW or restore the GRANT
--                              (granted_permission_codes <@ declared_permission_codes). Every code is a 'read' or
--                              'write' permission, never 'configure', 'business_approval' or 'finance_validation'
--                              (service_identity_guard). Versioned and audited; trigger-written append-only history
--                              service_identity_change. Job rows are inserted only by a migration (owner check).
--                              connector_id gets its foreign key from the connector table's migration (ADR-0055).
--   operational_exception      one ACTIVE (open or acknowledged) row per (organization, dedup key), the key being
--                              '<source_kind>:<source_code>:<failure_class>' (unique index operational_exception_one_
--                              active_key, NULLS NOT DISTINCT so platform rows are unique too). A recurrence while active
--                              increments occurrence_count by exactly 1; a recurrence after resolution opens a NEW row.
--                              States: open -> acknowledged | resolved; acknowledged -> resolved; resolved is terminal.
--                              Versioned and audited; trigger-written append-only history operational_exception_event.
--   operational_exception_kpi  append-only links from an exception to the KPI definitions whose data it makes stale
--                              (same organization; the KPI's Stale label and last value stay DG4's, ADR-0028).
--   worker_heartbeat           one row per worker instance, updated by the worker every 30 s. Operational telemetry, not
--                              a business record: version-stepped (P2 row guard) but NOT audited (the job_run precedent,
--                              0074), so a beat never writes an audit event.
-- Nothing here reads or writes DG0-DG7. No code grants a business approval.

-- ---------------------------------------------------------------------------------------------------------------
-- service_identity
CREATE TABLE service_identity (
  id                        uuid PRIMARY KEY,
  code                      text NOT NULL CONSTRAINT service_identity_code_key UNIQUE
                              CONSTRAINT service_identity_code_format
                              CHECK (code ~ '^(job|connector):[a-z0-9][a-z0-9_.:-]{0,119}$'),
  subject_kind              text NOT NULL CHECK (subject_kind IN ('job', 'connector')),
  queue_name                text NULL CHECK (queue_name IS NULL OR (queue_name ~ '^[a-z_]+\.[a-z_.]+$'
                              AND char_length(queue_name) <= 100)),
  connector_id              uuid NULL,
  scope_level               text NOT NULL CHECK (scope_level IN ('platform', 'organization')),
  organization_id           uuid NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  declared_permission_codes text[] NOT NULL CHECK (cardinality(declared_permission_codes) <= 40
                              AND array_position(declared_permission_codes, NULL) IS NULL),
  granted_permission_codes  text[] NOT NULL CHECK (array_position(granted_permission_codes, NULL) IS NULL),
  sensitive_access          text NOT NULL DEFAULT 'none' CHECK (sensitive_access IN ('none', 'aggregate_only')),
  label_en                  text NOT NULL CHECK (char_length(label_en) BETWEEN 1 AND 200),
  label_ar                  text NOT NULL CHECK (char_length(label_ar) BETWEEN 1 AND 200),
  reason                    text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 1000),
  version                   integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT service_identity_subject_shape CHECK (
    (subject_kind = 'job' AND queue_name IS NOT NULL AND connector_id IS NULL AND code = 'job:' || queue_name)
    OR (subject_kind = 'connector' AND connector_id IS NOT NULL AND queue_name IS NULL
        AND scope_level = 'organization' AND code = 'connector:' || connector_id::text)),
  CONSTRAINT service_identity_scope_shape CHECK ((scope_level = 'platform') = (organization_id IS NULL)),
  CONSTRAINT service_identity_grant_within_declaration CHECK (granted_permission_codes <@ declared_permission_codes)
);
CREATE INDEX service_identity_organization_idx ON service_identity (organization_id, code);
SELECT p2_attach_guards('service_identity', true);
GRANT SELECT, INSERT ON service_identity TO mth_app;
-- The application can change the grant and its reason only (column privileges; probe SI).
GRANT UPDATE (granted_permission_codes, reason, version, updated_at, updated_by) ON service_identity TO mth_app;

CREATE FUNCTION service_identity_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  is_owner boolean := current_user = 'mth_owner' OR current_user IN (SELECT rolname FROM pg_roles WHERE rolsuper);
  bad text;
BEGIN
  SELECT c INTO bad FROM unnest(NEW.declared_permission_codes) AS c
   WHERE NOT EXISTS (SELECT 1 FROM permission p WHERE p.code = c AND p.category IN ('read', 'write'))
   LIMIT 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'service_identity: % is not a read or write permission (a service identity never holds a configuration, business-approval or Finance-validation right)', bad
      USING ERRCODE = 'check_violation', CONSTRAINT = 'service_identity_permission_category';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.subject_kind = 'job' AND NOT is_owner THEN
      RAISE EXCEPTION 'service_identity: a job identity is declared by a migration only'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'service_identity_job_by_migration';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT is_owner AND (NEW.code, NEW.subject_kind, NEW.queue_name, NEW.connector_id, NEW.scope_level,
      NEW.declared_permission_codes, NEW.sensitive_access, NEW.label_en, NEW.label_ar)
     IS DISTINCT FROM (OLD.code, OLD.subject_kind, OLD.queue_name, OLD.connector_id, OLD.scope_level,
      OLD.declared_permission_codes, OLD.sensitive_access, OLD.label_en, OLD.label_ar) THEN
    RAISE EXCEPTION 'service_identity: the declaration of a service identity never changes outside a migration'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'service_identity_declaration_fixed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER service_identity_guard BEFORE INSERT OR UPDATE ON service_identity
  FOR EACH ROW EXECUTE FUNCTION service_identity_guard();

CREATE TABLE service_identity_change (
  id                        uuid PRIMARY KEY,
  service_identity_id       uuid NOT NULL REFERENCES service_identity (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_version            integer NOT NULL CHECK (record_version >= 1),
  declared_permission_codes text[] NOT NULL,
  granted_permission_codes  text[] NOT NULL,
  sensitive_access          text NOT NULL,
  reason                    text NOT NULL,
  changed_by                uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  changed_at                timestamptz NOT NULL,
  CONSTRAINT service_identity_change_version_key UNIQUE (service_identity_id, record_version)
);
SELECT p2_attach_append_only('service_identity_change');
GRANT SELECT ON service_identity_change TO mth_app;

CREATE FUNCTION service_identity_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO service_identity_change (id, service_identity_id, record_version, declared_permission_codes,
    granted_permission_codes, sensitive_access, reason, changed_by, changed_at)
  VALUES (mth_uuid_v7(), NEW.id, NEW.version, NEW.declared_permission_codes, NEW.granted_permission_codes,
    NEW.sensitive_access, NEW.reason, NEW.updated_by, NEW.updated_at);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION service_identity_history() FROM PUBLIC;
CREATE TRIGGER service_identity_history AFTER INSERT OR UPDATE ON service_identity
  FOR EACH ROW EXECUTE FUNCTION service_identity_history();

-- ---------------------------------------------------------------------------------------------------------------
-- operational_exception
CREATE TABLE operational_exception (
  id                     uuid PRIMARY KEY,
  organization_id        uuid NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  source_kind            text NOT NULL CHECK (source_kind IN ('job', 'connector', 'data_freshness', 'worker')),
  source_code            text NOT NULL CHECK (char_length(source_code) BETWEEN 1 AND 200
                           AND source_code ~ '^[a-z0-9][a-z0-9_.:-]*$'),
  failure_class          text NOT NULL CHECK (failure_class IN ('job_failed', 'connector_run_failed',
                           'connector_unreachable', 'connector_credentials_rejected', 'data_stale', 'heartbeat_missed')),
  dedup_key              text NOT NULL,
  service_identity_id    uuid NULL REFERENCES service_identity (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  operational_failure_id uuid NULL REFERENCES operational_failure (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  occurrence_count       integer NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
  first_occurred_at      timestamptz NOT NULL,
  last_occurred_at       timestamptz NOT NULL,
  last_error_code        text NOT NULL CHECK (char_length(last_error_code) BETWEEN 1 AND 100
                           AND last_error_code ~ '^[a-z][a-z0-9_.]*$'),
  last_error_message     text NOT NULL CHECK (char_length(last_error_message) BETWEEN 1 AND 2000),
  acknowledged_at        timestamptz NULL,
  acknowledged_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  acknowledge_note       text NULL CHECK (acknowledge_note IS NULL OR char_length(acknowledge_note) BETWEEN 3 AND 1000),
  resolved_at            timestamptz NULL,
  resolved_by            uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  resolution             text NULL CHECK (resolution IS NULL OR resolution IN ('manual', 'recovered')),
  resolution_note        text NULL CHECK (resolution_note IS NULL OR char_length(resolution_note) BETWEEN 3 AND 1000),
  version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT operational_exception_dedup_key CHECK (dedup_key = source_kind || ':' || source_code || ':' || failure_class),
  CONSTRAINT operational_exception_class_shape CHECK (
    (source_kind = 'job' AND failure_class = 'job_failed')
    OR (source_kind = 'connector' AND failure_class IN ('connector_run_failed', 'connector_unreachable',
        'connector_credentials_rejected') AND organization_id IS NOT NULL)
    OR (source_kind = 'data_freshness' AND failure_class = 'data_stale' AND organization_id IS NOT NULL)
    OR (source_kind = 'worker' AND failure_class = 'heartbeat_missed' AND organization_id IS NULL)),
  CONSTRAINT operational_exception_times CHECK (last_occurred_at >= first_occurred_at),
  CONSTRAINT operational_exception_ack_complete CHECK (
    (acknowledged_at IS NULL) = (acknowledged_by IS NULL)
    AND (acknowledge_note IS NULL OR acknowledged_at IS NOT NULL)
    AND (status <> 'acknowledged' OR acknowledged_at IS NOT NULL)
    AND (status <> 'open' OR acknowledged_at IS NULL)),
  CONSTRAINT operational_exception_resolved_complete CHECK (
    (status = 'resolved') = (resolved_at IS NOT NULL)
    AND (resolved_at IS NULL) = (resolution IS NULL)
    AND (resolution IS DISTINCT FROM 'manual' OR (resolved_by IS NOT NULL AND resolution_note IS NOT NULL))
    AND (resolution IS DISTINCT FROM 'recovered' OR resolved_by IS NULL)
    AND (resolved_at IS NOT NULL OR (resolved_by IS NULL AND resolution_note IS NULL)))
);
CREATE UNIQUE INDEX operational_exception_one_active_key ON operational_exception (organization_id, dedup_key)
  NULLS NOT DISTINCT WHERE status IN ('open', 'acknowledged');
CREATE INDEX operational_exception_list_idx ON operational_exception (organization_id, status, last_occurred_at DESC, id DESC);
SELECT p2_attach_guards('operational_exception', true);
GRANT SELECT, INSERT, UPDATE ON operational_exception TO mth_app;

CREATE FUNCTION operational_exception_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' OR NEW.occurrence_count <> 1 OR NEW.last_occurred_at <> NEW.first_occurred_at THEN
      RAISE EXCEPTION 'operational_exception: an exception is created open, with one occurrence'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'operational_exception_transition';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'resolved' THEN
    RAISE EXCEPTION 'operational_exception: a resolved exception never changes (a new failure opens a new exception)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'operational_exception_resolved_final';
  END IF;
  IF (NEW.source_kind, NEW.source_code, NEW.failure_class, NEW.dedup_key, NEW.first_occurred_at)
     IS DISTINCT FROM (OLD.source_kind, OLD.source_code, OLD.failure_class, OLD.dedup_key, OLD.first_occurred_at) THEN
    RAISE EXCEPTION 'operational_exception: the source, failure class and first occurrence never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'operational_exception_identity_fixed';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'open' AND NEW.status IN ('acknowledged', 'resolved'))
       OR (OLD.status = 'acknowledged' AND NEW.status = 'resolved')) THEN
    RAISE EXCEPTION 'operational_exception: % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'operational_exception_transition';
  END IF;
  IF NEW.occurrence_count <> OLD.occurrence_count AND (NEW.occurrence_count <> OLD.occurrence_count + 1
       OR NEW.last_occurred_at < OLD.last_occurred_at) THEN
    RAISE EXCEPTION 'operational_exception: each recurrence counts once and moves last_occurred_at forward'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'operational_exception_occurrence_step';
  END IF;
  IF NEW.occurrence_count = OLD.occurrence_count AND NEW.last_occurred_at <> OLD.last_occurred_at THEN
    RAISE EXCEPTION 'operational_exception: last_occurred_at moves only with a recurrence'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'operational_exception_occurrence_step';
  END IF;
  IF OLD.acknowledged_at IS NOT NULL AND (NEW.acknowledged_at, NEW.acknowledged_by, NEW.acknowledge_note)
     IS DISTINCT FROM (OLD.acknowledged_at, OLD.acknowledged_by, OLD.acknowledge_note) THEN
    RAISE EXCEPTION 'operational_exception: an acknowledgement is recorded once'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'operational_exception_ack_once';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER operational_exception_guard BEFORE INSERT OR UPDATE ON operational_exception
  FOR EACH ROW EXECUTE FUNCTION operational_exception_guard();

CREATE TABLE operational_exception_event (
  id                       uuid PRIMARY KEY,
  operational_exception_id uuid NOT NULL REFERENCES operational_exception (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_version           integer NOT NULL CHECK (record_version >= 1),
  event_kind               text NOT NULL CHECK (event_kind IN ('opened', 'recurred', 'acknowledged', 'resolved', 'updated')),
  status                   text NOT NULL,
  occurrence_count         integer NOT NULL,
  error_code               text NOT NULL,
  actor_user_id            uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  note                     text NULL,
  occurred_at              timestamptz NOT NULL,
  CONSTRAINT operational_exception_event_version_key UNIQUE (operational_exception_id, record_version)
);
SELECT p2_attach_append_only('operational_exception_event');
GRANT SELECT ON operational_exception_event TO mth_app;

CREATE FUNCTION operational_exception_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  kind text;
  note text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    kind := 'opened';
  ELSIF NEW.status = 'resolved' AND OLD.status <> 'resolved' THEN
    kind := 'resolved';
    note := NEW.resolution_note;
  ELSIF NEW.status = 'acknowledged' AND OLD.status = 'open' THEN
    kind := 'acknowledged';
    note := NEW.acknowledge_note;
  ELSIF NEW.occurrence_count <> OLD.occurrence_count THEN
    kind := 'recurred';
  ELSE
    kind := 'updated';
  END IF;
  INSERT INTO operational_exception_event (id, operational_exception_id, record_version, event_kind, status,
    occurrence_count, error_code, actor_user_id, note, occurred_at)
  VALUES (mth_uuid_v7(), NEW.id, NEW.version, kind, NEW.status, NEW.occurrence_count, NEW.last_error_code,
    NEW.updated_by, note, NEW.updated_at);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION operational_exception_history() FROM PUBLIC;
CREATE TRIGGER operational_exception_history AFTER INSERT OR UPDATE ON operational_exception
  FOR EACH ROW EXECUTE FUNCTION operational_exception_history();

-- ---------------------------------------------------------------------------------------------------------------
-- operational_exception_kpi: which KPIs an exception makes stale (written in the exception's open/recur transaction,
-- whose audit event lists the KPI ids).
CREATE TABLE operational_exception_kpi (
  id                       uuid PRIMARY KEY,
  operational_exception_id uuid NOT NULL REFERENCES operational_exception (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  organization_id          uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id        uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kpi_definition_id        uuid NOT NULL REFERENCES kpi_definition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  linked_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operational_exception_kpi_key UNIQUE (operational_exception_id, kpi_definition_id)
);
CREATE INDEX operational_exception_kpi_transformation_idx ON operational_exception_kpi (transformation_id, kpi_definition_id);
SELECT p2_attach_append_only('operational_exception_kpi');
GRANT SELECT, INSERT ON operational_exception_kpi TO mth_app;

CREATE FUNCTION operational_exception_kpi_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM kpi_definition k WHERE k.id = NEW.kpi_definition_id
                   AND k.organization_id = NEW.organization_id AND k.transformation_id = NEW.transformation_id)
     OR NOT EXISTS (SELECT 1 FROM operational_exception e WHERE e.id = NEW.operational_exception_id
                   AND e.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'operational_exception_kpi: the KPI and the exception must belong to the same organization (and the KPI to the named transformation)'
      USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'operational_exception_kpi_same_scope';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER operational_exception_kpi_guard BEFORE INSERT ON operational_exception_kpi
  FOR EACH ROW EXECUTE FUNCTION operational_exception_kpi_guard();

-- ---------------------------------------------------------------------------------------------------------------
-- worker_heartbeat: operational telemetry (not audited, see the header).
CREATE TABLE worker_heartbeat (
  id           uuid PRIMARY KEY,
  instance_key text NOT NULL CONSTRAINT worker_heartbeat_instance_key UNIQUE
                 CHECK (instance_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'),
  app_version  text NOT NULL CHECK (char_length(app_version) BETWEEN 1 AND 50),
  started_at   timestamptz NOT NULL,
  last_beat_at timestamptz NOT NULL,
  beat_count   bigint NOT NULL DEFAULT 1 CHECK (beat_count >= 1),
  queue_count  integer NOT NULL CHECK (queue_count BETWEEN 0 AND 1000),
  version      integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT worker_heartbeat_times CHECK (last_beat_at >= started_at)
);
SELECT p2_attach_guards('worker_heartbeat', false);
GRANT SELECT, INSERT, UPDATE ON worker_heartbeat TO mth_app;

CREATE FUNCTION worker_heartbeat_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF (NEW.instance_key, NEW.started_at) IS DISTINCT FROM (OLD.instance_key, OLD.started_at)
     OR NEW.last_beat_at < OLD.last_beat_at OR NEW.beat_count <> OLD.beat_count + 1 THEN
    RAISE EXCEPTION 'worker_heartbeat: a beat moves forward by exactly one (a restarted worker writes a new instance key)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'worker_heartbeat_forward';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER worker_heartbeat_guard BEFORE UPDATE ON worker_heartbeat
  FOR EACH ROW EXECUTE FUNCTION worker_heartbeat_guard();
