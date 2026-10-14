// P5 operations without a route yet, owned by backend-workflow-engineer task T-DG5-BE-F (slice C: procedure definitions, the procedures kind provider)
// (docs/architecture/p5-work-split.md §B/§C). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG5 candidate freezes. Only the owning task edits this file.
// T-DG5-BE-F routed all five (listProcedureDefinitions, validateProcedureDefinition, getProcedureDefinition,
// putProcedureDefinition, removeProcedureDefinition); each is exercised in p5-exercises-be-f.ts.
export const P5_PENDING_BE_F: readonly string[] = [];
