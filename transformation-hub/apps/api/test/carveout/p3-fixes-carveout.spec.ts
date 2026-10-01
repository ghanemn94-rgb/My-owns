import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, demoUserId, loginAs, owner } from '../helpers';
import { Personas, approveBaseline, approveChangeRequest, base, carveoutProject, createItem, item, linkEvidence, ok, workstreamId } from './carveout-kit';

/**
 * Fixes of the P3 domain / security reviews for the carve-out perimeter (docs/reviews/P3-domain-review.md,
 * docs/reviews/P3-P4-security-review.md). DOM-P3-05: "transfer not applicable" on an Included / Shared item is a specialist
 * determination before baseline, a change request after it, never on both aspects, and never reads as transferred.
 * DOM-P3-10 (transfer verification), DOM-P3-15 (consent need read from the specialist class), DOM-P3-17 (the legal reviewer
 * of an agreement holds a legal role). All data is synthetic.
 */
let pid: string;
let p: Personas;
const dims = async () => (await p.pm.post(`${base(pid)}/status-dimensions/recompute`, {})).body as { items: { key: string; state: string; explanationI18n: { code: string }[] }[]; carveOutComplete: boolean };
const na = (c: typeof p.pm, itemId: string, aspect: 'legal' | 'economic', v: number) =>
  c.post(`${base(pid)}/transfers`, { perimeterItemId: itemId, aspect, command: 'mark_not_applicable', expectedVersion: v, note: 'Not transferring (synthetic)' });
const determine = (c: typeof p.pm, itemId: string, aspect: 'legal' | 'economic', v: number) =>
  c.post(`${base(pid)}/perimeter-items/${itemId}/transfer-not-applicable`, { expectedVersion: v, aspect, basis: 'No separate economic transfer: the economic benefit follows the legal title (synthetic basis)' });

beforeAll(async () => {
  ({ projectId: pid, p } = await carveoutProject('P3FIX-CO'));
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('DOM-P3-05 — "transfer not applicable" on an Included item [AT-06, AT-07, REQ-PER-002, REQ-PER-007]', () => {
  let itemId: string;

  it('before baseline: the transfer manager is refused (403 transfer.not_applicable_specialist); a specialist (not the owner) determines ONE aspect with a basis', async () => {
    const ws = await workstreamId(p.pm, pid, 'WS05');
    const x = await createItem(p.pm, pid, { type: 'asset', name: 'Chiller unit (synthetic)', disposition: 'included', workstreamId: ws, ownerUserId: p.pm.userId });
    itemId = x.id;
    const pm = await na(p.pm, itemId, 'economic', x.version);
    expect(pm.status).toBe(403);
    expect(pm.body.code).toBe('transfer.not_applicable_specialist');
    const noBasis = await p.approver.post(`${base(pid)}/perimeter-items/${itemId}/transfer-not-applicable`, { expectedVersion: x.version, aspect: 'economic' });
    expect(noBasis.status).toBe(400);
    const r = await determine(p.approver, itemId, 'economic', x.version);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ aspect: 'economic', status: 'not_applicable', changeRequest: null });
    const hist = await owner().query(`select command, note, recorded_by from transfer_record where perimeter_item_id = $1`, [itemId]);
    expect(hist.rows).toEqual([expect.objectContaining({ command: 'mark_not_applicable', recorded_by: p.approver.userId })]);
    expect(hist.rows[0].note).toMatch(/^Specialist determination: /);
  });

  it('never both aspects: the second is refused (422 transfer.not_applicable_in_scope) — the item would be reclassified instead', async () => {
    const cur = await item(p.pm, pid, itemId);
    const r = await determine(p.approver, itemId, 'legal', cur.version);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('transfer.not_applicable_in_scope');
    expect((await item(p.pm, pid, itemId)).transfer).toMatchObject({ legal: 'not_started', economic: 'not_applicable' });
  });

  it('the item owner cannot determine it (not_self), and the reconciliation reports the aspect', async () => {
    const ws = await workstreamId(p.pm, pid, 'WS05');
    const own = await createItem(p.pm, pid, { type: 'asset', name: 'Owned by the approver (synthetic)', disposition: 'included', workstreamId: ws, ownerUserId: p.approver.userId });
    const self = await determine(p.approver, own.id, 'economic', own.version);
    expect(self.status).toBe(403);
    const recon = (await p.pm.get(`${base(pid)}/perimeter/reconciliation`).expect(200)).body;
    const f = (recon.findings as { itemId: string; issue: string }[]).filter((x) => x.itemId === itemId).map((x) => x.issue);
    expect(f).toContain('transfer_not_applicable');
  });

  it('an in-scope item whose transfer is "not applicable" never reads as transferred (dimension)', async () => {
    // Owner pool (setup): simulate legacy data where both aspects of an in-scope item were marked not applicable.
    const ws = await workstreamId(p.pm, pid, 'WS06');
    const legacy = await createItem(p.pm, pid, { type: 'data', name: 'Legacy N/A item (synthetic)', disposition: 'included', workstreamId: ws, ownerUserId: p.pm.userId });
    await owner().query(`update perimeter_item set transfer_status = 'not_applicable', economic_transfer_status = 'not_applicable' where id = $1`, [legacy.id]);
    const d = await dims();
    expect(d.items.find((x) => x.key === 'perimeter_transfer')!.state).not.toBe('transferred_verified');
    const recon = (await p.pm.get(`${base(pid)}/perimeter/reconciliation`).expect(200)).body;
    expect((recon.findings as { itemId: string; issue: string }[]).some((x) => x.itemId === legacy.id && x.issue === 'transfer_not_applicable')).toBe(true);
    await owner().query(`update perimeter_item set disposition = 'excluded' where id = $1`, [legacy.id]); // leave the project consistent
  });

});

describe('DOM-P3-10 — whoever linked the transfer evidence does not verify the transfer [access-matrix §5.1 carveout.transfer.verify]', () => {
  it('a second PM who also holds a verifier role links the transfer evidence and is refused the verification (403)', async () => {
    const admin = await loginAs('portfolio.admin');
    const second = await demoUserId('pm.b');
    const grants: string[] = [];
    try {
      for (const role of ['project_manager', 'functional_approver']) {
        const g = await admin.post(`${base(pid)}/members`, { userId: second, role, reason: 'P3 fix test (second PM with a verifier role)' });
        expect(g.status, JSON.stringify(g.body)).toBe(201);
        grants.push(g.body.id as string);
      }
      const pmb = await loginAs('pm.b');
      const ws = await workstreamId(p.pm, pid, 'WS05');
      const x = await createItem(p.pm, pid, { type: 'asset', name: 'Rack row (synthetic)', disposition: 'included', workstreamId: ws, ownerUserId: p.pm.userId });
      let cur = await item(p.pm, pid, x.id);
      const tr = (command: string, extra: Record<string, unknown> = {}) => p.pm.post(`${base(pid)}/transfers`, { perimeterItemId: x.id, aspect: 'legal', command, expectedVersion: cur.version, ...extra });
      let r = await tr('plan', { mechanism: 'Asset transfer deed (synthetic)', effectiveDate: '2026-09-01' });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      cur = await item(p.pm, pid, x.id);
      r = await tr('start');
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      cur = await item(p.pm, pid, x.id);
      r = await tr('report_transferred', { mechanism: 'Asset transfer deed (synthetic)', effectiveDate: '2026-09-01' });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const reportId = r.body.id as string;
      await linkEvidence(pmb, pid, 'transfer', x.id, 'Signed transfer deed (synthetic) — linked by the future verifier');
      cur = await item(p.pm, pid, x.id);
      const v = await pmb.post(`${base(pid)}/transfers/${reportId}/verify`, { expectedVersion: cur.version, note: 'Verified on my own evidence (probe)' });
      expect(v.status).toBe(403);
      expect((await item(p.pm, pid, x.id)).transfer.legal).toBe('transferred_pending_evidence');
    } finally {
      for (const id of grants) await admin.post(`${base(pid)}/members/${id}/revoke`, { reason: 'P3 fix test done' }).expect(201);
    }
  });
});

describe('DOM-P3-15 (perimeter) — the consent need set by the specialist class is not undone by a descriptive edit [REQ-AGR-006, REQ-AGR-008]', () => {
  it('after the specialist classifies a contract "consent required", resetting consentRequired to false does not remove the consent_outstanding finding', async () => {
    const x = await createItem(p.pm, pid, { type: 'contract', name: 'Colocation customer contract (synthetic)', disposition: 'included' });
    let cur = await item(p.pm, pid, x.id);
    await ok(p.legal.post(`${base(pid)}/perimeter-items/${x.id}/transferability`, { expectedVersion: cur.version, transferClass: 'consent_required', basis: 'Assignment clause requires the customer consent (synthetic)' }));
    cur = await item(p.pm, pid, x.id);
    expect(cur.consentRequired).toBe(true);
    const patch = await p.pm.patch(`${base(pid)}/perimeter-items/${x.id}`, { expectedVersion: cur.version, consentRequired: false });
    const recon = (await p.pm.get(`${base(pid)}/perimeter/reconciliation`).expect(200)).body;
    const issues = (recon.findings as { itemId: string; issue: string }[]).filter((f) => f.itemId === x.id).map((f) => f.issue);
    expect(issues, `PATCH ${patch.status} ${JSON.stringify(patch.body)}`).toContain('consent_outstanding');
  });
});

describe('DOM-P3-17 (agreements) — the legal reviewer of an agreement holds a legal role [REQ-AGR-001]', () => {
  it('the agreement manager cannot name a non-legal member (e.g. themselves) as legal reviewer (422); a Legal member can be named', async () => {
    const self = await p.pm.post(`${base(pid)}/agreements`, { kindLabel: 'MSA', title: 'Master services agreement (synthetic)', legalReviewerUserId: p.pm.userId });
    expect(self.status, JSON.stringify(self.body)).toBe(422);
    expect(self.body.code).toBe('agreement.legal_reviewer_not_legal');
    const good = await p.pm.post(`${base(pid)}/agreements`, { kindLabel: 'MSA', title: 'Master services agreement (synthetic)', legalReviewerUserId: p.legal.userId });
    expect(good.status, JSON.stringify(good.body)).toBe(201);
    const upd = await p.pm.patch(`${base(pid)}/agreements/${good.body.id}`, { expectedVersion: good.body.version, legalReviewerUserId: p.pm.userId });
    expect(upd.status).toBe(422);
  });
});

describe('DOM-P3-05 — after the baseline is approved (last: the baseline changes how items are added) [AT-07, REQ-PER-005]', () => {
  it('after baseline: the transfer manager raises a CHANGE REQUEST (aspect unchanged until the approved request is applied); the specialist route is refused', async () => {
    const ws = await workstreamId(p.pm, pid, 'WS06');
    const x = await createItem(p.pm, pid, { type: 'contract', name: 'Maintenance contract (synthetic)', disposition: 'included', workstreamId: ws, ownerUserId: p.pm.userId });
    await approveBaseline(p, pid);
    let cur = await item(p.pm, pid, x.id);
    expect(cur.inApprovedBaseline).toBe(true);
    const spec = await determine(p.approver, x.id, 'economic', cur.version);
    expect(spec.status).toBe(422);
    expect(spec.body.code).toBe('transfer.not_applicable_after_baseline');
    const r = await na(p.pm, x.id, 'economic', cur.version);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.id).toBeNull();
    expect(r.body.changeRequest).toMatchObject({ code: expect.stringMatching(/^CR-/) });
    cur = await item(p.pm, pid, x.id);
    expect(cur.transfer.economic).toBe('not_started');
    expect(cur.pendingChange?.id).toBe(r.body.changeRequest.id);
    // A second request while one is open → 409.
    expect((await na(p.pm, x.id, 'legal', cur.version)).status).toBe(409);
    await approveChangeRequest(p, pid, r.body.changeRequest.id);
    cur = await item(p.pm, pid, x.id);
    const applied = await ok<{ outcome: string }>(p.pm.post(`${base(pid)}/perimeter-items/${x.id}/apply-change`, { expectedVersion: cur.version, changeRequestId: r.body.changeRequest.id }));
    expect(applied.outcome).toBe('applied');
    cur = await item(p.pm, pid, x.id);
    expect(cur.transfer).toMatchObject({ economic: 'not_applicable', legal: 'not_started' });
    expect(cur.disposition).toBe('included');
    const rec = await owner().query(`select command, to_status, note from transfer_record where perimeter_item_id = $1`, [x.id]);
    expect(rec.rows).toEqual([expect.objectContaining({ command: 'mark_not_applicable', to_status: 'not_applicable' })]);
    expect(rec.rows[0].note).toContain(r.body.changeRequest.code);
  });
});
