import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { setupProject, gateByKey, crit, Personas } from './gate-test-kit';

/**
 * AT-13: a non-waivable condition or an unauthorized waiver request is rejected and logged; the condition stays unmet.
 * The chair additionally holds `legal_restricted` in this project so that a self-approval attempt can be exercised.
 */
let projectId: string;
let p: Personas;

beforeAll(async () => {
  ({ projectId, p } = await setupProject('GT-AT13', [['chair', 'legal_restricted']]));
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

const waivers = () => owner().query(`select id, target_id, status from waiver where project_id = $1`, [projectId]);

describe('AT-13 — non-waivable conditions and unauthorized waivers [REQ-LCY-012, REQ-LCY-013]', () => {
  it('a waiver request on a non-waivable criterion is rejected (422), audited as rejected, and the criterion stays unmet', async () => {
    const g1 = await gateByKey(p.pm, projectId, 'G1');
    const c = crit(g1, 'G1-C02');
    expect(c.waivable).toBe(false);
    const r = await p.pm.post(`/api/v1/projects/${projectId}/gates/${g1.id}/criteria/${c.id}/waivers`, { basis: 'Accelerate G1', impact: 'Perimeter not baselined' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('gates.waiver.non_waivable');
    const audit = await owner().query(
      `select outcome, actor_user_id, reason from audit_event where project_id = $1 and action = 'gates.waiver.request' and entity_id = $2`,
      [projectId, c.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ outcome: 'rejected', actor_user_id: p.pm.userId });
    expect(audit.rows[0].reason).toMatch(/not waivable/);
    expect((await waivers()).rows.filter((w) => w.target_id === c.id)).toHaveLength(0);
    const after = crit(await gateByKey(p.pm, projectId, 'G1'), 'G1-C02');
    expect(after.assessment.status).toBe('unmet');
    expect(after.assessment.waiverId).toBeNull();
  });

  it('only waiver requesters may request (403 for a contributor)', async () => {
    const g3 = await gateByKey(p.pm, projectId, 'G3');
    const c = crit(g3, 'G3-C08');
    const r = await p.contributor.post(`/api/v1/projects/${projectId}/gates/${g3.id}/criteria/${c.id}/waivers`, { basis: 'x', impact: 'y' });
    expect(r.status).toBe(403);
  });

  let waiverId: string;
  it('a waivable criterion accepts a request with basis and impact', async () => {
    const g3 = await gateByKey(p.pm, projectId, 'G3');
    const c = crit(g3, 'G3-C08');
    expect(c.waivable).toBe(true);
    const r = await p.pm.post(`/api/v1/projects/${projectId}/gates/${g3.id}/criteria/${c.id}/waivers`, {
      basis: 'Rehearsal repeated after remediation (synthetic test basis)',
      impact: 'Schedule +1 week; residual risk accepted by operations (synthetic)',
      conditions: 'Second rehearsal before Day 1',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ status: 'requested', authorityRole: 'committee_chair', targetKey: 'G3-C08', gateKey: 'G3' });
    waiverId = r.body.id;
    const dup = await p.pm.post(`/api/v1/projects/${projectId}/gates/${g3.id}/criteria/${c.id}/waivers`, { basis: 'again', impact: 'again' });
    expect(dup.status).toBe(409);
  });

  it('unauthorized approvers are refused (403) and logged: no approve permission, or not the waiver authority role', async () => {
    const w = (await p.pm.get(`/api/v1/projects/${projectId}/gate-waivers`).expect(200)).body.items.find((x: { id: string }) => x.id === waiverId);
    const pmTry = await p.pm.post(`/api/v1/projects/${projectId}/gate-waivers/${waiverId}/approve`, { expectedVersion: w.version });
    expect(pmTry.status).toBe(403);
    // The sponsor holds gates.waiver.approve but the waiver authority for G3-C08 is the committee chair.
    const sponsorTry = await p.sponsor.post(`/api/v1/projects/${projectId}/gate-waivers/${waiverId}/approve`, { expectedVersion: w.version });
    expect(sponsorTry.status).toBe(403);
    const denied = await owner().query(`select count(*)::int as n from audit_event where project_id = $1 and action = 'gates.approveWaiver' and outcome = 'denied'`, [projectId]);
    expect(denied.rows[0].n).toBeGreaterThanOrEqual(2);
    const c = crit(await gateByKey(p.pm, projectId, 'G3'), 'G3-C08');
    expect(c.assessment.status).toBe('unmet');
  });

  it('self-approval is refused even for the waiver authority; the criterion stays unmet', async () => {
    const g5 = await gateByKey(p.chair, projectId, 'G5');
    const c = crit(g5, 'G5-C01');
    const req = await p.chair.post(`/api/v1/projects/${projectId}/gates/${g5.id}/criteria/${c.id}/waivers`, { basis: 'Comparative assessment deferred (synthetic)', impact: 'Partner choice weaker (synthetic)' });
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    const self = await p.chair.post(`/api/v1/projects/${projectId}/gate-waivers/${req.body.id}/approve`, { expectedVersion: req.body.version });
    expect(self.status).toBe(403);
    expect(self.body.detail).toMatch(/Separation of duties/);
    expect(crit(await gateByKey(p.pm, projectId, 'G5'), 'G5-C01').assessment.status).toBe('unmet');
    const w = (await waivers()).rows.find((x) => x.id === req.body.id);
    expect(w?.status).toBe('requested');
  });

  it('when a specialist makes a criterion non-waivable, a pending waiver can no longer be approved', async () => {
    const g5 = await gateByKey(p.finance, projectId, 'G5');
    const c = crit(g5, 'G5-C01');
    // Only specialists may set waivability (pm → 403); the determination is versioned.
    expect((await p.pm.post(`/api/v1/projects/${projectId}/gates/${g5.id}/criteria/${c.id}/waivability`, { expectedVersion: c.version, waivable: false, waivabilityBasis: 'x' })).status).toBe(403);
    const set = await p.finance.post(`/api/v1/projects/${projectId}/gates/${g5.id}/criteria/${c.id}/waivability`, {
      expectedVersion: c.version,
      waivable: false,
      waivabilityBasis: 'Corporate Development specialist: comparative assessment is mandatory for this transaction (synthetic)',
    });
    expect(set.status, JSON.stringify(set.body)).toBe(201);
    expect(set.body).toMatchObject({ waivable: false, waiverAuthorityRole: null, version: c.version + 1 });
    const versions = await owner().query(`select version_no, snapshot from record_version where entity_type = 'gate_criterion' and entity_id = $1 order by version_no`, [c.id]);
    expect(versions.rows.map((v) => v.version_no)).toEqual([c.version, c.version + 1]);
    expect(versions.rows[0].snapshot.waivable).toBe(true);
    expect(versions.rows[1].snapshot.waivable).toBe(false);

    const pending = (await p.pm.get(`/api/v1/projects/${projectId}/gate-waivers?status=requested`).expect(200)).body.items.find((x: { targetKey: string }) => x.targetKey === 'G5-C01');
    const r = await p.chair.post(`/api/v1/projects/${projectId}/gate-waivers/${pending.id}/approve`, { expectedVersion: pending.version });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('gates.waiver.non_waivable');
  });

  it('the waiver authority (chair, not the requester) approves a documented waiver → criterion waived, gate shows the exception', async () => {
    const w = (await p.pm.get(`/api/v1/projects/${projectId}/gate-waivers`).expect(200)).body.items.find((x: { id: string }) => x.id === waiverId);
    const r = await p.chair.post(`/api/v1/projects/${projectId}/gate-waivers/${waiverId}/approve`, { expectedVersion: w.version, note: 'Approved within committee authority (synthetic)' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ status: 'approved', decidedBy: p.chair.userId, effective: true });
    const g3 = await gateByKey(p.pm, projectId, 'G3');
    const c = crit(g3, 'G3-C08');
    expect(c.assessment).toMatchObject({ status: 'waived', waiverId });
    expect(g3.evaluation.hasWaivers).toBe(true);
    expect(g3.evaluation.counts.waived).toBe(1);
    const audit = await owner().query(`select after from audit_event where project_id = $1 and action = 'gates.waiver.approve' and entity_id = $2`, [projectId, waiverId]);
    expect(audit.rows[0].after).toMatchObject({ basis: expect.any(String), impact: expect.any(String), authorityRole: 'committee_chair' });
    // the approval is recorded against the generic approval request, bound to the payload hash and criterion version
    const req = await owner().query(
      `select ar.status, ar.subject_type, ar.subject_version, ar.payload_hash, ar.required_permission, rec.decision, rec.approver_user_id, rec.payload_hash as record_hash
         from waiver w join approval_request ar on ar.id = w.approval_request_id join approval_record rec on rec.approval_request_id = ar.id where w.id = $1`,
      [waiverId],
    );
    expect(req.rows).toHaveLength(1);
    expect(req.rows[0]).toMatchObject({ status: 'approved', subject_type: 'gate_criterion', required_permission: 'gates.waiver.approve', decision: 'approve', approver_user_id: p.chair.userId });
    expect(req.rows[0].record_hash).toBe(req.rows[0].payload_hash);
  });

  it('a waivability/authority change after the request invalidates the pending approval (409 — fresh request required)', async () => {
    let g7 = await gateByKey(p.finance, projectId, 'G7');
    let c = crit(g7, 'G7-C02');
    const setUrl = `/api/v1/projects/${projectId}/gates/${g7.id}/criteria/${c.id}/waivability`;
    await p.finance.post(setUrl, { expectedVersion: c.version, waivable: true, waiverAuthorityRole: 'committee_chair', waivabilityBasis: 'Ops specialist (synthetic)' }).expect(201);
    const req = await p.pm.post(`/api/v1/projects/${projectId}/gates/${g7.id}/criteria/${c.id}/waivers`, { basis: 'b', impact: 'i' });
    expect(req.status).toBe(201);
    g7 = await gateByKey(p.finance, projectId, 'G7');
    c = crit(g7, 'G7-C02');
    await p.finance.post(setUrl, { expectedVersion: c.version, waivable: true, waiverAuthorityRole: 'sponsor', waivabilityBasis: 'Authority re-assigned (synthetic)' }).expect(201);
    const stale = await p.sponsor.post(`/api/v1/projects/${projectId}/gate-waivers/${req.body.id}/approve`, { expectedVersion: req.body.version });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('gates.waiver.approval_stale');
    expect((await p.chair.post(`/api/v1/projects/${projectId}/gate-waivers/${req.body.id}/approve`, { expectedVersion: req.body.version })).status).toBe(403);
    expect(crit(await gateByKey(p.pm, projectId, 'G7'), 'G7-C02').assessment.status).toBe('unmet');
  });

  it('a rejected waiver is recorded with its reason', async () => {
    const g4 = await gateByKey(p.finance, projectId, 'G4');
    const c = crit(g4, 'G4-C07');
    await p.finance
      .post(`/api/v1/projects/${projectId}/gates/${g4.id}/criteria/${c.id}/waivability`, { expectedVersion: c.version, waivable: true, waiverAuthorityRole: 'committee_chair', waivabilityBasis: 'Finance specialist (synthetic)' })
      .expect(201);
    const req = await p.finance.post(`/api/v1/projects/${projectId}/gates/${g4.id}/criteria/${c.id}/waivers`, { basis: 'b', impact: 'i' });
    expect(req.status).toBe(201);
    const rej = await p.chair.post(`/api/v1/projects/${projectId}/gate-waivers/${req.body.id}/reject`, { expectedVersion: req.body.version, note: 'Reconciliation is required before G4 (synthetic)' });
    expect(rej.status).toBe(201);
    expect(rej.body.status).toBe('rejected');
    expect(crit(await gateByKey(p.pm, projectId, 'G4'), 'G4-C07').assessment.status).toBe('unmet');
  });
});
