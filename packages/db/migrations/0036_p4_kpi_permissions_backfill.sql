-- 0036 P4 slice A seeds and backfill: the kpi_version_activation approval type, the KPI work-item kinds, the slice A
-- permission catalogue and role defaults, and a one-time copy of approved DG2 T02 trajectories into target_trajectory
-- (T-DG4-ARCH-02; ADR-0027 §2, §5, §6, §11; p4-plan seam 7, D-089). Authored by solution-architect. Runs as mth_owner
-- inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
-- Nothing here approves anything new: the backfill copies approvals that named people already gave on DG2 outcome_kpi
-- rows (approver and time preserved), and no job or trigger here grants an approval. Nothing touches DG0-DG7.

-- -----------------------------------------------------------------------------------------------------------------
-- A KPI version whose definition_approval is 'business_approval' is activated only after this approval (ADR-0026 §4
-- engine; the Business Owner by default, REQ-S07-001 "approve-definition:BO (per approval policy)").
INSERT INTO approval_type (code, subject_table, default_sod_policy, requires_decision_right, owner_module, label_en, label_ar, source_ref) VALUES
  ('kpi_version_activation', 'kpi_version', 'requester_excluded', false, 'kpi', 'KPI definition version approval', 'اعتماد نسخة تعريف مؤشر الأداء', 'M0158;M0163');

INSERT INTO work_item_kind (code, owner_module, label_en, label_ar, source_ref) VALUES
  ('kpi_actual_review', 'kpi', 'KPI actual to review', 'قيمة فعلية لمؤشر أداء بانتظار المراجعة', 'M0162'),
  ('kpi_actual_rejected', 'kpi', 'KPI actual returned for correction', 'قيمة فعلية لمؤشر أداء أُعيدت للتصحيح', 'M0162');

-- -----------------------------------------------------------------------------------------------------------------
-- Slice A permission catalogue and role defaults. EXACTLY packages/shared/src/permissions.ts P4_KPI_PERMISSIONS /
-- P4_KPI_ROLE_PERMISSIONS (packages/db/src/seed.test.ts compares them). A CONFIGURABLE STARTING POINT, not a
-- Mobily-approved access policy. Every code is 'write' or 'configure': none is business_approval or
-- finance_validation, so the DG1/DG2 rules keyed on "a role holding an approval permission" (F-DG1-106; ADR-0020 §3)
-- are unchanged. Trajectory approval reuses the DG2 business approval kpi_target.approve (SP, BO). No technical_admin
-- role and no AUD role receives any of these (AUD stays read-only).
INSERT INTO permission (code, category, description_en, description_ar) VALUES
  ('kpi_version.edit', 'write', 'Create and edit draft KPI definition versions: measure type, aggregation, data-quality rule and submission route', 'إنشاء نسخ مسودة لتعريف مؤشر الأداء وتحريرها: نوع القياس والتجميع وقاعدة جودة البيانات ومسار التقديم'),
  ('kpi_version.activate', 'write', 'Activate a KPI definition version (directly, or after its business approval)', 'تفعيل نسخة تعريف مؤشر الأداء (مباشرة أو بعد اعتماد الأعمال)'),
  ('kpi_threshold.configure', 'write', 'Set a new version of a KPI''s RAG thresholds', 'تعيين نسخة جديدة من حدود حالة مؤشر الأداء (أحمر/أصفر/أخضر)'),
  ('target_trajectory.edit', 'write', 'Create and edit draft target trajectories', 'إنشاء مسارات الأهداف المسودة وتحريرها'),
  ('reporting_period.manage', 'configure', 'Create, open and close reporting periods', 'إنشاء فترات التقارير وفتحها وإغلاقها'),
  ('kpi_actual.submit', 'write', 'Enter and submit KPI actuals with evidence', 'إدخال القيم الفعلية لمؤشرات الأداء مع الأدلة وتقديمها'),
  ('kpi_actual.accept', 'write', 'Accept or reject submitted KPI actuals as the configured reviewer', 'قبول القيم الفعلية المقدمة لمؤشرات الأداء أو رفضها بصفتك المراجع المحدد'),
  ('rag.override', 'write', 'Override a calculated RAG with reason, evidence and expiry', 'تجاوز حالة المؤشر المحسوبة مع ذكر السبب والدليل وتاريخ الانتهاء'),
  ('data_quality.manage', 'write', 'Resolve or dismiss data-quality findings', 'معالجة ملاحظات جودة البيانات أو استبعادها');

INSERT INTO role_permission (role_id, permission_code) VALUES
  ('01920000-0000-7000-8000-000000000001', 'kpi_actual.accept'), -- SP
  ('01920000-0000-7000-8000-000000000002', 'kpi_version.edit'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'kpi_version.activate'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'kpi_threshold.configure'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'target_trajectory.edit'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'kpi_actual.accept'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'rag.override'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'data_quality.manage'), -- TL
  ('01920000-0000-7000-8000-000000000003', 'kpi_actual.submit'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'kpi_actual.accept'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'rag.override'), -- BO
  ('01920000-0000-7000-8000-000000000006', 'reporting_period.manage'), -- TO
  ('01920000-0000-7000-8000-000000000007', 'kpi_version.edit'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'kpi_version.activate'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'kpi_threshold.configure'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'target_trajectory.edit'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'kpi_actual.submit'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'data_quality.manage'); -- KDS

-- -----------------------------------------------------------------------------------------------------------------
-- One-time backfill (p4-plan seam 7, additive form): every ACTIVE outcome_kpi row whose DG2 trajectory is approved and
-- has at least one point becomes an approved target_trajectory (scope = the transformation, basis 'period', linear) with
-- the same points, created by the outcome_kpi row's creator and approved by its DG2 approver at the DG2 approval time.
-- When several outcome_kpi rows of one KPI are approved, only the most recently approved one is copied (one approved
-- trajectory per KPI and scope). Values are copied verbatim. The outcome_kpi rows are not changed. Each copy writes two
-- audit events (create, approve) with actor 'system' and source 'migration'.
DO $$
DECLARE
  r record;
  tid uuid;
  pt record;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (ok.kpi_definition_id) ok.*
    FROM outcome_kpi ok
    WHERE ok.status = 'active' AND ok.trajectory_status = 'approved' AND jsonb_array_length(ok.trajectory_points) > 0
    ORDER BY ok.kpi_definition_id, ok.trajectory_approved_at DESC, ok.id DESC
  LOOP
    tid := mth_uuid_v7();
    INSERT INTO target_trajectory (id, organization_id, transformation_id, kpi_definition_id, scope_kind, scope_id, version_no,
                                   source, source_outcome_kpi_id, created_by, updated_by)
    VALUES (tid, r.organization_id, r.transformation_id, r.kpi_definition_id, 'transformation', r.transformation_id,
            (SELECT coalesce(max(x.version_no), 0) + 1 FROM target_trajectory x
             WHERE x.kpi_definition_id = r.kpi_definition_id AND x.scope_kind = 'transformation' AND x.scope_id = r.transformation_id),
            'outcome_kpi_backfill', r.id, r.created_by, r.created_by);
    INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, action, record_type, record_id, new_version, source, changes)
    VALUES (mth_uuid_v7(), r.organization_id, r.transformation_id, 'system', 'target_trajectory.backfill', 'target_trajectory', tid, 1,
            'migration', jsonb_build_object('sourceOutcomeKpiId', r.id));
    FOR pt IN
      SELECT DISTINCT ON ((p->>'date')::date) (p->>'date')::date AS d, (p->>'value')::numeric(24,6) AS v
      FROM jsonb_array_elements(r.trajectory_points) p
      WHERE p ? 'date' AND p ? 'value' AND p->>'value' IS NOT NULL
      ORDER BY (p->>'date')::date
    LOOP
      INSERT INTO target_trajectory_point (id, organization_id, transformation_id, target_trajectory_id, point_date, expected_value, created_by)
      VALUES (mth_uuid_v7(), r.organization_id, r.transformation_id, tid, pt.d, pt.v, r.created_by);
    END LOOP;
    UPDATE target_trajectory
    SET status = 'approved', approved_by = r.trajectory_approved_by, approved_at = r.trajectory_approved_at,
        approved_record_version = 1, version = 2, updated_by = r.trajectory_approved_by, updated_at = now()
    WHERE id = tid;
    INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, action, record_type, record_id, prior_version,
                             new_version, source, changes)
    VALUES (mth_uuid_v7(), r.organization_id, r.transformation_id, 'system', 'target_trajectory.backfill_approved', 'target_trajectory',
            tid, 1, 2, 'migration', jsonb_build_object('approvedBy', r.trajectory_approved_by, 'approvedAt', r.trajectory_approved_at));
  END LOOP;
END $$;
