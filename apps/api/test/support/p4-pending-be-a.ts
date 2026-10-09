// P4 operations without a route yet, owned by backend-workflow-engineer task BE-A (slice I: calendars and holidays, job schedules, My Work items and the inbox)
// (docs/architecture/p4-work-split.md §I+C). Remove an entry in the same change that registers its route and exercises it
// in the contract test. Must be empty when the DG4 candidate freezes. Only this task edits this file.
// T-DG4-BE-A routed and exercised all 15 (calendars and holidays, working days, job schedules, My Work items, the inbox;
// p4-exercises-be-a.ts), so the list is empty.
export const P4_PENDING_BE_A: readonly string[] = [];
