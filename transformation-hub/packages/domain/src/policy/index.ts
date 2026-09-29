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
