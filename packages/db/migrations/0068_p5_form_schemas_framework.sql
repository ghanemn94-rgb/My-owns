-- 0068 P5 slice B: form schema versions, Studio field types, protected source columns, custom-field values and the
-- common form framework (T-DG5-ARCH-02; ADR-0041; REQ-S05-001, REQ-S05-002, REQ-S05-006, REQ-S06-005, REQ-S16-010).
-- Authored by solution-architect. Contract: docs/architecture/data-dictionary.md ("P5 tables, slice B").
-- Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged.
-- SQL floor: PostgreSQL 16. Ids come from the application; seed rows use fixed literal UUIDs.
--
-- Additive on DG2-DG4: no DG2-DG4 table, column, CHECK or trigger changes. Custom-field values live in a side table
-- (form_custom_value) keyed (record_type, record_id) instead of a custom_field_values column on each register table, so
-- the DG2-DG4 frozen-column and immutability triggers of those tables (e.g. funding_decision, evidence, decision) are
-- untouched (ADR-0041 §4; amends the ADR-0014 §4 wording, D-142 seam 5 reason). On slice A (DG5, not yet approved):
-- the methodology_element element-type CHECK is widened with 'form' and 'form_field', and methodology_element_guard()
-- is redefined with every slice A rule kept verbatim plus the form_schema rules (ADR-0041 §2).
-- Nothing here reads or writes the engineering gates DG0-DG7; no row here is a business approval.

-- -----------------------------------------------------------------------------------------------------------------
-- form_record_type: the registry of native forms (ADR-0041 §1): the sixteen templates (M0128-M0144), the source
-- deliverables (M0145-M0148), the twelve extension record types of M0149 and the product records the coverage view
-- links to. title_en of a template is VERBATIM from docs/source/playbook.md at source_ref (the source_element label);
-- title_en of an M0149 extension is VERBATIM from the M0149 list; title_ar is a PROVISIONAL translation needing review.
-- extension_badge = true exactly for the M0149 types (the playbook supplies no full template for them, REQ-S05-006).
-- Read-only for the application.
CREATE TABLE form_record_type (
  code                  text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$|^T(0[1-9]|1[0-6])$'),
  ordinal               smallint NOT NULL CONSTRAINT form_record_type_ordinal_key UNIQUE CHECK (ordinal BETWEEN 1 AND 99),
  kind                  text NOT NULL CHECK (kind IN ('template', 'source_deliverable', 'extension', 'product')),
  title_en              text NOT NULL CHECK (char_length(title_en) BETWEEN 1 AND 200),
  title_ar              text NOT NULL CHECK (char_length(title_ar) BETWEEN 1 AND 200),
  source_ref            text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 50),
  table_name            text NULL CHECK (table_name IS NULL OR table_name ~ '^[a-z][a-z0-9_]{1,62}$'),
  discriminator_column  text NULL CHECK (discriminator_column IS NULL OR discriminator_column ~ '^[a-z][a-z0-9_]{1,62}$'),
  discriminator_value   text NULL CHECK (discriminator_value IS NULL OR char_length(discriminator_value) BETWEEN 1 AND 50),
  write_permission_code text NULL REFERENCES permission (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  extension_badge       boolean NOT NULL,
  custom_fields_allowed boolean NOT NULL,
  bulk_edit_allowed     boolean NOT NULL,
  feature_status        text NOT NULL CHECK (feature_status IN ('working', 'planned')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT form_record_type_badge_is_extension CHECK (extension_badge = (kind = 'extension')),
  CONSTRAINT form_record_type_discriminator_complete CHECK ((discriminator_column IS NULL) = (discriminator_value IS NULL)),
  CONSTRAINT form_record_type_storage_complete
    CHECK ((table_name IS NULL) = (feature_status = 'planned') AND (table_name IS NOT NULL OR NOT custom_fields_allowed)
           AND (NOT custom_fields_allowed OR write_permission_code IS NOT NULL)),
  CONSTRAINT form_record_type_template_code CHECK ((kind = 'template') = (code ~ '^T(0[1-9]|1[0-6])$'))
);
GRANT SELECT ON form_record_type TO mth_app;

INSERT INTO form_record_type (code, ordinal, kind, title_en, title_ar, source_ref, table_name, discriminator_column,
                              discriminator_value, write_permission_code, extension_badge, custom_fields_allowed,
                              bulk_edit_allowed, feature_status) VALUES
  ('T01', 1, 'template', 'Template 1 — Current-State Diagnostic', 'النموذج 1 — تشخيص الوضع الحالي', 'B0030', 'diagnostic_item', NULL, NULL, 'diagnostic.edit', false, true, true, 'working'),
  ('T02', 2, 'template', 'Template 2 — Outcome & KPI Tree', 'النموذج 2 — شجرة النتائج ومؤشرات الأداء', 'B0049', 'outcome', NULL, NULL, 'outcome.edit', false, true, true, 'working'),
  ('T03', 3, 'template', 'Template 3 — TOM Gap Matrix', 'النموذج 3 — مصفوفة فجوات نموذج التشغيل المستهدف', 'B0057', 'tom_gap', NULL, NULL, 'tom.edit', false, true, true, 'working'),
  ('T04', 4, 'template', 'Template 4 — Design Decision Log', 'النموذج 4 — سجل قرارات التصميم', 'B0064', 'decision', 'kind', 'design', 'decision.edit', false, true, true, 'working'),
  ('T05', 5, 'template', 'Template 5 — Initiative Card', 'النموذج 5 — بطاقة المبادرة', 'B0071', 'initiative', NULL, NULL, 'initiative.edit', false, true, true, 'working'),
  ('T06', 6, 'template', 'Template 6 — Prioritization Scorecard', 'النموذج 6 — بطاقة تحديد الأولويات', 'B0075', 'initiative_score', NULL, NULL, 'prioritization.score', false, true, false, 'working'),
  ('T07', 7, 'template', 'Template 7 — Wave Roadmap', 'النموذج 7 — خارطة طريق الموجات', 'B0078', 'roadmap_wave', NULL, NULL, 'roadmap.edit', false, true, true, 'working'),
  ('T08', 8, 'template', 'Template 8 — Dependency Map', 'النموذج 8 — خريطة الاعتماديات', 'B0080', 'dependency', NULL, NULL, 'dependency.edit', false, true, true, 'working'),
  ('T09', 9, 'template', 'Template 9 — Benefit Formula', 'النموذج 9 — معادلة المنفعة', 'B0086', 'benefit_formula', NULL, NULL, 'benefit_formula.edit', false, true, false, 'working'),
  ('T11', 11, 'template', 'Template 11 — Decision Rights Matrix', 'النموذج 11 — مصفوفة صلاحيات القرار', 'B0098', 'transformation_decision_right', NULL, NULL, 'decision_right.configure', false, true, false, 'working'),
  ('T12', 12, 'template', 'Template 12 — RACI', 'النموذج 12 — مصفوفة المسؤوليات', 'B0100', 'transformation_raci_deliverable', NULL, NULL, 'raci.edit', false, true, false, 'working'),
  ('T13', 13, 'template', 'Template 13 — Stakeholder & Adoption Plan', 'النموذج 13 — خطة أصحاب المصلحة والتبنّي', 'B0106', 'stakeholder_group', NULL, NULL, 'adoption.edit', false, true, true, 'working'),
  ('T14', 14, 'template', 'Template 14 — Benefits Register', 'النموذج 14 — سجل المنافع', 'B0122', 'benefit', NULL, NULL, 'benefit.edit', false, true, true, 'working'),
  ('T15', 15, 'template', 'Template 15 — RAID', 'النموذج 15 — سجل المخاطر والافتراضات والقضايا والاعتماديات', 'B0127', 'raid_entry', NULL, NULL, 'raid.edit', false, true, true, 'working'),
  ('T16', 16, 'template', 'Template 16 — Executive Decision Log', 'النموذج 16 — سجل القرارات التنفيذية', 'B0129', 'decision', 'kind', 'executive', 'executive_decision.create', false, true, true, 'working'),
  ('charter', 20, 'source_deliverable', 'Transformation Charter', 'ميثاق التحول (ترجمة مؤقتة)', 'M0146', 'charter', NULL, NULL, 'charter.edit', false, true, false, 'working'),
  ('tom_canvas', 21, 'source_deliverable', 'Target Operating Model Canvas', 'لوحة نموذج التشغيل المستهدف (ترجمة مؤقتة)', 'M0147', 'tom_canvas_cell', NULL, NULL, 'tom.edit', false, true, false, 'working'),
  ('business_case', 22, 'source_deliverable', 'Transformation Business Case', 'دراسة جدوى التحول (ترجمة مؤقتة)', 'M0148', 'business_case', NULL, NULL, 'business_case.edit', false, true, false, 'working'),
  ('evidence', 30, 'extension', 'Structured evidence', 'الأدلة المنظمة (ترجمة مؤقتة)', 'M0149', 'evidence', NULL, NULL, 'evidence.create', true, true, false, 'working'),
  ('baseline', 31, 'extension', 'Baseline registry', 'سجل خطوط الأساس (ترجمة مؤقتة)', 'M0149', 'baseline', NULL, NULL, 'baseline.edit', true, true, true, 'working'),
  ('value_pool', 32, 'extension', 'Value-pool register', 'سجل مجمعات القيمة (ترجمة مؤقتة)', 'M0149', 'value_pool', NULL, NULL, 'diagnostic.edit', true, true, true, 'working'),
  ('resource_plan', 33, 'extension', 'Resource/capacity plan', 'خطة الموارد والطاقة الاستيعابية (ترجمة مؤقتة)', 'M0149', 'resource_demand', NULL, NULL, 'capacity.edit', true, true, true, 'working'),
  ('funding_approval', 34, 'extension', 'Funding approvals', 'اعتمادات التمويل (ترجمة مؤقتة)', 'M0149', 'funding_decision', NULL, NULL, 'funding.approve', true, true, false, 'working'),
  ('procedure_definition', 35, 'extension', 'Process/procedure definitions', 'تعريفات العمليات والإجراءات (ترجمة مؤقتة)', 'M0149', 'procedure_definition', NULL, NULL, 'methodology.configure', true, false, false, 'working'),
  ('change_request', 36, 'extension', 'Change requests', 'طلبات التغيير (ترجمة مؤقتة)', 'M0149', 'change_request', NULL, NULL, 'change_request.raise', true, true, false, 'working'),
  ('meeting_record', 37, 'extension', 'Meeting records', 'سجلات الاجتماعات (ترجمة مؤقتة)', 'M0149', 'meeting', NULL, NULL, 'meeting.prepare', true, true, false, 'working'),
  ('corrective_plan', 38, 'extension', 'Corrective plans', 'الخطط التصحيحية (ترجمة مؤقتة)', 'M0149', 'corrective_case', NULL, NULL, 'corrective_action.manage', true, true, true, 'working'),
  ('lesson', 39, 'extension', 'Lessons learned', 'الدروس المستفادة (ترجمة مؤقتة)', 'M0149', 'lesson', NULL, NULL, 'lesson.edit', true, true, false, 'working'),
  ('bau_handover', 40, 'extension', 'BAU handover', 'التسليم للعمليات الاعتيادية (ترجمة مؤقتة)', 'M0149', 'bau_handover', NULL, NULL, 'bau_handover.prepare', true, true, false, 'working'),
  ('control', 41, 'extension', 'Controls', 'الضوابط (ترجمة مؤقتة)', 'M0149', 'control', NULL, NULL, 'control.manage', true, true, true, 'working'),
  ('phase_step', 50, 'product', 'Phase steps', 'خطوات المرحلة (ترجمة مؤقتة)', 'M0118', 'phase_step', NULL, NULL, 'phase_step.manage', false, false, false, 'working'),
  ('launch_plan', 51, 'product', '90-day launch plan', 'خطة الإطلاق لمدة 90 يوماً (ترجمة مؤقتة)', 'B0134', NULL, NULL, NULL, NULL, false, false, false, 'planned'),
  ('health_assessment', 52, 'product', 'Transformation health check', 'فحص صحة التحول (ترجمة مؤقتة)', 'B0150', NULL, NULL, NULL, NULL, false, false, false, 'planned');

-- -----------------------------------------------------------------------------------------------------------------
-- form_source_field: the protected source columns (REQ-S05-002, M0127 "Preserve all source columns below"): one row
-- per minimum field of M0129-M0144 (T10 is the dashboard read model of slice F and has no form), with label_en VERBATIM
-- from the master prompt row at source_ref, a PROVISIONAL Arabic label, its Studio field type (fixed: an admin can
-- relabel and add help, never delete the column or change its type semantics) and where the platform stores it:
-- 'column' = one typed column table.column (the probe checks it exists), 'composite' = several typed columns or
-- related rows, 'computed' = calculated by a DG2-DG4 engine. Read-only for the application.
CREATE TABLE form_source_field (
  id             uuid PRIMARY KEY,
  record_type    text NOT NULL REFERENCES form_record_type (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  field_key      text NOT NULL CHECK (field_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  ordinal        smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 99),
  label_en       text NOT NULL CHECK (char_length(label_en) BETWEEN 1 AND 200),
  label_ar       text NOT NULL CHECK (char_length(label_ar) BETWEEN 1 AND 200),
  field_type     text NOT NULL CHECK (field_type IN ('text', 'rich_text', 'number', 'currency', 'percentage', 'date',
                                                     'reference', 'attachment', 'lookup', 'choice', 'calculated')),
  storage_kind   text NOT NULL CHECK (storage_kind IN ('column', 'composite', 'computed')),
  storage_ref    text NOT NULL CHECK (char_length(storage_ref) BETWEEN 1 AND 200),
  bulk_editable  boolean NOT NULL DEFAULT false,
  source_ref     text NOT NULL CHECK (source_ref ~ '^M01(29|3[0-9]|4[0-4])$'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT form_source_field_key UNIQUE (record_type, field_key),
  CONSTRAINT form_source_field_ordinal_key UNIQUE (record_type, ordinal),
  CONSTRAINT form_source_field_column_ref CHECK (storage_kind <> 'column' OR storage_ref ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  CONSTRAINT form_source_field_bulk_column CHECK (NOT bulk_editable OR storage_kind = 'column')
);
GRANT SELECT ON form_source_field TO mth_app;

INSERT INTO form_source_field (id, record_type, field_key, ordinal, label_en, label_ar, field_type, storage_kind, storage_ref, bulk_editable, source_ref) VALUES
  -- T01 (M0129): Dimension, current state, evidence/baseline, root cause, impact, confidence H/M/L
  ('01920005-0201-7000-8000-000000000001', 'T01', 'dimension', 1, 'Dimension', 'البُعد', 'lookup', 'column', 'diagnostic_item.dimension_code', false, 'M0129'),
  ('01920005-0201-7000-8000-000000000002', 'T01', 'current_state', 2, 'current state', 'الوضع الحالي', 'rich_text', 'column', 'diagnostic_item.current_state', false, 'M0129'),
  ('01920005-0201-7000-8000-000000000003', 'T01', 'evidence_baseline', 3, 'evidence/baseline', 'الدليل/خط الأساس', 'text', 'composite', 'diagnostic_item.evidence_baseline, diagnostic_item.baseline_id', false, 'M0129'),
  ('01920005-0201-7000-8000-000000000004', 'T01', 'root_cause', 4, 'root cause', 'السبب الجذري', 'rich_text', 'column', 'diagnostic_item.root_cause', false, 'M0129'),
  ('01920005-0201-7000-8000-000000000005', 'T01', 'impact', 5, 'impact', 'الأثر', 'text', 'composite', 'diagnostic_item.impact_text, impact_amount, impact_currency, impact_kpi_definition_id', false, 'M0129'),
  ('01920005-0201-7000-8000-000000000006', 'T01', 'confidence', 6, 'confidence H/M/L', 'مستوى الثقة مرتفع/متوسط/منخفض', 'choice', 'column', 'diagnostic_item.confidence', true, 'M0129'),
  -- T02 (M0130): Outcome, KPI, baseline, target, target date, owner, leading indicator
  ('01920005-0202-7000-8000-000000000001', 'T02', 'outcome', 1, 'Outcome', 'النتيجة', 'text', 'column', 'outcome.statement', false, 'M0130'),
  ('01920005-0202-7000-8000-000000000002', 'T02', 'kpi', 2, 'KPI', 'مؤشر الأداء', 'reference', 'composite', 'outcome_kpi -> kpi_definition', false, 'M0130'),
  ('01920005-0202-7000-8000-000000000003', 'T02', 'baseline', 3, 'baseline', 'خط الأساس', 'reference', 'composite', 'kpi_definition -> baseline', false, 'M0130'),
  ('01920005-0202-7000-8000-000000000004', 'T02', 'target', 4, 'target', 'المستهدف', 'number', 'composite', 'target_trajectory, target_trajectory_point', false, 'M0130'),
  ('01920005-0202-7000-8000-000000000005', 'T02', 'target_date', 5, 'target date', 'تاريخ المستهدف', 'date', 'composite', 'target_trajectory_point', false, 'M0130'),
  ('01920005-0202-7000-8000-000000000006', 'T02', 'owner', 6, 'owner', 'المالك', 'reference', 'column', 'outcome.owner_user_id', true, 'M0130'),
  ('01920005-0202-7000-8000-000000000007', 'T02', 'leading_indicator', 7, 'leading indicator', 'مؤشر استباقي', 'choice', 'composite', 'kpi_definition.is_leading', false, 'M0130'),
  -- T03 (M0131): TOM dimension, current state, target state, gap, design decision, owner
  ('01920005-0203-7000-8000-000000000001', 'T03', 'tom_dimension', 1, 'TOM dimension', 'بُعد نموذج التشغيل المستهدف', 'lookup', 'column', 'tom_gap.dimension_code', false, 'M0131'),
  ('01920005-0203-7000-8000-000000000002', 'T03', 'current_state', 2, 'current state', 'الوضع الحالي', 'rich_text', 'column', 'tom_gap.current_state', false, 'M0131'),
  ('01920005-0203-7000-8000-000000000003', 'T03', 'target_state', 3, 'target state', 'الوضع المستهدف', 'rich_text', 'column', 'tom_gap.target_state', false, 'M0131'),
  ('01920005-0203-7000-8000-000000000004', 'T03', 'gap', 4, 'gap', 'الفجوة', 'rich_text', 'column', 'tom_gap.gap', false, 'M0131'),
  ('01920005-0203-7000-8000-000000000005', 'T03', 'design_decision', 5, 'design decision', 'قرار التصميم', 'reference', 'column', 'tom_gap.design_decision_id', false, 'M0131'),
  ('01920005-0203-7000-8000-000000000006', 'T03', 'owner', 6, 'owner', 'المالك', 'reference', 'column', 'tom_gap.owner_user_id', true, 'M0131'),
  -- T04 (M0132): ID, decision required, options, recommendation, decision owner, due date, status
  ('01920005-0204-7000-8000-000000000001', 'T04', 'id', 1, 'ID', 'المعرّف', 'text', 'column', 'decision.code', false, 'M0132'),
  ('01920005-0204-7000-8000-000000000002', 'T04', 'decision_required', 2, 'decision required', 'القرار المطلوب', 'text', 'column', 'decision.title', false, 'M0132'),
  ('01920005-0204-7000-8000-000000000003', 'T04', 'options', 3, 'options', 'الخيارات', 'text', 'composite', 'decision_option', false, 'M0132'),
  ('01920005-0204-7000-8000-000000000004', 'T04', 'recommendation', 4, 'recommendation', 'التوصية', 'rich_text', 'composite', 'decision.recommendation_option_id, decision.recommendation_text', false, 'M0132'),
  ('01920005-0204-7000-8000-000000000005', 'T04', 'decision_owner', 5, 'decision owner', 'مالك القرار', 'reference', 'column', 'decision.owner_user_id', true, 'M0132'),
  ('01920005-0204-7000-8000-000000000006', 'T04', 'due_date', 6, 'due date', 'تاريخ الاستحقاق', 'date', 'column', 'decision.due_date', true, 'M0132'),
  ('01920005-0204-7000-8000-000000000007', 'T04', 'status', 7, 'status', 'الحالة', 'choice', 'column', 'decision.status', false, 'M0132'),
  -- T05 (M0133)
  ('01920005-0205-7000-8000-000000000001', 'T05', 'initiative_name', 1, 'Initiative name', 'اسم المبادرة', 'text', 'column', 'initiative.name', false, 'M0133'),
  ('01920005-0205-7000-8000-000000000002', 'T05', 'executive_owner', 2, 'executive owner', 'المالك التنفيذي', 'reference', 'column', 'initiative.executive_owner_user_id', true, 'M0133'),
  ('01920005-0205-7000-8000-000000000003', 'T05', 'workstream_lead', 3, 'workstream lead', 'قائد مسار العمل', 'reference', 'column', 'initiative.workstream_lead_user_id', true, 'M0133'),
  ('01920005-0205-7000-8000-000000000004', 'T05', 'problem_gap_addressed', 4, 'problem/gap addressed', 'المشكلة/الفجوة المعالجة', 'rich_text', 'composite', 'initiative.problem_statement, initiative_gap_link', false, 'M0133'),
  ('01920005-0205-7000-8000-000000000005', 'T05', 'objective', 5, 'objective', 'الهدف', 'rich_text', 'column', 'initiative.objective', false, 'M0133'),
  ('01920005-0205-7000-8000-000000000006', 'T05', 'scope_in_out', 6, 'scope in/out', 'النطاق داخل/خارج', 'rich_text', 'composite', 'initiative.scope_in, initiative.scope_out', false, 'M0133'),
  ('01920005-0205-7000-8000-000000000007', 'T05', 'key_deliverables', 7, 'key deliverables', 'المخرجات الرئيسية', 'reference', 'composite', 'deliverable', false, 'M0133'),
  ('01920005-0205-7000-8000-000000000008', 'T05', 'outcome_kpi_contribution', 8, 'outcome/KPI contribution', 'المساهمة في النتائج/المؤشرات', 'reference', 'composite', 'initiative_outcome_contribution', false, 'M0133'),
  ('01920005-0205-7000-8000-000000000009', 'T05', 'financial_benefit', 9, 'financial benefit', 'المنفعة المالية', 'rich_text', 'column', 'initiative.financial_benefit_summary', false, 'M0133'),
  ('01920005-0205-7000-8000-00000000000a', 'T05', 'customer_benefit', 10, 'customer benefit', 'منفعة العميل', 'rich_text', 'column', 'initiative.customer_benefit_summary', false, 'M0133'),
  ('01920005-0205-7000-8000-00000000000b', 'T05', 'dependencies', 11, 'dependencies', 'الاعتماديات', 'reference', 'composite', 'dependency (from_initiative_id, to_initiative_id)', false, 'M0133'),
  ('01920005-0205-7000-8000-00000000000c', 'T05', 'risks', 12, 'risks', 'المخاطر', 'rich_text', 'column', 'initiative.risks_summary', false, 'M0133'),
  ('01920005-0205-7000-8000-00000000000d', 'T05', 'milestones', 13, 'milestones', 'المعالم الرئيسية', 'reference', 'composite', 'milestone', false, 'M0133'),
  ('01920005-0205-7000-8000-00000000000e', 'T05', 'required_decisions', 14, 'required decisions', 'القرارات المطلوبة', 'reference', 'composite', 'initiative_decision_link', false, 'M0133'),
  -- T06 (M0134): Initiative; 1–5 scores for strategic fit, financial value, customer impact, feasibility and time-to-value; weights and weighted result
  ('01920005-0206-7000-8000-000000000001', 'T06', 'initiative', 1, 'Initiative', 'المبادرة', 'reference', 'column', 'initiative_score.initiative_id', false, 'M0134'),
  ('01920005-0206-7000-8000-000000000002', 'T06', 'scores', 2, '1–5 scores for strategic fit, financial value, customer impact, feasibility and time-to-value', 'درجات من 1 إلى 5 للملاءمة الاستراتيجية والقيمة المالية والأثر على العملاء وقابلية التنفيذ وسرعة تحقيق القيمة', 'number', 'composite', 'initiative_score.criterion_code, initiative_score.score', false, 'M0134'),
  ('01920005-0206-7000-8000-000000000003', 'T06', 'weights', 3, 'weights', 'الأوزان', 'percentage', 'composite', 'scoring_weight_set, scoring_weight', false, 'M0134'),
  ('01920005-0206-7000-8000-000000000004', 'T06', 'weighted_result', 4, 'weighted result', 'النتيجة المرجّحة', 'calculated', 'computed', 'initiative_score_result (DG3 scoring engine)', false, 'M0134'),
  -- T07 (M0135): Wave, purpose, typical horizon, entry criteria, exit evidence; linked initiatives, dates and milestones
  ('01920005-0207-7000-8000-000000000001', 'T07', 'wave', 1, 'Wave', 'الموجة', 'text', 'column', 'roadmap_wave.name_en', false, 'M0135'),
  ('01920005-0207-7000-8000-000000000002', 'T07', 'purpose', 2, 'purpose', 'الغرض', 'rich_text', 'column', 'roadmap_wave.purpose_en', false, 'M0135'),
  ('01920005-0207-7000-8000-000000000003', 'T07', 'typical_horizon', 3, 'typical horizon', 'الأفق الزمني المعتاد', 'text', 'composite', 'roadmap_wave.horizon_en, horizon_from_weeks, horizon_to_weeks', false, 'M0135'),
  ('01920005-0207-7000-8000-000000000004', 'T07', 'entry_criteria', 4, 'entry criteria', 'معايير الدخول', 'rich_text', 'column', 'roadmap_wave.entry_criteria_en', false, 'M0135'),
  ('01920005-0207-7000-8000-000000000005', 'T07', 'exit_evidence', 5, 'exit evidence', 'أدلة الخروج', 'rich_text', 'column', 'roadmap_wave.exit_evidence_en', false, 'M0135'),
  ('01920005-0207-7000-8000-000000000006', 'T07', 'linked_initiatives_dates_milestones', 6, 'linked initiatives, dates and milestones', 'المبادرات والتواريخ والمعالم المرتبطة', 'reference', 'composite', 'initiative.wave_id, roadmap_wave.planned_start, planned_end, milestone', false, 'M0135'),
  -- T08 (M0136): Dependency, from, to, type, needed-by date, owner, status/mitigation
  ('01920005-0208-7000-8000-000000000001', 'T08', 'dependency', 1, 'Dependency', 'الاعتمادية', 'text', 'column', 'dependency.description', false, 'M0136'),
  ('01920005-0208-7000-8000-000000000002', 'T08', 'from', 2, 'from', 'من', 'reference', 'composite', 'dependency.from_kind, from_label, from_initiative_id', false, 'M0136'),
  ('01920005-0208-7000-8000-000000000003', 'T08', 'to', 3, 'to', 'إلى', 'reference', 'composite', 'dependency.to_kind, to_label, to_initiative_id', false, 'M0136'),
  ('01920005-0208-7000-8000-000000000004', 'T08', 'type', 4, 'type', 'النوع', 'lookup', 'column', 'dependency.dependency_type', false, 'M0136'),
  ('01920005-0208-7000-8000-000000000005', 'T08', 'needed_by_date', 5, 'needed-by date', 'التاريخ المطلوب', 'date', 'column', 'dependency.needed_by', true, 'M0136'),
  ('01920005-0208-7000-8000-000000000006', 'T08', 'owner', 6, 'owner', 'المالك', 'reference', 'column', 'dependency.owner_user_id', true, 'M0136'),
  ('01920005-0208-7000-8000-000000000007', 'T08', 'status_mitigation', 7, 'status/mitigation', 'الحالة/المعالجة', 'text', 'composite', 'dependency.status, dependency.mitigation', false, 'M0136'),
  -- T09 (M0137): Benefit, baseline driver, change assumption, formula, ramp, confidence H/M/L
  ('01920005-0209-7000-8000-000000000001', 'T09', 'benefit', 1, 'Benefit', 'المنفعة', 'text', 'column', 'benefit_formula.benefit_name', false, 'M0137'),
  ('01920005-0209-7000-8000-000000000002', 'T09', 'baseline_driver', 2, 'baseline driver', 'محرك خط الأساس', 'text', 'column', 'benefit_formula.baseline_driver', false, 'M0137'),
  ('01920005-0209-7000-8000-000000000003', 'T09', 'change_assumption', 3, 'change assumption', 'افتراض التغيير', 'text', 'column', 'benefit_formula.change_assumption', false, 'M0137'),
  ('01920005-0209-7000-8000-000000000004', 'T09', 'formula', 4, 'formula', 'المعادلة', 'calculated', 'computed', 'benefit_formula_version (DG3 formula engine)', false, 'M0137'),
  ('01920005-0209-7000-8000-000000000005', 'T09', 'ramp', 5, 'ramp', 'منحنى التدرج', 'text', 'column', 'benefit_formula.ramp', false, 'M0137'),
  ('01920005-0209-7000-8000-000000000006', 'T09', 'confidence', 6, 'confidence H/M/L', 'مستوى الثقة مرتفع/متوسط/منخفض', 'choice', 'column', 'benefit_formula.confidence', false, 'M0137'),
  -- T11 (M0139): Decision, Recommend, Approve, Consult, Inform, SLA
  ('01920005-020b-7000-8000-000000000001', 'T11', 'decision', 1, 'Decision', 'القرار', 'text', 'column', 'transformation_decision_right.decision_en', false, 'M0139'),
  ('01920005-020b-7000-8000-000000000002', 'T11', 'recommend', 2, 'Recommend', 'يوصي', 'lookup', 'column', 'transformation_decision_right.recommend_parties', false, 'M0139'),
  ('01920005-020b-7000-8000-000000000003', 'T11', 'approve', 3, 'Approve', 'يعتمد', 'lookup', 'column', 'transformation_decision_right.approve_party_code', false, 'M0139'),
  ('01920005-020b-7000-8000-000000000004', 'T11', 'consult', 4, 'Consult', 'يُستشار', 'lookup', 'column', 'transformation_decision_right.consult_parties', false, 'M0139'),
  ('01920005-020b-7000-8000-000000000005', 'T11', 'inform', 5, 'Inform', 'يُبلَّغ', 'lookup', 'column', 'transformation_decision_right.inform_parties', false, 'M0139'),
  ('01920005-020b-7000-8000-000000000006', 'T11', 'sla', 6, 'SLA', 'اتفاقية مستوى الخدمة', 'number', 'composite', 'transformation_decision_right.sla_type, sla_working_days, urgent_working_days', false, 'M0139'),
  -- T12 (M0140): Deliverable, Sponsor, Transformation Lead, Business Owner, Workstream Lead, Finance, Tech/Data
  ('01920005-020c-7000-8000-000000000001', 'T12', 'deliverable', 1, 'Deliverable', 'المُخرَج', 'text', 'column', 'transformation_raci_deliverable.label_en', false, 'M0140'),
  ('01920005-020c-7000-8000-000000000002', 'T12', 'sponsor', 2, 'Sponsor', 'الراعي', 'choice', 'composite', 'transformation_raci_assignment (party SP)', false, 'M0140'),
  ('01920005-020c-7000-8000-000000000003', 'T12', 'transformation_lead', 3, 'Transformation Lead', 'قائد التحول', 'choice', 'composite', 'transformation_raci_assignment (party TL)', false, 'M0140'),
  ('01920005-020c-7000-8000-000000000004', 'T12', 'business_owner', 4, 'Business Owner', 'مالك الأعمال', 'choice', 'composite', 'transformation_raci_assignment (party BO)', false, 'M0140'),
  ('01920005-020c-7000-8000-000000000005', 'T12', 'workstream_lead', 5, 'Workstream Lead', 'قائد مسار العمل', 'choice', 'composite', 'transformation_raci_assignment (party WL)', false, 'M0140'),
  ('01920005-020c-7000-8000-000000000006', 'T12', 'finance', 6, 'Finance', 'المالية', 'choice', 'composite', 'transformation_raci_assignment (party FIN)', false, 'M0140'),
  ('01920005-020c-7000-8000-000000000007', 'T12', 'tech_data', 7, 'Tech/Data', 'التقنية/البيانات', 'choice', 'composite', 'transformation_raci_assignment (party TD)', false, 'M0140'),
  -- T13 (M0141)
  ('01920005-020d-7000-8000-000000000001', 'T13', 'stakeholder_group', 1, 'Stakeholder/group', 'صاحب المصلحة/المجموعة', 'text', 'column', 'stakeholder_group.name', false, 'M0141'),
  ('01920005-020d-7000-8000-000000000002', 'T13', 'impact', 2, 'impact H/M/L', 'الأثر مرتفع/متوسط/منخفض', 'choice', 'column', 'stakeholder_group.impact', true, 'M0141'),
  ('01920005-020d-7000-8000-000000000003', 'T13', 'current_stance', 3, 'current stance Support/Neutral/Resist', 'الموقف الحالي داعم/محايد/مقاوم', 'choice', 'column', 'stakeholder_group.current_stance', true, 'M0141'),
  ('01920005-020d-7000-8000-000000000004', 'T13', 'required_behavior', 4, 'required behavior', 'السلوك المطلوب', 'rich_text', 'column', 'stakeholder_group.required_behavior', false, 'M0141'),
  ('01920005-020d-7000-8000-000000000005', 'T13', 'intervention', 5, 'intervention', 'التدخل', 'rich_text', 'composite', 'stakeholder_group.intervention_types, intervention_plan, adoption_intervention', false, 'M0141'),
  ('01920005-020d-7000-8000-000000000006', 'T13', 'owner', 6, 'owner', 'المالك', 'reference', 'column', 'stakeholder_group.owner_user_id', true, 'M0141'),
  ('01920005-020d-7000-8000-000000000007', 'T13', 'adoption_kpi', 7, 'adoption KPI', 'مؤشر التبنّي', 'reference', 'column', 'stakeholder_group.adoption_kpi_definition_id', false, 'M0141'),
  -- T14 (M0142): ID, benefit, type, baseline, target, value SAR, realized, owner, evidence, status
  ('01920005-020e-7000-8000-000000000001', 'T14', 'id', 1, 'ID', 'المعرّف', 'text', 'column', 'benefit.code', false, 'M0142'),
  ('01920005-020e-7000-8000-000000000002', 'T14', 'benefit', 2, 'benefit', 'المنفعة', 'text', 'column', 'benefit.title', false, 'M0142'),
  ('01920005-020e-7000-8000-000000000003', 'T14', 'type', 3, 'type', 'النوع', 'choice', 'column', 'benefit.benefit_type', false, 'M0142'),
  ('01920005-020e-7000-8000-000000000004', 'T14', 'baseline', 4, 'baseline', 'خط الأساس', 'number', 'composite', 'benefit.baseline_value, baseline_unit, baseline_id', false, 'M0142'),
  ('01920005-020e-7000-8000-000000000005', 'T14', 'target', 5, 'target', 'المستهدف', 'number', 'column', 'benefit.target_value', false, 'M0142'),
  ('01920005-020e-7000-8000-000000000006', 'T14', 'value_sar', 6, 'value SAR', 'القيمة بالريال السعودي', 'currency', 'composite', 'benefit.planned_value, benefit.currency', false, 'M0142'),
  ('01920005-020e-7000-8000-000000000007', 'T14', 'realized', 7, 'realized', 'المُحقَّق', 'calculated', 'computed', 'benefit_measurement (DG4 realized value)', false, 'M0142'),
  ('01920005-020e-7000-8000-000000000008', 'T14', 'owner', 8, 'owner', 'المالك', 'reference', 'column', 'benefit.owner_user_id', true, 'M0142'),
  ('01920005-020e-7000-8000-000000000009', 'T14', 'evidence', 9, 'evidence', 'الدليل', 'attachment', 'composite', 'benefit_evidence', false, 'M0142'),
  ('01920005-020e-7000-8000-00000000000a', 'T14', 'status', 10, 'status', 'الحالة', 'choice', 'composite', 'benefit.status, benefit.status_rag', false, 'M0142'),
  -- T15 (M0143)
  ('01920005-020f-7000-8000-000000000001', 'T15', 'id', 1, 'ID', 'المعرّف', 'text', 'column', 'raid_entry.code', false, 'M0143'),
  ('01920005-020f-7000-8000-000000000002', 'T15', 'type', 2, 'type Risk/Assumption/Issue/Dependency', 'النوع خطر/افتراض/قضية/اعتمادية', 'choice', 'column', 'raid_entry.entry_type', false, 'M0143'),
  ('01920005-020f-7000-8000-000000000003', 'T15', 'description', 3, 'description', 'الوصف', 'rich_text', 'column', 'raid_entry.description', false, 'M0143'),
  ('01920005-020f-7000-8000-000000000004', 'T15', 'impact', 4, 'impact', 'الأثر', 'choice', 'column', 'raid_entry.impact', true, 'M0143'),
  ('01920005-020f-7000-8000-000000000005', 'T15', 'probability', 5, 'probability where applicable', 'الاحتمالية حيثما ينطبق', 'choice', 'column', 'raid_entry.probability', true, 'M0143'),
  ('01920005-020f-7000-8000-000000000006', 'T15', 'owner', 6, 'owner', 'المالك', 'reference', 'column', 'raid_entry.owner_user_id', true, 'M0143'),
  ('01920005-020f-7000-8000-000000000007', 'T15', 'due_date', 7, 'due date', 'تاريخ الاستحقاق', 'date', 'column', 'raid_entry.due_date', true, 'M0143'),
  ('01920005-020f-7000-8000-000000000008', 'T15', 'mitigation_action', 8, 'mitigation/action', 'المعالجة/الإجراء', 'rich_text', 'column', 'raid_entry.mitigation', false, 'M0143'),
  ('01920005-020f-7000-8000-000000000009', 'T15', 'status', 9, 'status', 'الحالة', 'choice', 'column', 'raid_entry.status', false, 'M0143'),
  -- T16 (M0144): ID, decision, why now, options, recommendation, owner, decision date, impact if delayed, outcome
  ('01920005-0210-7000-8000-000000000001', 'T16', 'id', 1, 'ID', 'المعرّف', 'text', 'column', 'decision.code', false, 'M0144'),
  ('01920005-0210-7000-8000-000000000002', 'T16', 'decision', 2, 'decision', 'القرار', 'text', 'column', 'decision.title', false, 'M0144'),
  ('01920005-0210-7000-8000-000000000003', 'T16', 'why_now', 3, 'why now', 'لماذا الآن', 'rich_text', 'column', 'decision.why_now', false, 'M0144'),
  ('01920005-0210-7000-8000-000000000004', 'T16', 'options', 4, 'options', 'الخيارات', 'text', 'composite', 'decision_option', false, 'M0144'),
  ('01920005-0210-7000-8000-000000000005', 'T16', 'recommendation', 5, 'recommendation', 'التوصية', 'rich_text', 'composite', 'decision.recommendation_option_id, decision.recommendation_text', false, 'M0144'),
  ('01920005-0210-7000-8000-000000000006', 'T16', 'owner', 6, 'owner', 'المالك', 'reference', 'column', 'decision.owner_user_id', true, 'M0144'),
  ('01920005-0210-7000-8000-000000000007', 'T16', 'decision_date', 7, 'decision date', 'تاريخ القرار', 'date', 'column', 'decision.decided_at', false, 'M0144'),
  ('01920005-0210-7000-8000-000000000008', 'T16', 'impact_if_delayed', 8, 'impact if delayed', 'الأثر في حال التأخير', 'rich_text', 'column', 'decision.impact_of_delay', false, 'M0144'),
  ('01920005-0210-7000-8000-000000000009', 'T16', 'outcome', 9, 'outcome', 'النتيجة', 'rich_text', 'column', 'decision.outcome_text', false, 'M0144');

-- -----------------------------------------------------------------------------------------------------------------
-- methodology_element: the form_schema kind gets two element types (ADR-0041 §2): 'form' (stable key = a
-- form_record_type code; form-level label and help) and 'form_field' (stable key '<recordType>.<fieldKey>'; origin
-- 'source' = a protected source column of form_source_field, origin 'admin' = an extension field).
ALTER TABLE methodology_element DROP CONSTRAINT methodology_element_element_type_check;
ALTER TABLE methodology_element
  ADD CONSTRAINT methodology_element_element_type_check CHECK (element_type IN (
    'methodology_text', 'phase', 'gate', 'gate_criterion', 'mandatory_artifact', 'checklist_item',
    'template', 'tom_dimension', 'approver_route', 'reminder', 'escalation_rule', 'dashboard',
    'report_layout', 'source_element', 'scoring_weight', 'scoring_rubric', 'form', 'form_field')),
  -- REQ-S05-002: a source column is never deleted; a form (record type) is never added by an admin nor removed.
  ADD CONSTRAINT methodology_element_source_field_protected
    CHECK (element_type <> 'form_field' OR origin <> 'source' OR NOT removed),
  ADD CONSTRAINT methodology_element_form_fixed CHECK (element_type <> 'form' OR (origin = 'source' AND NOT removed)),
  -- REQ-S06-005: the eleven Studio field types; an extension field names its type.
  ADD CONSTRAINT methodology_element_field_type
    CHECK (element_type <> 'form_field'
           OR (attributes->>'fieldType' IN ('text', 'rich_text', 'number', 'currency', 'percentage', 'date',
                                           'reference', 'attachment', 'lookup', 'choice', 'calculated'))
           OR (origin = 'source' AND NOT attributes ? 'fieldType'));

-- Every slice A rule of 0062 is kept verbatim; the additions are marked "ADR-0041".
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
           'strategic_fit', 'financial_value', 'customer_impact', 'feasibility', 'time_to_value', 'risk_compliance'])) THEN
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

-- -----------------------------------------------------------------------------------------------------------------
-- The seeded form schema v1 (key 'forms'): no element rows, so every form resolves to the registry (the DG2-DG4
-- forms exactly, with no extension field). The content hash of a seeded version is an opaque identity (ADR-0039 §1).
INSERT INTO methodology_version (id, key, version_no, status, title_en, title_ar, source_document, source_sha256,
                                 definition, content_sha256, published_at, config_kind, origin) VALUES
  ('01920005-0200-7000-8000-000000000001', 'forms', 1, 'published',
   'Native forms v1 (source columns, no extension fields)', 'النماذج الأصلية — الإصدار 1 (ترجمة مؤقتة)',
   'docs/source/master-prompt-v2.0.md (M0127-M0149)', NULL,
   '{"sourceRefs": ["M0127", "M0128", "M0149"]}'::jsonb,
   encode(sha256(convert_to('forms/1:source-columns-only', 'UTF8')), 'hex'),
   now(), 'form_schema', 'seed');
-- methodology_version is audited since 0062 (deferred check at COMMIT): the seed writes its own audit event.
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, reason, source) VALUES
  ('01920005-0200-7000-8000-0000000000ff', 'system', 'methodology_version.seed', 'methodology_version', '01920005-0200-7000-8000-000000000001', 1,
   'Seeded forms configuration v1 (T-DG5-ARCH-02)', 'migration');

-- -----------------------------------------------------------------------------------------------------------------
-- Shared: resolve the form schema version a transformation uses (its form_schema pin, else the seeded v1; ADR-0039
-- §3 "never the latest"), and check that (record_type, record_id) names an existing row of the registered table in
-- the transformation (and, for T04/T16, of the right decision kind).
CREATE FUNCTION p5_form_schema_version_for(p_transformation_id uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT p.methodology_version_id FROM transformation_config_pin p
                    WHERE p.transformation_id = p_transformation_id AND p.kind = 'form_schema'),
                  '01920005-0200-7000-8000-000000000001'::uuid)
$$;
CREATE FUNCTION p5_form_record_ref_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  n jsonb := to_jsonb(NEW);
  t record;
  found_it boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND (n->'record_type' IS NOT DISTINCT FROM to_jsonb(OLD)->'record_type')
     AND (n->'record_id' IS NOT DISTINCT FROM to_jsonb(OLD)->'record_id') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '%: record_type and record_id never change', TG_TABLE_NAME
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_record_fixed';
  END IF;
  SELECT f.table_name, f.discriminator_column, f.discriminator_value INTO t FROM form_record_type f WHERE f.code = n->>'record_type';
  IF t.table_name IS NULL OR t.table_name = 'procedure_definition' OR n->>'transformation_id' IS NULL THEN
    RAISE EXCEPTION '%: record type % has no stored records in a transformation', TG_TABLE_NAME, n->>'record_type'
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_record_type';
  END IF;
  IF n->>'record_id' IS NULL THEN
    RETURN NEW;
  END IF;
  IF t.discriminator_column IS NULL THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND transformation_id = $2)', t.table_name)
      INTO found_it USING (n->>'record_id')::uuid, (n->>'transformation_id')::uuid;
  ELSE
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND transformation_id = $2 AND %I = $3)',
                   t.table_name, t.discriminator_column)
      INTO found_it USING (n->>'record_id')::uuid, (n->>'transformation_id')::uuid, t.discriminator_value;
  END IF;
  IF NOT found_it THEN
    RAISE EXCEPTION '%: % % does not exist in transformation %', TG_TABLE_NAME, n->>'record_type', n->>'record_id', n->>'transformation_id'
      USING ERRCODE = 'foreign_key_violation', CONSTRAINT = TG_TABLE_NAME || '_record_ref';
  END IF;
  RETURN NEW;
END $$;

-- -----------------------------------------------------------------------------------------------------------------
-- form_custom_value: the extension-field values of one record (REQ-S05-002, REQ-S16-010), validated by the API
-- against the form schema version the transformation is pinned to (ADR-0041 §4) and, as the last line of defence,
-- by the trigger below: the version is that pinned version; every key is an extension field (origin 'admin', not
-- removed) of the record type in that version; every value has the JSON shape of its field type (decimals and
-- percentages as decimal strings, a percentage as a fraction, currency as {amount: decimal string, currencyCode},
-- dates as YYYY-MM-DD, references as uuids, attachments as arrays of evidence uuids); calculated fields are never
-- stored (computed at read through the DG3 engine). JSON null clears a value. Core entity columns stay typed.
CREATE TABLE form_custom_value (
  id                     uuid PRIMARY KEY,
  organization_id        uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id      uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_type            text NOT NULL REFERENCES form_record_type (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_id              uuid NOT NULL,
  form_schema_version_id uuid NOT NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  field_values           jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(field_values) = 'object'),
  version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT form_custom_value_record_key UNIQUE (record_type, record_id),
  CONSTRAINT form_custom_value_size CHECK (pg_column_size(field_values) <= 65536)
);
CREATE INDEX form_custom_value_transformation_idx ON form_custom_value (transformation_id, record_type);
CREATE TRIGGER form_custom_value_record_ref BEFORE INSERT OR UPDATE ON form_custom_value
  FOR EACH ROW EXECUTE FUNCTION p5_form_record_ref_guard();
CREATE FUNCTION form_custom_value_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  k text;
  val jsonb;
  ftype text;
  dec text := '^-?[0-9]{1,15}(\.[0-9]{1,6})?$';
BEGIN
  IF NOT (SELECT f.custom_fields_allowed FROM form_record_type f WHERE f.code = NEW.record_type) THEN
    RAISE EXCEPTION 'form_custom_value %: record type % takes no extension fields', NEW.id, NEW.record_type
      USING ERRCODE = 'check_violation', CONSTRAINT = 'form_custom_value_record_type';
  END IF;
  IF NEW.form_schema_version_id IS DISTINCT FROM p5_form_schema_version_for(NEW.transformation_id) THEN
    RAISE EXCEPTION 'form_custom_value %: values are validated against the form schema version the transformation is pinned to', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'form_custom_value_pinned_version';
  END IF;
  FOR k, val IN SELECT e.key, e.value FROM jsonb_each(NEW.field_values) AS e LOOP
    SELECT m.attributes->>'fieldType' INTO ftype FROM methodology_element m
     WHERE m.methodology_version_id = NEW.form_schema_version_id AND m.element_type = 'form_field'
       AND m.stable_key = NEW.record_type || '.' || k AND m.origin = 'admin' AND NOT m.removed;
    IF ftype IS NULL THEN
      RAISE EXCEPTION 'form_custom_value %: % is not an extension field of % in the pinned form schema version', NEW.id, k, NEW.record_type
        USING ERRCODE = 'check_violation', CONSTRAINT = 'form_custom_value_unknown_field';
    END IF;
    IF jsonb_typeof(val) <> 'null' AND NOT (CASE ftype
         WHEN 'text' THEN jsonb_typeof(val) = 'string' AND char_length(val #>> '{}') BETWEEN 1 AND 2000
         WHEN 'rich_text' THEN jsonb_typeof(val) = 'string' AND char_length(val #>> '{}') BETWEEN 1 AND 20000
         WHEN 'number' THEN jsonb_typeof(val) = 'string' AND (val #>> '{}') ~ dec
         WHEN 'percentage' THEN jsonb_typeof(val) = 'string' AND (val #>> '{}') ~ dec
         WHEN 'currency' THEN jsonb_typeof(val) = 'object' AND jsonb_typeof(val->'amount') = 'string'
                              AND (val->>'amount') ~ dec AND coalesce(val->>'currencyCode', '') ~ '^[A-Z]{3}$'
                              AND (SELECT count(*) FROM jsonb_object_keys(val)) = 2
         WHEN 'date' THEN jsonb_typeof(val) = 'string' AND (val #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         WHEN 'reference' THEN jsonb_typeof(val) = 'string'
                               AND (val #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         WHEN 'attachment' THEN jsonb_typeof(val) = 'array' AND jsonb_array_length(val) <= 20
         WHEN 'lookup' THEN jsonb_typeof(val) = 'string' AND char_length(val #>> '{}') BETWEEN 1 AND 100
         WHEN 'choice' THEN jsonb_typeof(val) = 'string' AND char_length(val #>> '{}') BETWEEN 1 AND 100
         ELSE false END) THEN
      RAISE EXCEPTION 'form_custom_value %: the value of % does not have the shape of a % field (ADR-0041 §3)', NEW.id, k, ftype
        USING ERRCODE = 'check_violation', CONSTRAINT = 'form_custom_value_type_shape';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER form_custom_value_guard BEFORE INSERT OR UPDATE ON form_custom_value
  FOR EACH ROW EXECUTE FUNCTION form_custom_value_guard();
SELECT p2_attach_guards('form_custom_value', true);
GRANT SELECT, INSERT, UPDATE ON form_custom_value TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- form_draft: a saved, not yet submitted form (REQ-S05-001 "draft saving"): owned by one user, for a new record
-- (record_id NULL) or an existing one (its record version at draft time). open -> closed ('saved' when the record
-- write succeeded, 'discarded'); a closed draft never reopens or changes. The payload is the partial request body,
-- validated by the API against the record type's update schema made partial; never the record itself.
CREATE TABLE form_draft (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id   uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_type         text NOT NULL REFERENCES form_record_type (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_id           uuid NULL,
  base_record_version integer NULL CHECK (base_record_version IS NULL OR base_record_version >= 1),
  owner_user_id       uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  payload             jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 262144),
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_reason       text NULL CHECK (closed_reason IS NULL OR closed_reason IN ('saved', 'discarded')),
  closed_at           timestamptz NULL,
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT form_draft_closed_complete CHECK ((status = 'closed') = (closed_reason IS NOT NULL) AND (closed_reason IS NULL) = (closed_at IS NULL)),
  CONSTRAINT form_draft_base_version CHECK ((record_id IS NULL) = (base_record_version IS NULL)),
  CONSTRAINT form_draft_owner_is_creator CHECK (owner_user_id = created_by)
);
-- One open draft per user and existing record; drafts of new records are not limited.
CREATE UNIQUE INDEX form_draft_open_record_key ON form_draft (owner_user_id, record_type, record_id)
  WHERE status = 'open' AND record_id IS NOT NULL;
CREATE INDEX form_draft_owner_idx ON form_draft (owner_user_id, transformation_id, status, updated_at DESC);
CREATE TRIGGER form_draft_record_ref BEFORE INSERT OR UPDATE ON form_draft
  FOR EACH ROW EXECUTE FUNCTION p5_form_record_ref_guard();
CREATE FUNCTION form_draft_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'open' THEN
    RAISE EXCEPTION 'form_draft %: a draft starts open', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'form_draft_status_transition';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'closed' THEN
      RAISE EXCEPTION 'form_draft %: a closed draft never changes', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'form_draft_status_transition';
    END IF;
    IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.base_record_version IS DISTINCT FROM OLD.base_record_version THEN
      RAISE EXCEPTION 'form_draft %: owner and base record version never change', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'form_draft_identity_fixed';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER form_draft_guard BEFORE INSERT OR UPDATE ON form_draft
  FOR EACH ROW EXECUTE FUNCTION form_draft_guard();
SELECT p2_attach_guards('form_draft', true);
GRANT SELECT, INSERT, UPDATE ON form_draft TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- form_record_comment: comments on a record (REQ-S05-001 "comments"), append-only (a comment is never edited or
-- deleted; a correction is a new comment). Replies are one level deep and stay on the same record.
CREATE TABLE form_record_comment (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_type       text NOT NULL REFERENCES form_record_type (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_id         uuid NOT NULL,
  parent_comment_id uuid NULL REFERENCES form_record_comment (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  body              text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX form_record_comment_record_idx ON form_record_comment (record_type, record_id, created_at, id);
CREATE TRIGGER form_record_comment_record_ref BEFORE INSERT ON form_record_comment
  FOR EACH ROW EXECUTE FUNCTION p5_form_record_ref_guard();
CREATE FUNCTION form_record_comment_parent() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.parent_comment_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM form_record_comment p WHERE p.id = NEW.parent_comment_id AND p.record_type = NEW.record_type
         AND p.record_id = NEW.record_id AND p.parent_comment_id IS NULL) THEN
    RAISE EXCEPTION 'form_record_comment %: a reply answers a top-level comment of the same record', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'form_record_comment_parent_same_record';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER form_record_comment_parent BEFORE INSERT ON form_record_comment
  FOR EACH ROW EXECUTE FUNCTION form_record_comment_parent();
SELECT p2_attach_append_only('form_record_comment');
SELECT p2_attach_guards('form_record_comment', true);
GRANT SELECT, INSERT ON form_record_comment TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- form_record_attachment: evidence attached to a record of a type the DG2 evidence_link does not cover (REQ-S05-001
-- "attachments"). The twenty DG2 record types keep evidence_link (one canonical attachment place per record type,
-- M0150 "avoid duplicate registers"); the trigger refuses them here. Same shape and removal rule as evidence_link.
CREATE TABLE form_record_attachment (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_type       text NOT NULL REFERENCES form_record_type (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_id         uuid NOT NULL,
  evidence_id       uuid NOT NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  removed_at        timestamptz NULL,
  removed_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  remove_reason     text NULL CHECK (remove_reason IS NULL OR char_length(remove_reason) BETWEEN 3 AND 1000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT form_record_attachment_evidence_fkey FOREIGN KEY (transformation_id, evidence_id)
    REFERENCES evidence (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT form_record_attachment_removal_complete
    CHECK ((status = 'removed') = (removed_at IS NOT NULL) AND (removed_at IS NULL) = (removed_by IS NULL)
           AND (removed_at IS NULL) = (remove_reason IS NULL))
);
CREATE UNIQUE INDEX form_record_attachment_active_key ON form_record_attachment (evidence_id, record_type, record_id) WHERE status = 'active';
CREATE INDEX form_record_attachment_record_idx ON form_record_attachment (record_type, record_id) WHERE status = 'active';
CREATE TRIGGER form_record_attachment_record_ref BEFORE INSERT OR UPDATE ON form_record_attachment
  FOR EACH ROW EXECUTE FUNCTION p5_form_record_ref_guard();
CREATE FUNCTION form_record_attachment_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  movable text[] := ARRAY['status', 'removed_at', 'removed_by', 'remove_reason', 'version', 'updated_at', 'updated_by'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'active' THEN
      RAISE EXCEPTION 'form_record_attachment %: an attachment starts active', NEW.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'form_record_attachment_status_transition';
    END IF;
    -- The DG2 record types of evidence_link (0012) keep their attachments there.
    IF (SELECT f.table_name FROM form_record_type f WHERE f.code = NEW.record_type) = ANY (ARRAY[
         'charter', 'north_star', 'strategic_guardrail', 'outcome', 'kpi_definition', 'baseline', 'outcome_kpi',
         'value_pool', 'diagnostic_item', 'diagnostic_finding', 'diagnostic_workstream_output', 'tom_canvas_cell',
         'tom_gap', 'capability', 'journey', 'journey_pain_point', 'decision', 'dependency', 'tom_workshop',
         'action_item']) THEN
      RAISE EXCEPTION 'form_record_attachment %: % records keep their attachments in evidence_link', NEW.id, NEW.record_type
        USING ERRCODE = 'check_violation', CONSTRAINT = 'form_record_attachment_use_evidence_link';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - movable) IS DISTINCT FROM (to_jsonb(OLD) - movable) THEN
    RAISE EXCEPTION 'form_record_attachment %: only the removal columns change', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'form_record_attachment_frozen';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'active' AND NEW.status = 'removed') THEN
    RAISE EXCEPTION 'form_record_attachment %: % -> % is not a legal transition', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'form_record_attachment_status_transition';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER form_record_attachment_guard BEFORE INSERT OR UPDATE ON form_record_attachment
  FOR EACH ROW EXECUTE FUNCTION form_record_attachment_guard();
SELECT p2_attach_guards('form_record_attachment', true);
GRANT SELECT, INSERT, UPDATE ON form_record_attachment TO mth_app;
