-- 0002 transformation records (T-DG1-BE). Contract: docs/architecture/data-dictionary.md "transformation".
-- Status transitions, archived read-only and "mode = end_to_end starts in diagnose" are enforced in the API;
-- the constraints below are the last line of defence (REQ-S19-004).

CREATE TABLE transformation (
  id                          uuid PRIMARY KEY,
  organization_id             uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  business_unit_id            uuid NOT NULL,
  code                        text NOT NULL CONSTRAINT transformation_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  name                        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description                 text NULL CHECK (description IS NULL OR char_length(description) <= 4000),
  mode                        text NOT NULL CHECK (mode IN ('end_to_end', 'modular')),
  entry_phase                 text NULL CHECK (entry_phase IS NULL OR entry_phase IN ('diagnose', 'define', 'design', 'mobilize', 'transform', 'realize')),
  standalone_deliverable_type text NULL CHECK (standalone_deliverable_type IS NULL OR standalone_deliverable_type IN
                                ('target_operating_model', 'initiative_business_case', 'benefits_register')),
  status                      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'on_hold', 'closed')),
  current_phase               text NOT NULL CHECK (current_phase IN ('diagnose', 'define', 'design', 'mobilize', 'transform', 'realize')),
  sponsor_user_id             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  lead_user_id                uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  timezone                    text NOT NULL CHECK (char_length(timezone) BETWEEN 1 AND 64),
  currency                    char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  archived_at                 timestamptz NULL,
  archived_by                 uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason              text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version                     integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT transformation_org_code_key UNIQUE (organization_id, code),
  CONSTRAINT transformation_bu_same_org_fkey FOREIGN KEY (organization_id, business_unit_id)
    REFERENCES business_unit (organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT transformation_modular_entry_phase CHECK ((mode = 'modular') = (entry_phase IS NOT NULL)),
  CONSTRAINT transformation_standalone_only_modular CHECK (mode = 'modular' OR standalone_deliverable_type IS NULL),
  CONSTRAINT transformation_archive_complete CHECK (
    (archived_at IS NULL) = (archive_reason IS NULL) AND (archived_at IS NULL) = (archived_by IS NULL))
);
CREATE INDEX transformation_org_updated_idx ON transformation (organization_id, updated_at DESC, id DESC);
CREATE INDEX transformation_bu_idx ON transformation (business_unit_id);
CREATE INDEX transformation_org_status_live_idx ON transformation (organization_id, status) WHERE archived_at IS NULL;
CREATE INDEX transformation_org_name_idx ON transformation (organization_id, lower(name));

GRANT SELECT, INSERT, UPDATE ON transformation TO mth_app;

-- Scope hierarchy read model for the single policy function (ADR-0006). One row per scope node that a
-- scoped_assignment can point at in P1: (level, id) -> organization and, below the organization, business unit.
-- Owned by the access module; later stages add portfolio/workstream/initiative/... rows with a forward migration.
CREATE VIEW scope_node AS
  SELECT 'organization'::text AS scope_type, o.id AS scope_id, o.id AS organization_id,
         NULL::uuid AS business_unit_id, NULL::uuid AS transformation_id
  FROM organization o
  UNION ALL
  SELECT 'business_unit', b.id, b.organization_id, b.id, NULL::uuid
  FROM business_unit b
  UNION ALL
  SELECT 'transformation', t.id, t.organization_id, t.business_unit_id, t.id
  FROM transformation t;

GRANT SELECT ON scope_node TO mth_app;
