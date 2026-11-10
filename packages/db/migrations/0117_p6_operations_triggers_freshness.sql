-- 0117 P6 slice J: the operations catalogue triggers, starter 16 version 2, the KPI freshness scan and the exception
-- alert sweep (T-DG6-BE-K2; ADR-0053 §2, §3, §6; ADR-0044 §1; REQ-S12-019; p6-work-split §J/C.4). Authored by
-- backend-workflow-engineer. Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never
-- edit once merged. SQL floor: PostgreSQL 16. Id: the next above the highest shipped file on this branch (0115, D-196);
-- the orchestrator renumbers at merge if another task shipped a higher id first.
--
-- 1. Two catalogue triggers (ADR-0053 §3; additive; admin-selectable; source M0239), each fed to automation.evaluate
--    (apps/worker queues/automation.ts AUTOMATION_EVENT_TRIGGERS):
--      connector.run_failed  event, integrations, condition fields {connectorId, failureClass}; emitted by the
--                            connector run on failure (ADR-0055, slice B);
--      data.stale            event, kpi, condition fields {kpiId}; emitted by the kpi.freshness_scan job once per
--                            stale episode of a KPI (its DG4 freshness became `stale`).
-- 2. The starter version guard (0074 automation_rule_version_guard) is redefined with ONE change, in the D-142 Q3
--    starter clause: the trigger set a starter keeps is that of its latest version that ran (published or superseded),
--    no longer always version 1's, and only a migration may seed a version whose trigger set ADDS to it. Everything
--    else in the function is 0074's text unchanged. For every starter whose only run version is 1 (all sixteen until
--    this file) the rule is exactly 0074's; the API's own check already compares with the current content
--    (apps/api automation/versions.ts validateContent), so the two now agree after a later version too.
-- 3. Starter 16 (`starter.job_failed`, M0239) gets a seeded, published version 2 whose triggers are {job.failed,
--    connector.run_failed, data.stale} and whose handler opens or recurs the operational exception (ADR-0053 §2):
--    job.failed keeps its version-1 handler (the failure capture, whose kit hook raises the `job_failed` exception);
--    data.stale runs `operations.exception_raise` (the `data_stale` exception, linked to its KPI). Version 1 becomes
--    `superseded` and stays as published history, unchanged in content. The rule stays a guarantee (enabled, not
--    disableable), owned by ADM_METHOD; each changed row has its audit event (actor system, source migration).
-- 4. Two job schedules and three service identities, one per new queue (the 0114/0115 pattern; apps/worker/src/kit.ts
--    JOB_SERVICE_IDENTITIES declares the same rows and apps/worker/src/service-identities.test.ts compares them):
--      kpi.freshness_scan          hourly at minute 25, Asia/Riyadh: reads DG4 freshness (unchanged; ADR-0028) through
--                                  its service principal; never writes a KPI value or freshness label;
--      operations.exception_alerts every minute: one alert per OPENED exception (ADR-0053 §6), none per recurrence;
--    and the event queue operations.exception_raise (consumer of data.stale; no schedule).
-- Nothing here approves anything: an operational exception is not a business approval (G1-G6), no identity holds a
-- configure, business-approval or Finance-validation code (0101 guard), and nothing reads or writes DG0-DG7.

-- ---------------------------------------------------------------------------------------------------------------- 1
INSERT INTO automation_trigger (code, trigger_kind, owner_module, label_en, label_ar, condition_fields, initiating_user_field, admin_selectable, source_ref) VALUES
  ('connector.run_failed', 'event', 'integrations', 'Connector run fails', 'إخفاق تشغيل موصل', '{connectorId,failureClass}', NULL, true, 'M0239'),
  ('data.stale', 'event', 'kpi', 'KPI data becomes stale', 'تقادم بيانات مؤشر الأداء', '{kpiId}', NULL, true, 'M0239');

-- ---------------------------------------------------------------------------------------------------------------- 2
CREATE OR REPLACE FUNCTION automation_rule_version_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  r record;
  t record;
  bad text;
  base text[];
  triggers_changed boolean;
  is_owner boolean := current_user = 'mth_owner' OR current_user IN (SELECT rolname FROM pg_roles WHERE rolsuper);
BEGIN
  SELECT a.origin, a.code INTO r FROM automation_rule a WHERE a.id = NEW.automation_rule_id;
  -- Every trigger is catalogued (an array cannot carry a foreign key).
  SELECT string_agg(u.code, ', ') INTO bad FROM unnest(NEW.trigger_codes) AS u(code)
    LEFT JOIN automation_trigger g ON g.code = u.code WHERE g.code IS NULL;
  IF bad IS NOT NULL OR (SELECT count(DISTINCT u.code) FROM unnest(NEW.trigger_codes) AS u(code)) <> cardinality(NEW.trigger_codes) THEN
    RAISE EXCEPTION 'automation_rule_version: trigger % is unknown or repeated', coalesce(bad, '(repeated)')
      USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'automation_rule_version_trigger_known';
  END IF;
  SELECT bool_and(g.admin_selectable) AS admin_selectable, bool_and(g.initiating_user_field IS NOT NULL) AS has_user
    INTO t FROM automation_trigger g WHERE g.code = ANY (NEW.trigger_codes);
  -- REQ-S12-026: a human decision is never an automated action.
  SELECT string_agg(c.code, ', ') INTO bad FROM unnest(NEW.action_types) AS u(code)
    LEFT JOIN automation_action_type c ON c.code = u.code
    WHERE c.code IS NULL OR c.action_class = 'human_only';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'automation_rule_version: action % is unknown or a human decision (M0242)', bad
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_human_only';
  END IF;
  -- An admin rule uses admin-selectable triggers and actions only; starter versions are seeded by migrations.
  IF r.origin = 'admin' THEN
    IF NOT t.admin_selectable OR EXISTS (SELECT 1 FROM unnest(NEW.action_types) AS u(code)
         JOIN automation_action_type c ON c.code = u.code WHERE NOT c.admin_selectable) THEN
      RAISE EXCEPTION 'automation_rule_version: an admin rule uses a starter-only trigger or action'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_admin_catalogue';
    END IF;
  ELSE
    IF TG_OP = 'INSERT' AND NOT is_owner AND NEW.version_no = 1 THEN
      RAISE EXCEPTION 'automation_rule_version: version 1 of a starter is seeded by a migration'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_starter_seed';
    END IF;
    -- D-142 Q3: a starter keeps its trigger and its handler, and takes no condition (a condition could suppress a
    -- guarantee); only its declared parameters change in a new version (ADR-0044 §1).
    -- 0117 (T-DG6-BE-K2; ADR-0053 §3): the trigger set a starter keeps is that of its latest version that ran
    -- (published or superseded) below NEW: version 1's until a migration publishes another. Only a migration (the
    -- owner) may seed a version that ADDS triggers to that set (starter 16 version 2: job.failed, connector.run_failed,
    -- data.stale); the API never can, and no trigger is ever removed. The set is checked when it is written (an insert,
    -- or an update that changes it), so a status change of an earlier version is unaffected.
    IF TG_OP = 'INSERT' THEN
      triggers_changed := true;
    ELSE
      triggers_changed := NEW.trigger_codes IS DISTINCT FROM OLD.trigger_codes;
    END IF;
    base := coalesce((SELECT v.trigger_codes FROM automation_rule_version v WHERE v.automation_rule_id = NEW.automation_rule_id
                        AND v.version_no < NEW.version_no AND v.status IN ('published', 'superseded')
                      ORDER BY v.version_no DESC LIMIT 1), NEW.trigger_codes);
    IF NEW.conditions <> '[]'::jsonb OR NEW.action_types <> ARRAY['starter_handler'] OR (triggers_changed AND NOT (
         NEW.trigger_codes IS NOT DISTINCT FROM base OR (is_owner AND NEW.trigger_codes @> base))) THEN
      RAISE EXCEPTION 'automation_rule_version: a starter keeps its trigger and handler and has no conditions'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_starter_fixed';
    END IF;
  END IF;
  -- Running as the initiating user needs a trigger that names one (REQ-S12-003).
  IF NEW.run_as = 'initiating_user' AND NOT t.has_user THEN
    RAISE EXCEPTION 'automation_rule_version: a trigger of % has no initiating user', NEW.trigger_codes
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_initiating_user';
  END IF;
  -- A service identity never holds a business-approval or Finance-validation permission (REQ-S10-003, REQ-S12-026).
  SELECT string_agg(u.code, ', ') INTO bad FROM unnest(NEW.service_permission_codes) AS u(code)
    LEFT JOIN permission p ON p.code = u.code
    WHERE p.code IS NULL OR p.category IN ('business_approval', 'finance_validation');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'automation_rule_version: service permission % is unknown or an approval right', bad
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_service_permission';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.version_no <> coalesce((SELECT max(v.version_no) FROM automation_rule_version v
                                   WHERE v.automation_rule_id = NEW.automation_rule_id), 0) + 1 THEN
      RAISE EXCEPTION 'automation_rule_version: version_no must be the next number of the rule'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_next_number';
    END IF;
    IF NEW.status <> 'draft' AND NOT is_owner THEN
      RAISE EXCEPTION 'automation_rule_version: a new version starts as a draft'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_transition';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.automation_rule_id IS DISTINCT FROM OLD.automation_rule_id OR NEW.version_no IS DISTINCT FROM OLD.version_no
     OR NEW.authored_by IS DISTINCT FROM OLD.authored_by THEN
    RAISE EXCEPTION 'automation_rule_version: rule, number and author never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_identity_fixed';
  END IF;
  IF OLD.status <> 'draft' AND (NEW.trigger_codes, NEW.conditions, NEW.actions, NEW.action_types, NEW.run_as,
       NEW.service_permission_codes, NEW.parameters, NEW.content_sha256)
     IS DISTINCT FROM (OLD.trigger_codes, OLD.conditions, OLD.actions, OLD.action_types, OLD.run_as,
       OLD.service_permission_codes, OLD.parameters, OLD.content_sha256) THEN
    RAISE EXCEPTION 'automation_rule_version: content changes only in a draft (published versions are immutable)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_content_frozen';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'draft' AND NEW.status IN ('in_review', 'published', 'discarded'))
       OR (OLD.status = 'in_review' AND NEW.status IN ('approved', 'draft', 'discarded'))
       OR (OLD.status = 'approved' AND NEW.status IN ('published', 'draft', 'discarded'))
       OR (OLD.status = 'published' AND NEW.status = 'superseded')) THEN
    RAISE EXCEPTION 'automation_rule_version: % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_transition';
  END IF;
  -- Leaving a draft needs a pass dry run for exactly this content (REQ-S12-002).
  IF OLD.status = 'draft' AND NEW.status IN ('in_review', 'published') AND NOT EXISTS (
       SELECT 1 FROM automation_dry_run d WHERE d.automation_rule_version_id = NEW.id
         AND d.content_sha256 = NEW.content_sha256 AND d.outcome = 'pass') THEN
    RAISE EXCEPTION 'automation_rule_version: no pass dry run for the current content'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_dry_run_required';
  END IF;
  -- Review where configured (config_review_policy 'automation_rule_set', ADR-0039 §5): publishing straight from a
  -- draft is allowed only when the policy requires no review.
  IF OLD.status = 'draft' AND NEW.status = 'published'
     AND coalesce((SELECT p.review_required FROM config_review_policy p WHERE p.config_kind = 'automation_rule_set'), true) THEN
    RAISE EXCEPTION 'automation_rule_version: the configured review is required before publish'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_review_required';
  END IF;
  IF OLD.status = 'in_review' AND NEW.status = 'approved' AND NEW.reviewed_by IS NULL THEN
    RAISE EXCEPTION 'automation_rule_version: an approved review names its reviewer'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_reviewed_complete';
  END IF;
  -- A superseded version is replaced by the newer published version in the same transaction.
  IF NEW.status = 'superseded' AND OLD.status = 'published' AND NOT EXISTS (
       SELECT 1 FROM automation_rule_version v WHERE v.automation_rule_id = NEW.automation_rule_id
         AND v.version_no > NEW.version_no AND v.status = 'published') THEN
    RAISE EXCEPTION 'automation_rule_version: only a newer published version supersedes this one'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_transition';
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------------------------------------------- 3
-- Statement order of a publish (ADR-0043 §4): the new version 'published'; the rule's effective_version_id -> it; the
-- old version -> 'superseded'. The one-published exclusion and the audit requirement are checked at COMMIT.
INSERT INTO automation_rule_version (id, automation_rule_id, version_no, status, trigger_codes, conditions, actions, action_types,
                                     run_as, parameters, content_sha256, change_summary, published_at)
VALUES ('01920006-0117-7000-8000-000000000001', '01920005-0075-7000-8000-000000000110', 2, 'published',
        ARRAY['job.failed', 'connector.run_failed', 'data.stale']::text[], '[]'::jsonb,
        jsonb_build_array(jsonb_build_object('type', 'starter_handler',
          'handlers', jsonb_build_array('jobs.failure_capture', 'operations.exception_raise'))),
        ARRAY['starter_handler'], 'service', '{}'::jsonb,
        encode(sha256(convert_to('starter:starter.job_failed:v2', 'UTF8')), 'hex'),
        'Seeded starter version 2 (ADR-0053 §3): a connector run failure or stale KPI data also opens or recurs the visible operational exception; version 1 stays as history.',
        now());
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source, changes)
VALUES (mth_uuid_v7(), 'system', 'automation_rule_version.create', 'automation_rule_version',
        '01920006-0117-7000-8000-000000000001', 1, 'migration',
        jsonb_build_object('version_no', jsonb_build_object('from', NULL, 'to', 2),
                           'status', jsonb_build_object('from', NULL, 'to', 'published'),
                           'trigger_codes', jsonb_build_object('from', NULL, 'to', to_jsonb(ARRAY['job.failed', 'connector.run_failed', 'data.stale']))));

UPDATE automation_rule
   SET effective_version_id = '01920006-0117-7000-8000-000000000001', version = version + 1, updated_at = now()
 WHERE id = '01920005-0075-7000-8000-000000000110' AND code = 'starter.job_failed';
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, prior_version, new_version, source, changes)
SELECT mth_uuid_v7(), 'system', 'automation_rule.effective_version', 'automation_rule', r.id, r.version - 1, r.version,
       'migration',
       jsonb_build_object('effective_version_id', jsonb_build_object('from', '01920005-0075-7000-8000-000000000210',
                                                                     'to', '01920006-0117-7000-8000-000000000001'))
FROM automation_rule r WHERE r.id = '01920005-0075-7000-8000-000000000110';

UPDATE automation_rule_version
   SET status = 'superseded', superseded_at = now(), version = version + 1, updated_at = now()
 WHERE id = '01920005-0075-7000-8000-000000000210' AND status = 'published';
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, prior_version, new_version, source, changes)
SELECT mth_uuid_v7(), 'system', 'automation_rule_version.supersede', 'automation_rule_version', v.id, v.version - 1,
       v.version, 'migration', jsonb_build_object('status', jsonb_build_object('from', 'published', 'to', 'superseded'))
FROM automation_rule_version v WHERE v.id = '01920005-0075-7000-8000-000000000210';

-- ---------------------------------------------------------------------------------------------------------------- 4
INSERT INTO job_schedule (id, code, queue_name, cron, timezone, description_en, description_ar, owner_module) VALUES
  ('01920006-0117-7000-8000-000000000011', 'kpi.freshness_scan', 'kpi.freshness_scan', '25 * * * *', 'Asia/Riyadh',
   'Find KPIs whose last accepted data became stale (DG4 freshness rule, unchanged) and open one operational exception per KPI; resolve it when the data is fresh again. Never changes a KPI value; never approves anything.',
   'العثور على مؤشرات الأداء التي تقادمت آخر بياناتها المقبولة وفتح استثناء تشغيلي واحد لكل مؤشر؛ وإغلاقه عند تحديث البيانات. لا يغيّر أي قيمة؛ لا يعتمد أي شيء.',
   'kpi'),
  ('01920006-0117-7000-8000-000000000012', 'operations.exception_alerts', 'operations.exception_alerts', '* * * * *', 'Asia/Riyadh',
   'Alert once for each newly opened operational exception: one error log line and one in-app notification to each holder of operations.acknowledge (ADR-0053 §6). Never approves anything.',
   'التنبيه مرة واحدة لكل استثناء تشغيلي يُفتح: سطر سجل خطأ واحد وإشعار داخل التطبيق لكل من يملك صلاحية الإقرار. لا يعتمد أي شيء.',
   'operations');
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source)
SELECT mth_uuid_v7(), 'system', 'job_schedule.create', 'job_schedule', s.id, 1, 'migration'
  FROM job_schedule s WHERE s.code IN ('kpi.freshness_scan', 'operations.exception_alerts');

CREATE TEMPORARY TABLE p6_operations_job_identity (id uuid, code text, queue text, codes text[], sensitive text, en text, ar text) ON COMMIT DROP;
INSERT INTO p6_operations_job_identity VALUES
  ('01920006-0117-7000-8000-000000000021', 'job:kpi.freshness_scan', 'kpi.freshness_scan', ARRAY['transformation.read', 'operations.read']::text[], 'none', 'Job: KPI data freshness scan', 'مهمة: فحص حداثة بيانات مؤشرات الأداء'),
  ('01920006-0117-7000-8000-000000000022', 'job:operations.exception_alerts', 'operations.exception_alerts', ARRAY['operations.read', 'access.read']::text[], 'none', 'Job: operational exception alerts', 'مهمة: تنبيهات الاستثناءات التشغيلية'),
  ('01920006-0117-7000-8000-000000000023', 'job:operations.exception_raise', 'operations.exception_raise', ARRAY['transformation.read', 'operations.read']::text[], 'none', 'Job: operational exception from stale data', 'مهمة: استثناء تشغيلي من بيانات متقادمة');

INSERT INTO service_identity (id, code, subject_kind, queue_name, connector_id, scope_level, organization_id,
                              declared_permission_codes, granted_permission_codes, sensitive_access, label_en, label_ar,
                              reason)
SELECT j.id, j.code, 'job', j.queue, NULL, 'platform', NULL, j.codes, j.codes, j.sensitive, j.en, j.ar,
       'Seeded declaration (0117; ADR-0053 §1): the narrowest read set the operations job needs.'
FROM p6_operations_job_identity j ORDER BY j.code;

INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source, changes)
SELECT mth_uuid_v7(), 'system', 'service_identity.create', 'service_identity', s.id, 1, 'migration',
       jsonb_build_object(
         'code', jsonb_build_object('from', NULL, 'to', s.code),
         'declared_permission_codes', jsonb_build_object('from', NULL, 'to', to_jsonb(s.declared_permission_codes)),
         'granted_permission_codes', jsonb_build_object('from', NULL, 'to', to_jsonb(s.granted_permission_codes)),
         'sensitive_access', jsonb_build_object('from', NULL, 'to', s.sensitive_access))
FROM service_identity s JOIN p6_operations_job_identity j ON j.id = s.id;
