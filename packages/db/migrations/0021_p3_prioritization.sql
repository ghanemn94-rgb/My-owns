-- 0021 P3 prioritization (T06): versioned weight sets, scores, calculated results, ranking snapshots with causes,
-- overrides (T-DG3-ARCH-01; ADR-0022). Authored by solution-architect.
-- Contract: docs/architecture/data-dictionary.md ("P3" section). Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16. Decimal only (numeric).

-- -----------------------------------------------------------------------------------------------------------------
-- scoring_weight_set: a versioned, immutable set of T06 weights per transformation. v1 = source defaults (B0076),
-- instantiated by p3_instantiate_transformation() (0024). Only the lifecycle columns ever change.
CREATE TABLE scoring_weight_set (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version_no        integer NOT NULL CHECK (version_no >= 1),
  status            text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'superseded', 'withdrawn')),
  approval_basis    text NULL CHECK (approval_basis IS NULL OR approval_basis IN ('source_default', 'approved')),
  rationale         text NULL CHECK (rationale IS NULL OR char_length(rationale) BETWEEN 1 AND 4000),
  approved_by       uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  approved_at       timestamptz NULL,
  activated_at      timestamptz NULL,
  superseded_at     timestamptz NULL,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT scoring_weight_set_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT scoring_weight_set_id_version_no_key UNIQUE (id, version_no),
  CONSTRAINT scoring_weight_set_version_no_key UNIQUE (transformation_id, version_no),
  CONSTRAINT scoring_weight_set_activated_complete CHECK ((status IN ('active', 'superseded')) = (activated_at IS NOT NULL) AND (activated_at IS NULL) = (approval_basis IS NULL)),
  CONSTRAINT scoring_weight_set_superseded_complete CHECK ((status = 'superseded') = (superseded_at IS NOT NULL)),
  CONSTRAINT scoring_weight_set_approval_complete CHECK ((approved_by IS NULL) = (approved_at IS NULL) AND (approval_basis IS DISTINCT FROM 'approved' OR approved_by IS NOT NULL) AND (approval_basis IS DISTINCT FROM 'source_default' OR approved_by IS NULL)),
  CONSTRAINT scoring_weight_set_approver_not_proposer CHECK (approved_by IS NULL OR approved_by <> created_by)
);
CREATE UNIQUE INDEX scoring_weight_set_one_active_key ON scoring_weight_set (transformation_id) WHERE status = 'active';
-- Content is immutable; the status only moves proposed -> active | withdrawn and active -> superseded.
CREATE FUNCTION scoring_weight_set_freeze() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  movable text[] := ARRAY['status', 'approval_basis', 'approved_by', 'approved_at', 'activated_at', 'superseded_at',
                          'version', 'updated_at', 'updated_by'];
BEGIN
  IF (to_jsonb(NEW) - movable) IS DISTINCT FROM (to_jsonb(OLD) - movable) THEN
    RAISE EXCEPTION 'scoring_weight_set %: a weight set is immutable (ADR-0022)', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'scoring_weight_set_immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY['proposed>active', 'proposed>withdrawn', 'active>superseded']) THEN
    RAISE EXCEPTION 'scoring_weight_set %: % -> % is not a legal transition', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'scoring_weight_set_status_transition';
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status AND (NEW.approved_by IS DISTINCT FROM OLD.approved_by
      OR NEW.approval_basis IS DISTINCT FROM OLD.approval_basis OR NEW.activated_at IS DISTINCT FROM OLD.activated_at) THEN
    RAISE EXCEPTION 'scoring_weight_set %: approval columns change only with the status', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'scoring_weight_set_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER scoring_weight_set_freeze BEFORE UPDATE ON scoring_weight_set
  FOR EACH ROW EXECUTE FUNCTION scoring_weight_set_freeze();
SELECT p2_attach_guards('scoring_weight_set', true);
GRANT SELECT, INSERT, UPDATE ON scoring_weight_set TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- scoring_weight: the weights of one set (append-only). Weights are percent with two decimals; a set totals exactly
-- 100.00 (deferred check below), with 2-6 criteria.
CREATE TABLE scoring_weight (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  weight_set_id     uuid NOT NULL,
  criterion_code    text NOT NULL CHECK (criterion_code IN ('strategic_fit', 'financial_value', 'customer_impact', 'feasibility', 'time_to_value', 'risk_compliance')),
  weight_percent    numeric(5,2) NOT NULL CHECK (weight_percent > 0 AND weight_percent <= 100),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT scoring_weight_weight_set_id_fkey FOREIGN KEY (transformation_id, weight_set_id) REFERENCES scoring_weight_set (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT scoring_weight_criterion_key UNIQUE (weight_set_id, criterion_code)
);
SELECT p2_attach_append_only('scoring_weight');
SELECT p2_attach_guards('scoring_weight', false);
GRANT SELECT, INSERT ON scoring_weight TO mth_app;

-- At COMMIT every weight set touched in the transaction has 2-6 weights totalling exactly 100.00 (REQ-PB-049).
CREATE FUNCTION scoring_weight_set_total() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  set_id uuid := CASE WHEN TG_TABLE_NAME = 'scoring_weight' THEN (to_jsonb(NEW)->>'weight_set_id')::uuid ELSE NEW.id END;
  total numeric;
  n integer;
BEGIN
  SELECT coalesce(sum(w.weight_percent), 0), count(*) INTO total, n FROM scoring_weight w WHERE w.weight_set_id = set_id;
  IF total <> 100 OR n NOT BETWEEN 2 AND 6 THEN
    RAISE EXCEPTION 'scoring_weight_set %: weights must total 100%% over 2-6 criteria (got % over %)', set_id, total, n
      USING ERRCODE = 'check_violation', CONSTRAINT = 'scoring_weight_set_total';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER scoring_weight_set_total AFTER INSERT ON scoring_weight_set DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION scoring_weight_set_total();
CREATE CONSTRAINT TRIGGER scoring_weight_total AFTER INSERT ON scoring_weight DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION scoring_weight_set_total();

-- -----------------------------------------------------------------------------------------------------------------
-- initiative_score: the current 1-5 score of one initiative on one criterion (NULL = cleared). History is in the
-- audit trail and in initiative_score_result.inputs.
CREATE TABLE initiative_score (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  initiative_id     uuid NOT NULL,
  criterion_code    text NOT NULL CHECK (criterion_code IN ('strategic_fit', 'financial_value', 'customer_impact', 'feasibility', 'time_to_value', 'risk_compliance')),
  score             smallint NULL CHECK (score IS NULL OR score BETWEEN 1 AND 5),
  note              text NULL CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000),
  scored_by         uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  scored_at         timestamptz NULL,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT initiative_score_initiative_id_fkey FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT initiative_score_criterion_key UNIQUE (initiative_id, criterion_code),
  CONSTRAINT initiative_score_scored_complete CHECK ((score IS NULL) = (scored_by IS NULL) AND (scored_by IS NULL) = (scored_at IS NULL))
);
SELECT p2_attach_guards('initiative_score', true);
GRANT SELECT, INSERT, UPDATE ON initiative_score TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- initiative_score_result: the calculated weighted score (read-only for users), append-only, pinned to the weight set
-- version it used. NULL score = incomplete (never 0).
CREATE TABLE initiative_score_result (
  id                    uuid PRIMARY KEY,
  organization_id       uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id     uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  initiative_id         uuid NOT NULL,
  weight_set_id         uuid NOT NULL,
  weight_set_version_no integer NOT NULL CHECK (weight_set_version_no >= 1),
  weighted_score        numeric(7,4) NULL CHECK (weighted_score IS NULL OR weighted_score BETWEEN 1 AND 5),
  completeness          text NOT NULL CHECK (completeness IN ('complete', 'incomplete')),
  missing_criteria      text[] NOT NULL DEFAULT '{}'::text[],
  inputs                jsonb NOT NULL CHECK (jsonb_typeof(inputs) = 'object'),
  cause                 text NOT NULL CHECK (cause IN ('initial', 'score_change', 'weight_set_activated')),
  computed_at           timestamptz NOT NULL DEFAULT now(),
  computed_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT initiative_score_result_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT initiative_score_result_initiative_id_fkey FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT initiative_score_result_weight_set_fkey FOREIGN KEY (weight_set_id, weight_set_version_no) REFERENCES scoring_weight_set (id, version_no) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT initiative_score_result_complete CHECK ((completeness = 'complete') = (weighted_score IS NOT NULL) AND (completeness = 'complete') = (cardinality(missing_criteria) = 0))
);
CREATE INDEX initiative_score_result_latest_idx ON initiative_score_result (initiative_id, weight_set_id, computed_at DESC, id DESC);
SELECT p2_attach_append_only('initiative_score_result');
SELECT p2_attach_guards('initiative_score_result', false);
GRANT SELECT, INSERT ON initiative_score_result TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- ranking_snapshot: a proposed ranking (advisory; never a selection). Frozen except its status.
CREATE TABLE ranking_snapshot (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  snapshot_no       integer NOT NULL CHECK (snapshot_no >= 1),
  weight_set_id     uuid NOT NULL,
  status            text NOT NULL DEFAULT 'current' CHECK (status IN ('current', 'superseded')),
  note              text NULL CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000),
  proposed_by       uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  proposed_at       timestamptz NOT NULL DEFAULT now(),
  superseded_at     timestamptz NULL,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ranking_snapshot_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT ranking_snapshot_no_key UNIQUE (transformation_id, snapshot_no),
  CONSTRAINT ranking_snapshot_weight_set_id_fkey FOREIGN KEY (transformation_id, weight_set_id) REFERENCES scoring_weight_set (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ranking_snapshot_superseded_complete CHECK ((status = 'superseded') = (superseded_at IS NOT NULL))
);
CREATE UNIQUE INDEX ranking_snapshot_one_current_key ON ranking_snapshot (transformation_id) WHERE status = 'current';
CREATE FUNCTION ranking_snapshot_freeze() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  movable text[] := ARRAY['status', 'superseded_at', 'version', 'updated_at', 'updated_by'];
BEGIN
  IF (to_jsonb(NEW) - movable) IS DISTINCT FROM (to_jsonb(OLD) - movable) OR (OLD.status = 'superseded' AND NEW.status <> 'superseded') THEN
    RAISE EXCEPTION 'ranking_snapshot %: a ranking snapshot is immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ranking_snapshot_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ranking_snapshot_freeze BEFORE UPDATE ON ranking_snapshot
  FOR EACH ROW EXECUTE FUNCTION ranking_snapshot_freeze();
SELECT p2_attach_guards('ranking_snapshot', true);
GRANT SELECT, INSERT, UPDATE ON ranking_snapshot TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- ranking_override: a manual rank with a mandatory reason and an approver who is not the proposer (REQ-S09-005).
CREATE TABLE ranking_override (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  initiative_id     uuid NOT NULL,
  override_rank     integer NOT NULL CHECK (override_rank >= 1),
  reason            text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 2000),
  status            text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected', 'revoked')),
  proposed_by       uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_at        timestamptz NULL,
  decision_note     text NULL CHECK (decision_note IS NULL OR char_length(decision_note) BETWEEN 1 AND 2000),
  revoked_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  revoked_at        timestamptz NULL,
  revoke_reason     text NULL CHECK (revoke_reason IS NULL OR char_length(revoke_reason) BETWEEN 3 AND 1000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ranking_override_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT ranking_override_initiative_id_fkey FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ranking_override_decided_complete CHECK ((status IN ('approved', 'rejected', 'revoked')) = (decided_at IS NOT NULL) AND (decided_at IS NULL) = (decided_by IS NULL)),
  CONSTRAINT ranking_override_revoked_complete CHECK ((status = 'revoked') = (revoked_at IS NOT NULL) AND (revoked_at IS NULL) = (revoked_by IS NULL) AND (revoked_at IS NULL) = (revoke_reason IS NULL)),
  CONSTRAINT ranking_override_approver_not_proposer CHECK (decided_by IS NULL OR decided_by <> proposed_by)
);
CREATE UNIQUE INDEX ranking_override_one_live_key ON ranking_override (initiative_id) WHERE status IN ('proposed', 'approved');
SELECT p2_attach_guards('ranking_override', true);
GRANT SELECT, INSERT, UPDATE ON ranking_override TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- ranking_entry: one initiative in one ranking snapshot, with the causes of its rank change (append-only).
CREATE TABLE ranking_entry (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  snapshot_id       uuid NOT NULL,
  initiative_id     uuid NOT NULL,
  rank              integer NULL CHECK (rank IS NULL OR rank >= 1),
  weighted_score    numeric(7,4) NULL CHECK (weighted_score IS NULL OR weighted_score BETWEEN 1 AND 5),
  completeness      text NOT NULL CHECK (completeness IN ('complete', 'incomplete', 'removed')),
  score_result_id   uuid NULL,
  previous_rank     integer NULL CHECK (previous_rank IS NULL OR previous_rank >= 1),
  causes            text[] NOT NULL DEFAULT '{}'::text[] CHECK (causes <@ ARRAY['new', 'score', 'weight', 'override', 'relative', 'removed']::text[]),
  cause_detail      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(cause_detail) = 'object'),
  override_id       uuid NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ranking_entry_snapshot_id_fkey FOREIGN KEY (transformation_id, snapshot_id) REFERENCES ranking_snapshot (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ranking_entry_initiative_id_fkey FOREIGN KEY (transformation_id, initiative_id) REFERENCES initiative (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ranking_entry_score_result_id_fkey FOREIGN KEY (transformation_id, score_result_id) REFERENCES initiative_score_result (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ranking_entry_override_id_fkey FOREIGN KEY (transformation_id, override_id) REFERENCES ranking_override (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ranking_entry_initiative_key UNIQUE (snapshot_id, initiative_id),
  CONSTRAINT ranking_entry_rank_complete CHECK ((rank IS NOT NULL) = (completeness = 'complete') AND (completeness = 'complete') = (weighted_score IS NOT NULL))
);
CREATE UNIQUE INDEX ranking_entry_rank_key ON ranking_entry (snapshot_id, rank) WHERE rank IS NOT NULL;
CREATE INDEX ranking_entry_initiative_idx ON ranking_entry (initiative_id, created_at DESC);
SELECT p2_attach_append_only('ranking_entry');
SELECT p2_attach_guards('ranking_entry', false);
GRANT SELECT, INSERT ON ranking_entry TO mth_app;
