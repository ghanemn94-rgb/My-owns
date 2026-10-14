// The worker twin of the API's action planner (apps/api/src/modules/tasks/automation-actions.ts `planRecipients`;
// ADR-0043 §2, §3; ADR-0002 rule 5: the worker imports no API code). The executors (create-task.ts, notify.ts,
// escalate.ts) plan with it and then write the effect. apps/api/test/integration/automation/automation-engine.test.ts
// runs both planners over the same fixtures and requires the same outcome, target, recipients and key (parity).
//
//  - target = the action's `targetTransformationId`, or the event's transformation; none -> `invalid`;
//  - a target outside the rule's scope, or (initiating_user) a target the user cannot read -> `forbidden`
//    (`automation.action_forbidden`; never retried; ADR-0043 §3);
//  - recipients = the active holders of the business role whose grant gives them `transformation.read` on the target
//    (ADR-0006 scope: a transformation grant, or an inherited organization / business-unit grant), sorted by id.
// Exactly-once key: `automation:<rule code>:<trigger key>:<ordinal>`; each effect adds `:<recipient>`.
import { sql, type Tx } from "@mth/db";
import type { AutomationPlannedAction } from "@mth/shared/schemas";

/** The permission a recipient (and an initiating user) must hold on the target transformation. */
export const RECIPIENT_PERMISSION = "transformation.read";
export const ACTION_FORBIDDEN = "automation.action_forbidden";
export const ACTION_FAILED = "automation.action_failed";

export type WorkerIdentity =
  | { readonly runAs: "service"; readonly permissions: readonly string[] }
  | { readonly runAs: "initiating_user"; readonly userId: string };

export interface WorkerActionContext {
  readonly ruleCode: string;
  readonly ruleName: string;
  readonly triggerCode: string;
  readonly triggerLabel: string;
  readonly triggerKey: string;
  readonly ordinal: number;
  readonly scope: {
    readonly level: "platform" | "organization" | "transformation";
    readonly organizationId: string | null;
    readonly transformationId: string | null;
  };
  /** The event's transformation (null when it names none). */
  readonly transformationId: string | null;
  readonly identity: WorkerIdentity;
  readonly executionId: string;
  readonly jobId: string;
}

/** What an executor did (recorded as one automation_action_result). */
export interface ActionEffect {
  readonly outcome: "done" | "existing" | "skipped" | "failed" | "forbidden";
  readonly resultRecordType: string | null;
  readonly resultRecordId: string | null;
  readonly errorCode: string | null;
  readonly planned: AutomationPlannedAction;
}

export function automationActionKey(ctx: Pick<WorkerActionContext, "ruleCode" | "triggerKey" | "ordinal">): string {
  return `automation:${ctx.ruleCode}:${ctx.triggerKey}:${ctx.ordinal}`;
}

interface TargetRow {
  readonly id: string;
  readonly organization_id: string;
  readonly business_unit_id: string | null;
  readonly timezone: string;
}

export async function loadTarget(tx: Tx, transformationId: string): Promise<TargetRow | undefined> {
  return tx
    .selectFrom("transformation")
    .select(["id", "organization_id", "business_unit_id", "timezone"])
    .where("id", "=", transformationId)
    .executeTakeFirst();
}

/**
 * Users (optionally only `userId`, optionally only holders of `roleCode`) whose live grant gives them
 * `transformation.read` on the target: the approverRoleHolders scope rule of handlers/gates.ts.
 */
async function readersOf(tx: Tx, t: TargetRow, opts: { roleCode?: string; userId?: string }): Promise<string[]> {
  const r = await sql<{ user_id: string }>`
    SELECT DISTINCT sa.user_id
    FROM scoped_assignment sa
    JOIN role r ON r.id = sa.role_id
    JOIN role_permission rp ON rp.role_id = r.id AND rp.permission_code = ${RECIPIENT_PERMISSION}
    JOIN app_user u ON u.id = sa.user_id AND u.status = 'active'
    WHERE sa.revoked_at IS NULL AND sa.effective_from <= now() AND (sa.effective_to IS NULL OR sa.effective_to > now())
      AND sa.organization_id = ${t.organization_id}::uuid
      AND (${opts.roleCode ?? null}::text IS NULL OR r.code = ${opts.roleCode ?? null}::text)
      AND (${opts.userId ?? null}::uuid IS NULL OR sa.user_id = ${opts.userId ?? null}::uuid)
      AND ((sa.scope_type = 'transformation' AND sa.scope_id = ${t.id}::uuid)
        OR (r.inherits_downward AND sa.scope_type = 'organization' AND sa.scope_id = ${t.organization_id}::uuid)
        OR (r.inherits_downward AND sa.scope_type = 'business_unit'
            AND sa.scope_id IN (SELECT c.ancestor_id FROM business_unit_closure c
                                WHERE c.descendant_id = ${t.business_unit_id}::uuid)))
    ORDER BY sa.user_id`.execute(tx);
  return r.rows.map((x) => x.user_id);
}

export interface RecipientPlan {
  readonly planned: AutomationPlannedAction;
  readonly target: TargetRow | null;
  readonly recipients: readonly string[];
}

/** The planner twin (see the header). Read-only. */
export async function planRecipients(
  tx: Tx,
  ctx: WorkerActionContext,
  actionType: string,
  p: { readonly role: string; readonly messageKey: string; readonly targetTransformationId?: string | undefined },
): Promise<RecipientPlan> {
  const base = { ordinal: ctx.ordinal, actionType, idempotencyKey: automationActionKey(ctx), messageKey: p.messageKey };
  const transformationId = p.targetTransformationId ?? ctx.transformationId;
  if (transformationId === null)
    return {
      planned: { ...base, outcome: "invalid", target: { reason: "no_target_transformation" } },
      target: null,
      recipients: [],
    };
  const target = await loadTarget(tx, transformationId);
  if (target === undefined)
    return {
      planned: { ...base, outcome: "invalid", target: { transformationId, reason: "target_not_found" } },
      target: null,
      recipients: [],
    };
  const s = ctx.scope;
  const inScope =
    s.level === "platform" ||
    (s.level === "organization" && s.organizationId === target.organization_id) ||
    (s.level === "transformation" && s.transformationId === transformationId);
  if (!inScope)
    return {
      planned: { ...base, outcome: "forbidden", target: { transformationId, reason: "outside_rule_scope" } },
      target,
      recipients: [],
    };
  if (ctx.identity.runAs === "initiating_user") {
    const can = await readersOf(tx, target, { userId: ctx.identity.userId });
    if (can.length === 0)
      return {
        planned: { ...base, outcome: "forbidden", target: { transformationId, reason: "identity_lacks_permission" } },
        target,
        recipients: [],
      };
  }
  const recipients = await readersOf(tx, target, { roleCode: p.role });
  return {
    planned: {
      ...base,
      outcome: "would_run",
      target: {
        organizationId: target.organization_id,
        transformationId,
        roleCode: p.role,
        recipientUserIds: recipients,
      },
    },
    target,
    recipients,
  };
}

/** The effect when the plan is not `would_run`: forbidden (never retried) or failed (no usable target). */
export function refusedEffect(planned: AutomationPlannedAction): ActionEffect {
  return planned.outcome === "forbidden"
    ? { outcome: "forbidden", resultRecordType: null, resultRecordId: null, errorCode: ACTION_FORBIDDEN, planned }
    : { outcome: "failed", resultRecordType: null, resultRecordId: null, errorCode: ACTION_FAILED, planned };
}

/** The in-app link of an automation item: the target transformation. */
export const linkOf = (transformationId: string) => `/transformations/${transformationId}`;
