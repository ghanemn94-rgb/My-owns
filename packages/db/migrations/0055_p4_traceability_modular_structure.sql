-- 0055 P4 slice K: traceability links with contribution and allocation rules, the traceability edge view, inherited
-- records of a Modular entry, and the portfolio and workstream structure (T-DG4-ARCH-08; ADR-0038; REQ-PB-005,
-- REQ-PB-010, REQ-PB-044, REQ-S03-001, REQ-S03-005, REQ-S03-006). Authored by solution-architect.
-- Contract: docs/architecture/data-dictionary.md ("P4 tables, slices J and K").
-- Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged.
-- SQL floor: PostgreSQL 16 (NULLS NOT DISTINCT is used). Nothing here approves anything: an inherited record is
-- provenance, never a gate decision (prior approvals stay gate_dispensation rows, ADR-0021 §5), and nothing touches
-- DG0-DG7.

-- Human-readable code WS-01, WS-02, ... per transformation.
ALTER TABLE record_code_counter DROP CONSTRAINT record_code_counter_prefix_check;
ALTER TABLE record_code_counter ADD CONSTRAINT record_code_counter_prefix_check
  CHECK (prefix IN ('D', 'DEC', 'GD', 'DEP', 'INI', 'BC', 'BF', 'B', 'BG', 'VM', 'R', 'A', 'I', 'CA', 'SG', 'AI',
                    'PA', 'HO', 'CTL', 'CI', 'LL', 'TD', 'CR', 'WS'));

-- -----------------------------------------------------------------------------------------------------------------
-- portfolio: an organization-level grouping of transformations (REQ-S03-001 "a transformation ... can sit in a
-- portfolio"). Not transformation-scoped: p2_row_guard checks only identity immutability and the version step here.
CREATE TABLE portfolio (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code            text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  name            text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 300),
  description     text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 4000),
  owner_user_id   uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at     timestamptz NULL,
  archived_by     uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason  text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version         integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT portfolio_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT portfolio_org_code_key UNIQUE (organization_id, code),
  CONSTRAINT portfolio_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL)
    AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
SELECT p2_attach_guards('portfolio', true);
GRANT SELECT, INSERT, UPDATE ON portfolio TO mth_app;

-- portfolio_transformation: membership. A transformation sits in at most one portfolio at a time (unique index on the
-- active rows); removal keeps the row (never deleted).
CREATE TABLE portfolio_transformation (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  portfolio_id      uuid NOT NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  removed_at        timestamptz NULL,
  removed_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  remove_reason     text NULL CHECK (remove_reason IS NULL OR char_length(remove_reason) BETWEEN 3 AND 1000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- The portfolio belongs to the same organization as the transformation (p2_row_guard checks the transformation side).
  CONSTRAINT portfolio_transformation_portfolio_fkey FOREIGN KEY (organization_id, portfolio_id)
    REFERENCES portfolio (organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT portfolio_transformation_removal_complete CHECK ((status = 'removed') = (removed_at IS NOT NULL)
    AND (removed_at IS NULL) = (removed_by IS NULL) AND (removed_at IS NULL) = (remove_reason IS NULL))
);
CREATE UNIQUE INDEX portfolio_transformation_one_active_key ON portfolio_transformation (transformation_id) WHERE status = 'active';
CREATE INDEX portfolio_transformation_portfolio_idx ON portfolio_transformation (portfolio_id) WHERE status = 'active';
SELECT p2_attach_guards('portfolio_transformation', true);
GRANT SELECT, INSERT, UPDATE ON portfolio_transformation TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- workstream: groups initiatives inside one transformation (REQ-S03-001 "workstreams group initiatives"; the scope of
-- the workstream dashboard, REQ-S13-001). Code WS-nn.
CREATE TABLE workstream (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code              text NOT NULL CHECK (code ~ '^WS-[0-9]{2,6}$'),
  name              text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 300),
  description       text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 4000),
  lead_user_id      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at       timestamptz NULL,
  archived_by       uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason    text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT workstream_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT workstream_code_key UNIQUE (transformation_id, code),
  CONSTRAINT workstream_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL)
    AND (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL))
);
SELECT p2_attach_guards('workstream', true);
GRANT SELECT, INSERT, UPDATE ON workstream TO mth_app;

-- workstream_initiative: an initiative belongs to at most one workstream at a time; both in the same transformation.
CREATE TABLE workstream_initiative (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  workstream_id     uuid NOT NULL,
  initiative_id     uuid NOT NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  removed_at        timestamptz NULL,
  removed_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  remove_reason     text NULL CHECK (remove_reason IS NULL OR char_length(remove_reason) BETWEEN 3 AND 1000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT workstream_initiative_workstream_fkey FOREIGN KEY (transformation_id, workstream_id)
    REFERENCES workstream (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT workstream_initiative_initiative_fkey FOREIGN KEY (transformation_id, initiative_id)
    REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT workstream_initiative_removal_complete CHECK ((status = 'removed') = (removed_at IS NOT NULL)
    AND (removed_at IS NULL) = (removed_by IS NULL) AND (removed_at IS NULL) = (remove_reason IS NULL))
);
CREATE UNIQUE INDEX workstream_initiative_one_active_key ON workstream_initiative (initiative_id) WHERE status = 'active';
CREATE INDEX workstream_initiative_workstream_idx ON workstream_initiative (workstream_id) WHERE status = 'active';
SELECT p2_attach_guards('workstream_initiative', true);
GRANT SELECT, INSERT, UPDATE ON workstream_initiative TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- trace_link: the chain steps of M0097 that no typed DG2-P4 table already records (REQ-S03-006, REQ-PB-044):
--   issue_gap              diagnostic_finding -> tom_gap        ("Diagnosed issue -> Target-state gap")
--   deliverable_capability deliverable        -> capability     ("Deliverable -> Capability change")
--   capability_kpi         capability         -> outcome_kpi    ("Capability change -> KPI movement")
--   kpi_benefit            outcome_kpi        -> benefit        ("KPI movement -> Benefit")
-- The other steps stay in their canonical tables (initiative_gap_link, deliverable.initiative_id,
-- initiative_outcome_contribution, benefit.measurement_kpi_definition_id, benefit_allocation); trace_link never copies
-- them. Each row states its contribution; a share (0 < share <= 1, a decimal fraction) is allowed only into a
-- value-bearing record (an outcome KPI or a benefit), and the shares into one record total at most 1 (the trigger
-- below, with initiative_outcome_contribution's shares).
CREATE TABLE trace_link (
  id                     uuid PRIMARY KEY,
  organization_id        uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id      uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  link_kind              text NOT NULL CHECK (link_kind IN ('issue_gap', 'deliverable_capability', 'capability_kpi', 'kpi_benefit')),
  diagnostic_finding_id  uuid NULL,
  tom_gap_id             uuid NULL,
  deliverable_id         uuid NULL,
  capability_id          uuid NULL,
  outcome_kpi_id         uuid NULL,
  benefit_id             uuid NULL,
  contribution_statement text NOT NULL CHECK (char_length(contribution_statement) BETWEEN 1 AND 2000),
  allocation_share       numeric(7,6) NULL CHECK (allocation_share IS NULL OR (allocation_share > 0 AND allocation_share <= 1)),
  allocation_basis       text NULL CHECK (allocation_basis IS NULL OR char_length(allocation_basis) BETWEEN 1 AND 1000),
  status                 text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  removed_at             timestamptz NULL,
  removed_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  remove_reason          text NULL CHECK (remove_reason IS NULL OR char_length(remove_reason) BETWEEN 3 AND 1000),
  version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT trace_link_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT trace_link_finding_fkey FOREIGN KEY (transformation_id, diagnostic_finding_id)
    REFERENCES diagnostic_finding (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT trace_link_tom_gap_fkey FOREIGN KEY (transformation_id, tom_gap_id)
    REFERENCES tom_gap (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT trace_link_deliverable_fkey FOREIGN KEY (transformation_id, deliverable_id)
    REFERENCES deliverable (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT trace_link_capability_fkey FOREIGN KEY (transformation_id, capability_id)
    REFERENCES capability (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT trace_link_outcome_kpi_fkey FOREIGN KEY (transformation_id, outcome_kpi_id)
    REFERENCES outcome_kpi (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT trace_link_benefit_fkey FOREIGN KEY (transformation_id, benefit_id)
    REFERENCES benefit (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- Exactly the two records the kind names, and no other.
  CONSTRAINT trace_link_kind_shape CHECK (
    (link_kind = 'issue_gap') = (diagnostic_finding_id IS NOT NULL)
    AND (link_kind = 'deliverable_capability') = (deliverable_id IS NOT NULL)
    AND (link_kind = 'kpi_benefit') = (benefit_id IS NOT NULL)
    AND (tom_gap_id IS NOT NULL) = (link_kind = 'issue_gap')
    AND (capability_id IS NOT NULL) = (link_kind IN ('deliverable_capability', 'capability_kpi'))
    AND (outcome_kpi_id IS NOT NULL) = (link_kind IN ('capability_kpi', 'kpi_benefit'))),
  -- A share only into a value-bearing record; a basis only with a share.
  CONSTRAINT trace_link_allocation_kind CHECK (allocation_share IS NULL OR link_kind IN ('capability_kpi', 'kpi_benefit')),
  CONSTRAINT trace_link_basis_needs_share CHECK (allocation_basis IS NULL OR allocation_share IS NOT NULL),
  CONSTRAINT trace_link_removal_complete CHECK ((status = 'removed') = (removed_at IS NOT NULL)
    AND (removed_at IS NULL) = (removed_by IS NULL) AND (removed_at IS NULL) = (remove_reason IS NULL))
);
-- One active link per (kind, from, to).
CREATE UNIQUE INDEX trace_link_one_active_key ON trace_link
  (transformation_id, link_kind, diagnostic_finding_id, tom_gap_id, deliverable_id, capability_id, outcome_kpi_id, benefit_id)
  NULLS NOT DISTINCT WHERE status = 'active';
CREATE INDEX trace_link_outcome_kpi_idx ON trace_link (outcome_kpi_id) WHERE status = 'active';
CREATE INDEX trace_link_benefit_idx ON trace_link (benefit_id) WHERE status = 'active';
SELECT p2_attach_guards('trace_link', true);
GRANT SELECT, INSERT, UPDATE ON trace_link TO mth_app;

-- The DG3 initiative -> outcome/KPI contribution (T05 "Outcome/KPI contribution") gains an optional share of the KPI
-- movement it is credited with. Additive: NULL on every existing row, and the DG3 routes never write it (the P4
-- operation setOutcomeContributionAllocation does, with If-Match and an audit event).
ALTER TABLE initiative_outcome_contribution
  ADD COLUMN allocation_share numeric(7,6) NULL
    CONSTRAINT initiative_outcome_contribution_allocation_share_check CHECK (allocation_share IS NULL OR (allocation_share > 0 AND allocation_share <= 1)),
  ADD COLUMN allocation_basis text NULL
    CONSTRAINT initiative_outcome_contribution_allocation_basis_check CHECK (allocation_basis IS NULL OR char_length(allocation_basis) BETWEEN 1 AND 1000),
  -- A share is a share of a KPI movement, so it needs the T02 row; a basis only with a share.
  ADD CONSTRAINT initiative_outcome_contribution_allocation_needs_kpi CHECK (allocation_share IS NULL OR outcome_kpi_id IS NOT NULL),
  ADD CONSTRAINT initiative_outcome_contribution_basis_needs_share CHECK (allocation_basis IS NULL OR allocation_share IS NOT NULL);

-- The allocation set of one target record: every ACTIVE link into it that carries a share. Into an outcome KPI these
-- are trace_link capability_kpi rows and initiative_outcome_contribution rows; into a benefit, trace_link kpi_benefit
-- rows (benefit -> initiative shares stay benefit_allocation's own 100 % rule, 0037). The total may not exceed 1
-- (100 %); below 1 the rest is shown as unallocated by the read model. Serialized per target by advisory-lock class
-- 730249 (ADR-0016 §6), which the API takes first with the same key.
CREATE FUNCTION trace_allocation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  trace_allocation_lock_class CONSTANT integer := 730249;
  n jsonb := to_jsonb(NEW);
  target_kpi uuid;
  target_benefit uuid;
  total numeric;
BEGIN
  IF NEW.status <> 'active' OR NEW.allocation_share IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'trace_link' AND n->>'link_kind' = 'kpi_benefit' THEN
    target_benefit := (n->>'benefit_id')::uuid;
  ELSE
    target_kpi := (n->>'outcome_kpi_id')::uuid;
  END IF;
  PERFORM pg_advisory_xact_lock(trace_allocation_lock_class, hashtext(coalesce(target_kpi, target_benefit)::text));
  IF target_kpi IS NOT NULL THEN
    SELECT coalesce(sum(s), 0) INTO total FROM (
      SELECT t.allocation_share AS s FROM trace_link t
       WHERE t.outcome_kpi_id = target_kpi AND t.link_kind = 'capability_kpi' AND t.status = 'active'
         AND t.allocation_share IS NOT NULL AND NOT (TG_TABLE_NAME = 'trace_link' AND t.id = NEW.id)
      UNION ALL
      SELECT c.allocation_share FROM initiative_outcome_contribution c
       WHERE c.outcome_kpi_id = target_kpi AND c.status = 'active' AND c.allocation_share IS NOT NULL
         AND NOT (TG_TABLE_NAME = 'initiative_outcome_contribution' AND c.id = NEW.id)) x;
  ELSE
    SELECT coalesce(sum(t.allocation_share), 0) INTO total FROM trace_link t
     WHERE t.benefit_id = target_benefit AND t.link_kind = 'kpi_benefit' AND t.status = 'active'
       AND t.allocation_share IS NOT NULL AND t.id <> NEW.id;
  END IF;
  IF total + NEW.allocation_share > 1 THEN
    RAISE EXCEPTION '%: the allocation set of % would total % (more than 1, i.e. 100 %%)', TG_TABLE_NAME,
      coalesce(target_kpi, target_benefit), total + NEW.allocation_share
      USING ERRCODE = 'check_violation', CONSTRAINT = 'trace_allocation_total';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trace_link_allocation_guard BEFORE INSERT OR UPDATE ON trace_link
  FOR EACH ROW EXECUTE FUNCTION trace_allocation_guard();
CREATE TRIGGER initiative_outcome_contribution_allocation_guard BEFORE INSERT OR UPDATE ON initiative_outcome_contribution
  FOR EACH ROW EXECUTE FUNCTION trace_allocation_guard();

-- -----------------------------------------------------------------------------------------------------------------
-- inherited_record: inherited evidence and inherited baselines of a Modular entry, labelled with their provenance
-- (REQ-S03-005; M0095 "Capture inherited evidence, baseline and approvals"). The canonical evidence or baseline row is
-- referenced, never copied. Prior approvals are NOT stored here: they stay gate_dispensation rows of kind
-- 'inherited_approval' (ADR-0021 §5), which never create a gate_decision. Only a Modular transformation takes rows.
CREATE TABLE inherited_record (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id    uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kind                 text NOT NULL CHECK (kind IN ('evidence', 'baseline')),
  evidence_id          uuid NULL,
  baseline_id          uuid NULL,
  source_description   text NOT NULL CHECK (char_length(source_description) BETWEEN 3 AND 2000),
  original_owner       text NULL CHECK (original_owner IS NULL OR char_length(original_owner) BETWEEN 1 AND 300),
  original_date        date NULL,
  recorded_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
  withdrawn_at         timestamptz NULL,
  withdrawn_by         uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  withdraw_reason      text NULL CHECK (withdraw_reason IS NULL OR char_length(withdraw_reason) BETWEEN 3 AND 1000),
  version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inherited_record_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT inherited_record_evidence_fkey FOREIGN KEY (transformation_id, evidence_id)
    REFERENCES evidence (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inherited_record_baseline_fkey FOREIGN KEY (transformation_id, baseline_id)
    REFERENCES baseline (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inherited_record_kind_shape CHECK ((kind = 'evidence') = (evidence_id IS NOT NULL)
    AND (kind = 'baseline') = (baseline_id IS NOT NULL)),
  CONSTRAINT inherited_record_withdrawal_complete CHECK ((status = 'withdrawn') = (withdrawn_at IS NOT NULL)
    AND (withdrawn_at IS NULL) = (withdrawn_by IS NULL) AND (withdrawn_at IS NULL) = (withdraw_reason IS NULL))
);
CREATE UNIQUE INDEX inherited_record_one_active_key ON inherited_record (transformation_id, kind, evidence_id, baseline_id)
  NULLS NOT DISTINCT WHERE status = 'active';
SELECT p2_attach_guards('inherited_record', true);
GRANT SELECT, INSERT, UPDATE ON inherited_record TO mth_app;

CREATE FUNCTION inherited_record_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  m text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT t.mode INTO m FROM transformation t WHERE t.id = NEW.transformation_id;
    IF m IS DISTINCT FROM 'modular' THEN
      RAISE EXCEPTION 'inherited_record: only a Modular transformation records inherited items'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'inherited_record_modular_only';
    END IF;
    IF NEW.status <> 'active' THEN
      RAISE EXCEPTION 'inherited_record: a new row starts active'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'inherited_record_starts_active';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: only the withdrawal (active -> withdrawn) is allowed; the provenance columns are immutable.
  IF OLD.status <> 'active' OR NEW.status <> 'withdrawn'
     OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.evidence_id IS DISTINCT FROM OLD.evidence_id
     OR NEW.baseline_id IS DISTINCT FROM OLD.baseline_id OR NEW.source_description IS DISTINCT FROM OLD.source_description
     OR NEW.original_owner IS DISTINCT FROM OLD.original_owner OR NEW.original_date IS DISTINCT FROM OLD.original_date
     OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by THEN
    RAISE EXCEPTION 'inherited_record: provenance is immutable; the only change is a withdrawal of an active row'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'inherited_record_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inherited_record_guard BEFORE INSERT OR UPDATE ON inherited_record
  FOR EACH ROW EXECUTE FUNCTION inherited_record_guard();

-- -----------------------------------------------------------------------------------------------------------------
-- traceability_edge: ONE read model of every active chain edge (REQ-PB-044, REQ-S03-006, REQ-PB-010), defined here for
-- the reporting read models (ADR-0002 rule 4: "Reporting read models may use SQL views"). Each branch reads one
-- canonical table; no row is copied. Node types: diagnostic_finding, tom_gap, initiative, deliverable, capability,
-- outcome, outcome_kpi, benefit. Removed links, archived deliverables and archived/inactive outcome KPIs are left out.
CREATE VIEW traceability_edge AS
SELECT l.organization_id, l.transformation_id, 'issue_gap'::text AS edge_kind,
       'diagnostic_finding'::text AS from_type, l.diagnostic_finding_id AS from_id, 'tom_gap'::text AS to_type, l.tom_gap_id AS to_id,
       'trace_link'::text AS link_table, l.id AS link_id, l.contribution_statement, NULL::numeric AS allocation_share
FROM trace_link l WHERE l.status = 'active' AND l.link_kind = 'issue_gap'
UNION ALL
SELECT g.organization_id, g.transformation_id, 'gap_initiative', g.target_type, coalesce(g.tom_gap_id, g.diagnostic_finding_id),
       'initiative', g.initiative_id, 'initiative_gap_link', g.id, NULL::text, NULL::numeric
FROM initiative_gap_link g WHERE g.status = 'active'
UNION ALL
SELECT d.organization_id, d.transformation_id, 'initiative_deliverable', 'initiative', d.initiative_id,
       'deliverable', d.id, 'deliverable', d.id, NULL::text, NULL::numeric
FROM deliverable d WHERE d.status = 'active'
UNION ALL
SELECT l.organization_id, l.transformation_id, 'deliverable_capability', 'deliverable', l.deliverable_id,
       'capability', l.capability_id, 'trace_link', l.id, l.contribution_statement, NULL::numeric
FROM trace_link l WHERE l.status = 'active' AND l.link_kind = 'deliverable_capability'
UNION ALL
SELECT l.organization_id, l.transformation_id, 'capability_kpi', 'capability', l.capability_id,
       'outcome_kpi', l.outcome_kpi_id, 'trace_link', l.id, l.contribution_statement, l.allocation_share
FROM trace_link l WHERE l.status = 'active' AND l.link_kind = 'capability_kpi'
UNION ALL
SELECT c.organization_id, c.transformation_id, 'initiative_kpi', 'initiative', c.initiative_id,
       CASE WHEN c.outcome_kpi_id IS NULL THEN 'outcome' ELSE 'outcome_kpi' END, coalesce(c.outcome_kpi_id, c.outcome_id),
       'initiative_outcome_contribution', c.id, c.contribution_statement, c.allocation_share
FROM initiative_outcome_contribution c WHERE c.status = 'active'
UNION ALL
SELECT k.organization_id, k.transformation_id, 'outcome_kpi_of', 'outcome', k.outcome_id,
       'outcome_kpi', k.id, 'outcome_kpi', k.id, NULL::text, NULL::numeric
FROM outcome_kpi k WHERE k.status = 'active'
UNION ALL
SELECT l.organization_id, l.transformation_id, 'kpi_benefit', 'outcome_kpi', l.outcome_kpi_id,
       'benefit', l.benefit_id, 'trace_link', l.id, l.contribution_statement, l.allocation_share
FROM trace_link l WHERE l.status = 'active' AND l.link_kind = 'kpi_benefit'
UNION ALL
SELECT b.organization_id, b.transformation_id, 'kpi_benefit_measure', 'outcome_kpi', k.id,
       'benefit', b.id, 'benefit', b.id, NULL::text, NULL::numeric
FROM benefit b JOIN outcome_kpi k ON k.transformation_id = b.transformation_id AND k.kpi_definition_id = b.measurement_kpi_definition_id
WHERE b.status = 'active' AND k.status = 'active'
UNION ALL
SELECT a.organization_id, a.transformation_id, 'initiative_benefit', 'initiative', a.initiative_id,
       'benefit', a.benefit_id, 'benefit_allocation', a.id, a.basis, a.share
FROM benefit_allocation a JOIN benefit b ON b.id = a.benefit_id AND b.allocation_set_no = a.set_no
WHERE b.status = 'active';
GRANT SELECT ON traceability_edge TO mth_app;
