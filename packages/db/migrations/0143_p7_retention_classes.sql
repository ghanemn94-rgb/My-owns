-- 0143 P7 slice E: the retention class registry and the table-to-class map, generated from the catalogue
-- (T-DG7-ARCH-03; ADR-0067 §1-§3). Authored by solution-architect. Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- REQ-S16-024 (acceptance "A19/A22: the configuration lists every record class; an archival job run on test data
-- archives only records past retention and logs each action"; note "Retention periods must be agreed with Mobily IT;
-- defaults are placeholders") under D-243 Q3:
--   * every class starts as action 'retain' with period_days NULL, shown as "not set (IT to agree)", so a fresh
--     installation archives and purges nothing;
--   * the IT approval of a period is a REFERENCE text an administrator types (for example a change ticket); it is never
--     an approval granted by the platform or by an agent;
--   * business, audit, snapshot, system and derived classes are 'retain' only (CHECK retention_class_retain_only):
--     nothing in them is ever archived or purged by P7 code (p7-plan §3 seams 5 and 9);
--   * 'archive' and 'archive_then_purge' exist only for operational classes, 'archive' only where every table of the
--     class declares an age column, and 'archive_then_purge' only where every table is purge-eligible
--     (trigger retention_class_guard);
--   * a class whose rows an existing DG1 job already removes on expiry (managed_by_job) stays 'retain': the retention
--     job never touches it, and its credential hashes are never written to an archive set (D-243 Q16).
--
--   retention_class        one row per record class (12 seeded here). mth_app reads it and updates only action,
--                          period_days, it_approval_reference and the version/updated columns (putRetentionClass,
--                          If-Match). Audited (retention_class.updated).
--   retention_table_class  one row per public base table: its class, its primary key columns (the archived record's
--                          key), its age column (NULL: never eligible) and whether a purge is allowed. Written by
--                          migrations only and append-only: every later migration that creates a table adds its row in
--                          the same file (catalogue test "every public base table has exactly one retention class").
-- Nothing here reads or writes DG0-DG7. No code grants a business, Finance or IT approval.

CREATE TABLE retention_class (
  id                     uuid PRIMARY KEY,
  code                   text NOT NULL CONSTRAINT retention_class_code_key UNIQUE
                           CHECK (code ~ '^[a-z][a-z0-9_]{2,62}$'),
  category               text NOT NULL CHECK (category IN ('business', 'audit', 'snapshot', 'system', 'derived',
                           'operational')),
  label_en               text NOT NULL CHECK (char_length(label_en) BETWEEN 1 AND 200),
  label_ar               text NOT NULL CHECK (char_length(label_ar) BETWEEN 1 AND 200),
  description_en         text NOT NULL CHECK (char_length(description_en) BETWEEN 1 AND 1000),
  description_ar         text NOT NULL CHECK (char_length(description_ar) BETWEEN 1 AND 1000),
  managed_by_job         text NULL CHECK (managed_by_job IS NULL OR managed_by_job ~ '^[a-z_]+\.[a-z_.-]+$'),
  action                 text NOT NULL DEFAULT 'retain' CHECK (action IN ('retain', 'archive', 'archive_then_purge')),
  period_days            integer NULL CHECK (period_days IS NULL OR period_days BETWEEN 1 AND 36500),
  it_approval_reference  text NULL CHECK (it_approval_reference IS NULL
                           OR char_length(btrim(it_approval_reference)) BETWEEN 3 AND 500),
  version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- D-243 Q3: only operational classes can leave 'retain'; a class managed by an existing expiry job never does.
  CONSTRAINT retention_class_retain_only CHECK (action = 'retain'
    OR (category = 'operational' AND managed_by_job IS NULL)),
  -- An enabled action needs the agreed period and the IT reference text that records who agreed it outside the
  -- platform (never an approval by the platform).
  CONSTRAINT retention_class_enabled_shape CHECK (action = 'retain'
    OR (period_days IS NOT NULL AND it_approval_reference IS NOT NULL))
);

CREATE TABLE retention_table_class (
  table_name          text PRIMARY KEY CHECK (table_name ~ '^[a-z][a-z0-9_]{0,62}$'),
  retention_class_id  uuid NOT NULL REFERENCES retention_class (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  key_columns         text[] NOT NULL CHECK (cardinality(key_columns) BETWEEN 1 AND 4
                        AND array_position(key_columns, NULL) IS NULL),
  age_column          text NULL CHECK (age_column IS NULL OR age_column ~ '^[a-z][a-z0-9_]{0,62}$'),
  purge_eligible      boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retention_table_class_purge_needs_age CHECK (NOT purge_eligible OR age_column IS NOT NULL)
);
CREATE INDEX retention_table_class_class_idx ON retention_table_class (retention_class_id, table_name);

-- The 12 classes (ADR-0067 §2). Ids are fixed so later migrations can name them.
INSERT INTO retention_class (id, code, category, label_en, label_ar, description_en, description_ar, managed_by_job) VALUES
  ('01930000-0000-7000-8000-000000143001', 'business_record', 'business', 'Business records', 'سجلات الأعمال',
   'Every transformation, governance, value, KPI, configuration and history record. Kept; never archived or purged by the platform.',
   'جميع سجلات التحول والحوكمة والقيمة والمؤشرات والإعدادات والسجل التاريخي. تُحفظ ولا تُؤرشف أو تُحذف من قِبل المنصة.', NULL),
  ('01930000-0000-7000-8000-000000143002', 'audit_trail', 'audit', 'Audit trail', 'سجل التدقيق',
   'The append-only audit trail. Never purged by the application.',
   'سجل التدقيق غير القابل للتعديل. لا يحذفه التطبيق أبداً.', NULL),
  ('01930000-0000-7000-8000-000000143003', 'report_snapshot', 'snapshot', 'Report and ranking snapshots', 'لقطات التقارير والترتيب',
   'Approved report snapshots and ranking snapshots. Kept unchanged so historical reports never change.',
   'لقطات التقارير المعتمدة ولقطات الترتيب. تُحفظ دون تغيير حتى لا تتغير التقارير التاريخية.', NULL),
  ('01930000-0000-7000-8000-000000143004', 'system_catalogue', 'system', 'System catalogues', 'فهارس النظام',
   'The migration level and the platform''s own rule catalogues. Kept.',
   'مستوى الترحيل وفهارس القواعد الخاصة بالمنصة. تُحفظ.', NULL),
  ('01930000-0000-7000-8000-000000143005', 'derived_index', 'derived', 'Derived search index', 'فهرس البحث المشتق',
   'The search index, rebuilt from the records by the reindex job. Kept.',
   'فهرس البحث الذي يُعاد بناؤه من السجلات بواسطة مهمة إعادة الفهرسة. يُحفظ.', NULL),
  ('01930000-0000-7000-8000-000000143006', 'retention_backup_history', 'audit', 'Retention and backup history', 'سجل الاحتفاظ والنسخ الاحتياطي',
   'Retention runs, their actions, archived-record markers and reported backup sets. Never purged.',
   'عمليات الاحتفاظ وإجراءاتها ومؤشرات السجلات المؤرشفة ومجموعات النسخ الاحتياطي المُبلغ عنها. لا تُحذف أبداً.', NULL),
  ('01930000-0000-7000-8000-000000143007', 'expiring_credential', 'operational', 'Sessions and sign-in states', 'الجلسات وحالات تسجيل الدخول',
   'Sessions, single-use sign-in states and request replay records. Removed on expiry by the existing maintenance job; never archived.',
   'الجلسات وحالات تسجيل الدخول أحادية الاستخدام وسجلات منع تكرار الطلبات. تُزال عند انتهاء صلاحيتها بواسطة مهمة الصيانة الحالية ولا تُؤرشف.',
   'platform.purge-expired'),
  ('01930000-0000-7000-8000-000000143008', 'job_history', 'operational', 'Completed job runs', 'سجل تشغيل المهام المكتملة',
   'The history of finished scheduled job runs. Can be archived; never purged (append-only).',
   'سجل عمليات تشغيل المهام المجدولة المنتهية. يمكن أرشفته ولا يُحذف (غير قابل للتعديل).', NULL),
  ('01930000-0000-7000-8000-000000143009', 'webhook_receipt_log', 'operational', 'Webhook receipts', 'سجل استلام الخطافات',
   'Signed webhook receipts. Can be archived; never purged (append-only).',
   'إيصالات الخطافات الموقعة. يمكن أرشفتها ولا تُحذف (غير قابلة للتعديل).', NULL),
  ('01930000-0000-7000-8000-000000143010', 'processed_message_log', 'operational', 'Processed message markers', 'مؤشرات الرسائل المعالجة',
   'Exactly-once markers of consumed messages. Can be archived, then purged.',
   'مؤشرات المعالجة لمرة واحدة للرسائل المستهلكة. يمكن أرشفتها ثم حذفها.', NULL),
  ('01930000-0000-7000-8000-000000143011', 'worker_heartbeat_log', 'operational', 'Worker heartbeats', 'نبضات العامل',
   'Heartbeats of worker instances. Can be archived, then purged.',
   'نبضات مثيلات العامل. يمكن أرشفتها ثم حذفها.', NULL),
  ('01930000-0000-7000-8000-000000143012', 'inbox_read_item', 'operational', 'Read inbox notifications', 'إشعارات صندوق الوارد المقروءة',
   'Inbox notifications the recipient has read. Can be archived, then purged when nothing references them.',
   'إشعارات صندوق الوارد التي قرأها المستلم. يمكن أرشفتها ثم حذفها عندما لا يشير إليها أي سجل.', NULL);

-- The explicit (non-business) tables (ADR-0067 §3). The age column marks the only tables a run may ever select.
INSERT INTO retention_table_class (table_name, retention_class_id, key_columns, age_column, purge_eligible) VALUES
  ('audit_event', '01930000-0000-7000-8000-000000143002', '{id}', NULL, false),
  ('report_snapshot', '01930000-0000-7000-8000-000000143003', '{id}', NULL, false),
  ('report_snapshot_aggregate', '01930000-0000-7000-8000-000000143003', '{id}', NULL, false),
  ('report_snapshot_evidence', '01930000-0000-7000-8000-000000143003', '{id}', NULL, false),
  ('report_snapshot_source', '01930000-0000-7000-8000-000000143003', '{id}', NULL, false),
  ('report_snapshot_version', '01930000-0000-7000-8000-000000143003', '{id}', NULL, false),
  ('ranking_snapshot', '01930000-0000-7000-8000-000000143003', '{id}', NULL, false),
  ('schema_migration', '01930000-0000-7000-8000-000000143004', '{id}', NULL, false),
  ('transfer_table_rule', '01930000-0000-7000-8000-000000143004', '{table_name}', NULL, false),
  ('transfer_column_rule', '01930000-0000-7000-8000-000000143004', '{table_name,column_name}', NULL, false),
  ('retention_class', '01930000-0000-7000-8000-000000143004', '{id}', NULL, false),
  ('retention_table_class', '01930000-0000-7000-8000-000000143004', '{table_name}', NULL, false),
  ('search_document', '01930000-0000-7000-8000-000000143005', '{id}', NULL, false),
  ('search_index_state', '01930000-0000-7000-8000-000000143005', '{id}', NULL, false),
  ('session', '01930000-0000-7000-8000-000000143007', '{id}', NULL, false),
  ('oidc_login_state', '01930000-0000-7000-8000-000000143007', '{state_hash}', NULL, false),
  ('idempotency_record', '01930000-0000-7000-8000-000000143007', '{user_id,key}', NULL, false),
  ('job_run', '01930000-0000-7000-8000-000000143008', '{id}', 'finished_at', false),
  ('webhook_receipt', '01930000-0000-7000-8000-000000143009', '{id}', 'received_at', false),
  ('processed_message', '01930000-0000-7000-8000-000000143010', '{consumer,idempotency_key}', 'processed_at', true),
  ('worker_heartbeat', '01930000-0000-7000-8000-000000143011', '{id}', 'last_beat_at', true),
  ('inbox_notification', '01930000-0000-7000-8000-000000143012', '{id}', 'read_at', true);

-- Generated from the catalogue: every other public base table that exists now is a business record, with its primary
-- key read from pg_index. A table without a primary key fails the key_columns CHECK, so the migration stops.
INSERT INTO retention_table_class (table_name, retention_class_id, key_columns)
SELECT c.relname, '01930000-0000-7000-8000-000000143001'::uuid,
       ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
             JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum ORDER BY k.ord)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  LEFT JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary
 WHERE c.relkind IN ('r', 'p')
   AND NOT EXISTS (SELECT 1 FROM retention_table_class r WHERE r.table_name = c.relname);

-- The explicit rows name existing tables with their real primary keys and age columns (a typo stops the migration).
DO $$
DECLARE
  r record;
  pk text[];
BEGIN
  FOR r IN SELECT * FROM retention_table_class LOOP
    SELECT ARRAY(SELECT a.attname::text FROM pg_index i
                   CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
                   JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                  WHERE i.indrelid = format('public.%I', r.table_name)::regclass AND i.indisprimary
                  ORDER BY k.ord) INTO pk;
    IF pk IS DISTINCT FROM r.key_columns THEN
      RAISE EXCEPTION 'retention_table_class %: key_columns % are not the primary key %', r.table_name, r.key_columns, pk;
    END IF;
    IF r.age_column IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = r.table_name AND column_name = r.age_column
         AND data_type = 'timestamp with time zone') THEN
      RAISE EXCEPTION 'retention_table_class %: age column % is not a timestamptz column', r.table_name, r.age_column;
    END IF;
  END LOOP;
END $$;

SELECT p2_attach_append_only('retention_table_class');
GRANT SELECT ON retention_table_class TO mth_app;

-- Seeds are in; from here every change is versioned and audited.
SELECT p2_attach_guards('retention_class', true);
GRANT SELECT ON retention_class TO mth_app;
GRANT UPDATE (action, period_days, it_approval_reference, version, updated_at, updated_by) ON retention_class TO mth_app;

CREATE FUNCTION retention_class_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF (NEW.code, NEW.category, NEW.label_en, NEW.label_ar, NEW.description_en, NEW.description_ar, NEW.managed_by_job)
     IS DISTINCT FROM
     (OLD.code, OLD.category, OLD.label_en, OLD.label_ar, OLD.description_en, OLD.description_ar, OLD.managed_by_job) THEN
    RAISE EXCEPTION 'retention_class: the class definition never changes; only action, period and IT reference do'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'retention_class_definition_immutable';
  END IF;
  IF NEW.category <> 'operational' OR NEW.managed_by_job IS NOT NULL THEN
    RETURN NEW; -- CHECK retention_class_retain_only decides (only 'retain' is possible)
  END IF;
  IF NEW.action IN ('archive', 'archive_then_purge') AND EXISTS (
       SELECT 1 FROM retention_table_class t WHERE t.retention_class_id = NEW.id AND t.age_column IS NULL) THEN
    RAISE EXCEPTION 'retention_class %: a table of this class has no age column, so it cannot be archived', NEW.code
      USING ERRCODE = 'check_violation', CONSTRAINT = 'retention_class_action_eligible';
  END IF;
  IF NEW.action = 'archive_then_purge' AND EXISTS (
       SELECT 1 FROM retention_table_class t WHERE t.retention_class_id = NEW.id AND NOT t.purge_eligible) THEN
    RAISE EXCEPTION 'retention_class %: a table of this class is not purge-eligible', NEW.code
      USING ERRCODE = 'check_violation', CONSTRAINT = 'retention_class_action_eligible';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER retention_class_guard BEFORE UPDATE ON retention_class
  FOR EACH ROW EXECUTE FUNCTION retention_class_guard();
CREATE TRIGGER retention_class_no_delete BEFORE DELETE OR TRUNCATE ON retention_class
  FOR EACH STATEMENT EXECUTE FUNCTION p2_append_only();
