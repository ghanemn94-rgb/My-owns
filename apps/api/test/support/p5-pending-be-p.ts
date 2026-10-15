// P5 operations without a route yet, owned by backend-workflow-engineer task T-DG5-BE-P (slice H: launch plan, tasks and predecessors)
// (docs/architecture/p5-work-split.md §G/§H). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG5 candidate freezes. Only the owning task edits this file.
// T-DG5-BE-P: all nine are routed (launch/template.ts, plan.ts, tasks.ts, predecessors.ts) and exercised in
// p5-exercises-be-p.ts.
export const P5_PENDING_BE_P: readonly string[] = [];
