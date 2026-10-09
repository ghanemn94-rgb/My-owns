// P4 operations without a route yet, owned by backend-workflow-engineer task BE-B (slice C: groups, role mappings, delegations, approvals)
// (docs/architecture/p4-work-split.md §I+C). Remove an entry in the same change that registers its route and exercises it
// in the contract test. Must be empty when the DG4 candidate freezes. Only this task edits this file.
export const P4_PENDING_BE_B: readonly string[] = [
  "listGroups",
  "createGroup",
  "getGroup",
  "updateGroup",
  "listGroupMembers",
  "addGroupMember",
  "removeGroupMember",
  "listGovernanceParties",
  "listRoleMappings",
  "createRoleMapping",
  "endRoleMapping",
  "resolveGovernanceParty",
  "listDelegations",
  "createDelegation",
  "getDelegation",
  "revokeDelegation",
  "listMyApprovals",
  "requestApproval",
  "getApproval",
  "decideApproval",
  "resubmitApproval",
  "withdrawApproval",
  "listApprovalDecisionRecords",
];
