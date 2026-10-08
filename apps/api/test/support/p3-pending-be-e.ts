// P3 operations without a route yet, owned by backend-workflow-engineer task BE-E (capacity, funding, G4) (docs/architecture/p3-work-split.md).
// Remove an entry in the same change that registers its route and exercises it in the contract test. Must be empty
// when the DG3 candidate freezes. Only this task edits this file.
// T-DG3-BE-E: all 17 operations are routed (portfolio/capacity.ts, resource-demands.ts, funding.ts) and exercised in
// test/integration/contract/p3-exercises-be-e.ts.
export const P3_PENDING_BE_E: readonly string[] = [];
