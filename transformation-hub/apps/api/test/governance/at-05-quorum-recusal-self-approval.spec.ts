import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, owner, projectIdByCode } from '../helpers';
import { Actors, P, TestCommittee, actors, auditCount, decisionRow, decisionVersion, openMeeting, paper, setupCommittee, tabledDecision, vote, voteRows } from './gov-fixtures';

let pid: string;
let a: Actors;
let tc: TestCommittee;
let meetingId: string;
let d1: { id: string };
let d2: { id: string };

beforeAll(async () => {
  pid = await projectIdByCode(DC);
  a = await actors();
  tc = await setupCommittee(pid, a);
  // Only 2 of the 5 voting members are present: DEMO quorum requires at least 3.
  meetingId = (await openMeeting(pid, a, tc, ['chair', 'sponsor', 'secretary'])).id;
  d1 = await tabledDecision(pid, a, a.pm, tc.id, meetingId);
});

afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('AT-05 — missing quorum, recused-member vote and prohibited self-approval are rejected server-side and logged [REQ-GOV-015, REQ-GOV-016, REQ-GOV-022, REQ-SEC]', () => {
  it('a vote without quorum present is rejected (422), audited, and no vote is stored', async () => {
    const before = await auditCount('governance.castVote', a.chair.userId, 'rejected');
    const r = await vote(pid, a.chair, d1.id, 'approve');
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('governance.vote.no_quorum');
    expect(r.body.detail).toMatch(/Quorum NOT met: 2 of 5/);
    expect(await auditCount('governance.castVote', a.chair.userId, 'rejected')).toBe(before + 1);
    expect(await voteRows(d1.id)).toBe(0);
  });

  it('recording an outcome without quorum is rejected (422) and audited; the decision is unchanged', async () => {
    const before = await auditCount('governance.recordOutcome', a.secretary.userId, 'rejected');
    const snapshot = await decisionRow(d1.id);
    const r = await a.secretary.post(`${P(pid)}/decisions/${d1.id}/record-outcome`, { expectedVersion: snapshot.version });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('governance.outcome.no_quorum');
    expect(await auditCount('governance.recordOutcome', a.secretary.userId, 'rejected')).toBe(before + 1);
    const after = await decisionRow(d1.id);
    expect(after.status).toBe('under_review');
    expect(after.version).toBe(snapshot.version);
    expect(after.tally_snapshot).toBeNull();
  });

  it('a client cannot supply its own quorum: extra body fields are ignored and the server recomputes', async () => {
    const v = await decisionVersion(a.secretary, pid, d1.id);
    const r = await a.secretary.post(`${P(pid)}/decisions/${d1.id}/record-outcome`, { expectedVersion: v, quorumMet: true, presentVoting: 5 });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('governance.outcome.no_quorum');
  });

  it('a recused member cannot vote (422, audited) and is excluded from quorum', async () => {
    await a.secretary.post(`${P(pid)}/meetings/${meetingId}/attendance`, { entries: ['finance', 'legal', 'approver'].map((k) => ({ membershipId: tc.memberships[k], status: 'present' })) }).expect(201);
    await a.legal.post(`${P(pid)}/decisions/${d1.id}/recusals`, { reason: 'Declared interest in the synthetic vendor' }).expect(201);
    const before = await auditCount('governance.castVote', a.legal.userId, 'rejected');
    const r = await vote(pid, a.legal, d1.id, 'approve');
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('governance.vote.recused');
    expect(await auditCount('governance.castVote', a.legal.userId, 'rejected')).toBe(before + 1);
    expect(await owner().query(`select 1 from vote where decision_id = $1 and user_id = $2`, [d1.id, a.legal.userId]).then((x) => x.rowCount)).toBe(0);
    // A duplicate recusal is refused rather than silently rewritten (recusals are append-only).
    const dup = await a.legal.post(`${P(pid)}/decisions/${d1.id}/recusals`, { reason: 'again' });
    expect(dup.status).toBe(409);
  });

  it('the requester cannot vote on their own decision (separation of duties → 403, audited as denied)', async () => {
    d2 = await tabledDecision(pid, a, a.finance, tc.id, meetingId);
    const before = await auditCount('governance.castVote', a.finance.userId, 'denied');
    const r = await vote(pid, a.finance, d2.id, 'approve');
    expect(r.status).toBe(403);
    expect(r.body.detail).toMatch(/Separation of duties/);
    expect(await auditCount('governance.castVote', a.finance.userId, 'denied')).toBe(before + 1);
    expect(await voteRows(d2.id)).toBe(0);
  });

  it('non-members and non-voting roles cannot vote (403 at the route; contributor has no vote permission)', async () => {
    const r = await vote(pid, a.contributor, d1.id, 'approve');
    expect(r.status).toBe(403);
    const s = await vote(pid, a.secretary, d1.id, 'approve');
    expect(s.status).toBe(403);
  });

  it('with quorum restored, valid votes decide; the recused member and the requester are excluded from quorum and tally', async () => {
    const v1 = await decisionVersion(a.chair, pid, d1.id);
    for (const k of ['chair', 'sponsor', 'approver'] as const) expect((await vote(pid, a[k], d1.id, 'approve', v1)).status).toBe(201);
    const dupe = await vote(pid, a.chair, d1.id, 'reject', v1);
    expect(dupe.status).toBe(409);
    const r = await a.secretary.post(`${P(pid)}/decisions/${d1.id}/record-outcome`, { expectedVersion: v1 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.status).toBe('approved');
    const row = await decisionRow(d1.id);
    const snap = row.tally_snapshot as { quorum: { eligibleVoting: number; presentVoting: number }; tally: { approve: number } };
    expect(snap.quorum.eligibleVoting).toBe(4); // 5 voting members − 1 recused
    expect(snap.tally.approve).toBe(3);

    // d2: requested by finance (a voting member) → finance is excluded from quorum for that item.
    const v2 = await decisionVersion(a.chair, pid, d2.id);
    for (const k of ['chair', 'sponsor', 'legal'] as const) expect((await vote(pid, a[k], d2.id, 'approve', v2)).status).toBe(201);
    const r2 = await a.chair.post(`${P(pid)}/decisions/${d2.id}/record-outcome`, { expectedVersion: v2 });
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    expect(((await decisionRow(d2.id)).tally_snapshot as { quorum: { eligibleVoting: number } }).quorum.eligibleVoting).toBe(4);
  });

  it('a secretariat member cannot review their own paper (not_self on start-review → 403, audited as denied)', async () => {
    const d3 = (await a.secretary.post(`${P(pid)}/decisions`, paper(tc.id)).expect(201)).body;
    const s = (await a.secretary.post(`${P(pid)}/decisions/${d3.id}/submit`, { expectedVersion: d3.version }).expect(201)).body;
    const before = await auditCount('governance.startReview', a.secretary.userId, 'denied');
    const r = await a.secretary.post(`${P(pid)}/decisions/${d3.id}/start-review`, { expectedVersion: s.version, meetingId });
    expect(r.status).toBe(403);
    expect(r.body.detail).toMatch(/Separation of duties/);
    expect(await auditCount('governance.startReview', a.secretary.userId, 'denied')).toBe(before + 1);
    expect((await decisionRow(d3.id)).status).toBe('submitted');
  });

  it('vote rows are immutable in the database (even for the owner role)', async () => {
    await expect(owner().query(`update vote set choice = 'reject' where decision_id = $1`, [d1.id])).rejects.toThrow(/append_only_violation/);
    await expect(owner().query(`delete from vote where decision_id = $1`, [d1.id])).rejects.toThrow(/append_only_violation/);
    await expect(owner().query(`update recusal set reason = 'x' where decision_id = $1`, [d1.id])).rejects.toThrow(/append_only_violation/);
  });
});
