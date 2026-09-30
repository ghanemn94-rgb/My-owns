import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { runWorker } from '../gates/gate-test-kit';
import { Personas, approveBaseline, base, carveoutProject, createItem, item, linkEvidence, newcoId, ok, workstreamId } from '../carveout/carveout-kit';

/**
 * P3 DOMAIN REVIEW — perimeter transfer and incorporation dimensions (docs/reviews/P3-domain-review.md; AT-06, AT-07,
 * business-gates.md §1 "four independent status dimensions … the carve-out is never shown as complete because one dimension
 * is complete"). One DC project for this file, real API only (owner pool for assertions).
 *
 * `DEFECT …` probes assert the REQUIRED behaviour and are declared with `it.fails` while the defect is open;
 * `P3D_PROBE_PLAIN=1` runs them as plain tests. `CONTROL …` are plain tests. All data is synthetic.
 */
const defect = process.env['P3D_PROBE_PLAIN'] ? it : it.fails;

let pid: string;
let p: Personas;
type Dim = { key: string; state: string; explanation: string };
const dims = async () => (await p.pm.post(`${base(pid)}/status-dimensions/recompute`, {})).body as { items: Dim[]; carveOutComplete: boolean };
const stateOf = (d: { items: Dim[] }, key: string) => d.items.find((x) => x.key === key)!;

beforeAll(async () => {
  ({ projectId: pid, p } = await carveoutProject('P3D-PER'));
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

async function markNotApplicable(itemId: string, aspect: 'legal' | 'economic', version: number) {
  return p.pm.post(`${base(pid)}/transfers`, { perimeterItemId: itemId, aspect, command: 'mark_not_applicable', expectedVersion: version, note: 'Not transferring (probe, synthetic)' });
}

describe('P3 domain review — an INCLUDED item marked "transfer not applicable" [AT-06, AT-07, REQ-PER-007, REQ-LCY-006]', () => {
  it('CONTROL: one included item, nothing transferred → perimeter_transfer is not_started and the carve-out is not complete', async () => {
    const ws = await workstreamId(p.pm, pid, 'WS05');
    await createItem(p.pm, pid, { type: 'site', name: 'Probe site hall 1 (synthetic)', disposition: 'included', workstreamId: ws, ownerUserId: p.pm.userId });
    const d = await dims();
    expect(stateOf(d, 'perimeter_transfer').state).toBe('not_started');
    expect(d.carveOutComplete).toBe(false);
  });

  it('DOM-P3-05a: marking both aspects of the only INCLUDED item "not applicable" shows the perimeter as "transferred_verified — all in-scope items transferred with verified evidence" (fixed, regression)', async () => {
    const [it0] = (await p.pm.get(`${base(pid)}/perimeter-items`).expect(200)).body.items as { id: string; version: number; disposition: string }[];
    expect(it0!.disposition).toBe('included');
    const legal = await markNotApplicable(it0!.id, 'legal', it0!.version);
    const economic = legal.status === 201 ? await markNotApplicable(it0!.id, 'economic', legal.body.itemVersion) : legal;
    await runWorker();
    const d = await dims();
    const per = stateOf(d, 'perimeter_transfer');
    const recon = (await p.pm.get(`${base(pid)}/perimeter/reconciliation`).expect(200)).body;
    const cur = await item(p.pm, pid, it0!.id);
    // Required (spec §7.1 "reconciliation identifying items without a transfer plan or evidence"; business-gates.md §1
    // `transferred_verified` = "verified transfer evidence"; the transfer machine itself describes not_applicable as
    // "Not transferring (excluded/retained)"): an item that stays INCLUDED in the transferring scope is never counted as
    // transferred because its transfer was declared not applicable — no transfer, no evidence, no verifier.
    expect(
      per.state,
      `legal N/A ${legal.status}, economic N/A ${economic.status}; item disposition ${cur.disposition}, transfer ${JSON.stringify(cur.transfer)}; dimension ${JSON.stringify(per)}; reconciliation findings ${JSON.stringify(recon.findings)}; carveOutComplete ${d.carveOutComplete}`,
    ).not.toBe('transferred_verified');
  });

  it('DOM-P3-05b: after the baseline is approved, "not applicable" on both aspects takes an in-scope item out of the transfer without a change request (AT-07) (fixed, regression)', async () => {
    const ws = await workstreamId(p.pm, pid, 'WS06');
    const x = await createItem(p.pm, pid, { type: 'data', name: 'Probe DCIM data set (synthetic)', disposition: 'included', workstreamId: ws, ownerUserId: p.pm.userId });
    expect(x.applied).toBe(true);
    await approveBaseline(p, pid);
    const before = await item(p.pm, pid, x.id);
    expect(before.inApprovedBaseline).toBe(true);
    const legal = await markNotApplicable(x.id, 'legal', before.version);
    const economic = legal.status === 201 ? await markNotApplicable(x.id, 'economic', legal.body.itemVersion) : legal;
    const after = await item(p.pm, pid, x.id);
    const crs = (await owner().query(`select code, status from change_request where project_id = $1 and subject_type = 'perimeter_item' and subject_id = $2`, [pid, x.id])).rows;
    // Required (AT-07; perimeterChangeRequiresChangeRequest: "after baseline approval a change request is required … to move
    // an item into or out of the transferring scope"): declaring that an in-baseline included item does not transfer is a
    // scope change — refused, or raised as a change request with its impact, never applied directly by the transfer manager.
    expect(
      economic.status === 201 && after.transfer.combined === 'not_applicable' && crs.length === 0,
      `legal ${legal.status}, economic ${economic.status} ${JSON.stringify(economic.body)}; item ${after.disposition} ${JSON.stringify(after.transfer)}, pendingChange ${JSON.stringify(after.pendingChange)}; change requests ${JSON.stringify(crs)}`,
    ).toBe(false);
  });
});

describe('P3 domain review — separation of duties on incorporation verification [REQ-SET-010, access-matrix §2.4]', () => {
  defect('DEFECT DOM-P3-10b: Legal links the incorporation evidence, the PM records "incorporated", and the same Legal member verifies it on the evidence Legal recorded', async () => {
    const created = await ok<{ id: string; version: number }>(p.pm.post(`${base(pid)}/legal-entities`, { name: 'Probe JV company (fictional entity)', kind: 'jv_company', role: 'jv_company' }));
    const link = await linkEvidence(p.legal, pid, 'legal_entity', created.id, 'Synthetic registration extract (probe) — linked by Legal');
    let e = (await p.pm.get(`${base(pid)}/legal-entities/${created.id}`).expect(200)).body;
    await ok(p.pm.post(`${base(pid)}/legal-entities/${created.id}/incorporation`, { expectedVersion: e.version, status: 'incorporated', evidenceNote: 'Extract linked by Legal (probe)' }));
    e = (await p.legal.get(`${base(pid)}/legal-entities/${created.id}`).expect(200)).body;
    const v = await p.legal.post(`${base(pid)}/legal-entities/${created.id}/incorporation/verify`, { expectedVersion: e.version, outcome: 'confirm', note: 'Checked against the extract (probe)' });
    // Required (access-matrix.md §2.4: `newco.incorporation.verify` is not_self against "record owner and the person who
    // recorded the status/evidence"): the person who recorded the evidence does not verify the status on that evidence.
    expect(v.status, `evidence ${link.id} linked by Legal; verification by Legal ${v.status} ${JSON.stringify(v.body)}`).toBe(403);
  });
});

describe('P3 domain review — incorporation evidence found defective after verification [AT-06, AT-14, REQ-SET-010, REQ-LCY-007]', () => {
  defect('DEFECT DOM-P3-08: the only incorporation evidence is rejected as defective — the dimension still says "Incorporation confirmed with verified evidence"', async () => {
    const entityId = await newcoId(p.pm, pid);
    const link = await linkEvidence(p.pm, pid, 'legal_entity', entityId, 'Synthetic registration extract (probe)');
    let e = (await p.pm.get(`${base(pid)}/legal-entities/${entityId}`).expect(200)).body;
    await ok(p.pm.post(`${base(pid)}/legal-entities/${entityId}/incorporation`, { expectedVersion: e.version, status: 'incorporated', evidenceNote: 'Extract linked (probe)' }));
    e = (await p.legal.get(`${base(pid)}/legal-entities/${entityId}`).expect(200)).body;
    await ok(p.legal.post(`${base(pid)}/legal-entities/${entityId}/incorporation/verify`, { expectedVersion: e.version, outcome: 'confirm', note: 'Checked against the extract (probe)' }));
    expect(stateOf(await dims(), 'incorporation').state).toBe('incorporated_verified');
    // Evidence verification in the documents module (not the linker) rejects the extract as defective.
    const lv = (await owner().query(`select version from evidence_link where id = $1`, [link.id])).rows[0].version as number;
    const rej = await p.secretary.post(`${base(pid)}/evidence/${link.id}/verify`, { expectedVersion: lv, decision: 'reject', note: 'Extract of another company — defective (probe, synthetic)' });
    expect(rej.status, JSON.stringify(rej.body)).toBe(201);
    await runWorker();
    const d = await dims();
    const inc = stateOf(d, 'incorporation');
    const ent = (await p.pm.get(`${base(pid)}/legal-entities/${entityId}`).expect(200)).body;
    // Required (business-gates.md §1 rule 3 "evidence-pending states exist so that a reported fact is visible without being
    // treated as verified"; spec §3 "If approved evidence is found defective, reopen the assessment through a controlled
    // process while preserving previous status and decisions"; AT-14): once the evidence the verification relied on is
    // rejected as defective, the incorporation is no longer shown as verified (flagged / back to evidence pending for Legal).
    expect(inc.state, `entity incorporation ${JSON.stringify(ent.incorporation)}, evidence ${JSON.stringify(ent.evidence)}; dimension ${JSON.stringify(inc)}`).not.toBe('incorporated_verified');
  });
});
