// P4 operations without a route yet, owned by backend-workflow-engineer task BE-G (slice D: the T16 Executive Decision Log, decision-SLA escalation, blocker RAG by cycle and escalation rules)
// (docs/architecture/p4-work-split.md §D). Remove an entry in the same change that registers its route and exercises it
// in the contract test. Must be empty when the DG4 candidate freezes. Only the owning task edits this file.
// T-DG4-BE-G routed all 11 (executive-decisions.ts, escalations.ts) and exercises them in p4-exercises-be-g.ts.
export const P4_PENDING_BE_G: readonly string[] = [];
