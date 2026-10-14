-- 0089 P5 slice I: the playbook reader (verbatim source blocks, en/ar full-text search, block links), the provenance
-- statement and source foundations, element provenance and guiding-question tags, the two claim/label text rules, and
-- versioned branding with a configurable product name (T-DG5-ARCH-06; ADR-0049; REQ-PB-001, REQ-PB-002, REQ-PB-011,
-- REQ-PB-077, REQ-S01-002, REQ-S02-004, REQ-S03-010, REQ-S15-004, REQ-S21-001). Authored by solution-architect.
-- Contract: docs/architecture/data-dictionary.md ("P5 tables, slices I and J"). Runs as mth_owner inside one
-- transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16 (the 'english'
-- and 'arabic' text search configurations were verified on the pinned 16.13 server; ADR-0049 §3). Ids come from the
-- application (UUIDv7); seed rows use fixed literal UUIDs.
--
-- Source texts: the four guiding questions are VERBATIM from B0016, the source foundations from B0156, the element
-- labels without a source_element row from B0149, B0146 and B0161. The 165 playbook blocks themselves are seeded by
-- BE-Q in 0092 (VERBATIM from docs/source/playbook.md). Every Arabic text is a PROVISIONAL translation that needs review
-- by a Mobily Arabic editor. The question tag of each template is an ANALYST DEFAULT (REQ-PB-011 notes: the source
-- gives the rule, not the mapping); the provenance of each element follows B0156-B0162.
--
-- Slice A objects touched (DG5 code, not yet approved; the 0068/0086 precedent): methodology_element gains one extra
-- BEFORE trigger (methodology_element_reader_guard) for the reader namespaces of element type 'methodology_text';
-- methodology_element_guard() is NOT redefined. No DG1-DG4 table, constraint or function changes.
-- Nothing here grants or records a business approval, and nothing reads or writes the engineering gates DG0-DG7.

-- -----------------------------------------------------------------------------------------------------------------
-- The two text rules (ADR-0049 §7). IMMUTABLE, so CHECK constraints can use them. packages/shared/src/text-scan/**
-- (BE-R) mirrors them exactly; a test runs both over one corpus.
-- p5_claims_official_pmi: true when the text claims official PMI status or certification (REQ-PB-001, M0089), in en
-- or ar, after removing negated mentions ("not an official PMI standard", "غير معتمد من PMI", "ليس معيارًا رسميًا من PMI";
-- an Arabic negation may be followed by one word before the claim), which are true disclaimers and allowed.
CREATE FUNCTION p5_claims_official_pmi(t text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  claim CONSTANT text := '(official(ly)?\s+(an?\s+)?PMI|PMI[\s-]*(certified|certification|accredited|endorsed|approved)'
    || '|certified\s+(by|under)\s+(the\s+)?PMI|PMI\s+standard\s+(product|application|platform|tool|software)'
    || '|(معتمد|معتمدة|مُعتمد|مُعتمدة)\s+من\s+(قبل\s+)?(PMI|معهد\s+إدارة\s+المشاريع)'
    || '|(معيار|معايير|منهجية)\s+(PMI|معهد\s+إدارة\s+المشاريع)\s+(الرسمي|الرسمية)'
    || '|شهادة\s+(PMI|معهد\s+إدارة\s+المشاريع)|(PMI|معهد\s+إدارة\s+المشاريع)\s+(الرسمي|الرسمية|المعتمد|المعتمدة)'
    || '|(رسمي|رسمية|رسميًا|رسمياً)\s+من\s+(PMI|معهد\s+إدارة\s+المشاريع))';
  neg CONSTANT text := '((not|never|no|nor|without|isn''t|aren''t)\s+((an?|the)\s+)?|(ليس|ليست|لا|غير|دون)\s+(\S+\s+)?)';
BEGIN
  IF t IS NULL THEN
    RETURN false;
  END IF;
  RETURN regexp_replace(t, neg || claim, ' ', 'gi') ~* claim;
END $$;
-- p5_mentions_engineering_gate: true when the text names an engineering delivery gate DG0-DG7 (REQ-S21-001: no product
-- screen or export template shows DG status). Western and Arabic-Indic digits.
CREATE FUNCTION p5_mentions_engineering_gate(t text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(t ~* '(^|[^A-Za-z0-9_])DG\s*-?\s*[0-7٠-٧]([^0-9٠-٩]|$)', false)
$$;
GRANT EXECUTE ON FUNCTION p5_claims_official_pmi(text) TO mth_app;
GRANT EXECUTE ON FUNCTION p5_mentions_engineering_gate(text) TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- guiding_question: the four B0016 questions, verbatim (REQ-PB-011). Read-only to mth_app.
CREATE TABLE guiding_question (
  code       text PRIMARY KEY CHECK (code IN ('why_change', 'what_different', 'how_execute', 'how_prove_value')),
  ordinal    smallint NOT NULL CONSTRAINT guiding_question_ordinal_key UNIQUE CHECK (ordinal BETWEEN 1 AND 4),
  text_en    text NOT NULL CHECK (char_length(text_en) BETWEEN 1 AND 100),
  text_ar    text NOT NULL CHECK (char_length(text_ar) BETWEEN 1 AND 200),
  source_ref text NOT NULL CHECK (source_ref = 'B0016')
);
GRANT SELECT ON guiding_question TO mth_app;
INSERT INTO guiding_question (code, ordinal, text_en, text_ar, source_ref) VALUES
  ('why_change', 1, 'Why change?', 'لماذا التغيير؟', 'B0016'),
  ('what_different', 2, 'What must become different?', 'ما الذي يجب أن يصبح مختلفاً؟', 'B0016'),
  ('how_execute', 3, 'How will we execute?', 'كيف سننفّذ؟', 'B0016'),
  ('how_prove_value', 4, 'How will we prove value?', 'كيف سنثبت القيمة؟', 'B0016');
SELECT p2_attach_append_only('guiding_question');

-- -----------------------------------------------------------------------------------------------------------------
-- playbook_block: the 165 blocks of the authoritative playbook v1.0 (docs/source/playbook.md, anchors B0001-B0165),
-- text_en VERBATIM (tables kept as the source's Markdown rows), text_ar a PROVISIONAL translation. Seeded by BE-Q (0092).
-- Never deleted; only the Arabic translation and its provisional flag may be corrected, by a migration (owner).
-- search_en/search_ar are stored generated tsvectors over the 'english' and 'arabic' configurations (ADR-0049 §3).
CREATE TABLE playbook_block (
  block_ref         text PRIMARY KEY CHECK (block_ref ~ '^B0[0-9]{3}$' AND substring(block_ref FROM 2)::integer BETWEEN 1 AND 165),
  ordinal           smallint NOT NULL CONSTRAINT playbook_block_ordinal_key UNIQUE CHECK (ordinal BETWEEN 1 AND 165),
  block_kind        text NOT NULL CHECK (block_kind IN ('text', 'table')),
  is_heading        boolean NOT NULL DEFAULT false,
  section_block_ref text NULL REFERENCES playbook_block (block_ref) ON DELETE RESTRICT ON UPDATE RESTRICT,
  phase_code        text NULL REFERENCES phase_definition (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  text_en           text NOT NULL CHECK (char_length(text_en) BETWEEN 1 AND 20000),
  text_ar           text NOT NULL CHECK (char_length(text_ar) BETWEEN 1 AND 40000),
  ar_provisional    boolean NOT NULL DEFAULT true,
  source_document   text NOT NULL DEFAULT 'docs/source/playbook.md' CHECK (source_document = 'docs/source/playbook.md'),
  search_en         tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, text_en)) STORED,
  search_ar         tsvector GENERATED ALWAYS AS (to_tsvector('arabic'::regconfig, text_ar)) STORED,
  CONSTRAINT playbook_block_ordinal_matches CHECK (ordinal = substring(block_ref FROM 2)::integer),
  CONSTRAINT playbook_block_section_before CHECK (section_block_ref IS NULL OR section_block_ref < block_ref)
);
CREATE INDEX playbook_block_search_en_idx ON playbook_block USING gin (search_en);
CREATE INDEX playbook_block_search_ar_idx ON playbook_block USING gin (search_ar);
CREATE INDEX playbook_block_phase_idx ON playbook_block (phase_code, ordinal);
CREATE FUNCTION playbook_block_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'playbook_block: source blocks are never deleted'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'playbook_block_immutable';
  END IF;
  IF NEW.block_ref IS DISTINCT FROM OLD.block_ref OR NEW.ordinal IS DISTINCT FROM OLD.ordinal
     OR NEW.block_kind IS DISTINCT FROM OLD.block_kind OR NEW.is_heading IS DISTINCT FROM OLD.is_heading
     OR NEW.section_block_ref IS DISTINCT FROM OLD.section_block_ref OR NEW.phase_code IS DISTINCT FROM OLD.phase_code
     OR NEW.text_en IS DISTINCT FROM OLD.text_en OR NEW.source_document IS DISTINCT FROM OLD.source_document THEN
    RAISE EXCEPTION 'playbook_block %: the verbatim source text and its position never change; only text_ar and ar_provisional may be corrected', OLD.block_ref
      USING ERRCODE = 'check_violation', CONSTRAINT = 'playbook_block_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER playbook_block_guard BEFORE UPDATE OR DELETE ON playbook_block
  FOR EACH ROW EXECUTE FUNCTION playbook_block_guard();
CREATE TRIGGER playbook_block_guard_truncate BEFORE TRUNCATE ON playbook_block
  FOR EACH STATEMENT EXECUTE FUNCTION playbook_block_guard();
GRANT SELECT ON playbook_block TO mth_app;

-- playbook_block_link: the seeded links of a block to the native form (template), procedure and requirement IDs that
-- implement it (REQ-S02-004). Seeded by BE-Q (0092). Version-scoped additions and removals are Studio
-- 'methodology_text' elements with stable key 'block.<Bxxxx>' (ADR-0049 §4). Append-only.
CREATE TABLE playbook_block_link (
  block_ref   text NOT NULL REFERENCES playbook_block (block_ref) ON DELETE RESTRICT ON UPDATE RESTRICT,
  target_kind text NOT NULL CHECK (target_kind IN ('template', 'procedure', 'requirement')),
  target_key  text NOT NULL CHECK (char_length(target_key) BETWEEN 1 AND 100),
  ordinal     smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 99),
  PRIMARY KEY (block_ref, target_kind, target_key),
  CONSTRAINT playbook_block_link_ordinal_key UNIQUE (block_ref, ordinal),
  CONSTRAINT playbook_block_link_target_shape CHECK (CASE target_kind
    WHEN 'template' THEN target_key ~ '^T(0[1-9]|1[0-6])$'
    WHEN 'requirement' THEN target_key ~ '^REQ-[A-Z0-9]+-[0-9]{3}$'
    ELSE target_key ~ '^[a-z][a-z0-9_]{0,62}$' END)
);
CREATE INDEX playbook_block_link_target_idx ON playbook_block_link (target_kind, target_key);
SELECT p2_attach_append_only('playbook_block_link');
GRANT SELECT ON playbook_block_link TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- source_foundation: the B0156 source-foundations table (Source / Used for), verbatim, shown read-only (REQ-PB-001).
CREATE TABLE source_foundation (
  code        text PRIMARY KEY CHECK (code IN ('pmi_organizational_transformation', 'brightline_transformation_compass',
                                               'pmi_benefits_realization_management')),
  ordinal     smallint NOT NULL CONSTRAINT source_foundation_ordinal_key UNIQUE CHECK (ordinal BETWEEN 1 AND 3),
  source_en   text NOT NULL CHECK (char_length(source_en) BETWEEN 1 AND 200),
  source_ar   text NOT NULL CHECK (char_length(source_ar) BETWEEN 1 AND 300),
  used_for_en text NOT NULL CHECK (char_length(used_for_en) BETWEEN 1 AND 500),
  used_for_ar text NOT NULL CHECK (char_length(used_for_ar) BETWEEN 1 AND 800),
  source_ref  text NOT NULL CHECK (source_ref = 'B0156')
);
GRANT SELECT ON source_foundation TO mth_app;
INSERT INTO source_foundation (code, ordinal, source_en, source_ar, used_for_en, used_for_ar, source_ref) VALUES
  ('pmi_organizational_transformation', 1, 'PMI Organizational Transformation Series', 'سلسلة التحول المؤسسي من PMI',
   'Transformation concepts, building blocks, lifecycle, readiness, implementation and orchestration.',
   'مفاهيم التحول ولبناته الأساسية ودورة حياته والجاهزية والتنفيذ والتنسيق.', 'B0156'),
  ('brightline_transformation_compass', 2, 'Brightline Initiative / Transformation Compass', 'مبادرة برايتلاين / بوصلة التحول',
   'North Star, transformation operating-system thinking, people-centered transformation and transformation leadership.',
   'النجم الشمالي، والتفكير بنظام تشغيل التحول، والتحول المتمحور حول الإنسان، وقيادة التحول.', 'B0156'),
  ('pmi_benefits_realization_management', 3, 'PMI Benefits Realization Management', 'إدارة تحقيق المنافع من PMI',
   'Benefit identification, delivery/measurement and sustainment logic.',
   'منطق تحديد المنافع وتحقيقها/قياسها واستدامتها.', 'B0156');
SELECT p2_attach_append_only('source_foundation');

-- -----------------------------------------------------------------------------------------------------------------
-- methodology_element_profile: the default provenance and guiding-question tag of every seeded methodology element
-- named by B0156-B0162 (REQ-PB-002, REQ-PB-011). element_ref = '<element_kind>.<stable_key>'. Elements with a
-- source_element row (0064) take their labels from it; the three without one carry their own. A Studio version may
-- override provenance or question tag through a 'methodology_text' element 'profile.<element_ref>' (ADR-0049 §2).
-- Provenance follows the source: B0158 phases, B0159 TOM, B0160 gates and templates, B0161 scoring model, governance
-- cadence (forums), launch plan and health check, B0162 roaming example and traceability chain are custom extensions;
-- the benefit lifecycle is inspired by PMI Benefits Realization Management (B0156). Exactly one question tag per
-- template, none elsewhere.
CREATE TABLE methodology_element_profile (
  element_ref           text PRIMARY KEY,
  element_kind          text NOT NULL CHECK (element_kind IN ('phase', 'gate', 'tom_dimension', 'template', 'scoring_model',
                          'forum', 'launch_window', 'health_check', 'roaming_example', 'traceability_chain', 'benefit_lifecycle_step')),
  stable_key            text NOT NULL CHECK (stable_key ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$'),
  ordinal               smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 99),
  source_element_id     uuid NULL REFERENCES source_element (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  label_en              text NULL CHECK (label_en IS NULL OR char_length(label_en) BETWEEN 1 AND 300),
  label_ar              text NULL CHECK (label_ar IS NULL OR char_length(label_ar) BETWEEN 1 AND 300),
  provenance            text NOT NULL CHECK (provenance IN ('custom_extension', 'foundation_inspired')),
  provenance_source_ref text NOT NULL CHECK (provenance_source_ref IN ('B0156', 'B0158', 'B0159', 'B0160', 'B0161', 'B0162')),
  question_tag          text NULL REFERENCES guiding_question (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  source_refs           text[] NOT NULL CHECK (cardinality(source_refs) BETWEEN 1 AND 10),
  CONSTRAINT methodology_element_profile_ref CHECK (element_ref = element_kind || '.' || stable_key),
  CONSTRAINT methodology_element_profile_kind_ordinal_key UNIQUE (element_kind, ordinal),
  CONSTRAINT methodology_element_profile_label CHECK ((source_element_id IS NULL) = (label_en IS NOT NULL AND label_ar IS NOT NULL)
                                                     AND (label_en IS NULL) = (label_ar IS NULL)),
  CONSTRAINT methodology_element_profile_question_tag CHECK ((element_kind = 'template') = (question_tag IS NOT NULL)),
  CONSTRAINT methodology_element_profile_provenance CHECK ((provenance = 'foundation_inspired') = (provenance_source_ref = 'B0156')),
  CONSTRAINT methodology_element_profile_kind_source CHECK (provenance_source_ref = CASE element_kind
    WHEN 'phase' THEN 'B0158' WHEN 'tom_dimension' THEN 'B0159' WHEN 'gate' THEN 'B0160' WHEN 'template' THEN 'B0160'
    WHEN 'benefit_lifecycle_step' THEN 'B0156' WHEN 'roaming_example' THEN 'B0162' WHEN 'traceability_chain' THEN 'B0162'
    ELSE 'B0161' END),
  CONSTRAINT methodology_element_profile_source_refs
    CHECK (array_to_string(source_refs, ',') ~ '^B0(00[1-9]|0[1-9][0-9]|1[0-5][0-9]|16[0-5])(,B0(00[1-9]|0[1-9][0-9]|1[0-5][0-9]|16[0-5]))*$')
);
-- The source_element of a profile row must be the same identity (set_code.stable_key = element_ref).
CREATE FUNCTION methodology_element_profile_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.source_element_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM source_element s WHERE s.id = NEW.source_element_id AND s.set_code || '.' || s.stable_key = NEW.element_ref) THEN
    RAISE EXCEPTION 'methodology_element_profile %: source_element % is not the same identity', NEW.element_ref, NEW.source_element_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_element_profile_source_element';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER methodology_element_profile_guard BEFORE INSERT ON methodology_element_profile
  FOR EACH ROW EXECUTE FUNCTION methodology_element_profile_guard();
GRANT SELECT ON methodology_element_profile TO mth_app;
INSERT INTO methodology_element_profile (element_ref, element_kind, stable_key, ordinal, source_element_id, label_en, label_ar,
                                         provenance, provenance_source_ref, question_tag, source_refs) VALUES
  ('phase.diagnose', 'phase', 'diagnose', 1, '01920005-0011-7000-8000-000000000001', NULL, NULL, 'custom_extension', 'B0158', NULL, '{B0021,B0026}'),
  ('phase.define', 'phase', 'define', 2, '01920005-0011-7000-8000-000000000002', NULL, NULL, 'custom_extension', 'B0158', NULL, '{B0021,B0045}'),
  ('phase.design', 'phase', 'design', 3, '01920005-0011-7000-8000-000000000003', NULL, NULL, 'custom_extension', 'B0158', NULL, '{B0021,B0053}'),
  ('phase.mobilize', 'phase', 'mobilize', 4, '01920005-0011-7000-8000-000000000004', NULL, NULL, 'custom_extension', 'B0158', NULL, '{B0021,B0067}'),
  ('phase.transform', 'phase', 'transform', 5, '01920005-0011-7000-8000-000000000005', NULL, NULL, 'custom_extension', 'B0158', NULL, '{B0021,B0090}'),
  ('phase.realize', 'phase', 'realize', 6, '01920005-0011-7000-8000-000000000006', NULL, NULL, 'custom_extension', 'B0158', NULL, '{B0021,B0118,B0124}'),
  ('gate.G1', 'gate', 'G1', 1, '01920005-0012-7000-8000-000000000001', NULL, NULL, 'custom_extension', 'B0160', NULL, '{B0023}'),
  ('gate.G2', 'gate', 'G2', 2, '01920005-0012-7000-8000-000000000002', NULL, NULL, 'custom_extension', 'B0160', NULL, '{B0023}'),
  ('gate.G3', 'gate', 'G3', 3, '01920005-0012-7000-8000-000000000003', NULL, NULL, 'custom_extension', 'B0160', NULL, '{B0023}'),
  ('gate.G4', 'gate', 'G4', 4, '01920005-0012-7000-8000-000000000004', NULL, NULL, 'custom_extension', 'B0160', NULL, '{B0023}'),
  ('gate.G5', 'gate', 'G5', 5, '01920005-0012-7000-8000-000000000005', NULL, NULL, 'custom_extension', 'B0160', NULL, '{B0023}'),
  ('gate.G6', 'gate', 'G6', 6, '01920005-0012-7000-8000-000000000006', NULL, NULL, 'custom_extension', 'B0160', NULL, '{B0023}'),
  ('tom_dimension.customer_value_proposition', 'tom_dimension', 'customer_value_proposition', 1, '01920005-0014-7000-8000-000000000001', NULL, NULL, 'custom_extension', 'B0159', NULL, '{B0056}'),
  ('tom_dimension.products_services', 'tom_dimension', 'products_services', 2, '01920005-0014-7000-8000-000000000002', NULL, NULL, 'custom_extension', 'B0159', NULL, '{B0056}'),
  ('tom_dimension.journeys_processes', 'tom_dimension', 'journeys_processes', 3, '01920005-0014-7000-8000-000000000003', NULL, NULL, 'custom_extension', 'B0159', NULL, '{B0056}'),
  ('tom_dimension.organization', 'tom_dimension', 'organization', 4, '01920005-0014-7000-8000-000000000004', NULL, NULL, 'custom_extension', 'B0159', NULL, '{B0056}'),
  ('tom_dimension.governance_decision_rights', 'tom_dimension', 'governance_decision_rights', 5, '01920005-0014-7000-8000-000000000005', NULL, NULL, 'custom_extension', 'B0159', NULL, '{B0056}'),
  ('tom_dimension.people_capabilities', 'tom_dimension', 'people_capabilities', 6, '01920005-0014-7000-8000-000000000006', NULL, NULL, 'custom_extension', 'B0159', NULL, '{B0056}'),
  ('tom_dimension.technology', 'tom_dimension', 'technology', 7, '01920005-0014-7000-8000-000000000007', NULL, NULL, 'custom_extension', 'B0159', NULL, '{B0056}'),
  ('tom_dimension.data_analytics', 'tom_dimension', 'data_analytics', 8, '01920005-0014-7000-8000-000000000008', NULL, NULL, 'custom_extension', 'B0159', NULL, '{B0056}'),
  ('tom_dimension.partners_sourcing', 'tom_dimension', 'partners_sourcing', 9, '01920005-0014-7000-8000-000000000009', NULL, NULL, 'custom_extension', 'B0159', NULL, '{B0056}'),
  ('tom_dimension.performance_management', 'tom_dimension', 'performance_management', 10, '01920005-0014-7000-8000-00000000000a', NULL, NULL, 'custom_extension', 'B0159', NULL, '{B0056}'),
  ('template.T01', 'template', 'T01', 1, '01920005-0013-7000-8000-000000000001', NULL, NULL, 'custom_extension', 'B0160', 'why_change', '{B0030,B0031}'),
  ('template.T02', 'template', 'T02', 2, '01920005-0013-7000-8000-000000000002', NULL, NULL, 'custom_extension', 'B0160', 'what_different', '{B0049,B0050}'),
  ('template.T03', 'template', 'T03', 3, '01920005-0013-7000-8000-000000000003', NULL, NULL, 'custom_extension', 'B0160', 'what_different', '{B0057,B0058}'),
  ('template.T04', 'template', 'T04', 4, '01920005-0013-7000-8000-000000000004', NULL, NULL, 'custom_extension', 'B0160', 'what_different', '{B0064,B0065}'),
  ('template.T05', 'template', 'T05', 5, '01920005-0013-7000-8000-000000000005', NULL, NULL, 'custom_extension', 'B0160', 'how_execute', '{B0071,B0072}'),
  ('template.T06', 'template', 'T06', 6, '01920005-0013-7000-8000-000000000006', NULL, NULL, 'custom_extension', 'B0160', 'how_execute', '{B0075,B0076}'),
  ('template.T07', 'template', 'T07', 7, '01920005-0013-7000-8000-000000000007', NULL, NULL, 'custom_extension', 'B0160', 'how_execute', '{B0078,B0079}'),
  ('template.T08', 'template', 'T08', 8, '01920005-0013-7000-8000-000000000008', NULL, NULL, 'custom_extension', 'B0160', 'how_execute', '{B0080,B0081}'),
  ('template.T09', 'template', 'T09', 9, '01920005-0013-7000-8000-000000000009', NULL, NULL, 'custom_extension', 'B0160', 'how_prove_value', '{B0086,B0087}'),
  ('template.T10', 'template', 'T10', 10, '01920005-0013-7000-8000-00000000000a', NULL, NULL, 'custom_extension', 'B0160', 'how_prove_value', '{B0094,B0095}'),
  ('template.T11', 'template', 'T11', 11, '01920005-0013-7000-8000-00000000000b', NULL, NULL, 'custom_extension', 'B0160', 'how_execute', '{B0098,B0099}'),
  ('template.T12', 'template', 'T12', 12, '01920005-0013-7000-8000-00000000000c', NULL, NULL, 'custom_extension', 'B0160', 'how_execute', '{B0100,B0101}'),
  ('template.T13', 'template', 'T13', 13, '01920005-0013-7000-8000-00000000000d', NULL, NULL, 'custom_extension', 'B0160', 'how_execute', '{B0106,B0107}'),
  ('template.T14', 'template', 'T14', 14, '01920005-0013-7000-8000-00000000000e', NULL, NULL, 'custom_extension', 'B0160', 'how_prove_value', '{B0122,B0123}'),
  ('template.T15', 'template', 'T15', 15, '01920005-0013-7000-8000-00000000000f', NULL, NULL, 'custom_extension', 'B0160', 'how_execute', '{B0127,B0128}'),
  ('template.T16', 'template', 'T16', 16, '01920005-0013-7000-8000-000000000010', NULL, NULL, 'custom_extension', 'B0160', 'how_execute', '{B0129,B0130}'),
  ('scoring_model.initiative_scoring', 'scoring_model', 'initiative_scoring', 1, NULL, 'Initiative scoring model', 'نموذج تقييم المبادرات', 'custom_extension', 'B0161', NULL, '{B0075,B0076,B0077}'),
  ('forum.executive_steerco', 'forum', 'executive_steerco', 1, '01920005-0015-7000-8000-000000000001', NULL, NULL, 'custom_extension', 'B0161', NULL, '{B0093}'),
  ('forum.transformation_review', 'forum', 'transformation_review', 2, '01920005-0015-7000-8000-000000000002', NULL, NULL, 'custom_extension', 'B0161', NULL, '{B0093}'),
  ('forum.workstream_review', 'forum', 'workstream_review', 3, '01920005-0015-7000-8000-000000000003', NULL, NULL, 'custom_extension', 'B0161', NULL, '{B0093}'),
  ('forum.rapid_response', 'forum', 'rapid_response', 4, '01920005-0015-7000-8000-000000000004', NULL, NULL, 'custom_extension', 'B0161', NULL, '{B0093}'),
  ('forum.value_review', 'forum', 'value_review', 5, '01920005-0015-7000-8000-000000000005', NULL, NULL, 'custom_extension', 'B0161', NULL, '{B0093}'),
  ('launch_window.days_0_30', 'launch_window', 'days_0_30', 1, '01920005-0017-7000-8000-000000000001', NULL, NULL, 'custom_extension', 'B0161', NULL, '{B0133,B0134}'),
  ('launch_window.days_31_60', 'launch_window', 'days_31_60', 2, '01920005-0017-7000-8000-000000000002', NULL, NULL, 'custom_extension', 'B0161', NULL, '{B0133,B0134}'),
  ('launch_window.days_61_90', 'launch_window', 'days_61_90', 3, '01920005-0017-7000-8000-000000000003', NULL, NULL, 'custom_extension', 'B0161', NULL, '{B0133,B0134,B0135}'),
  ('health_check.transformation_health_check', 'health_check', 'transformation_health_check', 1, NULL, 'Transformation Health Check — 25 Questions', 'فحص صحة التحول — 25 سؤالاً', 'custom_extension', 'B0161', NULL, '{B0149,B0150,B0151,B0152}'),
  ('roaming_example.international_roaming', 'roaming_example', 'international_roaming', 1, '01920005-0018-7000-8000-000000000001', NULL, NULL, 'custom_extension', 'B0162', NULL, '{B0143,B0144,B0145}'),
  ('traceability_chain.illustrative_traceability', 'traceability_chain', 'illustrative_traceability', 1, NULL, 'Illustrative traceability', 'إمكانية التتبع التوضيحية', 'custom_extension', 'B0162', NULL, '{B0146,B0147}'),
  ('benefit_lifecycle_step.identify', 'benefit_lifecycle_step', 'identify', 1, '01920005-0016-7000-8000-000000000001', NULL, NULL, 'foundation_inspired', 'B0156', NULL, '{B0120,B0121}'),
  ('benefit_lifecycle_step.plan', 'benefit_lifecycle_step', 'plan', 2, '01920005-0016-7000-8000-000000000002', NULL, NULL, 'foundation_inspired', 'B0156', NULL, '{B0120,B0121}'),
  ('benefit_lifecycle_step.enable', 'benefit_lifecycle_step', 'enable', 3, '01920005-0016-7000-8000-000000000003', NULL, NULL, 'foundation_inspired', 'B0156', NULL, '{B0120,B0121}'),
  ('benefit_lifecycle_step.measure', 'benefit_lifecycle_step', 'measure', 4, '01920005-0016-7000-8000-000000000004', NULL, NULL, 'foundation_inspired', 'B0156', NULL, '{B0120,B0121}'),
  ('benefit_lifecycle_step.correct', 'benefit_lifecycle_step', 'correct', 5, '01920005-0016-7000-8000-000000000005', NULL, NULL, 'foundation_inspired', 'B0156', NULL, '{B0120,B0121}'),
  ('benefit_lifecycle_step.sustain', 'benefit_lifecycle_step', 'sustain', 6, '01920005-0016-7000-8000-000000000006', NULL, NULL, 'foundation_inspired', 'B0156', NULL, '{B0120,B0121}');
SELECT p2_attach_append_only('methodology_element_profile');

-- -----------------------------------------------------------------------------------------------------------------
-- The reader namespaces of Studio element type 'methodology_text' (ADR-0049 §2, §4, §6). An extra BEFORE trigger beside
-- methodology_element_guard (which is not redefined). It acts only on rows whose stable key is in a reader namespace or
-- whose attributes use a reader attribute:
--   'profile.<element_ref>'  attributes provenance / questionTag override the profile default for that version;
--   'block.<Bxxxx>'          bodyEn/bodyAr = guidance shown beside the verbatim block; linksAdded/linksRemoved;
--   'provenance.note'        bodyEn/bodyAr = an explanatory note shown under the verbatim B0004 statement.
-- Every text in these namespaces passes the two text rules (no official-PMI claim, no DG0-DG7 name).
CREATE FUNCTION methodology_element_reader_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  a jsonb := NEW.attributes;
  reader_attr boolean := a ?| ARRAY['provenance', 'questionTag', 'linksAdded', 'linksRemoved'];
  ns text := CASE WHEN NEW.stable_key LIKE 'profile.%' THEN 'profile' WHEN NEW.stable_key LIKE 'block.%' THEN 'block'
                  WHEN NEW.stable_key = 'provenance.note' THEN 'note' ELSE NULL END;
  prof record;
  link jsonb;
  k text;
BEGIN
  IF ns IS NULL AND NOT reader_attr THEN
    RETURN NEW;
  END IF;
  IF NEW.element_type <> 'methodology_text' OR ns IS NULL THEN
    RAISE EXCEPTION 'methodology_element %: provenance, questionTag and block links exist only on methodology_text elements of the reader namespaces', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_element_reader_namespace';
  END IF;
  IF ns = 'profile' THEN
    SELECT * INTO prof FROM methodology_element_profile p WHERE 'profile.' || p.element_ref = NEW.stable_key;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'methodology_element %: % names no seeded methodology element', NEW.id, NEW.stable_key
        USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'methodology_element_reader_profile';
    END IF;
    IF a ?| ARRAY['linksAdded', 'linksRemoved']
       OR (a ? 'provenance' AND NOT coalesce(a->>'provenance' IN ('custom_extension', 'foundation_inspired'), false))
       OR (a ? 'questionTag' AND (prof.element_kind <> 'template'
           OR NOT EXISTS (SELECT 1 FROM guiding_question q WHERE q.code = a->>'questionTag'))) THEN
      RAISE EXCEPTION 'methodology_element %: a profile override sets provenance (custom_extension | foundation_inspired) and, for a template only, one guiding-question tag', NEW.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_element_reader_profile';
    END IF;
  ELSIF ns = 'block' THEN
    IF NOT EXISTS (SELECT 1 FROM playbook_block b WHERE 'block.' || b.block_ref = NEW.stable_key)
       OR a ?| ARRAY['provenance', 'questionTag'] THEN
      RAISE EXCEPTION 'methodology_element %: % names no playbook block, or sets a profile attribute', NEW.id, NEW.stable_key
        USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'methodology_element_reader_block';
    END IF;
    FOREACH k IN ARRAY ARRAY['linksAdded', 'linksRemoved'] LOOP
      IF a ? k THEN
        IF jsonb_typeof(a->k) <> 'array' OR jsonb_array_length(a->k) > 50 THEN
          RAISE EXCEPTION 'methodology_element %: % is an array of at most 50 links', NEW.id, k
            USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_element_reader_block';
        END IF;
        FOR link IN SELECT jsonb_array_elements(a->k) LOOP
          IF jsonb_typeof(link) <> 'object' OR NOT coalesce(CASE link->>'targetKind'
               WHEN 'template' THEN link->>'targetKey' ~ '^T(0[1-9]|1[0-6])$'
               WHEN 'requirement' THEN link->>'targetKey' ~ '^REQ-[A-Z0-9]+-[0-9]{3}$'
               WHEN 'procedure' THEN link->>'targetKey' ~ '^[a-z][a-z0-9_]{0,62}$'
               ELSE false END, false) THEN
            RAISE EXCEPTION 'methodology_element %: each link is {targetKind: template | procedure | requirement, targetKey}', NEW.id
              USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_element_reader_block';
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  ELSIF reader_attr THEN
    RAISE EXCEPTION 'methodology_element %: the provenance note carries text only', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_element_reader_namespace';
  END IF;
  FOREACH k IN ARRAY ARRAY['labelEn', 'labelAr', 'helpEn', 'helpAr', 'bodyEn', 'bodyAr'] LOOP
    IF p5_claims_official_pmi(a->>k) OR p5_mentions_engineering_gate(a->>k) THEN
      RAISE EXCEPTION 'methodology_element %: % claims official PMI status or certification, or names an engineering gate DG0-DG7', NEW.id, k
        USING ERRCODE = 'check_violation', CONSTRAINT = 'methodology_element_reader_text';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER methodology_element_reader_guard BEFORE INSERT OR UPDATE ON methodology_element
  FOR EACH ROW EXECUTE FUNCTION methodology_element_reader_guard();

-- -----------------------------------------------------------------------------------------------------------------
-- Branding (REQ-S15-004, REQ-S01-002; ADR-0049 §8). branding_version: every saved branding is a new, immutable version
-- of one organization (append-only), numbered 1, 2, 3 ... (branding_version_step, under lock 730270). branding_setting:
-- the organization's head row naming its current version (version = current_version_no; If-Match). No row = version 0,
-- the defaults: product name 'Mobily Transformation Hub' / the shipped Arabic name, the provisional design tokens
-- (#0078FF is PROVISIONAL, not a verified Mobily colour) and the provisional text wordmark (no logo is invented).
-- Fonts are only the locally bundled OFL fonts (no public font CDN, M0301). A logo is a PNG of at most 256 KiB (no SVG:
-- no script content). Colours count as approved only with an approval reference; otherwise they stay provisional.
CREATE TABLE branding_version (
  id                        uuid PRIMARY KEY,
  organization_id           uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version_no                integer NOT NULL CHECK (version_no >= 1),
  product_name_en           text NOT NULL CHECK (char_length(product_name_en) BETWEEN 1 AND 80),
  product_name_ar           text NOT NULL CHECK (char_length(product_name_ar) BETWEEN 1 AND 80),
  primary_colour            text NOT NULL CHECK (primary_colour ~ '^#[0-9A-F]{6}$'),
  secondary_colour          text NOT NULL CHECK (secondary_colour ~ '^#[0-9A-F]{6}$'),
  colours_provisional       boolean NOT NULL,
  colour_approval_reference text NULL CHECK (colour_approval_reference IS NULL OR char_length(colour_approval_reference) BETWEEN 1 AND 300),
  font_latin                text NOT NULL CHECK (font_latin IN ('IBM Plex Sans')),
  font_arabic               text NOT NULL CHECK (font_arabic IN ('IBM Plex Sans Arabic')),
  logo_png                  bytea NULL CHECK (logo_png IS NULL OR (octet_length(logo_png) BETWEEN 67 AND 262144
                                              AND substring(logo_png FROM 1 FOR 8) = '\x89504e470d0a1a0a'::bytea)),
  logo_sha256               text NULL CHECK (logo_sha256 IS NULL OR logo_sha256 ~ '^[0-9a-f]{64}$'),
  logo_alt_en               text NULL CHECK (logo_alt_en IS NULL OR char_length(logo_alt_en) BETWEEN 1 AND 200),
  logo_alt_ar               text NULL CHECK (logo_alt_ar IS NULL OR char_length(logo_alt_ar) BETWEEN 1 AND 200),
  report_header_en          text NULL CHECK (report_header_en IS NULL OR char_length(report_header_en) BETWEEN 1 AND 300),
  report_header_ar          text NULL CHECK (report_header_ar IS NULL OR char_length(report_header_ar) BETWEEN 1 AND 300),
  report_footer_en          text NULL CHECK (report_footer_en IS NULL OR char_length(report_footer_en) BETWEEN 1 AND 300),
  report_footer_ar          text NULL CHECK (report_footer_ar IS NULL OR char_length(report_footer_ar) BETWEEN 1 AND 300),
  change_note               text NULL CHECK (change_note IS NULL OR char_length(change_note) BETWEEN 1 AND 1000),
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT branding_version_organization_version_key UNIQUE (organization_id, version_no),
  CONSTRAINT branding_version_colour_approval CHECK (colours_provisional = (colour_approval_reference IS NULL)),
  CONSTRAINT branding_version_logo_complete CHECK ((logo_png IS NULL) = (logo_sha256 IS NULL)
    AND (logo_png IS NULL) = (logo_alt_en IS NULL) AND (logo_png IS NULL) = (logo_alt_ar IS NULL)
    AND (logo_png IS NULL OR logo_sha256 = encode(sha256(logo_png), 'hex'))),
  CONSTRAINT branding_version_header_pair CHECK ((report_header_en IS NULL) = (report_header_ar IS NULL)),
  CONSTRAINT branding_version_footer_pair CHECK ((report_footer_en IS NULL) = (report_footer_ar IS NULL)),
  CONSTRAINT branding_version_no_pmi_claim CHECK (NOT (p5_claims_official_pmi(product_name_en) OR p5_claims_official_pmi(product_name_ar)
    OR p5_claims_official_pmi(report_header_en) OR p5_claims_official_pmi(report_header_ar)
    OR p5_claims_official_pmi(report_footer_en) OR p5_claims_official_pmi(report_footer_ar))),
  CONSTRAINT branding_version_no_engineering_gate CHECK (NOT (p5_mentions_engineering_gate(product_name_en)
    OR p5_mentions_engineering_gate(product_name_ar) OR p5_mentions_engineering_gate(report_header_en)
    OR p5_mentions_engineering_gate(report_header_ar) OR p5_mentions_engineering_gate(report_footer_en)
    OR p5_mentions_engineering_gate(report_footer_ar)))
);
CREATE FUNCTION branding_version_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  branding_publish_lock_class CONSTANT integer := 730270;
BEGIN
  PERFORM pg_advisory_xact_lock(branding_publish_lock_class, hashtext(NEW.organization_id::text));
  IF NEW.version_no <> coalesce((SELECT max(b.version_no) FROM branding_version b WHERE b.organization_id = NEW.organization_id), 0) + 1 THEN
    RAISE EXCEPTION 'branding_version: version % of organization % is not the next version', NEW.version_no, NEW.organization_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'branding_version_step';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER branding_version_guard BEFORE INSERT ON branding_version
  FOR EACH ROW EXECUTE FUNCTION branding_version_guard();
SELECT p2_attach_guards('branding_version', true);
SELECT p2_attach_append_only('branding_version');
GRANT SELECT, INSERT ON branding_version TO mth_app;

CREATE TABLE branding_setting (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT
                       CONSTRAINT branding_setting_organization_key UNIQUE,
  current_version_no integer NOT NULL CHECK (current_version_no >= 1),
  version            integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT branding_setting_version_matches CHECK (current_version_no = version),
  CONSTRAINT branding_setting_current_fkey FOREIGN KEY (organization_id, current_version_no)
    REFERENCES branding_version (organization_id, version_no) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE FUNCTION branding_setting_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  branding_publish_lock_class CONSTANT integer := 730270;
BEGIN
  PERFORM pg_advisory_xact_lock(branding_publish_lock_class, hashtext(NEW.organization_id::text));
  IF NEW.current_version_no <> (SELECT max(b.version_no) FROM branding_version b WHERE b.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'branding_setting: the current version of organization % is always its latest branding version', NEW.organization_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'branding_setting_current_latest';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER branding_setting_guard BEFORE INSERT OR UPDATE ON branding_setting
  FOR EACH ROW EXECUTE FUNCTION branding_setting_guard();
SELECT p2_attach_guards('branding_setting', true);
GRANT SELECT, INSERT, UPDATE ON branding_setting TO mth_app;
