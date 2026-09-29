import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { P, check, completePlan, createCheck, insertSite, plan, setupProject, Personas } from './readiness-kit';

/**
 * Readiness waivers through the gates module's generic WaiverService (no second waiver engine):
 *  - AT-13 (readiness side): a non-waivable blocker can never be waived; the rejected request is audited; the check stays unmet.
 *  - N-02: the approver must hold the SPECIALIST-SET waiver authority role; basis AND impact are required; no self-approval.
 * The sponsor additionally holds finance_restricted here (can request AND approve) to exercise self-approval.
 */
let projectId: string;
let p: Personas;
let planId: string;
let blockerId: string;

beforeAll(async () => {
  ({ projectId, p } = await setupProject('RD-WAIV', [['sponsor', 'finance_restricted']]));
  const siteId = await insertSite(projectId, 'S-WAIV');
  planId = await completePlan(p.pm, projectId, { siteId, accountableUserId: p.pm.userId });
  blockerId = await createCheck(p.pm, projectId, { area: 'noc', title: 'NOC monitoring coverage verified (test)', mandatory: true, blocker: true, signoffRole: 'functional_approver', cutoverPlanId: planId });
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

const waivers = () => owner().query(`select id, status from waiver where project_id = $1 and target_type = 'readiness_check' and target_id = $2`, [projectId, blockerId]);

describe('Readiness waivers — AT-13 (readiness side) and domain review N-02 [REQ-LCY-012, REQ-LCY-013, REQ-RDY-004]', () => {
  it('AT-13: a waiver request on a non-waivable blocker is rejected (422), audited, and the check stays unmet', async () => {
    const c = await check(p.pm, projectId, blockerId);
    expect(c.waivable).toBe(false); // default: non-waivable until a specialist decides
    const r = await p.pm.post(`${P(projectId)}/readiness-checks/${blockerId}/waivers`, { basis: 'Accelerate Day-1 (test)', impact: 'NOC coverage unverified (test)' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('gates.waiver.non_waivable');
    const audit = await owner().query(`select outcome, actor_user_id, reason from audit_event where project_id = $1 and action = 'readiness_check.waiver.request' and entity_id = $2`, [projectId, blockerId]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ outcome: 'rejected', actor_user_id: p.pm.userId });
    expect((await waivers()).rows).toHaveLength(0);
    const after = await check(p.pm, projectId, blockerId);
    expect(after).toMatchObject({ status: 'not_started', waiverId: null, version: c.version });
    const v = await plan(p.pm, projectId, planId);
    expect(v.goEvaluation.blockers.map((b: { id: string }) => b.id)).toContain(blockerId);
  });

  it('only the assigned specialist determines waivability; a waivable check must name the waiver authority role', async () => {
    const c = await check(p.pm, projectId, blockerId);
    const body = { expectedVersion: c.version, mandatory: true, blocker: true, waivable: true, waiverAuthorityRole: 'sponsor', basis: 'Specialist: NOC coverage may be bridged by the current operator for 30 days (synthetic)' };
    expect((await p.pm.post(`${P(projectId)}/readiness-checks/${blockerId}/determination`, body)).status).toBe(403); // no specialist permission
    expect((await p.sponsor.post(`${P(projectId)}/readiness-checks/${blockerId}/determination`, body)).status).toBe(403);
    const noAuthority = await p.approver.post(`${P(projectId)}/readiness-checks/${blockerId}/determination`, { ...body, waiverAuthorityRole: null });
    expect(noAuthority.status).toBe(422);
    expect(noAuthority.body.code).toBe('readiness.determination.authority_required');
    const ok = await p.approver.post(`${P(projectId)}/readiness-checks/${blockerId}/determination`, body);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(await check(p.pm, projectId, blockerId)).toMatchObject({ waivable: true, waiverAuthorityRole: 'sponsor', waivabilityDeterminedBy: p.approver.userId });
  });

  let waiverId: string;
  it('a request needs basis AND impact (400 without impact); a documented request is accepted', async () => {
    const noImpact = await p.pm.post(`${P(projectId)}/readiness-checks/${blockerId}/waivers`, { basis: 'Bridging arrangement (test)' });
    expect(noImpact.status).toBe(400);
    const r = await p.pm.post(`${P(projectId)}/readiness-checks/${blockerId}/waivers`, {
      basis: 'Current operator NOC bridges coverage for 30 days (synthetic)',
      impact: 'Monitoring by the current operator; residual risk accepted by operations (synthetic)',
      conditions: 'Coverage verified before day 30',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ status: 'requested', authorityRole: 'sponsor', checkId: blockerId, effective: false });
    waiverId = r.body.id;
    const list = (await p.pm.get(`${P(projectId)}/readiness-waivers`).expect(200)).body.items;
    expect(list.map((w: { id: string }) => w.id)).toContain(waiverId);
  });

  it('N-02: an approver without the specialist-set authority role is refused; the waiver stays requested and the check unwaived', async () => {
    const r = await p.chair.post(`${P(projectId)}/readiness-waivers/${waiverId}/approve`, { expectedVersion: 1 });
    expect(r.status).toBe(403); // chair holds gates.waiver.approve but not the `sponsor` waiver authority
    expect((await waivers()).rows).toEqual([{ id: waiverId, status: 'requested' }]);
    expect((await check(p.pm, projectId, blockerId)).status).toBe('not_started');
  });

  it('the holder of the authority role approves: the check is waived with the waiver reference and no longer blocks GO', async () => {
    const r = await p.sponsor.post(`${P(projectId)}/readiness-waivers/${waiverId}/approve`, { expectedVersion: 1, note: 'Approved within the waiver authority (test)' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ status: 'approved', decidedBy: p.sponsor.userId, effective: true });
    const c = await check(p.pm, projectId, blockerId);
    expect(c).toMatchObject({ status: 'waived', waiverId, waiverEffective: true });
    expect(c.waivers).toHaveLength(1);
    const v = await plan(p.pm, projectId, planId);
    expect(v.goEvaluation.blockers.map((b: { id: string }) => b.id)).not.toContain(blockerId);
    const rec = await owner().query(`select decision, approver_user_id from approval_record r join waiver w on w.approval_request_id = r.approval_request_id where w.id = $1`, [waiverId]);
    expect(rec.rows).toEqual([{ decision: 'approve', approver_user_id: p.sponsor.userId }]);
    // A waived check cannot silently become non-waivable (it must be reopened first).
    const det = await p.approver.post(`${P(projectId)}/readiness-checks/${blockerId}/determination`, { expectedVersion: c.version, mandatory: true, blocker: true, waivable: false, waiverAuthorityRole: null, basis: 'Reverse (test)' });
    expect(det.status).toBe(422);
    expect(det.body.code).toBe('readiness.determination.waived_check');
  });

  it('self-approval is refused even for a holder of the authority role (not_self)', async () => {
    const other = await createCheck(p.pm, projectId, { area: 'spares', title: 'Critical spares available (test)', mandatory: true, blocker: true, signoffRole: 'functional_approver', cutoverPlanId: planId });
    const c = await check(p.pm, projectId, other);
    const det = await p.approver.post(`${P(projectId)}/readiness-checks/${other}/determination`, { expectedVersion: c.version, mandatory: true, blocker: true, waivable: true, waiverAuthorityRole: 'sponsor', basis: 'Specialist basis (synthetic)' });
    expect(det.status, JSON.stringify(det.body)).toBe(201);
    const w = await p.sponsor.post(`${P(projectId)}/readiness-checks/${other}/waivers`, { basis: 'Spares arrive after Day 1 (synthetic)', impact: 'Longer repair times (synthetic)' });
    expect(w.status, JSON.stringify(w.body)).toBe(201);
    const self = await p.sponsor.post(`${P(projectId)}/readiness-waivers/${w.body.id}/approve`, { expectedVersion: w.body.version });
    expect(self.status).toBe(403);
    expect((await check(p.pm, projectId, other)).status).toBe('not_started');
  });

  it('the approval is bound to the check version: a change after the request requires a fresh request (409)', async () => {
    const other = await createCheck(p.pm, projectId, { area: 'support', title: 'Support channels operational (test)', mandatory: true, blocker: true, signoffRole: 'functional_approver' });
    let c = await check(p.pm, projectId, other);
    await p.approver.post(`${P(projectId)}/readiness-checks/${other}/determination`, { expectedVersion: c.version, mandatory: true, blocker: true, waivable: true, waiverAuthorityRole: 'sponsor', basis: 'Specialist basis (synthetic)' }).expect(201);
    const w = await p.pm.post(`${P(projectId)}/readiness-checks/${other}/waivers`, { basis: 'Basis (synthetic)', impact: 'Impact (synthetic)' });
    expect(w.status).toBe(201);
    c = await check(p.pm, projectId, other);
    await p.pm.post(`${P(projectId)}/readiness-checks/${other}/test-runs`, { expectedVersion: c.version, result: 'failed', note: 'Channel down (synthetic)' }).expect(201);
    const stale = await p.sponsor.post(`${P(projectId)}/readiness-waivers/${w.body.id}/approve`, { expectedVersion: w.body.version });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('gates.waiver.approval_stale');
    const rej = await p.sponsor.post(`${P(projectId)}/readiness-waivers/${w.body.id}/reject`, { expectedVersion: w.body.version, note: 'Superseded — request again with the current test result (test)' });
    expect(rej.status, JSON.stringify(rej.body)).toBe(201);
    expect(rej.body.status).toBe('rejected');
  });
});
