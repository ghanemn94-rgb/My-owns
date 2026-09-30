-- ============================================================================================================
-- Post-migrate SQL (idempotent). Applied by the OWNER role after every migration run.
--   1. Session-context helper functions used by RLS
--   2. Row-level security: project isolation (every table with project_id) + org isolation
--   3. Least-privilege grants for the runtime role hub_app (NOT owner, NOBYPASSRLS)
--   4. Append-only / immutability triggers (audit, votes, history, snapshots)
--   5. Tamper-evident audit hash chain
--   6. Retention / legal-hold guard on documents (AT-27)
--   7. SECURITY DEFINER auth lookups (the only RLS bypass, narrowly scoped)
-- See ADR-0003 (isolation) and ADR-0014 (audit) for rationale and limits.
-- ============================================================================================================

-- 1. Context helpers ----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_org_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.org_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_project_ids() RETURNS uuid[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_to_array(nullif(current_setting('app.project_ids', true), ''), ',')::uuid[], '{}'::uuid[])
$$;

-- Projects where the principal is a full member (not merely room-scoped, e.g. clean team / external partner).
CREATE OR REPLACE FUNCTION app_full_project_ids() RETURNS uuid[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_to_array(nullif(current_setting('app.full_project_ids', true), ''), ',')::uuid[], '{}'::uuid[])
$$;

-- Partner / clean-team rooms with an active grant for the principal.
CREATE OR REPLACE FUNCTION app_room_ids() RETURNS uuid[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_to_array(nullif(current_setting('app.room_ids', true), ''), ',')::uuid[], '{}'::uuid[])
$$;

-- Room-only principal (clean team / external partner with no project, workstream or org role): set by the API.
CREATE OR REPLACE FUNCTION app_room_only() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.room_only', true), '') = 'true'
$$;

-- 2. Row-level security -------------------------------------------------------------------------------------
DO $rls$
DECLARE
  r record;
  -- Infrastructure tables accessed by the worker across projects. Payloads carry ids only; every job re-enters
  -- a project-scoped context before touching business data. Exempt from RLS by design (documented in ADR-0004).
  exempt text[] := ARRAY['job', 'outbox_event', 'scheduled_job', 'delivery_record', 'session', '__drizzle_migrations'];
  -- Tables with a NULLABLE project_id: org-level rows allowed when project_id IS NULL.
  nullable_project text[] := ARRAY['audit_event', 'record_version'];
BEGIN
  -- (a) Tables with a project_id column
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND c.column_name = 'project_id' AND t.table_type = 'BASE TABLE'
  LOOP
    CONTINUE WHEN r.table_name = ANY (exempt);
    CONTINUE WHEN r.table_name IN ('notification', 'project_membership');
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS hub_project_isolation ON %I', r.table_name);
    IF r.table_name = ANY (nullable_project) THEN
      -- Reads: full members only; writes (e.g. audit of a room-only user's actions): any in-scope project.
      -- org-level rows (project_id NULL) are not readable by room-only principals (SEC-P1-12)
      EXECUTE format(
        'CREATE POLICY hub_project_isolation ON %I USING (org_id = app_org_id() AND ((project_id IS NULL AND NOT app_room_only()) OR project_id = ANY (app_full_project_ids()))) WITH CHECK (org_id = app_org_id() AND (project_id IS NULL OR project_id = ANY (app_project_ids())))',
        r.table_name);
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns c3 WHERE c3.table_schema = 'public' AND c3.table_name = r.table_name AND c3.column_name = 'room_id') THEN
      -- Room-bearing tables: full members see the project's rows; room-only principals only rows of their rooms.
      EXECUTE format(
        'CREATE POLICY hub_project_isolation ON %I USING (project_id = ANY (app_full_project_ids()) OR (project_id = ANY (app_project_ids()) AND room_id = ANY (app_room_ids()))) WITH CHECK (project_id = ANY (app_full_project_ids()) OR (project_id = ANY (app_project_ids()) AND room_id = ANY (app_room_ids())))',
        r.table_name);
    ELSE
      -- Everything else: full members only (room-only principals see nothing).
      EXECUTE format(
        'CREATE POLICY hub_project_isolation ON %I USING (project_id = ANY (app_full_project_ids())) WITH CHECK (project_id = ANY (app_full_project_ids()))',
        r.table_name);
    END IF;
  END LOOP;

  -- (b) Org-level tables (org_id, no project_id)
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND c.column_name = 'org_id' AND t.table_type = 'BASE TABLE'
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns c2
        WHERE c2.table_schema = 'public' AND c2.table_name = c.table_name AND c2.column_name = 'project_id')
  LOOP
    CONTINUE WHEN r.table_name = ANY (exempt);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS hub_org_isolation ON %I', r.table_name);
    -- Room-only principals (clean team / partner) read no organization-level data (SEC-P1-12); app_user is re-scoped below.
    EXECUTE format(
      'CREATE POLICY hub_org_isolation ON %I USING (org_id = app_org_id() AND NOT app_room_only()) WITH CHECK (org_id = app_org_id() AND NOT app_room_only())',
      r.table_name);
  END LOOP;
END
$rls$;

-- app_user: a room-only principal sees only its own account (not the organization's directory) — SEC-P1-12.
DROP POLICY IF EXISTS hub_org_isolation ON app_user;
CREATE POLICY hub_org_isolation ON app_user
  USING (org_id = app_org_id() AND (NOT app_room_only() OR id = app_user_id()))
  WITH CHECK (org_id = app_org_id() AND (NOT app_room_only() OR id = app_user_id()));

-- organization: a session sees only its own organization
ALTER TABLE organization ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hub_org_self ON organization;
CREATE POLICY hub_org_self ON organization USING (id = app_org_id());

-- project: visible only when in the caller's computed project scope. INSERT of a new project is allowed when
-- the service has added the new id to app.project_ids inside the same transaction.
DROP POLICY IF EXISTS hub_org_isolation ON project;
ALTER TABLE project ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hub_project_self ON project;
CREATE POLICY hub_project_self ON project
  USING (org_id = app_org_id() AND id = ANY (app_project_ids()))
  WITH CHECK (org_id = app_org_id() AND id = ANY (app_project_ids()));

-- project_membership: full members see the project's team; everyone sees their own memberships (needed to compute
-- scope). Room-only principals (clean team / external partner) do NOT see the internal team (ARCH-22).
ALTER TABLE project_membership ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hub_project_isolation ON project_membership;
DROP POLICY IF EXISTS hub_membership_access ON project_membership;
CREATE POLICY hub_membership_access ON project_membership
  USING (org_id = app_org_id() AND (project_id = ANY (app_full_project_ids()) OR user_id = app_user_id()))
  WITH CHECK (org_id = app_org_id() AND project_id = ANY (app_full_project_ids()));

-- notification: users read only their own; services may create for others inside the project scope.
ALTER TABLE notification ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hub_project_isolation ON notification;
DROP POLICY IF EXISTS hub_notification_read ON notification;
DROP POLICY IF EXISTS hub_notification_write ON notification;
DROP POLICY IF EXISTS hub_notification_update ON notification;
CREATE POLICY hub_notification_read ON notification FOR SELECT
  USING (org_id = app_org_id() AND user_id = app_user_id() AND (project_id IS NULL OR project_id = ANY (app_project_ids())));
CREATE POLICY hub_notification_write ON notification FOR INSERT
  WITH CHECK (org_id = app_org_id() AND (project_id IS NULL OR project_id = ANY (app_project_ids())));
CREATE POLICY hub_notification_update ON notification FOR UPDATE
  USING (org_id = app_org_id() AND user_id = app_user_id())
  WITH CHECK (org_id = app_org_id() AND user_id = app_user_id());

-- partner_room: room-only principals may read the rooms they are granted (id, not room_id).
DROP POLICY IF EXISTS hub_project_isolation ON partner_room;
CREATE POLICY hub_project_isolation ON partner_room
  USING (project_id = ANY (app_full_project_ids()) OR (project_id = ANY (app_project_ids()) AND id = ANY (app_room_ids())))
  WITH CHECK (project_id = ANY (app_full_project_ids()));

-- room_grant: room-only principals read only their OWN grants and can never write grants (ARCH-22).
DROP POLICY IF EXISTS hub_project_isolation ON room_grant;
CREATE POLICY hub_project_isolation ON room_grant
  USING (project_id = ANY (app_full_project_ids()) OR (project_id = ANY (app_project_ids()) AND user_id = app_user_id()))
  WITH CHECK (project_id = ANY (app_full_project_ids()));

-- 3. Grants ------------------------------------------------------------------------------------------------
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO hub_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hub_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hub_app';
    -- Append-only tables: no UPDATE/DELETE for the runtime role
    EXECUTE 'REVOKE UPDATE, DELETE ON audit_event, vote, record_version, approval_record, transfer_record, readiness_test_run, report_snapshot FROM hub_app';
    -- P3 history tables: decision records of cutover GO/NO-GO, agreement versions, perimeter impact assessments
    EXECUTE 'REVOKE UPDATE, DELETE ON cutover_decision_record, agreement_version, perimeter_impact_assessment FROM hub_app';
    -- Documents are soft-deleted only; grant/membership history is revoked, never hard-deleted (ARCH-15c)
    EXECUTE 'REVOKE DELETE ON document, document_version, organization, project, org_role_assignment, project_membership, room_grant, recusal, conflict_declaration, attendance FROM hub_app';
    EXECUTE 'REVOKE UPDATE ON recusal, conflict_declaration FROM hub_app';
    -- Audit checkpoints are written only by hub_audit_checkpoint() (no forged checkpoints, ARCH-05b)
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON audit_checkpoint FROM hub_app';
    -- No temporary objects for the runtime role (prevents pg_temp shadowing in SECURITY DEFINER functions, ARCH-03)
    EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
    EXECUTE format('GRANT TEMPORARY ON DATABASE %I TO hub_owner', current_database());
    -- Migration bookkeeping is owner-only
    IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM hub_app';
    END IF;
  END IF;
END
$grants$;

-- 4. Append-only / immutability triggers -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hub_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append_only_violation: % on % is not permitted', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END
$$;

DO $append$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_event', 'vote', 'record_version', 'approval_record', 'transfer_record', 'readiness_test_run', 'report_snapshot', 'recusal', 'conflict_declaration', 'audit_checkpoint', 'cutover_decision_record', 'agreement_version', 'perimeter_impact_assessment']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS hub_append_only ON %I', t);
    EXECUTE format('CREATE TRIGGER hub_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION hub_reject_mutation()', t);
    -- Row triggers do not fire on TRUNCATE (ARCH-05): add a statement-level guard.
    EXECUTE format('DROP TRIGGER IF EXISTS hub_no_truncate ON %I', t);
    EXECUTE format('CREATE TRIGGER hub_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION hub_reject_mutation()', t);
  END LOOP;
END
$append$;

-- attendance: never deleted; frozen once the meeting's minutes are approved (ARCH-06).
CREATE OR REPLACE FUNCTION hub_attendance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'append_only_violation: attendance rows are never deleted' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM meeting m WHERE m.id = OLD.meeting_id AND m.status = 'minutes_approved') THEN
    RAISE EXCEPTION 'append_only_violation: attendance is frozen after minutes approval' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS hub_attendance_guard ON attendance;
CREATE TRIGGER hub_attendance_guard BEFORE UPDATE OR DELETE ON attendance FOR EACH ROW EXECUTE FUNCTION hub_attendance_guard();

-- document_version: storage identity is immutable; only scan/extraction metadata may change (ARCH-06).
CREATE OR REPLACE FUNCTION hub_document_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'retention_violation: document versions are never deleted' USING ERRCODE = 'P0001'; END IF;
  IF (NEW.document_id, NEW.version_no, NEW.storage_key, NEW.filename, NEW.size_bytes, NEW.sha256, NEW.uploaded_by, NEW.created_at, NEW.project_id)
     IS DISTINCT FROM (OLD.document_id, OLD.version_no, OLD.storage_key, OLD.filename, OLD.size_bytes, OLD.sha256, OLD.uploaded_by, OLD.created_at, OLD.project_id) THEN
    RAISE EXCEPTION 'append_only_violation: document version identity (storage key, hash, size, filename) is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS hub_document_version_guard ON document_version;
CREATE TRIGGER hub_document_version_guard BEFORE UPDATE OR DELETE ON document_version FOR EACH ROW EXECUTE FUNCTION hub_document_version_guard();


-- 5. Audit hash chain (tamper-EVIDENT) ---------------------------------------------------------------------
-- Serialized per organization with a transaction-scoped advisory lock; chain_pos gives the verification order.
CREATE OR REPLACE FUNCTION hub_audit_chain() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  prev_hash text;
  prev_pos bigint;
BEGIN
  -- Trusted fields are set/validated here, not taken from the caller (ARCH-05).
  NEW.created_at := now();
  IF NEW.actor_kind = 'user' AND NEW.actor_user_id IS DISTINCT FROM app_user_id() THEN
    RAISE EXCEPTION 'audit_actor_mismatch: audit actor must be the session user' USING ERRCODE = 'P0001';
  END IF;
  -- Service/system rows may not attribute the action to a human other than the session user (ARCH-05c).
  IF NEW.actor_kind <> 'user' AND NEW.actor_user_id IS NOT NULL AND NEW.actor_user_id IS DISTINCT FROM app_user_id() THEN
    RAISE EXCEPTION 'audit_actor_mismatch: a service/system audit row cannot name another user as actor' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.org_id IS DISTINCT FROM app_org_id() AND app_org_id() IS NOT NULL THEN
    RAISE EXCEPTION 'audit_org_mismatch: audit organization must be the session organization' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub_audit:' || NEW.org_id::text, 0));
  SELECT a.hash, a.chain_pos INTO prev_hash, prev_pos
    FROM audit_event a WHERE a.org_id = NEW.org_id AND a.chain_pos IS NOT NULL
    ORDER BY a.chain_pos DESC LIMIT 1;
  NEW.chain_pos := coalesce(prev_pos, 0) + 1;
  NEW.prev_hash := coalesce(prev_hash, repeat('0', 64));
  NEW.hash := encode(digest(concat_ws('|',
      NEW.prev_hash, NEW.chain_pos::text, NEW.id::text, NEW.org_id::text, coalesce(NEW.project_id::text, ''),
      coalesce(NEW.actor_user_id::text, ''), NEW.actor_kind::text, NEW.action, coalesce(NEW.entity_type, ''),
      coalesce(NEW.entity_id::text, ''), NEW.outcome, coalesce(NEW.reason, ''), coalesce(NEW.before::text, ''),
      coalesce(NEW.after::text, ''), coalesce(NEW.correlation_id, ''),
      to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')), 'sha256'), 'hex');
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS hub_audit_chain ON audit_event;
CREATE TRIGGER hub_audit_chain BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION hub_audit_chain();

-- Verification helper: returns the first broken link, or a checkpoint mismatch (tail truncation) — own org only.
DROP FUNCTION IF EXISTS hub_audit_verify(uuid);
CREATE OR REPLACE FUNCTION hub_audit_verify(p_org uuid)
RETURNS TABLE (broken_at bigint, expected text, actual text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  r record;
  expected_prev text := repeat('0', 64);
  computed text;
  cp record;
BEGIN
  -- The runtime role may verify only its session organization; operators (owner role) may verify any org.
  IF p_org IS DISTINCT FROM app_org_id() AND (app_org_id() IS NOT NULL OR session_user = 'hub_app') THEN
    RAISE EXCEPTION 'audit_verify_forbidden: can only verify the session organization' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM audit_event WHERE org_id = p_org AND chain_pos IS NOT NULL ORDER BY chain_pos LOOP
    computed := encode(digest(concat_ws('|',
      r.prev_hash, r.chain_pos::text, r.id::text, r.org_id::text, coalesce(r.project_id::text, ''),
      coalesce(r.actor_user_id::text, ''), r.actor_kind::text, r.action, coalesce(r.entity_type, ''),
      coalesce(r.entity_id::text, ''), r.outcome, coalesce(r.reason, ''), coalesce(r.before::text, ''),
      coalesce(r.after::text, ''), coalesce(r.correlation_id, ''),
      to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')), 'sha256'), 'hex');
    IF r.prev_hash IS DISTINCT FROM expected_prev OR r.hash IS DISTINCT FROM computed THEN
      broken_at := r.chain_pos; expected := computed; actual := r.hash;
      RETURN NEXT; RETURN;
    END IF;
    expected_prev := r.hash;
  END LOOP;
  -- Every checkpoint must still match the chain (detects deletion/rewrite of rows up to the last checkpoint).
  FOR cp IN SELECT * FROM audit_checkpoint WHERE org_id = p_org ORDER BY chain_pos LOOP
    IF NOT EXISTS (SELECT 1 FROM audit_event a WHERE a.org_id = p_org AND a.chain_pos = cp.chain_pos AND a.hash = cp.hash) THEN
      broken_at := cp.chain_pos; expected := cp.hash; actual := 'missing or altered (checkpoint mismatch)';
      RETURN NEXT; RETURN;
    END IF;
  END LOOP;
  RETURN;
END
$$;

-- Records the current chain head as a checkpoint. Scheduled by the worker (job `platform.audit.checkpoint`, every 15 min);
-- in production also export checkpoints to external WORM storage/SIEM (ADR-0014).
CREATE OR REPLACE FUNCTION hub_audit_checkpoint(p_org uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE head record; n bigint;
BEGIN
  IF p_org IS DISTINCT FROM app_org_id() AND (app_org_id() IS NOT NULL OR session_user = 'hub_app') THEN
    RAISE EXCEPTION 'audit_checkpoint_forbidden: can only checkpoint the session organization' USING ERRCODE = 'P0001';
  END IF;
  SELECT chain_pos, hash INTO head FROM audit_event WHERE org_id = p_org AND chain_pos IS NOT NULL ORDER BY chain_pos DESC LIMIT 1;
  IF head IS NULL THEN RETURN 0; END IF;
  SELECT count(*) INTO n FROM audit_event WHERE org_id = p_org;
  INSERT INTO audit_checkpoint (id, org_id, chain_pos, hash, row_count) VALUES (gen_random_uuid(), p_org, head.chain_pos, head.hash, n);
  RETURN head.chain_pos;
END
$$;

-- 6. Retention / legal hold guard (AT-27) --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hub_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'retention_violation: documents are soft-deleted only' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    IF OLD.legal_hold THEN
      RAISE EXCEPTION 'legal_hold_violation: document % is under legal hold', OLD.id USING ERRCODE = 'P0001';
    END IF;
    IF OLD.retention_until IS NOT NULL AND OLD.retention_until > current_date THEN
      RAISE EXCEPTION 'retention_violation: document % is retained until %', OLD.id, OLD.retention_until USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS hub_document_guard ON document;
CREATE TRIGGER hub_document_guard BEFORE UPDATE OR DELETE ON document FOR EACH ROW EXECUTE FUNCTION hub_document_guard();

-- 7. Narrow SECURITY DEFINER auth lookups --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hub_auth_org_by_slug(p_slug text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT id FROM organization WHERE slug = p_slug
$$;

CREATE OR REPLACE FUNCTION hub_auth_session(p_token_hash text)
RETURNS TABLE (
  session_id uuid, user_id uuid, org_id uuid, csrf_hash text, auth_method text,
  idle_expires_at timestamptz, absolute_expires_at timestamptz, revoked_at timestamptz,
  user_active boolean, user_clearance text, user_locale text, user_display_name text, user_email text,
  user_is_demo boolean
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  -- user_active is false for service / non-person accounts: they never hold an interactive session (I-R5).
  SELECT s.id, s.user_id, s.org_id, s.csrf_hash, s.auth_method, s.idle_expires_at, s.absolute_expires_at,
         s.revoked_at, (u.is_active AND NOT u.is_service_account), u.clearance::text, u.locale, u.display_name, u.email, u.is_demo
  FROM session s JOIN app_user u ON u.id = s.user_id
  WHERE s.token_hash = p_token_hash
$$;

REVOKE ALL ON FUNCTION hub_auth_org_by_slug(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hub_auth_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hub_audit_verify(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION hub_audit_checkpoint(uuid) FROM PUBLIC;
DO $fgrants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION hub_auth_org_by_slug(text) TO hub_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION hub_auth_session(text) TO hub_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION hub_audit_verify(uuid) TO hub_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION hub_audit_checkpoint(uuid) TO hub_app';
  END IF;
END
$fgrants$;

-- 8. Principal scope resolution (SECURITY DEFINER, read-only) --------------------------------------------------
-- Returns the caller's effective grants so the API can compute app.project_ids. Computed fresh on every request
-- and every job execution (no caching) so revocations take effect immediately (AT-19).
DROP FUNCTION IF EXISTS hub_auth_user_scope(uuid);
CREATE OR REPLACE FUNCTION hub_auth_user_scope(p_user uuid)
RETURNS TABLE (kind text, project_id uuid, role text, workstream_id uuid, room_id uuid, is_clean_team boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  -- project / workstream memberships
  SELECT 'membership', pm.project_id, pm.role::text, pm.workstream_id, NULL::uuid, false
  FROM project_membership pm JOIN app_user u ON u.id = pm.user_id AND u.is_active AND u.org_id = pm.org_id
  WHERE pm.user_id = p_user AND pm.revoked_at IS NULL AND pm.valid_from <= now()
    AND (pm.valid_to IS NULL OR pm.valid_to > now())
  UNION ALL
  -- organization-level roles (project_id NULL)
  SELECT 'org_role', NULL::uuid, ora.role::text, NULL::uuid, NULL::uuid, false
  FROM org_role_assignment ora JOIN app_user u ON u.id = ora.user_id AND u.is_active AND u.org_id = ora.org_id
  WHERE ora.user_id = p_user AND ora.scope_type = 'organization' AND ora.revoked_at IS NULL
    AND ora.valid_from <= now() AND (ora.valid_to IS NULL OR ora.valid_to > now())
  UNION ALL
  -- organization-wide auditor / portfolio_admin expand to every project of the organization (read scope; the
  -- permission matrix limits them to read-only / portfolio functions). platform_admin is deliberately NOT expanded.
  SELECT 'org_expansion', p.id, ora.role::text, NULL::uuid, NULL::uuid, false
  FROM org_role_assignment ora
  JOIN app_user u ON u.id = ora.user_id AND u.is_active AND u.org_id = ora.org_id
  JOIN project p ON p.org_id = ora.org_id
  WHERE ora.user_id = p_user AND ora.scope_type = 'organization' AND ora.role IN ('auditor', 'portfolio_admin')
    AND ora.revoked_at IS NULL AND ora.valid_from <= now() AND (ora.valid_to IS NULL OR ora.valid_to > now())
  UNION ALL
  -- portfolio-scoped roles expand to the projects of that portfolio
  SELECT 'portfolio_role', p.id, ora.role::text, NULL::uuid, NULL::uuid, false
  FROM org_role_assignment ora
  JOIN app_user u ON u.id = ora.user_id AND u.is_active AND u.org_id = ora.org_id
  JOIN program pr ON pr.portfolio_id = ora.scope_id AND pr.org_id = ora.org_id
  JOIN project p ON p.program_id = pr.id AND p.org_id = ora.org_id
  WHERE ora.user_id = p_user AND ora.scope_type = 'portfolio' AND ora.revoked_at IS NULL
    AND ora.valid_from <= now() AND (ora.valid_to IS NULL OR ora.valid_to > now())
  UNION ALL
  -- partner / clean-team room grants
  SELECT 'room_grant', rg.project_id, rg.role::text, NULL::uuid, rg.room_id, r.is_clean_team
  FROM room_grant rg JOIN partner_room r ON r.id = rg.room_id
  JOIN app_user u ON u.id = rg.user_id AND u.is_active AND u.org_id = rg.org_id
  WHERE rg.user_id = p_user AND rg.revoked_at IS NULL AND (rg.expires_at IS NULL OR rg.expires_at > now())
$$;
REVOKE ALL ON FUNCTION hub_auth_user_scope(uuid) FROM PUBLIC;
DO $sgrant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION hub_auth_user_scope(uuid) TO hub_app';
  END IF;
END
$sgrant$;

-- 9. Identity lookups before an org/user context exists (login mapping; seed/bootstrap) -------------------------
CREATE OR REPLACE FUNCTION hub_auth_user_by_email(p_org uuid, p_email text)
RETURNS TABLE (id uuid, org_id uuid, display_name text, email text, clearance text, is_active boolean, is_demo boolean, is_service_account boolean, locale text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT u.id, u.org_id, u.display_name, u.email, u.clearance::text, u.is_active, u.is_demo, u.is_service_account, u.locale
  FROM app_user u WHERE u.org_id = p_org AND lower(u.email) = lower(p_email)
$$;
CREATE OR REPLACE FUNCTION hub_auth_user_by_subject(p_issuer text, p_subject text)
RETURNS TABLE (id uuid, org_id uuid, display_name text, email text, clearance text, is_active boolean, is_demo boolean, is_service_account boolean, locale text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT u.id, u.org_id, u.display_name, u.email, u.clearance::text, u.is_active, u.is_demo, u.is_service_account, u.locale
  FROM app_user u WHERE u.oidc_issuer = p_issuer AND u.oidc_subject = p_subject
$$;
REVOKE ALL ON FUNCTION hub_auth_user_by_email(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hub_auth_user_by_subject(text, text) FROM PUBLIC;
DO $ugrant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION hub_auth_user_by_email(uuid, text) TO hub_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION hub_auth_user_by_subject(text, text) TO hub_app';
  END IF;
END
$ugrant$;


-- 10. Same-project guard for polymorphic references (ARCH-01) ---------------------------------------------------
-- Allowlisted target types → tables. Runs as the invoker (RLS applies): a target outside the caller's scope is
-- indistinguishable from a missing one and is rejected.
CREATE OR REPLACE FUNCTION hub_target_table(p_type text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_type
    WHEN 'project' THEN 'project' WHEN 'workstream' THEN 'workstream' WHEN 'task' THEN 'task' WHEN 'milestone' THEN 'milestone'
    WHEN 'deliverable' THEN 'deliverable' WHEN 'risk' THEN 'risk' WHEN 'issue' THEN 'issue' WHEN 'assumption' THEN 'assumption'
    WHEN 'raid_dependency' THEN 'raid_dependency' WHEN 'change_request' THEN 'change_request' WHEN 'baseline_version' THEN 'baseline_version'
    WHEN 'status_update' THEN 'status_update' WHEN 'committee' THEN 'committee' WHEN 'meeting' THEN 'meeting' WHEN 'decision' THEN 'decision'
    WHEN 'action_item' THEN 'action_item' WHEN 'escalation' THEN 'escalation' WHEN 'gate_definition' THEN 'gate_definition'
    WHEN 'gate_criterion' THEN 'gate_criterion' WHEN 'gate_assessment' THEN 'gate_assessment' WHEN 'perimeter_item' THEN 'perimeter_item'
    WHEN 'transfer' THEN 'perimeter_item' WHEN 'agreement' THEN 'agreement' WHEN 'consent' THEN 'consent'
    WHEN 'regulatory_requirement' THEN 'regulatory_requirement' WHEN 'tsa_service' THEN 'tsa_service' WHEN 'readiness_check' THEN 'readiness_check'
    WHEN 'cutover_plan' THEN 'cutover_plan' WHEN 'financial_snapshot' THEN 'financial_snapshot' WHEN 'budget_line' THEN 'budget_line'
    WHEN 'financial_model_version' THEN 'financial_model_version' WHEN 'benefit' THEN 'benefit' WHEN 'kpi' THEN 'kpi'
    WHEN 'intercompany_reconciliation' THEN 'intercompany_reconciliation' WHEN 'partner' THEN 'partner' WHEN 'deal_scenario' THEN 'deal_scenario'
    WHEN 'negotiation_issue' THEN 'negotiation_issue' WHEN 'diligence_request' THEN 'diligence_request' WHEN 'diligence_finding' THEN 'diligence_finding'
    WHEN 'closing' THEN 'closing' WHEN 'closing_condition' THEN 'closing_condition' WHEN 'closing_deliverable' THEN 'closing_deliverable'
    WHEN 'post_close_obligation' THEN 'post_close_obligation' WHEN 'document' THEN 'document' WHEN 'site' THEN 'site'
    WHEN 'operating_model_definition' THEN 'operating_model_definition' WHEN 'ai_proposal' THEN 'ai_proposal'
    ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION hub_assert_same_project() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  type_col text := TG_ARGV[0];
  id_col text := TG_ARGV[1];
  t_type text;
  t_id uuid;
  tbl text;
  found boolean;
BEGIN
  EXECUTE format('SELECT ($1).%I::text, ($1).%I::uuid', type_col, id_col) INTO t_type, t_id USING NEW;
  IF t_id IS NULL THEN RETURN NEW; END IF;
  IF t_type = 'legal_entity' THEN
    SELECT EXISTS (SELECT 1 FROM project_entity pe WHERE pe.legal_entity_id = t_id AND pe.project_id = NEW.project_id) INTO found;
  ELSIF t_type = 'request' THEN
    RETURN NEW; -- synthetic audit-style target (no row)
  ELSE
    tbl := hub_target_table(t_type);
    IF tbl IS NULL THEN
      RAISE EXCEPTION 'invalid_target_type: unsupported target type %', t_type USING ERRCODE = 'P0001';
    END IF;
    IF tbl = 'project' THEN
      found := (t_id = NEW.project_id);
    ELSE
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND project_id = $2)', tbl) INTO found USING t_id, NEW.project_id;
    END IF;
  END IF;
  IF NOT found THEN
    RAISE EXCEPTION 'cross_project_reference: % % is not a record of this project', t_type, t_id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

DO $poly$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('evidence_link', 'target_type', 'target_id', 'target'),
      ('waiver', 'target_type', 'target_id', 'target'),
      ('approval_request', 'subject_type', 'subject_id', 'subject'),
      ('raci_assignment', 'entity_type', 'entity_id', 'entity'),
      ('rag_override', 'entity_type', 'entity_id', 'entity'),
      ('change_request', 'subject_type', 'subject_id', 'subject'),
      ('source_claim', 'target_type', 'target_id', 'target'),
      ('escalation', 'source_type', 'source_id', 'source'),
      ('import_row', 'target_type', 'target_id', 'target'),
      ('ai_proposal', 'target_type', 'target_id', 'target'),
      ('dependency', 'predecessor_type', 'predecessor_id', 'predecessor'),
      ('dependency', 'successor_type', 'successor_id', 'successor')
    ) AS v(tbl, type_col, id_col, suffix)
  LOOP
    IF to_regclass(r.tbl) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'hub_same_project_' || r.suffix, r.tbl);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION hub_assert_same_project(%L, %L)',
      'hub_same_project_' || r.suffix, r.tbl, r.type_col, r.id_col);
  END LOOP;
END
$poly$;

-- 11. document_chunk ACL attributes are DERIVED from the parent document (ARCH-01 / ADR-0008) ----------------------
CREATE OR REPLACE FUNCTION hub_chunk_acl_sync() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d record;
BEGIN
  SELECT room_id, classification, project_id INTO d FROM document WHERE id = NEW.document_id;
  IF d IS NULL OR d.project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'cross_project_reference: chunk document not in project' USING ERRCODE = 'P0001';
  END IF;
  NEW.room_id := d.room_id;
  NEW.classification := d.classification;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS hub_chunk_acl_sync ON document_chunk;
CREATE TRIGGER hub_chunk_acl_sync BEFORE INSERT OR UPDATE ON document_chunk FOR EACH ROW EXECUTE FUNCTION hub_chunk_acl_sync();

-- document_version / evidence_link: room derived from the (linked) document, so room-only principals (clean team /
-- partner) can work with their room's versions and evidence under RLS and see nothing else.
CREATE OR REPLACE FUNCTION hub_document_child_room_sync() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  j jsonb := to_jsonb(NEW);
  doc_id uuid := nullif(j ->> 'document_id', '')::uuid;
  ver_id uuid := nullif(j ->> 'document_version_id', '')::uuid;
  d record;
BEGIN
  IF doc_id IS NULL AND ver_id IS NOT NULL THEN
    SELECT v.document_id INTO doc_id FROM document_version v WHERE v.id = ver_id AND v.project_id = NEW.project_id;
    IF doc_id IS NULL THEN
      RAISE EXCEPTION 'cross_project_reference: document version is not a record of this project' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF doc_id IS NULL THEN
    NEW.room_id := NULL;
    RETURN NEW;
  END IF;
  SELECT room_id, project_id INTO d FROM document WHERE id = doc_id;
  IF d IS NULL OR d.project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'cross_project_reference: document is not a record of this project' USING ERRCODE = 'P0001';
  END IF;
  NEW.room_id := d.room_id;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS hub_document_child_room_sync ON document_version;
CREATE TRIGGER hub_document_child_room_sync BEFORE INSERT OR UPDATE ON document_version FOR EACH ROW EXECUTE FUNCTION hub_document_child_room_sync();
DROP TRIGGER IF EXISTS hub_document_child_room_sync ON evidence_link;
CREATE TRIGGER hub_document_child_room_sync BEFORE INSERT OR UPDATE ON evidence_link FOR EACH ROW EXECUTE FUNCTION hub_document_child_room_sync();

CREATE OR REPLACE FUNCTION hub_document_acl_cascade() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.room_id IS DISTINCT FROM OLD.room_id OR NEW.classification IS DISTINCT FROM OLD.classification THEN
    UPDATE document_chunk SET room_id = NEW.room_id, classification = NEW.classification WHERE document_id = NEW.id;
  END IF;
  IF NEW.room_id IS DISTINCT FROM OLD.room_id THEN
    UPDATE document_version SET room_id = NEW.room_id WHERE document_id = NEW.id;
    UPDATE evidence_link SET room_id = NEW.room_id WHERE document_id = NEW.id;
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS hub_document_acl_cascade ON document;
CREATE TRIGGER hub_document_acl_cascade AFTER UPDATE ON document FOR EACH ROW EXECUTE FUNCTION hub_document_acl_cascade();

-- 12. Identity lookup by id for worker re-authorization (AT-19) -----------------------------------------------------
CREATE OR REPLACE FUNCTION hub_auth_user_by_id(p_user uuid)
RETURNS TABLE (id uuid, org_id uuid, display_name text, email text, clearance text, is_active boolean, is_demo boolean, is_service_account boolean, locale text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT u.id, u.org_id, u.display_name, u.email, u.clearance::text, u.is_active, u.is_demo, u.is_service_account, u.locale
  FROM app_user u WHERE u.id = p_user
$$;
REVOKE ALL ON FUNCTION hub_auth_user_by_id(uuid) FROM PUBLIC;
DO $idgrant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION hub_auth_user_by_id(uuid) TO hub_app';
  END IF;
END
$idgrant$;

-- 13. Scope immutability (ARCH-23) ------------------------------------------------------------------------------
-- project_id / org_id never change after insert. Moving a record between projects would silently turn existing
-- references (evidence links, dependencies, polymorphic targets) into cross-project links; a move must be an
-- explicit command that re-creates the record in the target project.
CREATE OR REPLACE FUNCTION hub_scope_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) -> 'project_id') IS DISTINCT FROM (to_jsonb(OLD) -> 'project_id')
     OR (to_jsonb(NEW) -> 'org_id') IS DISTINCT FROM (to_jsonb(OLD) -> 'org_id') THEN
    RAISE EXCEPTION 'immutable_scope: project_id/org_id cannot change on %; re-create the record in the target project', TG_TABLE_NAME
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

DO $scope$
DECLARE r record; cols text;
BEGIN
  FOR r IN
    SELECT t.table_name,
           bool_or(c.column_name = 'project_id') AS has_project,
           bool_or(c.column_name = 'org_id') AS has_org
    FROM information_schema.tables t
    JOIN information_schema.columns c ON c.table_schema = t.table_schema AND c.table_name = t.table_name
    WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.column_name IN ('project_id', 'org_id')
    GROUP BY t.table_name
  LOOP
    cols := concat_ws(', ', CASE WHEN r.has_project THEN 'project_id' END, CASE WHEN r.has_org THEN 'org_id' END);
    EXECUTE format('DROP TRIGGER IF EXISTS hub_scope_immutable ON %I', r.table_name);
    EXECUTE format('CREATE TRIGGER hub_scope_immutable BEFORE UPDATE OF %s ON %I FOR EACH ROW EXECUTE FUNCTION hub_scope_immutable()', cols, r.table_name);
  END LOOP;
END
$scope$;

-- 14. Org-scoped user references and (org, project) binding (ARCH-21, ARCH-15b) ---------------------------------
-- Convention (module guide): a uuid column named *_user_id or *_by is a USER reference. Every such column on a table
-- with org_id gets a composite FK (org_id, col) → app_user(org_id, id), so a record can only name users of its own
-- organization. Every table with org_id + project_id gets (org_id, project_id) → project(org_id, id).
-- Generated here so columns added later by modules are covered automatically.
CREATE UNIQUE INDEX IF NOT EXISTS app_user_org_id_uq ON app_user (org_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS project_org_id_uq ON project (org_id, id);

DO $userfk$
DECLARE r record; cname text;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.data_type = 'uuid'
      AND (c.column_name LIKE '%user\_id' OR c.column_name LIKE '%\_by')
      AND c.table_name <> 'app_user'
      AND EXISTS (SELECT 1 FROM information_schema.columns o WHERE o.table_schema = 'public' AND o.table_name = c.table_name AND o.column_name = 'org_id')
      -- skip only columns that already carry a MULTI-column FK including org_id (a plain FK to app_user(id) does not
      -- bind the organization — SEC-P1-06)
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint k
        JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
        JOIN pg_attribute o ON o.attrelid = k.conrelid AND o.attnum = ANY (k.conkey) AND o.attname = 'org_id'
        WHERE k.contype = 'f' AND k.conrelid = format('public.%I', c.table_name)::regclass AND a.attname = c.column_name)
  LOOP
    cname := left('hub_ufk_' || r.table_name || '_' || r.column_name, 63);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (org_id, %I) REFERENCES app_user (org_id, id)', r.table_name, cname, r.column_name);
  END LOOP;

  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'project_id'
      AND EXISTS (SELECT 1 FROM information_schema.columns o WHERE o.table_schema = 'public' AND o.table_name = c.table_name AND o.column_name = 'org_id')
  LOOP
    cname := left('hub_opfk_' || r.table_name, 63);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = cname AND conrelid = format('public.%I', r.table_name)::regclass) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (org_id, project_id) REFERENCES project (org_id, id)', r.table_name, cname);
    END IF;
  END LOOP;
END
$userfk$;

-- 15. document.current_version_id must be a version of THIS document (ARCH-21) ------------------------------------
-- Deferred constraint trigger: checked at COMMIT for INSERT and UPDATE, so a document and its first version can be
-- written in either order inside one transaction. SECURITY DEFINER only to see the version row regardless of the
-- caller's room scope; it compares ids and reveals nothing.
CREATE OR REPLACE FUNCTION hub_document_current_version_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.current_version_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM document_version v
       WHERE v.id = NEW.current_version_id AND v.document_id = NEW.id AND v.project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'cross_project_reference: current version must be a version of this document' USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION hub_document_current_version_check() FROM PUBLIC;
DROP TRIGGER IF EXISTS hub_document_current_version ON document;
CREATE CONSTRAINT TRIGGER hub_document_current_version AFTER INSERT OR UPDATE OF current_version_id ON document
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hub_document_current_version_check();

-- 16. Id-list references (ARCH-21) -----------------------------------------------------------------------------------
-- Prefer child tables with composite FKs. Where a jsonb/uuid[] id list exists, every element must be a record of the
-- same project that the caller can see (runs as invoker: RLS applies). Register new lists in the VALUES below.
CREATE OR REPLACE FUNCTION hub_assert_same_project_ids() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  col text := TG_ARGV[0];
  tbl text := TG_ARGV[1];
  ids jsonb;
  bad text;
BEGIN
  EXECUTE format('SELECT to_jsonb(($1).%I)', col) INTO ids USING NEW;
  IF ids IS NULL OR jsonb_typeof(ids) = 'null' THEN RETURN NEW; END IF;
  IF jsonb_typeof(ids) <> 'array' THEN
    RAISE EXCEPTION 'invalid_reference_list: % must be an array of ids', col USING ERRCODE = 'P0001';
  END IF;
  EXECUTE format(
    'SELECT e FROM jsonb_array_elements_text($1) e WHERE NOT EXISTS (SELECT 1 FROM %I t WHERE t.id = e::uuid AND t.project_id = $2) LIMIT 1', tbl)
    INTO bad USING ids, NEW.project_id;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'cross_project_reference: % % is not a record of this project', tbl, bad USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

DO $idlists$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('diligence_request', 'evidence_document_ids', 'document')
    ) AS v(tbl, col, target)
  LOOP
    IF to_regclass(r.tbl) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'hub_same_project_' || r.col, r.tbl);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON %I FOR EACH ROW EXECUTE FUNCTION hub_assert_same_project_ids(%L, %L)',
      'hub_same_project_' || r.col, r.col, r.tbl, r.col, r.target);
  END LOOP;
END
$idlists$;

-- 17. Votes are cast by the member of the deciding committee (ARCH-21, AT-05) ---------------------------------------
-- vote.user_id must be the user of vote.membership_id, and that membership must belong to the decision's committee.
CREATE OR REPLACE FUNCTION hub_vote_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM committee_membership cm
       JOIN decision d ON d.id = NEW.decision_id AND d.project_id = NEW.project_id
       WHERE cm.id = NEW.membership_id AND cm.project_id = NEW.project_id
         AND cm.user_id = NEW.user_id AND cm.committee_id = d.committee_id) THEN
    RAISE EXCEPTION 'vote_membership_mismatch: a vote must be cast by a member of the deciding committee' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS hub_vote_binding ON vote;
CREATE TRIGGER hub_vote_binding BEFORE INSERT ON vote FOR EACH ROW EXECUTE FUNCTION hub_vote_binding();

-- 18. Notification sources belong to the notification's project (ARCH-21) --------------------------------------------
DROP TRIGGER IF EXISTS hub_same_project_source ON notification;
CREATE TRIGGER hub_same_project_source BEFORE INSERT OR UPDATE OF source_type, source_id ON notification
  FOR EACH ROW EXECUTE FUNCTION hub_assert_same_project('source_type', 'source_id');

-- 19. Frozen snapshots (planning) ------------------------------------------------------------------------------------
-- A baseline snapshot and its hash never change after insert; a status update's frozen snapshot never changes once the
-- update has been accepted (spec §9: history is preserved; changes go through a new baseline / status update).
CREATE OR REPLACE FUNCTION hub_frozen_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME IN ('baseline_version', 'perimeter_version') THEN
    IF NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash THEN
      RAISE EXCEPTION 'append_only_violation: a % snapshot is immutable — propose a new version', TG_TABLE_NAME USING ERRCODE = 'P0001';
    END IF;
  ELSIF TG_TABLE_NAME = 'status_update' THEN
    IF OLD.status::text = 'accepted' AND NEW.frozen_snapshot IS DISTINCT FROM OLD.frozen_snapshot THEN
      RAISE EXCEPTION 'append_only_violation: the frozen snapshot of an accepted status update is immutable' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS hub_frozen_snapshot_guard ON baseline_version;
CREATE TRIGGER hub_frozen_snapshot_guard BEFORE UPDATE OF snapshot, snapshot_hash ON baseline_version FOR EACH ROW EXECUTE FUNCTION hub_frozen_snapshot_guard();
DROP TRIGGER IF EXISTS hub_frozen_snapshot_guard ON perimeter_version;
CREATE TRIGGER hub_frozen_snapshot_guard BEFORE UPDATE OF snapshot, snapshot_hash ON perimeter_version FOR EACH ROW EXECUTE FUNCTION hub_frozen_snapshot_guard();
DROP TRIGGER IF EXISTS hub_frozen_snapshot_guard ON status_update;
CREATE TRIGGER hub_frozen_snapshot_guard BEFORE UPDATE OF frozen_snapshot ON status_update FOR EACH ROW EXECUTE FUNCTION hub_frozen_snapshot_guard();

-- 20. Account types (access-matrix §2.8, QA-P1-04) ---------------------------------------------------------------------
-- External (partner) accounts never hold project, workstream, committee or organization roles; in rooms they may hold
-- only `external_partner_limited`. Enforced here so no code path (or data fix) can mis-assign them.
CREATE OR REPLACE FUNCTION hub_account_type_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE acct text; uid uuid; role_text text;
BEGIN
  uid := nullif(to_jsonb(NEW) ->> 'user_id', '')::uuid;
  IF uid IS NULL THEN RETURN NEW; END IF;
  SELECT account_type INTO acct FROM app_user WHERE id = uid;
  IF acct IS DISTINCT FROM 'external' THEN RETURN NEW; END IF;
  role_text := to_jsonb(NEW) ->> 'role';
  IF TG_TABLE_NAME = 'room_grant' AND role_text = 'external_partner_limited' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'external_account_role: an external account cannot hold % on %', coalesce(role_text, 'a role'), TG_TABLE_NAME USING ERRCODE = 'P0001';
END
$$;
REVOKE ALL ON FUNCTION hub_account_type_guard() FROM PUBLIC;
DO $acct$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_membership', 'org_role_assignment', 'committee_membership', 'room_grant'] LOOP
    IF to_regclass(t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS hub_account_type_guard ON %I', t);
    EXECUTE format('CREATE TRIGGER hub_account_type_guard BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION hub_account_type_guard()', t);
  END LOOP;
END
$acct$;

-- An INTERNAL account holding roles cannot be switched to EXTERNAL (I-R1): the guard above fires on role and grant rows;
-- this one fires on the account itself, so the order "grant first, then flip the type" is refused too. Revoke / end the
-- internal grants first. (Future-dated grants count: they would become active on an external account.)
CREATE OR REPLACE FUNCTION hub_account_type_flip_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.account_type IS DISTINCT FROM 'external' OR OLD.account_type IS NOT DISTINCT FROM 'external' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM project_membership m WHERE m.user_id = NEW.id AND m.revoked_at IS NULL AND (m.valid_to IS NULL OR m.valid_to > now()))
     OR EXISTS (SELECT 1 FROM org_role_assignment a WHERE a.user_id = NEW.id AND a.revoked_at IS NULL AND (a.valid_to IS NULL OR a.valid_to > now()))
     OR EXISTS (SELECT 1 FROM committee_membership c WHERE c.user_id = NEW.id AND (c.valid_to IS NULL OR c.valid_to >= current_date))
     OR EXISTS (SELECT 1 FROM room_grant g WHERE g.user_id = NEW.id AND g.revoked_at IS NULL AND g.role <> 'external_partner_limited') THEN
    RAISE EXCEPTION 'external_account_role: the account still holds internal roles or grants — revoke them before making it external'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION hub_account_type_flip_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS hub_account_type_flip_guard ON app_user;
CREATE TRIGGER hub_account_type_flip_guard BEFORE UPDATE OF account_type ON app_user FOR EACH ROW EXECUTE FUNCTION hub_account_type_flip_guard();

-- 21. Shared legal entities have ONE owning project (SEC-P1R-03) --------------------------------------------------------
-- legal_entity is organization-level and may be linked to several projects (project_entity). Only the OWNING project (the
-- one that created it, legal_entity.owner_project_id) may change it; linked projects read it. The API refuses with 403
-- `newco.legal_entity.not_owner`; here: the owner reference is org-bound and immutable, rows are inserted only for an
-- in-scope project, and UPDATE is restricted (RESTRICTIVE policy, ANDed with the org policy) to full members of the owner.
DO $leowner$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_entity_owner_project_org_fk') THEN
    ALTER TABLE legal_entity ADD CONSTRAINT legal_entity_owner_project_org_fk FOREIGN KEY (org_id, owner_project_id) REFERENCES project (org_id, id);
  END IF;
END
$leowner$;
DROP POLICY IF EXISTS hub_legal_entity_owner_insert ON legal_entity;
CREATE POLICY hub_legal_entity_owner_insert ON legal_entity AS RESTRICTIVE FOR INSERT
  WITH CHECK (owner_project_id = ANY (app_project_ids()));
DROP POLICY IF EXISTS hub_legal_entity_owner_update ON legal_entity;
CREATE POLICY hub_legal_entity_owner_update ON legal_entity AS RESTRICTIVE FOR UPDATE
  USING (owner_project_id = ANY (app_full_project_ids()))
  WITH CHECK (owner_project_id = ANY (app_full_project_ids()));
CREATE OR REPLACE FUNCTION hub_legal_entity_owner_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_project_id IS DISTINCT FROM OLD.owner_project_id THEN
    RAISE EXCEPTION 'immutable_owner: the owning project of a legal entity cannot change' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS hub_legal_entity_owner_immutable ON legal_entity;
CREATE TRIGGER hub_legal_entity_owner_immutable BEFORE UPDATE OF owner_project_id ON legal_entity FOR EACH ROW EXECUTE FUNCTION hub_legal_entity_owner_immutable();

-- Projects linked to a legal entity other than its owner (ids only), for the owning project's change fan-out
-- (`legal_entity.changed` outbox events): under RLS the owner cannot see other projects' project_entity rows. Callable
-- only by full members of the OWNING project; returns nothing otherwise.
CREATE OR REPLACE FUNCTION hub_legal_entity_linked_projects(p_entity uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT DISTINCT pe.project_id
    FROM project_entity pe JOIN legal_entity le ON le.id = pe.legal_entity_id
   WHERE pe.legal_entity_id = p_entity AND le.org_id = app_org_id() AND pe.org_id = le.org_id
     AND le.owner_project_id = ANY (app_full_project_ids()) AND pe.project_id <> le.owner_project_id
$$;
REVOKE ALL ON FUNCTION hub_legal_entity_linked_projects(uuid) FROM PUBLIC;
DO $legrant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION hub_legal_entity_linked_projects(uuid) TO hub_app';
  END IF;
END
$legrant$;
