import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeQuorum, type MemberSnapshot } from '@hub/domain';
import { closeApp, closePools, owner } from '../helpers';
import { setupProject, setupGovernance, gateByKey, crit, evidenceLinks, makeReady, approveGate, startGate, meetAllMandatory, reviewGate, gateDecision, runWorker, Personas, Gov } from '../gates/gate-test-kit';
import { Actors, DEMO_AUTHORITY_POLICY, P, decisionRow, decisionVersion, tabledDecision, uniq, verifiedDecisionEvidence, vote } from '../governance/gov-fixtures';

/**
 * P2 DOMAIN RE-REVIEW — probes (docs/reviews/P2-domain-rereview.md).
 *
 * `RE DOM-P2-nn` tests independently re-verify a fix of the first review through the real API; they are expected to pass.
 * `DEFECT DOM-P2R-nn` tests assert the behaviour REQUIRED by the specification (or by the platform's own governance
 * documents) for a NEW finding of the re-review; at the reviewed revision they FAIL — the failure is the reproduction. They
 * must not be weakened to pass; rename them (drop `DEFECT`) once the defect is fixed.
 * `OBSERVATION DOM-P2R-nn` tests pin the current behaviour behind a finding whose rule awaits the governance owner; they pass.
 * All data is synthetic (the project is created by the test and flagged demo, like every gate-kit project).
 */

let pR: string;
let a: Personas;
let gov: Gov;
const A = () => a as unknown as Actors;

beforeAll(async () => {
  ({ projectId: pR, p: a } = await setupProject('DRR-A'));
  gov = await setupGovernance(pR, a);
}, 600_000);

afterAll(async () => {
  await closeApp();
  await closePools();
});

const newCr = async (over: Record<string, unknown>) => {
  const cr = await a.pm.post(`${P(pR)}/change-requests`, {
    title: uniq('Re-review change request (synthetic)'),
    rationale: 'Re-review probe of delegated authority (synthetic)',
    alternatives: ['Do nothing'],
    impacts: { scope: 'Synthetic scope change' },
    ...over,
  });
  expect(cr.status, JSON.stringify(cr.body)).toBe(201);
  await a.pm.post(`${P(pR)}/change-requests/${cr.body.id}/submit`, { expectedVersion: 1 }).expect(201);
  await a.pm.post(`${P(pR)}/change-requests/${cr.body.id}/start-review`, { expectedVersion: 2 }).expect(201);
  return cr.body.id as string;
};
const approveCr = (id: string, body: Record<string, unknown> = {}) => a.sponsor.post(`${P(pR)}/change-requests/${id}/approve`, { expectedVersion: 3, note: 'Re-review probe (synthetic)', ...body });
const gateUrl = (gateId: string, cmd: string) => `${P(pR)}/gates/${gateId}/assessment/${cmd}`;

describe('P2 domain re-review — probes [docs/reviews/P2-domain-rereview.md]', () => {
  // -------------------------------------------------------------------------------------------------------------
  it('RE DOM-P2-01: a decision of the operational gate type raised for G5 (reserved to the Board) cannot even be linked to G5', async () => {
    const d = await tabledDecision(pR, A(), a.pm, gov.committeeId, gov.meetingId, { decisionTypeKey: 'gate_decision_operational', gateKey: 'G5', amount: null, requiredAuthority: 'Per the DEMO matrix (synthetic)' });
    const g5 = await gateByKey(a.pm, pR, 'G5');
    const r = await a.pm.post(gateUrl(g5.id, 'link-decision'), { expectedVersion: g5.assessment.version, decisionId: d.id });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('gates.decision.not_for_gate');
    // Leave no open round at the meeting (the attendance freeze applies only to rounds with votes; this one has none).
  });

  // -------------------------------------------------------------------------------------------------------------
  // Was "OBSERVATION DOM-P2R-01" (pinned the gap: approved 1 to 0 at once). The fix (proposed default, pending the
  // governance owner, Q-40) requires every present eligible member's vote, or the chair's closing of the vote with a reason.
  it('DOM-P2R-01 (fixed, regression): with the eligible members present, ONE approve vote does not let the outcome be recorded; only the chair closes voting (with a reason), non-voters are recorded', async () => {
    const x = await tabledDecision(pR, A(), a.pm, gov.committeeId, gov.meetingId); // change_request_budget, 100,000 (within the DEMO limit)
    const v = await decisionVersion(a.chair, pR, x.id);
    expect((await vote(pR, a.chair, x.id, 'approve', v)).status).toBe(201);
    // Nobody else has voted yet; the secretariat tries to record the outcome at once.
    const early = await a.secretary.post(`${P(pR)}/decisions/${x.id}/record-outcome`, { expectedVersion: v });
    expect(early.status, JSON.stringify(early.body)).toBe(422);
    expect(early.body.code).toBe('governance.outcome.votes_outstanding');
    expect(early.body.details).toMatchObject({ round: 1, outstanding: 3 });
    expect((await decisionRow(x.id))['status']).toBe('under_review');
    // Only the committee's chair closes voting.
    const bySecretary = await a.secretary.post(`${P(pR)}/decisions/${x.id}/close-voting`, { expectedVersion: v, reason: 'Closing the vote (probe)' });
    expect(bySecretary.status, JSON.stringify(bySecretary.body)).toBe(403);
    expect(bySecretary.body.code).toBe('governance.voting.not_chair');
    const closed = await a.chair.post(`${P(pR)}/decisions/${x.id}/close-voting`, { expectedVersion: v, reason: 'Members left before voting (synthetic)' });
    expect(closed.status, JSON.stringify(closed.body)).toBe(201);
    expect(closed.body).toMatchObject({ round: 1, notVoted: 3 });
    // No vote is accepted in the closed round.
    const late = await vote(pR, a.sponsor, x.id, 'approve');
    expect(late.status, JSON.stringify(late.body)).toBe(422);
    expect(late.body.code).toBe('governance.vote.voting_closed');
    const out = await a.secretary.post(`${P(pR)}/decisions/${x.id}/record-outcome`, { expectedVersion: closed.body.version });
    expect(out.status, JSON.stringify(out.body)).toBe(201);
    expect(out.body.explanation).toMatch(/1 approve, 0 reject, 0 abstain of 1 eligible votes/);
    const snap = (await decisionRow(x.id))['tally_snapshot'] as { voting: { complete: string; notVoted: string[]; closeReason: string } };
    expect(snap.voting).toMatchObject({ complete: 'closed_by_chair', closeReason: 'Members left before voting (synthetic)' });
    expect(snap.voting.notVoted).toHaveLength(3);
  });

  // -------------------------------------------------------------------------------------------------------------
  it('RE DOM-P2-03: a change request with a STRUCTURED cost impact above the DEMO limit is refused to the sponsor alone (422 outside_delegated_authority)', async () => {
    const id = await newCr({ costImpact: { amount: '1500000.0000', currency: 'SAR', unitScale: 1 } });
    const r = await approveCr(id);
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('change_control.outside_delegated_authority');
    expect((await owner().query(`select status from change_request where id = $1`, [id])).rows[0].status).toBe('under_review');
  });

  // Was "OBSERVATION DOM-P2R-02" (pinned the gap: approved on the requester's own 0). The fix (conservative option, pending
  // the governance owner, Q-43): the amount decides authority only when recorded or confirmed by an assessor who is not the
  // requester; a requester-stated figure can refuse an approval but never make it pass.
  it('DOM-P2R-02 (fixed, regression): the requester alone records the structured cost impact (0) against a stated 1,500,000 — refused until an assessor other than the requester records the amount', async () => {
    // The PM raises the change, states a cost of 1,500,000 DEMO-SAR in the impact text and records the structured cost
    // impact as 0 on the same request; the PM also starts the review. Nobody but the requester quantified the amount.
    const id = await newCr({
      impacts: { cost: '1,500,000 DEMO-SAR one-off (synthetic) — above the DEMO committee limit of 1,000,000 DEMO-SAR' },
      costImpact: { amount: '0.0000', currency: 'SAR', unitScale: 1 },
    });
    const cr = (await a.pm.get(`${P(pR)}/change-requests/${id}`).expect(200)).body;
    expect(cr).toMatchObject({ costImpact: { amount: '0.0000' }, costImpactConfirmed: false, costImpactRecordedBy: a.pm.userId });
    const r = await approveCr(id);
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('change_control.amount_unconfirmed');
    expect((await owner().query(`select status from change_request where id = $1`, [id])).rows[0].status).toBe('under_review');
    // Finance (an assessor who is not the requester) records the amount stated in the text: now it decides — and it is above
    // the delegated limit, so the sponsor alone cannot approve.
    const as = await a.finance.post(`${P(pR)}/change-requests/${id}/assess`, { expectedVersion: cr.version, impacts: {}, costImpact: { amount: '1500000.0000', currency: 'SAR', unitScale: 1 }, note: 'Assessed from the stated cost (synthetic)' });
    expect(as.status, JSON.stringify(as.body)).toBe(201);
    const again = await a.sponsor.post(`${P(pR)}/change-requests/${id}/approve`, { expectedVersion: as.body.version, note: 'Re-review probe (synthetic)' });
    expect(again.status, JSON.stringify(again.body)).toBe(422);
    expect(again.body.code).toBe('change_control.outside_delegated_authority');
  });

  it('DOM-P2R-03 (fixed, regression): a committee decision that authorized change request X cannot approve a different change request Y', async () => {
    const crX = await newCr({ title: uniq('Change X (synthetic)'), costImpact: { amount: '1500000.0000', currency: 'SAR', unitScale: 1 } });
    const crY = await newCr({ title: uniq('Change Y (synthetic)'), costImpact: { amount: '1200000.0000', currency: 'SAR', unitScale: 1 } });
    // The committee paper is about change X (1,500,000): recommended above the limit, then approved by the external body.
    const d = await tabledDecision(pR, A(), a.pm, gov.committeeId, gov.meetingId, {
      title: uniq('Authorize change X only (synthetic)'),
      issue: `Change request ${crX} (synthetic) exceeds the DEMO limit`,
      decisionTypeKey: 'change_request_budget',
      amount: { amount: '1500000.0000', currency: 'SAR', unitScale: 1 },
    });
    const v = await decisionVersion(a.chair, pR, d.id);
    for (const k of ['chair', 'sponsor', 'finance', 'legal'] as const) expect((await vote(pR, a[k], d.id, 'approve', v)).status).toBe(201);
    const out = await a.secretary.post(`${P(pR)}/decisions/${d.id}/record-outcome`, { expectedVersion: v });
    expect(out.body).toMatchObject({ status: 'recommended', authorityOutcome: 'pending_external_authority' });
    const evidenceLinkId = await verifiedDecisionEvidence(pR, a.pm, a.legal, d.id);
    const ev = await decisionVersion(a.chair, pR, d.id);
    const ext = await gov.secretary2.post(`${P(pR)}/decisions/${d.id}/record-external-approval`, { expectedVersion: ev, outcome: 'approved', externalReference: 'DEMO-DELEGATING-AUTHORITY (synthetic)', evidenceLinkId });
    expect(ext.status, JSON.stringify(ext.body)).toBe(201);
    // The sponsor uses the decision about X to approve Y.
    const r = await approveCr(crY, { decisionId: d.id });
    // Required: spec §4.2 ("approval interfaces enforcing delegated authority"), AT-04 ("route to the authorized body"): the
    // authorized body approved change X, not change Y. A decision must name the change request / baseline it authorizes.
    expect(r.status, `change Y approved on the decision about change X: ${JSON.stringify(r.body)}`).toBe(422);
  });

  it('DOM-P2R-04b (fixed, regression): an external approval whose evidence was since rejected as defective no longer backs a change-request approval', async () => {
    const cr = await newCr({ title: uniq('Change Z (synthetic)'), costImpact: { amount: '1500000.0000', currency: 'SAR', unitScale: 1 } });
    const d = await tabledDecision(pR, A(), a.pm, gov.committeeId, gov.meetingId, {
      title: uniq('Authorize change Z (synthetic)'),
      decisionTypeKey: 'change_request_budget',
      amount: { amount: '1500000.0000', currency: 'SAR', unitScale: 1 },
    });
    const v = await decisionVersion(a.chair, pR, d.id);
    for (const k of ['chair', 'sponsor', 'finance', 'legal'] as const) expect((await vote(pR, a[k], d.id, 'approve', v)).status).toBe(201);
    expect((await a.secretary.post(`${P(pR)}/decisions/${d.id}/record-outcome`, { expectedVersion: v })).body.status).toBe('recommended');
    const linkId = await verifiedDecisionEvidence(pR, a.pm, a.legal, d.id);
    const ev = await decisionVersion(a.chair, pR, d.id);
    await gov.secretary2.post(`${P(pR)}/decisions/${d.id}/record-external-approval`, { expectedVersion: ev, outcome: 'approved', externalReference: 'DEMO-DELEGATING-AUTHORITY-Z (synthetic)', evidenceLinkId: linkId }).expect(201);
    // A third person finds the record of the external decision defective (documents-module verification: reject).
    const l = (await owner().query(`select version from evidence_link where id = $1`, [linkId])).rows[0];
    const rej = await a.finance.post(`${P(pR)}/evidence/${linkId}/verify`, { expectedVersion: l.version, decision: 'reject', note: 'Defective: the record does not match the authority decision (synthetic)' });
    expect(rej.status, JSON.stringify(rej.body)).toBe(201);
    const r = await approveCr(cr, { decisionId: d.id });
    // Required: DOM-P2-12 fix (an external authority decision rests on VERIFIED evidence), spec §3 / REQ-LCY-015 ("if approved
    // evidence is found defective, reopen … through a controlled process"): a decision whose only evidence of the external
    // approval is now rejected cannot back a new approval.
    expect(r.status, `approved on a decision whose external-approval evidence is rejected: ${JSON.stringify(r.body)}`).toBe(422);
  });

  // -------------------------------------------------------------------------------------------------------------
  it('RE DOM-P2-20: attendance is frozen once the current round has a vote (422), and free again after the outcome', async () => {
    const x = await tabledDecision(pR, A(), a.pm, gov.committeeId, gov.meetingId);
    const v = await decisionVersion(a.chair, pR, x.id);
    expect((await vote(pR, a.chair, x.id, 'approve', v)).status).toBe(201);
    const seat = (await owner().query(`select id from committee_membership where committee_id = $1 and user_id = $2`, [gov.committeeId, a.approver.userId])).rows[0].id as string;
    const r = await a.secretary.post(`${P(pR)}/meetings/${gov.meetingId}/attendance`, { entries: [{ membershipId: seat, status: 'absent' }] });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('governance.attendance.frozen_voting_open');
    // Close the round so later probes can use the meeting. (Setup change for DOM-P2R-01: the outcome needs every present
    // eligible member's vote — Legal is present in the gate kit's meeting and votes too; the assertions are unchanged.)
    for (const k of ['sponsor', 'finance', 'legal'] as const) expect((await vote(pR, a[k], x.id, 'approve', v)).status).toBe(201);
    expect((await a.secretary.post(`${P(pR)}/decisions/${x.id}/record-outcome`, { expectedVersion: v })).status).toBe(201);
  });

  it('RE DOM-P2-13 (domain): the quorum fraction is taken over APPOINTED voting members — recusals never lower the bar', () => {
    const seat = (i: number): MemberSnapshot => ({ membershipId: `m${i}`, userId: `u${i}`, role: 'voting_member', voting: true, validFrom: '2026-01-01', validTo: null });
    const members = [1, 2, 3, 4, 5, 6, 7, 8].map(seat);
    const base = { members, recusedUserIds: ['u6', 'u7', 'u8'], onDate: '2026-09-30', policy: DEMO_AUTHORITY_POLICY, requesterUserId: null };
    const three = computeQuorum({ ...base, presentUserIds: ['u1', 'u2', 'u3', 'u6', 'u7', 'u8'] });
    expect(three).toMatchObject({ appointedVoting: 8, required: 4, presentVoting: 3, met: false });
    expect(computeQuorum({ ...base, presentUserIds: ['u1', 'u2', 'u3', 'u4'] }).met).toBe(true);
  });

  // -------------------------------------------------------------------------------------------------------------
  it('RE DOM-P2-01 / DOM-P2-12: G0 passes only on the reserved-type decision approved by the external body with verified evidence', async () => {
    await makeReady(a, pR, 'G0');
    // The committee cannot pass G0 "within mandate": the reserved type ends as a recommendation.
    const rec = await gateDecision(pR, a, gov, 'G0');
    expect(rec.status).toBe('recommended');
    const g0 = await gateByKey(a.pm, pR, 'G0');
    const refused = await a.sponsor.post(gateUrl(g0.id, 'decide'), { expectedVersion: g0.assessment.version, outcome: 'approve', decisionId: rec.id, note: 'probe' });
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body.code).toBe('gates.decide.decision_not_final');
    const { decisionId } = await approveGate(a, gov, pR, 'G0'); // new decision: reserved type → recommended → external approval (verified evidence)
    const after = await gateByKey(a.pm, pR, 'G0');
    expect(after.assessment).toMatchObject({ status: 'approved', decisionId });
  });

  it('RE DOM-P2-16: an endorsement goes stale when evidence changes; the endorsing reviewer cannot submit; the owner submits a current endorsement', async () => {
    await startGate(a, pR, 'G1'); // owner role: workstream lead (tech.lead)
    await meetAllMandatory(a, pR, 'G1');
    await reviewGate(a, pR, 'G1'); // designated gate reviewer: project manager
    let g1 = await gateByKey(a.pm, pR, 'G1');
    expect(g1.review.state).toBe('endorsed');
    // A second person verifies an evidence link of a met criterion after the endorsement: the criterion state changed.
    const c = crit(g1, 'G1-C01');
    const link = (await evidenceLinks(a.pm, pR, c.id)).find((l) => l.status === 'active')!;
    const vf = await a.finance.post(`${P(pR)}/evidence/${link.id}/verify`, { expectedVersion: link.version, decision: 'accept', note: 'Checked (synthetic)' });
    expect(vf.status, JSON.stringify(vf.body)).toBe(201);
    g1 = await gateByKey(a.pm, pR, 'G1');
    expect(g1.review.state).toBe('stale');
    const stale = await a.techLead.post(gateUrl(g1.id, 'mark-ready'), { expectedVersion: g1.assessment.version });
    expect(stale.status, JSON.stringify(stale.body)).toBe(422);
    expect(stale.body.code).toBe('gates.assessment.review_stale');
    await reviewGate(a, pR, 'G1');
    g1 = await gateByKey(a.pm, pR, 'G1');
    // The PM may act as owner (override), but not on the cycle it endorsed.
    const own = await a.pm.post(gateUrl(g1.id, 'mark-ready'), { expectedVersion: g1.assessment.version });
    expect(own.status, JSON.stringify(own.body)).toBe(403);
    expect(own.body.code).toBe('gates.assessment.reviewer_cannot_submit');
    const ok = await a.techLead.post(gateUrl(g1.id, 'mark-ready'), { expectedVersion: g1.assessment.version });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const d = await gateDecision(pR, a, gov, 'G1');
    expect(d.status).toBe('approved');
    g1 = await gateByKey(a.pm, pR, 'G1');
    const decided = await a.chair.post(gateUrl(g1.id, 'decide'), { expectedVersion: g1.assessment.version, outcome: 'approve', decisionId: d.id, note: 'Re-review probe (synthetic)' });
    expect(decided.status, JSON.stringify(decided.body)).toBe(201);
  });

  // -------------------------------------------------------------------------------------------------------------
  it('DOM-P2R-04a (fixed, regression): the external approval evidence behind an APPROVED gate is later rejected as defective — the gate must be flagged for controlled reassessment', async () => {
    const g0 = await gateByKey(a.pm, pR, 'G0');
    expect(g0.assessment.status).toBe('approved');
    const d = await decisionRow(g0.assessment.decisionId!);
    const linkId = d['external_evidence_link_id'] as string;
    expect(linkId, 'the G0 decision rests on an external-approval evidence link (DOM-P2-12)').toBeTruthy();
    const l = (await owner().query(`select version, status, reviewed_by from evidence_link where id = $1`, [linkId])).rows[0];
    expect(l.status).toBe('active');
    // A verifier other than the linker (PM) and the first verifier (Legal) finds the board-resolution record defective.
    const rej = await a.finance.post(`${P(pR)}/evidence/${linkId}/verify`, { expectedVersion: l.version, decision: 'reject', note: 'Defective: the record does not match the resolution (synthetic)' });
    expect(rej.status, JSON.stringify(rej.body)).toBe(201);
    await runWorker();
    const after = await gateByKey(a.pm, pR, 'G0');
    // Required: spec §3 ("If approved evidence is found defective, reopen the assessment through a controlled process"),
    // spec §14 (evidence changes trigger reassessment of derived records), REQ-DAT-014, REQ-LCY-015.
    expect(after.assessment.reassessment.needsReassessment, `rag=${after.rag}; decision still ${d['status']}`).toBe(true);
  });
});
