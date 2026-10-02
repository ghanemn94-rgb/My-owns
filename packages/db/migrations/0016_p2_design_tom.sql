-- 0016 Design: TOM canvas, T03 TOM Gap Matrix, capability heatmap, journeys and pain points (T-DG2-ARCH-01;
-- ADR-0016). Authored by solution-architect.
-- Contract: docs/architecture/data-dictionary.md ("P2" section). Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged; later P2 changes go into new migrations (0019+, owned by
-- backend-workflow-engineer). SQL floor: PostgreSQL 16. Ids are UUIDv7 from the application; seed rows use fixed
-- literal UUIDs.

-- -----------------------------------------------------------------------------------------------------------------
-- tom_canvas_cell: One TOM Canvas box per dimension per transformation (B0062): current/target design and owner. Ten rows pre-created per transformation.
CREATE TABLE tom_canvas_cell (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  dimension_code    text NOT NULL REFERENCES tom_dimension (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  current_design    text NULL CHECK (current_design IS NULL OR char_length(current_design) BETWEEN 1 AND 20000),
  target_design     text NULL CHECK (target_design IS NULL OR char_length(target_design) BETWEEN 1 AND 20000),
  owner_user_id     uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready')),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tom_canvas_cell_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT tom_canvas_cell_dimension_key UNIQUE (transformation_id, dimension_code),
  CONSTRAINT tom_canvas_cell_ready_complete CHECK (status <> 'ready' OR (target_design IS NOT NULL AND owner_user_id IS NOT NULL))
);
SELECT p2_attach_guards('tom_canvas_cell', true);
GRANT SELECT, INSERT, UPDATE ON tom_canvas_cell TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- tom_gap: T03 TOM Gap Matrix row (B0058): TOM dimension, current state, target state, gap, design decision, owner.
CREATE TABLE tom_gap (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id  uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  dimension_code     text NOT NULL REFERENCES tom_dimension (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  current_state      text NULL CHECK (current_state IS NULL OR char_length(current_state) BETWEEN 1 AND 20000),
  target_state       text NULL CHECK (target_state IS NULL OR char_length(target_state) BETWEEN 1 AND 20000),
  gap                text NULL CHECK (gap IS NULL OR char_length(gap) BETWEEN 1 AND 20000),
  design_decision_id uuid NULL,
  owner_user_id      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'archived')),
  archived_at        timestamptz NULL,
  archived_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason     text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version            integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tom_gap_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT tom_gap_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL) AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
CREATE INDEX tom_gap_transformation_updated_idx ON tom_gap (transformation_id, updated_at DESC, id DESC);
CREATE INDEX tom_gap_dimension_idx ON tom_gap (transformation_id, dimension_code) WHERE status <> 'archived';
SELECT p2_attach_guards('tom_gap', true);
GRANT SELECT, INSERT, UPDATE ON tom_gap TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- capability: Capability heatmap entry: current vs target level and build/buy/partner need (REQ-PB-024).
CREATE TABLE capability (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  name              text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 300),
  description       text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 4000),
  dimension_code    text NULL REFERENCES tom_dimension (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  current_level     smallint NULL CHECK (current_level IS NULL OR current_level BETWEEN 1 AND 5),
  target_level      smallint NULL CHECK (target_level IS NULL OR target_level BETWEEN 1 AND 5),
  sourcing_need     text NULL CHECK (sourcing_need IS NULL OR sourcing_need IN ('build', 'buy', 'partner', 'undecided')),
  owner_user_id     uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  tom_gap_id        uuid NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at       timestamptz NULL,
  archived_by       uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason    text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT capability_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT capability_tom_gap_id_fkey FOREIGN KEY (transformation_id, tom_gap_id) REFERENCES tom_gap (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT capability_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL) AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
CREATE INDEX capability_transformation_updated_idx ON capability (transformation_id, updated_at DESC, id DESC);
SELECT p2_attach_guards('capability', true);
GRANT SELECT, INSERT, UPDATE ON capability TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- journey: Journey or process map, current or future state (REQ-PB-025); steps with actors, handoffs, systems, controls.
CREATE TABLE journey (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  name              text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 300),
  kind              text NOT NULL CHECK (kind IN ('journey', 'process')),
  state             text NOT NULL CHECK (state IN ('current', 'future')),
  description       text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 20000),
  dimension_code    text NULL REFERENCES tom_dimension (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  steps             jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) <= 200),
  cycle_time_value  numeric(14,4) NULL CHECK (cycle_time_value IS NULL OR cycle_time_value >= 0),
  cycle_time_unit   text NULL CHECK (cycle_time_unit IS NULL OR cycle_time_unit IN ('minutes', 'hours', 'days', 'weeks')),
  failure_demand    text NULL CHECK (failure_demand IS NULL OR char_length(failure_demand) BETWEEN 1 AND 4000),
  owner_user_id     uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  archived_at       timestamptz NULL,
  archived_by       uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason    text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT journey_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT journey_cycle_time_pair CHECK ((cycle_time_value IS NULL) = (cycle_time_unit IS NULL)),
  CONSTRAINT journey_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL) AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
CREATE INDEX journey_transformation_updated_idx ON journey (transformation_id, updated_at DESC, id DESC);
CREATE INDEX journey_state_idx ON journey (transformation_id, state) WHERE status <> 'archived';
SELECT p2_attach_guards('journey', true);
GRANT SELECT, INSERT, UPDATE ON journey TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- journey_pain_point: A pain point on a journey (optionally on one step), linkable to a T01 row (REQ-PB-025).
CREATE TABLE journey_pain_point (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id  uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  journey_id         uuid NOT NULL,
  step_key           uuid NULL,
  description        text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 2000),
  diagnostic_item_id uuid NULL,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at        timestamptz NULL,
  archived_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason     text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version            integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT journey_pain_point_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT journey_pain_point_journey_id_fkey FOREIGN KEY (transformation_id, journey_id) REFERENCES journey (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT journey_pain_point_diagnostic_item_id_fkey FOREIGN KEY (transformation_id, diagnostic_item_id) REFERENCES diagnostic_item (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT journey_pain_point_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL) AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
CREATE INDEX journey_pain_point_journey_idx ON journey_pain_point (journey_id);
SELECT p2_attach_guards('journey_pain_point', true);
GRANT SELECT, INSERT, UPDATE ON journey_pain_point TO mth_app;
