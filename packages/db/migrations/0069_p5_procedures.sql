-- 0069 P5 slice C: procedure definitions (versioned through Playbook Studio), procedure instances pinned to the
-- definition version, step instances, output and evidence links, and the ten seeded procedures (T-DG5-ARCH-02;
-- ADR-0042; REQ-S06-001, REQ-S06-002, REQ-S06-003, REQ-S16-015). Authored by solution-architect.
-- Contract: docs/architecture/data-dictionary.md ("P5 tables, slice C"). Runs as mth_owner inside one transaction
-- opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- Additive: new tables only. A procedure definition is a version-scoped row of the Studio configuration kind
-- 'procedure' (key 'procedures', ADR-0039 §1): it is edited in a draft and published through the slice A pipeline;
-- a published definition never changes. An instance pins the exact definition row it was launched from.
-- The ten seeded definitions are PRODUCT DEFAULTS: their names follow the M0153 list; purpose, steps, roles, SLAs and
-- the other parts are a configurable starting point written for this product (not playbook text), editable in Studio
-- (REQ-S06-003). Arabic texts are PROVISIONAL translations needing review. Seeded approval steps name the business
-- role that decides; a seed approves nothing. Nothing here reads or writes the engineering gates DG0-DG7.

-- -----------------------------------------------------------------------------------------------------------------
-- procedure_definition: one procedure in one version of the 'procedures' configuration (M0152: purpose, trigger,
-- scope, prerequisites, inputs and input schema, steps, responsible roles, SLA, validation rules, approval path,
-- escalation path, expected outputs, completion conditions, exceptions, version (the configuration version_no) and
-- effective date). input_schema is a JSON array of field definitions validated by the API with the ADR-0041 §3
-- field-type schemas; never an unvalidated blob.
CREATE TABLE procedure_definition (
  id                            uuid PRIMARY KEY,
  methodology_version_id        uuid NOT NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code                          text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{2,47}$'),
  origin                        text NOT NULL CHECK (origin IN ('source', 'admin')),
  removed                       boolean NOT NULL DEFAULT false,
  ordinal                       smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 999),
  name_en                       text NOT NULL CHECK (char_length(name_en) BETWEEN 1 AND 200),
  name_ar                       text NOT NULL CHECK (char_length(name_ar) BETWEEN 1 AND 200),
  purpose_en                    text NOT NULL CHECK (char_length(purpose_en) BETWEEN 1 AND 2000),
  purpose_ar                    text NOT NULL CHECK (char_length(purpose_ar) BETWEEN 1 AND 2000),
  trigger_kind                  text NOT NULL CHECK (trigger_kind IN ('manual', 'event', 'schedule')),
  trigger_event                 text NULL CHECK (trigger_event IS NULL OR trigger_event ~ '^[a-z_]+\.[a-z_.]+$'),
  trigger_en                    text NOT NULL CHECK (char_length(trigger_en) BETWEEN 1 AND 1000),
  trigger_ar                    text NOT NULL CHECK (char_length(trigger_ar) BETWEEN 1 AND 1000),
  scope_level                   text NOT NULL CHECK (scope_level IN ('organization', 'transformation')),
  scope_en                      text NOT NULL CHECK (char_length(scope_en) BETWEEN 1 AND 1000),
  scope_ar                      text NOT NULL CHECK (char_length(scope_ar) BETWEEN 1 AND 1000),
  prerequisites_en              text NULL CHECK (prerequisites_en IS NULL OR char_length(prerequisites_en) BETWEEN 1 AND 2000),
  prerequisites_ar              text NULL CHECK (prerequisites_ar IS NULL OR char_length(prerequisites_ar) BETWEEN 1 AND 2000),
  input_schema                  jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(input_schema) = 'array' AND jsonb_array_length(input_schema) <= 50),
  launch_role_codes             text[] NOT NULL CHECK (cardinality(launch_role_codes) BETWEEN 1 AND 14),
  responsible_role_codes        text[] NOT NULL CHECK (cardinality(responsible_role_codes) BETWEEN 1 AND 14),
  sla_working_days              smallint NOT NULL CHECK (sla_working_days BETWEEN 1 AND 250),
  validation_rules_en           text NOT NULL CHECK (char_length(validation_rules_en) BETWEEN 1 AND 2000),
  validation_rules_ar           text NOT NULL CHECK (char_length(validation_rules_ar) BETWEEN 1 AND 2000),
  approval_mode                 text NOT NULL CHECK (approval_mode IN ('none', 'any', 'sequential', 'parallel')),
  approval_role_codes           text[] NOT NULL DEFAULT '{}' CHECK (cardinality(approval_role_codes) <= 6),
  escalation_role_code          text NULL REFERENCES role (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  escalation_after_working_days smallint NULL CHECK (escalation_after_working_days IS NULL OR escalation_after_working_days BETWEEN 1 AND 250),
  expected_outputs_en           text NOT NULL CHECK (char_length(expected_outputs_en) BETWEEN 1 AND 2000),
  expected_outputs_ar           text NOT NULL CHECK (char_length(expected_outputs_ar) BETWEEN 1 AND 2000),
  completion_rule               text NOT NULL CHECK (completion_rule IN ('all_steps_closed', 'all_steps_closed_and_outputs_linked')),
  completion_en                 text NOT NULL CHECK (char_length(completion_en) BETWEEN 1 AND 1000),
  completion_ar                 text NOT NULL CHECK (char_length(completion_ar) BETWEEN 1 AND 1000),
  exceptions_en                 text NULL CHECK (exceptions_en IS NULL OR char_length(exceptions_en) BETWEEN 1 AND 2000),
  exceptions_ar                 text NULL CHECK (exceptions_ar IS NULL OR char_length(exceptions_ar) BETWEEN 1 AND 2000),
  effective_from                date NOT NULL,
  source_ref                    text NULL CHECK (source_ref IS NULL OR char_length(source_ref) BETWEEN 1 AND 50),
  version                       integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                    timestamptz NOT NULL DEFAULT now(),
  created_by                    uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  updated_by                    uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT procedure_definition_code_key UNIQUE (methodology_version_id, code),
  CONSTRAINT procedure_definition_id_version_key UNIQUE (id, methodology_version_id),
  CONSTRAINT procedure_definition_trigger_event CHECK ((trigger_kind = 'event') = (trigger_event IS NOT NULL)),
  CONSTRAINT procedure_definition_approval_complete CHECK ((approval_mode = 'none') = (cardinality(approval_role_codes) = 0)),
  CONSTRAINT procedure_definition_escalation_complete CHECK ((escalation_role_code IS NULL) = (escalation_after_working_days IS NULL)),
  CONSTRAINT procedure_definition_bilingual
    CHECK ((prerequisites_en IS NULL) = (prerequisites_ar IS NULL) AND (exceptions_en IS NULL) = (exceptions_ar IS NULL)),
  -- REQ-S06-003: a seeded procedure is editable but never deleted.
  CONSTRAINT procedure_definition_source_kept CHECK (origin <> 'source' OR NOT removed)
);
CREATE INDEX procedure_definition_version_idx ON procedure_definition (methodology_version_id, ordinal);

-- procedure_step_definition: one step of a definition (M0152 "ordered/conditional/parallel steps"). Steps run in
-- ordinal order; steps sharing an ordinal form one parallel group (all must name the same parallel_group) and all of
-- them must close before the next ordinal starts; a step with a condition runs only when the condition on an input
-- value holds at activation, else it is 'not_applicable'. An approval step closes only through the canonical approval
-- (ADR-0026) decided by approval_role_code; a seed or an agent never decides it.
CREATE TABLE procedure_step_definition (
  id                      uuid PRIMARY KEY,
  procedure_definition_id uuid NOT NULL REFERENCES procedure_definition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  step_key                text NOT NULL CHECK (step_key ~ '^[a-z][a-z0-9_]{1,47}$'),
  ordinal                 smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 99),
  parallel_group          text NULL CHECK (parallel_group IS NULL OR parallel_group ~ '^[a-z][a-z0-9_]{0,31}$'),
  step_kind               text NOT NULL CHECK (step_kind IN ('task', 'approval')),
  name_en                 text NOT NULL CHECK (char_length(name_en) BETWEEN 1 AND 200),
  name_ar                 text NOT NULL CHECK (char_length(name_ar) BETWEEN 1 AND 200),
  instructions_en         text NULL CHECK (instructions_en IS NULL OR char_length(instructions_en) BETWEEN 1 AND 2000),
  instructions_ar         text NULL CHECK (instructions_ar IS NULL OR char_length(instructions_ar) BETWEEN 1 AND 2000),
  responsible_role_code   text NOT NULL REFERENCES role (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  approval_role_code      text NULL REFERENCES role (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  sla_working_days        smallint NOT NULL CHECK (sla_working_days BETWEEN 1 AND 250),
  condition_input_key     text NULL CHECK (condition_input_key IS NULL OR condition_input_key ~ '^[a-z][a-zA-Z0-9_]{0,39}$'),
  condition_operator      text NULL CHECK (condition_operator IS NULL OR condition_operator IN ('eq', 'neq', 'in', 'gt', 'gte', 'lt', 'lte', 'present', 'absent')),
  condition_value         jsonb NULL,
  required_input_keys     text[] NOT NULL DEFAULT '{}' CHECK (cardinality(required_input_keys) <= 50),
  evidence_required       boolean NOT NULL DEFAULT false,
  output_record_type      text NULL CHECK (output_record_type IS NULL OR output_record_type IN (
                            'transformation', 'charter', 'baseline', 'kpi_actual', 'tom_canvas_cell', 'approval',
                            'ranking_snapshot', 'gate_submission', 'change_request', 'finance_validation', 'decision',
                            'bau_handover', 'evidence')),
  output_mode             text NULL CHECK (output_mode IS NULL OR output_mode IN ('create', 'advance', 'link')),
  skippable               boolean NOT NULL DEFAULT false,
  removed                 boolean NOT NULL DEFAULT false,
  version                 integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT procedure_step_definition_key UNIQUE (procedure_definition_id, step_key),
  CONSTRAINT procedure_step_definition_condition_complete
    CHECK ((condition_input_key IS NULL) = (condition_operator IS NULL)
           AND (condition_operator IS NULL OR condition_operator IN ('present', 'absent') OR condition_value IS NOT NULL)),
  CONSTRAINT procedure_step_definition_approval_complete
    CHECK ((step_kind = 'approval') = (approval_role_code IS NOT NULL) AND (step_kind <> 'approval' OR NOT skippable)),
  CONSTRAINT procedure_step_definition_output_complete CHECK ((output_record_type IS NULL) = (output_mode IS NULL))
);
CREATE INDEX procedure_step_definition_order_idx ON procedure_step_definition (procedure_definition_id, ordinal);

-- Definitions and steps change only inside a 'procedure' draft being edited (the migration role may seed); identity
-- columns never change; roles exist and are never a technical administrator or AUD (REQ-S06-006, REQ-S10-003);
-- parallel steps share their group; a step's required inputs and condition key are inputs of its definition.
CREATE FUNCTION p5_procedure_roles_ok(codes text[]) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT NOT EXISTS (SELECT 1 FROM unnest(codes) AS c(code) LEFT JOIN role r ON r.code = c.code
                     WHERE r.code IS NULL OR r.kind = 'technical_admin' OR r.code = 'AUD')
$$;
CREATE FUNCTION p5_procedure_version_editable(p_version_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT (current_user = 'mth_owner' OR current_user IN (SELECT rolname FROM pg_roles WHERE rolsuper))
         OR EXISTS (SELECT 1 FROM methodology_version m WHERE m.id = p_version_id AND m.status = 'draft'
                      AND m.draft_stage IN ('editing', 'preview'))
$$;
CREATE FUNCTION procedure_definition_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF (SELECT m.config_kind FROM methodology_version m WHERE m.id = NEW.methodology_version_id) IS DISTINCT FROM 'procedure' THEN
    RAISE EXCEPTION 'procedure_definition %: a definition belongs to a version of configuration kind procedure', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_definition_kind';
  END IF;
  IF NOT p5_procedure_version_editable(NEW.methodology_version_id) THEN
    RAISE EXCEPTION 'procedure_definition %: definitions change only in a draft being edited; a published version is immutable', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_definition_draft_only';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.methodology_version_id IS DISTINCT FROM OLD.methodology_version_id
       OR NEW.code IS DISTINCT FROM OLD.code OR NEW.origin IS DISTINCT FROM OLD.origin) THEN
    RAISE EXCEPTION 'procedure_definition %: version, code and origin never change', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_definition_identity_fixed';
  END IF;
  IF NOT p5_procedure_roles_ok(NEW.launch_role_codes || NEW.responsible_role_codes || NEW.approval_role_codes
                               || array_remove(ARRAY[NEW.escalation_role_code], NULL)) THEN
    RAISE EXCEPTION 'procedure_definition %: every role exists and is a business role, never a technical administrator or AUD', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_definition_roles';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER procedure_definition_guard BEFORE INSERT OR UPDATE ON procedure_definition
  FOR EACH ROW EXECUTE FUNCTION procedure_definition_guard();

CREATE FUNCTION procedure_step_definition_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  d record;
  input_keys text[];
BEGIN
  SELECT pd.methodology_version_id, pd.input_schema INTO d FROM procedure_definition pd WHERE pd.id = NEW.procedure_definition_id;
  IF NOT p5_procedure_version_editable(d.methodology_version_id) THEN
    RAISE EXCEPTION 'procedure_step_definition %: steps change only in a draft being edited', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_step_definition_draft_only';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.procedure_definition_id IS DISTINCT FROM OLD.procedure_definition_id
       OR NEW.step_key IS DISTINCT FROM OLD.step_key) THEN
    RAISE EXCEPTION 'procedure_step_definition %: definition and step key never change', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_step_definition_identity_fixed';
  END IF;
  IF NOT p5_procedure_roles_ok(array_remove(ARRAY[NEW.responsible_role_code, NEW.approval_role_code], NULL)) THEN
    RAISE EXCEPTION 'procedure_step_definition %: a step role is a business role, never a technical administrator or AUD', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_step_definition_roles';
  END IF;
  input_keys := ARRAY(SELECT f->>'key' FROM jsonb_array_elements(d.input_schema) AS f);
  IF NOT NEW.required_input_keys <@ input_keys
     OR (NEW.condition_input_key IS NOT NULL AND NOT NEW.condition_input_key = ANY (input_keys)) THEN
    RAISE EXCEPTION 'procedure_step_definition %: required inputs and the condition key must be inputs of the definition', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_step_definition_inputs';
  END IF;
  IF NOT NEW.removed AND EXISTS (
       SELECT 1 FROM procedure_step_definition s WHERE s.procedure_definition_id = NEW.procedure_definition_id
         AND s.id <> NEW.id AND NOT s.removed AND s.ordinal = NEW.ordinal
         AND (s.parallel_group IS NULL OR NEW.parallel_group IS NULL OR s.parallel_group <> NEW.parallel_group)) THEN
    RAISE EXCEPTION 'procedure_step_definition %: steps sharing ordinal % must share one parallel group', NEW.id, NEW.ordinal
      USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_step_definition_parallel_group';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER procedure_step_definition_guard BEFORE INSERT OR UPDATE ON procedure_step_definition
  FOR EACH ROW EXECUTE FUNCTION procedure_step_definition_guard();

-- -----------------------------------------------------------------------------------------------------------------
-- Seed: the 'procedures' configuration v1 and the ten procedures of M0153 (REQ-S06-003). PRODUCT DEFAULTS (see header).
INSERT INTO methodology_version (id, key, version_no, status, title_en, title_ar, source_document, source_sha256,
                                 definition, content_sha256, published_at, config_kind, origin) VALUES
  ('01920005-0300-7000-8000-000000000001', 'procedures', 1, 'published',
   'Procedures v1 (ten seeded procedures)', 'الإجراءات — الإصدار 1 (عشرة إجراءات مهيأة مسبقاً) (ترجمة مؤقتة)',
   'docs/source/master-prompt-v2.0.md (M0152, M0153)', NULL,
   '{"sourceRefs": ["M0152", "M0153"], "productDefaults": true}'::jsonb,
   encode(sha256(convert_to('procedures/1:ten-seeded-procedures', 'UTF8')), 'hex'),
   now(), 'procedure', 'seed');
-- methodology_version is audited since 0062 (deferred check at COMMIT): the seed writes its own audit event.
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, reason, source) VALUES
  ('01920005-0300-7000-8000-0000000000ff', 'system', 'methodology_version.seed', 'methodology_version', '01920005-0300-7000-8000-000000000001', 1,
   'Seeded procedures configuration v1 (T-DG5-ARCH-02)', 'migration');

INSERT INTO procedure_definition (id, methodology_version_id, code, origin, ordinal, name_en, name_ar, purpose_en, purpose_ar,
  trigger_kind, trigger_event, trigger_en, trigger_ar, scope_level, scope_en, scope_ar, prerequisites_en, prerequisites_ar,
  input_schema, launch_role_codes, responsible_role_codes, sla_working_days, validation_rules_en, validation_rules_ar,
  approval_mode, approval_role_codes, escalation_role_code, escalation_after_working_days, expected_outputs_en, expected_outputs_ar,
  completion_rule, completion_en, completion_ar, exceptions_en, exceptions_ar, effective_from, source_ref) VALUES
  ('01920005-0301-7000-8000-000000000001', '01920005-0300-7000-8000-000000000001', 'new_transformation_intake', 'source', 1,
   'New transformation intake', 'استقبال تحول جديد (ترجمة مؤقتة)',
   'Capture a proposed transformation, create its record and draft charter, and confirm the sponsor.', 'تسجيل تحول مقترح وإنشاء سجله ومسودة ميثاقه وتأكيد الراعي.',
   'manual', NULL, 'A sponsor or transformation lead proposes a new transformation.', 'يقترح الراعي أو قائد التحول تحولاً جديداً.',
   'organization', 'One organization; the transformation does not exist yet.', 'منظمة واحدة؛ التحول غير موجود بعد.',
   NULL, NULL,
   '[{"key": "transformationName", "fieldType": "text", "labelEn": "Transformation name", "labelAr": "اسم التحول", "required": true},
     {"key": "caseForChange", "fieldType": "rich_text", "labelEn": "Case for change", "labelAr": "مبررات التغيير", "required": true}]'::jsonb,
   ARRAY['SP', 'TL', 'TO'], ARRAY['TL'], 10,
   'The name and case for change are required; the transformation is created through the standard create rules.', 'الاسم ومبررات التغيير مطلوبة؛ ويُنشأ التحول وفق قواعد الإنشاء المعتادة.',
   'any', ARRAY['SP'], 'TO', 5,
   'A transformation record and its draft charter, linked to the instance.', 'سجل تحول ومسودة ميثاقه مرتبطان بالإجراء.',
   'all_steps_closed_and_outputs_linked', 'The transformation exists, the charter draft is linked and the sponsor confirmed.', 'التحول موجود ومسودة الميثاق مرتبطة والراعي أكّد.',
   NULL, NULL, DATE '2026-10-14', 'M0153'),
  ('01920005-0301-7000-8000-000000000002', '01920005-0300-7000-8000-000000000001', 'baseline_validation', 'source', 2,
   'Baseline validation', 'التحقق من خط الأساس (ترجمة مؤقتة)',
   'Record a baseline with its source and date, and have Finance validate it.', 'تسجيل خط أساس بمصدره وتاريخه والتحقق منه من قبل المالية.',
   'manual', NULL, 'A baseline is needed for a KPI or a benefit, or a recorded baseline changed.', 'الحاجة إلى خط أساس لمؤشر أو منفعة، أو تغيّر خط أساس مسجّل.',
   'transformation', 'One baseline of one transformation.', 'خط أساس واحد لتحول واحد.',
   'The KPI definition exists.', 'تعريف المؤشر موجود.',
   '[{"key": "metric", "fieldType": "text", "labelEn": "Metric", "labelAr": "المقياس", "required": true},
     {"key": "value", "fieldType": "number", "labelEn": "Baseline value", "labelAr": "قيمة خط الأساس", "required": true},
     {"key": "unit", "fieldType": "text", "labelEn": "Unit", "labelAr": "الوحدة", "required": true},
     {"key": "baselineDate", "fieldType": "date", "labelEn": "Baseline date", "labelAr": "تاريخ خط الأساس", "required": true},
     {"key": "source", "fieldType": "text", "labelEn": "Source", "labelAr": "المصدر", "required": true}]'::jsonb,
   ARRAY['TL', 'BO', 'FIN', 'TO'], ARRAY['BO', 'FIN'], 10,
   'Value is a decimal; the date is not in the future; the validator is not the person who recorded the baseline.', 'القيمة عشرية؛ والتاريخ ليس في المستقبل؛ والمتحقق ليس من سجّل خط الأساس.',
   'none', '{}', 'TL', 5,
   'A validated baseline record linked to the instance.', 'سجل خط أساس متحقق منه مرتبط بالإجراء.',
   'all_steps_closed_and_outputs_linked', 'The baseline is recorded and validated by Finance.', 'سُجّل خط الأساس وتحققت منه المالية.',
   'A baseline that cannot be measured is recorded as Unknown with a reason and stays unvalidated.', 'خط الأساس غير القابل للقياس يُسجّل كمجهول مع السبب ويبقى غير متحقق منه.', DATE '2026-10-14', 'M0153'),
  ('01920005-0301-7000-8000-000000000003', '01920005-0300-7000-8000-000000000001', 'kpi_submission', 'source', 3,
   'KPI submission', 'تقديم مؤشر الأداء (ترجمة مؤقتة)',
   'Submit a KPI actual for a reporting period and have the data steward accept it.', 'تقديم القيمة الفعلية لمؤشر عن فترة تقرير وقبولها من أمين البيانات.',
   'schedule', NULL, 'A reporting period opens for a KPI.', 'فتح فترة تقرير لمؤشر.',
   'transformation', 'One KPI and one reporting period.', 'مؤشر واحد وفترة تقرير واحدة.',
   'The KPI version is active and the period is open.', 'إصدار المؤشر نشط والفترة مفتوحة.',
   '[{"key": "period", "fieldType": "text", "labelEn": "Reporting period", "labelAr": "فترة التقرير", "required": true}]'::jsonb,
   ARRAY['BO', 'KDS', 'TO'], ARRAY['BO', 'KDS'], 5,
   'The DG4 actual-submission rules apply unchanged.', 'تنطبق قواعد تقديم القيم الفعلية المعتمدة في المرحلة الرابعة دون تغيير.',
   'none', '{}', 'TL', 3,
   'A submitted and accepted KPI actual linked to the instance.', 'قيمة فعلية مقدّمة ومقبولة مرتبطة بالإجراء.',
   'all_steps_closed_and_outputs_linked', 'The actual is submitted and accepted.', 'قُدّمت القيمة الفعلية وقُبلت.',
   'A missing value is reported as Unknown, never as zero.', 'القيمة المفقودة تُعرض كمجهولة وليست صفراً.', DATE '2026-10-14', 'M0153'),
  ('01920005-0301-7000-8000-000000000004', '01920005-0300-7000-8000-000000000001', 'tom_approval', 'source', 4,
   'TOM approval', 'اعتماد نموذج التشغيل المستهدف (ترجمة مؤقتة)',
   'Review the target operating model canvas in parallel and route it for the sponsor''s business approval.', 'مراجعة لوحة نموذج التشغيل المستهدف بالتوازي وتوجيهها لاعتماد الراعي.',
   'manual', NULL, 'The TOM canvas is complete for all ten dimensions.', 'اكتمال لوحة نموذج التشغيل للأبعاد العشرة.',
   'transformation', 'The TOM canvas of one transformation.', 'لوحة نموذج التشغيل لتحول واحد.',
   'All ten TOM dimensions have a current and target design.', 'لكل الأبعاد العشرة تصميم حالي ومستهدف.',
   '[]'::jsonb,
   ARRAY['TL', 'TO'], ARRAY['TL', 'TD', 'BO'], 15,
   'Every dimension has a current and a target design; no dimension is removed.', 'لكل بعد تصميم حالي ومستهدف؛ ولا يُحذف أي بعد.',
   'any', ARRAY['SP'], 'TO', 5,
   'An approval record of the TOM canvas linked to the instance.', 'سجل اعتماد للوحة نموذج التشغيل مرتبط بالإجراء.',
   'all_steps_closed_and_outputs_linked', 'Both reviews are closed and the sponsor decided.', 'أُغلقت المراجعتان وقرّر الراعي.',
   NULL, NULL, DATE '2026-10-14', 'M0153'),
  ('01920005-0301-7000-8000-000000000005', '01920005-0300-7000-8000-000000000001', 'initiative_prioritization', 'source', 5,
   'Initiative prioritization', 'تحديد أولويات المبادرات (ترجمة مؤقتة)',
   'Score initiatives with the pinned T06 weights, record a ranking snapshot and route it for approval.', 'تقييم المبادرات بالأوزان المثبتة للنموذج 6 وتسجيل لقطة ترتيب وتوجيهها للاعتماد.',
   'manual', NULL, 'Initiative cards are ready for scoring.', 'بطاقات المبادرات جاهزة للتقييم.',
   'transformation', 'The candidate initiatives of one transformation.', 'المبادرات المرشحة لتحول واحد.',
   'The weight set is approved.', 'مجموعة الأوزان معتمدة.',
   '[]'::jsonb,
   ARRAY['TL', 'TO'], ARRAY['TL', 'TO'], 10,
   'The DG3 scoring and ranking rules apply unchanged.', 'تنطبق قواعد التقييم والترتيب المعتمدة في المرحلة الثالثة دون تغيير.',
   'any', ARRAY['SP'], 'TO', 5,
   'A ranking snapshot linked to the instance.', 'لقطة ترتيب مرتبطة بالإجراء.',
   'all_steps_closed_and_outputs_linked', 'The ranking snapshot is recorded and decided.', 'سُجّلت لقطة الترتيب وتقرر بشأنها.',
   NULL, NULL, DATE '2026-10-14', 'M0153'),
  ('01920005-0301-7000-8000-000000000006', '01920005-0300-7000-8000-000000000001', 'gate_review', 'source', 6,
   'Gate review', 'مراجعة البوابة (ترجمة مؤقتة)',
   'Prepare a gate submission, review its criteria (and Finance where required) and obtain the gate decision.', 'إعداد تقديم البوابة ومراجعة معاييرها (والمالية عند الحاجة) والحصول على قرار البوابة.',
   'manual', NULL, 'The phase work for a gate is ready for review.', 'عمل المرحلة الخاص بالبوابة جاهز للمراجعة.',
   'transformation', 'One gate of one transformation.', 'بوابة واحدة لتحول واحد.',
   'The previous gate is approved.', 'البوابة السابقة معتمدة.',
   '[{"key": "gateCode", "fieldType": "choice", "labelEn": "Gate", "labelAr": "البوابة", "required": true, "options": ["G1", "G2", "G3", "G4", "G5", "G6"]},
     {"key": "financeReviewRequired", "fieldType": "choice", "labelEn": "Finance review required", "labelAr": "مراجعة المالية مطلوبة", "required": true, "options": ["yes", "no"]}]'::jsonb,
   ARRAY['TL', 'TO'], ARRAY['TL', 'TO', 'FIN'], 15,
   'Missing mandatory evidence blocks submission unless an authorized exception is recorded (DG2-DG4 gate rules unchanged).', 'غياب الأدلة الإلزامية يمنع التقديم ما لم يُسجّل استثناء معتمد (قواعد البوابات دون تغيير).',
   'any', ARRAY['SP'], 'SP', 5,
   'A gate submission and its decision linked to the instance.', 'تقديم البوابة وقرارها مرتبطان بالإجراء.',
   'all_steps_closed_and_outputs_linked', 'The submission is reviewed and the gate decided by its business approver.', 'رُوجع التقديم وقرّر معتمد الأعمال بشأن البوابة.',
   'A deferred or rejected gate closes the instance; a resubmission is a new instance.', 'البوابة المؤجلة أو المرفوضة تغلق الإجراء؛ وإعادة التقديم إجراء جديد.', DATE '2026-10-14', 'M0153'),
  ('01920005-0301-7000-8000-000000000007', '01920005-0300-7000-8000-000000000001', 'scope_target_change', 'source', 7,
   'Scope/target change', 'تغيير النطاق/المستهدف (ترجمة مؤقتة)',
   'Raise a change to approved scope or targets, assess its impact and route it for business approval.', 'رفع تغيير على النطاق أو المستهدفات المعتمدة وتقييم أثره وتوجيهه لاعتماد الأعمال.',
   'manual', NULL, 'An approved scope, baseline or target needs to change.', 'الحاجة إلى تغيير نطاق أو خط أساس أو مستهدف معتمد.',
   'transformation', 'One approved record of one transformation.', 'سجل معتمد واحد لتحول واحد.',
   NULL, NULL,
   '[{"key": "reason", "fieldType": "rich_text", "labelEn": "Reason for change", "labelAr": "سبب التغيير", "required": true}]'::jsonb,
   ARRAY['TL', 'BO', 'TO'], ARRAY['TL', 'TO'], 10,
   'The DG4 change-control and impact-assessment rules apply unchanged.', 'تنطبق قواعد ضبط التغيير وتقييم الأثر المعتمدة دون تغيير.',
   'any', ARRAY['SP'], 'SP', 5,
   'A change request linked to the instance.', 'طلب تغيير مرتبط بالإجراء.',
   'all_steps_closed_and_outputs_linked', 'The change request is assessed and decided.', 'قُيّم طلب التغيير وتقرر بشأنه.',
   NULL, NULL, DATE '2026-10-14', 'M0153'),
  ('01920005-0301-7000-8000-000000000008', '01920005-0300-7000-8000-000000000001', 'benefit_validation', 'source', 8,
   'Benefit validation', 'التحقق من المنفعة (ترجمة مؤقتة)',
   'Measure a benefit, attach evidence and Finance validation in parallel, and plan recovery when below target.', 'قياس منفعة وإرفاق الأدلة وتحقق المالية بالتوازي، وتخطيط التعافي عند انخفاضها عن المستهدف.',
   'manual', NULL, 'A benefit measurement is due.', 'حلول موعد قياس منفعة.',
   'transformation', 'One benefit of one transformation.', 'منفعة واحدة لتحول واحد.',
   'The benefit has a validated baseline.', 'للمنفعة خط أساس متحقق منه.',
   '[{"key": "belowTarget", "fieldType": "choice", "labelEn": "Below target", "labelAr": "أقل من المستهدف", "required": true, "options": ["yes", "no"]}]'::jsonb,
   ARRAY['TL', 'BO', 'FIN', 'TO'], ARRAY['BO', 'FIN', 'TL'], 15,
   'Finance validation follows the DG4 rules; the validator is not the benefit owner.', 'يتبع تحقق المالية القواعد المعتمدة؛ والمتحقق ليس مالك المنفعة.',
   'none', '{}', 'TL', 5,
   'A Finance validation record linked to the instance.', 'سجل تحقق مالي مرتبط بالإجراء.',
   'all_steps_closed_and_outputs_linked', 'Evidence is attached, Finance validated, and a recovery plan exists when below target.', 'أُرفقت الأدلة وتحققت المالية ووُضعت خطة تعافٍ عند الانخفاض.',
   NULL, NULL, DATE '2026-10-14', 'M0153'),
  ('01920005-0301-7000-8000-000000000009', '01920005-0300-7000-8000-000000000001', 'executive_escalation', 'source', 9,
   'Executive escalation', 'التصعيد التنفيذي (ترجمة مؤقتة)',
   'Escalate a blocked decision to the executive level, record the executive decision and communicate it.', 'تصعيد قرار متعثر إلى المستوى التنفيذي وتسجيل القرار التنفيذي وإبلاغه.',
   'manual', NULL, 'A decision or blocker passed its escalation threshold.', 'تجاوز قرار أو عائق حد التصعيد.',
   'transformation', 'One escalated decision of one transformation.', 'قرار مصعّد واحد لتحول واحد.',
   NULL, NULL,
   '[{"key": "whyNow", "fieldType": "rich_text", "labelEn": "Why now", "labelAr": "لماذا الآن", "required": true}]'::jsonb,
   ARRAY['TL', 'TO'], ARRAY['TL', 'SP'], 5,
   'The T16 executive decision rules apply unchanged.', 'تنطبق قواعد القرار التنفيذي للنموذج 16 دون تغيير.',
   'any', ARRAY['SP'], 'SP', 3,
   'An executive decision record linked to the instance.', 'سجل قرار تنفيذي مرتبط بالإجراء.',
   'all_steps_closed_and_outputs_linked', 'The executive decision is recorded and communicated.', 'سُجّل القرار التنفيذي وأُبلغ.',
   NULL, NULL, DATE '2026-10-14', 'M0153'),
  ('01920005-0301-7000-8000-00000000000a', '01920005-0300-7000-8000-000000000001', 'bau_handover', 'source', 10,
   'BAU handover', 'التسليم للعمليات الاعتيادية (ترجمة مؤقتة)',
   'Prepare the BAU handover of a performance area, obtain the receiving owner''s acceptance and schedule the recurring reviews.', 'إعداد تسليم مجال أداء للعمليات الاعتيادية والحصول على قبول المالك المستلم وجدولة المراجعات الدورية.',
   'manual', NULL, 'A performance area is ready to transfer to its business owner.', 'مجال أداء جاهز للنقل إلى مالكه.',
   'transformation', 'One performance area of one transformation.', 'مجال أداء واحد لتحول واحد.',
   'Controls and KPI ownership are defined.', 'الضوابط وملكية المؤشرات محددة.',
   '[]'::jsonb,
   ARRAY['TL', 'BO', 'TO'], ARRAY['TL', 'BO', 'TO'], 15,
   'The DG4 BAU handover rules apply unchanged.', 'تنطبق قواعد التسليم المعتمدة دون تغيير.',
   'any', ARRAY['BO'], 'SP', 5,
   'An accepted BAU handover record linked to the instance.', 'سجل تسليم مقبول مرتبط بالإجراء.',
   'all_steps_closed_and_outputs_linked', 'The handover is accepted and the recurring reviews are scheduled.', 'قُبل التسليم وجُدولت المراجعات الدورية.',
   NULL, NULL, DATE '2026-10-14', 'M0153');

INSERT INTO procedure_step_definition (id, procedure_definition_id, step_key, ordinal, parallel_group, step_kind, name_en, name_ar,
  responsible_role_code, approval_role_code, sla_working_days, condition_input_key, condition_operator, condition_value,
  required_input_keys, evidence_required, output_record_type, output_mode, skippable)
SELECT md5('p5-procedure-step:' || v.code || ':' || v.step_key)::uuid, d.id, v.step_key, v.ordinal, v.parallel_group, v.step_kind,
       v.name_en, v.name_ar, v.responsible, v.approver, v.sla, v.cond_key, v.cond_op, v.cond_value::jsonb, v.required_inputs,
       v.evidence_required, v.output_type, v.output_mode, v.skippable
FROM (VALUES
  ('new_transformation_intake', 'capture_intake', 1, NULL, 'task', 'Capture the intake and create the transformation', 'تسجيل الطلب وإنشاء التحول', 'TL', NULL, 3, NULL, NULL, NULL, ARRAY['transformationName', 'caseForChange'], false, 'transformation', 'create', false),
  ('new_transformation_intake', 'draft_charter', 2, NULL, 'task', 'Draft the charter', 'إعداد مسودة الميثاق', 'TL', NULL, 5, NULL, NULL, NULL, '{}'::text[], false, 'charter', 'link', false),
  ('new_transformation_intake', 'confirm_sponsor', 3, NULL, 'approval', 'Sponsor confirms the transformation', 'تأكيد الراعي للتحول', 'TL', 'SP', 2, NULL, NULL, NULL, '{}'::text[], false, 'approval', 'create', false),
  ('baseline_validation', 'record_baseline', 1, NULL, 'task', 'Record the baseline', 'تسجيل خط الأساس', 'BO', NULL, 5, NULL, NULL, NULL, ARRAY['metric', 'value', 'unit', 'baselineDate', 'source'], true, 'baseline', 'create', false),
  ('baseline_validation', 'validate_baseline', 2, NULL, 'task', 'Finance validates the baseline', 'تحقق المالية من خط الأساس', 'FIN', NULL, 5, NULL, NULL, NULL, '{}'::text[], false, 'baseline', 'advance', false),
  ('kpi_submission', 'submit_actual', 1, NULL, 'task', 'Submit the KPI actual', 'تقديم القيمة الفعلية', 'BO', NULL, 3, NULL, NULL, NULL, ARRAY['period'], false, 'kpi_actual', 'create', false),
  ('kpi_submission', 'accept_actual', 2, NULL, 'task', 'Data steward accepts the actual', 'قبول أمين البيانات للقيمة الفعلية', 'KDS', NULL, 2, NULL, NULL, NULL, '{}'::text[], false, 'kpi_actual', 'advance', false),
  ('tom_approval', 'complete_canvas', 1, NULL, 'task', 'Complete the TOM canvas', 'استكمال لوحة نموذج التشغيل', 'TL', NULL, 5, NULL, NULL, NULL, '{}'::text[], false, 'tom_canvas_cell', 'link', false),
  ('tom_approval', 'technology_review', 2, 'review', 'task', 'Technology and data review', 'مراجعة التقنية والبيانات', 'TD', NULL, 5, NULL, NULL, NULL, '{}'::text[], false, NULL, NULL, false),
  ('tom_approval', 'business_review', 2, 'review', 'task', 'Business owner review', 'مراجعة مالك الأعمال', 'BO', NULL, 5, NULL, NULL, NULL, '{}'::text[], false, NULL, NULL, false),
  ('tom_approval', 'sponsor_approval', 3, NULL, 'approval', 'Sponsor approves the TOM', 'اعتماد الراعي لنموذج التشغيل', 'TL', 'SP', 5, NULL, NULL, NULL, '{}'::text[], false, 'approval', 'create', false),
  ('initiative_prioritization', 'score_initiatives', 1, NULL, 'task', 'Score the initiatives', 'تقييم المبادرات', 'TL', NULL, 5, NULL, NULL, NULL, '{}'::text[], false, NULL, NULL, false),
  ('initiative_prioritization', 'record_ranking', 2, NULL, 'task', 'Record the ranking snapshot', 'تسجيل لقطة الترتيب', 'TO', NULL, 2, NULL, NULL, NULL, '{}'::text[], false, 'ranking_snapshot', 'create', false),
  ('initiative_prioritization', 'approve_ranking', 3, NULL, 'approval', 'Sponsor approves the ranking', 'اعتماد الراعي للترتيب', 'TL', 'SP', 5, NULL, NULL, NULL, '{}'::text[], false, 'approval', 'create', false),
  ('gate_review', 'prepare_submission', 1, NULL, 'task', 'Prepare and submit the gate submission', 'إعداد تقديم البوابة وتقديمه', 'TL', NULL, 5, NULL, NULL, NULL, ARRAY['gateCode'], true, 'gate_submission', 'create', false),
  ('gate_review', 'criteria_review', 2, 'review', 'task', 'Review the gate criteria', 'مراجعة معايير البوابة', 'TO', NULL, 5, NULL, NULL, NULL, '{}'::text[], false, NULL, NULL, false),
  ('gate_review', 'finance_review', 2, 'review', 'task', 'Finance review', 'مراجعة المالية', 'FIN', NULL, 5, 'financeReviewRequired', 'eq', '"yes"', '{}'::text[], false, NULL, NULL, false),
  ('gate_review', 'gate_decision', 3, NULL, 'approval', 'Gate decision by the business approver', 'قرار البوابة من معتمد الأعمال', 'TL', 'SP', 5, NULL, NULL, NULL, '{}'::text[], false, 'gate_submission', 'advance', false),
  ('scope_target_change', 'raise_change', 1, NULL, 'task', 'Raise the change request', 'رفع طلب التغيير', 'TL', NULL, 3, NULL, NULL, NULL, ARRAY['reason'], false, 'change_request', 'create', false),
  ('scope_target_change', 'assess_impact', 2, NULL, 'task', 'Assess the impact', 'تقييم الأثر', 'TO', NULL, 5, NULL, NULL, NULL, '{}'::text[], false, NULL, NULL, false),
  ('scope_target_change', 'decide_change', 3, NULL, 'approval', 'Business approver decides the change', 'قرار معتمد الأعمال بشأن التغيير', 'TL', 'SP', 5, NULL, NULL, NULL, '{}'::text[], false, 'change_request', 'advance', false),
  ('benefit_validation', 'measure_benefit', 1, NULL, 'task', 'Record the benefit measurement', 'تسجيل قياس المنفعة', 'BO', NULL, 5, NULL, NULL, NULL, '{}'::text[], false, NULL, NULL, false),
  ('benefit_validation', 'attach_evidence', 2, 'validate', 'task', 'Attach the evidence', 'إرفاق الأدلة', 'BO', NULL, 3, NULL, NULL, NULL, '{}'::text[], true, 'evidence', 'link', false),
  ('benefit_validation', 'finance_validation', 2, 'validate', 'task', 'Finance validates the benefit', 'تحقق المالية من المنفعة', 'FIN', NULL, 5, NULL, NULL, NULL, '{}'::text[], false, 'finance_validation', 'create', false),
  ('benefit_validation', 'recovery_plan', 3, NULL, 'task', 'Plan the recovery', 'تخطيط التعافي', 'TL', NULL, 5, 'belowTarget', 'eq', '"yes"', ARRAY['belowTarget'], false, NULL, NULL, false),
  ('executive_escalation', 'raise_escalation', 1, NULL, 'task', 'Raise the executive decision', 'رفع القرار التنفيذي', 'TL', NULL, 2, NULL, NULL, NULL, ARRAY['whyNow'], false, 'decision', 'create', false),
  ('executive_escalation', 'executive_decision', 2, NULL, 'approval', 'Sponsor decides', 'قرار الراعي', 'TL', 'SP', 3, NULL, NULL, NULL, '{}'::text[], false, 'decision', 'advance', false),
  ('executive_escalation', 'communicate_decision', 3, NULL, 'task', 'Communicate the decision', 'إبلاغ القرار', 'TL', NULL, 2, NULL, NULL, NULL, '{}'::text[], false, NULL, NULL, true),
  ('bau_handover', 'prepare_handover', 1, NULL, 'task', 'Prepare the handover', 'إعداد التسليم', 'TL', NULL, 10, NULL, NULL, NULL, '{}'::text[], true, 'bau_handover', 'create', false),
  ('bau_handover', 'accept_handover', 2, NULL, 'approval', 'Receiving business owner accepts', 'قبول مالك الأعمال المستلم', 'TL', 'BO', 5, NULL, NULL, NULL, '{}'::text[], false, 'bau_handover', 'advance', false),
  ('bau_handover', 'schedule_reviews', 3, NULL, 'task', 'Schedule the recurring reviews', 'جدولة المراجعات الدورية', 'TO', NULL, 5, NULL, NULL, NULL, '{}'::text[], false, NULL, NULL, false)
) AS v(code, step_key, ordinal, parallel_group, step_kind, name_en, name_ar, responsible, approver, sla, cond_key, cond_op, cond_value,
       required_inputs, evidence_required, output_type, output_mode, skippable)
JOIN procedure_definition d ON d.code = v.code AND d.methodology_version_id = '01920005-0300-7000-8000-000000000001';

-- Guards attach after the seed (the seed has no audit event; every later write needs one).
SELECT p2_attach_guards('procedure_definition', true);
SELECT p2_attach_guards('procedure_step_definition', true);
GRANT SELECT, INSERT, UPDATE ON procedure_definition, procedure_step_definition TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- procedure_instance: one launched procedure (REQ-S06-002, M0153), pinned to the exact published definition row.
--   active -> completed | cancelled (final). transformation_id is NULL exactly for organization-scope procedures.
-- launch_key (UNIQUE) makes an automation-triggered launch exactly once (slice E rule actions; p5-work-split §2.10).
CREATE TABLE procedure_instance (
  id                      uuid PRIMARY KEY,
  organization_id         uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id       uuid NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  procedure_definition_id uuid NOT NULL,
  methodology_version_id  uuid NOT NULL,
  procedure_code          text NOT NULL CHECK (procedure_code ~ '^[a-z][a-z0-9_]{2,47}$'),
  status                  text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  subject_record_type     text NULL CHECK (subject_record_type IS NULL OR subject_record_type ~ '^[a-z][a-z0-9_]{1,62}$'),
  subject_record_id       uuid NULL,
  input_values            jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input_values) = 'object' AND pg_column_size(input_values) <= 65536),
  due_date                date NULL,
  launch_key              text NULL CONSTRAINT procedure_instance_launch_key UNIQUE CHECK (launch_key IS NULL OR char_length(launch_key) BETWEEN 1 AND 200),
  launched_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  launched_at             timestamptz NOT NULL DEFAULT now(),
  completed_at            timestamptz NULL,
  cancelled_at            timestamptz NULL,
  cancelled_by            uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  cancel_reason           text NULL CHECK (cancel_reason IS NULL OR char_length(cancel_reason) BETWEEN 3 AND 2000),
  version                 integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT procedure_instance_definition_fkey FOREIGN KEY (procedure_definition_id, methodology_version_id)
    REFERENCES procedure_definition (id, methodology_version_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT procedure_instance_subject_complete CHECK ((subject_record_type IS NULL) = (subject_record_id IS NULL)),
  CONSTRAINT procedure_instance_completed_complete CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CONSTRAINT procedure_instance_cancelled_complete
    CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL) AND (cancelled_at IS NULL) = (cancelled_by IS NULL)
           AND (cancelled_at IS NULL) = (cancel_reason IS NULL)),
  CONSTRAINT procedure_instance_launcher CHECK (launched_by = created_by)
);
CREATE INDEX procedure_instance_transformation_idx ON procedure_instance (transformation_id, status, launched_at DESC);
CREATE INDEX procedure_instance_org_idx ON procedure_instance (organization_id, status, launched_at DESC);

-- procedure_step_instance: the steps of one instance, created at launch from the pinned definition's steps.
--   pending -> active | not_applicable | cancelled;  active -> completed | skipped | cancelled  (others final)
CREATE TABLE procedure_step_instance (
  id                         uuid PRIMARY KEY,
  organization_id            uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id          uuid NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  procedure_instance_id      uuid NOT NULL REFERENCES procedure_instance (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  step_definition_id         uuid NOT NULL REFERENCES procedure_step_definition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  step_key                   text NOT NULL CHECK (step_key ~ '^[a-z][a-z0-9_]{1,47}$'),
  ordinal                    smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 99),
  status                     text NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'active', 'completed', 'skipped', 'not_applicable', 'cancelled')),
  assignee_role_code         text NOT NULL REFERENCES role (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  assignee_user_id           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  due_date                   date NULL,
  activated_at               timestamptz NULL,
  completed_at               timestamptz NULL,
  completed_by               uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  skipped_by                 uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  skip_reason                text NULL CHECK (skip_reason IS NULL OR char_length(skip_reason) BETWEEN 3 AND 2000),
  completion_note            text NULL CHECK (completion_note IS NULL OR char_length(completion_note) BETWEEN 1 AND 4000),
  approval_id                uuid NULL REFERENCES approval (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version                    integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  updated_by                 uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT procedure_step_instance_key UNIQUE (procedure_instance_id, step_key),
  CONSTRAINT procedure_step_instance_activated CHECK (status NOT IN ('active', 'completed', 'skipped') OR activated_at IS NOT NULL),
  CONSTRAINT procedure_step_instance_completed_complete
    CHECK ((status = 'completed') = (completed_at IS NOT NULL) AND (completed_at IS NULL) = (completed_by IS NULL)),
  CONSTRAINT procedure_step_instance_skipped_complete
    CHECK ((status = 'skipped') = (skip_reason IS NOT NULL) AND (skip_reason IS NULL) = (skipped_by IS NULL))
);
CREATE INDEX procedure_step_instance_assignee_idx ON procedure_step_instance (assignee_user_id, status, due_date);
CREATE INDEX procedure_step_instance_instance_idx ON procedure_step_instance (procedure_instance_id, ordinal);

-- procedure_instance_link: the real records an instance produced ('output') and the evidence it used ('evidence')
-- (REQ-S06-002 "outputs are real linked records"). Append-only: a link is never changed or deleted.
CREATE TABLE procedure_instance_link (
  id                    uuid PRIMARY KEY,
  organization_id       uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id     uuid NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  procedure_instance_id uuid NOT NULL REFERENCES procedure_instance (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  step_instance_id      uuid NULL REFERENCES procedure_step_instance (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  link_kind             text NOT NULL CHECK (link_kind IN ('output', 'evidence')),
  record_type           text NOT NULL CHECK (record_type IN (
                          'transformation', 'charter', 'baseline', 'kpi_actual', 'tom_canvas_cell', 'approval',
                          'ranking_snapshot', 'gate_submission', 'change_request', 'finance_validation', 'decision',
                          'bau_handover', 'evidence')),
  record_id             uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT procedure_instance_link_key UNIQUE (procedure_instance_id, link_kind, record_type, record_id),
  CONSTRAINT procedure_instance_link_evidence_kind CHECK (link_kind <> 'evidence' OR record_type = 'evidence')
);
CREATE INDEX procedure_instance_link_record_idx ON procedure_instance_link (record_type, record_id);

CREATE FUNCTION procedure_instance_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  d record;
  frozen text[] := ARRAY['procedure_definition_id', 'methodology_version_id', 'procedure_code', 'subject_record_type',
                         'subject_record_id', 'launch_key', 'launched_by', 'launched_at'];
  f text;
BEGIN
  SELECT pd.code, pd.scope_level, pd.removed, pd.input_schema, pd.completion_rule, m.status AS version_status
    INTO d FROM procedure_definition pd JOIN methodology_version m ON m.id = pd.methodology_version_id
   WHERE pd.id = NEW.procedure_definition_id;
  IF TG_OP = 'INSERT' THEN
    IF d.version_status <> 'published' OR d.removed OR NEW.status <> 'active' OR NEW.procedure_code <> d.code THEN
      RAISE EXCEPTION 'procedure_instance %: an instance starts active, from a published, not removed definition (its code)', NEW.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_instance_launch';
    END IF;
    IF (d.scope_level = 'organization') <> (NEW.transformation_id IS NULL) THEN
      RAISE EXCEPTION 'procedure_instance %: a transformation-scope procedure runs in a transformation; an organization-scope one does not', NEW.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_instance_scope';
    END IF;
  ELSE
    FOREACH f IN ARRAY frozen LOOP
      IF to_jsonb(NEW)->f IS DISTINCT FROM to_jsonb(OLD)->f THEN
        RAISE EXCEPTION 'procedure_instance %: % never changes (the instance stays pinned)', OLD.id, f
          USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_instance_pinned';
      END IF;
    END LOOP;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY['active>completed', 'active>cancelled']) THEN
      RAISE EXCEPTION 'procedure_instance %: % -> % is not a legal transition', OLD.id, OLD.status, NEW.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_instance_status_transition';
    END IF;
    IF OLD.status <> 'active' AND NEW.input_values IS DISTINCT FROM OLD.input_values THEN
      RAISE EXCEPTION 'procedure_instance %: inputs change only while the instance is active', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_instance_status_transition';
    END IF;
    IF NEW.status = 'completed' AND OLD.status = 'active' THEN
      IF EXISTS (SELECT 1 FROM procedure_step_instance s WHERE s.procedure_instance_id = NEW.id AND s.status IN ('pending', 'active')) THEN
        RAISE EXCEPTION 'procedure_instance %: every step must be closed before the instance completes', OLD.id
          USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_instance_completion';
      END IF;
      IF d.completion_rule = 'all_steps_closed_and_outputs_linked' AND EXISTS (
           SELECT 1 FROM procedure_step_instance s JOIN procedure_step_definition sd ON sd.id = s.step_definition_id
            WHERE s.procedure_instance_id = NEW.id AND s.status = 'completed' AND sd.output_record_type IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM procedure_instance_link l WHERE l.step_instance_id = s.id AND l.record_type = sd.output_record_type)) THEN
        RAISE EXCEPTION 'procedure_instance %: every completed step with an expected output must link its output record', OLD.id
          USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_instance_completion';
      END IF;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(NEW.input_values) AS k(key)
             WHERE NOT k.key = ANY (ARRAY(SELECT f2->>'key' FROM jsonb_array_elements(d.input_schema) AS f2))) THEN
    RAISE EXCEPTION 'procedure_instance %: an input value names an input the pinned definition does not declare', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_instance_inputs';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER procedure_instance_guard BEFORE INSERT OR UPDATE ON procedure_instance
  FOR EACH ROW EXECUTE FUNCTION procedure_instance_guard();
SELECT p2_attach_guards('procedure_instance', true);
GRANT SELECT, INSERT, UPDATE ON procedure_instance TO mth_app;

CREATE FUNCTION procedure_step_instance_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  i record;
  sd record;
  frozen text[] := ARRAY['procedure_instance_id', 'step_definition_id', 'step_key', 'ordinal'];
  f text;
BEGIN
  SELECT pi.procedure_definition_id, pi.status, pi.transformation_id, pi.input_values INTO i
    FROM procedure_instance pi WHERE pi.id = NEW.procedure_instance_id;
  SELECT s.procedure_definition_id, s.step_key, s.ordinal, s.step_kind, s.skippable, s.evidence_required,
         s.required_input_keys, s.removed
    INTO sd FROM procedure_step_definition s WHERE s.id = NEW.step_definition_id;
  IF TG_OP = 'INSERT' THEN
    IF sd.procedure_definition_id IS DISTINCT FROM i.procedure_definition_id OR sd.removed
       OR NEW.step_key <> sd.step_key OR NEW.ordinal <> sd.ordinal OR NEW.status <> 'pending'
       OR NEW.transformation_id IS DISTINCT FROM i.transformation_id THEN
      RAISE EXCEPTION 'procedure_step_instance %: a step instance copies a step of the pinned definition and starts pending', NEW.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_step_instance_pinned';
    END IF;
    RETURN NEW;
  END IF;
  FOREACH f IN ARRAY frozen LOOP
    IF to_jsonb(NEW)->f IS DISTINCT FROM to_jsonb(OLD)->f THEN
      RAISE EXCEPTION 'procedure_step_instance %: % never changes', OLD.id, f
        USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_step_instance_pinned';
    END IF;
  END LOOP;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY['pending>active', 'pending>not_applicable', 'pending>cancelled',
                                                         'active>completed', 'active>skipped', 'active>cancelled']) THEN
      RAISE EXCEPTION 'procedure_step_instance %: % -> % is not a legal transition', OLD.id, OLD.status, NEW.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_step_instance_status_transition';
    END IF;
    IF NEW.status <> 'cancelled' AND i.status <> 'active' THEN
      RAISE EXCEPTION 'procedure_step_instance %: steps move only while the instance is active', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_step_instance_status_transition';
    END IF;
    -- Ordered steps: a step activates (or is found not applicable) only when every lower ordinal is closed.
    IF NEW.status IN ('active', 'not_applicable') AND EXISTS (
         SELECT 1 FROM procedure_step_instance s WHERE s.procedure_instance_id = NEW.procedure_instance_id
           AND s.ordinal < NEW.ordinal AND s.status IN ('pending', 'active')) THEN
      RAISE EXCEPTION 'procedure_step_instance %: earlier steps are still open', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_step_instance_order';
    END IF;
    IF NEW.status = 'skipped' AND NOT sd.skippable THEN
      RAISE EXCEPTION 'procedure_step_instance %: this step cannot be skipped', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_step_instance_not_skippable';
    END IF;
    IF NEW.status = 'completed' THEN
      IF sd.step_kind = 'approval' AND (NEW.approval_id IS NULL
           OR (SELECT a.status FROM approval a WHERE a.id = NEW.approval_id) IS DISTINCT FROM 'approved') THEN
        RAISE EXCEPTION 'procedure_step_instance %: an approval step completes only through an approved canonical approval', OLD.id
          USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_step_instance_approval';
      END IF;
      IF EXISTS (SELECT 1 FROM unnest(sd.required_input_keys) AS k(key)
                 WHERE NOT (i.input_values ? k.key) OR jsonb_typeof(i.input_values->k.key) = 'null') THEN
        RAISE EXCEPTION 'procedure_step_instance %: required inputs are missing', OLD.id
          USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_step_instance_inputs';
      END IF;
      IF sd.evidence_required AND NOT EXISTS (SELECT 1 FROM procedure_instance_link l WHERE l.step_instance_id = NEW.id
                                                AND l.link_kind = 'evidence') THEN
        RAISE EXCEPTION 'procedure_step_instance %: this step needs linked evidence', OLD.id
          USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_step_instance_evidence';
      END IF;
    END IF;
  ELSIF OLD.status NOT IN ('pending', 'active') AND (to_jsonb(NEW) - ARRAY['version', 'updated_at', 'updated_by'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['version', 'updated_at', 'updated_by']) THEN
    RAISE EXCEPTION 'procedure_step_instance %: a closed step never changes', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_step_instance_status_transition';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER procedure_step_instance_guard BEFORE INSERT OR UPDATE ON procedure_step_instance
  FOR EACH ROW EXECUTE FUNCTION procedure_step_instance_guard();
SELECT p2_attach_guards('procedure_step_instance', true);
GRANT SELECT, INSERT, UPDATE ON procedure_step_instance TO mth_app;

-- A link names an existing record of its type: in the instance's transformation, or (organization scope) the
-- transformation it created in the instance's organization; its step belongs to the instance.
CREATE FUNCTION procedure_instance_link_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  i record;
  found_it boolean;
BEGIN
  SELECT pi.organization_id, pi.transformation_id INTO i FROM procedure_instance pi WHERE pi.id = NEW.procedure_instance_id;
  IF NEW.transformation_id IS DISTINCT FROM i.transformation_id OR NEW.organization_id IS DISTINCT FROM i.organization_id
     OR (NEW.step_instance_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM procedure_step_instance s
           WHERE s.id = NEW.step_instance_id AND s.procedure_instance_id = NEW.procedure_instance_id)) THEN
    RAISE EXCEPTION 'procedure_instance_link %: a link belongs to its instance (organization, transformation, step)', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'procedure_instance_link_scope';
  END IF;
  IF NEW.record_type = 'transformation' THEN
    found_it := EXISTS (SELECT 1 FROM transformation t WHERE t.id = NEW.record_id AND t.organization_id = i.organization_id
                          AND (i.transformation_id IS NULL OR t.id = i.transformation_id));
  ELSIF i.transformation_id IS NULL THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I r JOIN transformation t ON t.id = r.transformation_id
                                   WHERE r.id = $1 AND t.organization_id = $2)', NEW.record_type)
      INTO found_it USING NEW.record_id, i.organization_id;
  ELSE
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND transformation_id = $2)', NEW.record_type)
      INTO found_it USING NEW.record_id, i.transformation_id;
  END IF;
  IF NOT found_it THEN
    RAISE EXCEPTION 'procedure_instance_link %: % % does not exist in the instance''s scope', NEW.id, NEW.record_type, NEW.record_id
      USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'procedure_instance_link_record_ref';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER procedure_instance_link_guard BEFORE INSERT ON procedure_instance_link
  FOR EACH ROW EXECUTE FUNCTION procedure_instance_link_guard();
SELECT p2_attach_append_only('procedure_instance_link');
SELECT p2_attach_guards('procedure_instance_link', true);
GRANT SELECT, INSERT ON procedure_instance_link TO mth_app;
