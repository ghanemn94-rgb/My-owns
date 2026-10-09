-- 0030 P4 operating model: T11 Decision Rights Matrix and T12 RACI, seeded VERBATIM from the playbook, copied per
-- transformation as a configurable starting point, with the governance-matrix approval header and the one-accountable
-- guard, plus the P4 starter structure of a transformation and its backfill (T-DG4-ARCH-01; ADR-0026 §5-§7).
-- Authored by solution-architect. Contract: docs/architecture/data-dictionary.md ("P4" section). Runs as mth_owner
-- inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
-- Source text: docs/source/playbook.md B0099 (T11) and B0101 (T12), English VERBATIM; Arabic is a PROVISIONAL
-- translation. The seeded rows approve nothing: G1-G6 and every T11-routed approval are decided by named people.

-- -----------------------------------------------------------------------------------------------------------------
-- Party-list validation shared by the T11 tables: every code in the arrays exists in governance_party.
CREATE FUNCTION p4_parties_known(p_codes text[]) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(bool_and(EXISTS (SELECT 1 FROM governance_party g WHERE g.code = c)), true)
  FROM unnest(p_codes) AS c
$$;

-- -----------------------------------------------------------------------------------------------------------------
-- decision_right_template: the four T11 rows of B0099, verbatim, read-only.
CREATE TABLE decision_right_template (
  key                 text PRIMARY KEY CHECK (key ~ '^[a-z_]+$'),
  ordinal             smallint NOT NULL CHECK (ordinal >= 1),
  source_decision_en  text NOT NULL,
  source_recommend_en text NOT NULL,
  source_approve_en   text NOT NULL,
  source_consult_en   text NOT NULL,
  source_inform_en    text NOT NULL,
  source_sla_en       text NOT NULL,
  decision_ar         text NOT NULL,
  recommend_ar        text NOT NULL,
  approve_ar          text NOT NULL,
  consult_ar          text NOT NULL,
  inform_ar           text NOT NULL,
  sla_ar              text NOT NULL,
  recommend_parties   text[] NOT NULL,
  approve_party_code  text NOT NULL REFERENCES governance_party (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  consult_parties     text[] NOT NULL,
  inform_parties      text[] NOT NULL,
  sla_type            text NOT NULL CHECK (sla_type IN ('working_days', 'next_steerco_or_urgent', 'release_plan')),
  sla_working_days    smallint NULL CHECK (sla_working_days IS NULL OR sla_working_days BETWEEN 1 AND 250),
  escalation_chain    text[] NOT NULL CHECK (cardinality(escalation_chain) BETWEEN 1 AND 5),
  source_ref          text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 50),
  CONSTRAINT decision_right_template_ordinal_key UNIQUE (ordinal),
  CONSTRAINT decision_right_template_sla CHECK ((sla_type = 'working_days') = (sla_working_days IS NOT NULL))
);
GRANT SELECT ON decision_right_template TO mth_app;
-- Escalation chain (D-089 Q7): the Approve party, then SP. Where the Approve party is SP, the chain is SP alone, and an
-- escalation past it is a visible routing error (ADR-0026 §6).
INSERT INTO decision_right_template (key, ordinal, source_decision_en, source_recommend_en, source_approve_en, source_consult_en, source_inform_en, source_sla_en, decision_ar, recommend_ar, approve_ar, consult_ar, inform_ar, sla_ar, recommend_parties, approve_party_code, consult_parties, inform_parties, sla_type, sla_working_days, escalation_chain, source_ref) VALUES
  ('business_scope_change', 1, 'Business scope change', 'Transformation Lead', 'Sponsor', 'Business owners / Finance', 'Workstreams', '5 working days', 'تغيير نطاق الأعمال', 'قائد التحول', 'الراعي', 'ملاك الأعمال / المالية', 'مسارات العمل', '5 أيام عمل', ARRAY['TL'], 'SP', ARRAY['BUSINESS_OWNERS', 'FIN'], ARRAY['WORKSTREAMS'], 'working_days', 5, ARRAY['SP'], 'B0099'),
  ('funding_reallocation', 2, 'Funding reallocation', 'Transformation Lead + Finance', 'SteerCo', 'Initiative owners', 'PMO', 'Next SteerCo / urgent route', 'إعادة تخصيص التمويل', 'قائد التحول + المالية', 'اللجنة التوجيهية', 'مالكو المبادرات', 'مكتب إدارة المشاريع', 'اجتماع اللجنة التوجيهية التالي / المسار العاجل', ARRAY['TL', 'FIN'], 'STEERCO', ARRAY['INITIATIVE_OWNERS'], ARRAY['PMO'], 'next_steerco_or_urgent', NULL, ARRAY['STEERCO', 'SP'], 'B0099'),
  ('target_state_design', 3, 'Target-state design', 'Design owner', 'Business owner', 'Tech / Ops / CX / Finance', 'Transformation Office', '10 working days', 'تصميم الحالة المستهدفة', 'مالك التصميم', 'مالك الأعمال', 'التقنية / العمليات / تجربة العملاء / المالية', 'مكتب التحول', '10 أيام عمل', ARRAY['DESIGN_OWNER'], 'BO', ARRAY['TECH', 'OPS', 'CX', 'FIN'], ARRAY['TO'], 'working_days', 10, ARRAY['BO', 'SP'], 'B0099'),
  ('go_live_scale', 4, 'Go-live / scale', 'Initiative owner', 'Business owner', 'Risk / Tech / CX', 'SteerCo', 'Per release plan', 'الإطلاق / التوسّع', 'مالك المبادرة', 'مالك الأعمال', 'المخاطر / التقنية / تجربة العملاء', 'اللجنة التوجيهية', 'وفق خطة الإصدار', ARRAY['INITIATIVE_OWNER'], 'BO', ARRAY['RISK', 'TECH', 'CX'], ARRAY['STEERCO'], 'release_plan', NULL, ARRAY['BO', 'SP'], 'B0099');

-- -----------------------------------------------------------------------------------------------------------------
-- governance_matrix: one approval header per transformation and matrix kind (T11 = decision_rights, T12 = raci).
-- Row edits bump its version; SP approves a version through the approval engine (0031). While a version is in
-- approval, the matrix rows are frozen (trigger below).
CREATE TABLE governance_matrix (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kind              text NOT NULL CHECK (kind IN ('decision_rights', 'raci')),
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_approval', 'approved')),
  approved_version  integer NULL CHECK (approved_version IS NULL OR approved_version >= 1),
  approved_at       timestamptz NULL,
  approved_by       uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT governance_matrix_kind_key UNIQUE (transformation_id, kind),
  CONSTRAINT governance_matrix_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT governance_matrix_approval_complete CHECK (
    (approved_version IS NULL) = (approved_at IS NULL) AND (approved_at IS NULL) = (approved_by IS NULL)
    AND (status <> 'approved' OR approved_version IS NOT NULL))
);
SELECT p2_attach_guards('governance_matrix', true);
GRANT SELECT, INSERT, UPDATE ON governance_matrix TO mth_app;

-- Matrix rows are frozen while their matrix is in approval (ADR-0026 §5).
CREATE FUNCTION governance_matrix_rows_editable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  k text := CASE WHEN TG_TABLE_NAME = 'transformation_decision_right' THEN 'decision_rights' ELSE 'raci' END;
BEGIN
  IF EXISTS (SELECT 1 FROM governance_matrix g
             WHERE g.transformation_id = NEW.transformation_id AND g.kind = k AND g.status = 'in_approval') THEN
    RAISE EXCEPTION '%: the % matrix is in approval; its rows cannot change until it is decided', TG_TABLE_NAME, k
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_matrix_in_approval';
  END IF;
  RETURN NEW;
END $$;

-- -----------------------------------------------------------------------------------------------------------------
-- transformation_decision_right: the T11 matrix of one transformation (REQ-PB-065, REQ-PB-066). Seeded rows copy the
-- template verbatim (template_key set); teams edit their copy and may add rows. The template never changes.
CREATE TABLE transformation_decision_right (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id   uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  template_key        text NULL REFERENCES decision_right_template (key) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ordinal             smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 999),
  decision_en         text NOT NULL CHECK (char_length(decision_en) BETWEEN 1 AND 300),
  decision_ar         text NOT NULL CHECK (char_length(decision_ar) BETWEEN 1 AND 300),
  recommend_label     text NOT NULL CHECK (char_length(recommend_label) BETWEEN 1 AND 300),
  approve_label       text NOT NULL CHECK (char_length(approve_label) BETWEEN 1 AND 300),
  consult_label       text NOT NULL CHECK (char_length(consult_label) BETWEEN 1 AND 300),
  inform_label        text NOT NULL CHECK (char_length(inform_label) BETWEEN 1 AND 300),
  sla_label           text NOT NULL CHECK (char_length(sla_label) BETWEEN 1 AND 300),
  recommend_parties   text[] NOT NULL DEFAULT '{}',
  approve_party_code  text NOT NULL REFERENCES governance_party (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  consult_parties     text[] NOT NULL DEFAULT '{}',
  inform_parties      text[] NOT NULL DEFAULT '{}',
  sla_type            text NOT NULL CHECK (sla_type IN ('working_days', 'next_steerco_or_urgent', 'release_plan')),
  sla_working_days    smallint NULL CHECK (sla_working_days IS NULL OR sla_working_days BETWEEN 1 AND 250),
  urgent_working_days smallint NULL CHECK (urgent_working_days IS NULL OR urgent_working_days BETWEEN 1 AND 250),
  escalation_chain    text[] NOT NULL CHECK (cardinality(escalation_chain) BETWEEN 1 AND 5),
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT transformation_decision_right_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT transformation_decision_right_sla CHECK (
    (sla_type = 'working_days') = (sla_working_days IS NOT NULL)
    AND (urgent_working_days IS NULL OR sla_type = 'next_steerco_or_urgent'))
);
CREATE UNIQUE INDEX transformation_decision_right_template_key ON transformation_decision_right (transformation_id, template_key)
  WHERE template_key IS NOT NULL;
CREATE INDEX transformation_decision_right_order_idx ON transformation_decision_right (transformation_id, ordinal, id);
CREATE FUNCTION transformation_decision_right_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT (p4_parties_known(NEW.recommend_parties) AND p4_parties_known(NEW.consult_parties)
          AND p4_parties_known(NEW.inform_parties) AND p4_parties_known(NEW.escalation_chain)) THEN
    RAISE EXCEPTION 'transformation_decision_right: unknown governance party code'
      USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'transformation_decision_right_party_known';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.template_key IS DISTINCT FROM OLD.template_key THEN
    RAISE EXCEPTION 'transformation_decision_right: template_key is immutable'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'transformation_decision_right_template_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transformation_decision_right_guard BEFORE INSERT OR UPDATE ON transformation_decision_right
  FOR EACH ROW EXECUTE FUNCTION transformation_decision_right_guard();
CREATE TRIGGER transformation_decision_right_editable BEFORE INSERT OR UPDATE ON transformation_decision_right
  FOR EACH ROW EXECUTE FUNCTION governance_matrix_rows_editable();
SELECT p2_attach_guards('transformation_decision_right', true);
GRANT SELECT, INSERT, UPDATE ON transformation_decision_right TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- raci_template_deliverable / raci_template_cell: the six T12 deliverables of B0101 and their 36 cells, verbatim,
-- read-only. Columns map to parties: Sponsor = SP, Transformation Lead = TL, Business Owner = BO,
-- Workstream Lead = WL, Finance = FIN, Tech/Data = TD.
CREATE TABLE raci_template_deliverable (
  key                   text PRIMARY KEY CHECK (key ~ '^[a-z_]+$'),
  ordinal               smallint NOT NULL CHECK (ordinal >= 1),
  source_deliverable_en text NOT NULL,
  deliverable_ar        text NOT NULL,
  source_ref            text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 50),
  CONSTRAINT raci_template_deliverable_ordinal_key UNIQUE (ordinal)
);
CREATE TABLE raci_template_cell (
  deliverable_key text NOT NULL REFERENCES raci_template_deliverable (key) ON DELETE RESTRICT ON UPDATE RESTRICT,
  party_code      text NOT NULL REFERENCES governance_party (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  value           text NOT NULL CHECK (value IN ('A', 'R', 'C', 'I', 'A/R')),
  PRIMARY KEY (deliverable_key, party_code)
);
GRANT SELECT ON raci_template_deliverable, raci_template_cell TO mth_app;
INSERT INTO raci_template_deliverable (key, ordinal, source_deliverable_en, deliverable_ar, source_ref) VALUES
  ('charter', 1, 'Charter', 'الميثاق', 'B0101'),
  ('target_operating_model', 2, 'Target Operating Model', 'نموذج التشغيل المستهدف', 'B0101'),
  ('business_case', 3, 'Business Case', 'دراسة الجدوى', 'B0101'),
  ('initiative_delivery', 4, 'Initiative Delivery', 'تنفيذ المبادرات', 'B0101'),
  ('benefits_validation', 5, 'Benefits Validation', 'التحقق من المنافع', 'B0101'),
  ('bau_handover', 6, 'BAU Handover', 'التسليم إلى العمليات الاعتيادية', 'B0101');
INSERT INTO raci_template_cell (deliverable_key, party_code, value)
SELECT d.key, p.party, p.value
FROM (VALUES
  ('charter', 'SP', 'A'), ('charter', 'TL', 'R'), ('charter', 'BO', 'C'), ('charter', 'WL', 'I'), ('charter', 'FIN', 'C'), ('charter', 'TD', 'I'),
  ('target_operating_model', 'SP', 'C'), ('target_operating_model', 'TL', 'R'), ('target_operating_model', 'BO', 'A'), ('target_operating_model', 'WL', 'C'), ('target_operating_model', 'FIN', 'C'), ('target_operating_model', 'TD', 'C'),
  ('business_case', 'SP', 'A'), ('business_case', 'TL', 'R'), ('business_case', 'BO', 'C'), ('business_case', 'WL', 'C'), ('business_case', 'FIN', 'R'), ('business_case', 'TD', 'C'),
  ('initiative_delivery', 'SP', 'I'), ('initiative_delivery', 'TL', 'C'), ('initiative_delivery', 'BO', 'A'), ('initiative_delivery', 'WL', 'R'), ('initiative_delivery', 'FIN', 'C'), ('initiative_delivery', 'TD', 'C'),
  ('benefits_validation', 'SP', 'I'), ('benefits_validation', 'TL', 'C'), ('benefits_validation', 'BO', 'A'), ('benefits_validation', 'WL', 'C'), ('benefits_validation', 'FIN', 'R'), ('benefits_validation', 'TD', 'I'),
  ('bau_handover', 'SP', 'I'), ('bau_handover', 'TL', 'C'), ('bau_handover', 'BO', 'A/R'), ('bau_handover', 'WL', 'R'), ('bau_handover', 'FIN', 'C'), ('bau_handover', 'TD', 'C')
) AS p (deliverable, party, value)
JOIN raci_template_deliverable d ON d.key = p.deliverable;

-- -----------------------------------------------------------------------------------------------------------------
-- transformation_raci_deliverable / transformation_raci_assignment: the T12 RACI of one transformation
-- (REQ-PB-067, REQ-S10-007, REQ-S10-009). A cell value is A, R, C, I or A/R, or NULL (no involvement).
CREATE TABLE transformation_raci_deliverable (
  id                        uuid PRIMARY KEY,
  organization_id           uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id         uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  template_key              text NULL REFERENCES raci_template_deliverable (key) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ordinal                   smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 999),
  label_en                  text NOT NULL CHECK (char_length(label_en) BETWEEN 1 AND 300),
  label_ar                  text NOT NULL CHECK (char_length(label_ar) BETWEEN 1 AND 300),
  accountability_exception  text NULL CHECK (accountability_exception IS NULL OR char_length(accountability_exception) BETWEEN 10 AND 2000),
  status                    text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  version                   integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT transformation_raci_deliverable_transformation_id_id_key UNIQUE (transformation_id, id)
);
CREATE UNIQUE INDEX transformation_raci_deliverable_template_key ON transformation_raci_deliverable (transformation_id, template_key)
  WHERE template_key IS NOT NULL;
CREATE INDEX transformation_raci_deliverable_order_idx ON transformation_raci_deliverable (transformation_id, ordinal, id);
CREATE TRIGGER transformation_raci_deliverable_editable BEFORE INSERT OR UPDATE ON transformation_raci_deliverable
  FOR EACH ROW EXECUTE FUNCTION governance_matrix_rows_editable();
SELECT p2_attach_guards('transformation_raci_deliverable', true);
GRANT SELECT, INSERT, UPDATE ON transformation_raci_deliverable TO mth_app;

CREATE TABLE transformation_raci_assignment (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  deliverable_id    uuid NOT NULL,
  party_code        text NOT NULL REFERENCES governance_party (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  value             text NULL CONSTRAINT transformation_raci_assignment_value CHECK (value IS NULL OR value IN ('A', 'R', 'C', 'I', 'A/R')),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT transformation_raci_assignment_deliverable_fkey FOREIGN KEY (transformation_id, deliverable_id)
    REFERENCES transformation_raci_deliverable (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT transformation_raci_assignment_cell_key UNIQUE (deliverable_id, party_code)
);
CREATE FUNCTION transformation_raci_assignment_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.deliverable_id IS DISTINCT FROM OLD.deliverable_id OR NEW.party_code IS DISTINCT FROM OLD.party_code THEN
    RAISE EXCEPTION 'transformation_raci_assignment: deliverable and party are immutable'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'transformation_raci_assignment_cell_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transformation_raci_assignment_guard BEFORE UPDATE ON transformation_raci_assignment
  FOR EACH ROW EXECUTE FUNCTION transformation_raci_assignment_guard();
CREATE TRIGGER transformation_raci_assignment_editable BEFORE INSERT OR UPDATE ON transformation_raci_assignment
  FOR EACH ROW EXECUTE FUNCTION governance_matrix_rows_editable();
SELECT p2_attach_guards('transformation_raci_assignment', true);
GRANT SELECT, INSERT, UPDATE ON transformation_raci_assignment TO mth_app;

-- One accountable per deliverable (REQ-S10-009, M0211): at COMMIT, an active deliverable has exactly one cell whose
-- value is A or A/R ('A/R' counts as one), unless accountability_exception documents the governance rule that permits
-- otherwise. Deferred, so a save that moves the A between cells in one transaction passes. Serialized per deliverable
-- with advisory-lock class 730225 (ADR-0016 §6).
CREATE FUNCTION transformation_raci_one_accountable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  raci_deliverable_lock_class CONSTANT integer := 730225;
  did uuid := CASE WHEN TG_TABLE_NAME = 'transformation_raci_deliverable' THEN NEW.id
                   ELSE (to_jsonb(NEW) ->> 'deliverable_id')::uuid END;
  d record;
  n integer;
BEGIN
  PERFORM pg_advisory_xact_lock(raci_deliverable_lock_class, hashtext(did::text));
  SELECT x.status, x.accountability_exception, x.label_en INTO d FROM transformation_raci_deliverable x WHERE x.id = did;
  IF NOT FOUND OR d.status <> 'active' OR d.accountability_exception IS NOT NULL THEN
    RETURN NULL;
  END IF;
  SELECT count(*) INTO n FROM transformation_raci_assignment a WHERE a.deliverable_id = did AND a.value IN ('A', 'A/R');
  IF n <> 1 THEN
    RAISE EXCEPTION 'transformation_raci: deliverable % (%) has % accountable assignments; exactly one is required', did, d.label_en, n
      USING ERRCODE = 'check_violation', CONSTRAINT = 'transformation_raci_one_accountable';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER transformation_raci_assignment_one_accountable AFTER INSERT OR UPDATE ON transformation_raci_assignment
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION transformation_raci_one_accountable();
CREATE CONSTRAINT TRIGGER transformation_raci_deliverable_one_accountable AFTER INSERT OR UPDATE ON transformation_raci_deliverable
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION transformation_raci_one_accountable();

-- -----------------------------------------------------------------------------------------------------------------
-- P4 starter structure of a transformation (ADR-0026 §7): the P3 structure (p3_instantiate_transformation), the two
-- governance-matrix headers, the four T11 rows and the six T12 deliverables with their 36 cells, all copied verbatim.
-- Same contract as p2/p3: idempotent, serialized by the transformation row lock, every created row audited (actor
-- 'user' from the API; 'system' on behalf of the creator in the backfill). Edits to a copy never touch the template
-- or another transformation (REQ-S10-007).
CREATE FUNCTION p4_instantiate_transformation(p_transformation_id uuid, p_actor_user_id uuid, p_request_id text, p_source text)
RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  t record;
  rid uuid;
  did uuid;
  creator uuid;
  a_type text := CASE WHEN p_actor_user_id IS NULL THEN 'system' ELSE 'user' END;
  on_behalf uuid;
  created integer;
  k text;
  r record;
  c record;
BEGIN
  created := p3_instantiate_transformation(p_transformation_id, p_actor_user_id, p_request_id, p_source);
  SELECT x.id, x.organization_id, x.created_by INTO t FROM transformation x WHERE x.id = p_transformation_id FOR UPDATE;
  creator := coalesce(p_actor_user_id, t.created_by);
  on_behalf := CASE WHEN p_actor_user_id IS NULL THEN t.created_by END;

  FOREACH k IN ARRAY ARRAY['decision_rights', 'raci'] LOOP
    IF NOT EXISTS (SELECT 1 FROM governance_matrix g WHERE g.transformation_id = t.id AND g.kind = k) THEN
      rid := mth_uuid_v7();
      INSERT INTO governance_matrix (id, organization_id, transformation_id, kind, created_by, updated_by)
      VALUES (rid, t.organization_id, t.id, k, creator, creator);
      INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, on_behalf_of_user_id, action,
                               record_type, record_id, new_version, request_id, source)
      VALUES (mth_uuid_v7(), t.organization_id, t.id, a_type, p_actor_user_id, on_behalf, 'governance_matrix.create',
              'governance_matrix', rid, 1, p_request_id, p_source);
      created := created + 1;
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM decision_right_template ORDER BY ordinal LOOP
    IF NOT EXISTS (SELECT 1 FROM transformation_decision_right x WHERE x.transformation_id = t.id AND x.template_key = r.key) THEN
      rid := mth_uuid_v7();
      INSERT INTO transformation_decision_right (id, organization_id, transformation_id, template_key, ordinal, decision_en,
        decision_ar, recommend_label, approve_label, consult_label, inform_label, sla_label, recommend_parties,
        approve_party_code, consult_parties, inform_parties, sla_type, sla_working_days, escalation_chain, created_by, updated_by)
      VALUES (rid, t.organization_id, t.id, r.key, r.ordinal, r.source_decision_en, r.decision_ar, r.source_recommend_en,
              r.source_approve_en, r.source_consult_en, r.source_inform_en, r.source_sla_en, r.recommend_parties,
              r.approve_party_code, r.consult_parties, r.inform_parties, r.sla_type, r.sla_working_days, r.escalation_chain,
              creator, creator);
      INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, on_behalf_of_user_id, action,
                               record_type, record_id, new_version, request_id, source)
      VALUES (mth_uuid_v7(), t.organization_id, t.id, a_type, p_actor_user_id, on_behalf, 'transformation_decision_right.create',
              'transformation_decision_right', rid, 1, p_request_id, p_source);
      created := created + 1;
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM raci_template_deliverable ORDER BY ordinal LOOP
    IF NOT EXISTS (SELECT 1 FROM transformation_raci_deliverable x WHERE x.transformation_id = t.id AND x.template_key = r.key) THEN
      did := mth_uuid_v7();
      INSERT INTO transformation_raci_deliverable (id, organization_id, transformation_id, template_key, ordinal, label_en,
                                                   label_ar, created_by, updated_by)
      VALUES (did, t.organization_id, t.id, r.key, r.ordinal, r.source_deliverable_en, r.deliverable_ar, creator, creator);
      INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, on_behalf_of_user_id, action,
                               record_type, record_id, new_version, request_id, source)
      VALUES (mth_uuid_v7(), t.organization_id, t.id, a_type, p_actor_user_id, on_behalf, 'transformation_raci_deliverable.create',
              'transformation_raci_deliverable', did, 1, p_request_id, p_source);
      created := created + 1;
      FOR c IN SELECT cell.party_code, cell.value FROM raci_template_cell cell
               JOIN governance_party g ON g.code = cell.party_code
               WHERE cell.deliverable_key = r.key ORDER BY g.ordinal LOOP
        rid := mth_uuid_v7();
        INSERT INTO transformation_raci_assignment (id, organization_id, transformation_id, deliverable_id, party_code, value,
                                                    created_by, updated_by)
        VALUES (rid, t.organization_id, t.id, did, c.party_code, c.value, creator, creator);
        INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, on_behalf_of_user_id, action,
                                 record_type, record_id, new_version, request_id, source)
        VALUES (mth_uuid_v7(), t.organization_id, t.id, a_type, p_actor_user_id, on_behalf, 'transformation_raci_assignment.create',
                'transformation_raci_assignment', rid, 1, p_request_id, p_source);
        created := created + 1;
      END LOOP;
    END IF;
  END LOOP;
  RETURN created;
END $$;
REVOKE ALL ON FUNCTION p4_instantiate_transformation(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p4_instantiate_transformation(uuid, uuid, text, text) TO mth_app;

-- Backfill: every existing transformation gets the P4 starter structure (the P2/P3 parts already exist and are
-- skipped), audited as actor 'system' on behalf of its creator. On a fresh database this selects no rows.
SELECT p4_instantiate_transformation(x.id, NULL, NULL, 'migration') FROM transformation x ORDER BY x.created_at, x.id;
