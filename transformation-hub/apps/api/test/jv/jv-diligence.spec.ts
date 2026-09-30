import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { P, auditRows, doc, grant, in30, ok, partnerAt, room, setupJvProject, syntheticUser, DocClient, JvProject } from './jv-kit';

/**
 * Due diligence Q&A (REQ-JV-010) and findings (REQ-JV-011, ARCH-22): the counterparty's projection shows only the
 * question, status, due date and the RELEASED answer; release needs an approved review by someone other than the drafter;
 * findings inherit the room of their DD request (derived in the database) and are visible to that room's members only.
 */
let j: JvProject;
let pid: string;
let roomId: string;
let otherRoom: string;
let ext: DocClient;
let requestId: string;

const detail = async (c: DocClient, id: string) => (await c.get(`${P(pid)}/diligence-requests/${id}`).expect(200)).body;

beforeAll(async () => {
  j = await setupJvProject('JV-DD');
  pid = j.projectId;
  const { p } = j;
  const partnerId = await partnerAt(j, 'DD Partner (fictional)');
  ext = await syntheticUser(j.orgId, 'jv.dd.ext', 'external');
  await ok(await p.legal.post(`${P(pid)}/partners/${partnerId}/contacts`, { userId: ext.userId }));
  roomId = (await room(p.pm, pid, { name: 'DD room (test)', type: 'partner', partnerId })).id;
  otherRoom = (await room(p.pm, pid, { name: 'Internal working room (test)', type: 'internal' })).id;
  await ok(await grant(p.legal, pid, roomId, { userId: p.sponsor.userId, accessLevel: 'manage' }));
  await ok(await grant(p.sponsor, pid, roomId, { userId: p.legal.userId, accessLevel: 'manage' }));
  await ok(await grant(p.legal, pid, roomId, { userId: p.finance.userId, accessLevel: 'contribute' }));
  await ok(await grant(p.legal, pid, roomId, { userId: ext.userId, role: 'external_partner_limited', accessLevel: 'contribute', expiresAt: in30() }));
  requestId = (await ok(await ext.post(`${P(pid)}/partner-access/rooms/${roomId}/dd-requests`, { question: 'Please provide the synthetic asset register.', domain: 'technical' }))).id;
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('REQ-JV-010 — DD requests / Q&A: controlled answer workflow and release', () => {
  it('the counterparty raises a question in its room; the deal team sees the internal projection', async () => {
    const list = (await j.p.pm.get(`${P(pid)}/diligence-requests?roomId=${roomId}`).expect(200)).body;
    expect(list.items.map((x: { id: string; origin: string; number: number }) => [x.id, x.origin, x.number])).toEqual([[requestId, 'partner', 1]]);
    const mine = (await ext.get(`${P(pid)}/partner-access/rooms/${roomId}/dd-requests`).expect(200)).body.items;
    expect(mine).toHaveLength(1);
    expect(Object.keys(mine[0]).sort()).toEqual(['answer', 'answeredAt', 'createdAt', 'domain', 'dueDate', 'id', 'number', 'question', 'status'].sort());
    expect(mine[0]).toMatchObject({ status: 'open', answer: null });
    // No grant → no DD request (even with jv.dd_request.read).
    expect((await j.p.contributor.get(`${P(pid)}/diligence-requests/${requestId}`)).status).toBe(404);
    expect((await j.p.contributor.get(`${P(pid)}/diligence-requests`).expect(200)).body.total).toBe(0);
  });

  it('UT: release without approval is rejected (and logged); the drafter never reviews or releases', async () => {
    let d = await detail(j.p.pm, requestId);
    const sameReviewer = await j.p.pm.post(`${P(pid)}/diligence-requests/${requestId}/assign`, { expectedVersion: d.version, assigneeUserId: j.p.finance.userId, reviewerUserId: j.p.finance.userId });
    expect(sameReviewer.body.code).toBe('jv.dd.reviewer_is_assignee');
    const noGrant = await j.p.pm.post(`${P(pid)}/diligence-requests/${requestId}/assign`, { expectedVersion: d.version, assigneeUserId: j.p.approver.userId });
    expect(noGrant.body.code).toBe('jv.dd.not_room_worker');
    await ok(await j.p.pm.post(`${P(pid)}/diligence-requests/${requestId}/assign`, { expectedVersion: d.version, assigneeUserId: j.p.finance.userId, reviewerUserId: j.p.legal.userId, dueDate: '2026-12-31' }));
    d = await detail(j.p.finance, requestId);
    const elsewhere = await doc(j.p.pm, pid, 'Doc in another room (synthetic)', { roomId: otherRoom });
    const wrongEvidence = await j.p.finance.post(`${P(pid)}/diligence-requests/${requestId}/answer`, { expectedVersion: d.version, answerDraft: 'Draft (synthetic)', evidenceDocumentIds: [elsewhere.id] });
    expect(wrongEvidence.status).toBe(404); // finance cannot even see the other room's document
    const evidenceDoc = await doc(j.p.pm, pid, 'Synthetic asset register', { roomId });
    const drafted = await ok(await j.p.finance.post(`${P(pid)}/diligence-requests/${requestId}/answer`, { expectedVersion: d.version, answerDraft: 'The synthetic register is attached.', evidenceDocumentIds: [evidenceDoc.id] }));
    const early = await j.p.legal.post(`${P(pid)}/diligence-requests/${requestId}/release`, { expectedVersion: drafted.version });
    expect(early.status).toBe(422);
    expect(early.body.code).toBe('jv.dd.release_requires_approval');
    expect((await auditRows(pid, 'jv.dd_answer.release', requestId)).map((r) => r.outcome)).toEqual(['rejected']);
    const sub = await ok(await j.p.finance.post(`${P(pid)}/diligence-requests/${requestId}/submit-for-review`, { expectedVersion: drafted.version }));
    const stillEarly = await j.p.legal.post(`${P(pid)}/diligence-requests/${requestId}/release`, { expectedVersion: sub.version });
    expect(stillEarly.body.code).toBe('jv.dd.release_requires_approval');
    const selfReview = await j.p.finance.post(`${P(pid)}/diligence-requests/${requestId}/review`, { expectedVersion: sub.version, outcome: 'approve' });
    expect(selfReview.status).toBe(403);
    const rev = await ok(await j.p.legal.post(`${P(pid)}/diligence-requests/${requestId}/review`, { expectedVersion: sub.version, outcome: 'approve', note: 'Reviewed (test)' }));
    expect(rev.releaseStatus).toBe('approved_for_release');
    expect((await ext.get(`${P(pid)}/partner-access/rooms/${roomId}/dd-requests`).expect(200)).body.items[0]).toMatchObject({ status: 'open', answer: null });
    const byDrafter = await j.p.finance.post(`${P(pid)}/diligence-requests/${requestId}/release`, { expectedVersion: rev.version });
    expect(byDrafter.status).toBe(403);
    const rel = await ok(await j.p.legal.post(`${P(pid)}/diligence-requests/${requestId}/release`, { expectedVersion: rev.version }));
    expect(rel).toMatchObject({ releaseStatus: 'released', disclosures: 1 });
    const seen = (await ext.get(`${P(pid)}/partner-access/rooms/${roomId}/dd-requests`).expect(200)).body.items[0];
    expect(seen).toMatchObject({ status: 'answered', answer: 'The synthetic register is attached.' });
    const disclosed = (await ext.get(`${P(pid)}/partner-access/rooms/${roomId}/disclosures`).expect(200)).body.items;
    expect(disclosed.map((x: { title: string }) => x.title)).toEqual(['Synthetic asset register']);
    const full = await detail(j.p.pm, requestId);
    expect(full).toMatchObject({ releaseStatus: 'released', draftedBy: j.p.finance.userId, releaseApprovedBy: j.p.legal.userId, releasedBy: j.p.legal.userId, releasedAnswer: 'The synthetic register is attached.' });
  });
});

describe('REQ-JV-011 / ARCH-22 — findings', () => {
  it('UT: a material finding requires a remediation owner (API and database)', async () => {
    const r = await j.p.finance.post(`${P(pid)}/diligence-findings`, { title: 'Material finding (synthetic)', materiality: 'critical', diligenceRequestId: requestId, remediation: 'Fix (synthetic)' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('jv.finding.remediation_owner_required');
    await expect(owner().query(`insert into diligence_finding (org_id, project_id, code, title, materiality) values ($1,$2,'PROBE-F1','probe','high')`, [j.orgId, pid])).rejects.toMatchObject({ code: '23514' });
  });

  it("a finding raised from a DD request carries the request's room (derived) and is visible to that room's members only", async () => {
    const mismatch = await j.p.finance.post(`${P(pid)}/diligence-findings`, { title: 'x', materiality: 'low', diligenceRequestId: requestId, roomId: otherRoom });
    expect(mismatch.status).toBe(422);
    const f = await ok(await j.p.finance.post(`${P(pid)}/diligence-findings`, {
      title: 'Lease consent needed (synthetic)',
      materiality: 'high',
      diligenceRequestId: requestId,
      remediation: 'Obtain consent (synthetic)',
      remediationOwnerUserId: j.p.legal.userId,
      cpImplication: 'Becomes a CP (synthetic)',
    }));
    const row = (await owner().query('select room_id from diligence_finding where id = $1', [f.id])).rows[0];
    expect(row.room_id).toBe(roomId);
    // Database derivation: a client-supplied room is overwritten by the request's room.
    const forged = await owner().query(`insert into diligence_finding (org_id, project_id, code, title, materiality, diligence_request_id, room_id) values ($1,$2,'PROBE-F2','probe','low',$3,$4) returning room_id`, [j.orgId, pid, requestId, otherRoom]);
    expect(forged.rows[0].room_id).toBe(roomId);
    // Visibility inside SQL: members of the room see it; members without a grant do not (list, count, detail).
    expect((await j.p.finance.get(`${P(pid)}/diligence-findings`).expect(200)).body.items.map((x: { id: string }) => x.id)).toContain(f.id);
    for (const c of [j.p.contributor, j.p.approver]) {
      const list = (await c.get(`${P(pid)}/diligence-findings`).expect(200)).body;
      expect(list.total, c.persona).toBe(0);
      expect((await c.get(`${P(pid)}/diligence-findings/${f.id}`)).status, c.persona).toBe(404);
    }
    await ok(await grant(j.p.legal, pid, roomId, { userId: j.p.approver.userId, accessLevel: 'read' }));
    expect((await j.p.approver.get(`${P(pid)}/diligence-findings/${f.id}`).expect(200)).body).toMatchObject({ id: f.id, material: true, roomId });
    // Lifecycle: stages are not skipped; accepting a risk needs a reason.
    const skip = await j.p.finance.post(`${P(pid)}/diligence-findings/${f.id}/transition`, { expectedVersion: 1, command: 'close' });
    expect(skip.status).toBe(422);
    const noReason = await j.p.finance.post(`${P(pid)}/diligence-findings/${f.id}/transition`, { expectedVersion: 1, command: 'accept_risk' });
    expect(noReason.body.code).toBe('jv.finding.reason_required');
    const planned = await ok(await j.p.finance.post(`${P(pid)}/diligence-findings/${f.id}/transition`, { expectedVersion: 1, command: 'plan_remediation' }));
    expect(planned.status).toBe('remediation_planned');
    const clearOwner = await j.p.finance.patch(`${P(pid)}/diligence-findings/${f.id}`, { expectedVersion: planned.version, remediationOwnerUserId: null });
    expect(clearOwner.body.code).toBe('jv.finding.remediation_owner_required');
  });
});
