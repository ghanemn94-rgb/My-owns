-- 0113 P6 slice J seeds: one service identity per job queue (T-DG6-BE-J; ADR-0053 §1; REQ-S16-029; D-195 Q13).
-- Authored by backend-workflow-engineer. Runs as mth_owner inside one transaction opened by `mth-db migrate` (a job
-- identity is inserted by a migration only: 0101 service_identity_job_by_migration). Forward-only: never edit once
-- merged. SQL floor: PostgreSQL 16. Id: the next above the highest shipped file on this branch (0112, D-196); the
-- orchestrator renumbers at merge if another task shipped a higher id first.
--
-- Rows: EXACTLY apps/worker/src/kit.ts JOB_SERVICE_IDENTITIES, one per queue of apps/worker/src/queues/** (40 at this
-- revision; apps/worker/src/service-identities.test.ts compares the two). Each row declares the narrowest set of READ
-- codes its DG4/DG5 handler needs, platform scope (the job builds one principal per organization), and the grant equal
-- to the declaration. Administrators may later narrow or restore the grant (putServiceIdentity); the declaration
-- changes only through a new migration. No code is configure, business_approval or finance_validation (the 0101 guard
-- refuses those, also here): a service identity never approves anything and nothing here touches DG0-DG7. Two
-- identities admit sensitive records into aggregates only (`aggregate_only`: the benefit recalculations, so totals stay
-- identical for every reader, D-195 Q3); every other identity excludes sensitive records (`none`).
-- Each row has its audit event (actor system, source migration) in this transaction (p2_attach_guards, ADR-0004).
CREATE TEMPORARY TABLE p6_job_identity (id uuid, code text, queue text, codes text[], sensitive text, en text, ar text) ON COMMIT DROP;
INSERT INTO p6_job_identity VALUES
  ('01920006-0113-7000-8000-000000000001', 'job:adoption.indicator_evaluated', 'adoption.indicator_evaluated', ARRAY['transformation.read', 'user.read']::text[], 'none', 'Job: adoption indicator evaluation', 'مهمة: تقييم مؤشرات التبني'),
  ('01920006-0113-7000-8000-000000000002', 'job:approval.escalation_scan', 'approval.escalation_scan', ARRAY['transformation.read', 'access.read']::text[], 'none', 'Job: approval escalation scan', 'مهمة: فحص تصعيد الاعتمادات'),
  ('01920006-0113-7000-8000-000000000003', 'job:automation.evaluate', 'automation.evaluate', ARRAY['transformation.read', 'automation.read']::text[], 'none', 'Job: automation rule evaluation', 'مهمة: تقييم قواعد الأتمتة'),
  ('01920006-0113-7000-8000-000000000004', 'job:automation.failure_retry', 'automation.failure_retry', ARRAY['automation.read', 'job.read']::text[], 'none', 'Job: failure-queue retry', 'مهمة: إعادة محاولة قائمة الإخفاقات'),
  ('01920006-0113-7000-8000-000000000005', 'job:automation.job_failed', 'automation.job_failed', ARRAY['job.read']::text[], 'none', 'Job: job failure recording', 'مهمة: تسجيل إخفاق المهام'),
  ('01920006-0113-7000-8000-000000000006', 'job:automation.tick_daily', 'automation.tick_daily', ARRAY['transformation.read', 'automation.read']::text[], 'none', 'Job: daily automation tick', 'مهمة: دورة الأتمتة اليومية'),
  ('01920006-0113-7000-8000-000000000007', 'job:automation.tick_hourly', 'automation.tick_hourly', ARRAY['transformation.read', 'automation.read']::text[], 'none', 'Job: hourly automation tick', 'مهمة: دورة الأتمتة كل ساعة'),
  ('01920006-0113-7000-8000-000000000008', 'job:benefits.finance_queue', 'benefits.finance_queue', ARRAY['transformation.read', 'access.read']::text[], 'none', 'Job: Finance validation queue routing', 'مهمة: توجيه قائمة التحقق المالي'),
  ('01920006-0113-7000-8000-000000000009', 'job:benefits.recalculate_pending', 'benefits.recalculate_pending', ARRAY['transformation.read']::text[], 'aggregate_only', 'Job: benefit recalculation', 'مهمة: إعادة حساب المنافع'),
  ('01920006-0113-7000-8000-00000000000a', 'job:benefits.value_decided', 'benefits.value_decided', ARRAY['transformation.read']::text[], 'aggregate_only', 'Job: benefit value decision follow-up', 'مهمة: متابعة قرار قيمة المنفعة'),
  ('01920006-0113-7000-8000-00000000000b', 'job:branding.published', 'branding.published', ARRAY['organization.read']::text[], 'none', 'Job: branding publication', 'مهمة: نشر الهوية البصرية'),
  ('01920006-0113-7000-8000-00000000000c', 'job:delegation.expiry_sweep', 'delegation.expiry_sweep', ARRAY['access.read']::text[], 'none', 'Job: delegation expiry sweep', 'مهمة: إنهاء التفويضات المنتهية'),
  ('01920006-0113-7000-8000-00000000000d', 'job:demo.reset', 'demo.reset', ARRAY['organization.read', 'transformation.read']::text[], 'none', 'Job: demo environment reset', 'مهمة: إعادة ضبط بيئة العرض'),
  ('01920006-0113-7000-8000-00000000000e', 'job:gate.condition_escalation_scan', 'gate.condition_escalation_scan', ARRAY['transformation.read', 'access.read']::text[], 'none', 'Job: gate condition escalation scan', 'مهمة: فحص تصعيد شروط البوابات'),
  ('01920006-0113-7000-8000-00000000000f', 'job:gate.exception_expiry_scan', 'gate.exception_expiry_scan', ARRAY['transformation.read']::text[], 'none', 'Job: gate exception expiry scan', 'مهمة: فحص انتهاء استثناءات البوابات'),
  ('01920006-0113-7000-8000-000000000010', 'job:gates.decided', 'gates.decided', ARRAY['transformation.read']::text[], 'none', 'Job: gate decision follow-up', 'مهمة: متابعة قرار البوابة'),
  ('01920006-0113-7000-8000-000000000011', 'job:gates.submitted', 'gates.submitted', ARRAY['transformation.read', 'access.read']::text[], 'none', 'Job: gate submission routing', 'مهمة: توجيه تقديم البوابة'),
  ('01920006-0113-7000-8000-000000000012', 'job:governance.blocker_escalation', 'governance.blocker_escalation', ARRAY['transformation.read', 'access.read']::text[], 'none', 'Job: blocker escalation', 'مهمة: تصعيد العوائق'),
  ('01920006-0113-7000-8000-000000000013', 'job:governance.blocker_escalation_scan', 'governance.blocker_escalation_scan', ARRAY['transformation.read', 'access.read']::text[], 'none', 'Job: blocker escalation scan', 'مهمة: فحص تصعيد العوائق'),
  ('01920006-0113-7000-8000-000000000014', 'job:governance.decision_sla_scan', 'governance.decision_sla_scan', ARRAY['transformation.read', 'access.read']::text[], 'none', 'Job: decision SLA scan', 'مهمة: فحص مهل القرارات'),
  ('01920006-0113-7000-8000-000000000015', 'job:governance.meeting_cutoff_scan', 'governance.meeting_cutoff_scan', ARRAY['transformation.read', 'access.read']::text[], 'none', 'Job: meeting cut-off scan', 'مهمة: فحص مواعيد إقفال الاجتماعات'),
  ('01920006-0113-7000-8000-000000000016', 'job:governance.meeting_series_generate', 'governance.meeting_series_generate', ARRAY['transformation.read']::text[], 'none', 'Job: meeting series generation', 'مهمة: إنشاء سلاسل الاجتماعات'),
  ('01920006-0113-7000-8000-000000000017', 'job:job_schedule.updated', 'job_schedule.updated', ARRAY['job.read']::text[], 'none', 'Job: schedule re-registration', 'مهمة: إعادة تسجيل الجداول'),
  ('01920006-0113-7000-8000-000000000018', 'job:jobs.run_now', 'jobs.run_now', ARRAY['job.read']::text[], 'none', 'Job: run-now dispatch', 'مهمة: تشغيل المهمة الآن'),
  ('01920006-0113-7000-8000-000000000019', 'job:kpi.recalculate', 'kpi.recalculate', ARRAY['transformation.read']::text[], 'none', 'Job: KPI recalculation', 'مهمة: إعادة حساب مؤشرات الأداء'),
  ('01920006-0113-7000-8000-00000000001a', 'job:kpi.reporting_period_open', 'kpi.reporting_period_open', ARRAY['transformation.read']::text[], 'none', 'Job: reporting period opening', 'مهمة: فتح فترة التقارير'),
  ('01920006-0113-7000-8000-00000000001b', 'job:launch.day_ninety_tests', 'launch.day_ninety_tests', ARRAY['transformation.read']::text[], 'none', 'Job: day-90 tests', 'مهمة: اختبارات اليوم التسعين'),
  ('01920006-0113-7000-8000-00000000001c', 'job:maintenance.purge_expired', 'maintenance.purge_expired', '{}'::text[], 'none', 'Job: expired session purge', 'مهمة: حذف الجلسات المنتهية'),
  ('01920006-0113-7000-8000-00000000001d', 'job:notification.digest', 'notification.digest', ARRAY['user.read']::text[], 'none', 'Job: notification digest', 'مهمة: ملخص الإشعارات'),
  ('01920006-0113-7000-8000-00000000001e', 'job:ops.failed', 'ops.failed', '{}'::text[], 'none', 'Queue: failed jobs (dead letter)', 'قائمة: المهام المخفقة'),
  ('01920006-0113-7000-8000-00000000001f', 'job:portfolio.dependency_slip', 'portfolio.dependency_slip', ARRAY['transformation.read']::text[], 'none', 'Job: dependency slip follow-up', 'مهمة: متابعة تأخر الاعتماديات'),
  ('01920006-0113-7000-8000-000000000020', 'job:raid.corrective_adoption', 'raid.corrective_adoption', ARRAY['transformation.read', 'user.read']::text[], 'none', 'Job: corrective action for adoption', 'مهمة: إجراء تصحيحي للتبني'),
  ('01920006-0113-7000-8000-000000000021', 'job:raid.corrective_benefit', 'raid.corrective_benefit', ARRAY['transformation.read', 'user.read']::text[], 'none', 'Job: corrective action for a benefit', 'مهمة: إجراء تصحيحي لمنفعة'),
  ('01920006-0113-7000-8000-000000000022', 'job:raid.corrective_control', 'raid.corrective_control', ARRAY['transformation.read', 'user.read']::text[], 'none', 'Job: corrective action for a control', 'مهمة: إجراء تصحيحي لضابط'),
  ('01920006-0113-7000-8000-000000000023', 'job:raid.corrective_kpi', 'raid.corrective_kpi', ARRAY['transformation.read', 'user.read']::text[], 'none', 'Job: corrective action for a KPI', 'مهمة: إجراء تصحيحي لمؤشر أداء'),
  ('01920006-0113-7000-8000-000000000024', 'job:reports.export', 'reports.export', ARRAY['transformation.read']::text[], 'none', 'Job: report export', 'مهمة: تصدير التقارير'),
  ('01920006-0113-7000-8000-000000000025', 'job:reports.owner_update_tasks', 'reports.owner_update_tasks', ARRAY['transformation.read']::text[], 'none', 'Job: owner update tasks', 'مهمة: مهام تحديث المالكين'),
  ('01920006-0113-7000-8000-000000000026', 'job:sustainment.control_check_scan', 'sustainment.control_check_scan', ARRAY['transformation.read']::text[], 'none', 'Job: control check scan', 'مهمة: فحص فحوص الضوابط'),
  ('01920006-0113-7000-8000-000000000027', 'job:sustainment.review_scan', 'sustainment.review_scan', ARRAY['transformation.read']::text[], 'none', 'Job: performance review scan', 'مهمة: فحص مراجعات الأداء'),
  ('01920006-0113-7000-8000-000000000028', 'job:transformation.created', 'transformation.created', ARRAY['transformation.read', 'access.read', 'methodology.read']::text[], 'none', 'Job: new transformation set-up', 'مهمة: إعداد تحول جديد');

INSERT INTO service_identity (id, code, subject_kind, queue_name, connector_id, scope_level, organization_id,
                              declared_permission_codes, granted_permission_codes, sensitive_access, label_en, label_ar,
                              reason)
SELECT j.id, j.code, 'job', j.queue, NULL, 'platform', NULL, j.codes, j.codes, j.sensitive, j.en, j.ar,
       'Seeded declaration (0113; ADR-0053 §1): the narrowest set of read permissions the DG5 handler needs.'
FROM p6_job_identity j ORDER BY j.code;

INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source, changes)
SELECT mth_uuid_v7(), 'system', 'service_identity.create', 'service_identity', s.id, 1, 'migration',
       jsonb_build_object(
         'code', jsonb_build_object('from', NULL, 'to', s.code),
         'declared_permission_codes', jsonb_build_object('from', NULL, 'to', to_jsonb(s.declared_permission_codes)),
         'granted_permission_codes', jsonb_build_object('from', NULL, 'to', to_jsonb(s.granted_permission_codes)),
         'sensitive_access', jsonb_build_object('from', NULL, 'to', s.sensitive_access))
FROM service_identity s JOIN p6_job_identity j ON j.id = s.id;
