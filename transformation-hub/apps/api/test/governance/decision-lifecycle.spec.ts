import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, owner, projectIdByCode } from '../helpers';
import { Actors, P, TestCommittee, actors, auditCount, decisionRow, decisionVersion, meetingVersion, paper, plusDays, setupCommittee, vote } from './gov-fixtures';

let pid: string;
let a: Actors;
let tc: TestCommittee;
let meetingId: string;
let decisionId: string;
let agendaId: string;
let packId: string;
let packHash: string;
let pmActionId: string;
let secActionId: string;

beforeAll(async () => {
  pid = await projectIdByCode(DC);
  a = await actors();
  tc = await setupCommittee(pid, a);
  meetingId = (await a.secretary.post(`${P(pid)}/committees/${tc.id}/meetings`, { title: 'Lifecycle meeting', scheduledAt: new Date().toISOString(), location: 'Virtual (test)' }).expect(201)).body.id;
});

afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('P2 exit criterion — decision lifecycle end to end [REQ-GOV-012, 013, 014, 015, 016, 017, 018, 019, 020, 021; AT-16; AT-30 (governance part)]', () => {
  it('1. agenda request for a draft decision paper → secretariat screening onto a numbered agenda', async () => {
    const draft = { committeeId: tc.id, title: 'Lifecycle — approve rehearsal budget (synthetic)', decisionTypeKey: 'change_request_budget', issue: 'Synthetic rehearsal budget gap' };
    const d = (await a.pm.post(`${P(pid)}/decisions`, draft).expect(201)).body;
    decisionId = d.id;
    expect(d.code).toMatch(/^DEC-\d{3}$/);
    const got = (await a.pm.get(`${P(pid)}/decisions/${decisionId}`).expect(200)).body;
    expect(got.status).toBe('draft');
    expect(got.requesterUserId).toBe(a.pm.userId);
    expect(got.missingFields).toEqual(expect.arrayContaining(['whyNow', 'alternatives', 'latestSafeDate', 'impacts.schedule']));

    const req = (await a.pm.post(`${P(pid)}/agenda-requests`, { committeeId: tc.id, title: `Decision ${d.code}`, kind: 'decision', decisionId, meetingId }).expect(201)).body;
    agendaId = req.id;
    // The requester has no screening permission; screening by the secretariat numbers the item.
    expect((await a.pm.post(`${P(pid)}/agenda-requests/${agendaId}/screen`, { expectedVersion: 1, outcome: 'accept', meetingId })).status).toBe(403);
    const bad = await a.secretary.post(`${P(pid)}/agenda-requests/${agendaId}/screen`, { expectedVersion: 1, outcome: 'return' });
    expect(bad.status).toBe(400); // a reason is required to return
    const s = await a.secretary.post(`${P(pid)}/agenda-requests/${agendaId}/screen`, { expectedVersion: 1, outcome: 'accept', meetingId, note: 'Accepted for meeting' });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    expect(s.body).toMatchObject({ screeningStatus: 'accepted', number: 1 });
    expect((await a.pm.get(`${P(pid)}/decisions/${decisionId}`).expect(200)).body.meetingId).toBe(meetingId);
  });

  it('2. an incomplete paper cannot be submitted (422 lists missing fields); stale edits are rejected (AT-16 → 409)', async () => {
    const v = await decisionVersion(a.pm, pid, decisionId);
    const r = await a.pm.post(`${P(pid)}/decisions/${decisionId}/submit`, { expectedVersion: v });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('governance.decision.incomplete_paper');
    expect(r.body.details.missing).toEqual(expect.arrayContaining(['whyNow', 'latestSafeDate', 'requiredAuthority']));

    const full = paper(tc.id);
    const { committeeId: _c, title: _t, ...fields } = full;
    const first = await a.pm.patch(`${P(pid)}/decisions/${decisionId}`, { expectedVersion: v, ...fields });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const stale = await a.pm.patch(`${P(pid)}/decisions/${decisionId}`, { expectedVersion: v, recommendation: 'stale overwrite' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('concurrency.version_mismatch');
    expect((await decisionRow(decisionId)).recommendation).toBe('Approve');
    // PATCH cannot change the status: the body is strict, so a status field is refused with 400 (REQ-DAT-013; it used to be
    // stripped with 200) — the status is a command.
    const sneaky = await a.pm.patch(`${P(pid)}/decisions/${decisionId}`, { expectedVersion: first.body.version, status: 'approved' });
    expect(sneaky.status).toBe(400);
    expect(sneaky.body.code).toBe('validation_failed');
    expect(await decisionRow(decisionId)).toMatchObject({ status: 'draft', version: first.body.version });
  });

  it('3. submit → secretariat review (not the requester); entering review emits approval.pending', async () => {
    let v = await decisionVersion(a.pm, pid, decisionId);
    v = (await a.pm.post(`${P(pid)}/decisions/${decisionId}/submit`, { expectedVersion: v }).expect(201)).body.version;
    expect((await a.pm.post(`${P(pid)}/decisions/${decisionId}/start-review`, { expectedVersion: v })).status).toBe(403);
    // Only draft papers are editable.
    expect((await a.pm.patch(`${P(pid)}/decisions/${decisionId}`, { expectedVersion: v, risks: 'late edit' })).status).toBe(422);
    await a.secretary.post(`${P(pid)}/decisions/${decisionId}/start-review`, { expectedVersion: v, note: 'Complete paper' }).expect(201);
    const row = await decisionRow(decisionId);
    expect(row.status).toBe('under_review');
    const ev = await owner().query(`select type, payload from outbox_event where aggregate_id = $1`, [decisionId]);
    expect(ev.rows.filter((e) => e.type === 'decision.status_changed').map((e) => e.payload.to)).toEqual(expect.arrayContaining(['submitted', 'under_review']));
    expect(ev.rows.some((e) => e.type === 'approval.pending' && e.payload.requiredPermission === 'governance.decision.vote')).toBe(true);
  });

  it('4. agenda published, meeting pack frozen (immutable snapshot), session, attendance, conflict declarations, quorum', async () => {
    let v = await meetingVersion(a.secretary, pid, meetingId);
    v = (await a.secretary.post(`${P(pid)}/meetings/${meetingId}/publish-agenda`, { expectedVersion: v }).expect(201)).body.version;
    const pack = (await a.secretary.post(`${P(pid)}/meetings/${meetingId}/packs`, { expectedVersion: v }).expect(201)).body;
    packId = pack.id;
    packHash = pack.contentHash;
    expect(pack.previousSnapshotId).toBeNull();
    v = (await a.secretary.post(`${P(pid)}/meetings/${meetingId}/start`, { expectedVersion: pack.version }).expect(201)).body.version;
    const att = await a.secretary.post(`${P(pid)}/meetings/${meetingId}/attendance`, {
      entries: [
        ...['chair', 'sponsor', 'finance', 'legal', 'secretary'].map((k) => ({ membershipId: tc.memberships[k], status: 'present' })),
        { membershipId: tc.memberships['approver'], status: 'remote' },
      ],
    });
    expect(att.status, JSON.stringify(att.body)).toBe(201);
    expect(att.body.items).toHaveLength(6);
    for (const k of ['chair', 'sponsor', 'finance', 'legal', 'approver'] as const) {
      await a[k].post(`${P(pid)}/meetings/${meetingId}/conflicts`, { declaration: 'no_conflict', decisionId }).expect(201);
    }
    // The secretary records on behalf only with meeting.manage; a member cannot declare for someone else.
    expect((await a.finance.post(`${P(pid)}/meetings/${meetingId}/conflicts`, { userId: a.legal.userId, declaration: 'no_conflict' })).status).toBe(403);
    const q = (await a.secretary.post(`${P(pid)}/meetings/${meetingId}/quorum-check`, { expectedVersion: v }).expect(201)).body;
    expect(q.quorum).toMatchObject({ met: true, presentVoting: 5, eligibleVoting: 5, required: 3 });
    const m = (await a.chair.get(`${P(pid)}/meetings/${meetingId}`).expect(200)).body;
    expect(m.agenda.map((x: { number: number }) => x.number)).toEqual([1]);
    expect(m.conflicts).toHaveLength(5);
    expect(m.quorumSnapshot.met).toBe(true);
  });

  it('5. votes → server-computed outcome: approved within the mandate (and duplicate votes are refused)', async () => {
    const v = await decisionVersion(a.chair, pid, decisionId);
    const choices: [keyof Actors, 'approve' | 'reject' | 'abstain'][] = [
      ['chair', 'approve'],
      ['sponsor', 'approve'],
      ['finance', 'approve'],
      ['legal', 'reject'],
      ['approver', 'abstain'],
    ];
    for (const [k, c] of choices) expect((await vote(pid, a[k], decisionId, c, v)).status).toBe(201);
    expect((await vote(pid, a.chair, decisionId, 'reject', v)).status).toBe(409);
    const r = await a.chair.post(`${P(pid)}/decisions/${decisionId}/record-outcome`, { expectedVersion: v });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ status: 'approved', outcome: 'approve', authorityOutcome: 'within_mandate', escalationId: null });
    const votes = (await a.contributor.get(`${P(pid)}/decisions/${decisionId}/votes`).expect(200)).body.items;
    expect(votes).toHaveLength(5);
    expect(votes.every((x: { round: number; authorityMatrixVersionId: string }) => x.round === 1 && x.authorityMatrixVersionId === tc.matrixId)).toBe(true);
  });

  it('6. approval ≠ implementation: approved is not implemented; tracking needs an owned, dated action', async () => {
    const v = await decisionVersion(a.sponsor, pid, decisionId);
    const early = await a.sponsor.post(`${P(pid)}/decisions/${decisionId}/verify-implementation`, { expectedVersion: v, evidenceNote: 'too early' });
    expect(early.status).toBe(422);
    expect(early.body.code).toBe('decision.invalid_transition');
    const none = await a.secretary.post(`${P(pid)}/decisions/${decisionId}/start-implementation`, { expectedVersion: v });
    expect(none.status).toBe(422);
    expect(none.body.code).toBe('governance.implementation.no_actions');

    // Owner must be an active project member (partner/unknown users are refused).
    const outsider = await a.secretary.post(`${P(pid)}/actions`, { title: 'x', decisionId, ownerUserId: '00000000-0000-7000-8000-000000000000', dueDate: plusDays(7) });
    expect(outsider.status).toBe(422);
    pmActionId = (await a.secretary.post(`${P(pid)}/actions`, { title: 'Book rehearsal environment', decisionId, meetingId, ownerUserId: a.pm.userId, dueDate: plusDays(7) }).expect(201)).body.id;
    secActionId = (await a.secretary.post(`${P(pid)}/actions`, { title: 'Circulate minutes', meetingId, ownerUserId: a.secretary.userId, dueDate: plusDays(3) }).expect(201)).body.id;
    await a.secretary.post(`${P(pid)}/decisions/${decisionId}/start-implementation`, { expectedVersion: v }).expect(201);
    expect((await decisionRow(decisionId)).status).toBe('implementation_pending');
    const blocked = await a.sponsor.post(`${P(pid)}/decisions/${decisionId}/verify-implementation`, { expectedVersion: v + 1, evidenceNote: 'Evidence' });
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe('governance.implementation.actions_open');
  });

  it('7. action closure: owner reports done with evidence; self-verification is rejected; a different person verifies', async () => {
    let act = (await a.pm.get(`${P(pid)}/actions/${pmActionId}`).expect(200)).body;
    expect(act).toMatchObject({ status: 'open', overdue: false, ownerUserId: a.pm.userId });
    // Only the owner reports progress
    expect((await a.finance.post(`${P(pid)}/actions/${pmActionId}/report-done`, { expectedVersion: act.version, closureEvidenceNote: 'x' })).status).toBe(403);
    const noEvidence = await a.pm.post(`${P(pid)}/actions/${pmActionId}/report-done`, { expectedVersion: act.version });
    expect(noEvidence.status).toBe(422);
    expect(noEvidence.body.code).toBe('governance.action.closure_evidence_required');
    await a.pm.post(`${P(pid)}/actions/${pmActionId}/report-done`, { expectedVersion: act.version, closureEvidenceNote: 'Booking confirmation reference (synthetic)' }).expect(201);

    // Self-verification: the secretary owns and reports their own action, then tries to verify it.
    let sec = (await a.secretary.get(`${P(pid)}/actions/${secActionId}`).expect(200)).body;
    await a.secretary.post(`${P(pid)}/actions/${secActionId}/report-done`, { expectedVersion: sec.version, closureEvidenceNote: 'Minutes sent (synthetic)' }).expect(201);
    sec = (await a.secretary.get(`${P(pid)}/actions/${secActionId}`).expect(200)).body;
    const before = await auditCount('governance.verifyActionClosure', a.secretary.userId, 'denied');
    const self = await a.secretary.post(`${P(pid)}/actions/${secActionId}/verify-closure`, { expectedVersion: sec.version });
    expect(self.status).toBe(403);
    expect(await auditCount('governance.verifyActionClosure', a.secretary.userId, 'denied')).toBe(before + 1);
    expect((await owner().query(`select status from action_item where id = $1`, [secActionId])).rows[0].status).toBe('done_pending_verification');

    act = (await a.pm.get(`${P(pid)}/actions/${pmActionId}`).expect(200)).body;
    await a.secretary.post(`${P(pid)}/actions/${pmActionId}/verify-closure`, { expectedVersion: act.version, note: 'Evidence checked' }).expect(201);
    expect((await owner().query(`select status, verified_by from action_item where id = $1`, [pmActionId])).rows[0]).toMatchObject({ status: 'verified_closed', verified_by: a.secretary.userId });
  });

  it('8. implementation verified with evidence by someone other than the person who started tracking', async () => {
    const v = await decisionVersion(a.sponsor, pid, decisionId);
    const self = await a.secretary.post(`${P(pid)}/decisions/${decisionId}/verify-implementation`, { expectedVersion: v, evidenceNote: 'self' });
    expect(self.status).toBe(403);
    const noEvidence = await a.sponsor.post(`${P(pid)}/decisions/${decisionId}/verify-implementation`, { expectedVersion: v });
    expect(noEvidence.status).toBe(422);
    expect(noEvidence.body.code).toBe('governance.implementation.evidence_required');
    await a.sponsor.post(`${P(pid)}/decisions/${decisionId}/verify-implementation`, { expectedVersion: v, evidenceNote: 'Rehearsal held; action ACT verified (synthetic)' }).expect(201);
    const row = await decisionRow(decisionId);
    expect(row).toMatchObject({ status: 'implemented_verified', implementation_verified_by: a.sponsor.userId, implementation_started_by: a.secretary.userId });
  });

  it('9. minutes: drafted by the secretariat, approved by the chair; approved minutes change only through a new version with a reason', async () => {
    let v = await meetingVersion(a.secretary, pid, meetingId);
    v = (await a.secretary.post(`${P(pid)}/meetings/${meetingId}/close`, { expectedVersion: v }).expect(201)).body.version;
    v = (await a.secretary.post(`${P(pid)}/meetings/${meetingId}/minutes`, { expectedVersion: v, text: 'Minutes v1 (synthetic)' }).expect(201)).body.version;
    expect((await a.secretary.post(`${P(pid)}/meetings/${meetingId}/minutes/approve`, { expectedVersion: v })).status).toBe(403);
    v = (await a.chair.post(`${P(pid)}/meetings/${meetingId}/minutes/approve`, { expectedVersion: v }).expect(201)).body.version;
    // Attendance is frozen after minutes approval.
    expect((await a.secretary.post(`${P(pid)}/meetings/${meetingId}/attendance`, { entries: [{ membershipId: tc.memberships['legal'], status: 'absent' }] })).status).toBe(422);
    await expect(owner().query(`update attendance set status = 'absent' where meeting_id = $1`, [meetingId])).rejects.toThrow(/frozen after minutes approval/);
    const noReason = await a.secretary.post(`${P(pid)}/meetings/${meetingId}/minutes`, { expectedVersion: v, text: 'Minutes v2' });
    expect(noReason.status).toBe(422);
    expect(noReason.body.code).toBe('governance.minutes.correction_reason_required');
    await a.secretary.post(`${P(pid)}/meetings/${meetingId}/minutes`, { expectedVersion: v, text: 'Minutes v2 (typo fixed)', reason: 'Typo in item 1' }).expect(201);
    const hist = await owner().query(`select snapshot->>'status' s, snapshot->>'text' t from record_version where entity_type = 'meeting_minutes' and entity_id = $1 order by version_no`, [meetingId]);
    expect(hist.rows.map((r) => r.s)).toEqual(['minutes_draft', 'minutes_approved', 'minutes_draft']);
    expect(hist.rows[1].t).toBe('Minutes v1 (synthetic)');
  });

  it('10. the frozen pack is unchanged by later changes; re-freezing creates a linked new version; the DB rejects edits', async () => {
    const pack = (await a.legal.get(`${P(pid)}/meetings/${meetingId}/packs/${packId}`).expect(200)).body;
    expect(pack.contentHash).toBe(packHash);
    const paperInPack = pack.payload.decisionPapers.find((d: { id: string }) => d.id === decisionId);
    expect(paperInPack.status).toBe('under_review'); // as frozen, although the decision is now implemented_verified
    expect(pack.payload.agenda).toHaveLength(1);
    await expect(owner().query(`update report_snapshot set title = 'tampered' where id = $1`, [packId])).rejects.toThrow(/append_only_violation/);
    const v = await meetingVersion(a.secretary, pid, meetingId);
    const v2 = (await a.secretary.post(`${P(pid)}/meetings/${meetingId}/packs`, { expectedVersion: v }).expect(201)).body;
    expect(v2.previousSnapshotId).toBe(packId);
    expect(v2.contentHash).not.toBe(packHash);
    const list = (await a.chair.get(`${P(pid)}/meetings/${meetingId}/packs`).expect(200)).body.items;
    expect(list.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining([packId, v2.id]));
  });

  it('11. history: the decision activity feed shows every command; the audit chain is intact', async () => {
    const feed = (await a.pm.get(`${P(pid)}/activity?entityType=decision&entityId=${decisionId}&pageSize=100`).expect(200)).body.items.map((e: { action: string }) => e.action);
    expect(feed).toEqual(
      expect.arrayContaining([
        'governance.decision.draft',
        'governance.decision.update',
        'governance.decision.submit',
        'governance.decision.start_review',
        'governance.decision.vote',
        'governance.decision.record_outcome',
        'governance.decision.start_implementation',
        'governance.decision.verify_implementation',
      ]),
    );
    const org = await owner().query(`select org_id from project where id = $1`, [pid]);
    expect((await owner().query(`select * from hub_audit_verify($1)`, [org.rows[0].org_id])).rows).toEqual([]);
  });
});
