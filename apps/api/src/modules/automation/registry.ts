// The AutomationActionRegistry port (ADR-0043 §2; p5-work-split §D.1; T-DG5-BE-H). It maps each AUTOMATIC action code
// of the `automation_action_type` catalogue to a descriptor: the Zod schema of its parameters, the permission the
// acting identity must hold in the target's scope, and a read-only planner used by validation and the dry run.
//
// The GateFactsProvider pattern: automation imports no domain module. Each action's descriptor is defined by the module
// that owns the action (`tasks/automation-actions.ts`: create_task, notify, escalate; `procedures/automation-actions.ts`:
// launch_procedure, BE-J) and registered into the one registry by the composition root (server.ts), which then hands
// the registry to automation through `setAutomationActionRegistry`.
//
// Human decisions are never registered: the six `human_only` codes (REQ-S12-026) have no descriptor, and `register`
// refuses them as a programming error. A planner never writes: it runs inside the dry run's rolled-back read-only
// transaction (BE-H2) and only reads.
import type { DbOrTx } from "@mth/db";
import type { Permission } from "@mth/shared";
import { HUMAN_ONLY_ACTION_CODES, type AutomationPlannedAction } from "@mth/shared/schemas";
import type { z } from "zod";

/** The identity an action runs as (ADR-0043 §3). */
export type AutomationIdentity =
  | { readonly runAs: "service"; readonly permissions: readonly Permission[] }
  | { readonly runAs: "initiating_user"; readonly userId: string };

/** The rule's scope (ADR-0043 §1): a target outside it is `forbidden`, never retried (§3). */
export interface AutomationRuleScope {
  readonly level: "platform" | "organization" | "transformation";
  readonly organizationId: string | null;
  readonly transformationId: string | null;
}

/** What a planner receives (ADR-0043 §2, §5). `parameters` were validated by the descriptor's schema. */
export interface AutomationPlanContext {
  readonly ruleCode: string;
  readonly triggerCode: string;
  /** The envelope's idempotency key, or `<schedule code>:<ISO minute>` for ticks. */
  readonly triggerKey: string;
  /** 1-based position of the action in its version. */
  readonly ordinal: number;
  readonly scope: AutomationRuleScope;
  /** The event's organization and transformation (null when the event names none). */
  readonly organizationId: string | null;
  readonly transformationId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly parameters: unknown;
  readonly identity: AutomationIdentity;
}

/** One automatic action type (ADR-0043 §2). */
export interface AutomationActionDescriptor {
  /** An `automation_action_type.code` with `action_class = 'automatic'`. */
  readonly code: string;
  readonly ownerModule: string;
  readonly parametersSchema: z.ZodType;
  /** The permission checked in the target's scope (`automation_action_type.required_permission_code`). */
  readonly requiredPermission: Permission | null;
  /** Read-only: what the action would do, and whether the identity may do it. Never writes. */
  plan(db: DbOrTx, ctx: AutomationPlanContext): Promise<AutomationPlannedAction>;
}

export interface AutomationActionRegistry {
  register(descriptor: AutomationActionDescriptor): void;
  get(code: string): AutomationActionDescriptor | undefined;
  codes(): string[];
}

const HUMAN_ONLY: ReadonlySet<string> = new Set(HUMAN_ONLY_ACTION_CODES);

/** A new, empty registry. Registering a code again replaces its descriptor (idempotent wiring). */
export function createAutomationActionRegistry(): AutomationActionRegistry {
  const byCode = new Map<string, AutomationActionDescriptor>();
  return {
    register(descriptor) {
      if (HUMAN_ONLY.has(descriptor.code))
        throw new Error(`automation registry: ${descriptor.code} is a human decision and is never automated (M0242)`);
      byCode.set(descriptor.code, descriptor);
    },
    get: (code) => byCode.get(code),
    codes: () => [...byCode.keys()].sort(),
  };
}

let current: AutomationActionRegistry = createAutomationActionRegistry();

/** Wiring line of the composition root (server.ts): the registry every automation route reads. */
export function setAutomationActionRegistry(registry: AutomationActionRegistry): void {
  current = registry;
}

/** The registry wired by server.ts (an empty one before wiring). */
export function automationActionRegistry(): AutomationActionRegistry {
  return current;
}
