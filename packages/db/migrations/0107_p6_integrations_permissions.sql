-- 0107 P6 slices B and A seeds: the connector, import, webhook, outbound-write and external-change permission catalogue
-- and its role defaults (T-DG6-ARCH-03; ADR-0055 §9, ADR-0056 §9). Authored by solution-architect. Runs as mth_owner
-- inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- Permissions: EXACTLY packages/shared/src/permissions.ts P6_INTEGRATIONS_PERMISSIONS /
-- P6_INTEGRATIONS_ROLE_PERMISSIONS (packages/db/src/seed.test.ts compares them). A CONFIGURABLE STARTING POINT, not a
-- Mobily-approved access policy.
--   connector.read           Administration > Integrations: connectors, configuration versions, runs, counts and errors
--                            (REQ-S17-001 "view-runs:ADM,KDS"): ADM_TECH, KDS, TD, TO and AUD. Never staged row values.
--   connector.configure      create, change, enable, disable and test connectors and their mappings (REQ-S17-001
--                            "configure:ADM"): ADM_TECH.
--   connector.run            run a connector now or retry a failed run: ADM_TECH and KDS.
--   webhook.configure        create, rotate the secret reference of, and disable webhook endpoints: ADM_TECH.
--   import.read              staged batches, rows, row-level reasons and lineage, in the reader's scope: KDS, BO, TO
--                            and AUD.
--   import.create            upload a CSV or XLSX file to staging (REQ-S17-002 "import:KDS,ADM"): KDS.
--   import.commit            commit the valid rows of a staged batch, or cancel it: KDS. The commit ALSO needs the
--                            target's own right at commit time (kpi_actual.submit for KPI actuals).
--   outbound_write.read      outbound writes and their confirmation state: TD, KDS, TO and AUD.
--   outbound_write.execute   execute or re-check a downstream write (REQ-S17-006 "execute-write: explicitly granted role
--                            only"): TD only; implied by no other code.
--   external_change.flag     flag or withdraw a deliverable as an external change: TL, BO, WL and TO.
--   external_change.confirm  confirm an external change with reviewed evidence (REQ-S01-005 "confirm-external: evidence
--                            reviewer (BO or TD)"): BO and TD.
-- The technical administrators (ADM_TECH) get configuration and run rights only: no import, outbound-write or
-- external-change right (REQ-S10-003; no business-record write). No code is a business_approval or finance_validation
-- code, so the technical-admin trigger of 0001 accepts every link. AUD gets read codes only. Nothing touches DG0-DG7.
INSERT INTO permission (code, category, description_en, description_ar) VALUES
  ('connector.read', 'read', 'Read connectors, their configuration versions, runs, row counts, reconciliation and errors', 'قراءة الموصلات وإصدارات إعدادها وعمليات تشغيلها وأعداد الصفوف والمطابقة والأخطاء'),
  ('connector.configure', 'configure', 'Create, change, enable, disable and test connectors and their field mappings', 'إنشاء الموصلات وتعديلها وتفعيلها وتعطيلها واختبارها وتعديل ربط حقولها'),
  ('connector.run', 'write', 'Run a connector now or retry a failed run', 'تشغيل موصل الآن أو إعادة محاولة تشغيل فاشل'),
  ('webhook.configure', 'configure', 'Create webhook endpoints, rotate their secret reference and disable them', 'إنشاء نقاط استقبال الويب هوك وتدوير مرجع السر الخاص بها وتعطيلها'),
  ('import.read', 'read', 'Read staged imports, their rows, row-level reasons and lineage', 'قراءة عمليات الاستيراد المرحلية وصفوفها وأسباب رفض الصفوف ومصدرها'),
  ('import.create', 'write', 'Upload a CSV or XLSX file to an import staging area', 'رفع ملف CSV أو XLSX إلى منطقة الاستيراد المرحلية'),
  ('import.commit', 'write', 'Commit the valid rows of a staged import, or cancel it', 'اعتماد الصفوف الصالحة لعملية استيراد مرحلية أو إلغاؤها'),
  ('outbound_write.read', 'read', 'Read outbound writes and their confirmation state', 'قراءة عمليات الكتابة الصادرة وحالة تأكيدها'),
  ('outbound_write.execute', 'write', 'Execute a downstream write through a connector, or re-check its confirmation', 'تنفيذ عملية كتابة لدى نظام خارجي عبر موصل أو إعادة التحقق من تأكيدها'),
  ('external_change.flag', 'write', 'Flag a deliverable as an external operational change, or withdraw the flag', 'وسم مُخرَج بأنه تغيير تشغيلي خارجي أو سحب الوسم'),
  ('external_change.confirm', 'write', 'Confirm an external change with reviewed evidence', 'تأكيد تغيير خارجي بدليل تمت مراجعته');
INSERT INTO role_permission (role_id, permission_code) VALUES
  ('01920000-0000-7000-8000-000000000002', 'external_change.flag'), -- TL
  ('01920000-0000-7000-8000-000000000003', 'import.read'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'external_change.flag'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'external_change.confirm'), -- BO
  ('01920000-0000-7000-8000-000000000004', 'external_change.flag'), -- WL
  ('01920000-0000-7000-8000-000000000006', 'connector.read'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'import.read'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'outbound_write.read'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'external_change.flag'), -- TO
  ('01920000-0000-7000-8000-000000000007', 'connector.read'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'connector.run'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'import.read'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'import.create'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'import.commit'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'outbound_write.read'), -- KDS
  ('01920000-0000-7000-8000-000000000008', 'connector.read'), -- TD
  ('01920000-0000-7000-8000-000000000008', 'outbound_write.read'), -- TD
  ('01920000-0000-7000-8000-000000000008', 'outbound_write.execute'), -- TD
  ('01920000-0000-7000-8000-000000000008', 'external_change.confirm'), -- TD
  ('01920000-0000-7000-8000-00000000000b', 'connector.read'), -- AUD
  ('01920000-0000-7000-8000-00000000000b', 'import.read'), -- AUD
  ('01920000-0000-7000-8000-00000000000b', 'outbound_write.read'), -- AUD
  ('01920000-0000-7000-8000-00000000000c', 'connector.read'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'connector.configure'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'connector.run'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'webhook.configure'); -- ADM_TECH
