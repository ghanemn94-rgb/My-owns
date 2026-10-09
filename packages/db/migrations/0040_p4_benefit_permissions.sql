-- 0040 P4 slice B seeds: the benefit permission catalogue and role defaults, and the Finance work-item kinds
-- (T-DG4-ARCH-03; ADR-0029 §9, ADR-0030 §9; REQ-PB-013, REQ-S08-014, REQ-S12-014). Authored by solution-architect.
-- Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged.
-- SQL floor: PostgreSQL 16. Nothing here approves or validates anything, and nothing touches DG0-DG7.

-- -----------------------------------------------------------------------------------------------------------------
-- Work-item kinds (ADR-0025 §4): the Finance validation queue item (REQ-S12-014, one per submitted measurement) and
-- the Finance overlap task (REQ-S08-014 "Overlap detected -> Finance task").
INSERT INTO work_item_kind (code, owner_module, label_en, label_ar, source_ref) VALUES
  ('finance_validation_review', 'benefits', 'Benefit value to validate', 'قيمة منفعة بانتظار التحقق المالي', 'M0234'),
  ('benefit_overlap_review', 'benefits', 'Benefit overlap to resolve', 'تداخل منافع بانتظار الحسم المالي', 'M0173');

-- -----------------------------------------------------------------------------------------------------------------
-- Slice B permission catalogue and role defaults. EXACTLY packages/shared/src/permissions.ts P4_BENEFIT_PERMISSIONS /
-- P4_BENEFIT_ROLE_PERMISSIONS (packages/db/src/seed.test.ts compares them). A CONFIGURABLE STARTING POINT, not a
-- Mobily-approved access policy. Every new code is 'write': none is business_approval or finance_validation, so the
-- DG1/DG2 rules keyed on "a role holding an approval permission" (F-DG1-106; ADR-0020 §3) are unchanged. Finance
-- validation, corrections, overlap resolution, baseline validation and valuation-method decisions reuse the P1
-- finance.validate code (category finance_validation), held by FIN only. No technical_admin role and no AUD role
-- receives any of these (AUD stays read-only).
INSERT INTO permission (code, category, description_en, description_ar) VALUES
  ('benefit.edit', 'write', 'Create and edit benefits in the benefits register, their enablers, planned and forecast values, and propose valuation methods', 'إنشاء المنافع في سجل المنافع وتحريرها، وممكّناتها، وقيمها المخططة والمتوقعة، واقتراح طرق التقييم'),
  ('benefit.advance', 'write', 'Advance a benefit through the benefits lifecycle steps', 'نقل المنفعة بين خطوات دورة حياة المنافع'),
  ('benefit.allocate', 'write', 'Set the contribution allocations of a benefit to initiatives', 'تحديد توزيع مساهمة المنفعة على المبادرات'),
  ('benefit.measure', 'write', 'Record benefit measurements with evidence and submit them for Finance validation', 'تسجيل قياسات المنافع مع الأدلة وتقديمها للتحقق المالي'),
  ('benefit_scenario.edit', 'write', 'Create and edit base, upside and downside benefit scenarios', 'إنشاء سيناريوهات المنافع الأساسية والمتفائلة والمتحفظة وتحريرها'),
  ('benefit_group.manage', 'write', 'Create and edit shared-benefit groups and name their counted benefit', 'إنشاء مجموعات المنافع المشتركة وتحريرها وتحديد المنفعة المحتسبة فيها');

INSERT INTO role_permission (role_id, permission_code) VALUES
  ('01920000-0000-7000-8000-000000000002', 'benefit.edit'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'benefit.allocate'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'benefit_scenario.edit'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'benefit_group.manage'), -- TL
  ('01920000-0000-7000-8000-000000000003', 'benefit.edit'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'benefit.advance'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'benefit.allocate'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'benefit.measure'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'benefit_group.manage'), -- BO
  ('01920000-0000-7000-8000-000000000004', 'benefit.measure'), -- WL
  ('01920000-0000-7000-8000-000000000005', 'benefit_scenario.edit'), -- FIN
  ('01920000-0000-7000-8000-000000000007', 'benefit.measure'); -- KDS
