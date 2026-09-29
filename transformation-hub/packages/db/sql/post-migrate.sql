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
      EXECUTE format(
        'CREATE POLICY hub_project_isolation ON %I USING (org_id = app_org_id() AND (project_id IS NULL OR project_id = ANY (app_project_ids()))) WITH CHECK (org_id = app_org_id() AND (project_id IS NULL OR project_id = ANY (app_project_ids())))',
        r.table_name);
    ELSE
      EXECUTE format(
        'CREATE POLICY hub_project_isolation ON %I USING (project_id = ANY (app_project_ids())) WITH CHECK (project_id = ANY (app_project_ids()))',
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
    EXECUTE format(
      'CREATE POLICY hub_org_isolation ON %I USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id())',
      r.table_name);
  END LOOP;
END
$rls$;

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

-- project_membership: in-scope projects, plus the caller's own memberships (needed to compute scope).
ALTER TABLE project_membership ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hub_project_isolation ON project_membership;
DROP POLICY IF EXISTS hub_membership_access ON project_membership;
CREATE POLICY hub_membership_access ON project_membership
  USING (org_id = app_org_id() AND (project_id = ANY (app_project_ids()) OR user_id = app_user_id()))
  WITH CHECK (org_id = app_org_id() AND project_id = ANY (app_project_ids()));

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
  USING (org_id = app_org_id() AND (user_id = app_user_id() OR project_id = ANY (app_project_ids())))
  WITH CHECK (org_id = app_org_id() AND (project_id IS NULL OR project_id = ANY (app_project_ids())));

-- 3. Grants ------------------------------------------------------------------------------------------------
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO hub_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hub_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hub_app';
    -- Append-only tables: no UPDATE/DELETE for the runtime role
    EXECUTE 'REVOKE UPDATE, DELETE ON audit_event, vote, record_version, approval_record, transfer_record, readiness_test_run, report_snapshot FROM hub_app';
    -- Documents are soft-deleted only
    EXECUTE 'REVOKE DELETE ON document, document_version FROM hub_app';
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
  FOREACH t IN ARRAY ARRAY['audit_event', 'vote', 'record_version', 'approval_record', 'transfer_record', 'readiness_test_run', 'report_snapshot']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS hub_append_only ON %I', t);
    EXECUTE format('CREATE TRIGGER hub_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION hub_reject_mutation()', t);
  END LOOP;
END
$append$;

-- 5. Audit hash chain (tamper-EVIDENT) ---------------------------------------------------------------------
-- Serialized per organization with a transaction-scoped advisory lock; chain_pos gives the verification order.
CREATE OR REPLACE FUNCTION hub_audit_chain() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  prev_hash text;
  prev_pos bigint;
BEGIN
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

-- Verification helper: returns the first broken link (NULL chain_pos when intact).
CREATE OR REPLACE FUNCTION hub_audit_verify(p_org uuid)
RETURNS TABLE (broken_at bigint, expected text, actual text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  expected_prev text := repeat('0', 64);
  computed text;
BEGIN
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
  RETURN;
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
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM organization WHERE slug = p_slug
$$;

CREATE OR REPLACE FUNCTION hub_auth_session(p_token_hash text)
RETURNS TABLE (
  session_id uuid, user_id uuid, org_id uuid, csrf_hash text, auth_method text,
  idle_expires_at timestamptz, absolute_expires_at timestamptz, revoked_at timestamptz,
  user_active boolean, user_clearance text, user_locale text, user_display_name text, user_email text,
  user_is_demo boolean
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.user_id, s.org_id, s.csrf_hash, s.auth_method, s.idle_expires_at, s.absolute_expires_at,
         s.revoked_at, u.is_active, u.clearance::text, u.locale, u.display_name, u.email, u.is_demo
  FROM session s JOIN app_user u ON u.id = s.user_id
  WHERE s.token_hash = p_token_hash
$$;

REVOKE ALL ON FUNCTION hub_auth_org_by_slug(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hub_auth_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hub_audit_verify(uuid) FROM PUBLIC;
DO $fgrants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION hub_auth_org_by_slug(text) TO hub_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION hub_auth_session(text) TO hub_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION hub_audit_verify(uuid) TO hub_app';
  END IF;
END
$fgrants$;
