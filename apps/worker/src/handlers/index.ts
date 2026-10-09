// Job handler registry (ADR-0008; P4 split by T-DG4-BE-A, p4-plan §3 seam 18, p4-work-split §I+C.1): the platform
// handlers (platform.ts) plus one file per domain. Each task owns only its domain file; this index already imports
// every one, and worker.ts starts a pg-boss worker for each registered handler.
import { APPROVALS_HANDLERS } from "./approvals.ts";
import { ACCESS_HANDLERS } from "./access.ts";
import { KPI_HANDLERS } from "./kpi.ts";
import { BENEFITS_HANDLERS } from "./benefits.ts";
import { RAID_HANDLERS } from "./raid.ts";
import { MEETINGS_HANDLERS } from "./meetings.ts";
import { ESCALATIONS_HANDLERS } from "./escalations.ts";
import { ADOPTION_HANDLERS } from "./adoption.ts";
import { SUSTAINMENT_HANDLERS } from "./sustainment.ts";
import { GATES_HANDLERS } from "./gates.ts";
import type { JobHandler } from "./spec.ts";

export {
  handleTransformationCreated,
  purgeExpired,
  STARTER_AUTOMATION_CONSUMER,
  type HandlerOutcome,
  type PurgeResult,
} from "./platform.ts";
export type { JobHandler } from "./spec.ts";

/** Every domain handler (P4 slices); the platform handlers are wired by worker.ts itself. */
export const DOMAIN_HANDLERS: readonly JobHandler[] = [
  ...APPROVALS_HANDLERS,
  ...ACCESS_HANDLERS,
  ...KPI_HANDLERS,
  ...BENEFITS_HANDLERS,
  ...RAID_HANDLERS,
  ...MEETINGS_HANDLERS,
  ...ESCALATIONS_HANDLERS,
  ...ADOPTION_HANDLERS,
  ...SUSTAINMENT_HANDLERS,
  ...GATES_HANDLERS,
];
