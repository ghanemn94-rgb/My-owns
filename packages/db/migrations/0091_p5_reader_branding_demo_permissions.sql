-- 0091 P5 slices I and J seeds: the branding and demo-reset permission catalogue and its role defaults
-- (T-DG5-ARCH-06; ADR-0049 §10, ADR-0050 §8). Authored by solution-architect. Runs as mth_owner inside one transaction
-- opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- Permissions: EXACTLY packages/shared/src/permissions.ts P5_READER_DEMO_PERMISSIONS / P5_READER_DEMO_ROLE_PERMISSIONS
-- (packages/db/src/seed.test.ts compares them). A CONFIGURABLE STARTING POINT, not a Mobily-approved access policy.
-- Reading the playbook reader, the provenance, the element profiles, the branding, the navigation, the environment and
-- the walkthrough needs a session only (REQ-PB-001/PB-002/PB-011/S02-004/S03-010/S15-004 "view: all signed-in users").
-- Editing the reader texts, provenance overrides, question tags and block links uses the slice A Studio rights
-- (methodology.configure, methodology.publish; ADM_METHOD) through a published version. Both codes below are
-- 'configure' codes for the technical administrator ADM_TECH; neither is a business approval or a Finance validation.
-- AUD gets nothing here and stays read-only. Nothing touches DG0-DG7.
INSERT INTO permission (code, category, description_en, description_ar) VALUES
  ('branding.configure', 'configure', 'Edit and publish the branding settings: product name, logo, colours, fonts and report header and footer', 'تعديل إعدادات الهوية ونشرها: اسم المنتج والشعار والألوان والخطوط وترويسة التقارير وتذييلها'),
  ('demo.reset', 'configure', 'Read the demo environment status and reset the demo environment to its seeded state', 'قراءة حالة بيئة العرض التوضيحي وإعادة ضبطها إلى حالتها المزروعة');
INSERT INTO role_permission (role_id, permission_code) VALUES
  ('01920000-0000-7000-8000-00000000000c', 'branding.configure'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'demo.reset'); -- ADM_TECH
