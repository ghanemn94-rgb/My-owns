-- 0121 P6 slice C: the notification channel fan-out jobs (T-DG6-BE-I2; ADR-0054 §3; ADR-0053 §1; REQ-S12-023;
-- p6-work-split §J/C.11). Authored by backend-workflow-engineer. Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16. Id: the next above the highest
-- shipped file on this branch (0119, D-196); the orchestrator renumbers at merge if another task shipped a higher id
-- first.
--
-- One job schedule and two service identities, one per new queue (the 0114-0117 pattern; apps/worker/src/kit.ts
-- JOB_SERVICE_IDENTITIES declares the same rows and apps/worker/src/service-identities.test.ts compares them):
--   notifications.fanout          the consumer of inbox_notification.created (no schedule). After the producing
--                                 transaction commits, it writes one notification_delivery per ENABLED channel of the
--                                 notification's organization (pending, or skipped with its reason) and sends the
--                                 pending ones outside any transaction. With no channel row it writes nothing (A21).
--   notifications.delivery_sweep  every minute, Asia/Riyadh: fans out the notifications released from quiet hours and
--                                 the digest notifications (ADR-0044 §5: a held notification fans out when released,
--                                 never before), retries the retryable failed deliveries with backoff (ADR-0008 §4: 5
--                                 attempts), and sends a pending delivery left by an interrupted run.
-- Each identity reads the notification, its recipient's address and active grants (whether the recipient can still
-- read the target, ADR-0051 §3) and the organization's channel settings: transformation.read, user.read, access.read
-- and operations.read, all read codes. Neither can hold notification_channel.configure (a configure code; 0101
-- service_identity_permission_category). No schema object changes; nothing here approves anything (no business
-- approval, G1-G6), and nothing reads or writes DG0-DG7.

INSERT INTO job_schedule (id, code, queue_name, cron, timezone, description_en, description_ar, owner_module) VALUES
  ('01920006-0120-7000-8000-000000000011', 'notifications.delivery_sweep', 'notifications.delivery_sweep', '* * * * *', 'Asia/Riyadh',
   'Send external channel deliveries that are due: notifications released from quiet hours or a digest, retries of failed sends with backoff (5 attempts), and sends an interrupted run left pending. The in-app inbox never waits for it. Never approves anything.',
   'إرسال تسليمات القنوات الخارجية المستحقة: الإشعارات المُفرج عنها بعد ساعات الهدوء أو في ملخص، وإعادة محاولة الإرسال الفاشل مع مهلة متزايدة (5 محاولات)، والإرسال الذي تركه تشغيل متوقف معلّقاً. لا ينتظره صندوق الوارد داخل التطبيق. لا يعتمد أي شيء.',
   'tasks');
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source)
SELECT mth_uuid_v7(), 'system', 'job_schedule.create', 'job_schedule', s.id, 1, 'migration'
  FROM job_schedule s WHERE s.code = 'notifications.delivery_sweep';

CREATE TEMPORARY TABLE p6_notification_job_identity (id uuid, code text, queue text, codes text[], sensitive text, en text, ar text) ON COMMIT DROP;
INSERT INTO p6_notification_job_identity VALUES
  ('01920006-0120-7000-8000-000000000021', 'job:notifications.delivery_sweep', 'notifications.delivery_sweep', ARRAY['transformation.read', 'user.read', 'access.read', 'operations.read']::text[], 'none', 'Job: notification delivery sweep', 'مهمة: متابعة تسليم الإشعارات'),
  ('01920006-0120-7000-8000-000000000022', 'job:notifications.fanout', 'notifications.fanout', ARRAY['transformation.read', 'user.read', 'access.read', 'operations.read']::text[], 'none', 'Job: notification channel fan-out', 'مهمة: توزيع الإشعارات على القنوات');

INSERT INTO service_identity (id, code, subject_kind, queue_name, connector_id, scope_level, organization_id,
                              declared_permission_codes, granted_permission_codes, sensitive_access, label_en, label_ar,
                              reason)
SELECT j.id, j.code, 'job', j.queue, NULL, 'platform', NULL, j.codes, j.codes, j.sensitive, j.en, j.ar,
       'Seeded declaration (0121; ADR-0053 §1): the narrowest read set the notification channel job needs.'
FROM p6_notification_job_identity j ORDER BY j.code;

INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source, changes)
SELECT mth_uuid_v7(), 'system', 'service_identity.create', 'service_identity', s.id, 1, 'migration',
       jsonb_build_object(
         'code', jsonb_build_object('from', NULL, 'to', s.code),
         'declared_permission_codes', jsonb_build_object('from', NULL, 'to', to_jsonb(s.declared_permission_codes)),
         'granted_permission_codes', jsonb_build_object('from', NULL, 'to', to_jsonb(s.granted_permission_codes)),
         'sensitive_access', jsonb_build_object('from', NULL, 'to', s.sensitive_access))
FROM service_identity s JOIN p6_notification_job_identity j ON j.id = s.id;
