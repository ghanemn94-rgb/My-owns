// P5 operations without a route yet, owned by backend-workflow-engineer task T-DG5-BE-Q (slice I: playbook blocks and block links)
// (docs/architecture/p5-work-split.md §I/§J). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG5 candidate freezes. Only the owning task edits this file.
// T-DG5-BE-Q routed and exercised all four (listMethodologyBlocks, getMethodologyBlock, listMethodologyBlockLinks,
// listTemplateSourceLinks; p5-exercises-be-q.ts).
export const P5_PENDING_BE_Q: readonly string[] = [];
