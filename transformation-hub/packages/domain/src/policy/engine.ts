import type { Classification, RoleKey, ScopeType } from '../enums';
import { CLASSIFICATIONS } from '../enums';

export type AbacCondition = 'classification' | 'room' | 'clean_team' | 'not_self' | 'authority' | 'own_workstream';

export interface PolicyMatrix {
  version: string;
  permissions: Record<string, { description: string; conditions: AbacCondition[] }>;
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
  /** The user who requested/created the subject when separation of duties applies. */
  subjectRequesterId?: string | null;
  /** Workstream of the resource when permission is scoped to own workstream. */
  workstreamId?: string | null;
  userWorkstreamIds?: Set<string>;
  /** Result of an authority check computed by the caller (e.g. amount within delegation). */
  withinAuthority?: boolean;
}

export interface AbacResult {
  allowed: boolean;
  failed: AbacCondition[];
}

/**
 * Evaluate ABAC conditions for a permission. Conditions that cannot be evaluated because the attribute was not
 * supplied FAIL CLOSED (deny by default) — except `own_workstream`, which only applies when the grant came from a
 * workstream-scoped role (callers pass `userWorkstreamIds` in that case).
 */
export function evaluateConditions(conditions: AbacCondition[], a: AbacAttributes): AbacResult {
  const failed: AbacCondition[] = [];
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
        if (a.subjectRequesterId && a.actorUserId && a.subjectRequesterId === a.actorUserId) failed.push(c);
        break;
      case 'authority':
        if (a.withinAuthority === false) failed.push(c);
        break;
      case 'own_workstream':
        if (a.userWorkstreamIds && a.workstreamId && !a.userWorkstreamIds.has(a.workstreamId)) failed.push(c);
        break;
    }
  }
  return { allowed: failed.length === 0, failed };
}
