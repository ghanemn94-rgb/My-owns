-- 0102 P6 slice C: the evidence-storage setting, the store of each evidence file, notification channels and their
-- per-notification deliveries (T-DG6-ARCH-02; ADR-0054). Authored by solution-architect. Runs as mth_owner inside one
-- transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- REQ-S16-006 (M0311 "Provide an evidence-storage adapter with a private filesystem option and an optional
-- IT-approved object-store adapter"; acceptance "contract tests pass for both adapters; evidence is never served from a
-- public URL") and REQ-S12-023 (M0241 "Always provide an in-app inbox. Email and enterprise messaging are optional
-- IT-configured adapters; their absence must not break workflows").
--   p6_secret_ref_valid(jsonb)  a SecretRef ({"provider", "name"}, ADR-0052 §5) has exactly those two keys and never a
--                               value. Credentials are stored ONLY as references.
--   storage_setting             at most one row for the installation (singleton). No row = the environment default of
--                               ADR-0010/ADR-0011 (EVIDENCE_STORAGE_DRIVER, filesystem in every shipped profile). With
--                               driver 's3' the endpoint, region, bucket and both credential references are required.
--                               Versioned and audited; trigger-written append-only history storage_setting_change.
--   evidence_content            one column storage_driver (which store holds the bytes). Every row stored before P6 is
--                               'filesystem' (the column default), so a driver change never strands an earlier file:
--                               reads use the row's driver, new writes use the current setting.
--   notification_channel        at most one row per (organization, channel kind). 'email' can be enabled when its SMTP
--                               host, port, security and sender are set; 'enterprise_messaging' has a port and no
--                               adapter in P6, so it can never be enabled. No row or a disabled row = in-app only.
--                               Versioned and audited; trigger-written append-only history notification_channel_change.
--   notification_delivery       one row per (inbox notification, channel kind): the idempotency backstop of the
--                               fan-out (UNIQUE). States: pending -> sent | failed | skipped; failed -> pending (a retry,
--                               attempts + 1 on the next attempt). sent and skipped are terminal. No message body is
--                               stored; the channel renders it from the notification at send time. Versioned and
--                               audited (service actor).
-- Nothing here reads or writes DG0-DG7.

CREATE FUNCTION p6_secret_ref_valid(r jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $$
  SELECT r IS NULL OR (
    jsonb_typeof(r) = 'object'
    AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(r) AS k) = ARRAY['name', 'provider']
    AND jsonb_typeof(r->'provider') = 'string' AND (r->>'provider') ~ '^[a-z][a-z0-9_]{0,31}$'
    AND jsonb_typeof(r->'name') = 'string' AND (r->>'name') ~ '^[A-Za-z_][A-Za-z0-9_./-]{0,127}$')
$$;
COMMENT ON FUNCTION p6_secret_ref_valid(jsonb) IS
  'A SecretRef {provider, name} (ADR-0052 §5): exactly two string keys, never a secret value (ADR-0054 §2).';
GRANT EXECUTE ON FUNCTION p6_secret_ref_valid(jsonb) TO mth_app;

-- ---------------------------------------------------------------------------------------------------------------
-- storage_setting
CREATE TABLE storage_setting (
  id                  uuid PRIMARY KEY,
  singleton           boolean NOT NULL DEFAULT true CONSTRAINT storage_setting_singleton_key UNIQUE
                        CONSTRAINT storage_setting_singleton CHECK (singleton),
  driver              text NOT NULL CHECK (driver IN ('filesystem', 's3')),
  s3_endpoint         text NULL CHECK (s3_endpoint IS NULL OR (s3_endpoint ~ '^https?://[^/?#@[:space:]]+(:[0-9]{1,5})?/?$'
                        AND char_length(s3_endpoint) <= 300)),
  s3_region           text NULL CHECK (s3_region IS NULL OR s3_region ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  s3_bucket           text NULL CHECK (s3_bucket IS NULL OR s3_bucket ~ '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$'),
  s3_key_prefix       text NULL CHECK (s3_key_prefix IS NULL OR s3_key_prefix ~ '^[a-z0-9][a-z0-9_/-]{0,99}$'),
  s3_force_path_style boolean NOT NULL DEFAULT true,
  s3_access_key_ref   jsonb NULL CONSTRAINT storage_setting_access_key_ref CHECK (p6_secret_ref_valid(s3_access_key_ref)),
  s3_secret_key_ref   jsonb NULL CONSTRAINT storage_setting_secret_key_ref CHECK (p6_secret_ref_valid(s3_secret_key_ref)),
  reason              text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 1000),
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT storage_setting_s3_complete CHECK (driver <> 's3' OR (s3_endpoint IS NOT NULL AND s3_region IS NOT NULL
    AND s3_bucket IS NOT NULL AND s3_access_key_ref IS NOT NULL AND s3_secret_key_ref IS NOT NULL))
);
SELECT p2_attach_guards('storage_setting', true);
GRANT SELECT, INSERT, UPDATE ON storage_setting TO mth_app;

CREATE TABLE storage_setting_change (
  id                  uuid PRIMARY KEY,
  storage_setting_id  uuid NOT NULL REFERENCES storage_setting (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_version      integer NOT NULL CHECK (record_version >= 1),
  driver              text NOT NULL,
  s3_endpoint         text NULL,
  s3_region           text NULL,
  s3_bucket           text NULL,
  s3_key_prefix       text NULL,
  s3_force_path_style boolean NOT NULL,
  s3_access_key_ref   jsonb NULL,
  s3_secret_key_ref   jsonb NULL,
  reason              text NOT NULL,
  changed_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  changed_at          timestamptz NOT NULL,
  CONSTRAINT storage_setting_change_version_key UNIQUE (storage_setting_id, record_version)
);
SELECT p2_attach_append_only('storage_setting_change');
GRANT SELECT ON storage_setting_change TO mth_app;

CREATE FUNCTION storage_setting_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO storage_setting_change (id, storage_setting_id, record_version, driver, s3_endpoint, s3_region, s3_bucket,
    s3_key_prefix, s3_force_path_style, s3_access_key_ref, s3_secret_key_ref, reason, changed_by, changed_at)
  VALUES (mth_uuid_v7(), NEW.id, NEW.version, NEW.driver, NEW.s3_endpoint, NEW.s3_region, NEW.s3_bucket,
    NEW.s3_key_prefix, NEW.s3_force_path_style, NEW.s3_access_key_ref, NEW.s3_secret_key_ref, NEW.reason,
    NEW.updated_by, NEW.updated_at);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION storage_setting_history() FROM PUBLIC;
CREATE TRIGGER storage_setting_history AFTER INSERT OR UPDATE ON storage_setting
  FOR EACH ROW EXECUTE FUNCTION storage_setting_history();

ALTER TABLE evidence_content
  ADD COLUMN storage_driver text NOT NULL DEFAULT 'filesystem'
    CONSTRAINT evidence_content_storage_driver CHECK (storage_driver IN ('filesystem', 's3'));

-- ---------------------------------------------------------------------------------------------------------------
-- notification_channel
CREATE TABLE notification_channel (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  channel_kind      text NOT NULL CHECK (channel_kind IN ('email', 'enterprise_messaging')),
  enabled           boolean NOT NULL DEFAULT false,
  smtp_host         text NULL CHECK (smtp_host IS NULL OR smtp_host ~ '^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$'),
  smtp_port         integer NULL CHECK (smtp_port IS NULL OR smtp_port BETWEEN 1 AND 65535),
  smtp_security     text NULL CHECK (smtp_security IS NULL OR smtp_security IN ('starttls', 'tls', 'none')),
  smtp_username_ref jsonb NULL CONSTRAINT notification_channel_username_ref CHECK (p6_secret_ref_valid(smtp_username_ref)),
  smtp_password_ref jsonb NULL CONSTRAINT notification_channel_password_ref CHECK (p6_secret_ref_valid(smtp_password_ref)),
  from_address      text NULL CHECK (from_address IS NULL OR (char_length(from_address) <= 254
                      AND from_address ~ '^[^@[:space:]<>]+@[^@[:space:]<>]+\.[^@[:space:]<>]+$')),
  reason            text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 1000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT notification_channel_kind_key UNIQUE (organization_id, channel_kind),
  CONSTRAINT notification_channel_no_messaging_adapter CHECK (channel_kind <> 'enterprise_messaging' OR (NOT enabled
    AND smtp_host IS NULL AND smtp_port IS NULL AND smtp_security IS NULL AND smtp_username_ref IS NULL
    AND smtp_password_ref IS NULL AND from_address IS NULL)),
  CONSTRAINT notification_channel_email_complete CHECK (channel_kind <> 'email' OR NOT enabled OR (smtp_host IS NOT NULL
    AND smtp_port IS NOT NULL AND smtp_security IS NOT NULL AND from_address IS NOT NULL)),
  CONSTRAINT notification_channel_credentials_pair CHECK ((smtp_username_ref IS NULL) = (smtp_password_ref IS NULL))
);
SELECT p2_attach_guards('notification_channel', true);
GRANT SELECT, INSERT, UPDATE ON notification_channel TO mth_app;

CREATE TABLE notification_channel_change (
  id                      uuid PRIMARY KEY,
  notification_channel_id uuid NOT NULL REFERENCES notification_channel (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  organization_id         uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_version          integer NOT NULL CHECK (record_version >= 1),
  channel_kind            text NOT NULL,
  enabled                 boolean NOT NULL,
  smtp_host               text NULL,
  smtp_port               integer NULL,
  smtp_security           text NULL,
  smtp_username_ref       jsonb NULL,
  smtp_password_ref       jsonb NULL,
  from_address            text NULL,
  reason                  text NOT NULL,
  changed_by              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  changed_at              timestamptz NOT NULL,
  CONSTRAINT notification_channel_change_version_key UNIQUE (notification_channel_id, record_version)
);
SELECT p2_attach_append_only('notification_channel_change');
GRANT SELECT ON notification_channel_change TO mth_app;

CREATE FUNCTION notification_channel_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.channel_kind IS DISTINCT FROM OLD.channel_kind THEN
    RAISE EXCEPTION 'notification_channel: the channel kind never changes'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'notification_channel_kind_fixed';
  END IF;
  INSERT INTO notification_channel_change (id, notification_channel_id, organization_id, record_version, channel_kind,
    enabled, smtp_host, smtp_port, smtp_security, smtp_username_ref, smtp_password_ref, from_address, reason, changed_by,
    changed_at)
  VALUES (mth_uuid_v7(), NEW.id, NEW.organization_id, NEW.version, NEW.channel_kind, NEW.enabled, NEW.smtp_host,
    NEW.smtp_port, NEW.smtp_security, NEW.smtp_username_ref, NEW.smtp_password_ref, NEW.from_address, NEW.reason,
    NEW.updated_by, NEW.updated_at);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION notification_channel_history() FROM PUBLIC;
CREATE TRIGGER notification_channel_history AFTER INSERT OR UPDATE ON notification_channel
  FOR EACH ROW EXECUTE FUNCTION notification_channel_history();

-- ---------------------------------------------------------------------------------------------------------------
-- notification_delivery
CREATE TABLE notification_delivery (
  id                    uuid PRIMARY KEY,
  organization_id       uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  inbox_notification_id uuid NOT NULL REFERENCES inbox_notification (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  channel_kind          text NOT NULL CHECK (channel_kind IN ('email', 'enterprise_messaging')),
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts              smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  last_attempt_at       timestamptz NULL,
  sent_at               timestamptz NULL,
  skip_reason           text NULL CHECK (skip_reason IS NULL OR skip_reason IN ('no_address', 'recipient_restricted',
                          'channel_disabled', 'recipient_disabled')),
  error_code            text NULL CHECK (error_code IS NULL OR (char_length(error_code) BETWEEN 1 AND 100
                          AND error_code ~ '^[a-z][a-z0-9_.]*$')),
  version               integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT notification_delivery_once_key UNIQUE (inbox_notification_id, channel_kind),
  CONSTRAINT notification_delivery_sent_complete CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
  CONSTRAINT notification_delivery_skipped_complete CHECK ((status = 'skipped') = (skip_reason IS NOT NULL)),
  CONSTRAINT notification_delivery_failed_complete CHECK (status <> 'failed' OR (error_code IS NOT NULL
    AND last_attempt_at IS NOT NULL)),
  CONSTRAINT notification_delivery_attempted CHECK ((attempts = 0) = (last_attempt_at IS NULL))
);
CREATE INDEX notification_delivery_status_idx ON notification_delivery (status, updated_at, id);
SELECT p2_attach_guards('notification_delivery', true);
GRANT SELECT, INSERT, UPDATE ON notification_delivery TO mth_app;

CREATE FUNCTION notification_delivery_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM inbox_notification n WHERE n.id = NEW.inbox_notification_id
                     AND n.organization_id = NEW.organization_id) THEN
      RAISE EXCEPTION 'notification_delivery: the notification belongs to another organization'
        USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'notification_delivery_same_organization';
    END IF;
    IF NEW.status NOT IN ('pending', 'skipped') OR NEW.attempts <> 0 THEN
      RAISE EXCEPTION 'notification_delivery: a delivery is created pending (or skipped), with no attempt'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'notification_delivery_transition';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.inbox_notification_id, NEW.channel_kind) IS DISTINCT FROM (OLD.inbox_notification_id, OLD.channel_kind) THEN
    RAISE EXCEPTION 'notification_delivery: the notification and the channel never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'notification_delivery_identity_fixed';
  END IF;
  IF OLD.status IN ('sent', 'skipped') THEN
    RAISE EXCEPTION 'notification_delivery: a % delivery is final', OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'notification_delivery_final';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'pending' AND NEW.status IN ('sent', 'failed', 'skipped'))
       OR (OLD.status = 'failed' AND NEW.status = 'pending')) THEN
    RAISE EXCEPTION 'notification_delivery: % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'notification_delivery_transition';
  END IF;
  IF NEW.attempts < OLD.attempts OR NEW.attempts > OLD.attempts + 1
     OR (NEW.status IN ('sent', 'failed') AND NEW.attempts <> OLD.attempts + 1) THEN
    RAISE EXCEPTION 'notification_delivery: each send attempt counts exactly once'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'notification_delivery_attempt_step';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notification_delivery_guard BEFORE INSERT OR UPDATE ON notification_delivery
  FOR EACH ROW EXECUTE FUNCTION notification_delivery_guard();
