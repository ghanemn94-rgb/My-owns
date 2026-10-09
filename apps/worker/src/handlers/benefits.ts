// benefits job handlers (P4 stub, T-DG4-BE-A; p4-work-split §I+C.1): the Finance validation queue (REQ-S12-014) and pending measurements (REQ-S07-014). Owned and filled by KBE-E. Every
// handler uses the kit (../kit.ts): runOnce(db, consumer, key, fn) for its effects and the ledger row in one
// transaction, createWorkItemOnce for tasks and reminders, jobActor(jobId) as the audit actor (S-13). A job never
// decides a business approval.
import type { JobHandler } from "./spec.ts";

export const BENEFITS_HANDLERS: readonly JobHandler[] = [];
