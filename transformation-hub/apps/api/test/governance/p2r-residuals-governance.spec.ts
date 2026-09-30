import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTERNAL_APPROVAL_LABEL_EN } from '@hub/domain';
import { closeApp, closePools, DC, loginAs, owner, projectIdByCode } from '../helpers';
import {
  Actors,
  DEMO_AUTHORITY_POLICY,
  P,
  SEATS,
  actors,
  decisionRow,
  decisionVersion,
  meetingVersion,
  openMeeting,
  paper,
  tabledDecision,
  uniq,
  verifiedDecisionEvidence,
  voteOutstanding,
} from './gov-fixtures';

/**
 * P2 residuals — governance (docs/phases/P2-P4-requirement-disposition.md, "Update at the P2 gate"):
 *  REQ-GOV-002 two committees with distinct APPROVED authority levels decide differently for the same decision type;
 *  REQ-GOV-027 approval records carry the "Internal electronic approval — not a legally certified signature" label;
 *  REQ-GOV-008 minutes and meeting packs inherit the committee (charter) classification — lists and counts included;
 *  REQ-GOV-009 a PROPOSED meeting series generated from the charter cadence (never scheduled automatically; idempotent);
 *  REQ-GOV-012 screening outcomes merge and reject (reason required), with an `agenda_request.screened` outbox event;
 *  REQ-GOV-019 (API side) an illegal decision command is 422 decision.invalid_transition; a stale version is 409.
 * All values are synthetic test data in the demo project.
 */

let pid: string;
let a: Actors;
const LABEL = { method: 'internal_electronic', label: INTERNAL_APPROVAL_LABEL_EN };
const INTERNAL = 'Internal electronic approval — not a legally certified signature';

/** A committee with its own classification, charter and (optionally) its own approved authority matrix. */
async function committeeWith(opts: { name: string; classification?: string; charter?: Record<string, unknown>; policy?: Record<string, unknown> | null; seats?: boolean }) {
  const created = await a.secretary.post(`${P(pid)}/committees`, {
    kind: 'program_steering',
    name: opts.name,
    classification: opts.classification ?? 'confidential',
    charter: { purpose: 'Integration test committee (synthetic)', ...(opts.charter ?? {}) },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const c = created.body as { id: string; version: number };
  const charterApproval = await a.sponsor.post(`${P(pid)}/committees/${c.id}/charter/approve`, { expectedVersion: c.version, approvalReference: 'TEST (synthetic)' });
  expect(charterApproval.status, JSON.stringify(charterApproval.body)).toBe(201);
  const v = (await a.secretary.post(`${P(pid)}/committees/${c.id}/activate`, { expectedVersion: charterApproval.body.version }).expect(201)).body.version as number;
  const memberships: Record<string, string> = {};
  if (opts.seats !== false) {
    for (const [key, memberRole, voting] of SEATS) {
      const r = await a.secretary.post(`${P(pid)}/committees/${c.id}/memberships`, { userId: a[key].userId, roleLabel: `${key} (test persona)`, memberRole, voting, validFrom: '2026-01-01' });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      memberships[key] = r.body.id;
    }
  }
  let matrixId: string | null = null;
  let matrixApproval: Record<string, unknown> | null = null;
  if (opts.policy !== null) {
    const m = (await a.secretary.post(`${P(pid)}/committees/${c.id}/authority-matrix-versions`, { policy: opts.policy ?? DEMO_AUTHORITY_POLICY, effectiveFrom: '2026-01-01' }).expect(201)).body;
    const ap = await a.sponsor.post(`${P(pid)}/committees/${c.id}/authority-matrix-versions/${m.id}/approve`, { approvalReference: 'TEST DEMO matrix (synthetic)' });
    expect(ap.status, JSON.stringify(ap.body)).toBe(201);
    matrixId = m.id;
    matrixApproval = ap.body;
  }
  return { id: c.id, version: v, memberships, matrixId, charterApproval: charterApproval.body as Record<string, unknown>, matrixApproval };
}

beforeAll(async () => {
  pid = await projectIdByCode(DC);
  a = await actors();
}, 300_000);

afterAll(async () => {
  await closeApp();
  await closePools();
});

// ---------------------------------------------------------------------------------------------------------------------
// REQ-GOV-002 + REQ-GOV-027 (decision / matrix / charter approval records)
// ---------------------------------------------------------------------------------------------------------------------

describe('REQ-GOV-002 — two committees of one project with distinct APPROVED authority matrices decide differently for the same decision type', () => {
  let steering: Awaited<ReturnType<typeof committeeWith>>;
  let board: Awaited<ReturnType<typeof committeeWith>>;
  let within: { id: string };
  let outside: { id: string };
  // Lower delegated limit for the same decision type; above it the board escalates to the steering committee (synthetic).
  const BOARD_POLICY = {
    ...DEMO_AUTHORITY_POLICY,
    decisionTypes: DEMO_AUTHORITY_POLICY.decisionTypes.map((t) => (t.key === 'change_request_budget' ? { ...t, maxAmount: '100000.0000', escalateTo: 'Steering committee (synthetic test body)' } : t)),
  };
  const AMOUNT = { amount: { amount: '500000.0000', currency: 'SAR', unitScale: 1 } };

  beforeAll(async () => {
    steering = await committeeWith({ name: uniq('Steering committee (GOV-002 test)') });
    board = await committeeWith({ name: uniq('Workstream board (GOV-002 test)'), policy: BOARD_POLICY });
  }, 300_000);

  it('both committees have their own APPROVED matrix version, with different limits for change_request_budget', async () => {
    const mA = (await a.pm.get(`${P(pid)}/committees/${steering.id}/authority-matrix-versions`).expect(200)).body.items;
    const mB = (await a.pm.get(`${P(pid)}/committees/${board.id}/authority-matrix-versions`).expect(200)).body.items;
    expect(mA).toHaveLength(1);
    expect(mB).toHaveLength(1);
    expect(mA[0]).toMatchObject({ id: steering.matrixId, status: 'approved' });
    expect(mB[0]).toMatchObject({ id: board.matrixId, status: 'approved' });
    expect(mA[0].policyHash).not.toBe(mB[0].policyHash);
    const limit = (m: { policy: { decisionTypes: { key: string; maxAmount: string }[] } }) => m.policy.decisionTypes.find((t) => t.key === 'change_request_budget')!.maxAmount;
    expect(limit(mA[0])).toBe('1000000.0000');
    expect(limit(mB[0])).toBe('100000.0000');
  });

  it('the same decision type and amount (500,000 DEMO-SAR) is Approved within the mandate of one committee and only Recommended (escalated) by the other', async () => {
    const present = ['chair', 'sponsor', 'secretary', 'finance', 'legal', 'approver'];
    const meetingA = await openMeeting(pid, a, { id: steering.id, memberships: steering.memberships, matrixId: steering.matrixId }, present);
    const meetingB = await openMeeting(pid, a, { id: board.id, memberships: board.memberships, matrixId: board.matrixId }, present);
    within = await tabledDecision(pid, a, a.pm, steering.id, meetingA.id, AMOUNT);
    outside = await tabledDecision(pid, a, a.pm, board.id, meetingB.id, AMOUNT);
    await voteOutstanding(pid, a, within.id, 'approve');
    await voteOutstanding(pid, a, outside.id, 'approve');

    const rA = await a.secretary.post(`${P(pid)}/decisions/${within.id}/record-outcome`, { expectedVersion: await decisionVersion(a.secretary, pid, within.id) });
    expect(rA.status, JSON.stringify(rA.body)).toBe(201);
    expect(rA.body).toMatchObject({ status: 'approved', outcome: 'approve', authorityOutcome: 'within_mandate', escalatedTo: null, escalationId: null });
    const rB = await a.secretary.post(`${P(pid)}/decisions/${outside.id}/record-outcome`, { expectedVersion: await decisionVersion(a.secretary, pid, outside.id) });
    expect(rB.status, JSON.stringify(rB.body)).toBe(201);
    expect(rB.body).toMatchObject({ status: 'recommended', outcome: 'approve', authorityOutcome: 'pending_external_authority', escalatedTo: 'Steering committee (synthetic test body)' });
    expect(rB.body.escalationId).toBeTruthy();

    // Each outcome was computed under its own committee's approved matrix (tally snapshot) — same type, same amount.
    const dA = await decisionRow(within.id);
    const dB = await decisionRow(outside.id);
    expect(dA).toMatchObject({ status: 'approved', decision_type_key: 'change_request_budget', amount_amount: '500000.0000', amount_currency: 'SAR' });
    expect(dB).toMatchObject({ status: 'recommended', decision_type_key: 'change_request_budget', amount_amount: '500000.0000', amount_currency: 'SAR' });
    expect((dA.tally_snapshot as { matrixVersionId: string }).matrixVersionId).toBe(steering.matrixId);
    expect((dB.tally_snapshot as { matrixVersionId: string }).matrixVersionId).toBe(board.matrixId);
    expect((dB.tally_snapshot as { authority: { reasonI18n: { code: string }[] } }).authority.reasonI18n[0]!.code).toBe('authority.above_limit');

    // REQ-GOV-027: the recorded outcomes are internal electronic approval records.
    expect(rA.body.approvalRecord).toEqual(LABEL);
    expect(rB.body.approvalRecord).toEqual(LABEL);
  });

  describe('REQ-GOV-027 — approval records carry "Internal electronic approval — not a legally certified signature" in API responses', () => {
    it('the label text is exactly the internal-approval wording', () => {
      expect(INTERNAL_APPROVAL_LABEL_EN).toBe(INTERNAL);
    });

    it('decision approval: the decision detail carries the label once an outcome is recorded (never on a draft paper)', async () => {
      const approved = (await a.pm.get(`${P(pid)}/decisions/${within.id}`).expect(200)).body;
      expect(approved.approvalRecord).toEqual(LABEL);
      const recommended = (await a.pm.get(`${P(pid)}/decisions/${outside.id}`).expect(200)).body;
      expect(recommended.approvalRecord).toEqual(LABEL);
      const draft = (await a.pm.post(`${P(pid)}/decisions`, paper(steering.id)).expect(201)).body;
      expect((await a.pm.get(`${P(pid)}/decisions/${draft.id}`).expect(200)).body.approvalRecord).toBeNull();
    });

    it('external authority decision: the recording response and the decision carry the label', async () => {
      const evidenceLinkId = await verifiedDecisionEvidence(pid, a.pm, a.legal, outside.id);
      const r = await a.chair.post(`${P(pid)}/decisions/${outside.id}/record-external-approval`, {
        expectedVersion: await decisionVersion(a.chair, pid, outside.id),
        externalReference: 'DEMO-STEERING-RESOLUTION-GOV-002 (synthetic)',
        evidenceLinkId,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body).toMatchObject({ status: 'approved', approvalRecord: LABEL });
      expect((await a.pm.get(`${P(pid)}/decisions/${outside.id}`).expect(200)).body.approvalRecord).toEqual(LABEL);
    });

    it('authority-matrix approval: the approve response and the approved version carry the label; a draft version does not', async () => {
      expect(steering.matrixApproval).toMatchObject({ status: 'approved', approvalRecord: LABEL });
      const draft = (await a.secretary.post(`${P(pid)}/committees/${steering.id}/authority-matrix-versions`, { policy: DEMO_AUTHORITY_POLICY, effectiveFrom: '2026-01-01' }).expect(201)).body;
      const items = (await a.pm.get(`${P(pid)}/committees/${steering.id}/authority-matrix-versions`).expect(200)).body.items as { id: string; approvalRecord: unknown }[];
      expect(items.find((m) => m.id === steering.matrixId)!.approvalRecord).toEqual(LABEL);
      expect(items.find((m) => m.id === draft.id)!.approvalRecord).toBeNull();
    });

    it('charter approval: the approve response and the committee carry the label; an unapproved charter does not', async () => {
      expect(steering.charterApproval).toMatchObject({ status: 'charter_approved', approvalRecord: LABEL });
      expect((await a.pm.get(`${P(pid)}/committees/${steering.id}`).expect(200)).body.charterApproval).toEqual(LABEL);
      const fresh = (await a.secretary.post(`${P(pid)}/committees`, { kind: 'program_steering', name: uniq('Draft committee (GOV-027 test)'), charter: { purpose: 'Synthetic' } }).expect(201)).body;
      expect((await a.pm.get(`${P(pid)}/committees/${fresh.id}`).expect(200)).body.charterApproval).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// REQ-GOV-008 (+ REQ-GOV-027 minutes / pack)
// ---------------------------------------------------------------------------------------------------------------------

describe('REQ-GOV-008 — minutes and meeting packs inherit the committee charter classification (lists and counts included)', () => {
  let restricted: Awaited<ReturnType<typeof committeeWith>>;
  let meetingId: string;
  let packId: string;
  let requestId: string;
  const title = uniq('Restricted committee meeting (GOV-008 test)');
  const itemTitle = uniq('Restricted agenda item (GOV-008 test)');

  beforeAll(async () => {
    // The charter states the classification; the committee record carries it (enforced in SQL visibility).
    restricted = await committeeWith({ name: uniq('Restricted committee (GOV-008 test)'), classification: 'restricted', charter: { classification: 'Restricted — committee members and cleared readers only (synthetic)' }, policy: null, seats: false });
    const m = (await a.secretary.post(`${P(pid)}/committees/${restricted.id}/meetings`, { title, scheduledAt: new Date().toISOString() }).expect(201)).body;
    meetingId = m.id;
    // The chair (cleared to restricted) requests the item; the secretariat screens it onto the agenda.
    requestId = (await a.chair.post(`${P(pid)}/agenda-requests`, { committeeId: restricted.id, title: itemTitle, kind: 'information', meetingId }).expect(201)).body.id;
    await a.secretary.post(`${P(pid)}/agenda-requests/${requestId}/screen`, { expectedVersion: 1, outcome: 'accept', meetingId }).expect(201);
    let v = (await a.secretary.post(`${P(pid)}/meetings/${meetingId}/publish-agenda`, { expectedVersion: m.version }).expect(201)).body.version;
    v = (await a.secretary.post(`${P(pid)}/meetings/${meetingId}/start`, { expectedVersion: v }).expect(201)).body.version;
    v = (await a.secretary.post(`${P(pid)}/meetings/${meetingId}/close`, { expectedVersion: v }).expect(201)).body.version;
    v = (await a.secretary.post(`${P(pid)}/meetings/${meetingId}/minutes`, { expectedVersion: v, text: 'Synthetic restricted minutes (GOV-008 test).' }).expect(201)).body.version;
    const ap = await a.chair.post(`${P(pid)}/meetings/${meetingId}/minutes/approve`, { expectedVersion: v });
    expect(ap.status, JSON.stringify(ap.body)).toBe(201);
    // REQ-GOV-027: the minutes approval response carries the internal-approval label.
    expect(ap.body.approvalRecord).toEqual(LABEL);
    const pack = await a.secretary.post(`${P(pid)}/meetings/${meetingId}/packs`, { expectedVersion: ap.body.version });
    expect(pack.status, JSON.stringify(pack.body)).toBe(201);
    packId = pack.body.id;
  }, 300_000);

  it('a cleared reader sees the meeting, its approved minutes (labelled) and its pack, classified like the committee', async () => {
    const d = (await a.chair.get(`${P(pid)}/meetings/${meetingId}`).expect(200)).body;
    expect(d).toMatchObject({ classification: 'restricted', status: 'minutes_approved', minutesText: 'Synthetic restricted minutes (GOV-008 test).', minutesApproval: LABEL });
    const packs = (await a.chair.get(`${P(pid)}/meetings/${meetingId}/packs`).expect(200)).body.items;
    expect(packs).toHaveLength(1);
    expect(packs[0]).toMatchObject({ id: packId, classification: 'restricted' });
    const pack = (await a.chair.get(`${P(pid)}/meetings/${meetingId}/packs/${packId}`).expect(200)).body;
    expect(pack.classification).toBe('restricted');
    // REQ-GOV-027: the frozen pack carries the same label (and the method).
    expect(pack.payload.labels).toMatchObject({ approvals: INTERNAL, approvalMethod: 'internal_electronic' });
    const row = await owner().query(`select classification from report_snapshot where id = $1`, [packId]);
    expect(row.rows[0].classification).toBe('restricted');
  });

  it('a reader without that clearance (PM: confidential) gets 404 for the meeting, its minutes and its packs', async () => {
    // Control: the same reader opens meetings of confidential committees of the project (read permission is not the cause).
    const confidential = (await a.pm.get(`${P(pid)}/meetings?pageSize=100`).expect(200)).body.items.find((x: { committeeId: string }) => x.committeeId !== restricted.id);
    expect(confidential).toBeTruthy();
    expect((await a.pm.get(`${P(pid)}/meetings/${confidential.id}`)).status).toBe(200);
    expect((await a.pm.get(`${P(pid)}/meetings/${meetingId}`)).status).toBe(404);
    expect((await a.pm.get(`${P(pid)}/meetings/${meetingId}/packs`)).status).toBe(404);
    expect((await a.pm.get(`${P(pid)}/meetings/${meetingId}/packs/${packId}`)).status).toBe(404);
    expect((await a.pm.get(`${P(pid)}/committees/${restricted.id}`)).status).toBe(404);
    // The chair (cleared to restricted) and the PM hold the same read permission on meetings.
    const chair = await loginAs('chair');
    expect((await chair.get(`${P(pid)}/meetings/${meetingId}`)).status).toBe(200);
  });

  it('lists and counts exclude them for that reader: meetings, agenda requests and the activity of the minutes', async () => {
    const q = encodeURIComponent(title);
    const cleared = (await a.chair.get(`${P(pid)}/meetings?q=${q}`).expect(200)).body;
    expect(cleared.total).toBe(1);
    const hidden = (await a.pm.get(`${P(pid)}/meetings?q=${q}`).expect(200)).body;
    expect(hidden).toMatchObject({ total: 0, items: [] });
    expect((await a.pm.get(`${P(pid)}/meetings?committeeId=${restricted.id}`).expect(200)).body.total).toBe(0);
    const iq = encodeURIComponent(itemTitle);
    expect((await a.chair.get(`${P(pid)}/agenda-requests?q=${iq}`).expect(200)).body.total).toBe(1);
    expect((await a.pm.get(`${P(pid)}/agenda-requests?q=${iq}`).expect(200)).body).toMatchObject({ total: 0, items: [] });
    // The minutes draft / approval events are not in the reader's activity feed (visibility inherited from the committee).
    const clearedFeed = (await a.chair.get(`${P(pid)}/activity?entityType=meeting&entityId=${meetingId}`).expect(200)).body;
    expect(clearedFeed.items.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['governance.minutes.draft', 'governance.minutes.approve']));
    expect((await a.pm.get(`${P(pid)}/activity?entityType=meeting&entityId=${meetingId}`).expect(200)).body).toMatchObject({ total: 0, items: [] });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// REQ-GOV-009
// ---------------------------------------------------------------------------------------------------------------------

describe('REQ-GOV-009 — a meeting series generated from the charter cadence is PROPOSED, never scheduled automatically, and idempotent', () => {
  let weekly: Awaited<ReturnType<typeof committeeWith>>;
  let ids: string[] = [];
  // A Sunday, 10:00 Riyadh time (07:00 UTC) — the first meeting given by the secretariat (synthetic).
  const FIRST = '2027-01-03T07:00:00.000Z';
  const path = (cid: string) => `${P(pid)}/committees/${cid}/cadence/proposed-meetings`;

  beforeAll(async () => {
    weekly = await committeeWith({
      name: uniq('Weekly follow-up committee (GOV-009 test)'),
      charter: { cadence: 'Weekly operational follow-up (proposed, synthetic)', cadenceRule: { frequency: 'weekly' } },
      policy: null,
      seats: false,
    });
  }, 300_000);

  it('only the secretariat generates; a charter without a cadence rule cannot be used', async () => {
    const body = { expectedVersion: weekly.version, firstMeetingAt: FIRST, count: 4, title: 'Weekly follow-up (proposed)' };
    expect((await a.pm.post(path(weekly.id), body)).status).toBe(403);
    const noRule = await committeeWith({ name: uniq('No cadence rule (GOV-009 test)'), policy: null, seats: false });
    const r = await a.secretary.post(path(noRule.id), { ...body, expectedVersion: noRule.version });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('governance.cadence.not_configured');
    const stale = await a.secretary.post(path(weekly.id), { ...body, expectedVersion: weekly.version - 1 });
    expect(stale.status).toBe(409);
    const past = await a.secretary.post(path(weekly.id), { ...body, firstMeetingAt: '2026-01-04T07:00:00.000Z' });
    expect(past.status).toBe(422);
    expect(past.body.code).toBe('governance.cadence.start_in_past');
    expect((await owner().query(`select count(*)::int n from meeting where committee_id = $1`, [weekly.id])).rows[0].n).toBe(0);
  });

  it('creates Proposed meetings on the dates the cadence determines from the first meeting (nothing else invented)', async () => {
    const r = await a.secretary.post(path(weekly.id), { expectedVersion: weekly.version, firstMeetingAt: FIRST, count: 4, title: 'Weekly follow-up (proposed)' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.frequency).toBe('weekly');
    expect(r.body.skipped).toEqual([]);
    expect(r.body.created.map((x: { scheduledAt: string }) => x.scheduledAt)).toEqual(['2027-01-03T07:00:00.000Z', '2027-01-10T07:00:00.000Z', '2027-01-17T07:00:00.000Z', '2027-01-24T07:00:00.000Z']);
    expect(r.body.created.map((x: { localDate: string }) => x.localDate)).toEqual(['2027-01-03', '2027-01-10', '2027-01-17', '2027-01-24']);
    ids = r.body.created.map((x: { id: string }) => x.id);
    const list = (await a.pm.get(`${P(pid)}/meetings?committeeId=${weekly.id}&pageSize=100`).expect(200)).body;
    expect(list.total).toBe(4);
    for (const m of list.items) {
      expect(m.status).toBe('proposed');
      expect(m.cadenceCharterVersionNo).toBe(r.body.charterVersionNo);
      expect(m.packSnapshotId).toBeNull();
    }
    const rows = await owner().query(`select status, cadence_charter_version_no from meeting where committee_id = $1`, [weekly.id]);
    expect(rows.rows.every((x) => x.status === 'proposed')).toBe(true);
    const audit = await owner().query(`select count(*)::int n from audit_event where action = 'governance.meeting.propose_series' and entity_id = $1`, [weekly.id]);
    expect(audit.rows[0].n).toBe(1);
  });

  it('is idempotent: the same request creates nothing new; a longer series only adds the missing dates', async () => {
    const again = await a.secretary.post(path(weekly.id), { expectedVersion: weekly.version, firstMeetingAt: FIRST, count: 4, title: 'Weekly follow-up (proposed)' });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.created).toEqual([]);
    expect(again.body.skipped.map((x: { existingMeetingId: string }) => x.existingMeetingId)).toEqual(ids);
    const longer = await a.secretary.post(path(weekly.id), { expectedVersion: weekly.version, firstMeetingAt: FIRST, count: 6, title: 'Weekly follow-up (proposed)' });
    expect(longer.body.created.map((x: { localDate: string }) => x.localDate)).toEqual(['2027-01-31', '2027-02-07']);
    expect(longer.body.skipped).toHaveLength(4);
    ids.push(...longer.body.created.map((x: { id: string }) => x.id));
    expect((await owner().query(`select count(*)::int n from meeting where committee_id = $1`, [weekly.id])).rows[0].n).toBe(6);
  });

  it('a proposed meeting is never published or opened, and takes no agenda item until the secretariat confirms it', async () => {
    const id = ids[0]!;
    const v = await meetingVersion(a.secretary, pid, id);
    const pub = await a.secretary.post(`${P(pid)}/meetings/${id}/publish-agenda`, { expectedVersion: v });
    expect(pub.status).toBe(422);
    expect(pub.body.code).toBe('meeting.invalid_transition');
    expect((await a.secretary.post(`${P(pid)}/meetings/${id}/start`, { expectedVersion: v })).status).toBe(422);
    const req = await a.pm.post(`${P(pid)}/agenda-requests`, { committeeId: weekly.id, title: 'Item for a proposed meeting (synthetic)', kind: 'information', meetingId: id });
    expect(req.status).toBe(422);
    expect(req.body.code).toBe('governance.agenda.meeting_proposed');
    // Only the explicit confirmation makes it a planned meeting.
    expect((await a.pm.post(`${P(pid)}/meetings/${id}/confirm`, { expectedVersion: v })).status).toBe(403);
    const ok = await a.secretary.post(`${P(pid)}/meetings/${id}/confirm`, { expectedVersion: v, note: 'Date confirmed with the members (synthetic)' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await a.pm.get(`${P(pid)}/meetings/${id}`).expect(200)).body.status).toBe('planned');
    expect((await a.secretary.post(`${P(pid)}/meetings/${id}/confirm`, { expectedVersion: ok.body.version })).status).toBe(422);
  });

  it('a declined (cancelled) proposal is not re-created by a later run', async () => {
    const id = ids[1]!;
    const c = await a.secretary.post(`${P(pid)}/meetings/${id}/cancel`, { expectedVersion: await meetingVersion(a.secretary, pid, id), note: 'Date not suitable (synthetic)' });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const again = await a.secretary.post(path(weekly.id), { expectedVersion: weekly.version, firstMeetingAt: FIRST, count: 6, title: 'Weekly follow-up (proposed)' });
    expect(again.body.created).toEqual([]);
    expect(again.body.skipped.map((x: { existingMeetingId: string }) => x.existingMeetingId)).toContain(id);
    expect((await a.pm.get(`${P(pid)}/meetings/${id}`).expect(200)).body.status).toBe('cancelled');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// REQ-GOV-012
// ---------------------------------------------------------------------------------------------------------------------

describe('REQ-GOV-012 — screening outcomes merge (into another request of the same meeting) and reject, each with a reason', () => {
  let committee: Awaited<ReturnType<typeof committeeWith>>;
  let m1: string;
  let m2: string;
  const req = async (meetingId: string | null, over: Record<string, unknown> = {}) => {
    const r = await a.pm.post(`${P(pid)}/agenda-requests`, { committeeId: committee.id, title: uniq('Agenda request (GOV-012 test)'), kind: 'discussion', ...(meetingId ? { meetingId } : {}), ...over });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id as string;
  };
  const screen = (id: string, body: Record<string, unknown>) => a.secretary.post(`${P(pid)}/agenda-requests/${id}/screen`, { expectedVersion: 1, ...body });
  const row = async (id: string) => (await owner().query(`select screening_status, screening_note, merged_into_agenda_item_id, number, meeting_id, screened_by from agenda_item where id = $1`, [id])).rows[0];

  beforeAll(async () => {
    committee = await committeeWith({ name: uniq('Screening committee (GOV-012 test)'), policy: null, seats: false });
    m1 = (await a.secretary.post(`${P(pid)}/committees/${committee.id}/meetings`, { title: uniq('Meeting 1 (GOV-012 test)'), scheduledAt: '2027-02-01T07:00:00.000Z' }).expect(201)).body.id;
    m2 = (await a.secretary.post(`${P(pid)}/committees/${committee.id}/meetings`, { title: uniq('Meeting 2 (GOV-012 test)'), scheduledAt: '2027-03-01T07:00:00.000Z' }).expect(201)).body.id;
  }, 300_000);

  it('reject: a reason is required (400); with it the request is screened out, the reason recorded, the requester event emitted', async () => {
    const id = await req(m1);
    const noReason = await screen(id, { outcome: 'reject' });
    expect(noReason.status).toBe(400);
    expect((await row(id)).screening_status).toBe('requested');
    const r = await screen(id, { outcome: 'reject', note: 'Out of the committee remit (synthetic)' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ screeningStatus: 'rejected', number: null, mergedIntoAgendaItemId: null });
    expect(await row(id)).toMatchObject({ screening_status: 'rejected', screening_note: 'Out of the committee remit (synthetic)', number: null, screened_by: a.secretary.userId });
    const audit = await owner().query(`select reason, after from audit_event where action = 'governance.agenda_request.screen' and entity_id = $1`, [id]);
    expect(audit.rows[0]).toMatchObject({ reason: 'Out of the committee remit (synthetic)' });
    const ev = await owner().query(`select payload from outbox_event where type = 'agenda_request.screened' and aggregate_id = $1`, [id]);
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0].payload).toMatchObject({ agendaItemId: id, outcome: 'reject', screeningStatus: 'rejected', requesterUserId: a.pm.userId });
    // A rejected request is closed: no further screening.
    const again = await a.secretary.post(`${P(pid)}/agenda-requests/${id}/screen`, { expectedVersion: r.body.version, outcome: 'accept', meetingId: m1 });
    expect(again.status).toBe(422);
    expect(again.body.code).toBe('agenda_request.invalid_transition');
  });

  it('merge: into another live request of the same meeting only, with a reason; the merged request gets no agenda number', async () => {
    const target = await req(m1);
    const other = await req(m2);
    const closed = await req(m1);
    await screen(closed, { outcome: 'return', note: 'Needs more detail (synthetic)' }).expect(201);
    const src = await req(m1);
    expect((await screen(src, { outcome: 'merge', mergeIntoAgendaItemId: target })).status).toBe(400); // no reason
    expect((await screen(src, { outcome: 'merge', note: 'Same topic (synthetic)' })).status).toBe(400); // no target
    const codeOf = async (body: Record<string, unknown>) => {
      const r = await screen(src, { outcome: 'merge', note: 'Same topic (synthetic)', ...body });
      expect(r.status, JSON.stringify(r.body)).toBe(422);
      return r.body.code as string;
    };
    expect(await codeOf({ mergeIntoAgendaItemId: src })).toBe('governance.agenda.merge_self');
    expect(await codeOf({ mergeIntoAgendaItemId: other })).toBe('governance.agenda.merge_other_meeting');
    expect(await codeOf({ mergeIntoAgendaItemId: closed })).toBe('governance.agenda.merge_target_closed');
    expect((await row(src)).screening_status).toBe('requested');

    const ok = await screen(src, { outcome: 'merge', mergeIntoAgendaItemId: target, note: 'Same topic as the other request (synthetic)' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ screeningStatus: 'merged', mergedIntoAgendaItemId: target, number: null });
    expect(await row(src)).toMatchObject({ screening_status: 'merged', merged_into_agenda_item_id: target, meeting_id: m1, number: null, screening_note: 'Same topic as the other request (synthetic)' });
    const listed = (await a.pm.get(`${P(pid)}/agenda-requests?meetingId=${m1}&screeningStatus=merged`).expect(200)).body.items;
    expect(listed.find((x: { id: string }) => x.id === src)).toMatchObject({ screeningStatus: 'merged', mergedIntoAgendaItemId: target });
    const ev = await owner().query(`select payload from outbox_event where type = 'agenda_request.screened' and aggregate_id = $1`, [src]);
    expect(ev.rows[0].payload).toMatchObject({ outcome: 'merge', mergedIntoAgendaItemId: target, requesterUserId: a.pm.userId });
    // The target can still be accepted and numbered; a merged request cannot be screened again.
    const acc = await screen(target, { outcome: 'accept', meetingId: m1 });
    expect(acc.status, JSON.stringify(acc.body)).toBe(201);
    expect(acc.body.number).toBeGreaterThan(0);
    expect((await a.secretary.post(`${P(pid)}/agenda-requests/${src}/screen`, { expectedVersion: ok.body.version, outcome: 'accept', meetingId: m1 })).status).toBe(422);
  });

  it('a request for a decision paper merges only into a request for the same paper; the requester cannot screen (403)', async () => {
    const target = await req(m1);
    const d = (await a.pm.post(`${P(pid)}/decisions`, paper(committee.id)).expect(201)).body;
    const src = await req(m1, { decisionId: d.id });
    const r = await screen(src, { outcome: 'merge', mergeIntoAgendaItemId: target, note: 'Same topic (synthetic)' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('governance.agenda.merge_decision_conflict');
    // The secretariat's own request is never screened by the same person (not_self).
    const own = (await a.secretary.post(`${P(pid)}/agenda-requests`, { committeeId: committee.id, title: uniq('Own request (GOV-012 test)'), kind: 'information', meetingId: m1 }).expect(201)).body.id;
    expect((await screen(own, { outcome: 'reject', note: 'Self-screening attempt (synthetic)' })).status).toBe(403);
    expect((await row(own)).screening_status).toBe('requested');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// REQ-GOV-019 (API side of the unit test in packages/domain/src/governance.p2r.test.ts)
// ---------------------------------------------------------------------------------------------------------------------

describe('REQ-GOV-019 — an illegal decision command is refused with 422 decision.invalid_transition; only a version conflict is 409', () => {
  it('defer / resume / start-review of a draft paper: 422 with the machine code; the paper is unchanged', async () => {
    const tc = await committeeWith({ name: uniq('Transition committee (GOV-019 test)'), policy: null, seats: false });
    const d = (await a.pm.post(`${P(pid)}/decisions`, paper(tc.id)).expect(201)).body;
    const attempts: [typeof a.chair, string, Record<string, unknown>][] = [
      [a.chair, 'defer', { note: 'Illegal from draft (synthetic)' }],
      [a.secretary, 'resume', {}],
      [a.secretary, 'start-review', {}],
    ];
    for (const [c, cmd, body] of attempts) {
      const r = await c.post(`${P(pid)}/decisions/${d.id}/${cmd}`, { expectedVersion: d.version, ...body });
      expect(r.status, `${cmd}: ${JSON.stringify(r.body)}`).toBe(422);
      expect(r.body.code).toBe('decision.invalid_transition');
    }
    const stale = await a.chair.post(`${P(pid)}/decisions/${d.id}/defer`, { expectedVersion: d.version + 5, note: 'Stale (synthetic)' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('concurrency.version_mismatch');
    expect(await decisionRow(d.id)).toMatchObject({ status: 'draft', version: d.version });
  });
});
