import { afterAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { gateDecision, setupGovernance } from '../gates/gate-test-kit';
import { Personas, approveChangeRequest, base, carveoutProject, createItem, item, ok, workstreamId } from '../carveout/carveout-kit';

/**
 * P2 DOMAIN RE-REVIEW — perimeter-version approval (docs/reviews/P2-domain-rereview.md). Own file: one gate-kit project per
 * file (public demo-login rate limit). `DEFECT DOM-P2R-05` asserts the REQUIRED behaviour and fails at the reviewed revision.
 * All data is synthetic.
 */
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('P2 domain re-review — perimeter version approval backed by a G1 decision [docs/reviews/P2-domain-rereview.md]', () => {
  it('DOM-P2R-05 (fixed, regression): the G1 decision that approved perimeter version 1 cannot also approve a later, different version 2', async () => {
    const { projectId: pv, p: q } = (await carveoutProject('DRR-PV')) as { projectId: string; p: Personas };
    const ws = await workstreamId(q.pm, pv, 'WS05');
    await createItem(q.pm, pv, { type: 'site', name: 'Re-review site (synthetic)', disposition: 'included', workstreamId: ws, ownerUserId: q.pm.userId });
    const v1 = await ok<{ id: string; versionNo: number }>(q.pm.post(`${base(pv)}/setup/steps/perimeter`, { note: 'Initial perimeter (re-review, synthetic)' }));
    expect(v1.versionNo).toBe(1);
    const gov = await setupGovernance(pv, q);
    // Since DOM-P2F-08 a G1 paper must name the version it approves: this one is raised FOR version 1.
    const d = await gateDecision(pv, q, gov, 'G1', { subject: { type: 'perimeter_version', id: v1.id } });
    expect(d.status).toBe('approved');
    await ok(q.sponsor.post(`${base(pv)}/perimeter/versions/${v1.id}/approve`, { expectedVersion: 1, decisionId: d.id, note: 'v1 approved (re-review, synthetic)' }));

    // A later addition goes through change control (AT-07) and is applied; the PM proposes version 2.
    const late = await createItem(q.pm, pv, { type: 'site', name: 'Re-review late site (synthetic)', disposition: 'included', justification: 'Found after approval (re-review, synthetic)' });
    await approveChangeRequest(q, pv, late.changeRequest!.id);
    const cur = await item(q.pm, pv, late.id);
    await ok(q.pm.post(`${base(pv)}/perimeter-items/${late.id}/apply-change`, { expectedVersion: cur.version, changeRequestId: late.changeRequest!.id }));
    const late2 = await item(q.pm, pv, late.id);
    await ok(q.pm.patch(`${base(pv)}/perimeter-items/${late.id}`, { expectedVersion: late2.version, workstreamId: ws, ownerUserId: q.pm.userId }), 200);
    const v2 = await ok<{ id: string; versionNo: number }>(q.pm.post(`${base(pv)}/setup/steps/perimeter`, { note: 'Perimeter after the change (re-review, synthetic)' }));
    expect(v2.versionNo).toBe(2);

    // The sponsor approves version 2 on the SAME decision that approved version 1.
    const r = await q.sponsor.post(`${base(pv)}/perimeter/versions/${v2.id}/approve`, { expectedVersion: 1, decisionId: d.id, note: 'v2 on the v1 decision (probe)' });
    const rows = (await owner().query(`select version_no, status, decision_id from perimeter_version where project_id = $1 order by version_no`, [pv])).rows;
    // Required: spec §4.2 ("approval interfaces enforcing delegated authority"), REQ-SET-012 / AT-07 (the approved version is
    // the baseline perimeter): the committee approved version 1, never saw version 2. A decision backs one version only (or
    // is bound to the snapshot hash it approved), like `change_control.decision_already_used` for baselines / change requests.
    expect(r.status, `v2 approved on the v1 decision: ${JSON.stringify(r.body)}; versions ${JSON.stringify(rows)}`).not.toBe(201);
  });
});
