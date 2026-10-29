-- 0116 P6 slice B seeds: the connector run jobs (T-DG6-BE-L2; ADR-0055 §2; ADR-0053 §1-§3; REQ-S17-001, REQ-S17-005).
-- Authored by backend-workflow-engineer. Runs as mth_owner inside one transaction opened by `mth-db migrate` (a job
-- identity is inserted by a migration only: 0101 service_identity_job_by_migration). Forward-only: never edit once
-- merged. SQL floor: PostgreSQL 16. Id: the next above the highest shipped file on this branch (0115, D-196); the
-- orchestrator renumbers at merge if another task shipped a higher id first.
--
-- 1. One job_schedule row (the 0028 pattern, with its audit event, actor system, source migration):
--      integrations.connector_run   every minute: creates each enabled pull connector's due cadence slot (hourly,
--                                   daily, weekly) as one queued run `schedule:<connector id>:<slot start>`, once.
--    The queue `integrations.connector_exception` is event-driven (the outbox events connector.run_failed and
--    connector.run_recovered) and has no schedule row.
--    Neither job approves anything (G1-G6), and nothing here reads or writes DG0-DG7.
-- 2. Their two service identities (the 0114/0115 pattern; apps/worker/src/kit.ts JOB_SERVICE_IDENTITIES declares the
--    same rows and apps/worker/src/service-identities.test.ts compares them): platform scope (one principal per
--    organization), sensitive_access 'none';
--      job:integrations.connector_run         declared = granted = {connector.read} (it reads connectors and their
--                                             current configuration; it never configures one);
--      job:integrations.connector_exception   declared = granted = {} (it reads no business record; it writes the
--                                             operational exception of a connector, like the failure-queue consumer).
INSERT INTO job_schedule (id, code, queue_name, cron, timezone, description_en, description_ar, owner_module) VALUES
  ('01920006-0116-7000-8000-000000000001', 'integrations.connector_run', 'integrations.connector_run', '* * * * *',
   'Asia/Riyadh',
   'Queue each enabled connector''s scheduled run (hourly, daily or weekly) once per slot (ADR-0055 §2). Starts connector runs only; never approves anything.',
   'جدولة التشغيل المجدول لكل موصل مفعّل (كل ساعة أو يومياً أو أسبوعياً) مرة واحدة لكل فترة. يبدأ تشغيل الموصلات فقط؛ لا يعتمد أي شيء.',
   'integrations');
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source)
SELECT mth_uuid_v7(), 'system', 'job_schedule.create', 'job_schedule', s.id, 1, 'migration'
  FROM job_schedule s WHERE s.code = 'integrations.connector_run';

CREATE TEMPORARY TABLE p6_connector_job_identity (id uuid, code text, queue text, codes text[], sensitive text, en text, ar text) ON COMMIT DROP;
INSERT INTO p6_connector_job_identity VALUES
  ('01920006-0116-7000-8000-000000000011', 'job:integrations.connector_exception', 'integrations.connector_exception', ARRAY[]::text[], 'none', 'Job: connector run exceptions', 'مهمة: استثناءات تشغيل الموصلات'),
  ('01920006-0116-7000-8000-000000000012', 'job:integrations.connector_run', 'integrations.connector_run', ARRAY['connector.read']::text[], 'none', 'Job: connector cadence schedule', 'مهمة: جدول تشغيل الموصلات');

INSERT INTO service_identity (id, code, subject_kind, queue_name, connector_id, scope_level, organization_id,
                              declared_permission_codes, granted_permission_codes, sensitive_access, label_en, label_ar,
                              reason)
SELECT j.id, j.code, 'job', j.queue, NULL, 'platform', NULL, j.codes, j.codes, j.sensitive, j.en, j.ar,
       'Seeded declaration (0116; ADR-0053 §1, ADR-0055 §2).'
FROM p6_connector_job_identity j ORDER BY j.code;

INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source, changes)
SELECT mth_uuid_v7(), 'system', 'service_identity.create', 'service_identity', s.id, 1, 'migration',
       jsonb_build_object(
         'code', jsonb_build_object('from', NULL, 'to', s.code),
         'declared_permission_codes', jsonb_build_object('from', NULL, 'to', to_jsonb(s.declared_permission_codes)),
         'granted_permission_codes', jsonb_build_object('from', NULL, 'to', to_jsonb(s.granted_permission_codes)),
         'sensitive_access', jsonb_build_object('from', NULL, 'to', s.sensitive_access))
FROM service_identity s JOIN p6_connector_job_identity j ON j.id = s.id;
