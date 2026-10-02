// Record-level authorization rules on top of the role permission (ADR-0020 §3). Every P2 mutation calls these through
// the access module's public interface; each one still decides through THE policy function (`authorize`), so the
// fail-closed guard counts the decision and a denial is audited (denials.ts).
//
//   *.contribute          create, and edit only rows the caller created or owns (created_by / owner_user_id)
//   action.update_own     only actions the caller owns
//   decision.decide       only the named decision owner (or a delegate acting on their behalf; workflows module)
//   evidence.review       never on evidence the caller created
//   gate.decide           only the configured approver, never the submitter (workflows module)
//   team.assign           only at the caller's transformation, and only roles WL, KDS, TD, CM, SEC
import type { DbOrTx } from "@mth/db";
import type { Permission } from "@mth/shared";
import { problems } from "../platform/index.ts";
import { authorize, denialOf, requireRead, type Principal } from "./policy.ts";
import type { ResolvedTarget } from "./rules.ts";

/** One way to be allowed to write: a permission, optionally limited to rows the caller created or owns. */
export interface WriteRule {
  readonly permission: Permission;
  /** `own`: only rows created or owned by the caller (`*.contribute`, `action.update_own`). */
  readonly scope?: "any" | "own";
}

/** Who a row belongs to, for `own` rules. On create, pass the owner the new row will have (or nothing). */
export interface Ownership {
  readonly createdBy?: string | null;
  readonly ownerUserId?: string | null;
}

/** True when the principal created or owns the row. */
export function isOwnRow(principal: Principal, row: Ownership): boolean {
  const me = principal.userId;
  if (me === null) return false;
  return row.createdBy === me || row.ownerUserId === me;
}

/**
 * The write gate for a record inside a transformation. Tries each rule in order through the policy function; an
 * `own` rule allows only when `ownership` names the caller (on create, `{ createdBy: caller }` is implied unless the
 * caller passes `strictOwner`, e.g. action.update_own requires the new action's owner to be the caller).
 * Denied -> 403 with the denial attached for the failed-mutation audit. Returns the rule that allowed it.
 */
export async function requireRecordWrite(
  db: DbOrTx,
  principal: Principal,
  target: ResolvedTarget,
  rules: readonly WriteRule[],
  ownership: Ownership,
): Promise<WriteRule> {
  if (rules.length === 0) throw new Error("requireRecordWrite: no rule");
  for (const rule of rules) {
    const d = await authorize(db, principal, rule.permission, target);
    if (!d.allowed) continue;
    if ((rule.scope ?? "any") === "any" || isOwnRow(principal, ownership)) return rule;
  }
  throw problems.forbidden().withDenial(denialOf(rules[0]!.permission, target));
}

/**
 * Read gate of a transformation-scoped record: the caller must be able to read the transformation (404 otherwise, so
 * existence is never disclosed). Returns the resolved transformation target.
 */
export function requireTransformationRead(
  db: DbOrTx,
  principal: Principal,
  transformationId: string,
): Promise<ResolvedTarget> {
  return requireRead(db, principal, "transformation.read", { type: "transformation", id: transformationId });
}

/** True when the principal holds `permission` on the target (one policy decision; nothing is thrown). */
export async function holds(
  db: DbOrTx,
  principal: Principal,
  permission: Permission,
  target: ResolvedTarget,
  requesterId?: string,
): Promise<boolean> {
  const d = await authorize(db, principal, permission, target, requesterId === undefined ? {} : { requesterId });
  return d.allowed;
}

/**
 * Acting on someone's behalf (P1 delegation table; ADR-0015 §2, ADR-0020 §3): true when `delegatorUserId` has an
 * ACTIVE, currently effective delegation to the caller that covers the record type and the target's scope. One hop
 * only - a delegate never re-delegates, so delegation cannot form a loop - and nobody delegates to themselves (CHECK).
 */
export async function actsOnBehalfOf(
  db: DbOrTx,
  principal: Principal,
  delegatorUserId: string,
  recordType: string,
  target: ResolvedTarget,
): Promise<boolean> {
  principal.tracker.decisions += 1;
  if (principal.userId === null || principal.userId === delegatorUserId) return false;
  const scopes: { type: string; id: string }[] = [
    { type: "organization", id: target.organizationId },
    ...target.businessUnitAncestry.map((id) => ({ type: "business_unit", id })),
    ...(target.transformationId ? [{ type: "transformation", id: target.transformationId }] : []),
  ];
  const rows = await db
    .selectFrom("delegation")
    .select(["scope_type", "scope_id", "record_types"])
    .where("delegator_user_id", "=", delegatorUserId)
    .where("delegate_user_id", "=", principal.userId)
    .where("organization_id", "=", target.organizationId)
    .where("status", "=", "active")
    .where("effective_from", "<=", new Date())
    .where("effective_to", ">", new Date())
    .execute();
  return rows.some(
    (d) =>
      (d.record_types === null || d.record_types.includes(recordType)) &&
      (d.scope_type === null || scopes.some((s) => s.type === d.scope_type && s.id === d.scope_id)),
  );
}
