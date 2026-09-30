import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { P, ok, setupJvProject, JvProject } from './jv-kit';

/**
 * AT-13 (CP side) — a non-waivable condition or an unauthorized waiver request is rejected and logged; the condition
 * remains unmet. Waivability and waiver authority are specialist determinations (default: NOT waivable).
 */
let j: JvProject;
let pid: string;
let closing: string;

async function newCp(title: string) {
  const c = await ok(await j.p.legal.post(`${P(pid)}/closing-conditions`, { closingId: closing, title, ownerUserId: j.p.pm.userId }));
  return c.id as string;
}
const cpOf = async (id: string) => (await j.p.pm.get(`${P(pid)}/closing-conditions/${id}`).expect(200)).body;

beforeAll(async () => {
  j = await setupJvProject('JV-AT13');
  pid = j.projectId;
  const s = await ok(await j.p.pm.post(`${P(pid)}/signings`, { name: 'AT-13 signing (synthetic)' }));
  closing = (await ok(await j.p.pm.post(`${P(pid)}/closings`, { signingId: s.id, name: 'AT-13 closing (synthetic)' }))).id;
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('AT-13 — non-waivable CP or unauthorized waiver: rejected, logged, the CP stays unmet [AT-13, REQ-JV-013]', () => {
  it('a CP is not waivable until a specialist determines otherwise; a waiver request on it is rejected and logged', async () => {
    const id = await newCp('Regulatory approval (synthetic, non-waivable)');
    const c = await cpOf(id);
    expect(c.waivable).toBe(false);
    const r = await j.p.pm.post(`${P(pid)}/closing-conditions/${id}/waivers`, { basis: 'Try to skip (test)', impact: 'None claimed (test)' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('gates.waiver.non_waivable');
    const audit = await owner().query(`select outcome, reason from audit_event where project_id = $1 and action = 'closing_condition.waiver.request' and entity_id = $2`, [pid, id]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ outcome: 'rejected' });
    expect(audit.rows[0].reason).toMatch(/non_waivable/);
    expect((await owner().query(`select count(*)::int n from waiver where target_id = $1`, [id])).rows[0].n).toBe(0);
    const after = await cpOf(id);
    expect(after).toMatchObject({ status: 'open', waiverId: null, version: c.version });
    const d = (await j.p.pm.get(`${P(pid)}/closings/${closing}`).expect(200)).body;
    expect(d.blockers.map((b: { ref: string }) => b.ref)).toContain(c.reference);
  });

  it('only a specialist determines waivability (documented basis); the PM cannot', async () => {
    const id = await newCp('Certificate delivery (synthetic)');
    const c = await cpOf(id);
    const pm = await j.p.pm.post(`${P(pid)}/closing-conditions/${id}/determine-waivability`, { expectedVersion: c.version, blocking: true, waivable: true, waiverAuthorityRole: 'sponsor', basis: 'PM attempt (test)' });
    expect(pm.status).toBe(403);
    const noAuthority = await j.p.legal.post(`${P(pid)}/closing-conditions/${id}/determine-waivability`, { expectedVersion: c.version, blocking: true, waivable: true, waiverAuthorityRole: null, basis: 'Missing authority (test)' });
    expect(noAuthority.status).toBe(422);
    expect(noAuthority.body.code).toBe('jv.cp.waiver_authority_required');
  });

  it('a waiver needs the specialist-set authority: approval outside it is refused; the CP stays unmet', async () => {
    const id = await newCp('Consent with legal authority (synthetic)');
    let c = await cpOf(id);
    await ok(await j.p.legal.post(`${P(pid)}/closing-conditions/${id}/determine-waivability`, { expectedVersion: c.version, blocking: true, waivable: true, waiverAuthorityRole: 'legal_restricted', basis: 'Specialist determination (test)' }));
    const w = await ok(await j.p.pm.post(`${P(pid)}/closing-conditions/${id}/waivers`, { basis: 'Commercial basis (test)', impact: 'Accepted risk (test)' }));
    const byLegal = await j.p.legal.post(`${P(pid)}/closing-condition-waivers/${w.id}/approve`, { expectedVersion: w.version });
    expect(byLegal.status).toBe(403); // Legal holds no jv.cp.waive
    const bySponsor = await j.p.sponsor.post(`${P(pid)}/closing-condition-waivers/${w.id}/approve`, { expectedVersion: w.version });
    expect(bySponsor.status).toBe(403); // the sponsor is not the determined waiver authority
    c = await cpOf(id);
    expect(c.status).toBe('open');
  });

  it('a pending waiver cannot be approved once the CP is determined non-waivable (an exception never overrides it)', async () => {
    const id = await newCp('Consent later found non-waivable (synthetic)');
    let c = await cpOf(id);
    const det = await ok(await j.p.legal.post(`${P(pid)}/closing-conditions/${id}/determine-waivability`, { expectedVersion: c.version, blocking: true, waivable: true, waiverAuthorityRole: 'sponsor', basis: 'Initial determination (test)' }));
    const w = await ok(await j.p.pm.post(`${P(pid)}/closing-conditions/${id}/waivers`, { basis: 'Basis (test)', impact: 'Impact (test)' }));
    await ok(await j.p.legal.post(`${P(pid)}/closing-conditions/${id}/determine-waivability`, { expectedVersion: det.version, blocking: true, waivable: false, waiverAuthorityRole: null, basis: 'Re-determined: non-waivable (test)' }));
    const r = await j.p.sponsor.post(`${P(pid)}/closing-condition-waivers/${w.id}/approve`, { expectedVersion: w.version });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('gates.waiver.non_waivable');
    c = await cpOf(id);
    expect(c.status).toBe('open');
    expect(c.waiverEffective).toBe(false);
  });

  it('an authorized waiver of a waivable CP (sponsor, not the requester) clears the blocker; a non-waivable one never does', async () => {
    const id = await newCp('Waivable deliverable (synthetic)');
    let c = await cpOf(id);
    await ok(await j.p.legal.post(`${P(pid)}/closing-conditions/${id}/determine-waivability`, { expectedVersion: c.version, blocking: true, waivable: true, waiverAuthorityRole: 'sponsor', basis: 'Specialist determination (test)' }));
    const w = await ok(await j.p.pm.post(`${P(pid)}/closing-conditions/${id}/waivers`, { basis: 'Commercially agreed (test)', impact: 'Delivered after closing (test)' }));
    const a = await ok(await j.p.sponsor.post(`${P(pid)}/closing-condition-waivers/${w.id}/approve`, { expectedVersion: w.version }));
    expect(a.status).toBe('approved');
    c = await cpOf(id);
    expect(c).toMatchObject({ status: 'waived', waiverId: w.id, waiverEffective: true });
    const d = (await j.p.pm.get(`${P(pid)}/closings/${closing}`).expect(200)).body;
    expect(d.blockers.map((b: { ref: string }) => b.ref)).not.toContain(c.reference);
    const detail = (await j.p.pm.get(`${P(pid)}/closing-conditions/${id}`).expect(200)).body;
    expect(detail.waivers.map((x: { id: string; status: string }) => [x.id, x.status])).toEqual([[w.id, 'approved']]);
  });
});
