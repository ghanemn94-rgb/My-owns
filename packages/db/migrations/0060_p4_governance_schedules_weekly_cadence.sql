-- 0060 P4 repair: the three slice D job schedules and the weekly benefit control cadence (T-DG4-ARCH-R1; D-102, D-105,
-- D-106 "0060 is reserved for the repair migration of D-105"). Repair range (D-089: 0058-0069 held for repairs).
-- Authored by solution-architect. Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only:
-- never edit once merged. SQL floor: PostgreSQL 16. Nothing here approves anything, and nothing touches the
-- engineering delivery gates DG0-DG7.
--
-- 1. job_schedule rows (ADR-0025 §3; ADR-0032 §2, §7, §8.3, §10 "governance.meeting_series_generate (daily),
--    governance.decision_sla_scan (daily, working days only), governance.blocker_escalation_scan (daily)"). The queue
--    names are the ones apps/worker/src/queues/meetings.ts and queues/escalations.ts create. BE-F and BE-G registered
--    the handlers, so the worker schedules each row at start (apps/worker/src/schedules.ts). "Working days only" is the
--    decision-SLA handler's own business-calendar check (ADR-0032 §7): the schedule fires daily and the handler does
--    nothing on a non-working day or without a calendar. Each row is audited (actor 'system', source 'migration'), as in
--    0028, 0050 and 0054. Cron fields: minute hour day-of-month month day-of-week, evaluated in `timezone`; the minutes
--    follow the existing rows (00:05, 00:20, 00:25, 00:30) so no two daily jobs start together.
--    description_ar is a PROVISIONAL translation that needs linguistic review.
INSERT INTO job_schedule (id, code, queue_name, cron, timezone, description_en, description_ar, owner_module) VALUES
  ('01920004-0001-7000-8000-000000000007', 'governance.meeting_series_generate', 'governance.meeting_series_generate', '35 0 * * *', 'Asia/Riyadh',
   'Create the missing meetings of every active meeting series up to its horizon, once per occurrence; never decides or approves anything (REQ-PB-060, REQ-S10-005).',
   'إنشاء الاجتماعات الناقصة لكل سلسلة اجتماعات نشطة حتى أفقها، مرة واحدة لكل موعد؛ لا يقرر ولا يعتمد شيئاً.', 'governance'),
  ('01920004-0001-7000-8000-000000000008', 'governance.decision_sla_scan', 'governance.decision_sla_scan', '40 0 * * *', 'Asia/Riyadh',
   'On a working day, escalate once each open or deferred executive ask whose SLA date has passed; an ask with an Unknown SLA date is never selected; never decides the ask (REQ-S12-011).',
   'في يوم العمل، تصعيد كل طلب تنفيذي مفتوح أو مؤجل تجاوز تاريخ اتفاقية مستوى الخدمة مرة واحدة؛ لا يُختار طلب تاريخه غير معروف؛ لا يبت في الطلب.', 'governance'),
  ('01920004-0001-7000-8000-000000000009', 'governance.blocker_escalation_scan', 'governance.blocker_escalation_scan', '45 0 * * *', 'Asia/Riyadh',
   'Evaluate red blockers against the forum escalation rule and escalate each once per cycle; never decides or approves anything (REQ-PB-082).',
   'تقييم العوائق الحمراء وفق قاعدة التصعيد في المنتدى وتصعيد كل منها مرة واحدة لكل دورة؛ لا يقرر ولا يعتمد شيئاً.', 'governance');
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source)
SELECT mth_uuid_v7(), 'system', 'job_schedule.create', 'job_schedule', s.id, 1, 'migration' FROM job_schedule s
WHERE s.code IN ('governance.meeting_series_generate', 'governance.decision_sla_scan', 'governance.blocker_escalation_scan');

-- 2. benefit.control_cadence gains 'weekly' (BE-I handback §6 item 1; ADR-0029 and ADR-0034 amendments of 2026-10-09).
--    0037 declared the column CHECK inline, so PostgreSQL named it benefit_control_cadence_check. The new CHECK is a
--    superset of the old one, so every existing row satisfies it; `semiannual` keeps its spelling (the handover's
--    `semi_annual` maps to it, ADR-0034 §5 amendment). benefit_sustain_outputs_present is unchanged.
ALTER TABLE benefit DROP CONSTRAINT benefit_control_cadence_check;
ALTER TABLE benefit ADD CONSTRAINT benefit_control_cadence_check
  CHECK (control_cadence IS NULL OR control_cadence IN ('weekly', 'monthly', 'quarterly', 'semiannual', 'annual'));

DO $$
BEGIN
  IF (SELECT count(*) FROM job_schedule
       WHERE code IN ('governance.meeting_series_generate', 'governance.decision_sla_scan', 'governance.blocker_escalation_scan')
         AND code = queue_name AND enabled) <> 3 THEN
    RAISE EXCEPTION '0060: the three governance job_schedule rows are missing';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'benefit'::regclass AND conname = 'benefit_control_cadence_check'
         AND pg_get_constraintdef(oid) LIKE '%weekly%') <> 1 THEN
    RAISE EXCEPTION '0060: benefit_control_cadence_check does not admit weekly';
  END IF;
END $$;
