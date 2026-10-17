// P5 operations without a route yet, owned by backend-workflow-engineer task T-DG5-BE-O (slice F: meeting presentation, evidence register and versions)
// (docs/architecture/p5-work-split.md §F). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG5 candidate freezes. Only the owning task edits this file.
// T-DG5-BE-O: getMeetingPresentation (governance/presentation.ts), listEvidenceRegister and listEvidenceVersions
// (evidence/register.ts) are routed and exercised in p5-exercises-be-o.ts.
export const P5_PENDING_BE_O: readonly string[] = [];

/**
 * Acceptance tests of BE-O that stay PENDING until another task merges (p5-work-split §F.7, the BE-J precedent): not
 * operations, so never part of the contract test's pending-operation sets. Each names what unblocks it.
 * T-DG5-BE-T5 (D-162 e; D-167): empty. The REQ-S10-013 test ("changing a linked decision before cut-off changes the live
 * presentation; the issued meeting-pack snapshot still returns the old decision") runs and passes in
 * apps/api/test/integration/governance/presentation.test.ts: the meeting_pack assembler (KBE-D2) and the
 * composition-root line setMeetingPackAssembler(...) are in place since D-159.
 */
export const P5_PENDING_TESTS_BE_O: readonly {
  readonly requirement: string;
  readonly test: string;
  readonly unblockedBy: string;
}[] = [];
