-- 0086 P5 slice H: the 90-day launch plan as editable scheduled tasks, the Day-90 leadership test, the 25-question
-- Transformation Health Check (HealthAssessment) and its versioned scoring schemes (T-DG5-ARCH-05; ADR-0048;
-- REQ-PB-086, REQ-PB-087, REQ-PB-091, REQ-PB-092, REQ-S14-001, REQ-S14-002, REQ-S14-003, REQ-S14-004, REQ-S16-021).
-- Authored by solution-architect. Contract: docs/architecture/data-dictionary.md ("P5 tables, slices G and H"). Runs as
-- mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor:
-- PostgreSQL 16. Ids come from the application (UUIDv7); seed rows use fixed literal UUIDs.
--
-- Source texts: the launch windows, objectives, actions and outputs are VERBATIM from B0134, the Day-90 questions
-- from B0136-B0141, the health-check bands from B0152 (D-142 Q5: the playbook text, not the master-prompt paraphrase).
-- Every Arabic text in this file is a PROVISIONAL translation that needs review by a Mobily Arabic editor.
-- The 25 health questions are the source_element rows of set 'health_question' (0064, verbatim B0150); they are not
-- copied here. The Yes=1/No=0 scheme v1 is an IMPLEMENTATION ASSUMPTION (M0262, D-010), not a source rule.
--
-- Slice A objects touched (DG5 code, not yet approved; the 0068 precedent): methodology_element's element-type CHECK
-- gains 'health_response' and 'health_band', and methodology_element_guard() is redefined with every 0062/0068 rule
-- kept verbatim plus the health_check_scheme kind's types. No DG1-DG4 table, constraint or function changes.
-- Nothing here grants or records a business approval, and nothing reads or writes the engineering gates DG0-DG7.

-- -----------------------------------------------------------------------------------------------------------------
-- Catalogues (read-only to mth_app; rows come from migrations).
-- launch_window: the three B0134 windows. Day d of a plan is start date + d CALENDAR days (D-142 Q6): a window's tasks
-- start on day start_day and are due on day end_day (Days 31-60 of a plan starting 2026-10-01: 2026-11-01..2026-11-30).
CREATE TABLE launch_window (
  code             text PRIMARY KEY CHECK (code IN ('days_0_30', 'days_31_60', 'days_61_90')),
  ordinal          smallint NOT NULL CONSTRAINT launch_window_ordinal_key UNIQUE CHECK (ordinal BETWEEN 1 AND 3),
  start_day        smallint NOT NULL CHECK (start_day BETWEEN 0 AND 90),
  end_day          smallint NOT NULL CHECK (end_day BETWEEN 0 AND 90),
  label_en         text NOT NULL CHECK (char_length(label_en) BETWEEN 1 AND 40),
  label_ar         text NOT NULL CHECK (char_length(label_ar) BETWEEN 1 AND 80),
  objective_en     text NOT NULL CHECK (char_length(objective_en) BETWEEN 1 AND 100),
  objective_ar     text NOT NULL CHECK (char_length(objective_ar) BETWEEN 1 AND 200),
  actions_source_en text NOT NULL CHECK (char_length(actions_source_en) BETWEEN 1 AND 500),
  outputs_source_en text NOT NULL CHECK (char_length(outputs_source_en) BETWEEN 1 AND 500),
  source_ref       text NOT NULL CHECK (source_ref = 'B0134'),
  CONSTRAINT launch_window_days CHECK (start_day <= end_day)
);
GRANT SELECT ON launch_window TO mth_app;
INSERT INTO launch_window (code, ordinal, start_day, end_day, label_en, label_ar, objective_en, objective_ar, actions_source_en, outputs_source_en, source_ref) VALUES
  ('days_0_30', 1, 0, 30, 'Days 0-30', 'الأيام 0-30', 'Diagnose & align', 'التشخيص والمواءمة',
   'Confirm sponsor; build baseline; interview stakeholders; map journeys/processes; quantify value pools; establish initial governance.',
   'Charter v0.9; diagnostic; baseline; issue tree; governance.', 'B0134'),
  ('days_31_60', 2, 31, 60, 'Days 31-60', 'الأيام 31-60', 'Define & design', 'التحديد والتصميم',
   'Agree North Star/outcomes; build KPI tree; design TOM; run design decisions; identify initiatives; size benefits.',
   'North Star; KPI tree; TOM; initiative backlog; initial business case.', 'B0134'),
  ('days_61_90', 3, 61, 90, 'Days 61-90', 'الأيام 61-90', 'Mobilize & prove', 'التعبئة والإثبات',
   'Prioritize portfolio; assign owners; sequence roadmap; launch Wave 1 pilots; establish benefits register and executive dashboard.',
   'Roadmap; initiative cards; dashboard; benefits register; Wave 1 evidence.', 'B0134');

-- launch_template_item: the B0134 cell texts split at ';' (the platform's split; each fragment verbatim, without the
-- separator and the cell's final '.'), one task each, plus the Day-90 leadership test (B0135) due on day 90.
-- output_record_type is the record type an output task links to (NULL where no single record type is the output).
CREATE TABLE launch_template_item (
  code               text PRIMARY KEY CHECK (code ~ '^(w[1-3]_(a|o)[1-9]|day_ninety_test)$'),
  window_code        text NOT NULL REFERENCES launch_window (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  item_kind          text NOT NULL CHECK (item_kind IN ('action', 'output', 'day_ninety_test')),
  ordinal            smallint NOT NULL CONSTRAINT launch_template_item_ordinal_key UNIQUE CHECK (ordinal BETWEEN 1 AND 99),
  text_en            text NOT NULL CHECK (char_length(text_en) BETWEEN 1 AND 200),
  text_ar            text NOT NULL CHECK (char_length(text_ar) BETWEEN 1 AND 300),
  output_record_type text NULL CHECK (output_record_type IS NULL OR output_record_type IN ('charter', 'diagnostic_item', 'baseline',
                       'north_star', 'kpi_definition', 'tom_canvas_cell', 'initiative', 'business_case', 'roadmap_wave', 'benefit',
                       'evidence', 'meeting_series')),
  start_day          smallint NOT NULL CHECK (start_day BETWEEN 0 AND 90),
  due_day            smallint NOT NULL CHECK (due_day BETWEEN 0 AND 90),
  source_ref         text NOT NULL CHECK (source_ref IN ('B0134', 'B0135')),
  CONSTRAINT launch_template_item_days CHECK (start_day <= due_day),
  CONSTRAINT launch_template_item_output CHECK (output_record_type IS NULL OR item_kind = 'output')
);
GRANT SELECT ON launch_template_item TO mth_app;
INSERT INTO launch_template_item (code, window_code, item_kind, ordinal, text_en, text_ar, output_record_type, start_day, due_day, source_ref) VALUES
  ('w1_a1', 'days_0_30', 'action', 1, 'Confirm sponsor', 'تأكيد الراعي', NULL, 0, 30, 'B0134'),
  ('w1_a2', 'days_0_30', 'action', 2, 'build baseline', 'بناء خط الأساس', NULL, 0, 30, 'B0134'),
  ('w1_a3', 'days_0_30', 'action', 3, 'interview stakeholders', 'إجراء مقابلات مع أصحاب المصلحة', NULL, 0, 30, 'B0134'),
  ('w1_a4', 'days_0_30', 'action', 4, 'map journeys/processes', 'رسم الرحلات/العمليات', NULL, 0, 30, 'B0134'),
  ('w1_a5', 'days_0_30', 'action', 5, 'quantify value pools', 'تقدير مجمّعات القيمة كمياً', NULL, 0, 30, 'B0134'),
  ('w1_a6', 'days_0_30', 'action', 6, 'establish initial governance', 'إرساء الحوكمة الأولية', NULL, 0, 30, 'B0134'),
  ('w1_o1', 'days_0_30', 'output', 7, 'Charter v0.9', 'الميثاق الإصدار 0.9', 'charter', 0, 30, 'B0134'),
  ('w1_o2', 'days_0_30', 'output', 8, 'diagnostic', 'التشخيص', 'diagnostic_item', 0, 30, 'B0134'),
  ('w1_o3', 'days_0_30', 'output', 9, 'baseline', 'خط الأساس', 'baseline', 0, 30, 'B0134'),
  ('w1_o4', 'days_0_30', 'output', 10, 'issue tree', 'شجرة المشكلات', NULL, 0, 30, 'B0134'),
  ('w1_o5', 'days_0_30', 'output', 11, 'governance', 'الحوكمة', 'meeting_series', 0, 30, 'B0134'),
  ('w2_a1', 'days_31_60', 'action', 12, 'Agree North Star/outcomes', 'الاتفاق على النجم الشمالي/النتائج', NULL, 31, 60, 'B0134'),
  ('w2_a2', 'days_31_60', 'action', 13, 'build KPI tree', 'بناء شجرة مؤشرات الأداء', NULL, 31, 60, 'B0134'),
  ('w2_a3', 'days_31_60', 'action', 14, 'design TOM', 'تصميم نموذج التشغيل المستهدف', NULL, 31, 60, 'B0134'),
  ('w2_a4', 'days_31_60', 'action', 15, 'run design decisions', 'إدارة قرارات التصميم', NULL, 31, 60, 'B0134'),
  ('w2_a5', 'days_31_60', 'action', 16, 'identify initiatives', 'تحديد المبادرات', NULL, 31, 60, 'B0134'),
  ('w2_a6', 'days_31_60', 'action', 17, 'size benefits', 'تقدير حجم المنافع', NULL, 31, 60, 'B0134'),
  ('w2_o1', 'days_31_60', 'output', 18, 'North Star', 'النجم الشمالي', 'north_star', 31, 60, 'B0134'),
  ('w2_o2', 'days_31_60', 'output', 19, 'KPI tree', 'شجرة مؤشرات الأداء', 'kpi_definition', 31, 60, 'B0134'),
  ('w2_o3', 'days_31_60', 'output', 20, 'TOM', 'نموذج التشغيل المستهدف', 'tom_canvas_cell', 31, 60, 'B0134'),
  ('w2_o4', 'days_31_60', 'output', 21, 'initiative backlog', 'قائمة المبادرات', 'initiative', 31, 60, 'B0134'),
  ('w2_o5', 'days_31_60', 'output', 22, 'initial business case', 'دراسة الجدوى الأولية', 'business_case', 31, 60, 'B0134'),
  ('w3_a1', 'days_61_90', 'action', 23, 'Prioritize portfolio', 'ترتيب أولويات المحفظة', NULL, 61, 90, 'B0134'),
  ('w3_a2', 'days_61_90', 'action', 24, 'assign owners', 'تعيين الملاك', NULL, 61, 90, 'B0134'),
  ('w3_a3', 'days_61_90', 'action', 25, 'sequence roadmap', 'ترتيب خارطة الطريق', NULL, 61, 90, 'B0134'),
  ('w3_a4', 'days_61_90', 'action', 26, 'launch Wave 1 pilots', 'إطلاق المشاريع التجريبية للموجة الأولى', NULL, 61, 90, 'B0134'),
  ('w3_a5', 'days_61_90', 'action', 27, 'establish benefits register and executive dashboard', 'إنشاء سجل المنافع واللوحة التنفيذية', NULL, 61, 90, 'B0134'),
  ('w3_o1', 'days_61_90', 'output', 28, 'Roadmap', 'خارطة الطريق', 'roadmap_wave', 61, 90, 'B0134'),
  ('w3_o2', 'days_61_90', 'output', 29, 'initiative cards', 'بطاقات المبادرات', 'initiative', 61, 90, 'B0134'),
  ('w3_o3', 'days_61_90', 'output', 30, 'dashboard', 'اللوحة', NULL, 61, 90, 'B0134'),
  ('w3_o4', 'days_61_90', 'output', 31, 'benefits register', 'سجل المنافع', 'benefit', 61, 90, 'B0134'),
  ('w3_o5', 'days_61_90', 'output', 32, 'Wave 1 evidence', 'أدلة الموجة الأولى', 'evidence', 61, 90, 'B0134'),
  ('day_ninety_test', 'days_61_90', 'day_ninety_test', 33, 'Day-90 leadership test', 'اختبار القيادة في اليوم 90', NULL, 90, 90, 'B0135');

-- day_ninety_question: the six Day-90 leadership test questions, verbatim (B0136-B0141). evidence_record_types names the
-- record types the API reads to pre-fill evidence suggestions (REQ-PB-087 "pre-fills evidence where available").
CREATE TABLE day_ninety_question (
  code                  text PRIMARY KEY CHECK (code ~ '^q[1-6]$'),
  ordinal               smallint NOT NULL CONSTRAINT day_ninety_question_ordinal_key UNIQUE CHECK (ordinal BETWEEN 1 AND 6),
  text_en               text NOT NULL CHECK (char_length(text_en) BETWEEN 1 AND 300),
  text_ar               text NOT NULL CHECK (char_length(text_ar) BETWEEN 1 AND 400),
  source_ref            text NOT NULL CONSTRAINT day_ninety_question_source_ref_key UNIQUE CHECK (source_ref ~ '^B01(3[6-9]|4[01])$'),
  evidence_record_types text[] NOT NULL CHECK (cardinality(evidence_record_types) BETWEEN 1 AND 5)
);
GRANT SELECT ON day_ninety_question TO mth_app;
INSERT INTO day_ninety_question (code, ordinal, text_en, text_ar, source_ref, evidence_record_types) VALUES
  ('q1', 1, 'Can leaders explain the same case for change and North Star?', 'هل يستطيع القادة شرح مبررات التغيير والنجم الشمالي ذاتهما؟', 'B0136', ARRAY['charter', 'north_star']),
  ('q2', 2, 'Can every initiative be traced to a target-state gap and outcome?', 'هل يمكن تتبع كل مبادرة إلى فجوة في الحالة المستهدفة وإلى نتيجة؟', 'B0137', ARRAY['initiative', 'tom_gap', 'outcome']),
  ('q3', 3, 'Are executive decision rights clear?', 'هل صلاحيات القرار التنفيذية واضحة؟', 'B0138', ARRAY['decision_right']),
  ('q4', 4, 'Is Finance aligned on baselines and benefit formulas?', 'هل المالية متوافقة على خطوط الأساس ومعادلات المنافع؟', 'B0139', ARRAY['baseline', 'benefit_formula']),
  ('q5', 5, 'Are Wave 1 initiatives producing evidence rather than only plans?', 'هل تنتج مبادرات الموجة الأولى أدلة لا مجرد خطط؟', 'B0140', ARRAY['evidence', 'initiative']),
  ('q6', 6, 'Can the transformation team show what it needs from executives this month?', 'هل يستطيع فريق التحول أن يبيّن ما يحتاجه من التنفيذيين هذا الشهر؟', 'B0141', ARRAY['executive_ask']);

-- -----------------------------------------------------------------------------------------------------------------
-- launch_plan: at most one per transformation (REQ-PB-086). Generated once (idempotency key
-- 'launch_plan:<transformationId>', the S12-004 port key of ADR-0044 §1) from the template above and a start date;
-- changing the start date re-dates the unstarted tasks in the same transaction (ADR-0048 §2; lock 730267).
CREATE TABLE launch_plan (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT
                      CONSTRAINT launch_plan_transformation_key UNIQUE,
  start_date        date NOT NULL,
  template_ref      text NOT NULL DEFAULT 'B0134' CHECK (template_ref = 'B0134'),
  generated_via     text NOT NULL CHECK (generated_via IN ('request', 'automation')),
  idempotency_key   text NOT NULL CONSTRAINT launch_plan_idempotency_key UNIQUE,
  last_shift_days   integer NULL CHECK (last_shift_days IS NULL OR last_shift_days <> 0),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT launch_plan_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT launch_plan_idempotency_shape CHECK (idempotency_key = 'launch_plan:' || transformation_id::text)
);
CREATE FUNCTION launch_plan_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  launch_plan_lock_class CONSTANT integer := 730267;
BEGIN
  PERFORM pg_advisory_xact_lock(launch_plan_lock_class, hashtext(NEW.transformation_id::text));
  IF TG_OP = 'UPDATE' AND (NEW.template_ref IS DISTINCT FROM OLD.template_ref OR NEW.generated_via IS DISTINCT FROM OLD.generated_via
                           OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key) THEN
    RAISE EXCEPTION 'launch_plan: the template, origin and idempotency key never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'launch_plan_identity_fixed';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.start_date IS DISTINCT FROM OLD.start_date
     AND NEW.last_shift_days IS DISTINCT FROM (NEW.start_date - OLD.start_date) THEN
    RAISE EXCEPTION 'launch_plan: last_shift_days records the start-date shift in days'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'launch_plan_shift_recorded';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER launch_plan_guard BEFORE INSERT OR UPDATE ON launch_plan FOR EACH ROW EXECUTE FUNCTION launch_plan_guard();
SELECT p2_attach_guards('launch_plan', true);
GRANT SELECT, INSERT, UPDATE ON launch_plan TO mth_app;

-- launch_task: one editable scheduled task (REQ-S14-004). Template tasks carry their template item (and so the verbatim
-- source text); custom tasks have none. Status: not_started -> in_progress | completed | cancelled;
-- in_progress -> not_started | completed | cancelled; completed -> in_progress (reopen); cancelled is final.
-- A completed task's dates never change (a start-date shift moves only not_started tasks; ADR-0048 §2).
CREATE TABLE launch_task (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id  uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  plan_id            uuid NOT NULL,
  ordinal            smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 999),
  template_item_code text NULL REFERENCES launch_template_item (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  window_code        text NOT NULL REFERENCES launch_window (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  task_kind          text NOT NULL CHECK (task_kind IN ('action', 'output', 'day_ninety_test', 'custom')),
  title              text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  notes              text NULL CHECK (notes IS NULL OR char_length(notes) BETWEEN 1 AND 4000),
  start_date         date NOT NULL,
  due_date           date NOT NULL,
  owner_user_id      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status             text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed', 'cancelled')),
  completed_at       timestamptz NULL,
  completed_by       uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  output_record_type text NULL CHECK (output_record_type IS NULL OR output_record_type IN ('charter', 'diagnostic_item', 'baseline',
                       'north_star', 'kpi_definition', 'tom_canvas_cell', 'initiative', 'business_case', 'roadmap_wave', 'benefit',
                       'evidence', 'meeting_series')),
  output_record_id   uuid NULL,
  version            integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT launch_task_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT launch_task_plan_fkey FOREIGN KEY (transformation_id, plan_id)
    REFERENCES launch_plan (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT launch_task_ordinal_key UNIQUE (plan_id, ordinal),
  CONSTRAINT launch_task_template_key UNIQUE (plan_id, template_item_code),
  CONSTRAINT launch_task_kind_template CHECK ((task_kind = 'custom') = (template_item_code IS NULL)),
  CONSTRAINT launch_task_dates CHECK (due_date >= start_date),
  CONSTRAINT launch_task_completed_stamps CHECK ((status = 'completed') = (completed_at IS NOT NULL)
                                                AND (completed_at IS NULL) = (completed_by IS NULL)),
  CONSTRAINT launch_task_output_link CHECK (output_record_id IS NULL OR output_record_type IS NOT NULL)
);
CREATE INDEX launch_task_plan_idx ON launch_task (plan_id, due_date, ordinal);
CREATE FUNCTION launch_task_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  t launch_template_item%ROWTYPE;
  found_it boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'not_started' THEN
      RAISE EXCEPTION 'launch_task: a task is created not started'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'launch_task_created_not_started';
    END IF;
    IF NEW.template_item_code IS NOT NULL THEN
      SELECT * INTO t FROM launch_template_item WHERE code = NEW.template_item_code;
      IF FOUND AND (t.item_kind <> NEW.task_kind OR t.window_code <> NEW.window_code
                    OR t.output_record_type IS DISTINCT FROM NEW.output_record_type) THEN
        RAISE EXCEPTION 'launch_task: a template task keeps its template item''s kind, window and output record type'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'launch_task_template_match';
      END IF;
    END IF;
  ELSE
    IF NEW.plan_id IS DISTINCT FROM OLD.plan_id OR NEW.template_item_code IS DISTINCT FROM OLD.template_item_code
       OR NEW.task_kind IS DISTINCT FROM OLD.task_kind OR NEW.window_code IS DISTINCT FROM OLD.window_code
       OR NEW.ordinal IS DISTINCT FROM OLD.ordinal
       OR (OLD.template_item_code IS NOT NULL AND NEW.output_record_type IS DISTINCT FROM OLD.output_record_type) THEN
      RAISE EXCEPTION 'launch_task: plan, template item, kind, window, ordinal and a template output type never change'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'launch_task_identity_fixed';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY['not_started>in_progress', 'not_started>completed',
         'not_started>cancelled', 'in_progress>not_started', 'in_progress>completed', 'in_progress>cancelled', 'completed>in_progress']) THEN
      RAISE EXCEPTION 'launch_task: % -> % is not an allowed transition', OLD.status, NEW.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'launch_task_status_step';
    END IF;
    IF OLD.status = 'cancelled' THEN
      RAISE EXCEPTION 'launch_task: a cancelled task is final'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'launch_task_status_step';
    END IF;
    IF OLD.status = 'completed' AND (NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.due_date IS DISTINCT FROM OLD.due_date) THEN
      RAISE EXCEPTION 'launch_task: a completed task keeps its dates'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'launch_task_completed_dates_fixed';
    END IF;
  END IF;
  IF NEW.output_record_id IS NOT NULL THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND transformation_id = $2)', NEW.output_record_type)
      INTO found_it USING NEW.output_record_id, NEW.transformation_id;
    IF NOT found_it THEN
      RAISE EXCEPTION 'launch_task: % % is not a record of this transformation', NEW.output_record_type, NEW.output_record_id
        USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'launch_task_output_record';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER launch_task_guard BEFORE INSERT OR UPDATE ON launch_task FOR EACH ROW EXECUTE FUNCTION launch_task_guard();
SELECT p2_attach_guards('launch_task', true);
GRANT SELECT, INSERT, UPDATE ON launch_task TO mth_app;

-- launch_task_predecessor: "task X needs task Y first" (REQ-S14-004 dependencies). Both tasks are in the same plan; no
-- task precedes itself, directly or through a chain of active links (cycle check under lock 730267). A link is never
-- deleted: removing it sets removed_at/removed_by (its only change; each add and removal is audited), and re-adding
-- makes a new row. "Blocked by" is derived on read: the active predecessors whose status is not completed
-- (ADR-0048 §3).
CREATE TABLE launch_task_predecessor (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id   uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  task_id             uuid NOT NULL,
  predecessor_task_id uuid NOT NULL,
  removed_at          timestamptz NULL,
  removed_by          uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT launch_task_predecessor_task_fkey FOREIGN KEY (transformation_id, task_id)
    REFERENCES launch_task (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT launch_task_predecessor_pred_fkey FOREIGN KEY (transformation_id, predecessor_task_id)
    REFERENCES launch_task (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT launch_task_predecessor_not_self CHECK (task_id <> predecessor_task_id),
  CONSTRAINT launch_task_predecessor_removed_complete CHECK ((removed_at IS NULL) = (removed_by IS NULL))
);
CREATE UNIQUE INDEX launch_task_predecessor_active_key ON launch_task_predecessor (task_id, predecessor_task_id)
  WHERE removed_at IS NULL;
CREATE FUNCTION launch_task_predecessor_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  launch_plan_lock_class CONSTANT integer := 730267;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.task_id IS DISTINCT FROM OLD.task_id OR NEW.predecessor_task_id IS DISTINCT FROM OLD.predecessor_task_id
       OR OLD.removed_at IS NOT NULL OR NEW.removed_at IS NULL THEN
      RAISE EXCEPTION 'launch_task_predecessor: the only change of a link is its removal'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'launch_task_predecessor_immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'launch_task_predecessor: a link is created active'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'launch_task_predecessor_immutable';
  END IF;
  PERFORM pg_advisory_xact_lock(launch_plan_lock_class, hashtext(NEW.transformation_id::text));
  IF (SELECT plan_id FROM launch_task WHERE id = NEW.task_id) IS DISTINCT FROM (SELECT plan_id FROM launch_task WHERE id = NEW.predecessor_task_id) THEN
    RAISE EXCEPTION 'launch_task_predecessor: both tasks belong to the same launch plan'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'launch_task_predecessor_same_plan';
  END IF;
  IF EXISTS (WITH RECURSIVE up(id) AS (
               SELECT NEW.predecessor_task_id
               UNION
               SELECT p.predecessor_task_id FROM launch_task_predecessor p JOIN up ON p.task_id = up.id
                WHERE p.removed_at IS NULL)
             SELECT 1 FROM up WHERE up.id = NEW.task_id) THEN
    RAISE EXCEPTION 'launch_task_predecessor: the link would create a cycle'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'launch_task_predecessor_no_cycle';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER launch_task_predecessor_guard BEFORE INSERT OR UPDATE ON launch_task_predecessor
  FOR EACH ROW EXECUTE FUNCTION launch_task_predecessor_guard();
SELECT p2_attach_guards('launch_task_predecessor', true);
GRANT SELECT, INSERT, UPDATE ON launch_task_predecessor TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- day_ninety_test: the Day-90 leadership test of a plan (REQ-PB-087), created with the plan and scheduled on day 90
-- (= the plan's start date + 90; it moves with a start-date shift while the test is open). It is INCOMPLETE while any
-- of the six questions has no response; it can be completed only with all six (checked at COMMIT).
CREATE TABLE day_ninety_test (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  plan_id           uuid NOT NULL CONSTRAINT day_ninety_test_plan_key UNIQUE,
  scheduled_date    date NOT NULL,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed')),
  answered_count    smallint NOT NULL DEFAULT 0 CHECK (answered_count BETWEEN 0 AND 6),
  completed_at      timestamptz NULL,
  completed_by      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT day_ninety_test_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT day_ninety_test_plan_fkey FOREIGN KEY (transformation_id, plan_id)
    REFERENCES launch_plan (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT day_ninety_test_completed_complete CHECK ((status = 'completed') = (completed_at IS NOT NULL)
    AND (completed_at IS NULL) = (completed_by IS NULL) AND (status <> 'completed' OR answered_count = 6))
);
CREATE FUNCTION day_ninety_test_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' AND (NEW.status <> 'open' OR NEW.answered_count <> 0) THEN
    RAISE EXCEPTION 'day_ninety_test: a test is created open with no response'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'day_ninety_test_created_open';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.plan_id IS DISTINCT FROM OLD.plan_id OR (OLD.status = 'completed') THEN
      RAISE EXCEPTION 'day_ninety_test: the plan never changes, and a completed test is final'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'day_ninety_test_completed_final';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER day_ninety_test_guard BEFORE INSERT OR UPDATE ON day_ninety_test FOR EACH ROW EXECUTE FUNCTION day_ninety_test_guard();
SELECT p2_attach_guards('day_ninety_test', true);
GRANT SELECT, INSERT, UPDATE ON day_ninety_test TO mth_app;

-- day_ninety_response: one leader response per question (yes or no, with an optional comment and evidence), written only
-- while the test is open. Changing a response steps its version (its own audit event).
CREATE TABLE day_ninety_response (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  test_id           uuid NOT NULL,
  question_code     text NOT NULL REFERENCES day_ninety_question (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  answer            text NOT NULL CHECK (answer IN ('yes', 'no')),
  comment           text NULL CHECK (comment IS NULL OR char_length(comment) BETWEEN 1 AND 2000),
  evidence_id       uuid NULL,
  responded_by      uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT day_ninety_response_test_fkey FOREIGN KEY (transformation_id, test_id)
    REFERENCES day_ninety_test (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT day_ninety_response_evidence_fkey FOREIGN KEY (transformation_id, evidence_id)
    REFERENCES evidence (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT day_ninety_response_key UNIQUE (test_id, question_code)
);
CREATE FUNCTION day_ninety_response_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.test_id IS DISTINCT FROM OLD.test_id OR NEW.question_code IS DISTINCT FROM OLD.question_code) THEN
    RAISE EXCEPTION 'day_ninety_response: the test and question never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'day_ninety_response_identity_fixed';
  END IF;
  IF EXISTS (SELECT 1 FROM day_ninety_test t WHERE t.id = NEW.test_id AND t.status <> 'open') THEN
    RAISE EXCEPTION 'day_ninety_response: responses are recorded only while the test is open'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'day_ninety_response_test_open';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER day_ninety_response_guard BEFORE INSERT OR UPDATE ON day_ninety_response FOR EACH ROW EXECUTE FUNCTION day_ninety_response_guard();
SELECT p2_attach_guards('day_ninety_response', true);
GRANT SELECT, INSERT, UPDATE ON day_ninety_response TO mth_app;

-- Checked at COMMIT: a test's answered_count equals its responses (attached to both tables).
CREATE FUNCTION day_ninety_test_counted() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  tid uuid := CASE WHEN TG_TABLE_NAME = 'day_ninety_test' THEN (to_jsonb(NEW)->>'id')::uuid ELSE (to_jsonb(NEW)->>'test_id')::uuid END;
BEGIN
  IF (SELECT answered_count FROM day_ninety_test WHERE id = tid) <> (SELECT count(*) FROM day_ninety_response r WHERE r.test_id = tid) THEN
    RAISE EXCEPTION 'day_ninety_test %: answered_count must equal its responses', tid
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'day_ninety_test_answered_count';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER day_ninety_test_counted AFTER INSERT OR UPDATE ON day_ninety_test
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION day_ninety_test_counted();
CREATE CONSTRAINT TRIGGER day_ninety_response_counted AFTER INSERT ON day_ninety_response
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION day_ninety_test_counted();

-- -----------------------------------------------------------------------------------------------------------------
-- Health-check scoring schemes (REQ-S14-003): versions of configuration kind 'health_check_scheme', published through
-- the slice A pipeline (ADR-0039). A scheme's elements are its allowed responses ('health_response', stable keys yes,
-- no, partial, na; attribute `credit` a decimal string, null for na) and its interpretation bands ('health_band';
-- attribute `minScore` a decimal string: a score falls in the band with the highest minScore not above it).
ALTER TABLE methodology_element DROP CONSTRAINT methodology_element_element_type_check;
ALTER TABLE methodology_element
  ADD CONSTRAINT methodology_element_element_type_check CHECK (element_type IN (
    'methodology_text', 'phase', 'gate', 'gate_criterion', 'mandatory_artifact', 'checklist_item',
    'template', 'tom_dimension', 'approver_route', 'reminder', 'escalation_rule', 'dashboard',
    'report_layout', 'source_element', 'scoring_weight', 'scoring_rubric', 'form', 'form_field',
    'health_response', 'health_band'));

-- methodology_element_guard(): every rule of 0062 and 0068 is kept verbatim; the additions are marked "ADR-0048".
CREATE OR REPLACE FUNCTION methodology_element_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v record;
  allowed text[];
  roles text[];
  rt text;
  fk text;
  src_type text;
BEGIN
  SELECT m.status, m.draft_stage, m.config_kind INTO v FROM methodology_version m WHERE m.id = NEW.methodology_version_id;
  IF NOT (v.status = 'draft' AND v.draft_stage IN ('editing', 'preview'))
     AND current_user <> 'mth_owner' AND current_user NOT IN (SELECT rolname FROM pg_roles WHERE rolsuper) THEN
    RAISE EXCEPTION 'methodology_element %: elements change only in a draft being edited; a published version is immutable', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_element_draft_only';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.methodology_version_id IS DISTINCT FROM OLD.methodology_version_id
      OR NEW.element_type IS DISTINCT FROM OLD.element_type OR NEW.stable_key IS DISTINCT FROM OLD.stable_key
      OR NEW.origin IS DISTINCT FROM OLD.origin) THEN
    RAISE EXCEPTION 'methodology_element %: version, type, stable key and origin never change (REQ-S06-006)', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_element_identity_fixed';
  END IF;
  allowed := CASE v.config_kind
    WHEN 'methodology' THEN ARRAY['methodology_text', 'phase', 'gate', 'gate_criterion', 'mandatory_artifact',
                                  'checklist_item', 'template', 'tom_dimension', 'approver_route', 'reminder',
                                  'escalation_rule', 'dashboard', 'report_layout', 'source_element']
    WHEN 'scoring_defaults' THEN ARRAY['scoring_weight', 'scoring_rubric']
    WHEN 'form_schema' THEN ARRAY['form', 'form_field'] -- ADR-0041 §2
    WHEN 'health_check_scheme' THEN ARRAY['health_response', 'health_band'] -- ADR-0048 §6
    ELSE ARRAY[]::text[] END;
  IF NOT NEW.element_type = ANY (allowed) THEN
    RAISE EXCEPTION 'methodology_element %: type % does not belong to configuration kind %', NEW.id, NEW.element_type, v.config_kind
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_element_kind_type';
  END IF;
  IF (NEW.origin = 'source' AND NOT (CASE NEW.element_type
       WHEN 'phase' THEN EXISTS (SELECT 1 FROM phase_definition d WHERE d.code = NEW.stable_key)
       WHEN 'gate' THEN EXISTS (SELECT 1 FROM gate_definition d WHERE d.code = NEW.stable_key)
       WHEN 'tom_dimension' THEN EXISTS (SELECT 1 FROM tom_dimension d WHERE d.code = NEW.stable_key)
       WHEN 'gate_criterion' THEN EXISTS (SELECT 1 FROM gate_criterion_definition d WHERE d.key = NEW.stable_key)
       WHEN 'template' THEN EXISTS (SELECT 1 FROM source_element s WHERE s.set_code = 'template' AND s.stable_key = NEW.stable_key)
       WHEN 'source_element' THEN EXISTS (SELECT 1 FROM source_element s WHERE s.set_code || '.' || s.stable_key = NEW.stable_key)
       -- ADR-0041 §2: a form is a registered record type; a source field is a registered source column.
       WHEN 'form' THEN EXISTS (SELECT 1 FROM form_record_type f WHERE f.code = NEW.stable_key)
       WHEN 'form_field' THEN EXISTS (SELECT 1 FROM form_source_field f WHERE f.record_type || '.' || f.field_key = NEW.stable_key)
       ELSE true END))
     OR (NEW.element_type IN ('scoring_weight', 'scoring_rubric') AND NOT NEW.stable_key = ANY (ARRAY[
           'strategic_fit', 'financial_value', 'customer_impact', 'feasibility', 'time_to_value', 'risk_compliance']))
     -- ADR-0048 §6: the four response keys; a source band is one of the four B0152 bands.
     OR (NEW.element_type = 'health_response' AND NOT NEW.stable_key = ANY (ARRAY['yes', 'no', 'partial', 'na']))
     OR (NEW.element_type = 'health_band' AND NEW.origin = 'source' AND NOT NEW.stable_key = ANY (ARRAY[
           'b0152_21_25', 'b0152_16_20', 'b0152_10_15', 'b0152_0_9'])) THEN
    RAISE EXCEPTION 'methodology_element %: % % is not a stable source identity', NEW.id, NEW.element_type, NEW.stable_key
      USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'methodology_element_source_identity';
  END IF;
  IF NEW.element_type = 'scoring_weight' AND NOT (jsonb_typeof(NEW.attributes->'weightPercent') = 'string'
       AND NEW.attributes->>'weightPercent' ~ '^(100(\.0{1,2})?|[0-9]{1,2}(\.[0-9]{1,2})?)$'
       AND (NEW.attributes->>'weightPercent')::numeric > 0) THEN
    RAISE EXCEPTION 'methodology_element %: weightPercent is a decimal string in (0, 100] with at most 2 decimals', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_element_weight_decimal';
  END IF;
  -- ADR-0041 §2-§3: form fields.
  IF NEW.element_type = 'form_field' THEN
    rt := split_part(NEW.stable_key, '.', 1);
    fk := substr(NEW.stable_key, char_length(rt) + 2);
    IF NEW.origin = 'admin' AND (
         NOT EXISTS (SELECT 1 FROM form_record_type f WHERE f.code = rt AND f.custom_fields_allowed)
         OR fk !~ '^[a-z][a-z0-9_]{0,39}$'
         OR EXISTS (SELECT 1 FROM form_source_field f WHERE f.record_type = rt AND f.field_key = fk)) THEN
      RAISE EXCEPTION 'methodology_element %: an extension field is <recordType>.<key> of a record type that allows extension fields, and never reuses a source column key', NEW.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_element_extension_field_key';
    END IF;
    IF NEW.origin = 'source' AND NEW.attributes ? 'fieldType' THEN
      SELECT f.field_type INTO src_type FROM form_source_field f WHERE f.record_type || '.' || f.field_key = NEW.stable_key;
      IF NEW.attributes->>'fieldType' IS DISTINCT FROM src_type THEN
        RAISE EXCEPTION 'methodology_element %: the type of source column % is fixed (%); relabel it instead (REQ-S05-002)', NEW.id, NEW.stable_key, src_type
          USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_element_source_field_type_fixed';
      END IF;
    END IF;
    IF NEW.origin = 'admin' AND NOT coalesce(CASE NEW.attributes->>'fieldType'
         WHEN 'calculated' THEN jsonb_typeof(NEW.attributes->'expression') = 'string'
                                AND char_length(NEW.attributes->>'expression') BETWEEN 1 AND 2000
         WHEN 'currency' THEN coalesce(NEW.attributes->>'currencyCode', 'SAR') ~ '^[A-Z]{3}$'
         WHEN 'choice' THEN jsonb_typeof(NEW.attributes->'options') = 'array'
                            AND jsonb_array_length(NEW.attributes->'options') BETWEEN 1 AND 100
         WHEN 'reference' THEN jsonb_typeof(NEW.attributes->'targetRecordType') = 'string'
         WHEN 'lookup' THEN jsonb_typeof(NEW.attributes->'lookupSet') = 'string'
         ELSE true END, false) THEN
      RAISE EXCEPTION 'methodology_element %: field type % is missing its required settings (ADR-0041 §3)', NEW.id, NEW.attributes->>'fieldType'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_element_field_settings';
    END IF;
  END IF;
  -- ADR-0048 §6: decimal strings only (never a float). A response credit is "0", "1" or a fraction with at most two
  -- decimals, or null for na; a band's minScore has at most two decimals, and the band carries both texts.
  IF NEW.element_type = 'health_response' AND NOT coalesce(
       (NEW.stable_key = 'na' AND jsonb_typeof(NEW.attributes->'credit') = 'null')
       OR (NEW.stable_key <> 'na' AND jsonb_typeof(NEW.attributes->'credit') = 'string'
           AND NEW.attributes->>'credit' ~ '^(0|1|0\.[0-9]{1,2})$'), false) THEN
    RAISE EXCEPTION 'methodology_element %: a health response credit is a decimal string in [0, 1] (null for na)', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_element_health_credit';
  END IF;
  IF NEW.element_type = 'health_band' AND NOT coalesce(jsonb_typeof(NEW.attributes->'minScore') = 'string'
       AND NEW.attributes->>'minScore' ~ '^[0-9]{1,3}(\.[0-9]{1,2})?$'
       AND jsonb_typeof(NEW.attributes->'textEn') = 'string' AND jsonb_typeof(NEW.attributes->'textAr') = 'string'
       AND jsonb_typeof(NEW.attributes->'rangeLabel') = 'string', false) THEN
    RAISE EXCEPTION 'methodology_element %: a health band has a decimal-string minScore, a rangeLabel and both texts', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_element_health_band';
  END IF;
  roles := ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(NEW.attributes->'approverRoleCodes') = 'array'
                                                        THEN NEW.attributes->'approverRoleCodes' ELSE '[]'::jsonb END))
           || ARRAY(SELECT NEW.attributes->>k FROM unnest(ARRAY['approverRoleCode', 'defaultApproverRoleCode']) AS k
                    WHERE NEW.attributes ? k);
  IF EXISTS (SELECT 1 FROM unnest(roles) AS c(code) LEFT JOIN role r ON r.code = c.code
             WHERE r.code IS NULL OR r.kind = 'technical_admin' OR r.code = 'AUD') THEN
    RAISE EXCEPTION 'methodology_element %: an approver must be an existing business role, never a technical administrator or AUD (REQ-S06-006, REQ-S10-003)', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_element_no_admin_approver';
  END IF;
  RETURN NEW;
END $$;

-- The publish rule of a health-check scheme (ADR-0048 §6), checked when a draft becomes published:
--   definition.scoreBasis is 'points' (out of 25) or 'percent_of_applicable'; definition.questionCount is 25;
--   responses yes (credit 1) and no (credit 0) are present; partial has a credit strictly between 0 and 1; na has none;
--   na needs scoreBasis 'percent_of_applicable';
--   at least one band, one of them at minScore 0, every minScore distinct and not above the maximum (25 or 100);
--   a scheme with partial or na uses ONLY its own bands: none of the four source bands (origin 'source', B0152) may
--   remain in it (M0262 "do not silently reuse the original interpretation bands").
CREATE FUNCTION p5_health_scheme_problem(p_version_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  d jsonb;
  basis text;
  mx numeric;
  has_na boolean;
  has_partial boolean;
BEGIN
  SELECT definition INTO d FROM methodology_version WHERE id = p_version_id;
  basis := d->>'scoreBasis';
  IF basis IS NULL OR basis NOT IN ('points', 'percent_of_applicable') OR d->>'questionCount' IS DISTINCT FROM '25' THEN
    RETURN 'health_scheme_definition';
  END IF;
  mx := CASE basis WHEN 'points' THEN 25 ELSE 100 END;
  IF NOT EXISTS (SELECT 1 FROM methodology_element e WHERE e.methodology_version_id = p_version_id AND NOT e.removed
                   AND e.element_type = 'health_response' AND e.stable_key = 'yes' AND e.attributes->>'credit' = '1')
     OR NOT EXISTS (SELECT 1 FROM methodology_element e WHERE e.methodology_version_id = p_version_id AND NOT e.removed
                   AND e.element_type = 'health_response' AND e.stable_key = 'no' AND e.attributes->>'credit' = '0') THEN
    RETURN 'health_scheme_yes_no_required';
  END IF;
  SELECT bool_or(e.stable_key = 'na'), bool_or(e.stable_key = 'partial') INTO has_na, has_partial
    FROM methodology_element e WHERE e.methodology_version_id = p_version_id AND NOT e.removed AND e.element_type = 'health_response';
  IF EXISTS (SELECT 1 FROM methodology_element e WHERE e.methodology_version_id = p_version_id AND NOT e.removed
               AND e.element_type = 'health_response' AND (
                 (e.stable_key = 'partial' AND NOT coalesce(jsonb_typeof(e.attributes->'credit') = 'string'
                    AND e.attributes->>'credit' ~ '^0\.[0-9]{1,2}$' AND (e.attributes->>'credit')::numeric > 0, false))
                 OR (e.stable_key = 'na' AND jsonb_typeof(e.attributes->'credit') IS DISTINCT FROM 'null'))) THEN
    RETURN 'health_scheme_credit';
  END IF;
  IF has_na AND basis <> 'percent_of_applicable' THEN
    RETURN 'health_scheme_na_needs_percent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM methodology_element e WHERE e.methodology_version_id = p_version_id AND NOT e.removed
                   AND e.element_type = 'health_band' AND e.attributes->>'minScore' ~ '^0+(\.0+)?$')
     OR EXISTS (SELECT 1 FROM methodology_element e WHERE e.methodology_version_id = p_version_id AND NOT e.removed
                  AND e.element_type = 'health_band' AND NOT coalesce(e.attributes->>'minScore' ~ '^[0-9]{1,3}(\.[0-9]{1,2})?$'
                                                              AND (e.attributes->>'minScore')::numeric <= mx, false))
     OR (SELECT count(*) <> count(DISTINCT (e.attributes->>'minScore')::numeric) FROM methodology_element e
          WHERE e.methodology_version_id = p_version_id AND NOT e.removed AND e.element_type = 'health_band') THEN
    RETURN 'health_scheme_bands_invalid';
  END IF;
  IF (has_na OR has_partial) AND EXISTS (SELECT 1 FROM methodology_element e WHERE e.methodology_version_id = p_version_id
        AND NOT e.removed AND e.element_type = 'health_band' AND e.origin = 'source') THEN
    RETURN 'health_scheme_own_bands_required';
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION health_scheme_publish_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  problem text;
BEGIN
  IF NEW.config_kind = 'health_check_scheme' AND OLD.status = 'draft' AND NEW.status = 'published' THEN
    problem := p5_health_scheme_problem(NEW.id);
    IF problem IS NOT NULL THEN
      RAISE EXCEPTION 'methodology_version %: this health-check scheme cannot be published (%)', NEW.id, problem
        USING ERRCODE = 'check_violation', CONSTRAINT = problem;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER health_scheme_publish_guard BEFORE UPDATE ON methodology_version
  FOR EACH ROW EXECUTE FUNCTION health_scheme_publish_guard();

-- The seeded scheme v1 (key 'health-check'): Yes = 1, No = 0, score out of 25, and the four B0152 bands verbatim.
-- An IMPLEMENTATION ASSUMPTION (M0262, D-010): the source gives checkboxes and 'Score: ____ / 25' only.
INSERT INTO methodology_version (id, key, version_no, status, title_en, title_ar, source_document, source_sha256,
                                 definition, content_sha256, published_at, config_kind, origin) VALUES
  ('01920005-0860-7000-8000-000000000001', 'health-check', 1, 'published',
   'Health-check scoring v1 (Yes = 1, No = 0; out of 25)', 'تقييم فحص الصحة — الإصدار 1 (نعم = 1، لا = 0؛ من 25) (ترجمة مؤقتة)',
   'docs/source/playbook.md (B0150, B0152); docs/source/master-prompt-v2.0.md (M0262)', NULL,
   '{"scoreBasis": "points", "questionCount": 25, "implementationAssumption": true, "assumptionRef": "M0262", "sourceRefs": ["B0150", "B0152"]}'::jsonb,
   encode(sha256(convert_to('health-check/1:yes=1,no=0:points/25:B0152', 'UTF8')), 'hex'),
   now(), 'health_check_scheme', 'seed');
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, reason, source) VALUES
  ('01920005-0860-7000-8000-0000000000ff', 'system', 'methodology_version.seed', 'methodology_version', '01920005-0860-7000-8000-000000000001', 1,
   'Seeded health-check scoring scheme v1 (T-DG5-ARCH-05)', 'migration');
INSERT INTO methodology_element (id, methodology_version_id, element_type, stable_key, origin, ordinal, attributes) VALUES
  ('01920005-0861-7000-8000-000000000001', '01920005-0860-7000-8000-000000000001', 'health_response', 'yes', 'source', 1,
   '{"credit": "1", "labelEn": "Yes", "labelAr": "نعم", "sourceRef": "B0150"}'),
  ('01920005-0861-7000-8000-000000000002', '01920005-0860-7000-8000-000000000001', 'health_response', 'no', 'source', 2,
   '{"credit": "0", "labelEn": "No", "labelAr": "لا", "sourceRef": "B0150"}'),
  ('01920005-0862-7000-8000-000000000001', '01920005-0860-7000-8000-000000000001', 'health_band', 'b0152_21_25', 'source', 1,
   '{"minScore": "21", "rangeLabel": "21-25", "textEn": "Strong transformation discipline; focus on value acceleration and continuous improvement.", "textAr": "انضباط قوي في التحول؛ ركّز على تسريع القيمة والتحسين المستمر.", "sourceRef": "B0152"}'),
  ('01920005-0862-7000-8000-000000000002', '01920005-0860-7000-8000-000000000001', 'health_band', 'b0152_16_20', 'source', 2,
   '{"minScore": "16", "rangeLabel": "16-20", "textEn": "Solid foundation; address a few structural gaps before scaling.", "textAr": "أساس متين؛ عالج بعض الفجوات الهيكلية قبل التوسع.", "sourceRef": "B0152"}'),
  ('01920005-0862-7000-8000-000000000003', '01920005-0860-7000-8000-000000000001', 'health_band', 'b0152_10_15', 'source', 3,
   '{"minScore": "10", "rangeLabel": "10-15", "textEn": "Execution risk is material; strengthen direction, TOM, governance or benefits.", "textAr": "مخاطر التنفيذ جوهرية؛ عزّز التوجه أو نموذج التشغيل المستهدف أو الحوكمة أو المنافع.", "sourceRef": "B0152"}'),
  ('01920005-0862-7000-8000-000000000004', '01920005-0860-7000-8000-000000000001', 'health_band', 'b0152_0_9', 'source', 4,
   '{"minScore": "0", "rangeLabel": "0-9", "textEn": "Transformation is likely being managed as disconnected projects; reset around outcomes and operating model.", "textAr": "يُرجَّح أن التحول يُدار كمشاريع منفصلة؛ أعد ضبطه حول النتائج ونموذج التشغيل.", "sourceRef": "B0152"}');
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, reason, source)
SELECT mth_uuid_v7(), 'system', 'methodology_element.seed', 'methodology_element', e.id, 1,
       'Seeded health-check scoring scheme v1 (T-DG5-ARCH-05)', 'migration'
  FROM methodology_element e WHERE e.methodology_version_id = '01920005-0860-7000-8000-000000000001';
DO $$
BEGIN
  IF p5_health_scheme_problem('01920005-0860-7000-8000-000000000001') IS NOT NULL THEN
    RAISE EXCEPTION '0086: the seeded health-check scheme v1 breaks its own publish rule (%)',
      p5_health_scheme_problem('01920005-0860-7000-8000-000000000001');
  END IF;
END $$;

-- -----------------------------------------------------------------------------------------------------------------
-- health_assessment (HealthAssessment, REQ-S16-021; REQ-PB-091, REQ-S14-001..003): one assessment of the 25 questions
-- under one scheme version (fixed at creation: the transformation's health_check_scheme pin, else v1; ADR-0039 §3).
-- draft -> submitted (final). While any question is unanswered the assessment is INCOMPLETE and has no score and no
-- band. Submission needs 25 answers and the top 3 actions; the database recomputes the score and band from the
-- answers and the scheme and refuses any other value (lock 730268). Reassessments are new rows in sequence order,
-- each naming the previous submitted one; a submitted assessment keeps its scheme version, score and band forever.
CREATE TABLE health_assessment (
  id                     uuid PRIMARY KEY,
  organization_id        uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id      uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  sequence_no            smallint NOT NULL CHECK (sequence_no BETWEEN 1 AND 9999),
  scheme_version_id      uuid NOT NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  assessment_date        date NOT NULL,
  owner_user_id          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status                 text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  answered_count         smallint NOT NULL DEFAULT 0 CHECK (answered_count BETWEEN 0 AND 25),
  score                  numeric(7,2) NULL CHECK (score IS NULL OR score >= 0),
  score_max              numeric(7,2) NULL CHECK (score_max IS NULL OR score_max IN (25, 100)),
  band_key               text NULL CHECK (band_key IS NULL OR band_key ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$'),
  previous_assessment_id uuid NULL,
  submitted_at           timestamptz NULL,
  submitted_by           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT health_assessment_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT health_assessment_sequence_key UNIQUE (transformation_id, sequence_no),
  CONSTRAINT health_assessment_previous_fkey FOREIGN KEY (transformation_id, previous_assessment_id)
    REFERENCES health_assessment (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT health_assessment_submitted_complete CHECK (
    (status = 'submitted') = (submitted_at IS NOT NULL) AND (submitted_at IS NULL) = (submitted_by IS NULL)
    AND (status = 'submitted') = (score IS NOT NULL) AND (score IS NULL) = (score_max IS NULL)
    AND (score IS NULL) = (band_key IS NULL) AND (status <> 'submitted' OR answered_count = 25)
    AND (score IS NULL OR score <= score_max))
);
-- At most one draft per transformation.
CREATE UNIQUE INDEX health_assessment_one_draft_key ON health_assessment (transformation_id) WHERE status = 'draft';

-- The score and band of an assessment from its answers and its scheme (NULLs while incomplete or not computable).
CREATE FUNCTION p5_health_assessment_result(p_assessment_id uuid, OUT score numeric, OUT score_max numeric, OUT band_key text)
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  a health_assessment%ROWTYPE;
  basis text;
  answered integer;
  applicable integer;
  total numeric;
BEGIN
  SELECT * INTO a FROM health_assessment WHERE id = p_assessment_id;
  SELECT m.definition->>'scoreBasis' INTO basis FROM methodology_version m WHERE m.id = a.scheme_version_id;
  SELECT count(*), count(c.credit), coalesce(sum(c.credit), 0) INTO answered, applicable, total
    FROM health_assessment_answer x
    LEFT JOIN LATERAL (SELECT (e.attributes->>'credit')::numeric AS credit FROM methodology_element e
                        WHERE e.methodology_version_id = a.scheme_version_id AND e.element_type = 'health_response'
                          AND e.stable_key = x.response AND NOT e.removed) c ON true
   WHERE x.assessment_id = p_assessment_id;
  IF answered < 25 OR applicable = 0 THEN
    score := NULL; score_max := NULL; band_key := NULL;
    RETURN;
  END IF;
  IF basis = 'points' THEN
    score := round(total, 2); score_max := 25;
  ELSE
    score := round(100 * total / applicable, 2); score_max := 100;
  END IF;
  SELECT e.stable_key INTO band_key FROM methodology_element e
   WHERE e.methodology_version_id = a.scheme_version_id AND e.element_type = 'health_band' AND NOT e.removed
     AND (e.attributes->>'minScore')::numeric <= score
   ORDER BY (e.attributes->>'minScore')::numeric DESC LIMIT 1;
END $$;

CREATE FUNCTION health_assessment_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  health_assessment_lock_class CONSTANT integer := 730268;
  r record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR NEW.answered_count <> 0 THEN
      RAISE EXCEPTION 'health_assessment: an assessment is created as a draft with no answer'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'health_assessment_created_draft';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM methodology_version m WHERE m.id = NEW.scheme_version_id
                     AND m.config_kind = 'health_check_scheme' AND m.status = 'published') THEN
      RAISE EXCEPTION 'health_assessment: the scheme must be a published health-check scoring scheme version'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'health_assessment_scheme_published';
    END IF;
    IF NEW.previous_assessment_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM health_assessment p WHERE p.id = NEW.previous_assessment_id AND p.status = 'submitted'
           AND p.sequence_no < NEW.sequence_no) THEN
      RAISE EXCEPTION 'health_assessment: a reassessment names an earlier submitted assessment'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'health_assessment_previous_submitted';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.scheme_version_id IS DISTINCT FROM OLD.scheme_version_id OR NEW.sequence_no IS DISTINCT FROM OLD.sequence_no
     OR NEW.previous_assessment_id IS DISTINCT FROM OLD.previous_assessment_id THEN
    RAISE EXCEPTION 'health_assessment: the scheme version, sequence and previous assessment never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'health_assessment_scheme_fixed';
  END IF;
  IF OLD.status = 'submitted' THEN
    RAISE EXCEPTION 'health_assessment: a submitted assessment is final (reassess with a new assessment)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'health_assessment_submitted_final';
  END IF;
  IF NEW.status = 'submitted' THEN
    PERFORM pg_advisory_xact_lock(health_assessment_lock_class, hashtext(NEW.id::text));
    IF (SELECT count(*) FROM health_assessment_action x WHERE x.assessment_id = NEW.id) <> 3 THEN
      RAISE EXCEPTION 'health_assessment: submission needs the top 3 actions'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'health_assessment_three_actions';
    END IF;
    SELECT * INTO r FROM p5_health_assessment_result(NEW.id);
    IF r.score IS NULL THEN
      RAISE EXCEPTION 'health_assessment: an incomplete or not computable assessment cannot be submitted'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'health_assessment_incomplete';
    END IF;
    IF NEW.score IS DISTINCT FROM r.score OR NEW.score_max IS DISTINCT FROM r.score_max OR NEW.band_key IS DISTINCT FROM r.band_key THEN
      RAISE EXCEPTION 'health_assessment: score %/% and band % differ from the scheme result %/% and %', NEW.score, NEW.score_max,
        NEW.band_key, r.score, r.score_max, r.band_key
        USING ERRCODE = 'check_violation', CONSTRAINT = 'health_assessment_score_matches';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER health_assessment_guard BEFORE INSERT OR UPDATE ON health_assessment
  FOR EACH ROW EXECUTE FUNCTION health_assessment_guard();
SELECT p2_attach_guards('health_assessment', true);
GRANT SELECT, INSERT, UPDATE ON health_assessment TO mth_app;

-- health_assessment_answer: the response, evidence, owner and action of one question (M0262), written only while the
-- assessment is a draft. The response is one of the scheme version's (non-removed) health_response keys.
CREATE TABLE health_assessment_answer (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  assessment_id     uuid NOT NULL,
  question_code     text NOT NULL CHECK (question_code ~ '^q(0[1-9]|1[0-9]|2[0-5])$'),
  response          text NOT NULL CHECK (response IN ('yes', 'no', 'partial', 'na')),
  evidence_note     text NULL CHECK (evidence_note IS NULL OR char_length(evidence_note) BETWEEN 1 AND 2000),
  evidence_id       uuid NULL,
  owner_user_id     uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  action_note       text NULL CHECK (action_note IS NULL OR char_length(action_note) BETWEEN 1 AND 1000),
  answered_by       uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT health_assessment_answer_parent_fkey FOREIGN KEY (transformation_id, assessment_id)
    REFERENCES health_assessment (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT health_assessment_answer_evidence_fkey FOREIGN KEY (transformation_id, evidence_id)
    REFERENCES evidence (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT health_assessment_answer_key UNIQUE (assessment_id, question_code)
);
CREATE FUNCTION health_assessment_answer_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  a health_assessment%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.assessment_id IS DISTINCT FROM OLD.assessment_id OR NEW.question_code IS DISTINCT FROM OLD.question_code) THEN
    RAISE EXCEPTION 'health_assessment_answer: the assessment and question never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'health_assessment_answer_identity_fixed';
  END IF;
  SELECT * INTO a FROM health_assessment WHERE id = NEW.assessment_id;
  IF FOUND AND a.status <> 'draft' THEN
    RAISE EXCEPTION 'health_assessment_answer: answers change only while the assessment is a draft'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'health_assessment_answer_draft_only';
  END IF;
  IF FOUND AND NOT EXISTS (SELECT 1 FROM methodology_element e WHERE e.methodology_version_id = a.scheme_version_id
                             AND e.element_type = 'health_response' AND e.stable_key = NEW.response AND NOT e.removed) THEN
    RAISE EXCEPTION 'health_assessment_answer: % is not a response of this assessment''s scoring scheme', NEW.response
      USING ERRCODE = 'check_violation', CONSTRAINT = 'health_assessment_answer_response_allowed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER health_assessment_answer_guard BEFORE INSERT OR UPDATE ON health_assessment_answer
  FOR EACH ROW EXECUTE FUNCTION health_assessment_answer_guard();
SELECT p2_attach_guards('health_assessment_answer', true);
GRANT SELECT, INSERT, UPDATE ON health_assessment_answer TO mth_app;

-- health_assessment_action: the top 3 improvement actions (B0150 'Top 3 actions'; M0288 "Require the top three
-- improvement actions"), ranks 1-3, written only while the assessment is a draft; optionally linked to a DG4
-- improvement item of the same transformation.
CREATE TABLE health_assessment_action (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id   uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  assessment_id       uuid NOT NULL,
  rank                smallint NOT NULL CHECK (rank BETWEEN 1 AND 3),
  action_text         text NOT NULL CHECK (char_length(action_text) BETWEEN 1 AND 1000),
  owner_user_id       uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  due_date            date NULL,
  improvement_item_id uuid NULL,
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT health_assessment_action_parent_fkey FOREIGN KEY (transformation_id, assessment_id)
    REFERENCES health_assessment (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT health_assessment_action_improvement_fkey FOREIGN KEY (transformation_id, improvement_item_id)
    REFERENCES improvement_item (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT health_assessment_action_rank_key UNIQUE (assessment_id, rank)
);
CREATE FUNCTION health_assessment_action_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.assessment_id IS DISTINCT FROM OLD.assessment_id OR NEW.rank IS DISTINCT FROM OLD.rank) THEN
    RAISE EXCEPTION 'health_assessment_action: the assessment and rank never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'health_assessment_action_identity_fixed';
  END IF;
  IF EXISTS (SELECT 1 FROM health_assessment a WHERE a.id = NEW.assessment_id AND a.status <> 'draft') THEN
    RAISE EXCEPTION 'health_assessment_action: actions change only while the assessment is a draft'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'health_assessment_action_draft_only';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER health_assessment_action_guard BEFORE INSERT OR UPDATE ON health_assessment_action
  FOR EACH ROW EXECUTE FUNCTION health_assessment_action_guard();
SELECT p2_attach_guards('health_assessment_action', true);
GRANT SELECT, INSERT, UPDATE ON health_assessment_action TO mth_app;

-- Checked at COMMIT: an assessment's answered_count equals its answers (attached to both tables).
CREATE FUNCTION health_assessment_counted() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  aid uuid := CASE WHEN TG_TABLE_NAME = 'health_assessment' THEN (to_jsonb(NEW)->>'id')::uuid ELSE (to_jsonb(NEW)->>'assessment_id')::uuid END;
BEGIN
  IF (SELECT answered_count FROM health_assessment WHERE id = aid) <> (SELECT count(*) FROM health_assessment_answer x WHERE x.assessment_id = aid) THEN
    RAISE EXCEPTION 'health_assessment %: answered_count must equal its answers', aid
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'health_assessment_answered_count';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER health_assessment_counted AFTER INSERT OR UPDATE ON health_assessment
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION health_assessment_counted();
CREATE CONSTRAINT TRIGGER health_assessment_answer_counted AFTER INSERT ON health_assessment_answer
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION health_assessment_counted();

-- -----------------------------------------------------------------------------------------------------------------
-- "Day 90 reached -> create test task" (REQ-PB-087): one My Work item per open Day-90 test whose scheduled date has
-- come (Asia/Riyadh) and per holder of day_ninety_test.respond in the transformation (exactly once through the work_item
-- dedupe key 'day_ninety_test:<testId>:<userId>'; ADR-0048 §4).
INSERT INTO work_item_kind (code, owner_module, label_en, label_ar, source_ref, urgency) VALUES
  ('day_ninety_test_due', 'launch', 'Day-90 leadership test due', 'اختبار القيادة في اليوم 90 مستحق', 'B0135', 'normal');
INSERT INTO job_schedule (id, code, queue_name, cron, timezone, description_en, description_ar, owner_module) VALUES
  ('01920005-0086-7000-8000-000000000001', 'launch.day_ninety_tests', 'launch.day_ninety_tests', '50 0 * * *', 'Asia/Riyadh',
   'Create one Day-90 leadership test task per due open test and respondent (REQ-PB-087).',
   'إنشاء مهمة واحدة لاختبار القيادة في اليوم 90 لكل اختبار مفتوح مستحق ولكل مجيب.', 'launch');
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source)
SELECT mth_uuid_v7(), 'system', 'job_schedule.create', 'job_schedule', s.id, 1, 'migration'
  FROM job_schedule s WHERE s.code = 'launch.day_ninety_tests';
