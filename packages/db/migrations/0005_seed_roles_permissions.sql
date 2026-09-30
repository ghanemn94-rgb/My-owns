-- 0005 role and permission seed (T-DG1-BE; ADR-0006). EXACTLY packages/shared/src/permissions.ts:
-- a unit test (packages/db/src/seed.test.ts) and an integration test compare this file and the seeded rows
-- with that module. These defaults are a CONFIGURABLE STARTING POINT, not a Mobily-approved access policy.
-- Arabic names and descriptions are provisional translations that need linguistic review.
-- Role IDs are fixed literal UUIDs (version-7 layout) so every installation has the same catalogue IDs.

INSERT INTO permission (code, category, description_en, description_ar) VALUES
  ('organization.read', 'read', 'Read organization settings', 'عرض إعدادات المؤسسة'),
  ('organization.manage', 'configure', 'Create and update organizations', 'إنشاء المؤسسات وتحديثها'),
  ('business_unit.read', 'read', 'Read business units', 'عرض وحدات الأعمال'),
  ('business_unit.manage', 'configure', 'Create and update business units', 'إنشاء وحدات الأعمال وتحديثها'),
  ('user.read', 'read', 'Read user accounts', 'عرض حسابات المستخدمين'),
  ('user.manage', 'configure', 'Create, update and disable user accounts', 'إنشاء حسابات المستخدمين وتحديثها وتعطيلها'),
  ('role.read', 'read', 'Read the role and permission catalogue', 'عرض دليل الأدوار والصلاحيات'),
  ('access.read', 'read', 'Read scoped role assignments', 'عرض إسنادات الأدوار ضمن النطاق'),
  ('access.assign', 'configure', 'Grant and revoke scoped role assignments', 'منح إسنادات الأدوار ضمن النطاق وإلغاؤها'),
  ('transformation.read', 'read', 'Read transformation records', 'عرض سجلات التحول'),
  ('transformation.create', 'write', 'Create transformation records', 'إنشاء سجلات التحول'),
  ('transformation.update', 'write', 'Update transformation records', 'تحديث سجلات التحول'),
  ('transformation.archive', 'write', 'Archive transformation records', 'أرشفة سجلات التحول'),
  ('audit.read', 'read', 'Read the audit trail of business records', 'عرض سجل التدقيق لسجلات الأعمال'),
  ('gate.decide', 'business_approval', 'Decide product gates G1-G6 (business approval)', 'اتخاذ قرار بوابات المنتج G1-G6 (اعتماد أعمال)'),
  ('finance.validate', 'finance_validation', 'Validate financial values (Finance only)', 'التحقق من القيم المالية (المالية فقط)');

INSERT INTO role (id, code, name_en, name_ar, kind, inherits_downward, is_system) VALUES
  ('01920000-0000-7000-8000-000000000001', 'SP', 'Executive Sponsor', 'الراعي التنفيذي', 'source', false, true),
  ('01920000-0000-7000-8000-000000000002', 'TL', 'Transformation Lead', 'قائد التحول', 'source', false, true),
  ('01920000-0000-7000-8000-000000000003', 'BO', 'Business Owner', 'مالك الأعمال', 'source', false, true),
  ('01920000-0000-7000-8000-000000000004', 'WL', 'Workstream Lead', 'قائد مسار العمل', 'source', false, true),
  ('01920000-0000-7000-8000-000000000005', 'FIN', 'Finance / Value Office', 'المالية / مكتب القيمة', 'source', false, true),
  ('01920000-0000-7000-8000-000000000006', 'TO', 'Transformation Office', 'مكتب التحول', 'source', true, true),
  ('01920000-0000-7000-8000-000000000007', 'KDS', 'KPI/Data Steward', 'أمين بيانات مؤشرات الأداء', 'implementation', false, true),
  ('01920000-0000-7000-8000-000000000008', 'TD', 'Tech/Data Contributor', 'مساهم التقنية والبيانات', 'implementation', false, true),
  ('01920000-0000-7000-8000-000000000009', 'CM', 'Committee Member', 'عضو اللجنة', 'implementation', false, true),
  ('01920000-0000-7000-8000-00000000000a', 'SEC', 'Committee Secretary', 'أمين سر اللجنة', 'implementation', false, true),
  ('01920000-0000-7000-8000-00000000000b', 'AUD', 'Read-only Auditor', 'مدقق (قراءة فقط)', 'implementation', true, true),
  ('01920000-0000-7000-8000-00000000000c', 'ADM_TECH', 'Technical Administrator', 'المسؤول التقني', 'technical_admin', false, true),
  ('01920000-0000-7000-8000-00000000000d', 'ADM_ACCESS', 'Access Administrator', 'مسؤول الصلاحيات', 'technical_admin', false, true),
  ('01920000-0000-7000-8000-00000000000e', 'ADM_METHOD', 'Methodology Administrator', 'مسؤول المنهجية', 'technical_admin', false, true);

INSERT INTO role_permission (role_id, permission_code) VALUES
  ('01920000-0000-7000-8000-000000000001', 'organization.read'), -- SP
  ('01920000-0000-7000-8000-000000000001', 'business_unit.read'), -- SP
  ('01920000-0000-7000-8000-000000000001', 'role.read'), -- SP
  ('01920000-0000-7000-8000-000000000001', 'transformation.read'), -- SP
  ('01920000-0000-7000-8000-000000000001', 'gate.decide'), -- SP
  ('01920000-0000-7000-8000-000000000002', 'organization.read'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'business_unit.read'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'role.read'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'transformation.read'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'transformation.create'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'transformation.update'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'transformation.archive'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'audit.read'), -- TL
  ('01920000-0000-7000-8000-000000000003', 'organization.read'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'business_unit.read'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'role.read'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'transformation.read'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'gate.decide'), -- BO
  ('01920000-0000-7000-8000-000000000004', 'organization.read'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'business_unit.read'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'role.read'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'transformation.read'), -- WL
  ('01920000-0000-7000-8000-000000000005', 'organization.read'), -- FIN
  ('01920000-0000-7000-8000-000000000005', 'business_unit.read'), -- FIN
  ('01920000-0000-7000-8000-000000000005', 'role.read'), -- FIN
  ('01920000-0000-7000-8000-000000000005', 'transformation.read'), -- FIN
  ('01920000-0000-7000-8000-000000000005', 'finance.validate'), -- FIN
  ('01920000-0000-7000-8000-000000000006', 'organization.read'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'business_unit.read'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'role.read'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'transformation.read'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'transformation.create'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'transformation.update'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'transformation.archive'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'audit.read'), -- TO
  ('01920000-0000-7000-8000-000000000007', 'organization.read'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'business_unit.read'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'role.read'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'transformation.read'), -- KDS
  ('01920000-0000-7000-8000-000000000008', 'organization.read'), -- TD
  ('01920000-0000-7000-8000-000000000008', 'business_unit.read'), -- TD
  ('01920000-0000-7000-8000-000000000008', 'role.read'), -- TD
  ('01920000-0000-7000-8000-000000000008', 'transformation.read'), -- TD
  ('01920000-0000-7000-8000-000000000009', 'organization.read'), -- CM
  ('01920000-0000-7000-8000-000000000009', 'business_unit.read'), -- CM
  ('01920000-0000-7000-8000-000000000009', 'role.read'), -- CM
  ('01920000-0000-7000-8000-000000000009', 'transformation.read'), -- CM
  ('01920000-0000-7000-8000-00000000000a', 'organization.read'), -- SEC
  ('01920000-0000-7000-8000-00000000000a', 'business_unit.read'), -- SEC
  ('01920000-0000-7000-8000-00000000000a', 'role.read'), -- SEC
  ('01920000-0000-7000-8000-00000000000a', 'transformation.read'), -- SEC
  ('01920000-0000-7000-8000-00000000000b', 'organization.read'), -- AUD
  ('01920000-0000-7000-8000-00000000000b', 'business_unit.read'), -- AUD
  ('01920000-0000-7000-8000-00000000000b', 'role.read'), -- AUD
  ('01920000-0000-7000-8000-00000000000b', 'transformation.read'), -- AUD
  ('01920000-0000-7000-8000-00000000000b', 'audit.read'), -- AUD
  ('01920000-0000-7000-8000-00000000000b', 'user.read'), -- AUD
  ('01920000-0000-7000-8000-00000000000b', 'access.read'), -- AUD
  ('01920000-0000-7000-8000-00000000000c', 'organization.read'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'organization.manage'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'business_unit.read'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'business_unit.manage'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'role.read'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000d', 'organization.read'), -- ADM_ACCESS
  ('01920000-0000-7000-8000-00000000000d', 'business_unit.read'), -- ADM_ACCESS
  ('01920000-0000-7000-8000-00000000000d', 'role.read'), -- ADM_ACCESS
  ('01920000-0000-7000-8000-00000000000d', 'user.read'), -- ADM_ACCESS
  ('01920000-0000-7000-8000-00000000000d', 'user.manage'), -- ADM_ACCESS
  ('01920000-0000-7000-8000-00000000000d', 'access.read'), -- ADM_ACCESS
  ('01920000-0000-7000-8000-00000000000d', 'access.assign'), -- ADM_ACCESS
  ('01920000-0000-7000-8000-00000000000e', 'organization.read'), -- ADM_METHOD
  ('01920000-0000-7000-8000-00000000000e', 'role.read'); -- ADM_METHOD
