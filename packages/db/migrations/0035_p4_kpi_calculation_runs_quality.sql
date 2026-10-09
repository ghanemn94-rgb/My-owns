-- 0035 P4 calculation runs, KPI evaluations (values and calculated RAG), data-quality findings and manual RAG overrides
-- (T-DG4-ARCH-02; ADR-0027 §8-§10, ADR-0028 §2-§6; REQ-S07-004..-009, -013, REQ-S12-006, REQ-S16-014). Authored by
-- solution-architect. Contract: docs/architecture/data-dictionary.md ("P4 tables, slice A"). Runs as mth_owner inside
-- one transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
-- calculation_run and kpi_evaluation are append-only LINEAGE rows written by the worker (the benefit_calculation
-- precedent, 0023): they carry no audit event of their own, so accepting one actual writes exactly one audit event (on
-- kpi_actual) and the worker writes exactly one calculation_run for it (unique calculation_run_trigger_key).

-- -----------------------------------------------------------------------------------------------------------------
-- calculation_run (CalculationRun, REQ-S16-014): one run per trigger. trigger_kind + trigger_record_id + trigger_slot
-- is unique, so a redelivered or restarted job cannot create a second run for the same accepted value (REQ-S07-013,
-- REQ-S12-006). A run row is written once, when the run has finished (completed or failed).
CREATE TABLE calculation_run (
  id                 uuid PRIMARY KEY,
  seq                bigint GENERATED ALWAYS AS IDENTITY,
  organization_id    uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id  uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  trigger_kind       text NOT NULL CHECK (trigger_kind IN ('actual_accepted', 'threshold_changed', 'trajectory_approved', 'version_activated')),
  trigger_record_type text NOT NULL CHECK (trigger_record_type IN ('kpi_actual', 'kpi_rag_threshold', 'target_trajectory', 'kpi_version')),
  trigger_record_id  uuid NOT NULL,
  trigger_slot       integer NOT NULL CHECK (trigger_slot >= 1),
  idempotency_key    text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  status             text NOT NULL CHECK (status IN ('completed', 'failed')),
  error_code         text NULL CHECK (error_code IS NULL OR error_code ~ '^[a-z_]+\.[a-z_.]{1,80}$'),
  evaluation_count   integer NOT NULL DEFAULT 0 CHECK (evaluation_count >= 0),
  finding_count      integer NOT NULL DEFAULT 0 CHECK (finding_count >= 0),
  formula_engine_version text NOT NULL CHECK (char_length(formula_engine_version) BETWEEN 1 AND 50),
  kpi_rules_version  text NOT NULL CHECK (char_length(kpi_rules_version) BETWEEN 1 AND 50),
  started_at         timestamptz NOT NULL,
  completed_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calculation_run_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT calculation_run_seq_key UNIQUE (seq),
  CONSTRAINT calculation_run_trigger_key UNIQUE (trigger_kind, trigger_record_id, trigger_slot),
  CONSTRAINT calculation_run_idempotency_key UNIQUE (idempotency_key),
  CONSTRAINT calculation_run_trigger_pair CHECK (
    (trigger_kind = 'actual_accepted' AND trigger_record_type = 'kpi_actual')
    OR (trigger_kind = 'threshold_changed' AND trigger_record_type = 'kpi_rag_threshold')
    OR (trigger_kind = 'trajectory_approved' AND trigger_record_type = 'target_trajectory')
    OR (trigger_kind = 'version_activated' AND trigger_record_type = 'kpi_version')),
  CONSTRAINT calculation_run_failed_shape CHECK ((status = 'failed') = (error_code IS NOT NULL)),
  CONSTRAINT calculation_run_times CHECK (completed_at >= started_at)
);
CREATE INDEX calculation_run_transformation_idx ON calculation_run (transformation_id, seq DESC);
SELECT p2_attach_append_only('calculation_run');
SELECT p2_attach_guards('calculation_run', false);
GRANT SELECT, INSERT ON calculation_run TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- kpi_evaluation: one evaluated KPI value per run, KPI, scope, period and basis (period or cumulative): the value with
-- its status, expected-to-date, final target, variance, trend, freshness and the calculated RAG with the rule that
-- produced it (REQ-S07-004..-008). Append-only. The current status of a slot is its evaluation with the highest run seq.
-- DB invariants for REQ-S07-006: 'unknown' and 'not_computable' have no value (NULL, never 0); a 'stale' value keeps its
-- number but its calculated RAG is 'stale'; green, amber and red need value status 'ok' and a known deviation.
CREATE TABLE kpi_evaluation (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id   uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  calculation_run_id  uuid NOT NULL,
  kpi_definition_id   uuid NOT NULL,
  kpi_version_id      uuid NOT NULL,
  scope_kind          text NOT NULL CHECK (scope_kind IN ('transformation', 'business_unit', 'initiative')),
  scope_id            uuid NOT NULL,
  reporting_period_id uuid NOT NULL,
  period_label        text NOT NULL,
  value_basis         text NOT NULL CHECK (value_basis IN ('period', 'cumulative')),
  value               numeric(24,6) NULL,
  value_status        text NOT NULL CHECK (value_status IN ('ok', 'unknown', 'stale', 'not_computable')),
  value_reason        text NULL CHECK (value_reason IS NULL OR value_reason ~ '^kpi\.[a-z_]{1,60}$'),
  value_source        text NOT NULL CHECK (value_source IN ('entered', 'rolled_up', 'formula', 'none')),
  currency            char(3) NULL CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  inputs              jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(inputs) = 'object'),
  rounding            jsonb NULL CHECK (rounding IS NULL OR jsonb_typeof(rounding) = 'object'),
  expected_value      numeric(24,6) NULL,
  final_target        numeric(24,6) NULL,
  variance            numeric(24,6) NULL,
  variance_ratio      numeric(24,6) NULL,
  comparison_flag     text NULL CHECK (comparison_flag IS NULL OR comparison_flag IN ('negative_baseline', 'not_comparable', 'zero_base')),
  trend               text NOT NULL CHECK (trend IN ('improving', 'worsening', 'flat', 'not_comparable', 'unknown')),
  previous_period_id  uuid NULL,
  data_as_of          date NULL,
  calculated_rag      text NOT NULL CHECK (calculated_rag IN ('green', 'amber', 'red', 'unknown', 'stale', 'not_computable')),
  deviation           text NOT NULL CHECK (deviation IN ('favourable', 'within', 'adverse', 'unknown')),
  threshold_id        uuid NULL,
  threshold_source    text NOT NULL CHECK (threshold_source IN ('configured', 'default', 'none')),
  target_trajectory_id uuid NULL,
  explanation_key     text NOT NULL CHECK (explanation_key ~ '^kpi\.rag\.[a-z_]{1,60}$'),
  explanation_params  jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(explanation_params) = 'object'),
  evaluated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kpi_evaluation_key UNIQUE (calculation_run_id, kpi_definition_id, scope_kind, scope_id, reporting_period_id, value_basis),
  CONSTRAINT kpi_evaluation_run_fkey FOREIGN KEY (transformation_id, calculation_run_id)
    REFERENCES calculation_run (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_evaluation_kpi_fkey FOREIGN KEY (transformation_id, kpi_definition_id)
    REFERENCES kpi_definition (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_evaluation_version_fkey FOREIGN KEY (transformation_id, kpi_version_id)
    REFERENCES kpi_version (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_evaluation_period_fkey FOREIGN KEY (organization_id, reporting_period_id)
    REFERENCES reporting_period (organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_evaluation_threshold_fkey FOREIGN KEY (transformation_id, threshold_id)
    REFERENCES kpi_rag_threshold (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_evaluation_trajectory_fkey FOREIGN KEY (transformation_id, target_trajectory_id)
    REFERENCES target_trajectory (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT kpi_evaluation_value_status CHECK ((value IS NOT NULL) = (value_status IN ('ok', 'stale'))
                                                AND (value_status = 'ok' OR value_reason IS NOT NULL)),
  CONSTRAINT kpi_evaluation_rag_needs_data CHECK (calculated_rag NOT IN ('green', 'amber', 'red')
                                                  OR (value_status = 'ok' AND deviation <> 'unknown')),
  CONSTRAINT kpi_evaluation_unknown_rag CHECK (value_status = 'ok' OR calculated_rag = value_status),
  CONSTRAINT kpi_evaluation_threshold_source CHECK ((threshold_source = 'configured') = (threshold_id IS NOT NULL))
);
CREATE INDEX kpi_evaluation_slot_idx ON kpi_evaluation (kpi_definition_id, scope_kind, scope_id, reporting_period_id, value_basis);
CREATE INDEX kpi_evaluation_run_idx ON kpi_evaluation (calculation_run_id);
SELECT p2_attach_append_only('kpi_evaluation');
SELECT p2_attach_guards('kpi_evaluation', false);
GRANT SELECT, INSERT ON kpi_evaluation TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- data_quality_finding (DataQualityFinding, REQ-S16-014): a data-quality exception found by a calculation run
-- (REQ-S07-005, REQ-S07-006 "Data becomes stale -> visible exception"). Inserted by the worker with its run id (lineage,
-- no audit event); a person's resolve or dismiss is versioned and audited (kpi_data_quality_finding_audit_on_update).
-- At most one open finding per KPI, scope, period and rule. Status machine: open -> resolved | dismissed (final).
CREATE TABLE data_quality_finding (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id   uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kpi_definition_id   uuid NOT NULL,
  scope_kind          text NOT NULL CHECK (scope_kind IN ('transformation', 'business_unit', 'initiative')),
  scope_id            uuid NOT NULL,
  reporting_period_id uuid NOT NULL,
  kpi_actual_id       uuid NULL,
  value_no            smallint NULL CHECK (value_no IS NULL OR value_no >= 1),
  rule_code           text NOT NULL CHECK (rule_code IN ('missing_actual', 'stale', 'out_of_range', 'evidence_missing',
                                                         'zero_denominator', 'not_comparable', 'negative_baseline', 'scope_missing')),
  severity            text NOT NULL CHECK (severity IN ('info', 'warning')),
  detail_params       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail_params) = 'object'),
  detected_by_run_id  uuid NOT NULL,
  detected_at         timestamptz NOT NULL DEFAULT now(),
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution_note     text NULL CHECK (resolution_note IS NULL OR char_length(resolution_note) BETWEEN 3 AND 2000),
  resolved_by         uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  resolved_at         timestamptz NULL,
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT data_quality_finding_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT data_quality_finding_kpi_fkey FOREIGN KEY (transformation_id, kpi_definition_id)
    REFERENCES kpi_definition (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT data_quality_finding_period_fkey FOREIGN KEY (organization_id, reporting_period_id)
    REFERENCES reporting_period (organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT data_quality_finding_actual_fkey FOREIGN KEY (transformation_id, kpi_actual_id)
    REFERENCES kpi_actual (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT data_quality_finding_run_fkey FOREIGN KEY (transformation_id, detected_by_run_id)
    REFERENCES calculation_run (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT data_quality_finding_value_ref CHECK (value_no IS NULL OR kpi_actual_id IS NOT NULL),
  CONSTRAINT data_quality_finding_resolution CHECK ((status = 'open') = (resolved_at IS NULL)
    AND (resolved_at IS NULL) = (resolved_by IS NULL) AND (resolved_at IS NULL) = (resolution_note IS NULL))
);
CREATE UNIQUE INDEX data_quality_finding_one_open ON data_quality_finding (kpi_definition_id, scope_kind, scope_id, reporting_period_id, rule_code)
  WHERE status = 'open';
CREATE INDEX data_quality_finding_transformation_idx ON data_quality_finding (transformation_id, status, detected_at DESC);
CREATE FUNCTION data_quality_finding_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' THEN
      RAISE EXCEPTION 'data_quality_finding: a finding is created open'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'data_quality_finding_status_step';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'open' OR NEW.status NOT IN ('resolved', 'dismissed')
     OR (to_jsonb(NEW) - ARRAY['status', 'resolution_note', 'resolved_by', 'resolved_at', 'version', 'updated_at', 'updated_by'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'resolution_note', 'resolved_by', 'resolved_at', 'version', 'updated_at', 'updated_by']) THEN
    RAISE EXCEPTION 'data_quality_finding: only open -> resolved | dismissed, with a note'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'data_quality_finding_status_step';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER data_quality_finding_guard BEFORE INSERT OR UPDATE ON data_quality_finding
  FOR EACH ROW EXECUTE FUNCTION data_quality_finding_guard();
SELECT p2_attach_guards('data_quality_finding', false);
-- A person's change is audited: the deferred audit-coverage constraint on UPDATE only (inserts are run lineage).
CREATE CONSTRAINT TRIGGER data_quality_finding_audit_required AFTER UPDATE ON data_quality_finding DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION p2_audit_required();
GRANT SELECT, INSERT, UPDATE ON data_quality_finding TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- rag_override: a manual RAG for one KPI, scope and period (REQ-S07-009). Reason, evidence and expiry are required
-- (NOT NULL); the calculated RAG at the time is preserved on the row, and evaluations keep being calculated. An override
-- is in force while status = 'active' and now() < expires_at; after expiry the calculated RAG is displayed (read rule,
-- ADR-0028 §6). At most one override in force per slot (guard under lock 730229). Status: active -> revoked (final).
CREATE TABLE rag_override (
  id                     uuid PRIMARY KEY,
  organization_id        uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id      uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kpi_definition_id      uuid NOT NULL,
  scope_kind             text NOT NULL CHECK (scope_kind IN ('transformation', 'business_unit', 'initiative')),
  scope_id               uuid NOT NULL,
  reporting_period_id    uuid NOT NULL,
  override_rag           text NOT NULL CHECK (override_rag IN ('green', 'amber', 'red')),
  calculated_rag         text NOT NULL CHECK (calculated_rag IN ('green', 'amber', 'red', 'unknown', 'stale', 'not_computable')),
  kpi_evaluation_id      uuid NULL REFERENCES kpi_evaluation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  reason                 text NOT NULL CHECK (char_length(btrim(reason)) >= 3 AND char_length(reason) <= 2000),
  evidence_id            uuid NOT NULL,
  expires_at             timestamptz NOT NULL,
  status                 text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  revoked_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  revoked_at             timestamptz NULL,
  revoke_reason          text NULL CHECK (revoke_reason IS NULL OR char_length(revoke_reason) BETWEEN 3 AND 1000),
  version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT rag_override_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT rag_override_kpi_fkey FOREIGN KEY (transformation_id, kpi_definition_id)
    REFERENCES kpi_definition (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT rag_override_period_fkey FOREIGN KEY (organization_id, reporting_period_id)
    REFERENCES reporting_period (organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT rag_override_evidence_fkey FOREIGN KEY (transformation_id, evidence_id)
    REFERENCES evidence (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT rag_override_expiry_window CHECK (expires_at > created_at AND expires_at <= created_at + interval '366 days'),
  CONSTRAINT rag_override_revoked CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)
    AND (revoked_at IS NULL) = (revoked_by IS NULL) AND (revoked_at IS NULL) = (revoke_reason IS NULL))
);
CREATE INDEX rag_override_slot_idx ON rag_override (kpi_definition_id, scope_kind, scope_id, reporting_period_id, expires_at DESC);
CREATE FUNCTION rag_override_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  kpi_actual_slot_lock_class CONSTANT integer := 730229;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'active' THEN
      RAISE EXCEPTION 'rag_override: an override is created active'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'rag_override_status_step';
    END IF;
    IF NOT p4_kpi_scope_valid(NEW.organization_id, NEW.transformation_id, NEW.scope_kind, NEW.scope_id) THEN
      RAISE EXCEPTION 'rag_override: scope % % is not in this transformation', NEW.scope_kind, NEW.scope_id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'rag_override_scope_valid';
    END IF;
    PERFORM pg_advisory_xact_lock(kpi_actual_slot_lock_class,
      hashtext(NEW.kpi_definition_id::text || ':' || NEW.scope_kind || ':' || NEW.scope_id::text || ':' || NEW.reporting_period_id::text));
    IF EXISTS (SELECT 1 FROM rag_override o
               WHERE o.kpi_definition_id = NEW.kpi_definition_id AND o.scope_kind = NEW.scope_kind AND o.scope_id = NEW.scope_id
                 AND o.reporting_period_id = NEW.reporting_period_id AND o.status = 'active' AND o.expires_at > now()) THEN
      RAISE EXCEPTION 'rag_override: an override is already in force for this KPI, scope and period'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'rag_override_one_in_force';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'active' OR NEW.status <> 'revoked'
     OR (to_jsonb(NEW) - ARRAY['status', 'revoked_by', 'revoked_at', 'revoke_reason', 'version', 'updated_at', 'updated_by'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'revoked_by', 'revoked_at', 'revoke_reason', 'version', 'updated_at', 'updated_by']) THEN
    RAISE EXCEPTION 'rag_override: an override is immutable; the only change is active -> revoked'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'rag_override_status_step';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rag_override_guard BEFORE INSERT OR UPDATE ON rag_override FOR EACH ROW EXECUTE FUNCTION rag_override_guard();
SELECT p2_attach_guards('rag_override', true);
GRANT SELECT, INSERT, UPDATE ON rag_override TO mth_app;
