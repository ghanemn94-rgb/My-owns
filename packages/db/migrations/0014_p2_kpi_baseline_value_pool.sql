-- 0014 KPI dictionary (P2 subset), baselines, T02 Outcome & KPI Tree, value pools (T-DG2-ARCH-01; ADR-0016,
-- ADR-0019). Authored by solution-architect.
-- Contract: docs/architecture/data-dictionary.md ("P2" section). Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged; later P2 changes go into new migrations (0019+, owned by
-- backend-workflow-engineer). SQL floor: PostgreSQL 16. Ids are UUIDv7 from the application; seed rows use fixed
-- literal UUIDs.

-- -----------------------------------------------------------------------------------------------------------------
-- kpi_definition: KPI dictionary entry (P2 subset of REQ-S07-001; P4 adds versions, formulas and actuals).
CREATE TABLE kpi_definition (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  name              text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description       text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 4000),
  business_purpose  text NULL CHECK (business_purpose IS NULL OR char_length(business_purpose) BETWEEN 1 AND 4000),
  unit_kind         text NOT NULL CHECK (unit_kind IN ('currency', 'percentage', 'count', 'ratio', 'duration', 'score', 'other')),
  unit_label        text NULL CHECK (unit_label IS NULL OR char_length(unit_label) BETWEEN 1 AND 50),
  currency          char(3) NULL CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  polarity          text NOT NULL CHECK (polarity IN ('higher_is_better', 'lower_is_better', 'within_band')),
  frequency         text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'annual', 'ad_hoc')),
  is_leading        boolean NOT NULL DEFAULT false,
  data_source       text NULL CHECK (data_source IS NULL OR char_length(data_source) BETWEEN 1 AND 500),
  owner_user_id     uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  steward_user_id   uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  archived_at       timestamptz NULL,
  archived_by       uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason    text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_definition_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT kpi_definition_currency_unit CHECK ((unit_kind = 'currency') = (currency IS NOT NULL)),
  CONSTRAINT kpi_definition_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL) AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
CREATE INDEX kpi_definition_transformation_updated_idx ON kpi_definition (transformation_id, updated_at DESC, id DESC);
CREATE UNIQUE INDEX kpi_definition_name_key ON kpi_definition (transformation_id, lower(name)) WHERE status <> 'archived';
SELECT p2_attach_guards('kpi_definition', true);
GRANT SELECT, INSERT, UPDATE ON kpi_definition TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- baseline: Baseline registry entry: metric, value, unit, source, baseline date (REQ-PB-027). Missing value = Unknown.
CREATE TABLE baseline (
  id                       uuid PRIMARY KEY,
  organization_id          uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id        uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  metric                   text NOT NULL CHECK (char_length(metric) BETWEEN 1 AND 300),
  kpi_definition_id        uuid NULL,
  value                    numeric(24,6) NULL,
  unit                     text NOT NULL CHECK (char_length(unit) BETWEEN 1 AND 50),
  currency                 char(3) NULL CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  source                   text NULL CHECK (source IS NULL OR char_length(source) BETWEEN 1 AND 1000),
  baseline_date            date NULL,
  scope                    text NOT NULL CHECK (scope IN ('revenue', 'cost', 'customer', 'operational', 'capability')),
  owner_user_id            uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  validation_status        text NOT NULL DEFAULT 'unvalidated' CHECK (validation_status IN ('unvalidated', 'validated', 'rejected')),
  validated_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  validated_at             timestamptz NULL,
  validation_note          text NULL CHECK (validation_note IS NULL OR char_length(validation_note) BETWEEN 1 AND 2000),
  validated_record_version integer NULL CHECK (validated_record_version IS NULL OR validated_record_version >= 1),
  status                   text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at              timestamptz NULL,
  archived_by              uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason           text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version                  integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT baseline_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT baseline_kpi_definition_id_fkey FOREIGN KEY (transformation_id, kpi_definition_id) REFERENCES kpi_definition (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT baseline_validation_complete CHECK ((validation_status = 'unvalidated') = (validated_by IS NULL) AND (validated_by IS NULL) = (validated_at IS NULL) AND (validated_at IS NULL) = (validated_record_version IS NULL)),
  CONSTRAINT baseline_validated_measurable CHECK (validation_status <> 'validated' OR (value IS NOT NULL AND source IS NOT NULL AND baseline_date IS NOT NULL)),
  CONSTRAINT baseline_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL) AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
CREATE INDEX baseline_transformation_updated_idx ON baseline (transformation_id, updated_at DESC, id DESC);
SELECT p2_attach_guards('baseline', true);
GRANT SELECT, INSERT, UPDATE ON baseline TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- outcome_kpi: T02 Outcome & KPI Tree row (B0050): outcome, KPI, baseline, target, target date, owner, leading indicator.
CREATE TABLE outcome_kpi (
  id                          uuid PRIMARY KEY,
  organization_id             uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id           uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  outcome_id                  uuid NOT NULL,
  kpi_definition_id           uuid NOT NULL,
  baseline_id                 uuid NULL,
  baseline_value              numeric(24,6) NULL,
  target_value                numeric(24,6) NULL,
  target_date                 date NOT NULL,
  owner_user_id               uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  leading_indicator_text      text NULL CHECK (leading_indicator_text IS NULL OR char_length(leading_indicator_text) BETWEEN 1 AND 1000),
  leading_kpi_definition_id   uuid NULL,
  ordinal                     integer NOT NULL DEFAULT 1 CHECK (ordinal >= 1),
  trajectory_points           jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(trajectory_points) = 'array' AND jsonb_array_length(trajectory_points) <= 120),
  trajectory_status           text NOT NULL DEFAULT 'draft' CHECK (trajectory_status IN ('draft', 'approved')),
  trajectory_approved_by      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  trajectory_approved_at      timestamptz NULL,
  trajectory_approved_version integer NULL CHECK (trajectory_approved_version IS NULL OR trajectory_approved_version >= 1),
  status                      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at                 timestamptz NULL,
  archived_by                 uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason              text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version                     integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT outcome_kpi_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT outcome_kpi_outcome_id_fkey FOREIGN KEY (transformation_id, outcome_id) REFERENCES outcome (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT outcome_kpi_kpi_definition_id_fkey FOREIGN KEY (transformation_id, kpi_definition_id) REFERENCES kpi_definition (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT outcome_kpi_baseline_id_fkey FOREIGN KEY (transformation_id, baseline_id) REFERENCES baseline (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT outcome_kpi_leading_kpi_definition_id_fkey FOREIGN KEY (transformation_id, leading_kpi_definition_id) REFERENCES kpi_definition (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT outcome_kpi_one_baseline_source CHECK (baseline_id IS NULL OR baseline_value IS NULL),
  CONSTRAINT outcome_kpi_trajectory_complete CHECK ((trajectory_status = 'approved') = (trajectory_approved_by IS NOT NULL) AND (trajectory_approved_by IS NULL) = (trajectory_approved_at IS NULL) AND (trajectory_approved_at IS NULL) = (trajectory_approved_version IS NULL) AND (trajectory_status <> 'approved' OR target_value IS NOT NULL)),
  CONSTRAINT outcome_kpi_approver_not_creator CHECK (trajectory_approved_by IS NULL OR trajectory_approved_by <> created_by),
  CONSTRAINT outcome_kpi_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL) AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
CREATE INDEX outcome_kpi_transformation_updated_idx ON outcome_kpi (transformation_id, updated_at DESC, id DESC);
CREATE INDEX outcome_kpi_outcome_idx ON outcome_kpi (outcome_id);
SELECT p2_attach_guards('outcome_kpi', true);
GRANT SELECT, INSERT, UPDATE ON outcome_kpi TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- value_pool: Value pool quantified by driver with upside/downside, or explicitly unquantified (REQ-PB-028, ADR-0019).
CREATE TABLE value_pool (
  id                       uuid PRIMARY KEY,
  organization_id          uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id        uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  name                     text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 300),
  driver                   text NULL CHECK (driver IS NULL OR char_length(driver) BETWEEN 1 AND 1000),
  workstream_code          text NULL REFERENCES diagnostic_workstream (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  quantification_status    text NOT NULL DEFAULT 'unquantified' CHECK (quantification_status IN ('quantified', 'unquantified')),
  upside_amount            numeric(20,4) NULL,
  downside_amount          numeric(20,4) NULL,
  currency                 char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  unquantified_reason      text NULL CHECK (unquantified_reason IS NULL OR char_length(unquantified_reason) BETWEEN 1 AND 2000),
  materiality              text NOT NULL DEFAULT 'not_assessed' CHECK (materiality IN ('material', 'not_material', 'not_assessed')),
  confidence               text NULL CHECK (confidence IS NULL OR confidence IN ('H', 'M', 'L')),
  owner_user_id            uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  validation_status        text NOT NULL DEFAULT 'unvalidated' CHECK (validation_status IN ('unvalidated', 'validated', 'rejected')),
  validated_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  validated_at             timestamptz NULL,
  validation_note          text NULL CHECK (validation_note IS NULL OR char_length(validation_note) BETWEEN 1 AND 2000),
  validated_record_version integer NULL CHECK (validated_record_version IS NULL OR validated_record_version >= 1),
  status                   text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at              timestamptz NULL,
  archived_by              uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason           text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version                  integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT value_pool_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT value_pool_quantification CHECK ((quantification_status = 'quantified' AND upside_amount IS NOT NULL AND downside_amount IS NOT NULL AND downside_amount <= upside_amount AND unquantified_reason IS NULL) OR (quantification_status = 'unquantified' AND upside_amount IS NULL AND downside_amount IS NULL)),
  CONSTRAINT value_pool_validation_complete CHECK ((validation_status = 'unvalidated') = (validated_by IS NULL) AND (validated_by IS NULL) = (validated_at IS NULL) AND (validated_at IS NULL) = (validated_record_version IS NULL)),
  CONSTRAINT value_pool_validated_quantified CHECK (validation_status <> 'validated' OR quantification_status = 'quantified'),
  CONSTRAINT value_pool_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL) AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
CREATE INDEX value_pool_transformation_updated_idx ON value_pool (transformation_id, updated_at DESC, id DESC);
CREATE INDEX value_pool_materiality_idx ON value_pool (transformation_id, materiality) WHERE status = 'active';
SELECT p2_attach_guards('value_pool', true);
GRANT SELECT, INSERT, UPDATE ON value_pool TO mth_app;
