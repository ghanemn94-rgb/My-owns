// The automation actions owned by tasks (ADR-0043 §2; p5-work-split §D.1; T-DG5-BE-H): `create_task`, `notify` and
// `escalate`. Each descriptor gives the Zod schema of the action's settings, the permission checked (none beyond the
// target's scope: the recipients are the holders of a business role who can read the target transformation), and a
// READ-ONLY planner used by validation and the dry run (BE-H2). The worker executes the same codes through
// apps/worker/src/automation/actions/** (BE-H2), each with a parity test against the planner here.
//
// The composition root registers these into the automation registry (server.ts), so automation imports no domain
// module (the GateFactsProvider pattern). tasks is a leaf that automation depends on, so this file never imports
// automation: the descriptor and context types below are structural, and server.ts checks that they fit the
// automation port (`AutomationActionDescriptor`, `AutomationPlanContext` in automation/registry.ts).
//
// Exactly-once key (ADR-0043 §2, §5): `automation:<rule code>:<trigger key>:<ordinal>`; each effect adds the recipient
// (`…:<assignee>`), and `createWorkItemOnce`'s UNIQUE (organization_id, dedupe_key) is the effect's own backstop.
// Nothing here approves anything: a task or notification asks a person to act; it never decides for them.
import type { DbOrTx } from "@mth/db";
import type { Permission } from "@mth/shared";
import {
  createTaskActionParameters,
  escalateActionParameters,
  notifyActionParameters,
  type AutomationPlannedAction,
} from "@mth/shared/schemas";
import type { z } from "zod";
import { decide, loadGrants, resolveTarget } from "../access/index.ts";

/** What a planner reads of automation's `AutomationPlanContext` (structural; ADR-0043 §2, §3). */
export interface TaskActionPlanContext {
  readonly ruleCode: string;
  readonly triggerKey: string;
  readonly ordinal: number;
  readonly scope: {
    readonly level: "platform" | "organization" | "transformation";
    readonly organizationId: string | null;
    readonly transformationId: string | null;
  };
  readonly transformationId: string | null;
  readonly parameters: unknown;
  readonly identity:
    | { readonly runAs: "service"; readonly permissions: readonly Permission[] }
    | { readonly runAs: "initiating_user"; readonly userId: string };
}

/** One action descriptor (structural twin of automation's `AutomationActionDescriptor`). */
export interface TaskActionDescriptor {
  readonly code: string;
  readonly ownerModule: string;
  readonly parametersSchema: z.ZodType;
  readonly requiredPermission: Permission | null;
  plan(db: DbOrTx, ctx: TaskActionPlanContext): Promise<AutomationPlannedAction>;
}

/** The permission a recipient must hold in the target transformation. */
const RECIPIENT_PERMISSION: Permission = "transformation.read";

/** `automation:<rule code>:<trigger key>:<ordinal>` (the action's idempotency key; ADR-0043 §5 layer 2). */
export function automationActionKey(ctx: Pick<TaskActionPlanContext, "ruleCode" | "triggerKey" | "ordinal">): string {
  return `automation:${ctx.ruleCode}:${ctx.triggerKey}:${ctx.ordinal}`;
}

/**
 * The active users holding `roleCode` through a grant that gives them `transformation.read` on the target (the policy
 * function decides, so scope inheritance is exactly ADR-0006's). Sorted by id, for a deterministic plan.
 */
export async function recipientsOf(db: DbOrTx, roleCode: string, transformationId: string): Promise<string[]> {
  const target = await resolveTarget(db, { type: "transformation", id: transformationId });
  if (target === null) return [];
  const candidates = await db
    .selectFrom("scoped_assignment as a")
    .innerJoin("role as r", "r.id", "a.role_id")
    .innerJoin("app_user as u", "u.id", "a.user_id")
    .select("a.user_id")
    .distinct()
    .where("r.code", "=", roleCode)
    .where("a.organization_id", "=", target.organizationId)
    .where("a.revoked_at", "is", null)
    .where("u.status", "=", "active")
    .orderBy("a.user_id")
    .execute();
  const out: string[] = [];
  for (const c of candidates) {
    const grants = (await loadGrants(db, c.user_id)).filter((g) => g.roleCode === roleCode);
    if (decide({ kind: "user", userId: c.user_id, grants }, RECIPIENT_PERMISSION, target).allowed) out.push(c.user_id);
  }
  return out;
}

interface RecipientParameters {
  readonly role: string;
  readonly messageKey: string;
  readonly targetTransformationId?: string | undefined;
}

/**
 * The shared planner: target = `targetTransformationId` or the event's transformation; a target outside the rule's
 * scope, or one the initiating user cannot read, is `forbidden` (ADR-0043 §3: never retried, a failure at once); no
 * target is `invalid`; otherwise `would_run` with the recipients.
 */
async function planRecipients(
  db: DbOrTx,
  ctx: TaskActionPlanContext,
  actionType: string,
  p: RecipientParameters,
): Promise<AutomationPlannedAction> {
  const base = { ordinal: ctx.ordinal, actionType, idempotencyKey: automationActionKey(ctx), messageKey: p.messageKey };
  const transformationId = p.targetTransformationId ?? ctx.transformationId;
  if (transformationId === null) return { ...base, outcome: "invalid", target: { reason: "no_target_transformation" } };
  const target = await resolveTarget(db, { type: "transformation", id: transformationId });
  if (target === null) return { ...base, outcome: "invalid", target: { transformationId, reason: "target_not_found" } };
  const s = ctx.scope;
  const inScope =
    s.level === "platform" ||
    (s.level === "organization" && s.organizationId === target.organizationId) ||
    (s.level === "transformation" && s.transformationId === transformationId);
  if (!inScope) return { ...base, outcome: "forbidden", target: { transformationId, reason: "outside_rule_scope" } };
  if (ctx.identity.runAs === "initiating_user") {
    const grants = await loadGrants(db, ctx.identity.userId);
    const d = decide({ kind: "user", userId: ctx.identity.userId, grants }, RECIPIENT_PERMISSION, target);
    if (!d.allowed)
      return { ...base, outcome: "forbidden", target: { transformationId, reason: "identity_lacks_permission" } };
  }
  const recipients = await recipientsOf(db, p.role, transformationId);
  return {
    ...base,
    outcome: "would_run",
    target: {
      organizationId: target.organizationId,
      transformationId,
      roleCode: p.role,
      recipientUserIds: recipients,
    },
  };
}

type CreateTask = z.infer<typeof createTaskActionParameters>;
type Notify = z.infer<typeof notifyActionParameters>;
type Escalate = z.infer<typeof escalateActionParameters>;

export const createTaskAction: TaskActionDescriptor = {
  code: "create_task",
  ownerModule: "tasks",
  parametersSchema: createTaskActionParameters,
  requiredPermission: null,
  plan: async (db, ctx) => {
    const p = ctx.parameters as CreateTask;
    const planned = await planRecipients(db, ctx, "create_task", {
      role: p.assigneeRole,
      messageKey: p.messageKey,
      targetTransformationId: p.targetTransformationId,
    });
    return planned.outcome === "would_run"
      ? { ...planned, target: { ...planned.target, dueInWorkingDays: p.dueInWorkingDays ?? null } }
      : planned;
  },
};

export const notifyAction: TaskActionDescriptor = {
  code: "notify",
  ownerModule: "tasks",
  parametersSchema: notifyActionParameters,
  requiredPermission: null,
  plan: (db, ctx) => {
    const p = ctx.parameters as Notify;
    return planRecipients(db, ctx, "notify", {
      role: p.recipientRole,
      messageKey: p.messageKey,
      targetTransformationId: p.targetTransformationId,
    });
  },
};

export const escalateAction: TaskActionDescriptor = {
  code: "escalate",
  ownerModule: "tasks",
  parametersSchema: escalateActionParameters,
  requiredPermission: null,
  plan: (db, ctx) => {
    const p = ctx.parameters as Escalate;
    return planRecipients(db, ctx, "escalate", {
      role: p.toRole,
      messageKey: p.messageKey,
      targetTransformationId: p.targetTransformationId,
    });
  },
};

/** The three descriptors tasks owns, for the composition root's registration line. */
export const TASK_AUTOMATION_ACTIONS: readonly TaskActionDescriptor[] = [
  createTaskAction,
  notifyAction,
  escalateAction,
];
