-- 0025 P3 G1 leadership agreement guard (T-DG3-BE-A; ADR-0021 §8; REQ-PB-022, B0032), and the audit diff shape of
-- p3_instantiate_transformation() (see the end of this file). Authored by
-- backend-workflow-engineer. Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never
-- edit once merged. SQL floor: PostgreSQL 16.
--
-- An approved G1 gate_decision needs EXACTLY the three gate_decision_agreement rows (problem, baseline,
-- material_value_pools) at COMMIT. A deferred constraint trigger on gate_decision checks it, so the approving
-- transaction can insert the decision first and its three confirmations after it (the 0024 BEFORE INSERT guard on
-- gate_decision_agreement already requires the decision to exist and the confirmer to be its decider).
-- It ships with the API change that sends the confirmations (ADR-0021 §8, "same migration and release"): shipping it
-- earlier would have broken the DG2 G1 approval. gate_decision is append-only (0017), so checking at INSERT suffices;
-- gate_decision_agreement is append-only (0024), so rows can never be removed afterwards.
-- G1-G6 are BUSINESS approvals inside the product; nothing here touches engineering gates DG0-DG7, and no row here
-- approves anything. The API answers 422 gate.g1_agreements_required before this guard is ever reached; reaching it
-- means a programming error (the API maps the constraint to 500).

CREATE FUNCTION gate_decision_g1_agreements() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  n integer;
BEGIN
  IF NEW.gate_code <> 'G1' OR NEW.outcome <> 'approved' THEN
    RETURN NULL;
  END IF;
  SELECT count(DISTINCT a.agreement_code) INTO n
  FROM gate_decision_agreement a
  WHERE a.gate_decision_id = NEW.id
    AND a.agreement_code IN ('problem', 'baseline', 'material_value_pools');
  IF n <> 3 OR (SELECT count(*) FROM gate_decision_agreement a WHERE a.gate_decision_id = NEW.id) <> 3 THEN
    RAISE EXCEPTION 'gate_decision %: an approved G1 decision needs exactly the three leadership agreement confirmations (problem, baseline, material_value_pools); found %', NEW.id, n
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'gate_decision_g1_agreements';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER gate_decision_g1_agreements AFTER INSERT ON gate_decision DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION gate_decision_g1_agreements();

REVOKE ALL ON FUNCTION gate_decision_g1_agreements() FROM PUBLIC;

-- -----------------------------------------------------------------------------------------------------------------
-- p3_instantiate_transformation(): same function as 0024, with ONE change. Its scoring_weight_set.create audit event
-- wrote `changes` as {"weights": {...}}, which is not the audit diff shape ({"<field>": {"from", "to"}}) that every
-- other event uses and that the AuditEvent contract requires (GET /transformations/{id}/audit then failed contract
-- validation). It now writes {"weights": {"from": null, "to": {...}}}. Found when POST /transformations switched to
-- this function in the same release (T-DG3-BE-A); reported in the handback. Rows written by 0024's backfill on an
-- upgraded database keep the old shape (audit_event is append-only); a fresh database has none.
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
