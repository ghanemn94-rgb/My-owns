import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, demoUserId, loginAs, owner } from '../helpers';
import { Personas, base, carveoutProject, createItem, deniedCount, item, linkEvidence, ok, workstreamId } from './carveout-kit';

/**
 * AT-08: a customer contract that cannot transfer on Day 1 shows the required consent or interim arrangement,
 * service / billing / SLA accountability and a remediation plan. REQ-AGR-006: transferability is set only by a
 * specialist; REQ-AGR-008: consents tracked with evidence; REQ-PER-007: verifyTransfer needs evidence and another person.
 */
let pid: string;
let p: Personas;
let contractId: string;
let consentId: string;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
type Day1 = { applicable: boolean; consentGranted: boolean; ok: boolean; missing: string[] };

beforeAll(async () => {
  ({ projectId: pid, p } = await carveoutProject('CO-AT08'));
  const r = await createItem(p.pm, pid, { type: 'contract', name: 'AT-08 customer contract (fictional customer)', disposition: 'included', workstreamId: await workstreamId(p.pm, pid, 'WS09'), consentRequired: true });
  contractId = r.id;
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('AT-08 — Day-1 position of a contract that cannot transfer [AT-08, REQ-AGR-006, REQ-AGR-008, REQ-PER-007]', () => {
  it('UT/IT: a non-specialist cannot set transferability (403, audited); the class stays unknown', async () => {
    const d = await item(p.pm, pid, contractId);
    expect(d.transferClass).toBe('unknown');
    const r = await p.pm.post(`${base(pid)}/perimeter-items/${contractId}/transferability`, { expectedVersion: d.version, transferClass: 'transferable', basis: 'I think so' });
    expect(r.status).toBe(403);
    expect(await deniedCount(p.pm.userId, 'denied', 'carveout.setTransferability')).toBeGreaterThanOrEqual(1);
    expect((await item(p.pm, pid, contractId)).transferClass).toBe('unknown');
  });

  it('unassessed → the Day-1 position lists the specialist classification as missing', async () => {
    const d = await item(p.pm, pid, contractId);
    expect(d.day1 as Day1).toMatchObject({ applicable: true, ok: false });
    expect(d.day1.missing).toContain('specialistClassification');
  });

  it('Legal classifies "consent required"; consent outstanding → interim arrangement, owners and remediation required', async () => {
    const d = await item(p.legal, pid, contractId);
    const r = await ok<{ transferClass: string; day1: Day1 }>(p.legal.post(`${base(pid)}/perimeter-items/${contractId}/transferability`, { expectedVersion: d.version, transferClass: 'consent_required', basis: 'Assignment clause needs counterparty consent (synthetic)' }));
    expect(r.transferClass).toBe('consent_required');
    expect(r.day1).toEqual({ applicable: true, consentGranted: false, ok: false, missing: ['interimArrangement', 'serviceAccountableOwner', 'billingAccountableOwner', 'slaAccountableOwner', 'remediationPlan'], interimArrangement: null, serviceAccountable: null, billingAccountable: null, slaAccountable: null, remediationPlan: null });
    const after = await item(p.legal, pid, contractId);
    expect(after.transferClassAssessment.assessedBy.userId).toBe(p.legal.userId);
    const positions = (await p.pm.get(`${base(pid)}/perimeter/day1-contract-positions`).expect(200)).body;
    expect(positions.summary).toEqual({ total: 1, ok: 0, incomplete: 1 });
    const recon = (await p.pm.get(`${base(pid)}/perimeter/reconciliation`).expect(200)).body;
    expect(recon.findings.filter((f: { itemId: string }) => f.itemId === contractId).map((f: { issue: string }) => f.issue)).toEqual(expect.arrayContaining(['day1_position_incomplete', 'consent_outstanding', 'no_transfer_plan']));
  });

  it('consents: requested → a response needs evidence; conditional needs conditions; "not required" needs a specialist', async () => {
    const c = await ok<{ id: string }>(p.pm.post(`${base(pid)}/consents`, { perimeterItemId: contractId, counterparty: 'Fictional Customer One', contractRef: 'T-C-1', ownerUserId: p.pm.userId, dueDate: today() }));
    consentId = c.id;
    await ok(p.pm.post(`${base(pid)}/consents/${consentId}/record-response`, { expectedVersion: 1, status: 'requested', date: today() }));
    const noEv = await p.pm.post(`${base(pid)}/consents/${consentId}/record-response`, { expectedVersion: 2, status: 'granted', date: today() });
    expect(noEv.status).toBe(422);
    expect(noEv.body.code).toBe('consent.evidence_required');
    const noCond = await p.pm.post(`${base(pid)}/consents/${consentId}/record-response`, { expectedVersion: 2, status: 'conditional', date: today(), evidenceNote: 'Letter (synthetic)' });
    expect(noCond.body.code).toBe('consent.conditions_required');
    expect((await p.pm.post(`${base(pid)}/consents/${consentId}/record-response`, { expectedVersion: 2, status: 'not_required', date: today(), evidenceNote: 'x' })).status).toBe(403);
    const list = (await p.pm.get(`${base(pid)}/consents?perimeterItemId=${contractId}`).expect(200)).body;
    expect(list.items[0]).toMatchObject({ status: 'requested', requestedOn: today() });
    // PATCH cannot change a consent status.
    expect((await p.pm.patch(`${base(pid)}/consents/${consentId}`, { expectedVersion: 2, status: 'granted' })).status).toBe(400);
  });

  it('the legal transfer of the contract cannot be reported while consent is outstanding', async () => {
    let d = await item(p.pm, pid, contractId);
    const plan = await ok<{ itemVersion: number }>(p.pm.post(`${base(pid)}/transfers`, { perimeterItemId: contractId, aspect: 'legal', command: 'plan', expectedVersion: d.version, mechanism: 'Assignment with consent (proposed)', effectiveDate: today() }));
    await ok(p.pm.post(`${base(pid)}/transfers`, { perimeterItemId: contractId, aspect: 'legal', command: 'start', expectedVersion: plan.itemVersion }));
    d = await item(p.pm, pid, contractId);
    const r = await p.pm.post(`${base(pid)}/transfers`, { perimeterItemId: contractId, aspect: 'legal', command: 'report_transferred', expectedVersion: d.version, effectiveDate: today() });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('transfer.consent_outstanding');
    expect((await item(p.pm, pid, contractId)).transfer.legal).toBe('in_progress');
  });

  it('accountable owners must be project members; a complete interim position makes the Day-1 position OK', async () => {
    let d = await item(p.pm, pid, contractId);
    const outsider = await demoUserId('pm.b');
    const bad = await p.pm.post(`${base(pid)}/perimeter-items/${contractId}/interim-arrangement`, { expectedVersion: d.version, serviceAccountableUserId: outsider });
    expect(bad.status).toBe(400);
    const r = await ok<{ day1: Day1 & { serviceAccountable: { userId: string } } }>(
      p.pm.post(`${base(pid)}/perimeter-items/${contractId}/interim-arrangement`, {
        expectedVersion: d.version,
        interimArrangement: 'Parent keeps the contract on Day 1; NewCo delivers back-to-back (structure TBD by Legal)',
        serviceAccountableUserId: p.approver.userId,
        billingAccountableUserId: p.finance.userId,
        slaAccountableUserId: p.approver.userId,
        remediationPlan: 'Chase the consent; review at G3',
      }),
    );
    expect(r.day1).toMatchObject({ applicable: true, consentGranted: false, ok: true, missing: [] });
    expect(r.day1.serviceAccountable.userId).toBe(p.approver.userId);
    const positions = (await p.contributor.get(`${base(pid)}/perimeter/day1-contract-positions`).expect(200)).body;
    expect(positions.summary).toEqual({ total: 1, ok: 1, incomplete: 0 });
    expect(positions.items[0].position.billingAccountable.userId).toBe(p.finance.userId);
    const recon = (await p.pm.get(`${base(pid)}/perimeter/reconciliation`).expect(200)).body;
    expect(recon.findings.filter((f: { itemId: string }) => f.itemId === contractId).map((f: { issue: string }) => f.issue)).not.toContain('day1_position_incomplete');
    d = await item(p.pm, pid, contractId);
    expect(d.day1.interimArrangement).toMatch(/back-to-back/);
  });

  it('once consent is granted with evidence the transfer is reported; verifyTransfer needs evidence and another person', async () => {
    await ok(p.pm.post(`${base(pid)}/consents/${consentId}/record-response`, { expectedVersion: 2, status: 'granted', date: today(), evidenceNote: 'Counterparty consent letter (synthetic)' }));
    let d = await item(p.pm, pid, contractId);
    expect(d.day1.consentGranted).toBe(true);
    const rep = await ok<{ id: string; status: string; itemVersion: number }>(p.pm.post(`${base(pid)}/transfers`, { perimeterItemId: contractId, aspect: 'legal', command: 'report_transferred', expectedVersion: d.version, effectiveDate: today() }));
    expect(rep.status).toBe('transferred_pending_evidence');
    // UT/IT: verifyTransfer without evidence rejected.
    const noEv = await p.legal.post(`${base(pid)}/transfers/${rep.id}/verify`, { expectedVersion: rep.itemVersion });
    expect(noEv.status).toBe(422);
    expect(noEv.body.code).toBe('transfer.evidence_required');
    await linkEvidence(p.pm, pid, 'transfer', contractId, 'Executed assignment (synthetic)');
    // The PM (reporter) lacks the verify permission altogether.
    expect((await p.pm.post(`${base(pid)}/transfers/${rep.id}/verify`, { expectedVersion: rep.itemVersion })).status).toBe(403);
    const v = await ok<{ status: string; transfer: { legal: string; economic: string; combined: string } }>(p.legal.post(`${base(pid)}/transfers/${rep.id}/verify`, { expectedVersion: rep.itemVersion, note: 'Checked (test)' }));
    expect(v.status).toBe('transferred_verified');
    expect(v.transfer).toEqual({ legal: 'transferred_verified', economic: 'not_started', combined: 'not_started' });
    // Append-only history with the aspect and the effective date of that aspect (D-05).
    const rows = await owner().query(`select aspect, command, from_status, to_status, effective_date::text as d, reviews_record_id, evidence_count from transfer_record where perimeter_item_id = $1 order by created_at, id`, [contractId]);
    expect(rows.rows.map((x) => `${x.aspect}:${x.command}:${x.to_status}`)).toEqual(['legal:plan:planned', 'legal:start:in_progress', 'legal:report_transferred:transferred_pending_evidence', 'legal:verify:transferred_verified']);
    expect(rows.rows[3]).toMatchObject({ reviews_record_id: rep.id, evidence_count: 1 });
    const upd = await owner().query(`update transfer_record set note = 'tamper' where perimeter_item_id = $1`, [contractId]).catch((e: Error) => e);
    expect(upd).toBeInstanceOf(Error); // append-only
    d = await item(p.pm, pid, contractId);
    expect(d.legalDates.actual).toBe(today());
    expect(d.economicDates.actual).toBeNull();
  });

  it('separation of duties: a person who reported a transfer cannot verify it, even holding the verify role (not_self)', async () => {
    const admin = await loginAs('portfolio.admin');
    const ws09 = await workstreamId(p.pm, pid, 'WS09');
    await admin.post(`${base(pid)}/members`, { userId: p.finance.userId, role: 'workstream_lead', workstreamId: ws09, reason: 'AT-08 test: reporter who also verifies' }).expect(201);
    const fin = await loginAs('finance');
    let d = await item(fin, pid, contractId);
    let v = d.version;
    for (const command of ['plan', 'start', 'report_transferred'] as const) {
      v = (await ok<{ itemVersion: number }>(fin.post(`${base(pid)}/transfers`, { perimeterItemId: contractId, aspect: 'economic', command, expectedVersion: v, mechanism: 'Back-to-back economics (test)', effectiveDate: today() }))).itemVersion;
    }
    const rep = (await fin.get(`${base(pid)}/transfers?perimeterItemId=${contractId}&aspect=economic`).expect(200)).body.items.find((x: { command: string }) => x.command === 'report_transferred');
    const self = await fin.post(`${base(pid)}/transfers/${rep.id}/verify`, { expectedVersion: v });
    expect(self.status).toBe(403);
    expect(await deniedCount(fin.userId, 'denied', 'carveout.verifyTransfer')).toBeGreaterThanOrEqual(1);
    d = await item(p.legal, pid, contractId);
    expect(d.transfer.economic).toBe('transferred_pending_evidence');
    const ok2 = await ok<{ transfer: { combined: string } }>(p.legal.post(`${base(pid)}/transfers/${rep.id}/verify`, { expectedVersion: d.version }));
    expect(ok2.transfer.combined).toBe('transferred_verified');
  });
});
