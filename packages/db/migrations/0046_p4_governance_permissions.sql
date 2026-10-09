-- 0046 P4 slice D seeds: the forum / meeting / T16 / escalation permission catalogue and role defaults, and the slice D
-- work-item kinds (T-DG4-ARCH-05; ADR-0032 §9; REQ-PB-060, REQ-PB-068, REQ-PB-081, REQ-S10-005, REQ-S10-011,
-- REQ-S10-012, REQ-S12-011). Authored by solution-architect. Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16. Nothing here approves anything,
-- and nothing touches DG0-DG7.

-- -----------------------------------------------------------------------------------------------------------------
-- Work-item kinds (ADR-0025 §4): an action assigned in a meeting (REQ-S10-011 "actions appear in owners' My Work"),
-- an executive ask awaiting its owner's decision (REQ-PB-081), an expired ask escalated to the next authority
-- (REQ-S12-011), and minutes awaiting the chair's approval (REQ-S10-011).
INSERT INTO work_item_kind (code, owner_module, label_en, label_ar, source_ref) VALUES
  ('meeting_action_due', 'governance', 'Meeting action assigned to you', 'إجراء اجتماع مُسند إليك', 'M0212'),
  ('executive_decision_due', 'governance', 'Executive decision awaiting you', 'قرار تنفيذي بانتظارك', 'M0144'),
  ('executive_decision_escalated', 'governance', 'Overdue executive decision escalated to you', 'قرار تنفيذي متأخر صُعّد إليك', 'M0231'),
  ('minutes_to_approve', 'governance', 'Meeting minutes to approve', 'محضر اجتماع بانتظار الاعتماد', 'M0212');

-- -----------------------------------------------------------------------------------------------------------------
-- Slice D permission catalogue and role defaults. EXACTLY packages/shared/src/permissions.ts P4_GOVERNANCE_PERMISSIONS
-- / P4_GOVERNANCE_ROLE_PERMISSIONS (packages/db/src/seed.test.ts compares them). A CONFIGURABLE STARTING POINT, not a
-- Mobily-approved access policy. One code is a business approval: executive_decision.decide (recording the Outcome of
-- a T16 executive decision), granted only to SP, BO and FIN, the roles that already hold a business_approval or
-- finance_validation code, so the DG1/DG2 rules keyed on "a role holding an approval permission" (F-DG1-106; ADR-0020
-- §3; ADR-0026 §8) are unchanged. Chairing (meeting.chair: publish agenda items, approve and publish minutes) is a
-- 'write' code: minutes are an operational record, not a G1-G6 decision. No technical_admin role and no AUD role
-- receives any of these (AUD stays read-only; the 0001 trigger refuses a business_approval code for a technical admin).
INSERT INTO permission (code, category, description_en, description_ar) VALUES
  ('forum.configure', 'configure', 'Configure governance forums, their participants, quorum, cut-off and agenda rules, and their meeting series', 'ضبط منتديات الحوكمة والمشاركين فيها والنصاب وموعد الإغلاق وقواعد جدول الأعمال وسلاسل اجتماعاتها'),
  ('meeting.prepare', 'write', 'Prepare and run meetings: agenda items, materials, attendance, outputs, blocker status, draft minutes and meeting actions', 'إعداد الاجتماعات وإدارتها: بنود جدول الأعمال والمواد والحضور والمخرجات وحالة العوائق ومسودة المحضر وإجراءات الاجتماع'),
  ('meeting.chair', 'write', 'Chair a meeting: publish agenda items and the agenda, approve and publish the minutes (only as the meeting''s chair)', 'رئاسة الاجتماع: نشر بنود جدول الأعمال والجدول واعتماد المحضر ونشره (بصفة رئيس الاجتماع فقط)'),
  ('executive_decision.create', 'write', 'Raise and complete executive asks in the T16 Executive Decision Log', 'رفع الطلبات التنفيذية واستكمالها في سجل القرارات التنفيذية'),
  ('executive_decision.decide', 'business_approval', 'Record the outcome of an executive decision you own (or decide on behalf of its owner as an active delegate)', 'تسجيل نتيجة قرار تنفيذي تملكه (أو البت فيه نيابة عن مالكه بصفة مفوض نشط)'),
  ('escalation_rule.configure', 'configure', 'Configure the decision-SLA and blocker escalation rules of a transformation', 'ضبط قواعد تصعيد مهلة القرار والعوائق في التحول');

INSERT INTO role_permission (role_id, permission_code) VALUES
  ('01920000-0000-7000-8000-000000000001', 'meeting.chair'), -- SP
  ('01920000-0000-7000-8000-000000000001', 'executive_decision.decide'), -- SP
  ('01920000-0000-7000-8000-000000000002', 'meeting.prepare'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'meeting.chair'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'executive_decision.create'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'escalation_rule.configure'), -- TL
  ('01920000-0000-7000-8000-000000000003', 'meeting.chair'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'executive_decision.decide'), -- BO
  ('01920000-0000-7000-8000-000000000004', 'meeting.chair'), -- WL
  ('01920000-0000-7000-8000-000000000005', 'meeting.chair'), -- FIN
  ('01920000-0000-7000-8000-000000000005', 'executive_decision.decide'), -- FIN
  ('01920000-0000-7000-8000-000000000006', 'forum.configure'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'meeting.prepare'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'meeting.chair'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'executive_decision.create'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'escalation_rule.configure'), -- TO
  ('01920000-0000-7000-8000-00000000000a', 'meeting.prepare'), -- SEC
  ('01920000-0000-7000-8000-00000000000a', 'executive_decision.create'); -- SEC
