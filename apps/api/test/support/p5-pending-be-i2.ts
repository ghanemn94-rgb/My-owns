// P5 operations without a route yet, owned by backend-workflow-engineer task T-DG5-BE-I2 (slice D: the jobs operations view, job runs, next run, run now)
// (docs/architecture/p5-work-split.md §D/§E). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG5 candidate freezes. Only the owning task edits this file.
// T-DG5-BE-I2 routed all 3 (listJobOperations, getJobOperation, runJobNow; p5-exercises-be-i2.ts).
export const P5_PENDING_BE_I2: readonly string[] = [];
