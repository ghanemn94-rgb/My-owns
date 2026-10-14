-- 0074 P5 slice D: the automation engine (T-DG5-ARCH-03; ADR-0043; REQ-S12-001, REQ-S12-002, REQ-S12-003,
-- REQ-S12-020, REQ-S12-021, REQ-S12-022, REQ-S12-026). Authored by solution-architect.
-- Contract: docs/architecture/data-dictionary.md ("P5 tables, slices D and E"). Runs as mth_owner inside one
-- transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- Additive: new tables only; no DG1-DG4 table, constraint or function changes. A rule is an identity
-- (automation_rule) with versions (automation_rule_version); only a published version runs, and a published version's
-- content never changes. Executions, action results, dry runs and job runs are history. The failure queue
-- (operational_failure) holds rule executions and jobs that failed for good. Action types that are human decisions
-- (approvals, investment decisions, Finance attestations; M0242) are catalogued so they can be named and refused, and
-- the database refuses a rule version that uses one. Nothing here grants, decides or records a business approval, and
-- nothing reads or writes the engineering gates DG0-DG7.

-- -----------------------------------------------------------------------------------------------------------------
-- automation_trigger: the catalogue of triggers a rule can use (M0221 "event and schedule-driven"). 'event' = an
-- outbox event type; 'schedule' = a job_schedule code; 'request' = evaluated by the owning module inside the request
-- (starters only). condition_fields are the payload members a condition may test; initiating_user_field names the
-- payload member holding the user whose action raised the event (NULL: no initiating user, so the rule runs as the
-- service identity). Read-only to mth_app; rows come from migrations.
CREATE TABLE automation_trigger (
  code                  text PRIMARY KEY CHECK (code ~ '^[a-z_]+\.[a-z_.]+$' AND char_length(code) <= 100),
  trigger_kind          text NOT NULL CHECK (trigger_kind IN ('event', 'schedule', 'request')),
  owner_module          text NOT NULL CHECK (owner_module ~ '^[a-z_]+$'),
  label_en              text NOT NULL CHECK (char_length(label_en) BETWEEN 1 AND 200),
  label_ar              text NOT NULL CHECK (char_length(label_ar) BETWEEN 1 AND 200),
  condition_fields      text[] NOT NULL DEFAULT '{}' CHECK (cardinality(condition_fields) <= 30),
  initiating_user_field text NULL CHECK (initiating_user_field IS NULL OR initiating_user_field ~ '^[a-z][a-zA-Z0-9]{0,39}$'),
  admin_selectable      boolean NOT NULL,
  source_ref            text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 50),
  CONSTRAINT automation_trigger_request_starter_only CHECK (trigger_kind <> 'request' OR NOT admin_selectable),
  CONSTRAINT automation_trigger_schedule_no_user CHECK (trigger_kind <> 'schedule' OR initiating_user_field IS NULL)
);
GRANT SELECT ON automation_trigger TO mth_app;

-- automation_action_type: the action registry's catalogue (ADR-0043 §3). 'automatic' actions may run; 'human_only'
-- actions are listed only so the builder can name them and the engine can refuse them (REQ-S12-026, M0242).
-- required_permission_code is the permission the acting identity must hold in the target's scope (REQ-S12-003).
CREATE TABLE automation_action_type (
  code                     text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{2,63}$'),
  action_class             text NOT NULL CHECK (action_class IN ('automatic', 'human_only')),
  owner_module             text NOT NULL CHECK (owner_module ~ '^[a-z_]+$'),
  label_en                 text NOT NULL CHECK (char_length(label_en) BETWEEN 1 AND 200),
  label_ar                 text NOT NULL CHECK (char_length(label_ar) BETWEEN 1 AND 200),
  required_permission_code text NULL REFERENCES permission (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  admin_selectable         boolean NOT NULL,
  source_ref               text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 50),
  CONSTRAINT automation_action_type_human_never_selectable CHECK (action_class = 'automatic' OR NOT admin_selectable)
);
GRANT SELECT ON automation_action_type TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- automation_rule: the identity of one rule (M0221 "trigger, conditions, actions, scope, owner, effective version").
-- origin 'starter' = one of the sixteen M0224-M0239 starters (seeded by 0075, never created by the API); 'admin' =
-- authored in the rule builder. Scope: 'platform' (every organization; starters only), 'organization' or
-- 'transformation'. The owner is a person or, for starters, a role. disable_allowed = false marks a starter that
-- implements a DG2-DG4-approved guarantee (D-142 Q3): it can never be disabled.
CREATE TABLE automation_rule (
  id                   uuid PRIMARY KEY,
  code                 text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_.]{2,63}$'),
  origin               text NOT NULL CHECK (origin IN ('starter', 'admin')),
  source_ref           text NULL CHECK (source_ref IS NULL OR source_ref ~ '^M0[0-9]{3}$'),
  name_en              text NOT NULL CHECK (char_length(name_en) BETWEEN 1 AND 200),
  name_ar              text NOT NULL CHECK (char_length(name_ar) BETWEEN 1 AND 200),
  description_en       text NULL CHECK (description_en IS NULL OR char_length(description_en) BETWEEN 1 AND 2000),
  description_ar       text NULL CHECK (description_ar IS NULL OR char_length(description_ar) BETWEEN 1 AND 2000),
  scope_level          text NOT NULL CHECK (scope_level IN ('platform', 'organization', 'transformation')),
  organization_id      uuid NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id    uuid NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  owner_user_id        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  owner_role_code      text NULL REFERENCES role (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  enabled              boolean NOT NULL DEFAULT false,
  disable_allowed      boolean NOT NULL,
  disabled_reason      text NULL CHECK (disabled_reason IS NULL OR char_length(disabled_reason) BETWEEN 3 AND 1000),
  effective_version_id uuid NULL,
  version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT automation_rule_code_key UNIQUE (code),
  CONSTRAINT automation_rule_scope_complete CHECK (
    (scope_level = 'platform' AND organization_id IS NULL AND transformation_id IS NULL)
    OR (scope_level = 'organization' AND organization_id IS NOT NULL AND transformation_id IS NULL)
    OR (scope_level = 'transformation' AND organization_id IS NOT NULL AND transformation_id IS NOT NULL)),
  CONSTRAINT automation_rule_one_owner CHECK ((owner_user_id IS NULL) <> (owner_role_code IS NULL)),
  CONSTRAINT automation_rule_origin_shape CHECK (
    (origin = 'starter' AND source_ref IS NOT NULL AND scope_level = 'platform' AND owner_role_code IS NOT NULL)
    OR (origin = 'admin' AND source_ref IS NULL AND scope_level <> 'platform' AND owner_user_id IS NOT NULL AND disable_allowed)),
  -- D-142 Q3: a guarantee starter is always enabled.
  CONSTRAINT automation_rule_guarantee_kept CHECK (disable_allowed OR enabled),
  CONSTRAINT automation_rule_disabled_reason CHECK (NOT enabled OR disabled_reason IS NULL),
  -- A rule runs only with an effective (published) version.
  CONSTRAINT automation_rule_enabled_needs_version CHECK (NOT enabled OR effective_version_id IS NOT NULL)
);
CREATE INDEX automation_rule_scope_idx ON automation_rule (organization_id, transformation_id);

-- automation_rule_version: one version of a rule; it may name up to six triggers (e.g. M0231's two SLA scans). Status machine (trigger automation_rule_version_guard):
--   draft -> in_review | published (when no review is required) | discarded
--   in_review -> approved | draft (changes requested) | discarded
--   approved -> published | draft | discarded
--   published -> superseded (only when a newer version of the rule is published)
-- Content (trigger, conditions, actions, run_as, service permissions, parameters) changes only in 'draft'; any
-- content change resets the dry-run requirement because content_sha256 changes. Leaving 'draft' needs a 'pass' dry
-- run for exactly the current content_sha256 (REQ-S12-002 "dry-run preview"). conditions and actions are JSON arrays
-- validated by the API with the ADR-0043 §2 Zod schemas (never an unvalidated blob); action_types mirrors the action
-- codes so the database can refuse human-only actions (REQ-S12-026).
CREATE TABLE automation_rule_version (
  id                       uuid PRIMARY KEY,
  automation_rule_id       uuid NOT NULL REFERENCES automation_rule (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version_no               integer NOT NULL CHECK (version_no >= 1),
  status                   text NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'in_review', 'approved', 'published', 'superseded', 'discarded')),
  trigger_codes            text[] NOT NULL CHECK (cardinality(trigger_codes) BETWEEN 1 AND 6),
  conditions               jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(conditions) = 'array' AND jsonb_array_length(conditions) <= 20),
  actions                  jsonb NOT NULL CHECK (jsonb_typeof(actions) = 'array' AND jsonb_array_length(actions) BETWEEN 1 AND 10),
  action_types             text[] NOT NULL CHECK (cardinality(action_types) BETWEEN 1 AND 10),
  run_as                   text NOT NULL CHECK (run_as IN ('initiating_user', 'service')),
  service_permission_codes text[] NOT NULL DEFAULT '{}' CHECK (cardinality(service_permission_codes) <= 20),
  parameters               jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(parameters) = 'object'),
  content_sha256           text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  change_summary           text NULL CHECK (change_summary IS NULL OR char_length(change_summary) BETWEEN 3 AND 2000),
  authored_by              uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  submitted_at             timestamptz NULL,
  reviewed_by              uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  reviewed_at              timestamptz NULL,
  review_note              text NULL CHECK (review_note IS NULL OR char_length(review_note) BETWEEN 3 AND 2000),
  published_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  published_at             timestamptz NULL,
  superseded_at            timestamptz NULL,
  discarded_at             timestamptz NULL,
  version                  integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT automation_rule_version_no_key UNIQUE (automation_rule_id, version_no),
  CONSTRAINT automation_rule_version_rule_id_key UNIQUE (automation_rule_id, id),
  CONSTRAINT automation_rule_version_actions_match CHECK (jsonb_array_length(actions) = cardinality(action_types)),
  -- published_by is NULL only for the starter versions seeded by a migration.
  CONSTRAINT automation_rule_version_published_complete CHECK (
    (status IN ('published', 'superseded')) = (published_at IS NOT NULL) AND (published_by IS NULL OR published_at IS NOT NULL)),
  CONSTRAINT automation_rule_version_superseded_complete CHECK ((status = 'superseded') = (superseded_at IS NOT NULL)),
  CONSTRAINT automation_rule_version_discarded_complete CHECK ((status = 'discarded') = (discarded_at IS NOT NULL)),
  CONSTRAINT automation_rule_version_reviewed_complete CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL)),
  -- A configuration review is a second person's check, not a business approval (ADR-0039 §5 precedent).
  CONSTRAINT automation_rule_version_review_sod CHECK (reviewed_by IS NULL OR authored_by IS NULL OR reviewed_by <> authored_by),
  -- A schedule-triggered rule has nobody who initiated it.
  CONSTRAINT automation_rule_version_service_permissions CHECK (run_as = 'service' OR cardinality(service_permission_codes) = 0)
);
CREATE UNIQUE INDEX automation_rule_version_one_open_key ON automation_rule_version (automation_rule_id)
  WHERE status IN ('draft', 'in_review', 'approved');
-- One published (effective) version per rule, checked at COMMIT so a publish can insert the new published state before
-- it supersedes the old one in the same transaction (ADR-0043 §4).
ALTER TABLE automation_rule_version ADD CONSTRAINT automation_rule_version_one_published
  EXCLUDE USING btree (automation_rule_id WITH =) WHERE (status = 'published') DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE automation_rule ADD CONSTRAINT automation_rule_effective_version_fkey
  FOREIGN KEY (id, effective_version_id) REFERENCES automation_rule_version (automation_rule_id, id)
  ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;

-- automation_dry_run: a dry run of one rule version against a sample event (REQ-S12-002). It evaluates conditions and
-- plans actions through the registry's read-only planners; it never writes a business record, a work item or a
-- notification. Append-only history; one audit event each.
CREATE TABLE automation_dry_run (
  id                         uuid PRIMARY KEY,
  automation_rule_version_id uuid NOT NULL REFERENCES automation_rule_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  content_sha256             text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  sample_event               jsonb NOT NULL CHECK (jsonb_typeof(sample_event) = 'object'),
  outcome                    text NOT NULL CHECK (outcome IN ('pass', 'fail')),
  conditions_met             boolean NULL,
  planned_actions            jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(planned_actions) = 'array' AND jsonb_array_length(planned_actions) <= 10),
  findings                   jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(findings) = 'array' AND jsonb_array_length(findings) <= 50),
  run_by                     uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_dry_run_fail_has_finding CHECK (outcome = 'pass' OR jsonb_array_length(findings) >= 1)
);
CREATE INDEX automation_dry_run_version_idx ON automation_dry_run (automation_rule_version_id, created_at DESC, id DESC);

CREATE FUNCTION automation_rule_version_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  r record;
  t record;
  bad text;
  is_owner boolean := current_user = 'mth_owner' OR current_user IN (SELECT rolname FROM pg_roles WHERE rolsuper);
BEGIN
  SELECT a.origin, a.code INTO r FROM automation_rule a WHERE a.id = NEW.automation_rule_id;
  -- Every trigger is catalogued (an array cannot carry a foreign key).
  SELECT string_agg(u.code, ', ') INTO bad FROM unnest(NEW.trigger_codes) AS u(code)
    LEFT JOIN automation_trigger g ON g.code = u.code WHERE g.code IS NULL;
  IF bad IS NOT NULL OR (SELECT count(DISTINCT u.code) FROM unnest(NEW.trigger_codes) AS u(code)) <> cardinality(NEW.trigger_codes) THEN
    RAISE EXCEPTION 'automation_rule_version: trigger % is unknown or repeated', coalesce(bad, '(repeated)')
      USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'automation_rule_version_trigger_known';
  END IF;
  SELECT bool_and(g.admin_selectable) AS admin_selectable, bool_and(g.initiating_user_field IS NOT NULL) AS has_user
    INTO t FROM automation_trigger g WHERE g.code = ANY (NEW.trigger_codes);
  -- REQ-S12-026: a human decision is never an automated action.
  SELECT string_agg(c.code, ', ') INTO bad FROM unnest(NEW.action_types) AS u(code)
    LEFT JOIN automation_action_type c ON c.code = u.code
    WHERE c.code IS NULL OR c.action_class = 'human_only';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'automation_rule_version: action % is unknown or a human decision (M0242)', bad
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_human_only';
  END IF;
  -- An admin rule uses admin-selectable triggers and actions only; starter versions are seeded by migrations.
  IF r.origin = 'admin' THEN
    IF NOT t.admin_selectable OR EXISTS (SELECT 1 FROM unnest(NEW.action_types) AS u(code)
         JOIN automation_action_type c ON c.code = u.code WHERE NOT c.admin_selectable) THEN
      RAISE EXCEPTION 'automation_rule_version: an admin rule uses a starter-only trigger or action'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_admin_catalogue';
    END IF;
  ELSE
    IF TG_OP = 'INSERT' AND NOT is_owner AND NEW.version_no = 1 THEN
      RAISE EXCEPTION 'automation_rule_version: version 1 of a starter is seeded by a migration'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_starter_seed';
    END IF;
    -- D-142 Q3: a starter keeps its trigger and its handler, and takes no condition (a condition could suppress a
    -- guarantee); only its declared parameters change in a new version (ADR-0044 §1).
    IF NEW.conditions <> '[]'::jsonb OR NEW.action_types <> ARRAY['starter_handler'] OR NEW.trigger_codes IS DISTINCT FROM
         coalesce((SELECT v.trigger_codes FROM automation_rule_version v WHERE v.automation_rule_id = NEW.automation_rule_id
                     AND v.version_no = 1), NEW.trigger_codes) THEN
      RAISE EXCEPTION 'automation_rule_version: a starter keeps its trigger and handler and has no conditions'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_starter_fixed';
    END IF;
  END IF;
  -- Running as the initiating user needs a trigger that names one (REQ-S12-003).
  IF NEW.run_as = 'initiating_user' AND NOT t.has_user THEN
    RAISE EXCEPTION 'automation_rule_version: a trigger of % has no initiating user', NEW.trigger_codes
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_initiating_user';
  END IF;
  -- A service identity never holds a business-approval or Finance-validation permission (REQ-S10-003, REQ-S12-026).
  SELECT string_agg(u.code, ', ') INTO bad FROM unnest(NEW.service_permission_codes) AS u(code)
    LEFT JOIN permission p ON p.code = u.code
    WHERE p.code IS NULL OR p.category IN ('business_approval', 'finance_validation');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'automation_rule_version: service permission % is unknown or an approval right', bad
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_service_permission';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.version_no <> coalesce((SELECT max(v.version_no) FROM automation_rule_version v
                                   WHERE v.automation_rule_id = NEW.automation_rule_id), 0) + 1 THEN
      RAISE EXCEPTION 'automation_rule_version: version_no must be the next number of the rule'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_next_number';
    END IF;
    IF NEW.status <> 'draft' AND NOT is_owner THEN
      RAISE EXCEPTION 'automation_rule_version: a new version starts as a draft'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_transition';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.automation_rule_id IS DISTINCT FROM OLD.automation_rule_id OR NEW.version_no IS DISTINCT FROM OLD.version_no
     OR NEW.authored_by IS DISTINCT FROM OLD.authored_by THEN
    RAISE EXCEPTION 'automation_rule_version: rule, number and author never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_identity_fixed';
  END IF;
  IF OLD.status <> 'draft' AND (NEW.trigger_codes, NEW.conditions, NEW.actions, NEW.action_types, NEW.run_as,
       NEW.service_permission_codes, NEW.parameters, NEW.content_sha256)
     IS DISTINCT FROM (OLD.trigger_codes, OLD.conditions, OLD.actions, OLD.action_types, OLD.run_as,
       OLD.service_permission_codes, OLD.parameters, OLD.content_sha256) THEN
    RAISE EXCEPTION 'automation_rule_version: content changes only in a draft (published versions are immutable)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_content_frozen';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'draft' AND NEW.status IN ('in_review', 'published', 'discarded'))
       OR (OLD.status = 'in_review' AND NEW.status IN ('approved', 'draft', 'discarded'))
       OR (OLD.status = 'approved' AND NEW.status IN ('published', 'draft', 'discarded'))
       OR (OLD.status = 'published' AND NEW.status = 'superseded')) THEN
    RAISE EXCEPTION 'automation_rule_version: % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_transition';
  END IF;
  -- Leaving a draft needs a pass dry run for exactly this content (REQ-S12-002).
  IF OLD.status = 'draft' AND NEW.status IN ('in_review', 'published') AND NOT EXISTS (
       SELECT 1 FROM automation_dry_run d WHERE d.automation_rule_version_id = NEW.id
         AND d.content_sha256 = NEW.content_sha256 AND d.outcome = 'pass') THEN
    RAISE EXCEPTION 'automation_rule_version: no pass dry run for the current content'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_dry_run_required';
  END IF;
  -- Review where configured (config_review_policy 'automation_rule_set', ADR-0039 §5): publishing straight from a
  -- draft is allowed only when the policy requires no review.
  IF OLD.status = 'draft' AND NEW.status = 'published'
     AND coalesce((SELECT p.review_required FROM config_review_policy p WHERE p.config_kind = 'automation_rule_set'), true) THEN
    RAISE EXCEPTION 'automation_rule_version: the configured review is required before publish'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_review_required';
  END IF;
  IF OLD.status = 'in_review' AND NEW.status = 'approved' AND NEW.reviewed_by IS NULL THEN
    RAISE EXCEPTION 'automation_rule_version: an approved review names its reviewer'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_reviewed_complete';
  END IF;
  -- A superseded version is replaced by the newer published version in the same transaction.
  IF NEW.status = 'superseded' AND OLD.status = 'published' AND NOT EXISTS (
       SELECT 1 FROM automation_rule_version v WHERE v.automation_rule_id = NEW.automation_rule_id
         AND v.version_no > NEW.version_no AND v.status = 'published') THEN
    RAISE EXCEPTION 'automation_rule_version: only a newer published version supersedes this one'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_transition';
  END IF;
  RETURN NEW;
END $$;
-- Statement order of a publish (ADR-0043 §4): the new version -> 'published'; the rule's effective_version_id -> the new
-- version; the old version -> 'superseded'. The one-published exclusion is checked at COMMIT.
CREATE TRIGGER automation_rule_version_guard BEFORE INSERT OR UPDATE ON automation_rule_version
  FOR EACH ROW EXECUTE FUNCTION automation_rule_version_guard();
SELECT p2_attach_guards('automation_rule_version', true);
GRANT SELECT, INSERT, UPDATE ON automation_rule_version TO mth_app;

CREATE FUNCTION automation_rule_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  is_owner boolean := current_user = 'mth_owner' OR current_user IN (SELECT rolname FROM pg_roles WHERE rolsuper);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.origin = 'starter' AND NOT is_owner THEN
      RAISE EXCEPTION 'automation_rule: starters are seeded by migrations'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_starter_seed';
    END IF;
  ELSIF (NEW.code, NEW.origin, NEW.source_ref, NEW.scope_level, NEW.disable_allowed)
        IS DISTINCT FROM (OLD.code, OLD.origin, OLD.source_ref, OLD.scope_level, OLD.disable_allowed) THEN
    RAISE EXCEPTION 'automation_rule: code, origin, source, scope level and the guarantee flag never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_identity_fixed';
  END IF;
  IF NEW.transformation_id IS NOT NULL AND (SELECT t.organization_id FROM transformation t WHERE t.id = NEW.transformation_id)
       IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'automation_rule: organization_id must equal the transformation''s organization'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_organization_matches';
  END IF;
  IF NEW.owner_role_code IS NOT NULL AND EXISTS (SELECT 1 FROM role x WHERE x.code = NEW.owner_role_code AND x.code = 'AUD') THEN
    RAISE EXCEPTION 'automation_rule: the auditor role never owns a rule'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_owner_not_auditor';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER automation_rule_guard BEFORE INSERT OR UPDATE ON automation_rule
  FOR EACH ROW EXECUTE FUNCTION automation_rule_guard();
-- At COMMIT: the effective version is the published version of this rule (deferred, because a starter and its seeded
-- version 1 reference each other, and a publish moves both rows in one transaction).
CREATE FUNCTION automation_rule_effective_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  cur record;
BEGIN
  SELECT a.effective_version_id INTO cur FROM automation_rule a WHERE a.id = NEW.id;
  IF cur.effective_version_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM automation_rule_version v WHERE v.id = cur.effective_version_id
         AND v.automation_rule_id = NEW.id AND v.status = 'published') THEN
    RAISE EXCEPTION 'automation_rule: the effective version must be the published version of the rule'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_effective_published';
  END IF;
  IF cur.effective_version_id IS NULL AND EXISTS (
       SELECT 1 FROM automation_rule_version v WHERE v.automation_rule_id = NEW.id AND v.status = 'published') THEN
    RAISE EXCEPTION 'automation_rule: a rule with a published version names it as its effective version'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_effective_published';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER automation_rule_effective_check AFTER INSERT OR UPDATE ON automation_rule
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION automation_rule_effective_check();
SELECT p2_attach_guards('automation_rule', true);
GRANT SELECT, INSERT, UPDATE ON automation_rule TO mth_app;

CREATE FUNCTION automation_dry_run_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM automation_rule_version v WHERE v.id = NEW.automation_rule_version_id
                   AND v.status = 'draft' AND v.content_sha256 = NEW.content_sha256) THEN
    RAISE EXCEPTION 'automation_dry_run: a dry run tests the current content of a draft version'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_dry_run_current_draft';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER automation_dry_run_guard BEFORE INSERT ON automation_dry_run
  FOR EACH ROW EXECUTE FUNCTION automation_dry_run_guard();
SELECT p2_attach_append_only('automation_dry_run');
SELECT p2_attach_guards('automation_dry_run', true);
GRANT SELECT, INSERT ON automation_dry_run TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- automation_execution: one evaluation of one rule version for one trigger occurrence (REQ-S12-001 "each execution is
-- recorded with rule version, trigger event and outcome"). trigger_key is the outbox event's idempotency key, the
-- schedule slot `<schedule code>:<ISO minute>` or the request key; UNIQUE (rule version, trigger key) is the
-- exactly-once backstop behind lock 730258 (REQ-S12-021). Status machine (trigger automation_execution_guard):
--   running -> succeeded | skipped (conditions not met) | failed
--   failed  -> running (a retry from the failure queue; attempt_no + 1)
CREATE TABLE automation_execution (
  id                         uuid PRIMARY KEY,
  automation_rule_id         uuid NOT NULL,
  automation_rule_version_id uuid NOT NULL,
  trigger_code               text NOT NULL REFERENCES automation_trigger (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  trigger_key                text NOT NULL CHECK (char_length(trigger_key) BETWEEN 1 AND 200),
  trigger_payload            jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(trigger_payload) = 'object'),
  organization_id            uuid NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id          uuid NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  run_as                     text NOT NULL CHECK (run_as IN ('initiating_user', 'service')),
  initiating_user_id         uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status                     text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'skipped', 'failed')),
  conditions_met             boolean NULL,
  attempt_no                 smallint NOT NULL DEFAULT 1 CHECK (attempt_no BETWEEN 1 AND 100),
  error_code                 text NULL CHECK (error_code IS NULL OR error_code ~ '^[a-z_]+\.[a-z_.]+$'),
  error_detail               text NULL CHECK (error_detail IS NULL OR char_length(error_detail) BETWEEN 1 AND 2000),
  started_at                 timestamptz NOT NULL DEFAULT now(),
  finished_at                timestamptz NULL,
  version                    integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  updated_by                 uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT automation_execution_rule_version_fkey FOREIGN KEY (automation_rule_id, automation_rule_version_id)
    REFERENCES automation_rule_version (automation_rule_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT automation_execution_once_key UNIQUE (automation_rule_version_id, trigger_key),
  CONSTRAINT automation_execution_finished_complete CHECK ((status = 'running') = (finished_at IS NULL)),
  CONSTRAINT automation_execution_failed_complete CHECK ((status = 'failed') = (error_code IS NOT NULL)),
  CONSTRAINT automation_execution_skipped_complete CHECK (status <> 'skipped' OR conditions_met IS FALSE),
  CONSTRAINT automation_execution_identity CHECK ((run_as = 'initiating_user') = (initiating_user_id IS NOT NULL)),
  CONSTRAINT automation_execution_scope CHECK (transformation_id IS NULL OR organization_id IS NOT NULL)
);
CREATE INDEX automation_execution_rule_idx ON automation_execution (automation_rule_id, started_at DESC, id DESC);
CREATE INDEX automation_execution_status_idx ON automation_execution (status, started_at DESC) WHERE status IN ('running', 'failed');
CREATE FUNCTION automation_execution_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'running' OR NEW.attempt_no <> 1 THEN
      RAISE EXCEPTION 'automation_execution: an execution starts running at attempt 1'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_execution_transition';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM automation_rule_version v WHERE v.id = NEW.automation_rule_version_id
                     AND v.status IN ('published', 'superseded') AND NEW.trigger_code = ANY (v.trigger_codes)) THEN
      RAISE EXCEPTION 'automation_execution: only a published version runs, on its own trigger'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_execution_published_version';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.automation_rule_id, NEW.automation_rule_version_id, NEW.trigger_code, NEW.trigger_key, NEW.trigger_payload,
      NEW.organization_id, NEW.transformation_id, NEW.run_as, NEW.initiating_user_id)
     IS DISTINCT FROM (OLD.automation_rule_id, OLD.automation_rule_version_id, OLD.trigger_code, OLD.trigger_key,
      OLD.trigger_payload, OLD.organization_id, OLD.transformation_id, OLD.run_as, OLD.initiating_user_id) THEN
    RAISE EXCEPTION 'automation_execution: rule, version, trigger, scope and identity never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_execution_identity_fixed';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'running' AND NEW.status IN ('succeeded', 'skipped', 'failed'))
       OR (OLD.status = 'failed' AND NEW.status = 'running' AND NEW.attempt_no = OLD.attempt_no + 1)) THEN
    RAISE EXCEPTION 'automation_execution: % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_execution_transition';
  END IF;
  IF NEW.status = OLD.status AND NEW.attempt_no <> OLD.attempt_no THEN
    RAISE EXCEPTION 'automation_execution: the attempt number changes only on a retry'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_execution_transition';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER automation_execution_guard BEFORE INSERT OR UPDATE ON automation_execution
  FOR EACH ROW EXECUTE FUNCTION automation_execution_guard();
SELECT p2_attach_guards('automation_execution', true);
GRANT SELECT, INSERT, UPDATE ON automation_execution TO mth_app;

-- automation_action_result: the outcome of one action of one execution attempt (append-only). idempotency_key is
-- `<rule code>:<trigger key>:<action ordinal>`; the partial UNIQUE makes a second effective outcome for the same key
-- impossible, so a retry or a replay never repeats a side effect (REQ-S12-021). 'existing' = the effect was already
-- there (the domain's own dedupe key found it). 'forbidden' = the acting identity lacked the permission or the target
-- was outside the rule's scope (REQ-S12-003).
CREATE TABLE automation_action_result (
  id                      uuid PRIMARY KEY,
  automation_execution_id uuid NOT NULL REFERENCES automation_execution (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  attempt_no              smallint NOT NULL CHECK (attempt_no BETWEEN 1 AND 100),
  ordinal                 smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 10),
  action_type             text NOT NULL REFERENCES automation_action_type (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  idempotency_key         text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  outcome                 text NOT NULL CHECK (outcome IN ('done', 'existing', 'skipped', 'failed', 'forbidden')),
  result_record_type      text NULL CHECK (result_record_type IS NULL OR result_record_type ~ '^[a-z_]+$'),
  result_record_id        uuid NULL,
  error_code              text NULL CHECK (error_code IS NULL OR error_code ~ '^[a-z_]+\.[a-z_.]+$'),
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_action_result_attempt_key UNIQUE (automation_execution_id, attempt_no, ordinal),
  CONSTRAINT automation_action_result_error_complete CHECK ((outcome IN ('failed', 'forbidden')) = (error_code IS NOT NULL)),
  CONSTRAINT automation_action_result_record_complete CHECK ((result_record_type IS NULL) = (result_record_id IS NULL))
);
CREATE UNIQUE INDEX automation_action_result_effect_once_key ON automation_action_result (idempotency_key)
  WHERE outcome = 'done';
CREATE FUNCTION automation_action_result_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  e record;
BEGIN
  SELECT x.status, x.attempt_no INTO e FROM automation_execution x WHERE x.id = NEW.automation_execution_id;
  IF e.status IS DISTINCT FROM 'running' OR e.attempt_no IS DISTINCT FROM NEW.attempt_no THEN
    RAISE EXCEPTION 'automation_action_result: results are recorded only for the running attempt of an execution'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_action_result_running_attempt';
  END IF;
  -- REQ-S12-026 again at the effect: a human-only action type never has a result.
  IF EXISTS (SELECT 1 FROM automation_action_type c WHERE c.code = NEW.action_type AND c.action_class = 'human_only') THEN
    RAISE EXCEPTION 'automation_action_result: % is a human decision', NEW.action_type
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_action_result_human_only';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER automation_action_result_guard BEFORE INSERT ON automation_action_result
  FOR EACH ROW EXECUTE FUNCTION automation_action_result_guard();
SELECT p2_attach_append_only('automation_action_result');
SELECT p2_attach_guards('automation_action_result', true);
GRANT SELECT, INSERT ON automation_action_result TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- job_run: one finished run of a scheduled job (REQ-S12-022 "store scheduled runs and execution outcomes"). Written by
-- the worker once per pg-boss job id when the handler returns or fails for good; append-only operational history like
-- processed_message (no audit event: it records the worker's own run, not a change to a business record).
CREATE TABLE job_run (
  id                uuid PRIMARY KEY,
  job_schedule_code text NOT NULL REFERENCES job_schedule (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  job_id            text NOT NULL CHECK (char_length(job_id) BETWEEN 1 AND 100),
  attempt_no        smallint NOT NULL CHECK (attempt_no BETWEEN 1 AND 100),
  outcome           text NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
  started_at        timestamptz NOT NULL,
  finished_at       timestamptz NOT NULL,
  error_code        text NULL CHECK (error_code IS NULL OR char_length(error_code) BETWEEN 1 AND 100),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_run_job_attempt_key UNIQUE (job_id, attempt_no),
  CONSTRAINT job_run_times CHECK (finished_at >= started_at),
  CONSTRAINT job_run_error_complete CHECK ((outcome = 'failed') = (error_code IS NOT NULL))
);
CREATE INDEX job_run_schedule_idx ON job_run (job_schedule_code, finished_at DESC, id DESC);
CREATE INDEX job_run_last_success_idx ON job_run (job_schedule_code, finished_at DESC) WHERE outcome = 'succeeded';
SELECT p2_attach_append_only('job_run');
SELECT p2_attach_guards('job_run', false);
GRANT SELECT, INSERT ON job_run TO mth_app;

-- operational_failure: the failure queue (REQ-S12-002, REQ-S12-020, REQ-S12-022; M0239 "a visible operational
-- exception"). One open row per (source, queue, idempotency key). 'rule_execution' rows point at the failed
-- execution; 'job' rows keep the queue, the original job data and its idempotency key so a retry re-sends exactly the
-- same work (the handlers' runOnce ledgers make it exactly once). Status machine (trigger operational_failure_guard):
--   open -> retrying | dismissed
--   retrying -> resolved (the retry succeeded) | open (it failed again; retry_count + 1)
CREATE TABLE operational_failure (
  id                      uuid PRIMARY KEY,
  source                  text NOT NULL CHECK (source IN ('rule_execution', 'job')),
  organization_id         uuid NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  automation_execution_id uuid NULL REFERENCES automation_execution (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  job_schedule_code       text NULL REFERENCES job_schedule (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  queue_name              text NOT NULL CHECK (queue_name ~ '^[a-z_]+\.[a-z_.]+$' AND char_length(queue_name) <= 100),
  job_id                  text NULL CHECK (job_id IS NULL OR char_length(job_id) BETWEEN 1 AND 100),
  idempotency_key         text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  job_data                jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(job_data) = 'object'),
  error_code              text NOT NULL CHECK (char_length(error_code) BETWEEN 1 AND 100),
  error_message           text NOT NULL CHECK (char_length(error_message) BETWEEN 1 AND 2000),
  attempts                smallint NOT NULL CHECK (attempts BETWEEN 1 AND 100),
  first_failed_at         timestamptz NOT NULL,
  last_failed_at          timestamptz NOT NULL,
  status                  text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'retrying', 'resolved', 'dismissed')),
  retry_count             smallint NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 20),
  last_retry_by           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  last_retry_at           timestamptz NULL,
  resolved_at             timestamptz NULL,
  dismissed_by            uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  dismissed_at            timestamptz NULL,
  dismiss_reason          text NULL CHECK (dismiss_reason IS NULL OR char_length(dismiss_reason) BETWEEN 3 AND 1000),
  version                 integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT operational_failure_source_shape CHECK (
    (source = 'rule_execution' AND automation_execution_id IS NOT NULL AND organization_id IS NOT NULL)
    OR (source = 'job' AND automation_execution_id IS NULL)),
  CONSTRAINT operational_failure_times CHECK (last_failed_at >= first_failed_at),
  CONSTRAINT operational_failure_resolved_complete CHECK ((status = 'resolved') = (resolved_at IS NOT NULL)),
  CONSTRAINT operational_failure_dismissed_complete CHECK (
    (status = 'dismissed') = (dismissed_at IS NOT NULL)
    AND (dismissed_at IS NULL) = (dismissed_by IS NULL) AND (dismissed_at IS NULL) = (dismiss_reason IS NULL)),
  CONSTRAINT operational_failure_retry_complete CHECK ((last_retry_at IS NULL) = (last_retry_by IS NULL)
                                                       AND (retry_count = 0) = (last_retry_at IS NULL))
);
CREATE UNIQUE INDEX operational_failure_one_open_key ON operational_failure (source, queue_name, idempotency_key)
  WHERE status IN ('open', 'retrying');
CREATE INDEX operational_failure_status_idx ON operational_failure (status, last_failed_at DESC, id DESC);
CREATE INDEX operational_failure_schedule_idx ON operational_failure (job_schedule_code, status);
CREATE FUNCTION operational_failure_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' OR NEW.retry_count <> 0 THEN
      RAISE EXCEPTION 'operational_failure: a failure enters the queue open'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'operational_failure_transition';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.source, NEW.organization_id, NEW.automation_execution_id, NEW.job_schedule_code, NEW.queue_name,
      NEW.idempotency_key, NEW.job_data, NEW.first_failed_at)
     IS DISTINCT FROM (OLD.source, OLD.organization_id, OLD.automation_execution_id, OLD.job_schedule_code,
      OLD.queue_name, OLD.idempotency_key, OLD.job_data, OLD.first_failed_at) THEN
    RAISE EXCEPTION 'operational_failure: the failed work and its idempotency key never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'operational_failure_identity_fixed';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'open' AND NEW.status IN ('retrying', 'dismissed'))
       OR (OLD.status = 'retrying' AND NEW.status IN ('resolved', 'open'))) THEN
    RAISE EXCEPTION 'operational_failure: % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'operational_failure_transition';
  END IF;
  IF OLD.status = 'open' AND NEW.status = 'retrying' AND NEW.retry_count <> OLD.retry_count + 1 THEN
    RAISE EXCEPTION 'operational_failure: each retry counts once'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'operational_failure_retry_count';
  END IF;
  IF NOT (OLD.status = 'open' AND NEW.status = 'retrying') AND NEW.retry_count <> OLD.retry_count THEN
    RAISE EXCEPTION 'operational_failure: the retry count changes only when a retry starts'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'operational_failure_retry_count';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER operational_failure_guard BEFORE INSERT OR UPDATE ON operational_failure
  FOR EACH ROW EXECUTE FUNCTION operational_failure_guard();
SELECT p2_attach_guards('operational_failure', true);
GRANT SELECT, INSERT, UPDATE ON operational_failure TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- Catalogue seeds. Labels are product texts; Arabic labels are PROVISIONAL translations needing review.
INSERT INTO automation_trigger (code, trigger_kind, owner_module, label_en, label_ar, condition_fields, initiating_user_field, admin_selectable, source_ref) VALUES
  ('transformation.created', 'event', 'transformations', 'New transformation created', 'إنشاء تحوّل جديد', '{mode,entryPhase}', 'createdBy', true, 'M0224'),
  ('kpi.reporting_period_open', 'schedule', 'kpi', 'Reporting period opens or update is due', 'فتح فترة التقارير أو استحقاق التحديث', '{}', NULL, false, 'M0225'),
  ('kpi.actual_accepted', 'event', 'kpi', 'Accepted KPI actual changes', 'تغيّر قيمة فعلية مقبولة لمؤشر أداء', '{kpiId,periodLabel}', NULL, true, 'M0226'),
  ('kpi.deviation_evaluated', 'event', 'kpi', 'KPI deviates from trajectory', 'انحراف مؤشر الأداء عن المسار', '{kpiId,severity,persistedPeriods}', NULL, true, 'M0227'),
  ('gate.submission_requested', 'request', 'workflows', 'Gate submission requested (mandatory evidence check)', 'طلب تقديم بوابة (فحص الأدلة الإلزامية)', '{}', NULL, false, 'M0228'),
  ('gate.submitted', 'event', 'workflows', 'Valid gate submission', 'تقديم بوابة صالح', '{gateCode}', NULL, true, 'M0229'),
  ('gate.decided', 'event', 'workflows', 'Gate decided', 'البت في البوابة', '{gateCode,outcome}', NULL, true, 'M0230'),
  ('governance.decision_sla_scan', 'schedule', 'governance', 'Decision SLA expires', 'انقضاء مهلة اتخاذ القرار', '{}', NULL, false, 'M0231'),
  ('approval.escalation_scan', 'schedule', 'workflows', 'Approval SLA expires', 'انقضاء مهلة الموافقة', '{}', NULL, false, 'M0231'),
  ('dependency.slipped', 'event', 'portfolio', 'Critical dependency slips', 'تأخر اعتمادية حرجة', '{dependencyId,slipDays}', NULL, true, 'M0232'),
  ('blocker_status.recorded', 'event', 'governance', 'Blocker status recorded', 'تسجيل حالة عائق', '{status}', NULL, true, 'M0233'),
  ('governance.blocker_escalation_scan', 'schedule', 'governance', 'Blocker remains red across configured cycles', 'استمرار العائق باللون الأحمر عبر الدورات المحددة', '{}', NULL, false, 'M0233'),
  ('benefit.evidence_submitted', 'event', 'benefits', 'Benefit evidence submitted', 'تقديم أدلة المنفعة', '{benefitId}', NULL, true, 'M0234'),
  ('governance.meeting_cutoff_scan', 'schedule', 'governance', 'Meeting cut-off reached', 'بلوغ موعد الإقفال للاجتماع', '{}', NULL, false, 'M0235'),
  ('adoption.check_failed', 'event', 'adoption', 'Adoption check fails', 'إخفاق فحص التبني', '{}', NULL, true, 'M0236'),
  ('control_check.failed', 'event', 'sustainment', 'Control check fails', 'إخفاق فحص الضوابط', '{}', NULL, true, 'M0236'),
  ('bau_handover.accept_requested', 'request', 'sustainment', 'BAU handover accepted', 'قبول التسليم إلى العمليات الاعتيادية', '{}', NULL, false, 'M0237'),
  ('methodology.revision_proposed', 'request', 'methodology', 'Methodology or formula revision is proposed', 'اقتراح مراجعة للمنهجية أو المعادلة', '{}', NULL, false, 'M0238'),
  ('job.failed', 'event', 'jobs', 'Connector or job fails', 'إخفاق موصل أو مهمة', '{queueName}', NULL, false, 'M0239'),
  ('procedure_step.activated', 'event', 'procedures', 'Procedure step activated', 'تفعيل خطوة إجراء', '{stepKey,dueDate}', NULL, true, 'M0152'),
  ('automation.tick_hourly', 'schedule', 'automation', 'Every hour', 'كل ساعة', '{}', NULL, true, 'M0221'),
  ('automation.tick_daily', 'schedule', 'automation', 'Every day', 'كل يوم', '{}', NULL, true, 'M0221');

-- Action types. The 'starter.*' actions call the DG4/P5 handler of their starter unchanged (ADR-0044 §1); the
-- human-only rows exist only to be refused by name.
INSERT INTO automation_action_type (code, action_class, owner_module, label_en, label_ar, required_permission_code, admin_selectable, source_ref) VALUES
  ('create_task', 'automatic', 'tasks', 'Create a task with an in-app reminder', 'إنشاء مهمة مع تذكير داخل التطبيق', NULL, true, 'M0225'),
  ('notify', 'automatic', 'tasks', 'Send an in-app notification', 'إرسال إشعار داخل التطبيق', NULL, true, 'M0241'),
  ('escalate', 'automatic', 'tasks', 'Escalate to a role with an in-app notification', 'التصعيد إلى دور مع إشعار داخل التطبيق', NULL, true, 'M0231'),
  ('launch_procedure', 'automatic', 'procedures', 'Launch a procedure', 'إطلاق إجراء', 'procedure.launch', true, 'M0152'),
  ('starter_handler', 'automatic', 'automation', 'Run the starter automation''s handler', 'تشغيل معالج الأتمتة المبدئية', NULL, false, 'M0222'),
  ('approve_gate', 'human_only', 'workflows', 'Approve a gate', 'اعتماد بوابة', NULL, false, 'M0242'),
  ('decide_approval', 'human_only', 'workflows', 'Decide an approval', 'البت في موافقة', NULL, false, 'M0242'),
  ('decide_investment', 'human_only', 'portfolio', 'Make an investment or funding decision', 'اتخاذ قرار استثمار أو تمويل', NULL, false, 'M0242'),
  ('attest_finance_value', 'human_only', 'benefits', 'Attest or validate a value for Finance', 'المصادقة على قيمة أو التحقق منها للمالية', NULL, false, 'M0242'),
  ('decide_executive_ask', 'human_only', 'governance', 'Decide an executive ask', 'البت في طلب تنفيذي', NULL, false, 'M0242'),
  ('approve_methodology_migration', 'human_only', 'methodology', 'Approve a methodology migration', 'اعتماد ترحيل المنهجية', NULL, false, 'M0242');

-- Schedules of the engine (ADR-0043 §6). Audited like 0028's seeds (actor 'system', source 'migration').
INSERT INTO job_schedule (id, code, queue_name, cron, timezone, description_en, description_ar, owner_module) VALUES
  ('01920005-0074-7000-8000-000000000001', 'automation.tick_hourly', 'automation.tick_hourly', '7 * * * *', 'Asia/Riyadh', 'Evaluate the hourly admin automation rules once per hour; never approves.', 'تقييم قواعد الأتمتة الساعية مرة كل ساعة؛ لا يعتمد أبداً.', 'automation'),
  ('01920005-0074-7000-8000-000000000002', 'automation.tick_daily', 'automation.tick_daily', '20 0 * * *', 'Asia/Riyadh', 'Evaluate the daily admin automation rules once per day; never approves.', 'تقييم قواعد الأتمتة اليومية مرة كل يوم؛ لا يعتمد أبداً.', 'automation');
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source)
SELECT mth_uuid_v7(), 'system', 'job_schedule.create', 'job_schedule', s.id, 1, 'migration'
FROM job_schedule s WHERE s.code IN ('automation.tick_hourly', 'automation.tick_daily');
