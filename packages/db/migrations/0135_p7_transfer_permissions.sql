-- 0135 P7 slices C and D seeds: the migration-transfer and configuration-bundle permission catalogue and its role
-- defaults (T-DG7-ARCH-02; ADR-0064 §9, ADR-0065 §8). Authored by solution-architect. Runs as mth_owner inside one
-- transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- Permissions: EXACTLY packages/shared/src/permissions.ts P7_TRANSFER_PERMISSIONS / P7_TRANSFER_ROLE_PERMISSIONS
-- (packages/db/src/seed.test.ts compares them). A CONFIGURABLE STARTING POINT, not a Mobily-approved access policy.
--   migration.export              request a whole-installation migration export and read its status, manifest and
--                                 attachment manifest (never row data; ADR-0064 §7): ADM_TECH.
--   migration_import.read         read the imports, their reconciliation reports and the identity rebind list (the
--                                 import and the rebind themselves are CLI-only, IT-run; ADR-0064 §6, §8): ADM_TECH,
--                                 ADM_ACCESS and AUD.
--   config_bundle.export          export a configuration bundle and read and download the exports: ADM_TECH, ADM_METHOD.
--   config_bundle.import          upload, validate and commit a configuration bundle and read the imports; the commit
--                                 also needs each item kind's own configure right (ADR-0065 §5): ADM_TECH, ADM_METHOD.
-- No code is a business_approval or finance_validation code, so the technical-admin trigger of 0001 accepts every link
-- (REQ-S10-003). AUD gets a read code only. Nothing touches DG0-DG7.
INSERT INTO permission (code, category, description_en, description_ar) VALUES
  ('migration.export', 'configure', 'Request a whole-installation migration export and read its status and manifests', 'طلب تصدير ترحيل كامل للمنصة وقراءة حالته وبياناته الوصفية'),
  ('migration_import.read', 'read', 'Read migration imports, their reconciliation reports and the identity rebind list', 'قراءة عمليات استيراد الترحيل وتقارير المطابقة وقائمة إعادة ربط الهويات'),
  ('config_bundle.export', 'configure', 'Export a configuration bundle and download it', 'تصدير حزمة إعدادات وتنزيلها'),
  ('config_bundle.import', 'configure', 'Upload, validate and commit a configuration bundle as drafts', 'رفع حزمة إعدادات والتحقق منها واعتمادها كمسودات');
INSERT INTO role_permission (role_id, permission_code) VALUES
  ('01920000-0000-7000-8000-00000000000b', 'migration_import.read'), -- AUD
  ('01920000-0000-7000-8000-00000000000c', 'migration.export'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'migration_import.read'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'config_bundle.export'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'config_bundle.import'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000d', 'migration_import.read'), -- ADM_ACCESS
  ('01920000-0000-7000-8000-00000000000e', 'config_bundle.export'), -- ADM_METHOD
  ('01920000-0000-7000-8000-00000000000e', 'config_bundle.import'); -- ADM_METHOD
