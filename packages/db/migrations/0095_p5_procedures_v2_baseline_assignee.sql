-- 0095 P5 repair (T-DG5-BE-T3; D-165; QA-E O-2): the `procedures` configuration v2, a SEEDED product-default version
-- whose only change from v1 (0069) is the assignee of `baseline_validation.record_baseline`: TL instead of BO.
-- Authored by backend-workflow-engineer. Forward-only and additive: never edit once merged. Runs as mth_owner inside
-- one transaction opened by `mth-db migrate`. SQL floor: PostgreSQL 16.
--
-- Why: REQ-PB-027 gives baseline create and edit (`baseline.edit`, 0018) to TL and KDS only, so the v1 assignee (BO)
-- cannot produce the step's output, a baseline (observation O-2 of T-DG5-QA-E). The Lead records the baseline; Finance
-- still validates it (`validate_baseline`, FIN, unchanged), so the recorder and the validator stay different roles.
--
-- How (ADR-0042 §1; ADR-0039 §1-§4): through the configuration's own versioning, never by editing a published version
-- or an applied migration. v1 stays published, immutable and unchanged (0069 procedure_definition_draft_only). v2 is a
-- new row of the same kind and key with `origin = 'seed'` (ADR-0039: seeded rows are inserted by migrations only,
-- methodology_version_seed_only; a seeded version's hash is an opaque identity set by its migration),
-- `based_on_version_id` = v1 (the lineage the Studio diff reads) and a change summary. Its ten definitions and 31
-- steps are copies of v1's, and each inserted row has its audit event (the 0069 audit guards are attached now). Fixed,
-- deterministic ids: a definition's id is its v1 id with the group 0301 -> 0311 (01920005-0311-7000-8000-<ordinal>);
-- a step's and an audit event's id is the MD5 of a fixed text with the RFC 9562 version (7) and variant (8) nibbles
-- set, so every id is a valid UUID for the API's validators.
--
-- Who gets it: a launch uses the transformation's `procedure` pin, else the newest published `procedures` version
-- (procedures/instances.ts launchDefinition). No transformation is pinned to procedures at creation, so instances
-- launched from now on in an unpinned transformation (every new one) use v2. A transformation that holds a
-- `procedure` pin stays on its pinned version: a pin moves only through an approved methodology migration (ADR-0040
-- §1, transformation_config_pin_guard), never through a publish. A RUNNING instance never changes: it stays on the
-- definition version it launched with (0069 procedure_instance_pinned).
--
-- Nothing here grants a business, Finance or IT approval, and nothing reads or writes the engineering gates DG0-DG7.

INSERT INTO methodology_version (id, key, version_no, status, title_en, title_ar, source_document, source_sha256,
                                 definition, content_sha256, published_at, config_kind, origin, based_on_version_id,
                                 change_summary) VALUES
  ('01920005-0300-7000-8000-000000000002', 'procedures', 2, 'published',
   'Procedures v2 (ten seeded procedures; baseline recorded by the Transformation Lead)',
   'الإجراءات — الإصدار 2 (عشرة إجراءات مهيأة مسبقاً؛ يسجل قائد التحول خط الأساس) (ترجمة مؤقتة)',
   'docs/source/master-prompt-v2.0.md (M0152, M0153)', NULL,
   '{"sourceRefs": ["M0152", "M0153"], "productDefaults": true}'::jsonb,
   encode(sha256(convert_to('procedures/2:ten-seeded-procedures:record-baseline-tl', 'UTF8')), 'hex'),
   now(), 'procedure', 'seed', '01920005-0300-7000-8000-000000000001',
   'Baseline validation: the "Record the baseline" step is assigned to the Transformation Lead (TL), who holds baseline create and edit (REQ-PB-027); Finance still validates it.');
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, reason, source) VALUES
  ('01920005-0300-7000-8000-0000000000fe', 'system', 'methodology_version.seed', 'methodology_version',
   '01920005-0300-7000-8000-000000000002', 1,
   'Seeded procedures configuration v2: record_baseline assigned to TL (T-DG5-BE-T3, D-165)', 'migration');

-- The ten definitions: copies of v1's; baseline_validation's responsible roles follow its steps (TL records, FIN
-- validates).
INSERT INTO procedure_definition (id, methodology_version_id, code, origin, removed, ordinal, name_en, name_ar,
  purpose_en, purpose_ar, trigger_kind, trigger_event, trigger_en, trigger_ar, scope_level, scope_en, scope_ar,
  prerequisites_en, prerequisites_ar, input_schema, launch_role_codes, responsible_role_codes, sla_working_days,
  validation_rules_en, validation_rules_ar, approval_mode, approval_role_codes, escalation_role_code,
  escalation_after_working_days, expected_outputs_en, expected_outputs_ar, completion_rule, completion_en,
  completion_ar, exceptions_en, exceptions_ar, effective_from, source_ref)
SELECT overlay(d.id::text PLACING '0311' FROM 10 FOR 4)::uuid, '01920005-0300-7000-8000-000000000002', d.code, d.origin,
       d.removed, d.ordinal, d.name_en, d.name_ar, d.purpose_en, d.purpose_ar, d.trigger_kind, d.trigger_event,
       d.trigger_en, d.trigger_ar, d.scope_level, d.scope_en, d.scope_ar, d.prerequisites_en, d.prerequisites_ar,
       d.input_schema, d.launch_role_codes,
       CASE WHEN d.code = 'baseline_validation' THEN ARRAY['TL', 'FIN'] ELSE d.responsible_role_codes END,
       d.sla_working_days, d.validation_rules_en, d.validation_rules_ar, d.approval_mode, d.approval_role_codes,
       d.escalation_role_code, d.escalation_after_working_days, d.expected_outputs_en, d.expected_outputs_ar,
       d.completion_rule, d.completion_en, d.completion_ar, d.exceptions_en, d.exceptions_ar, d.effective_from,
       d.source_ref
  FROM procedure_definition d
 WHERE d.methodology_version_id = '01920005-0300-7000-8000-000000000001'
 ORDER BY d.ordinal;

-- The 31 steps: copies of v1's; only baseline_validation.record_baseline changes its responsible role (BO -> TL).
INSERT INTO procedure_step_definition (id, procedure_definition_id, step_key, ordinal, parallel_group, step_kind,
  name_en, name_ar, instructions_en, instructions_ar, responsible_role_code, approval_role_code, sla_working_days,
  condition_input_key, condition_operator, condition_value, required_input_keys, evidence_required,
  output_record_type, output_mode, skippable, removed)
SELECT (substr(m.h, 1, 8) || '-' || substr(m.h, 9, 4) || '-7' || substr(m.h, 14, 3) || '-8' || substr(m.h, 18, 3)
        || '-' || substr(m.h, 21, 12))::uuid,
       overlay(d.id::text PLACING '0311' FROM 10 FOR 4)::uuid, s.step_key, s.ordinal, s.parallel_group, s.step_kind,
       s.name_en, s.name_ar, s.instructions_en, s.instructions_ar,
       CASE WHEN d.code = 'baseline_validation' AND s.step_key = 'record_baseline' THEN 'TL' ELSE s.responsible_role_code END,
       s.approval_role_code, s.sla_working_days, s.condition_input_key, s.condition_operator, s.condition_value,
       s.required_input_keys, s.evidence_required, s.output_record_type, s.output_mode, s.skippable, s.removed
  FROM procedure_step_definition s
  JOIN procedure_definition d ON d.id = s.procedure_definition_id
 CROSS JOIN LATERAL (SELECT md5('p5-procedures-v2:step:' || d.code || ':' || s.step_key) AS h) AS m
 WHERE d.methodology_version_id = '01920005-0300-7000-8000-000000000001'
 ORDER BY d.ordinal, s.ordinal, s.step_key;

-- One audit event per inserted definition and step row (the 0069 deferred audit guards check them at COMMIT).
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, reason, source)
SELECT (substr(m.h, 1, 8) || '-' || substr(m.h, 9, 4) || '-7' || substr(m.h, 14, 3) || '-8' || substr(m.h, 18, 3)
        || '-' || substr(m.h, 21, 12))::uuid, 'system', 'procedure_definition.seed', 'procedure_definition',
       d.id, 1, 'Seeded procedures configuration v2 (T-DG5-BE-T3, D-165)', 'migration'
  FROM procedure_definition d
 CROSS JOIN LATERAL (SELECT md5('p5-procedures-v2:audit:' || d.id::text) AS h) AS m
 WHERE d.methodology_version_id = '01920005-0300-7000-8000-000000000002';
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, reason, source)
SELECT (substr(m.h, 1, 8) || '-' || substr(m.h, 9, 4) || '-7' || substr(m.h, 14, 3) || '-8' || substr(m.h, 18, 3)
        || '-' || substr(m.h, 21, 12))::uuid, 'system', 'procedure_step_definition.seed',
       'procedure_step_definition', s.id, 1, 'Seeded procedures configuration v2 (T-DG5-BE-T3, D-165)', 'migration'
  FROM procedure_step_definition s
  JOIN procedure_definition d ON d.id = s.procedure_definition_id
 CROSS JOIN LATERAL (SELECT md5('p5-procedures-v2:audit:' || s.id::text) AS h) AS m
 WHERE d.methodology_version_id = '01920005-0300-7000-8000-000000000002';
