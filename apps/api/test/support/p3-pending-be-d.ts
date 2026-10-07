// P3 operations without a route yet, owned by backend-workflow-engineer task BE-D (prioritization) (docs/architecture/p3-work-split.md).
// Remove an entry in the same change that registers its route and exercises it in the contract test. Must be empty
// when the DG3 candidate freezes. Only this task edits this file.
export const P3_PENDING_BE_D: readonly string[] = [
  "getPrioritization",
  "listWeightSets",
  "createWeightSet",
  "getWeightSet",
  "approveWeightSet",
  "withdrawWeightSet",
  "getInitiativeScores",
  "createInitiativeScore",
  "updateInitiativeScore",
  "listRankingSnapshots",
  "createRankingSnapshot",
  "getRankingSnapshot",
  "getRankingHistory",
  "listRankingOverrides",
  "createRankingOverride",
  "decideRankingOverride",
  "revokeRankingOverride",
];
