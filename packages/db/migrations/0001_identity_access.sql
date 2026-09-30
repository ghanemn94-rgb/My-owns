-- 0001 identity and access (T-DG1-BE). Contract: docs/architecture/data-dictionary.md; ADR-0003/0005/0006.
-- Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged.
-- SQL floor: PostgreSQL 16 (no uuidv7(), no virtual generated columns). IDs come from the application (UUIDv7).

DO $$
BEGIN
  IF current_user <> 'mth_owner' THEN
    RAISE EXCEPTION 'migrations must run as mth_owner (ADR-0003), not %', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mth_app') THEN
    RAISE EXCEPTION 'role mth_app must exist before migrations run (ADR-0003: deployment creates it)';
  END IF;
END
$$;

-- Only the owner creates objects in public; the app role can use them (the database is owned by mth_owner,
-- so mth_owner controls the public schema through pg_database_owner).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO mth_app;
GRANT SELECT ON schema_migration TO mth_app; -- read by GET /readyz

-- ---------------------------------------------------------------------------------------------------------
-- organization
CREATE TABLE organization (
  id               uuid PRIMARY KEY,
  code             text NOT NULL CONSTRAINT organization_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  name_en          text NOT NULL CHECK (char_length(name_en) BETWEEN 1 AND 200),
  name_ar          text NOT NULL CHECK (char_length(name_ar) BETWEEN 1 AND 200),
  default_timezone text NOT NULL DEFAULT 'Asia/Riyadh' CHECK (char_length(default_timezone) BETWEEN 1 AND 64),
  default_currency char(3) NOT NULL DEFAULT 'SAR' CHECK (default_currency ~ '^[A-Z]{3}$'),
  default_locale   text NOT NULL DEFAULT 'ar' CHECK (default_locale IN ('ar', 'en')),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  version          integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NULL,
  updated_by       uuid NULL,
  CONSTRAINT organization_code_key UNIQUE (code)
);

-- ---------------------------------------------------------------------------------------------------------
-- app_user (no password columns ever: OIDC, or dev login bound to urn:mth:dev-local)
CREATE TABLE app_user (
  id               uuid PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  display_name     text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 200),
  email            text NULL CHECK (email IS NULL OR char_length(email) <= 320),
  preferred_locale text NOT NULL DEFAULT 'ar' CHECK (preferred_locale IN ('ar', 'en')),
  timezone         text NULL CHECK (timezone IS NULL OR char_length(timezone) BETWEEN 1 AND 64),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_login_at    timestamptz NULL,
  version          integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_by       uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX app_user_org_email_key ON app_user (organization_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX app_user_org_name_idx ON app_user (organization_id, lower(display_name));

-- Read model owned by the identity module: the only user attribute other modules may show (audit actor names).
CREATE VIEW actor_display AS SELECT id AS user_id, display_name FROM app_user;

ALTER TABLE organization
  ADD CONSTRAINT organization_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT organization_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------------------------------------
-- business_unit (parent in the same organization via composite FK; no cycles: API check, depth <= 10)
CREATE TABLE business_unit (
  id                      uuid PRIMARY KEY,
  organization_id         uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  parent_business_unit_id uuid NULL,
  code                    text NOT NULL CONSTRAINT business_unit_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  name_en                 text NOT NULL CHECK (char_length(name_en) BETWEEN 1 AND 200),
  name_ar                 text NOT NULL CHECK (char_length(name_ar) BETWEEN 1 AND 200),
  status                  text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  version                 integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_by              uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT business_unit_org_code_key UNIQUE (organization_id, code),
  CONSTRAINT business_unit_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT business_unit_not_own_parent CHECK (parent_business_unit_id IS DISTINCT FROM id),
  CONSTRAINT business_unit_parent_same_org_fkey FOREIGN KEY (organization_id, parent_business_unit_id)
    REFERENCES business_unit (organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX business_unit_parent_idx ON business_unit (parent_business_unit_id);

-- Read model owned by the organization module: every (ancestor, descendant) pair, including (x, x) at depth 0.
-- Used by the policy function for downward inheritance (ADR-0006: "raw SQL for recursive BU queries").
CREATE VIEW business_unit_closure AS
WITH RECURSIVE closure (ancestor_id, descendant_id, organization_id, depth) AS (
  SELECT bu.id, bu.id, bu.organization_id, 0 FROM business_unit bu
  UNION ALL
  SELECT c.ancestor_id, child.id, child.organization_id, c.depth + 1
  FROM closure c
  JOIN business_unit child ON child.parent_business_unit_id = c.descendant_id
  WHERE c.depth < 10
)
SELECT ancestor_id, descendant_id, organization_id, depth FROM closure;

-- ---------------------------------------------------------------------------------------------------------
-- user_identity: (issuer, subject) identifies exactly one user (ADR-0005)
CREATE TABLE user_identity (
  id               uuid PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  issuer           text NOT NULL CHECK (char_length(issuer) BETWEEN 1 AND 512),
  subject          text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 255),
  email_at_binding text NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_login_at    timestamptz NULL,
  CONSTRAINT user_identity_issuer_subject_key UNIQUE (issuer, subject)
);
CREATE INDEX user_identity_user_idx ON user_identity (user_id);

-- ---------------------------------------------------------------------------------------------------------
-- session: server-side sessions; only SHA-256 hashes of the cookie value and CSRF token are stored
CREATE TABLE session (
  id                  uuid PRIMARY KEY,
  token_hash          bytea NOT NULL CHECK (octet_length(token_hash) = 32),
  user_id             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  auth_mode           text NOT NULL CHECK (auth_mode IN ('oidc', 'dev')),
  idp_issuer          text NULL,
  idp_session_id      text NULL,
  csrf_token_hash     bytea NOT NULL CHECK (octet_length(csrf_token_hash) = 32),
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  idle_expires_at     timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at          timestamptz NULL,
  user_agent          text NULL CHECK (user_agent IS NULL OR char_length(user_agent) <= 512),
  CONSTRAINT session_token_hash_key UNIQUE (token_hash)
);
CREATE INDEX session_active_user_idx ON session (user_id) WHERE revoked_at IS NULL;
CREATE INDEX session_absolute_expiry_idx ON session (absolute_expires_at);

-- ---------------------------------------------------------------------------------------------------------
-- oidc_login_state: single use (DELETE ... RETURNING in the callback), 10-minute expiry
CREATE TABLE oidc_login_state (
  state_hash    bytea PRIMARY KEY CHECK (octet_length(state_hash) = 32),
  code_verifier text NOT NULL,
  nonce         text NOT NULL,
  return_to     text NOT NULL DEFAULT '/'
                CONSTRAINT oidc_login_state_return_to_relative
                CHECK (left(return_to, 1) = '/' AND substr(return_to, 2, 1) NOT IN ('/', E'\\')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
CREATE INDEX oidc_login_state_expiry_idx ON oidc_login_state (expires_at);

-- ---------------------------------------------------------------------------------------------------------
-- role, permission, role_permission (seeded in 0005 from packages/shared/src/permissions.ts)
CREATE TABLE role (
  id                uuid PRIMARY KEY,
  code              text NOT NULL,
  name_en           text NOT NULL CHECK (char_length(name_en) BETWEEN 1 AND 200),
  name_ar           text NOT NULL CHECK (char_length(name_ar) BETWEEN 1 AND 200),
  kind              text NOT NULL CHECK (kind IN ('source', 'implementation', 'technical_admin')),
  inherits_downward boolean NOT NULL DEFAULT false,
  is_system         boolean NOT NULL DEFAULT true,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT role_code_key UNIQUE (code),
  CONSTRAINT role_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$')
);

CREATE TABLE permission (
  code           text PRIMARY KEY CHECK (code ~ '^[a-z_]+\.[a-z_]+$'),
  category       text NOT NULL CHECK (category IN ('read', 'write', 'configure', 'business_approval', 'finance_validation')),
  description_en text NOT NULL,
  description_ar text NOT NULL
);

CREATE TABLE role_permission (
  role_id         uuid NOT NULL REFERENCES role (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  permission_code text NOT NULL REFERENCES permission (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_code)
);

-- Separation of duties (ADR-0006, REQ-S10-003, REQ-S06-010): a technical_admin role can never hold a
-- business_approval or finance_validation permission. Enforced on every path that could create the link:
-- inserting/updating role_permission, re-classifying a role as technical_admin, re-classifying a permission.
CREATE FUNCTION role_permission_no_admin_approver() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_role_code text;
  v_perm_code text;
BEGIN
  IF TG_TABLE_NAME = 'role_permission' THEN
    SELECT r.code, p.code INTO v_role_code, v_perm_code
    FROM role r, permission p
    WHERE r.id = NEW.role_id AND p.code = NEW.permission_code
      AND r.kind = 'technical_admin' AND p.category IN ('business_approval', 'finance_validation');
  ELSIF TG_TABLE_NAME = 'role' THEN
    SELECT NEW.code, p.code INTO v_role_code, v_perm_code
    FROM role_permission rp JOIN permission p ON p.code = rp.permission_code
    WHERE rp.role_id = NEW.id AND NEW.kind = 'technical_admin'
      AND p.category IN ('business_approval', 'finance_validation')
    LIMIT 1;
  ELSE -- permission
    SELECT r.code, NEW.code INTO v_role_code, v_perm_code
    FROM role_permission rp JOIN role r ON r.id = rp.role_id
    WHERE rp.permission_code = NEW.code AND r.kind = 'technical_admin'
      AND NEW.category IN ('business_approval', 'finance_validation')
    LIMIT 1;
  END IF;
  IF v_role_code IS NOT NULL THEN
    RAISE EXCEPTION 'technical administrator role % cannot hold approval permission % (separation of duties)', v_role_code, v_perm_code
      USING ERRCODE = 'check_violation', CONSTRAINT = 'role_permission_no_admin_approver';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER role_permission_no_admin_approver
  BEFORE INSERT OR UPDATE ON role_permission
  FOR EACH ROW EXECUTE FUNCTION role_permission_no_admin_approver();
CREATE TRIGGER role_no_admin_approver
  BEFORE UPDATE OF kind ON role
  FOR EACH ROW EXECUTE FUNCTION role_permission_no_admin_approver();
CREATE TRIGGER permission_no_admin_approver
  BEFORE UPDATE OF category ON permission
  FOR EACH ROW EXECUTE FUNCTION role_permission_no_admin_approver();

-- ---------------------------------------------------------------------------------------------------------
-- scoped_assignment: the only source of access (never job titles or IdP attributes)
CREATE TABLE scoped_assignment (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  user_id         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  role_id         uuid NOT NULL REFERENCES role (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  scope_type      text NOT NULL CHECK (scope_type IN ('organization', 'business_unit', 'transformation', 'portfolio',
                                                      'workstream', 'initiative', 'performance_area', 'forum', 'record')),
  scope_id        uuid NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz NULL,
  reason          text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 1000),
  granted_by      uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  revoked_at      timestamptz NULL,
  revoked_by      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  revoke_reason   text NULL CHECK (revoke_reason IS NULL OR char_length(revoke_reason) BETWEEN 3 AND 1000),
  version         integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_by      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT scoped_assignment_effective_range CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT scoped_assignment_revocation_complete CHECK (
    (revoked_at IS NULL) = (revoked_by IS NULL) AND (revoked_at IS NULL) = (revoke_reason IS NULL)),
  CONSTRAINT scoped_assignment_org_scope_matches CHECK (scope_type <> 'organization' OR scope_id = organization_id)
);
CREATE INDEX scoped_assignment_active_user_idx ON scoped_assignment (user_id) WHERE revoked_at IS NULL;
CREATE INDEX scoped_assignment_active_scope_idx ON scoped_assignment (scope_type, scope_id) WHERE revoked_at IS NULL;
CREATE INDEX scoped_assignment_org_role_idx ON scoped_assignment (organization_id, role_id);
CREATE UNIQUE INDEX scoped_assignment_active_unique ON scoped_assignment (user_id, role_id, scope_type, scope_id)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------------------------------------
-- delegation (table in P1; logic in P2/P4: no cycles, never exceeds the delegator, not to a pending requester)
CREATE TABLE delegation (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  delegator_user_id uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  delegate_user_id  uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  scope_type        text NULL CHECK (scope_type IS NULL OR scope_type IN ('organization', 'business_unit', 'transformation',
                                     'portfolio', 'workstream', 'initiative', 'performance_area', 'forum', 'record')),
  scope_id          uuid NULL,
  record_types      text[] NULL,
  reason_code       text NOT NULL CHECK (reason_code IN ('absence', 'other')),
  reason_text       text NULL,
  effective_from    timestamptz NOT NULL,
  effective_to      timestamptz NOT NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT delegation_not_self CHECK (delegate_user_id <> delegator_user_id),
  CONSTRAINT delegation_scope_pair CHECK ((scope_type IS NULL) = (scope_id IS NULL)),
  CONSTRAINT delegation_effective_range CHECK (effective_to > effective_from)
);
CREATE INDEX delegation_delegate_idx ON delegation (delegate_user_id, status);
CREATE INDEX delegation_delegator_idx ON delegation (delegator_user_id, status);

-- ---------------------------------------------------------------------------------------------------------
-- Grants (data dictionary: SELECT, INSERT, UPDATE on business tables; DELETE only where stated)
GRANT SELECT, INSERT, UPDATE ON organization, business_unit, app_user, scoped_assignment, delegation TO mth_app;
GRANT SELECT ON business_unit_closure, actor_display TO mth_app;
-- Rebinding service only (ADR-0005); identities are otherwise append/update.
GRANT SELECT, INSERT, UPDATE, DELETE ON user_identity TO mth_app;
-- Sessions and login states are not business records; expired rows are purged by the worker.
GRANT SELECT, INSERT, UPDATE, DELETE ON session, oidc_login_state TO mth_app;
-- Roles and permissions are read-only for the application in P1 (configurable roles arrive in P5).
GRANT SELECT ON role, permission, role_permission TO mth_app;
