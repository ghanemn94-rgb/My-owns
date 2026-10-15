// The worker side of the S12-004 launch-plan port (ADR-0044 §2 step 3; ADR-0048; p5-work-split §E.1, §H.1;
// T-DG5-BE-J). Starter 1 (`starter.transformation_created`) runs in the worker, so it calls the port registered HERE
// at worker composition; the API twin (apps/api/src/modules/automation/ports/launch-plan.ts) is the same signature for
// the API process. Until BE-P registers an implementation the default is a no-op that reports `port_unavailable`:
// nothing is generated and nothing is guessed (REQ-S12-004 "with the plan flag the 90-day tasks are dated from the
// start date" stays pending until BE-P merges, p5-plan §5.2). A generator must be idempotent on `idempotencyKey`
// (`launch_plan:<transformationId>`): a replay writes nothing.
import type { Tx } from "@mth/db";

export interface LaunchPlanRequest {
  readonly transformationId: string;
  /** Business date `YYYY-MM-DD`: day d = startDate + d calendar days (D-142 Q6). */
  readonly startDate: string;
  readonly idempotencyKey: string;
  /** The pg-boss job id, for the audit actor (`job:<id>`). */
  readonly jobId: string;
}

export type LaunchPlanOutcome =
  | { readonly outcome: "created" | "existing"; readonly launchPlanId: string }
  | { readonly outcome: "port_unavailable" };

export interface LaunchPlanPort {
  generate(tx: Tx, request: LaunchPlanRequest): Promise<LaunchPlanOutcome>;
}

export const LAUNCH_PLAN_PORT_UNAVAILABLE = "automation.port_unavailable";

const NO_OP: LaunchPlanPort = { generate: async () => ({ outcome: "port_unavailable" }) };
let port: LaunchPlanPort = NO_OP;

/** Registered once at worker composition by the launch-plan owner (BE-P); `null` restores the no-op default. */
export function registerLaunchPlanPort(p: LaunchPlanPort | null): void {
  port = p ?? NO_OP;
}

export function launchPlanPort(): LaunchPlanPort {
  return port;
}
