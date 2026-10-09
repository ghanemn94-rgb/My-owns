-- 0056 P4 slice J: the six Template 10 dashboard areas seeded verbatim, and the per-organization dashboard RAG policy
-- (T-DG4-ARCH-08; ADR-0037; REQ-PB-062, REQ-PB-063, REQ-PB-064, REQ-S03-008, REQ-S03-009, REQ-S03-011, REQ-S13-001,
-- REQ-S13-002, REQ-S13-003). Authored by solution-architect. Contract: docs/architecture/data-dictionary.md
-- ("P4 tables, slices J and K"). Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only:
-- never edit once merged. SQL floor: PostgreSQL 16. The dashboards are read models computed on every request; no
-- table here stores a dashboard figure, a RAG status or an approval. Nothing touches DG0-DG7.

-- -----------------------------------------------------------------------------------------------------------------
-- t10_area_definition: Template 10 "Executive Transformation Dashboard", one row per area (B0094, B0095; M0245-M0252).
-- The source_* columns are VERBATIM: area, "What to show" and "RAG logic" from the playbook table B0095, "Required
-- presentation" and "Status basis" from the master-prompt table M0246-M0252. The Arabic columns are PROVISIONAL
-- (ar_provisional = true) until a Mobily reviewer confirms them. Read-only for the application (SELECT only).
CREATE TABLE t10_area_definition (
  id                         uuid PRIMARY KEY,
  code                       text NOT NULL CONSTRAINT t10_area_definition_code_key UNIQUE
                             CHECK (code IN ('outcomes', 'value', 'portfolio', 'dependencies', 'decisions', 'people_adoption')),
  methodology_version_id     uuid NOT NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ordinal                    smallint NOT NULL CONSTRAINT t10_area_definition_ordinal_key UNIQUE CHECK (ordinal BETWEEN 1 AND 6),
  source_area_en             text NOT NULL CHECK (char_length(source_area_en) BETWEEN 1 AND 50),
  area_ar                    text NOT NULL CHECK (char_length(area_ar) BETWEEN 1 AND 100),
  source_what_to_show_en     text NOT NULL CHECK (char_length(source_what_to_show_en) BETWEEN 1 AND 200),
  what_to_show_ar            text NOT NULL CHECK (char_length(what_to_show_ar) BETWEEN 1 AND 300),
  source_rag_logic_en        text NOT NULL CHECK (char_length(source_rag_logic_en) BETWEEN 1 AND 200),
  rag_logic_ar               text NOT NULL CHECK (char_length(rag_logic_ar) BETWEEN 1 AND 300),
  source_presentation_en     text NOT NULL CHECK (char_length(source_presentation_en) BETWEEN 1 AND 200),
  presentation_ar            text NOT NULL CHECK (char_length(presentation_ar) BETWEEN 1 AND 300),
  source_status_basis_en     text NOT NULL CHECK (char_length(source_status_basis_en) BETWEEN 1 AND 200),
  status_basis_ar            text NOT NULL CHECK (char_length(status_basis_ar) BETWEEN 1 AND 300),
  source_ref                 text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 100),
  ar_provisional             boolean NOT NULL DEFAULT true,
  created_at                 timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON t10_area_definition TO mth_app;

INSERT INTO t10_area_definition (id, code, methodology_version_id, ordinal, source_area_en, area_ar, source_what_to_show_en,
                                 what_to_show_ar, source_rag_logic_en, rag_logic_ar, source_presentation_en, presentation_ar,
                                 source_status_basis_en, status_basis_ar, source_ref) VALUES
  ('01920002-000a-7000-8000-000000000001', 'outcomes', '01920002-0000-7000-8000-000000000001', 1, 'Outcomes', 'النتائج',
   'Actual vs baseline vs target; trend', 'الفعلي مقابل خط الأساس مقابل المستهدف؛ الاتجاه',
   'RAG based on target trajectory, not activity completion', 'حالة RAG وفق مسار المستهدف، لا وفق إنجاز الأنشطة',
   'Baseline, actual, target, trajectory and trend', 'خط الأساس والفعلي والمستهدف والمسار والاتجاه',
   'Expected outcome trajectory', 'مسار النتيجة المتوقع', 'B0095;M0247'),
  ('01920002-000a-7000-8000-000000000002', 'value', '01920002-0000-7000-8000-000000000001', 2, 'Value', 'القيمة',
   'Realized / forecast benefit; investment', 'المنفعة المحققة / المتوقعة؛ الاستثمار',
   'RAG based on validated benefit gap', 'حالة RAG وفق فجوة المنفعة المعتمدة',
   'Planned, forecast and validated realized benefit; investment', 'المنفعة المخططة والمتوقعة والمحققة المعتمدة؛ الاستثمار',
   'Validated benefit gap', 'فجوة المنفعة المعتمدة', 'B0095;M0248'),
  ('01920002-000a-7000-8000-000000000003', 'portfolio', '01920002-0000-7000-8000-000000000001', 3, 'Portfolio', 'المحفظة',
   'Top initiatives by value/criticality', 'أهم المبادرات حسب القيمة/الأهمية الحرجة',
   'RAG by milestone + outcome risk', 'حالة RAG وفق المعالم الرئيسية + مخاطر النتائج',
   'High-value/critical initiatives and delivery outlook', 'المبادرات عالية القيمة/الحرجة وتوقعات التسليم',
   'Milestone and outcome risk', 'مخاطر المعالم الرئيسية والنتائج', 'B0095;M0249'),
  ('01920002-000a-7000-8000-000000000004', 'dependencies', '01920002-0000-7000-8000-000000000001', 4, 'Dependencies', 'الاعتماديات',
   'Top cross-functional blockers', 'أهم العوائق متعددة الوظائف',
   'RAG by decision date / critical path', 'حالة RAG وفق تاريخ القرار / المسار الحرج',
   'Cross-functional blockers and affected scope', 'العوائق متعددة الوظائف والنطاق المتأثر',
   'Needed-by date and supported critical-path logic', 'تاريخ الحاجة ومنطق المسار الحرج المدعوم', 'B0095;M0250'),
  ('01920002-000a-7000-8000-000000000005', 'decisions', '01920002-0000-7000-8000-000000000001', 5, 'Decisions', 'القرارات',
   'Decision needed, owner, due date, impact of delay', 'القرار المطلوب، المالك، تاريخ الاستحقاق، أثر التأخير',
   'Red if executive decision overdue', 'أحمر إذا تأخر قرار تنفيذي',
   'Ask, owner, deadline and delay impact', 'الطلب والمالك والموعد النهائي وأثر التأخير',
   'Overdue executive decisions are red', 'القرارات التنفيذية المتأخرة حمراء', 'B0095;M0251'),
  ('01920002-000a-7000-8000-000000000006', 'people_adoption', '01920002-0000-7000-8000-000000000001', 6, 'People & adoption', 'الأفراد والتبني',
   'Usage/adoption/capability signals', 'مؤشرات الاستخدام/التبني/القدرات',
   'RAG vs adoption curve', 'حالة RAG مقابل منحنى التبني',
   'Usage, behavior and capability indicators', 'مؤشرات الاستخدام والسلوك والقدرات',
   'Adoption trajectory', 'مسار التبني', 'B0095;M0252');

-- -----------------------------------------------------------------------------------------------------------------
-- dashboard_rag_policy: the configurable thresholds of the T10 area rules of one organization (M0160 "configurable
-- thresholds"; ADR-0037 §3). Neither source gives a value, so every column is NULL by default and NULL means "use the
-- documented default of ADR-0037 §3" (the API reports which applies: policySource default | configured). A configured
-- value is the organization's decision, never a seeded figure. Ratios are decimal fractions (0.05 = 5 %).
CREATE TABLE dashboard_rag_policy (
  id                                 uuid PRIMARY KEY,
  organization_id                    uuid NOT NULL CONSTRAINT dashboard_rag_policy_organization_key UNIQUE
                                     REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  value_gap_amber_ratio              numeric(9,6) NULL CHECK (value_gap_amber_ratio IS NULL OR value_gap_amber_ratio BETWEEN 0 AND 1),
  value_gap_red_ratio                numeric(9,6) NULL CHECK (value_gap_red_ratio IS NULL OR value_gap_red_ratio BETWEEN 0 AND 1),
  milestone_slip_amber_working_days  integer NULL CHECK (milestone_slip_amber_working_days IS NULL OR milestone_slip_amber_working_days BETWEEN 0 AND 250),
  milestone_slip_red_working_days    integer NULL CHECK (milestone_slip_red_working_days IS NULL OR milestone_slip_red_working_days BETWEEN 0 AND 250),
  dependency_due_soon_working_days   integer NULL CHECK (dependency_due_soon_working_days IS NULL OR dependency_due_soon_working_days BETWEEN 0 AND 250),
  decision_due_soon_working_days     integer NULL CHECK (decision_due_soon_working_days IS NULL OR decision_due_soon_working_days BETWEEN 0 AND 250),
  top_initiative_count               smallint NULL CHECK (top_initiative_count IS NULL OR top_initiative_count BETWEEN 1 AND 50),
  deadline_horizon_working_days      integer NULL CHECK (deadline_horizon_working_days IS NULL OR deadline_horizon_working_days BETWEEN 1 AND 250),
  note                               text NULL CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000),
  version                            integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                         timestamptz NOT NULL DEFAULT now(),
  created_by                         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                         timestamptz NOT NULL DEFAULT now(),
  updated_by                         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- When both bounds of a pair are configured, amber is reached no later than red.
  CONSTRAINT dashboard_rag_policy_value_gap_order CHECK (value_gap_amber_ratio IS NULL OR value_gap_red_ratio IS NULL
    OR value_gap_amber_ratio <= value_gap_red_ratio),
  CONSTRAINT dashboard_rag_policy_milestone_slip_order CHECK (milestone_slip_amber_working_days IS NULL
    OR milestone_slip_red_working_days IS NULL OR milestone_slip_amber_working_days <= milestone_slip_red_working_days)
);
SELECT p2_attach_guards('dashboard_rag_policy', true);
GRANT SELECT, INSERT, UPDATE ON dashboard_rag_policy TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- my_work_draft: the "Drafts" section of My Work (REQ-S03-008; M0100), defined here for the reporting read model
-- (ADR-0002 rule 4: "Reporting read models may use SQL views"). One row per record in status 'draft' of exactly these
-- 18 record types, with its author (created_by). gate_instance (a gate before submission), governance_matrix (created
-- by instantiation) and outcome_kpi.trajectory_status (a column of a T02 row) also use the word 'draft' and are
-- deliberately left out: none of them is a draft a person authored. The API filters by created_by = the caller and by
-- the transformations the caller may read.
CREATE VIEW my_work_draft AS
SELECT organization_id, transformation_id, 'agenda_item'::text AS record_type, id AS record_id, NULL::text AS code,
       title::text AS label, 'meeting'::text AS parent_type, meeting_id AS parent_id, created_by, updated_at
FROM agenda_item WHERE status = 'draft'
UNION ALL SELECT organization_id, transformation_id, 'assessment_form', id, NULL, name, NULL, NULL, created_by, updated_at
FROM assessment_form WHERE status = 'draft'
UNION ALL SELECT organization_id, transformation_id, 'bau_handover', id, code, NULL, 'performance_area', performance_area_id, created_by, updated_at
FROM bau_handover WHERE status = 'draft'
UNION ALL SELECT organization_id, transformation_id, 'benefit_measurement', id, NULL, NULL, 'benefit', benefit_id, created_by, updated_at
FROM benefit_measurement WHERE status = 'draft'
UNION ALL SELECT organization_id, transformation_id, 'business_case', id, code, title, NULL, NULL, created_by, updated_at
FROM business_case WHERE status = 'draft'
UNION ALL SELECT organization_id, transformation_id, 'change_request', id, code, NULL, NULL, NULL, created_by, updated_at
FROM change_request WHERE status = 'draft'
UNION ALL SELECT organization_id, transformation_id, 'diagnostic_finding', id, NULL, left(statement, 300), NULL, NULL, created_by, updated_at
FROM diagnostic_finding WHERE status = 'draft'
UNION ALL SELECT organization_id, transformation_id, 'initiative', id, code, name, NULL, NULL, created_by, updated_at
FROM initiative WHERE status = 'draft'
UNION ALL SELECT organization_id, transformation_id, 'journey', id, NULL, name, NULL, NULL, created_by, updated_at
FROM journey WHERE status = 'draft'
UNION ALL SELECT organization_id, transformation_id, 'kpi_actual', id, NULL, period_label, 'kpi_definition', kpi_definition_id, created_by, updated_at
FROM kpi_actual WHERE status = 'draft'
UNION ALL SELECT organization_id, transformation_id, 'kpi_definition', id, NULL, name, NULL, NULL, created_by, updated_at
FROM kpi_definition WHERE status = 'draft'
UNION ALL SELECT organization_id, transformation_id, 'kpi_version', id, NULL, NULL, 'kpi_definition', kpi_definition_id, created_by, updated_at
FROM kpi_version WHERE status = 'draft'
UNION ALL SELECT organization_id, transformation_id, 'lesson', id, code, title, NULL, NULL, created_by, updated_at
FROM lesson WHERE status = 'draft'
UNION ALL SELECT organization_id, transformation_id, 'meeting_minutes', id, NULL, NULL, 'meeting', meeting_id, created_by, updated_at
FROM meeting_minutes WHERE status = 'draft'
UNION ALL SELECT organization_id, transformation_id, 'outcome', id, NULL, left(statement, 300), NULL, NULL, created_by, updated_at
FROM outcome WHERE status = 'draft'
UNION ALL SELECT organization_id, transformation_id, 'target_trajectory', id, NULL, NULL, 'kpi_definition', kpi_definition_id, created_by, updated_at
FROM target_trajectory WHERE status = 'draft'
UNION ALL SELECT organization_id, transformation_id, 'tom_canvas_cell', id, NULL, NULL, NULL, NULL, created_by, updated_at
FROM tom_canvas_cell WHERE status = 'draft'
UNION ALL SELECT organization_id, transformation_id, 'transition_decision', id, code, NULL, 'benefit', benefit_id, created_by, updated_at
FROM transition_decision WHERE status = 'draft';
GRANT SELECT ON my_work_draft TO mth_app;
