import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, loginAs, owner, Client } from '../helpers';
import { setupProject, setupGovernance, Personas, Gov } from '../gates/gate-test-kit';
import { Actors, DEMO_AUTHORITY_POLICY, P, auditCount, decisionRow, decisionVersion, tabledDecision, uniq, verifiedDecisionEvidence, vote } from './gov-fixtures';
import { createProject, grant, task, workstreams } from '../planning/fixtures';
import { createWithVersion, login as docLogin } from '../documents/doc-helpers';

/**
 * P2 domain review — governance / authority fixes (docs/reviews/P2-domain-review.md, "Fix status"):
 *  DOM-P2-02 abstentions count as not approving · DOM-P2-03 baseline / change-request approvals act on the approved
 *  authority matrix (or on a final committee decision) · DOM-P2-06 no recusal after voting, tally integrity ·
 *  DOM-P2-12 matrix and external approvals rest on verified evidence · DOM-P2-13 quorum over appointed voting members ·
 *  DOM-P2-20 attendance frozen while voting is open. All data is synthetic (projects created by the test).
 *
 * Project A: demo project (gate kit) with an active steering committee, the approved DEMO matrix and an open meeting with
 * every voting member present. Project N: ordinary (non-demo) project, no committee and no matrix at first.
 */
let pA: string;
let a: Personas;
let govA: Gov;
let admin: Client;
let pN: string;
/** Another decision of project A (evidence attached to the wrong target). */
let otherDecisionId: string;
const A = () => a as unknown as Actors;

beforeAll(async () => {
  ({ projectId: pA, p: a } = await setupProject('GOVFIX-A'));
  govA = await setupGovernance(pA, a);
  admin = await loginAs('portfolio.admin');
  pN = await createProject(admin, a.pm, 'GOVFIX-N');
  await grant(admin, pN, a.sponsor, 'sponsor');
  await grant(admin, pN, a.secretary, 'secretary_cpmo');
  await grant(admin, pN, a.legal, 'legal_restricted');
  otherDecisionId = (await tabledDecision(pA, A(), a.pm, govA.committeeId, null)).id;
}, 600_000);

afterAll(async () => {
  await closeApp();
  await closePools();
});

const outcome = (pid: string, who: Client, id: string, expectedVersion: number) => who.post(`${P(pid)}/decisions/${id}/record-outcome`, { expectedVersion });
const auditRow = async (entityId: string, action: string) =>
  (await owner().query(`select outcome, after, reason, actor_user_id from audit_event where entity_id = $1 and action = $2 order by seq desc limit 1`, [entityId, action])).rows[0] as
    | { outcome: string; after: Record<string, unknown>; reason: string | null; actor_user_id: string }
    | undefined;
const rejectedCount = (actor: string, routeId: string) => auditCount(routeId, actor, 'rejected');

describe('DOM-P2-02 — abstentions count as not approving (authority-matrix.md §3 steps 5–6) [REQ-GOV-007, REQ-GOV-016]', () => {
  it('three approve and two abstain → approved; two approve, one reject, two abstain → rejected; eligible votes include abstentions', async () => {
    const yes = await tabledDecision(pA, A(), a.pm, govA.committeeId, govA.meetingId);
    let v = await decisionVersion(a.chair, pA, yes.id);
    for (const k of ['chair', 'sponsor', 'finance'] as const) expect((await vote(pA, a[k], yes.id, 'approve', v)).status).toBe(201);
    for (const k of ['legal', 'approver'] as const) expect((await vote(pA, a[k], yes.id, 'abstain', v)).status).toBe(201);
    const r1 = await outcome(pA, a.secretary, yes.id, v);
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    expect(r1.body).toMatchObject({ status: 'approved', outcome: 'approve' });
    expect(r1.body.explanation).toMatch(/3 approve, 0 reject, 2 abstain of 5 eligible votes; abstentions count as not approving/);

    const no = await tabledDecision(pA, A(), a.pm, govA.committeeId, govA.meetingId);
    v = await decisionVersion(a.chair, pA, no.id);
    for (const k of ['chair', 'sponsor'] as const) expect((await vote(pA, a[k], no.id, 'approve', v)).status).toBe(201);
    expect((await vote(pA, a.finance, no.id, 'reject', v)).status).toBe(201);
    for (const k of ['legal', 'approver'] as const) expect((await vote(pA, a[k], no.id, 'abstain', v)).status).toBe(201);
    const r2 = await outcome(pA, a.secretary, no.id, v);
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    expect(r2.body).toMatchObject({ status: 'rejected', outcome: 'reject' });
    const snap = (await decisionRow(no.id)).tally_snapshot as { tally: { approve: number; eligibleVotes: number } };
    expect(snap.tally).toMatchObject({ approve: 2, eligibleVotes: 5 });
  });

  it('a tie (approve = reject + abstain) under the DEMO "escalate" rule is never approved: the decision stays under review, escalated', async () => {
    const t = await tabledDecision(pA, A(), a.pm, govA.committeeId, govA.meetingId);
    const v = await decisionVersion(a.chair, pA, t.id);
    for (const k of ['chair', 'sponsor'] as const) expect((await vote(pA, a[k], t.id, 'approve', v)).status).toBe(201);
    expect((await vote(pA, a.finance, t.id, 'reject', v)).status).toBe(201);
    expect((await vote(pA, a.legal, t.id, 'abstain', v)).status).toBe(201);
    const r = await outcome(pA, a.secretary, t.id, v);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ status: 'under_review', outcome: 'tie_escalate' });
    expect(r.body.escalationId).toBeTruthy();
    // Close the round so the shared meeting has no open voting left (attendance is frozen while voting is open).
    const dv = await decisionVersion(a.chair, pA, t.id);
    await a.chair.post(`${P(pA)}/decisions/${t.id}/defer`, { expectedVersion: dv, note: 'Tie escalated (test)' }).expect(201);
  });
});

describe('DOM-P2-06 — no recusal after voting; recusals on behalf need a reason; tally integrity [REQ-GOV-015, REQ-SEC-005]', () => {
  it('the secretariat cannot recuse a member who already voted in the round (422, audited, nothing recorded); nor can the member', async () => {
    const d = await tabledDecision(pA, A(), a.pm, govA.committeeId, govA.meetingId);
    const v = await decisionVersion(a.chair, pA, d.id);
    expect((await vote(pA, a.finance, d.id, 'reject', v)).status).toBe(201);
    const before = await rejectedCount(a.secretary.userId, 'governance.declareRecusal');
    const onBehalf = await a.secretary.post(`${P(pA)}/decisions/${d.id}/recusals`, { userId: a.finance.userId, reason: 'Recorded on behalf after the vote (test)' });
    expect(onBehalf.status).toBe(422);
    expect(onBehalf.body.code).toBe('governance.recusal.after_vote');
    expect(await rejectedCount(a.secretary.userId, 'governance.declareRecusal')).toBe(before + 1);
    const own = await a.finance.post(`${P(pA)}/decisions/${d.id}/recusals`, { reason: 'Own recusal after my vote (test)' });
    expect(own.status).toBe(422);
    expect(own.body.code).toBe('governance.recusal.after_vote');
    // The meeting declaration path applies the same guard.
    const decl = await a.secretary.post(`${P(pA)}/meetings/${govA.meetingId}/conflicts`, { userId: a.finance.userId, decisionId: d.id, declaration: 'recused', description: 'Via the meeting (test)' });
    expect(decl.status).toBe(422);
    expect(decl.body.code).toBe('governance.recusal.after_vote');
    expect((await owner().query(`select count(*)::int n from recusal where decision_id = $1`, [d.id])).rows[0].n).toBe(0);

    // A conflict found after voting is handled by a NEW round: defer → resume, then the recusal is recorded before voting.
    let dv = await decisionVersion(a.chair, pA, d.id);
    dv = (await a.chair.post(`${P(pA)}/decisions/${d.id}/defer`, { expectedVersion: dv, note: 'Conflict found after voting (test)' }).expect(201)).body.version;
    const resumed = (await a.secretary.post(`${P(pA)}/decisions/${d.id}/resume`, { expectedVersion: dv, meetingId: govA.meetingId }).expect(201)).body;
    expect(resumed.voteRound).toBe(2);
    await a.secretary.post(`${P(pA)}/decisions/${d.id}/recusals`, { userId: a.finance.userId, reason: 'Declared interest in the synthetic vendor (test)' }).expect(201);
    const detail = (await a.pm.get(`${P(pA)}/decisions/${d.id}`).expect(200)).body;
    expect(detail.recusals).toEqual([expect.objectContaining({ userId: a.finance.userId, recordedBy: a.secretary.userId, onBehalf: true })]);
    const audit = await auditRow(d.id, 'governance.decision.recusal');
    expect(audit?.after).toMatchObject({ userId: a.finance.userId, recordedBy: a.secretary.userId, onBehalf: true, round: 2 });
    // Round 2: the outcome counts only round-2 votes and the snapshot shows who recused whom.
    const v2 = await decisionVersion(a.chair, pA, d.id);
    for (const k of ['chair', 'sponsor', 'legal'] as const) expect((await vote(pA, a[k], d.id, 'approve', v2)).status).toBe(201);
    const r = await outcome(pA, a.secretary, d.id, v2);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const snap = (await decisionRow(d.id)).tally_snapshot as { round: number; recusals: unknown[]; disregardedVotes: number; tally: { approve: number; reject: number } };
    expect(snap).toMatchObject({ round: 2, disregardedVotes: 0, tally: { approve: 3, reject: 0 } });
    expect(snap.recusals).toEqual([{ userId: a.finance.userId, recordedBy: a.secretary.userId, onBehalf: true }]);
  });

  it('a recusal declared on behalf through the meeting needs a reason (422)', async () => {
    const d = await tabledDecision(pA, A(), a.pm, govA.committeeId, govA.meetingId);
    const r = await a.secretary.post(`${P(pA)}/meetings/${govA.meetingId}/conflicts`, { userId: a.approver.userId, decisionId: d.id, declaration: 'recused' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('governance.recusal.reason_required');
    // The member's own declaration needs none.
    const own = await a.approver.post(`${P(pA)}/meetings/${govA.meetingId}/conflicts`, { decisionId: d.id, declaration: 'recused' });
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    expect(own.body.recusalRecorded).toBe(true);
  });

  it('tally integrity: a vote of a member recused behind the API (owner pool) refuses the outcome instead of being dropped', async () => {
    const d = await tabledDecision(pA, A(), a.pm, govA.committeeId, govA.meetingId);
    const v = await decisionVersion(a.chair, pA, d.id);
    for (const k of ['chair', 'sponsor'] as const) expect((await vote(pA, a[k], d.id, 'approve', v)).status).toBe(201);
    for (const k of ['finance', 'legal', 'approver'] as const) expect((await vote(pA, a[k], d.id, 'reject', v)).status).toBe(201);
    const org = (await owner().query(`select org_id from project where id = $1`, [pA])).rows[0].org_id;
    await owner().query(`insert into recusal (org_id, project_id, decision_id, user_id, reason, recorded_by) values ($1, $2, $3, $4, 'inserted behind the API (test)', $5)`, [org, pA, d.id, a.legal.userId, a.secretary.userId]);
    const r = await outcome(pA, a.secretary, d.id, v);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('governance.outcome.vote_integrity');
    expect((await decisionRow(d.id)).status).toBe('under_review');
    const dv = await decisionVersion(a.chair, pA, d.id);
    await a.chair.post(`${P(pA)}/decisions/${d.id}/defer`, { expectedVersion: dv, note: 'Integrity problem — new round needed (test)' }).expect(201);
  });
});

describe('DOM-P2-20 — attendance is frozen while voting is open [REQ-GOV-015, REQ-SEC-005]', () => {
  let meetingId: string;
  let seat: Map<string, string>;

  beforeAll(async () => {
    const members = (await a.secretary.get(`${P(pA)}/committees/${govA.committeeId}`).expect(200)).body.memberships as { id: string; userId: string | null }[];
    seat = new Map(members.filter((m) => m.userId).map((m) => [m.userId!, m.id]));
    const m = (await a.secretary.post(`${P(pA)}/committees/${govA.committeeId}/meetings`, { title: uniq('Attendance freeze meeting (test)'), scheduledAt: new Date().toISOString() }).expect(201)).body;
    const req = (await a.pm.post(`${P(pA)}/agenda-requests`, { committeeId: govA.committeeId, title: 'Status (information)', kind: 'information', meetingId: m.id }).expect(201)).body;
    await a.secretary.post(`${P(pA)}/agenda-requests/${req.id}/screen`, { expectedVersion: req.version, outcome: 'accept', meetingId: m.id }).expect(201);
    let v = (await a.secretary.post(`${P(pA)}/meetings/${m.id}/publish-agenda`, { expectedVersion: m.version }).expect(201)).body.version;
    v = (await a.secretary.post(`${P(pA)}/meetings/${m.id}/start`, { expectedVersion: v }).expect(201)).body.version;
    await a.secretary
      .post(`${P(pA)}/meetings/${m.id}/attendance`, { entries: (['chair', 'sponsor', 'finance', 'legal', 'approver'] as const).map((k) => ({ membershipId: seat.get(a[k].userId)!, status: 'present' })) })
      .expect(201);
    meetingId = m.id;
  });

  it('after the first vote, attendance cannot change (422, audited); after the outcome is recorded it can again', async () => {
    const d = await tabledDecision(pA, A(), a.pm, govA.committeeId, meetingId);
    const v = await decisionVersion(a.chair, pA, d.id);
    expect((await vote(pA, a.approver, d.id, 'approve', v)).status).toBe(201);
    const before = await rejectedCount(a.secretary.userId, 'governance.recordAttendance');
    const r = await a.secretary.post(`${P(pA)}/meetings/${meetingId}/attendance`, { entries: [{ membershipId: seat.get(a.approver.userId)!, status: 'absent' }] });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('governance.attendance.frozen_voting_open');
    expect(r.body.detail).toContain(d.code);
    expect(await rejectedCount(a.secretary.userId, 'governance.recordAttendance')).toBe(before + 1);
    expect((await owner().query(`select status from attendance where meeting_id = $1 and user_id = $2`, [meetingId, a.approver.userId])).rows[0].status).toBe('present');
    for (const k of ['chair', 'sponsor'] as const) expect((await vote(pA, a[k], d.id, 'approve', v)).status).toBe(201);
    expect((await outcome(pA, a.secretary, d.id, v)).status).toBe(201);
    await a.secretary.post(`${P(pA)}/meetings/${meetingId}/attendance`, { entries: [{ membershipId: seat.get(a.approver.userId)!, status: 'present' }] }).expect(201);
  });

  it('defense in depth: a voter marked absent behind the API makes the outcome refuse (votes of absent members are never counted silently)', async () => {
    const d = await tabledDecision(pA, A(), a.pm, govA.committeeId, meetingId);
    const v = await decisionVersion(a.chair, pA, d.id);
    for (const k of ['chair', 'sponsor', 'finance'] as const) expect((await vote(pA, a[k], d.id, 'approve', v)).status).toBe(201);
    await owner().query(`update attendance set status = 'absent' where meeting_id = $1 and user_id = $2`, [meetingId, a.finance.userId]);
    const r = await outcome(pA, a.secretary, d.id, v);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('governance.outcome.vote_integrity');
    await owner().query(`update attendance set status = 'present' where meeting_id = $1 and user_id = $2`, [meetingId, a.finance.userId]);
    expect((await outcome(pA, a.secretary, d.id, v)).status).toBe(201);
  });
});

describe('DOM-P2-13 — quorum fraction over the APPOINTED voting members (authority-matrix.md §3 step 4) [REQ-GOV-007]', () => {
  it('8 appointed, 3 recused, 3 eligible present: 50% of 8 = 4 required → no quorum; a fourth eligible member present → quorum', async () => {
    const c = (await a.secretary.post(`${P(pA)}/committees`, { kind: 'program_steering', name: uniq('Quorum denominator committee (test)'), charter: { purpose: 'Synthetic quorum test' } }).expect(201)).body;
    let v = (await a.sponsor.post(`${P(pA)}/committees/${c.id}/charter/approve`, { expectedVersion: c.version, approvalReference: 'TEST (synthetic)' }).expect(201)).body.version;
    await a.secretary.post(`${P(pA)}/committees/${c.id}/activate`, { expectedVersion: v }).expect(201);
    const seats = new Map<string, string>();
    const people: [string, string, 'chair' | 'sponsor' | 'voting_member'][] = [
      [a.chair.userId, 'Chair', 'chair'],
      [a.sponsor.userId, 'Sponsor', 'sponsor'],
      [a.finance.userId, 'Finance', 'voting_member'],
      [a.legal.userId, 'Legal', 'voting_member'],
      [a.approver.userId, 'Operations', 'voting_member'],
      [a.techLead.userId, 'Technology', 'voting_member'],
      [a.contributor.userId, 'Strategy', 'voting_member'],
      [govA.secretary2.userId, 'Corporate development', 'voting_member'],
    ];
    for (const [userId, label, memberRole] of people) {
      seats.set(userId, (await a.secretary.post(`${P(pA)}/committees/${c.id}/memberships`, { userId, roleLabel: `${label} (test persona)`, memberRole, voting: true, validFrom: '2026-01-01' }).expect(201)).body.id);
    }
    await a.secretary.post(`${P(pA)}/committees/${c.id}/memberships`, { userId: a.secretary.userId, roleLabel: 'Secretary (test persona)', memberRole: 'secretary', voting: false, validFrom: '2026-01-01' }).expect(201);
    const mx = (await a.secretary.post(`${P(pA)}/committees/${c.id}/authority-matrix-versions`, { policy: DEMO_AUTHORITY_POLICY, effectiveFrom: '2026-01-01' }).expect(201)).body;
    await a.sponsor.post(`${P(pA)}/committees/${c.id}/authority-matrix-versions/${mx.id}/approve`, { approvalReference: 'TEST DEMO matrix (synthetic)' }).expect(201);
    const m = (await a.secretary.post(`${P(pA)}/committees/${c.id}/meetings`, { title: uniq('Quorum meeting (test)'), scheduledAt: new Date().toISOString() }).expect(201)).body;
    const req = (await a.pm.post(`${P(pA)}/agenda-requests`, { committeeId: c.id, title: 'Status (information)', kind: 'information', meetingId: m.id }).expect(201)).body;
    await a.secretary.post(`${P(pA)}/agenda-requests/${req.id}/screen`, { expectedVersion: req.version, outcome: 'accept', meetingId: m.id }).expect(201);
    v = (await a.secretary.post(`${P(pA)}/meetings/${m.id}/publish-agenda`, { expectedVersion: m.version }).expect(201)).body.version;
    await a.secretary.post(`${P(pA)}/meetings/${m.id}/start`, { expectedVersion: v }).expect(201);
    const recusedIds = [a.techLead.userId, a.contributor.userId, govA.secretary2.userId];
    const presentIds = [a.chair.userId, a.sponsor.userId, a.finance.userId, ...recusedIds];
    await a.secretary.post(`${P(pA)}/meetings/${m.id}/attendance`, { entries: presentIds.map((u) => ({ membershipId: seats.get(u)!, status: 'present' })) }).expect(201);
    const d = await tabledDecision(pA, A(), a.pm, c.id, m.id);
    for (const u of recusedIds) await a.secretary.post(`${P(pA)}/decisions/${d.id}/recusals`, { userId: u, reason: 'Declared interest (test)' }).expect(201);
    const dv = await decisionVersion(a.chair, pA, d.id);
    const refused = await vote(pA, a.chair, d.id, 'approve', dv);
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('governance.vote.no_quorum');
    // The old rule (fraction of the 5 members left after recusals = 3) would have accepted this vote.
    expect(refused.body.detail).toMatch(/Quorum NOT met: 3 of 5 eligible voting members present \(required 4: at least 3 and 50% of 8 appointed voting members\)/);
    await a.secretary.post(`${P(pA)}/meetings/${m.id}/attendance`, { entries: [{ membershipId: seats.get(a.legal.userId)!, status: 'present' }] }).expect(201);
    expect((await vote(pA, a.chair, d.id, 'approve', dv)).status).toBe(201);
  });
});

describe('DOM-P2-03 — change requests act on the approved authority matrix; above it only on a final committee decision [REQ-PLN-013, REQ-GOV-022, AT-04]', () => {
  const newCr = async (over: Record<string, unknown>) => {
    const cr = await a.pm.post(`${P(pA)}/change-requests`, {
      title: uniq('Synthetic change request'),
      rationale: 'Authority test (synthetic)',
      alternatives: ['Do nothing'],
      impacts: { scope: 'Synthetic scope change' },
      ...over,
    });
    expect(cr.status, JSON.stringify(cr.body)).toBe(201);
    await a.pm.post(`${P(pA)}/change-requests/${cr.body.id}/submit`, { expectedVersion: 1 }).expect(201);
    await a.pm.post(`${P(pA)}/change-requests/${cr.body.id}/start-review`, { expectedVersion: 2 }).expect(201);
    return cr.body.id as string;
  };
  const approve = (id: string, body: Record<string, unknown> = {}) => a.sponsor.post(`${P(pA)}/change-requests/${id}/approve`, { expectedVersion: 3, note: 'test', ...body });
  let above: string;
  let recommendationId: string;

  it('within the DEMO limit (quantified cost) → approved, the authority basis is audited', async () => {
    const id = await newCr({ costImpact: { amount: '250000.0000', currency: 'SAR', unitScale: 1 } });
    const r = await approve(id);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.status).toBe('approved');
    const audit = await auditRow(id, 'planning.change_request.approve');
    expect(audit?.after).toMatchObject({
      status: 'approved',
      costImpact: { amount: '250000.0000', currency: 'SAR', unitScale: 1 },
      authority: { basis: 'delegated_authority', decisionTypeKey: 'change_request_budget', matrixSource: 'approved_matrix', decisionId: null },
    });
  });

  it('above the limit → 422 outside_delegated_authority with the body to escalate to (audited); another currency is not compared', async () => {
    above = await newCr({ costImpact: { amount: '1500000.0000', currency: 'SAR', unitScale: 1 } });
    const before = await rejectedCount(a.sponsor.userId, 'planning.approveChangeRequest');
    const r = await approve(above);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('change_control.outside_delegated_authority');
    expect(r.body.details).toMatchObject({ decisionTypeKey: 'change_request_budget', escalateTo: 'Delegating authority — to be confirmed', matrixSource: 'approved_matrix' });
    expect(await rejectedCount(a.sponsor.userId, 'planning.approveChangeRequest')).toBe(before + 1);
    expect((await owner().query(`select status from change_request where id = $1`, [above])).rows[0].status).toBe('under_review');
    const usd = await newCr({ costImpact: { amount: '10.0000', currency: 'USD', unitScale: 1 } });
    expect((await approve(usd)).body.code).toBe('change_control.outside_delegated_authority');
  });

  it('the requester is refused by separation of duties (403) before any authority evaluation', async () => {
    await grant(admin, pA, a.pm, 'sponsor');
    const own = await a.pm.post(`${P(pA)}/change-requests/${above}/approve`, { expectedVersion: 3 });
    expect(own.status).toBe(403);
    expect(own.body.detail).toMatch(/Separation of duties/);
  });

  it('routed to the committee: a recommendation is not enough; the externally approved decision of the matching type backs the approval', async () => {
    const d = await tabledDecision(pA, A(), a.pm, govA.committeeId, govA.meetingId, { decisionTypeKey: 'change_request_budget', amount: { amount: '1500000.0000', currency: 'SAR', unitScale: 1 } });
    const v = await decisionVersion(a.chair, pA, d.id);
    for (const k of ['chair', 'sponsor', 'finance', 'legal'] as const) expect((await vote(pA, a[k], d.id, 'approve', v)).status).toBe(201);
    const out = await outcome(pA, a.secretary, d.id, v);
    expect(out.body).toMatchObject({ status: 'recommended', authorityOutcome: 'pending_external_authority' });
    recommendationId = d.id;
    const notFinal = await approve(above, { decisionId: d.id });
    expect(notFinal.status).toBe(422);
    expect(notFinal.body.code).toBe('change_control.decision_not_final');

    const evidenceLinkId = await verifiedDecisionEvidence(pA, a.pm, a.legal, d.id);
    const ev = await decisionVersion(a.chair, pA, d.id);
    await govA.secretary2.post(`${P(pA)}/decisions/${d.id}/record-external-approval`, { expectedVersion: ev, outcome: 'approved', externalReference: 'DEMO-DELEGATING-AUTHORITY-CR (synthetic)', evidenceLinkId }).expect(201);
    const ok = await approve(above, { decisionId: d.id });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const cr = (await a.pm.get(`${P(pA)}/change-requests/${above}`).expect(200)).body;
    expect(cr).toMatchObject({ status: 'approved', decisionId: d.id, costImpact: { amount: '1500000.0000', currency: 'SAR', unitScale: 1 } });
    expect((await auditRow(above, 'planning.change_request.approve'))?.after).toMatchObject({ authority: { basis: 'governance_decision', decisionId: d.id } });
  });

  it('the decision must be of the matching type, cover the amount, belong to the project, and back one approval only', async () => {
    const other = await newCr({ costImpact: { amount: '1200000.0000', currency: 'SAR', unitScale: 1 } });
    const reused = await approve(other, { decisionId: recommendationId });
    expect(reused.status).toBe(422);
    expect(reused.body.code).toBe('change_control.decision_already_used');
    // A final decision of another type (the probe's operational gate decisions are within mandate).
    const gateType = await tabledDecision(pA, A(), a.pm, govA.committeeId, govA.meetingId, { decisionTypeKey: 'gate_decision_operational', amount: null });
    const gv = await decisionVersion(a.chair, pA, gateType.id);
    for (const k of ['chair', 'sponsor', 'finance'] as const) expect((await vote(pA, a[k], gateType.id, 'approve', gv)).status).toBe(201);
    expect((await outcome(pA, a.secretary, gateType.id, gv)).body.status).toBe('approved');
    expect((await approve(other, { decisionId: gateType.id })).body.code).toBe('change_control.decision_type_mismatch');
    // A smaller approved amount does not cover the change.
    const small = await tabledDecision(pA, A(), a.pm, govA.committeeId, govA.meetingId, { decisionTypeKey: 'change_request_budget', amount: { amount: '100000.0000', currency: 'SAR', unitScale: 1 } });
    const sv = await decisionVersion(a.chair, pA, small.id);
    for (const k of ['chair', 'sponsor', 'finance'] as const) expect((await vote(pA, a[k], small.id, 'approve', sv)).status).toBe(201);
    expect((await outcome(pA, a.secretary, small.id, sv)).body.status).toBe('approved');
    expect((await approve(other, { decisionId: small.id })).body.code).toBe('change_control.decision_amount_insufficient');
    // A decision id of another project is never trusted (404).
    const foreign = (await owner().query(`select id from decision where project_id <> $1 limit 1`, [pA])).rows[0]?.id as string | undefined;
    if (foreign) expect((await approve(other, { decisionId: foreign })).status).toBe(404);
    expect((await owner().query(`select status, decision_id from change_request where id = $1`, [other])).rows[0]).toMatchObject({ status: 'under_review', decision_id: null });
  });
});

describe('DOM-P2-03 / DOM-P2-12 — non-demo project: no authority without an approved, VERIFIED matrix [REQ-GOV-010, REQ-GOV-011, REQ-PLN-004]', () => {
  let committeeId: string;
  let matrixId: string;
  let baselineId: string;
  let docId: string;

  it('baseline approval is refused while no approved matrix exists (422, audited)', async () => {
    const ws = await workstreams(a.pm, pN);
    await task(a.pm, pN, ws.get('WS01')!.id, 'Dated task (synthetic)', { durationDays: 5, plannedStart: '2026-10-04', plannedFinish: '2026-10-08' });
    baselineId = (await a.pm.post(`${P(pN)}/baselines`, { note: 'v1 (test)' }).expect(201)).body.id;
    const before = await rejectedCount(a.sponsor.userId, 'planning.approveBaseline');
    const r = await a.sponsor.post(`${P(pN)}/baselines/${baselineId}/approve`, { expectedVersion: 1 });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('change_control.no_usable_matrix');
    expect(await rejectedCount(a.sponsor.userId, 'planning.approveBaseline')).toBe(before + 1);
    expect((await owner().query(`select status from baseline_version where id = $1`, [baselineId])).rows[0].status).toBe('proposed');
  });

  it('a non-demo matrix needs its approval document (422 without); with it the approval awaits a second-person verification and is not in force', async () => {
    const c = (await a.secretary.post(`${P(pN)}/committees`, { kind: 'program_steering', name: uniq('Non-demo steering (test)'), charter: { purpose: 'Synthetic' } }).expect(201)).body;
    committeeId = c.id;
    const v = (await a.sponsor.post(`${P(pN)}/committees/${c.id}/charter/approve`, { expectedVersion: c.version }).expect(201)).body.version;
    await a.secretary.post(`${P(pN)}/committees/${c.id}/activate`, { expectedVersion: v }).expect(201);
    matrixId = (await a.secretary.post(`${P(pN)}/committees/${c.id}/authority-matrix-versions`, { policy: { ...DEMO_AUTHORITY_POLICY, isDemoPolicy: false }, effectiveFrom: '2026-01-01' }).expect(201)).body.id;
    const noDoc = await a.sponsor.post(`${P(pN)}/committees/${c.id}/authority-matrix-versions/${matrixId}/approve`, { approvalReference: 'TEST-DELEGATION-REF (synthetic)' });
    expect(noDoc.status).toBe(422);
    expect(noDoc.body.code).toBe('governance.authority_matrix.evidence_required');
    const pmDoc = await docLogin('pm');
    docId = (await createWithVersion(pmDoc, pN, { title: 'Delegation record (synthetic test)', classification: 'internal' }, { bytes: Buffer.from('Synthetic delegation record (test).'), name: 'delegation.txt' })).id;
    const ap = await a.sponsor.post(`${P(pN)}/committees/${c.id}/authority-matrix-versions/${matrixId}/approve`, { approvalReference: 'TEST-DELEGATION-REF (synthetic)', approvalDocumentId: docId });
    expect(ap.status, JSON.stringify(ap.body)).toBe(201);
    expect(ap.body).toMatchObject({ status: 'draft', pendingVerification: true });
    expect((await a.secretary.get(`${P(pN)}/committees/${c.id}`).expect(200)).body.activeMatrix).toBeNull();
    const again = await a.sponsor.post(`${P(pN)}/committees/${c.id}/authority-matrix-versions/${matrixId}/approve`, { approvalReference: 'x', approvalDocumentId: docId });
    expect(again.body.code).toBe('governance.authority_matrix.approval_pending_verification');
    // Still no approval authority for the baseline.
    expect((await a.sponsor.post(`${P(pN)}/baselines/${baselineId}/approve`, { expectedVersion: 1 })).body.code).toBe('change_control.no_usable_matrix');
  });

  it('verification: never by the approver or the drafter (403); a rejection needs a reason and clears the approval; acceptance brings the matrix into force', async () => {
    const path = `${P(pN)}/committees/${committeeId}/authority-matrix-versions/${matrixId}/verify-approval`;
    expect((await a.sponsor.post(path, { decision: 'accept' })).status).toBe(403); // approver (and no verify permission)
    const drafter = await a.secretary.post(path, { decision: 'accept' });
    expect(drafter.status).toBe(403);
    expect(drafter.body.detail).toMatch(/Separation of duties/);
    expect((await a.legal.post(path, { decision: 'reject' })).body.code).toBe('governance.authority_matrix.rejection_reason_required');
    const rej = await a.legal.post(path, { decision: 'reject', note: 'The record does not match the loaded limits (test)' });
    expect(rej.status, JSON.stringify(rej.body)).toBe(201);
    let mx = ((await a.secretary.get(`${P(pN)}/committees/${committeeId}/authority-matrix-versions`).expect(200)).body.items as Record<string, unknown>[]).find((x) => x.id === matrixId)!;
    expect(mx).toMatchObject({ status: 'draft', pendingVerification: false, approvedBy: null, approvalDocumentId: null });
    await a.sponsor.post(`${P(pN)}/committees/${committeeId}/authority-matrix-versions/${matrixId}/approve`, { approvalReference: 'TEST-DELEGATION-REF-2 (synthetic)', approvalDocumentId: docId }).expect(201);
    const acc = await a.legal.post(path, { decision: 'accept', note: 'Checked against the loaded values (test)' });
    expect(acc.status, JSON.stringify(acc.body)).toBe(201);
    expect(acc.body).toMatchObject({ status: 'approved', approvalVerifiedBy: a.legal.userId });
    mx = ((await a.secretary.get(`${P(pN)}/committees/${committeeId}/authority-matrix-versions`).expect(200)).body.items as Record<string, unknown>[]).find((x) => x.id === matrixId)!;
    expect(mx).toMatchObject({ status: 'approved', pendingVerification: false, approvalDocumentId: docId, approvalVerifiedBy: a.legal.userId, approvedBy: a.sponsor.userId });
    expect((await a.secretary.get(`${P(pN)}/committees/${committeeId}`).expect(200)).body.activeMatrix).toMatchObject({ id: matrixId, isDemoPolicy: false, usable: true });
    expect((await auditRow(matrixId, 'governance.authority_matrix.verify_approval'))?.actor_user_id).toBe(a.legal.userId);
  });

  it('with the verified matrix in force, the sponsor approves the baseline within the baseline_approval delegation (audited basis)', async () => {
    const r = await a.sponsor.post(`${P(pN)}/baselines/${baselineId}/approve`, { expectedVersion: 1, note: 'within delegation (test)' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await auditRow(baselineId, 'planning.baseline.approve'))?.after).toMatchObject({
      authority: { basis: 'delegated_authority', decisionTypeKey: 'baseline_approval', matrixSource: 'approved_matrix', matrixVersionId: matrixId },
    });
  });
});

describe('DOM-P2-12 — an external authority decision rests on a verified evidence link on the decision [REQ-GOV-023, AT-04]', () => {
  it('no evidence, unverified evidence, evidence of another decision → 422; the verifier cannot record (403); verified evidence → recorded', async () => {
    const d = await tabledDecision(pA, A(), a.pm, govA.committeeId, govA.meetingId, { decisionTypeKey: 'jv_signing_authorization', amount: null, requiredAuthority: 'Board of Directors — to be confirmed' });
    const v = await decisionVersion(a.chair, pA, d.id);
    for (const k of ['chair', 'sponsor', 'finance', 'legal'] as const) expect((await vote(pA, a[k], d.id, 'approve', v)).status).toBe(201);
    expect((await outcome(pA, a.secretary, d.id, v)).body.status).toBe('recommended');
    const rec = (body: Record<string, unknown>, who: Client = a.chair) =>
      decisionVersion(a.chair, pA, d.id).then((ev) => who.post(`${P(pA)}/decisions/${d.id}/record-external-approval`, { expectedVersion: ev, outcome: 'approved', externalReference: 'DEMO-BOARD-RESOLUTION (synthetic)', ...body }));

    expect((await rec({})).body.code).toBe('governance.external.evidence_required');
    const unverified = (await a.pm.post(`${P(pA)}/evidence`, { targetType: 'decision', targetId: d.id, note: 'Unverified record (test)' }).expect(201)).body.id;
    expect((await rec({ evidenceLinkId: unverified })).body.code).toBe('governance.external.evidence_unverified');
    const elsewhere = await verifiedDecisionEvidence(pA, a.pm, a.legal, otherDecisionId);
    expect((await rec({ evidenceLinkId: elsewhere })).body.code).toBe('governance.external.evidence_other_target');
    // The secretariat member who verified the evidence cannot also record the decision it evidences.
    const byS2 = await verifiedDecisionEvidence(pA, a.pm, govA.secretary2, d.id, 'Record verified by the second secretary (test)');
    const sod = await rec({ evidenceLinkId: byS2 }, govA.secretary2);
    expect(sod.status).toBe(403);
    expect(sod.body.detail).toMatch(/Separation of duties/);
    expect((await decisionRow(d.id)).status).toBe('recommended');
    const ok = await rec({ evidenceLinkId: byS2 }, a.chair);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(await decisionRow(d.id)).toMatchObject({ status: 'approved', external_evidence_link_id: byS2 });
    expect((await a.pm.get(`${P(pA)}/decisions/${d.id}`).expect(200)).body.externalEvidenceLinkId).toBe(byS2);
  });
});

