import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { runWorker } from '../gates/gate-test-kit';
import { Personas, approveBaseline, approveChangeRequest, base, carveoutProject, createItem, item, linkEvidence, ok, workstreamId } from '../carveout/carveout-kit';

/**
 * P3/P4 DOMAIN RE-REVIEW, RE-CHECK OF THE FIXES (lead request) — equivalent paths around the DOM-P34R-05 / -06 fixes
 * (docs/reviews/P3-P4-domain-rereview.md "Re-check of the fixes"; business-gates.md §1 rule 8; AT-06, AT-07, AT-14):
 *  - DOM-P34R-06 was reproduced with a REJECTED link; here the verified transfer's evidence is CONTESTED (a second link flagged
 *    as conflicting with it — AT-14 "new evidence conflicts with evidence previously relied upon");
 *  - DOM-P34R-05 was reproduced through `classify` before the baseline; here "not applicable" is marked while an item created
 *    AFTER the baseline is held `pending`, and the item enters the scope when its creation change request is applied.
 * One DC project for this file; the tests run in order (the baseline is approved in the second describe). Real API only (owner
 * pool for evidence-link versions and assertions). Both are plain tests asserting the REQUIRED behaviour (they pass when the
 * fix covers the variant). All data is synthetic.
 */
let pid: string;
let p: Personas;
type Dim = { key: string; state: string; explanation: string };
const dims = async () => (await p.pm.post(`${base(pid)}/status-dimensions/recompute`, {})).body as { items: Dim[] };
const stateOf = (d: { items: Dim[] }, key: string) => d.items.find((x) => x.key === key)!;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());

beforeAll(async () => {
  ({ projectId: pid, p } = await carveoutProject('P34R2-PER'));
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('P3/P4 domain re-review, re-check — verified transfer whose evidence is contested [AT-14, REQ-PER-007, DOM-P34R-06 variant]', () => {
  it('VARIANT DOM-P34R-06: a second link is flagged as conflicting with the verified transfer\'s evidence — the dimension no longer says transferred_verified and the reaction returns both aspects to in_progress', async () => {
    const ws = await workstreamId(p.pm, pid, 'WS05');
    const x = await createItem(p.pm, pid, { type: 'asset', name: 'UPS string C (synthetic)', disposition: 'included', workstreamId: ws, ownerUserId: p.pm.userId });
    const itemId = x.id;
    let v = x.version;
    for (const aspect of ['legal', 'economic'] as const) {
      for (const command of ['plan', 'start', 'report_transferred'] as const) {
        const r = await ok<{ itemVersion: number }>(p.pm.post(`${base(pid)}/transfers`, { perimeterItemId: itemId, aspect, command, expectedVersion: v, mechanism: 'Asset transfer instrument (synthetic)', effectiveDate: today() }));
        v = r.itemVersion;
      }
    }
    const l1 = (await linkEvidence(p.pm, pid, 'transfer', itemId, 'Signed asset transfer record (synthetic)')).id;
    for (const aspect of ['legal', 'economic'] as const) {
      const rep = (await p.pm.get(`${base(pid)}/transfers?perimeterItemId=${itemId}&aspect=${aspect}`).expect(200)).body.items.find((r: { command: string }) => r.command === 'report_transferred');
      const cur = await item(p.pm, pid, itemId);
      await ok(p.legal.post(`${base(pid)}/transfers/${rep.id}/verify`, { expectedVersion: cur.version, note: 'Checked against the signed record (synthetic)' }));
    }
    await runWorker();
    expect(stateOf(await dims(), 'perimeter_transfer').state, 'setup: verified').toBe('transferred_verified');
    // New evidence contradicts the record relied upon: the PM (transfer manager) links it and flags the conflict.
    const l2 = (await linkEvidence(p.pm, pid, 'transfer', itemId, 'Registry extract: the asset is still recorded under the seller (synthetic)')).id;
    const lv = (await owner().query(`select version from evidence_link where id = $1`, [l1])).rows[0].version as number;
    const flag = await p.pm.post(`${base(pid)}/evidence/${l1}/flag-conflict`, { expectedVersion: lv, withLinkId: l2, note: 'The registry extract contradicts the signed record (probe, synthetic)' });
    expect(flag.status, JSON.stringify(flag.body)).toBe(201);
    const immediate = stateOf(await dims(), 'perimeter_transfer');
    await runWorker();
    const after = await item(p.pm, pid, itemId);
    const per = stateOf(await dims(), 'perimeter_transfer');
    // Required (business-gates.md §1 rule 8 / §4 rule 9; AT-14): contested evidence no longer supports "transferred with verified
    // evidence" — at once in the dimension, and the aspects return to in progress for a fresh verification.
    expect(immediate.state, `before the worker: ${JSON.stringify(immediate)}`).not.toBe('transferred_verified');
    expect(per.state, `after the worker: item ${JSON.stringify(after.transfer)}, evidence ${JSON.stringify(after.evidence)}; dimension ${JSON.stringify(per)}`).not.toBe('transferred_verified');
    expect(after.transfer).toMatchObject({ legal: 'in_progress', economic: 'in_progress' });
  });
});

describe('P3/P4 domain re-review, re-check — "not applicable" marked while an item is pending after the baseline [AT-07, A-P3-05, DOM-P34R-05 variant]', () => {
  it('VARIANT DOM-P34R-05: an item added after the baseline is held pending; the PM marks its legal transfer not applicable; when the creation change request is applied the item enters the scope with that aspect reset', async () => {
    const ws = await workstreamId(p.pm, pid, 'WS06');
    await approveBaseline(p, pid);
    const x = await createItem(p.pm, pid, { type: 'contract', name: 'Probe colocation contract (synthetic)', disposition: 'included', workstreamId: ws, ownerUserId: p.pm.userId, justification: 'Contract found after the baseline (probe, synthetic)' });
    expect(x.disposition, 'setup: held pending until the change request is applied').toBe('pending');
    expect(x.changeRequest).not.toBeNull();
    const na = await p.pm.post(`${base(pid)}/transfers`, { perimeterItemId: x.id, aspect: 'legal', command: 'mark_not_applicable', expectedVersion: x.version, note: 'Retained (probe, synthetic)' });
    await approveChangeRequest(p, pid, x.changeRequest!.id);
    const cur = await item(p.pm, pid, x.id);
    const applied = await p.pm.post(`${base(pid)}/perimeter-items/${x.id}/apply-change`, { expectedVersion: cur.version, changeRequestId: x.changeRequest!.id, note: 'Apply the approved addition (probe)' });
    expect(applied.status, JSON.stringify(applied.body)).toBe(201);
    const after = await item(p.pm, pid, x.id);
    const hist = (await owner().query(`select aspect, command, from_status::text as from_status, to_status::text as to_status from transfer_record where perimeter_item_id = $1 order by created_at`, [x.id])).rows;
    // Required (A-P3-05 / business-gates.md §1 rule 8 — on an in-scope item "not applicable" is a specialist determination;
    // DOM-P34R-05 fix "every aspect marked not applicable while out of scope is reset when the item enters the scope"):
    // the item enters the scope without an undetermined "not applicable" aspect.
    expect(after.disposition).toBe('included');
    expect(after.transfer.legal, `N/A while pending ${na.status} ${JSON.stringify(na.body)}; apply ${applied.status}; item ${JSON.stringify(after.transfer)}; transfer history ${JSON.stringify(hist)}`).not.toBe('not_applicable');
  });
});
