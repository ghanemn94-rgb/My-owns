-- 0148 P7 slice E: the service identity and the DISABLED weekly schedule of the retention archival job (T-DG7-BE-G;
-- ADR-0067 §4; ADR-0053 §1; ADR-0025 §3; REQ-S16-024; p7-work-split §E.1). Authored by backend-workflow-engineer. Runs
-- as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor:
-- PostgreSQL 16. Id: the next above the highest shipped file on this branch (0147, T-DG7-BE-C; the work split's 0147
-- was taken first, D-245 O9); the orchestrator renumbers at merge if another task shipped 0148.
--
--   job:retention.archive  the consumer of the internal outbox event `retention_run.requested` (createRetentionRun,
--                          createRetentionDryRun) and of its own schedule. Platform scope; declared and granted
--                          `retention.read` only: it writes through the run it was given, the archived-record markers
--                          (re-checked by their trigger) and the purge function retention_purge_record(), never through
--                          a permission (ADR-0067 §4). apps/worker/src/kit.ts JOB_SERVICE_IDENTITIES declares the same
--                          row and apps/worker/src/service-identities.test.ts compares them.
--   job_schedule           `retention.archive`, weekly on Monday at 02:00 Asia/Riyadh, shipped DISABLED (p7-plan §3
--                          seam 4). Every retention class also ships `retain` with no period, so even an enabled
--                          schedule archives and purges nothing until an administrator configures a class.
-- No table is created, so no retention_table_class row is added (p7-work-split §E.7). The seeded texts name no ADR or
-- decision id (the seeded-text scan, REQ-S21-001). Nothing here approves anything (no business, Finance or IT approval;
-- G1-G6), and nothing reads or writes DG0-DG7.

CREATE TEMPORARY TABLE p7_retention_job_identity (id uuid, code text, queue text, codes text[], sensitive text, en text, ar text) ON COMMIT DROP;
INSERT INTO p7_retention_job_identity VALUES
  ('01920007-0148-7000-8000-000000000001', 'job:retention.archive', 'retention.archive', ARRAY['retention.read']::text[], 'none', 'Job: retention archival', 'مهمة: أرشفة الاحتفاظ');

INSERT INTO service_identity (id, code, subject_kind, queue_name, connector_id, scope_level, organization_id,
                              declared_permission_codes, granted_permission_codes, sensitive_access, label_en, label_ar,
                              reason)
SELECT j.id, j.code, 'job', j.queue, NULL, 'platform', NULL, j.codes, j.codes, j.sensitive, j.en, j.ar,
       'Seeded declaration: reads the retention classes; it archives and purges only through the run it was given and the database purge function, and every action is audited.'
FROM p7_retention_job_identity j ORDER BY j.code;

INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source, changes)
SELECT mth_uuid_v7(), 'system', 'service_identity.create', 'service_identity', s.id, 1, 'migration',
       jsonb_build_object(
         'code', jsonb_build_object('from', NULL, 'to', s.code),
         'declared_permission_codes', jsonb_build_object('from', NULL, 'to', to_jsonb(s.declared_permission_codes)),
         'granted_permission_codes', jsonb_build_object('from', NULL, 'to', to_jsonb(s.granted_permission_codes)),
         'sensitive_access', jsonb_build_object('from', NULL, 'to', s.sensitive_access))
FROM service_identity s JOIN p7_retention_job_identity j ON j.id = s.id;

INSERT INTO job_schedule (id, code, queue_name, cron, timezone, enabled, description_en, description_ar, owner_module) VALUES
  ('01920007-0148-7000-8000-000000000011', 'retention.archive', 'retention.archive', '0 2 * * 1', 'Asia/Riyadh', false,
   'Weekly retention run: archive, and where configured delete, operational records past the retention period agreed with IT. Ships disabled; every class ships as Keep. Never approves anything.',
   'عملية احتفاظ أسبوعية: أرشفة السجلات التشغيلية التي تجاوزت مدة الاحتفاظ المتفق عليها مع تقنية المعلومات، وحذفها حيث يُضبط ذلك. تُشحن معطلة، وتُشحن كل فئة بإجراء الاحتفاظ. لا تعتمد أي شيء.',
   'retention');
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source)
SELECT mth_uuid_v7(), 'system', 'job_schedule.create', 'job_schedule', s.id, 1, 'migration'
  FROM job_schedule s WHERE s.code = 'retention.archive';
