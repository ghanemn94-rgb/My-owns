-- 0130 P6 DG6 re-gate repair (round 4 audit): seeded product text names the rule in business terms, never an
-- engineering delivery gate (DG0-DG7) or an internal engineering reference (T-DG6-BE-RG3; F-DG6-990; REQ-S21-001,
-- M0007, M0412). Authored by backend-workflow-engineer. Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16. Id: the next above the highest
-- shipped file on this branch (0129, D-196 item 2); the orchestrator renumbers at merge if another task shipped a
-- higher id first.
--
-- Earlier migrations seeded descriptive texts that the product serves or stores as product data and that name an
-- engineering delivery gate ("the DG4 freshness rule", "the DG4 behaviour", "The DG3 ... rules apply unchanged", "the
-- DG5 handler", "(DG3 scoring engine)") or an internal engineering record (decision ids such as D-142, ADR sections,
-- migration numbers). Applied migrations are never edited, so this one rewrites the STORED texts. Every rewrite is
-- conditional on the stored text still being the seeded one (exact match), so a text an administrator has since
-- changed is left alone; each changed row steps its version where it has one and gets an audit event (actor system,
-- source migration) with the exact {from, to} of the changed column, so the audit trail keeps the previous wording.
-- Only wording changes: no rule, value, trigger, handler, grant, status, approval or permission changes.
--
-- 1. job_schedule.description_en (served by listJobSchedules/listJobOperations; the English job name on the Jobs and
--    Job operations pages): kpi.freshness_scan (0117, "DG4 freshness rule") and the four descriptions that cite an
--    ADR section (0115 search.index_feed and search.reindex, 0116 integrations.connector_run, 0117
--    operations.exception_alerts). The Arabic descriptions already use business terms and are unchanged.
-- 2. automation_rule_version.change_summary (served by listAutomationRuleVersions): the 16 seeded starter versions 1
--    (0075, "Seeded starter: the DG4 behaviour (D-142 Q3).") and starter.job_failed version 2 (0117, "(ADR-0053 §3)").
--    A published or superseded version is immutable in its CONTENT (0074/0117 automation_rule_version_guard: triggers,
--    conditions, actions, action types, run-as, service permissions, parameters and content_sha256). change_summary
--    is the version's descriptive note, outside that content and outside content_sha256, so the guard allows it and
--    the executed behaviour, its hash and every execution's pinned version are untouched. Superseding the starters
--    with new versions would not help: version 1 stays served as history with the same note.
-- 3. procedure_definition.validation_rules_en/_ar (served by listProcedureDefinitions/getProcedureDefinition and
--    loaded into the Procedure builder): the six seeded definitions that cite DG2-DG4, in BOTH stored configuration
--    versions (0069 v1, superseded; 0095 v2, published) - 12 rows. A published procedure version is immutable to the
--    application by design (0069 procedure_definition_guard: changes only in a draft being edited), which protects
--    what a launched instance was pinned to; the guard admits the migration role (p5_procedure_version_editable) for
--    exactly this kind of seeded-data correction. The correction is wording only: the validation behaviour is in
--    code and unchanged, the en and ar texts keep their meaning, and both versions are corrected identically so the
--    v1/v2 comparison is unchanged. Two Arabic texts said "approved in the fourth/third stage" (an engineering
--    delivery stage, which a reader could take for a methodology phase, M0412); they now read like the others
--    ("... المعتمدة دون تغيير").
-- 4. service_identity.reason (served by listServiceIdentities/getServiceIdentity as the current reason): the seeded
--    declarations' reasons of 0114 ("the DG5 handler"), 0115, 0116, 0117 and 0121 (migration numbers, ADR sections
--    and D-199). Only rows whose reason is still the seeded one AND that no user has changed (updated_by IS NULL) are
--    rewritten. The append-only history service_identity_change keeps the earlier reasons (trigger-written; not
--    served) and gets the new one through the 0101 history trigger.
-- 5. form_source_field.storage_ref (not served: an internal storage descriptor of three computed source fields of
--    0068; storage_kind 'computed'; neither text holds a `table.column`, before or after, so the forms code derives no
--    column from it): the "(DG3 ...)"/"(DG4 ...)" annotations. No version column; each row still gets its audit event.
--
-- Nothing here approves anything (no business approval, G1-G6), and nothing reads or writes DG0-DG7.

-- ---------------------------------------------------------------------------------------------------------------- 1
CREATE TEMPORARY TABLE p6_rg3_job_text (code text PRIMARY KEY, old_en text NOT NULL, new_en text NOT NULL) ON COMMIT DROP;
INSERT INTO p6_rg3_job_text VALUES
  ('kpi.freshness_scan',
   'Find KPIs whose last accepted data became stale (DG4 freshness rule, unchanged) and open one operational exception per KPI; resolve it when the data is fresh again. Never changes a KPI value; never approves anything.',
   'Find KPIs whose last accepted data became stale (the KPI freshness rule, unchanged) and open one operational exception per KPI; resolve it when the data is fresh again. Never changes a KPI value; never approves anything.'),
  ('operations.exception_alerts',
   'Alert once for each newly opened operational exception: one error log line and one in-app notification to each holder of operations.acknowledge (ADR-0053 §6). Never approves anything.',
   'Alert once for each newly opened operational exception: one error log line and one in-app notification to each holder of operations.acknowledge. Never approves anything.'),
  ('search.index_feed',
   'Keep the search index current from the audit trail: update the search document of every record changed since the last run (ADR-0057 §2). Indexes titles, codes and descriptions only; never approves anything.',
   'Keep the search index current from the audit trail: update the search document of every record changed since the last run. Indexes titles, codes and descriptions only; never approves anything.'),
  ('search.reindex',
   'Rebuild the search index of every indexed record type from the current records (ADR-0057 §2). Weekly, or on demand by a technical administrator; never approves anything.',
   'Rebuild the search index of every indexed record type from the current records. Weekly, or on demand by a technical administrator; never approves anything.'),
  ('integrations.connector_run',
   'Queue each enabled connector''s scheduled run (hourly, daily or weekly) once per slot (ADR-0055 §2). Starts connector runs only; never approves anything.',
   'Queue each enabled connector''s scheduled run (hourly, daily or weekly) once per slot. Starts connector runs only; never approves anything.');

CREATE TEMPORARY TABLE p6_rg3_job_changed (id uuid PRIMARY KEY, version integer NOT NULL, old_en text NOT NULL, new_en text NOT NULL) ON COMMIT DROP;
WITH changed AS (
  UPDATE job_schedule s
     SET description_en = t.new_en, version = s.version + 1, updated_at = now(), updated_by = NULL
    FROM p6_rg3_job_text t
   WHERE s.code = t.code AND s.description_en = t.old_en
  RETURNING s.id, s.version, t.old_en, t.new_en)
INSERT INTO p6_rg3_job_changed SELECT id, version, old_en, new_en FROM changed;
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, prior_version, new_version, reason, source, changes)
SELECT mth_uuid_v7(), 'system', 'job_schedule.reword', 'job_schedule', c.id, c.version - 1, c.version,
       'Seeded description reworded in business terms (no engineering delivery gate or internal reference).', 'migration',
       jsonb_build_object('description_en', jsonb_build_object('from', c.old_en, 'to', c.new_en))
  FROM p6_rg3_job_changed c ORDER BY c.id;

-- ---------------------------------------------------------------------------------------------------------------- 2
CREATE TEMPORARY TABLE p6_rg3_rule_text (old_text text PRIMARY KEY, new_text text NOT NULL) ON COMMIT DROP;
INSERT INTO p6_rg3_rule_text VALUES
  ('Seeded starter: the DG4 behaviour (D-142 Q3).',
   'Seeded starter version 1: the released starter behaviour.'),
  ('Seeded starter version 2 (ADR-0053 §3): a connector run failure or stale KPI data also opens or recurs the visible operational exception; version 1 stays as history.',
   'Seeded starter version 2: a connector run failure or stale KPI data also opens or recurs the visible operational exception; version 1 stays as history.');

CREATE TEMPORARY TABLE p6_rg3_rule_changed (id uuid PRIMARY KEY, version integer NOT NULL, old_text text NOT NULL, new_text text NOT NULL) ON COMMIT DROP;
WITH changed AS (
  UPDATE automation_rule_version v
     SET change_summary = t.new_text, version = v.version + 1, updated_at = now(), updated_by = NULL
    FROM p6_rg3_rule_text t, automation_rule r
   WHERE v.change_summary = t.old_text AND r.id = v.automation_rule_id AND r.origin = 'starter'
     AND v.published_by IS NULL AND v.authored_by IS NULL
  RETURNING v.id, v.version, t.old_text, t.new_text)
INSERT INTO p6_rg3_rule_changed SELECT id, version, old_text, new_text FROM changed;
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, prior_version, new_version, reason, source, changes)
SELECT mth_uuid_v7(), 'system', 'automation_rule_version.reword', 'automation_rule_version', c.id, c.version - 1, c.version,
       'Seeded change summary reworded in business terms (no engineering delivery gate or internal reference); the version''s content is unchanged.',
       'migration', jsonb_build_object('change_summary', jsonb_build_object('from', c.old_text, 'to', c.new_text))
  FROM p6_rg3_rule_changed c ORDER BY c.id;

-- ---------------------------------------------------------------------------------------------------------------- 3
CREATE TEMPORARY TABLE p6_rg3_procedure_text (code text PRIMARY KEY, old_en text NOT NULL, new_en text NOT NULL,
                                              old_ar text NOT NULL, new_ar text NOT NULL) ON COMMIT DROP;
INSERT INTO p6_rg3_procedure_text VALUES
  ('kpi_submission',
   'The DG4 actual-submission rules apply unchanged.',
   'The KPI actual-submission rules apply unchanged.',
   'تنطبق قواعد تقديم القيم الفعلية المعتمدة في المرحلة الرابعة دون تغيير.',
   'تنطبق قواعد تقديم القيم الفعلية المعتمدة دون تغيير.'),
  ('initiative_prioritization',
   'The DG3 scoring and ranking rules apply unchanged.',
   'The initiative scoring and ranking rules apply unchanged.',
   'تنطبق قواعد التقييم والترتيب المعتمدة في المرحلة الثالثة دون تغيير.',
   'تنطبق قواعد التقييم والترتيب المعتمدة دون تغيير.'),
  ('gate_review',
   'Missing mandatory evidence blocks submission unless an authorized exception is recorded (DG2-DG4 gate rules unchanged).',
   'Missing mandatory evidence blocks submission unless an authorized exception is recorded (the gate rules apply unchanged).',
   'غياب الأدلة الإلزامية يمنع التقديم ما لم يُسجّل استثناء معتمد (قواعد البوابات دون تغيير).',
   'غياب الأدلة الإلزامية يمنع التقديم ما لم يُسجّل استثناء معتمد (قواعد البوابات دون تغيير).'),
  ('scope_target_change',
   'The DG4 change-control and impact-assessment rules apply unchanged.',
   'The change-control and impact-assessment rules apply unchanged.',
   'تنطبق قواعد ضبط التغيير وتقييم الأثر المعتمدة دون تغيير.',
   'تنطبق قواعد ضبط التغيير وتقييم الأثر المعتمدة دون تغيير.'),
  ('benefit_validation',
   'Finance validation follows the DG4 rules; the validator is not the benefit owner.',
   'Finance validation follows the benefit validation rules; the validator is not the benefit owner.',
   'يتبع تحقق المالية القواعد المعتمدة؛ والمتحقق ليس مالك المنفعة.',
   'يتبع تحقق المالية القواعد المعتمدة؛ والمتحقق ليس مالك المنفعة.'),
  ('bau_handover',
   'The DG4 BAU handover rules apply unchanged.',
   'The BAU handover rules apply unchanged.',
   'تنطبق قواعد التسليم المعتمدة دون تغيير.',
   'تنطبق قواعد التسليم المعتمدة دون تغيير.');

CREATE TEMPORARY TABLE p6_rg3_procedure_changed (id uuid PRIMARY KEY, version integer NOT NULL, changes jsonb NOT NULL) ON COMMIT DROP;
WITH changed AS (
  UPDATE procedure_definition d
     SET validation_rules_en = t.new_en, validation_rules_ar = t.new_ar, version = d.version + 1, updated_at = now(),
         updated_by = NULL
    FROM p6_rg3_procedure_text t
   WHERE d.code = t.code AND d.origin = 'source' AND d.validation_rules_en = t.old_en AND d.validation_rules_ar = t.old_ar
     AND d.methodology_version_id IN ('01920005-0300-7000-8000-000000000001', '01920005-0300-7000-8000-000000000002')
  RETURNING d.id, d.version,
            jsonb_build_object('validation_rules_en', jsonb_build_object('from', t.old_en, 'to', t.new_en))
            || CASE WHEN t.old_ar = t.new_ar THEN '{}'::jsonb
                    ELSE jsonb_build_object('validation_rules_ar', jsonb_build_object('from', t.old_ar, 'to', t.new_ar)) END
            AS changes)
INSERT INTO p6_rg3_procedure_changed SELECT id, version, changes FROM changed;
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, prior_version, new_version, reason, source, changes)
SELECT mth_uuid_v7(), 'system', 'procedure_definition.reword', 'procedure_definition', c.id, c.version - 1, c.version,
       'Seeded validation-rule text reworded in business terms (no engineering delivery gate); the rules are unchanged.',
       'migration', c.changes
  FROM p6_rg3_procedure_changed c ORDER BY c.id;

-- ---------------------------------------------------------------------------------------------------------------- 4
CREATE TEMPORARY TABLE p6_rg3_identity_text (old_text text PRIMARY KEY, new_text text NOT NULL) ON COMMIT DROP;
INSERT INTO p6_rg3_identity_text VALUES
  ('Seeded declaration (0114; ADR-0053 §1): the narrowest set of read permissions the DG5 handler needs.',
   'Seeded declaration: the narrowest set of read permissions this job''s handler needs.'),
  ('Seeded declaration (0115; ADR-0053 §1). Declared exception (ADR-0057 §2, D-199): reads only the indexed columns (code, title, summary, status) of sensitive benefits, business cases and evidence; no value column; every reader is filtered at query time.',
   'Seeded declaration. Declared exception: reads only the indexed columns (code, title, summary, status) of sensitive benefits, business cases and evidence; no value column; every reader is filtered at query time.'),
  ('Seeded declaration (0116; ADR-0053 §1, ADR-0055 §2).',
   'Seeded declaration: the narrowest set of read permissions the connector run job needs.'),
  ('Seeded declaration (0117; ADR-0053 §1): the narrowest read set the operations job needs.',
   'Seeded declaration: the narrowest set of read permissions the operations job needs.'),
  ('Seeded declaration (0121; ADR-0053 §1): the narrowest read set the notification channel job needs.',
   'Seeded declaration: the narrowest set of read permissions the notification channel job needs.');

CREATE TEMPORARY TABLE p6_rg3_identity_changed (id uuid PRIMARY KEY, version integer NOT NULL, old_text text NOT NULL, new_text text NOT NULL) ON COMMIT DROP;
WITH changed AS (
  UPDATE service_identity s
     SET reason = t.new_text, version = s.version + 1, updated_at = now(), updated_by = NULL
    FROM p6_rg3_identity_text t
   WHERE s.subject_kind = 'job' AND s.reason = t.old_text AND s.updated_by IS NULL
  RETURNING s.id, s.version, t.old_text, t.new_text)
INSERT INTO p6_rg3_identity_changed SELECT id, version, old_text, new_text FROM changed;
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, prior_version, new_version, reason, source, changes)
SELECT mth_uuid_v7(), 'system', 'service_identity.reword', 'service_identity', c.id, c.version - 1, c.version,
       'Seeded declaration reason reworded in business terms (no engineering delivery gate or internal reference); the declaration and grant are unchanged.',
       'migration', jsonb_build_object('reason', jsonb_build_object('from', c.old_text, 'to', c.new_text))
  FROM p6_rg3_identity_changed c ORDER BY c.id;

-- ---------------------------------------------------------------------------------------------------------------- 5
CREATE TEMPORARY TABLE p6_rg3_source_field_text (id uuid PRIMARY KEY, old_ref text NOT NULL, new_ref text NOT NULL) ON COMMIT DROP;
INSERT INTO p6_rg3_source_field_text VALUES
  ('01920005-0206-7000-8000-000000000004', 'initiative_score_result (DG3 scoring engine)', 'initiative_score_result (scoring engine)'),
  ('01920005-0209-7000-8000-000000000004', 'benefit_formula_version (DG3 formula engine)', 'benefit_formula_version (formula engine)'),
  ('01920005-020e-7000-8000-000000000007', 'benefit_measurement (DG4 realized value)', 'benefit_measurement (realized value)');

CREATE TEMPORARY TABLE p6_rg3_source_field_changed (id uuid PRIMARY KEY, old_ref text NOT NULL, new_ref text NOT NULL) ON COMMIT DROP;
WITH changed AS (
  UPDATE form_source_field f
     SET storage_ref = t.new_ref
    FROM p6_rg3_source_field_text t
   WHERE f.id = t.id AND f.storage_kind = 'computed' AND f.storage_ref = t.old_ref
  RETURNING f.id, t.old_ref, t.new_ref)
INSERT INTO p6_rg3_source_field_changed SELECT id, old_ref, new_ref FROM changed;
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, reason, source, changes)
SELECT mth_uuid_v7(), 'system', 'form_source_field.reword', 'form_source_field', c.id,
       'Seeded storage note reworded (no engineering delivery gate); the mapping is unchanged.', 'migration',
       jsonb_build_object('storage_ref', jsonb_build_object('from', c.old_ref, 'to', c.new_ref))
  FROM p6_rg3_source_field_changed c ORDER BY c.id;
