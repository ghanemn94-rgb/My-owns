-- 0090 P5 slice J: the deployment environment marker (production | demo), the demo fixture registry, the demo dataset
-- runs with their record counts and checksums, and the guided-walkthrough catalogue (T-DG5-ARCH-06; ADR-0050;
-- REQ-S18-001, REQ-S18-002, REQ-S18-003, REQ-S18-004, REQ-PB-088, REQ-PB-089, REQ-PB-090). Authored by
-- solution-architect. Contract: docs/architecture/data-dictionary.md ("P5 tables, slices I and J"). Runs as mth_owner
-- inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- D-142 Q7: demo data lives only in a SEPARATELY INITIALIZED demo database selected by configuration; it never shares a
-- database with production. This migration creates the same (empty) tables in every database; it inserts NO
-- deployment_environment row, NO demo record and NO demo user. Production initialization (`mth-db bootstrap`) writes
-- environment_kind 'production'; `mth-db seed-demo` / `reset-demo` write 'demo' into a fresh database and are refused
-- in production mode (ADR-0050 §3). Every demo record and number is SYNTHETIC: an illustrative example, not Mobily
-- actual performance (M0339), and a demo approval approves nothing real (M0412).
-- The twelve walkthrough step titles are VERBATIM segments of M0349; the Arabic titles are PROVISIONAL translations.
-- Nothing here grants or records a business approval, and nothing reads or writes the engineering gates DG0-DG7.

-- -----------------------------------------------------------------------------------------------------------------
-- deployment_environment: at most one row, written once by the initialization command (owner) and never changed
-- (append-only: a production database can never become a demo database, and the reverse). No row means the database
-- was not initialized through a P5 command; the API reports it as 'production' (fail-safe: no synthetic label is ever
-- shown on data that might be real, and demo seeding into it is refused unless the database is empty; ADR-0050 §3).
CREATE TABLE deployment_environment (
  singleton          boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  environment_kind   text NOT NULL CHECK (environment_kind IN ('production', 'demo')),
  initialized_via    text NOT NULL CHECK (initialized_via IN ('bootstrap', 'seed_demo')),
  dataset_code       text NULL CHECK (dataset_code IS NULL OR dataset_code = 'international_roaming'),
  dataset_version    text NULL CHECK (dataset_version IS NULL OR dataset_version ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'),
  synthetic_clock_at timestamptz NULL,
  initialized_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deployment_environment_kind_via CHECK ((environment_kind = 'demo') = (initialized_via = 'seed_demo')),
  CONSTRAINT deployment_environment_demo_dataset CHECK ((environment_kind = 'demo')
    = (dataset_code IS NOT NULL AND dataset_version IS NOT NULL AND synthetic_clock_at IS NOT NULL)
    AND (dataset_code IS NULL) = (dataset_version IS NULL) AND (dataset_code IS NULL) = (synthetic_clock_at IS NULL))
);
SELECT p2_attach_append_only('deployment_environment');
GRANT SELECT ON deployment_environment TO mth_app;

-- demo_seed_record: every record the demo seed created, by table and id, with its stable fixture key (ADR-0050 §4).
-- Inserted only into a demo database (demo_seed_record_demo_only) and only for an existing row of an existing table
-- (demo_seed_record_ref). Append-only. In a production database this table is empty by construction (REQ-S18-003).
CREATE TABLE demo_seed_record (
  record_type text NOT NULL CHECK (record_type ~ '^[a-z][a-z0-9_]{0,62}$'),
  record_id   uuid NOT NULL,
  fixture_key text NOT NULL CONSTRAINT demo_seed_record_fixture_key UNIQUE CHECK (fixture_key ~ '^[a-z0-9][a-z0-9_.-]{0,119}$'),
  PRIMARY KEY (record_type, record_id)
);
CREATE FUNCTION demo_seed_record_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  found_it boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM deployment_environment e WHERE e.environment_kind = 'demo') THEN
    RAISE EXCEPTION 'demo_seed_record: demo records exist only in a database initialized as a demo environment'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'demo_seed_record_demo_only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public'
                   AND c.table_name = NEW.record_type AND c.column_name = 'id' AND c.data_type = 'uuid') THEN
    RAISE EXCEPTION 'demo_seed_record: % is not a table with a uuid id', NEW.record_type
      USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'demo_seed_record_ref';
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1)', NEW.record_type) INTO found_it USING NEW.record_id;
  IF NOT found_it THEN
    RAISE EXCEPTION 'demo_seed_record: % % does not exist', NEW.record_type, NEW.record_id
      USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'demo_seed_record_ref';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER demo_seed_record_guard BEFORE INSERT ON demo_seed_record
  FOR EACH ROW EXECUTE FUNCTION demo_seed_record_guard();
SELECT p2_attach_append_only('demo_seed_record');
GRANT SELECT ON demo_seed_record TO mth_app;

-- demo_dataset_run: the outcome of one seed or reset of the demo database: the record count of every table, the
-- SHA-256 checksum over the business columns (ADR-0050 §5 defines both exactly) and the seed-coverage result of
-- REQ-S18-002 (condition -> count). Numbered 1, 2, ... (demo_dataset_run_step); only in a demo database; append-only.
-- requested_by has no foreign key on purpose: a reset re-creates the demo database, and the requesting user is a
-- seeded demo user whose fixed id is re-created by the seed (ADR-0050 §6).
CREATE TABLE demo_dataset_run (
  id                 uuid PRIMARY KEY,
  run_no             integer NOT NULL CONSTRAINT demo_dataset_run_run_no_key UNIQUE CHECK (run_no >= 1),
  run_kind           text NOT NULL CHECK (run_kind IN ('seed', 'reset')),
  requested_via      text NOT NULL CHECK (requested_via IN ('cli', 'api')),
  requested_by       uuid NULL,
  dataset_code       text NOT NULL CHECK (dataset_code = 'international_roaming'),
  dataset_version    text NOT NULL CHECK (dataset_version ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'),
  synthetic_clock_at timestamptz NOT NULL,
  record_counts      jsonb NOT NULL CHECK (jsonb_typeof(record_counts) = 'object'),
  checksum_sha256    text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  coverage           jsonb NOT NULL CHECK (jsonb_typeof(coverage) = 'object'),
  coverage_complete  boolean NOT NULL,
  completed_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT demo_dataset_run_requester CHECK (requested_via = 'cli' OR requested_by IS NOT NULL),
  CONSTRAINT demo_dataset_run_api_reset CHECK (requested_via = 'cli' OR run_kind = 'reset')
);
CREATE FUNCTION demo_dataset_run_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM deployment_environment e WHERE e.environment_kind = 'demo'
                   AND e.dataset_code = NEW.dataset_code AND e.dataset_version = NEW.dataset_version
                   AND e.synthetic_clock_at = NEW.synthetic_clock_at) THEN
    RAISE EXCEPTION 'demo_dataset_run: a dataset run exists only in a demo database, for its own dataset and synthetic clock'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'demo_dataset_run_demo_only';
  END IF;
  IF NEW.run_no <> coalesce((SELECT max(r.run_no) FROM demo_dataset_run r), 0) + 1 THEN
    RAISE EXCEPTION 'demo_dataset_run: run % is not the next run', NEW.run_no
      USING ERRCODE = 'check_violation', CONSTRAINT = 'demo_dataset_run_step';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER demo_dataset_run_guard BEFORE INSERT ON demo_dataset_run
  FOR EACH ROW EXECUTE FUNCTION demo_dataset_run_guard();
SELECT p2_attach_append_only('demo_dataset_run');
GRANT SELECT ON demo_dataset_run TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- walkthrough_step: the twelve M0349 steps of the guided walkthrough (REQ-S18-004), in order. completion_rule names
-- the API predicate that decides, from the demo transformation's persisted records, whether the step is done
-- (ADR-0050 §7); area_code is the navigation area where the step is performed (ADR-0049 §9). Read-only to mth_app.
CREATE TABLE walkthrough_step (
  code            text PRIMARY KEY CHECK (code ~ '^[a-z][a-z_]{0,47}$'),
  ordinal         smallint NOT NULL CONSTRAINT walkthrough_step_ordinal_key UNIQUE CHECK (ordinal BETWEEN 1 AND 12),
  title_en        text NOT NULL CHECK (char_length(title_en) BETWEEN 1 AND 100),
  title_ar        text NOT NULL CHECK (char_length(title_ar) BETWEEN 1 AND 200),
  area_code       text NOT NULL CHECK (area_code IN ('my_work', 'executive_overview', 'transformations', 'playbook_procedures',
                    'strategy_kpis', 'target_operating_model', 'initiatives_roadmaps', 'governance', 'risks_actions',
                    'benefits_finance', 'change_adoption', 'evidence_reports', 'bau_improvement', 'administration')),
  completion_rule text NOT NULL CONSTRAINT walkthrough_step_completion_rule_key UNIQUE CHECK (completion_rule ~ '^[a-z][a-z_]{0,63}$'),
  source_ref      text NOT NULL CHECK (source_ref = 'M0349')
);
GRANT SELECT ON walkthrough_step TO mth_app;
INSERT INTO walkthrough_step (code, ordinal, title_en, title_ar, area_code, completion_rule, source_ref) VALUES
  ('create_transformation', 1, 'create transformation', 'إنشاء التحول', 'transformations', 'transformation_created', 'M0349'),
  ('diagnose_baseline', 2, 'diagnose and agree baseline', 'التشخيص والاتفاق على خط الأساس', 'strategy_kpis', 'baseline_agreed', 'M0349'),
  ('define_outcomes_kpis', 3, 'define outcomes/KPIs', 'تحديد النتائج/مؤشرات الأداء', 'strategy_kpis', 'outcomes_kpis_defined', 'M0349'),
  ('design_tom', 4, 'design TOM', 'تصميم نموذج التشغيل المستهدف', 'target_operating_model', 'tom_designed', 'M0349'),
  ('prioritize_mobilize', 5, 'prioritize initiatives and approve mobilization', 'ترتيب أولويات المبادرات واعتماد التعبئة', 'initiatives_roadmaps', 'mobilization_approved', 'M0349'),
  ('update_delivery_adoption', 6, 'update delivery/adoption', 'تحديث التنفيذ/التبنّي', 'change_adoption', 'delivery_adoption_updated', 'M0349'),
  ('submit_kpi_actual', 7, 'submit KPI actual', 'إدخال القيمة الفعلية لمؤشر الأداء', 'strategy_kpis', 'kpi_actual_submitted', 'M0349'),
  ('validate_benefit', 8, 'validate benefit', 'التحقق من المنفعة', 'benefits_finance', 'benefit_validated', 'M0349'),
  ('resolve_decision', 9, 'resolve executive decision', 'حسم القرار التنفيذي', 'governance', 'executive_decision_resolved', 'M0349'),
  ('generate_report', 10, 'generate report', 'إنشاء التقرير', 'evidence_reports', 'report_generated', 'M0349'),
  ('accept_bau_handover', 11, 'accept BAU handover', 'قبول التسليم للعمليات الاعتيادية', 'bau_improvement', 'bau_handover_accepted', 'M0349'),
  ('continue_monitoring', 12, 'continue performance monitoring', 'مواصلة متابعة الأداء', 'bau_improvement', 'performance_monitoring_continued', 'M0349');
SELECT p2_attach_append_only('walkthrough_step');
