// sustainment job handlers (P4 stub, T-DG4-BE-A; p4-work-split §I+C.1): recurring BAU reviews and control checks (slice G). Owned and filled by BE-I. Every
// handler uses the kit (../kit.ts): runOnce(db, consumer, key, fn) for its effects and the ledger row in one
// transaction, createWorkItemOnce for tasks and reminders, jobActor(jobId) as the audit actor (S-13). A job never
// decides a business approval.
import type { JobHandler } from "./spec.ts";

export const SUSTAINMENT_HANDLERS: readonly JobHandler[] = [];
