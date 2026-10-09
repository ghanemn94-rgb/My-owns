// P4 operations without a route yet, owned by backend-workflow-engineer task BE-B (slice C: groups, role mappings, delegations, approvals)
// (docs/architecture/p4-work-split.md §I+C). Remove an entry in the same change that registers its route and exercises it
// in the contract test. Must be empty when the DG4 candidate freezes. Only this task edits this file.
// T-DG4-BE-B routed and exercised all 23 (groups and members, governance parties, role mappings and the resolve preview,
// delegations, approvals and the decision-record view; p4-exercises-be-b.ts), so the list is empty.
export const P4_PENDING_BE_B: readonly string[] = [];
