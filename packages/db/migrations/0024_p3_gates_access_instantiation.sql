-- 0024 P3 product gate G4 criteria, G1 leadership agreement confirmations, P3 permissions and role defaults, and the
-- P3 starter structure of a transformation (four source waves, T06 weight set v1) with a backfill
-- (T-DG3-ARCH-01; ADR-0021, ADR-0022, ADR-0023, ADR-0020). Authored by solution-architect.
-- Contract: docs/architecture/data-dictionary.md ("P3" section). Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
-- G1-G6 are BUSINESS approvals inside the product; nothing here touches engineering gates DG0-DG7, and no row here
-- approves anything.

-- -----------------------------------------------------------------------------------------------------------------
-- G4 required outputs (B0023 "Initiative cards, business cases, roadmap, owners, capacity"; ADR-0021 §7). G4 stays
-- submission_enabled = false here: the backend task enables it together with the evaluators (ADR-0021 §7).
INSERT INTO gate_criterion_definition (id, gate_definition_id, key, ordinal, label_en, label_ar, description_en,
                                       description_ar, mandatory, requires_verified_evidence, source_ref) VALUES
  ('01920002-0005-7000-8000-000000000011', '01920002-0004-7000-8000-000000000004', 'g4.initiative_cards', 1, 'Initiative cards', 'بطاقات المبادرات', 'At least one initiative in the approved portfolio; each has a name, objective, scope, at least one gap link and at least one outcome/KPI contribution.', 'مبادرة واحدة على الأقل في المحفظة المعتمدة؛ لكل منها اسم وهدف ونطاق، وربط بفجوة واحدة على الأقل، ومساهمة واحدة على الأقل في نتيجة/مؤشر أداء.', true, false, 'B0023;B0072'),
  ('01920002-0005-7000-8000-000000000012', '01920002-0004-7000-8000-000000000004', 'g4.business_cases', 2, 'Business cases', 'دراسات الجدوى', 'A transformation-level business case with all ten sections, and a linked initiative case for every initiative in the portfolio.', 'دراسة جدوى على مستوى التحول بأقسامها العشرة، ودراسة مرتبطة لكل مبادرة في المحفظة.', true, false, 'B0023;B0084;B0085'),
  ('01920002-0005-7000-8000-000000000013', '01920002-0004-7000-8000-000000000004', 'g4.finance_validation', 3, 'Finance validation', 'التحقق المالي', 'Finance has validated the baseline of every business case and the current version of every benefit formula used.', 'تحققت المالية من الخط الأساسي لكل دراسة جدوى ومن الإصدار الحالي لكل معادلة منافع مستخدمة.', true, false, 'B0084;B0139'),
  ('01920002-0005-7000-8000-000000000014', '01920002-0004-7000-8000-000000000004', 'g4.prioritization', 4, 'Prioritization', 'تحديد الأولويات', 'A current proposed ranking under the active weight set, with a complete score for every initiative in the portfolio.', 'ترتيب مقترح حالي وفق مجموعة الأوزان النشطة، مع درجة مكتملة لكل مبادرة في المحفظة.', true, false, 'B0076'),
  ('01920002-0005-7000-8000-000000000015', '01920002-0004-7000-8000-000000000004', 'g4.roadmap', 5, 'Roadmap', 'خريطة الطريق', 'Every initiative has a wave, planned dates and an approved milestone; no dependency cycle and no unmitigated schedule conflict.', 'لكل مبادرة موجة وتواريخ مخططة ومعلم معتمد؛ لا توجد دورة اعتماديات ولا تعارض زمني دون معالجة.', true, false, 'B0023;B0079;B0081'),
  ('01920002-0005-7000-8000-000000000016', '01920002-0004-7000-8000-000000000004', 'g4.owners', 6, 'Owners', 'المالكون', 'Every initiative in the portfolio has an executive owner and a workstream lead.', 'لكل مبادرة في المحفظة مالك تنفيذي وقائد مسار عمل.', true, false, 'B0023;B0072'),
  ('01920002-0005-7000-8000-000000000017', '01920002-0004-7000-8000-000000000004', 'g4.funding', 7, 'Funding', 'التمويل', 'Every initiative in the portfolio has a current approved funding decision.', 'لكل مبادرة في المحفظة قرار تمويل معتمد وساري.', true, false, 'M0121'),
  ('01920002-0005-7000-8000-000000000018', '01920002-0004-7000-8000-000000000004', 'g4.capacity', 8, 'Capacity', 'الطاقة الاستيعابية', 'Every initiative in the portfolio has a committed resource demand, and no committed demand exceeds the available capacity of its role and month.', 'لكل مبادرة في المحفظة طلب موارد ملتزم به، ولا يتجاوز أي طلب ملتزم به الطاقة المتاحة لدوره وشهره.', true, false, 'B0023;B0079');

-- -----------------------------------------------------------------------------------------------------------------
-- gate_decision_agreement: the three B0032 leadership agreement confirmations of an approved G1 decision (REQ-PB-022),
-- append-only. The deferred "approved G1 needs all three" guard ships with the API change (backend task, ADR-0021 §8).
CREATE TABLE gate_decision_agreement (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  gate_decision_id  uuid NOT NULL REFERENCES gate_decision (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  agreement_code    text NOT NULL CHECK (agreement_code IN ('problem', 'baseline', 'material_value_pools')),
  confirmed_by      uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  confirmed_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gate_decision_agreement_key UNIQUE (gate_decision_id, agreement_code)
);
-- Only an approved G1 decision carries confirmations, and only its decider confirms.
CREATE FUNCTION gate_decision_agreement_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM gate_decision g
                 WHERE g.id = NEW.gate_decision_id AND g.gate_code = 'G1' AND g.outcome = 'approved'
                   AND g.decided_by = NEW.confirmed_by AND g.transformation_id = NEW.transformation_id) THEN
    RAISE EXCEPTION 'gate_decision_agreement: % must belong to an approved G1 decision and be confirmed by its decider', NEW.gate_decision_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'gate_decision_agreement_g1_approved';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gate_decision_agreement_guard BEFORE INSERT ON gate_decision_agreement
  FOR EACH ROW EXECUTE FUNCTION gate_decision_agreement_guard();
SELECT p2_attach_append_only('gate_decision_agreement');
SELECT p2_attach_guards('gate_decision_agreement', false);
GRANT SELECT, INSERT ON gate_decision_agreement TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- P3 permission catalogue and role defaults. EXACTLY packages/shared/src/permissions.ts P3_PERMISSIONS /
-- P3_ROLE_PERMISSIONS (packages/db/src/seed.test.ts compares them). A CONFIGURABLE STARTING POINT, not a
-- Mobily-approved access policy. The SoD trigger from 0001 still refuses any technical_admin role holding a
-- business_approval or finance_validation permission.
INSERT INTO permission (code, category, description_en, description_ar) VALUES
  ('initiative.edit', 'write', 'Create and edit initiatives (T05), their links, deliverables and milestones; submit, withdraw and cancel', 'إنشاء المبادرات وتحريرها وروابطها ومخرجاتها ومعالمها؛ وتقديمها وسحبها وإلغاؤها'),
  ('initiative.launch', 'write', 'Launch a funded initiative once the sequencing rules allow it', 'إطلاق مبادرة ممولة عندما تسمح قواعد التسلسل بذلك'),
  ('portfolio.select', 'business_approval', 'Select or deselect initiatives for the approved portfolio (business approval)', 'اختيار المبادرات للمحفظة المعتمدة أو استبعادها (اعتماد أعمال)'),
  ('prioritization.score', 'write', 'Enter T06 scores for initiatives', 'إدخال درجات بطاقة تحديد الأولويات للمبادرات'),
  ('prioritization.edit', 'write', 'Propose weight sets, ranking snapshots and ranking overrides', 'اقتراح مجموعات الأوزان ولقطات الترتيب وتجاوزات الترتيب'),
  ('prioritization.approve', 'business_approval', 'Approve weight sets and ranking overrides (business approval)', 'اعتماد مجموعات الأوزان وتجاوزات الترتيب (اعتماد أعمال)'),
  ('roadmap.edit', 'write', 'Edit roadmap waves, wave assignments and milestone forecasts', 'تحرير موجات خريطة الطريق وإسناد المبادرات إليها وتوقعات المعالم'),
  ('roadmap.approve', 'write', 'Approve milestone baseline dates', 'اعتماد التواريخ الأساسية للمعالم'),
  ('deliverable.accept', 'write', 'Accept or reject deliverables of initiatives you own', 'قبول مخرجات المبادرات التي تملكها أو رفضها'),
  ('capacity.edit', 'write', 'Edit resourcing roles, capacity and resource demand', 'تحرير أدوار الموارد والطاقة الاستيعابية والطلب على الموارد'),
  ('capacity.commit', 'write', 'Commit or release resource demand against capacity', 'الالتزام بالطلب على الموارد مقابل الطاقة المتاحة أو تحريره'),
  ('funding.approve', 'business_approval', 'Record a funding decision for a selected initiative (business approval)', 'تسجيل قرار تمويل لمبادرة مختارة (اعتماد أعمال)'),
  ('business_case.edit', 'write', 'Create and edit business cases and their lines', 'إنشاء دراسات الجدوى وبنودها وتحريرها'),
  ('benefit_formula.edit', 'write', 'Create benefit formulas (T09) and new formula versions', 'إنشاء معادلات المنافع وإصدارات جديدة منها'),
  ('dependency_type.configure', 'configure', 'Add, relabel and retire configurable dependency types', 'إضافة أنواع الاعتماديات القابلة للإعداد وإعادة تسميتها وإيقافها');

INSERT INTO role_permission (role_id, permission_code) VALUES
  ('01920000-0000-7000-8000-000000000001', 'portfolio.select'), -- SP
  ('01920000-0000-7000-8000-000000000001', 'prioritization.approve'), -- SP
  ('01920000-0000-7000-8000-000000000001', 'deliverable.accept'), -- SP
  ('01920000-0000-7000-8000-000000000001', 'funding.approve'), -- SP
  ('01920000-0000-7000-8000-000000000002', 'initiative.edit'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'initiative.launch'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'prioritization.score'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'prioritization.edit'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'roadmap.edit'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'roadmap.approve'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'deliverable.accept'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'capacity.edit'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'business_case.edit'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'benefit_formula.edit'), -- TL
  ('01920000-0000-7000-8000-000000000003', 'prioritization.score'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'deliverable.accept'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'capacity.commit'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'benefit_formula.edit'), -- BO
  ('01920000-0000-7000-8000-000000000004', 'initiative.edit'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'prioritization.score'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'roadmap.edit'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'capacity.edit'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'business_case.edit'), -- WL
  ('01920000-0000-7000-8000-000000000005', 'funding.approve'), -- FIN
  ('01920000-0000-7000-8000-000000000006', 'initiative.edit'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'prioritization.edit'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'roadmap.edit'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'roadmap.approve'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'capacity.edit'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'capacity.commit'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'business_case.edit'), -- TO
  ('01920000-0000-7000-8000-000000000007', 'benefit_formula.edit'), -- KDS
  ('01920000-0000-7000-8000-00000000000e', 'dependency_type.configure'); -- ADM_METHOD

-- -----------------------------------------------------------------------------------------------------------------
-- P3 starter structure of a transformation (ADR-0023 §1, ADR-0022 §1): the P2 structure (p2_instantiate_transformation),
-- the four B0079 waves VERBATIM and the T06 weight set v1 at the B0076 source defaults. Same contract as the P2
-- function: idempotent, serialized by the row lock, every created row audited (actor 'user' from the API, 'system' on
-- behalf of the creator in a backfill). The API's POST /transformations switches to this function (backend task).
-- Every audit event's `changes` uses the AuditEvent diff shape {"<field>": {"from", "to"}} (ADR-0004); the weight set's
-- event is {"weights": {"from": null, "to": {...}}}. Corrected in place by T-DG3-ARCH-02 (0024 was unreleased and
-- ungated; the DG2 ARCH-01B precedent), so neither a fresh nor an upgraded database ever holds the earlier malformed
-- {"weights": {...}} row that T-DG3-BE-A found (finding 6.1).
CREATE FUNCTION p3_instantiate_transformation(p_transformation_id uuid, p_actor_user_id uuid, p_request_id text, p_source text)
RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  t record;
  rid uuid;
  creator uuid;
  a_type text := CASE WHEN p_actor_user_id IS NULL THEN 'system' ELSE 'user' END;
  on_behalf uuid;
  created integer;
  w record;
  c record;
BEGIN
  created := p2_instantiate_transformation(p_transformation_id, p_actor_user_id, p_request_id, p_source);
  SELECT x.id, x.organization_id, x.created_by INTO t FROM transformation x WHERE x.id = p_transformation_id FOR UPDATE;
  creator := coalesce(p_actor_user_id, t.created_by);
  on_behalf := CASE WHEN p_actor_user_id IS NULL THEN t.created_by END;

  -- Source text VERBATIM from docs/source/playbook.md B0079 (the en columns); Arabic is a PROVISIONAL translation.
  FOR w IN SELECT * FROM (VALUES
      ('wave_0', 0, 'Wave 0 — Mobilize', 'الموجة 0 — التعبئة', 'Baseline, governance, design decisions', 'الخط الأساسي، والحوكمة، وقرارات التصميم', '0-6 weeks', '0-6 أسابيع', 'Sponsor + charter', 'الراعي + الميثاق', 'Approved case, owners, stage gates', 'دراسة معتمدة، ومالكون، وبوابات مراحل', 0, 6),
      ('wave_1', 1, 'Wave 1 — Prove', 'الموجة 1 — الإثبات', 'Quick wins / pilots / de-risking', 'مكاسب سريعة / تجارب / تقليل المخاطر', '1-3 months', '1-3 أشهر', 'Prioritized initiatives', 'مبادرات ذات أولوية', 'Measured pilot results', 'نتائج تجارب مقاسة', 4, 13),
      ('wave_2', 2, 'Wave 2 — Scale', 'الموجة 2 — التوسّع', 'Scale validated changes', 'توسيع التغييرات المُتحقق منها', '3-9 months', '3-9 أشهر', 'Evidence + capacity', 'أدلة + طاقة استيعابية', 'Adoption + KPI movement', 'التبنّي + تحرك مؤشرات الأداء', 13, 39),
      ('wave_3', 3, 'Wave 3 — Embed', 'الموجة 3 — الترسيخ', 'BAU integration / optimization', 'الدمج في العمليات الاعتيادية / التحسين', '6-18 months', '6-18 شهراً', 'Stable solution', 'حل مستقر', 'Benefits sustained, ownership transferred', 'استدامة المنافع، ونقل الملكية', 26, 78)
    ) AS v(code, ordinal, name_en, name_ar, purpose_en, purpose_ar, horizon_en, horizon_ar, entry_en, entry_ar, exit_en, exit_ar, wfrom, wto)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM roadmap_wave r WHERE r.transformation_id = t.id AND r.code = w.code) THEN
      rid := mth_uuid_v7();
      INSERT INTO roadmap_wave (id, organization_id, transformation_id, code, ordinal, is_source_seeded, source_ref,
                                name_en, name_ar, purpose_en, purpose_ar, horizon_en, horizon_ar, entry_criteria_en,
                                entry_criteria_ar, exit_evidence_en, exit_evidence_ar, horizon_from_weeks,
                                horizon_to_weeks, created_by, updated_by)
      VALUES (rid, t.organization_id, t.id, w.code, w.ordinal, true, 'B0079', w.name_en, w.name_ar, w.purpose_en,
              w.purpose_ar, w.horizon_en, w.horizon_ar, w.entry_en, w.entry_ar, w.exit_en, w.exit_ar, w.wfrom, w.wto,
              creator, creator);
      INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, on_behalf_of_user_id, action,
                               record_type, record_id, new_version, request_id, source)
      VALUES (mth_uuid_v7(), t.organization_id, t.id, a_type, p_actor_user_id, on_behalf, 'roadmap_wave.create',
              'roadmap_wave', rid, 1, p_request_id, p_source);
      created := created + 1;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM scoring_weight_set s WHERE s.transformation_id = t.id) THEN
    rid := mth_uuid_v7();
    INSERT INTO scoring_weight_set (id, organization_id, transformation_id, version_no, status, approval_basis, rationale,
                                    activated_at, created_by, updated_by)
    VALUES (rid, t.organization_id, t.id, 1, 'active', 'source_default',
            'Source default weights (B0076): strategic fit 25%, financial value 25%, customer impact 20%, feasibility 15%, time-to-value 15%.',
            now(), creator, creator);
    FOR c IN SELECT * FROM (VALUES ('strategic_fit', 25.00), ('financial_value', 25.00), ('customer_impact', 20.00),
                                   ('feasibility', 15.00), ('time_to_value', 15.00)) AS v(code, weight) LOOP
      INSERT INTO scoring_weight (id, organization_id, transformation_id, weight_set_id, criterion_code, weight_percent, created_by)
      VALUES (mth_uuid_v7(), t.organization_id, t.id, rid, c.code, c.weight, creator);
    END LOOP;
    INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, on_behalf_of_user_id, action,
                             record_type, record_id, new_version, request_id, source, changes)
    VALUES (mth_uuid_v7(), t.organization_id, t.id, a_type, p_actor_user_id, on_behalf, 'scoring_weight_set.create',
            'scoring_weight_set', rid, 1, p_request_id, p_source,
            '{"weights": {"from": null, "to": {"strategic_fit": "25.00", "financial_value": "25.00", "customer_impact": "20.00", "feasibility": "15.00", "time_to_value": "15.00"}}}'::jsonb);
    created := created + 1;
  END IF;
  RETURN created;
END $$;

REVOKE ALL ON FUNCTION p3_instantiate_transformation(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p3_instantiate_transformation(uuid, uuid, text, text) TO mth_app;

-- Backfill: every existing transformation gets the P3 starter structure, audited as actor 'system' on behalf of its
-- creator. On a fresh database this selects no rows.
SELECT p3_instantiate_transformation(x.id, NULL, NULL, 'migration') FROM transformation x ORDER BY x.created_at, x.id;
