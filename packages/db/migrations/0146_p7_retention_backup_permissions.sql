-- 0146 P7 slice E seeds: the retention and backup-status permission catalogue and its role defaults (T-DG7-ARCH-03;
-- ADR-0067 §8, ADR-0066 §6). Authored by solution-architect. Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- Permissions: EXACTLY packages/shared/src/permissions.ts P7_RETENTION_PERMISSIONS / P7_RETENTION_ROLE_PERMISSIONS
-- (packages/db/src/seed.test.ts compares them). A CONFIGURABLE STARTING POINT, not a Mobily-approved access policy.
--   retention.read       read the retention classes, runs, run actions and archived-record markers: ADM_TECH,
--                        ADM_ACCESS and AUD.
--   retention.configure  change a class's action, period and IT approval reference text (If-Match): ADM_TECH. The
--                        reference records an approval given outside the platform; holding this code approves nothing.
--   retention.run        request a dry run or a run of the retention job: ADM_TECH.
--   backup.read          read the backup sets the backup job reported (status, checksums, counts; no content):
--                        ADM_TECH and AUD.
-- No code is a business_approval or finance_validation code, so the technical-admin trigger of 0001 accepts every link
-- (REQ-S10-003). AUD gets read codes only. Nothing touches DG0-DG7.
INSERT INTO permission (code, category, description_en, description_ar) VALUES
  ('retention.read', 'read', 'Read retention classes, runs, their actions and archived records', 'قراءة فئات الاحتفاظ وعملياتها وإجراءاتها والسجلات المؤرشفة'),
  ('retention.configure', 'configure', 'Change a retention class action, period and IT approval reference', 'تغيير إجراء فئة الاحتفاظ ومدتها ومرجع موافقة تقنية المعلومات'),
  ('retention.run', 'configure', 'Request a retention dry run or run', 'طلب تشغيل تجريبي أو فعلي لمهمة الاحتفاظ'),
  ('backup.read', 'read', 'Read the backup sets reported by the backup job', 'قراءة مجموعات النسخ الاحتياطي التي أبلغت عنها مهمة النسخ');
INSERT INTO role_permission (role_id, permission_code) VALUES
  ('01920000-0000-7000-8000-00000000000b', 'retention.read'), -- AUD
  ('01920000-0000-7000-8000-00000000000b', 'backup.read'), -- AUD
  ('01920000-0000-7000-8000-00000000000c', 'retention.read'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'retention.configure'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'retention.run'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'backup.read'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000d', 'retention.read'); -- ADM_ACCESS
