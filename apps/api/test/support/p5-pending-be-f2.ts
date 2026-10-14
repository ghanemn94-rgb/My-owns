// P5 operations without a route yet, owned by backend-workflow-engineer task T-DG5-BE-F2 (slice C: procedure instances and steps)
// (docs/architecture/p5-work-split.md §B/§C). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG5 candidate freezes. Only the owning task edits this file.
export const P5_PENDING_BE_F2: readonly string[] = [
  "listProcedureInstances",
  "launchProcedureInstance",
  "getProcedureInstance",
  "updateProcedureInstanceInputs",
  "completeProcedureStep",
  "skipProcedureStep",
  "assignProcedureStep",
  "linkProcedureStepEvidence",
  "cancelProcedureInstance",
  "listMyProcedureSteps",
];
