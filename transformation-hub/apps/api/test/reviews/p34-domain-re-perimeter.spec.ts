import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { runWorker } from '../gates/gate-test-kit';
import { Personas, base, carveoutProject, createItem, item, linkEvidence, ok, workstreamId } from '../carveout/carveout-kit';

/**
 * P3/P4 FOCUSED DOMAIN RE-REVIEW — perimeter transfer after the DOM-P3-05 / DOM-P3-09 fixes (docs/reviews/
 * P3-P4-domain-rereview.md; business-gates.md §1 rule 8 "`transferred_verified` when every in-scope item is transferred with
 * verified evidence"; A-P3-05 "'not applicable' on an in-scope item: one aspect only, a specialist determination before
 * baseline"; spec §3 "if approved evidence is found defective, reopen … through a controlled process"; AT-06, AT-14).
 * One DC project for this file, real API only (owner pool for evidence-link versions and assertions).
 * The tests run in order: the first describe needs the project's ONLY in-scope item to be the transferred one.
 *
 * `DEFECT …` probes assert the REQUIRED behaviour and are declared with `it.fails` while the defect is open;
 * `P34DRE_PROBE_PLAIN=1` runs them as plain tests. `CONTROL …` / `OBSERVED …` are plain tests. All data is synthetic.
 */
// Implementer (fix of the P3/P4 domain re-review): every DEFECT probe of this file is fixed and renamed `… (fixed, regression)`
// — plain `it`, assertions unchanged. The alias stays so that P34DRE_PROBE_PLAIN=1 keeps working for any probe added later.
const defect = process.env['P34DRE_PROBE_PLAIN'] ? it : it.fails;
void defect;

let pid: string;
let p: Personas;
type Dim = { key: string; state: string; explanation: string };
const dims = async () => (await p.pm.post(`${base(pid)}/status-dimensions/recompute`, {})).body as { items: Dim[]; carveOutComplete: boolean };
const stateOf = (d: { items: Dim[] }, key: string) => d.items.find((x) => x.key === key)!;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());

beforeAll(async () => {
  ({ projectId: pid, p } = await carveoutProject('P34R-PER'));
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('P3/P4 domain re-review — transfer evidence rejected after verification [AT-06, AT-14, REQ-PER-007, DOM-P3-09 residual]', () => {
  let itemId: string;
  let linkId: string;

  it('CONTROL: the only in-scope item transferred on both aspects and verified by Legal on the PM\'s evidence → perimeter_transfer = transferred_verified', async () => {
    const ws = await workstreamId(p.pm, pid, 'WS05');
    const x = await createItem(p.pm, pid, { type: 'asset', name: 'UPS string B (synthetic)', disposition: 'included', workstreamId: ws, ownerUserId: p.pm.userId });
    itemId = x.id;
    let v = x.version;
    for (const aspect of ['legal', 'economic'] as const) {
      for (const command of ['plan', 'start', 'report_transferred'] as const) {
        const r = await ok<{ itemVersion: number }>(p.pm.post(`${base(pid)}/transfers`, { perimeterItemId: itemId, aspect, command, expectedVersion: v, mechanism: 'Asset transfer instrument (synthetic)', effectiveDate: today() }));
        v = r.itemVersion;
      }
    }
    linkId = (await linkEvidence(p.pm, pid, 'transfer', itemId, 'Signed asset transfer record (synthetic)')).id;
    for (const aspect of ['legal', 'economic'] as const) {
      const rep = (await p.pm.get(`${base(pid)}/transfers?perimeterItemId=${itemId}&aspect=${aspect}`).expect(200)).body.items.find((r: { command: string }) => r.command === 'report_transferred');
      const cur = await item(p.pm, pid, itemId);
      await ok(p.legal.post(`${base(pid)}/transfers/${rep.id}/verify`, { expectedVersion: cur.version, note: 'Checked against the signed record (synthetic)' }));
    }
    expect((await item(p.pm, pid, itemId)).transfer).toEqual({ legal: 'transferred_verified', economic: 'transferred_verified', combined: 'transferred_verified' });
    await runWorker();
    expect(stateOf(await dims(), 'perimeter_transfer').state).toBe('transferred_verified');
  });

  it('DOM-P34R-06: the only transfer evidence is rejected as defective — the perimeter still reads "All in-scope items transferred with verified evidence" (fixed, regression)', async () => {
    const lv = (await owner().query(`select version from evidence_link where id = $1`, [linkId])).rows[0].version as number;
    const rej = await p.secretary.post(`${base(pid)}/evidence/${linkId}/verify`, { expectedVersion: lv, decision: 'reject', note: 'Record of another asset — defective (probe, synthetic)' });
    expect(rej.status, JSON.stringify(rej.body)).toBe(201);
    await runWorker();
    const per = stateOf(await dims(), 'perimeter_transfer');
    const cur = await item(p.pm, pid, itemId);
    // Required (spec §3 controlled reopen; business-gates.md §1 rule 8 "transferred with verified evidence"; the rule the
    // DOM-P3-08 / DOM-P3-09 fixes apply to incorporation and Day-1 sign-offs): once the only evidence of the verified
    // transfer is rejected as defective, the perimeter is no longer stated as transferred with verified evidence.
    expect(per.state, `item transfer ${JSON.stringify(cur.transfer)}, evidence ${JSON.stringify(cur.evidence)}; dimension ${JSON.stringify(per)}`).not.toBe('transferred_verified');
  });
});

describe('P3/P4 domain re-review — "not applicable" carried into the transferring scope by a reclassification [AT-07, A-P3-05, Q-P3-05]', () => {
  let itemId: string;

  it('DOM-P34R-05: the transfer manager marks both aspects of an EXCLUDED item "not applicable", then classifies it INCLUDED — an in-scope item with no transfer at all, without the specialist determination (fixed, regression)', async () => {
    const ws = await workstreamId(p.pm, pid, 'WS06');
    const x = await createItem(p.pm, pid, { type: 'contract', name: 'Probe maintenance contract (synthetic)', disposition: 'excluded', workstreamId: ws, ownerUserId: p.pm.userId });
    itemId = x.id;
    const legal = await p.pm.post(`${base(pid)}/transfers`, { perimeterItemId: itemId, aspect: 'legal', command: 'mark_not_applicable', expectedVersion: x.version, note: 'Retained (probe, synthetic)' });
    expect(legal.status, JSON.stringify(legal.body)).toBe(201);
    const economic = await p.pm.post(`${base(pid)}/transfers`, { perimeterItemId: itemId, aspect: 'economic', command: 'mark_not_applicable', expectedVersion: legal.body.itemVersion, note: 'Retained (probe, synthetic)' });
    expect(economic.status, JSON.stringify(economic.body)).toBe(201);
    const cls = await p.pm.post(`${base(pid)}/perimeter-items/${itemId}/classify`, { expectedVersion: economic.body.itemVersion, disposition: 'included', justification: 'Now transfers with the hall (probe, synthetic)' });
    const after = await item(p.pm, pid, itemId);
    const hist = (await owner().query(`select aspect, command, note from transfer_record where perimeter_item_id = $1 order by created_at`, [itemId])).rows;
    // Required (A-P3-05 / business-gates.md §1 rule 8: on an Included / Shared item "not applicable" is one aspect only and a
    // specialist determination with its basis before baseline; transfer.not_applicable_in_scope "never both aspects"): an
    // item does not enter the transferring scope carrying "not applicable" aspects nobody determined for an in-scope item
    // (the reclassification is refused, or resets the aspects for planning / specialist determination).
    expect(
      after.disposition === 'included' && after.transfer.combined === 'not_applicable',
      `classify ${cls.status} ${JSON.stringify(cls.body)}; item ${after.disposition} ${JSON.stringify(after.transfer)}; transfer records ${JSON.stringify(hist)}`,
    ).toBe(false);
  });

  // Implementer (fix): the OBSERVED probe below pinned the reported behaviour; per the probe convention it was updated together
  // with the fix (setup unchanged) and now pins the implemented rule — see the "Fix status" of the re-review.
  it('DOM-P34R-05 (fixed): entering the scope resets the "not applicable" aspects — the item can be planned (or determined by the specialist), and the reset is in the transfer history', async () => {
    const after = await item(p.pm, pid, itemId);
    // Implemented: included, both aspects back to not_started with a `scope_reset` record each; the transfer can be planned.
    expect(after.disposition).toBe('included');
    expect(after.transfer).toEqual({ legal: 'not_started', economic: 'not_started', combined: 'not_started' });
    expect(after.allowedTransferCommands.legal).toContain('plan');
    expect(after.allowedTransferCommands.economic).toContain('plan');
    const resets = (await owner().query(`select aspect, from_status::text, to_status::text from transfer_record where perimeter_item_id = $1 and command = 'scope_reset' order by aspect`, [itemId])).rows;
    expect(resets).toEqual([
      { aspect: 'economic', from_status: 'not_applicable', to_status: 'not_started' },
      { aspect: 'legal', from_status: 'not_applicable', to_status: 'not_started' },
    ]);
    const per = stateOf(await dims(), 'perimeter_transfer');
    expect(per.explanation).not.toMatch(/neither a legal nor an economic transfer/);
  });
});
