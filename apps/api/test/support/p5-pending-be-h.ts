// P5 operations without a route yet, owned by backend-workflow-engineer task T-DG5-BE-H (slice D: automation rules and versions, the builder catalogue, enable/disable)
// (docs/architecture/p5-work-split.md §D/§E). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG5 candidate freezes. Only the owning task edits this file.
// T-DG5-BE-H routed all eleven (getAutomationCatalogue, listAutomationRules, createAutomationRule, getAutomationRule,
// updateAutomationRule, enableAutomationRule, disableAutomationRule, listAutomationRuleVersions,
// createAutomationRuleVersion, getAutomationRuleVersion, updateAutomationRuleVersion); each is exercised in
// test/integration/contract/p5-exercises-be-h.ts.
export const P5_PENDING_BE_H: readonly string[] = [];
