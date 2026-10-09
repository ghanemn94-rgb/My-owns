// access job handlers (P4 stub, T-DG4-BE-A; p4-work-split §I+C.1): delegation.expiry_sweep (REQ-S10-010). Owned and filled by BE-B. Every
// handler uses the kit (../kit.ts): runOnce(db, consumer, key, fn) for its effects and the ledger row in one
// transaction, createWorkItemOnce for tasks and reminders, jobActor(jobId) as the audit actor (S-13). A job never
// decides a business approval.
import type { JobHandler } from "./spec.ts";

export const ACCESS_HANDLERS: readonly JobHandler[] = [];
