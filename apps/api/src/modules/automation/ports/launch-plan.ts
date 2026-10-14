// The S12-004 launch-plan port, API side (ADR-0044 §2 step 3; ADR-0048; p5-work-split §E.1, §H.1; T-DG5-BE-J). BE-P
// registers its implementation (launch/port.ts) with one line in server.ts. The no-op default reports
// `port_unavailable` and writes nothing. Starter 1 runs in the worker, which imports no API code (ADR-0002 rule 5), so
// the worker calls its own twin with the same signature (apps/worker/src/automation/ports/launch-plan.ts); a generator
// must be idempotent on `idempotencyKey` (`launch_plan:<transformationId>`): a replay writes nothing.
import type { Tx } from "@mth/db";

export interface LaunchPlanRequest {
  readonly transformationId: string;
  /** Business date `YYYY-MM-DD`: day d = startDate + d calendar days (D-142 Q6). */
  readonly startDate: string;
  readonly idempotencyKey: string;
}

export type LaunchPlanOutcome =
  | { readonly outcome: "created" | "existing"; readonly launchPlanId: string }
  | { readonly outcome: "port_unavailable" };

export interface LaunchPlanPort {
  generate(tx: Tx, request: LaunchPlanRequest): Promise<LaunchPlanOutcome>;
}

export const LAUNCH_PLAN_PORT_UNAVAILABLE = "automation.port_unavailable";

/** The port's idempotency key for a transformation (ADR-0044 §2). */
export const launchPlanKey = (transformationId: string) => `launch_plan:${transformationId}`;

const NO_OP: LaunchPlanPort = { generate: async () => ({ outcome: "port_unavailable" }) };
let port: LaunchPlanPort = NO_OP;

/** One registration line in server.ts (BE-P); `null` restores the no-op default (tests). */
export function registerLaunchPlanPort(p: LaunchPlanPort | null): void {
  port = p ?? NO_OP;
}

export function launchPlanPort(): LaunchPlanPort {
  return port;
}
