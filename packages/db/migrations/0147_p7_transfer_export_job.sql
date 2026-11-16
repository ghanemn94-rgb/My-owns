-- 0147 P7 slice C: the service identity of the migration export job (T-DG7-BE-C; ADR-0064 §7; ADR-0053 §1;
-- REQ-S19-014, REQ-S19-016; p7-work-split §C.1). Authored by backend-workflow-engineer. Runs as mth_owner inside one
-- transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16. Id: the
-- next above the highest shipped file on this branch (0146; the work split's 0136 is below it and the runner refuses
-- an id below the highest applied one, D-245 O9); the orchestrator renumbers at merge if another task shipped 0147.
--
-- One service identity (the 0114-0121 pattern; apps/worker/src/kit.ts JOB_SERVICE_IDENTITIES declares the same row and
-- apps/worker/src/service-identities.test.ts compares them):
--   transfer.export  the consumer of the internal outbox event `migration_export.requested` (no schedule: the job is
--                    enqueued by createMigrationExport, never scheduled, so no job_schedule row). It declares NO
--                    permission code (ADR-0064 §7, D-245 O4): it reads every exported table as the database role, like
--                    a backup, and ADR-0053 scoping does not limit it; the protections are the migration.export right
--                    (ADM_TECH only) that starts it, the audit event of every transition, and that the package stays in
--                    IT-controlled storage (no API operation returns row data or bytes).
-- The seeded reason names no ADR or decision id (the seeded-text scan, REQ-S21-001). No schema object changes. Nothing
-- here approves anything (no business, Finance or IT approval; G1-G6), and nothing
-- reads or writes DG0-DG7.

CREATE TEMPORARY TABLE p7_transfer_job_identity (id uuid, code text, queue text, codes text[], sensitive text, en text, ar text) ON COMMIT DROP;
INSERT INTO p7_transfer_job_identity VALUES
  ('01920007-0147-7000-8000-000000000001', 'job:transfer.export', 'transfer.export', ARRAY[]::text[], 'none', 'Job: migration export', 'مهمة: تصدير الترحيل');

INSERT INTO service_identity (id, code, subject_kind, queue_name, connector_id, scope_level, organization_id,
                              declared_permission_codes, granted_permission_codes, sensitive_access, label_en, label_ar,
                              reason)
SELECT j.id, j.code, 'job', j.queue, NULL, 'platform', NULL, j.codes, j.codes, j.sensitive, j.en, j.ar,
       'Seeded declaration: no permission code. The job reads every exported table as the database role, like a backup; only the migration export right starts it, and every run is audited.'
FROM p7_transfer_job_identity j ORDER BY j.code;

INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source, changes)
SELECT mth_uuid_v7(), 'system', 'service_identity.create', 'service_identity', s.id, 1, 'migration',
       jsonb_build_object(
         'code', jsonb_build_object('from', NULL, 'to', s.code),
         'declared_permission_codes', jsonb_build_object('from', NULL, 'to', to_jsonb(s.declared_permission_codes)),
         'granted_permission_codes', jsonb_build_object('from', NULL, 'to', to_jsonb(s.granted_permission_codes)),
         'sensitive_access', jsonb_build_object('from', NULL, 'to', s.sensitive_access))
FROM service_identity s JOIN p7_transfer_job_identity j ON j.id = s.id;
