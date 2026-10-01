import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { runWorker } from '../gates/gate-test-kit';
import { Personas, approveBaseline, approveChangeRequest, base, carveoutProject, createItem, item, linkEvidence, ok, workstreamId } from './carveout-kit';

/**
 * Fixes of the P3/P4 focused domain re-review for the perimeter (docs/reviews/P3-P4-domain-rereview.md):
 * DOM-P34R-05 ("not applicable" set out of scope is reset when the item enters the transferring scope — classification before
 * the baseline, applied change request after it) and DOM-P34R-06 (transfer evidence rejected after verification: the
 * dimension fails closed at once and the evidence reaction returns the verified aspects to in progress). The baseline test is
 * last (the baseline changes how items are added). Real API; synthetic data.
 */
let pid: string;
let p: Personas;
type Dim = { key: string; state: string; explanation: string; explanationI18n: { code: string }[] };
const perimeterDim = async () => ((await p.pm.post(`${base(pid)}/status-dimensions/recompute`, {})).body as { items: Dim[] }).items.find((d) => d.key === 'perimeter_transfer')!;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
const history = async (itemId: string) =>
  (await owner().query(`select aspect, command, from_status::text as "from", to_status::text as "to", recorded_by from transfer_record where perimeter_item_id = $1 order by created_at, id`, [itemId])).rows as {
    aspect: string;
    command: string;
    from: string;
    to: string;
    recorded_by: string | null;
  }[];

beforeAll(async () => {
  ({ projectId: pid, p } = await carveoutProject('P34RF-PER'));
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('DOM-P34R-06 — transfer evidence rejected after verification [AT-06, AT-14, REQ-PER-007]', () => {
  it('the dimension fails closed at once (evidence pending); the reaction returns the verified aspects to in progress (system entries); a new report on valid evidence is verified again', async () => {
    const ws = await workstreamId(p.pm, pid, 'WS05');
    const x = await createItem(p.pm, pid, { type: 'asset', name: 'Battery string C (synthetic)', disposition: 'included', workstreamId: ws, ownerUserId: p.pm.userId });
    let v = x.version;
    for (const aspect of ['legal', 'economic'] as const) {
      for (const command of ['plan', 'start', 'report_transferred'] as const) {
        v = (await ok<{ itemVersion: number }>(p.pm.post(`${base(pid)}/transfers`, { perimeterItemId: x.id, aspect, command, expectedVersion: v, mechanism: 'Asset transfer instrument (synthetic)', effectiveDate: today() }))).itemVersion;
      }
    }
    const link = await linkEvidence(p.pm, pid, 'transfer', x.id, 'Signed asset transfer record (synthetic)');
    const verifyBoth = async () => {
      for (const aspect of ['legal', 'economic'] as const) {
        const rep = (await p.pm.get(`${base(pid)}/transfers?perimeterItemId=${x.id}&aspect=${aspect}`).expect(200)).body.items.find((r: { command: string }) => r.command === 'report_transferred');
        await ok(p.legal.post(`${base(pid)}/transfers/${rep.id}/verify`, { expectedVersion: (await item(p.pm, pid, x.id)).version, note: 'Checked against the signed record (synthetic)' }));
      }
    };
    await verifyBoth();
    await runWorker();
    expect((await perimeterDim()).state).toBe('transferred_verified');

    const lv = (await owner().query(`select version from evidence_link where id = $1`, [link.id])).rows[0].version as number;
    await ok(p.secretary.post(`${base(pid)}/evidence/${link.id}/verify`, { expectedVersion: lv, decision: 'reject', note: 'Record of another asset — defective (synthetic)' }));
    // Before the worker runs: the rule fails closed — the verified aspects without valid evidence read "evidence pending".
    const pending = await perimeterDim();
    expect(pending.state, JSON.stringify(pending)).toBe('transferred_evidence_pending');

    await runWorker();
    const after = await item(p.pm, pid, x.id);
    expect(after.transfer).toEqual({ legal: 'in_progress', economic: 'in_progress', combined: 'in_progress' });
    const rejects = (await history(x.id)).filter((h) => h.command === 'reject_evidence');
    expect(rejects.map((h) => [h.aspect, h.from, h.to, h.recorded_by]).sort()).toEqual([
      ['economic', 'transferred_verified', 'in_progress', null],
      ['legal', 'transferred_verified', 'in_progress', null],
    ]);
    const audit = (await owner().query(`select actor_kind from audit_event where project_id = $1 and action = 'carveout.transfer.evidence_invalidated' and entity_id = $2`, [pid, x.id])).rows;
    expect(audit).toEqual([{ actor_kind: 'service' }]);
    // The history list shows the system entry (recordedBy null).
    const listed = (await p.pm.get(`${base(pid)}/transfers?perimeterItemId=${x.id}`).expect(200)).body.items as { command: string; recordedBy: string | null }[];
    expect(listed.filter((r) => r.command === 'reject_evidence').every((r) => r.recordedBy === null)).toBe(true);
    expect((await perimeterDim()).state).not.toBe('transferred_verified');

    // Re-reported on new, valid evidence and verified again (Legal is neither the reporter nor the linker).
    v = after.version;
    for (const aspect of ['legal', 'economic'] as const) {
      v = (await ok<{ itemVersion: number }>(p.pm.post(`${base(pid)}/transfers`, { perimeterItemId: x.id, aspect, command: 'report_transferred', expectedVersion: v, mechanism: 'Asset transfer instrument (synthetic)', effectiveDate: today() }))).itemVersion;
    }
    await linkEvidence(p.pm, pid, 'transfer', x.id, 'Corrected signed asset transfer record (synthetic)');
    await verifyBoth();
    await runWorker();
    expect((await item(p.pm, pid, x.id)).transfer.combined).toBe('transferred_verified');
    expect((await perimeterDim()).state).toBe('transferred_verified');
  });
});

describe('DOM-P34R-05 — "not applicable" recorded out of scope does not enter the transferring scope [AT-07, A-P3-05]', () => {
  it('before the baseline: classifying an Excluded item with one aspect "not applicable" as Included resets that aspect (scope_reset entry); it is never "determined" without the specialist', async () => {
    const ws = await workstreamId(p.pm, pid, 'WS06');
    const x = await createItem(p.pm, pid, { type: 'contract', name: 'Cleaning contract (synthetic)', disposition: 'excluded', workstreamId: ws, ownerUserId: p.pm.userId });
    const na = await ok<{ itemVersion: number }>(p.pm.post(`${base(pid)}/transfers`, { perimeterItemId: x.id, aspect: 'economic', command: 'mark_not_applicable', expectedVersion: x.version, note: 'Retained (synthetic)' }));
    const cls = await ok<{ applied: boolean }>(p.pm.post(`${base(pid)}/perimeter-items/${x.id}/classify`, { expectedVersion: na.itemVersion, disposition: 'included', justification: 'Now transfers with the hall (synthetic)' }));
    expect(cls.applied).toBe(true);
    const after = await item(p.pm, pid, x.id);
    expect(after.transfer).toEqual({ legal: 'not_started', economic: 'not_started', combined: 'not_started' });
    expect((await history(x.id)).map((h) => [h.aspect, h.command, h.from, h.to])).toEqual([
      ['economic', 'mark_not_applicable', 'not_started', 'not_applicable'],
      ['economic', 'scope_reset', 'not_applicable', 'not_started'],
    ]);
    expect((await perimeterDim()).explanationI18n.map((m) => m.code)).not.toContain('dimension.perimeter.aspect_not_applicable');
  });

  it('after the baseline: the approved change request that brings an Excluded item into scope resets its "not applicable" aspects when applied', async () => {
    const ws = await workstreamId(p.pm, pid, 'WS06');
    const x = await createItem(p.pm, pid, { type: 'contract', name: 'Security guarding contract (synthetic)', disposition: 'excluded', workstreamId: ws, ownerUserId: p.pm.userId });
    const legal = await ok<{ itemVersion: number }>(p.pm.post(`${base(pid)}/transfers`, { perimeterItemId: x.id, aspect: 'legal', command: 'mark_not_applicable', expectedVersion: x.version, note: 'Retained (synthetic)' }));
    await ok(p.pm.post(`${base(pid)}/transfers`, { perimeterItemId: x.id, aspect: 'economic', command: 'mark_not_applicable', expectedVersion: legal.itemVersion, note: 'Retained (synthetic)' }));
    await approveBaseline(p, pid);
    let cur = await item(p.pm, pid, x.id);
    const cls = await ok<{ applied: boolean; changeRequest: { id: string } }>(p.pm.post(`${base(pid)}/perimeter-items/${x.id}/classify`, { expectedVersion: cur.version, disposition: 'included', justification: 'Brought into the transferring scope (synthetic)' }));
    expect(cls.applied).toBe(false);
    cur = await item(p.pm, pid, x.id);
    expect(cur.transfer.combined).toBe('not_applicable'); // unchanged until the approved request is applied
    await approveChangeRequest(p, pid, cls.changeRequest.id);
    cur = await item(p.pm, pid, x.id);
    const applied = await ok<{ outcome: string }>(p.pm.post(`${base(pid)}/perimeter-items/${x.id}/apply-change`, { expectedVersion: cur.version, changeRequestId: cls.changeRequest.id }));
    expect(applied.outcome).toBe('applied');
    cur = await item(p.pm, pid, x.id);
    expect(cur.disposition).toBe('included');
    expect(cur.transfer).toEqual({ legal: 'not_started', economic: 'not_started', combined: 'not_started' });
    const resets = (await history(x.id)).filter((h) => h.command === 'scope_reset').map((h) => h.aspect).sort();
    expect(resets).toEqual(['economic', 'legal']);
  });
});
