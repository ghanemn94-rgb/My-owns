import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner, projectIdByCode, DC } from '../helpers';
import { setupProject, setupGovernance, Personas, Gov } from '../gates/gate-test-kit';
import { Actors, P, closeVoting, decisionRow, decisionVersion, paper, plusDays, tabledDecision, uniq, vote } from './gov-fixtures';

/**
 * P2 domain re-review fixes in the governance module (docs/reviews/P2-domain-rereview.md):
 *  - DOM-P2R-01 — voting closes when every eligible member voted, or the chair closes it (meeting AND circulation);
 *  - REQ-GOV-015 (F-01) — the member's own conflict-of-interest declaration for the item precedes the vote;
 *  - DOM-P2-14 (REQ-GOV-014) — a paper cites supporting evidence or states "none" with a reason;
 *  - DOM-P2R-03 — the paper's subject: validated in the project when drafted, fixed from the first submission.
 * One gate-kit project (synthetic, demo-flagged) with the DEMO matrix; the kit's meeting records chair, sponsor, finance and
 * legal present (the approver seat is not present).
 */
let pid: string;
let p: Personas;
let gov: Gov;
const A = () => p as unknown as Actors;

beforeAll(async () => {
  ({ projectId: pid, p } = await setupProject('P2R-GOV'));
  gov = await setupGovernance(pid, p);
}, 600_000);

afterAll(async () => {
  await closeApp();
  await closePools();
});

const newCr = async (title: string) => {
  const cr = await p.pm.post(`${P(pid)}/change-requests`, { title: uniq(title), rationale: 'Synthetic rationale (test)', alternatives: ['Do nothing'], impacts: { scope: 'Synthetic' } });
  expect(cr.status, JSON.stringify(cr.body)).toBe(201);
  return cr.body.id as string;
};

describe('DOM-P2R-01 — the vote is complete before an outcome is recorded [REQ-GOV-016, REQ-GOV-015; proposed rule, Q-40]', () => {
  it('meeting: the voting state lists who has not voted; complete once every present eligible member voted', async () => {
    const d = await tabledDecision(pid, A(), p.pm, gov.committeeId, gov.meetingId, { title: uniq('Voting state (test)') });
    const v = await decisionVersion(p.chair, pid, d.id);
    for (const k of ['chair', 'sponsor'] as const) expect((await vote(pid, p[k], d.id, 'approve', v)).status).toBe(201);
    let detail = (await p.secretary.get(`${P(pid)}/decisions/${d.id}`).expect(200)).body;
    expect(detail.voting).toMatchObject({ round: 1, outstanding: 2, complete: false, closed: false, chairUserId: p.chair.userId });
    expect(detail.voting.outstandingUserIds.sort()).toEqual([p.finance.userId, p.legal.userId].sort());
    expect(detail.voting.declaredUserIds.sort()).toEqual([p.chair.userId, p.sponsor.userId].sort());
    const refused = await p.secretary.post(`${P(pid)}/decisions/${d.id}/record-outcome`, { expectedVersion: v });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'governance.outcome.votes_outstanding', details: { round: 1, outstanding: 2 } });
    for (const k of ['finance', 'legal'] as const) expect((await vote(pid, p[k], d.id, 'reject', v)).status).toBe(201);
    detail = (await p.secretary.get(`${P(pid)}/decisions/${d.id}`).expect(200)).body;
    expect(detail.voting).toMatchObject({ outstanding: 0, complete: true });
    const out = await p.secretary.post(`${P(pid)}/decisions/${d.id}/record-outcome`, { expectedVersion: v });
    expect(out.status, JSON.stringify(out.body)).toBe(201);
    // 2 approve / 2 reject under the DEMO "escalate" tie rule: no approval, escalated.
    expect(out.body.outcome).toBe('tie_escalate');
    expect(((await decisionRow(d.id))['tally_snapshot'] as { voting: unknown }).voting).toMatchObject({ complete: 'all_voted', notVoted: [] });
  });

  it('closing needs a reason (400) and a decision under review; a new round (defer → resume) reopens voting', async () => {
    const d = await tabledDecision(pid, A(), p.pm, gov.committeeId, gov.meetingId, { title: uniq('Close and reopen (test)') });
    const v = await decisionVersion(p.chair, pid, d.id);
    expect((await vote(pid, p.chair, d.id, 'approve', v)).status).toBe(201);
    expect((await p.chair.post(`${P(pid)}/decisions/${d.id}/close-voting`, { expectedVersion: v, reason: '' })).status).toBe(400);
    const closed = await closeVoting(pid, p.chair, d.id, 'Session ended before the remaining votes (synthetic)');
    expect(closed).toMatchObject({ round: 1, notVoted: 3 });
    const twice = await p.chair.post(`${P(pid)}/decisions/${d.id}/close-voting`, { expectedVersion: closed.version, reason: 'again' });
    expect(twice.status).toBe(422);
    expect(twice.body.code).toBe('governance.voting.already_closed');
    const audit = (await owner().query(`select after, reason from audit_event where entity_id = $1 and action = 'governance.decision.close_voting'`, [d.id])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].reason).toBe('Session ended before the remaining votes (synthetic)');
    expect((audit[0].after as { notVoted: string[] }).notVoted).toHaveLength(3);
    // Defer → resume opens round 2: voting is open again (the closure applied to round 1 only).
    const df = await p.secretary.post(`${P(pid)}/decisions/${d.id}/defer`, { expectedVersion: closed.version, note: 'Deferred (synthetic)' });
    expect(df.status, JSON.stringify(df.body)).toBe(201);
    const rs = await p.secretary.post(`${P(pid)}/decisions/${d.id}/resume`, { expectedVersion: df.body.version, meetingId: gov.meetingId });
    expect(rs.status, JSON.stringify(rs.body)).toBe(201);
    expect(rs.body.voteRound).toBe(2);
    expect((await vote(pid, p.sponsor, d.id, 'approve', rs.body.version)).status).toBe(201);
    const detail = (await p.secretary.get(`${P(pid)}/decisions/${d.id}`).expect(200)).body;
    expect(detail.voting).toMatchObject({ round: 2, closed: false, outstanding: 3 });
    // Close the round so the meeting has no open voting left for the other tests.
    await closeVoting(pid, p.chair, d.id);
    expect((await p.secretary.post(`${P(pid)}/decisions/${d.id}/record-outcome`, { expectedVersion: await decisionVersion(p.chair, pid, d.id) })).status).toBe(201);
  });

  it('circulation: every eligible appointed member is expected to respond — quorum of responders alone is not enough', async () => {
    const d = await tabledDecision(pid, A(), p.pm, gov.committeeId, null, { title: uniq('Circulation completeness (test)') });
    const c = await p.secretary.post(`${P(pid)}/decisions/${d.id}/circulate`, { expectedVersion: d.version, responseDeadline: plusDays(5) });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const v = c.body.version as number;
    for (const k of ['chair', 'sponsor', 'finance'] as const) expect((await vote(pid, p[k], d.id, 'approve', v)).status).toBe(201);
    // Three responders meet the DEMO quorum (3), but Legal and the approver (appointed voting members) have not responded.
    const early = await p.secretary.post(`${P(pid)}/decisions/${d.id}/record-outcome`, { expectedVersion: v });
    expect(early.status, JSON.stringify(early.body)).toBe(422);
    expect(early.body).toMatchObject({ code: 'governance.outcome.votes_outstanding', details: { outstanding: 2 } });
    for (const k of ['legal', 'approver'] as const) expect((await vote(pid, p[k], d.id, 'approve', v)).status).toBe(201);
    const out = await p.secretary.post(`${P(pid)}/decisions/${d.id}/record-outcome`, { expectedVersion: v });
    expect(out.status, JSON.stringify(out.body)).toBe(201);
    expect(out.body.status).toBe('approved');
  });
});

describe('REQ-GOV-015 — a conflict-of-interest declaration for the item precedes the vote', () => {
  it('no declaration → 422; an on-behalf "no conflict" does not count; the member’s own declaration (meeting endpoint or with the vote) does', async () => {
    const d = await tabledDecision(pid, A(), p.pm, gov.committeeId, gov.meetingId, { title: uniq('Declarations (test)') });
    const v = await decisionVersion(p.chair, pid, d.id);
    const bare = await vote(pid, p.chair, d.id, 'approve', v, { declare: false });
    expect(bare.status, JSON.stringify(bare.body)).toBe(422);
    expect(bare.body.code).toBe('governance.vote.declaration_required');
    expect((await owner().query(`select count(*)::int n from vote where decision_id = $1`, [d.id])).rows[0].n).toBe(0);
    // The secretariat records "no conflict" on the chair's behalf: not the member's own declaration.
    const behalf = await p.secretary.post(`${P(pid)}/meetings/${gov.meetingId}/conflicts`, { userId: p.chair.userId, decisionId: d.id, declaration: 'no_conflict' });
    expect(behalf.status, JSON.stringify(behalf.body)).toBe(201);
    expect((await vote(pid, p.chair, d.id, 'approve', v, { declare: false })).status).toBe(422);
    // The chair's own declaration through the meeting's conflict register.
    expect((await p.chair.post(`${P(pid)}/meetings/${gov.meetingId}/conflicts`, { decisionId: d.id, declaration: 'no_conflict' })).status).toBe(201);
    expect((await vote(pid, p.chair, d.id, 'approve', v, { declare: false })).status).toBe(201);
    // A declared interest (the chair may rule a recusal) also allows the vote.
    expect((await p.sponsor.post(`${P(pid)}/meetings/${gov.meetingId}/conflicts`, { decisionId: d.id, declaration: 'interest_declared', description: 'Minor shareholding (synthetic)' })).status).toBe(201);
    expect((await vote(pid, p.sponsor, d.id, 'approve', v, { declare: false })).status).toBe(201);
    // "No conflict" given with the vote is recorded (append-only register, audited) before the vote in one transaction.
    expect((await vote(pid, p.finance, d.id, 'approve', v)).status).toBe(201);
    const rows = (await owner().query(`select user_id, recorded_by, declaration from conflict_declaration where decision_id = $1 and user_id = $2`, [d.id, p.finance.userId])).rows;
    expect(rows).toEqual([{ user_id: p.finance.userId, recorded_by: p.finance.userId, declaration: 'no_conflict' }]);
    // A member with a conflict recuses instead of voting.
    expect((await p.legal.post(`${P(pid)}/decisions/${d.id}/recusals`, { reason: 'Conflict: advised the counterparty (synthetic)' })).status).toBe(201);
    expect((await vote(pid, p.legal, d.id, 'approve', v)).body.code).toBe('governance.vote.recused');
    expect((await p.secretary.post(`${P(pid)}/decisions/${d.id}/record-outcome`, { expectedVersion: v })).status).toBe(201);
  });
});

describe('DOM-P2-14 — supporting evidence (or "none" with a reason) before submission [REQ-GOV-014]', () => {
  it('refused without evidence and without a reason; accepted with an evidence link on the paper, or with a reason', async () => {
    const draft = (await p.pm.post(`${P(pid)}/decisions`, paper(gov.committeeId, { title: uniq('Evidence rule (test)'), evidenceNoneReason: null })).expect(201)).body;
    let detail = (await p.pm.get(`${P(pid)}/decisions/${draft.id}`).expect(200)).body;
    expect(detail.missingFields).toEqual(['supportingEvidence']);
    expect(detail.supportingEvidenceLinks).toBe(0);
    const refused = await p.pm.post(`${P(pid)}/decisions/${draft.id}/submit`, { expectedVersion: draft.version });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'governance.decision.incomplete_paper', details: { missing: ['supportingEvidence'] } });
    const link = await p.pm.post(`${P(pid)}/evidence`, { targetType: 'decision', targetId: draft.id, note: 'Supporting analysis (synthetic)', purpose: 'Supporting evidence (test)' });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    detail = (await p.pm.get(`${P(pid)}/decisions/${draft.id}`).expect(200)).body;
    expect(detail).toMatchObject({ missingFields: [], supportingEvidenceLinks: 1 });
    expect((await p.pm.post(`${P(pid)}/decisions/${draft.id}/submit`, { expectedVersion: draft.version })).status).toBe(201);
    // The explicit "none — reason" entry.
    const other = (await p.pm.post(`${P(pid)}/decisions`, paper(gov.committeeId, { title: uniq('Evidence none (test)'), evidenceNoneReason: 'No documents exist for this synthetic item' })).expect(201)).body;
    expect((await p.pm.post(`${P(pid)}/decisions/${other.id}/submit`, { expectedVersion: other.version })).status).toBe(201);
    expect((await p.pm.get(`${P(pid)}/decisions/${other.id}`).expect(200)).body.evidenceNoneReason).toBe('No documents exist for this synthetic item');
  });
});

describe('DOM-P2R-03 — the subject of a paper: a record of the project awaiting approval, fixed from the first submission', () => {
  it('validated in the project (404 for another project), open records only (422), both fields together (400), locked after submission', async () => {
    const cr = await newCr('Subject change (test)');
    const cr2 = await newCr('Other change (test)');
    // Another project's change request (the PM is a member of DEMO-DC too): 404, no existence oracle.
    const dcCr = (await owner().query<{ id: string }>(`select id from change_request where project_id = $1 limit 1`, [await projectIdByCode(DC)])).rows[0];
    if (dcCr) expect((await p.pm.post(`${P(pid)}/decisions`, paper(gov.committeeId, { subjectType: 'change_request', subjectId: dcCr.id }))).status).toBe(404);
    expect((await p.pm.post(`${P(pid)}/decisions`, paper(gov.committeeId, { subjectType: 'change_request' }))).status).toBe(400);
    const d = (await p.pm.post(`${P(pid)}/decisions`, paper(gov.committeeId, { title: uniq('Paper for a change (test)'), subjectType: 'change_request', subjectId: cr })).expect(201)).body;
    let detail = (await p.pm.get(`${P(pid)}/decisions/${d.id}`).expect(200)).body;
    expect(detail).toMatchObject({ subjectType: 'change_request', subjectId: cr, subject: { type: 'change_request', id: cr }, firstSubmittedAt: null });
    expect(detail.subject.label).toMatch(/^CR-/);
    // Before submission the requester may still change it.
    const moved = await p.pm.patch(`${P(pid)}/decisions/${d.id}`, { expectedVersion: d.version, subjectType: 'change_request', subjectId: cr2 });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const back = await p.pm.patch(`${P(pid)}/decisions/${d.id}`, { expectedVersion: moved.body.version, subjectType: 'change_request', subjectId: cr });
    expect(back.status).toBe(200);
    const sub = await p.pm.post(`${P(pid)}/decisions/${d.id}/submit`, { expectedVersion: back.body.version });
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    // The secretariat returns it to draft: the subject stays fixed.
    const ret = await p.secretary.post(`${P(pid)}/decisions/${d.id}/return`, { expectedVersion: sub.body.version, note: 'Clarify the recommendation (synthetic)' });
    expect(ret.status, JSON.stringify(ret.body)).toBe(201);
    const locked = await p.pm.patch(`${P(pid)}/decisions/${d.id}`, { expectedVersion: ret.body.version, subjectType: 'change_request', subjectId: cr2 });
    expect(locked.status).toBe(422);
    expect(locked.body.code).toBe('governance.decision.subject_locked');
    expect((await p.pm.patch(`${P(pid)}/decisions/${d.id}`, { expectedVersion: ret.body.version, subjectType: null, subjectId: null })).body.code).toBe('governance.decision.subject_locked');
    // Other edits of the returned draft remain possible.
    expect((await p.pm.patch(`${P(pid)}/decisions/${d.id}`, { expectedVersion: ret.body.version, recommendation: 'Approve (clarified, synthetic)' })).status).toBe(200);
    detail = (await p.pm.get(`${P(pid)}/decisions/${d.id}`).expect(200)).body;
    expect(detail.subjectId).toBe(cr);
    expect(detail.firstSubmittedAt).not.toBeNull();
    // The register filter used by the approval pickers.
    const listed = (await p.sponsor.get(`${P(pid)}/decisions?subjectType=change_request&subjectId=${cr}`).expect(200)).body.items as { id: string }[];
    expect(listed.map((x) => x.id)).toEqual([d.id]);
    expect((await p.sponsor.get(`${P(pid)}/decisions?subjectType=change_request&subjectId=${cr2}`).expect(200)).body.total).toBe(0);
    // A decided change request is not open for a new paper.
    await p.pm.post(`${P(pid)}/change-requests/${cr2}/submit`, { expectedVersion: 1 }).expect(201);
    await p.pm.post(`${P(pid)}/change-requests/${cr2}/withdraw`, { expectedVersion: 2, reason: 'Not needed (synthetic)' }).expect(201);
    const closed = await p.pm.post(`${P(pid)}/decisions`, paper(gov.committeeId, { subjectType: 'change_request', subjectId: cr2 }));
    expect(closed.status).toBe(422);
    expect(closed.body.code).toBe('governance.decision.subject_not_open');
  });

  it('DB: the subject is a record of the decision’s own project (same-project trigger); type and id go together (check)', async () => {
    const dcCr = (await owner().query<{ id: string }>(`select id from change_request where project_id = $1 limit 1`, [await projectIdByCode(DC)])).rows[0];
    const d = (await owner().query<{ id: string }>(`select id from decision where project_id = $1 limit 1`, [pid])).rows[0]!;
    if (dcCr) await expect(owner().query(`update decision set subject_type = 'change_request', subject_id = $1 where id = $2`, [dcCr.id, d.id])).rejects.toThrow(/cross_project_reference/);
    await expect(owner().query(`update decision set subject_type = 'change_request', subject_id = null where id = $1`, [d.id])).rejects.toThrow(/decision_subject_ck/);
  });
});
