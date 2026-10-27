-- 0112 P6 slice D seeds: the assistant permission catalogue and its role defaults (T-DG6-ARCH-05; ADR-0059 §9).
-- Authored by solution-architect. Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only:
-- never edit once merged. SQL floor: PostgreSQL 16.
--
-- Permissions: EXACTLY packages/shared/src/permissions.ts P6_ASSISTANT_PERMISSIONS / P6_ASSISTANT_ROLE_PERMISSIONS
-- (packages/db/src/seed.test.ts compares them). A CONFIGURABLE STARTING POINT, not a Mobily-approved access policy.
--   assistant.use        open one's own assistant conversations, ask questions and take one's own draft suggestions to
--                        a draft prefill (REQ-S17-007 "use:signed-in users when enabled"): every role except AUD (13
--                        roles). AUD stays read-only (REQ-S10-001): a conversation is a write of the caller's own rows,
--                        the saved_view.manage precedent of 0109. Retrieval admits exactly the records the caller's
--                        record-view permissions admit, through ReadScope (ADR-0059 §4); this code widens no read.
--   assistant.configure  read and change the assistant setting, turn it on and off (REQ-S17-009 "configure:ADM
--                        (IT-authorized)"): ADM_TECH only. Turning it on needs an authorization reference that the
--                        administrator enters from the company's authorization; the product does not verify it.
-- Reading the setting (GET /admin/assistant) is also open to operations.read holders (TO, KDS, TD, AUD, ADM_TECH;
-- 0103), so AUD can see that AI is off and who turned it on. Neither code is a business_approval or
-- finance_validation code, so the technical-admin trigger of 0001 accepts every link. Nothing touches DG0-DG7.
INSERT INTO permission (code, category, description_en, description_ar) VALUES
  ('assistant.use', 'write', 'Use the optional assistant: your own conversations and draft suggestions', 'استخدام المساعد الاختياري: محادثاتك واقتراحات المسودات الخاصة بك'),
  ('assistant.configure', 'configure', 'Read and change the assistant setting and turn the assistant on or off', 'قراءة إعداد المساعد وتعديله وتشغيل المساعد أو إيقافه');
INSERT INTO role_permission (role_id, permission_code) VALUES
  ('01920000-0000-7000-8000-000000000001', 'assistant.use'), -- SP
  ('01920000-0000-7000-8000-000000000002', 'assistant.use'), -- TL
  ('01920000-0000-7000-8000-000000000003', 'assistant.use'), -- BO
  ('01920000-0000-7000-8000-000000000004', 'assistant.use'), -- WL
  ('01920000-0000-7000-8000-000000000005', 'assistant.use'), -- FIN
  ('01920000-0000-7000-8000-000000000006', 'assistant.use'), -- TO
  ('01920000-0000-7000-8000-000000000007', 'assistant.use'), -- KDS
  ('01920000-0000-7000-8000-000000000008', 'assistant.use'), -- TD
  ('01920000-0000-7000-8000-000000000009', 'assistant.use'), -- CM
  ('01920000-0000-7000-8000-00000000000a', 'assistant.use'), -- SEC
  ('01920000-0000-7000-8000-00000000000c', 'assistant.use'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000c', 'assistant.configure'), -- ADM_TECH
  ('01920000-0000-7000-8000-00000000000d', 'assistant.use'), -- ADM_ACCESS
  ('01920000-0000-7000-8000-00000000000e', 'assistant.use'); -- ADM_METHOD
