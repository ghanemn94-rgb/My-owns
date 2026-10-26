-- 0103 P6 slices J and C seeds: the operations, service-identity, identity, storage and notification-channel permission
-- catalogue and its role defaults (T-DG6-ARCH-02; ADR-0053 §9, ADR-0054 §5). Authored by solution-architect. Runs as
-- mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor:
-- PostgreSQL 16.
--
-- Permissions: EXACTLY packages/shared/src/permissions.ts P6_OPERATIONS_CHANNELS_PERMISSIONS /
-- P6_OPERATIONS_CHANNELS_ROLE_PERMISSIONS (packages/db/src/seed.test.ts compares them). A CONFIGURABLE STARTING POINT,
-- not a Mobily-approved access policy.
--   operations.read                read Administration > Operations: operational exceptions, the worker heartbeat and
--                                  the service identities (REQ-S12-019 "An exception is shown to admins and data
--                                  owners"): ADM_TECH, TO, KDS, TD and AUD.
--   operations.acknowledge         acknowledge or resolve an operational exception: ADM_TECH and KDS.
--   service_identity.configure     narrow or restore the permissions granted to a job's or connector's service identity
--                                  (REQ-S16-029 "configure:ADM(IT)"): ADM_TECH.
--   identity.read                  read Administration > Identity (issuer, client id, scopes, claim mapping; never the
--                                  client secret) (REQ-S16-007): ADM_TECH, ADM_ACCESS and AUD.
--   storage.configure              read, change and test the evidence-storage setting (REQ-S16-006 "configure:ADM(IT)"):
--                                  ADM_TECH.
--   notification_channel.configure read, change and test notification channels (REQ-S12-023 "configure-channels:ADM"):
--                                  ADM_TECH.
-- No code is a business_approval or finance_validation code, so the technical-admin trigger of 0001 accepts every link
-- (REQ-S10-003). AUD gets read codes only. Nothing touches DG0-DG7.
INSERT INTO permission (code, category, description_en, description_ar) VALUES
  ('operations.read', 'read', 'Read operational exceptions, the worker heartbeat and the service identities in Administration > Operations', 'قراءة الاستثناءات التشغيلية ونبض العامل وهويات الخدمة في الإدارة > العمليات'),
  ('operations.acknowledge', 'write', 'Acknowledge or resolve an operational exception', 'الإقرار باستثناء تشغيلي أو إغلاقه'),
  ('service_identity.configure', 'configure', 'Narrow or restore the permissions granted to a job or connector service identity', 'تقييد الصلاحيات الممنوحة لهوية خدمة مهمة أو موصل أو استعادتها'),
  ('identity.read', 'read', 'Read the identity-provider settings in Administration > Identity (never the client secret)', 'قراءة إعدادات مزود الهوية في الإدارة > الهوية (دون السر الخاص بالعميل)'),
  ('storage.configure', 'configure', 'Read, change and test the evidence-storage setting', 'قراءة إعداد تخزين الأدلة وتعديله واختباره'),
  ('notification_channel.configure', 'configure', 'Read, change and test the email and enterprise-messaging notification channels', 'قراءة قنوات الإشعار عبر البريد الإلكتروني والمراسلة المؤسسية وتعديلها واختبارها');
INSERT INTO role_permission (role_id, permission_code) VALUES
  ('01920000-0000-7000-8000-000000000006', 'operations.read'), -- TO
  ('01920000-0000-7000-8000-000000000007', 'operations.read'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'operations.acknowledge'), -- KDS
  ('01920000-0000-7000-8000-000000000008', 'operations.read'), -- TD
  ('01920000-0000-7000-8000-00000000000b', 'operations.read'), -- AUD
  ('01920000-0000-7000-8000-00000000000b', 'identity.read'), -- AUD
  ('01920000-0000-7000-8000-00000000000c', 'operations.read'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'operations.acknowledge'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'service_identity.configure'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'identity.read'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'storage.configure'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'notification_channel.configure'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000d', 'identity.read'); -- ADM_ACCESS
