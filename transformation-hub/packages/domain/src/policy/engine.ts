import type { Classification, RoleKey, ScopeType } from '../enums';
import { CLASSIFICATIONS } from '../enums';

export type AbacCondition = 'classification' | 'room' | 'clean_team' | 'not_self' | 'authority' | 'own_workstream';

export interface PolicyPermission {
  description: string;
  conditions: AbacCondition[];
  /**
   * access-matrix §2.2.1 (present only when true): a WORKSTREAM-scoped grant of this read permission also covers the
   * project's records of that type that belong to no workstream and no room. Every other workstream-scoped grant covers
   * only records of its own workstreams (§2.2). Pending confirmation by Mobily data governance.
   */
  projectLevelRead?: true;
}

export interface PolicyMatrix {
  version: string;
  permissions: Record<string, PolicyPermission>;
  roles: Record<RoleKey, { scopeTypes: ScopeType[]; permissions: string[]; defaultClearance: Classification }>;
}

export function classificationRank(c: Classification): number {
  return CLASSIFICATIONS.indexOf(c);
}

/** Clearance must be ≥ the resource classification. */
export function clearanceAllows(clearance: Classification, classification: Classification): boolean {
  return classificationRank(clearance) >= classificationRank(classification);
}

export function permissionsOf(matrix: PolicyMatrix, roles: Iterable<RoleKey>): Set<string> {
  const out = new Set<string>();
  for (const r of roles) for (const p of matrix.roles[r]?.permissions ?? []) out.add(p);
  return out;
}

export interface AbacAttributes {
  clearance: Classification;
  classification?: Classification | null;
  /** Room the resource belongs to (null = not room-restricted). */
  roomId?: string | null;
  userRoomIds?: Set<string>;
  roomIsCleanTeam?: boolean;
  userCleanTeamRoomIds?: Set<string>;
  actorUserId?: string | null;
  /**
   * The user who requested / created / recorded / submitted the subject when separation of duties applies (`not_self`).
   * REQUIRED for a `not_self` permission: missing (undefined or null) fails CLOSED (I-R3) — a record whose requester is
   * unknown cannot be approved by anyone, because nobody can be shown to be someone else.
   */
  subjectRequesterId?: string | null;
  /** Workstream of the resource when permission is scoped to own workstream. */
  workstreamId?: string | null;
  userWorkstreamIds?: Set<string>;
  /**
   * `own_workstream` as defined in docs/security/access-matrix.md §2.4, computed by the caller: the actor owns/is assigned/
   * created the resource, OR holds a workstream-scoped grant on its workstream, OR is the project manager. A project-scope
   * grant of any other role does NOT satisfy it. When supplied it is authoritative.
   */
  ownWorkstreamSatisfied?: boolean;
  /**
   * Result of an authority check computed by the caller (e.g. amount within delegation, designated approver role).
   * REQUIRED for an `authority` permission: `undefined` fails CLOSED (I-R3); a caller whose authority is the role grant
   * itself must say so explicitly (`withinAuthority: true`, with the reason at the call site).
   */
  withinAuthority?: boolean;
}

/**
 * Explicit "there is no human requester" marker for `not_self` (I-R3). Callers pass it ONLY when the data PROVES that
 * nobody else's submission is being approved:
 *  - the subject was raised by the system itself (an escalation flagged `is_system_generated` with no raiser);
 *  - a gate criterion is reviewed with no evidence linked at all (the not_self subject is the evidence owner; with no
 *    evidence there is none — the evidence rules still apply).
 * A missing requester id (undefined / null) is never read as this marker: it fails closed.
 */
export const NO_HUMAN_REQUESTER = 'none:no-human-requester';

export interface AbacResult {
  allowed: boolean;
  failed: AbacCondition[];
  /** Conditions that failed because the caller did not supply the attribute they need (fail-closed, I-R3). */
  missing: AbacCondition[];
}

/**
 * Evaluate ABAC conditions for a permission. Conditions that cannot be evaluated because the attribute was not
 * supplied FAIL CLOSED (deny by default) and are reported in `missing`: `not_self` without the actor or the subject's
 * requester, `authority` without an explicit authority result (I-R3), `own_workstream` when ownership cannot be established.
 * `classification`, `room` and `clean_team` restrict only when the resource HAS a classification / room (an unclassified,
 * room-less resource is not restricted by them).
 */
export function evaluateConditions(conditions: AbacCondition[], a: AbacAttributes): AbacResult {
  const failed: AbacCondition[] = [];
  const missing: AbacCondition[] = [];
  for (const c of conditions) {
    switch (c) {
      case 'classification':
        if (a.classification && !clearanceAllows(a.clearance, a.classification)) failed.push(c);
        break;
      case 'room':
        if (a.roomId && !(a.userRoomIds?.has(a.roomId) ?? false)) failed.push(c);
        break;
      case 'clean_team':
        if (a.roomIsCleanTeam && a.roomId && !(a.userCleanTeamRoomIds?.has(a.roomId) ?? false)) failed.push(c);
        break;
      case 'not_self':
        if (!a.subjectRequesterId || !a.actorUserId) {
          failed.push(c);
          missing.push(c); // fail closed: separation of duties cannot be established
        } else if (a.subjectRequesterId === a.actorUserId) failed.push(c);
        break;
      case 'authority':
        if (a.withinAuthority === undefined) {
          failed.push(c);
          missing.push(c); // fail closed: the caller did not evaluate authority
        } else if (a.withinAuthority !== true) failed.push(c);
        break;
      case 'own_workstream':
        if (a.ownWorkstreamSatisfied !== undefined) {
          if (!a.ownWorkstreamSatisfied) failed.push(c);
        } else if (!(a.userWorkstreamIds && a.workstreamId && a.userWorkstreamIds.has(a.workstreamId))) {
          failed.push(c); // fail closed when the caller cannot establish ownership
        }
        break;
    }
  }
  return { allowed: failed.length === 0, failed, missing };
}
