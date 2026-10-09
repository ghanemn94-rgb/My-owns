-- 0028 P4 foundation: business calendar and holidays, job schedules, work items (My Work tasks) and the in-app inbox
-- (T-DG4-ARCH-01; ADR-0025). Authored by solution-architect. Contract: docs/architecture/data-dictionary.md ("P4"
-- section). Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged.
-- SQL floor: PostgreSQL 16. Ids are UUIDv7 from the application; seed rows use fixed literal UUIDs.
--
-- Time semantics (ADR-0025 §2; REQ-S15-008): an event instant is a timestamptz (stored in UTC); a business date is a
-- `date` read in the organization's calendar timezone (Asia/Riyadh by default); an observation period is a typed
-- (period_start, period_end, label) triple on the record that owns it. No column here stores local wall-clock time.
-- No public holiday is seeded: a holiday exists only once an administrator configures it (REQ-S10-006).

-- -----------------------------------------------------------------------------------------------------------------
-- Shared helpers.
-- The business date of an instant in a timezone (ADR-0025 §2). STABLE because the timezone database can change.
CREATE FUNCTION p4_business_date(p_at timestamptz, p_timezone text) RETURNS date
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT (p_at AT TIME ZONE p_timezone)::date
$$;
REVOKE ALL ON FUNCTION p4_business_date(timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p4_business_date(timestamptz, text) TO mth_app;

-- A workweek is a non-empty set of distinct ISO weekdays (1 = Monday ... 7 = Sunday).
CREATE FUNCTION p4_valid_workweek(p_days smallint[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_days IS NOT NULL
     AND cardinality(p_days) BETWEEN 1 AND 7
     AND array_position(p_days, NULL) IS NULL
     AND p_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]
     AND (SELECT count(DISTINCT d) FROM unnest(p_days) AS d) = cardinality(p_days)
$$;

-- A time zone name PostgreSQL knows (pg_timezone_names). Used by triggers, not CHECKs (the catalogue is not immutable).
CREATE FUNCTION p4_timezone_known() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = NEW.timezone) THEN
    RAISE EXCEPTION '%: unknown time zone %', TG_TABLE_NAME, NEW.timezone
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_timezone_known';
  END IF;
  RETURN NEW;
END $$;

-- -----------------------------------------------------------------------------------------------------------------
-- business_calendar: the working-day calendar of an organization (REQ-S10-006, M0196). One active default per
-- organization. The default workweek is Sunday-Thursday in Asia/Riyadh; both are configuration, never code.
CREATE TABLE business_calendar (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code            text NOT NULL CONSTRAINT business_calendar_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  name_en         text NOT NULL CHECK (char_length(name_en) BETWEEN 1 AND 200),
  name_ar         text NOT NULL CHECK (char_length(name_ar) BETWEEN 1 AND 200),
  timezone        text NOT NULL DEFAULT 'Asia/Riyadh' CHECK (char_length(timezone) BETWEEN 1 AND 64),
  workweek        smallint[] NOT NULL DEFAULT ARRAY[7, 1, 2, 3, 4]::smallint[]
                  CONSTRAINT business_calendar_workweek_valid CHECK (p4_valid_workweek(workweek)),
  is_default      boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version         integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT business_calendar_org_code_key UNIQUE (organization_id, code),
  CONSTRAINT business_calendar_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT business_calendar_default_active CHECK (NOT is_default OR status = 'active')
);
CREATE UNIQUE INDEX business_calendar_one_default ON business_calendar (organization_id) WHERE is_default;
CREATE TRIGGER business_calendar_timezone_known BEFORE INSERT OR UPDATE OF timezone ON business_calendar
  FOR EACH ROW EXECUTE FUNCTION p4_timezone_known();
SELECT p2_attach_guards('business_calendar', true);
GRANT SELECT, INSERT, UPDATE ON business_calendar TO mth_app;

-- business_calendar_holiday: administered non-working dates (inclusive range, at most 31 days). Removal is a status
-- change, never a DELETE, so a due date computed earlier can be explained from the audit trail.
CREATE TABLE business_calendar_holiday (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  calendar_id     uuid NOT NULL,
  date_from       date NOT NULL,
  date_to         date NOT NULL,
  name_en         text NOT NULL CHECK (char_length(name_en) BETWEEN 1 AND 200),
  name_ar         text NOT NULL CHECK (char_length(name_ar) BETWEEN 1 AND 200),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  version         integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT business_calendar_holiday_calendar_fkey FOREIGN KEY (organization_id, calendar_id)
    REFERENCES business_calendar (organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT business_calendar_holiday_range CHECK (date_to >= date_from AND date_to - date_from <= 30)
);
CREATE INDEX business_calendar_holiday_calendar_idx ON business_calendar_holiday (calendar_id, date_from) WHERE status = 'active';
SELECT p2_attach_guards('business_calendar_holiday', true);
GRANT SELECT, INSERT, UPDATE ON business_calendar_holiday TO mth_app;

-- The organization's default calendar. Idempotent: creates nothing when an active default exists. Every created row is
-- audited (actor 'user' from the API; 'system' on behalf of nobody in the backfill). The timezone is the
-- organization's default_timezone (Asia/Riyadh unless configured).
CREATE FUNCTION p4_ensure_default_calendar(p_organization_id uuid, p_actor_user_id uuid, p_request_id text, p_source text)
RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  o record;
  rid uuid;
BEGIN
  SELECT x.id, x.default_timezone INTO o FROM organization x WHERE x.id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'p4_ensure_default_calendar: organization % does not exist', p_organization_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM business_calendar c WHERE c.organization_id = o.id AND c.is_default) THEN
    RETURN 0;
  END IF;
  rid := mth_uuid_v7();
  INSERT INTO business_calendar (id, organization_id, code, name_en, name_ar, timezone, is_default, created_by, updated_by)
  VALUES (rid, o.id, 'DEFAULT', 'Default business calendar', 'تقويم العمل الافتراضي', o.default_timezone, true,
          p_actor_user_id, p_actor_user_id);
  INSERT INTO audit_event (id, organization_id, actor_type, actor_user_id, action, record_type, record_id, new_version,
                           request_id, source)
  VALUES (mth_uuid_v7(), o.id, CASE WHEN p_actor_user_id IS NULL THEN 'system' ELSE 'user' END, p_actor_user_id,
          'business_calendar.create', 'business_calendar', rid, 1, p_request_id, p_source);
  RETURN 1;
END $$;
REVOKE ALL ON FUNCTION p4_ensure_default_calendar(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p4_ensure_default_calendar(uuid, uuid, text, text) TO mth_app;

-- Backfill: every existing organization gets its default calendar (no holidays). Selects no rows on a fresh database.
SELECT p4_ensure_default_calendar(x.id, NULL, NULL, 'migration') FROM organization x ORDER BY x.created_at, x.id;

-- -----------------------------------------------------------------------------------------------------------------
-- job_schedule: the recurring jobs of the scheduled-job kit (REQ-S16-005, ADR-0025 §3). The worker registers each
-- enabled row with pg-boss `schedule(queue_name, cron, data, { tz: timezone })`. Platform-wide (one deployment).
CREATE TABLE job_schedule (
  id             uuid PRIMARY KEY,
  code           text NOT NULL CONSTRAINT job_schedule_code_format CHECK (code ~ '^[a-z_]+\.[a-z_]+$'),
  queue_name     text NOT NULL CHECK (queue_name ~ '^[a-z_]+\.[a-z_.]+$'),
  cron           text NOT NULL CHECK (cron ~ '^\S+( \S+){4}$'),
  timezone       text NOT NULL DEFAULT 'Asia/Riyadh' CHECK (char_length(timezone) BETWEEN 1 AND 64),
  enabled        boolean NOT NULL DEFAULT true,
  description_en text NOT NULL CHECK (char_length(description_en) BETWEEN 1 AND 500),
  description_ar text NOT NULL CHECK (char_length(description_ar) BETWEEN 1 AND 500),
  owner_module   text NOT NULL CHECK (owner_module ~ '^[a-z_]+$'),
  version        integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT job_schedule_code_key UNIQUE (code)
);
CREATE TRIGGER job_schedule_timezone_known BEFORE INSERT OR UPDATE OF timezone ON job_schedule
  FOR EACH ROW EXECUTE FUNCTION p4_timezone_known();
SELECT p2_attach_guards('job_schedule', true);
GRANT SELECT, UPDATE ON job_schedule TO mth_app;

-- Seeded schedules, each audited (actor 'system', source 'migration'). Later slices insert their own rows in their
-- own migrations. Cron fields are minute hour day-of-month month day-of-week, evaluated in `timezone`.
INSERT INTO job_schedule (id, code, queue_name, cron, timezone, description_en, description_ar, owner_module) VALUES
  ('01920004-0001-7000-8000-000000000001', 'approval.escalation_scan', 'approval.escalation_scan', '*/15 * * * *', 'Asia/Riyadh', 'Escalate overdue approvals once to the next authority; never approves (REQ-S10-019).', 'تصعيد الموافقات المتأخرة مرة واحدة إلى الجهة التالية؛ لا يعتمد أبداً.', 'workflows'),
  ('01920004-0001-7000-8000-000000000002', 'delegation.expiry_sweep', 'delegation.expiry_sweep', '*/15 * * * *', 'Asia/Riyadh', 'Mark delegations whose end has passed as expired (REQ-S10-010).', 'وضع علامة انتهاء على التفويضات التي انقضت مدتها.', 'access'),
  ('01920004-0001-7000-8000-000000000003', 'kpi.reporting_period_open', 'kpi.reporting_period_open', '5 0 * * *', 'Asia/Riyadh', 'Open due reporting periods and create one update task and reminder per KPI owner (REQ-S12-005).', 'فتح فترات التقارير المستحقة وإنشاء مهمة تحديث وتذكير واحد لكل مالك مؤشر أداء.', 'kpi');
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source)
SELECT mth_uuid_v7(), 'system', 'job_schedule.create', 'job_schedule', s.id, 1, 'migration' FROM job_schedule s;

-- -----------------------------------------------------------------------------------------------------------------
-- work_item_kind: the catalogue of My Work item kinds. Each later slice inserts its own kinds in its own migration, so
-- no CHECK has to be widened. message_key is the i18n key the web client translates at render time.
CREATE TABLE work_item_kind (
  code         text PRIMARY KEY CHECK (code ~ '^[a-z_]+$'),
  owner_module text NOT NULL CHECK (owner_module ~ '^[a-z_]+$'),
  label_en     text NOT NULL CHECK (char_length(label_en) BETWEEN 1 AND 200),
  label_ar     text NOT NULL CHECK (char_length(label_ar) BETWEEN 1 AND 200),
  source_ref   text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 50)
);
GRANT SELECT ON work_item_kind TO mth_app;
INSERT INTO work_item_kind (code, owner_module, label_en, label_ar, source_ref) VALUES
  ('kpi_update_due', 'kpi', 'KPI update due', 'تحديث مؤشر أداء مستحق', 'M0225'),
  ('approval_decision', 'workflows', 'Approval to decide', 'موافقة بانتظار القرار', 'M0213'),
  ('approval_escalated', 'workflows', 'Overdue approval escalated to you', 'موافقة متأخرة صُعّدت إليك', 'M0213'),
  ('approval_changes_requested', 'workflows', 'Changes requested on your request', 'طُلبت تعديلات على طلبك', 'M0213');

-- -----------------------------------------------------------------------------------------------------------------
-- work_item: one owned task in My Work (REQ-S12-005, REQ-S03-008). Created by a domain service or an idempotent job
-- handler; dedupe_key makes a second creation for the same (rule, subject, slot, assignee) impossible, so a worker
-- restart or a redelivered message cannot duplicate a task (REQ-S16-005).
CREATE TABLE work_item (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kind              text NOT NULL REFERENCES work_item_kind (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  assignee_user_id  uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  subject_type      text NOT NULL CHECK (subject_type ~ '^[a-z_]+$' AND char_length(subject_type) <= 64),
  subject_id        uuid NOT NULL,
  link_path         text NOT NULL CONSTRAINT work_item_link_path_relative
                    CHECK (left(link_path, 1) = '/' AND substr(link_path, 2, 1) NOT IN ('/', E'\\') AND char_length(link_path) <= 500),
  message_key       text NOT NULL CHECK (message_key ~ '^[a-z][a-zA-Z0-9_.]*$' AND char_length(message_key) <= 128),
  message_params    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(message_params) = 'object'),
  due_date          date NULL,
  period_label      text NULL CHECK (period_label IS NULL OR char_length(period_label) BETWEEN 1 AND 32),
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  completed_at      timestamptz NULL,
  completed_by      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  dedupe_key        text NOT NULL CHECK (char_length(dedupe_key) BETWEEN 1 AND 200),
  created_source    text NOT NULL CHECK (created_source IN ('api', 'worker', 'migration')),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT work_item_dedupe_key UNIQUE (organization_id, dedupe_key),
  CONSTRAINT work_item_completion CHECK ((status = 'done') = (completed_at IS NOT NULL)
                                         AND (completed_by IS NULL OR completed_at IS NOT NULL))
);
CREATE INDEX work_item_assignee_open_idx ON work_item (assignee_user_id, due_date NULLS LAST, id) WHERE status = 'open';
CREATE INDEX work_item_subject_idx ON work_item (subject_type, subject_id);
CREATE INDEX work_item_transformation_idx ON work_item (transformation_id, status);
SELECT p2_attach_guards('work_item', true);
GRANT SELECT, INSERT, UPDATE ON work_item TO mth_app;

-- inbox_notification: an in-app reminder with a direct link (REQ-S12-005). No email or messaging channel in P4.
CREATE TABLE inbox_notification (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  recipient_user_id uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  work_item_id      uuid NULL REFERENCES work_item (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  link_path         text NOT NULL CONSTRAINT inbox_notification_link_path_relative
                    CHECK (left(link_path, 1) = '/' AND substr(link_path, 2, 1) NOT IN ('/', E'\\') AND char_length(link_path) <= 500),
  message_key       text NOT NULL CHECK (message_key ~ '^[a-z][a-zA-Z0-9_.]*$' AND char_length(message_key) <= 128),
  message_params    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(message_params) = 'object'),
  dedupe_key        text NOT NULL CHECK (char_length(dedupe_key) BETWEEN 1 AND 200),
  read_at           timestamptz NULL,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inbox_notification_dedupe_key UNIQUE (organization_id, dedupe_key)
);
CREATE INDEX inbox_notification_recipient_idx ON inbox_notification (recipient_user_id, created_at DESC, id DESC);
CREATE INDEX inbox_notification_unread_idx ON inbox_notification (recipient_user_id) WHERE read_at IS NULL;
-- A read notification stays read (read_at is set once).
CREATE FUNCTION inbox_notification_read_once() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN
    RAISE EXCEPTION 'inbox_notification: read_at is set once'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'inbox_notification_read_once';
  END IF;
  IF NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key THEN
    RAISE EXCEPTION 'inbox_notification: recipient and dedupe key are immutable'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'inbox_notification_identity';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inbox_notification_read_once BEFORE UPDATE ON inbox_notification
  FOR EACH ROW EXECUTE FUNCTION inbox_notification_read_once();
SELECT p2_attach_guards('inbox_notification', true);
GRANT SELECT, INSERT, UPDATE ON inbox_notification TO mth_app;

-- A work item's assignee, subject and dedupe key never change; a closed item never reopens.
CREATE FUNCTION work_item_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id OR NEW.subject_type IS DISTINCT FROM OLD.subject_type
     OR NEW.subject_id IS DISTINCT FROM OLD.subject_id OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
     OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'work_item: kind, assignee, subject and dedupe key are immutable'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'work_item_identity';
  END IF;
  IF OLD.status <> 'open' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'work_item: a % item is closed and cannot change status', OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'work_item_closed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER work_item_guard BEFORE UPDATE ON work_item FOR EACH ROW EXECUTE FUNCTION work_item_guard();
