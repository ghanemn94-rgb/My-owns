// REQ-S10-003 (ADR-0026 §8; ADR-0020; D-094; T-DG4-BE-B2): "Never make technical administrators business approvers
// automatically". Acceptance A12: "an ADM-only user calling a gate or Finance approval endpoint gets 403".
//
// The read gate of a mutation answers 404 to a caller who cannot read the transformation (existence not disclosed).
// An ADM-only caller holds no transformation.read, so without this rule an approval endpoint answered 404, not the
// 403 of the acceptance. ONE narrow rule (D-094): a caller whose EVERY grant in the target organization is a
// technical-administrator role (ADM_TECH, ADM_ACCESS, ADM_METHOD) and who fails the read gate is refused with 403
// `forbidden` (the missing business-approval right), the same problem decideApproval uses. Every other caller's
// response is unchanged: a business user who cannot read, a non-member (no grant in the organization) and a caller
// with no grant at all keep the 404; a caller who can read never reaches this rule.
import { ROLES } from "@mth/shared";
import { HttpProblem, problems } from "../platform/index.ts";
import type { Principal } from "./policy.ts";

/** The technical-administrator roles of the catalogue (ADR-0020; never business approvers, REQ-S10-003). */
export const TECHNICAL_ADMIN_ROLES: ReadonlySet<string> = new Set(
  Object.entries(ROLES)
    .filter(([, r]) => r.kind === "technical_admin")
    .map(([code]) => code),
);

/**
 * True when the principal holds grants in the organization and every one of them is a technical-admin role. Counts as
 * a policy decision for the fail-closed response guard (the outcome depends on the caller's grants).
 */
export function isTechnicalAdminOnly(principal: Principal, organizationId: string): boolean {
  principal.tracker.decisions += 1;
  const inOrg = principal.grants.filter((g) => g.organizationId === organizationId);
  return inOrg.length > 0 && inOrg.every((g) => TECHNICAL_ADMIN_ROLES.has(g.roleCode));
}

/**
 * Maps a read-gate refusal of a gate or Finance approval endpoint to the REQ-S10-003 403. `err` is what the read gate
 * threw: the 404 of `requireTransformationRead` (or its commit-time 403, `commitTimeDenial`), which carries the denial
 * of `transformation.read` with the transformation's organization. When `principal` is technical-admin-only in that
 * organization, returns 403 `forbidden` (decideApproval's problem) with the denial re-stated for `permission`, so the
 * failed-mutation audit records `authorization.denied` for the approval right. Anything else is returned unchanged.
 */
export function technicalAdminRefusal(principal: Principal, err: unknown, permission: string): unknown {
  if (!(err instanceof HttpProblem) || (err.status !== 404 && err.status !== 403)) return err;
  const denial = err.denial;
  if (!denial || denial.permission !== "transformation.read" || denial.organizationId === null) return err;
  if (!isTechnicalAdminOnly(principal, denial.organizationId)) return err;
  return problems.forbidden().withDenial({ ...denial, permission });
}
