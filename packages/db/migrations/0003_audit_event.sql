-- 0003 append-only audit trail (T-DG1-BE; ADR-0004, REQ-S16-032).
-- Written by the application in the same transaction as the mutation it describes. Protected two ways:
--   1. privileges: mth_app has INSERT and SELECT only;
--   2. trigger audit_event_immutable: UPDATE, DELETE and TRUNCATE raise, even for the table owner.
-- Residual risk (documented in ADR-0004): the owner role could drop the trigger; its credentials are IT-held.

CREATE TABLE audit_event (
  id                   uuid PRIMARY KEY,
  seq                  bigint GENERATED ALWAYS AS IDENTITY,
  occurred_at          timestamptz NOT NULL DEFAULT now(),
  organization_id      uuid NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id    uuid NULL, -- deliberately no FK: the trail must survive any future retention of the record
  actor_type           text NOT NULL CHECK (actor_type IN ('user', 'service', 'system')),
  actor_user_id        uuid NULL,
  on_behalf_of_user_id uuid NULL,
  action               text NOT NULL CHECK (action ~ '^[a-z_]+\.[a-z_.]+$'),
  record_type          text NOT NULL CHECK (char_length(record_type) BETWEEN 1 AND 64),
  record_id            uuid NOT NULL,
  prior_version        integer NULL CHECK (prior_version IS NULL OR prior_version >= 1),
  new_version          integer NULL CHECK (new_version IS NULL OR new_version >= 1),
  reason               text NULL,
  request_id           text NULL CHECK (request_id IS NULL OR char_length(request_id) <= 128),
  source               text NOT NULL CHECK (source IN ('api', 'worker', 'cli', 'migration')),
  changes              jsonb NULL CHECK (changes IS NULL OR jsonb_typeof(changes) = 'object'),
  CONSTRAINT audit_event_seq_key UNIQUE (seq),
  CONSTRAINT audit_event_user_actor CHECK (actor_type <> 'user' OR actor_user_id IS NOT NULL),
  CONSTRAINT audit_event_version_step CHECK (prior_version IS NULL OR new_version IS NULL OR new_version = prior_version + 1)
);
CREATE INDEX audit_event_transformation_idx ON audit_event (transformation_id, seq DESC);
CREATE INDEX audit_event_record_idx ON audit_event (record_type, record_id, seq DESC);
CREATE INDEX audit_event_org_time_idx ON audit_event (organization_id, occurred_at DESC);

CREATE FUNCTION audit_event_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER audit_event_immutable
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_immutable();
CREATE TRIGGER audit_event_immutable_truncate
  BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION audit_event_immutable();

REVOKE ALL ON audit_event FROM PUBLIC;
GRANT INSERT, SELECT ON audit_event TO mth_app;
GRANT USAGE ON SEQUENCE audit_event_seq_seq TO mth_app;
