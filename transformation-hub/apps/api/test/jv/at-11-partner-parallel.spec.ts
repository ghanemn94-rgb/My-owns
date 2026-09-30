import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { gateByKey, runWorker } from '../gates/gate-test-kit';
import { P, doc, finalDecision, ok, partner, partnerAt, passG5, room, setupJvProject, JvProject } from './jv-kit';

/**
 * AT-11 — partner preparation runs in parallel with separation (REQ-LCY-008) while every step keeps its own
 * authorization (outreach approval, NDA, grants); signing and closing are separate events with their own checklists,
 * dependencies, CP sets, confirmations and statuses (REQ-LCY-009, REQ-JV-012); the engagement stage machine rejects
 * skipped stages (REQ-JV-003).
 */
let j: JvProject;
let pid: string;

beforeAll(async () => {
  j = await setupJvProject('JV-AT11');
  pid = j.projectId;
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

async function tasks(): Promise<Map<string, { id: string; code: string; gateKey: string | null }>> {
  const r = await owner().query<{ id: string; wbs_code: string; gate_key: string | null }>('select id, wbs_code, gate_key from task where project_id = $1', [pid]);
  return new Map(r.rows.map((t) => [t.wbs_code, { id: t.id, code: t.wbs_code, gateKey: t.gate_key }]));
}

describe('AT-11 — partner preparation and DD run in parallel with separation [AT-11, REQ-LCY-008, REQ-JV-003]', () => {
  it('REQ-LCY-008: G5 does not depend on G3/G4, and the DD tasks are schedulable before G3 unless an explicit dependency is configured', async () => {
    const g5 = await gateByKey(j.gp.pm, pid, 'G5');
    expect(g5).toBeTruthy();
    const g5Def = (await j.p.pm.get(`${P(pid)}/gates`).expect(200)).body.items.find((g: { key: string }) => g.key === 'G5');
    expect(g5Def.prerequisiteGateKeys).not.toContain('G3');
    expect(g5Def.prerequisiteGateKeys).not.toContain('G4');
    const t = await tasks();
    const dd = t.get('WS11-A09')!; // "Manage due diligence requests and Q&A"
    const network = async () => {
      const s = (await j.p.pm.get(`${P(pid)}/schedule?targetNodeId=${dd.id}`).expect(200)).body;
      expect(s.scope.kind).toBe('driving_network');
      return (s.nodes as { code: string }[]).map((n) => t.get(n.code)?.gateKey ?? null);
    };
    const before = await network();
    expect(before.length).toBeGreaterThan(1);
    expect(before.filter((g) => g === 'G3' || g === 'G4')).toEqual([]);
    // An explicit, authorized dependency is the only way to sequence DD after a separation (G3) activity.
    const g3Task = [...t.values()].find((x) => x.gateKey === 'G3')!;
    await ok(await j.p.pm.post(`${P(pid)}/dependencies`, { predecessorType: 'task', predecessorId: g3Task.id, successorType: 'task', successorId: t.get('WS11-A08')!.id, note: 'Test: explicit sequencing (synthetic)' }));
    expect(await network()).toContain('G3');
  });

  it('the partner process and DD proceed while separation gates are not approved — each step with its own authorization', async () => {
    const g3 = await gateByKey(j.gp.pm, pid, 'G3');
    expect(['approved', 'approved_with_exceptions']).not.toContain(g3.assessment.status);
    const id = await partnerAt(j, 'Parallel Partner (fictional)');
    let v = (await partner(j.p.pm, pid, id)).version;
    v = (await ok(await j.p.pm.post(`${P(pid)}/partners/${id}/advance`, { expectedVersion: v, toStage: 'dd' }))).version;
    const r = await room(j.p.pm, pid, { name: 'Parallel room (test)', type: 'partner', partnerId: id });
    const q = await ok(await j.p.pm.post(`${P(pid)}/diligence-requests`, { roomId: r.id, question: 'Parallel DD question (synthetic)', domain: 'technical' }));
    expect(q.number).toBe(1);
    expect((await partner(j.p.pm, pid, id)).stage).toBe('dd');
  });

  it('REQ-JV-003: the stage machine rejects skipped stages; NDA needs the outreach approval; approval stages need their own command', async () => {
    const id = await partnerAt(j, 'Skipping Partner (fictional)', 'identified');
    const v = (await partner(j.p.pm, pid, id)).version;
    for (const [to, code] of [
      ['dd', 'jv.partner.stage_skipped'],
      ['materials_access', 'jv.partner.nda_required'],
      ['nda', 'jv.partner.outreach_approval_required'],
      ['approved_for_contact', 'jv.partner.use_approval_command'],
      ['closing', 'jv.partner.signing_not_confirmed'],
    ] as const) {
      const r = await j.p.pm.post(`${P(pid)}/partners/${id}/advance`, { expectedVersion: v, toStage: to });
      expect(r.status, to).toBe(422);
      expect(r.body.code, to).toBe(code);
    }
    const nda = await doc(j.p.pm, pid, 'Premature NDA (synthetic)', { kind: 'agreement' });
    const sub = await j.p.pm.post(`${P(pid)}/partners/${id}/nda`, { expectedVersion: v, documentId: nda.id, executedOn: '2026-01-01' });
    expect(sub.status).toBe(422);
    expect(sub.body.code).toBe('jv.partner.outreach_approval_required');
    expect((await partner(j.p.pm, pid, id)).stage).toBe('identified');
    const audit = await owner().query(`select count(*)::int n from audit_event where project_id = $1 and action = 'jv.submitNda' and outcome = 'rejected'`, [pid]);
    expect(audit.rows[0].n).toBeGreaterThan(0); // rejected mutation logged
  });
});

describe('REQ-LCY-009 / REQ-JV-012 — signing is separate from closing; two closings with independent CP sets', () => {
  let signing: string;
  let c1: string;
  let c2: string;
  let partnerId: string;
  beforeAll(async () => {
    partnerId = await partnerAt(j, 'Signing Partner (fictional)');
    signing = (await ok(await j.p.pm.post(`${P(pid)}/signings`, { name: 'Test signing (synthetic)', partnerId }))).id;
    c1 = (await ok(await j.p.pm.post(`${P(pid)}/closings`, { signingId: signing, name: 'Closing #1 (synthetic)' }))).id;
    c2 = (await ok(await j.p.pm.post(`${P(pid)}/closings`, { signingId: signing, name: 'Closing #2 (synthetic)' }))).id;
  });

  it('UT: checklist items belong to exactly one of signing or closing', async () => {
    const item = await ok(await j.p.pm.post(`${P(pid)}/checklist-items`, { eventId: signing, title: 'Executed agreement (synthetic)' }));
    const sc = (await j.p.pm.get(`${P(pid)}/signings/${signing}/checklist`).expect(200)).body;
    expect(sc.items.map((x: { id: string }) => x.id)).toEqual([item.id]);
    expect((await j.p.pm.get(`${P(pid)}/closings/${c1}/checklist`).expect(200)).body.items).toEqual([]);
    // A signing is not a closing (and vice versa): the routes do not mix them.
    expect((await j.p.pm.get(`${P(pid)}/closings/${signing}`)).status).toBe(404);
    expect((await j.p.pm.get(`${P(pid)}/signings/${c1}`)).status).toBe(404);
    await expect(owner().query('update closing_deliverable set closing_id = $2 where id = $1', [item.id, c1])).rejects.toThrow(/immutable_event_link/);
    const cpOnSigning = await j.p.legal.post(`${P(pid)}/closing-conditions`, { closingId: signing, title: 'CP on a signing (probe)', ownerUserId: j.p.pm.userId });
    expect(cpOnSigning.status).toBe(422);
    expect(cpOnSigning.body.code).toBe('jv.cp.closing_only');
    const org = j.orgId;
    await expect(owner().query(`insert into closing_condition (org_id, project_id, closing_id, reference, title) values ($1,$2,$3,'PROBE-1','probe')`, [org, pid, signing])).rejects.toThrow(/invalid_event_kind/);
    await expect(owner().query(`insert into closing (org_id, project_id, kind, code, name, signing_id, sequence) values ($1,$2,'closing','PROBE-CLO','probe',$3, 99)`, [org, pid, c1])).rejects.toThrow(/invalid_event_kind/);
  });

  it('UT: two closings with independent CP sets and states; closing waits for its own signing', async () => {
    const cp1 = await ok(await j.p.legal.post(`${P(pid)}/closing-conditions`, { closingId: c1, title: 'CP of closing #1 (synthetic)', ownerUserId: j.p.pm.userId }));
    const cp2 = await ok(await j.p.legal.post(`${P(pid)}/closing-conditions`, { closingId: c2, title: 'CP of closing #2 (synthetic)', ownerUserId: j.p.pm.userId }));
    await ok(await j.p.pm.post(`${P(pid)}/evidence`, { targetType: 'closing_condition', targetId: cp1.id, note: 'Synthetic evidence (test)' }));
    await ok(await j.p.pm.post(`${P(pid)}/closing-conditions/${cp1.id}/submit-evidence`, { expectedVersion: 1 }));
    await ok(await j.p.legal.post(`${P(pid)}/closing-conditions/${cp1.id}/verify`, { expectedVersion: 2, outcome: 'verify' }));
    const d1 = (await j.p.pm.get(`${P(pid)}/closings/${c1}`).expect(200)).body;
    const d2 = (await j.p.pm.get(`${P(pid)}/closings/${c2}`).expect(200)).body;
    expect(d1.conditions.map((c: { reference: string; status: string }) => [c.reference, c.status])).toEqual([[cp1.code, 'verified']]);
    expect(d2.conditions.map((c: { reference: string; status: string }) => [c.reference, c.status])).toEqual([[cp2.code, 'open']]);
    expect(d1.blockers.map((b: { ref: string }) => b.ref)).not.toContain(cp2.code);
    expect(d2.blockers.map((b: { ref: string }) => b.ref)).toContain(cp2.code);
    // Both closings wait for their signing (not confirmed yet).
    for (const d of [d1, d2]) expect(d.blockers[0].messageI18n[0]).toMatchObject({ code: 'jv.closing.signing_not_confirmed' });
    const s = (await j.p.pm.get(`${P(pid)}/signings/${signing}`).expect(200)).body;
    expect(s.closings.map((c: { id: string }) => c.id).sort()).toEqual([c1, c2].sort());
    expect(s.conditions).toEqual([]);
  });

  it('UT: signing completion does not change closing status (signing is never mistaken for completion)', async () => {
    const pm = j.p.pm;
    const items = (await pm.get(`${P(pid)}/signings/${signing}/checklist`).expect(200)).body.items as { id: string; version: number }[];
    const executed = await doc(pm, pid, 'Executed SHA (synthetic)', { kind: 'agreement' });
    for (const it of items) {
      const dv = await ok(await pm.post(`${P(pid)}/checklist-items/${it.id}/deliver`, { expectedVersion: it.version, documentId: executed.id }));
      await ok(await j.p.legal.post(`${P(pid)}/checklist-items/${it.id}/accept`, { expectedVersion: dv.version }));
    }
    let sv = (await pm.get(`${P(pid)}/signings/${signing}`).expect(200)).body.version;
    sv = (await ok(await pm.post(`${P(pid)}/transaction-events/${signing}/transition`, { expectedVersion: sv, command: 'start_preparation' }))).version;
    sv = (await ok(await pm.post(`${P(pid)}/transaction-events/${signing}/transition`, { expectedVersion: sv, command: 'mark_ready' }))).version;
    // DOM-P4-02 (REQ-LCY-009 "signing and its dependencies"): a FINAL signing authorization alone records no signing while
    // gate G5 has not passed; the decision that approved G5 does — and G5 passes while separation (G3) is not approved.
    const early = await pm.post(`${P(pid)}/transaction-events/${signing}/request-confirmation`, { expectedVersion: sv, decisionId: await finalDecision(j, 'jv_signing_authorization'), executedDocumentId: executed.id });
    expect(early.status, JSON.stringify(early.body)).toBe(422);
    expect(early.body.code).toBe('jv.signing.g5_not_passed');
    const decisionId = await passG5(j);
    expect(['approved', 'approved_with_exceptions']).not.toContain((await gateByKey(j.gp.pm, pid, 'G3')).assessment.status);
    const req = await ok(await pm.post(`${P(pid)}/transaction-events/${signing}/request-confirmation`, { expectedVersion: sv, decisionId, executedDocumentId: executed.id }));
    const rec = await ok(await j.p.sponsor.post(`${P(pid)}/signings/${signing}/record`, { expectedVersion: req.version }));
    expect(rec.status).toBe('confirmed');
    for (const c of [c1, c2]) {
      const d = (await pm.get(`${P(pid)}/closings/${c}`).expect(200)).body;
      expect(d.status).toBe('planned');
      expect(d.confirmedAt).toBeNull();
      expect(d.blockers.some((b: { kind: string }) => b.kind === 'signing')).toBe(false);
    }
    // With the signing confirmed, the partner may move on to closing preparation (never before).
    let v = (await partner(pm, pid, partnerId)).version;
    for (const to of ['dd', 'proposal', 'negotiation', 'signing', 'closing']) v = (await ok(await pm.post(`${P(pid)}/partners/${partnerId}/advance`, { expectedVersion: v, toStage: to }))).version;
    expect((await partner(pm, pid, partnerId)).stage).toBe('closing');
    // The JV status dimension (owned by the gates module, recomputed from cp.changed): signed, not closed.
    await runWorker();
    const dims = (await pm.get(`${P(pid)}/status-dimensions`).expect(200)).body.items as { key: string; state: string }[];
    expect(dims.find((d) => d.key === 'jv_transaction')?.state).toBe('signed');
  });
});
