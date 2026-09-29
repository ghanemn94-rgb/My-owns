import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, Client, DC, loginAs, owner, projectIdByCode } from '../helpers';
import { Actors, P, TestCommittee, actors, auditCount, decisionRow, decisionVersion, openMeeting, setupCommittee, tabledDecision, vote } from './gov-fixtures';

let pid: string;
let a: Actors;
let tc: TestCommittee;
let meetingId: string;
let secondSecretary: Client;
let grantId: string;
let reserved: { id: string; code: string };

beforeAll(async () => {
  pid = await projectIdByCode(DC);
  a = await actors();
  tc = await setupCommittee(pid, a);
  meetingId = (await openMeeting(pid, a, tc, ['chair', 'sponsor', 'secretary', 'finance', 'legal', 'approver'])).id;
  // A second secretariat member (granted for this test only) to exercise "recorded by a different authorized person".
  const admin = await loginAs('portfolio.admin');
  secondSecretary = await loginAs('ops.lead');
  grantId = (await admin.post(`${P(pid)}/members`, { userId: secondSecretary.userId, role: 'secretary_cpmo', reason: 'AT-04 test: second secretariat member' }).expect(201)).body.id;
});

afterAll(async () => {
  const admin = await loginAs('portfolio.admin');
  if (grantId) await admin.post(`${P(pid)}/members/${grantId}/revoke`, { reason: 'AT-04 test done' }).expect(201);
  await closeApp();
  await closePools();
});

async function passingVote(decisionId: string) {
  const v = await decisionVersion(a.chair, pid, decisionId);
  for (const k of ['chair', 'sponsor', 'finance', 'legal'] as const) {
    const r = await vote(pid, a[k], decisionId, 'approve', v);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  }
  return v;
}

describe('AT-04 — committee recommends a decision outside its delegation [REQ-GOV-010, REQ-GOV-011, REQ-GOV-022, REQ-GOV-023]', () => {
  it('a passing vote on a reserved decision type is recorded as Recommended — pending external authority, with an escalation (never Approved)', async () => {
    reserved = await tabledDecision(pid, a, a.pm, tc.id, meetingId, { decisionTypeKey: 'jv_signing_authorization', amount: null, requiredAuthority: 'Board of Directors — to be confirmed' });
    const v = await passingVote(reserved.id);
    const r = await a.secretary.post(`${P(pid)}/decisions/${reserved.id}/record-outcome`, { expectedVersion: v });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ status: 'recommended', outcome: 'approve', authorityOutcome: 'pending_external_authority', escalatedTo: 'Board of Directors — to be confirmed' });
    expect(r.body.escalationId).toBeTruthy();

    const row = await decisionRow(reserved.id);
    expect(row.status).toBe('recommended');
    expect(row.status).not.toBe('approved');
    expect(row.authority_outcome).toBe('pending_external_authority');
    expect(row.recommendation_recorded_by).toBe(a.secretary.userId);
    expect(row.escalated_to).toBe('Board of Directors — to be confirmed');

    const esc = await owner().query(`select * from escalation where source_type = 'decision' and source_id = $1`, [reserved.id]);
    expect(esc.rows).toHaveLength(1);
    expect(esc.rows[0]).toMatchObject({ status: 'decision_requested', target: 'Board of Directors — to be confirmed', is_system_generated: true });
    expect(esc.rows[0].options.length).toBeGreaterThan(0);

    const ev = await owner().query(`select type, payload from outbox_event where aggregate_id = $1 order by created_at`, [reserved.id]);
    expect(ev.rows.some((e) => e.type === 'decision.status_changed' && e.payload.to === 'recommended')).toBe(true);
    expect(ev.rows.some((e) => e.type === 'approval.pending' && e.payload.requiredPermission === 'governance.decision.record_external_approval')).toBe(true);

    // The API view shows the same (escalation listed for the decision)
    const list = await a.pm.get(`${P(pid)}/escalations?sourceType=decision&sourceId=${reserved.id}`).expect(200);
    expect(list.body.total).toBe(1);
  });

  it('an amount above the delegated limit, or in another currency without a conversion basis, is only a recommendation; within the limit it is approved', async () => {
    const above = await tabledDecision(pid, a, a.pm, tc.id, meetingId, { amount: { amount: '1500000.0000', currency: 'SAR', unitScale: 1 } });
    const otherCcy = await tabledDecision(pid, a, a.pm, tc.id, meetingId, { amount: { amount: '10.0000', currency: 'USD', unitScale: 1 } });
    const within = await tabledDecision(pid, a, a.pm, tc.id, meetingId, { amount: { amount: '999999.0000', currency: 'SAR', unitScale: 1 } });
    const expected: [string, string, string][] = [
      [above.id, 'recommended', 'pending_external_authority'],
      [otherCcy.id, 'recommended', 'pending_external_authority'],
      [within.id, 'approved', 'within_mandate'],
    ];
    for (const [id, status, authority] of expected) {
      const v = await passingVote(id);
      const r = await a.chair.post(`${P(pid)}/decisions/${id}/record-outcome`, { expectedVersion: v });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body).toMatchObject({ status, authorityOutcome: authority });
      expect((await decisionRow(id)).status).toBe(status);
    }
  });

  it('the person who recorded the recommendation cannot record its external approval (422, audited, unchanged)', async () => {
    const before = await auditCount('governance.recordExternalApproval', a.secretary.userId, 'rejected');
    const v = await decisionVersion(a.secretary, pid, reserved.id);
    const r = await a.secretary.post(`${P(pid)}/decisions/${reserved.id}/record-external-approval`, { expectedVersion: v, externalReference: 'DEMO-BOARD-RESOLUTION-001 (synthetic)' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('governance.approval.same_recorder');
    expect(await auditCount('governance.recordExternalApproval', a.secretary.userId, 'rejected')).toBe(before + 1);
    const row = await decisionRow(reserved.id);
    expect(row.status).toBe('recommended');
    expect(row.version).toBe(v);
  });

  it('an external approval without the external authority reference is refused', async () => {
    const v = await decisionVersion(secondSecretary, pid, reserved.id);
    const r = await secondSecretary.post(`${P(pid)}/decisions/${reserved.id}/record-external-approval`, { expectedVersion: v });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('governance.approval.missing_external_reference');
    expect((await decisionRow(reserved.id)).status).toBe('recommended');
  });

  it('roles without the permission cannot record external approvals (chair → 403)', async () => {
    const v = await decisionVersion(a.chair, pid, reserved.id);
    const r = await a.chair.post(`${P(pid)}/decisions/${reserved.id}/record-external-approval`, { expectedVersion: v, externalReference: 'X' });
    expect(r.status).toBe(403);
  });

  it('a different authorized person with a reference records the external approval → Approved; the escalation is resolved', async () => {
    const v = await decisionVersion(secondSecretary, pid, reserved.id);
    const r = await secondSecretary.post(`${P(pid)}/decisions/${reserved.id}/record-external-approval`, { expectedVersion: v, externalReference: 'DEMO-BOARD-RESOLUTION-001 (synthetic)', note: 'Synthetic external decision' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.status).toBe('approved');
    const row = await decisionRow(reserved.id);
    expect(row).toMatchObject({ status: 'approved', external_authority_reference: 'DEMO-BOARD-RESOLUTION-001 (synthetic)', authority_outcome: 'pending_external_authority' });
    const esc = await owner().query(`select status, resolution_decision_id, resolved_by from escalation where source_id = $1`, [reserved.id]);
    expect(esc.rows[0]).toMatchObject({ status: 'resolved', resolution_decision_id: reserved.id, resolved_by: secondSecretary.userId });
    // Approval is still not implementation.
    expect(row.status).not.toBe('implemented_verified');
  });
});
