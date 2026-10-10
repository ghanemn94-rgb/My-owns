// P4 operations without a route yet, owned by backend-workflow-engineer task BE-M2 (slice K: the Modular-entry missing-link report and the labelled inherited records)
// (docs/architecture/p4-work-split.md §J+K). Remove an entry in the same change that registers its route and exercises
// it in the contract test. Must be empty when the DG4 candidate freezes. Only the owning task edits this file.
// T-DG4-BE-M2: getMissingLinks, listInheritedRecords, createInheritedRecord and withdrawInheritedRecord are routed
// (reporting/modular.ts) and exercised in p4-exercises-be-m.ts (exerciseP4BeM2Operations).
export const P4_PENDING_BE_M2: readonly string[] = [];
