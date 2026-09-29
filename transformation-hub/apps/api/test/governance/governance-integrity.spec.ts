import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, Client, DC, GEN, loginAs, owner, projectIdByCode } from '../helpers';
import {
  Actors,
  DEMO_AUTHORITY_POLICY,
  P,
  TestCommittee,
  actors,
  auditCount,
  decisionRow,
  decisionVersion,
  meetingVersion,
  openMeeting,
  paper,
  plusDays,
  setupCommittee,
  tabledDecision,
  today,
  uniq,
  vote,
} from './gov-fixtures';

let pid: string;
let genId: string;
let a: Actors;
let tc: TestCommittee;

beforeAll(async () => {
  pid = await projectIdByCode(DC);
  genId = await projectIdByCode(GEN);
  a = await actors();
  tc = await setupCommittee(pid, a);
});

afterAll(async () => {
  await closeApp();
  await closePools();
});

async function approvedDecision(meetingId: string, over: Record<string, unknown> = {}) {
  const d = await tabledDecision(pid, a, a.pm, tc.id, meetingId, over);
  const v = await decisionVersion(a.chair, pid, d.id);
  for (const k of ['chair', 'sponsor', 'finance'] as const) expect((await vote(pid, a[k], d.id, 'approve', v)).status).toBe(201);
  await a.chair.post(`${P(pid)}/decisions/${d.id}/record-outcome`, { expectedVersion: v }).expect(201);
  return d;
}

describe('REQ-GOV-024 — historical votes are unchanged when membership ends', () => {
  it('ending a seat keeps the seat, its votes and the recorded tally; the ex-member cannot take part in later meetings', async () => {
    const own = await setupCommittee(pid, a);
    const m = await openMeeting(pid, a, own, ['chair', 'sponsor', 'finance', 'legal', 'approver']);
    const d = await tabledDecision(pid, a, a.pm, own.id, m.id);
    const v = await decisionVersion(a.chair, pid, d.id);
    for (const k of ['chair', 'sponsor', 'finance'] as const) expect((await vote(pid, a[k], d.id, 'approve', v)).status).toBe(201);
    await a.chair.post(`${P(pid)}/decisions/${d.id}/record-outcome`, { expectedVersion: v }).expect(201);
    const votesBefore = (await a.pm.get(`${P(pid)}/decisions/${d.id}/votes`).expect(200)).body.items;
    const tallyBefore = (await decisionRow(d.id)).tally_snapshot;

    const seat = (await a.secretary.get(`${P(pid)}/committees/${own.id}`).expect(200)).body.memberships.find((x: { id: string }) => x.id === own.memberships['finance']);
    // A retroactive end date before recorded attendance/votes would rewrite history → refused.
    const retro = await a.secretary.post(`${P(pid)}/committees/${own.id}/memberships/${seat.id}/end`, { expectedVersion: seat.version, validTo: '2026-02-01', reason: 'retroactive' });
    expect(retro.status).toBe(422);
    expect(retro.body.code).toBe('governance.membership.history_conflict');
    await a.secretary.post(`${P(pid)}/committees/${own.id}/memberships/${seat.id}/end`, { expectedVersion: seat.version, validTo: today(), reason: 'Rotated off the committee (synthetic)' }).expect(201);

    const votesAfter = (await a.pm.get(`${P(pid)}/decisions/${d.id}/votes`).expect(200)).body.items;
    expect(votesAfter).toEqual(votesBefore);
    expect((await decisionRow(d.id)).tally_snapshot).toEqual(tallyBefore);
    const detail = (await a.secretary.get(`${P(pid)}/committees/${own.id}`).expect(200)).body;
    const ended = detail.memberships.find((x: { id: string }) => x.id === seat.id);
    expect(ended).toMatchObject({ validTo: today(), userId: a.finance.userId });

    // Next meeting (tomorrow): the ended seat can no longer attend (nor therefore vote).
    const tomorrow = new Date(Date.now() + 36 * 3600 * 1000).toISOString();
    const next = await openMeeting(pid, a, own, ['chair'], { scheduledAt: tomorrow });
    const att = await a.secretary.post(`${P(pid)}/meetings/${next.id}/attendance`, { entries: [{ membershipId: seat.id, status: 'present' }] });
    expect(att.status).toBe(422);
    expect(att.body.code).toBe('governance.attendance.member_inactive');
  });
});

describe('AT-16 — optimistic concurrency on governance commands [REQ-DAT]', () => {
  it('a stale expectedVersion on a command returns 409 and changes nothing', async () => {
    const m = await openMeeting(pid, a, tc, ['chair', 'sponsor', 'finance']);
    const d = await tabledDecision(pid, a, a.pm, tc.id, m.id);
    const before = await decisionRow(d.id);
    const r1 = await a.chair.post(`${P(pid)}/decisions/${d.id}/defer`, { expectedVersion: d.version, note: 'Need more information' });
    expect(r1.status).toBe(201);
    const r2 = await a.chair.post(`${P(pid)}/decisions/${d.id}/defer`, { expectedVersion: d.version, note: 'Second writer (stale)' });
    expect(r2.status).toBe(409);
    expect(r2.body.code).toBe('concurrency.version_mismatch');
    expect((await decisionRow(d.id)).version).toBe((before.version as number) + 1);
    // A vote bound to a stale paper version is refused as well.
    const staleVote = await a.sponsor.post(`${P(pid)}/decisions/${d.id}/votes`, { expectedVersion: d.version, choice: 'approve' });
    expect(staleVote.status).toBe(409);
  });
});

describe('Defer / resume opens a new voting round; supersede links decisions of the same project [REQ-GOV-019]', () => {
  it('votes from a previous round do not count after resume; supersede requires an approved successor', async () => {
    const m = await openMeeting(pid, a, tc, ['chair', 'sponsor', 'finance', 'legal', 'approver']);
    const d = await tabledDecision(pid, a, a.pm, tc.id, m.id);
    expect((await vote(pid, a.sponsor, d.id, 'approve')).status).toBe(201);
    let v = await decisionVersion(a.chair, pid, d.id);
    v = (await a.chair.post(`${P(pid)}/decisions/${d.id}/defer`, { expectedVersion: v, note: 'Awaiting specialist input', revisitDate: plusDays(14) }).expect(201)).body.version;
    const resumed = (await a.secretary.post(`${P(pid)}/decisions/${d.id}/resume`, { expectedVersion: v, meetingId: m.id }).expect(201)).body;
    expect(resumed.voteRound).toBe(2);
    const out = await a.chair.post(`${P(pid)}/decisions/${d.id}/record-outcome`, { expectedVersion: resumed.version });
    expect(out.status).toBe(422);
    expect(out.body.code).toBe('governance.outcome.insufficient_votes');
    // Round-1 vote is kept (immutable history) and a new vote is possible in round 2.
    expect((await vote(pid, a.sponsor, d.id, 'approve', resumed.version)).status).toBe(201);
    const votes = (await a.pm.get(`${P(pid)}/decisions/${d.id}/votes`).expect(200)).body.items;
    expect(votes.map((x: { round: number }) => x.round).sort()).toEqual([1, 2]);

    const older = await approvedDecision(m.id);
    const newer = await approvedDecision(m.id);
    const draft = (await a.pm.post(`${P(pid)}/decisions`, paper(tc.id)).expect(201)).body;
    const ov = await decisionVersion(a.chair, pid, older.id);
    const notApproved = await a.chair.post(`${P(pid)}/decisions/${older.id}/supersede`, { expectedVersion: ov, supersededByDecisionId: draft.id, note: 'x' });
    expect(notApproved.status).toBe(422);
    await a.chair.post(`${P(pid)}/decisions/${older.id}/supersede`, { expectedVersion: ov, supersededByDecisionId: newer.id, note: 'Replaced by the updated budget' }).expect(201);
    expect(await decisionRow(older.id)).toMatchObject({ status: 'superseded', superseded_by_decision_id: newer.id });
  });
});

describe('Resolution by circulation (assumption: quorum = voting members who responded, same thresholds) [REQ-GOV-016]', () => {
  it('responses are flagged via_circulation; enough responders → outcome recorded; the circulation closes', async () => {
    const d = await tabledDecision(pid, a, a.pm, tc.id, null);
    const c = await a.chair.post(`${P(pid)}/decisions/${d.id}/circulate`, { expectedVersion: d.version, responseDeadline: plusDays(3) });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const circ = (await a.chair.get(`${P(pid)}/meetings/${c.body.meetingId}`).expect(200)).body;
    expect(circ).toMatchObject({ isCirculation: true, status: 'in_session', responseDeadline: plusDays(3), packSnapshotId: c.body.packSnapshotId });
    for (const k of ['chair', 'sponsor', 'finance'] as const) expect((await vote(pid, a[k], d.id, 'approve', c.body.version)).status).toBe(201);
    const flags = await owner().query(`select via_circulation from vote where decision_id = $1`, [d.id]);
    expect(flags.rows.every((r) => r.via_circulation === true)).toBe(true);
    const r = await a.secretary.post(`${P(pid)}/decisions/${d.id}/record-outcome`, { expectedVersion: c.body.version });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.status).toBe('approved');
    expect(await decisionRow(d.id)).toMatchObject({ decided_via_circulation: true });
    expect((await a.chair.get(`${P(pid)}/meetings/${c.body.meetingId}`).expect(200)).body.status).toBe('held');
  });

  it('too few responders → no quorum (422, audited)', async () => {
    const d = await tabledDecision(pid, a, a.pm, tc.id, null);
    const c = (await a.chair.post(`${P(pid)}/decisions/${d.id}/circulate`, { expectedVersion: d.version, responseDeadline: plusDays(3) }).expect(201)).body;
    for (const k of ['chair', 'sponsor'] as const) expect((await vote(pid, a[k], d.id, 'approve', c.version)).status).toBe(201);
    const before = await auditCount('governance.recordOutcome', a.secretary.userId, 'rejected');
    const r = await a.secretary.post(`${P(pid)}/decisions/${d.id}/record-outcome`, { expectedVersion: c.version });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('governance.outcome.no_quorum');
    expect(await auditCount('governance.recordOutcome', a.secretary.userId, 'rejected')).toBe(before + 1);
  });
});

describe('REQ-GOV-010 / REQ-GOV-011 — a non-demo project cannot activate authority with the Demo policy', () => {
  let np: string;
  let sec: Client;
  let sponsor: Client;
  let committeeId: string;

  beforeAll(async () => {
    const admin = await loginAs('portfolio.admin');
    const templates = (await admin.get('/api/v1/templates').expect(200)).body.items as { id: string; templateKey: string }[];
    const tpl = templates.find((t) => t.templateKey === 'general-transformation')!;
    const code = `GOVND-${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
    np = (await admin.post('/api/v1/projects', { templateVersionId: tpl.id, code, name: 'Governance non-demo test project', projectManagerUserId: a.pm.userId }).expect(201)).body.id;
    sec = a.secretary;
    sponsor = a.sponsor;
    await admin.post(`${P(np)}/members`, { userId: sec.userId, role: 'secretary_cpmo', reason: 'governance non-demo test' }).expect(201);
    await admin.post(`${P(np)}/members`, { userId: sponsor.userId, role: 'sponsor', reason: 'governance non-demo test' }).expect(201);
    expect((await owner().query(`select is_demo from project where id = $1`, [np])).rows[0].is_demo).toBe(false);
  });

  it('the Demo matrix can be drafted but not approved (422, audited); no authority is in force', async () => {
    const c = (await sec.post(`${P(np)}/committees`, { kind: 'program_steering', name: uniq('Non-demo steering'), charter: {} }).expect(201)).body;
    committeeId = c.id;
    let v = (await sponsor.post(`${P(np)}/committees/${c.id}/charter/approve`, { expectedVersion: c.version }).expect(201)).body.version;
    await sec.post(`${P(np)}/committees/${c.id}/activate`, { expectedVersion: v }).expect(201);
    await sec.post(`${P(np)}/committees/${c.id}/memberships`, { userId: sponsor.userId, roleLabel: 'Sponsor', memberRole: 'sponsor', voting: true, validFrom: '2026-01-01' }).expect(201);
    const m = (await sec.post(`${P(np)}/committees/${c.id}/authority-matrix-versions`, { policy: DEMO_AUTHORITY_POLICY }).expect(201)).body;
    const before = await auditCount('governance.approveAuthorityMatrixVersion', sponsor.userId, 'rejected');
    const r = await sponsor.post(`${P(np)}/committees/${c.id}/authority-matrix-versions/${m.id}/approve`, { approvalReference: 'attempt' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('governance.authority_matrix.demo_policy_non_demo_project');
    expect(await auditCount('governance.approveAuthorityMatrixVersion', sponsor.userId, 'rejected')).toBe(before + 1);
    expect((await owner().query(`select status from authority_matrix_version where id = $1`, [m.id])).rows[0].status).toBe('draft');
    expect((await sec.get(`${P(np)}/committees/${c.id}`).expect(200)).body.activeMatrix).toBeNull();
    // The drafter cannot approve their own matrix (and the secretary lacks the permission anyway).
    expect((await sec.post(`${P(np)}/committees/${c.id}/authority-matrix-versions/${m.id}/approve`, { approvalReference: 'x' })).status).toBe(403);

    // Without an approved matrix, votes / outcomes / quorum checks are refused: no production approval authority.
    const meeting = (await sec.post(`${P(np)}/committees/${c.id}/meetings`, { title: 'Non-demo meeting', scheduledAt: new Date().toISOString() }).expect(201)).body;
    const req = (await a.pm.post(`${P(np)}/agenda-requests`, { committeeId: c.id, title: 'Status', kind: 'information', meetingId: meeting.id }).expect(201)).body;
    await sec.post(`${P(np)}/agenda-requests/${req.id}/screen`, { expectedVersion: 1, outcome: 'accept', meetingId: meeting.id }).expect(201);
    v = (await sec.post(`${P(np)}/meetings/${meeting.id}/publish-agenda`, { expectedVersion: meeting.version }).expect(201)).body.version;
    v = (await sec.post(`${P(np)}/meetings/${meeting.id}/start`, { expectedVersion: v }).expect(201)).body.version;
    const members = (await sec.get(`${P(np)}/committees/${c.id}`).expect(200)).body.memberships;
    await sec.post(`${P(np)}/meetings/${meeting.id}/attendance`, { entries: [{ membershipId: members[0].id, status: 'present' }] }).expect(201);
    const q = await sec.post(`${P(np)}/meetings/${meeting.id}/quorum-check`, { expectedVersion: v });
    expect(q.status).toBe(422);
    expect(q.body.code).toBe('governance.matrix.not_usable');
    const d = (await a.pm.post(`${P(np)}/decisions`, paper(c.id, { decisionTypeKey: 'baseline_approval', amount: null })).expect(201)).body;
    const s = (await a.pm.post(`${P(np)}/decisions/${d.id}/submit`, { expectedVersion: d.version }).expect(201)).body;
    const rv = (await sec.post(`${P(np)}/decisions/${d.id}/start-review`, { expectedVersion: s.version, meetingId: meeting.id }).expect(201)).body;
    const vt = await sponsor.post(`${P(np)}/decisions/${d.id}/votes`, { expectedVersion: rv.version, choice: 'approve' });
    expect(vt.status).toBe(422);
    expect(vt.body.code).toBe('governance.matrix.not_usable');
    const out = await sec.post(`${P(np)}/decisions/${d.id}/record-outcome`, { expectedVersion: rv.version });
    expect(out.status).toBe(422);
    expect(out.body.code).toBe('governance.matrix.not_usable');
    expect((await decisionRow(d.id)).status).toBe('under_review');
  });

  it('a non-demo policy (e.g. loaded from an approved delegation) can be approved; then authority is in force', async () => {
    const realShape = { ...DEMO_AUTHORITY_POLICY, isDemoPolicy: false, quorum: { minVotingMembersPresent: 1, minFractionPresent: 0.5 } };
    const m = (await sec.post(`${P(np)}/committees/${committeeId}/authority-matrix-versions`, { policy: realShape }).expect(201)).body;
    const r = await sponsor.post(`${P(np)}/committees/${committeeId}/authority-matrix-versions/${m.id}/approve`, { approvalReference: 'TEST-DELEGATION-REF (synthetic test value)' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const c = (await sec.get(`${P(np)}/committees/${committeeId}`).expect(200)).body;
    expect(c.activeMatrix).toMatchObject({ id: m.id, isDemoPolicy: false, usable: true });
  });

  it('policy validation: platform invariants and duplicate decision types are rejected (400)', async () => {
    const bad1 = await sec.post(`${P(np)}/committees/${committeeId}/authority-matrix-versions`, { policy: { ...DEMO_AUTHORITY_POLICY, selfApprovalProhibited: false } });
    expect(bad1.status).toBe(400);
    const dupTypes = [...DEMO_AUTHORITY_POLICY.decisionTypes, DEMO_AUTHORITY_POLICY.decisionTypes[0]];
    const bad2 = await sec.post(`${P(np)}/committees/${committeeId}/authority-matrix-versions`, { policy: { ...DEMO_AUTHORITY_POLICY, decisionTypes: dupTypes } });
    expect(bad2.status).toBe(400);
    const bad3 = await sec.post(`${P(np)}/committees/${committeeId}/authority-matrix-versions`, { policy: { ...DEMO_AUTHORITY_POLICY, quorum: { minVotingMembersPresent: 0, minFractionPresent: 2 } } });
    expect(bad3.status).toBe(400);
  });
});

describe('AT-03 / REQ-GOV-001 — cross-project ids are never accepted and other projects see nothing (404)', () => {
  let genMeeting: string;
  let genDecision: string;
  let dcDecision: { id: string; version: number };

  beforeAll(async () => {
    const org = (await owner().query(`select org_id from project where id = $1`, [genId])).rows[0].org_id;
    const gc = await owner().query(`insert into committee (org_id, project_id, kind, name, status) values ($1, $2, 'program_steering', 'GEN fixture committee', 'active') returning id`, [org, genId]);
    genMeeting = (await owner().query(`insert into meeting (org_id, project_id, committee_id, number, title, scheduled_at) values ($1, $2, $3, 1, 'GEN fixture meeting', now()) returning id`, [org, genId, gc.rows[0].id])).rows[0].id;
    genDecision = (await owner().query(`insert into decision (org_id, project_id, committee_id, code, title, status) values ($1, $2, $3, 'GEN-DEC-1', 'GEN fixture decision', 'approved') returning id`, [org, genId, gc.rows[0].id])).rows[0].id;
    const m = await openMeeting(pid, a, tc, ['chair', 'sponsor', 'finance']);
    dcDecision = await approvedDecision(m.id);
    dcDecision.version = await decisionVersion(a.chair, pid, dcDecision.id);
  });

  it('a Project-B user gets 404 for Project-A committees, decisions and meetings (no titles leak)', async () => {
    const pmB = await loginAs('pm.b');
    for (const path of [`${P(pid)}/committees`, `${P(pid)}/committees/${tc.id}`, `${P(pid)}/decisions/${dcDecision.id}`, `${P(pid)}/decisions`]) {
      const r = await pmB.get(path);
      expect(r.status).toBe(404);
    }
    const viaOwnProject = await pmB.get(`${P(genId)}/decisions/${dcDecision.id}`);
    expect(viaOwnProject.status).toBe(404);
    expect(JSON.stringify(viaOwnProject.body)).not.toMatch(/Test decision/);
  });

  it('submitting another project\'s meeting / decision ids is refused with 404 and changes nothing', async () => {
    const before = await decisionRow(dcDecision.id);
    const sup = await a.chair.post(`${P(pid)}/decisions/${dcDecision.id}/supersede`, { expectedVersion: dcDecision.version, supersededByDecisionId: genDecision, note: 'cross-project attempt' });
    expect(sup.status).toBe(404);
    const act = await a.secretary.post(`${P(pid)}/actions`, { title: 'x', decisionId: genDecision, ownerUserId: a.pm.userId, dueDate: plusDays(3) });
    expect(act.status).toBe(404);
    const agenda = await a.pm.post(`${P(pid)}/agenda-requests`, { committeeId: tc.id, title: 'x', kind: 'information', meetingId: genMeeting });
    expect(agenda.status).toBe(404);
    const d = (await a.pm.post(`${P(pid)}/decisions`, paper(tc.id)).expect(201)).body;
    const s = (await a.pm.post(`${P(pid)}/decisions/${d.id}/submit`, { expectedVersion: d.version }).expect(201)).body;
    const rv = await a.secretary.post(`${P(pid)}/decisions/${d.id}/start-review`, { expectedVersion: s.version, meetingId: genMeeting });
    expect(rv.status).toBe(404);
    const esc = await a.pm.post(`${P(pid)}/escalations`, { title: 'x', sourceType: 'decision', sourceId: genDecision, requestedAction: 'x', decisionDeadline: plusDays(3), options: [{ title: 'a' }] });
    expect(esc.status).toBe(404);
    expect(await decisionRow(dcDecision.id)).toEqual(before);
    expect((await decisionRow(d.id)).status).toBe('submitted');
  });
});

describe('Committees, charters and memberships [REQ-GOV-002, 003, 004, 005, 006, 007, 009]', () => {
  it('committee kinds are distinct (program committee ≠ NewCo/JV boards) and filterable; kind cannot be changed', async () => {
    const jv = (await a.secretary.post(`${P(pid)}/committees`, { kind: 'jv_board', name: uniq('JV board (test)'), charter: {} }).expect(201)).body;
    const list = (await a.pm.get(`${P(pid)}/committees?kind=jv_board&pageSize=100`).expect(200)).body;
    expect(list.items.every((c: { kind: string }) => c.kind === 'jv_board')).toBe(true);
    expect(list.items.some((c: { id: string }) => c.id === jv.id)).toBe(true);
    // Charter updates carry no kind; unknown fields are stripped.
    const v = (await a.secretary.get(`${P(pid)}/committees/${jv.id}`).expect(200)).body.version;
    await a.secretary.post(`${P(pid)}/committees/${jv.id}/charter`, { expectedVersion: v, charter: { purpose: 'x' }, kind: 'program_steering' }).expect(201);
    expect((await owner().query(`select kind from committee where id = $1`, [jv.id])).rows[0].kind).toBe('jv_board');
  });

  it('charter versions: amendments after approval need re-approval by someone other than the drafter', async () => {
    const c = (await a.secretary.post(`${P(pid)}/committees`, { kind: 'program_steering', name: uniq('Charter test'), charter: { purpose: 'v1', cadence: 'Monthly (proposal)' } }).expect(201)).body;
    let v = (await a.sponsor.post(`${P(pid)}/committees/${c.id}/charter/approve`, { expectedVersion: c.version }).expect(201)).body.version;
    const again = await a.sponsor.post(`${P(pid)}/committees/${c.id}/charter/approve`, { expectedVersion: v });
    expect(again.status).toBe(422);
    const upd = (await a.secretary.post(`${P(pid)}/committees/${c.id}/charter`, { expectedVersion: v, charter: { purpose: 'v2' }, reason: 'Scope clarified' }).expect(201)).body;
    expect(upd.charterVersionNo).toBe(2);
    let detail = (await a.pm.get(`${P(pid)}/committees/${c.id}`).expect(200)).body;
    expect(detail).toMatchObject({ status: 'charter_approved', charterVersionNo: 2, charterApprovedVersionNo: 1 });
    expect(detail.charter.cadenceIsProposal).toBe(true);
    v = (await a.sponsor.post(`${P(pid)}/committees/${c.id}/charter/approve`, { expectedVersion: upd.version }).expect(201)).body.version;
    detail = (await a.pm.get(`${P(pid)}/committees/${c.id}`).expect(200)).body;
    expect(detail.charterApprovedVersionNo).toBe(2);
    const versions = (await a.pm.get(`${P(pid)}/committees/${c.id}/charter/versions`).expect(200)).body.items;
    expect(versions.map((x: { versionNo: number; approved: boolean }) => [x.versionNo, x.approved])).toEqual([
      [1, true],
      [2, true],
    ]);
    void v;
  });

  it('seats: placeholders show "Role — To be confirmed", non-voting roles cannot vote, one chair at a time', async () => {
    const c = (await a.secretary.post(`${P(pid)}/committees`, { kind: 'newco_board', name: uniq('Seat test'), charter: {} }).expect(201)).body;
    await a.secretary.post(`${P(pid)}/committees/${c.id}/memberships`, { userId: null, roleLabel: 'Chair — Role to be confirmed', memberRole: 'chair', voting: true, validFrom: today() }).expect(201);
    const sec = await a.secretary.post(`${P(pid)}/committees/${c.id}/memberships`, { userId: a.secretary.userId, roleLabel: 'Secretary', memberRole: 'secretary', voting: true, validFrom: today() });
    expect(sec.status).toBe(422);
    expect(sec.body.code).toBe('governance.membership.non_voting_role');
    await a.secretary.post(`${P(pid)}/committees/${c.id}/memberships`, { userId: a.chair.userId, roleLabel: 'Chair', memberRole: 'chair', voting: true, validFrom: today() }).expect(201);
    const second = await a.secretary.post(`${P(pid)}/committees/${c.id}/memberships`, { userId: a.sponsor.userId, roleLabel: 'Chair 2', memberRole: 'chair', voting: true, validFrom: today() });
    expect(second.status).toBe(422);
    expect(second.body.code).toBe('governance.membership.chair_exists');
    const detail = (await a.pm.get(`${P(pid)}/committees/${c.id}`).expect(200)).body;
    const placeholder = detail.memberships.find((m: { isPlaceholder: boolean }) => m.isPlaceholder);
    expect(placeholder).toMatchObject({ userId: null, displayName: null, roleLabel: 'Chair — Role to be confirmed' });
    // Only the secretariat manages seats.
    expect((await a.pm.post(`${P(pid)}/committees/${c.id}/memberships`, { userId: a.pm.userId, roleLabel: 'x', memberRole: 'guest', voting: false, validFrom: today() })).status).toBe(403);
  });
});

describe('Visibility by classification, actions overdue flag and escalations [REQ-GOV-018, 025, 026]', () => {
  it('a restricted paper is invisible (404, not counted) to a reader cleared only for confidential', async () => {
    const all = (await a.pm.get(`${P(pid)}/decisions?pageSize=100`).expect(200)).body.total;
    const d = (await a.secretary.post(`${P(pid)}/decisions`, { ...paper(tc.id), classification: 'restricted' }).expect(201)).body;
    expect((await a.pm.get(`${P(pid)}/decisions/${d.id}`)).status).toBe(404);
    expect((await a.pm.get(`${P(pid)}/decisions?pageSize=100`).expect(200)).body.total).toBe(all);
    expect((await a.chair.get(`${P(pid)}/decisions/${d.id}`)).status).toBe(200); // chair is cleared for restricted
    // A drafter cannot classify above their own clearance.
    const above = await a.pm.post(`${P(pid)}/decisions`, { ...paper(tc.id), classification: 'strictly_confidential' });
    expect(above.status).toBe(422);
  });

  it('overdue is computed in the project timezone and filterable', async () => {
    const late = (await a.secretary.post(`${P(pid)}/actions`, { title: 'Late action (test)', ownerUserId: a.pm.userId, dueDate: plusDays(-2) }).expect(201)).body;
    const got = (await a.pm.get(`${P(pid)}/actions/${late.id}`).expect(200)).body;
    expect(got.overdue).toBe(true);
    const list = (await a.pm.get(`${P(pid)}/actions?overdue=true&pageSize=100`).expect(200)).body.items;
    expect(list.some((x: { id: string }) => x.id === late.id)).toBe(true);
    expect(list.every((x: { overdue: boolean }) => x.overdue)).toBe(true);
    const upd = await a.secretary.patch(`${P(pid)}/actions/${late.id}`, { expectedVersion: got.version, dueDate: plusDays(5), reason: 'Re-dated' });
    expect(upd.status).toBe(200);
    expect((await a.pm.get(`${P(pid)}/actions/${late.id}`).expect(200)).body.overdue).toBe(false);
    await a.secretary.post(`${P(pid)}/actions/${late.id}/cancel`, { expectedVersion: upd.body.version, note: 'No longer needed' }).expect(201);
  });

  it('escalations need a requested action, deadline and at least one option; they are resolved by someone else', async () => {
    const noOptions = await a.pm.post(`${P(pid)}/escalations`, { title: 'x', sourceType: 'other', requestedAction: 'Decide', decisionDeadline: plusDays(5), options: [] });
    expect(noOptions.status).toBe(400);
    const noDeadline = await a.pm.post(`${P(pid)}/escalations`, { title: 'x', sourceType: 'other', requestedAction: 'Decide', options: [{ title: 'A' }] });
    expect(noDeadline.status).toBe(400);
    const e = (await a.pm.post(`${P(pid)}/escalations`, { title: 'Vendor slot conflict (test)', sourceType: 'other', requestedAction: 'Choose a vendor slot', decisionDeadline: plusDays(5), options: [{ title: 'Slot A', impact: 'None' }, { title: 'Slot B' }], target: 'Sponsor' }).expect(201)).body;
    const got = (await a.chair.get(`${P(pid)}/escalations/${e.id}`).expect(200)).body;
    expect(got).toMatchObject({ status: 'open', requestedAction: 'Choose a vendor slot', decisionDeadline: plusDays(5), target: 'Sponsor' });
    expect(got.options).toHaveLength(2);
    await a.chair.post(`${P(pid)}/escalations/${e.id}/resolve`, { expectedVersion: got.version, note: 'Slot A chosen' }).expect(201);
    expect((await a.pm.get(`${P(pid)}/escalations/${e.id}`).expect(200)).body.status).toBe('resolved');
  });
});

describe('Demo seed — governance scenario (spec §21)', () => {
  it('seeds the steering committee, distinct boards, an approved DEMO matrix, meeting #1 and the five decision states', async () => {
    const c = await owner().query(`select id, kind, status, is_demo from committee where project_id = $1 and name like '%(Demo)'`, [pid]);
    expect(c.rows.map((r) => [r.kind, r.status]).sort()).toEqual([
      ['jv_board', 'draft'],
      ['newco_board', 'draft'],
      ['program_steering', 'active'],
    ]);
    expect(c.rows.every((r) => r.is_demo)).toBe(true);
    const sc = c.rows.find((r) => r.kind === 'program_steering')!.id;
    const mx = await owner().query(`select status, is_demo_policy from authority_matrix_version where committee_id = $1`, [sc]);
    expect(mx.rows).toEqual([{ status: 'approved', is_demo_policy: true }]);
    const seats = await owner().query(`select role_label, user_id from committee_membership where committee_id = $1`, [sc]);
    expect(seats.rows.some((s) => s.user_id === null && /Role to be confirmed/.test(s.role_label))).toBe(true);
    const m = await owner().query(`select status, pack_snapshot_id, minutes_approved_by from meeting where committee_id = $1 and number = 1`, [sc]);
    expect(m.rows[0].status).toBe('minutes_approved');
    expect(m.rows[0].pack_snapshot_id).toBeTruthy();
    const d = await owner().query(`select status, authority_outcome, is_demo, gate_key, external_authority_reference from decision where committee_id = $1 order by code`, [sc]);
    expect(d.rows.map((r) => r.status)).toEqual(['implementation_pending', 'recommended', 'submitted', 'approved', 'draft']);
    expect(d.rows[1].authority_outcome).toBe('pending_external_authority');
    // (e) gate G0: recommended to the delegating authority, whose (synthetic) approval was then recorded
    expect(d.rows[3]).toMatchObject({ gate_key: 'G0', authority_outcome: 'pending_external_authority' });
    expect(d.rows[3].external_authority_reference).toMatch(/synthetic/);
    expect(d.rows.every((r) => r.is_demo)).toBe(true);
    const esc = await owner().query(`select e.status from escalation e join decision d on d.id = e.source_id where d.committee_id = $1 order by d.code`, [sc]);
    expect(esc.rows.map((r) => r.status)).toEqual(['decision_requested', 'resolved']);
    // Demo meeting totals visible through the API as well
    const list = (await a.chair.get(`${P(pid)}/meetings?committeeId=${sc}`).expect(200)).body;
    expect(list.items[0]).toMatchObject({ number: 1, status: 'minutes_approved', isDemo: true });
    void meetingVersion;
  });
});
