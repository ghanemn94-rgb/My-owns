-- 0076 P5 slices D + E seeds: the automation, jobs-repair, notification and condition permission catalogue and its
-- role defaults (T-DG5-ARCH-03; ADR-0043 §8, ADR-0044 §7). Authored by solution-architect. Runs as mth_owner inside
-- one transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- Permissions: EXACTLY packages/shared/src/permissions.ts P5_AUTOMATION_PERMISSIONS / P5_AUTOMATION_ROLE_PERMISSIONS
-- (packages/db/src/seed.test.ts compares them). A CONFIGURABLE STARTING POINT, not a Mobily-approved access policy.
-- No code here is a business_approval or finance_validation code: a route step is decided with the existing
-- approval.decide (a business approval right no technical admin holds), and automation.review is a configuration
-- review, not a business approval. AUD gets automation.read only (read-only everywhere); the jobs view stays job.read
-- (ADM_TECH), so a non-admin gets 403 there (REQ-S12-022). Nothing touches DG0-DG7.
INSERT INTO permission (code, category, description_en, description_ar) VALUES
  ('automation.read', 'read', 'Read automation rules, their versions, executions and the failure queue', 'قراءة قواعد الأتمتة ونسخها وعمليات تنفيذها وقائمة الإخفاقات'),
  ('automation.configure', 'configure', 'Author automation rule versions, dry-run, publish and enable or disable rules', 'إعداد نسخ قواعد الأتمتة وتجربتها ونشرها وتفعيل القواعد أو تعطيلها'),
  ('automation.review', 'write', 'Review an automation rule version before it is published (configuration review)', 'مراجعة نسخة قاعدة أتمتة قبل نشرها (مراجعة إعدادات)'),
  ('automation.repair', 'configure', 'Retry or dismiss failed automation executions in the failure queue', 'إعادة محاولة عمليات الأتمتة المخفقة أو استبعادها من قائمة الإخفاقات'),
  ('job.repair', 'configure', 'Retry or dismiss failed jobs and run a scheduled job now', 'إعادة محاولة المهام المخفقة أو استبعادها وتشغيل مهمة مجدولة الآن'),
  ('notification_policy.configure', 'configure', 'Configure the organization''s notification policy', 'إعداد سياسة الإشعارات للمؤسسة'),
  ('notification.preferences', 'write', 'Set your own quiet hours and digest preferences', 'ضبط ساعات الهدوء وتفضيلات الملخص الخاصة بك'),
  ('gate_condition.close', 'write', 'Close a condition of a conditional approval that you own', 'إغلاق شرط من شروط الاعتماد المشروط تملكه');
INSERT INTO role_permission (role_id, permission_code) VALUES
  ('01920000-0000-7000-8000-000000000001', 'notification.preferences'), -- SP
  ('01920000-0000-7000-8000-000000000001', 'gate_condition.close'), -- SP
  ('01920000-0000-7000-8000-000000000002', 'notification.preferences'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'gate_condition.close'), -- TL
  ('01920000-0000-7000-8000-000000000003', 'notification.preferences'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'gate_condition.close'), -- BO
  ('01920000-0000-7000-8000-000000000004', 'notification.preferences'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'gate_condition.close'), -- WL
  ('01920000-0000-7000-8000-000000000005', 'notification.preferences'), -- FIN
  ('01920000-0000-7000-8000-000000000005', 'gate_condition.close'), -- FIN
  ('01920000-0000-7000-8000-000000000006', 'automation.read'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'automation.review'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'notification.preferences'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'gate_condition.close'), -- TO
  ('01920000-0000-7000-8000-000000000007', 'notification.preferences'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'gate_condition.close'), -- KDS
  ('01920000-0000-7000-8000-000000000008', 'notification.preferences'), -- TD
  ('01920000-0000-7000-8000-000000000008', 'gate_condition.close'), -- TD
  ('01920000-0000-7000-8000-000000000009', 'notification.preferences'), -- CM
  ('01920000-0000-7000-8000-000000000009', 'gate_condition.close'), -- CM
  ('01920000-0000-7000-8000-00000000000a', 'notification.preferences'), -- SEC
  ('01920000-0000-7000-8000-00000000000b', 'automation.read'), -- AUD
  ('01920000-0000-7000-8000-00000000000c', 'automation.read'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'automation.repair'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'job.repair'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'notification_policy.configure'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'notification.preferences'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000d', 'notification.preferences'), -- ADM_ACCESS
  ('01920000-0000-7000-8000-00000000000e', 'automation.read'), -- ADM_METHOD
  ('01920000-0000-7000-8000-00000000000e', 'automation.configure'), -- ADM_METHOD
  ('01920000-0000-7000-8000-00000000000e', 'automation.repair'), -- ADM_METHOD
  ('01920000-0000-7000-8000-00000000000e', 'notification.preferences'); -- ADM_METHOD
