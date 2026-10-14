// Shared work-item writing of the create_task and escalate executors (ADR-0043 §2; T-DG5-BE-H2): one
// `automation_task` item per recipient through the kit's createWorkItemOnce, and the working-day due date on the
// organization's default business calendar (the handlers/adoption.ts rule: never elapsed days, no hard-coded holiday).
import { sql, type AuditActor, type Tx } from "@mth/db";
import type { AutomationPlannedAction } from "@mth/shared/schemas";
import { addWorkingDays } from "@mth/shared/time";
import { createWorkItemOnce } from "../../kit.ts";
import { linkOf, type ActionEffect, type WorkerActionContext } from "./common.ts";

export const AUTOMATION_TASK_KIND = "automation_task";

/** The `workingDays`-th working day after `from` on the organization's default calendar (null if not computable). */
export async function workingDayDueDate(
  tx: Tx,
  organizationId: string,
  from: string,
  workingDays: number,
): Promise<string | null> {
  const calendar = await tx
    .selectFrom("business_calendar")
    .select(["id", "workweek"])
    .where("organization_id", "=", organizationId)
    .where("is_default", "=", true)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!calendar) return addWorkingDays(from, workingDays, null).dueDate;
  const holidays = await tx
    .selectFrom("business_calendar_holiday")
    .select([sql<string>`date_from::text`.as("dateFrom"), sql<string>`date_to::text`.as("dateTo")])
    .where("calendar_id", "=", calendar.id)
    .where("status", "=", "active")
    .execute();
  return addWorkingDays(from, workingDays, { workweek: calendar.workweek.map(Number), holidays }).dueDate;
}

export async function createItemsFor(
  tx: Tx,
  actor: AuditActor,
  ctx: WorkerActionContext,
  target: { readonly id: string; readonly organization_id: string },
  recipients: readonly string[],
  messageKey: string,
  dueDate: string | null,
  planned: AutomationPlannedAction,
): Promise<ActionEffect> {
  let first: string | null = null;
  let created = 0;
  for (const userId of recipients) {
    const r = await createWorkItemOnce(tx, actor, {
      organizationId: target.organization_id,
      transformationId: target.id,
      kind: AUTOMATION_TASK_KIND,
      assigneeUserId: userId,
      subjectType: "automation_execution",
      subjectId: ctx.executionId,
      linkPath: linkOf(target.id),
      messageKey,
      messageParams: { ruleName: ctx.ruleName, triggerLabel: ctx.triggerLabel },
      dueDate,
      dedupeKey: `${planned.idempotencyKey}:${userId}`,
    });
    if (r.outcome === "created") {
      created += 1;
      first ??= r.workItemId;
    }
  }
  if (recipients.length === 0)
    return { outcome: "skipped", resultRecordType: null, resultRecordId: null, errorCode: null, planned };
  return {
    outcome: created > 0 ? "done" : "existing",
    resultRecordType: first === null ? null : "work_item",
    resultRecordId: first,
    errorCode: null,
    planned,
  };
}
