// reports job handlers (P5; stub by T-DG5-BE-A, p5-plan §5.1 and §5.3): the owning P5 task registers its handlers here,
// each idempotent through the kit (../kit.ts: runOnce, createWorkItemOnce). Empty until then.
import type { JobHandler } from "./spec.ts";

export const REPORTS_HANDLERS: readonly JobHandler[] = [];
