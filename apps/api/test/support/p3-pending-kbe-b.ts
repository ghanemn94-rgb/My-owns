// P3 operations without a route yet, owned by kpi-benefits-engineer task KBE-B (business cases) (docs/architecture/p3-work-split.md).
// Remove an entry in the same change that registers its route and exercises it in the contract test. Must be empty
// when the DG3 candidate freezes. Only this task edits this file.
export const P3_PENDING_KBE_B: readonly string[] = [
  "listBusinessCases",
  "createBusinessCase",
  "getBusinessCase",
  "updateBusinessCase",
  "archiveBusinessCase",
  "getBusinessCaseTotals",
  "validateBusinessCaseBaseline",
  "listBusinessCaseLines",
  "createBusinessCaseLine",
  "updateBusinessCaseLine",
  "archiveBusinessCaseLine",
];
