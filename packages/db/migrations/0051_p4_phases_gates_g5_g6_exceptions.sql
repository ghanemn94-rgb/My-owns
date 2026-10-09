-- 0051 P4 slice H: the six-phase catalogue and guided phase steps, G5/G6 required outputs, per-criterion gate reviews,
-- gate-submission exceptions (waivers), the G5 approved scale scope with its conditions, scale transitions, and RAID
-- risk dispositions (T-DG4-ARCH-07; ADR-0035; REQ-PB-014, REQ-PB-015, REQ-PB-020, REQ-PB-021, REQ-S03-004,
-- REQ-S04-001, REQ-S04-002, REQ-S04-007, REQ-S04-008, REQ-S04-009, REQ-S04-010, REQ-S04-012, REQ-S04-013,
-- REQ-S12-009, REQ-S12-010). Authored by solution-architect.
-- Contract: docs/architecture/data-dictionary.md ("P4 tables, slice H").
-- Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged.
-- SQL floor: PostgreSQL 16.
-- G1-G6 are BUSINESS approvals inside the product. Nothing here approves anything, enables G5/G6 submission
-- (gate_definition.submission_enabled stays false for G5 and G6; the enabling migration ships with the evaluators,
-- the 0026 precedent) or touches the engineering delivery gates DG0-DG7. Product G6 never implies DG7.
--
-- One DG2 database invariant changes here, as decided by the orchestrator (D-089 Q2, p4-plan §3 seam 3):
-- gate_submission_criterion_mandatory_complete was "mandatory => complete"; it becomes "mandatory => complete, or
-- covered by an accepted gate exception recorded on the row". A row without an exception keeps the DG2 rule exactly.

-- -----------------------------------------------------------------------------------------------------------------
-- phase_definition: the six phases, verbatim from the playbook (B0021 name, purpose and key outputs; B0026, B0045,
-- B0053, B0067, B0090, B0118 titles; B0027, B0046, B0054, B0068, B0091, B0119 objectives). Arabic is a PROVISIONAL
-- translation that needs linguistic review (ar_provisional). Read-only for mth_app (REQ-PB-014).
CREATE TABLE phase_definition (
  id                     uuid PRIMARY KEY,
  code                   text NOT NULL CONSTRAINT phase_definition_code_key UNIQUE
                         CHECK (code IN ('diagnose', 'define', 'design', 'mobilize', 'transform', 'realize')),
  methodology_version_id uuid NOT NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ordinal                smallint NOT NULL CONSTRAINT phase_definition_ordinal_key UNIQUE CHECK (ordinal BETWEEN 1 AND 6),
  gate_code              text NOT NULL CONSTRAINT phase_definition_gate_code_key UNIQUE
                         REFERENCES gate_definition (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  source_name_en         text NOT NULL CHECK (char_length(source_name_en) BETWEEN 1 AND 50),
  name_ar                text NOT NULL CHECK (char_length(name_ar) BETWEEN 1 AND 100),
  source_title_en        text NOT NULL CHECK (char_length(source_title_en) BETWEEN 1 AND 200),
  title_ar               text NOT NULL CHECK (char_length(title_ar) BETWEEN 1 AND 200),
  source_purpose_en      text NOT NULL CHECK (char_length(source_purpose_en) BETWEEN 1 AND 200),
  purpose_ar             text NOT NULL CHECK (char_length(purpose_ar) BETWEEN 1 AND 200),
  source_key_outputs_en  text NOT NULL CHECK (char_length(source_key_outputs_en) BETWEEN 1 AND 500),
  key_outputs_ar         text NOT NULL CHECK (char_length(key_outputs_ar) BETWEEN 1 AND 500),
  source_objective_en    text NOT NULL CHECK (char_length(source_objective_en) BETWEEN 1 AND 1000),
  objective_ar           text NOT NULL CHECK (char_length(objective_ar) BETWEEN 1 AND 1000),
  source_ref             text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 100),
  ar_provisional         boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON phase_definition TO mth_app;

INSERT INTO phase_definition (id, code, methodology_version_id, ordinal, gate_code, source_name_en, name_ar, source_title_en, title_ar,
                              source_purpose_en, purpose_ar, source_key_outputs_en, key_outputs_ar, source_objective_en,
                              objective_ar, source_ref) VALUES
  ('01920002-0008-7000-8000-000000000001', 'diagnose', '01920002-0000-7000-8000-000000000001', 1, 'G1', 'DIAGNOSE', 'التشخيص',
   'DIAGNOSE — Build the Fact Base', 'التشخيص — بناء قاعدة الحقائق', 'Establish fact base', 'إرساء قاعدة الحقائق',
   'Current state, root causes, value pools', 'الوضع الحالي، الأسباب الجذرية، مجمّعات القيمة',
   'create a shared, evidence-based view of current performance, root causes and value at stake before solutions are chosen.',
   'بناء رؤية مشتركة قائمة على الأدلة للأداء الحالي والأسباب الجذرية والقيمة المعرّضة للتحقق قبل اختيار الحلول.', 'B0021;B0026;B0027'),
  ('01920002-0008-7000-8000-000000000002', 'define', '01920002-0000-7000-8000-000000000001', 2, 'G2', 'DEFINE', 'التحديد',
   'DEFINE — North Star & Outcomes', 'التحديد — نجم الشمال والنتائج', 'Set direction', 'تحديد التوجّه',
   'North Star, outcomes, KPIs, guardrails', 'نجم الشمال، النتائج، مؤشرات الأداء الرئيسية، الضوابط الاستراتيجية',
   'translate the case for change into measurable transformation outcomes that can steer portfolio and operating-model choices.',
   'ترجمة مبررات التغيير إلى نتائج تحول قابلة للقياس توجّه خيارات المحفظة ونموذج التشغيل.', 'B0021;B0045;B0046'),
  ('01920002-0008-7000-8000-000000000003', 'design', '01920002-0000-7000-8000-000000000001', 3, 'G3', 'DESIGN', 'التصميم',
   'DESIGN — Target Operating Model', 'التصميم — نموذج التشغيل المستهدف', 'Create target state', 'إنشاء الحالة المستهدفة',
   'Target Operating Model, capabilities, journeys', 'نموذج التشغيل المستهدف، القدرات، الرحلات',
   'define what must be different in the business—beyond projects—so the outcomes can be sustained.',
   'تحديد ما يجب أن يتغير في الأعمال — بما يتجاوز المشاريع — حتى تستدام النتائج.', 'B0021;B0053;B0054'),
  ('01920002-0008-7000-8000-000000000004', 'mobilize', '01920002-0000-7000-8000-000000000001', 4, 'G4', 'MOBILIZE', 'التعبئة',
   'MOBILIZE — Build the Transformation Portfolio', 'التعبئة — بناء محفظة التحول', 'Build execution portfolio', 'بناء محفظة التنفيذ',
   'Initiatives, business cases, roadmap, resourcing', 'المبادرات، دراسات الجدوى، خريطة الطريق، الموارد',
   'convert target-state gaps into an integrated portfolio of initiatives with clear value logic, sequencing, ownership and capacity.',
   'تحويل فجوات الحالة المستهدفة إلى محفظة متكاملة من المبادرات بمنطق قيمة وتسلسل وملكية وطاقة استيعابية واضحة.', 'B0021;B0067;B0068'),
  ('01920002-0008-7000-8000-000000000005', 'transform', '01920002-0000-7000-8000-000000000001', 5, 'G5', 'TRANSFORM', 'التحول',
   'TRANSFORM — Transformation Operating System', 'التحول — نظام تشغيل التحول', 'Execute & govern', 'التنفيذ والحوكمة',
   'Operating system, workstreams, decisions, adoption', 'نظام التشغيل، مسارات العمل، القرارات، التبنّي',
   'create a fast, disciplined mechanism for cross-functional execution, escalation, learning and decision-making while protecting outcome ownership.',
   'إنشاء آلية سريعة ومنضبطة للتنفيذ متعدد الوظائف والتصعيد والتعلّم واتخاذ القرار مع حماية ملكية النتائج.', 'B0021;B0090;B0091'),
  ('01920002-0008-7000-8000-000000000006', 'realize', '01920002-0000-7000-8000-000000000001', 6, 'G6', 'REALIZE', 'تحقيق القيمة',
   'REALIZE — Benefits & Sustainability', 'تحقيق القيمة — المنافع والاستدامة', 'Prove & sustain value', 'إثبات القيمة واستدامتها',
   'Benefits, BAU handover, continuous improvement', 'المنافع، التسليم للعمليات الاعتيادية، التحسين المستمر',
   'convert delivered capabilities into validated business value, transfer ownership to BAU, and establish a mechanism for sustained performance.',
   'تحويل القدرات المُسلَّمة إلى قيمة أعمال متحقق منها، ونقل الملكية إلى العمليات الاعتيادية، وإرساء آلية للأداء المستدام.', 'B0021;B0118;B0119');

-- -----------------------------------------------------------------------------------------------------------------
-- phase_step_definition: the guided procedure of each phase (REQ-S04-001, M0116). source_procedure_en is VERBATIM, one
-- clause of the master prompt's "Inputs and native procedure" column (M0118-M0123, split at ';'). required_evidence_en
-- and the role defaults are an ARCHITECT INTERPRETATION (ADR-0035 §1), not source text. completion_rule is evaluated by
-- the API (ADR-0035 §1 table); the database stores the frozen result (phase_step.completion_check). Read-only.
CREATE TABLE phase_step_definition (
  id                      uuid PRIMARY KEY,
  key                     text NOT NULL CONSTRAINT phase_step_definition_key_key UNIQUE
                          CHECK (key ~ '^(diagnose|define|design|mobilize|transform|realize)\.[a-z_]{1,48}$'),
  phase_code              text NOT NULL REFERENCES phase_definition (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ordinal                 smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 10),
  source_procedure_en     text NOT NULL CHECK (char_length(source_procedure_en) BETWEEN 1 AND 500),
  procedure_ar            text NOT NULL CHECK (char_length(procedure_ar) BETWEEN 1 AND 500),
  required_evidence_en    text NOT NULL CHECK (char_length(required_evidence_en) BETWEEN 1 AND 500),
  required_evidence_ar    text NOT NULL CHECK (char_length(required_evidence_ar) BETWEEN 1 AND 500),
  default_owner_role_code text NOT NULL REFERENCES role (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  reviewer_role_code      text NOT NULL REFERENCES role (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  completion_rule         text NOT NULL CHECK (completion_rule IN ('evidence_linked', 'meeting_held', 'kpi_actual_accepted',
                            'raid_register_present', 'benefit_validated', 'corrective_cases_owned', 'handover_accepted',
                            'improvement_backlog_present')),
  source_ref              text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 50),
  ar_provisional          boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phase_step_definition_ordinal_key UNIQUE (phase_code, ordinal),
  CONSTRAINT phase_step_definition_key_phase_key UNIQUE (key, phase_code),
  CONSTRAINT phase_step_definition_key_prefix CHECK (split_part(key, '.', 1) = phase_code),
  CONSTRAINT phase_step_definition_reviewer_not_owner_role CHECK (reviewer_role_code <> default_owner_role_code)
);
GRANT SELECT ON phase_step_definition TO mth_app;

INSERT INTO phase_step_definition (id, key, phase_code, ordinal, source_procedure_en, procedure_ar, required_evidence_en,
                                   required_evidence_ar, default_owner_role_code, reviewer_role_code, completion_rule, source_ref) VALUES
  ('01920002-0009-7000-8000-000000000001', 'diagnose.register_scope_sponsor', 'diagnose', 1, 'Register scope and sponsor', 'تسجيل النطاق والراعي',
   'At least one verified evidence item linked to the step (e.g. the initial charter or sponsor confirmation).', 'دليل واحد متحقق منه على الأقل مرتبط بالخطوة (مثل الميثاق الأولي أو تأكيد الراعي).', 'TL', 'TO', 'evidence_linked', 'M0118'),
  ('01920002-0009-7000-8000-000000000002', 'diagnose.assess_performance', 'diagnose', 2,
   'assess business/financial performance, customer experience, processes/operations, organization/governance, technology/data and capabilities',
   'تقييم الأداء التجاري/المالي وتجربة العملاء والعمليات/التشغيل والتنظيم/الحوكمة والتقنية/البيانات والقدرات',
   'At least one verified evidence item linked to the step (the assessment inputs).', 'دليل واحد متحقق منه على الأقل مرتبط بالخطوة (مدخلات التقييم).', 'TL', 'TO', 'evidence_linked', 'M0118'),
  ('01920002-0009-7000-8000-000000000003', 'diagnose.collect_baseline_evidence', 'diagnose', 3, 'collect baseline evidence', 'جمع أدلة الخط الأساسي',
   'At least one verified evidence item linked to the step (baseline sources).', 'دليل واحد متحقق منه على الأقل مرتبط بالخطوة (مصادر الخط الأساسي).', 'TL', 'TO', 'evidence_linked', 'M0118'),
  ('01920002-0009-7000-8000-000000000004', 'diagnose.root_causes', 'diagnose', 4, 'distinguish symptoms from root causes', 'التمييز بين الأعراض والأسباب الجذرية',
   'At least one verified evidence item linked to the step (root-cause analysis).', 'دليل واحد متحقق منه على الأقل مرتبط بالخطوة (تحليل الأسباب الجذرية).', 'TL', 'TO', 'evidence_linked', 'M0118'),
  ('01920002-0009-7000-8000-000000000005', 'diagnose.value_pools', 'diagnose', 5, 'identify value pools and confidence', 'تحديد مجمّعات القيمة ودرجة الثقة',
   'At least one verified evidence item linked to the step (value-pool sizing).', 'دليل واحد متحقق منه على الأقل مرتبط بالخطوة (تقدير مجمّعات القيمة).', 'TL', 'TO', 'evidence_linked', 'M0118'),
  ('01920002-0009-7000-8000-000000000006', 'define.north_star', 'define', 1, 'Refine the North Star', 'صقل نجم الشمال',
   'At least one verified evidence item linked to the step.', 'دليل واحد متحقق منه على الأقل مرتبط بالخطوة.', 'TL', 'TO', 'evidence_linked', 'M0119'),
  ('01920002-0009-7000-8000-000000000007', 'define.outcome_hierarchy', 'define', 2, 'build the outcome hierarchy', 'بناء هرم النتائج',
   'At least one verified evidence item linked to the step.', 'دليل واحد متحقق منه على الأقل مرتبط بالخطوة.', 'TL', 'TO', 'evidence_linked', 'M0119'),
  ('01920002-0009-7000-8000-000000000008', 'define.outcomes_kpis_guardrails', 'define', 3,
   'define 3–5 business outcomes, owners, KPIs, targets, target dates, leading indicators and strategic guardrails',
   'تحديد 3–5 نتائج أعمال ومالكيها ومؤشرات أدائها وأهدافها وتواريخها المستهدفة والمؤشرات القيادية والضوابط الاستراتيجية',
   'At least one verified evidence item linked to the step.', 'دليل واحد متحقق منه على الأقل مرتبط بالخطوة.', 'TL', 'TO', 'evidence_linked', 'M0119'),
  ('01920002-0009-7000-8000-000000000009', 'design.ten_dimension_tom', 'design', 1, 'Facilitate the ten-dimension TOM', 'تيسير نموذج التشغيل المستهدف بأبعاده العشرة',
   'At least one verified evidence item linked to the step.', 'دليل واحد متحقق منه على الأقل مرتبط بالخطوة.', 'TL', 'TO', 'evidence_linked', 'M0120'),
  ('01920002-0009-7000-8000-00000000000a', 'design.compare_states', 'design', 2, 'compare current and target states', 'مقارنة الحالتين الحالية والمستهدفة',
   'At least one verified evidence item linked to the step.', 'دليل واحد متحقق منه على الأقل مرتبط بالخطوة.', 'TL', 'TO', 'evidence_linked', 'M0120'),
  ('01920002-0009-7000-8000-00000000000b', 'design.journeys_capabilities', 'design', 3, 'map future journeys and capabilities', 'رسم الرحلات والقدرات المستقبلية',
   'At least one verified evidence item linked to the step.', 'دليل واحد متحقق منه على الأقل مرتبط بالخطوة.', 'TL', 'TO', 'evidence_linked', 'M0120'),
  ('01920002-0009-7000-8000-00000000000c', 'design.options_ownership', 'design', 4, 'resolve design options and ownership', 'حسم خيارات التصميم والملكية',
   'At least one verified evidence item linked to the step.', 'دليل واحد متحقق منه على الأقل مرتبط بالخطوة.', 'TL', 'TO', 'evidence_linked', 'M0120'),
  ('01920002-0009-7000-8000-00000000000d', 'mobilize.gaps_to_initiatives', 'mobilize', 1, 'Convert gaps into initiatives', 'تحويل الفجوات إلى مبادرات',
   'At least one verified evidence item linked to the step.', 'دليل واحد متحقق منه على الأقل مرتبط بالخطوة.', 'TL', 'TO', 'evidence_linked', 'M0121'),
  ('01920002-0009-7000-8000-00000000000e', 'mobilize.cases_benefit_logic', 'mobilize', 2, 'prepare cases and benefit logic', 'إعداد دراسات الجدوى ومنطق المنافع',
   'At least one verified evidence item linked to the step.', 'دليل واحد متحقق منه على الأقل مرتبط بالخطوة.', 'TL', 'TO', 'evidence_linked', 'M0121'),
  ('01920002-0009-7000-8000-00000000000f', 'mobilize.score_prioritize', 'mobilize', 3, 'score and prioritize', 'التقييم وتحديد الأولويات',
   'At least one verified evidence item linked to the step.', 'دليل واحد متحقق منه على الأقل مرتبط بالخطوة.', 'TL', 'TO', 'evidence_linked', 'M0121'),
  ('01920002-0009-7000-8000-000000000010', 'mobilize.waves_dependencies', 'mobilize', 4, 'sequence waves and dependencies', 'ترتيب الموجات والاعتماديات',
   'At least one verified evidence item linked to the step.', 'دليل واحد متحقق منه على الأقل مرتبط بالخطوة.', 'TL', 'TO', 'evidence_linked', 'M0121'),
  ('01920002-0009-7000-8000-000000000011', 'mobilize.owners_funding_capacity', 'mobilize', 5, 'confirm owners, funding and capacity', 'تأكيد المالكين والتمويل والطاقة الاستيعابية',
   'At least one verified evidence item linked to the step.', 'دليل واحد متحقق منه على الأقل مرتبط بالخطوة.', 'TL', 'TO', 'evidence_linked', 'M0121'),
  ('01920002-0009-7000-8000-000000000012', 'transform.workstreams_forums', 'transform', 1, 'Operate workstreams and forums', 'تشغيل مسارات العمل والمنتديات',
   'At least one meeting of the transformation held or with minutes published.', 'اجتماع واحد على الأقل للتحول عُقد أو نُشر محضره.', 'TL', 'TO', 'meeting_held', 'M0122;B0093'),
  ('01920002-0009-7000-8000-000000000013', 'transform.deliver_pilots', 'transform', 2, 'deliver pilots', 'تنفيذ التجارب',
   'At least one verified evidence item linked to the step (pilot or performance evidence).', 'دليل واحد متحقق منه على الأقل مرتبط بالخطوة (دليل التجربة أو الأداء).', 'WL', 'TO', 'evidence_linked', 'M0122'),
  ('01920002-0009-7000-8000-000000000014', 'transform.track_progress', 'transform', 3, 'track milestones, outcomes and adoption', 'متابعة المعالم والنتائج والتبنّي',
   'At least one accepted KPI actual in the transformation.', 'قيمة فعلية مقبولة واحدة على الأقل لمؤشر أداء في التحول.', 'TL', 'TO', 'kpi_actual_accepted', 'M0122'),
  ('01920002-0009-7000-8000-000000000015', 'transform.manage_raid_decisions', 'transform', 4, 'manage RAID, dependencies, decisions and corrective actions', 'إدارة المخاطر والافتراضات والقضايا والاعتماديات والقرارات والإجراءات التصحيحية',
   'At least one RAID entry recorded for the transformation.', 'إدخال واحد على الأقل في سجل المخاطر والافتراضات والقضايا والاعتماديات للتحول.', 'TL', 'TO', 'raid_register_present', 'M0122;B0128'),
  ('01920002-0009-7000-8000-000000000016', 'realize.measure_validate_benefits', 'realize', 1, 'Measure and validate benefits', 'قياس المنافع والتحقق منها',
   'At least one benefit measurement validated by Finance.', 'قياس منفعة واحد على الأقل تحققت منه المالية.', 'BO', 'TO', 'benefit_validated', 'M0123;B0121'),
  ('01920002-0009-7000-8000-000000000017', 'realize.correct_gaps', 'realize', 2, 'correct gaps', 'معالجة الفجوات',
   'Every open corrective case has an owner and a follow-up date.', 'لكل حالة تصحيحية مفتوحة مالك وتاريخ متابعة.', 'TL', 'TO', 'corrective_cases_owned', 'M0123;B0121'),
  ('01920002-0009-7000-8000-000000000018', 'realize.transfer_ownership_controls', 'realize', 3, 'transfer ownership and controls', 'نقل الملكية والضوابط الرقابية',
   'At least one BAU handover accepted by its receiving owner.', 'تسليم واحد على الأقل للعمليات الاعتيادية قبله مالكه المستلم.', 'BO', 'TO', 'handover_accepted', 'M0123;B0121'),
  ('01920002-0009-7000-8000-000000000019', 'realize.sustained_monitoring', 'realize', 4, 'establish sustained monitoring and improvement', 'إرساء المتابعة المستدامة والتحسين',
   'At least one continuous-improvement backlog item.', 'بند واحد على الأقل في قائمة أعمال التحسين المستمر.', 'BO', 'TO', 'improvement_backlog_present', 'M0123');

-- -----------------------------------------------------------------------------------------------------------------
-- phase_step: one transformation's progress on one step (REQ-S04-001). Created on first use (owner assignment, start)
-- or by the gate-approval consumer when the next phase is enabled (REQ-S12-010); a step without a row is shown
-- "not started" with an Unknown owner. State machine (trigger phase_step_status_step):
--   not_started -> in_progress -> in_review -> complete | returned;  returned -> in_progress | in_review.
--   complete is final. in_review needs a met completion check; complete needs an accepting reviewer who is neither the
--   owner nor the person who asked for the review (separation of duties).
CREATE TABLE phase_step (
  id                          uuid PRIMARY KEY,
  organization_id             uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id           uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  step_key                    text NOT NULL,
  phase_code                  text NOT NULL,
  owner_user_id               uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status                      text NOT NULL DEFAULT 'not_started'
                              CHECK (status IN ('not_started', 'in_progress', 'in_review', 'complete', 'returned')),
  enabled_by_gate_decision_id uuid NULL REFERENCES gate_decision (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  review_requested_by         uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  review_requested_at         timestamptz NULL,
  completion_check            jsonb NULL CHECK (completion_check IS NULL OR jsonb_typeof(completion_check) = 'object'),
  reviewed_by                 uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  reviewed_at                 timestamptz NULL,
  review_outcome              text NULL CHECK (review_outcome IS NULL OR review_outcome IN ('accepted', 'returned')),
  review_note                 text NULL CHECK (review_note IS NULL OR char_length(review_note) BETWEEN 1 AND 2000),
  completed_at                timestamptz NULL,
  version                     integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT phase_step_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT phase_step_key UNIQUE (transformation_id, step_key),
  CONSTRAINT phase_step_definition_fkey FOREIGN KEY (step_key, phase_code)
    REFERENCES phase_step_definition (key, phase_code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT phase_step_review_requested_complete CHECK ((review_requested_at IS NULL) = (review_requested_by IS NULL)),
  CONSTRAINT phase_step_in_review_checked CHECK (status <> 'in_review' OR (review_requested_at IS NOT NULL
                                                AND completion_check IS NOT NULL AND completion_check->>'met' = 'true')),
  CONSTRAINT phase_step_reviewed_complete CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL)
                                                 AND (reviewed_at IS NULL) = (review_outcome IS NULL)),
  CONSTRAINT phase_step_complete_shape CHECK ((status = 'complete') = (completed_at IS NOT NULL)
                                              AND (status <> 'complete' OR (review_outcome = 'accepted'
                                                   AND completion_check->>'met' = 'true' AND owner_user_id IS NOT NULL))),
  CONSTRAINT phase_step_returned_note CHECK (status <> 'returned' OR (review_outcome = 'returned' AND review_note IS NOT NULL)),
  CONSTRAINT phase_step_reviewer_separate CHECK (reviewed_by IS NULL OR (reviewed_by IS DISTINCT FROM owner_user_id
                                                 AND reviewed_by IS DISTINCT FROM review_requested_by))
);
CREATE INDEX phase_step_review_queue_idx ON phase_step (transformation_id, review_requested_at) WHERE status = 'in_review';
CREATE INDEX phase_step_owner_idx ON phase_step (owner_user_id) WHERE status IN ('not_started', 'in_progress', 'returned');
CREATE FUNCTION phase_step_status_step() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  ok boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('not_started', 'in_progress') THEN
      RAISE EXCEPTION 'phase_step: a new step starts not_started or in_progress, not %', NEW.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'phase_step_status_step';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'complete' THEN
    RAISE EXCEPTION 'phase_step %: a complete step is final', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'phase_step_complete_final';
  END IF;
  IF NEW.step_key IS DISTINCT FROM OLD.step_key OR NEW.phase_code IS DISTINCT FROM OLD.phase_code
     OR NEW.enabled_by_gate_decision_id IS DISTINCT FROM OLD.enabled_by_gate_decision_id THEN
    RAISE EXCEPTION 'phase_step %: step, phase and enabling gate decision are immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'phase_step_identity';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    ok := CASE OLD.status
            WHEN 'not_started' THEN NEW.status = 'in_progress'
            WHEN 'in_progress' THEN NEW.status = 'in_review'
            WHEN 'in_review' THEN NEW.status IN ('complete', 'returned')
            WHEN 'returned' THEN NEW.status IN ('in_progress', 'in_review')
            ELSE false END;
    IF NOT ok THEN
      RAISE EXCEPTION 'phase_step: % -> % is not an allowed transition', OLD.status, NEW.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'phase_step_status_step';
    END IF;
  END IF;
  -- The owner is fixed while the step is in review (the reviewer was chosen against that owner).
  IF OLD.status = 'in_review' AND NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    RAISE EXCEPTION 'phase_step %: the owner cannot change while the step is in review', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'phase_step_owner_locked_in_review';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER phase_step_status_step BEFORE INSERT OR UPDATE ON phase_step
  FOR EACH ROW EXECUTE FUNCTION phase_step_status_step();
SELECT p2_attach_guards('phase_step', true);
GRANT SELECT, INSERT, UPDATE ON phase_step TO mth_app;

-- phase_step_evidence: evidence linked to a step (completion rule 'evidence_linked' counts the verified ones).
-- Links are added and removed (status) only while the step is not complete.
CREATE TABLE phase_step_evidence (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  phase_step_id     uuid NOT NULL,
  evidence_id       uuid NOT NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  removed_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  removed_at        timestamptz NULL,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT phase_step_evidence_step_fkey FOREIGN KEY (transformation_id, phase_step_id)
    REFERENCES phase_step (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT phase_step_evidence_evidence_fkey FOREIGN KEY (transformation_id, evidence_id)
    REFERENCES evidence (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT phase_step_evidence_removed_complete CHECK ((status = 'removed') = (removed_at IS NOT NULL)
                                                         AND (removed_at IS NULL) = (removed_by IS NULL))
);
CREATE UNIQUE INDEX phase_step_evidence_active_key ON phase_step_evidence (phase_step_id, evidence_id) WHERE status = 'active';
CREATE FUNCTION phase_step_evidence_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM phase_step s WHERE s.id = NEW.phase_step_id AND s.status = 'complete') THEN
    RAISE EXCEPTION 'phase_step_evidence: the step is complete; its evidence is frozen'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'phase_step_evidence_step_open';
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.status = 'removed' OR NEW.phase_step_id IS DISTINCT FROM OLD.phase_step_id
                           OR NEW.evidence_id IS DISTINCT FROM OLD.evidence_id) THEN
    RAISE EXCEPTION 'phase_step_evidence: a link only moves active -> removed, once'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'phase_step_evidence_status_step';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER phase_step_evidence_guard BEFORE INSERT OR UPDATE ON phase_step_evidence
  FOR EACH ROW EXECUTE FUNCTION phase_step_evidence_guard();
SELECT p2_attach_guards('phase_step_evidence', true);
GRANT SELECT, INSERT, UPDATE ON phase_step_evidence TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- G5 and G6 required outputs (B0023 evidence lists, verbatim labels; M0122, M0123 decision evidence; REQ-PB-020,
-- REQ-PB-021). G1-G4 rows are untouched. G5 and G6 stay submission_enabled = false here (ADR-0035 §2).
INSERT INTO gate_criterion_definition (id, gate_definition_id, key, ordinal, label_en, label_ar, description_en,
                                       description_ar, mandatory, requires_verified_evidence, source_ref) VALUES
  ('01920002-0005-7000-8000-000000000021', '01920002-0004-7000-8000-000000000005', 'g5.performance_evidence', 1, 'Performance evidence', 'أدلة الأداء',
   'Every KPI linked to an outcome of the transformation has an accepted actual whose status is not Unknown, and at least one verified pilot or performance evidence item is linked to the Transform step "deliver pilots".',
   'لكل مؤشر أداء مرتبط بنتيجة للتحول قيمة فعلية مقبولة غير مجهولة الحالة، ودليل تجربة أو أداء واحد متحقق منه على الأقل مرتبط بخطوة "تنفيذ التجارب" في مرحلة التحول.', true, true, 'B0023;M0122'),
  ('01920002-0005-7000-8000-000000000022', '01920002-0004-7000-8000-000000000005', 'g5.adoption', 2, 'Adoption', 'التبنّي',
   'At least one adoption indicator is linked to the transformation, and every linked indicator has a current value that is not Unknown.',
   'مؤشر تبنٍّ واحد على الأقل مرتبط بالتحول، ولكل مؤشر مرتبط قيمة حالية غير مجهولة.', true, false, 'B0023;M0122;B0109'),
  ('01920002-0005-7000-8000-000000000023', '01920002-0004-7000-8000-000000000005', 'g5.risk_closure', 3, 'Risk closure', 'إغلاق المخاطر',
   'Every RAID risk of the transformation with High impact is closed or has an approved disposition.',
   'كل خطر عالي الأثر في سجل التحول مغلق أو له معالجة معتمدة.', true, false, 'B0023;M0122;B0128'),
  ('01920002-0005-7000-8000-000000000024', '01920002-0004-7000-8000-000000000005', 'g5.decision_log', 4, 'Decision log', 'سجل القرارات',
   'The T16 executive decision log has at least one entry, and no executive decision is open past its decision date.',
   'يحتوي سجل القرارات التنفيذية (T16) على قيد واحد على الأقل، ولا يوجد قرار تنفيذي مفتوح بعد تاريخ قراره.', true, false, 'B0023;M0122;B0130'),
  ('01920002-0005-7000-8000-000000000031', '01920002-0004-7000-8000-000000000006', 'g6.benefits_evidence', 1, 'Benefits evidence', 'أدلة المنافع',
   'At least one benefit exists, and every benefit of the transformation has a Finance-validated measurement or an approved transition decision.',
   'توجد منفعة واحدة على الأقل، ولكل منفعة في التحول قياس تحققت منه المالية أو قرار انتقال معتمد.', true, false, 'B0023;M0123;B0121'),
  ('01920002-0005-7000-8000-000000000032', '01920002-0004-7000-8000-000000000006', 'g6.ownership_transfer', 2, 'Ownership transfer', 'نقل الملكية',
   'At least one performance area of the transformation exists, and each one has a BAU handover accepted by its receiving owner in its current cycle.',
   'يوجد مجال أداء واحد على الأقل للتحول، ولكل مجال تسليم للعمليات الاعتيادية قبله مالكه المستلم في دورته الحالية.', true, false, 'B0023;M0123;B0121'),
  ('01920002-0005-7000-8000-000000000033', '01920002-0004-7000-8000-000000000006', 'g6.controls', 3, 'Controls', 'الضوابط الرقابية',
   'Every performance area with an accepted handover has at least one active control.',
   'لكل مجال أداء ذي تسليم مقبول ضابط رقابي نشط واحد على الأقل.', true, false, 'B0023;M0123'),
  ('01920002-0005-7000-8000-000000000034', '01920002-0004-7000-8000-000000000006', 'g6.improvement_backlog', 4, 'Continuous improvement backlog', 'قائمة أعمال التحسين المستمر',
   'The continuous-improvement backlog of the transformation has at least one item.',
   'تحتوي قائمة أعمال التحسين المستمر للتحول على بند واحد على الأقل.', true, false, 'B0023;M0123');

-- -----------------------------------------------------------------------------------------------------------------
-- gate_criterion_review: per-criterion review of a pending submission (REQ-S04-009): reviewer, finding, open condition,
-- risk, recommendation (the criterion "decision") and rationale. Append-only; the latest review_no per criterion is
-- current. The criterion, required evidence and completeness come from gate_criterion_definition and
-- gate_submission_criterion, so every criterion row shows all nine fields.
CREATE TABLE gate_criterion_review (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id  uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  gate_submission_id uuid NOT NULL REFERENCES gate_submission (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  criterion_key      text NOT NULL REFERENCES gate_criterion_definition (key) ON DELETE RESTRICT ON UPDATE RESTRICT,
  review_no          integer NOT NULL CHECK (review_no >= 1),
  reviewer_user_id   uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  finding            text NOT NULL CHECK (char_length(finding) BETWEEN 1 AND 4000),
  open_condition     text NULL CHECK (open_condition IS NULL OR char_length(open_condition) BETWEEN 1 AND 2000),
  risk_note          text NULL CHECK (risk_note IS NULL OR char_length(risk_note) BETWEEN 1 AND 2000),
  raid_entry_id      uuid NULL,
  recommendation     text NOT NULL CHECK (recommendation IN ('meets', 'meets_with_conditions', 'does_not_meet')),
  rationale          text NOT NULL CHECK (char_length(rationale) BETWEEN 3 AND 4000),
  reviewed_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gate_criterion_review_no_key UNIQUE (gate_submission_id, criterion_key, review_no),
  CONSTRAINT gate_criterion_review_raid_fkey FOREIGN KEY (transformation_id, raid_entry_id)
    REFERENCES raid_entry (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT gate_criterion_review_condition_required CHECK (recommendation <> 'meets_with_conditions' OR open_condition IS NOT NULL)
);
CREATE FUNCTION gate_criterion_review_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  s gate_submission%ROWTYPE;
BEGIN
  SELECT * INTO s FROM gate_submission WHERE id = NEW.gate_submission_id;
  IF s.transformation_id IS DISTINCT FROM NEW.transformation_id THEN
    RAISE EXCEPTION 'gate_criterion_review: submission % is not in transformation %', NEW.gate_submission_id, NEW.transformation_id
      USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'gate_criterion_review_submission_scope';
  END IF;
  IF s.status <> 'pending' THEN
    RAISE EXCEPTION 'gate_criterion_review: submission % is %, only a pending submission is reviewed', s.id, s.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_criterion_review_submission_pending';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM gate_submission_criterion c WHERE c.gate_submission_id = s.id AND c.criterion_key = NEW.criterion_key) THEN
    RAISE EXCEPTION 'gate_criterion_review: % is not a criterion of submission %', NEW.criterion_key, s.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_criterion_review_criterion_of_submission';
  END IF;
  IF NEW.reviewer_user_id = s.submitted_by THEN
    RAISE EXCEPTION 'gate_criterion_review: the submitter cannot review their own submission (separation of duties)'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'gate_criterion_review_not_submitter';
  END IF;
  IF NEW.review_no <> coalesce((SELECT max(r.review_no) FROM gate_criterion_review r
                                WHERE r.gate_submission_id = s.id AND r.criterion_key = NEW.criterion_key), 0) + 1 THEN
    RAISE EXCEPTION 'gate_criterion_review: review_no must be the next number for this criterion'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_criterion_review_no_sequence';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gate_criterion_review_guard BEFORE INSERT ON gate_criterion_review
  FOR EACH ROW EXECUTE FUNCTION gate_criterion_review_guard();
SELECT p2_attach_append_only('gate_criterion_review');
SELECT p2_attach_guards('gate_criterion_review', true);
GRANT SELECT, INSERT ON gate_criterion_review TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- gate_exception: a specifically authorized exception (waiver) for one mandatory criterion of one gate instance
-- (REQ-S04-012, REQ-S04-013, M0125): reason, scope, approver (decided_by), expiry and compensating action. Status:
--   pending -> accepted | rejected | withdrawn;  accepted -> revoked.  rejected, withdrawn, revoked: final.
-- Expiry is a date, not a status: an accepted exception covers its criterion only while the business date (the
-- transformation's timezone) is on or before expires_on. The decider is never the requester (CHECK) and must be the
-- gate's configured approver (API, ADR-0035 §4). Lock class 730247 (per gate instance) serialises requests.
CREATE TABLE gate_exception (
  id                         uuid PRIMARY KEY,
  organization_id            uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id          uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  gate_instance_id           uuid NOT NULL,
  gate_code                  text NOT NULL REFERENCES gate_definition (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  criterion_key              text NOT NULL REFERENCES gate_criterion_definition (key) ON DELETE RESTRICT ON UPDATE RESTRICT,
  reason                     text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 4000),
  scope                      text NOT NULL CHECK (char_length(scope) BETWEEN 3 AND 2000),
  compensating_action        text NOT NULL CHECK (char_length(compensating_action) BETWEEN 3 AND 4000),
  compensating_owner_user_id uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  expires_on                 date NOT NULL,
  status                     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn', 'revoked')),
  requested_by               uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  requested_at               timestamptz NOT NULL DEFAULT now(),
  decided_by                 uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_on_behalf_of       uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_at                 timestamptz NULL,
  decision_note              text NULL CHECK (decision_note IS NULL OR char_length(decision_note) BETWEEN 3 AND 2000),
  revoked_by                 uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  revoked_at                 timestamptz NULL,
  revoke_reason              text NULL CHECK (revoke_reason IS NULL OR char_length(revoke_reason) BETWEEN 3 AND 1000),
  expiry_notified_at         timestamptz NULL,
  version                    integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  updated_by                 uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT gate_exception_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT gate_exception_gate_instance_fkey FOREIGN KEY (transformation_id, gate_instance_id)
    REFERENCES gate_instance (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT gate_exception_decided_complete CHECK (
    (status IN ('accepted', 'rejected', 'revoked')) = (decided_at IS NOT NULL) AND (decided_at IS NULL) = (decided_by IS NULL)
    AND (decided_on_behalf_of IS NULL OR decided_by IS NOT NULL)),
  CONSTRAINT gate_exception_revoked_complete CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)
    AND (revoked_at IS NULL) = (revoked_by IS NULL) AND (revoked_at IS NULL) = (revoke_reason IS NULL)),
  CONSTRAINT gate_exception_decider_not_requester CHECK (decided_by IS NULL
    OR (decided_by <> requested_by AND decided_on_behalf_of IS DISTINCT FROM requested_by))
);
CREATE UNIQUE INDEX gate_exception_one_pending_key ON gate_exception (gate_instance_id, criterion_key) WHERE status = 'pending';
CREATE INDEX gate_exception_cover_idx ON gate_exception (gate_instance_id, criterion_key, expires_on DESC) WHERE status = 'accepted';
CREATE INDEX gate_exception_expiry_scan_idx ON gate_exception (expires_on) WHERE status = 'accepted' AND expiry_notified_at IS NULL;
CREATE FUNCTION gate_exception_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  ok boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'gate_exception: a new exception starts pending'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_exception_status_step';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM gate_instance i WHERE i.id = NEW.gate_instance_id AND i.gate_code = NEW.gate_code) THEN
      RAISE EXCEPTION 'gate_exception: gate instance % is not gate %', NEW.gate_instance_id, NEW.gate_code
        USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_exception_gate_matches';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM gate_criterion_definition c JOIN gate_definition d ON d.id = c.gate_definition_id
                   WHERE c.key = NEW.criterion_key AND d.code = NEW.gate_code AND c.mandatory) THEN
      RAISE EXCEPTION 'gate_exception: % is not a mandatory criterion of %', NEW.criterion_key, NEW.gate_code
        USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_exception_mandatory_criterion';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'decided_by', 'decided_on_behalf_of', 'decided_at', 'decision_note', 'revoked_by',
                            'revoked_at', 'revoke_reason', 'expiry_notified_at', 'version', 'updated_at', 'updated_by'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'decided_by', 'decided_on_behalf_of', 'decided_at', 'decision_note',
                            'revoked_by', 'revoked_at', 'revoke_reason', 'expiry_notified_at', 'version', 'updated_at', 'updated_by']) THEN
    RAISE EXCEPTION 'gate_exception %: reason, scope, expiry and compensating action are fixed once requested', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_exception_content_immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    ok := CASE OLD.status
            WHEN 'pending' THEN NEW.status IN ('accepted', 'rejected', 'withdrawn')
            WHEN 'accepted' THEN NEW.status = 'revoked'
            ELSE false END;
    IF NOT ok THEN
      RAISE EXCEPTION 'gate_exception: % -> % is not an allowed transition', OLD.status, NEW.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_exception_status_step';
    END IF;
  ELSIF OLD.status IN ('rejected', 'withdrawn', 'revoked')
        OR (OLD.decided_by IS DISTINCT FROM NEW.decided_by OR OLD.decided_at IS DISTINCT FROM NEW.decided_at) THEN
    RAISE EXCEPTION 'gate_exception %: the decision is final', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_exception_decision_final';
  END IF;
  IF OLD.expiry_notified_at IS NOT NULL AND NEW.expiry_notified_at IS DISTINCT FROM OLD.expiry_notified_at THEN
    RAISE EXCEPTION 'gate_exception %: the expiry notification is recorded once', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_exception_expiry_notified_once';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gate_exception_guard BEFORE INSERT OR UPDATE ON gate_exception
  FOR EACH ROW EXECUTE FUNCTION gate_exception_guard();
SELECT p2_attach_guards('gate_exception', true);
GRANT SELECT, INSERT, UPDATE ON gate_exception TO mth_app;

-- The D-089 Q2 reopen: a mandatory criterion may be frozen 'incomplete' only with an accepted exception that covers it
-- on the submission's business date; the snapshot (gate_submission.snapshot) records the exception (API). A row without
-- an exception is held to the DG2 rule exactly.
ALTER TABLE gate_submission_criterion ADD COLUMN gate_exception_id uuid NULL;
ALTER TABLE gate_submission_criterion ADD CONSTRAINT gate_submission_criterion_exception_fkey
  FOREIGN KEY (transformation_id, gate_exception_id) REFERENCES gate_exception (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE gate_submission_criterion DROP CONSTRAINT gate_submission_criterion_mandatory_complete;
ALTER TABLE gate_submission_criterion ADD CONSTRAINT gate_submission_criterion_mandatory_complete
  CHECK (NOT mandatory OR completeness = 'complete' OR gate_exception_id IS NOT NULL);
ALTER TABLE gate_submission_criterion ADD CONSTRAINT gate_submission_criterion_exception_only_incomplete
  CHECK (gate_exception_id IS NULL OR (mandatory AND completeness = 'incomplete'));
CREATE FUNCTION gate_submission_criterion_exception_valid() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  covered boolean;
BEGIN
  IF NEW.gate_exception_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM gate_exception e
    JOIN gate_submission s ON s.id = NEW.gate_submission_id
    JOIN transformation t ON t.id = s.transformation_id
    WHERE e.id = NEW.gate_exception_id AND e.status = 'accepted' AND e.gate_instance_id = s.gate_instance_id
      AND e.criterion_key = NEW.criterion_key AND e.expires_on >= (s.submitted_at AT TIME ZONE t.timezone)::date)
  INTO covered;
  IF NOT covered THEN
    RAISE EXCEPTION 'gate_submission_criterion: exception % does not cover % on the submission date (accepted, same gate, same criterion, unexpired)',
      NEW.gate_exception_id, NEW.criterion_key
      USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_submission_criterion_exception_covers';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gate_submission_criterion_exception_valid BEFORE INSERT ON gate_submission_criterion
  FOR EACH ROW EXECUTE FUNCTION gate_submission_criterion_exception_valid();

-- -----------------------------------------------------------------------------------------------------------------
-- gate_decision_scale_scope / gate_decision_condition: the approved scale scope of a G5 approval and its conditions
-- (REQ-S04-007, REQ-S12-010, M0124 "records permitted scope, conditions, owners and deadlines; it cannot authorize
-- unrestricted scaling"). Every scope item names one initiative AND one business unit, so a scope is always explicit.
-- Append-only; written in the G5 decision transaction.
CREATE FUNCTION p4_g5_approved_decision(p_gate_decision_id uuid, p_transformation_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM gate_decision g WHERE g.id = p_gate_decision_id AND g.transformation_id = p_transformation_id
                   AND g.gate_code = 'G5' AND g.outcome = 'approved')
$$;
CREATE TABLE gate_decision_scale_scope (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  gate_decision_id  uuid NOT NULL REFERENCES gate_decision (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  initiative_id     uuid NOT NULL,
  business_unit_id  uuid NOT NULL REFERENCES business_unit (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  note              text NULL CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 1000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT gate_decision_scale_scope_key UNIQUE (gate_decision_id, initiative_id, business_unit_id),
  CONSTRAINT gate_decision_scale_scope_initiative_fkey FOREIGN KEY (transformation_id, initiative_id)
    REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE gate_decision_condition (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  gate_decision_id  uuid NOT NULL REFERENCES gate_decision (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ordinal           smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 20),
  condition_text    text NOT NULL CHECK (char_length(condition_text) BETWEEN 3 AND 2000),
  owner_user_id     uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  due_date          date NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT gate_decision_condition_ordinal_key UNIQUE (gate_decision_id, ordinal)
);
CREATE FUNCTION gate_decision_scope_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT p4_g5_approved_decision(NEW.gate_decision_id, NEW.transformation_id) THEN
    RAISE EXCEPTION '%: % is not an approved G5 decision of transformation %', TG_TABLE_NAME, NEW.gate_decision_id, NEW.transformation_id
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_g5_approved';
  END IF;
  IF TG_TABLE_NAME = 'gate_decision_scale_scope' AND NOT EXISTS (
       SELECT 1 FROM business_unit b WHERE b.id = (to_jsonb(NEW)->>'business_unit_id')::uuid AND b.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'gate_decision_scale_scope: the business unit is not in the transformation''s organization'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_decision_scale_scope_business_unit_org';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gate_decision_scale_scope_guard BEFORE INSERT ON gate_decision_scale_scope
  FOR EACH ROW EXECUTE FUNCTION gate_decision_scope_guard();
CREATE TRIGGER gate_decision_condition_guard BEFORE INSERT ON gate_decision_condition
  FOR EACH ROW EXECUTE FUNCTION gate_decision_scope_guard();
SELECT p2_attach_append_only('gate_decision_scale_scope');
SELECT p2_attach_guards('gate_decision_scale_scope', true);
SELECT p2_attach_append_only('gate_decision_condition');
SELECT p2_attach_guards('gate_decision_condition', true);
GRANT SELECT, INSERT ON gate_decision_scale_scope, gate_decision_condition TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- scale_transition: scaling one initiative into one business unit (REQ-S03-004, REQ-S04-007). Only inside the scope of
-- an approved G5 decision; scaled once per initiative and business unit. Append-only.
CREATE TABLE scale_transition (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  initiative_id     uuid NOT NULL,
  business_unit_id  uuid NOT NULL REFERENCES business_unit (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  gate_decision_id  uuid NOT NULL REFERENCES gate_decision (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  note              text NULL CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000),
  transitioned_by   uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transitioned_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scale_transition_key UNIQUE (initiative_id, business_unit_id),
  CONSTRAINT scale_transition_initiative_fkey FOREIGN KEY (transformation_id, initiative_id)
    REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE FUNCTION scale_transition_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT p4_g5_approved_decision(NEW.gate_decision_id, NEW.transformation_id) THEN
    RAISE EXCEPTION 'scale_transition: scaling needs an approved G5 decision of transformation %', NEW.transformation_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'scale_transition_g5_approved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM gate_decision_scale_scope s WHERE s.gate_decision_id = NEW.gate_decision_id
                   AND s.initiative_id = NEW.initiative_id AND s.business_unit_id = NEW.business_unit_id) THEN
    RAISE EXCEPTION 'scale_transition: initiative % in business unit % is outside the approved G5 scale scope', NEW.initiative_id, NEW.business_unit_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'scale_transition_in_approved_scope';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER scale_transition_guard BEFORE INSERT ON scale_transition FOR EACH ROW EXECUTE FUNCTION scale_transition_guard();
SELECT p2_attach_append_only('scale_transition');
SELECT p2_attach_guards('scale_transition', true);
GRANT SELECT, INSERT ON scale_transition TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- risk_disposition: a proposed disposition of an open RAID risk (M0122 "resolved material risks or approved
-- dispositions"; REQ-PB-020, REQ-S04-007). Immutable; its approval is a canonical P4 approval of type
-- 'risk_disposition' whose subject is this row (ADR-0026 §4), so "approved" = an approved approval on the row.
CREATE TABLE risk_disposition (
  id                     uuid PRIMARY KEY,
  organization_id        uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id      uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  raid_entry_id          uuid NOT NULL,
  disposition            text NOT NULL CHECK (disposition IN ('accept', 'transfer', 'carry_into_bau')),
  rationale              text NOT NULL CHECK (char_length(rationale) BETWEEN 3 AND 4000),
  residual_owner_user_id uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version                integer NOT NULL DEFAULT 1 CHECK (version = 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT risk_disposition_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT risk_disposition_raid_fkey FOREIGN KEY (transformation_id, raid_entry_id)
    REFERENCES raid_entry (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX risk_disposition_raid_idx ON risk_disposition (raid_entry_id);
CREATE FUNCTION risk_disposition_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM raid_entry r WHERE r.id = NEW.raid_entry_id AND r.entry_type = 'risk' AND r.status <> 'closed') THEN
    RAISE EXCEPTION 'risk_disposition: % is not an open RAID risk', NEW.raid_entry_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'risk_disposition_open_risk';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER risk_disposition_guard BEFORE INSERT ON risk_disposition FOR EACH ROW EXECUTE FUNCTION risk_disposition_guard();
SELECT p2_attach_append_only('risk_disposition');
SELECT p2_attach_guards('risk_disposition', true);
GRANT SELECT, INSERT ON risk_disposition TO mth_app;
