-- 0106 P6 slice B: the external-change flag of a deliverable and its separate confirmation state with provenance
-- (T-DG6-ARCH-03; ADR-0055 §6). Authored by solution-architect. Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- REQ-S01-005 (M0080 "Never imply an external operational change happened because a task was marked complete; require
-- verified evidence or a confirmed integration result"; acceptance "marking the task complete leaves the deliverable
-- Unconfirmed; a filename-only link does not confirm it; reviewed evidence or a test-adapter confirmation sets it and
-- records the source").
--   deliverable_external_change  at most one row per deliverable (no row = not flagged as an external change). Additive
--                                on DG3: the deliverable table, its acceptance and every task table are unchanged and
--                                never write this table. confirmation_status: unconfirmed -> confirmed (terminal).
--                                'confirmed' has exactly one source:
--                                  reviewed_evidence  an evidence item of the same transformation whose review_status
--                                                     is 'verified' (a file_reference, i.e. a filename-only link, can
--                                                     never be verified: evidence_filename_never_verified, 0012), and
--                                                     the confirming user;
--                                  connector_result   a CONFIRMED outbound write for this deliverable (0104), its
--                                                     connector, source system id, downstream reference and confirmed
--                                                     time, and the connector's service identity.
--                                A flag can be withdrawn (is_external_change false) only while unconfirmed. Versioned
--                                and audited; trigger-written append-only history deliverable_external_change_event.
-- Nothing here reads or writes DG0-DG7. Confirming an external change is not a business approval.

CREATE TABLE deliverable_external_change (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id    uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  deliverable_id       uuid NOT NULL CONSTRAINT deliverable_external_change_deliverable_key UNIQUE,
  is_external_change   boolean NOT NULL DEFAULT true,
  change_type          text NOT NULL CHECK (change_type IN ('customer_system', 'network_upgrade', 'procurement_transaction', 'other')),
  description          text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 2000),
  confirmation_status  text NOT NULL DEFAULT 'unconfirmed' CHECK (confirmation_status IN ('unconfirmed', 'confirmed')),
  confirmation_source  text NULL CHECK (confirmation_source IS NULL OR confirmation_source IN ('reviewed_evidence', 'connector_result')),
  evidence_id          uuid NULL,
  outbound_write_id    uuid NULL REFERENCES outbound_write (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  connector_id         uuid NULL REFERENCES connector (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  source_system_id     text NULL CHECK (source_system_id IS NULL OR char_length(source_system_id) BETWEEN 1 AND 200),
  source_reference     text NULL CHECK (source_reference IS NULL OR char_length(source_reference) BETWEEN 1 AND 200),
  source_confirmed_at  timestamptz NULL,
  service_identity_id  uuid NULL REFERENCES service_identity (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  confirmed_at         timestamptz NULL,
  confirmed_by         uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  confirmation_note    text NULL CHECK (confirmation_note IS NULL OR char_length(confirmation_note) BETWEEN 3 AND 2000),
  version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT deliverable_external_change_deliverable_fkey FOREIGN KEY (transformation_id, deliverable_id)
    REFERENCES deliverable (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT deliverable_external_change_evidence_fkey FOREIGN KEY (transformation_id, evidence_id)
    REFERENCES evidence (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT deliverable_external_change_source_shape CHECK (
    (confirmation_status = 'unconfirmed' AND confirmation_source IS NULL AND evidence_id IS NULL
      AND outbound_write_id IS NULL AND connector_id IS NULL AND source_system_id IS NULL AND source_reference IS NULL
      AND source_confirmed_at IS NULL AND service_identity_id IS NULL AND confirmed_at IS NULL AND confirmed_by IS NULL
      AND confirmation_note IS NULL)
    OR (confirmation_status = 'confirmed' AND confirmation_source = 'reviewed_evidence' AND evidence_id IS NOT NULL
      AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND outbound_write_id IS NULL AND connector_id IS NULL
      AND source_system_id IS NULL AND source_reference IS NULL AND source_confirmed_at IS NULL AND service_identity_id IS NULL)
    OR (confirmation_status = 'confirmed' AND confirmation_source = 'connector_result' AND outbound_write_id IS NOT NULL
      AND connector_id IS NOT NULL AND source_system_id IS NOT NULL AND source_reference IS NOT NULL
      AND source_confirmed_at IS NOT NULL AND service_identity_id IS NOT NULL AND confirmed_at IS NOT NULL
      AND confirmed_by IS NULL AND evidence_id IS NULL)),
  CONSTRAINT deliverable_external_change_confirmed_flagged CHECK (confirmation_status = 'unconfirmed' OR is_external_change),
  CONSTRAINT deliverable_external_change_other_described CHECK (change_type <> 'other' OR description IS NOT NULL)
);
CREATE INDEX deliverable_external_change_list_idx ON deliverable_external_change (transformation_id, confirmation_status)
  WHERE is_external_change;
SELECT p2_attach_guards('deliverable_external_change', true);
GRANT SELECT, INSERT, UPDATE ON deliverable_external_change TO mth_app;

CREATE FUNCTION deliverable_external_change_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  w record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.confirmation_status <> 'unconfirmed' OR NOT NEW.is_external_change THEN
      RAISE EXCEPTION 'deliverable_external_change: a deliverable is flagged unconfirmed'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'deliverable_external_change_transition';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.confirmation_status = 'confirmed' THEN
    RAISE EXCEPTION 'deliverable_external_change: a confirmed external change never changes'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'deliverable_external_change_final';
  END IF;
  IF NEW.deliverable_id IS DISTINCT FROM OLD.deliverable_id THEN
    RAISE EXCEPTION 'deliverable_external_change: the deliverable never changes'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'deliverable_external_change_identity_fixed';
  END IF;
  IF NEW.confirmation_status = 'confirmed' THEN
    IF NOT OLD.is_external_change THEN
      RAISE EXCEPTION 'deliverable_external_change: a withdrawn flag cannot be confirmed'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'deliverable_external_change_confirmed_flagged';
    END IF;
    IF NEW.confirmation_source = 'reviewed_evidence' AND NOT EXISTS (
         SELECT 1 FROM evidence e WHERE e.id = NEW.evidence_id AND e.transformation_id = NEW.transformation_id
           AND e.review_status = 'verified' AND e.kind <> 'file_reference' AND e.status = 'active') THEN
      RAISE EXCEPTION 'deliverable_external_change: only verified evidence of the same transformation confirms (a filename-only link never does)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'deliverable_external_change_evidence_verified';
    END IF;
    IF NEW.confirmation_source = 'connector_result' THEN
      SELECT ow.*, cv.source_system_id AS cfg_source_system_id INTO w
        FROM outbound_write ow
        JOIN connector_config_version cv ON cv.connector_id = ow.connector_id AND cv.version_no = ow.config_version_no
       WHERE ow.id = NEW.outbound_write_id;
      IF NOT FOUND OR w.status <> 'confirmed' OR w.deliverable_id <> NEW.deliverable_id
         OR w.connector_id <> NEW.connector_id OR w.external_reference <> NEW.source_reference
         OR w.confirmed_at <> NEW.source_confirmed_at OR w.service_identity_id <> NEW.service_identity_id
         OR w.cfg_source_system_id <> NEW.source_system_id THEN
        RAISE EXCEPTION 'deliverable_external_change: a connector confirmation copies a confirmed outbound write of this deliverable'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'deliverable_external_change_connector_confirmed';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deliverable_external_change_guard BEFORE INSERT OR UPDATE ON deliverable_external_change
  FOR EACH ROW EXECUTE FUNCTION deliverable_external_change_guard();

CREATE TABLE deliverable_external_change_event (
  id                             uuid PRIMARY KEY,
  deliverable_external_change_id uuid NOT NULL REFERENCES deliverable_external_change (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_version                 integer NOT NULL CHECK (record_version >= 1),
  is_external_change             boolean NOT NULL,
  change_type                    text NOT NULL,
  confirmation_status            text NOT NULL,
  confirmation_source            text NULL,
  evidence_id                    uuid NULL,
  outbound_write_id              uuid NULL,
  source_reference               text NULL,
  actor_user_id                  uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  occurred_at                    timestamptz NOT NULL,
  CONSTRAINT deliverable_external_change_event_version_key UNIQUE (deliverable_external_change_id, record_version)
);
SELECT p2_attach_append_only('deliverable_external_change_event');
GRANT SELECT ON deliverable_external_change_event TO mth_app;

CREATE FUNCTION deliverable_external_change_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO deliverable_external_change_event (id, deliverable_external_change_id, record_version, is_external_change,
    change_type, confirmation_status, confirmation_source, evidence_id, outbound_write_id, source_reference,
    actor_user_id, occurred_at)
  VALUES (mth_uuid_v7(), NEW.id, NEW.version, NEW.is_external_change, NEW.change_type, NEW.confirmation_status,
    NEW.confirmation_source, NEW.evidence_id, NEW.outbound_write_id, NEW.source_reference,
    coalesce(NEW.updated_by, NEW.created_by), NEW.updated_at);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION deliverable_external_change_history() FROM PUBLIC;
CREATE TRIGGER deliverable_external_change_history AFTER INSERT OR UPDATE ON deliverable_external_change
  FOR EACH ROW EXECUTE FUNCTION deliverable_external_change_history();
