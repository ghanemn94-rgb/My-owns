-- 0100 P6 slices E and F seeds: the access-boundary and hardening permission catalogue and its role defaults
-- (T-DG6-ARCH-01; ADR-0051 §7, ADR-0052 §9). Authored by solution-architect. Runs as mth_owner inside one transaction
-- opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- Permissions: EXACTLY packages/shared/src/permissions.ts P6_ACCESS_HARDENING_PERMISSIONS /
-- P6_ACCESS_HARDENING_ROLE_PERMISSIONS (packages/db/src/seed.test.ts compares them). A CONFIGURABLE STARTING POINT, not a
-- Mobily-approved access policy.
--   sensitive_record.grant   mark a benefit, business case or evidence sensitive, and grant or revoke explicit access to
--                            it (REQ-S10-002 "grant:TO,ADM (access admin)"): TO and ADM_ACCESS.
--   sensitive_record.read    read sensitivity flags and the grant list (metadata only; never the record itself): TO,
--                            AUD and ADM_ACCESS.
--   audit_event.read         the global audit list /api/v1/audit-events and Administration > Audit (REQ-S16-032
--                            "view:AUD,ADM(scoped)"): AUD, ADM_TECH and ADM_ACCESS.
--   upload_policy.configure  read and change the upload allow-list and size limit (REQ-S13-011): ADM_TECH.
--   security.read            read the upload policy and the rate-limit matrix (Administration > Security): ADM_TECH, AUD.
-- No code is a business_approval or finance_validation code, so the technical-admin trigger of 0001 accepts every link
-- (REQ-S10-003). AUD gets read codes only. Nothing touches DG0-DG7.
INSERT INTO permission (code, category, description_en, description_ar) VALUES
  ('sensitive_record.grant', 'configure', 'Mark a benefit, business case or evidence item as sensitive, and grant or revoke explicit access to it', 'تمييز منفعة أو دراسة جدوى أو دليل كسجل حساس، ومنح صلاحية الوصول الصريحة إليه أو سحبها'),
  ('sensitive_record.read', 'read', 'Read which records are sensitive and who holds an explicit grant (not the records themselves)', 'قراءة السجلات الحساسة ومن يملك صلاحية صريحة عليها (دون السجلات نفسها)'),
  ('audit_event.read', 'read', 'Read the audit trail in Administration > Audit, within the assigned scope', 'قراءة سجل التدقيق في الإدارة > التدقيق ضمن النطاق المسند'),
  ('upload_policy.configure', 'configure', 'Change the allowed upload file types and the upload size limit', 'تعديل أنواع الملفات المسموح برفعها والحد الأقصى لحجم الملف'),
  ('security.read', 'read', 'Read the upload policy and the rate-limit settings', 'قراءة سياسة رفع الملفات وإعدادات حدود معدل الطلبات');
INSERT INTO role_permission (role_id, permission_code) VALUES
  ('01920000-0000-7000-8000-000000000006', 'sensitive_record.grant'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'sensitive_record.read'), -- TO
  ('01920000-0000-7000-8000-00000000000b', 'sensitive_record.read'), -- AUD
  ('01920000-0000-7000-8000-00000000000b', 'audit_event.read'), -- AUD
  ('01920000-0000-7000-8000-00000000000b', 'security.read'), -- AUD
  ('01920000-0000-7000-8000-00000000000c', 'audit_event.read'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'upload_policy.configure'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'security.read'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000d', 'sensitive_record.grant'), -- ADM_ACCESS
  ('01920000-0000-7000-8000-00000000000d', 'sensitive_record.read'), -- ADM_ACCESS
  ('01920000-0000-7000-8000-00000000000d', 'audit_event.read'); -- ADM_ACCESS
