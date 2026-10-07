// P3 operations without a route yet, owned by backend-workflow-engineer task BE-B (initiatives, links, lifecycle, selection) (docs/architecture/p3-work-split.md).
// Remove an entry in the same change that registers its route and exercises it in the contract test. Must be empty
// when the DG3 candidate freezes. Only this task edits this file.
export const P3_PENDING_BE_B: readonly string[] = [
  "listInitiatives",
  "createInitiative",
  "getInitiative",
  "updateInitiative",
  "submitInitiative",
  "withdrawInitiative",
  "selectInitiative",
  "deselectInitiative",
  "launchInitiative",
  "cancelInitiative",
  "listPortfolioSelections",
  "listInitiativeGapLinks",
  "createInitiativeGapLink",
  "removeInitiativeGapLink",
  "listInitiativeOutcomeContributions",
  "createInitiativeOutcomeContribution",
  "removeInitiativeOutcomeContribution",
  "listInitiativeDecisionLinks",
  "createInitiativeDecisionLink",
  "removeInitiativeDecisionLink",
];
