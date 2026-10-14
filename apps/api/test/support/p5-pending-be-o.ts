// P5 operations without a route yet, owned by backend-workflow-engineer task T-DG5-BE-O (slice F: meeting presentation, evidence register and versions)
// (docs/architecture/p5-work-split.md §F). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG5 candidate freezes. Only the owning task edits this file.
export const P5_PENDING_BE_O: readonly string[] = [
  "getMeetingPresentation",
  "listEvidenceRegister",
  "listEvidenceVersions",
];
