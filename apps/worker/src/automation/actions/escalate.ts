// `escalate` executor (ADR-0043 §2; p5-work-split §D.2; T-DG5-BE-H2): one `automation_task` work item (urgency of
// the kind) with its in-app notification for each holder of the business role `toRole` in the target transformation,
// through createWorkItemOnce (dedupe `automation:<rule code>:<trigger key>:<ordinal>:<assignee>`). No due date: an
// escalation asks for attention now. Planned by the twin of the API planner (common.ts; parity test). Escalation
// routes attention to a person; it never approves or decides anything (M0242).
import type { Tx } from "@mth/db";
import { escalateActionParameters } from "@mth/shared/schemas";
import { jobActor } from "../../kit.ts";
import { planRecipients, refusedEffect, type ActionEffect, type WorkerActionContext } from "./common.ts";
import { createItemsFor } from "./items.ts";

export const ESCALATE = "escalate";

export async function executeEscalate(tx: Tx, ctx: WorkerActionContext, parameters: unknown): Promise<ActionEffect> {
  const p = escalateActionParameters.parse(parameters);
  const plan = await planRecipients(tx, ctx, ESCALATE, {
    role: p.toRole,
    messageKey: p.messageKey,
    targetTransformationId: p.targetTransformationId,
  });
  if (plan.planned.outcome !== "would_run" || plan.target === null) return refusedEffect(plan.planned);
  return createItemsFor(tx, jobActor(ctx.jobId), ctx, plan.target, plan.recipients, p.messageKey, null, plan.planned);
}
