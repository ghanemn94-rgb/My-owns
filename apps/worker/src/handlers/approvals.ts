// approvals job handlers (P4 stub, T-DG4-BE-A; p4-work-split §I+C.1): approval.escalation_scan (REQ-S10-019, ADR-0026 §6). Owned and filled by BE-B. Every
// handler uses the kit (../kit.ts): runOnce(db, consumer, key, fn) for its effects and the ledger row in one
// transaction, createWorkItemOnce for tasks and reminders, jobActor(jobId) as the audit actor (S-13). A job never
// decides a business approval.
import type { JobHandler } from "./spec.ts";

export const APPROVALS_HANDLERS: readonly JobHandler[] = [];
