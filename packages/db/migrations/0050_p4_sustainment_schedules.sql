-- 0050 P4 slice G: the two recurring sustainment job schedules (T-DG4-ARCH-06; ADR-0034 §6; REQ-PB-083, REQ-S11-004,
-- REQ-S11-007, REQ-S11-008). Authored by solution-architect. Runs as mth_owner inside one transaction opened by
-- `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16. Nothing here approves anything,
-- and nothing touches DG0-DG7.
--
-- Written by the architect (not left to BE-I2) because migration ids must stay contiguous (p4-work-split S-12): a free
-- 0050 would block ARCH-07's 0051 until BE-I2 merged. Until BE-I2 registers the handlers, the worker reports both rows
-- as `unhandled` and schedules nothing (apps/worker/src/schedules.ts: no job without a consumer).
INSERT INTO job_schedule (id, code, queue_name, cron, timezone, description_en, description_ar, owner_module) VALUES
  ('01920004-0001-7000-8000-000000000004', 'sustainment.review_scan', 'sustainment.review_scan', '20 0 * * *', 'Asia/Riyadh',
   'Create the next performance-area review and benefit-monitoring review once per due date, at the latest 7 days before it is due; never reads the transformation status (REQ-S11-004, REQ-S11-007).',
   'إنشاء مراجعة مجال الأداء التالية ومراجعة متابعة المنفعة مرة واحدة لكل تاريخ استحقاق، قبل موعدها بسبعة أيام على الأكثر.', 'sustainment'),
  ('01920004-0001-7000-8000-000000000005', 'sustainment.control_check_scan', 'sustainment.control_check_scan', '25 0 * * *', 'Asia/Riyadh',
   'Create the next control check once per control and due date, at the latest 7 days before it is due (REQ-S11-008).',
   'إنشاء فحص الضابط الرقابي التالي مرة واحدة لكل ضابط وتاريخ استحقاق، قبل موعده بسبعة أيام على الأكثر.', 'sustainment');
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source)
SELECT mth_uuid_v7(), 'system', 'job_schedule.create', 'job_schedule', s.id, 1, 'migration' FROM job_schedule s
WHERE s.code IN ('sustainment.review_scan', 'sustainment.control_check_scan');
