-- 0082 P5 slice F seeds: the report, export and owner-update permission catalogue and its role defaults
-- (T-DG5-ARCH-04; ADR-0045 §8, ADR-0046 §6). Authored by solution-architect. Runs as mth_owner inside one transaction
-- opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- Permissions: EXACTLY packages/shared/src/permissions.ts P5_REPORTING_PERMISSIONS / P5_REPORTING_ROLE_PERMISSIONS
-- (packages/db/src/seed.test.ts compares them). A CONFIGURABLE STARTING POINT, not a Mobily-approved access policy.
-- Reading live reports, snapshots, presentations, owner updates and the evidence register needs transformation.read
-- (DG1) in the transformation: the same right as the records they show. No code here is a business_approval or
-- finance_validation code: issuing a report snapshot freezes what the records said, it approves nothing. AUD and the
-- technical administrators get none of these codes (AUD stays read-only; it reads through transformation.read).
-- Nothing touches DG0-DG7.
INSERT INTO permission (code, category, description_en, description_ar) VALUES
  ('report.generate', 'write', 'Generate a report snapshot from the records you can view', 'إنشاء لقطة تقرير من السجلات التي يمكنك عرضها'),
  ('report.issue', 'write', 'Issue, reissue or discard a report snapshot', 'إصدار لقطة تقرير أو إعادة إصدارها أو استبعادها'),
  ('export.create', 'write', 'Export a report snapshot you can view as PDF, DOCX, XLSX, PPTX or CSV', 'تصدير لقطة تقرير يمكنك عرضها بصيغة PDF أو DOCX أو XLSX أو PPTX أو CSV'),
  ('owner_update.submit', 'write', 'Write and submit the structured update of a subject you own', 'كتابة التحديث المنظَّم لموضوع تملكه وتقديمه');
INSERT INTO role_permission (role_id, permission_code) VALUES
  ('01920000-0000-7000-8000-000000000001', 'report.generate'), -- SP
  ('01920000-0000-7000-8000-000000000001', 'export.create'), -- SP
  ('01920000-0000-7000-8000-000000000002', 'report.generate'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'report.issue'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'export.create'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'owner_update.submit'), -- TL
  ('01920000-0000-7000-8000-000000000003', 'report.generate'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'export.create'), -- BO
  ('01920000-0000-7000-8000-000000000004', 'report.generate'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'export.create'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'owner_update.submit'), -- WL
  ('01920000-0000-7000-8000-000000000005', 'report.generate'), -- FIN
  ('01920000-0000-7000-8000-000000000005', 'export.create'), -- FIN
  ('01920000-0000-7000-8000-000000000006', 'report.generate'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'report.issue'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'export.create'), -- TO
  ('01920000-0000-7000-8000-000000000007', 'report.generate'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'export.create'), -- KDS
  ('01920000-0000-7000-8000-000000000008', 'report.generate'), -- TD
  ('01920000-0000-7000-8000-000000000008', 'export.create'), -- TD
  ('01920000-0000-7000-8000-000000000009', 'report.generate'), -- CM
  ('01920000-0000-7000-8000-000000000009', 'export.create'), -- CM
  ('01920000-0000-7000-8000-00000000000a', 'report.generate'), -- SEC
  ('01920000-0000-7000-8000-00000000000a', 'report.issue'), -- SEC
  ('01920000-0000-7000-8000-00000000000a', 'export.create'); -- SEC
