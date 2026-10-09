// P4 operations without a route yet, owned by backend-workflow-engineer task BE-D2 (slice E: corrective-action cases, signals, rules and the four event consumers; owned by BE-D when the
// orchestrator does not schedule the BE-D2 split)
// (docs/architecture/p4-work-split.md §E). Remove an entry in the same change that registers its route and exercises it
// in the contract test. Must be empty when the DG4 candidate freezes. Only the owning task edits this file.
export const P4_PENDING_BE_D2: readonly string[] = [];
