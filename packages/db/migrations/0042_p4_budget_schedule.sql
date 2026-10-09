-- 0042 P4 slice E: execution tracking - initiative budget lines (budget / actual / forecast in decimal money with a
-- per-row currency) and initiative durations, the input of the critical-path computation over the canonical dependency
-- graph (T-DG4-ARCH-04; ADR-0031 §7-§8; REQ-S09-007, REQ-S09-009). Authored by solution-architect.
-- Contract: docs/architecture/data-dictionary.md ("P4 tables, slice E"). Runs as mth_owner inside one transaction
-- opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16. Decimal only (numeric).

-- -----------------------------------------------------------------------------------------------------------------
-- budget_line: one budget line of an initiative (REQ-S09-007 "budget/actual/forecast use decimal SAR"). Each amount is
-- NULL when not yet known (shown as Unknown, never 0). Amounts are never converted between currencies; the currency is
-- copied from the organization default at creation (ADR-0025 §2, S-5) and is immutable.
CREATE TABLE budget_line (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  initiative_id     uuid NOT NULL,
  label             text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  period_month      date NULL CHECK (period_month IS NULL OR extract(day FROM period_month) = 1),
  currency          char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  budget_amount     numeric(20,4) NULL CHECK (budget_amount IS NULL OR budget_amount >= 0),
  actual_amount     numeric(20,4) NULL CHECK (actual_amount IS NULL OR actual_amount >= 0),
  forecast_amount   numeric(20,4) NULL CHECK (forecast_amount IS NULL OR forecast_amount >= 0),
  owner_user_id     uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  note              text NULL CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at       timestamptz NULL,
  archived_by       uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  archive_reason    text NULL CHECK (archive_reason IS NULL OR char_length(archive_reason) BETWEEN 3 AND 1000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT budget_line_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT budget_line_initiative_id_fkey FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT budget_line_archive_complete CHECK ((status = 'archived') = (archived_at IS NOT NULL)
                                                 AND (archived_at IS NULL) = (archived_by IS NULL)
                                                 AND (archived_at IS NULL) = (archive_reason IS NULL))
);
-- One active line per initiative, label (case-insensitive) and month (or whole-initiative line).
CREATE UNIQUE INDEX budget_line_active_key ON budget_line (initiative_id, lower(label), coalesce(period_month, DATE '0001-01-01'))
  WHERE status = 'active';
CREATE INDEX budget_line_initiative_idx ON budget_line (initiative_id, period_month NULLS FIRST, id) WHERE status = 'active';
-- The currency never changes, an archived line is frozen, and archiving is final.
CREATE FUNCTION budget_line_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.status = 'archived' THEN
    RAISE EXCEPTION 'budget_line %: an archived budget line is frozen', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'budget_line_archived_frozen';
  END IF;
  IF NEW.currency IS DISTINCT FROM OLD.currency OR NEW.initiative_id IS DISTINCT FROM OLD.initiative_id THEN
    RAISE EXCEPTION 'budget_line %: the currency and initiative are immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'budget_line_currency_locked';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER budget_line_guard BEFORE UPDATE ON budget_line FOR EACH ROW EXECUTE FUNCTION budget_line_guard();
SELECT p2_attach_guards('budget_line', true);
GRANT SELECT, INSERT, UPDATE ON budget_line TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- initiative_schedule: the planned duration of an initiative in WORKING days (the scheduling input of REQ-S09-009).
-- NULL duration = missing input: no critical path is claimed while any network node lacks one (ADR-0031 §8).
CREATE TABLE initiative_schedule (
  id                    uuid PRIMARY KEY,
  organization_id       uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id     uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  initiative_id         uuid NOT NULL,
  duration_working_days integer NULL CHECK (duration_working_days IS NULL OR duration_working_days BETWEEN 0 AND 2600),
  note                  text NULL CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000),
  version               integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT initiative_schedule_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT initiative_schedule_initiative_key UNIQUE (initiative_id),
  CONSTRAINT initiative_schedule_initiative_id_fkey FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE FUNCTION initiative_schedule_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.initiative_id IS DISTINCT FROM OLD.initiative_id THEN
    RAISE EXCEPTION 'initiative_schedule %: the initiative is immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'initiative_schedule_initiative_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER initiative_schedule_guard BEFORE UPDATE ON initiative_schedule
  FOR EACH ROW EXECUTE FUNCTION initiative_schedule_guard();
SELECT p2_attach_guards('initiative_schedule', true);
GRANT SELECT, INSERT, UPDATE ON initiative_schedule TO mth_app;
