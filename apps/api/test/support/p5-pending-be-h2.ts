// P5 operations without a route yet, owned by backend-workflow-engineer task T-DG5-BE-H2 (slice D: dry run, review where configured, publish, discard; the engine's evaluation handler)
// (docs/architecture/p5-work-split.md §D/§E). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG5 candidate freezes. Only the owning task edits this file.
// T-DG5-BE-H2 routed all six (listAutomationDryRuns, runAutomationDryRun, submitAutomationRuleVersion,
// decideAutomationRuleReview, publishAutomationRuleVersion, discardAutomationRuleVersion); exercised in
// test/integration/contract/p5-exercises-be-h2.ts.
export const P5_PENDING_BE_H2: readonly string[] = [];
