// kpi job handlers (P4 stub, T-DG4-BE-A; p4-work-split §I+C.1): kpi.reporting_period_open (REQ-S12-005) and the KPI recalculation (REQ-S12-006). Owned and filled by KBE-C. Every
// handler uses the kit (../kit.ts): runOnce(db, consumer, key, fn) for its effects and the ledger row in one
// transaction, createWorkItemOnce for tasks and reminders, jobActor(jobId) as the audit actor (S-13). A job never
// decides a business approval.
import type { JobHandler } from "./spec.ts";

export const KPI_HANDLERS: readonly JobHandler[] = [];
