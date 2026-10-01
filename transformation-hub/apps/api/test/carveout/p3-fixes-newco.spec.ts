import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { runWorker } from '../gates/gate-test-kit';
import { Personas, base, carveoutProject, linkEvidence, newcoId, ok } from './carveout-kit';

/**
 * Fixes of the P3 domain / security reviews for NewCo incorporation (docs/reviews/P3-domain-review.md DOM-P3-08, DOM-P3-10):
 * a verified incorporation whose evidence is rejected returns to "evidence pending" (history kept) and Legal verifies again
 * on valid evidence; the person who linked the evidence never verifies on it. All data is synthetic.
 */
let pid: string;
let p: Personas;
const dims = async () => (await p.pm.post(`${base(pid)}/status-dimensions/recompute`, {})).body as { items: { key: string; state: string; explanationI18n: { code: string }[] }[] };
const inc = async () => (await dims()).items.find((d) => d.key === 'incorporation')!;

beforeAll(async () => {
  ({ projectId: pid, p } = await carveoutProject('P3FIX-NC'));
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('DOM-P3-08 — incorporation evidence rejected after verification [AT-06, AT-14, REQ-SET-010, REQ-LCY-007]', () => {
  it('the verification returns to "proposed" (evidence pending, audited, history kept); Legal verifies again on new evidence linked by someone else', async () => {
    const entityId = await newcoId(p.pm, pid);
    const link = await linkEvidence(p.pm, pid, 'legal_entity', entityId, 'Synthetic registration extract');
    let e = (await p.pm.get(`${base(pid)}/legal-entities/${entityId}`).expect(200)).body;
    await ok(p.pm.post(`${base(pid)}/legal-entities/${entityId}/incorporation`, { expectedVersion: e.version, status: 'incorporated', evidenceNote: 'Extract linked' }));
    e = (await p.legal.get(`${base(pid)}/legal-entities/${entityId}`).expect(200)).body;
    await ok(p.legal.post(`${base(pid)}/legal-entities/${entityId}/incorporation/verify`, { expectedVersion: e.version, outcome: 'confirm', note: 'Checked' }));
    expect((await inc()).state).toBe('incorporated_verified');
    const lv = (await owner().query(`select version from evidence_link where id = $1`, [link.id])).rows[0].version as number;
    await ok(p.secretary.post(`${base(pid)}/evidence/${link.id}/verify`, { expectedVersion: lv, decision: 'reject', note: 'Extract of another company (synthetic)' }));
    // Before the worker runs, the dimension already does not count the verification (its evidence is gone).
    expect((await inc()).state).not.toBe('incorporated_verified');
    await runWorker();
    e = (await p.pm.get(`${base(pid)}/legal-entities/${entityId}`).expect(200)).body;
    expect(e.incorporation).toMatchObject({ status: 'incorporated', verification: 'proposed', verifiedBy: null });
    const audit = await owner().query(`select after from audit_event where project_id = $1 and entity_id = $2 and action = 'newco.incorporation.evidence_invalidated'`, [pid, entityId]);
    expect(audit.rows).toHaveLength(1);
    // The confirmed verification stays in the record history, followed by the invalidation.
    const hist = await owner().query(`select reason, snapshot->>'incorporationVerification' as v from record_version where entity_type = 'legal_entity' and entity_id = $1 order by version_no`, [entityId]);
    const reasons = hist.rows.map((r) => `${r.reason}:${r.v}`);
    expect(reasons.slice(-2)).toEqual(['Incorporation verified:confirmed', 'Incorporation evidence invalidated — re-verification required:proposed']);
    expect((await inc()).state).not.toBe('incorporated_verified');
    // Re-verification: new evidence (linked by the PM), Legal verifies again.
    await linkEvidence(p.pm, pid, 'legal_entity', entityId, 'Correct registration extract (synthetic)');
    e = (await p.legal.get(`${base(pid)}/legal-entities/${entityId}`).expect(200)).body;
    await ok(p.legal.post(`${base(pid)}/legal-entities/${entityId}/incorporation/verify`, { expectedVersion: e.version, outcome: 'confirm', note: 'Checked against the correct extract' }));
    expect((await inc()).state).toBe('incorporated_verified');
  });

  it('DOM-P3-10: whoever linked the incorporation evidence does not verify on it (403); the refusal is audited', async () => {
    const created = await ok<{ id: string }>(p.pm.post(`${base(pid)}/legal-entities`, { name: 'Linker test company (fictional entity)', kind: 'jv_company', role: 'jv_company' }));
    await linkEvidence(p.legal, pid, 'legal_entity', created.id, 'Extract linked by Legal (synthetic)');
    let e = (await p.pm.get(`${base(pid)}/legal-entities/${created.id}`).expect(200)).body;
    await ok(p.pm.post(`${base(pid)}/legal-entities/${created.id}/incorporation`, { expectedVersion: e.version, status: 'incorporated' }));
    e = (await p.legal.get(`${base(pid)}/legal-entities/${created.id}`).expect(200)).body;
    const v = await p.legal.post(`${base(pid)}/legal-entities/${created.id}/incorporation/verify`, { expectedVersion: e.version, outcome: 'confirm', note: 'On my own evidence (synthetic)' });
    expect(v.status).toBe(403);
    const denied = await owner().query(`select count(*)::int n from audit_event where project_id = $1 and actor_user_id = $2 and action = 'newco.verifyIncorporation' and outcome = 'denied'`, [pid, p.legal.userId]);
    expect(denied.rows[0].n).toBeGreaterThanOrEqual(1);
    expect((await p.pm.get(`${base(pid)}/legal-entities/${created.id}`).expect(200)).body.incorporation.verification).toBe('proposed');
  });
});
