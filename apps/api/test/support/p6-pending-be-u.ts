// P6 operations without a route yet, owned by backend task T-DG6-BE-U (slice D: suggestions to a draft prefill;
// ADR-0059 §6) (docs/architecture/p6-work-split.md §D). Remove an entry in the same change that registers its route and
// exercises it in the contract test. Must be empty when the DG6 candidate freezes. Only the owning task edits this file.
// T-DG6-BE-U routed takeAssistantSuggestionToDraft (assistant/suggestions.ts) and exercises it in p6-exercises-be-u.ts.
export const P6_PENDING_BE_U: readonly string[] = [];
