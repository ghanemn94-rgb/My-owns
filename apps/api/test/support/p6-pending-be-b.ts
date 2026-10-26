// P6 operations without a route yet, owned by backend-workflow-engineer task T-DG6-BE-B (slice E: ReadScope, sensitive records and grants; ADR-0051 §2)
// (docs/architecture/p6-work-split.md §E/F). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG6 candidate freezes. Only the owning task edits this file.
// T-DG6-BE-B routed all six (getRecordSensitivity, putRecordSensitivity, listSensitiveGrants, createSensitiveGrant,
// getSensitiveGrant, revokeSensitiveGrant; access/sensitivity.ts) and exercises them in p6-exercises-be-b.ts.
export const P6_PENDING_BE_B: readonly string[] = [];
