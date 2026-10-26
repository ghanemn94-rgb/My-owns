-- 0098 P6 slice E: sensitive records, explicit sensitive-record grants, and the deep-link token of an inbox notification
-- (T-DG6-ARCH-01; ADR-0051 §2, §3, §6). Authored by solution-architect. Runs as mth_owner inside one transaction opened
-- by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- REQ-S10-002 (M0188 "Access is scoped by organization, business unit, transformation and sensitive record where
-- needed"): a record of type benefit, business_case or evidence (D-195 Q3) can be marked sensitive. A sensitive record
-- is readable only by the parties ADR-0051 §2 enumerates and by holders of an ACTIVE explicit grant.
--   record_sensitivity         one row per marked record (unique per record), versioned and audited; the flag is
--                              switched on and off by UPDATE, never by DELETE. Every insert and update writes one
--                              row of the append-only history record_sensitivity_change (trigger, SECURITY DEFINER).
--   sensitive_record_grant     one row per grant; active -> revoked is the only transition (revoked is terminal); at
--                              most one ACTIVE grant per record and grantee (unique index). Versioned and audited.
--   inbox_notification         three nullable columns (REQ-S12-024, ADR-0051 §3): the opaque deep-link token and the
--                              record the notification points to. Each is set at most once (NULL -> value) and never
--                              changed afterwards. Rows written before P6 keep NULL; the API issues a token lazily
--                              under advisory lock class 730301.
-- Advisory locks (ADR-0016 §6 registry): 730300 sensitiveRecordGrant (key "<record_type>:<record_id>"), taken by the
-- triggers record_sensitivity_guard and sensitive_record_grant_guard; 730301 deepLinkIssue (key "<notificationId>"),
-- taken by inbox_notification_deep_link_guard when a token is set by UPDATE.
-- Nothing here reads or writes DG0-DG7. A grant is an access decision, never a business approval.

-- The sensitive record types (D-195 Q3). Each listed table has (id uuid, transformation_id uuid).
CREATE FUNCTION p6_sensitive_record_ref_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  found_it boolean;
BEGIN
  IF NOT NEW.record_type = ANY (ARRAY['benefit', 'business_case', 'evidence']) THEN
    RAISE EXCEPTION '%: record_type % cannot be marked sensitive', TG_TABLE_NAME, NEW.record_type
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_record_type';
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND transformation_id = $2)', NEW.record_type)
    INTO found_it USING NEW.record_id, NEW.transformation_id;
  IF NOT found_it THEN
    RAISE EXCEPTION '%: % % does not exist in transformation %', TG_TABLE_NAME, NEW.record_type, NEW.record_id, NEW.transformation_id
      USING ERRCODE = 'foreign_key_violation', CONSTRAINT = TG_TABLE_NAME || '_record_ref';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION p6_sensitive_record_ref_guard() FROM PUBLIC;

CREATE TABLE record_sensitivity (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_type       text NOT NULL CONSTRAINT record_sensitivity_record_type CHECK (record_type IN ('benefit', 'business_case', 'evidence')),
  record_id         uuid NOT NULL,
  is_sensitive      boolean NOT NULL,
  reason            text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 1000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT record_sensitivity_record_key UNIQUE (record_type, record_id)
);
CREATE INDEX record_sensitivity_transformation_idx ON record_sensitivity (transformation_id, record_type) WHERE is_sensitive;

CREATE FUNCTION record_sensitivity_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  sensitive_grant_lock_class CONSTANT integer := 730300;
BEGIN
  PERFORM pg_advisory_xact_lock(sensitive_grant_lock_class, hashtext(NEW.record_type || ':' || NEW.record_id::text));
  IF TG_OP = 'UPDATE' AND (NEW.record_type IS DISTINCT FROM OLD.record_type OR NEW.record_id IS DISTINCT FROM OLD.record_id) THEN
    RAISE EXCEPTION 'record_sensitivity: the record it marks is immutable'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'record_sensitivity_record_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER record_sensitivity_guard BEFORE INSERT OR UPDATE ON record_sensitivity
  FOR EACH ROW EXECUTE FUNCTION record_sensitivity_guard();
CREATE TRIGGER record_sensitivity_record_ref BEFORE INSERT ON record_sensitivity
  FOR EACH ROW EXECUTE FUNCTION p6_sensitive_record_ref_guard();
SELECT p2_attach_guards('record_sensitivity', true);
GRANT SELECT, INSERT, UPDATE ON record_sensitivity TO mth_app;

-- Append-only history of the flag: written only by the trigger below (SECURITY DEFINER), never by the application.
CREATE TABLE record_sensitivity_change (
  id                    uuid PRIMARY KEY,
  record_sensitivity_id uuid NOT NULL REFERENCES record_sensitivity (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  organization_id       uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id     uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_type           text NOT NULL CHECK (record_type IN ('benefit', 'business_case', 'evidence')),
  record_id             uuid NOT NULL,
  record_version        integer NOT NULL CHECK (record_version >= 1),
  is_sensitive          boolean NOT NULL,
  reason                text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 1000),
  changed_by            uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  changed_at            timestamptz NOT NULL,
  CONSTRAINT record_sensitivity_change_version_key UNIQUE (record_sensitivity_id, record_version)
);
SELECT p2_attach_append_only('record_sensitivity_change');
GRANT SELECT ON record_sensitivity_change TO mth_app;

CREATE FUNCTION record_sensitivity_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO record_sensitivity_change (id, record_sensitivity_id, organization_id, transformation_id, record_type,
    record_id, record_version, is_sensitive, reason, changed_by, changed_at)
  VALUES (mth_uuid_v7(), NEW.id, NEW.organization_id, NEW.transformation_id, NEW.record_type, NEW.record_id,
    NEW.version, NEW.is_sensitive, NEW.reason, NEW.updated_by, NEW.updated_at);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION record_sensitivity_history() FROM PUBLIC;
CREATE TRIGGER record_sensitivity_history AFTER INSERT OR UPDATE ON record_sensitivity
  FOR EACH ROW EXECUTE FUNCTION record_sensitivity_history();

CREATE TABLE sensitive_record_grant (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_type       text NOT NULL CONSTRAINT sensitive_record_grant_record_type CHECK (record_type IN ('benefit', 'business_case', 'evidence')),
  record_id         uuid NOT NULL,
  grantee_user_id   uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  reason            text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 1000),
  status            text NOT NULL DEFAULT 'active' CONSTRAINT sensitive_record_grant_status CHECK (status IN ('active', 'revoked')),
  revoked_at        timestamptz NULL,
  revoked_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  revoke_reason     text NULL CHECK (revoke_reason IS NULL OR char_length(revoke_reason) BETWEEN 3 AND 1000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT sensitive_record_grant_revoke_complete CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)
    AND (revoked_at IS NULL) = (revoked_by IS NULL) AND (revoked_at IS NULL) = (revoke_reason IS NULL)),
  CONSTRAINT sensitive_record_grant_not_self CHECK (grantee_user_id <> created_by)
);
CREATE UNIQUE INDEX sensitive_record_grant_one_active_key ON sensitive_record_grant (record_type, record_id, grantee_user_id)
  WHERE status = 'active';
CREATE INDEX sensitive_record_grant_grantee_idx ON sensitive_record_grant (grantee_user_id, record_type) WHERE status = 'active';
CREATE INDEX sensitive_record_grant_transformation_idx ON sensitive_record_grant (transformation_id, created_at DESC, id DESC);

CREATE FUNCTION sensitive_record_grant_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  sensitive_grant_lock_class CONSTANT integer := 730300;
BEGIN
  PERFORM pg_advisory_xact_lock(sensitive_grant_lock_class, hashtext(NEW.record_type || ':' || NEW.record_id::text));
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'active' THEN
      RAISE EXCEPTION 'sensitive_record_grant: a grant starts active'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'sensitive_record_grant_transition';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.record_type IS DISTINCT FROM OLD.record_type OR NEW.record_id IS DISTINCT FROM OLD.record_id
     OR NEW.grantee_user_id IS DISTINCT FROM OLD.grantee_user_id OR NEW.reason IS DISTINCT FROM OLD.reason THEN
    RAISE EXCEPTION 'sensitive_record_grant: the record, grantee and reason of a grant are immutable'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'sensitive_record_grant_immutable';
  END IF;
  IF NOT (OLD.status = 'active' AND NEW.status = 'revoked') THEN
    RAISE EXCEPTION 'sensitive_record_grant: % -> % is not a permitted transition (active -> revoked only)', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'sensitive_record_grant_transition';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sensitive_record_grant_guard BEFORE INSERT OR UPDATE ON sensitive_record_grant
  FOR EACH ROW EXECUTE FUNCTION sensitive_record_grant_guard();
CREATE TRIGGER sensitive_record_grant_record_ref BEFORE INSERT ON sensitive_record_grant
  FOR EACH ROW EXECUTE FUNCTION p6_sensitive_record_ref_guard();
SELECT p2_attach_guards('sensitive_record_grant', true);
GRANT SELECT, INSERT, UPDATE ON sensitive_record_grant TO mth_app;

-- Deep links (REQ-S12-024). The token is an opaque identifier, not a credential: resolving it always re-authorizes the
-- signed-in caller against the target (ADR-0051 §3). 32 random bytes, base64url without padding = 43 characters.
ALTER TABLE inbox_notification
  ADD COLUMN link_token text NULL
    CONSTRAINT inbox_notification_link_token_format CHECK (link_token IS NULL OR link_token ~ '^[A-Za-z0-9_-]{43}$'),
  ADD COLUMN target_record_type text NULL
    CONSTRAINT inbox_notification_target_record_type_format CHECK (target_record_type IS NULL OR target_record_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  ADD COLUMN target_record_id uuid NULL,
  ADD CONSTRAINT inbox_notification_target_pair CHECK ((target_record_type IS NULL) = (target_record_id IS NULL));
CREATE UNIQUE INDEX inbox_notification_link_token_key ON inbox_notification (link_token) WHERE link_token IS NOT NULL;

CREATE FUNCTION inbox_notification_deep_link_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  deep_link_issue_lock_class CONSTANT integer := 730301;
BEGIN
  IF NEW.link_token IS DISTINCT FROM OLD.link_token THEN
    PERFORM pg_advisory_xact_lock(deep_link_issue_lock_class, hashtext(NEW.id::text));
  END IF;
  IF (OLD.link_token IS NOT NULL AND NEW.link_token IS DISTINCT FROM OLD.link_token)
     OR (OLD.target_record_type IS NOT NULL AND NEW.target_record_type IS DISTINCT FROM OLD.target_record_type)
     OR (OLD.target_record_id IS NOT NULL AND NEW.target_record_id IS DISTINCT FROM OLD.target_record_id) THEN
    RAISE EXCEPTION 'inbox_notification: the deep-link token and target are set once and never changed'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'inbox_notification_deep_link_once';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inbox_notification_deep_link_guard BEFORE UPDATE ON inbox_notification
  FOR EACH ROW EXECUTE FUNCTION inbox_notification_deep_link_guard();
