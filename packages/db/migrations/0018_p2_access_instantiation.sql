-- 0018 P2 permissions and role defaults, role accountability, transformation starter structure (and backfill)
-- (T-DG2-ARCH-01; ADR-0006, ADR-0020, ADR-0016). Authored by solution-architect.
-- Contract: docs/architecture/data-dictionary.md ("P2" section). Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged; later P2 changes go into new migrations (0019+, owned by
-- backend-workflow-engineer). SQL floor: PostgreSQL 16. Ids are UUIDv7 from the application; seed rows use fixed
-- literal UUIDs.

-- -----------------------------------------------------------------------------------------------------------------
-- role_accountability: Accountability text per role, shown on role assignments (REQ-PB-012; source text from B0018).
CREATE TABLE role_accountability (
  role_id           uuid NOT NULL REFERENCES role (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  accountability_en text NOT NULL CHECK (char_length(accountability_en) BETWEEN 1 AND 1000),
  accountability_ar text NOT NULL CHECK (char_length(accountability_ar) BETWEEN 1 AND 1000),
  is_source_text    boolean NOT NULL,
  source_ref        text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 50),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  PRIMARY KEY (role_id)
);
GRANT SELECT ON role_accountability TO mth_app;

-- P2 permission catalogue and role defaults. EXACTLY packages/shared/src/permissions.ts P2_PERMISSIONS / the P2 part of
-- ROLES (packages/db/src/seed.test.ts compares them). A CONFIGURABLE STARTING POINT, not a Mobily-approved access policy.
-- The SoD trigger from 0001 still refuses any technical_admin role holding a business_approval permission.
INSERT INTO permission (code, category, description_en, description_ar) VALUES
  ('north_star.edit', 'write', 'Create and refine the transformation''s North Star', 'إنشاء نجم الشمال للتحول وتحسينه'),
  ('charter.edit', 'write', 'Draft and version the charter, thesis, scope checks and strategic guardrails', 'صياغة الميثاق والأطروحة وفحوص النطاق والضوابط الاستراتيجية وإصدار نسخها'),
  ('outcome.edit', 'write', 'Create and update outcomes and Outcome & KPI Tree rows', 'إنشاء النتائج وصفوف شجرة النتائج ومؤشرات الأداء وتحديثها'),
  ('kpi_definition.edit', 'write', 'Create and update KPI definitions', 'إنشاء تعريفات مؤشرات الأداء الرئيسية وتحديثها'),
  ('kpi_target.approve', 'business_approval', 'Approve a KPI target trajectory (business approval)', 'اعتماد مسار مستهدف مؤشر الأداء (اعتماد أعمال)'),
  ('baseline.edit', 'write', 'Create and update baselines', 'إنشاء الخطوط الأساسية وتحديثها'),
  ('diagnostic.edit', 'write', 'Edit the diagnostic, findings, workstream outputs and value pools', 'تحرير التشخيص والنتائج ومخرجات مسارات العمل ومجمّعات القيمة'),
  ('diagnostic.contribute', 'write', 'Add diagnostic records and edit own records', 'إضافة سجلات التشخيص وتحرير السجلات الخاصة'),
  ('tom.edit', 'write', 'Edit the TOM canvas, gap matrix, capabilities and journeys', 'تحرير لوحة نموذج التشغيل ومصفوفة الفجوات والقدرات والرحلات'),
  ('tom.contribute', 'write', 'Add TOM records and edit own records', 'إضافة سجلات نموذج التشغيل وتحرير السجلات الخاصة'),
  ('workshop.facilitate', 'write', 'Facilitate TOM workshops and convert unresolved items', 'تيسير ورش نموذج التشغيل وتحويل البنود غير المحسومة'),
  ('decision.edit', 'write', 'Create and update design decisions', 'إنشاء قرارات التصميم وتحديثها'),
  ('decision.decide', 'business_approval', 'Record the outcome of a decision you own (business approval)', 'تسجيل نتيجة قرار تملكه (اعتماد أعمال)'),
  ('dependency.edit', 'write', 'Create and update dependencies', 'إنشاء الاعتماديات وتحديثها'),
  ('action.edit', 'write', 'Create and update any action', 'إنشاء أي إجراء وتحديثه'),
  ('action.update_own', 'write', 'Update actions you own', 'تحديث الإجراءات التي تملكها'),
  ('evidence.create', 'write', 'Add evidence and link it to records you may edit', 'إضافة الأدلة وربطها بالسجلات التي يمكنك تحريرها'),
  ('evidence.review', 'write', 'Review evidence (verify or reject); never your own', 'مراجعة الأدلة (التحقق أو الرفض)؛ وليس أدلتك أبداً'),
  ('gate.submit', 'write', 'Submit a product gate (G1-G6) for decision', 'تقديم بوابة منتج (G1-G6) لاتخاذ القرار'),
  ('gate.configure', 'configure', 'Configure a product gate''s approver', 'إعداد معتمِد بوابة المنتج'),
  ('team.assign', 'configure', 'Assign non-approver team roles within a transformation', 'إسناد أدوار الفريق غير المعتمِدة داخل التحول'),
  ('methodology.configure', 'configure', 'Edit methodology display labels and translations', 'تحرير تسميات المنهجية وترجماتها');

INSERT INTO role_permission (role_id, permission_code) VALUES
  ('01920000-0000-7000-8000-000000000001', 'kpi_target.approve'), -- SP
  ('01920000-0000-7000-8000-000000000001', 'decision.decide'), -- SP
  ('01920000-0000-7000-8000-000000000001', 'action.update_own'), -- SP
  ('01920000-0000-7000-8000-000000000002', 'north_star.edit'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'charter.edit'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'outcome.edit'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'kpi_definition.edit'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'baseline.edit'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'diagnostic.edit'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'tom.edit'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'workshop.facilitate'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'decision.edit'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'decision.decide'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'dependency.edit'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'action.edit'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'evidence.create'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'evidence.review'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'gate.submit'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'team.assign'), -- TL
  ('01920000-0000-7000-8000-000000000003', 'outcome.edit'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'kpi_target.approve'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'tom.edit'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'decision.decide'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'action.update_own'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'evidence.create'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'evidence.review'), -- BO
  ('01920000-0000-7000-8000-000000000004', 'diagnostic.contribute'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'tom.contribute'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'decision.edit'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'decision.decide'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'dependency.edit'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'action.update_own'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'evidence.create'), -- WL
  ('01920000-0000-7000-8000-000000000005', 'action.update_own'), -- FIN
  ('01920000-0000-7000-8000-000000000005', 'evidence.create'), -- FIN
  ('01920000-0000-7000-8000-000000000005', 'evidence.review'), -- FIN
  ('01920000-0000-7000-8000-000000000006', 'charter.edit'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'diagnostic.edit'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'dependency.edit'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'action.edit'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'evidence.create'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'evidence.review'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'gate.configure'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'team.assign'), -- TO
  ('01920000-0000-7000-8000-000000000007', 'outcome.edit'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'kpi_definition.edit'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'baseline.edit'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'action.update_own'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'evidence.create'), -- KDS
  ('01920000-0000-7000-8000-000000000008', 'tom.contribute'), -- TD
  ('01920000-0000-7000-8000-000000000008', 'dependency.edit'), -- TD
  ('01920000-0000-7000-8000-000000000008', 'action.update_own'), -- TD
  ('01920000-0000-7000-8000-000000000008', 'evidence.create'), -- TD
  ('01920000-0000-7000-8000-00000000000e', 'methodology.configure'); -- ADM_METHOD

-- Accountability shown on role assignments: verbatim B0018 for the six source roles; implementation roles are
-- platform text (M0187), marked is_source_text = false. Arabic is a provisional translation.
INSERT INTO role_accountability (role_id, accountability_en, accountability_ar, is_source_text, source_ref) VALUES
  ('01920000-0000-7000-8000-000000000001', 'Owns enterprise outcome, removes constraints, approves major trade-offs.', 'يمتلك النتيجة على مستوى المؤسسة، ويزيل القيود، ويعتمد المفاضلات الكبرى.', true, 'B0018'), -- SP
  ('01920000-0000-7000-8000-000000000002', 'Integrates workstreams, drives cadence, ensures outcome realization.', 'يدمج مسارات العمل، ويقود الإيقاع، ويضمن تحقيق النتائج.', true, 'B0018'), -- TL
  ('01920000-0000-7000-8000-000000000003', 'Own target-state capabilities and BAU adoption.', 'يمتلكون قدرات الحالة المستهدفة وتبنّيها في العمليات الاعتيادية.', true, 'B0018'), -- BO
  ('01920000-0000-7000-8000-000000000004', 'Deliver initiatives and manage dependencies.', 'ينفّذون المبادرات ويديرون الاعتماديات.', true, 'B0018'), -- WL
  ('01920000-0000-7000-8000-000000000005', 'Validates baseline, benefit logic, value realization.', 'يتحقق من الخط الأساسي ومنطق المنافع وتحقيق القيمة.', true, 'B0018'), -- FIN
  ('01920000-0000-7000-8000-000000000006', 'Governance, reporting, risks, dependencies, decisions, standards.', 'الحوكمة، وإعداد التقارير، والمخاطر، والاعتماديات، والقرارات، والمعايير.', true, 'B0018'), -- TO
  ('01920000-0000-7000-8000-000000000007', 'Maintains KPI definitions, baselines and data quality for assigned KPIs.', 'يحافظ على تعريفات مؤشرات الأداء والخطوط الأساسية وجودة البيانات للمؤشرات المسندة.', false, 'M0187'), -- KDS
  ('01920000-0000-7000-8000-000000000008', 'Contributes technology and data input to target-state design and dependencies.', 'يساهم بمدخلات التقنية والبيانات في تصميم الحالة المستهدفة والاعتماديات.', false, 'M0187'), -- TD
  ('01920000-0000-7000-8000-000000000009', 'Participates in governance forums and their decisions.', 'يشارك في منتديات الحوكمة وقراراتها.', false, 'M0187'), -- CM
  ('01920000-0000-7000-8000-00000000000a', 'Prepares agendas and records attendance, minutes and actions for governance forums.', 'يعدّ جداول الأعمال ويسجل الحضور والمحاضر والإجراءات لمنتديات الحوكمة.', false, 'M0187'), -- SEC
  ('01920000-0000-7000-8000-00000000000b', 'Reviews records and audit trails read-only; can never change data.', 'يراجع السجلات وسجلات التدقيق للقراءة فقط، ولا يمكنه تغيير البيانات أبداً.', false, 'M0187'), -- AUD
  ('01920000-0000-7000-8000-00000000000c', 'Technical configuration only; never a business approver.', 'الإعدادات التقنية فقط، وليس معتمِداً للأعمال أبداً.', false, 'M0187'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000d', 'Administers user accounts and scoped access; never a business approver.', 'يدير حسابات المستخدمين والصلاحيات ضمن النطاق، وليس معتمِداً للأعمال أبداً.', false, 'M0187'), -- ADM_ACCESS
  ('01920000-0000-7000-8000-00000000000e', 'Maintains methodology content and labels; never a business approver.', 'يحافظ على محتوى المنهجية وتسمياتها، وليس معتمِداً للأعمال أبداً.', false, 'M0187'); -- ADM_METHOD

-- Starter structure of a transformation (REQ-S12-004 P2 increment, REQ-PB-026, REQ-PB-041; ADR-0016):
--   the methodology pin, the six seeded T01 rows, the ten TOM canvas boxes and the six product gate instances.
-- Idempotent (re-running creates nothing twice) and serialized per transformation by the row lock. Every row it creates
-- gets its own audit event, so the deferred audit_required triggers are satisfied.
--   p_actor_user_id  the creating user when called by the API in the POST /transformations transaction (actor 'user');
--                    NULL for a migration backfill (actor 'system', on behalf of the transformation's creator).
--   p_source         'api' | 'worker' | 'cli' | 'migration' (audit_event.source).
CREATE FUNCTION p2_instantiate_transformation(p_transformation_id uuid, p_actor_user_id uuid, p_request_id text, p_source text)
RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  t record;
  mv uuid;
  rid uuid;
  creator uuid;
  a_type text := CASE WHEN p_actor_user_id IS NULL THEN 'system' ELSE 'user' END;
  on_behalf uuid;
  created integer := 0;
  r record;
BEGIN
  SELECT x.id, x.organization_id, x.created_by INTO t FROM transformation x WHERE x.id = p_transformation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transformation % does not exist', p_transformation_id USING ERRCODE = 'no_data_found';
  END IF;
  creator := coalesce(p_actor_user_id, t.created_by);
  on_behalf := CASE WHEN p_actor_user_id IS NULL THEN t.created_by END;
  SELECT m.id INTO mv FROM methodology_version m WHERE m.key = 'playbook' AND m.status = 'published'
    ORDER BY m.version_no DESC LIMIT 1;

  IF NOT EXISTS (SELECT 1 FROM transformation_config_pin p WHERE p.transformation_id = t.id AND p.kind = 'methodology') THEN
    rid := mth_uuid_v7();
    INSERT INTO transformation_config_pin (id, organization_id, transformation_id, kind, methodology_version_id, pinned_by,
                                           created_by, updated_by)
    VALUES (rid, t.organization_id, t.id, 'methodology', mv, creator, creator, creator);
    INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, on_behalf_of_user_id, action,
                             record_type, record_id, new_version, request_id, source)
    VALUES (mth_uuid_v7(), t.organization_id, t.id, a_type, p_actor_user_id, on_behalf, 'transformation_config_pin.create',
            'transformation_config_pin', rid, 1, p_request_id, p_source);
    created := created + 1;
  END IF;

  FOR r IN SELECT d.code FROM diagnostic_dimension d WHERE d.is_source_seeded AND d.status = 'active' ORDER BY d.ordinal LOOP
    IF NOT EXISTS (SELECT 1 FROM diagnostic_item i WHERE i.transformation_id = t.id AND i.dimension_code = r.code AND i.is_seeded) THEN
      rid := mth_uuid_v7();
      INSERT INTO diagnostic_item (id, organization_id, transformation_id, dimension_code, is_seeded, created_by, updated_by)
      VALUES (rid, t.organization_id, t.id, r.code, true, creator, creator);
      INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, on_behalf_of_user_id, action,
                               record_type, record_id, new_version, request_id, source)
      VALUES (mth_uuid_v7(), t.organization_id, t.id, a_type, p_actor_user_id, on_behalf, 'diagnostic_item.create',
              'diagnostic_item', rid, 1, p_request_id, p_source);
      created := created + 1;
    END IF;
  END LOOP;

  FOR r IN SELECT d.code FROM tom_dimension d ORDER BY d.ordinal LOOP
    IF NOT EXISTS (SELECT 1 FROM tom_canvas_cell c WHERE c.transformation_id = t.id AND c.dimension_code = r.code) THEN
      rid := mth_uuid_v7();
      INSERT INTO tom_canvas_cell (id, organization_id, transformation_id, dimension_code, created_by, updated_by)
      VALUES (rid, t.organization_id, t.id, r.code, creator, creator);
      INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, on_behalf_of_user_id, action,
                               record_type, record_id, new_version, request_id, source)
      VALUES (mth_uuid_v7(), t.organization_id, t.id, a_type, p_actor_user_id, on_behalf, 'tom_canvas_cell.create',
              'tom_canvas_cell', rid, 1, p_request_id, p_source);
      created := created + 1;
    END IF;
  END LOOP;

  FOR r IN SELECT g.code, g.default_approver_role_code FROM gate_definition g ORDER BY g.ordinal LOOP
    IF NOT EXISTS (SELECT 1 FROM gate_instance gi WHERE gi.transformation_id = t.id AND gi.gate_code = r.code) THEN
      rid := mth_uuid_v7();
      INSERT INTO gate_instance (id, organization_id, transformation_id, gate_code, approver_role_code, created_by, updated_by)
      VALUES (rid, t.organization_id, t.id, r.code, r.default_approver_role_code, creator, creator);
      INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, on_behalf_of_user_id, action,
                               record_type, record_id, new_version, request_id, source)
      VALUES (mth_uuid_v7(), t.organization_id, t.id, a_type, p_actor_user_id, on_behalf, 'gate_instance.create',
              'gate_instance', rid, 1, p_request_id, p_source);
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END $$;

REVOKE ALL ON FUNCTION p2_instantiate_transformation(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2_instantiate_transformation(uuid, uuid, text, text) TO mth_app;

-- Backfill: transformations created before P2 (development and demo databases) get the same starter structure, audited
-- as actor 'system' on behalf of their creator. On a fresh database this selects no rows.
SELECT p2_instantiate_transformation(x.id, NULL, NULL, 'migration') FROM transformation x ORDER BY x.created_at, x.id;
