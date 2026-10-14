-- 0064 P5 slice A seeds: the Studio, review and methodology-migration permission catalogue and role defaults, and the
-- source inventory of REQ-S02-001 (T-DG5-ARCH-01; ADR-0039 §6, §9, ADR-0040 §6; REQ-S02-001, REQ-S06-006,
-- REQ-S06-010). Authored by solution-architect. Runs as mth_owner inside one transaction opened by `mth-db migrate`.
-- Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- Permissions: EXACTLY packages/shared/src/permissions.ts P5_STUDIO_PERMISSIONS / P5_STUDIO_ROLE_PERMISSIONS
-- (packages/db/src/seed.test.ts compares them). A CONFIGURABLE STARTING POINT, not a Mobily-approved access policy.
-- One business_approval code, methodology_migration.approve, held by SP only: TL stays approval-free because the DG1
-- creator-derived assignment (0008, ADR-0006) never derives a role holding an approval code. No technical_admin role
-- holds it (the 0005 role_permission trigger refuses that anyway, REQ-S10-003). ADM_METHOD configures, previews, publishes and
-- plans/executes approved migrations; it never reviews its own configuration and never approves (REQ-S06-010).
-- AUD gets methodology.read only. Nothing touches DG0-DG7.
INSERT INTO permission (code, category, description_en, description_ar) VALUES
  ('methodology.read', 'read', 'Read Playbook Studio versions, drafts, diffs, check runs, reviews and methodology migrations', 'قراءة إصدارات استوديو المنهجية ومسوداتها والفروقات ونتائج الفحوص والمراجعات وعمليات ترحيل المنهجية'),
  ('methodology.publish', 'configure', 'Preview, test and publish a Studio configuration version, and roll back to a prior version', 'معاينة إصدار إعدادات الاستوديو واختباره ونشره، والعودة إلى إصدار سابق'),
  ('methodology.review', 'write', 'Review a Studio configuration change before it is published (never its own)', 'مراجعة تغيير إعدادات الاستوديو قبل نشره (وليس تغييره الخاص أبداً)'),
  ('config_review_policy.configure', 'configure', 'Configure which configuration kinds need a review before publish, and by which role', 'تهيئة أنواع الإعدادات التي تتطلب مراجعة قبل النشر والدور المراجع'),
  ('source_coverage.run', 'configure', 'Run the source-completeness check of a methodology version', 'تشغيل فحص اكتمال عناصر المصدر لإصدار منهجية'),
  ('methodology_migration.plan', 'configure', 'Plan, preview and submit the migration of a pinned transformation to a newer version', 'تخطيط ترحيل تحول مثبّت إلى إصدار أحدث ومعاينته وتقديمه'),
  ('methodology_migration.approve', 'business_approval', 'Approve or reject the migration of a pinned transformation (business approval)', 'اعتماد أو رفض ترحيل تحول مثبّت (اعتماد أعمال)'),
  ('methodology_migration.execute', 'configure', 'Execute an approved methodology migration', 'تنفيذ ترحيل منهجية معتمد');
INSERT INTO role_permission (role_id, permission_code) VALUES
  ('01920000-0000-7000-8000-000000000001', 'methodology.read'), -- SP
  ('01920000-0000-7000-8000-000000000001', 'methodology_migration.approve'), -- SP
  ('01920000-0000-7000-8000-000000000002', 'methodology.read'), -- TL
  ('01920000-0000-7000-8000-000000000006', 'methodology.read'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'methodology.review'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'config_review_policy.configure'), -- TO
  ('01920000-0000-7000-8000-00000000000b', 'methodology.read'), -- AUD
  ('01920000-0000-7000-8000-00000000000e', 'methodology.read'), -- ADM_METHOD
  ('01920000-0000-7000-8000-00000000000e', 'methodology.publish'), -- ADM_METHOD
  ('01920000-0000-7000-8000-00000000000e', 'source_coverage.run'), -- ADM_METHOD
  ('01920000-0000-7000-8000-00000000000e', 'methodology_migration.plan'), -- ADM_METHOD
  ('01920000-0000-7000-8000-00000000000e', 'methodology_migration.execute'); -- ADM_METHOD

-- -----------------------------------------------------------------------------------------------------------------
-- Source inventory (REQ-S02-001, M0083: 2 modes, 6 phases, 6 gates, 16 templates, 10 TOM dimensions, 5 forums,
-- 6 lifecycle steps, 3 launch windows, 1 roaming example, 25 questions = 80 elements). source_label_en is VERBATIM
-- from docs/source/playbook.md at the cited block; label_ar is a PROVISIONAL translation needing review.
-- feature_status: 'working' where a DG2-DG4-approved feature implements the element; 'planned' where a P5 slice
-- delivers it (launch windows: slice H, BE-P; roaming example: slice J, BE-T; health questions: slice H, KBE-G). Those
-- tasks move their rows to 'working' in a migration of their own range (p5-work-split §A rule A-7).
INSERT INTO source_element (id, set_code, stable_key, ordinal, source_label_en, label_ar, source_ref, feature_ref, feature_status) VALUES
  ('01920005-0010-7000-8000-000000000001', 'mode', 'end_to_end', 1, 'End-to-End', 'من البداية إلى النهاية', 'B0009', 'transformation.mode (P1/P2)', 'working'),
  ('01920005-0010-7000-8000-000000000002', 'mode', 'modular', 2, 'Modular', 'مرحلي (نمطي)', 'B0009', 'transformation.mode, inherited_record (P2/P4)', 'working'),
  ('01920005-0011-7000-8000-000000000001', 'phase', 'diagnose', 1, 'DIAGNOSE', 'التشخيص', 'B0021', 'phase_definition (P4)', 'working'),
  ('01920005-0011-7000-8000-000000000002', 'phase', 'define', 2, 'DEFINE', 'التحديد', 'B0021', 'phase_definition (P4)', 'working'),
  ('01920005-0011-7000-8000-000000000003', 'phase', 'design', 3, 'DESIGN', 'التصميم', 'B0021', 'phase_definition (P4)', 'working'),
  ('01920005-0011-7000-8000-000000000004', 'phase', 'mobilize', 4, 'MOBILIZE', 'التعبئة', 'B0021', 'phase_definition (P4)', 'working'),
  ('01920005-0011-7000-8000-000000000005', 'phase', 'transform', 5, 'TRANSFORM', 'التحويل', 'B0021', 'phase_definition (P4)', 'working'),
  ('01920005-0011-7000-8000-000000000006', 'phase', 'realize', 6, 'REALIZE', 'تحقيق القيمة', 'B0021', 'phase_definition (P4)', 'working'),
  ('01920005-0012-7000-8000-000000000001', 'gate', 'G1', 1, 'G1 - Case for Change', 'البوابة 1 - مبررات التغيير', 'B0023', 'gate_definition, gate_instance (P2)', 'working'),
  ('01920005-0012-7000-8000-000000000002', 'gate', 'G2', 2, 'G2 - Direction', 'البوابة 2 - التوجّه', 'B0023', 'gate_definition, gate_instance (P2)', 'working'),
  ('01920005-0012-7000-8000-000000000003', 'gate', 'G3', 3, 'G3 - Target State', 'البوابة 3 - الحالة المستهدفة', 'B0023', 'gate_definition, gate_instance (P2)', 'working'),
  ('01920005-0012-7000-8000-000000000004', 'gate', 'G4', 4, 'G4 - Mobilization', 'البوابة 4 - التعبئة', 'B0023', 'gate_definition, gate_instance (P3)', 'working'),
  ('01920005-0012-7000-8000-000000000005', 'gate', 'G5', 5, 'G5 - Scale', 'البوابة 5 - التوسّع', 'B0023', 'gate_definition, gate_instance (P4)', 'working'),
  ('01920005-0012-7000-8000-000000000006', 'gate', 'G6', 6, 'G6 - Sustain', 'البوابة 6 - الاستدامة', 'B0023', 'gate_definition, gate_instance (P4)', 'working'),
  ('01920005-0013-7000-8000-000000000001', 'template', 'T01', 1, 'Template 1 — Current-State Diagnostic', 'النموذج 1 — تشخيص الوضع الحالي', 'B0030', 'diagnostic_item (P2)', 'working'),
  ('01920005-0013-7000-8000-000000000002', 'template', 'T02', 2, 'Template 2 — Outcome & KPI Tree', 'النموذج 2 — شجرة النتائج ومؤشرات الأداء', 'B0049', 'outcome, kpi_definition (P2)', 'working'),
  ('01920005-0013-7000-8000-000000000003', 'template', 'T03', 3, 'Template 3 — TOM Gap Matrix', 'النموذج 3 — مصفوفة فجوات نموذج التشغيل المستهدف', 'B0057', 'tom_gap (P2)', 'working'),
  ('01920005-0013-7000-8000-000000000004', 'template', 'T04', 4, 'Template 4 — Design Decision Log', 'النموذج 4 — سجل قرارات التصميم', 'B0064', 'decision (P2)', 'working'),
  ('01920005-0013-7000-8000-000000000005', 'template', 'T05', 5, 'Template 5 — Initiative Card', 'النموذج 5 — بطاقة المبادرة', 'B0071', 'initiative (P3)', 'working'),
  ('01920005-0013-7000-8000-000000000006', 'template', 'T06', 6, 'Template 6 — Prioritization Scorecard', 'النموذج 6 — بطاقة تحديد الأولويات', 'B0075', 'scoring_weight_set, initiative_score (P3)', 'working'),
  ('01920005-0013-7000-8000-000000000007', 'template', 'T07', 7, 'Template 7 — Wave Roadmap', 'النموذج 7 — خارطة طريق الموجات', 'B0078', 'roadmap_wave (P3)', 'working'),
  ('01920005-0013-7000-8000-000000000008', 'template', 'T08', 8, 'Template 8 — Dependency Map', 'النموذج 8 — خريطة الاعتماديات', 'B0080', 'dependency (P2/P3)', 'working'),
  ('01920005-0013-7000-8000-000000000009', 'template', 'T09', 9, 'Template 9 — Benefit Formula', 'النموذج 9 — معادلة المنفعة', 'B0086', 'benefit_formula (P3)', 'working'),
  ('01920005-0013-7000-8000-00000000000a', 'template', 'T10', 10, 'Template 10 — Executive Transformation Dashboard', 'النموذج 10 — لوحة التحول التنفيذية', 'B0094', 't10_area_definition, dashboards (P4)', 'working'),
  ('01920005-0013-7000-8000-00000000000b', 'template', 'T11', 11, 'Template 11 — Decision Rights Matrix', 'النموذج 11 — مصفوفة صلاحيات القرار', 'B0098', 'decision_right (P4)', 'working'),
  ('01920005-0013-7000-8000-00000000000c', 'template', 'T12', 12, 'Template 12 — RACI', 'النموذج 12 — مصفوفة المسؤوليات', 'B0100', 'raci_deliverable (P4)', 'working'),
  ('01920005-0013-7000-8000-00000000000d', 'template', 'T13', 13, 'Template 13 — Stakeholder & Adoption Plan', 'النموذج 13 — خطة أصحاب المصلحة والتبنّي', 'B0106', 'stakeholder_group, adoption_intervention (P4)', 'working'),
  ('01920005-0013-7000-8000-00000000000e', 'template', 'T14', 14, 'Template 14 — Benefits Register', 'النموذج 14 — سجل المنافع', 'B0122', 'benefit (P4)', 'working'),
  ('01920005-0013-7000-8000-00000000000f', 'template', 'T15', 15, 'Template 15 — RAID', 'النموذج 15 — سجل المخاطر والافتراضات والقضايا والاعتماديات', 'B0127', 'raid_entry (P4)', 'working'),
  ('01920005-0013-7000-8000-000000000010', 'template', 'T16', 16, 'Template 16 — Executive Decision Log', 'النموذج 16 — سجل القرارات التنفيذية', 'B0129', 'executive_decision (P4)', 'working'),
  ('01920005-0014-7000-8000-000000000001', 'tom_dimension', 'customer_value_proposition', 1, 'Customer & Value Proposition', 'العميل وعرض القيمة', 'B0056', 'tom_dimension (P2)', 'working'),
  ('01920005-0014-7000-8000-000000000002', 'tom_dimension', 'products_services', 2, 'Products & Services', 'المنتجات والخدمات', 'B0056', 'tom_dimension (P2)', 'working'),
  ('01920005-0014-7000-8000-000000000003', 'tom_dimension', 'journeys_processes', 3, 'Journeys & Processes', 'الرحلات والعمليات', 'B0056', 'tom_dimension (P2)', 'working'),
  ('01920005-0014-7000-8000-000000000004', 'tom_dimension', 'organization', 4, 'Organization', 'الهيكل التنظيمي', 'B0056', 'tom_dimension (P2)', 'working'),
  ('01920005-0014-7000-8000-000000000005', 'tom_dimension', 'governance_decision_rights', 5, 'Governance & Decision Rights', 'الحوكمة وصلاحيات القرار', 'B0056', 'tom_dimension (P2)', 'working'),
  ('01920005-0014-7000-8000-000000000006', 'tom_dimension', 'people_capabilities', 6, 'People & Capabilities', 'الأفراد والقدرات', 'B0056', 'tom_dimension (P2)', 'working'),
  ('01920005-0014-7000-8000-000000000007', 'tom_dimension', 'technology', 7, 'Technology', 'التقنية', 'B0056', 'tom_dimension (P2)', 'working'),
  ('01920005-0014-7000-8000-000000000008', 'tom_dimension', 'data_analytics', 8, 'Data & Analytics', 'البيانات والتحليلات', 'B0056', 'tom_dimension (P2)', 'working'),
  ('01920005-0014-7000-8000-000000000009', 'tom_dimension', 'partners_sourcing', 9, 'Partners & Sourcing', 'الشركاء والتوريد', 'B0056', 'tom_dimension (P2)', 'working'),
  ('01920005-0014-7000-8000-00000000000a', 'tom_dimension', 'performance_management', 10, 'Performance Management', 'إدارة الأداء', 'B0056', 'tom_dimension (P2)', 'working'),
  ('01920005-0015-7000-8000-000000000001', 'forum', 'executive_steerco', 1, 'Executive SteerCo', 'اللجنة التوجيهية التنفيذية', 'B0093', 'forum_template, forum (P4)', 'working'),
  ('01920005-0015-7000-8000-000000000002', 'forum', 'transformation_review', 2, 'Transformation Review', 'مراجعة التحول', 'B0093', 'forum_template, forum (P4)', 'working'),
  ('01920005-0015-7000-8000-000000000003', 'forum', 'workstream_review', 3, 'Workstream Review', 'مراجعة مسار العمل', 'B0093', 'forum_template, forum (P4)', 'working'),
  ('01920005-0015-7000-8000-000000000004', 'forum', 'rapid_response', 4, 'Rapid Response / Sprint', 'الاستجابة السريعة / السباق', 'B0093', 'forum_template, forum (P4)', 'working'),
  ('01920005-0015-7000-8000-000000000005', 'forum', 'value_review', 5, 'Value Review', 'مراجعة القيمة', 'B0093', 'forum_template, forum (P4)', 'working'),
  ('01920005-0016-7000-8000-000000000001', 'benefit_lifecycle_step', 'identify', 1, 'Identify', 'التحديد', 'B0121', 'benefit lifecycle (P4)', 'working'),
  ('01920005-0016-7000-8000-000000000002', 'benefit_lifecycle_step', 'plan', 2, 'Plan', 'التخطيط', 'B0121', 'benefit lifecycle (P4)', 'working'),
  ('01920005-0016-7000-8000-000000000003', 'benefit_lifecycle_step', 'enable', 3, 'Enable', 'التمكين', 'B0121', 'benefit lifecycle (P4)', 'working'),
  ('01920005-0016-7000-8000-000000000004', 'benefit_lifecycle_step', 'measure', 4, 'Measure', 'القياس', 'B0121', 'benefit lifecycle (P4)', 'working'),
  ('01920005-0016-7000-8000-000000000005', 'benefit_lifecycle_step', 'correct', 5, 'Correct', 'التصحيح', 'B0121', 'benefit lifecycle (P4)', 'working'),
  ('01920005-0016-7000-8000-000000000006', 'benefit_lifecycle_step', 'sustain', 6, 'Sustain', 'الاستدامة', 'B0121', 'benefit lifecycle (P4)', 'working'),
  ('01920005-0017-7000-8000-000000000001', 'launch_window', 'days_0_30', 1, 'Days 0-30', 'الأيام 0-30', 'B0134', '90-day launch plan (P5 slice H, BE-P)', 'planned'),
  ('01920005-0017-7000-8000-000000000002', 'launch_window', 'days_31_60', 2, 'Days 31-60', 'الأيام 31-60', 'B0134', '90-day launch plan (P5 slice H, BE-P)', 'planned'),
  ('01920005-0017-7000-8000-000000000003', 'launch_window', 'days_61_90', 3, 'Days 61-90', 'الأيام 61-90', 'B0134', '90-day launch plan (P5 slice H, BE-P)', 'planned'),
  ('01920005-0018-7000-8000-000000000001', 'roaming_example', 'international_roaming', 1, 'Example — International Roaming Transformation', 'مثال — تحول التجوال الدولي', 'B0143', 'demo dataset (P5 slice J, BE-T)', 'planned'),
  ('01920005-0019-7000-8000-000000000001', 'health_question', 'q01', 1, 'Is there a quantified case for change?', 'هل توجد مبررات تغيير مُقدَّرة كمياً؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned'),
  ('01920005-0019-7000-8000-000000000002', 'health_question', 'q02', 2, 'Is the baseline trusted by Finance?', 'هل تثق المالية بخط الأساس؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned'),
  ('01920005-0019-7000-8000-000000000003', 'health_question', 'q03', 3, 'Is there one clear North Star?', 'هل يوجد نجم شمال واحد واضح؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned'),
  ('01920005-0019-7000-8000-000000000004', 'health_question', 'q04', 4, 'Are 3-5 business outcomes measurable?', 'هل توجد 3-5 نتائج أعمال قابلة للقياس؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned'),
  ('01920005-0019-7000-8000-000000000005', 'health_question', 'q05', 5, 'Are outcomes owned by business leaders?', 'هل يملك قادة الأعمال النتائج؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned'),
  ('01920005-0019-7000-8000-000000000006', 'health_question', 'q06', 6, 'Is the customer perspective explicit?', 'هل منظور العميل صريح؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned'),
  ('01920005-0019-7000-8000-000000000007', 'health_question', 'q07', 7, 'Have root causes been separated from symptoms?', 'هل فُصلت الأسباب الجذرية عن الأعراض؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned'),
  ('01920005-0019-7000-8000-000000000008', 'health_question', 'q08', 8, 'Is there a defined Target Operating Model?', 'هل يوجد نموذج تشغيل مستهدف محدد؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned'),
  ('01920005-0019-7000-8000-000000000009', 'health_question', 'q09', 9, 'Are decision rights explicit?', 'هل صلاحيات القرار صريحة؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned'),
  ('01920005-0019-7000-8000-00000000000a', 'health_question', 'q10', 10, 'Are capability gaps visible?', 'هل فجوات القدرات ظاهرة؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned'),
  ('01920005-0019-7000-8000-00000000000b', 'health_question', 'q11', 11, 'Can every initiative be traced to a TOM gap?', 'هل يمكن تتبع كل مبادرة إلى فجوة في نموذج التشغيل المستهدف؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned'),
  ('01920005-0019-7000-8000-00000000000c', 'health_question', 'q12', 12, 'Can every initiative be traced to an outcome?', 'هل يمكن تتبع كل مبادرة إلى نتيجة؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned'),
  ('01920005-0019-7000-8000-00000000000d', 'health_question', 'q13', 13, 'Are benefits quantified without double counting?', 'هل قُدّرت المنافع كمياً دون ازدواج في الاحتساب؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned'),
  ('01920005-0019-7000-8000-00000000000e', 'health_question', 'q14', 14, 'Are dependencies integrated across workstreams?', 'هل الاعتماديات متكاملة عبر مسارات العمل؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned'),
  ('01920005-0019-7000-8000-00000000000f', 'health_question', 'q15', 15, 'Is sequencing based on value and feasibility?', 'هل يستند الترتيب إلى القيمة وقابلية التنفيذ؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned'),
  ('01920005-0019-7000-8000-000000000010', 'health_question', 'q16', 16, 'Do executive forums make decisions rather than review slides?', 'هل تتخذ المنتديات التنفيذية قرارات بدلاً من مراجعة العروض؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned'),
  ('01920005-0019-7000-8000-000000000011', 'health_question', 'q17', 17, 'Are overdue decisions visible?', 'هل القرارات المتأخرة ظاهرة؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned'),
  ('01920005-0019-7000-8000-000000000012', 'health_question', 'q18', 18, 'Are workstreams empowered within clear boundaries?', 'هل مسارات العمل مُمكَّنة ضمن حدود واضحة؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned'),
  ('01920005-0019-7000-8000-000000000013', 'health_question', 'q19', 19, 'Are adoption metrics tracked?', 'هل تُتابَع مقاييس التبنّي؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned'),
  ('01920005-0019-7000-8000-000000000014', 'health_question', 'q20', 20, 'Are frontline/business teams involved in design?', 'هل تشارك فرق الخطوط الأمامية والأعمال في التصميم؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned'),
  ('01920005-0019-7000-8000-000000000015', 'health_question', 'q21', 21, 'Are benefits validated with evidence?', 'هل يُتحقق من المنافع بالأدلة؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned'),
  ('01920005-0019-7000-8000-000000000016', 'health_question', 'q22', 22, 'Is BAU ownership defined before closure?', 'هل تُحدَّد ملكية العمليات الاعتيادية قبل الإغلاق؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned'),
  ('01920005-0019-7000-8000-000000000017', 'health_question', 'q23', 23, 'Is a continuous-improvement backlog retained?', 'هل يُحتفظ بقائمة أعمال للتحسين المستمر؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned'),
  ('01920005-0019-7000-8000-000000000018', 'health_question', 'q24', 24, 'Are lessons reused across transformations?', 'هل يُعاد استخدام الدروس المستفادة عبر التحولات؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned'),
  ('01920005-0019-7000-8000-000000000019', 'health_question', 'q25', 25, 'Can leadership state what support the transformation needs now?', 'هل تستطيع القيادة تحديد الدعم الذي يحتاجه التحول الآن؟', 'B0150', 'health check (P5 slice H, KBE-G)', 'planned');
