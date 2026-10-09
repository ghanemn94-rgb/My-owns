-- 0049 P4 slices F and G seeds: the adoption and sustainment permission catalogue and role defaults, the slice F/G
-- work-item kinds, and the approval type of a benefit transition decision
-- (T-DG4-ARCH-06; ADR-0033 §9, ADR-0034 §10; REQ-PB-069, REQ-PB-070, REQ-PB-072, REQ-PB-073, REQ-PB-083, REQ-PB-084,
-- REQ-S03-002, REQ-S03-003, REQ-S11-001, REQ-S11-002, REQ-S11-004, REQ-S11-005, REQ-S11-007, REQ-S11-008,
-- REQ-S11-009). Authored by solution-architect. Runs as mth_owner inside one transaction opened by `mth-db migrate`.
-- Forward-only: never edit once merged. SQL floor: PostgreSQL 16. Nothing here approves anything, and nothing touches
-- DG0-DG7. The recurring-job schedules (review and control-check scans) are migration 0050 (p4-work-split §F+G).

-- -----------------------------------------------------------------------------------------------------------------
-- Approval type (ADR-0026 §4): a benefit transition decision (REQ-S11-007 "decide:SP or configured authority").
INSERT INTO approval_type (code, subject_table, default_sod_policy, requires_decision_right, owner_module, label_en, label_ar, source_ref) VALUES
  ('benefit_transition_decision', 'transition_decision', 'requester_excluded', false, 'sustainment', 'Benefit transition decision', 'قرار انتقال المنفعة', 'M0218');

-- -----------------------------------------------------------------------------------------------------------------
-- Work-item kinds (ADR-0025 §4).
INSERT INTO work_item_kind (code, owner_module, label_en, label_ar, source_ref) VALUES
  ('adoption_intervention_due', 'adoption', 'Adoption intervention assigned to you', 'تدخل تبنٍّ مُسند إليك', 'M0215'),
  ('assessment_invitation', 'adoption', 'Feedback or assessment form to complete', 'نموذج ملاحظات أو تقييم بانتظار الإكمال', 'M0215'),
  ('assessment_to_review', 'adoption', 'Submitted feedback or assessment to review', 'ملاحظات أو تقييم مُقدَّم بانتظار المراجعة', 'M0215'),
  ('bau_handover_to_accept', 'sustainment', 'BAU handover awaiting your acceptance', 'تسليم إلى العمليات الاعتيادية بانتظار قبولك', 'M0217'),
  ('performance_review_due', 'sustainment', 'Performance area review due', 'مراجعة مجال أداء مستحقة', 'M0217'),
  ('benefit_monitoring_due', 'sustainment', 'Benefit monitoring review due', 'مراجعة متابعة منفعة مستحقة', 'M0218'),
  ('control_check_due', 'sustainment', 'Control check due', 'فحص ضابط رقابي مستحق', 'M0219');

-- -----------------------------------------------------------------------------------------------------------------
-- Slice F and G permission catalogue and role defaults. EXACTLY packages/shared/src/permissions.ts
-- P4_ADOPTION_SUSTAINMENT_PERMISSIONS / P4_ADOPTION_SUSTAINMENT_ROLE_PERMISSIONS (packages/db/src/seed.test.ts compares them).
-- A CONFIGURABLE STARTING POINT, not a Mobily-approved access policy. One code is a business approval:
-- bau_handover.accept (receiving-owner acceptance, REQ-S11-005), granted only to BO, a role that already holds a
-- business_approval code, so the DG1/DG2 rules keyed on "a role holding an approval permission" (F-DG1-106; ADR-0020
-- §3; ADR-0026 §8) are unchanged. lesson.search is a read code and is also granted to AUD (read-only everywhere). No
-- technical_admin role receives any of these (the 0001 trigger refuses a business_approval code for a technical admin).
INSERT INTO permission (code, category, description_en, description_ar) VALUES
  ('adoption.edit', 'write', 'Maintain the stakeholder and adoption plan: stakeholder groups, champions, interventions, indicator links and involvement in design', 'إدارة خطة أصحاب المصلحة والتبني: مجموعات أصحاب المصلحة والمناصرون والتدخلات وروابط المؤشرات والمشاركة في التصميم'),
  ('assessment_form.manage', 'write', 'Create, version, publish and retire feedback and assessment forms, and invite respondents', 'إنشاء نماذج الملاحظات والتقييم وإصدار نسخها ونشرها وإيقافها ودعوة المستجيبين'),
  ('assessment.respond', 'write', 'Answer a feedback or assessment form you are invited to', 'الإجابة على نموذج ملاحظات أو تقييم دُعيت إليه'),
  ('assessment.review', 'write', 'Review submitted feedback and assessment records', 'مراجعة سجلات الملاحظات والتقييم المقدمة'),
  ('proficiency.record', 'write', 'Record training attendance and observed proficiency as an assessor', 'تسجيل حضور التدريب والكفاءة المُلاحَظة بصفة مقيّم'),
  ('champion_constraint.raise', 'write', 'Raise a constraint on a design decision as an active champion', 'رفع قيد على قرار تصميم بصفة مناصر نشط'),
  ('adoption_status.set', 'write', 'Set an initiative''s business adoption status', 'تحديد حالة تبني الأعمال لمبادرة'),
  ('initiative.complete_delivery', 'write', 'Record that an initiative''s delivery is complete', 'تسجيل اكتمال تسليم مبادرة'),
  ('initiative.close', 'write', 'Close a delivery-complete initiative when its value conditions are met', 'إغلاق مبادرة مكتملة التسليم عند استيفاء شروط القيمة'),
  ('transformation.close', 'write', 'Close a transformation after its G6 (Sustain) business approval when its value and BAU conditions are met', 'إغلاق تحول بعد اعتماد بوابة الاستدامة G6 عند استيفاء شروط القيمة والتسليم إلى العمليات الاعتيادية'),
  ('performance_area.manage', 'write', 'Create and maintain performance areas, their KPI and benefit links, and retire them', 'إنشاء مجالات الأداء وإدارتها وروابط مؤشراتها ومنافعها وإيقافها'),
  ('performance_area.reopen', 'write', 'Reopen a deteriorating performance area (a new cycle; history preserved)', 'إعادة فتح مجال أداء متراجع (دورة جديدة مع حفظ السجل)'),
  ('bau_handover.prepare', 'write', 'Prepare and submit a BAU handover', 'إعداد التسليم إلى العمليات الاعتيادية وتقديمه'),
  ('bau_handover.accept', 'business_approval', 'Accept or return a BAU handover addressed to you as the receiving owner', 'قبول أو إعادة تسليم إلى العمليات الاعتيادية موجّه إليك بصفتك المالك المستلم'),
  ('control.manage', 'write', 'Define and retire BAU controls and their check cadence', 'تعريف الضوابط الرقابية للعمليات الاعتيادية ودورية فحصها وإيقافها'),
  ('control_check.record', 'write', 'Record the result of a control check', 'تسجيل نتيجة فحص ضابط رقابي'),
  ('sustainment_review.complete', 'write', 'Complete a performance or benefit-monitoring review assigned to you', 'إكمال مراجعة أداء أو متابعة منفعة مُسندة إليك'),
  ('improvement.edit', 'write', 'Maintain the continuous-improvement backlog', 'إدارة قائمة التحسين المستمر'),
  ('lesson.edit', 'write', 'Record, publish and archive lessons', 'تسجيل الدروس المستفادة ونشرها وأرشفتها'),
  ('lesson.search', 'read', 'Search published lessons across the transformations of the organization', 'البحث في الدروس المستفادة المنشورة عبر تحولات المؤسسة'),
  ('transition_decision.propose', 'write', 'Propose a benefit transition decision with residual ownership and monitoring', 'اقتراح قرار انتقال منفعة مع الملكية المتبقية والمتابعة');

INSERT INTO role_permission (role_id, permission_code) VALUES
  ('01920000-0000-7000-8000-000000000001', 'assessment.respond'), -- SP
  ('01920000-0000-7000-8000-000000000001', 'lesson.search'), -- SP
  ('01920000-0000-7000-8000-000000000002', 'adoption.edit'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'assessment.respond'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'initiative.complete_delivery'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'initiative.close'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'transformation.close'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'performance_area.reopen'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'bau_handover.prepare'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'lesson.search'), -- TL
  ('01920000-0000-7000-8000-000000000003', 'adoption.edit'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'assessment_form.manage'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'assessment.respond'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'assessment.review'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'proficiency.record'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'champion_constraint.raise'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'adoption_status.set'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'performance_area.manage'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'performance_area.reopen'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'bau_handover.accept'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'control.manage'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'control_check.record'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'sustainment_review.complete'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'improvement.edit'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'lesson.edit'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'lesson.search'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'transition_decision.propose'), -- BO
  ('01920000-0000-7000-8000-000000000004', 'adoption.edit'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'assessment_form.manage'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'assessment.respond'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'proficiency.record'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'champion_constraint.raise'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'initiative.complete_delivery'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'bau_handover.prepare'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'lesson.search'), -- WL
  ('01920000-0000-7000-8000-000000000005', 'assessment.respond'), -- FIN
  ('01920000-0000-7000-8000-000000000005', 'sustainment_review.complete'), -- FIN
  ('01920000-0000-7000-8000-000000000005', 'lesson.search'), -- FIN
  ('01920000-0000-7000-8000-000000000005', 'transition_decision.propose'), -- FIN
  ('01920000-0000-7000-8000-000000000006', 'assessment.respond'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'performance_area.manage'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'control.manage'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'control_check.record'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'improvement.edit'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'lesson.edit'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'lesson.search'), -- TO
  ('01920000-0000-7000-8000-000000000007', 'assessment.respond'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'sustainment_review.complete'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'lesson.search'), -- KDS
  ('01920000-0000-7000-8000-000000000008', 'assessment.respond'), -- TD
  ('01920000-0000-7000-8000-000000000008', 'lesson.search'), -- TD
  ('01920000-0000-7000-8000-000000000009', 'assessment.respond'), -- CM
  ('01920000-0000-7000-8000-000000000009', 'lesson.search'), -- CM
  ('01920000-0000-7000-8000-00000000000a', 'assessment.respond'), -- SEC
  ('01920000-0000-7000-8000-00000000000a', 'lesson.search'), -- SEC
  ('01920000-0000-7000-8000-00000000000b', 'lesson.search'); -- AUD (read-only)
