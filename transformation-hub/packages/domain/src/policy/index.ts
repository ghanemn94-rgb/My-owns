import type { PolicyMatrix } from './engine';
import matrixJson from './policy-matrix.json';

export * from './engine';

/**
 * Active role → permission matrix. Source of truth for the design is `docs/security/access-matrix.md`
 * (JSON block); `policy.test.ts` fails if this file drifts from that document.
 */
export const POLICY_MATRIX = matrixJson as unknown as PolicyMatrix;
export const POLICY_VERSION = POLICY_MATRIX.version;

export function isKnownPermission(p: string): boolean {
  return Object.prototype.hasOwnProperty.call(POLICY_MATRIX.permissions, p);
}

/**
 * access-matrix §2.2.1: read permissions whose WORKSTREAM-scoped grant also covers the project's project-level records of
 * that type (no workstream, not room-bound). Unknown permissions are never project-level reads (fail closed).
 */
export function isProjectLevelRead(p: string): boolean {
  return isKnownPermission(p) && POLICY_MATRIX.permissions[p]!.projectLevelRead === true;
}

/** The §2.2.1 exception list, derived from the matrix (the single source). */
export const PROJECT_LEVEL_READ_PERMISSIONS: readonly string[] = Object.keys(POLICY_MATRIX.permissions).filter(isProjectLevelRead).sort();
