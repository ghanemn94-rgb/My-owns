// The fixed ids of BE-T's part of the International Roaming dataset (ADR-0050 §4; p5-work-split §J.2; T-DG5-BE-T).
//
// Every seeded id is a fixed literal UUID in the namespace `01995000-…`:
//   - the anchors KBE-H's numbers hang on keep the ids of DEMO_ANCHORS (second group 0000; kpis.ts);
//   - every other BE-T record is `01995000-1<block, 3 hex digits>-7000-8000-<n, 12 hex digits>`. The second group
//     starts with 1 and is used by no other module (KBE-H's start with 4), so the ids never collide.
// SYNTHETIC: an illustrative example, not Mobily actual performance (M0339).

export function rtId(block: number, n: number): string {
  if (!Number.isInteger(block) || block < 0x001 || block > 0xfff) throw new Error(`rtId: invalid block ${block}`);
  if (!Number.isInteger(n) || n < 1 || n > 0xffff) throw new Error(`rtId: invalid number ${n}`);
  return `01995000-1${block.toString(16).padStart(3, "0")}-7000-8000-${n.toString(16).padStart(12, "0")}`;
}

/** Blocks of rtId, one per table (a table's rows are numbered from 1 in seed order). */
export const RT_BLOCK = {
  appUser: 0x001,
  userIdentity: 0x002,
  scopedAssignment: 0x003,
  /** D-165: the dev-issuer identities of a dev-mode demo stack only. */
  devUserIdentity: 0x004,
  configPin: 0x010,
  diagnosticItem: 0x011,
  tomCanvasCell: 0x012,
  gateInstance: 0x013,
  roadmapWave: 0x014,
  scoringWeightSet: 0x015,
  scoringWeight: 0x016,
  governanceMatrix: 0x017,
  decisionRight: 0x018,
  raciDeliverable: 0x019,
  raciAssignment: 0x01a,
  forum: 0x01b,
  northStar: 0x020,
  charter: 0x021,
  charterVersion: 0x022,
  outcome: 0x023,
  diagnosticFinding: 0x030,
  tomGap: 0x031,
  traceLink: 0x032,
  initiativeGapLink: 0x033,
  outcomeKpi: 0x034,
  contribution: 0x035,
  decision: 0x040,
  decisionOption: 0x041,
  dependency: 0x042,
  raidEntry: 0x043,
  stakeholderGroup: 0x044,
  adoptionIntervention: 0x045,
  initiativeScore: 0x046,
  evidence: 0x050,
  phaseStep: 0x051,
  gateSubmission: 0x052,
  approval: 0x053,
  bauHandover: 0x054,
  healthAssessment: 0x055,
  launchPlan: 0x056,
  /** T-DG5-BE-T5 (D-167, QA-E2 O-1): the seeded pending approval's role mapping, task and inbox notification. */
  roleMapping: 0x057,
  workItem: 0x058,
  inboxNotification: 0x059,
  /** T-DG5-BE-V3 (F-DG5-120, D-170): the G1-G4 gate history and the evidence its criteria read (roaming-gates.ts). */
  baseline: 0x060,
  valuePool: 0x061,
  guardrail: 0x062,
  capability: 0x063,
  journey: 0x064,
  evidenceLink: 0x065,
  gateSubmissionCriterion: 0x066,
  gateDecision: 0x067,
  gateDecisionAgreement: 0x068,
  /** Unused since T-DG5-BE-X2 (D-172: the demo G4 has no exception); kept so no block number is reused. */
  gateException: 0x069,
  /**
   * T-DG5-BE-X2 (F-DG5-120, F-DG5-122, D-172): the approved portfolio behind G4 (roaming-portfolio.ts). The canonical
   * decisions of the funding decisions use the `decision` block (numbers 7-9, after GD-01..GD-04).
   */
  scoreResult: 0x070,
  rankingSnapshot: 0x071,
  rankingEntry: 0x072,
  portfolioSelection: 0x073,
  fundingDecision: 0x074,
  milestone: 0x075,
  resourceRole: 0x076,
  capacity: 0x077,
  resourceDemand: 0x078,
} as const;
