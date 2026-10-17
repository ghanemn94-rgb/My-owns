// Ports of the reporting module (T-DG4-KBE-G2; ADR-0037 §1 item 3, §9). `reporting` may not import `workflows`
// (modules.ts; the P1 scaffold self-check), so the workspace header reads the live gate readiness through
// `WorkflowsReadPort`, which the composition root (server.ts) wires to `workflows/gate-readiness-read.ts` with one line
// (the GateFactsProvider precedent, ADR-0021 §7). Until it is wired the port answers null and the header shows
// `gateReadiness.state = "unknown"`: it fails closed, never "ready".
import type { DbOrTx } from "@mth/db";
import type { WorkspaceGateReadiness } from "@mth/shared/schemas";

export interface WorkflowsReadPort {
  /** The gate of the transformation's current phase with its live readiness, or null when it cannot be read. */
  gateReadiness(db: DbOrTx, transformationId: string): Promise<WorkspaceGateReadiness | null>;
  /**
   * T-DG5-KBE-D4 (D-164 c; ADR-0039 §3): the EFFECTIVE approver of one product gate of the transformation (workflows'
   * `effectiveGateApprover`, the rule a new submission routes by), or null when it cannot be read. The gate pack of a
   * gate without a submission names this approver, not the stored one, which a pinned methodology may override.
   */
  gateApprover(
    db: DbOrTx,
    transformationId: string,
    gateCode: string,
  ): Promise<{ readonly roleCode: string; readonly userId: string | null } | null>;
}

const UNWIRED: WorkflowsReadPort = Object.freeze({ gateReadiness: async () => null, gateApprover: async () => null });

let port: WorkflowsReadPort = UNWIRED;

/** Called once by the composition root (server.ts). */
export function setWorkflowsReadPort(p: WorkflowsReadPort): void {
  port = p;
}

/** The port in force (the unwired one answers null). */
export function workflowsReadPort(): WorkflowsReadPort {
  return port;
}
