import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_GRANT_MAX_DAYS,
  FINDING_MACHINE,
  FUNDS_FLOW_MACHINE,
  NEGOTIATION_ISSUE_MACHINE,
  POST_CLOSE_MACHINE,
  assertAssessmentEntry,
  assertChecklistItemAcceptable,
  assertChecklistNotRequiredDecision,
  assertChecklistNotRequiredRequest,
  assertCpVerifiable,
  assertCpWaivabilityDetermination,
  assertCriteriaWeights,
  assertDdReleaseAllowed,
  assertDdReviewAllowed,
  assertDisclosureReleasable,
  assertDisclosureRequestable,
  assertEventConfirmable,
  assertFindingRemediation,
  assertNegotiationAgreementAllowed,
  assertNegotiationIssueLinks,
  assertObligationVerifiable,
  assertOwnershipScenario,
  assertPartnerApprovalSeparation,
  assertPartnerStageGuards,
  assertProgramClosureAllowed,
  assertRoomGrantAllowed,
  assessObligationOverdue,
  blankOwnership,
  eventBlockers,
  externalDdStatus,
  nextPartnerStages,
  partnerAdvanceCommand,
  roomTypeOf,
  separationGatesBlocking,
  weightedScore,
  type EventReadinessInput,
  type RoomGrantInput,
} from './jv';
import { CLOSING_MACHINE, CONDITION_MACHINE, DD_RELEASE_MACHINE, PARTNER_MACHINE, transition } from './workflows';
import { DomainError } from './errors';

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return 'no error';
};

describe('REQ-JV-003 / REQ-JV-004 — partner engagement stage machine', () => {
  it('follows the ordered stages and rejects every skipped or reversed stage', () => {
    expect(partnerAdvanceCommand('materials_access', 'dd')).toBe('start_dd');
    expect(partnerAdvanceCommand('dd', 'proposal')).toBe('record_proposal');
    expect(partnerAdvanceCommand('negotiation', 'signing')).toBe('move_to_signing');
    expect(code(() => partnerAdvanceCommand('identified', 'nda'))).toBe('jv.partner.stage_skipped');
    expect(code(() => partnerAdvanceCommand('identified', 'materials_access'))).toBe('jv.partner.stage_skipped');
    expect(code(() => partnerAdvanceCommand('materials_access', 'proposal'))).toBe('jv.partner.stage_skipped'); // DD is not skipped
    expect(code(() => partnerAdvanceCommand('dd', 'materials_access'))).toBe('jv.partner.stage_skipped'); // no reversal
    expect(code(() => partnerAdvanceCommand('withdrawn', 'identified'))).toBe('jv.partner.stage_skipped');
    expect(partnerAdvanceCommand('nda', 'withdrawn')).toBe('withdraw');
    expect(() => transition('partner', PARTNER_MACHINE, 'materials_access', 'record_proposal')).toThrow(/invalid|Cannot/);
    expect(nextPartnerStages('identified')).toEqual(['approved_for_contact']);
  });

  it('advancing to NDA without outreach approval is rejected; approval stages need their own command', () => {
    expect(code(() => assertPartnerStageGuards({ to: 'nda', outreachApproved: false, ndaExecuted: false, signingConfirmed: false }))).toBe('jv.partner.outreach_approval_required');
    expect(code(() => assertPartnerStageGuards({ to: 'nda', outreachApproved: false, ndaExecuted: true, signingConfirmed: false, viaApprovalCommand: true }))).toBe('jv.partner.outreach_approval_required');
    expect(code(() => assertPartnerStageGuards({ to: 'approved_for_contact', outreachApproved: false, ndaExecuted: false, signingConfirmed: false }))).toBe('jv.partner.use_approval_command');
    expect(code(() => assertPartnerStageGuards({ to: 'nda', outreachApproved: true, ndaExecuted: false, signingConfirmed: false }))).toBe('jv.partner.use_approval_command');
    expect(code(() => assertPartnerStageGuards({ to: 'nda', outreachApproved: true, ndaExecuted: true, signingConfirmed: false, viaApprovalCommand: true }))).toBe('no error');
    expect(code(() => assertPartnerStageGuards({ to: 'materials_access', outreachApproved: true, ndaExecuted: false, signingConfirmed: false }))).toBe('jv.partner.nda_required');
    expect(code(() => assertPartnerStageGuards({ to: 'closing', outreachApproved: true, ndaExecuted: true, signingConfirmed: false }))).toBe('jv.partner.signing_not_confirmed');
  });

  it('outreach / NDA approvals: never by the requester, never by a person with an open conflict', () => {
    expect(code(() => assertPartnerApprovalSeparation({ approverUserId: 'u1', requesterUserId: 'u1', conflictedUserIds: [], what: 'Outreach' }))).toBe('jv.partner.self_approval');
    expect(code(() => assertPartnerApprovalSeparation({ approverUserId: 'u2', requesterUserId: 'u1', conflictedUserIds: ['u2'], what: 'Outreach' }))).toBe('jv.partner.conflicted_approver');
    expect(code(() => assertPartnerApprovalSeparation({ approverUserId: 'u2', requesterUserId: 'u1', conflictedUserIds: ['u3'], what: 'Outreach' }))).toBe('no error');
  });
});

describe('REQ-JV-002 / REQ-JV-006 — criteria weights and fact/judgement assessments', () => {
  const crit = [
    { key: 'capability', name: 'Operating capability', weight: '40' },
    { key: 'funding', name: 'Funding capacity', weight: '35.5' },
    { key: 'fit', name: 'Strategic fit', weight: '24.5' },
  ];
  it('weights must be positive and sum to exactly 100', () => {
    expect(assertCriteriaWeights(crit)).toEqual({ total: '100.00' });
    expect(code(() => assertCriteriaWeights([{ key: 'a', name: 'A', weight: '60' }, { key: 'b', name: 'B', weight: '30' }]))).toBe('jv.criteria.weights_sum');
    expect(code(() => assertCriteriaWeights([{ key: 'a', name: 'A', weight: '100.01' }]))).toBe('jv.criteria.weight_out_of_range');
    expect(code(() => assertCriteriaWeights([{ key: 'a', name: 'A', weight: '0' }, { key: 'b', name: 'B', weight: '100' }]))).toBe('jv.criteria.weight_out_of_range');
    expect(code(() => assertCriteriaWeights([{ key: 'a', name: 'A', weight: '50' }, { key: 'a', name: 'A2', weight: '50' }]))).toBe('jv.criteria.duplicate_key');
    expect(code(() => assertCriteriaWeights([]))).toBe('jv.criteria.empty');
  });
  it('the weighted score is exact decimal arithmetic and stays null while a criterion is unscored', () => {
    expect(weightedScore(crit, { capability: '4', funding: '3', fit: '5' })).toEqual({ score: '3.89', missing: [] }) // (40×4 + 35.5×3 + 24.5×5) / 100;
    expect(weightedScore(crit, { capability: '4', fit: '5' })).toEqual({ score: null, missing: ['funding'] });
  });
  it('every entry is tagged fact or judgement; a fact cites its source; scores stay on the 0–5 scale', () => {
    const keys = crit.map((c) => c.key);
    expect(code(() => assertAssessmentEntry({ basis: null, statement: 'x', knownCriterionKeys: keys }))).toBe('jv.assessment.basis_required');
    expect(code(() => assertAssessmentEntry({ basis: 'opinion', statement: 'x', knownCriterionKeys: keys }))).toBe('jv.assessment.basis_required');
    expect(code(() => assertAssessmentEntry({ basis: 'fact', statement: 'x', knownCriterionKeys: keys }))).toBe('jv.assessment.fact_source_required');
    expect(assertAssessmentEntry({ basis: 'fact', statement: 'x', sourceReference: 'Proposal §2', knownCriterionKeys: keys })).toBe('fact');
    expect(assertAssessmentEntry({ basis: 'judgement', statement: 'x', criterionKey: 'fit', score: '4.5', knownCriterionKeys: keys })).toBe('judgement');
    expect(code(() => assertAssessmentEntry({ basis: 'judgement', statement: 'x', score: '4', knownCriterionKeys: keys }))).toBe('jv.assessment.score_needs_criterion');
    expect(code(() => assertAssessmentEntry({ basis: 'judgement', statement: 'x', criterionKey: 'fit', score: '6', knownCriterionKeys: keys }))).toBe('jv.assessment.score_out_of_range');
    expect(code(() => assertAssessmentEntry({ basis: 'judgement', statement: 'x', criterionKey: 'price', score: '3', knownCriterionKeys: keys }))).toBe('jv.assessment.unknown_criterion');
  });
});

describe('REQ-JV-007 — ownership scenarios carry no default percentage', () => {
  it('a new scenario lists parties with NO percentage (never assumed)', () => {
    expect(blankOwnership(['Mobily (party A)', 'Partner (TBD)'])).toEqual([
      { party: 'Mobily (party A)', percent: null },
      { party: 'Partner (TBD)', percent: null },
    ]);
    expect(assertOwnershipScenario(blankOwnership(['A', 'B']))).toEqual({ complete: false, total: null });
  });
  it('entered values are validated; a complete split totals exactly 100', () => {
    expect(assertOwnershipScenario([{ party: 'A', percent: '40' }, { party: 'B', percent: null }])).toEqual({ complete: false, total: '40.0000' });
    expect(code(() => assertOwnershipScenario([{ party: 'A', percent: '70' }, { party: 'B', percent: '40' }]))).toBe('jv.scenario.ownership_exceeds_100');
    expect(code(() => assertOwnershipScenario([{ party: 'A', percent: '60' }, { party: 'B', percent: '30' }]))).toBe('jv.scenario.ownership_not_100');
    expect(assertOwnershipScenario([{ party: 'A', percent: '50.5' }, { party: 'B', percent: '49.5' }])).toEqual({ complete: true, total: '100.0000' });
    expect(code(() => assertOwnershipScenario([{ party: 'A', percent: '101' }]))).toBe('jv.scenario.percent_out_of_range');
    expect(code(() => assertOwnershipScenario([{ party: 'A', percent: null }, { party: 'a', percent: null }]))).toBe('jv.scenario.duplicate_party');
  });
});

describe('REQ-JV-008 — negotiation issue requiring approval links a decision', () => {
  it('requires the link and a FINAL approval before agreement', () => {
    expect(code(() => assertNegotiationIssueLinks({ requiresApproval: true, decisionId: null }))).toBe('jv.negotiation.decision_required');
    expect(code(() => assertNegotiationIssueLinks({ requiresApproval: false, decisionId: null }))).toBe('no error');
    expect(code(() => assertNegotiationAgreementAllowed({ requiresApproval: true, decision: { status: 'under_review', authorityOutcome: 'not_assessed' } }))).toBe('jv.negotiation.approval_pending');
    expect(code(() => assertNegotiationAgreementAllowed({ requiresApproval: true, decision: { status: 'recommended', authorityOutcome: 'pending_external_authority' } }))).toBe('jv.negotiation.approval_pending');
    expect(code(() => assertNegotiationAgreementAllowed({ requiresApproval: true, decision: { status: 'approved', authorityOutcome: 'within_mandate' } }))).toBe('no error');
    expect(() => transition('negotiation_issue', NEGOTIATION_ISSUE_MACHINE, 'open', 'agree')).toThrow();
  });
});

describe('REQ-JV-005 / REQ-ENT-012 / AT-03 — room grants', () => {
  const now = new Date('2026-10-01T08:00:00Z');
  const base: RoomGrantInput = {
    room: { type: 'partner', locked: false, partnerId: 'P-A', partnerStage: 'materials_access' },
    grantee: { userId: 'ext', accountType: 'external', isActive: true, isFullProjectMember: false, boundPartnerId: 'P-A' },
    grantorUserId: 'legal',
    grantorRoles: ['legal_restricted'],
    role: 'external_partner_limited',
    accessLevel: 'read',
    expiresAt: new Date('2026-11-01T00:00:00Z'),
    now,
    attestationRef: null,
  };
  it('an NDA alone grants nothing: a partner below Materials access cannot be granted', () => {
    expect(code(() => assertRoomGrantAllowed(base))).toBe('no error');
    expect(code(() => assertRoomGrantAllowed({ ...base, room: { ...base.room, partnerStage: 'nda' } }))).toBe('jv.room.materials_access_required');
  });
  it("partner B's account can never be granted into partner A's room; externals only hold the limited role", () => {
    expect(code(() => assertRoomGrantAllowed({ ...base, grantee: { ...base.grantee, boundPartnerId: 'P-B' } }))).toBe('jv.room.counterparty_mismatch');
    expect(code(() => assertRoomGrantAllowed({ ...base, grantee: { ...base.grantee, boundPartnerId: null } }))).toBe('jv.room.counterparty_mismatch');
    expect(code(() => assertRoomGrantAllowed({ ...base, role: null }))).toBe('jv.room.external_role_required');
    expect(code(() => assertRoomGrantAllowed({ ...base, room: { ...base.room, type: 'clean_team' } }))).toBe('jv.room.external_partner_room_only');
    expect(code(() => assertRoomGrantAllowed({ ...base, accessLevel: 'manage' }))).toBe('jv.room.external_manage_forbidden');
    expect(code(() => assertRoomGrantAllowed({ ...base, expiresAt: null }))).toBe('jv.room.expiry_required');
    expect(code(() => assertRoomGrantAllowed({ ...base, expiresAt: new Date(now.getTime() + (EXTERNAL_GRANT_MAX_DAYS + 1) * 86_400_000) }))).toBe('jv.room.expiry_too_long');
  });
  it('clean-team rooms: clean_team role + attestation, assigned by Legal only', () => {
    const ct: RoomGrantInput = { ...base, room: { type: 'clean_team', locked: false, partnerId: null, partnerStage: null }, grantee: { userId: 'ct', accountType: 'internal', isActive: true, isFullProjectMember: false, boundPartnerId: null }, role: 'clean_team', attestationRef: 'CT-ATTEST-1' };
    expect(code(() => assertRoomGrantAllowed(ct))).toBe('no error');
    expect(code(() => assertRoomGrantAllowed({ ...ct, role: null }))).toBe('jv.room.clean_team_role_required');
    expect(code(() => assertRoomGrantAllowed({ ...ct, attestationRef: ' ' }))).toBe('jv.room.attestation_required');
    expect(code(() => assertRoomGrantAllowed({ ...ct, grantorRoles: ['sponsor'] }))).toBe('jv.room.clean_team_legal_only');
    expect(code(() => assertRoomGrantAllowed({ ...ct, room: { type: 'internal', locked: false, partnerId: null, partnerStage: null } }))).toBe('jv.room.clean_team_room_only');
  });
  it('internal grants need a project role; no self-grants; no grants into a locked room', () => {
    const internal: RoomGrantInput = { ...base, grantee: { userId: 'pm', accountType: 'internal', isActive: true, isFullProjectMember: true, boundPartnerId: null }, role: null, expiresAt: null };
    expect(code(() => assertRoomGrantAllowed(internal))).toBe('no error');
    expect(code(() => assertRoomGrantAllowed({ ...internal, grantee: { ...internal.grantee, isFullProjectMember: false } }))).toBe('jv.room.grantee_not_member');
    expect(code(() => assertRoomGrantAllowed({ ...internal, role: 'external_partner_limited' }))).toBe('jv.room.external_role_internal_account');
    expect(code(() => assertRoomGrantAllowed({ ...internal, grantorUserId: 'pm' }))).toBe('jv.room.self_grant');
    expect(code(() => assertRoomGrantAllowed({ ...internal, room: { ...internal.room, locked: true } }))).toBe('jv.room.locked');
  });
  it('room types are derived, never client-asserted', () => {
    expect(roomTypeOf({ isCleanTeam: true, partnerId: 'x' })).toBe('clean_team');
    expect(roomTypeOf({ isCleanTeam: false, partnerId: 'x' })).toBe('partner');
    expect(roomTypeOf({ isCleanTeam: false, partnerId: null })).toBe('internal');
  });
});

describe('REQ-JV-009 — disclosures', () => {
  it('only usable versions filed in a partner room are disclosed, released by a separate person', () => {
    expect(code(() => assertDisclosureRequestable({ roomType: 'clean_team', roomLocked: false, versionUsable: true, documentInRoom: true }))).toBe('jv.disclosure.clean_team_room');
    expect(code(() => assertDisclosureRequestable({ roomType: 'partner', roomLocked: false, versionUsable: false, documentInRoom: true }))).toBe('jv.disclosure.version_not_usable');
    expect(code(() => assertDisclosureRequestable({ roomType: 'partner', roomLocked: false, versionUsable: true, documentInRoom: false }))).toBe('jv.disclosure.document_not_in_room');
    const r = { status: 'requested' as const, releaserUserId: 'legal', requesterUserId: 'pm', uploaderUserId: 'pm', versionUsable: true, roomLocked: false };
    expect(code(() => assertDisclosureReleasable(r))).toBe('no error');
    expect(code(() => assertDisclosureReleasable({ ...r, releaserUserId: 'pm' }))).toBe('jv.disclosure.self_release');
    expect(code(() => assertDisclosureReleasable({ ...r, status: 'revoked' }))).toBe('jv.disclosure.not_requested');
  });
});

describe('REQ-JV-010 — DD Q&A: release without approval is rejected', () => {
  it('release requires the approved review, a separate reviewer and releaser', () => {
    expect(code(() => assertDdReleaseAllowed({ status: 'draft', releaserUserId: 'legal', drafterUserId: 'pm', reviewerUserId: null, answer: 'A' }))).toBe('jv.dd.release_requires_approval');
    expect(code(() => assertDdReleaseAllowed({ status: 'in_review', releaserUserId: 'legal', drafterUserId: 'pm', reviewerUserId: null, answer: 'A' }))).toBe('jv.dd.release_requires_approval');
    expect(code(() => assertDdReleaseAllowed({ status: 'approved_for_release', releaserUserId: 'pm', drafterUserId: 'pm', reviewerUserId: 'fin', answer: 'A' }))).toBe('jv.dd.self_release');
    expect(code(() => assertDdReleaseAllowed({ status: 'approved_for_release', releaserUserId: 'legal', drafterUserId: 'pm', reviewerUserId: 'fin', answer: 'A' }))).toBe('no error');
    expect(code(() => assertDdReviewAllowed({ reviewerUserId: 'pm', drafterUserId: 'pm' }))).toBe('jv.dd.self_review');
    expect(() => transition('dd', DD_RELEASE_MACHINE, 'draft', 'release')).toThrow();
    expect(externalDdStatus('in_review')).toBe('open');
    expect(externalDdStatus('released')).toBe('answered');
  });
});

describe('REQ-JV-011 — findings', () => {
  it('a material finding requires a remediation owner and plan', () => {
    expect(code(() => assertFindingRemediation({ materiality: 'high', remediationOwnerUserId: null, remediation: 'Fix' }))).toBe('jv.finding.remediation_owner_required');
    expect(code(() => assertFindingRemediation({ materiality: 'critical', remediationOwnerUserId: 'u', remediation: '' }))).toBe('jv.finding.remediation_required');
    expect(code(() => assertFindingRemediation({ materiality: 'medium', remediationOwnerUserId: null, remediation: null }))).toBe('no error');
    expect(transition('finding', FINDING_MACHINE, 'open', 'plan_remediation')).toBe('remediation_planned');
    expect(() => transition('finding', FINDING_MACHINE, 'open', 'close')).toThrow();
  });
});

describe('REQ-JV-013 / AT-12 / AT-13 — conditions precedent', () => {
  it('verifyCP without evidence is rejected; the owner / evidence submitter cannot verify', () => {
    expect(code(() => assertCpVerifiable({ activeEvidence: 0, conflictingEvidence: 0, verifierUserId: 'legal', ownerUserId: 'pm', evidenceSubmittedBy: 'pm', evidenceLinkerUserIds: [] }))).toBe('jv.cp.evidence_required');
    expect(code(() => assertCpVerifiable({ activeEvidence: 1, conflictingEvidence: 0, verifierUserId: 'pm', ownerUserId: 'pm', evidenceSubmittedBy: 'x', evidenceLinkerUserIds: [] }))).toBe('jv.cp.self_verification');
    expect(code(() => assertCpVerifiable({ activeEvidence: 1, conflictingEvidence: 0, verifierUserId: 'x', ownerUserId: 'pm', evidenceSubmittedBy: 'x', evidenceLinkerUserIds: [] }))).toBe('jv.cp.self_verification');
    expect(code(() => assertCpVerifiable({ activeEvidence: 1, conflictingEvidence: 0, verifierUserId: 'legal', ownerUserId: 'pm', evidenceSubmittedBy: 'pm', evidenceLinkerUserIds: ['pm'] }))).toBe('no error');
    expect(() => transition('closing_condition', CONDITION_MACHINE, 'open', 'verify')).toThrow();
  });
  it('SEC-P34R-09: a CP with conflicting evidence is not verified until the conflict is resolved', () => {
    expect(code(() => assertCpVerifiable({ activeEvidence: 1, conflictingEvidence: 1, verifierUserId: 'legal', ownerUserId: 'pm', evidenceSubmittedBy: 'pm', evidenceLinkerUserIds: ['pm'] }))).toBe('jv.cp.evidence_conflicting');
  });
  it('SEC-P34-01: whoever linked active evidence of a CP / deliverable / obligation cannot verify or accept it', () => {
    expect(code(() => assertCpVerifiable({ activeEvidence: 1, conflictingEvidence: 0, verifierUserId: 'legal', ownerUserId: 'pm', evidenceSubmittedBy: 'pm', evidenceLinkerUserIds: ['pm', 'legal'] }))).toBe('jv.cp.self_verification');
    expect(code(() => assertChecklistItemAcceptable({ status: 'delivered', executedVersionUsable: true, acceptorUserId: 'legal', ownerUserId: 'x', deliveredBy: 'pm', evidenceLinkerUserIds: ['legal'] }))).toBe('jv.checklist_item.self_acceptance');
    expect(code(() => assertObligationVerifiable({ activeEvidence: 1, verifierUserId: 'legal', ownerUserId: 'pm', reportedBy: 'pm', evidenceLinkerUserIds: ['legal'] }))).toBe('jv.obligation.self_verification');
    expect(code(() => assertObligationVerifiable({ activeEvidence: 1, verifierUserId: 'legal', ownerUserId: 'pm', reportedBy: 'pm', evidenceLinkerUserIds: ['pm'] }))).toBe('no error');
  });
  it('waivability is a documented specialist determination', () => {
    expect(code(() => assertCpWaivabilityDetermination({ waivable: true, waiverAuthorityRole: null, basis: 'x' }))).toBe('jv.cp.waiver_authority_required');
    expect(code(() => assertCpWaivabilityDetermination({ waivable: false, waiverAuthorityRole: 'sponsor', basis: 'x' }))).toBe('jv.cp.non_waivable_no_authority');
    expect(code(() => assertCpWaivabilityDetermination({ waivable: false, waiverAuthorityRole: null, basis: '' }))).toBe('jv.cp.waivability_basis_required');
  });
});

describe('REQ-LCY-009 / REQ-JV-012 / REQ-JV-017 / REQ-JV-018 — signing and closing readiness', () => {
  const closing = (over: Partial<EventReadinessInput> = {}): EventReadinessInput => ({
    kind: 'closing',
    signing: { code: 'SIG-001', status: 'confirmed' },
    conditions: [
      { reference: 'CP-01', blocking: true, waivable: false, status: 'verified', waiverEffective: false, activeEvidence: 1, validTo: null, longStopDate: null },
      { reference: 'CP-02', blocking: true, waivable: false, status: 'open', waiverEffective: false, activeEvidence: 0, validTo: null, longStopDate: '2027-03-31' },
      { reference: 'CP-03', blocking: false, waivable: true, status: 'open', waiverEffective: false, activeEvidence: 0, validTo: null, longStopDate: null },
    ],
    items: [{ ref: 'CL-01', status: 'verified' }],
    today: '2026-10-01',
    ...over,
  });
  it('one unverified blocking CP blocks closing even when everything else is complete (no task input exists)', () => {
    const b = eventBlockers(closing());
    expect(b.map((x) => [x.kind, x.ref])).toEqual([['condition', 'CP-02']]);
    expect(b[0]!.message).toBe('Blocking condition CP-02 is open');
    expect(b[0]!.messageI18n).toEqual([{ code: 'jv.closing.cp_unmet', params: { ref: 'CP-02', status: 'open' } }]);
  });
  it('a verified CP whose evidence was withdrawn, an ineffective waiver, a lapsed validity all block', () => {
    const b = eventBlockers(
      closing({
        conditions: [
          { reference: 'CP-10', blocking: true, waivable: false, status: 'verified', waiverEffective: false, activeEvidence: 0, validTo: null, longStopDate: null },
          { reference: 'CP-11', blocking: true, waivable: true, status: 'waived', waiverEffective: false, activeEvidence: 0, validTo: null, longStopDate: null },
          { reference: 'CP-12', blocking: true, waivable: false, status: 'waived', waiverEffective: true, activeEvidence: 0, validTo: null, longStopDate: null },
          { reference: 'CP-13', blocking: true, waivable: false, status: 'verified', waiverEffective: false, activeEvidence: 2, validTo: '2026-09-01', longStopDate: null },
        ],
      }),
    );
    expect(b.map((x) => x.messageI18n[0]!.code)).toEqual(['jv.closing.cp_verified_without_evidence', 'jv.closing.cp_waiver_not_effective', 'jv.closing.cp_waiver_not_effective', 'jv.closing.cp_validity_lapsed']);
  });
  it('closing depends on its own confirmed signing; signing is a separate event', () => {
    expect(eventBlockers(closing({ signing: null, conditions: [] }))[0]!.messageI18n[0]!.code).toBe('jv.closing.no_signing');
    expect(eventBlockers(closing({ signing: { code: 'SIG-001', status: 'ready_for_confirmation' }, conditions: [] }))[0]!.ref).toBe('SIG-001');
    // a signing has no signing prerequisite and is blocked only by its own checklist
    expect(eventBlockers({ kind: 'signing', signing: null, conditions: [], items: [{ ref: 'SL-01', status: 'delivered' }], today: '2026-10-01' }).map((x) => x.ref)).toEqual(['SL-01']);
  });
  it('confirmation needs a separate person and a FINAL approved decision of the right type', () => {
    const ok = { kind: 'closing' as const, blockers: [], confirmerUserId: 'sponsor', requesterUserId: 'pm', decision: { status: 'approved' as const, authorityOutcome: 'pending_external_authority' as const, externalAuthorityReference: 'BOARD-1', decisionTypeKey: 'jv_closing_confirmation' } };
    expect(code(() => assertEventConfirmable(ok))).toBe('no error');
    expect(code(() => assertEventConfirmable({ ...ok, confirmerUserId: 'pm' }))).toBe('jv.closing.self_confirmation');
    expect(code(() => assertEventConfirmable({ ...ok, blockers: eventBlockers(closing()) }))).toBe('jv.closing.blocked');
    expect(code(() => assertEventConfirmable({ ...ok, decision: { ...ok.decision, externalAuthorityReference: null } }))).toBe('jv.closing.outside_authority');
    expect(code(() => assertEventConfirmable({ ...ok, decision: { ...ok.decision, decisionTypeKey: 'jv_signing_authorization' } }))).toBe('jv.closing.outside_authority');
    expect(() => transition('closing', CLOSING_MACHINE, 'in_preparation', 'confirm')).toThrow();
  });
});

describe('REQ-JV-014 / REQ-JV-015 / REQ-JV-016 / REQ-JV-019', () => {
  it('checklist-item acceptance requires the executed document and another person', () => {
    expect(code(() => assertChecklistItemAcceptable({ status: 'delivered', executedVersionUsable: null, acceptorUserId: 'legal', ownerUserId: 'pm', deliveredBy: 'pm', evidenceLinkerUserIds: [] }))).toBe('jv.checklist_item.executed_document_required');
    expect(code(() => assertChecklistItemAcceptable({ status: 'delivered', executedVersionUsable: true, acceptorUserId: 'pm', ownerUserId: 'x', deliveredBy: 'pm', evidenceLinkerUserIds: [] }))).toBe('jv.checklist_item.self_acceptance');
    expect(code(() => assertChecklistItemAcceptable({ status: 'pending', executedVersionUsable: true, acceptorUserId: 'legal', ownerUserId: 'x', deliveredBy: 'pm', evidenceLinkerUserIds: [] }))).toBe('jv.checklist_item.not_delivered');
    expect(code(() => assertChecklistItemAcceptable({ status: 'delivered', executedVersionUsable: true, acceptorUserId: 'legal', ownerUserId: 'x', deliveredBy: 'pm', evidenceLinkerUserIds: ['pm'] }))).toBe('no error');
  });
  it('SEC-P34-10: "not required" is requested with a reason and decided by a second person on the unchanged item', () => {
    expect(code(() => assertChecklistNotRequiredRequest({ status: 'verified', reason: 'x', pendingRequest: false }))).toBe('jv.checklist_item.invalid_state');
    expect(code(() => assertChecklistNotRequiredRequest({ status: 'pending', reason: ' ', pendingRequest: false }))).toBe('jv.checklist_item.reason_required');
    expect(code(() => assertChecklistNotRequiredRequest({ status: 'delivered', reason: 'x', pendingRequest: true }))).toBe('jv.checklist_item.not_required_pending');
    expect(code(() => assertChecklistNotRequiredRequest({ status: 'pending', reason: 'Superseded by the SPA (synthetic)', pendingRequest: false }))).toBe('no error');
    const d = { status: 'pending', requestPending: true, requestedVersion: 3, currentVersion: 3, deciderUserId: 'legal', requestedBy: 'pm', decision: 'confirm' as const, note: null };
    expect(code(() => assertChecklistNotRequiredDecision({ ...d, requestPending: false }))).toBe('jv.checklist_item.no_not_required_request');
    expect(code(() => assertChecklistNotRequiredDecision({ ...d, status: 'verified' }))).toBe('jv.checklist_item.invalid_state');
    expect(code(() => assertChecklistNotRequiredDecision({ ...d, currentVersion: 4 }))).toBe('jv.checklist_item.not_required_stale');
    expect(code(() => assertChecklistNotRequiredDecision({ ...d, deciderUserId: 'pm' }))).toBe('jv.checklist_item.not_required_self');
    expect(code(() => assertChecklistNotRequiredDecision({ ...d, requestedBy: null }))).toBe('jv.checklist_item.not_required_self');
    expect(code(() => assertChecklistNotRequiredDecision({ ...d, decision: 'reject' }))).toBe('jv.checklist_item.reason_required');
    expect(code(() => assertChecklistNotRequiredDecision(d))).toBe('no error');
    expect(code(() => assertChecklistNotRequiredDecision({ ...d, decision: 'reject', note: 'Still needed (synthetic)' }))).toBe('no error');
  });
  it('funds flow is record-only: its machine has no execute/pay command', () => {
    expect(Object.keys(FUNDS_FLOW_MACHINE).sort()).toEqual(['cancel', 'confirm', 'report_settled']);
    expect(Object.keys(FUNDS_FLOW_MACHINE).some((c) => /pay|execute|transfer|instruct/i.test(c))).toBe(false);
  });
  it('an overdue obligation (project-timezone business date) is detected; verified/cancelled never are', () => {
    expect(assessObligationOverdue({ status: 'open', dueDate: '2026-09-28', today: '2026-10-01' })).toEqual({ overdue: true, daysOverdue: 3 });
    expect(assessObligationOverdue({ status: 'in_progress', dueDate: '2026-10-01', today: '2026-10-01' })).toEqual({ overdue: false, daysOverdue: 0 });
    expect(assessObligationOverdue({ status: 'verified', dueDate: '2026-09-01', today: '2026-10-01' }).overdue).toBe(false);
    expect(transition('post_close_obligation', POST_CLOSE_MACHINE, 'open', 'mark_overdue')).toBe('overdue');
    expect(code(() => assertObligationVerifiable({ activeEvidence: 0, verifierUserId: 'legal', ownerUserId: 'pm', reportedBy: 'pm', evidenceLinkerUserIds: [] }))).toBe('jv.obligation.evidence_required');
  });
  it('program closure is rejected before G7 passes and by the requester', () => {
    expect(code(() => assertProgramClosureAllowed({ g7Status: null, confirmerUserId: 'pfa', requesterUserId: 'pm' }))).toBe('jv.program_closure.g7_not_passed');
    expect(code(() => assertProgramClosureAllowed({ g7Status: 'ready_for_decision', confirmerUserId: 'pfa', requesterUserId: 'pm' }))).toBe('jv.program_closure.g7_not_passed');
    expect(code(() => assertProgramClosureAllowed({ g7Status: 'approved', confirmerUserId: 'pm', requesterUserId: 'pm' }))).toBe('jv.program_closure.self_confirmation');
    expect(code(() => assertProgramClosureAllowed({ g7Status: 'approved_with_exceptions', confirmerUserId: 'pfa', requesterUserId: 'pm' }))).toBe('no error');
  });
});

describe('REQ-LCY-008 / AT-11 — partner preparation runs in parallel with separation', () => {
  const nodes = [
    { id: 'WS02-A01', gateKey: 'G1', prerequisites: [] },
    { id: 'WS07-A05', gateKey: 'G3', prerequisites: ['WS02-A01'] },
    { id: 'WS11-A03', gateKey: 'G5', prerequisites: ['WS02-A01'] },
    { id: 'WS11-A08', gateKey: 'G5', prerequisites: ['WS11-A03'] },
    { id: 'WS11-A09', gateKey: 'G5', prerequisites: ['WS11-A08'] },
  ];
  it('DD tasks are schedulable before G3 unless an explicit dependency is configured', () => {
    expect(separationGatesBlocking(nodes, 'WS11-A09')).toEqual([]);
    const withExplicit = nodes.map((n) => (n.id === 'WS11-A08' ? { ...n, prerequisites: [...n.prerequisites, 'WS07-A05'] } : n));
    expect(separationGatesBlocking(withExplicit, 'WS11-A09')).toEqual(['G3']);
  });
});
