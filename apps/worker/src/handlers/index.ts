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
// P5 domains (T-DG5-BE-A stubs; p5-plan §5.3): one import per new domain, each owned by its task.
import { AUTOMATION_HANDLERS } from "./automation.ts";
import { PROCEDURES_HANDLERS } from "./procedures.ts";
import { REPORTS_HANDLERS } from "./reports.ts";
import { LAUNCH_HANDLERS } from "./launch.ts";
import { DEMO_HANDLERS } from "./demo.ts";
import type { JobHandler } from "./spec.ts";
import type { Db } from "@mth/db";
// T-DG5-BE-J (ADR-0044 §1, §7; p5-work-split §E.1): the starters' wrapper and the dependency-slip consumer.
import { runAsStarter, withStarterRules } from "../automation/starters.ts";
import { handleTransformationCreated as handleTransformationCreatedDg4, type HandlerOutcome } from "./platform.ts";
import { PORTFOLIO_HANDLERS } from "./portfolio.ts";
import { DIGESTS_HANDLERS } from "./digests.ts"; // T-DG5-BE-L (ADR-0044 §5, §8)

export { purgeExpired, STARTER_AUTOMATION_CONSUMER, type HandlerOutcome, type PurgeResult } from "./platform.ts";
export type { JobHandler } from "./spec.ts";

/**
 * T-DG5-BE-J: `transformation.created` (worker.ts wires it itself) runs as starter 1 `starter.transformation_created`
 * through the same wrapper (the handler unchanged; its outcome returned as it is).
 */
export function handleTransformationCreated(db: Db, data: unknown, jobId: string): Promise<HandlerOutcome> {
  return runAsStarter(db, "starter.transformation_created", "transformation.created", data, jobId, undefined, () =>
    handleTransformationCreatedDg4(db, data, jobId),
  );
}

/**
 * Every domain handler (P4 and P5 slices); the platform handlers are wired by worker.ts itself. T-DG5-BE-J: each
 * handler on a starter queue is registered through withStarterRule (automation/starters.ts), same queue, unchanged.
 */
export const DOMAIN_HANDLERS: readonly JobHandler[] = withStarterRules([
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
  ...AUTOMATION_HANDLERS,
  ...PROCEDURES_HANDLERS,
  ...REPORTS_HANDLERS,
  ...LAUNCH_HANDLERS,
  ...DEMO_HANDLERS,
  ...PORTFOLIO_HANDLERS,
  ...DIGESTS_HANDLERS, // T-DG5-BE-L
]);
