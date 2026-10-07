// P3 operations without a route yet, owned by backend-workflow-engineer task BE-E (capacity, funding, G4) (docs/architecture/p3-work-split.md).
// Remove an entry in the same change that registers its route and exercises it in the contract test. Must be empty
// when the DG3 candidate freezes. Only this task edits this file.
export const P3_PENDING_BE_E: readonly string[] = [
  "listResourceRoles",
  "createResourceRole",
  "updateResourceRole",
  "listCapacity",
  "createCapacity",
  "getCapacity",
  "updateCapacity",
  "getCapacityPlan",
  "listResourceDemands",
  "createResourceDemand",
  "getResourceDemand",
  "updateResourceDemand",
  "commitResourceDemand",
  "releaseResourceDemand",
  "listFundingDecisions",
  "createFundingDecision",
  "getFundingDecision",
];
