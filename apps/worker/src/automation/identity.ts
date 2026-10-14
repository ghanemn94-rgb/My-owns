// Identity and per-action authorization of an automation action, the worker twin (ADR-0043 §3; REQ-S12-003;
// p5-work-split §D.3; T-DG5-BE-I). The twin of apps/api/src/modules/automation/identity.ts (ADR-0002 rule 5: the
// worker imports no API code); apps/api/test/integration/automation/automation-failures.test.ts requires both to give
// the same decision on every combination (parity).
//
// Each execution acts as exactly ONE identity:
//  - `initiating_user`: the user the trigger names; that user must hold the action's permission on the TARGET (the
//    caller reloads the grants inside the action's transaction and passes the answer, `initiatingUserHolds`);
//  - `service`: a constrained service identity holding exactly the version's `service_permission_codes` (never an
//    approval right: 0074 AV04), and only inside the rule's scope.
// A target outside the rule's scope, or a missing permission, is `forbidden` with `automation.action_forbidden`: it is
// never retried and goes to the failure queue at once (engine.ts finishExecution -> kit.ts recordExecutionOutcome).
export const ACTION_FORBIDDEN_CODE = "automation.action_forbidden";

export type ForbiddenReason = "outside_rule_scope" | "identity_lacks_permission" | "service_permission_missing";

export interface RuleScope {
  readonly level: "platform" | "organization" | "transformation";
  readonly organizationId: string | null;
  readonly transformationId: string | null;
}

export interface ActionTarget {
  readonly organizationId: string;
  readonly transformationId: string;
}

export type ActingIdentity =
  | { readonly runAs: "service"; readonly permissions: readonly string[] }
  | { readonly runAs: "initiating_user"; readonly userId: string };

export interface AuthorizationInput {
  readonly scope: RuleScope;
  readonly target: ActionTarget;
  readonly identity: ActingIdentity;
  /** The action type's `required_permission_code` (null: the target's readership is the check). */
  readonly requiredPermission: string | null;
  /** initiating_user only: does the user hold the permission on the target (grants reloaded by the caller)? */
  readonly initiatingUserHolds: boolean | null;
}

export type AuthorizationDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: ForbiddenReason; readonly errorCode: typeof ACTION_FORBIDDEN_CODE };

/** Is the target inside the rule's scope? A platform rule (a starter) covers every organization. */
export function targetInScope(scope: RuleScope, target: ActionTarget): boolean {
  if (scope.level === "platform") return true;
  if (scope.level === "organization") return scope.organizationId === target.organizationId;
  return scope.organizationId === target.organizationId && scope.transformationId === target.transformationId;
}

const forbidden = (reason: ForbiddenReason): AuthorizationDecision => ({
  allowed: false,
  reason,
  errorCode: ACTION_FORBIDDEN_CODE,
});

/** The decision for one action: scope first, then the acting identity's permission. Pure. */
export function decideActionAuthorization(input: AuthorizationInput): AuthorizationDecision {
  if (!targetInScope(input.scope, input.target)) return forbidden("outside_rule_scope");
  if (input.identity.runAs === "service") {
    if (input.requiredPermission !== null && !input.identity.permissions.includes(input.requiredPermission))
      return forbidden("service_permission_missing");
    return { allowed: true };
  }
  return input.initiatingUserHolds === true ? { allowed: true } : forbidden("identity_lacks_permission");
}
