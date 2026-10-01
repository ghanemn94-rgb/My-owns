import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { approveBaseline, approveChangeRequest, base, carveoutProject, createItem, item, ok, workstreamId } from '../carveout/carveout-kit';
import type { Personas } from '../carveout/carveout-kit';

/**
 * Independent QA — P3 review (docs/reviews/P3-P4-qa-review.md §3): acceptance criteria of §20 that the delivered AT specs
 * assert only in part.
 *  - AT-07 "preserving the previous version": the delivered spec checks the approved baseline only BEFORE the change request
 *    is decided. Here the change is approved and applied, then re-baselined: the previous approved baseline must survive as a
 *    superseded version whose frozen perimeter scope still excludes the new item.
 *  (AT-09: p34-qa-p3-at09-probe.spec.ts.)
 */
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('QA-P34 AT-07 — after the change is approved, applied and re-baselined, the previous perimeter version is preserved [AT-07, REQ-PER-005]', () => {
  let pid: string;
  let p: Personas;
  beforeAll(async () => {
    ({ projectId: pid, p } = await carveoutProject('QA34-AT07'));
  });

  it('CONTROL: baseline v1 stays approved and current until the re-baseline; after it, v1 is superseded with its frozen scope unchanged; the item history keeps every version', async () => {
    const ws05 = await workstreamId(p.pm, pid, 'WS05');
    const first = await createItem(p.pm, pid, { type: 'site', name: 'QA34 baselined site (synthetic)', disposition: 'included', workstreamId: ws05, ownerUserId: p.pm.userId });
    expect(first.applied).toBe(true);
    const v1Id = await approveBaseline(p, pid);
    const added = await createItem(p.pm, pid, { type: 'asset', name: 'QA34 shared UPS found after baseline (synthetic)', disposition: 'shared', workstreamId: ws05, justification: 'Shared UPS discovered after the baseline (QA)' });
    expect(added).toMatchObject({ applied: false, disposition: 'pending' });
    const crId = added.changeRequest!.id;
    await approveChangeRequest(p, pid, crId);
    const it0 = await item(p.pm, pid, added.id);
    const applied = await ok<{ outcome: string; disposition: string }>(p.pm.post(`${base(pid)}/perimeter-items/${added.id}/apply-change`, { expectedVersion: it0.version, changeRequestId: crId }));
    expect(applied).toMatchObject({ outcome: 'applied', disposition: 'shared' });

    // Applied, not yet re-baselined: the approved baseline is still v1 and its frozen scope is unchanged.
    const cur = (await p.pm.get(`${base(pid)}/baselines/current`).expect(200)).body;
    expect(cur.baseline.id).toBe(v1Id);
    expect(cur.perimeterItemIds).toEqual([first.id]);
    const afterApply = await item(p.pm, pid, added.id);
    console.log(`QA-P34 AT-07: applied item inApprovedBaseline=${afterApply.inApprovedBaseline}, history=${JSON.stringify(afterApply.history.map((h: { versionNo: number }) => h.versionNo))}`);
    expect(afterApply.inApprovedBaseline).toBe(false);
    expect(afterApply.history.map((h: { versionNo: number }) => h.versionNo)).toEqual([1, 2, 3]); // created (held pending), change raised, applied

    // Re-baseline on the approved change request: v2 carries the new item; v1 is superseded and keeps its own scope.
    const v2 = await ok<{ id: string; version: number; versionNo: number }>(p.pm.post(`${base(pid)}/baselines`, { note: 'QA re-baseline after the perimeter change (synthetic)', changeRequestId: crId }));
    const appr = await p.sponsor.post(`${base(pid)}/baselines/${v2.id}/approve`, { expectedVersion: v2.version, note: 'QA (synthetic)' });
    console.log(`QA-P34 AT-07: re-baseline v${v2.versionNo} approval → ${appr.status} ${appr.body.code ?? appr.body.status}`);
    expect(appr.status, JSON.stringify(appr.body)).toBe(201);
    const now = (await p.pm.get(`${base(pid)}/baselines/current`).expect(200)).body;
    expect(now.baseline.id).toBe(v2.id);
    expect([...now.perimeterItemIds].sort()).toEqual([first.id, added.id].sort());
    const old = (await p.pm.get(`${base(pid)}/baselines/${v1Id}`).expect(200)).body;
    expect(old.status).toBe('superseded');
    expect(old.snapshot.perimeterItemIds).toEqual([first.id]);
    expect((await item(p.pm, pid, added.id)).inApprovedBaseline).toBe(true);
    // The database keeps both versions immutable (record history of the baseline snapshot is not rewritten).
    const rows = await owner().query(`select version_no, status from baseline_version where project_id = $1 order by version_no`, [pid]);
    expect(rows.rows).toEqual([
      { version_no: 1, status: 'superseded' },
      { version_no: 2, status: 'approved' },
    ]);
  });
});
