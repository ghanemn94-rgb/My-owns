-- 0054 P4 slice H: the daily gate-exception expiry scan (T-DG4-ARCH-07; ADR-0035 §4; REQ-S04-013 "an expired waiver
-- no longer satisfies the item and the owner is notified"). Authored by solution-architect. Runs as mth_owner inside
-- one transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16. Nothing
-- here approves anything, and nothing touches DG0-DG7.
--
-- Written by the architect (not left to BE-K) because migration ids must stay contiguous (p4-work-split S-12): a free
-- 0054 would block ARCH-08's 0055. The scan only notifies: an exception stops covering its criterion on the day after
-- expires_on whether or not the scan has run (ADR-0035 §4). Until BE-K registers the handler, the worker reports the
-- row as `unhandled` and schedules nothing (apps/worker/src/schedules.ts: no job without a consumer).
INSERT INTO job_schedule (id, code, queue_name, cron, timezone, description_en, description_ar, owner_module) VALUES
  ('01920004-0001-7000-8000-000000000006', 'gate.exception_expiry_scan', 'gate.exception_expiry_scan', '30 0 * * *', 'Asia/Riyadh',
   'Notify the requester and the gate approver once when an accepted gate exception has expired, and create one task to close the reopened evidence gap (REQ-S04-013). Never changes an exception or a gate.',
   'إشعار مقدّم الطلب ومعتمد البوابة مرة واحدة عند انتهاء استثناء بوابة مقبول، وإنشاء مهمة واحدة لسد فجوة الدليل التي عادت. لا يغيّر استثناءً ولا بوابة.', 'workflows');
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source)
SELECT mth_uuid_v7(), 'system', 'job_schedule.create', 'job_schedule', s.id, 1, 'migration' FROM job_schedule s
WHERE s.code = 'gate.exception_expiry_scan';
