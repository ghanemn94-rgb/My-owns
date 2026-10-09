-- 0043 P4 slice E seeds: the RAID / corrective-action / budget permission catalogue and role defaults, and the slice E
-- work-item kinds (T-DG4-ARCH-04; ADR-0031 §9; REQ-PB-079, REQ-PB-085, REQ-S09-007, REQ-S12-016). Authored by
-- solution-architect. Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit
-- once merged. SQL floor: PostgreSQL 16. Nothing here approves anything, and nothing touches DG0-DG7.

-- -----------------------------------------------------------------------------------------------------------------
-- Work-item kinds (ADR-0025 §4): the follow-up task of a corrective-action case's owner (REQ-PB-085, REQ-S12-016
-- "assign owner and follow-up date") and the task of an action's owner when it is linked to a RAID entry or a case.
INSERT INTO work_item_kind (code, owner_module, label_en, label_ar, source_ref) VALUES
  ('corrective_case_follow_up', 'raid', 'Corrective action to follow up', 'إجراء تصحيحي بانتظار المتابعة', 'M0236'),
  ('raid_action_due', 'raid', 'RAID or recovery action assigned to you', 'إجراء سجل المخاطر أو التعافي مُسند إليك', 'M0143');

-- -----------------------------------------------------------------------------------------------------------------
-- Slice E permission catalogue and role defaults. EXACTLY packages/shared/src/permissions.ts P4_RAID_PERMISSIONS /
-- P4_RAID_ROLE_PERMISSIONS (packages/db/src/seed.test.ts compares them). A CONFIGURABLE STARTING POINT, not a
-- Mobily-approved access policy. Every code is 'write' or 'configure': none is business_approval or
-- finance_validation, so the DG1/DG2 rules keyed on "a role holding an approval permission" (F-DG1-106; ADR-0020 §3)
-- are unchanged. Actions reuse the P2 action.edit / action.update_own; durations reuse the P3 roadmap.edit. No
-- technical_admin role and no AUD role receives any of these (AUD stays read-only).
INSERT INTO permission (code, category, description_en, description_ar) VALUES
  ('raid.edit', 'write', 'Create, edit and close entries of the RAID log (risks, assumptions, issues; dependencies also need dependency.edit)', 'إنشاء مدخلات سجل المخاطر والافتراضات والقضايا والاعتماديات وتحريرها وإغلاقها (تتطلب الاعتماديات أيضًا صلاحية تحرير الاعتماديات)'),
  ('corrective_action.manage', 'write', 'Create, update and close corrective-action cases and recovery plans', 'إنشاء حالات الإجراءات التصحيحية وخطط التعافي وتحديثها وإغلاقها'),
  ('corrective_rule.configure', 'configure', 'Configure the severity and persistence rules that open corrective-action cases', 'ضبط قواعد الشدة والاستمرارية التي تفتح حالات الإجراءات التصحيحية'),
  ('budget.edit', 'write', 'Create and edit initiative budget lines (budget, actual and forecast)', 'إنشاء بنود ميزانية المبادرة وتحريرها (الميزانية والفعلي والمتوقع)');

INSERT INTO role_permission (role_id, permission_code) VALUES
  ('01920000-0000-7000-8000-000000000002', 'raid.edit'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'corrective_action.manage'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'corrective_rule.configure'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'budget.edit'), -- TL
  ('01920000-0000-7000-8000-000000000003', 'corrective_action.manage'), -- BO
  ('01920000-0000-7000-8000-000000000004', 'raid.edit'), -- WL
  ('01920000-0000-7000-8000-000000000005', 'corrective_action.manage'), -- FIN
  ('01920000-0000-7000-8000-000000000005', 'budget.edit'), -- FIN
  ('01920000-0000-7000-8000-000000000006', 'raid.edit'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'corrective_rule.configure'); -- TO
