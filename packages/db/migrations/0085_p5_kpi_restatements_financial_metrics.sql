-- 0085 P5 slice G: KPI restatements with selected periods, authority and a retained reconciliation; report reissue
-- offers; the optional NPV/ROI/payback extension's settings and cash flows (T-DG5-ARCH-05; ADR-0047; REQ-S07-016,
-- REQ-S08-019). Authored by solution-architect. Contract: docs/architecture/data-dictionary.md ("P5 tables, slices G
-- and H"). Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged.
-- SQL floor: PostgreSQL 16. Ids come from the application (UUIDv7); seed rows use fixed literal UUIDs.
--
-- DG4 tables touched, each additively (ADR-0047 §2, §8):
--   * calculation_run: the closed sets trigger_kind / trigger_record_type and the pair CHECK gain one member each
--     ('restatement_approved' / 'kpi_restatement'); every DG4 value stays valid and means what it meant. A new trigger
--     constrains only rows of the new kind.
--   * kpi_evaluation: a new BEFORE INSERT trigger constrains only evaluations whose calculation run is a restatement
--     run (the run's own periods and, for the restated KPI, the restated version); DG4 evaluations are unaffected.
--   * work_item_kind: two new kinds.
-- A restatement never updates or deletes an earlier evaluation (kpi_evaluation stays append-only): the restated values
-- are new evaluations of a new calculation run, and the reconciliation retains the values before and after. Issued
-- report snapshots are never changed; an approved restatement only OFFERS their reissue (ADR-0045 §4).
-- No code, row or job here grants, decides or records a business approval by itself: an approval is recorded only
-- when a person with the authority decides through the API. Nothing reads or writes the engineering gates DG0-DG7.

-- -----------------------------------------------------------------------------------------------------------------
-- kpi_restatement: one retrospective restatement of a KPI (M0163, REQ-S07-016). It applies one approved KPI version
-- (status active or superseded) to explicitly selected closed reporting periods (kpi_restatement_period), retains a
-- reconciliation of every affected slot (kpi_restatement_reconciliation, written in the submitting transaction) and
-- needs a decision by a person holding kpi_restatement.approve who is not the requester (ADR-0047 §2, §6).
--   draft -> submitted | withdrawn
--   submitted -> approved | rejected | withdrawn
--   approved -> applied (by the worker, once: the restatement calculation run)
--   rejected, withdrawn, applied: terminal
CREATE TABLE kpi_restatement (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id    uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kpi_definition_id    uuid NOT NULL,
  kpi_version_id       uuid NOT NULL,
  change_request_id    uuid NULL,
  reason               text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 2000),
  status               text NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'withdrawn', 'applied')),
  requested_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  submitted_at         timestamptz NULL,
  period_count         smallint NOT NULL DEFAULT 0 CHECK (period_count BETWEEN 0 AND 24),
  reconciliation_count integer NOT NULL DEFAULT 0 CHECK (reconciliation_count >= 0),
  decided_by           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_at           timestamptz NULL,
  decision_note        text NULL CHECK (decision_note IS NULL OR char_length(decision_note) BETWEEN 1 AND 2000),
  authority_permission text NULL CHECK (authority_permission IS NULL OR authority_permission = 'kpi_restatement.approve'),
  authority_role_code  text NULL REFERENCES role (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  calculation_run_id   uuid NULL,
  applied_at           timestamptz NULL,
  withdrawn_at         timestamptz NULL,
  withdrawn_by         uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_restatement_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT kpi_restatement_kpi_fkey FOREIGN KEY (transformation_id, kpi_definition_id)
    REFERENCES kpi_definition (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_restatement_version_fkey FOREIGN KEY (transformation_id, kpi_version_id)
    REFERENCES kpi_version (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_restatement_change_request_fkey FOREIGN KEY (transformation_id, change_request_id)
    REFERENCES change_request (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_restatement_run_fkey FOREIGN KEY (transformation_id, calculation_run_id)
    REFERENCES calculation_run (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- Separation of duties (D-142 Q10): the requester never decides their own restatement.
  CONSTRAINT kpi_restatement_sod CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT kpi_restatement_submitted_stamp CHECK (
    (status = 'draft' AND submitted_at IS NULL)
    OR (status IN ('submitted', 'approved', 'rejected', 'applied') AND submitted_at IS NOT NULL)
    OR status = 'withdrawn'),
  CONSTRAINT kpi_restatement_decision_complete CHECK (
    (status IN ('approved', 'rejected', 'applied')) = (decided_by IS NOT NULL)
    AND (decided_by IS NULL) = (decided_at IS NULL)
    AND (decided_by IS NULL) = (authority_permission IS NULL)
    AND (decided_by IS NULL) = (authority_role_code IS NULL)),
  CONSTRAINT kpi_restatement_reject_note CHECK (status <> 'rejected' OR decision_note IS NOT NULL),
  CONSTRAINT kpi_restatement_applied_complete CHECK (
    (status = 'applied') = (applied_at IS NOT NULL) AND (applied_at IS NULL) = (calculation_run_id IS NULL)),
  CONSTRAINT kpi_restatement_withdrawn_complete CHECK (
    (status = 'withdrawn') = (withdrawn_at IS NOT NULL) AND (withdrawn_at IS NULL) = (withdrawn_by IS NULL))
);
-- At most one restatement in progress per KPI (draft, submitted or approved-not-yet-applied).
CREATE UNIQUE INDEX kpi_restatement_one_open_key ON kpi_restatement (kpi_definition_id)
  WHERE status IN ('draft', 'submitted', 'approved');
CREATE INDEX kpi_restatement_kpi_idx ON kpi_restatement (transformation_id, kpi_definition_id, created_at DESC, id DESC);

CREATE FUNCTION kpi_restatement_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  kpi_restatement_lock_class CONSTANT integer := 730266;
  v kpi_version%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(kpi_restatement_lock_class, hashtext(NEW.kpi_definition_id::text));
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR NEW.reconciliation_count <> 0 THEN
      RAISE EXCEPTION 'kpi_restatement: a restatement is created as a draft without reconciliation'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_restatement_created_draft';
    END IF;
    SELECT * INTO v FROM kpi_version WHERE id = NEW.kpi_version_id;
    IF FOUND AND (v.kpi_definition_id <> NEW.kpi_definition_id OR v.status NOT IN ('active', 'superseded')) THEN
      RAISE EXCEPTION 'kpi_restatement: the restated version must be an approved (active or superseded) version of this KPI'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_restatement_version_approved';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.kpi_definition_id IS DISTINCT FROM OLD.kpi_definition_id OR NEW.kpi_version_id IS DISTINCT FROM OLD.kpi_version_id
     OR NEW.change_request_id IS DISTINCT FROM OLD.change_request_id OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR (OLD.status <> 'draft' AND (NEW.reason IS DISTINCT FROM OLD.reason OR NEW.period_count IS DISTINCT FROM OLD.period_count
                                    OR NEW.reconciliation_count IS DISTINCT FROM OLD.reconciliation_count)) THEN
    RAISE EXCEPTION 'kpi_restatement: the KPI, version, change request and requester never change; reason and periods change only in draft'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_restatement_identity_fixed';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY['draft>submitted', 'draft>withdrawn', 'submitted>approved',
                                                           'submitted>rejected', 'submitted>withdrawn', 'approved>applied']) THEN
    RAISE EXCEPTION 'kpi_restatement: % -> % is not an allowed transition', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_restatement_status_step';
  END IF;
  IF NEW.status = OLD.status AND OLD.status IN ('rejected', 'withdrawn', 'applied') THEN
    RAISE EXCEPTION 'kpi_restatement: a % restatement is final', OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_restatement_status_step';
  END IF;
  IF NEW.status = 'submitted' AND OLD.status = 'draft' THEN
    -- The submission time is the submitting transaction's time; the reconciliation rows must carry the same instant.
    NEW.submitted_at := now();
  ELSIF NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'kpi_restatement: the submission time is set only by the submission'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_restatement_identity_fixed';
  END IF;
  IF (NEW.decided_by IS DISTINCT FROM OLD.decided_by OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
      OR NEW.decision_note IS DISTINCT FROM OLD.decision_note OR NEW.authority_role_code IS DISTINCT FROM OLD.authority_role_code)
     AND NOT (OLD.status = 'submitted' AND NEW.status IN ('approved', 'rejected')) THEN
    RAISE EXCEPTION 'kpi_restatement: the decision is recorded only by the approve or reject transition'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_restatement_decision_frozen';
  END IF;
  IF NEW.status = 'applied' AND NOT EXISTS (
       SELECT 1 FROM calculation_run r WHERE r.id = NEW.calculation_run_id AND r.trigger_kind = 'restatement_approved'
         AND r.trigger_record_id = NEW.id AND r.status = 'completed') THEN
    RAISE EXCEPTION 'kpi_restatement: applied needs the completed restatement calculation run of this restatement'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_restatement_applied_run';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kpi_restatement_guard BEFORE INSERT OR UPDATE ON kpi_restatement
  FOR EACH ROW EXECUTE FUNCTION kpi_restatement_guard();
SELECT p2_attach_guards('kpi_restatement', true);
GRANT SELECT, INSERT, UPDATE ON kpi_restatement TO mth_app;

-- kpi_restatement_period: the explicitly selected periods (append-only; written only while the restatement is a draft).
-- Each is a CLOSED reporting period of the restated version's frequency in the restatement's organization: an open
-- period is not restated, it takes the new version prospectively (ADR-0047 §1).
CREATE TABLE kpi_restatement_period (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id   uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  restatement_id      uuid NOT NULL,
  reporting_period_id uuid NOT NULL,
  period_label        text NOT NULL CHECK (char_length(period_label) BETWEEN 1 AND 32),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kpi_restatement_period_parent_fkey FOREIGN KEY (transformation_id, restatement_id)
    REFERENCES kpi_restatement (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_restatement_period_period_fkey FOREIGN KEY (organization_id, reporting_period_id)
    REFERENCES reporting_period (organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_restatement_period_key UNIQUE (restatement_id, reporting_period_id)
);
CREATE FUNCTION kpi_restatement_period_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  r kpi_restatement%ROWTYPE;
  p reporting_period%ROWTYPE;
  freq text;
BEGIN
  SELECT * INTO r FROM kpi_restatement WHERE id = NEW.restatement_id;
  IF FOUND AND r.status <> 'draft' THEN
    RAISE EXCEPTION 'kpi_restatement_period: periods are selected only while the restatement is a draft'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_restatement_period_draft_only';
  END IF;
  SELECT * INTO p FROM reporting_period WHERE id = NEW.reporting_period_id;
  SELECT v.frequency INTO freq FROM kpi_version v WHERE v.id = r.kpi_version_id;
  IF FOUND AND (p.status <> 'closed' OR p.frequency <> freq OR p.period_label <> NEW.period_label
                OR p.organization_id <> r.organization_id) THEN
    RAISE EXCEPTION 'kpi_restatement_period: % is not a closed % period of this organization', NEW.period_label, freq
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_restatement_period_closed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kpi_restatement_period_guard BEFORE INSERT ON kpi_restatement_period
  FOR EACH ROW EXECUTE FUNCTION kpi_restatement_period_guard();
SELECT p2_attach_append_only('kpi_restatement_period');
SELECT p2_attach_guards('kpi_restatement_period', false);
GRANT SELECT, INSERT ON kpi_restatement_period TO mth_app;

-- kpi_restatement_reconciliation: the retained reconciliation (M0163). One row per selected period, scope and value
-- basis, written in the submitting transaction (created_at = the restatement's submitted_at; checked at COMMIT):
-- the value, status, RAG, target and version in force before (the latest DG4 evaluation of the slot, or 'none') and
-- after (the same evaluation with the restated version, computed by the API's preview), and the difference.
-- Unknown, stale and not computable values have no number, never 0 (the kpi_evaluation rule).
CREATE TABLE kpi_restatement_reconciliation (
  id                    uuid PRIMARY KEY,
  organization_id       uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id     uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  restatement_id        uuid NOT NULL,
  reporting_period_id   uuid NOT NULL,
  scope_kind            text NOT NULL CHECK (scope_kind IN ('transformation', 'business_unit', 'initiative')),
  scope_id              uuid NOT NULL,
  value_basis           text NOT NULL CHECK (value_basis IN ('period', 'cumulative')),
  before_evaluation_id  uuid NULL,
  before_kpi_version_id uuid NULL,
  before_value          numeric(24,6) NULL,
  before_value_status   text NOT NULL CHECK (before_value_status IN ('ok', 'unknown', 'stale', 'not_computable', 'none')),
  before_rag            text NOT NULL CHECK (before_rag IN ('green', 'amber', 'red', 'unknown', 'stale', 'not_computable', 'none')),
  before_target         numeric(24,6) NULL,
  after_value           numeric(24,6) NULL,
  after_value_status    text NOT NULL CHECK (after_value_status IN ('ok', 'unknown', 'stale', 'not_computable')),
  after_rag             text NOT NULL CHECK (after_rag IN ('green', 'amber', 'red', 'unknown', 'stale', 'not_computable')),
  after_target          numeric(24,6) NULL,
  difference            numeric(24,6) NULL,
  currency              char(3) NULL CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kpi_restatement_reconciliation_parent_fkey FOREIGN KEY (transformation_id, restatement_id)
    REFERENCES kpi_restatement (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_restatement_reconciliation_period_fkey FOREIGN KEY (restatement_id, reporting_period_id)
    REFERENCES kpi_restatement_period (restatement_id, reporting_period_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_restatement_reconciliation_evaluation_fkey FOREIGN KEY (before_evaluation_id)
    REFERENCES kpi_evaluation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_restatement_reconciliation_version_fkey FOREIGN KEY (transformation_id, before_kpi_version_id)
    REFERENCES kpi_version (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_restatement_reconciliation_slot_key UNIQUE (restatement_id, reporting_period_id, scope_kind, scope_id, value_basis),
  CONSTRAINT kpi_restatement_reconciliation_before CHECK (
    (before_value IS NOT NULL) = (before_value_status IN ('ok', 'stale'))
    AND (before_value_status = 'none') = (before_evaluation_id IS NULL)
    AND (before_value_status = 'none') = (before_rag = 'none')
    AND (before_evaluation_id IS NULL) = (before_kpi_version_id IS NULL)),
  CONSTRAINT kpi_restatement_reconciliation_after CHECK ((after_value IS NOT NULL) = (after_value_status IN ('ok', 'stale'))),
  CONSTRAINT kpi_restatement_reconciliation_difference CHECK (
    (difference IS NULL) = (before_value_status <> 'ok' OR after_value_status <> 'ok')
    AND (difference IS NULL OR difference = after_value - before_value))
);
CREATE FUNCTION kpi_restatement_reconciliation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM kpi_restatement r WHERE r.id = NEW.restatement_id AND r.status <> 'draft') THEN
    RAISE EXCEPTION 'kpi_restatement_reconciliation: the reconciliation is written only by the submission of a draft'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_restatement_reconciliation_at_submit';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kpi_restatement_reconciliation_guard BEFORE INSERT ON kpi_restatement_reconciliation
  FOR EACH ROW EXECUTE FUNCTION kpi_restatement_reconciliation_guard();
SELECT p2_attach_append_only('kpi_restatement_reconciliation');
SELECT p2_attach_guards('kpi_restatement_reconciliation', false);
GRANT SELECT, INSERT ON kpi_restatement_reconciliation TO mth_app;

-- Checked at COMMIT: the counters equal the children; a submitted (or later) restatement has at least one period, at
-- least one reconciliation row per period, and every reconciliation row was written in the submitting transaction.
-- Attached to the parent and to both child tables, so a child written without its parent is checked too.
CREATE FUNCTION kpi_restatement_complete() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  r kpi_restatement%ROWTYPE;
  rid uuid := CASE WHEN TG_TABLE_NAME = 'kpi_restatement' THEN (to_jsonb(NEW)->>'id')::uuid
                   ELSE (to_jsonb(NEW)->>'restatement_id')::uuid END;
BEGIN
  SELECT * INTO r FROM kpi_restatement WHERE id = rid;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF r.period_count <> (SELECT count(*) FROM kpi_restatement_period p WHERE p.restatement_id = r.id)
     OR r.reconciliation_count <> (SELECT count(*) FROM kpi_restatement_reconciliation c WHERE c.restatement_id = r.id) THEN
    RAISE EXCEPTION 'kpi_restatement %: period_count and reconciliation_count must equal the selected periods and reconciliation rows', r.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'kpi_restatement_counts';
  END IF;
  IF r.status IN ('submitted', 'approved', 'rejected', 'applied') AND (
       r.period_count = 0
       OR EXISTS (SELECT 1 FROM kpi_restatement_period p WHERE p.restatement_id = r.id
                    AND NOT EXISTS (SELECT 1 FROM kpi_restatement_reconciliation c
                                    WHERE c.restatement_id = r.id AND c.reporting_period_id = p.reporting_period_id))
       OR EXISTS (SELECT 1 FROM kpi_restatement_reconciliation c WHERE c.restatement_id = r.id AND c.created_at <> r.submitted_at)) THEN
    RAISE EXCEPTION 'kpi_restatement %: a submitted restatement needs at least one period and a reconciliation of every period, written at submission', r.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'kpi_restatement_reconciled';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER kpi_restatement_complete AFTER INSERT OR UPDATE ON kpi_restatement
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION kpi_restatement_complete();
CREATE CONSTRAINT TRIGGER kpi_restatement_period_complete AFTER INSERT ON kpi_restatement_period
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION kpi_restatement_complete();
CREATE CONSTRAINT TRIGGER kpi_restatement_reconciliation_complete AFTER INSERT ON kpi_restatement_reconciliation
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION kpi_restatement_complete();

-- -----------------------------------------------------------------------------------------------------------------
-- calculation_run (DG4, 0035): one more trigger kind for the recalculation of an approved restatement (additive; every
-- DG4 value keeps its meaning). The restatement run is written once per restatement (trigger_slot 1; the DG4
-- UNIQUE (trigger_kind, trigger_record_id, trigger_slot) and the idempotency key 'kpi_restatement:<id>' are the
-- exactly-once backstops) and only for an APPROVED restatement.
ALTER TABLE calculation_run DROP CONSTRAINT calculation_run_trigger_kind_check;
ALTER TABLE calculation_run ADD CONSTRAINT calculation_run_trigger_kind_check
  CHECK (trigger_kind IN ('actual_accepted', 'threshold_changed', 'trajectory_approved', 'version_activated', 'restatement_approved'));
ALTER TABLE calculation_run DROP CONSTRAINT calculation_run_trigger_record_type_check;
ALTER TABLE calculation_run ADD CONSTRAINT calculation_run_trigger_record_type_check
  CHECK (trigger_record_type IN ('kpi_actual', 'kpi_rag_threshold', 'target_trajectory', 'kpi_version', 'kpi_restatement'));
ALTER TABLE calculation_run DROP CONSTRAINT calculation_run_trigger_pair;
ALTER TABLE calculation_run ADD CONSTRAINT calculation_run_trigger_pair CHECK (
  (trigger_kind = 'actual_accepted' AND trigger_record_type = 'kpi_actual')
  OR (trigger_kind = 'threshold_changed' AND trigger_record_type = 'kpi_rag_threshold')
  OR (trigger_kind = 'trajectory_approved' AND trigger_record_type = 'target_trajectory')
  OR (trigger_kind = 'version_activated' AND trigger_record_type = 'kpi_version')
  OR (trigger_kind = 'restatement_approved' AND trigger_record_type = 'kpi_restatement'));

CREATE FUNCTION calculation_run_restatement_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.trigger_kind = 'restatement_approved' AND (NEW.trigger_slot <> 1
       OR NEW.idempotency_key <> 'kpi_restatement:' || NEW.trigger_record_id::text
       OR NOT EXISTS (SELECT 1 FROM kpi_restatement r WHERE r.id = NEW.trigger_record_id
                        AND r.transformation_id = NEW.transformation_id AND r.status = 'approved')) THEN
    RAISE EXCEPTION 'calculation_run: a restatement run needs an approved restatement of this transformation (slot 1, key kpi_restatement:<id>)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'calculation_run_restatement_approved';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER calculation_run_restatement_guard BEFORE INSERT ON calculation_run
  FOR EACH ROW EXECUTE FUNCTION calculation_run_restatement_guard();

-- kpi_evaluation (DG4, 0035): an evaluation of a restatement run lies in one of the restatement's selected periods,
-- and an evaluation of the restated KPI itself uses the restated version. Evaluations of other runs are unaffected.
CREATE FUNCTION kpi_evaluation_restatement_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  r kpi_restatement%ROWTYPE;
BEGIN
  SELECT k.* INTO r FROM calculation_run c JOIN kpi_restatement k ON k.id = c.trigger_record_id
   WHERE c.id = NEW.calculation_run_id AND c.trigger_kind = 'restatement_approved';
  IF FOUND AND (
       NOT EXISTS (SELECT 1 FROM kpi_restatement_period p WHERE p.restatement_id = r.id AND p.reporting_period_id = NEW.reporting_period_id)
       OR (NEW.kpi_definition_id = r.kpi_definition_id AND NEW.kpi_version_id <> r.kpi_version_id)) THEN
    RAISE EXCEPTION 'kpi_evaluation: a restatement run evaluates only the selected periods, and the restated KPI with the restated version'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_evaluation_restatement_scope';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kpi_evaluation_restatement_guard BEFORE INSERT ON kpi_evaluation
  FOR EACH ROW EXECUTE FUNCTION kpi_evaluation_restatement_guard();

-- kpi_restatement_reissue_offer: an issued report snapshot that showed the restated KPI for a restated period, offered
-- for reissue once per restatement (append-only; UNIQUE is the exactly-once backstop of the worker). The snapshot is
-- never changed; a person reissues it through reissueReportSnapshot (ADR-0045 §4), which makes a new issue version.
CREATE TABLE kpi_restatement_reissue_offer (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  restatement_id    uuid NOT NULL,
  snapshot_id       uuid NOT NULL,
  series_id         uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kpi_restatement_reissue_offer_parent_fkey FOREIGN KEY (transformation_id, restatement_id)
    REFERENCES kpi_restatement (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_restatement_reissue_offer_snapshot_fkey FOREIGN KEY (transformation_id, snapshot_id)
    REFERENCES report_snapshot (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_restatement_reissue_offer_key UNIQUE (restatement_id, snapshot_id)
);
CREATE FUNCTION kpi_restatement_reissue_offer_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM kpi_restatement r WHERE r.id = NEW.restatement_id AND r.status IN ('approved', 'applied'))
     OR NOT EXISTS (SELECT 1 FROM report_snapshot s WHERE s.id = NEW.snapshot_id AND s.series_id = NEW.series_id
                      AND s.status IN ('issued', 'superseded')) THEN
    RAISE EXCEPTION 'kpi_restatement_reissue_offer: an offer names an issued snapshot (and its series) of an approved restatement'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kpi_restatement_reissue_offer_valid';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kpi_restatement_reissue_offer_guard BEFORE INSERT ON kpi_restatement_reissue_offer
  FOR EACH ROW EXECUTE FUNCTION kpi_restatement_reissue_offer_guard();
SELECT p2_attach_append_only('kpi_restatement_reissue_offer');
SELECT p2_attach_guards('kpi_restatement_reissue_offer', false);
GRANT SELECT, INSERT ON kpi_restatement_reissue_offer TO mth_app;

INSERT INTO work_item_kind (code, owner_module, label_en, label_ar, source_ref, urgency) VALUES
  ('kpi_restatement_to_decide', 'kpi', 'KPI restatement to decide', 'إعادة بيان مؤشر أداء بانتظار القرار', 'M0163', 'normal'),
  ('report_reissue_offer', 'kpi', 'Issued report affected by a KPI restatement: reissue offered', 'تقرير صادر تأثر بإعادة بيان مؤشر أداء: إعادة الإصدار متاحة', 'M0163', 'normal');

-- -----------------------------------------------------------------------------------------------------------------
-- financial_metric_setting: the optional NPV / ROI / payback extension (M0174, REQ-S08-019), one row per organization.
-- No row, or enabled = false, means DISABLED (the default: no row is seeded). The methodology statement, timing
-- convention and period basis are explicit assumptions set by Finance, all or none; the discount rate is a decimal
-- fraction per period of the period basis (0.100000 = 10%). NPV is shown only when enabled AND a discount rate is
-- configured; ROI and payback need the extension enabled and the assumptions set (ADR-0047 §5).
CREATE TABLE financial_metric_setting (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT
                         CONSTRAINT financial_metric_setting_org_key UNIQUE,
  enabled              boolean NOT NULL DEFAULT false,
  methodology          text NOT NULL DEFAULT 'discounted_net_cash_flow' CHECK (methodology IN ('discounted_net_cash_flow')),
  methodology_note     text NULL CHECK (methodology_note IS NULL OR char_length(methodology_note) BETWEEN 3 AND 2000),
  timing               text NULL CHECK (timing IS NULL OR timing IN ('end_of_period', 'beginning_of_period')),
  period_basis         text NULL CHECK (period_basis IS NULL OR period_basis IN ('annual', 'quarterly', 'monthly')),
  discount_rate        numeric(9,6) NULL CHECK (discount_rate IS NULL OR (discount_rate >= 0 AND discount_rate <= 1)),
  assumptions_set_by   uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  assumptions_set_at   timestamptz NULL,
  enabled_changed_by   uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  enabled_changed_at   timestamptz NULL,
  version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT financial_metric_setting_assumptions_complete CHECK (
    (methodology_note IS NULL) = (timing IS NULL) AND (timing IS NULL) = (period_basis IS NULL)
    AND (timing IS NULL) = (assumptions_set_at IS NULL) AND (assumptions_set_at IS NULL) = (assumptions_set_by IS NULL)
    AND (discount_rate IS NULL OR timing IS NOT NULL)),
  CONSTRAINT financial_metric_setting_enabled_stamp CHECK ((enabled_changed_at IS NULL) = (enabled_changed_by IS NULL))
);
SELECT p2_attach_guards('financial_metric_setting', true);
GRANT SELECT, INSERT, UPDATE ON financial_metric_setting TO mth_app;

-- financial_cash_flow_set + financial_cash_flow: the explicit cash flows of one business case that NPV, ROI and payback
-- are computed from (Finance-entered; never derived from benefit values, so value bases are never mixed). The set is
-- replaced as a whole: each replacement steps `revision` and inserts the new rows (append-only history); the current
-- rows are those of the set's revision. Amounts are numeric(20,4) in the business case's currency.
CREATE TABLE financial_cash_flow_set (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  business_case_id  uuid NOT NULL,
  currency          char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  revision          integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  line_count        smallint NOT NULL CHECK (line_count BETWEEN 1 AND 121),
  basis_note        text NULL CHECK (basis_note IS NULL OR char_length(basis_note) BETWEEN 1 AND 2000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT financial_cash_flow_set_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT financial_cash_flow_set_case_key UNIQUE (business_case_id),
  CONSTRAINT financial_cash_flow_set_case_fkey FOREIGN KEY (transformation_id, business_case_id)
    REFERENCES business_case (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE FUNCTION financial_cash_flow_set_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.revision <> 1 THEN
    RAISE EXCEPTION 'financial_cash_flow_set: a set starts at revision 1'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'financial_cash_flow_set_revision_step';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.business_case_id IS DISTINCT FROM OLD.business_case_id OR NEW.currency IS DISTINCT FROM OLD.currency
                           OR NEW.revision NOT IN (OLD.revision, OLD.revision + 1)) THEN
    RAISE EXCEPTION 'financial_cash_flow_set: the business case and currency never change, and a replacement steps the revision by exactly 1'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'financial_cash_flow_set_revision_step';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM business_case b WHERE b.id = NEW.business_case_id AND b.currency = NEW.currency) THEN
    RAISE EXCEPTION 'financial_cash_flow_set: the cash flows are in the business case currency'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'financial_cash_flow_set_currency';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER financial_cash_flow_set_guard BEFORE INSERT OR UPDATE ON financial_cash_flow_set
  FOR EACH ROW EXECUTE FUNCTION financial_cash_flow_set_guard();
SELECT p2_attach_guards('financial_cash_flow_set', true);
GRANT SELECT, INSERT, UPDATE ON financial_cash_flow_set TO mth_app;

CREATE TABLE financial_cash_flow (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  set_id            uuid NOT NULL,
  revision          integer NOT NULL CHECK (revision >= 1),
  period_index      smallint NOT NULL CHECK (period_index BETWEEN 0 AND 120),
  outflow           numeric(20,4) NOT NULL CHECK (outflow >= 0),
  inflow            numeric(20,4) NOT NULL CHECK (inflow >= 0),
  note              text NULL CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_cash_flow_set_fkey FOREIGN KEY (transformation_id, set_id)
    REFERENCES financial_cash_flow_set (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT financial_cash_flow_period_key UNIQUE (set_id, revision, period_index)
);
CREATE FUNCTION financial_cash_flow_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM financial_cash_flow_set s WHERE s.id = NEW.set_id AND s.revision = NEW.revision) THEN
    RAISE EXCEPTION 'financial_cash_flow: rows are written only for the current revision of their set'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'financial_cash_flow_current_revision';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER financial_cash_flow_guard BEFORE INSERT ON financial_cash_flow
  FOR EACH ROW EXECUTE FUNCTION financial_cash_flow_guard();
SELECT p2_attach_append_only('financial_cash_flow');
SELECT p2_attach_guards('financial_cash_flow', false);
GRANT SELECT, INSERT ON financial_cash_flow TO mth_app;

-- Checked at COMMIT: the set's current revision has exactly line_count rows, with period indexes 0..line_count-1.
-- Attached to the set and to its rows, so a row written without its set is checked too.
CREATE FUNCTION financial_cash_flow_set_complete() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  s financial_cash_flow_set%ROWTYPE;
  n integer;
  mx integer;
  sid uuid := CASE WHEN TG_TABLE_NAME = 'financial_cash_flow_set' THEN (to_jsonb(NEW)->>'id')::uuid
                   ELSE (to_jsonb(NEW)->>'set_id')::uuid END;
BEGIN
  SELECT * INTO s FROM financial_cash_flow_set WHERE id = sid;
  SELECT count(*), max(period_index) INTO n, mx FROM financial_cash_flow f WHERE f.set_id = s.id AND f.revision = s.revision;
  IF n <> s.line_count OR mx IS DISTINCT FROM s.line_count - 1 THEN
    RAISE EXCEPTION 'financial_cash_flow_set %: revision % needs exactly % rows with period indexes 0..%', s.id, s.revision, s.line_count, s.line_count - 1
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'financial_cash_flow_set_rows';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER financial_cash_flow_set_complete AFTER INSERT OR UPDATE ON financial_cash_flow_set
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION financial_cash_flow_set_complete();
CREATE CONSTRAINT TRIGGER financial_cash_flow_complete AFTER INSERT ON financial_cash_flow
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION financial_cash_flow_set_complete();
