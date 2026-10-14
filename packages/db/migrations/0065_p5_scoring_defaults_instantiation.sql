-- 0065 P5 slice A (T-DG5-KBE-A; ADR-0040 §5; D-142 Q12; REQ-PB-093): new transformations start from the T06 default
-- weights and rubric published in Playbook Studio.
--
-- D-142 Q12 is a scoped reopen of the DG3 function p3_instantiate_transformation() (last defined in 0025, whose body
-- equals 0024's). It is redefined here so that, for a transformation instantiated from now on, it
--   (a) pins the configuration kind `scoring_defaults` to the NEWEST PUBLISHED version of the key `scoring-defaults`
--       (a transformation_config_pin row with its transformation_config_pin.create audit event, like the DG2 methodology
--       pin of p2_instantiate_transformation()); an existing pin is kept, never moved (a pin moves only through an
--       approved methodology migration, ADR-0040 §1);
--   (b) creates the T06 weight set v1 from the weights of the PINNED version:
--       - while those weights equal the source defaults of B0076 (strategic fit 25, financial value 25, customer impact
--         20, feasibility 15, time-to-value 15; compared as numbers over the same five criteria), the statements below
--         are the DG3 statements VERBATIM: the same rows in the same order, approval_basis 'source_default', the DG3
--         rationale text and the DG3 audit event, so the DG3 output is byte-identical (regression test
--         apps/api/test/integration/methodology/scoring-defaults.test.ts);
--       - otherwise approval_basis is 'studio_default' (no approver: a configured starting point, NOT a business
--         approval), the weights are the version's in its element order, and the rationale names the version:
--         "Studio default weights (scoring defaults v{n}): strategic fit {w}%, ...".
-- Existing transformations are NOT touched: no pin is backfilled, so a transformation without a scoring_defaults pin
-- resolves to version 1 (ADR-0039 §3), and its weight set is its own approved record (ADR-0040 §5).
--
-- The column CHECK scoring_weight_set_approval_basis_check is widened with 'studio_default', and
-- scoring_weight_set_approval_complete is extended so that a studio_default set, like a source_default one, has no
-- approver. Additive: every existing row stays valid. The two waves/weight-set blocks below are otherwise unchanged
-- from 0025; p2_instantiate_transformation() and p4_instantiate_transformation() (which calls this one) are unchanged.
-- Product gates G1-G6 are business approvals inside the product; nothing here approves anything.

ALTER TABLE scoring_weight_set DROP CONSTRAINT scoring_weight_set_approval_basis_check;
ALTER TABLE scoring_weight_set
  ADD CONSTRAINT scoring_weight_set_approval_basis_check
  CHECK (approval_basis IS NULL OR approval_basis IN ('source_default', 'approved', 'studio_default'));

ALTER TABLE scoring_weight_set DROP CONSTRAINT scoring_weight_set_approval_complete;
ALTER TABLE scoring_weight_set
  ADD CONSTRAINT scoring_weight_set_approval_complete
  CHECK ((approved_by IS NULL) = (approved_at IS NULL)
         AND (approval_basis IS DISTINCT FROM 'approved' OR approved_by IS NOT NULL)
         AND (approval_basis IS DISTINCT FROM 'source_default' OR approved_by IS NULL)
         AND (approval_basis IS DISTINCT FROM 'studio_default' OR approved_by IS NULL));

CREATE OR REPLACE FUNCTION p3_instantiate_transformation(p_transformation_id uuid, p_actor_user_id uuid, p_request_id text, p_source text)
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
  sd_id uuid;
  sd_no integer;
  is_source boolean;
  sd_rationale text;
  sd_changes jsonb;
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

  -- (a) P5 (0065): the scoring_defaults pin, to the newest published version of `scoring-defaults` (ADR-0040 §5).
  IF NOT EXISTS (SELECT 1 FROM transformation_config_pin p WHERE p.transformation_id = t.id AND p.kind = 'scoring_defaults') THEN
    SELECT v.id INTO sd_id FROM methodology_version v
     WHERE v.config_kind = 'scoring_defaults' AND v.key = 'scoring-defaults' AND v.status = 'published'
     ORDER BY v.version_no DESC LIMIT 1;
    IF sd_id IS NOT NULL THEN
      rid := mth_uuid_v7();
      INSERT INTO transformation_config_pin (id, organization_id, transformation_id, kind, methodology_version_id, pinned_by,
                                             created_by, updated_by)
      VALUES (rid, t.organization_id, t.id, 'scoring_defaults', sd_id, creator, creator, creator);
      INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, on_behalf_of_user_id, action,
                               record_type, record_id, new_version, request_id, source)
      VALUES (mth_uuid_v7(), t.organization_id, t.id, a_type, p_actor_user_id, on_behalf, 'transformation_config_pin.create',
              'transformation_config_pin', rid, 1, p_request_id, p_source);
      created := created + 1;
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM scoring_weight_set s WHERE s.transformation_id = t.id) THEN
    -- (b) The weights of the pinned version (a pin that predates this call is kept and read as it is).
    SELECT p.methodology_version_id, v.version_no INTO sd_id, sd_no
      FROM transformation_config_pin p JOIN methodology_version v ON v.id = p.methodology_version_id
     WHERE p.transformation_id = t.id AND p.kind = 'scoring_defaults';
    is_source := sd_id IS NULL OR NOT EXISTS (
      (SELECT e.stable_key, (e.attributes->>'weightPercent')::numeric
         FROM methodology_element e
        WHERE e.methodology_version_id = sd_id AND e.element_type = 'scoring_weight' AND NOT e.removed
       EXCEPT
       SELECT * FROM (VALUES ('strategic_fit', 25::numeric), ('financial_value', 25), ('customer_impact', 20),
                             ('feasibility', 15), ('time_to_value', 15)) AS s(code, weight))
      UNION ALL
      (SELECT * FROM (VALUES ('strategic_fit', 25::numeric), ('financial_value', 25), ('customer_impact', 20),
                             ('feasibility', 15), ('time_to_value', 15)) AS s(code, weight)
       EXCEPT
       SELECT e.stable_key, (e.attributes->>'weightPercent')::numeric
         FROM methodology_element e
        WHERE e.methodology_version_id = sd_id AND e.element_type = 'scoring_weight' AND NOT e.removed));

    IF is_source THEN
      -- The DG3 statements (0024/0025), unchanged.
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
    ELSE
      -- Studio default weights (REQ-PB-093): the pinned published version's weights, in its element order. The publish
      -- guard (0062 methodology_version_weights_total) has already required 2-6 weights totalling exactly 100.
      SELECT 'Studio default weights (scoring defaults v' || sd_no || '): '
             || string_agg(CASE e.stable_key
                             WHEN 'strategic_fit' THEN 'strategic fit'
                             WHEN 'financial_value' THEN 'financial value'
                             WHEN 'customer_impact' THEN 'customer impact'
                             WHEN 'feasibility' THEN 'feasibility'
                             WHEN 'time_to_value' THEN 'time-to-value'
                             WHEN 'risk_compliance' THEN 'risk/compliance'
                           END || ' ' || trim_scale((e.attributes->>'weightPercent')::numeric)::text || '%',
                           ', ' ORDER BY e.ordinal NULLS LAST, e.stable_key) || '.',
             jsonb_build_object('weights', jsonb_build_object('from', NULL, 'to',
               jsonb_object_agg(e.stable_key, ((e.attributes->>'weightPercent')::numeric(5,2))::text)))
        INTO sd_rationale, sd_changes
        FROM methodology_element e
       WHERE e.methodology_version_id = sd_id AND e.element_type = 'scoring_weight' AND NOT e.removed;
      rid := mth_uuid_v7();
      INSERT INTO scoring_weight_set (id, organization_id, transformation_id, version_no, status, approval_basis, rationale,
                                      activated_at, created_by, updated_by)
      VALUES (rid, t.organization_id, t.id, 1, 'active', 'studio_default', sd_rationale, now(), creator, creator);
      FOR c IN SELECT e.stable_key AS code, (e.attributes->>'weightPercent')::numeric(5,2) AS weight
                 FROM methodology_element e
                WHERE e.methodology_version_id = sd_id AND e.element_type = 'scoring_weight' AND NOT e.removed
                ORDER BY e.ordinal NULLS LAST, e.stable_key LOOP
        INSERT INTO scoring_weight (id, organization_id, transformation_id, weight_set_id, criterion_code, weight_percent, created_by)
        VALUES (mth_uuid_v7(), t.organization_id, t.id, rid, c.code, c.weight, creator);
      END LOOP;
      INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, on_behalf_of_user_id, action,
                               record_type, record_id, new_version, request_id, source, changes)
      VALUES (mth_uuid_v7(), t.organization_id, t.id, a_type, p_actor_user_id, on_behalf, 'scoring_weight_set.create',
              'scoring_weight_set', rid, 1, p_request_id, p_source, sd_changes);
      created := created + 1;
    END IF;
  END IF;
  RETURN created;
END $$;
