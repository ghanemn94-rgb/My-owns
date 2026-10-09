-- 0058 P4 approval reminder work-item kinds (T-DG4-BE-B2; D-094 (2); ADR-0026 §4 "Outcome behaviour" and §6 step 3;
-- ADR-0025 §4; M0213). Repair range (D-089: 0058-0069 held for repairs), assigned by D-094. Authored by
-- backend-workflow-engineer. Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never
-- edit once merged. SQL floor: PostgreSQL 16.
--
-- Two inbox reminders of the P4 approval service (apps/api/src/modules/workflows/approvals.ts and the escalation job
-- apps/worker/src/handlers/approvals.ts), created only through createWorkItemOnce (S-13):
--  - approval_outcome: the requester's reminder when their approval is approved or rejected (ADR-0026 §4: "The
--    requester gets an inbox reminder");
--  - approval_overdue: the requester's and the current assignee's reminder when the timer escalates an overdue
--    approval, naming the delay and any routing error (ADR-0026 §6 step 3).
-- A reminder informs; it decides nothing. No timer, job or row here approves anything, and nothing touches the
-- engineering gates DG0-DG7. label_en is the platform wording; label_ar is a PROVISIONAL translation that needs
-- linguistic review.
INSERT INTO work_item_kind (code, owner_module, label_en, label_ar, source_ref) VALUES
  ('approval_outcome', 'workflows', 'Your approval request was decided', 'تم البت في طلب الموافقة الخاص بك', 'M0213'),
  ('approval_overdue', 'workflows', 'An approval you follow is overdue', 'موافقة تتابعها متأخرة', 'M0213');
