import { afterAll, describe, expect, it } from 'vitest';
import { closeApp, closePools } from '../helpers';
import { gateDecision, setupGovernance } from '../gates/gate-test-kit';
import { Personas, approveChangeRequest, base, carveoutProject, createItem, item, newcoId, ok, workstreamId } from './carveout-kit';

/**
 * REQ-SET-010 (setup wizard step 2): NewCo status with evidence. REQ-SET-012 (setup wizard step 4): the perimeter, workstreams and owners are frozen as a perimeter version proposed by
 * the PM and approved by the sponsor with a FINAL governance decision; the approved version is a baseline perimeter for
 * change control (AT-07); a snapshot that changed after the proposal cannot be approved.
 */
const pvRef = {} as { id: string; p: Personas };

afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('Perimeter version — setup wizard step 4 [REQ-SET-012]', () => {
  let pv: string;
  let q: Personas;
  let gov: Awaited<ReturnType<typeof setupGovernance>>;
  let excludedId: string;
  it('pending dispositions or in-scope items without workstream/owner block the proposal', async () => {
    ({ projectId: pv, p: q } = await carveoutProject('CO-SETUP'));
    pvRef.id = pv;
    pvRef.p = q;
    const ws = await workstreamId(q.pm, pv, 'WS05');
    await createItem(q.pm, pv, { type: 'site', name: 'PV site (synthetic)', disposition: 'included', workstreamId: ws, ownerUserId: q.pm.userId });
    const noOwner = await createItem(q.pm, pv, { type: 'asset', name: 'PV asset without owner (synthetic)', disposition: 'included', workstreamId: ws });
    const pend = await createItem(q.pm, pv, { type: 'asset', name: 'PV pending asset (synthetic)' });
    excludedId = pend.id;
    const r = await q.pm.post(`${base(pv)}/setup/steps/perimeter`, {});
    expect(r.status).toBe(422);
    expect(r.body.details.blockers.map((b: { code: string }) => b.code).sort()).toEqual([noOwner.code, pend.code].sort());
    await ok(q.pm.post(`${base(pv)}/perimeter-items/${pend.id}/classify`, { expectedVersion: pend.version, disposition: 'excluded', justification: 'Retained by the parent (test)' }));
    await ok(q.pm.patch(`${base(pv)}/perimeter-items/${noOwner.id}`, { expectedVersion: noOwner.version, ownerUserId: q.pm.userId }), 200);
  });

  it('the PM proposes; approval needs the sponsor with a FINAL governance decision', async () => {
    const v = await ok<{ id: string; versionNo: number; status: string; warnings: { issue: string }[]; version: number }>(q.pm.post(`${base(pv)}/setup/steps/perimeter`, { note: 'Initial perimeter (test)' }));
    expect(v).toMatchObject({ versionNo: 1, status: 'proposed' });
    expect(v.warnings.some((w) => w.issue === 'Perimeter category not assessed')).toBe(true);
    expect((await q.pm.post(`${base(pv)}/setup/steps/perimeter`, {})).status).toBe(409); // one proposal at a time
    gov = await setupGovernance(pv, q);
    const notFinal = await gateDecision(pv, q, gov, 'G1', { vote: false });
    expect((await q.pm.post(`${base(pv)}/perimeter/versions/${v.id}/approve`, { expectedVersion: 1, decisionId: notFinal.id })).status).toBe(403);
    expect((await q.sponsor.post(`${base(pv)}/perimeter/versions/${v.id}/approve`, { expectedVersion: 1, decisionId: notFinal.id })).status).toBe(403); // outside authority until final
    const d = await gateDecision(pv, q, gov, 'G1');
    expect(d.status).toBe('approved');
    const a = await ok<{ status: string }>(q.sponsor.post(`${base(pv)}/perimeter/versions/${v.id}/approve`, { expectedVersion: 1, decisionId: d.id, note: 'Approved (test)' }));
    expect(a.status).toBe('approved');
    const items = (await q.pm.get(`${base(pv)}/perimeter-items`).expect(200)).body.items as { disposition: string; inApprovedBaseline: boolean }[];
    expect(items.filter((x) => x.disposition === 'included').every((x) => x.inApprovedBaseline)).toBe(true);
  });

  it('after approval a new item needs a change request; a stale snapshot cannot be approved', async () => {
    const late = await createItem(q.pm, pv, { type: 'site', name: 'PV late site (synthetic)', disposition: 'included', justification: 'Found after approval (test)' });
    expect(late.applied).toBe(false);
    expect(late.changeRequest!.rebaseline).toBe(false); // no planning baseline in this project
    // While the change is undecided the item is Pending → a new version cannot be proposed.
    expect((await q.pm.post(`${base(pv)}/setup/steps/perimeter`, {})).status).toBe(422);
    await approveChangeRequest(q, pv, late.changeRequest!.id);
    const cur = await item(q.pm, pv, late.id);
    await ok(q.pm.post(`${base(pv)}/perimeter-items/${late.id}/apply-change`, { expectedVersion: cur.version, changeRequestId: late.changeRequest!.id }));
    const late2 = await item(q.pm, pv, late.id);
    await ok(q.pm.patch(`${base(pv)}/perimeter-items/${late.id}`, { expectedVersion: late2.version, workstreamId: await workstreamId(q.pm, pv, 'WS05'), ownerUserId: q.pm.userId }), 200);
    const v2 = await ok<{ id: string; versionNo: number }>(q.pm.post(`${base(pv)}/setup/steps/perimeter`, {}));
    expect(v2.versionNo).toBe(2);
    // The register changes after the proposal (excluded → pending needs no change request) → approval refused (409).
    const ex = await item(q.pm, pv, excludedId);
    await ok(q.pm.post(`${base(pv)}/perimeter-items/${excludedId}/classify`, { expectedVersion: ex.version, disposition: 'pending', justification: 'Re-open the decision (test)' }));
    const d2 = await gateDecision(pv, q, gov, 'G1');
    const stale = await q.sponsor.post(`${base(pv)}/perimeter/versions/${v2.id}/approve`, { expectedVersion: 1, decisionId: d2.id });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('perimeter.version.stale');
    const versions = (await q.pm.get(`${base(pv)}/perimeter/versions`).expect(200)).body.items;
    expect(versions.map((x: { status: string }) => x.status)).toEqual(['proposed', 'approved']);
    await ok(q.sponsor.post(`${base(pv)}/perimeter/versions/${v2.id}/reject`, { expectedVersion: 1, reason: 'Register changed (test)' }));
  });
});

describe('REQ-SET-010 — setup wizard step 2: NewCo status with evidence', () => {
  it('"incorporated" without evidence is rejected; with evidence it is recorded as proposed; one NewCo per project', async () => {
    const pid2 = pvRef.id;
    const p2 = pvRef.p;
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
    const dup = await p2.pm.post(`${base(pid2)}/setup/steps/newco-status`, { mode: 'new', name: 'Second NewCo (test)', status: 'unconfirmed' });
    expect(dup.status).toBe(409);
  });
});
