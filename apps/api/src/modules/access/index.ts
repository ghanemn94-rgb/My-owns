// access (ADR-0006): roles, permissions, scoped assignments, delegation (table only in P1) and THE policy function.
// Depends on platform and audit only; never on a business module.
export {
  authorize,
  businessUnitAncestry,
  denialOf,
  holdsAnywhere,
  loadGrants,
  organizationsWith,
  requireAction,
  requireRead,
  resolveTarget,
  scopeFilter,
  targetFor,
  type Principal,
  type TargetRef,
} from "./policy.ts";
export {
  appliesDownward,
  decide,
  grantApplies,
  isApprovalPermission,
  STRUCTURAL_PERMISSIONS,
  type Decision,
  type DecisionContext,
  type Grant,
  type ResolvedTarget,
  type TargetLevel,
} from "./rules.ts";
export {
  activeAssignmentsOf,
  createAssignment,
  getAssignment,
  listAssignments,
  listPermissions,
  listRoles,
  revokeAssignment,
  toRoleAssignment,
  type AssignmentListQuery,
} from "./assignments.ts";
export { auditContextOf, commitTimeDenial, principalOf, refreshPrincipal, type PrincipalResolver } from "./request.ts";
export { grantCreatorAdminRoles, grantCreatorTransformationRoles } from "./assignments.ts";
export { registerDeniedMutationAudit } from "./denials.ts";
export {
  actsOnBehalfOf,
  holds,
  isOwnRow,
  requireRecordWrite,
  requireTransformationRead,
  type Ownership,
  type WriteRule,
} from "./records.ts";
export { registerAccessP2Routes } from "./team.ts";
export { registerAccessP4Routes } from "./p4-routes.ts";
// P4 slice C (T-DG4-BE-B; ADR-0026 §1-§3, §8): group membership, party routing and delegation for the approval service.
export { currentGroupMemberIds, effectiveGroupIds } from "./groups.ts";
export {
  approversOf,
  partyLabel,
  resolveParty,
  routeToParty,
  routingRefusals,
  userHoldsApprovalDecide,
  type PartyTarget,
  type RoutedParty,
} from "./role-mappings.ts";
export { actsFor, delegatorsOf } from "./delegations.ts";
