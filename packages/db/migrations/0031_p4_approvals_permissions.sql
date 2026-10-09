-- 0031 P4 canonical approval record (assignee, request version, due date, outcomes, rationale, comments, decision
-- time), its append-only decisions and escalations, the read-only union view of decisions, and the P4 permission
-- catalogue and role defaults of slices I and C (T-DG4-ARCH-01; ADR-0026 §4, §6, §8; D-089 Q10). Authored by
-- solution-architect. Contract: docs/architecture/data-dictionary.md ("P4" section). Runs as mth_owner inside one
-- transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
-- An approval here is a BUSINESS approval decided by a named person. No row, job or trigger here approves anything:
-- an approved or rejected approval needs a decision row written by a user (approval_guard), and the escalation timer
-- only records an escalation (approval_escalation). Nothing here touches the engineering gates DG0-DG7.

-- -----------------------------------------------------------------------------------------------------------------
-- approval_type: what can be approved through the engine. subject_table names the table whose row (id,
-- transformation_id, version) is the subject. Later slices insert their own types (e.g. change_request) in their own
-- migrations. default_sod_policy is the separation-of-duties policy copied onto each approval (REQ-S10-016).
CREATE TABLE approval_type (
  code                    text PRIMARY KEY CHECK (code ~ '^[a-z_]+$'),
  subject_table           text NOT NULL CHECK (subject_table ~ '^[a-z_]+$'),
  default_sod_policy      text NOT NULL CHECK (default_sod_policy IN ('requester_excluded', 'requester_allowed')),
  requires_decision_right boolean NOT NULL,
  owner_module            text NOT NULL CHECK (owner_module ~ '^[a-z_]+$'),
  label_en                text NOT NULL CHECK (char_length(label_en) BETWEEN 1 AND 200),
  label_ar                text NOT NULL CHECK (char_length(label_ar) BETWEEN 1 AND 200),
  source_ref              text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 50)
);
GRANT SELECT ON approval_type TO mth_app;
INSERT INTO approval_type (code, subject_table, default_sod_policy, requires_decision_right, owner_module, label_en, label_ar, source_ref) VALUES
  ('decision_request', 'decision', 'requester_excluded', true, 'workflows', 'Decision routed by the decision rights matrix', 'قرار موجّه وفق مصفوفة صلاحيات القرار', 'B0099;M0231'),
  ('governance_matrix_change', 'governance_matrix', 'requester_excluded', false, 'governance', 'Decision rights matrix or RACI change', 'تغيير مصفوفة صلاحيات القرار أو مصفوفة المسؤوليات', 'M0203;M0211');

-- -----------------------------------------------------------------------------------------------------------------
-- approval: one approval request (REQ-S10-014, M0213). Status machine (ADR-0026 §4):
--   pending -> approved | rejected | changes_requested | deferred | withdrawn
--   deferred -> approved | rejected | changes_requested | deferred | withdrawn
--   changes_requested -> pending (resubmission: new subject version, round_no + 1) | withdrawn
--   approved, rejected, withdrawn: final and immutable.
CREATE TABLE approval (
  id                      uuid PRIMARY KEY,
  organization_id         uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id       uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  approval_type           text NOT NULL REFERENCES approval_type (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  subject_type            text NOT NULL CHECK (subject_type ~ '^[a-z_]+$'),
  subject_id              uuid NOT NULL,
  subject_version         integer NOT NULL CHECK (subject_version >= 1),
  round_no                smallint NOT NULL DEFAULT 1 CHECK (round_no >= 1),
  decision_right_id       uuid NULL,
  title                   text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  request_note            text NULL CHECK (request_note IS NULL OR char_length(request_note) BETWEEN 1 AND 4000),
  requested_by            uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  requested_at            timestamptz NOT NULL DEFAULT now(),
  request_business_date   date NOT NULL,
  assignee_party_code     text NOT NULL REFERENCES governance_party (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  assignee_user_id        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  assignee_group_id       uuid NULL,
  sla_type                text NULL CHECK (sla_type IS NULL OR sla_type IN ('working_days', 'next_steerco_or_urgent', 'release_plan')),
  urgent_reason           text NULL CHECK (urgent_reason IS NULL OR char_length(urgent_reason) BETWEEN 1 AND 2000),
  due_date                date NULL,
  due_unknown_reason      text NULL CHECK (due_unknown_reason IS NULL OR due_unknown_reason IN
                            ('no_steerco_scheduled', 'no_release_date', 'calendar_not_configured', 'no_sla')),
  calendar_id             uuid NULL,
  calendar_version        integer NULL CHECK (calendar_version IS NULL OR calendar_version >= 1),
  sod_policy              text NOT NULL CHECK (sod_policy IN ('requester_excluded', 'requester_allowed')),
  status                  text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'changes_requested', 'deferred', 'approved', 'rejected', 'withdrawn')),
  escalation_level        smallint NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 5),
  escalated_to_party_code text NULL REFERENCES governance_party (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  escalated_to_user_id    uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  escalated_to_group_id   uuid NULL,
  decided_by              uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_on_behalf_of    uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_at              timestamptz NULL,
  version                 integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT approval_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT approval_decision_right_fkey FOREIGN KEY (transformation_id, decision_right_id)
    REFERENCES transformation_decision_right (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT approval_assignee_group_fkey FOREIGN KEY (organization_id, assignee_group_id)
    REFERENCES access_group (organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT approval_escalated_group_fkey FOREIGN KEY (organization_id, escalated_to_group_id)
    REFERENCES access_group (organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT approval_calendar_fkey FOREIGN KEY (organization_id, calendar_id)
    REFERENCES business_calendar (organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT approval_one_assignee CHECK ((assignee_user_id IS NULL) <> (assignee_group_id IS NULL)),
  CONSTRAINT approval_escalation_target CHECK (
    (escalation_level = 0 AND escalated_to_party_code IS NULL AND escalated_to_user_id IS NULL AND escalated_to_group_id IS NULL)
    OR (escalation_level > 0 AND (escalated_to_user_id IS NULL OR escalated_to_group_id IS NULL))),
  CONSTRAINT approval_due_known_or_reason CHECK ((due_date IS NULL) = (due_unknown_reason IS NOT NULL)),
  CONSTRAINT approval_working_day_calendar CHECK (sla_type IS DISTINCT FROM 'working_days' OR due_date IS NULL OR calendar_id IS NOT NULL),
  CONSTRAINT approval_urgent_reason CHECK (urgent_reason IS NULL OR sla_type = 'next_steerco_or_urgent'),
  CONSTRAINT approval_final_decided CHECK (
    (status IN ('approved', 'rejected')) = (decided_at IS NOT NULL) AND (decided_at IS NULL) = (decided_by IS NULL)
    AND (decided_on_behalf_of IS NULL OR decided_by IS NOT NULL)),
  CONSTRAINT approval_sod CHECK (
    sod_policy = 'requester_allowed' OR decided_by IS NULL
    OR (decided_by <> requested_by AND decided_on_behalf_of IS DISTINCT FROM requested_by))
);
-- At most one open approval per subject and type (REQ-S10-017: one current request version per subject).
CREATE UNIQUE INDEX approval_one_open_per_subject ON approval (approval_type, subject_id)
  WHERE status IN ('pending', 'changes_requested', 'deferred');
CREATE INDEX approval_assignee_open_idx ON approval (assignee_user_id, due_date NULLS LAST) WHERE status IN ('pending', 'deferred');
CREATE INDEX approval_group_open_idx ON approval (assignee_group_id) WHERE status IN ('pending', 'deferred');
CREATE INDEX approval_requested_by_idx ON approval (requested_by, requested_at DESC, id DESC);
CREATE INDEX approval_overdue_scan_idx ON approval (due_date) WHERE status IN ('pending', 'deferred') AND due_date IS NOT NULL;
CREATE INDEX approval_transformation_idx ON approval (transformation_id, requested_at DESC, id DESC);

-- The subject's current version, read FOR SHARE (a concurrent subject update waits for this transaction). NULL when
-- the subject does not exist in the transformation.
CREATE FUNCTION p4_approval_subject_version(p_type text, p_subject_id uuid, p_transformation_id uuid) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  tbl text;
  v integer;
BEGIN
  SELECT t.subject_table INTO tbl FROM approval_type t WHERE t.code = p_type;
  IF tbl IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE format('SELECT version FROM %I WHERE id = $1 AND transformation_id = $2 FOR SHARE', tbl)
    INTO v USING p_subject_id, p_transformation_id;
  RETURN v;
END $$;

CREATE FUNCTION approval_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  approval_subject_lock_class CONSTANT integer := 730226;
  tbl text;
  cur integer;
  ok boolean;
BEGIN
  SELECT t.subject_table INTO tbl FROM approval_type t WHERE t.code = NEW.approval_type;
  IF NEW.subject_type IS DISTINCT FROM tbl THEN
    RAISE EXCEPTION 'approval: subject_type % does not match approval type % (%)', NEW.subject_type, NEW.approval_type, tbl
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_subject_type';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.subject_version IS DISTINCT FROM OLD.subject_version THEN
    PERFORM pg_advisory_xact_lock(approval_subject_lock_class, hashtext(NEW.subject_id::text));
    cur := p4_approval_subject_version(NEW.approval_type, NEW.subject_id, NEW.transformation_id);
    IF cur IS NULL THEN
      RAISE EXCEPTION 'approval: subject % % does not exist in transformation %', tbl, NEW.subject_id, NEW.transformation_id
        USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'approval_subject_ref';
    END IF;
    IF cur <> NEW.subject_version THEN
      RAISE EXCEPTION 'approval: requested version % but the subject is at version %', NEW.subject_version, cur
        USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_subject_version_current';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.round_no <> 1 OR NEW.escalation_level <> 0 THEN
      RAISE EXCEPTION 'approval: a new approval starts pending, in round 1, not escalated'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_initial_state';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('approved', 'rejected', 'withdrawn') THEN
    RAISE EXCEPTION 'approval: a % approval is final and immutable', OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_final_immutable';
  END IF;
  IF NEW.approval_type IS DISTINCT FROM OLD.approval_type OR NEW.subject_id IS DISTINCT FROM OLD.subject_id
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.sod_policy IS DISTINCT FROM OLD.sod_policy THEN
    RAISE EXCEPTION 'approval: type, subject, requester and SoD policy are immutable'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_identity_immutable';
  END IF;
  ok := CASE OLD.status
          WHEN 'pending' THEN NEW.status IN ('pending', 'approved', 'rejected', 'changes_requested', 'deferred', 'withdrawn')
          WHEN 'deferred' THEN NEW.status IN ('deferred', 'approved', 'rejected', 'changes_requested', 'withdrawn')
          WHEN 'changes_requested' THEN NEW.status IN ('changes_requested', 'pending', 'withdrawn')
          ELSE false END;
  IF NOT ok THEN
    RAISE EXCEPTION 'approval: % -> % is not an allowed transition', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_status_step';
  END IF;
  -- Resubmission after changes requested: a new round on a new subject version.
  IF OLD.status = 'changes_requested' AND NEW.status = 'pending'
     AND (NEW.round_no <> OLD.round_no + 1 OR NEW.subject_version <= OLD.subject_version) THEN
    RAISE EXCEPTION 'approval: a resubmission starts round % on a newer subject version', OLD.round_no + 1
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_resubmission';
  END IF;
  IF NEW.round_no <> OLD.round_no AND NOT (OLD.status = 'changes_requested' AND NEW.status = 'pending') THEN
    RAISE EXCEPTION 'approval: round_no changes only on resubmission'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_resubmission';
  END IF;
  -- An escalation never changes the outcome (REQ-S10-019).
  IF NEW.escalation_level <> OLD.escalation_level AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'approval: an escalation cannot change the status'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_escalation_no_outcome';
  END IF;
  IF NEW.escalation_level < OLD.escalation_level THEN
    RAISE EXCEPTION 'approval: the escalation level never decreases'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_escalation_monotonic';
  END IF;
  -- A status that records an outcome needs the user's decision row of this round with that outcome
  -- (REQ-S10-018/019: only a person decides; a timer never approves).
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved', 'rejected', 'changes_requested', 'deferred') THEN
    IF NOT EXISTS (SELECT 1 FROM approval_decision d
                   WHERE d.approval_id = NEW.id AND d.round_no = NEW.round_no
                     AND d.outcome = CASE NEW.status WHEN 'approved' THEN 'approve' WHEN 'rejected' THEN 'reject'
                                                     WHEN 'changes_requested' THEN 'request_changes' ELSE 'defer' END
                     AND (NEW.status NOT IN ('approved', 'rejected') OR d.decided_by = NEW.decided_by)) THEN
      RAISE EXCEPTION 'approval: status % needs a matching decision of round % by a user', NEW.status, NEW.round_no
        USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_outcome_needs_decision';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER approval_guard BEFORE INSERT OR UPDATE ON approval FOR EACH ROW EXECUTE FUNCTION approval_guard();
SELECT p2_attach_guards('approval', true);
GRANT SELECT, INSERT, UPDATE ON approval TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- approval_decision: every outcome a person records, append-only (REQ-S10-014, REQ-S10-018). Rationale is required for
-- every outcome; 'defer' requires a new date after the decision's business date.
CREATE TABLE approval_decision (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id    uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  approval_id          uuid NOT NULL,
  round_no             smallint NOT NULL CHECK (round_no >= 1),
  outcome              text NOT NULL CHECK (outcome IN ('approve', 'reject', 'request_changes', 'defer')),
  rationale            text NOT NULL CONSTRAINT approval_decision_rationale_required
                       CHECK (char_length(btrim(rationale)) >= 1 AND char_length(rationale) <= 8000),
  comments             text NULL CHECK (comments IS NULL OR char_length(comments) BETWEEN 1 AND 8000),
  subject_version      integer NOT NULL CHECK (subject_version >= 1),
  decided_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  on_behalf_of_user_id uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_at           timestamptz NOT NULL DEFAULT now(),
  business_date        date NOT NULL,
  defer_until          date NULL,
  CONSTRAINT approval_decision_approval_fkey FOREIGN KEY (transformation_id, approval_id)
    REFERENCES approval (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT approval_decision_defer_date CHECK ((outcome = 'defer') = (defer_until IS NOT NULL)
                                                 AND (defer_until IS NULL OR defer_until > business_date)),
  CONSTRAINT approval_decision_not_self_behalf CHECK (on_behalf_of_user_id IS DISTINCT FROM decided_by)
);
CREATE INDEX approval_decision_approval_idx ON approval_decision (approval_id, decided_at, id);
-- Decide only an open request, on its current round and request version, which is still the subject's current version
-- (stale -> refused, REQ-S10-017), and never as (or on behalf of) the requester under requester_excluded (REQ-S10-016).
CREATE FUNCTION approval_decision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  approval_subject_lock_class CONSTANT integer := 730226;
  a record;
  cur integer;
BEGIN
  SELECT x.* INTO a FROM approval x WHERE x.id = NEW.approval_id AND x.transformation_id = NEW.transformation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW; -- the foreign key reports it
  END IF;
  IF a.status NOT IN ('pending', 'deferred') THEN
    RAISE EXCEPTION 'approval_decision: approval % is % and cannot be decided', a.id, a.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_decision_open';
  END IF;
  IF NEW.round_no <> a.round_no OR NEW.subject_version <> a.subject_version THEN
    RAISE EXCEPTION 'approval_decision: decides round % version % but the request is round % version %',
      NEW.round_no, NEW.subject_version, a.round_no, a.subject_version
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_decision_stale';
  END IF;
  PERFORM pg_advisory_xact_lock(approval_subject_lock_class, hashtext(a.subject_id::text));
  cur := p4_approval_subject_version(a.approval_type, a.subject_id, a.transformation_id);
  IF cur IS DISTINCT FROM a.subject_version THEN
    RAISE EXCEPTION 'approval_decision: the subject moved from version % to %', a.subject_version, cur
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_decision_stale';
  END IF;
  IF a.sod_policy = 'requester_excluded'
     AND (NEW.decided_by = a.requested_by OR NEW.on_behalf_of_user_id IS NOT DISTINCT FROM a.requested_by) THEN
    RAISE EXCEPTION 'approval_decision: the requester cannot decide their own request (separation of duties)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_decision_sod';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER approval_decision_guard BEFORE INSERT ON approval_decision
  FOR EACH ROW EXECUTE FUNCTION approval_decision_guard();
SELECT p2_attach_append_only('approval_decision');
SELECT p2_attach_guards('approval_decision', true);
GRANT SELECT, INSERT ON approval_decision TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- approval_escalation: what the overdue timer did, append-only (REQ-S10-019). At most one escalation per approval,
-- round and due date (UNIQUE), so retries and restarts escalate exactly once; a deferral to a new date allows one more.
-- Only an open, overdue approval (due date before today's business date in the calendar's timezone) can be escalated.
-- An escalation with no reachable next authority is recorded with routing_error (visible, never a silent skip).
CREATE TABLE approval_escalation (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  approval_id       uuid NOT NULL,
  round_no          smallint NOT NULL CHECK (round_no >= 1),
  due_date          date NOT NULL,
  level             smallint NOT NULL CHECK (level BETWEEN 1 AND 5),
  from_party_code   text NOT NULL REFERENCES governance_party (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  to_party_code     text NULL REFERENCES governance_party (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  to_user_id        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  to_group_id       uuid NULL,
  routing_error     text NULL CHECK (routing_error IS NULL OR routing_error IN ('no_next_authority', 'party_unmapped', 'party_not_approver')),
  escalated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_escalation_approval_fkey FOREIGN KEY (transformation_id, approval_id)
    REFERENCES approval (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT approval_escalation_group_fkey FOREIGN KEY (organization_id, to_group_id)
    REFERENCES access_group (organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT approval_escalation_once UNIQUE (approval_id, round_no, due_date),
  CONSTRAINT approval_escalation_target CHECK (
    (routing_error IS NULL AND to_party_code IS NOT NULL AND (to_user_id IS NULL) <> (to_group_id IS NULL))
    OR (routing_error IN ('party_unmapped', 'party_not_approver') AND to_party_code IS NOT NULL AND to_user_id IS NULL AND to_group_id IS NULL)
    OR (routing_error = 'no_next_authority' AND to_party_code IS NULL AND to_user_id IS NULL AND to_group_id IS NULL))
);
CREATE FUNCTION approval_escalation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  a record;
  tz text;
BEGIN
  SELECT x.status, x.round_no, x.due_date, x.calendar_id, x.organization_id INTO a FROM approval x
  WHERE x.id = NEW.approval_id AND x.transformation_id = NEW.transformation_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  SELECT coalesce((SELECT c.timezone FROM business_calendar c WHERE c.id = a.calendar_id),
                  (SELECT o.default_timezone FROM organization o WHERE o.id = a.organization_id)) INTO tz;
  IF a.status NOT IN ('pending', 'deferred') OR a.round_no <> NEW.round_no OR a.due_date IS DISTINCT FROM NEW.due_date
     OR NOT (a.due_date < p4_business_date(now(), tz)) THEN
    RAISE EXCEPTION 'approval_escalation: approval % is not open and overdue for round % and due date %', NEW.approval_id, NEW.round_no, NEW.due_date
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_escalation_overdue';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER approval_escalation_guard BEFORE INSERT ON approval_escalation
  FOR EACH ROW EXECUTE FUNCTION approval_escalation_guard();
SELECT p2_attach_append_only('approval_escalation');
SELECT p2_attach_guards('approval_escalation', true);
GRANT SELECT, INSERT ON approval_escalation TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- approval_decision_record: read-only union of the business-approval decisions (D-089 Q10): P4 approval decisions,
-- product-gate decisions (G1-G6) and funding decisions. The existing tables are not migrated. outcome is normalized to
-- approved | rejected | changes_requested | deferred | revoked.
CREATE VIEW approval_decision_record AS
SELECT 'approval'::text AS source, d.id AS record_id, d.organization_id, d.transformation_id, a.approval_type AS approval_kind,
       a.subject_type, a.subject_id, d.subject_version,
       CASE d.outcome WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected'
                      WHEN 'request_changes' THEN 'changes_requested' ELSE 'deferred' END AS outcome,
       d.rationale, d.decided_by, d.on_behalf_of_user_id, d.decided_at
FROM approval_decision d JOIN approval a ON a.id = d.approval_id
UNION ALL
SELECT 'gate_decision', g.id, g.organization_id, g.transformation_id, 'gate_' || lower(g.gate_code), 'gate_submission',
       g.gate_submission_id, g.submission_no, g.outcome, g.rationale, g.decided_by, g.on_behalf_of_user_id, g.decided_at
FROM gate_decision g
UNION ALL
SELECT 'funding_decision', f.id, f.organization_id, f.transformation_id, 'funding', 'initiative', f.initiative_id, NULL::integer,
       f.outcome, f.rationale, f.decided_by, f.on_behalf_of_user_id, f.decided_at
FROM funding_decision f;
GRANT SELECT ON approval_decision_record TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- P4 permission catalogue and role defaults, slices I and C. EXACTLY packages/shared/src/permissions.ts
-- P4_PERMISSIONS / P4_ROLE_PERMISSIONS (packages/db/src/seed.test.ts compares them). A CONFIGURABLE STARTING POINT,
-- not a Mobily-approved access policy. The 0001 SoD trigger still refuses any technical_admin role holding a
-- business_approval or finance_validation permission (REQ-S10-003). approval.decide is business_approval and goes ONLY
-- to SP, BO and FIN, the roles that already hold a business_approval or finance_validation permission: giving it to TL,
-- TO, WL or CM would change two DG1/DG2 rules that key on "a role holding an approval permission" (the creator-derived
-- assignment, F-DG1-106, and the team-role assignment, ADR-0020 §3). Later P4 slices append their own rows.
INSERT INTO permission (code, category, description_en, description_ar) VALUES
  ('calendar.configure', 'configure', 'Configure business calendars: timezone, workweek and holidays', 'إعداد تقاويم العمل: المنطقة الزمنية وأيام العمل والعطل'),
  ('job.read', 'read', 'View scheduled jobs and their configuration', 'عرض المهام المجدولة وإعداداتها'),
  ('job.configure', 'configure', 'Enable, disable and reschedule scheduled jobs', 'تفعيل المهام المجدولة وتعطيلها وإعادة جدولتها'),
  ('group.manage', 'configure', 'Create governed groups and manage their members', 'إنشاء المجموعات المحكومة وإدارة أعضائها'),
  ('role_mapping.assign', 'configure', 'Map governance roles to named people or governed groups in a transformation', 'ربط أدوار الحوكمة بأشخاص محددين أو بمجموعات محكومة في التحول'),
  ('delegation.create_own', 'write', 'Delegate your own approvals for a period, for example during an absence', 'تفويض موافقاتك لفترة محددة، مثلاً أثناء الغياب'),
  ('delegation.manage', 'configure', 'Record or revoke a delegation on the delegator''s request', 'تسجيل تفويض أو إلغاؤه بناءً على طلب المفوِّض'),
  ('approval.request', 'write', 'Request an approval routed by the decision rights matrix', 'طلب موافقة موجّهة وفق مصفوفة صلاحيات القرار'),
  ('approval.decide', 'business_approval', 'Decide an approval assigned to you or your group (business approval)', 'البت في موافقة مسندة إليك أو إلى مجموعتك (اعتماد أعمال)'),
  ('decision_right.configure', 'configure', 'Edit the transformation''s decision rights matrix (T11)', 'تحرير مصفوفة صلاحيات القرار للتحول'),
  ('raci.edit', 'write', 'Edit the transformation''s RACI (T12)', 'تحرير مصفوفة المسؤوليات للتحول');

INSERT INTO role_permission (role_id, permission_code) VALUES
  ('01920000-0000-7000-8000-000000000001', 'delegation.create_own'), -- SP
  ('01920000-0000-7000-8000-000000000001', 'approval.request'), -- SP
  ('01920000-0000-7000-8000-000000000001', 'approval.decide'), -- SP
  ('01920000-0000-7000-8000-000000000002', 'role_mapping.assign'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'delegation.create_own'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'approval.request'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'decision_right.configure'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'raci.edit'), -- TL
  ('01920000-0000-7000-8000-000000000003', 'delegation.create_own'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'approval.request'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'approval.decide'), -- BO
  ('01920000-0000-7000-8000-000000000004', 'delegation.create_own'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'approval.request'), -- WL
  ('01920000-0000-7000-8000-000000000005', 'delegation.create_own'), -- FIN
  ('01920000-0000-7000-8000-000000000005', 'approval.request'), -- FIN
  ('01920000-0000-7000-8000-000000000005', 'approval.decide'), -- FIN
  ('01920000-0000-7000-8000-000000000006', 'group.manage'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'role_mapping.assign'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'delegation.create_own'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'approval.request'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'decision_right.configure'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'raci.edit'), -- TO
  ('01920000-0000-7000-8000-000000000007', 'delegation.create_own'), -- KDS
  ('01920000-0000-7000-8000-000000000008', 'delegation.create_own'), -- TD
  ('01920000-0000-7000-8000-000000000009', 'delegation.create_own'), -- CM
  ('01920000-0000-7000-8000-00000000000a', 'delegation.create_own'), -- SEC
  ('01920000-0000-7000-8000-00000000000c', 'calendar.configure'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'job.read'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'job.configure'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000d', 'delegation.manage'); -- ADM_ACCESS
