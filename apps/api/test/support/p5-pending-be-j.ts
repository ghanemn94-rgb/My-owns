// P5 operations without a route yet, owned by backend-workflow-engineer task T-DG5-BE-J (slice E: the sixteen starters as rules, new-transformation instantiation, dependency slips)
// (docs/architecture/p5-work-split.md §D/§E). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG5 candidate freezes. Only the owning task edits this file.
// T-DG5-BE-J: listDependencySlips is routed (portfolio/dependency-slips.ts) and exercised in p5-exercises-be-j.ts.
export const P5_PENDING_BE_J: readonly string[] = [];

/**
 * Acceptance tests of BE-J that stay PENDING until another task merges (p5-plan §5.2; p5-work-split §E.1): not
 * operations, so never part of the contract test's pending-operation sets. Each names the task that unblocks it.
 */
export const P5_PENDING_TESTS_BE_J: readonly {
  readonly requirement: string;
  readonly test: string;
  readonly unblockedBy: string;
}[] = [];
// T-DG5-BE-P: REQ-S12-004 "with the plan flag the 90-day tasks are dated from the start date (day d = start date + d
// calendar days)" passes in apps/worker/test/integration/starters.test.ts with the worker's generator
// (apps/worker/src/automation/ports/launch-plan-generator.ts, wired in worker.ts).
