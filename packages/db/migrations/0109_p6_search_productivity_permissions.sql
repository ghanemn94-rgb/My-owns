-- 0109 P6 slices H and G seeds: the saved-view permission catalogue and its role defaults (T-DG6-ARCH-04; ADR-0057 §9).
-- Authored by solution-architect. Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only:
-- never edit once merged. SQL floor: PostgreSQL 16.
--
-- Permissions: EXACTLY packages/shared/src/permissions.ts P6_SEARCH_PERMISSIONS / P6_SEARCH_ROLE_PERMISSIONS
-- (packages/db/src/seed.test.ts compares them). A CONFIGURABLE STARTING POINT, not a Mobily-approved access policy.
--   saved_view.manage   create, change, set as default and delete one's OWN saved views (REQ-S15-010, REQ-S15-013):
--                       every role except AUD (13 roles). AUD stays read-only: it reads and applies the views shared
--                       in its organization, and saves none (REQ-S10-001).
--   saved_view.share    share one's own view with the organization, or stop sharing it (p6-plan §3 row 20): TL, BO,
--                       WL, TO, KDS and TD. Stopping the share of one's own view needs only saved_view.manage.
-- Searching (GET /search), reading help topics and reading one's own drafts need no new code: search admits exactly
-- the records the caller's record-view permission admits, through ReadScope (ADR-0057 §3). No code is a
-- business_approval or finance_validation code, so the technical-admin trigger of 0001 accepts every link. Nothing
-- touches DG0-DG7.
INSERT INTO permission (code, category, description_en, description_ar) VALUES
  ('saved_view.manage', 'write', 'Create, change, set as default and delete your own saved list views', 'إنشاء طرق عرض القوائم المحفوظة الخاصة بك وتعديلها وتعيينها كافتراضية وحذفها'),
  ('saved_view.share', 'write', 'Share your own saved list view with your organization', 'مشاركة طريقة عرض قائمة محفوظة خاصة بك مع مؤسستك');
INSERT INTO role_permission (role_id, permission_code) VALUES
  ('01920000-0000-7000-8000-000000000001', 'saved_view.manage'), -- SP
  ('01920000-0000-7000-8000-000000000002', 'saved_view.manage'), -- TL
  ('01920000-0000-7000-8000-000000000002', 'saved_view.share'), -- TL
  ('01920000-0000-7000-8000-000000000003', 'saved_view.manage'), -- BO
  ('01920000-0000-7000-8000-000000000003', 'saved_view.share'), -- BO
  ('01920000-0000-7000-8000-000000000004', 'saved_view.manage'), -- WL
  ('01920000-0000-7000-8000-000000000004', 'saved_view.share'), -- WL
  ('01920000-0000-7000-8000-000000000005', 'saved_view.manage'), -- FIN
  ('01920000-0000-7000-8000-000000000006', 'saved_view.manage'), -- TO
  ('01920000-0000-7000-8000-000000000006', 'saved_view.share'), -- TO
  ('01920000-0000-7000-8000-000000000007', 'saved_view.manage'), -- KDS
  ('01920000-0000-7000-8000-000000000007', 'saved_view.share'), -- KDS
  ('01920000-0000-7000-8000-000000000008', 'saved_view.manage'), -- TD
  ('01920000-0000-7000-8000-000000000008', 'saved_view.share'), -- TD
  ('01920000-0000-7000-8000-000000000009', 'saved_view.manage'), -- CM
  ('01920000-0000-7000-8000-00000000000a', 'saved_view.manage'), -- SEC
  ('01920000-0000-7000-8000-00000000000c', 'saved_view.manage'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000d', 'saved_view.manage'), -- ADM_ACCESS
  ('01920000-0000-7000-8000-00000000000e', 'saved_view.manage'); -- ADM_METHOD
