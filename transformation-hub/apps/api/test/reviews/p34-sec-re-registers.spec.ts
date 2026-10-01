import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { P, login, ok, setupJvProject, syntheticUser, DocClient, JvProject } from '../jv/jv-kit';
import { paper } from '../governance/gov-fixtures';

/**
 * Focused security RE-CHECK of the P3/P4 security fixes (docs/reviews/P3-P4-security-recheck.md) — record visibility of the
 * project-level registers (SEC-P34-12), the new P3/P4 routes (readiness rebind, cutover plan site, transfer not-applicable,
 * checklist "not required" decide) for authorization, 404-vs-403 and the audit of denied attempts, and the consent / TSA charge
 * fixes seen by a workstream-only reader. Written by the security-privacy-reviewer; no implementation file and no existing
 * test was changed. Kinds of test (review-common.md):
 *  - `DEFECT <ID>` asserts the REQUIRED behaviour with `it.fails` (green while open, red once fixed — then rename it
 *    "(fixed, regression)" and make it a plain `it`; never weaken the assertion);
 *  - `OBSERVED <ID>` pins current behaviour that is not a defect; `CONTROL` confirms a control the re-check relies on.
 * One JV test project (jv-kit), synthetic data only. `wsl` = tech.lead holding ONLY `workstream_lead` on the first workstream
 * (a workstream-only principal). The owner pool creates a synthetic account (no provisioning API) and reads audit rows.
 */
let j: JvProject;
let pid: string;
let ws: string[];
let wsl: DocClient;
let auditor: DocClient;
let fapWs1: DocClient; // synthetic internal account: functional_approver on the FIRST workstream only (jv.cp.verify, carveout.transfer.verify…)
let pmB: DocClient;
const TAG = 'P34SRE';
const UNKNOWN = '0192f0c0-0000-7000-8000-00000000abcd';

beforeAll(async () => {
  j = await setupJvProject('P34SRE-REG');
  pid = j.projectId;
  wsl = j.gp.techLead as unknown as DocClient;
  ws = ((await j.p.pm.get(`${P(pid)}/workstreams`).expect(200)).body.items as { id: string }[]).map((w) => w.id);
  auditor = await login('auditor');
  pmB = await login('pm.b');
  // Owner pool: the synthetic account (no provisioning API); its workstream-scoped role goes through the portfolio API.
  fapWs1 = await syntheticUser(j.orgId, 'p34sre.fap.ws1', 'internal', 'confidential');
  const admin = await login('portfolio.admin');
  await ok(await admin.post(`${P(pid)}/members`, { userId: fapWs1.userId, role: 'functional_approver', workstreamId: ws[0], reason: 'P3/P4 security re-check probe (synthetic)' }));
  const scope = await owner().query(`select user_id, role, workstream_id from project_membership where project_id = $1 and user_id = any($2::uuid[]) and revoked_at is null order by role`, [pid, [wsl.userId, fapWs1.userId]]);
  expect(scope.rows.map((r) => [r.user_id === wsl.userId ? 'wsl' : 'fap', r.role, r.workstream_id])).toEqual(
    expect.arrayContaining([
      ['fap', 'functional_approver', ws[0]],
      ['wsl', 'workstream_lead', ws[0]],
    ]),
  );
  expect(scope.rows).toHaveLength(2);
}, 600_000);
afterAll(async () => {
  await closeApp();
  await closePools();
});

const feed = (c: DocClient, type: string, id: string) => c.get(`${P(pid)}/activity?entityType=${type}&entityId=${id}&pageSize=100`);

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-12 re-check — project-level registers in prerequisites, the activity feed and evidence targets', () => {
  let agreementId: string;
  let consentId: string;
  let requirementId: string;
  let decisionId: string;
  let taskId: string;

  beforeAll(async () => {
    agreementId = (await ok(await j.p.pm.post(`${P(pid)}/agreements`, { kindLabel: 'SPA', title: `${TAG}-AGR-CANARY transitional agreement (synthetic)`, ownerUserId: j.p.pm.userId }))).id;
    const item = await ok(await j.p.pm.post(`${P(pid)}/perimeter-items`, { type: 'contract', name: `${TAG} WS1 lease (synthetic)`, disposition: 'included', classification: 'confidential', workstreamId: ws[0] }));
    consentId = (await ok(await j.p.legal.post(`${P(pid)}/consents`, { perimeterItemId: item.id, counterparty: `${TAG}-CNS-CANARY Fictional Landlord`, classification: 'confidential' }))).id;
    requirementId = (await ok(await j.p.legal.post(`${P(pid)}/regulatory-requirements`, { category: 'regulatory', authority: 'Fictional regulator (synthetic)', title: `${TAG}-REQ-CANARY licence (synthetic)` }))).id;
    decisionId = (await ok(await j.p.pm.post(`${P(pid)}/decisions`, paper(j.gov.committeeId, { title: `${TAG}-DEC-CANARY paper (synthetic)` })))).id;
    taskId = (await ok(await j.p.pm.post(`${P(pid)}/tasks`, { workstreamId: ws[0], title: `${TAG} WS1 task waiting for registers (synthetic)` }))).id;
    for (const [predecessorType, predecessorId] of [
      ['agreement', agreementId],
      ['decision', decisionId],
    ] as const) {
      await ok(await j.p.pm.post(`${P(pid)}/prerequisites`, { successorType: 'task', successorId: taskId, predecessorType, predecessorId }));
    }
  }, 300_000);

  it('CONTROL: project-wide readers (PM, Legal) still see the agreement and decision as prerequisites; PM, Legal and the auditor see the four registers in the activity feed, with total = rows shown', async () => {
    for (const c of [j.p.pm, j.p.legal]) {
      const pre = (await c.get(`${P(pid)}/prerequisites?successorId=${taskId}`).expect(200)).body;
      expect(JSON.stringify(pre), c.persona).toContain('AGR-CANARY');
      expect(JSON.stringify(pre), c.persona).toContain('DEC-CANARY');
    }
    for (const c of [j.p.pm, j.p.legal, auditor]) {
      for (const [type, id] of [
        ['agreement', agreementId],
        ['consent', consentId],
        ['regulatory_requirement', requirementId],
        ['decision', decisionId],
      ] as const) {
        const f = (await feed(c, type, id).expect(200)).body;
        expect(f.total, `${c.persona} ${type}`).toBeGreaterThan(0);
        expect(f.items.length, `${c.persona} ${type}: total = rows shown`).toBe(f.total);
      }
    }
  });

  it('CONTROL: Legal (project-wide) reads the evidence of the agreement and the consent and links evidence to them (201) — the stricter rule did not hide them from their specialists', async () => {
    for (const [targetType, targetId] of [
      ['agreement', agreementId],
      ['consent', consentId],
    ] as const) {
      expect((await j.p.legal.get(`${P(pid)}/evidence?targetType=${targetType}&targetId=${targetId}`)).status, targetType).toBe(200);
      await ok(await j.p.legal.post(`${P(pid)}/evidence`, { targetType, targetId, note: `Evidence note on the ${targetType} (synthetic probe)` }));
    }
  });

  it('CONTROL: the workstream-only reader gets none of them — prerequisite labels hidden, activity total 0, evidence of the agreement / consent 404 like an unknown id', async () => {
    expect((await wsl.get(`${P(pid)}/tasks/${taskId}`)).status).toBe(200);
    const pre = (await wsl.get(`${P(pid)}/prerequisites?successorId=${taskId}`).expect(200)).body;
    expect(JSON.stringify(pre)).not.toMatch(/AGR-CANARY|DEC-CANARY/);
    for (const [type, id] of [
      ['agreement', agreementId],
      ['consent', consentId],
      ['regulatory_requirement', requirementId],
      ['decision', decisionId],
    ] as const) {
      const r = await feed(wsl, type, id);
      expect([200, 404], type).toContain(r.status);
      if (r.status === 200) expect(r.body.total, type).toBe(0);
    }
    for (const [targetType, targetId] of [
      ['agreement', agreementId],
      ['consent', consentId],
    ] as const) {
      const r = await wsl.get(`${P(pid)}/evidence?targetType=${targetType}&targetId=${targetId}`);
      const u = await wsl.get(`${P(pid)}/evidence?targetType=${targetType}&targetId=${UNKNOWN}`);
      expect(r.status, targetType).toBe(404);
      expect(u.status, targetType).toBe(404);
      expect(r.body.code).toBe(u.body.code);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34R-01 — other project-level registers stay visible in the activity feed of a workstream-only reader [access-matrix §2.2 strict rule, SEC-P34-12 residual]', () => {
  let entityId: string;

  beforeAll(async () => {
    // A category review (carve-out: shown only in the project-level reconciliation) and an update of the project's NewCo
    // legal entity (NewCo: project-wide read only) — both by the PM, through their APIs.
    await ok(await j.p.pm.post(`${P(pid)}/perimeter/categories/receivable/review`, { conclusion: `${TAG} no receivable transfers in scope (synthetic)` }));
    const ents = (await j.p.pm.get(`${P(pid)}/legal-entities`).expect(200)).body.items as { id: string; version: number }[];
    expect(ents.length).toBeGreaterThan(0);
    entityId = ents[0]!.id;
    await ok(await j.p.pm.patch(`${P(pid)}/legal-entities/${entityId}`, { expectedVersion: ents[0]!.version, jurisdiction: `${TAG} fictional jurisdiction (synthetic)` }), 200);
  }, 120_000);

  it('CONTROL: the owning modules refuse those registers to the workstream-only reader (404) and show them to the PM', async () => {
    expect((await wsl.get(`${P(pid)}/legal-entities/${entityId}`)).status).toBe(404);
    expect((await wsl.get(`${P(pid)}/legal-entities`)).status).toBe(404);
    expect((await wsl.get(`${P(pid)}/perimeter/reconciliation`)).status).toBe(404);
    expect((await wsl.get(`${P(pid)}/perimeter/versions`)).status).toBe(404);
    expect((await feed(j.p.pm, 'legal_entity', entityId).expect(200)).body.total).toBeGreaterThan(0);
    expect((await j.p.pm.get(`${P(pid)}/activity?entityType=perimeter_category_review&pageSize=100`).expect(200)).body.total).toBeGreaterThan(0);
  });

  it('SEC-P34R-01 (fixed, regression): the activity feed never lists legal-entity or perimeter category-review events to a reader the owning module refuses (total 0)', async () => {
    const le = (await feed(wsl, 'legal_entity', entityId).expect(200)).body;
    const cr = (await wsl.get(`${P(pid)}/activity?entityType=perimeter_category_review&pageSize=100`).expect(200)).body;
    console.log(`SEC-P34R-01 observed: workstream-only reader — legal_entity events ${le.total} ${JSON.stringify(le.items.map((x: { action: string }) => x.action))}; category-review events ${cr.total} ${JSON.stringify(cr.items.map((x: { action: string }) => x.action))}`);
    expect(le.total).toBe(0);
    expect(cr.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('New P3/P4 routes — authorization, 404 vs 403, audit of denied attempts', () => {
  let siteId: string;
  let ws2Check: { id: string; version: number };
  let ws2Plan: { id: string; version: number };
  let ws2Item: { id: string; version: number };
  let itemId: string; // a JV closing checklist item with a pending "not required" request by the PM

  beforeAll(async () => {
    siteId = (await ok(await j.p.pm.post(`${P(pid)}/sites`, { name: `${TAG} site (synthetic)` }))).id;
    const c = await ok(await j.p.pm.post(`${P(pid)}/readiness-checks`, { area: 'noc', title: `${TAG} WS2 NOC check (synthetic)`, workstreamId: ws[1], siteId, signoffRole: 'functional_approver' }));
    ws2Check = { id: c.id, version: c.version };
    const pl = await ok(await j.p.pm.post(`${P(pid)}/cutover-plans`, { title: `${TAG} WS2 transition plan (synthetic)`, workstreamId: ws[1], siteId }));
    ws2Plan = { id: pl.id, version: pl.version ?? 1 };
    const it0 = await ok(await j.p.pm.post(`${P(pid)}/perimeter-items`, { type: 'contract', name: `${TAG} WS2 support contract (synthetic)`, disposition: 'included', classification: 'confidential', workstreamId: ws[1] }));
    ws2Item = { id: it0.id, version: it0.version ?? 1 };
    const s = await ok(await j.p.pm.post(`${P(pid)}/signings`, { name: `${TAG} signing (synthetic)` }));
    itemId = (await ok(await j.p.pm.post(`${P(pid)}/checklist-items`, { eventId: s.id, title: `${TAG} side letter (synthetic)` }))).id;
    await ok(await j.p.pm.post(`${P(pid)}/checklist-items/${itemId}/not-required`, { expectedVersion: 1, reason: `${TAG} not needed (synthetic)` }));
  }, 300_000);

  it('CONTROL: the WS1 lead and the WS1 functional approver cannot read the WS2 check / plan / item (GET 404); the WS1 approver cannot read JV records', async () => {
    expect((await wsl.get(`${P(pid)}/readiness-checks/${ws2Check.id}`)).status).toBe(404);
    expect((await wsl.get(`${P(pid)}/cutover-plans/${ws2Plan.id}`)).status).toBe(404);
    expect((await fapWs1.get(`${P(pid)}/perimeter-items/${ws2Item.id}`)).status).toBe(404);
    const sg = await fapWs1.get(`${P(pid)}/signings`);
    expect([403, 404]).toContain(sg.status);
  });

  it('SEC-P34R-02 (fixed, regression): rebind — a WS2 check the WS1 lead cannot read answers 404 like an unknown id (no existence oracle)', async () => {
    const body = { expectedVersion: ws2Check.version, siteId: null, reason: 'Probe (synthetic)' };
    const existing = await wsl.post(`${P(pid)}/readiness-checks/${ws2Check.id}/rebind`, body);
    const unknown = await wsl.post(`${P(pid)}/readiness-checks/${UNKNOWN}/rebind`, body);
    console.log(`SEC-P34R-02 observed (rebind): unreadable existing check → ${existing.status} ${existing.body.code}; unknown id → ${unknown.status} ${unknown.body.code}`);
    expect(unknown.status).toBe(404);
    expect(existing.status).toBe(404);
    expect(existing.body.code).toBe(unknown.body.code);
  });

  it('SEC-P34R-02 (fixed, regression): site change — a WS2 plan the WS1 lead cannot read answers 404 like an unknown id', async () => {
    const body = { expectedVersion: ws2Plan.version, siteId: null, reason: 'Probe (synthetic)' };
    const existing = await wsl.post(`${P(pid)}/cutover-plans/${ws2Plan.id}/site`, body);
    const unknown = await wsl.post(`${P(pid)}/cutover-plans/${UNKNOWN}/site`, body);
    console.log(`SEC-P34R-02 observed (plan site): unreadable existing plan → ${existing.status} ${existing.body.code}; unknown id → ${unknown.status} ${unknown.body.code}`);
    expect(unknown.status).toBe(404);
    expect(existing.status).toBe(404);
  });

  it('SEC-P34R-02 (fixed, regression): not-required decide — a checklist item the workstream-scoped approver cannot read (no jv.deal.read) answers 404 like an unknown id', async () => {
    const existing = await fapWs1.post(`${P(pid)}/checklist-items/${itemId}/not-required/decide`, { expectedVersion: 1, decision: 'confirm' });
    const unknown = await fapWs1.post(`${P(pid)}/checklist-items/${UNKNOWN}/not-required/decide`, { expectedVersion: 1, decision: 'confirm' });
    console.log(`SEC-P34R-02 observed (decide): unreadable existing item → ${existing.status} ${existing.body.code}; unknown id → ${unknown.status} ${unknown.body.code}`);
    const row = (await owner().query(`select status, version from closing_deliverable where id = $1`, [itemId])).rows[0];
    expect(row).toEqual({ status: 'pending', version: 1 }); // never changed, whatever the answer
    expect(unknown.status).toBe(404);
    expect(existing.status).toBe(404);
  });

  it('CONTROL: transfer not-applicable — unreadable item 404 like unknown (WS1 approver on a WS2 item); no permission 403; Project B 404; the item is unchanged', async () => {
    const body = { expectedVersion: ws2Item.version, aspect: 'legal', basis: 'Probe (synthetic)' };
    const unread = await fapWs1.post(`${P(pid)}/perimeter-items/${ws2Item.id}/transfer-not-applicable`, body);
    const unknown = await fapWs1.post(`${P(pid)}/perimeter-items/${UNKNOWN}/transfer-not-applicable`, body);
    expect(unread.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(unread.body.code).toBe(unknown.body.code);
    expect((await j.p.contributor.post(`${P(pid)}/perimeter-items/${ws2Item.id}/transfer-not-applicable`, body)).status).toBe(403);
    expect((await pmB.post(`${P(pid)}/perimeter-items/${ws2Item.id}/transfer-not-applicable`, body)).status).toBe(404);
    const row = (await owner().query(`select transfer_status, economic_transfer_status, version from perimeter_item where id = $1`, [ws2Item.id])).rows[0];
    expect(row.version).toBe(ws2Item.version);
    expect(row.transfer_status).not.toBe('not_applicable');
  });

  it('CONTROL: denied attempts on the new routes are audited with outcome denied (rebind by a contributor without own_workstream, decide without jv.cp.verify and by the requester, site change by a Project-B PM)', async () => {
    const since = new Date(Date.now() - 1000).toISOString();
    expect((await j.p.contributor.post(`${P(pid)}/readiness-checks/${ws2Check.id}/rebind`, { expectedVersion: ws2Check.version, siteId: null, reason: 'Probe (synthetic)' })).status).toBe(403);
    // The PM requested "not required" and lacks jv.cp.verify (route-level 403). Legal requests on a second item and is then
    // refused as the requester (service-level 403 jv.checklist_item.not_required_self).
    expect((await j.p.pm.post(`${P(pid)}/checklist-items/${itemId}/not-required/decide`, { expectedVersion: 1, decision: 'confirm' })).status).toBe(403);
    const s2 = await ok(await j.p.pm.post(`${P(pid)}/signings`, { name: `${TAG} second signing (synthetic)` }));
    const item2 = (await ok(await j.p.legal.post(`${P(pid)}/checklist-items`, { eventId: s2.id, title: `${TAG} board minute (synthetic)` }))).id;
    await ok(await j.p.legal.post(`${P(pid)}/checklist-items/${item2}/not-required`, { expectedVersion: 1, reason: `${TAG} covered elsewhere (synthetic)` }));
    const self = await j.p.legal.post(`${P(pid)}/checklist-items/${item2}/not-required/decide`, { expectedVersion: 1, decision: 'confirm' });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('jv.checklist_item.not_required_self');
    expect((await pmB.post(`${P(pid)}/cutover-plans/${ws2Plan.id}/site`, { expectedVersion: ws2Plan.version, siteId: null, reason: 'Probe (synthetic)' })).status).toBe(404);
    const rows = await owner().query(
      `select actor_user_id, action, outcome, project_id, after from audit_event where created_at >= $1 and outcome = 'denied' and action = any($2::text[]) order by seq`,
      [since, ['readiness.rebindCheck', 'jv.decideChecklistItemNotRequired', 'readiness.changeCutoverPlanSite']],
    );
    const who = (id: string) => (id === j.p.contributor.userId ? 'contributor' : id === j.p.pm.userId ? 'pm' : id === pmB.userId ? 'pm.b' : id === j.p.legal.userId ? 'other' : `unexpected:${id}`);
    const got = rows.rows.map((r) => [r.action, who(r.actor_user_id)]);
    expect(got).toEqual(
      expect.arrayContaining([
        ['readiness.rebindCheck', 'contributor'],
        ['jv.decideChecklistItemNotRequired', 'pm'],
        ['jv.decideChecklistItemNotRequired', 'other'], // Legal, the requester
        ['readiness.changeCutoverPlanSite', 'pm.b'],
      ]),
    );
    // The out-of-scope attempt records the probed project and record ids (SEC-P1R-06), not a project row of Project A.
    const b = rows.rows.find((r) => r.action === 'readiness.changeCutoverPlanSite' && r.actor_user_id === pmB.userId);
    expect(b.project_id).toBeNull();
    expect(JSON.stringify(b.after)).toContain(ws2Plan.id);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-06 / SEC-P34-07 re-check — the workstream-only reader', () => {
  it('CONTROL: the WS1 lead reads a WS1 perimeter item without its consents (no project-wide carve-out grant); the WS1 TSA charge is shown (finance reach covers WS1), a WS2 TSA is not readable at all', async () => {
    const item = await ok(await j.p.pm.post(`${P(pid)}/perimeter-items`, { type: 'contract', name: `${TAG} WS1 maintenance contract (synthetic)`, disposition: 'included', classification: 'confidential', workstreamId: ws[0] }));
    await ok(await j.p.legal.post(`${P(pid)}/consents`, { perimeterItemId: item.id, counterparty: `${TAG}-WS1-CNS-CANARY Fictional Vendor`, classification: 'confidential' }));
    const seen = (await wsl.get(`${P(pid)}/perimeter-items/${item.id}`).expect(200)).body;
    expect(JSON.stringify(seen)).not.toContain('WS1-CNS-CANARY');
    expect((await j.p.pm.get(`${P(pid)}/perimeter-items/${item.id}`).expect(200)).body.consents.map((c: { counterparty: string }) => c.counterparty)).toEqual([`${TAG}-WS1-CNS-CANARY Fictional Vendor`]);
    const day1 = (await wsl.get(`${P(pid)}/perimeter/day1-contract-positions`)).body;
    expect(JSON.stringify(day1)).not.toContain('WS1-CNS-CANARY');

    const charge = { amount: '1234.0000', currency: 'SAR', unitScale: 1 };
    const t1 = await ok(await j.p.pm.post(`${P(pid)}/tsa-services`, { name: `${TAG} WS1 charged TSA (synthetic)`, workstreamId: ws[0], chargeBasis: 'Monthly fee (synthetic)', charge }));
    const t2 = await ok(await j.p.pm.post(`${P(pid)}/tsa-services`, { name: `${TAG} WS2 charged TSA (synthetic)`, workstreamId: ws[1], chargeBasis: 'Monthly fee (synthetic)', charge }));
    const mine = (await wsl.get(`${P(pid)}/tsa-services/${t1.id}`).expect(200)).body;
    expect(mine.charge).toEqual(charge);
    expect((await wsl.get(`${P(pid)}/tsa-services/${t2.id}`)).status).toBe(404);
    const list = (await wsl.get(`${P(pid)}/tsa-services?pageSize=100`).expect(200)).body;
    expect(JSON.stringify(list)).not.toContain(t2.id);
    expect(JSON.stringify(list)).not.toContain('1234.0000'); // the list never carries a charge
  });
});
