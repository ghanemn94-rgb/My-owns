-- 0011 methodology catalogue: version pin, T01 dimensions, Diagnose workstreams, TOM dimensions, product gate
-- definitions and criteria, scope checks, good outcome test (T-DG2-ARCH-01; ADR-0014, ADR-0015, ADR-0016). Authored
-- by solution-architect.
-- Contract: docs/architecture/data-dictionary.md ("P2" section). Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged; later P2 changes go into new migrations (0019+, owned by
-- backend-workflow-engineer). SQL floor: PostgreSQL 16. Ids are UUIDv7 from the application; seed rows use fixed
-- literal UUIDs.

-- -----------------------------------------------------------------------------------------------------------------
-- methodology_version: Immutable published methodology versions (ADR-0014). P2 seeds the playbook v1.0 version.
CREATE TABLE methodology_version (
  id              uuid PRIMARY KEY,
  key             text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  version_no      integer NOT NULL CHECK (version_no >= 1),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  title_en        text NOT NULL CHECK (char_length(title_en) BETWEEN 1 AND 200),
  title_ar        text NOT NULL CHECK (char_length(title_ar) BETWEEN 1 AND 200),
  source_document text NOT NULL CHECK (char_length(source_document) BETWEEN 1 AND 500),
  source_sha256   char(64) NULL CHECK (source_sha256 IS NULL OR source_sha256 ~ '^[0-9a-f]{64}$'),
  definition      jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  content_sha256  char(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  published_at    timestamptz NULL,
  published_by    uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version         integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT methodology_version_key_no_key UNIQUE (key, version_no),
  CONSTRAINT methodology_version_published_complete CHECK ((status = 'draft') = (published_at IS NULL))
);
CREATE FUNCTION methodology_version_published_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.status <> 'draft' AND (NEW.definition IS DISTINCT FROM OLD.definition
      OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256 OR NEW.key IS DISTINCT FROM OLD.key
      OR NEW.version_no IS DISTINCT FROM OLD.version_no) THEN
    RAISE EXCEPTION 'methodology_version %/%: a published definition is immutable (ADR-0014)', OLD.key, OLD.version_no
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_version_published_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER methodology_version_published_immutable BEFORE UPDATE ON methodology_version
  FOR EACH ROW EXECUTE FUNCTION methodology_version_published_immutable();
GRANT SELECT ON methodology_version TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- transformation_config_pin: Configuration version a transformation is pinned to (ADR-0014). P2: kind = methodology.
CREATE TABLE transformation_config_pin (
  id                     uuid PRIMARY KEY,
  organization_id        uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id      uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kind                   text NOT NULL CHECK (kind IN ('methodology')),
  methodology_version_id uuid NOT NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  pinned_at              timestamptz NOT NULL DEFAULT now(),
  pinned_by              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT transformation_config_pin_kind_key UNIQUE (transformation_id, kind)
);
SELECT p2_attach_guards('transformation_config_pin', true);
GRANT SELECT, INSERT, UPDATE ON transformation_config_pin TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- diagnostic_dimension: T01 dimensions (B0031): Financial, Customer, Process, People / Org, Technology, Data.
CREATE TABLE diagnostic_dimension (
  id                     uuid PRIMARY KEY,
  code                   text NOT NULL CONSTRAINT diagnostic_dimension_code_key UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{0,47}$'),
  methodology_version_id uuid NOT NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ordinal                smallint NOT NULL CONSTRAINT diagnostic_dimension_ordinal_key UNIQUE CHECK (ordinal BETWEEN 1 AND 99),
  source_label           text NOT NULL CHECK (char_length(source_label) BETWEEN 1 AND 100),
  label_en               text NOT NULL CHECK (char_length(label_en) BETWEEN 1 AND 200),
  label_ar               text NOT NULL CHECK (char_length(label_ar) BETWEEN 1 AND 200),
  evidence_hint_en       text NOT NULL CHECK (char_length(evidence_hint_en) BETWEEN 1 AND 200),
  evidence_hint_ar       text NOT NULL CHECK (char_length(evidence_hint_ar) BETWEEN 1 AND 200),
  impact_hint_en         text NOT NULL CHECK (char_length(impact_hint_en) BETWEEN 1 AND 200),
  impact_hint_ar         text NOT NULL CHECK (char_length(impact_hint_ar) BETWEEN 1 AND 200),
  is_source_seeded       boolean NOT NULL DEFAULT true,
  status                 text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
GRANT SELECT ON diagnostic_dimension TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- diagnostic_workstream: The six Diagnose workstreams with key questions and typical outputs (B0029).
CREATE TABLE diagnostic_workstream (
  id                        uuid PRIMARY KEY,
  code                      text NOT NULL CONSTRAINT diagnostic_workstream_code_key UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{0,47}$'),
  methodology_version_id    uuid NOT NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ordinal                   smallint NOT NULL CONSTRAINT diagnostic_workstream_ordinal_key UNIQUE CHECK (ordinal BETWEEN 1 AND 99),
  source_name_en            text NOT NULL CHECK (char_length(source_name_en) BETWEEN 1 AND 100),
  name_ar                   text NOT NULL CHECK (char_length(name_ar) BETWEEN 1 AND 200),
  source_key_questions_en   text NOT NULL CHECK (char_length(source_key_questions_en) BETWEEN 1 AND 1000),
  key_questions_ar          text NOT NULL CHECK (char_length(key_questions_ar) BETWEEN 1 AND 1000),
  source_typical_outputs_en text NOT NULL CHECK (char_length(source_typical_outputs_en) BETWEEN 1 AND 1000),
  typical_outputs_ar        text NOT NULL CHECK (char_length(typical_outputs_ar) BETWEEN 1 AND 1000),
  source_ref                text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 50),
  status                    text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  version                   integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
GRANT SELECT ON diagnostic_workstream TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- tom_dimension: The ten TOM dimensions with design questions (B0056) and canvas boxes/prompts (B0062).
CREATE TABLE tom_dimension (
  id                        uuid PRIMARY KEY,
  code                      text NOT NULL CONSTRAINT tom_dimension_code_key UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{0,47}$'),
  methodology_version_id    uuid NOT NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ordinal                   smallint NOT NULL CONSTRAINT tom_dimension_ordinal_key UNIQUE CHECK (ordinal BETWEEN 1 AND 10),
  source_name_en            text NOT NULL CHECK (char_length(source_name_en) BETWEEN 1 AND 100),
  source_design_question_en text NOT NULL CHECK (char_length(source_design_question_en) BETWEEN 1 AND 500),
  source_canvas_box_en      text NOT NULL CHECK (char_length(source_canvas_box_en) BETWEEN 1 AND 100),
  source_canvas_prompt_en   text NOT NULL CHECK (char_length(source_canvas_prompt_en) BETWEEN 1 AND 500),
  label_en                  text NOT NULL CHECK (char_length(label_en) BETWEEN 1 AND 200),
  label_ar                  text NOT NULL CHECK (char_length(label_ar) BETWEEN 1 AND 200),
  design_question_ar        text NOT NULL CHECK (char_length(design_question_ar) BETWEEN 1 AND 500),
  canvas_box_ar             text NOT NULL CHECK (char_length(canvas_box_ar) BETWEEN 1 AND 200),
  canvas_prompt_ar          text NOT NULL CHECK (char_length(canvas_prompt_ar) BETWEEN 1 AND 500),
  source_ref                text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 50),
  version                   integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE FUNCTION tom_dimension_source_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['label_en', 'label_ar', 'design_question_ar', 'canvas_box_ar', 'canvas_prompt_ar', 'version', 'updated_at', 'updated_by'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['label_en', 'label_ar', 'design_question_ar', 'canvas_box_ar', 'canvas_prompt_ar', 'version', 'updated_at', 'updated_by']) THEN
    RAISE EXCEPTION 'tom_dimension %: only display labels and Arabic translations are editable; source text, code and order are fixed (REQ-PB-038)', OLD.code
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tom_dimension_source_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tom_dimension_source_immutable BEFORE UPDATE ON tom_dimension
  FOR EACH ROW EXECUTE FUNCTION tom_dimension_source_immutable();
GRANT SELECT, UPDATE ON tom_dimension TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- gate_definition: Product gates G1-G6 (B0023): decision question, evidence required, default approver.
CREATE TABLE gate_definition (
  id                          uuid PRIMARY KEY,
  code                        text NOT NULL CONSTRAINT gate_definition_code_key UNIQUE CHECK (code ~ '^G[1-6]$'),
  methodology_version_id      uuid NOT NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ordinal                     smallint NOT NULL CONSTRAINT gate_definition_ordinal_key UNIQUE CHECK (ordinal BETWEEN 1 AND 6),
  phase                       text NOT NULL CHECK (phase IN ('diagnose', 'define', 'design', 'mobilize', 'transform', 'realize')),
  next_phase                  text NULL CHECK (next_phase IS NULL OR next_phase IN ('diagnose', 'define', 'design', 'mobilize', 'transform', 'realize')),
  source_name_en              text NOT NULL CHECK (char_length(source_name_en) BETWEEN 1 AND 100),
  name_ar                     text NOT NULL CHECK (char_length(name_ar) BETWEEN 1 AND 200),
  source_decision_question_en text NOT NULL CHECK (char_length(source_decision_question_en) BETWEEN 1 AND 500),
  decision_question_ar        text NOT NULL CHECK (char_length(decision_question_ar) BETWEEN 1 AND 500),
  source_evidence_required_en text NOT NULL CHECK (char_length(source_evidence_required_en) BETWEEN 1 AND 500),
  evidence_required_ar        text NOT NULL CHECK (char_length(evidence_required_ar) BETWEEN 1 AND 500),
  default_approver_role_code  text NOT NULL REFERENCES role (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  allowed_approver_role_codes text[] NOT NULL,
  submission_enabled          boolean NOT NULL DEFAULT false,
  source_ref                  text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 50),
  version                     integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT gate_definition_approver_allowed CHECK (cardinality(allowed_approver_role_codes) BETWEEN 1 AND 5 AND default_approver_role_code = ANY (allowed_approver_role_codes))
);
GRANT SELECT ON gate_definition TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- gate_criterion_definition: Required outputs (criteria) per gate, evaluated by the workflows module (ADR-0015).
CREATE TABLE gate_criterion_definition (
  id                         uuid PRIMARY KEY,
  gate_definition_id         uuid NOT NULL REFERENCES gate_definition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  key                        text NOT NULL CONSTRAINT gate_criterion_definition_key_key UNIQUE CHECK (key ~ '^g[1-6]\.[a-z_]{1,48}$'),
  ordinal                    smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 20),
  label_en                   text NOT NULL CHECK (char_length(label_en) BETWEEN 1 AND 200),
  label_ar                   text NOT NULL CHECK (char_length(label_ar) BETWEEN 1 AND 200),
  description_en             text NOT NULL CHECK (char_length(description_en) BETWEEN 1 AND 1000),
  description_ar             text NOT NULL CHECK (char_length(description_ar) BETWEEN 1 AND 1000),
  mandatory                  boolean NOT NULL DEFAULT true,
  requires_verified_evidence boolean NOT NULL DEFAULT false,
  source_ref                 text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 100),
  version                    integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  updated_by                 uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT gate_criterion_definition_ordinal_key UNIQUE (gate_definition_id, ordinal)
);
GRANT SELECT ON gate_criterion_definition TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- charter_scope_check_definition: The five charter scope sanity checks, verbatim (B0038-B0043).
CREATE TABLE charter_scope_check_definition (
  id                     uuid PRIMARY KEY,
  code                   text NOT NULL CONSTRAINT charter_scope_check_definition_code_key UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{0,47}$'),
  methodology_version_id uuid NOT NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ordinal                smallint NOT NULL CONSTRAINT charter_scope_check_definition_ordinal_key UNIQUE CHECK (ordinal BETWEEN 1 AND 5),
  source_question_en     text NOT NULL CHECK (char_length(source_question_en) BETWEEN 1 AND 500),
  question_ar            text NOT NULL CHECK (char_length(question_ar) BETWEEN 1 AND 500),
  source_ref             text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 50),
  system_precheck        text NOT NULL CHECK (system_precheck IN ('none', 'scope_items_traced', 'exclusions_present', 'baseline_measurable', 'executive_decisions_visible')),
  version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
GRANT SELECT ON charter_scope_check_definition TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- good_outcome_criterion: The good outcome test criteria (B0051).
CREATE TABLE good_outcome_criterion (
  id                     uuid PRIMARY KEY,
  code                   text NOT NULL CONSTRAINT good_outcome_criterion_code_key UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{0,47}$'),
  methodology_version_id uuid NOT NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ordinal                smallint NOT NULL CONSTRAINT good_outcome_criterion_ordinal_key UNIQUE CHECK (ordinal BETWEEN 1 AND 5),
  source_label_en        text NOT NULL CHECK (char_length(source_label_en) BETWEEN 1 AND 200),
  label_ar               text NOT NULL CHECK (char_length(label_ar) BETWEEN 1 AND 200),
  evaluation             text NOT NULL CHECK (evaluation IN ('user_attested', 'system_kpi_linked', 'system_owner_set')),
  source_ref             text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 50),
  version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
GRANT SELECT ON good_outcome_criterion TO mth_app;

-- Seed (source text VERBATIM from docs/source/playbook.md; Arabic text is a PROVISIONAL translation that needs
-- linguistic review). The playbook is a practical synthesis inspired by PMI/Brightline/BRM, not an official standard.
INSERT INTO methodology_version (id, key, version_no, status, title_en, title_ar, source_document, source_sha256,
                                 definition, content_sha256, published_at)
SELECT '01920002-0000-7000-8000-000000000001', 'playbook', 1, 'published', 'Business Transformation Playbook v1.0',
       'دليل التحول المؤسسي، الإصدار 1.0', 'docs/source/Business_Transformation_Playbook.docx',
       '2584a35282804e639a697478eae75a55a43cfb8c551345dfc7636b9b34548ad2', d.definition,
       encode(sha256(convert_to(d.definition::text, 'UTF8')), 'hex'), now()
FROM (SELECT '{"schema": "mth.methodology/1", "source": "docs/source/playbook.md", "sourceTitle": "Business Transformation Playbook", "sourceVersion": "1.0", "phases": 6, "gates": 6, "templates": 16, "tomDimensions": 10, "provenance": "Practical synthesis inspired by PMI, Brightline and BRM, with custom extensions. Not an official PMI standard."}'::jsonb AS definition) d;

INSERT INTO diagnostic_dimension (id, code, methodology_version_id, ordinal, source_label, label_en, label_ar,
                                  evidence_hint_en, evidence_hint_ar, impact_hint_en, impact_hint_ar) VALUES
  ('01920002-0001-7000-8000-000000000001', 'financial', '01920002-0000-7000-8000-000000000001', 1, 'Financial', 'Financial', 'مالي', '[Metric / source]', '[المقياس / المصدر]', '[SAR / KPI]', '[ريال سعودي / مؤشر أداء رئيسي]'),
  ('01920002-0001-7000-8000-000000000002', 'customer', '01920002-0000-7000-8000-000000000001', 2, 'Customer', 'Customer', 'العملاء', '[Metric / source]', '[المقياس / المصدر]', '[KPI]', '[مؤشر أداء رئيسي]'),
  ('01920002-0001-7000-8000-000000000003', 'process', '01920002-0000-7000-8000-000000000001', 3, 'Process', 'Process', 'العمليات', '[Metric / source]', '[المقياس / المصدر]', '[KPI]', '[مؤشر أداء رئيسي]'),
  ('01920002-0001-7000-8000-000000000004', 'people_org', '01920002-0000-7000-8000-000000000001', 4, 'People / Org', 'People / Org', 'الأفراد / التنظيم', '[Evidence]', '[الدليل]', '[Impact]', '[الأثر]'),
  ('01920002-0001-7000-8000-000000000005', 'technology', '01920002-0000-7000-8000-000000000001', 5, 'Technology', 'Technology', 'التقنية', '[Evidence]', '[الدليل]', '[Impact]', '[الأثر]'),
  ('01920002-0001-7000-8000-000000000006', 'data', '01920002-0000-7000-8000-000000000001', 6, 'Data', 'Data', 'البيانات', '[Evidence]', '[الدليل]', '[Impact]', '[الأثر]');

INSERT INTO diagnostic_workstream (id, code, methodology_version_id, ordinal, source_name_en, name_ar,
                                   source_key_questions_en, key_questions_ar, source_typical_outputs_en,
                                   typical_outputs_ar, source_ref) VALUES
  ('01920002-0002-7000-8000-000000000001', 'business_financial', '01920002-0000-7000-8000-000000000001', 1, 'Business & Financial', 'الأعمال والمالية', 'Where is value created/lost? Revenue, margin, cost, churn, productivity?', 'أين تُخلق القيمة أو تُفقد؟ الإيرادات، الهامش، التكلفة، معدل فقدان العملاء، الإنتاجية؟', 'Baseline P&L bridge, value pools, trend analysis.', 'جسر الأرباح والخسائر للخط الأساسي، مجمّعات القيمة، تحليل الاتجاهات.', 'B0029'),
  ('01920002-0002-7000-8000-000000000002', 'customer', '01920002-0000-7000-8000-000000000001', 2, 'Customer', 'العملاء', 'Where does the customer experience break?', 'أين تنكسر تجربة العملاء؟', 'Journey pain points, complaints, NPS/CSAT drivers.', 'نقاط الألم في رحلة العميل، الشكاوى، محركات NPS/CSAT.', 'B0029'),
  ('01920002-0002-7000-8000-000000000003', 'process_operations', '01920002-0000-7000-8000-000000000001', 3, 'Process & Operations', 'العمليات والتشغيل', 'Where are delays, rework, bottlenecks, handoffs?', 'أين توجد التأخيرات وإعادة العمل والاختناقات وعمليات التسليم؟', 'Process map, cycle time, failure demand.', 'خريطة العمليات، زمن الدورة، الطلب الناتج عن الإخفاق.', 'B0029'),
  ('01920002-0002-7000-8000-000000000004', 'organization_governance', '01920002-0000-7000-8000-000000000001', 4, 'Organization & Governance', 'التنظيم والحوكمة', 'Are roles, decision rights, incentives and accountability clear?', 'هل الأدوار وحقوق القرار والحوافز والمساءلة واضحة؟', 'RACI gaps, decision latency, governance map.', 'فجوات مصفوفة RACI، بطء اتخاذ القرار، خريطة الحوكمة.', 'B0029'),
  ('01920002-0002-7000-8000-000000000005', 'technology_data', '01920002-0000-7000-8000-000000000001', 5, 'Technology & Data', 'التقنية والبيانات', 'What systems/data constrain performance?', 'ما الأنظمة/البيانات التي تقيّد الأداء؟', 'Architecture pain points, automation/data gaps.', 'نقاط الألم في البنية، فجوات الأتمتة/البيانات.', 'B0029'),
  ('01920002-0002-7000-8000-000000000006', 'capability', '01920002-0000-7000-8000-000000000001', 6, 'Capability', 'القدرات', 'What skills/capabilities are missing?', 'ما المهارات/القدرات المفقودة؟', 'Capability heatmap, build/buy/partner needs.', 'خريطة حرارية للقدرات، احتياجات البناء/الشراء/الشراكة.', 'B0029');

INSERT INTO tom_dimension (id, code, methodology_version_id, ordinal, source_name_en, source_design_question_en,
                           source_canvas_box_en, source_canvas_prompt_en, label_en, label_ar, design_question_ar,
                           canvas_box_ar, canvas_prompt_ar, source_ref) VALUES
  ('01920002-0003-7000-8000-000000000001', 'customer_value_proposition', '01920002-0000-7000-8000-000000000001', 1, 'Customer & Value Proposition', 'What experience/value should customers receive?', 'CUSTOMER & VALUE', 'Segments / needs / promise / experience principles', 'Customer & Value Proposition', 'العملاء والقيمة المقدَّمة', 'ما التجربة/القيمة التي يجب أن يحصل عليها العملاء؟', 'العملاء والقيمة', 'الشرائح / الاحتياجات / الوعد / مبادئ التجربة', 'B0056;B0062'),
  ('01920002-0003-7000-8000-000000000002', 'products_services', '01920002-0000-7000-8000-000000000001', 2, 'Products & Services', 'What portfolio, pricing, features and service model are required?', 'PRODUCTS & SERVICES', 'Portfolio / bundles / pricing / service model', 'Products & Services', 'المنتجات والخدمات', 'ما المحفظة والتسعير والخصائص ونموذج الخدمة المطلوبة؟', 'المنتجات والخدمات', 'المحفظة / الباقات / التسعير / نموذج الخدمة', 'B0056;B0062'),
  ('01920002-0003-7000-8000-000000000003', 'journeys_processes', '01920002-0000-7000-8000-000000000001', 3, 'Journeys & Processes', 'What end-to-end journeys/processes must change?', 'JOURNEYS & PROCESSES', 'Critical E2E journeys / automation / controls', 'Journeys & Processes', 'الرحلات والعمليات', 'ما الرحلات/العمليات الشاملة التي يجب أن تتغير؟', 'الرحلات والعمليات', 'الرحلات الشاملة الحرجة / الأتمتة / الضوابط', 'B0056;B0062'),
  ('01920002-0003-7000-8000-000000000004', 'organization', '01920002-0000-7000-8000-000000000001', 4, 'Organization', 'What structure, roles and accountabilities are needed?', 'ORGANIZATION', 'Structure / role clarity / accountability', 'Organization', 'التنظيم', 'ما الهيكل والأدوار والمسؤوليات المطلوبة؟', 'التنظيم', 'الهيكل / وضوح الأدوار / المساءلة', 'B0056;B0062'),
  ('01920002-0003-7000-8000-000000000005', 'governance_decision_rights', '01920002-0000-7000-8000-000000000001', 5, 'Governance & Decision Rights', 'Who decides what, at what level, using what forums?', 'GOVERNANCE', 'Decision rights / forums / escalation', 'Governance & Decision Rights', 'الحوكمة وحقوق اتخاذ القرار', 'من يقرر ماذا، وعلى أي مستوى، ومن خلال أي منتديات؟', 'الحوكمة', 'حقوق اتخاذ القرار / المنتديات / التصعيد', 'B0056;B0062'),
  ('01920002-0003-7000-8000-000000000006', 'people_capabilities', '01920002-0000-7000-8000-000000000001', 6, 'People & Capabilities', 'What skills, capacity, behaviors and incentives are required?', 'PEOPLE & CAPABILITY', 'Skills / capacity / incentives / behaviors', 'People & Capabilities', 'الأفراد والقدرات', 'ما المهارات والطاقة الاستيعابية والسلوكيات والحوافز المطلوبة؟', 'الأفراد والقدرات', 'المهارات / الطاقة الاستيعابية / الحوافز / السلوكيات', 'B0056;B0062'),
  ('01920002-0003-7000-8000-000000000007', 'technology', '01920002-0000-7000-8000-000000000001', 7, 'Technology', 'What platforms, systems and integration are required?', 'TECHNOLOGY', 'Platforms / architecture / integration', 'Technology', 'التقنية', 'ما المنصات والأنظمة والتكامل المطلوبة؟', 'التقنية', 'المنصات / البنية / التكامل', 'B0056;B0062'),
  ('01920002-0003-7000-8000-000000000008', 'data_analytics', '01920002-0000-7000-8000-000000000001', 8, 'Data & Analytics', 'What data, metrics, models and ownership are needed?', 'DATA & ANALYTICS', 'Sources / ownership / insight / AI / measurement', 'Data & Analytics', 'البيانات والتحليلات', 'ما البيانات والمقاييس والنماذج والملكية المطلوبة؟', 'البيانات والتحليلات', 'المصادر / الملكية / الرؤى / الذكاء الاصطناعي / القياس', 'B0056;B0062'),
  ('01920002-0003-7000-8000-000000000009', 'partners_sourcing', '01920002-0000-7000-8000-000000000001', 9, 'Partners & Sourcing', 'What should be built, bought, outsourced or partnered?', 'PARTNERS & SOURCING', 'Partner model / vendors / build-buy-partner', 'Partners & Sourcing', 'الشركاء والتوريد', 'ما الذي يجب بناؤه أو شراؤه أو إسناده لجهات خارجية أو تنفيذه بالشراكة؟', 'الشركاء والتوريد', 'نموذج الشراكة / الموردون / البناء-الشراء-الشراكة', 'B0056;B0062'),
  ('01920002-0003-7000-8000-00000000000a', 'performance_management', '01920002-0000-7000-8000-000000000001', 10, 'Performance Management', 'How will KPIs, benefits and continuous improvement be managed?', 'PERFORMANCE', 'KPIs / benefits / management cadence / CI', 'Performance Management', 'إدارة الأداء', 'كيف ستُدار مؤشرات الأداء الرئيسية والمنافع والتحسين المستمر؟', 'الأداء', 'مؤشرات الأداء / المنافع / إيقاع الإدارة / التحسين المستمر', 'B0056;B0062');

-- Label edits by methodology admins are versioned and audited; attached after the seed rows exist.
SELECT p2_attach_guards('tom_dimension', true);

INSERT INTO gate_definition (id, code, methodology_version_id, ordinal, phase, next_phase, source_name_en, name_ar,
                             source_decision_question_en, decision_question_ar, source_evidence_required_en,
                             evidence_required_ar, default_approver_role_code, allowed_approver_role_codes,
                             submission_enabled, source_ref) VALUES
  ('01920002-0004-7000-8000-000000000001', 'G1', '01920002-0000-7000-8000-000000000001', 1, 'diagnose', 'define', 'G1 - Case for Change', 'G1 - مبررات التغيير', 'Do we agree on the problem/opportunity and value at stake?', 'هل نتفق على المشكلة/الفرصة والقيمة المعرّضة للتحقق؟', 'Diagnostic, baseline, root causes, value pools.', 'التشخيص، الخط الأساسي، الأسباب الجذرية، مجمّعات القيمة.', 'SP', ARRAY['SP']::text[], true, 'B0023'),
  ('01920002-0004-7000-8000-000000000002', 'G2', '01920002-0000-7000-8000-000000000001', 2, 'define', 'design', 'G2 - Direction', 'G2 - التوجّه', 'Are outcomes specific enough to steer decisions?', 'هل النتائج محددة بما يكفي لتوجيه القرارات؟', 'North Star, outcome tree, KPI definitions, guardrails.', 'نجم الشمال، شجرة النتائج، تعريفات مؤشرات الأداء الرئيسية، الضوابط الاستراتيجية.', 'SP', ARRAY['SP']::text[], true, 'B0023'),
  ('01920002-0004-7000-8000-000000000003', 'G3', '01920002-0000-7000-8000-000000000001', 3, 'design', 'mobilize', 'G3 - Target State', 'G3 - الحالة المستهدفة', 'Do we know what must be different operationally?', 'هل نعرف ما الذي يجب أن يختلف تشغيلياً؟', 'Target Operating Model, capability gaps, future journeys.', 'نموذج التشغيل المستهدف، فجوات القدرات، الرحلات المستقبلية.', 'SP', ARRAY['SP', 'BO']::text[], true, 'B0023'),
  ('01920002-0004-7000-8000-000000000004', 'G4', '01920002-0000-7000-8000-000000000001', 4, 'mobilize', 'transform', 'G4 - Mobilization', 'G4 - التعبئة', 'Is the portfolio executable and value-backed?', 'هل المحفظة قابلة للتنفيذ ومدعومة بالقيمة؟', 'Initiative cards, business cases, roadmap, owners, capacity.', 'بطاقات المبادرات، دراسات الجدوى، خريطة الطريق، المالكون، الطاقة الاستيعابية.', 'SP', ARRAY['SP']::text[], false, 'B0023'),
  ('01920002-0004-7000-8000-000000000005', 'G5', '01920002-0000-7000-8000-000000000001', 5, 'transform', 'realize', 'G5 - Scale', 'G5 - التوسّع', 'Are pilots/results sufficient to scale?', 'هل التجارب/النتائج كافية للتوسّع؟', 'Performance evidence, adoption, risk closure, decision log.', 'أدلة الأداء، التبنّي، إغلاق المخاطر، سجل القرارات.', 'SP', ARRAY['SP', 'BO']::text[], false, 'B0023'),
  ('01920002-0004-7000-8000-000000000006', 'G6', '01920002-0000-7000-8000-000000000001', 6, 'realize', NULL, 'G6 - Sustain', 'G6 - الاستدامة', 'Is value embedded in BAU?', 'هل القيمة مدمجة في العمليات الاعتيادية؟', 'Benefits evidence, ownership transfer, controls, continuous improvement backlog.', 'أدلة المنافع، نقل الملكية، الضوابط، قائمة أعمال التحسين المستمر.', 'SP', ARRAY['SP']::text[], false, 'B0023');

INSERT INTO gate_criterion_definition (id, gate_definition_id, key, ordinal, label_en, label_ar, description_en,
                                       description_ar, mandatory, requires_verified_evidence, source_ref) VALUES
  ('01920002-0005-7000-8000-000000000001', '01920002-0004-7000-8000-000000000001', 'g1.diagnostic', 1, 'Diagnostic', 'التشخيص', 'Current-state diagnostic (T01): every seeded dimension has current state, root cause, impact and confidence, and is backed by a linked baseline or verified evidence.', 'التشخيص الحالي (T01): لكل بُعد مُهيّأ حالة حالية وسبب جذري وأثر ودرجة ثقة، ومدعوم بخط أساسي مرتبط أو بدليل مُتحقَّق منه.', true, true, 'B0023;B0031;M0118'),
  ('01920002-0005-7000-8000-000000000002', '01920002-0004-7000-8000-000000000001', 'g1.baseline', 2, 'Baseline', 'الخط الأساسي', 'Trusted baseline: at least one measurable baseline (value, source, baseline date) backed by verified evidence.', 'خط أساسي موثوق: خط أساسي واحد على الأقل قابل للقياس (القيمة، المصدر، تاريخ الأساس) ومدعوم بدليل مُتحقَّق منه.', true, true, 'B0023;M0118'),
  ('01920002-0005-7000-8000-000000000003', '01920002-0004-7000-8000-000000000001', 'g1.root_causes', 3, 'Root causes', 'الأسباب الجذرية', 'Symptoms separated from root causes: every seeded T01 row states a root cause and at least one confirmed finding is classified as a root cause.', 'فصل الأعراض عن الأسباب الجذرية: كل صف مُهيّأ في T01 يذكر سبباً جذرياً، ونتيجة مؤكدة واحدة على الأقل مصنفة سبباً جذرياً.', true, false, 'B0023;M0118'),
  ('01920002-0005-7000-8000-000000000004', '01920002-0004-7000-8000-000000000001', 'g1.value_pools', 4, 'Value pools', 'مجمّعات القيمة', 'At least one value pool; each is quantified (upside and downside) or explicitly unquantified, and its materiality is assessed.', 'مجمّع قيمة واحد على الأقل؛ كل مجمّع إما مُقدَّر كمياً (الحد الأعلى والأدنى) أو موسوم صراحة بأنه غير مُقدَّر، مع تقييم أهميته النسبية.', true, false, 'B0023;B0032;M0118'),
  ('01920002-0005-7000-8000-000000000005', '01920002-0004-7000-8000-000000000001', 'g1.case_for_change', 5, 'Case for change', 'مبررات التغيير', 'The charter states the case for change.', 'يذكر الميثاق مبررات التغيير.', true, false, 'M0118;B0035'),
  ('01920002-0005-7000-8000-000000000006', '01920002-0004-7000-8000-000000000001', 'g1.initial_charter', 6, 'Initial charter', 'الميثاق الأولي', 'An initial charter exists with transformation name, executive sponsor, transformation lead, scope in and out, and baseline date.', 'يوجد ميثاق أولي يتضمن اسم التحول والراعي التنفيذي وقائد التحول والنطاق المشمول والمستبعد وتاريخ الأساس.', true, false, 'M0118;B0035'),
  ('01920002-0005-7000-8000-000000000007', '01920002-0004-7000-8000-000000000002', 'g2.north_star', 1, 'North Star', 'نجم الشمال', 'Exactly one current North Star, stated as one sentence.', 'نجم شمال حالي واحد فقط، بصيغة جملة واحدة.', true, false, 'B0023;B0048;M0119'),
  ('01920002-0005-7000-8000-000000000008', '01920002-0004-7000-8000-000000000002', 'g2.outcome_tree', 2, 'Outcome tree', 'شجرة النتائج', 'At least one top outcome under the North Star, each with at least one Outcome & KPI Tree row.', 'نتيجة رئيسية واحدة على الأقل تحت نجم الشمال، لكل منها صف واحد على الأقل في شجرة النتائج ومؤشرات الأداء.', true, false, 'B0023;B0050;M0119'),
  ('01920002-0005-7000-8000-000000000009', '01920002-0004-7000-8000-000000000002', 'g2.kpi_definitions', 3, 'KPI definitions', 'تعريفات مؤشرات الأداء الرئيسية', 'Every KPI used in the Outcome & KPI Tree has an active KPI definition with unit, polarity and owner.', 'لكل مؤشر أداء مستخدم في شجرة النتائج تعريف نشط يتضمن الوحدة والاتجاه والمالك.', true, false, 'B0023;M0119'),
  ('01920002-0005-7000-8000-00000000000a', '01920002-0004-7000-8000-000000000002', 'g2.target_trajectory', 4, 'Target trajectory', 'مسار المستهدفات', 'Every Outcome & KPI Tree row has a target, a target date and an approved target trajectory.', 'لكل صف في شجرة النتائج ومؤشرات الأداء مستهدف وتاريخ مستهدف ومسار مستهدفات معتمد.', true, false, 'B0048;M0119'),
  ('01920002-0005-7000-8000-00000000000b', '01920002-0004-7000-8000-000000000002', 'g2.guardrails', 5, 'Guardrails', 'الضوابط الاستراتيجية', 'At least one active strategic guardrail.', 'ضابط استراتيجي نشط واحد على الأقل.', true, false, 'B0023;B0035;M0119'),
  ('01920002-0005-7000-8000-00000000000c', '01920002-0004-7000-8000-000000000003', 'g3.target_operating_model', 1, 'Target Operating Model', 'نموذج التشغيل المستهدف', 'All ten TOM dimensions have a target design and an owner.', 'لجميع أبعاد نموذج التشغيل العشرة تصميم مستهدف ومالك.', true, false, 'B0023;B0056;M0120'),
  ('01920002-0005-7000-8000-00000000000d', '01920002-0004-7000-8000-000000000003', 'g3.gap_matrix', 2, 'Gap matrix', 'مصفوفة الفجوات', 'At least one TOM gap row; every open gap has an owner.', 'صف فجوة واحد على الأقل؛ ولكل فجوة مفتوحة مالك.', true, false, 'B0058;M0120'),
  ('01920002-0005-7000-8000-00000000000e', '01920002-0004-7000-8000-000000000003', 'g3.capability_gaps', 3, 'Capability gaps', 'فجوات القدرات', 'At least one rated capability whose target level is above its current level.', 'قدرة مُقيَّمة واحدة على الأقل يكون مستواها المستهدف أعلى من مستواها الحالي.', true, false, 'B0023;M0120'),
  ('01920002-0005-7000-8000-00000000000f', '01920002-0004-7000-8000-000000000003', 'g3.future_journeys', 4, 'Future journeys', 'الرحلات المستقبلية', 'At least one future-state journey or process.', 'رحلة أو عملية واحدة على الأقل للحالة المستقبلية.', true, false, 'B0023;M0120'),
  ('01920002-0005-7000-8000-000000000010', '01920002-0004-7000-8000-000000000003', 'g3.design_decisions', 5, 'Design decisions', 'قرارات التصميم', 'No open design decision is without a decision owner.', 'لا يوجد قرار تصميم مفتوح بدون مالك للقرار.', true, false, 'B0065;M0120');

INSERT INTO charter_scope_check_definition (id, code, methodology_version_id, ordinal, source_question_en,
                                            question_ar, source_ref, system_precheck) VALUES
  ('01920002-0006-7000-8000-000000000001', 'outcome_linkage', '01920002-0000-7000-8000-000000000001', 1, 'Is scope tied to outcomes rather than departments?', 'هل النطاق مرتبط بالنتائج بدلاً من الإدارات؟', 'B0039', 'none'),
  ('01920002-0006-7000-8000-000000000002', 'problem_traceability', '01920002-0000-7000-8000-000000000001', 2, 'Can each major scope item be traced to a diagnosed problem or opportunity?', 'هل يمكن تتبّع كل عنصر رئيسي في النطاق إلى مشكلة أو فرصة تم تشخيصها؟', 'B0040', 'scope_items_traced'),
  ('01920002-0006-7000-8000-000000000003', 'exclusions_documented', '01920002-0000-7000-8000-000000000001', 3, 'Are explicit exclusions documented?', 'هل الاستثناءات الصريحة موثّقة؟', 'B0041', 'exclusions_present'),
  ('01920002-0006-7000-8000-000000000004', 'baseline_measurable', '01920002-0000-7000-8000-000000000001', 4, 'Is the baseline measurable?', 'هل الخط الأساسي قابل للقياس؟', 'B0042', 'baseline_measurable'),
  ('01920002-0006-7000-8000-000000000005', 'executive_decisions_visible', '01920002-0000-7000-8000-000000000001', 5, 'Are executive decisions required to unblock the transformation visible?', 'هل القرارات التنفيذية اللازمة لإزالة عوائق التحول ظاهرة؟', 'B0043', 'executive_decisions_visible');

INSERT INTO good_outcome_criterion (id, code, methodology_version_id, ordinal, source_label_en, label_ar, evaluation,
                                    source_ref) VALUES
  ('01920002-0007-7000-8000-000000000001', 'specific', '01920002-0000-7000-8000-000000000001', 1, 'Specific', 'محددة', 'user_attested', 'B0051'),
  ('01920002-0007-7000-8000-000000000002', 'measurable', '01920002-0000-7000-8000-000000000001', 2, 'Measurable', 'قابلة للقياس', 'system_kpi_linked', 'B0051'),
  ('01920002-0007-7000-8000-000000000003', 'strategically_relevant', '01920002-0000-7000-8000-000000000001', 3, 'Strategically relevant', 'ذات صلة استراتيجية', 'user_attested', 'B0051'),
  ('01920002-0007-7000-8000-000000000004', 'owned_by_business_leader', '01920002-0000-7000-8000-000000000001', 4, 'Owned by a business leader', 'مملوكة لقائد أعمال', 'system_owner_set', 'B0051'),
  ('01920002-0007-7000-8000-000000000005', 'causal_chain', '01920002-0000-7000-8000-000000000001', 5, 'Achievable through a defined causal chain', 'قابلة للتحقيق عبر سلسلة سببية محددة', 'user_attested', 'B0051');
