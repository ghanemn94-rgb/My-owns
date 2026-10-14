// `create_task` executor (ADR-0043 §2; REQ-S12-001, REQ-S12-021; p5-work-split §D.2; T-DG5-BE-H2): one
// `automation_task` work item, with its in-app notification, for each holder of `assigneeRole` in the target
// transformation, through the kit's createWorkItemOnce (UNIQUE (organization_id, dedupe_key) is the effect's own
// exactly-once backstop; dedupe key `automation:<rule code>:<trigger key>:<ordinal>:<assignee>`). The due date is
// `dueInWorkingDays` working days after the target's business date, on the organization's default business calendar
// (never elapsed days, never a hard-coded holiday); absent -> no due date. Planned by the twin of the API planner
// (common.ts; parity test). A task asks a person to act; it never decides anything for them.
import type { Tx } from "@mth/db";
import { createTaskActionParameters } from "@mth/shared/schemas";
import { businessDateOf } from "@mth/shared/time";
import { jobActor } from "../../kit.ts";
import { planRecipients, refusedEffect, type ActionEffect, type WorkerActionContext } from "./common.ts";
import { createItemsFor, workingDayDueDate } from "./items.ts";

export const CREATE_TASK = "create_task";

export async function executeCreateTask(tx: Tx, ctx: WorkerActionContext, parameters: unknown): Promise<ActionEffect> {
  const p = createTaskActionParameters.parse(parameters);
  const plan = await planRecipients(tx, ctx, CREATE_TASK, {
    role: p.assigneeRole,
    messageKey: p.messageKey,
    targetTransformationId: p.targetTransformationId,
  });
  if (plan.planned.outcome !== "would_run" || plan.target === null) return refusedEffect(plan.planned);
  const planned = { ...plan.planned, target: { ...plan.planned.target, dueInWorkingDays: p.dueInWorkingDays ?? null } };
  const dueDate =
    p.dueInWorkingDays === undefined
      ? null
      : await workingDayDueDate(
          tx,
          plan.target.organization_id,
          businessDateOf(new Date(), plan.target.timezone),
          p.dueInWorkingDays,
        );
  return createItemsFor(tx, jobActor(ctx.jobId), ctx, plan.target, plan.recipients, p.messageKey, dueDate, planned);
}
