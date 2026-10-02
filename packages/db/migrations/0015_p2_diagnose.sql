-- 0015 Diagnose: T01 Current-State Diagnostic, diagnostic findings, workstream outputs (T-DG2-ARCH-01; ADR-0016).
-- Authored by solution-architect.
-- Contract: docs/architecture/data-dictionary.md ("P2" section). Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged; later P2 changes go into new migrations (0019+, owned by
-- backend-workflow-engineer). SQL floor: PostgreSQL 16. Ids are UUIDv7 from the application; seed rows use fixed
-- literal UUIDs.

-- -----------------------------------------------------------------------------------------------------------------
-- diagnostic_item: T01 Current-State Diagnostic row (B0031): dimension, current state, evidence/baseline, root cause, impact (SAR or KPI), confidence H/M/L. Six rows pre-seeded per transformation.
CREATE TABLE diagnostic_item (
  id                       uuid PRIMARY KEY,
  organization_id          uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id        uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  dimension_code           text NOT NULL REFERENCES diagnostic_dimension (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  is_seeded                boolean NOT NULL DEFAULT false,
  current_state            text NULL CHECK (current_state IS NULL OR char_length(current_state) BETWEEN 1 AND 20000),
  evidence_baseline        text NULL CHECK (evidence_baseline IS NULL OR char_length(evidence_baseline) BETWEEN 1 AND 4000),
  baseline_id              uuid NULL,
  root_cause               text NULL CHECK (root_cause IS NULL OR char_length(root_cause) BETWEEN 1 AND 20000),
  impact_text              text NULL CHECK (impact_text IS NULL OR char_length(impact_text) BETWEEN 1 AND 4000),
  impact_amount            numeric(20,4) NULL,
  impact_currency          char(3) NULL CHECK (impact_currency IS NULL OR impact_currency ~ '^[A-Z]{3}$'),
  impact_kpi_definition_id uuid NULL,
  confidence               text NULL CHECK (confidence IS NULL OR confidence IN ('H', 'M', 'L')),
  owner_user_id            uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status                   text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at              timestamptz NULL,
  archived_by              uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason           text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version                  integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT diagnostic_item_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT diagnostic_item_baseline_id_fkey FOREIGN KEY (transformation_id, baseline_id) REFERENCES baseline (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT diagnostic_item_impact_kpi_definition_id_fkey FOREIGN KEY (transformation_id, impact_kpi_definition_id) REFERENCES kpi_definition (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT diagnostic_item_impact_money_pair CHECK ((impact_amount IS NULL) = (impact_currency IS NULL)),
  CONSTRAINT diagnostic_item_seeded_not_archived CHECK (NOT (is_seeded AND status = 'archived')),
  CONSTRAINT diagnostic_item_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL) AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
CREATE INDEX diagnostic_item_transformation_updated_idx ON diagnostic_item (transformation_id, updated_at DESC, id DESC);
CREATE UNIQUE INDEX diagnostic_item_seeded_key ON diagnostic_item (transformation_id, dimension_code) WHERE is_seeded;
SELECT p2_attach_guards('diagnostic_item', true);
GRANT SELECT, INSERT, UPDATE ON diagnostic_item TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- diagnostic_finding: A diagnostic finding in a workstream, classified to separate symptoms from root causes (REQ-S04-003).
CREATE TABLE diagnostic_finding (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id  uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  workstream_code    text NOT NULL REFERENCES diagnostic_workstream (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  diagnostic_item_id uuid NULL,
  kind               text NOT NULL CHECK (kind IN ('symptom', 'root_cause', 'opportunity', 'observation')),
  statement          text NOT NULL CHECK (char_length(statement) BETWEEN 1 AND 2000),
  detail             text NULL CHECK (detail IS NULL OR char_length(detail) BETWEEN 1 AND 20000),
  confidence         text NULL CHECK (confidence IS NULL OR confidence IN ('H', 'M', 'L')),
  owner_user_id      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'rejected', 'archived')),
  archived_at        timestamptz NULL,
  archived_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason     text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version            integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT diagnostic_finding_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT diagnostic_finding_diagnostic_item_id_fkey FOREIGN KEY (transformation_id, diagnostic_item_id) REFERENCES diagnostic_item (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT diagnostic_finding_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL) AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
CREATE INDEX diagnostic_finding_transformation_updated_idx ON diagnostic_finding (transformation_id, updated_at DESC, id DESC);
SELECT p2_attach_guards('diagnostic_finding', true);
GRANT SELECT, INSERT, UPDATE ON diagnostic_finding TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- diagnostic_workstream_output: An output attached to one of the six workstreams, as a linked record and/or evidence (REQ-PB-023).
CREATE TABLE diagnostic_workstream_output (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  workstream_code   text NOT NULL REFERENCES diagnostic_workstream (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  title             text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  output_kind       text NULL CHECK (output_kind IS NULL OR char_length(output_kind) BETWEEN 1 AND 100),
  record_type       text NULL CHECK (record_type IS NULL OR record_type IN ('diagnostic_item', 'diagnostic_finding', 'baseline', 'value_pool', 'capability', 'journey', 'kpi_definition')),
  record_id         uuid NULL,
  evidence_id       uuid NULL,
  note              text NULL CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 4000),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at       timestamptz NULL,
  archived_by       uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason    text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT diagnostic_workstream_output_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT diagnostic_workstream_output_evidence_id_fkey FOREIGN KEY (transformation_id, evidence_id) REFERENCES evidence (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT diagnostic_workstream_output_record_pair CHECK ((record_type IS NULL) = (record_id IS NULL)),
  CONSTRAINT diagnostic_workstream_output_has_target CHECK (record_id IS NOT NULL OR evidence_id IS NOT NULL),
  CONSTRAINT diagnostic_workstream_output_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL) AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
CREATE INDEX diagnostic_workstream_output_transformation_updated_idx ON diagnostic_workstream_output (transformation_id, updated_at DESC, id DESC);
CREATE TRIGGER diagnostic_workstream_output_record_ref BEFORE INSERT OR UPDATE OF record_type, record_id ON diagnostic_workstream_output
  FOR EACH ROW EXECUTE FUNCTION p2_record_ref_guard();
SELECT p2_attach_guards('diagnostic_workstream_output', true);
GRANT SELECT, INSERT, UPDATE ON diagnostic_workstream_output TO mth_app;
