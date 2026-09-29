import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { Personas, approveBaseline, approveChangeRequest, auditRows, base, carveoutProject, createItem, item, ok, workstreamId } from './carveout-kit';

/**
 * AT-07: adding a site / shared asset after baseline approval creates a change request with financial / TSA /
 * readiness / transaction impact and preserves the previous version (planning baseline + item history untouched).
 * REQ-PER-002 (justified, versioned classification), REQ-PER-004 (cross-module impact), REQ-PER-005.
 */
let pid: string;
let orgId: string;
let p: Personas;
let baselineItemId: string;
let ws05: string;

type Cr = { id: string; status: string; subjectType: string; subjectId: string; impacts: Record<string, string>; proposedChange: { kind: string; from: { disposition: string }; to: { disposition: string; siteId: string | null }; entersScope: boolean }; rebaseline: boolean; version: number };

beforeAll(async () => {
  ({ projectId: pid, orgId, p } = await carveoutProject('CO-AT07'));
  ws05 = await workstreamId(p.pm, pid, 'WS05');
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('AT-07 — perimeter change after baseline approval [AT-07, REQ-PER-002, REQ-PER-004, REQ-PER-005]', () => {
  it('before any baseline, an item is added and classified directly (justified and versioned)', async () => {
    const r = await createItem(p.pm, pid, { type: 'site', name: 'AT-07 baseline site (synthetic)', disposition: 'pending', workstreamId: ws05, ownerUserId: p.pm.userId });
    expect(r).toMatchObject({ applied: true, changeRequest: null, disposition: 'pending' });
    baselineItemId = r.id;
    const c = await ok<{ applied: boolean; disposition: string; version: number }>(
      p.pm.post(`${base(pid)}/perimeter-items/${r.id}/classify`, { expectedVersion: r.version, disposition: 'included', justification: 'In the transferring scope (test)' }),
    );
    expect(c).toMatchObject({ applied: true, disposition: 'included' });
    // Classification changes need a justification (400 without it) and are versioned.
    expect((await p.pm.post(`${base(pid)}/perimeter-items/${r.id}/classify`, { expectedVersion: c.version, disposition: 'excluded' })).status).toBe(400);
    const d = await item(p.pm, pid, r.id);
    expect(d.history.map((h: { versionNo: number }) => h.versionNo)).toEqual([1, 2]);
    expect(d.inApprovedBaseline).toBe(false);
  });

  it('a generic PATCH cannot change disposition or transfer status (strict body → 400)', async () => {
    const d = await item(p.pm, pid, baselineItemId);
    expect((await p.pm.patch(`${base(pid)}/perimeter-items/${baselineItemId}`, { expectedVersion: d.version, disposition: 'excluded' })).status).toBe(400);
    expect((await p.pm.patch(`${base(pid)}/perimeter-items/${baselineItemId}`, { expectedVersion: d.version, transferStatus: 'transferred_verified' })).status).toBe(400);
  });

  it('after baseline approval, adding a site and a shared asset raises change requests with cross-module impacts', async () => {
    await approveBaseline(p, pid);
    const before = (await p.pm.get(`${base(pid)}/baselines/current`).expect(200)).body;
    expect(before.perimeterItemIds).toEqual([baselineItemId]);
    expect((await item(p.pm, pid, baselineItemId)).inApprovedBaseline).toBe(true);

    const site = await ok<{ id: string }>(p.pm.post(`${base(pid)}/sites`, { name: 'AT-07 added site (synthetic)' }));
    // A readiness check already exists at that site (readiness module not in this worktree → owner-pool fixture row).
    await owner().query(`insert into readiness_check (id, org_id, project_id, code, area, title, site_id) values (gen_random_uuid(), $1, $2, 'RC-AT07', 'power', 'Power readiness at the added site (synthetic)', $3)`, [orgId, pid, site.id]);

    // Justification is mandatory once change control applies.
    expect((await p.pm.post(`${base(pid)}/perimeter-items`, { type: 'site', name: 'no justification', disposition: 'included', siteId: site.id })).status).toBe(422);

    const added = await createItem(p.pm, pid, {
      type: 'asset',
      name: 'AT-07 shared cooling asset (synthetic)',
      disposition: 'shared',
      siteId: site.id,
      workstreamId: ws05,
      justification: 'Shared cooling discovered after baseline (test)',
      impactNarrative: { tsa: 'Interim cooling service may be needed (test note)' },
    });
    expect(added.applied).toBe(false);
    expect(added.disposition).toBe('pending'); // held out of scope until the change is approved and applied
    expect(added.changeRequest).toMatchObject({ status: 'submitted', rebaseline: true });

    const cr = (await p.pm.get(`${base(pid)}/change-requests/${added.changeRequest!.id}`).expect(200)).body as Cr;
    expect(cr).toMatchObject({ subjectType: 'perimeter_item', subjectId: added.id, rebaseline: true });
    expect(cr.proposedChange).toMatchObject({ kind: 'add', from: { disposition: 'pending' }, to: { disposition: 'shared', siteId: site.id }, entersScope: true });
    for (const k of ['scope', 'financial', 'tsa', 'readiness', 'transaction', 'time', 'cost']) expect(cr.impacts[k], k).toBeTruthy();
    expect(cr.impacts.readiness).toMatch(/RC-AT07/);
    expect(cr.impacts.tsa).toMatch(/TSA or approved enduring arrangement/);
    expect(cr.impacts.tsa).toMatch(/Interim cooling service may be needed/);
    expect(cr.impacts.financial).toMatch(/Assessment pending — specialist/);

    // The impact assessment is recorded with entries for every area (REQ-PER-004).
    const impacts = (await p.pm.get(`${base(pid)}/perimeter-items/${added.id}/impact-assessments`).expect(200)).body.items;
    expect(impacts).toHaveLength(1);
    expect(impacts[0].trigger).toBe('change_request');
    expect(impacts[0].entries.map((e: { area: string }) => e.area)).toEqual(['financial_statements', 'valuation', 'agreements', 'tsa', 'readiness', 'schedule', 'budget', 'transaction']);

    // The previous version is preserved: the approved baseline is unchanged and still the current one.
    const after = (await p.pm.get(`${base(pid)}/baselines/current`).expect(200)).body;
    expect(after.baseline.id).toBe(before.baseline.id);
    expect(after.perimeterItemIds).toEqual([baselineItemId]);
    expect((await auditRows(pid, 'carveout.perimeter.create')).length).toBe(2);
  });

  it('reclassifying a baselined item raises a change request instead of changing it; one open change at a time', async () => {
    const d = await item(p.pm, pid, baselineItemId);
    const r = await ok<{ applied: boolean; disposition: string; version: number; changeRequest: { id: string; rebaseline: boolean } }>(
      p.pm.post(`${base(pid)}/perimeter-items/${baselineItemId}/classify`, { expectedVersion: d.version, disposition: 'excluded', justification: 'Retain the site with the parent (test)' }),
    );
    expect(r).toMatchObject({ applied: false, disposition: 'included' });
    expect(r.changeRequest.rebaseline).toBe(true);
    const again = await p.pm.post(`${base(pid)}/perimeter-items/${baselineItemId}/classify`, { expectedVersion: r.version, disposition: 'shared', justification: 'another change (test)' });
    expect(again.status).toBe(409);
    expect((await item(p.pm, pid, baselineItemId)).disposition).toBe('included');
  });

  it('an undecided change request cannot be applied; the requester cannot approve it; an approved one is applied', async () => {
    const list = (await p.pm.get(`${base(pid)}/perimeter-items?disposition=pending`).expect(200)).body.items;
    const added = list.find((x: { name: string }) => x.name.startsWith('AT-07 shared cooling'))!;
    const crId = added.pendingChange.id as string;
    const early = await p.pm.post(`${base(pid)}/perimeter-items/${added.id}/apply-change`, { expectedVersion: added.version, changeRequestId: crId });
    expect(early.status).toBe(422);
    expect(early.body.code).toBe('perimeter.change_request_not_decided');
    // separation of duties (planning): the PM who raised it cannot approve it
    const cr = (await p.pm.get(`${base(pid)}/change-requests/${crId}`).expect(200)).body;
    const rv = await ok<{ version: number }>(p.pm.post(`${base(pid)}/change-requests/${crId}/start-review`, { expectedVersion: cr.version }));
    expect((await p.pm.post(`${base(pid)}/change-requests/${crId}/approve`, { expectedVersion: rv.version })).status).toBe(403);
    await approveChangeRequest(p, pid, crId);
    const applied = await ok<{ outcome: string; disposition: string }>(p.pm.post(`${base(pid)}/perimeter-items/${added.id}/apply-change`, { expectedVersion: added.version, changeRequestId: crId, note: 'apply (test)' }));
    expect(applied).toEqual({ id: added.id, version: added.version + 1, disposition: 'shared', outcome: 'applied' });
    const d = await item(p.pm, pid, added.id);
    expect(d.pendingChange).toBeNull();
    expect(d.history.map((h: { versionNo: number }) => h.versionNo)).toEqual([1, 2, 3]);
    // Applying twice is impossible (no open change any more).
    expect((await p.pm.post(`${base(pid)}/perimeter-items/${added.id}/apply-change`, { expectedVersion: d.version, changeRequestId: crId })).status).toBe(422);
  });

  it('a rejected change request closes without changing the item', async () => {
    const d = await item(p.pm, pid, baselineItemId);
    const crId = d.pendingChange.id as string;
    let cr = (await p.pm.get(`${base(pid)}/change-requests/${crId}`).expect(200)).body;
    cr = await ok(p.pm.post(`${base(pid)}/change-requests/${crId}/start-review`, { expectedVersion: cr.version }));
    const v = (await p.pm.get(`${base(pid)}/change-requests/${crId}`).expect(200)).body.version;
    await ok(p.sponsor.post(`${base(pid)}/change-requests/${crId}/reject`, { expectedVersion: v, reason: 'Keep the site in scope (test)' }));
    const r = await ok<{ outcome: string; disposition: string }>(p.pm.post(`${base(pid)}/perimeter-items/${baselineItemId}/apply-change`, { expectedVersion: d.version, changeRequestId: crId }));
    expect(r).toMatchObject({ outcome: 'closed_without_change', disposition: 'included' });
  });

  it('stale expectedVersion → 409 and nothing changes', async () => {
    const d = await item(p.pm, pid, baselineItemId);
    const r = await p.pm.patch(`${base(pid)}/perimeter-items/${baselineItemId}`, { expectedVersion: d.version - 1, risks: 'stale write (test)' });
    expect(r.status).toBe(409);
    expect((await item(p.pm, pid, baselineItemId)).risks).toBeNull();
  });

  it('manual impact assessment (REQ-PER-004) is appended to the item history of assessments', async () => {
    const r = await ok<{ entries: { area: string; status: string }[]; narrative: Record<string, string> }>(
      p.pm.post(`${base(pid)}/perimeter-items/${baselineItemId}/impact-assessment`, { narrative: { budget: 'No change expected (test note)' } }),
    );
    expect(r.entries).toHaveLength(8);
    expect(r.narrative).toEqual({ budget: 'No change expected (test note)' });
    // Legal (no finance.record.read) sees the budget references withheld, never the codes.
    const legalView = (await p.legal.get(`${base(pid)}/perimeter-items/${baselineItemId}/impact-assessments`).expect(200)).body.items;
    expect(legalView.length).toBeGreaterThanOrEqual(1);
  });
});
