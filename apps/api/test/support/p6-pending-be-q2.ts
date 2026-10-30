// P6 operations without a route yet, owned by backend task T-DG6-BE-Q2 (slice H: draft recovery list, version comparison,
// help topics; ADR-0057 §6, §7, §9) (docs/architecture/p6-work-split.md §H/G). Remove an entry in the same change that
// registers its route and exercises it in the contract test. Must be empty when the DG6 candidate freezes. Only the owning
// task edits this file.
// T-DG6-BE-Q2 routed and exercised all four (listMyFormDrafts, compareFormRecordVersions, listHelpTopics, getHelpTopic;
// test/integration/contract/p6-exercises-be-q.ts, its BE-Q2 block).
export const P6_PENDING_BE_Q2: readonly string[] = [];
