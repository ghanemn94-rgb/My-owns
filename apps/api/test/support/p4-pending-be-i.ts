// P4 operations without a route yet, owned by backend-workflow-engineer task BE-I (slice G: performance areas, their links and cycles, BAU handovers and receiving-owner acceptance)
// (docs/architecture/p4-work-split.md §F+G). Remove an entry in the same change that registers its route and exercises
// it in the contract test. Must be empty when the DG4 candidate freezes. Only the owning task edits this file.
export const P4_PENDING_BE_I: readonly string[] = [
  "listPerformanceAreas",
  "createPerformanceArea",
  "getPerformanceArea",
  "updatePerformanceArea",
  "reopenPerformanceArea",
  "retirePerformanceArea",
  "listPerformanceAreaLinks",
  "createPerformanceAreaLink",
  "removePerformanceAreaLink",
  "listBauHandovers",
  "createBauHandover",
  "getBauHandover",
  "updateBauHandover",
  "addBauHandoverEvidence",
  "submitBauHandover",
  "acceptBauHandover",
  "returnBauHandover",
];
