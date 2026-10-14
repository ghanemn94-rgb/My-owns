-- 0087 P5 slices G and H seeds: the KPI restatement, financial-metric, launch-plan, Day-90 test and health-check
-- permission catalogue and its role defaults (T-DG5-ARCH-05; ADR-0047 §6, ADR-0048 §7). Authored by
-- solution-architect. Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit
-- once merged. SQL floor: PostgreSQL 16.
--
-- Permissions: EXACTLY packages/shared/src/permissions.ts P5_KPI_LAUNCH_HEALTH_PERMISSIONS /
-- P5_KPI_LAUNCH_HEALTH_ROLE_PERMISSIONS (packages/db/src/seed.test.ts compares them). A CONFIGURABLE STARTING POINT,
-- not a Mobily-approved access policy. Reading restatements, financial metrics, launch plans, Day-90 tests and health
-- assessments needs transformation.read (DG1) in the transformation; reading the health-check schemes needs a session
-- (REQ-S14-003 "view: all signed-in users"); publishing a scheme uses the slice A Studio rights (methodology.configure,
-- methodology.publish; ADM_METHOD) and its configured review (TO).
-- One code is a business approval: kpi_restatement.approve (D-142 Q10: the approvers of a KPI change request, SP, BO
-- and FIN, the approval.decide holders; never the requester, refused by the API and by the CHECK kpi_restatement_sod).
-- TL holds no business-approval code (ADR-0039 §9: the DG1 creator-derived assignment never derives one). AUD and the
-- technical administrators get no business-approval code (the 0005 trigger refuses it); ADM_METHOD only switches the
-- optional financial extension on or off. AUD gets nothing here and stays read-only. Nothing touches DG0-DG7.
INSERT INTO permission (code, category, description_en, description_ar) VALUES
  ('kpi_restatement.request', 'write', 'Request a retrospective restatement of selected closed periods of a KPI', 'طلب إعادة بيان بأثر رجعي لفترات مغلقة محددة لمؤشر أداء'),
  ('kpi_restatement.approve', 'business_approval', 'Approve or reject a KPI restatement requested by someone else', 'اعتماد أو رفض إعادة بيان مؤشر أداء طلبها شخص آخر'),
  ('financial_metrics.enable', 'configure', 'Switch the optional NPV, ROI and payback extension on or off', 'تشغيل الامتداد الاختياري لصافي القيمة الحالية والعائد على الاستثمار وفترة الاسترداد أو إيقافه'),
  ('financial_metrics.define', 'write', 'Define the methodology, timing and discount-rate assumptions and the cash flows of the financial metrics', 'تحديد افتراضات المنهجية والتوقيت ومعدل الخصم والتدفقات النقدية للمقاييس المالية'),
  ('launch_plan.edit', 'write', 'Generate and edit the 90-day launch plan and its tasks', 'إنشاء خطة الإطلاق لمدة 90 يوماً ومهامها وتعديلها'),
  ('day_ninety_test.respond', 'write', 'Record responses to the Day-90 leadership test', 'تسجيل الإجابات على اختبار القيادة في اليوم 90'),
  ('health_check.assess', 'write', 'Answer and submit a transformation health check', 'الإجابة على فحص صحة التحول وتقديمه');
INSERT INTO role_permission (role_id, permission_code) VALUES
  ('01920000-0000-7000-8000-000000000001', 'kpi_restatement.approve'), -- SP
  ('01920000-0000-7000-8000-000000000001', 'day_ninety_test.respond'), -- SP
  ('01920000-0000-7000-8000-000000000002', 'kpi_restatement.request'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'launch_plan.edit'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'day_ninety_test.respond'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'health_check.assess'), -- TL
  ('01920000-0000-7000-8000-000000000003', 'kpi_restatement.request'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'kpi_restatement.approve'), -- BO
  ('01920000-0000-7000-8000-000000000005', 'kpi_restatement.request'), -- FIN
  ('01920000-0000-7000-8000-000000000005', 'kpi_restatement.approve'), -- FIN
  ('01920000-0000-7000-8000-000000000005', 'financial_metrics.define'), -- FIN
  ('01920000-0000-7000-8000-000000000006', 'launch_plan.edit'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'health_check.assess'), -- TO
  ('01920000-0000-7000-8000-000000000007', 'kpi_restatement.request'), -- KDS
  ('01920000-0000-7000-8000-00000000000e', 'financial_metrics.enable'); -- ADM_METHOD
