-- 0070 P5 slices B + C seeds: the forms and procedures permission catalogue and role defaults, and the coverage links
-- of REQ-S01-003 (T-DG5-ARCH-02; ADR-0041 §9, ADR-0042 §8-§9). Authored by solution-architect. Runs as mth_owner
-- inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- Permissions: EXACTLY packages/shared/src/permissions.ts P5_FORMS_PROCEDURES_PERMISSIONS /
-- P5_FORMS_PROCEDURES_ROLE_PERMISSIONS (packages/db/src/seed.test.ts compares them). A CONFIGURABLE STARTING POINT,
-- not a Mobily-approved access policy. No code here is a business_approval or finance_validation code: an approval
-- step of a procedure is decided through the canonical approval (ADR-0026) by the holder of that business approval
-- right. Authoring procedures and form schemas uses the existing methodology.configure (ADM_METHOD, DG2) and the slice A
-- publish pipeline. AUD gets procedure.read only (read-only everywhere). Nothing touches DG0-DG7.
INSERT INTO permission (code, category, description_en, description_ar) VALUES
  ('form_record.comment', 'write', 'Comment on a form record you can read', 'التعليق على سجل نموذج يمكنك قراءته'),
  ('procedure.read', 'read', 'Read procedure definitions and the procedure instances in your scope', 'قراءة تعريفات الإجراءات ونُسخها ضمن نطاقك'),
  ('procedure.launch', 'write', 'Launch a procedure whose launch roles include one of your roles', 'إطلاق إجراء تشمل أدوار إطلاقه أحد أدوارك'),
  ('procedure.act', 'write', 'Provide inputs and complete or skip the procedure steps assigned to you', 'تقديم المدخلات وإكمال خطوات الإجراء المسندة إليك أو تخطيها'),
  ('procedure.manage', 'write', 'Assign procedure steps and cancel procedure instances in your scope', 'إسناد خطوات الإجراءات وإلغاء نُسخ الإجراءات ضمن نطاقك');
INSERT INTO role_permission (role_id, permission_code) VALUES
  ('01920000-0000-7000-8000-000000000001', 'form_record.comment'), -- SP
  ('01920000-0000-7000-8000-000000000001', 'procedure.read'), -- SP
  ('01920000-0000-7000-8000-000000000001', 'procedure.launch'), -- SP
  ('01920000-0000-7000-8000-000000000001', 'procedure.act'), -- SP
  ('01920000-0000-7000-8000-000000000002', 'form_record.comment'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'procedure.read'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'procedure.launch'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'procedure.act'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'procedure.manage'), -- TL
  ('01920000-0000-7000-8000-000000000003', 'form_record.comment'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'procedure.read'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'procedure.launch'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'procedure.act'), -- BO
  ('01920000-0000-7000-8000-000000000004', 'form_record.comment'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'procedure.read'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'procedure.launch'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'procedure.act'), -- WL
  ('01920000-0000-7000-8000-000000000005', 'form_record.comment'), -- FIN
  ('01920000-0000-7000-8000-000000000005', 'procedure.read'), -- FIN
  ('01920000-0000-7000-8000-000000000005', 'procedure.launch'), -- FIN
  ('01920000-0000-7000-8000-000000000005', 'procedure.act'), -- FIN
  ('01920000-0000-7000-8000-000000000006', 'form_record.comment'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'procedure.read'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'procedure.launch'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'procedure.act'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'procedure.manage'), -- TO
  ('01920000-0000-7000-8000-000000000007', 'form_record.comment'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'procedure.read'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'procedure.launch'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'procedure.act'), -- KDS
  ('01920000-0000-7000-8000-000000000008', 'form_record.comment'), -- TD
  ('01920000-0000-7000-8000-000000000008', 'procedure.read'), -- TD
  ('01920000-0000-7000-8000-000000000008', 'procedure.act'), -- TD
  ('01920000-0000-7000-8000-000000000009', 'form_record.comment'), -- CM
  ('01920000-0000-7000-8000-000000000009', 'procedure.read'), -- CM
  ('01920000-0000-7000-8000-000000000009', 'procedure.act'), -- CM
  ('01920000-0000-7000-8000-00000000000a', 'procedure.read'), -- SEC
  ('01920000-0000-7000-8000-00000000000b', 'procedure.read'), -- AUD
  ('01920000-0000-7000-8000-00000000000c', 'procedure.read'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000d', 'procedure.read'), -- ADM_ACCESS
  ('01920000-0000-7000-8000-00000000000e', 'procedure.read'); -- ADM_METHOD

-- -----------------------------------------------------------------------------------------------------------------
-- methodology_coverage_link: which native form(s) and procedure(s) implement each counted source element of the
-- source inventory (REQ-S01-003 "every seeded methodology element shows a linked form or procedure in the coverage
-- view"; ADR-0042 §8). A link names a registered form record type or a procedure code; the coverage view resolves it
-- against the published versions and reports Covered, Planned (the target's feature is not shipped yet) or Not covered,
-- never green for a planned or missing target. Read-only for the application; ids are deterministic (md5 of the link).
CREATE TABLE methodology_coverage_link (
  id                uuid PRIMARY KEY,
  source_element_id uuid NOT NULL REFERENCES source_element (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  target_kind       text NOT NULL CHECK (target_kind IN ('form', 'procedure')),
  target_code       text NOT NULL CHECK (target_code ~ '^[A-Za-z][A-Za-z0-9_]{1,47}$'),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT methodology_coverage_link_key UNIQUE (source_element_id, target_kind, target_code)
);
CREATE FUNCTION methodology_coverage_link_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT (CASE NEW.target_kind
            WHEN 'form' THEN EXISTS (SELECT 1 FROM form_record_type f WHERE f.code = NEW.target_code)
            ELSE EXISTS (SELECT 1 FROM procedure_definition p WHERE p.code = NEW.target_code) END) THEN
    RAISE EXCEPTION 'methodology_coverage_link %: % % does not exist', NEW.id, NEW.target_kind, NEW.target_code
      USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'methodology_coverage_link_target';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER methodology_coverage_link_guard BEFORE INSERT OR UPDATE ON methodology_coverage_link
  FOR EACH ROW EXECUTE FUNCTION methodology_coverage_link_guard();
GRANT SELECT ON methodology_coverage_link TO mth_app;

INSERT INTO methodology_coverage_link (id, source_element_id, target_kind, target_code)
SELECT md5('p5-coverage:' || s.set_code || '.' || s.stable_key || ':' || m.target_kind || ':' || m.target_code)::uuid,
       s.id, m.target_kind, m.target_code
FROM source_element s
JOIN (VALUES
  ('mode', NULL, 'procedure', 'new_transformation_intake'),
  ('phase', NULL, 'form', 'phase_step'),
  ('phase', NULL, 'procedure', 'gate_review'),
  ('gate', NULL, 'procedure', 'gate_review'),
  ('template', 'T10', 'procedure', 'kpi_submission'),
  ('template', 'T14', 'procedure', 'benefit_validation'),
  ('tom_dimension', NULL, 'form', 'T03'),
  ('tom_dimension', NULL, 'form', 'tom_canvas'),
  ('tom_dimension', NULL, 'procedure', 'tom_approval'),
  ('forum', NULL, 'form', 'meeting_record'),
  ('benefit_lifecycle_step', NULL, 'form', 'T14'),
  ('benefit_lifecycle_step', NULL, 'procedure', 'benefit_validation'),
  ('launch_window', NULL, 'form', 'launch_plan'),
  ('roaming_example', NULL, 'form', 'charter'),
  ('roaming_example', NULL, 'procedure', 'new_transformation_intake'),
  ('health_question', NULL, 'form', 'health_assessment')
) AS m(set_code, stable_key, target_kind, target_code)
  ON m.set_code = s.set_code AND (m.stable_key IS NULL OR m.stable_key = s.stable_key)
UNION ALL
-- Every template except T10 (the dashboard read model) is its own native form.
SELECT md5('p5-coverage:template.' || s.stable_key || ':form:' || s.stable_key)::uuid, s.id, 'form', s.stable_key
FROM source_element s WHERE s.set_code = 'template' AND s.stable_key <> 'T10';
