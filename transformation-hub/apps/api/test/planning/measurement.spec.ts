import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, loginAs, owner, Client } from '../helpers';
import { addDays, addEvidence, auditCount, createProject, grant, riyadhToday, task, workstreams } from './fixtures';

/** Measurement rules 1–8 (spec §9): weighted progress, RAG, overrides, periodic updates. */
let admin: Client;
let pm: Client;
let sponsor: Client;
let contributor: Client;
let approver: Client;
let secretary: Client;
let pid: string;
let ws: Map<string, { id: string; version: number }>;
const today = riyadhToday();

type WsHealth = { id: string; code: string; rag: { calculated: { status: string; explanation: string }; effective: string; overridden: boolean }; progress: { percent: number | null; denominatorWeight: number; numeratorWeight: number; includedCount: number; exclusions: { id: string; reason: string }[] }; openBlockers: { id: string }[] };
const health = async () => (await pm.get(`/api/v1/projects/${pid}/progress`).expect(200)).body as { project: { aggregate: { status: string }; redCritical: { id: string; reason: string }[]; dataQualityIssues: { id: string }[]; progress: { percent: number | null } }; workstreams: WsHealth[] };
const wsHealth = async (code: string) => (await health()).workstreams.find((w) => w.code === code)!;

beforeAll(async () => {
  admin = await loginAs('portfolio.admin');
  pm = await loginAs('pm');
  sponsor = await loginAs('sponsor');
  contributor = await loginAs('contributor');
  approver = await loginAs('approver');
  secretary = await loginAs('secretary');
  pid = await createProject(admin, pm, 'MEAS-P');
  await grant(admin, pid, sponsor, 'sponsor');
  await grant(pm, pid, contributor, 'contributor');
  await grant(pm, pid, approver, 'functional_approver');
  await grant(pm, pid, secretary, 'secretary_cpmo');
  ws = await workstreams(pm, pid);
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('Weighted progress on approved deliverable weights [REQ-PLN-016, REQ-PLN-017]', () => {
  const d: Record<string, { id: string }> = {};

  it('unapproved weights are excluded with a reason; approval needs baseline authority', async () => {
    const w5 = ws.get('WS05')!.id;
    for (const [k, weight] of [['D1', 5], ['D2', 3], ['D3', 2]] as const) {
      const r = await pm.post(`/api/v1/projects/${pid}/deliverables`, { workstreamId: w5, title: `Weighted ${k}`, weight });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      d[k] = r.body;
    }
    const h = await wsHealth('WS05');
    expect(h.progress.percent).toBeNull();
    expect(h.progress.denominatorWeight).toBe(0);
    expect(h.progress.exclusions.find((e) => e.id === d.D1!.id)!.reason).toMatch(/not approved/);
    // A PM cannot approve the weights (baseline-approval authority is required).
    expect((await pm.post(`/api/v1/projects/${pid}/deliverables/weights/approve`, { items: [{ id: d.D1!.id, expectedVersion: 1 }] })).status).toBe(403);
    const ok = await sponsor.post(`/api/v1/projects/${pid}/deliverables/weights/approve`, { items: ['D1', 'D2', 'D3'].map((k) => ({ id: d[k]!.id, expectedVersion: 1 })) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.approved).toBe(3);
  });

  it('only accepted (evidence-verified) deliverables count; a cancelled one is excluded, never complete', async () => {
    await pm.post(`/api/v1/projects/${pid}/deliverables/${d.D3!.id}/cancel`, { expectedVersion: 2, reason: 'Descoped (test)' }).expect(201);
    await pm.post(`/api/v1/projects/${pid}/deliverables/${d.D1!.id}/start`, { expectedVersion: 2 }).expect(201);
    await pm.post(`/api/v1/projects/${pid}/deliverables/${d.D1!.id}/submit`, { expectedVersion: 3 }).expect(201);
    const noEvidence = await approver.post(`/api/v1/projects/${pid}/deliverables/${d.D1!.id}/accept`, { expectedVersion: 4 });
    expect(noEvidence.status).toBe(422);
    expect(noEvidence.body.code).toBe('deliverable.evidence_required');
    await addEvidence(pid, 'deliverable', d.D1!.id, pm.userId);
    await approver.post(`/api/v1/projects/${pid}/deliverables/${d.D1!.id}/accept`, { expectedVersion: 4 }).expect(201);

    const h = await wsHealth('WS05');
    expect(h.progress.denominatorWeight).toBe(8); // 5 + 3; the cancelled 2 is not in the denominator
    expect(h.progress.numeratorWeight).toBe(5);
    expect(h.progress.includedCount).toBe(2);
    expect(h.progress.percent).toBe(62.5); // weighted — not 50 % (1 of 2 by count)
    expect(h.progress.exclusions.find((e) => e.id === d.D3!.id)!.reason).toMatch(/Cancelled/);
  });

  it('changing a weight withdraws its approval; the person who set a weight cannot approve it', async () => {
    const cur = (await pm.get(`/api/v1/projects/${pid}/deliverables/${d.D2!.id}`).expect(200)).body;
    await pm.patch(`/api/v1/projects/${pid}/deliverables/${d.D2!.id}`, { expectedVersion: cur.version, weight: 7 }).expect(200);
    const h = await wsHealth('WS05');
    expect(h.progress.denominatorWeight).toBe(5);
    expect(h.progress.exclusions.find((e) => e.id === d.D2!.id)!.reason).toMatch(/not approved/);
    await grant(admin, pid, pm, 'sponsor');
    const self = await pm.post(`/api/v1/projects/${pid}/deliverables/weights/approve`, { items: [{ id: d.D2!.id, expectedVersion: cur.version + 1 }] });
    expect(self.status).toBe(403);
    expect(self.body.detail).toMatch(/Separation of duties/);
  });
});

describe('RAG: stale never green, blockers red, worst-of aggregation [REQ-PLN-018, REQ-PLN-019, REQ-PLN-020, REQ-PLN-015, REQ-PLN-022]', () => {
  let upd1: string;

  it('a baselined, fresh, on-plan workstream is green', async () => {
    await task(pm, pid, ws.get('WS01')!.id, 'RAG dated task', { durationDays: 5, plannedStart: '2026-10-04', plannedFinish: '2026-10-08' });
    const b = await pm.post(`/api/v1/projects/${pid}/baselines`, {}).expect(201);
    await sponsor.post(`/api/v1/projects/${pid}/baselines/${b.body.id}/approve`, { expectedVersion: 1 }).expect(201);
    const u = await contributor.post(`/api/v1/projects/${pid}/status-updates`, { workstreamId: ws.get('WS01')!.id, periodEnd: today, summary: 'On plan (test)', ragReported: 'green' });
    expect(u.status, JSON.stringify(u.body)).toBe(201);
    upd1 = u.body.id;
    await contributor.post(`/api/v1/projects/${pid}/status-updates/${upd1}/submit`, { expectedVersion: 1 }).expect(201);
    // The submitter cannot review their own update (not_self), even with a reviewer role.
    await grant(pm, pid, contributor, 'secretary_cpmo');
    const self = await contributor.post(`/api/v1/projects/${pid}/status-updates/${upd1}/accept`, { expectedVersion: 2 });
    expect(self.status).toBe(403);
    expect(await auditCount(contributor.userId, 'denied', 'planning.acceptStatusUpdate')).toBeGreaterThanOrEqual(1);
    const acc = await secretary.post(`/api/v1/projects/${pid}/status-updates/${upd1}/accept`, { expectedVersion: 2 });
    expect(acc.status, JSON.stringify(acc.body)).toBe(201);
    const h = await wsHealth('WS01');
    expect(h.rag.calculated.status).toBe('green');
    const frozen = (await pm.get(`/api/v1/projects/${pid}/status-updates/${upd1}`).expect(200)).body;
    expect(frozen).toMatchObject({ status: 'accepted', ragReported: 'green', ragCalculated: 'green' });
    expect(frozen.frozenSnapshot.rag.calculated.status).toBe('green');
    // Accepted updates are frozen.
    expect((await contributor.patch(`/api/v1/projects/${pid}/status-updates/${upd1}`, { expectedVersion: 3, summary: 'rewrite history' })).status).toBe(422);
  });

  it('an update older than the freshness window is Data stale — never green', async () => {
    const u = await contributor.post(`/api/v1/projects/${pid}/status-updates`, { workstreamId: ws.get('WS02')!.id, periodEnd: addDays(today, -30), summary: 'Old news (test)', ragReported: 'green' }).expect(201);
    await contributor.post(`/api/v1/projects/${pid}/status-updates/${u.body.id}/submit`, { expectedVersion: 1 }).expect(201);
    // Return requires a reason; the author can fix and resubmit.
    expect((await secretary.post(`/api/v1/projects/${pid}/status-updates/${u.body.id}/return`, { expectedVersion: 2 })).status).toBe(400);
    await secretary.post(`/api/v1/projects/${pid}/status-updates/${u.body.id}/return`, { expectedVersion: 2, reason: 'Add next steps' }).expect(201);
    await contributor.patch(`/api/v1/projects/${pid}/status-updates/${u.body.id}`, { expectedVersion: 3, nextSteps: 'Refresh the plan' }).expect(200);
    await contributor.post(`/api/v1/projects/${pid}/status-updates/${u.body.id}/submit`, { expectedVersion: 4 }).expect(201);
    await secretary.post(`/api/v1/projects/${pid}/status-updates/${u.body.id}/accept`, { expectedVersion: 5 }).expect(201);
    const h = await wsHealth('WS02');
    expect(h.rag.calculated.status).toBe('stale');
    expect(h.rag.effective).not.toBe('green');
    const u2 = (await pm.get(`/api/v1/projects/${pid}/status-updates/${u.body.id}`).expect(200)).body;
    expect(u2.ragReported).toBe('green');
    expect(u2.ragCalculated).toBe('stale'); // reported vs calculated shown side by side
    expect((await wsHealth('WS04')).rag.calculated.status).toBe('not_updated');
  });

  it('an open blocker makes the workstream red and the project red despite a green workstream', async () => {
    const t = await task(pm, pid, ws.get('WS03')!.id, 'Blocked task', { durationDays: 2 });
    await pm.post(`/api/v1/projects/${pid}/tasks/${t}/start`, { expectedVersion: 1 }).expect(201);
    expect((await pm.post(`/api/v1/projects/${pid}/tasks/${t}/block`, { expectedVersion: 2 })).status).toBe(400); // reason required
    await pm.post(`/api/v1/projects/${pid}/tasks/${t}/block`, { expectedVersion: 2, reason: 'Waiting for access (test)' }).expect(201);
    const all = await health();
    const w3 = all.workstreams.find((w) => w.code === 'WS03')!;
    expect(w3.rag.calculated.status).toBe('red');
    expect(w3.rag.calculated.explanation).toMatch(/blocker/);
    expect(w3.openBlockers.map((b) => b.id)).toEqual([t]);
    expect(all.workstreams.find((w) => w.code === 'WS01')!.rag.calculated.status).toBe('green');
    expect(all.project.aggregate.status).toBe('red');
    expect(all.project.redCritical.map((r) => r.id)).toContain(w3.id);
    expect(all.project.dataQualityIssues.map((i) => i.id)).toEqual(expect.arrayContaining([ws.get('WS02')!.id, ws.get('WS04')!.id]));
    // The frozen WS01 update is not recalculated by later changes (published history preserved).
    const frozen = (await pm.get(`/api/v1/projects/${pid}/status-updates/${upd1}`).expect(200)).body;
    expect(frozen.frozenSnapshot.rag.calculated.status).toBe('green');
  });
});

describe('Manual RAG override: reason, expiry, reviewer; calculated value retained [REQ-PLN-021]', () => {
  let ovId: string;

  it('validates expiry and allows one pending request per item', async () => {
    const w3 = ws.get('WS03')!.id;
    expect((await pm.post(`/api/v1/projects/${pid}/rag-overrides`, { entityType: 'workstream', entityId: w3, overrideStatus: 'amber', reason: 'x', expiresOn: addDays(today, -1) })).status).toBe(422);
    expect((await pm.post(`/api/v1/projects/${pid}/rag-overrides`, { entityType: 'workstream', entityId: w3, overrideStatus: 'amber', reason: 'x', expiresOn: addDays(today, 120) })).status).toBe(422);
    const r = await pm.post(`/api/v1/projects/${pid}/rag-overrides`, { entityType: 'workstream', entityId: w3, overrideStatus: 'amber', reason: 'Workaround agreed (test)', expiresOn: addDays(today, 10) });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    ovId = r.body.id;
    const dup = await pm.post(`/api/v1/projects/${pid}/rag-overrides`, { entityType: 'workstream', entityId: w3, overrideStatus: 'green', reason: 'again', expiresOn: addDays(today, 10) });
    expect(dup.status).toBe(409);
    const row = await owner().query(`select calculated_status from rag_override where id = $1`, [ovId]);
    expect(row.rows[0].calculated_status).toBe('red');
  });

  it('the requester cannot approve their own override; a reviewer can — the blocker still shows as red critical', async () => {
    await grant(admin, pid, pm, 'secretary_cpmo');
    const self = await pm.post(`/api/v1/projects/${pid}/rag-overrides/${ovId}/approve`, { expectedVersion: 1 });
    expect(self.status).toBe(403);
    await secretary.post(`/api/v1/projects/${pid}/rag-overrides/${ovId}/approve`, { expectedVersion: 1, note: 'ok (test)' }).expect(201);
    const all = await health();
    const w3 = all.workstreams.find((w) => w.code === 'WS03')!;
    expect(w3.rag.calculated.status).toBe('red'); // retained
    expect(w3.rag.effective).toBe('amber');
    expect(w3.rag.overridden).toBe(true);
    expect(all.project.aggregate.status).toBe('red');
    expect(all.project.redCritical.find((r) => r.id === w3.id)!.reason).toMatch(/does not hide the blocker/);
    const list = (await pm.get(`/api/v1/projects/${pid}/rag-overrides?state=approved`).expect(200)).body.items;
    expect(list[0]).toMatchObject({ id: ovId, state: 'approved', calculatedAtRequest: 'red', overrideStatus: 'amber' });
    expect((await secretary.post(`/api/v1/projects/${pid}/rag-overrides/${ovId}/reject`, { expectedVersion: 2, reason: 'late' })).status).toBe(422);
  });
});
