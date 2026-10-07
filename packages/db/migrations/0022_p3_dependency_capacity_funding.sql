-- 0022 P3 dependency map (T08) on the canonical dependency record, race-free cycle guard, resource capacity and demand,
-- portfolio selection and funding decisions (T-DG3-ARCH-01; ADR-0023, ADR-0021). Authored by solution-architect.
-- Contract: docs/architecture/data-dictionary.md ("P3" section). Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16. Decimal only (numeric).

-- -----------------------------------------------------------------------------------------------------------------
-- dependency_type: T08 types (B0081): the four source types and 'other' are system rows that cannot be deleted or
-- retired; methodology admins add types. Global catalogue (one deployment = one organization in P3).
CREATE TABLE dependency_type (
  id         uuid PRIMARY KEY,
  code       text NOT NULL CONSTRAINT dependency_type_code_key UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{1,47}$'),
  label_en   text NOT NULL CHECK (char_length(label_en) BETWEEN 1 AND 100),
  label_ar   text NOT NULL CHECK (char_length(label_ar) BETWEEN 1 AND 100),
  is_system  boolean NOT NULL DEFAULT false,
  source_ref text NULL CHECK (source_ref IS NULL OR char_length(source_ref) BETWEEN 1 AND 50),
  ordinal    smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 999),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  version    integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT dependency_type_system_active CHECK (NOT is_system OR status = 'active')
);
-- Seed (B0081 "Decision / Tech / Data / Vendor"; 'other' keeps DG2 rows valid). Arabic is a PROVISIONAL translation.
INSERT INTO dependency_type (id, code, label_en, label_ar, is_system, source_ref, ordinal) VALUES
  ('01920003-0001-7000-8000-000000000001', 'decision', 'Decision', 'قرار', true, 'B0081', 1),
  ('01920003-0001-7000-8000-000000000002', 'tech', 'Tech', 'تقنية', true, 'B0081', 2),
  ('01920003-0001-7000-8000-000000000003', 'data', 'Data', 'بيانات', true, 'B0081', 3),
  ('01920003-0001-7000-8000-000000000004', 'vendor', 'Vendor', 'مورّد', true, 'B0081', 4),
  ('01920003-0001-7000-8000-000000000005', 'other', 'Other', 'أخرى', true, 'M0136', 5);
-- System rows: never deleted, retired, renamed in code or demoted. No row is ever deleted (custom types retire).
CREATE FUNCTION dependency_type_system_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'dependency_type %: types are never deleted (system types are permanent, custom types retire)', OLD.code
      USING ERRCODE = 'check_violation', CONSTRAINT = 'dependency_type_system_undeletable';
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code OR (OLD.is_system AND (NEW.is_system IS DISTINCT FROM OLD.is_system OR NEW.status <> 'active'))
     OR (NOT OLD.is_system AND NEW.is_system) THEN
    RAISE EXCEPTION 'dependency_type %: the code and system flag are immutable and a system type cannot be retired', OLD.code
      USING ERRCODE = 'check_violation', CONSTRAINT = 'dependency_type_system_undeletable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dependency_type_system_guard BEFORE UPDATE OR DELETE ON dependency_type
  FOR EACH ROW EXECUTE FUNCTION dependency_type_system_guard();
CREATE TRIGGER dependency_type_no_truncate BEFORE TRUNCATE ON dependency_type
  FOR EACH STATEMENT EXECUTE FUNCTION p2_append_only();
SELECT p2_attach_guards('dependency_type', true);
GRANT SELECT, INSERT, UPDATE ON dependency_type TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- dependency (DG2 0017, canonical, shared by T08 and RAID): P3 adds initiative endpoints and configurable types.
-- Compatible extension: existing rows keep every value; the five DG2 type codes are system rows above.
ALTER TABLE dependency DROP CONSTRAINT dependency_dependency_type_check;
ALTER TABLE dependency
  ADD COLUMN from_initiative_id uuid NULL,
  ADD COLUMN to_initiative_id   uuid NULL,
  ADD CONSTRAINT dependency_dependency_type_fkey FOREIGN KEY (dependency_type) REFERENCES dependency_type (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT dependency_from_initiative_id_fkey FOREIGN KEY (transformation_id, from_initiative_id) REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT dependency_to_initiative_id_fkey FOREIGN KEY (transformation_id, to_initiative_id) REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT dependency_from_initiative_kind CHECK (from_initiative_id IS NULL OR from_kind = 'initiative'),
  ADD CONSTRAINT dependency_to_initiative_kind CHECK (to_initiative_id IS NULL OR to_kind = 'initiative'),
  ADD CONSTRAINT dependency_not_self CHECK (from_initiative_id IS NULL OR from_initiative_id IS DISTINCT FROM to_initiative_id);
CREATE INDEX dependency_from_initiative_idx ON dependency (transformation_id, from_initiative_id) WHERE from_initiative_id IS NOT NULL AND status <> 'archived';
CREATE INDEX dependency_to_initiative_idx ON dependency (transformation_id, to_initiative_id) WHERE to_initiative_id IS NOT NULL AND status <> 'archived';

-- A new or changed type must be an active one (a retired custom type stays on old rows only).
CREATE FUNCTION dependency_type_active() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.dependency_type IS DISTINCT FROM OLD.dependency_type)
     AND NOT EXISTS (SELECT 1 FROM dependency_type t WHERE t.code = NEW.dependency_type AND t.status = 'active') THEN
    RAISE EXCEPTION 'dependency %: unknown or retired dependency type %', NEW.id, NEW.dependency_type
      USING ERRCODE = 'check_violation', CONSTRAINT = 'dependency_type_active';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dependency_type_active BEFORE INSERT OR UPDATE OF dependency_type ON dependency
  FOR EACH ROW EXECUTE FUNCTION dependency_type_active();

-- REQ-S09-008 / REQ-PB-051: the initiative graph (from -> to, non-archived) stays acyclic, race-free (F-DG1-140 pattern):
--  1. SERIALIZE per transformation with the transaction-scoped advisory lock (730221, hashtext(transformation_id)); the
--     API takes the SAME lock (portfolio DEPENDENCY_GRAPH_LOCK_CLASS) before its own friendly check.
--  2. RE-CHECK after the row is written (AFTER ROW) and after the lock is held: under READ COMMITTED every query takes
--     a fresh snapshot and sees what the previous lock holder committed. Under REPEATABLE READ / SERIALIZABLE the
--     snapshot may predate the lock, so the guard refuses to run there (40001): it fails closed.
--  3. Breadth-first search from to_initiative_id; reaching from_initiative_id closes a cycle, reported with initiative
--     codes as "dependency cycle: INI-01 -> INI-02 -> INI-01" (SQLSTATE 23514, constraint dependency_acyclic).
CREATE FUNCTION dependency_cycle_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  graph_lock_class CONSTANT integer := 730221;
  visited uuid[];
  parents uuid[];
  frontier uuid[];
  next_frontier uuid[];
  e record;
  found_cycle boolean := false;
  cur uuid;
  chain uuid[];
  path_text text;
BEGIN
  IF NEW.from_initiative_id IS NULL OR NEW.to_initiative_id IS NULL OR NEW.status = 'archived' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.from_initiative_id IS NOT DISTINCT FROM OLD.from_initiative_id
     AND NEW.to_initiative_id IS NOT DISTINCT FROM OLD.to_initiative_id AND OLD.status <> 'archived' THEN
    RETURN NULL;
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'dependency graph changes require READ COMMITTED isolation (dependency_cycle_guard)'
      USING ERRCODE = 'serialization_failure';
  END IF;

  PERFORM pg_advisory_xact_lock(graph_lock_class, hashtext(NEW.transformation_id::text));

  visited := ARRAY[NEW.to_initiative_id];
  parents := ARRAY[NULL::uuid];
  frontier := ARRAY[NEW.to_initiative_id];
  WHILE cardinality(frontier) > 0 AND NOT found_cycle LOOP
    next_frontier := ARRAY[]::uuid[];
    FOR e IN SELECT d.from_initiative_id AS f, d.to_initiative_id AS t
             FROM dependency d
             WHERE d.transformation_id = NEW.transformation_id AND d.status <> 'archived' AND d.id <> NEW.id
               AND d.from_initiative_id = ANY (frontier) AND d.to_initiative_id IS NOT NULL
             ORDER BY d.from_initiative_id, d.to_initiative_id LOOP
      CONTINUE WHEN e.t = ANY (visited);
      visited := visited || e.t;
      parents := parents || e.f;
      IF e.t = NEW.from_initiative_id THEN
        found_cycle := true;
        EXIT;
      END IF;
      next_frontier := next_frontier || e.t;
    END LOOP;
    frontier := next_frontier;
  END LOOP;

  IF found_cycle THEN
    -- Walk the parents back from `from` to `to`, then prepend `from`: from -> to -> ... -> from.
    chain := ARRAY[NEW.from_initiative_id];
    cur := NEW.from_initiative_id;
    WHILE cur IS DISTINCT FROM NEW.to_initiative_id LOOP
      cur := parents[array_position(visited, cur)];
      chain := cur || chain;
    END LOOP;
    chain := NEW.from_initiative_id || chain;
    SELECT string_agg(i.code, ' -> ' ORDER BY c.ord) INTO path_text
    FROM unnest(chain) WITH ORDINALITY AS c(id, ord) JOIN initiative i ON i.id = c.id;
    RAISE EXCEPTION 'dependency cycle: %', path_text
      USING ERRCODE = 'check_violation', CONSTRAINT = 'dependency_acyclic', TABLE = 'dependency',
            DETAIL = array_to_string(chain, ',');
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER dependency_cycle_guard
  AFTER INSERT OR UPDATE OF from_initiative_id, to_initiative_id, status ON dependency
  FOR EACH ROW EXECUTE FUNCTION dependency_cycle_guard();
COMMENT ON FUNCTION dependency_cycle_guard() IS
  'REQ-S09-008: refuses a dependency row that closes a cycle in the initiative graph; serialized per transformation by an advisory lock shared with the API (F-DG1-140 pattern).';

-- -----------------------------------------------------------------------------------------------------------------
-- resource_role: resourcing roles of one transformation ("Data engineer"); not access roles.
CREATE TABLE resource_role (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code              text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{0,47}$'),
  label_en          text NOT NULL CHECK (char_length(label_en) BETWEEN 1 AND 200),
  label_ar          text NOT NULL CHECK (char_length(label_ar) BETWEEN 1 AND 200),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT resource_role_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT resource_role_code_key UNIQUE (transformation_id, code)
);
SELECT p2_attach_guards('resource_role', true);
GRANT SELECT, INSERT, UPDATE ON resource_role TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- capacity: available FTE of one resourcing role in one month (REQ-PB-059).
CREATE TABLE capacity (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  resource_role_id  uuid NOT NULL,
  period_month      date NOT NULL CHECK (extract(day FROM period_month) = 1),
  available_fte     numeric(6,2) NOT NULL CHECK (available_fte >= 0),
  owner_user_id     uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  note              text NULL CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT capacity_resource_role_id_fkey FOREIGN KEY (transformation_id, resource_role_id) REFERENCES resource_role (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX capacity_role_month_active_key ON capacity (resource_role_id, period_month) WHERE status = 'active';
CREATE INDEX capacity_transformation_month_idx ON capacity (transformation_id, period_month);
SELECT p2_attach_guards('capacity', true);
GRANT SELECT, INSERT, UPDATE ON capacity TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- resource_demand: FTE an initiative needs from a role in a month; 'committed' is the capacity commitment G4 needs.
CREATE TABLE resource_demand (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  initiative_id     uuid NOT NULL,
  resource_role_id  uuid NOT NULL,
  period_month      date NOT NULL CHECK (extract(day FROM period_month) = 1),
  demand_fte        numeric(6,2) NOT NULL CHECK (demand_fte > 0),
  owner_user_id     uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  note              text NULL CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000),
  status            text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'committed', 'released', 'archived')),
  committed_by      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  committed_at      timestamptz NULL,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT resource_demand_initiative_id_fkey FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT resource_demand_resource_role_id_fkey FOREIGN KEY (transformation_id, resource_role_id) REFERENCES resource_role (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT resource_demand_committed_complete CHECK ((committed_at IS NULL) = (committed_by IS NULL) AND (status <> 'committed' OR committed_at IS NOT NULL))
);
CREATE INDEX resource_demand_role_month_idx ON resource_demand (resource_role_id, period_month) WHERE status IN ('planned', 'committed');
CREATE INDEX resource_demand_initiative_idx ON resource_demand (initiative_id);
SELECT p2_attach_guards('resource_demand', true);
GRANT SELECT, INSERT, UPDATE ON resource_demand TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- portfolio_selection: the approved portfolio selection decisions (REQ-S09-003), append-only; latest row decides.
CREATE TABLE portfolio_selection (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id    uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  initiative_id        uuid NOT NULL,
  action               text NOT NULL CHECK (action IN ('selected', 'deselected')),
  rationale            text NOT NULL CHECK (char_length(rationale) BETWEEN 3 AND 4000),
  ranking_snapshot_id  uuid NULL,
  decided_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  on_behalf_of_user_id uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portfolio_selection_initiative_id_fkey FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT portfolio_selection_ranking_snapshot_id_fkey FOREIGN KEY (transformation_id, ranking_snapshot_id) REFERENCES ranking_snapshot (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT portfolio_selection_selected_from_ranking CHECK (action <> 'selected' OR ranking_snapshot_id IS NOT NULL)
);
CREATE INDEX portfolio_selection_initiative_idx ON portfolio_selection (initiative_id, decided_at DESC, id DESC);
SELECT p2_attach_append_only('portfolio_selection');
SELECT p2_attach_guards('portfolio_selection', true);
GRANT SELECT, INSERT ON portfolio_selection TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- funding_decision: a recorded human funding decision (business approval) for one initiative, specialising a canonical
-- decision row of kind 'executive' (one decision model, ADR-0015). Append-only; latest row decides.
CREATE TABLE funding_decision (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id    uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  initiative_id        uuid NOT NULL,
  decision_id          uuid NOT NULL CONSTRAINT funding_decision_decision_id_key UNIQUE,
  decision_kind        text NOT NULL DEFAULT 'executive' CHECK (decision_kind = 'executive'),
  outcome              text NOT NULL CHECK (outcome IN ('approved', 'rejected', 'deferred', 'revoked')),
  amount               numeric(20,4) NULL CHECK (amount IS NULL OR amount >= 0),
  currency             char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  funding_source       text NULL CHECK (funding_source IS NULL OR char_length(funding_source) BETWEEN 1 AND 300),
  conditions           text NULL CHECK (conditions IS NULL OR char_length(conditions) BETWEEN 1 AND 4000),
  rationale            text NOT NULL CHECK (char_length(rationale) BETWEEN 3 AND 8000),
  business_case_id     uuid NULL,
  approver_role_code   text NOT NULL REFERENCES role (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  on_behalf_of_user_id uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT funding_decision_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT funding_decision_initiative_id_fkey FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT funding_decision_decision_fkey FOREIGN KEY (decision_id, decision_kind) REFERENCES decision (id, kind) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX funding_decision_initiative_idx ON funding_decision (initiative_id, decided_at DESC, id DESC);
SELECT p2_attach_append_only('funding_decision');
SELECT p2_attach_guards('funding_decision', true);
GRANT SELECT, INSERT ON funding_decision TO mth_app;
