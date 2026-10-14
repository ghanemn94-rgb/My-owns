// `notify` executor (ADR-0043 §2; REQ-S12-021; p5-work-split §D.2; T-DG5-BE-H2): one in-app notification (no work
// item) for each holder of `recipientRole` in the target transformation. UNIQUE (organization_id, dedupe_key) on
// inbox_notification is the effect's own exactly-once backstop (dedupe `automation:<rule code>:<trigger key>:
// <ordinal>:<recipient>`); a replay finds it and records `existing`. In-app only (D-142 Q11). Planned by the twin of
// the API planner (common.ts; parity test). The notification stores a message key and parameters, never a sentence.
import { insertAuditEvent, sql, type Tx } from "@mth/db";
import { notifyActionParameters } from "@mth/shared/schemas";
import { jobActor } from "../../kit.ts";
import { linkOf, planRecipients, refusedEffect, type ActionEffect, type WorkerActionContext } from "./common.ts";

export const NOTIFY = "notify";

export async function executeNotify(tx: Tx, ctx: WorkerActionContext, parameters: unknown): Promise<ActionEffect> {
  const p = notifyActionParameters.parse(parameters);
  const plan = await planRecipients(tx, ctx, NOTIFY, {
    role: p.recipientRole,
    messageKey: p.messageKey,
    targetTransformationId: p.targetTransformationId,
  });
  if (plan.planned.outcome !== "would_run" || plan.target === null) return refusedEffect(plan.planned);
  const target = plan.target;
  const actor = jobActor(ctx.jobId);
  let first: string | null = null;
  let created = 0;
  for (const userId of plan.recipients) {
    const dedupeKey = `${plan.planned.idempotencyKey}:${userId}`;
    const id = (await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx)).rows[0]!.id;
    const inserted = await tx
      .insertInto("inbox_notification")
      .values({
        id,
        organization_id: target.organization_id,
        transformation_id: target.id,
        recipient_user_id: userId,
        work_item_id: null,
        link_path: linkOf(target.id),
        message_key: p.messageKey,
        message_params: JSON.stringify({ ruleName: ctx.ruleName, triggerLabel: ctx.triggerLabel }),
        dedupe_key: dedupeKey,
        created_by: null,
        updated_by: null,
      })
      .onConflict((oc) => oc.columns(["organization_id", "dedupe_key"]).doNothing())
      .returning("id")
      .executeTakeFirst();
    if (!inserted) continue;
    created += 1;
    first ??= id;
    await insertAuditEvent(tx, actor, {
      action: "inbox_notification.create",
      recordType: "inbox_notification",
      recordId: id,
      organizationId: target.organization_id,
      transformationId: target.id,
      newVersion: 1,
      changes: {
        recipient_user_id: { from: null, to: userId },
        work_item_id: { from: null, to: null },
        dedupe_key: { from: null, to: dedupeKey },
      },
    });
  }
  if (plan.recipients.length === 0)
    return { outcome: "skipped", resultRecordType: null, resultRecordId: null, errorCode: null, planned: plan.planned };
  return {
    outcome: created > 0 ? "done" : "existing",
    resultRecordType: first === null ? null : "inbox_notification",
    resultRecordId: first,
    errorCode: null,
    planned: plan.planned,
  };
}
