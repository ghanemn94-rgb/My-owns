-- 0053 P4 slice H seeds: the phase/gate/change-control permission catalogue and role defaults, the slice H work-item
-- kinds, and the approval types of a change request and a risk disposition
-- (T-DG4-ARCH-07; ADR-0035 §8, ADR-0036 §7; REQ-PB-015, REQ-PB-020, REQ-S03-004, REQ-S04-001, REQ-S04-009,
-- REQ-S04-012, REQ-S04-013, REQ-S04-014, REQ-S07-015, REQ-S09-010, REQ-S12-009, REQ-S12-010). Authored by
-- solution-architect. Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit
-- once merged. SQL floor: PostgreSQL 16. Nothing here approves anything, and nothing touches DG0-DG7.

-- -----------------------------------------------------------------------------------------------------------------
-- Approval types (ADR-0026 §4). A change request routes through T11 where a row names the decision (ADR-0036 §4);
-- a risk disposition is a business approval of accepting, transferring or carrying a risk (ADR-0035 §6).
INSERT INTO approval_type (code, subject_table, default_sod_policy, requires_decision_right, owner_module, label_en, label_ar, source_ref) VALUES
  ('change_request', 'change_request', 'requester_excluded', false, 'workflows', 'Change request to an approved record', 'طلب تغيير على سجل معتمد', 'M0125;M0163;M0184'),
  ('risk_disposition', 'risk_disposition', 'requester_excluded', false, 'workflows', 'Disposition of a material risk', 'معالجة خطر جوهري', 'M0122');

-- -----------------------------------------------------------------------------------------------------------------
-- Work-item kinds (ADR-0025 §4).
INSERT INTO work_item_kind (code, owner_module, label_en, label_ar, source_ref) VALUES
  ('gate_decision_due', 'workflows', 'Gate submission awaiting your business approval', 'تقديم بوابة بانتظار اعتمادك', 'M0229'),
  ('gate_exception_to_decide', 'workflows', 'Gate exception awaiting your decision', 'استثناء بوابة بانتظار قرارك', 'M0125'),
  ('gate_exception_expired', 'workflows', 'Gate exception expired: the evidence item is missing again', 'انتهى استثناء البوابة: عنصر الدليل مفقود مجدداً', 'M0125'),
  ('gate_condition_due', 'workflows', 'Condition of a gate approval assigned to you', 'شرط اعتماد بوابة مُسند إليك', 'M0124'),
  ('phase_step_enabled', 'workflows', 'Phase step enabled by a gate approval', 'خطوة مرحلة فُعّلت باعتماد بوابة', 'M0230'),
  ('phase_step_review', 'workflows', 'Phase step awaiting your review', 'خطوة مرحلة بانتظار مراجعتك', 'M0116'),
  ('scale_scope_enabled', 'workflows', 'Approved scale scope ready to execute', 'نطاق توسع معتمد جاهز للتنفيذ', 'M0230');

-- -----------------------------------------------------------------------------------------------------------------
-- Slice H permission catalogue and role defaults. EXACTLY packages/shared/src/permissions.ts
-- P4_GATES_CHANGE_PERMISSIONS / P4_GATES_CHANGE_ROLE_PERMISSIONS (packages/db/src/seed.test.ts compares them).
-- A CONFIGURABLE STARTING POINT, not a Mobily-approved access policy. One code is a business approval:
-- gate_exception.decide, granted only to SP and BO, the roles that already hold gate.decide (and the API additionally
-- requires the caller to be the gate's configured approver). Change requests and risk dispositions are decided through
-- the canonical approval (approval.decide, SP/BO/FIN since 0031). AUD gets nothing here: every slice H read is
-- transformation.read. No technical_admin role receives any of these (the 0001 trigger refuses a business_approval
-- code for a technical admin).
INSERT INTO permission (code, category, description_en, description_ar) VALUES
  ('phase_step.manage', 'write', 'Assign phase-step owners and start phase steps', 'إسناد مالكي خطوات المرحلة وبدء خطوات المرحلة'),
  ('phase_step.progress', 'write', 'Progress a phase step you own: link evidence and request its review', 'متابعة خطوة مرحلة تملكها: ربط الأدلة وطلب مراجعتها'),
  ('phase_step.review', 'write', 'Accept or return a phase step in the review queue (never your own)', 'قبول خطوة مرحلة في قائمة المراجعة أو إعادتها (ليست خطوتك أبداً)'),
  ('gate.review', 'write', 'Record a per-criterion review of a pending gate submission: finding, open condition, risk, recommendation and rationale', 'تسجيل مراجعة لكل معيار في تقديم بوابة معلّق: الملاحظة والشرط المفتوح والخطر والتوصية والمبرر'),
  ('gate_exception.request', 'write', 'Request an exception (waiver) for a missing mandatory gate criterion', 'طلب استثناء (إعفاء) لمعيار بوابة إلزامي مفقود'),
  ('gate_exception.decide', 'business_approval', 'Accept, reject or revoke a gate exception as the gate''s configured approver', 'قبول استثناء البوابة أو رفضه أو إلغاؤه بصفة المعتمد المُهيّأ للبوابة'),
  ('scale.transition', 'write', 'Scale an initiative into a business unit inside the approved G5 scale scope', 'توسيع مبادرة إلى وحدة أعمال ضمن نطاق التوسع المعتمد في G5'),
  ('risk_disposition.propose', 'write', 'Propose a disposition of an open RAID risk for approval', 'اقتراح معالجة لخطر مفتوح في السجل لاعتمادها'),
  ('change_request.raise', 'write', 'Raise, edit, submit and withdraw change requests to approved records', 'رفع طلبات التغيير على السجلات المعتمدة وتحريرها وتقديمها وسحبها'),
  ('change_control.configure', 'configure', 'Configure the change-control materiality thresholds of a transformation', 'تهيئة حدود الأهمية النسبية لضبط التغيير في التحول');
INSERT INTO role_permission (role_id, permission_code) VALUES
  ('01920000-0000-7000-8000-000000000001', 'phase_step.review'), -- SP
  ('01920000-0000-7000-8000-000000000001', 'gate.review'), -- SP
  ('01920000-0000-7000-8000-000000000001', 'gate_exception.decide'), -- SP
  ('01920000-0000-7000-8000-000000000002', 'phase_step.manage'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'phase_step.progress'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'gate_exception.request'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'scale.transition'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'risk_disposition.propose'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'change_request.raise'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'change_control.configure'), -- TL
  ('01920000-0000-7000-8000-000000000003', 'phase_step.progress'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'phase_step.review'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'gate.review'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'gate_exception.decide'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'risk_disposition.propose'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'change_request.raise'), -- BO
  ('01920000-0000-7000-8000-000000000004', 'phase_step.progress'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'risk_disposition.propose'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'change_request.raise'), -- WL
  ('01920000-0000-7000-8000-000000000005', 'phase_step.progress'), -- FIN
  ('01920000-0000-7000-8000-000000000005', 'phase_step.review'), -- FIN
  ('01920000-0000-7000-8000-000000000005', 'gate.review'), -- FIN
  ('01920000-0000-7000-8000-000000000005', 'change_request.raise'), -- FIN
  ('01920000-0000-7000-8000-000000000006', 'phase_step.manage'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'phase_step.progress'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'phase_step.review'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'gate.review'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'change_request.raise'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'change_control.configure'), -- TO
  ('01920000-0000-7000-8000-000000000007', 'phase_step.progress'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'change_request.raise'); -- KDS
