// gates job handlers (P4 stub, T-DG4-BE-A; p4-work-split §I+C.1): gate.submitted / gate.decided consumers (REQ-S12-009, REQ-S12-010). Owned and filled by BE-K. Every
// handler uses the kit (../kit.ts): runOnce(db, consumer, key, fn) for its effects and the ledger row in one
// transaction, createWorkItemOnce for tasks and reminders, jobActor(jobId) as the audit actor (S-13). A job never
// decides a business approval.
import type { JobHandler } from "./spec.ts";

export const GATES_HANDLERS: readonly JobHandler[] = [];
