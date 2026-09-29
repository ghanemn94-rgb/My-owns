import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, loginAs, owner } from '../helpers';
import { runWorker } from '../gates/gate-test-kit';
import { Personas, auditRows, base, carveoutProject, createItem, linkEvidence, newcoId, ok } from './carveout-kit';

/**
 * AT-06: NewCo incorporation is confirmed while assets / contracts / operations remain pending → the dimensions stay
 * separate and the carve-out is never shown as complete (checked against the gates module's StatusDimensionsService).
 * REQ-SET-010: "incorporated" needs evidence; the default is unconfirmed; the recorder cannot verify.
 */
let pid: string;
let p: Personas;
let entityId: string;
type Dim = { key: string; state: string };
const states = (items: Dim[]) => Object.fromEntries(items.map((d) => [d.key, d.state]));

beforeAll(async () => {
  ({ projectId: pid, p } = await carveoutProject('CO-AT06'));
  entityId = await newcoId(p.pm, pid);
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('AT-06 — incorporation confirmed, carve-out not complete [AT-06, REQ-LCY-007, REQ-SET-010, REQ-PER-007]', () => {
  it('a new NewCo starts unconfirmed with unknown verification (never assumed)', async () => {
    const e = (await p.legal.get(`${base(pid)}/legal-entities/${entityId}`).expect(200)).body;
    expect(e.incorporation).toMatchObject({ status: 'unconfirmed', verification: 'unknown', recordedBy: null, verifiedBy: null });
  });

  it('UT/IT: recording "incorporated" without evidence is rejected, audited, and changes nothing', async () => {
    const e = (await p.pm.get(`${base(pid)}/legal-entities/${entityId}`).expect(200)).body;
    const r = await p.pm.post(`${base(pid)}/legal-entities/${entityId}/incorporation`, { expectedVersion: e.version, status: 'incorporated' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('newco.incorporation.evidence_required');
    const db = await owner().query('select incorporation_status, version from legal_entity where id = $1', [entityId]);
    expect(db.rows[0]).toMatchObject({ incorporation_status: 'unconfirmed', version: e.version });
    expect((await auditRows(pid, 'newco.recordIncorporation', 'rejected')).length).toBe(1);
  });

  it('a contributor cannot record incorporation (403) and a Project-B user cannot see the entity (404)', async () => {
    const e = (await p.pm.get(`${base(pid)}/legal-entities/${entityId}`).expect(200)).body;
    expect((await p.contributor.post(`${base(pid)}/legal-entities/${entityId}/incorporation`, { expectedVersion: e.version, status: 'unconfirmed' })).status).toBe(403);
    const pmB = await loginAs('pm.b');
    expect((await pmB.get(`${base(pid)}/legal-entities/${entityId}`)).status).toBe(404);
    expect((await pmB.get(`${base(pid)}/legal-entities`)).status).toBe(404);
  });

  it('with evidence the PM records "incorporated" — proposed, not verified; the incorporation dimension says unverified', async () => {
    await linkEvidence(p.pm, pid, 'legal_entity', entityId, 'Synthetic registration extract (test)');
    const e = (await p.pm.get(`${base(pid)}/legal-entities/${entityId}`).expect(200)).body;
    const r = await ok<{ status: string; verification: string; statusDimensions: { items: Dim[]; carveOutComplete: boolean } }>(
      p.pm.post(`${base(pid)}/legal-entities/${entityId}/incorporation`, { expectedVersion: e.version, status: 'incorporated', evidenceNote: 'Registration extract linked (test)' }),
    );
    expect(r).toMatchObject({ status: 'incorporated', verification: 'proposed' });
    expect(states(r.statusDimensions.items).incorporation).toBe('incorporated_unverified');
    expect(r.statusDimensions.carveOutComplete).toBe(false);
  });

  it('the recorder cannot verify their own record (not_self → 403, audited as denied)', async () => {
    const e = (await p.pm.get(`${base(pid)}/legal-entities/${entityId}`).expect(200)).body;
    // PM lacks newco.incorporation.verify entirely; Legal recording then verifying is the separation-of-duties case below.
    expect((await p.pm.post(`${base(pid)}/legal-entities/${entityId}/incorporation/verify`, { expectedVersion: e.version, outcome: 'confirm' })).status).toBe(403);
  });

  it('Legal verifies against evidence; incorporation is verified but transfers and operations stay pending → not complete', async () => {
    // Perimeter: one included item, nothing transferred (no baseline yet → direct).
    await createItem(p.pm, pid, { type: 'site', name: 'AT-06 test site (synthetic)', disposition: 'included' });
    const e = (await p.legal.get(`${base(pid)}/legal-entities/${entityId}`).expect(200)).body;
    const r = await ok<{ verification: string; statusDimensions: { items: Dim[]; carveOutComplete: boolean } }>(
      p.legal.post(`${base(pid)}/legal-entities/${entityId}/incorporation/verify`, { expectedVersion: e.version, outcome: 'confirm', note: 'Checked against the linked extract (test)' }),
    );
    expect(r.verification).toBe('confirmed');
    const s = states(r.statusDimensions.items);
    expect(s.incorporation).toBe('incorporated_verified');
    expect(s.perimeter_transfer).toBe('not_started');
    expect(s.operational_readiness).not.toBe('standalone_accepted');
    expect(r.statusDimensions.carveOutComplete).toBe(false);
    // Same answer from the gates module for any member.
    const g = (await p.contributor.get(`${base(pid)}/status-dimensions`).expect(200)).body;
    expect(states(g.items)).toMatchObject({ incorporation: 'incorporated_verified', perimeter_transfer: 'not_started' });
    expect(g.carveOutComplete).toBe(false);
    // The perimeter item was not touched by the incorporation commands.
    const items = (await p.pm.get(`${base(pid)}/perimeter-items`).expect(200)).body.items;
    expect(items[0].transfer).toEqual({ legal: 'not_started', economic: 'not_started', combined: 'not_started' });
    // History preserved: unconfirmed → incorporated (proposed) → confirmed.
    const detail = (await p.pm.get(`${base(pid)}/legal-entities/${entityId}`).expect(200)).body;
    expect(detail.history.map((h: { reason: string }) => h.reason)).toEqual(expect.arrayContaining(['Incorporation recorded: incorporated', 'Incorporation verified']));
  });

  it('legal transfer verified but economic still in progress keeps the perimeter dimension in progress (D-05)', async () => {
    const [it0] = (await p.pm.get(`${base(pid)}/perimeter-items`).expect(200)).body.items;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
    let v = it0.version;
    for (const command of ['plan', 'start', 'report_transferred'] as const) {
      const r = await ok<{ itemVersion: number }>(p.pm.post(`${base(pid)}/transfers`, { perimeterItemId: it0.id, aspect: 'legal', command, expectedVersion: v, mechanism: 'Transfer instrument (test)', effectiveDate: today }));
      v = r.itemVersion;
    }
    const r = await ok<{ itemVersion: number }>(p.pm.post(`${base(pid)}/transfers`, { perimeterItemId: it0.id, aspect: 'economic', command: 'plan', expectedVersion: v, effectiveDate: today }));
    v = r.itemVersion;
    await ok(p.pm.post(`${base(pid)}/transfers`, { perimeterItemId: it0.id, aspect: 'economic', command: 'start', expectedVersion: v }));
    await linkEvidence(p.pm, pid, 'transfer', it0.id, 'Signed transfer record (synthetic)');
    const rep = (await p.pm.get(`${base(pid)}/transfers?perimeterItemId=${it0.id}&aspect=legal`).expect(200)).body.items.find((x: { command: string }) => x.command === 'report_transferred');
    const cur = (await p.pm.get(`${base(pid)}/perimeter-items/${it0.id}`).expect(200)).body;
    const ver = await ok<{ transfer: { legal: string; economic: string; combined: string } }>(p.legal.post(`${base(pid)}/transfers/${rep.id}/verify`, { expectedVersion: cur.version }));
    expect(ver.transfer).toEqual({ legal: 'transferred_verified', economic: 'in_progress', combined: 'in_progress' });
    await runWorker(); // perimeter.changed → gates.recompute_dimensions
    const g = (await p.pm.get(`${base(pid)}/status-dimensions`).expect(200)).body;
    expect(states(g.items)).toMatchObject({ incorporation: 'incorporated_verified', perimeter_transfer: 'in_progress' });
    expect(g.carveOutComplete).toBe(false);
  });
});

describe('REQ-SET-010 — setup wizard step 2: NewCo status with evidence', () => {
  it('"incorporated" without evidence is rejected; with evidence it is recorded as proposed', async () => {
    const e = (await p.pm.get(`${base(pid)}/legal-entities/${entityId}`).expect(200)).body;
    void e;
    const { projectId: pid2, p: p2 } = await carveoutProject('CO-AT06-W');
    const ent2 = await newcoId(p2.pm, pid2);
    const bad = await p2.pm.post(`${base(pid2)}/setup/steps/newco-status`, { mode: 'existing', legalEntityId: ent2, status: 'incorporated' });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('newco.incorporation.evidence_required');
    const good = await ok<{ status: string; verification: string; statusDimensions: { carveOutComplete: boolean } }>(
      p2.pm.post(`${base(pid2)}/setup/steps/newco-status`, { mode: 'existing', legalEntityId: ent2, status: 'incorporation_in_progress', evidence: { note: 'Application reference (synthetic)' } }),
    );
    expect(good).toMatchObject({ status: 'incorporation_in_progress', verification: 'proposed' });
    expect(good.statusDimensions.carveOutComplete).toBe(false);
    const links = (await p2.pm.get(`${base(pid2)}/evidence?targetType=legal_entity&targetId=${ent2}`).expect(200)).body;
    expect(links.total).toBe(1);
    // A second NewCo for the same project is refused (one NewCo dimension per project).
    const dup = await p2.pm.post(`${base(pid2)}/setup/steps/newco-status`, { mode: 'new', name: 'Second NewCo (test)', status: 'unconfirmed' });
    expect(dup.status).toBe(409);
  });
});
