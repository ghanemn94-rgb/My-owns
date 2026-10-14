// P5 operations without a route yet, owned by backend-workflow-engineer task T-DG5-BE-S (slice J: environment, demo CLI, seed and reset)
// (docs/architecture/p5-work-split.md §I/§J). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG5 candidate freezes. Only the owning task edits this file.
export const P5_PENDING_BE_S: readonly string[] = ["getEnvironment", "getDemoEnvironmentStatus", "requestDemoReset"];
