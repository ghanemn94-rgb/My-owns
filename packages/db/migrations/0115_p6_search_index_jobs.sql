-- 0115 P6 slice H seeds: the two search index jobs (T-DG6-BE-P; ADR-0057 §2; ADR-0053 §1; REQ-S15-010; D-199 item 3).
-- Authored by backend-workflow-engineer. Runs as mth_owner inside one transaction opened by `mth-db migrate` (a job
-- identity is inserted by a migration only: 0101 service_identity_job_by_migration). Forward-only: never edit once
-- merged. SQL floor: PostgreSQL 16. Id: the next above the highest shipped file on this branch (0114, D-196); the
-- orchestrator renumbers at merge if another task shipped a higher id first.
--
-- 1. Two job_schedule rows (the 0028 pattern: each with its audit event, actor system, source migration):
--      search.index_feed  every minute: consumes the audit-event feed per indexed record type (ADR-0057 §2);
--      search.reindex     weekly, Sunday 02:30 Asia/Riyadh, and on demand through the P5 runJobNow (job.repair):
--                         rebuilds the documents of every indexed record type.
--    Both write only search_document and search_index_state (derived, not audited, ADR-0057 §1). Neither approves
--    anything, and nothing here reads or writes DG0-DG7.
-- 2. Their two service identities (the 0114 pattern; apps/worker/src/kit.ts JOB_SERVICE_IDENTITIES declares the same
--    rows and apps/worker/src/service-identities.test.ts compares them): platform scope (one principal per
--    organization), declared and granted `transformation.read` only (the read permission every one of the 12 record
--    views checks), sensitive_access 'none'. THE DECLARED EXCEPTION (ADR-0057 §2; ADR-0051 §2 "unless ADR-0053
--    declares an explicit exception for that job code"; D-199 item 3): these two job codes, and no other, read the
--    ADR-0057 §1 indexed columns (code, title, summary, status) of benefits, business cases and evidence marked
--    sensitive. No value column is read, and every reader is filtered at query time. The exception is stated in each
--    row's `reason` and enforced in code (apps/worker/src/search/documents.ts SEARCH_SENSITIVE_READ_EXCEPTION).
INSERT INTO job_schedule (id, code, queue_name, cron, timezone, description_en, description_ar, owner_module) VALUES
  ('01920006-0115-7000-8000-000000000001', 'search.index_feed', 'search.index_feed', '* * * * *', 'Asia/Riyadh',
   'Keep the search index current from the audit trail: update the search document of every record changed since the last run (ADR-0057 §2). Indexes titles, codes and descriptions only; never approves anything.',
   'تحديث فهرس البحث من سجل التدقيق: تحديث مستند البحث لكل سجل تغيّر منذ آخر تشغيل. يفهرس العناوين والرموز والأوصاف فقط؛ لا يعتمد أي شيء.',
   'search'),
  ('01920006-0115-7000-8000-000000000002', 'search.reindex', 'search.reindex', '30 2 * * 0', 'Asia/Riyadh',
   'Rebuild the search index of every indexed record type from the current records (ADR-0057 §2). Weekly, or on demand by a technical administrator; never approves anything.',
   'إعادة بناء فهرس البحث لكل أنواع السجلات المفهرسة من السجلات الحالية. أسبوعياً أو عند الطلب من المسؤول التقني؛ لا يعتمد أي شيء.',
   'search');
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source)
SELECT mth_uuid_v7(), 'system', 'job_schedule.create', 'job_schedule', s.id, 1, 'migration'
  FROM job_schedule s WHERE s.code IN ('search.index_feed', 'search.reindex');

CREATE TEMPORARY TABLE p6_search_job_identity (id uuid, code text, queue text, codes text[], sensitive text, en text, ar text) ON COMMIT DROP;
INSERT INTO p6_search_job_identity VALUES
  ('01920006-0115-7000-8000-000000000011', 'job:search.index_feed', 'search.index_feed', ARRAY['transformation.read']::text[], 'none', 'Job: search index feed', 'مهمة: تحديث فهرس البحث'),
  ('01920006-0115-7000-8000-000000000012', 'job:search.reindex', 'search.reindex', ARRAY['transformation.read']::text[], 'none', 'Job: search reindex', 'مهمة: إعادة بناء فهرس البحث');

INSERT INTO service_identity (id, code, subject_kind, queue_name, connector_id, scope_level, organization_id,
                              declared_permission_codes, granted_permission_codes, sensitive_access, label_en, label_ar,
                              reason)
SELECT j.id, j.code, 'job', j.queue, NULL, 'platform', NULL, j.codes, j.codes, j.sensitive, j.en, j.ar,
       'Seeded declaration (0115; ADR-0053 §1). Declared exception (ADR-0057 §2, D-199): reads only the indexed '
       || 'columns (code, title, summary, status) of sensitive benefits, business cases and evidence; no value '
       || 'column; every reader is filtered at query time.'
FROM p6_search_job_identity j ORDER BY j.code;

INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source, changes)
SELECT mth_uuid_v7(), 'system', 'service_identity.create', 'service_identity', s.id, 1, 'migration',
       jsonb_build_object(
         'code', jsonb_build_object('from', NULL, 'to', s.code),
         'declared_permission_codes', jsonb_build_object('from', NULL, 'to', to_jsonb(s.declared_permission_codes)),
         'granted_permission_codes', jsonb_build_object('from', NULL, 'to', to_jsonb(s.granted_permission_codes)),
         'sensitive_access', jsonb_build_object('from', NULL, 'to', s.sensitive_access))
FROM service_identity s JOIN p6_search_job_identity j ON j.id = s.id;
