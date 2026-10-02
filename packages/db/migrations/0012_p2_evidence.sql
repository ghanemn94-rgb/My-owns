-- 0012 evidence repository metadata: evidence items, append-only content revisions, links (T-DG2-ARCH-01; ADR-0010,
-- ADR-0018). Authored by solution-architect.
-- Contract: docs/architecture/data-dictionary.md ("P2" section). Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged; later P2 changes go into new migrations (0019+, owned by
-- backend-workflow-engineer). SQL floor: PostgreSQL 16. Ids are UUIDv7 from the application; seed rows use fixed
-- literal UUIDs.

-- -----------------------------------------------------------------------------------------------------------------
-- evidence: Evidence repository item (§13, ADR-0010/0018): a stored file, a native note, an external link or a bare filename reference. Counts toward gates only when verified.
CREATE TABLE evidence (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id    uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kind                 text NOT NULL CHECK (kind IN ('file', 'note', 'external_link', 'file_reference')),
  title                text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  description          text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 4000),
  evidence_type        text NOT NULL DEFAULT 'document' CHECK (evidence_type IN ('document', 'data_extract', 'analysis', 'interview', 'observation', 'system_report', 'other')),
  source               text NULL CHECK (source IS NULL OR char_length(source) BETWEEN 1 AND 500),
  owner_user_id        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  observation_start    date NULL,
  observation_end      date NULL,
  note_body            text NULL CHECK (note_body IS NULL OR char_length(note_body) BETWEEN 1 AND 20000),
  url                  text NULL CHECK (url IS NULL OR (url ~ '^https?://' AND char_length(url) <= 2000)),
  file_name            text NULL CHECK (file_name IS NULL OR char_length(file_name) BETWEEN 1 AND 255),
  current_content_id   uuid NULL,
  review_status        text NOT NULL DEFAULT 'unverified' CHECK (review_status IN ('unverified', 'verified', 'rejected')),
  accessibility_status text NOT NULL DEFAULT 'unchecked' CHECK (accessibility_status IN ('unchecked', 'accessible', 'inaccessible')),
  reviewed_content_id  uuid NULL,
  reviewed_by          uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  reviewed_at          timestamptz NULL,
  review_note          text NULL CHECK (review_note IS NULL OR char_length(review_note) BETWEEN 1 AND 2000),
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at          timestamptz NULL,
  archived_by          uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason       text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT evidence_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT evidence_observation_range CHECK (observation_end IS NULL OR observation_start IS NULL OR observation_end >= observation_start),
  CONSTRAINT evidence_kind_payload CHECK ((kind = 'note' AND note_body IS NOT NULL AND url IS NULL AND current_content_id IS NULL) OR (kind = 'external_link' AND url IS NOT NULL AND note_body IS NULL AND current_content_id IS NULL) OR (kind = 'file' AND url IS NULL AND note_body IS NULL) OR (kind = 'file_reference' AND file_name IS NOT NULL AND url IS NULL AND note_body IS NULL AND current_content_id IS NULL)),
  CONSTRAINT evidence_filename_never_verified CHECK (kind <> 'file_reference' OR (review_status <> 'verified' AND accessibility_status <> 'accessible')),
  CONSTRAINT evidence_review_complete CHECK ((review_status = 'unverified') = (reviewed_by IS NULL) AND (reviewed_by IS NULL) = (reviewed_at IS NULL)),
  CONSTRAINT evidence_verified_rule CHECK (review_status <> 'verified' OR (accessibility_status = 'accessible' AND reviewed_by <> created_by AND (kind <> 'file' OR (current_content_id IS NOT NULL AND reviewed_content_id = current_content_id)))),
  CONSTRAINT evidence_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL) AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
CREATE INDEX evidence_transformation_updated_idx ON evidence (transformation_id, updated_at DESC, id DESC);
CREATE INDEX evidence_review_idx ON evidence (transformation_id, review_status) WHERE status = 'active';
SELECT p2_attach_guards('evidence', true);
GRANT SELECT, INSERT, UPDATE ON evidence TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- evidence_content: Append-only stored content revisions of a file evidence item (key + SHA-256 in the EvidenceStore).
CREATE TABLE evidence_content (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  evidence_id       uuid NOT NULL,
  revision          integer NOT NULL CHECK (revision >= 1),
  storage_key       text NOT NULL CONSTRAINT evidence_content_storage_key_key UNIQUE CHECK (storage_key ~ '^[A-Za-z0-9/_.-]{1,200}$'),
  sha256            char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes        bigint NOT NULL CHECK (size_bytes BETWEEN 0 AND 1073741824),
  content_type      text NOT NULL CHECK (char_length(content_type) BETWEEN 1 AND 200),
  file_name         text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  uploaded_by       uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidence_content_evidence_id_fkey FOREIGN KEY (transformation_id, evidence_id) REFERENCES evidence (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT evidence_content_revision_key UNIQUE (evidence_id, revision),
  CONSTRAINT evidence_content_evidence_id_id_key UNIQUE (evidence_id, id)
);
SELECT p2_attach_append_only('evidence_content');
ALTER TABLE evidence
  ADD CONSTRAINT evidence_current_content_fkey FOREIGN KEY (id, current_content_id) REFERENCES evidence_content (evidence_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT evidence_reviewed_content_fkey FOREIGN KEY (id, reviewed_content_id) REFERENCES evidence_content (evidence_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT;
SELECT p2_attach_guards('evidence_content', false);
GRANT SELECT, INSERT ON evidence_content TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- evidence_link: Links an evidence item to any P2 record of the same transformation (polymorphic, guarded).
CREATE TABLE evidence_link (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  evidence_id       uuid NOT NULL,
  record_type       text NOT NULL CHECK (record_type IN ('charter', 'north_star', 'strategic_guardrail', 'outcome', 'kpi_definition', 'baseline', 'outcome_kpi', 'value_pool', 'diagnostic_item', 'diagnostic_finding', 'diagnostic_workstream_output', 'tom_canvas_cell', 'tom_gap', 'capability', 'journey', 'journey_pain_point', 'decision', 'dependency', 'tom_workshop', 'action_item')),
  record_id         uuid NOT NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  removed_at        timestamptz NULL,
  removed_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  remove_reason     text NULL CHECK (remove_reason IS NULL OR char_length(remove_reason) BETWEEN 3 AND 1000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT evidence_link_evidence_id_fkey FOREIGN KEY (transformation_id, evidence_id) REFERENCES evidence (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT evidence_link_removal_complete CHECK ((status = 'removed') = (removed_at IS NOT NULL) AND (removed_at IS NULL) = (removed_by IS NULL) AND (removed_at IS NULL) = (remove_reason IS NULL))
);
CREATE UNIQUE INDEX evidence_link_active_key ON evidence_link (evidence_id, record_type, record_id) WHERE status = 'active';
CREATE INDEX evidence_link_record_idx ON evidence_link (record_type, record_id) WHERE status = 'active';
CREATE TRIGGER evidence_link_record_ref BEFORE INSERT ON evidence_link FOR EACH ROW EXECUTE FUNCTION p2_record_ref_guard();
SELECT p2_attach_guards('evidence_link', true);
GRANT SELECT, INSERT, UPDATE ON evidence_link TO mth_app;
