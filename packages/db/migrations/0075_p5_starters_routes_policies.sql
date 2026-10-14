-- 0075 P5 slice E: the sixteen starter automations as seeded rules, sequential/parallel approval route steps,
-- conditional-approval condition closure and escalation, notification policy (business-day timing, quiet hours,
-- digests, urgent escalation), meeting cut-off draft packs and dependency slips (T-DG5-ARCH-03; ADR-0044;
-- REQ-S12-001 (starters), REQ-S12-004, REQ-S12-012, REQ-S12-015, REQ-S12-025, REQ-S10-015, REQ-S04-011).
-- Authored by solution-architect. Contract: docs/architecture/data-dictionary.md ("P5 tables, slices D and E").
-- Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged.
--
-- Additive: new tables; new nullable/defaulted columns on inbox_notification and work_item_kind whose defaults keep
-- every DG4 row and behaviour as it was ('normal', 'delivered'); one new BEFORE UPDATE trigger on inbox_notification
-- (delivery transitions; a DG4 row is 'delivered', which is final) and one on agenda_item that refuses publishing only
-- items generated into a cut-off pack that is not yet reviewed (no DG4 item is in a pack).
-- The starters' version-1 settings equal the DG4 behaviour (D-142 Q3): each calls its DG4 handler unchanged. A seed
-- approves nothing; route steps and conditions are decided and closed by people. Nothing touches DG0-DG7.
-- Arabic labels are PROVISIONAL translations needing review.

-- -----------------------------------------------------------------------------------------------------------------
-- Triggers the starters need beyond 0074's list (the other event types their DG4 handlers already consume).
INSERT INTO automation_trigger (code, trigger_kind, owner_module, label_en, label_ar, condition_fields, initiating_user_field, admin_selectable, source_ref) VALUES
  ('kpi.threshold_changed', 'event', 'kpi', 'KPI thresholds changed', 'تغيّر حدود مؤشر الأداء', '{kpiId}', NULL, true, 'M0226'),
  ('kpi.trajectory_approved', 'event', 'kpi', 'KPI trajectory approved', 'اعتماد مسار مؤشر الأداء', '{kpiId}', NULL, true, 'M0226'),
  ('kpi.version_activated', 'event', 'kpi', 'KPI definition version activated', 'تفعيل نسخة تعريف مؤشر الأداء', '{kpiId}', NULL, true, 'M0226'),
  ('kpi.values_recalculated', 'event', 'kpi', 'KPI values recalculated', 'إعادة حساب قيم مؤشر الأداء', '{kpiId}', NULL, true, 'M0226'),
  ('benefit.variance_evaluated', 'event', 'benefits', 'Benefit deviates from its forecast', 'انحراف المنفعة عن توقعها', '{benefitId,severity}', NULL, true, 'M0227'),
  ('sustainment.review_scan', 'schedule', 'sustainment', 'Recurring performance reviews due', 'استحقاق مراجعات الأداء الدورية', '{}', NULL, false, 'M0237'),
  ('sustainment.control_check_scan', 'schedule', 'sustainment', 'Recurring control checks due', 'استحقاق فحوص الضوابط الدورية', '{}', NULL, false, 'M0237'),
  ('gate.condition_escalation_scan', 'schedule', 'workflows', 'Conditional-approval condition overdue', 'تأخر شرط من شروط الاعتماد المشروط', '{}', NULL, false, 'M0124'),
  ('notification.digest', 'schedule', 'tasks', 'Digest window reached', 'بلوغ موعد الملخص', '{}', NULL, false, 'M0241');

-- New schedules (ADR-0044 §3-§6), audited like 0028's seeds.
INSERT INTO job_schedule (id, code, queue_name, cron, timezone, description_en, description_ar, owner_module) VALUES
  ('01920005-0075-7000-8000-000000000001', 'governance.meeting_cutoff_scan', 'governance.meeting_cutoff_scan', '30 0 * * *', 'Asia/Riyadh', 'Generate one draft agenda and pack for each meeting whose cut-off is reached; publication needs the chair''s review (REQ-S12-015).', 'إنشاء مسودة جدول أعمال وحزمة واحدة لكل اجتماع بلغ موعد إقفاله؛ يتطلب النشر مراجعة الرئيس.', 'governance'),
  ('01920005-0075-7000-8000-000000000002', 'gate.condition_escalation_scan', 'gate.condition_escalation_scan', '0 1 * * *', 'Asia/Riyadh', 'Escalate each overdue open condition of a conditional approval once; never approves (REQ-S04-011).', 'تصعيد كل شرط مفتوح متأخر من شروط الاعتماد المشروط مرة واحدة؛ لا يعتمد أبداً.', 'workflows'),
  ('01920005-0075-7000-8000-000000000003', 'notification.digest', 'notification.digest', '*/15 * * * *', 'Asia/Riyadh', 'Deliver held non-urgent notifications in one digest per user and window (REQ-S12-025).', 'تسليم الإشعارات غير العاجلة المؤجلة في ملخص واحد لكل مستخدم ونافذة.', 'tasks');
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source)
SELECT mth_uuid_v7(), 'system', 'job_schedule.create', 'job_schedule', s.id, 1, 'migration'
FROM job_schedule s WHERE s.code IN ('governance.meeting_cutoff_scan', 'gate.condition_escalation_scan', 'notification.digest');

-- -----------------------------------------------------------------------------------------------------------------
-- The sixteen starters (M0224-M0239) as rules with a published version 1 each (REQ-S12-001 note AN-04). Every one is
-- a guarantee (D-142 Q3): enabled, never disableable. Version 1 runs the DG4/P5 handler(s) named in its action with
-- the DG4 settings; `parameters` holds the values ADR-0044 §1 declares configurable (empty = none beyond cadence).
CREATE TEMPORARY TABLE p5_starter (n int, code text, src text, en text, ar text, triggers text[], handlers text, params text) ON COMMIT DROP;
INSERT INTO p5_starter VALUES
  (1, 'starter.transformation_created', 'M0224', 'New transformation: instantiate methodology, forms, phase checklist, role tasks and optional 90-day plan', 'تحوّل جديد: إنشاء المنهجية والنماذج وقائمة المرحلة ومهام الأدوار وخطة التسعين يوماً الاختيارية', '{transformation.created}', '["transformation.created"]', '{"roleTaskDueWorkingDays": 5}'),
  (2, 'starter.reporting_period_open', 'M0225', 'Reporting period opens: owner update tasks and in-app reminders', 'فتح فترة التقارير: مهام التحديث للمالكين وتذكيرات داخل التطبيق', '{kpi.reporting_period_open}', '["kpi.reporting_period_open"]', '{}'),
  (3, 'starter.kpi_actual_accepted', 'M0226', 'Accepted KPI actual: recalculate dependent values and RAG; flag benefit validation', 'قيمة فعلية مقبولة: إعادة حساب القيم التابعة وحالة الأداء؛ الإشارة إلى التحقق من المنفعة', '{kpi.actual_accepted,kpi.threshold_changed,kpi.trajectory_approved,kpi.version_activated,kpi.values_recalculated}', '["kpi.recalculate", "benefits.recalculate_pending"]', '{}'),
  (4, 'starter.kpi_deviation', 'M0227', 'KPI or benefit deviates: create or update a corrective-action case', 'انحراف مؤشر أو منفعة: إنشاء حالة إجراء تصحيحي أو تحديثها', '{kpi.deviation_evaluated,benefit.variance_evaluated}', '["raid.corrective_kpi", "raid.corrective_benefit"]', '{}'),
  (5, 'starter.gate_evidence_missing', 'M0228', 'Mandatory gate evidence missing: show missing requirements and block submission', 'نقص الأدلة الإلزامية للبوابة: عرض المتطلبات الناقصة ومنع التقديم', '{gate.submission_requested}', '["workflows.gate_submission_check"]', '{}'),
  (6, 'starter.gate_submission_routing', 'M0229', 'Valid gate submission: route the evidence snapshot to the required approvers', 'تقديم بوابة صالح: توجيه لقطة الأدلة إلى المعتمدين المطلوبين', '{gate.submitted}', '["gates.submitted"]', '{}'),
  (7, 'starter.gate_approved', 'M0230', 'Gate approved: enable the authorized next phase or scope and create its tasks', 'اعتماد البوابة: تمكين المرحلة أو النطاق التالي المعتمد وإنشاء مهامه', '{gate.decided}', '["gates.decided"]', '{}'),
  (8, 'starter.decision_sla', 'M0231', 'Decision SLA expires: escalate to the next configured authority', 'انقضاء مهلة القرار: التصعيد إلى الجهة التالية المحددة', '{governance.decision_sla_scan,approval.escalation_scan}', '["governance.decision_sla_scan", "approval.escalation_scan"]', '{}'),
  (9, 'starter.dependency_slip', 'M0232', 'Critical dependency slips: notify affected owners and recompute forecast impacts', 'تأخر اعتمادية حرجة: إشعار المالكين المتأثرين وإعادة حساب أثر التوقعات', '{dependency.slipped}', '["portfolio.dependency_slip"]', '{"minimumSlipDays": 1}'),
  (10, 'starter.blocker_red', 'M0233', 'Blocker red across cycles: require a named executive decision, owner and deadline', 'عائق أحمر عبر الدورات: طلب قرار تنفيذي محدد بمالك وموعد', '{blocker_status.recorded,governance.blocker_escalation_scan}', '["governance.blocker_escalation", "governance.blocker_escalation_scan"]', '{}'),
  (11, 'starter.benefit_evidence', 'M0234', 'Benefit evidence submitted: route to the Finance/value validation queue', 'تقديم أدلة المنفعة: التوجيه إلى قائمة التحقق المالي من القيمة', '{benefit.evidence_submitted}', '["benefits.finance_queue"]', '{}'),
  (12, 'starter.meeting_cutoff', 'M0235', 'Meeting cut-off reached: draft agenda and pack with a review step before publication', 'بلوغ موعد الإقفال: مسودة جدول أعمال وحزمة مع مراجعة قبل النشر', '{governance.meeting_cutoff_scan}', '["governance.meeting_cutoff_scan"]', '{}'),
  (13, 'starter.adoption_control_failed', 'M0236', 'Adoption or control check fails: recovery action with owner and follow-up date', 'إخفاق فحص التبني أو الضوابط: إجراء استعادة بمالك وموعد متابعة', '{adoption.check_failed,control_check.failed,kpi.deviation_evaluated}', '["raid.corrective_adoption", "raid.corrective_control", "adoption.indicator_evaluated"]', '{}'),
  (14, 'starter.bau_handover_accepted', 'M0237', 'BAU handover accepted: transfer routine ownership and activate recurring reviews', 'قبول التسليم: نقل الملكية الاعتيادية وتفعيل المراجعات الدورية', '{bau_handover.accept_requested,sustainment.review_scan,sustainment.control_check_scan}', '["sustainment.handover_accept", "sustainment.review_scan", "sustainment.control_check_scan"]', '{}'),
  (15, 'starter.revision_proposed', 'M0238', 'Methodology or formula revision proposed: impact, validation and configured review', 'اقتراح مراجعة للمنهجية أو المعادلة: الأثر والتحقق والمراجعة المحددة', '{methodology.revision_proposed}', '["methodology.revision_impact"]', '{}'),
  (16, 'starter.job_failed', 'M0239', 'Connector or job fails: visible operational exception; last known values keep freshness labels', 'إخفاق موصل أو مهمة: استثناء تشغيلي ظاهر؛ تبقى آخر القيم المعروفة بتسميات حداثتها', '{job.failed}', '["jobs.failure_capture"]', '{}');

INSERT INTO automation_rule (id, code, origin, source_ref, name_en, name_ar, scope_level, owner_role_code, enabled, disable_allowed, effective_version_id)
SELECT ('01920005-0075-7000-8000-0000000001' || lpad(to_hex(s.n), 2, '0'))::uuid, s.code, 'starter', s.src, s.en, s.ar,
       'platform', 'ADM_METHOD', true, false,
       ('01920005-0075-7000-8000-0000000002' || lpad(to_hex(s.n), 2, '0'))::uuid
FROM p5_starter s ORDER BY s.n;
INSERT INTO automation_rule_version (id, automation_rule_id, version_no, status, trigger_codes, conditions, actions, action_types,
                                     run_as, parameters, content_sha256, change_summary, published_at)
SELECT ('01920005-0075-7000-8000-0000000002' || lpad(to_hex(s.n), 2, '0'))::uuid,
       ('01920005-0075-7000-8000-0000000001' || lpad(to_hex(s.n), 2, '0'))::uuid,
       1, 'published', s.triggers, '[]'::jsonb,
       jsonb_build_array(jsonb_build_object('type', 'starter_handler', 'handlers', s.handlers::jsonb)),
       ARRAY['starter_handler'], 'service', s.params::jsonb,
       encode(sha256(convert_to('starter:' || s.code || ':v1', 'UTF8')), 'hex'),
       'Seeded starter: the DG4 behaviour (D-142 Q3).', now()
FROM p5_starter s ORDER BY s.n;
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source)
SELECT mth_uuid_v7(), 'system', 'automation_rule.create', 'automation_rule', r.id, 1, 'migration'
FROM automation_rule r WHERE r.origin = 'starter';
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source)
SELECT mth_uuid_v7(), 'system', 'automation_rule_version.create', 'automation_rule_version', v.id, 1, 'migration'
FROM automation_rule_version v JOIN automation_rule r ON r.id = v.automation_rule_id WHERE r.origin = 'starter';

-- -----------------------------------------------------------------------------------------------------------------
-- approval_route_step: the steps of a sequential or parallel approval route (REQ-S10-015, M0213). A route comes from
-- the resolved `approver_route` element of the transformation's pinned methodology (ADR-0039 §2; key
-- `approval.<approval_type>`) or a procedure's approval_mode/roles (ADR-0042 §2), with mode sequential or parallel
-- and 2-6 roles. A DG4 single-step approval has no rows. A resubmission (DG4 round_no + 1) gets a fresh set of steps
-- for its round; the steps of an earlier round stay as history. Sequential: step 1 starts active, step n becomes active only
-- when every lower step is approved. Parallel: every step starts active. The approval is approved when every step is
-- approved; rejected or changes_requested as soon as one step is (ADR-0044 §2). Status machine:
--   waiting -> active | cancelled;  active -> approved | rejected | changes_requested | cancelled
CREATE TABLE approval_route_step (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id    uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  approval_id          uuid NOT NULL,
  round_no             smallint NOT NULL CHECK (round_no >= 1),
  route_key            text NOT NULL CHECK (route_key ~ '^[a-z0-9_]+\.[a-zA-Z0-9_.]+$' AND char_length(route_key) <= 100),
  route_mode           text NOT NULL CHECK (route_mode IN ('sequential', 'parallel')),
  step_no              smallint NOT NULL CHECK (step_no BETWEEN 1 AND 6),
  approver_role_code   text NOT NULL REFERENCES role (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  assignee_user_id     uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status               text NOT NULL CHECK (status IN ('waiting', 'active', 'approved', 'rejected', 'changes_requested', 'cancelled')),
  activated_at         timestamptz NULL,
  decided_by           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_on_behalf_of uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_at           timestamptz NULL,
  decision_note        text NULL CHECK (decision_note IS NULL OR char_length(decision_note) BETWEEN 3 AND 4000),
  version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT approval_route_step_approval_fkey FOREIGN KEY (transformation_id, approval_id)
    REFERENCES approval (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT approval_route_step_no_key UNIQUE (approval_id, round_no, step_no),
  CONSTRAINT approval_route_step_decided_complete CHECK (
    (status IN ('approved', 'rejected', 'changes_requested')) = (decided_at IS NOT NULL)
    AND (decided_at IS NULL) = (decided_by IS NULL) AND (decided_on_behalf_of IS NULL OR decided_by IS NOT NULL)),
  CONSTRAINT approval_route_step_activated_complete CHECK (
    (status = 'waiting' AND activated_at IS NULL) OR (status IN ('active', 'approved', 'rejected', 'changes_requested') AND activated_at IS NOT NULL)
    OR status = 'cancelled')
);
CREATE INDEX approval_route_step_active_idx ON approval_route_step (approver_role_code, status) WHERE status = 'active';
CREATE FUNCTION approval_route_step_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT x.requested_by, x.sod_policy, x.round_no INTO a FROM approval x WHERE x.id = NEW.approval_id;
  IF EXISTS (SELECT 1 FROM role r WHERE r.code = NEW.approver_role_code AND (r.kind = 'technical_admin' OR r.code = 'AUD')) THEN
    RAISE EXCEPTION 'approval_route_step: a technical administrator or the auditor never approves (REQ-S10-003)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_route_step_business_role';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.round_no IS DISTINCT FROM a.round_no THEN
      RAISE EXCEPTION 'approval_route_step: steps are created for the approval''s current round'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_route_step_current_round';
    END IF;
    IF EXISTS (SELECT 1 FROM approval_route_step s WHERE s.approval_id = NEW.approval_id AND s.round_no = NEW.round_no
                 AND (s.route_key <> NEW.route_key OR s.route_mode <> NEW.route_mode)) THEN
      RAISE EXCEPTION 'approval_route_step: all steps of an approval round share one route and mode'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_route_step_one_route';
    END IF;
    IF NOT ((NEW.status = 'active' AND (NEW.route_mode = 'parallel' OR NEW.step_no = 1))
            OR (NEW.status = 'waiting' AND NEW.route_mode = 'sequential' AND NEW.step_no > 1)) THEN
      RAISE EXCEPTION 'approval_route_step: a parallel step and sequential step 1 start active; later sequential steps wait'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_route_step_transition';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.approval_id, NEW.round_no, NEW.route_key, NEW.route_mode, NEW.step_no, NEW.approver_role_code)
     IS DISTINCT FROM (OLD.approval_id, OLD.round_no, OLD.route_key, OLD.route_mode, OLD.step_no, OLD.approver_role_code) THEN
    RAISE EXCEPTION 'approval_route_step: approval, round, route, mode, step number and role never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_route_step_identity_fixed';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'waiting' AND NEW.status IN ('active', 'cancelled'))
       OR (OLD.status = 'active' AND NEW.status IN ('approved', 'rejected', 'changes_requested', 'cancelled'))) THEN
    RAISE EXCEPTION 'approval_route_step: % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_route_step_transition';
  END IF;
  -- Sequential: step n is activated only after every lower step is approved (REQ-S10-015 "step 2 is not notified until
  -- step 1 approves").
  IF OLD.status = 'waiting' AND NEW.status = 'active' AND EXISTS (
       SELECT 1 FROM approval_route_step s WHERE s.approval_id = NEW.approval_id AND s.round_no = NEW.round_no
         AND s.step_no < NEW.step_no AND s.status <> 'approved') THEN
    RAISE EXCEPTION 'approval_route_step: step % starts only after every earlier step is approved', NEW.step_no
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_route_step_sequence';
  END IF;
  -- Separation of duties: the requester never decides (unless the type allows it), and one person decides at most one
  -- step of an approval.
  IF NEW.decided_by IS NOT NULL AND OLD.decided_by IS NULL THEN
    IF a.sod_policy = 'requester_excluded'
       AND (NEW.decided_by = a.requested_by OR NEW.decided_on_behalf_of IS NOT DISTINCT FROM a.requested_by) THEN
      RAISE EXCEPTION 'approval_route_step: the requester cannot decide a step'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_route_step_sod';
    END IF;
    IF EXISTS (SELECT 1 FROM approval_route_step s WHERE s.approval_id = NEW.approval_id AND s.round_no = NEW.round_no
                 AND s.id <> NEW.id AND (s.decided_by = NEW.decided_by
                      OR s.decided_on_behalf_of IS NOT DISTINCT FROM coalesce(NEW.decided_on_behalf_of, NEW.decided_by))) THEN
      RAISE EXCEPTION 'approval_route_step: one person decides at most one step of an approval round'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_route_step_distinct_deciders';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER approval_route_step_guard BEFORE INSERT OR UPDATE ON approval_route_step
  FOR EACH ROW EXECUTE FUNCTION approval_route_step_guard();
SELECT p2_attach_guards('approval_route_step', true);
GRANT SELECT, INSERT, UPDATE ON approval_route_step TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- Conditional approval (REQ-S04-011): the DG4 condition rows (gate_decision_condition, 0051, append-only) stay as
-- they are. Closure and escalation are recorded beside them, append-only: a condition is closed when it has a closure
-- row, and overdue when it is open after its due date. Only the condition's owner closes it.
CREATE TABLE gate_condition_closure (
  id                         uuid PRIMARY KEY,
  organization_id            uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id          uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  gate_decision_condition_id uuid NOT NULL REFERENCES gate_decision_condition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  closure_note               text NOT NULL CHECK (char_length(closure_note) BETWEEN 3 AND 2000),
  evidence_id                uuid NULL REFERENCES evidence (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  closed_by                  uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gate_condition_closure_once_key UNIQUE (gate_decision_condition_id)
);
CREATE TABLE gate_condition_escalation (
  id                         uuid PRIMARY KEY,
  organization_id            uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id          uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  gate_decision_condition_id uuid NOT NULL REFERENCES gate_decision_condition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  overdue_since              date NOT NULL,
  escalated_to_user_id       uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  work_item_id               uuid NULL REFERENCES work_item (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT gate_condition_escalation_once_key UNIQUE (gate_decision_condition_id)
);
CREATE FUNCTION gate_condition_record_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  c record;
  n jsonb := to_jsonb(NEW);
BEGIN
  SELECT x.transformation_id, x.owner_user_id, x.due_date INTO c FROM gate_decision_condition x WHERE x.id = NEW.gate_decision_condition_id;
  IF c.transformation_id IS DISTINCT FROM NEW.transformation_id THEN
    RAISE EXCEPTION '%: the condition belongs to another transformation', TG_TABLE_NAME
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_condition_scope';
  END IF;
  IF TG_TABLE_NAME = 'gate_condition_closure' AND (n->>'closed_by')::uuid IS DISTINCT FROM c.owner_user_id THEN
    RAISE EXCEPTION 'gate_condition_closure: only the condition owner closes it'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_condition_closure_owner';
  END IF;
  IF TG_TABLE_NAME = 'gate_condition_escalation' THEN
    IF EXISTS (SELECT 1 FROM gate_condition_closure z WHERE z.gate_decision_condition_id = NEW.gate_decision_condition_id) THEN
      RAISE EXCEPTION 'gate_condition_escalation: a closed condition is not escalated'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_condition_escalation_open';
    END IF;
    IF (n->>'overdue_since')::date IS DISTINCT FROM c.due_date + 1 THEN
      RAISE EXCEPTION 'gate_condition_escalation: overdue_since is the day after the condition''s due date'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_condition_escalation_overdue';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gate_condition_closure_guard BEFORE INSERT ON gate_condition_closure
  FOR EACH ROW EXECUTE FUNCTION gate_condition_record_guard();
CREATE TRIGGER gate_condition_escalation_guard BEFORE INSERT ON gate_condition_escalation
  FOR EACH ROW EXECUTE FUNCTION gate_condition_record_guard();
SELECT p2_attach_append_only('gate_condition_closure');
SELECT p2_attach_guards('gate_condition_closure', true);
SELECT p2_attach_append_only('gate_condition_escalation');
SELECT p2_attach_guards('gate_condition_escalation', true);
GRANT SELECT, INSERT ON gate_condition_closure, gate_condition_escalation TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- Notification policy (REQ-S12-025, M0241, D-142 Q11: in-app only in P5). Four separate settings:
--   business-day timing: non-urgent deliveries only on working days of the organization's calendar (policy);
--   quiet hours: a non-urgent notification created inside them is held (user preference, else the policy default);
--   digest: held notifications are delivered in one digest notification per user and window (user preference);
--   urgent escalation: a notification whose work-item kind is 'urgent' is always delivered at once.
-- With no policy row and no preference row nothing is held: the DG4 behaviour.
ALTER TABLE work_item_kind ADD COLUMN urgency text NOT NULL DEFAULT 'normal' CONSTRAINT work_item_kind_urgency_check
  CHECK (urgency IN ('normal', 'urgent'));
UPDATE work_item_kind SET urgency = 'urgent'
WHERE code IN ('approval_escalated', 'executive_decision_escalated', 'approval_overdue');

CREATE TABLE notification_policy (
  id                              uuid PRIMARY KEY,
  organization_id                 uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  non_urgent_working_days_only    boolean NOT NULL DEFAULT false,
  default_quiet_hours_start       time NULL,
  default_quiet_hours_end         time NULL,
  default_digest_mode             text NOT NULL DEFAULT 'off' CHECK (default_digest_mode IN ('off', 'daily', 'twice_daily')),
  urgent_delivery                 text NOT NULL DEFAULT 'immediate' CHECK (urgent_delivery IN ('immediate')),
  version                         integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                      timestamptz NOT NULL DEFAULT now(),
  created_by                      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  updated_by                      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT notification_policy_organization_key UNIQUE (organization_id),
  CONSTRAINT notification_policy_quiet_complete CHECK (
    (default_quiet_hours_start IS NULL) = (default_quiet_hours_end IS NULL)
    AND (default_quiet_hours_start IS NULL OR default_quiet_hours_start <> default_quiet_hours_end))
);
SELECT p2_attach_guards('notification_policy', true);
GRANT SELECT, INSERT, UPDATE ON notification_policy TO mth_app;

CREATE TABLE notification_preference (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  user_id           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  quiet_hours_start time NULL,
  quiet_hours_end   time NULL,
  timezone          text NOT NULL DEFAULT 'Asia/Riyadh' CHECK (char_length(timezone) BETWEEN 1 AND 64),
  digest_mode       text NOT NULL DEFAULT 'off' CHECK (digest_mode IN ('off', 'daily', 'twice_daily')),
  digest_time       time NOT NULL DEFAULT '08:00',
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT notification_preference_user_key UNIQUE (user_id),
  CONSTRAINT notification_preference_quiet_complete CHECK (
    (quiet_hours_start IS NULL) = (quiet_hours_end IS NULL) AND (quiet_hours_start IS NULL OR quiet_hours_start <> quiet_hours_end)),
  -- A digest needs a time to send it; quiet hours without a digest hold until they end (ADR-0044 §5).
  CONSTRAINT notification_preference_minutes CHECK (date_part('second', digest_time) = 0)
);
CREATE TRIGGER notification_preference_timezone_known BEFORE INSERT OR UPDATE OF timezone ON notification_preference
  FOR EACH ROW EXECUTE FUNCTION p4_timezone_known();
CREATE FUNCTION notification_preference_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF (SELECT u.organization_id FROM app_user u WHERE u.id = NEW.user_id) IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'notification_preference: organization_id must equal the user''s organization'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'notification_preference_organization_matches';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'notification_preference: the user never changes'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'notification_preference_identity_fixed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notification_preference_guard BEFORE INSERT OR UPDATE ON notification_preference
  FOR EACH ROW EXECUTE FUNCTION notification_preference_guard();
SELECT p2_attach_guards('notification_preference', true);
GRANT SELECT, INSERT, UPDATE ON notification_preference TO mth_app;

-- notification_digest: one digest per user and window (lock 730261; UNIQUE backstop). Append-only.
CREATE TABLE notification_digest (
  id                    uuid PRIMARY KEY,
  organization_id       uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  recipient_user_id     uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  window_start          timestamptz NOT NULL,
  window_end            timestamptz NOT NULL,
  notification_count    integer NOT NULL CHECK (notification_count BETWEEN 1 AND 10000),
  inbox_notification_id uuid NOT NULL REFERENCES inbox_notification (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT notification_digest_window_key UNIQUE (recipient_user_id, window_start),
  CONSTRAINT notification_digest_window CHECK (window_end > window_start)
);
SELECT p2_attach_append_only('notification_digest');
SELECT p2_attach_guards('notification_digest', true);
GRANT SELECT, INSERT ON notification_digest TO mth_app;

-- inbox_notification gains its delivery state. Defaults keep every existing row and every DG4 insert 'delivered'.
--   delivered (final);  held -> digested (in a digest) | delivered (quiet hours ended, digest off)
ALTER TABLE inbox_notification
  ADD COLUMN urgency        text NOT NULL DEFAULT 'normal' CONSTRAINT inbox_notification_urgency_check CHECK (urgency IN ('normal', 'urgent')),
  ADD COLUMN delivery_state text NOT NULL DEFAULT 'delivered'
    CONSTRAINT inbox_notification_delivery_state_check CHECK (delivery_state IN ('delivered', 'held', 'digested')),
  ADD COLUMN deliver_after  timestamptz NULL,
  ADD COLUMN digest_id      uuid NULL REFERENCES notification_digest (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN is_digest      boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT inbox_notification_urgent_immediate CHECK (urgency = 'normal' OR delivery_state = 'delivered'),
  ADD CONSTRAINT inbox_notification_held_complete CHECK (delivery_state <> 'held' OR deliver_after IS NOT NULL),
  ADD CONSTRAINT inbox_notification_digested_complete CHECK ((delivery_state = 'digested') = (digest_id IS NOT NULL)),
  ADD CONSTRAINT inbox_notification_digest_delivered CHECK (NOT is_digest OR (delivery_state = 'delivered' AND urgency = 'normal'));
CREATE INDEX inbox_notification_held_idx ON inbox_notification (recipient_user_id, deliver_after) WHERE delivery_state = 'held';
CREATE FUNCTION inbox_notification_delivery_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF (NEW.urgency, NEW.is_digest) IS DISTINCT FROM (OLD.urgency, OLD.is_digest) THEN
    RAISE EXCEPTION 'inbox_notification: urgency and the digest flag never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'inbox_notification_delivery_fixed';
  END IF;
  IF NEW.delivery_state IS DISTINCT FROM OLD.delivery_state
     AND NOT (OLD.delivery_state = 'held' AND NEW.delivery_state IN ('digested', 'delivered')) THEN
    RAISE EXCEPTION 'inbox_notification: delivery % -> % is not allowed', OLD.delivery_state, NEW.delivery_state
      USING ERRCODE = 'check_violation', CONSTRAINT = 'inbox_notification_delivery_transition';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inbox_notification_delivery_guard BEFORE UPDATE ON inbox_notification
  FOR EACH ROW EXECUTE FUNCTION inbox_notification_delivery_guard();

-- -----------------------------------------------------------------------------------------------------------------
-- meeting_cutoff_pack: the draft agenda and pack generated once when a meeting's cut-off is reached (REQ-S12-015,
-- M0235). open_asks is the snapshot of the open executive asks at as_of (validated by the API); the agenda items it
-- created are DG4 agenda items in 'draft'. Review: the chair or secretary marks the pack reviewed; until then none of
-- its items can be published (trigger agenda_item_cutoff_review below). Status: draft -> reviewed.
CREATE TABLE meeting_cutoff_pack (
  id                      uuid PRIMARY KEY,
  organization_id         uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id       uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  meeting_id              uuid NOT NULL,
  cutoff_date             date NOT NULL,
  as_of                   timestamptz NOT NULL,
  open_asks               jsonb NOT NULL CHECK (jsonb_typeof(open_asks) = 'array' AND jsonb_array_length(open_asks) <= 200),
  agenda_item_ids         uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(agenda_item_ids) <= 200),
  automation_execution_id uuid NULL REFERENCES automation_execution (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status                  text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed')),
  reviewed_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  reviewed_at             timestamptz NULL,
  review_note             text NULL CHECK (review_note IS NULL OR char_length(review_note) BETWEEN 3 AND 2000),
  version                 integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT meeting_cutoff_pack_meeting_fkey FOREIGN KEY (transformation_id, meeting_id)
    REFERENCES meeting (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT meeting_cutoff_pack_once_key UNIQUE (meeting_id),
  CONSTRAINT meeting_cutoff_pack_reviewed_complete CHECK (
    (status = 'reviewed') = (reviewed_at IS NOT NULL) AND (reviewed_at IS NULL) = (reviewed_by IS NULL))
);
CREATE FUNCTION meeting_cutoff_pack_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  m record;
BEGIN
  SELECT x.chair_user_id, x.secretary_user_id, x.cutoff_date INTO m FROM meeting x WHERE x.id = NEW.meeting_id;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR m.cutoff_date IS DISTINCT FROM NEW.cutoff_date THEN
      RAISE EXCEPTION 'meeting_cutoff_pack: a pack starts as a draft for the meeting''s own cut-off date'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_cutoff_pack_transition';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.meeting_id, NEW.cutoff_date, NEW.as_of, NEW.open_asks, NEW.agenda_item_ids, NEW.automation_execution_id)
     IS DISTINCT FROM (OLD.meeting_id, OLD.cutoff_date, OLD.as_of, OLD.open_asks, OLD.agenda_item_ids, OLD.automation_execution_id) THEN
    RAISE EXCEPTION 'meeting_cutoff_pack: the generated content never changes'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_cutoff_pack_content_fixed';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'draft' AND NEW.status = 'reviewed') THEN
    RAISE EXCEPTION 'meeting_cutoff_pack: % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_cutoff_pack_transition';
  END IF;
  IF NEW.status = 'reviewed' AND OLD.status = 'draft'
     AND NEW.reviewed_by IS DISTINCT FROM m.chair_user_id AND NEW.reviewed_by IS DISTINCT FROM m.secretary_user_id THEN
    RAISE EXCEPTION 'meeting_cutoff_pack: only the meeting''s chair or secretary reviews its pack'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_cutoff_pack_reviewer';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER meeting_cutoff_pack_guard BEFORE INSERT OR UPDATE ON meeting_cutoff_pack
  FOR EACH ROW EXECUTE FUNCTION meeting_cutoff_pack_guard();
SELECT p2_attach_guards('meeting_cutoff_pack', true);
GRANT SELECT, INSERT, UPDATE ON meeting_cutoff_pack TO mth_app;

-- REQ-S12-015 "it is not published without review": an agenda item generated into a cut-off pack is published only
-- after the pack is reviewed. Items outside packs (every DG4 item) are unaffected.
CREATE FUNCTION agenda_item_cutoff_review() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'published' AND OLD.status IS DISTINCT FROM 'published' AND EXISTS (
       SELECT 1 FROM meeting_cutoff_pack p WHERE p.meeting_id = NEW.meeting_id AND NEW.id = ANY (p.agenda_item_ids)
         AND p.status = 'draft') THEN
    RAISE EXCEPTION 'agenda_item: the cut-off pack of this item is not reviewed yet'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'agenda_item_cutoff_pack_unreviewed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER agenda_item_cutoff_review BEFORE UPDATE OF status ON agenda_item
  FOR EACH ROW EXECUTE FUNCTION agenda_item_cutoff_review();

-- -----------------------------------------------------------------------------------------------------------------
-- dependency_slip: one detected slip of a critical dependency (REQ-S12-012, M0232). slip_key is
-- `<predecessor initiative id>:<schedule version>`; slip_days is the calendar-day move of the predecessor's finish
-- (ADR-0023 §5 predecessor finish); affected lists each dependent initiative with its owner and its forecast finish
-- before and after, computed by the DG4 scheduling functions unchanged. Append-only; one per (dependency, slip key).
CREATE TABLE dependency_slip (
  id                        uuid PRIMARY KEY,
  organization_id           uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id         uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  dependency_id             uuid NOT NULL,
  slip_key                  text NOT NULL CHECK (char_length(slip_key) BETWEEN 1 AND 200),
  predecessor_finish_before date NOT NULL,
  predecessor_finish_after  date NOT NULL,
  slip_days                 integer NOT NULL CHECK (slip_days BETWEEN 1 AND 3650),
  needed_by                 date NULL,
  critical_reason           text NOT NULL CHECK (critical_reason IN ('critical_path', 'needed_by_breached')),
  affected                  jsonb NOT NULL CHECK (jsonb_typeof(affected) = 'array' AND jsonb_array_length(affected) <= 200),
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT dependency_slip_dependency_fkey FOREIGN KEY (transformation_id, dependency_id)
    REFERENCES dependency (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT dependency_slip_once_key UNIQUE (dependency_id, slip_key),
  CONSTRAINT dependency_slip_days CHECK (slip_days = predecessor_finish_after - predecessor_finish_before),
  CONSTRAINT dependency_slip_needed_by CHECK (critical_reason <> 'needed_by_breached'
                                              OR (needed_by IS NOT NULL AND predecessor_finish_after > needed_by))
);
SELECT p2_attach_append_only('dependency_slip');
SELECT p2_attach_guards('dependency_slip', true);
GRANT SELECT, INSERT ON dependency_slip TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- Work-item kinds of slices D and E (My Work sections in reporting/my-work.ts MY_WORK_SECTION_BY_KIND).
INSERT INTO work_item_kind (code, owner_module, label_en, label_ar, source_ref, urgency) VALUES
  ('automation_task', 'automation', 'Task created by an automation rule', 'مهمة أنشأتها قاعدة أتمتة', 'M0221', 'normal'),
  ('automation_rule_review', 'automation', 'Automation rule version to review', 'نسخة قاعدة أتمتة بانتظار المراجعة', 'M0221', 'normal'),
  ('role_assignment', 'transformations', 'Assign a role in a new transformation', 'إسناد دور في تحوّل جديد', 'M0224', 'normal'),
  ('dependency_slip', 'portfolio', 'A critical dependency slipped', 'تأخرت اعتمادية حرجة', 'M0232', 'normal'),
  ('gate_condition_overdue', 'workflows', 'Overdue condition of a conditional approval escalated to you', 'شرط متأخر من شروط الاعتماد المشروط صُعّد إليك', 'M0124', 'urgent'),
  ('meeting_pack_review', 'governance', 'Draft agenda and pack to review before publication', 'مسودة جدول أعمال وحزمة للمراجعة قبل النشر', 'M0235', 'normal');
