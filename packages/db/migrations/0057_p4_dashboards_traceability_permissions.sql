-- 0057 P4 slices J and K seeds: the dashboard, traceability, inherited-record, portfolio and workstream permission
-- catalogue and role defaults (T-DG4-ARCH-08; ADR-0037 §8, ADR-0038 §8; REQ-PB-005, REQ-PB-044, REQ-PB-063,
-- REQ-S03-001, REQ-S03-005, REQ-S03-006). Authored by solution-architect. Runs as mth_owner inside one transaction
-- opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- EXACTLY packages/shared/src/permissions.ts P4_DASHBOARD_TRACE_PERMISSIONS / P4_DASHBOARD_TRACE_ROLE_PERMISSIONS
-- (packages/db/src/seed.test.ts compares them). A CONFIGURABLE STARTING POINT, not a Mobily-approved access policy.
-- None of these codes is a business approval or a Finance validation: every dashboard, My Work, workspace-header,
-- traceability, orphan, missing-link and impact read is transformation.read (or the caller's own items), which AUD
-- already holds read-only. AUD gets no code here. No technical_admin role receives any of these. Nothing touches DG0-DG7.
INSERT INTO permission (code, category, description_en, description_ar) VALUES
  ('traceability.link', 'write', 'Create, edit and remove traceability links and their contribution and allocation shares', 'إنشاء روابط التتبع وتحريرها وإزالتها مع بيانات المساهمة وحصص التخصيص'),
  ('inherited_record.record', 'write', 'Record and withdraw inherited evidence and baselines of a Modular entry (never an approval)', 'تسجيل الأدلة وخطوط الأساس الموروثة في الدخول المرحلي وسحبها (ليست اعتماداً أبداً)'),
  ('workstream.manage', 'write', 'Create and edit workstreams and assign initiatives to them', 'إنشاء مسارات العمل وتحريرها وإسناد المبادرات إليها'),
  ('portfolio.manage', 'configure', 'Create and edit portfolios and place transformations in them', 'إنشاء المحافظ وتحريرها ووضع التحولات فيها'),
  ('dashboard.configure', 'configure', 'Configure the dashboard RAG thresholds of the organization', 'تهيئة حدود حالات RAG للوحات المعلومات في المنظمة');
INSERT INTO role_permission (role_id, permission_code) VALUES
  ('01920000-0000-7000-8000-000000000002', 'traceability.link'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'inherited_record.record'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'workstream.manage'), -- TL
  ('01920000-0000-7000-8000-000000000003', 'traceability.link'), -- BO
  ('01920000-0000-7000-8000-000000000004', 'traceability.link'), -- WL
  ('01920000-0000-7000-8000-000000000006', 'traceability.link'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'inherited_record.record'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'workstream.manage'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'portfolio.manage'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'dashboard.configure'), -- TO
  ('01920000-0000-7000-8000-000000000007', 'dashboard.configure'); -- KDS
