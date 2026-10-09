// P4 operations without a route yet, owned by backend-workflow-engineer task BE-D (slice E: the T15 RAID register on canonical records, RAID-linked actions, the action register)
// (docs/architecture/p4-work-split.md §E). Remove an entry in the same change that registers its route and exercises it
// in the contract test. Must be empty when the DG4 candidate freezes. Only the owning task edits this file.
// T-DG4-BE-D routed all 11 (listRaidEntries, createRaidEntry, getRaidEntry, updateRaidEntry, closeRaidEntry,
// listRaidEntryActions, createRaidEntryAction, getRaidDecisionLog, listActionRegister, getActionRegisterItem,
// updateActionRegisterItem); each is exercised in test/integration/contract/p4-exercises-be-d.ts.
export const P4_PENDING_BE_D: readonly string[] = [];
