-- 0004 transactional outbox, consumer idempotency ledger and HTTP Idempotency-Key records
-- (T-DG1-BE; ADR-0007 §6, ADR-0008).

CREATE TABLE outbox_event (
  id               uuid PRIMARY KEY,
  seq              bigint GENERATED ALWAYS AS IDENTITY,
  organization_id  uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  aggregate_type   text NOT NULL CHECK (char_length(aggregate_type) BETWEEN 1 AND 64),
  aggregate_id     uuid NOT NULL,
  event_type       text NOT NULL CHECK (event_type ~ '^[a-z_]+\.[a-z_.]+$'),
  schema_version   integer NOT NULL CHECK (schema_version >= 1),
  payload          jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  idempotency_key  text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  created_at       timestamptz NOT NULL DEFAULT now(),
  published_at     timestamptz NULL,
  publish_attempts integer NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
  last_error       text NULL,
  CONSTRAINT outbox_event_seq_key UNIQUE (seq),
  CONSTRAINT outbox_event_idempotency_key_key UNIQUE (idempotency_key)
);
CREATE INDEX outbox_event_unpublished_idx ON outbox_event (seq) WHERE published_at IS NULL;

CREATE TABLE processed_message (
  consumer        text NOT NULL CHECK (char_length(consumer) BETWEEN 1 AND 100),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  processed_at    timestamptz NOT NULL DEFAULT now(),
  outcome         text NOT NULL CHECK (outcome IN ('done', 'skipped')),
  PRIMARY KEY (consumer, idempotency_key)
);

CREATE TABLE idempotency_record (
  user_id         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  key             text NOT NULL CHECK (char_length(key) BETWEEN 8 AND 128),
  request_hash    char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response_status integer NOT NULL CHECK (response_status BETWEEN 100 AND 599),
  response_body   jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  PRIMARY KEY (user_id, key),
  CONSTRAINT idempotency_record_expiry CHECK (expires_at > created_at)
);
CREATE INDEX idempotency_record_expiry_idx ON idempotency_record (expires_at);

GRANT SELECT, INSERT, UPDATE ON outbox_event TO mth_app;
GRANT USAGE ON SEQUENCE outbox_event_seq_seq TO mth_app;
GRANT SELECT, INSERT ON processed_message TO mth_app;
GRANT SELECT, INSERT, DELETE ON idempotency_record TO mth_app; -- expired rows are purged by the worker
