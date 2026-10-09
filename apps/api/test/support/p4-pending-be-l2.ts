// P4 operations without a route yet, owned by backend-workflow-engineer task BE-L2 (slice H: the phase catalogue, phase workspace, guided phase steps, step evidence and the review queue)
// (docs/architecture/p4-work-split.md §H). Remove an entry in the same change that registers its route and exercises
// it in the contract test. Must be empty when the DG4 candidate freezes. Only the owning task edits this file.
export const P4_PENDING_BE_L2: readonly string[] = [
  "listPhases",
  "getPhaseWorkspace",
  "listPhaseSteps",
  "getPhaseStep",
  "updatePhaseStep",
  "requestPhaseStepReview",
  "reviewPhaseStep",
  "listPhaseStepEvidence",
  "linkPhaseStepEvidence",
  "removePhaseStepEvidence",
];
