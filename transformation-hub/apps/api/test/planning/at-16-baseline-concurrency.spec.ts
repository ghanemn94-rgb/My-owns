import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, loginAs, owner, Client } from '../helpers';
import { auditCount, createProject, grant, task, workstreams } from './fixtures';

/**
 * AT-16 — concurrent baseline/approval changes: no lost updates; a conflicting request must reload and review.
 * Also covers re-baselining through an approved change request (spec §9, §14 proposeBaselineChange, AT-07 CR side).
 */
let admin: Client;
let pm: Client;
let sponsor: Client;
let chair: Client;
let pid: string;
let ws1: string;
let t1: string;

beforeAll(async () => {
  admin = await loginAs('portfolio.admin');
  pm = await loginAs('pm');
  sponsor = await loginAs('sponsor');
  chair = await loginAs('chair');
  pid = await createProject(admin, pm, 'AT16-P');
  // Two independent people with baseline-approval authority in this project.
  await grant(admin, pid, sponsor, 'sponsor');
  await grant(admin, pid, chair, 'sponsor');
  const ws = await workstreams(pm, pid);
  ws1 = ws.get('WS01')!.id;
  t1 = await task(pm, pid, ws1, 'AT-16 dated task', { durationDays: 5, plannedStart: '2026-10-04', plannedFinish: '2026-10-08' });
  await pm.post(`/api/v1/projects/${pid}/workstreams/${ws1}/tasks/activate`, { note: 'test' }).expect(201);
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('AT-16 — concurrent baseline approvals and stale versions [REQ-PLN-004, REQ-PLN-013]', () => {
  let b1: { id: string; version: number; snapshotHash: string };

  it('a PM proposes baseline v1 with a frozen snapshot and hash; only one proposal can be pending', async () => {
    const r = await pm.post(`/api/v1/projects/${pid}/baselines`, { note: 'AT-16 v1' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ versionNo: 1, status: 'proposed', version: 1 });
    expect(r.body.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
    b1 = r.body;
    const dup = await pm.post(`/api/v1/projects/${pid}/baselines`, {});
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('baseline.proposal_pending');
    const detail = (await pm.get(`/api/v1/projects/${pid}/baselines/${b1.id}`).expect(200)).body;
    const frozen = detail.snapshot.tasks.find((t: { id: string }) => t.id === t1);
    expect(frozen).toMatchObject({ plannedStart: '2026-10-04', plannedFinish: '2026-10-08', durationDays: 5 });
    // Draft (unconfirmed) template activities are not part of the committed baseline.
    const drafts = await owner().query(`select id from task where project_id = $1 and status = 'draft'`, [pid]);
    expect(detail.snapshot.tasks.some((t: { id: string }) => drafts.rows.some((d) => d.id === t.id))).toBe(false);
    // Budget stays restricted for a PM without finance read access.
    expect(detail.snapshot.budget.restricted).toBe(true);
  });

  it('the proposer cannot approve their own baseline (not_self) and the attempt is audited as denied', async () => {
    await grant(admin, pid, pm, 'sponsor').catch(() => undefined);
    const before = await auditCount(pm.userId, 'denied', 'planning.approveBaseline');
    const r = await pm.post(`/api/v1/projects/${pid}/baselines/${b1.id}/approve`, { expectedVersion: 1 });
    expect(r.status).toBe(403);
    expect(r.body.detail).toMatch(/Separation of duties/);
    expect(await auditCount(pm.userId, 'denied', 'planning.approveBaseline')).toBe(before + 1);
  });

  it('two approvers with the same expectedVersion: exactly one succeeds, the other gets 409 and nothing is lost', async () => {
    const [a, b] = await Promise.all([
      sponsor.post(`/api/v1/projects/${pid}/baselines/${b1.id}/approve`, { expectedVersion: 1, note: 'sponsor approval' }),
      chair.post(`/api/v1/projects/${pid}/baselines/${b1.id}/approve`, { expectedVersion: 1, note: 'second approval' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    const loserClient = a.status === 409 ? sponsor : chair;
    const winnerClient = a.status === 409 ? chair : sponsor;
    expect(loser.body.code).toBe('concurrency.version_mismatch');
    const row = await owner().query(`select status, approved_by, version from baseline_version where id = $1`, [b1.id]);
    expect(row.rows[0]).toMatchObject({ status: 'approved', approved_by: winnerClient.userId, version: 2 });
    const approvals = await owner().query(`select count(*)::int n from audit_event where entity_id = $1 and action = 'planning.baseline.approve' and outcome = 'success'`, [b1.id]);
    expect(approvals.rows[0].n).toBe(1);
    expect(await auditCount(loserClient.userId, 'rejected', 'planning.approveBaseline')).toBeGreaterThanOrEqual(1);
    const cur = (await pm.get(`/api/v1/projects/${pid}/baselines/current`).expect(200)).body;
    expect(cur.baseline).toMatchObject({ id: b1.id, status: 'approved', versionNo: 1 });
    expect(Array.isArray(cur.perimeterItemIds)).toBe(true);
  });

  it('a stale task update is rejected with 409 and the first writer wins', async () => {
    const v = (await pm.get(`/api/v1/projects/${pid}/tasks/${t1}`).expect(200)).body.version;
    await pm.patch(`/api/v1/projects/${pid}/tasks/${t1}`, { expectedVersion: v, title: 'first writer' }).expect(200);
    const stale = await pm.patch(`/api/v1/projects/${pid}/tasks/${t1}`, { expectedVersion: v, title: 'second writer (stale)' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('concurrency.version_mismatch');
    expect((await pm.get(`/api/v1/projects/${pid}/tasks/${t1}`).expect(200)).body.title).toBe('first writer');
  });

  it('re-baselining after approval requires an approved change request; the previous baseline is preserved (superseded)', async () => {
    const direct = await pm.post(`/api/v1/projects/${pid}/baselines`, {});
    expect(direct.status).toBe(422);
    expect(direct.body.code).toBe('baseline.change_request_required');

    // Change request: draft → submitted → under review (assessed) → approved by someone other than the requester.
    const cr = await pm.post(`/api/v1/projects/${pid}/change-requests`, { title: 'Extend AT-16 task', rationale: 'Scope grew (test)', alternatives: ['Descope'], rebaseline: true });
    expect(cr.status, JSON.stringify(cr.body)).toBe(201);
    await pm.post(`/api/v1/projects/${pid}/change-requests/${cr.body.id}/submit`, { expectedVersion: 1 }).expect(201);
    await pm.post(`/api/v1/projects/${pid}/change-requests/${cr.body.id}/start-review`, { expectedVersion: 2 }).expect(201);
    const early = await sponsor.post(`/api/v1/projects/${pid}/change-requests/${cr.body.id}/approve`, { expectedVersion: 3 });
    expect(early.status).toBe(422);
    expect(early.body.code).toBe('change_request.impacts_missing');
    await pm.post(`/api/v1/projects/${pid}/change-requests/${cr.body.id}/assess`, { expectedVersion: 3, impacts: { time: '+5 working days on WS01 (test)', cost: 'None (test)' } }).expect(201);
    // The PM (who holds the sponsor role in this project) cannot approve their own request.
    const self = await pm.post(`/api/v1/projects/${pid}/change-requests/${cr.body.id}/approve`, { expectedVersion: 4 });
    expect(self.status).toBe(403);
    await sponsor.post(`/api/v1/projects/${pid}/change-requests/${cr.body.id}/approve`, { expectedVersion: 4, note: 'approved (test)' }).expect(201);
    const early2 = await pm.post(`/api/v1/projects/${pid}/change-requests/${cr.body.id}/mark-implemented`, { expectedVersion: 5 });
    expect(early2.status).toBe(422);
    expect(early2.body.code).toBe('change_request.rebaseline_missing');

    const v = (await pm.get(`/api/v1/projects/${pid}/tasks/${t1}`).expect(200)).body.version;
    await pm.patch(`/api/v1/projects/${pid}/tasks/${t1}`, { expectedVersion: v, durationDays: 10, plannedFinish: '2026-10-15' }).expect(200);
    const b2 = await pm.post(`/api/v1/projects/${pid}/baselines`, { changeRequestId: cr.body.id, note: 'v2 per CR' });
    expect(b2.status, JSON.stringify(b2.body)).toBe(201);
    expect(b2.body.versionNo).toBe(2);
    // A stale approval of v2 (wrong expectedVersion) is refused.
    expect((await chair.post(`/api/v1/projects/${pid}/baselines/${b2.body.id}/approve`, { expectedVersion: 7 })).status).toBe(409);
    await chair.post(`/api/v1/projects/${pid}/baselines/${b2.body.id}/approve`, { expectedVersion: 1 }).expect(201);

    const list = (await pm.get(`/api/v1/projects/${pid}/baselines`).expect(200)).body.items as { versionNo: number; status: string; changeRequestId: string | null }[];
    expect(list.map((b) => [b.versionNo, b.status])).toEqual([
      [2, 'approved'],
      [1, 'superseded'],
    ]);
    const v1 = (await pm.get(`/api/v1/projects/${pid}/baselines/${b1.id}`).expect(200)).body;
    expect(v1.snapshot.tasks.find((t: { id: string }) => t.id === t1).plannedFinish).toBe('2026-10-08'); // preserved
    await pm.post(`/api/v1/projects/${pid}/change-requests/${cr.body.id}/mark-implemented`, { expectedVersion: 5 }).expect(201);
    const crNow = (await pm.get(`/api/v1/projects/${pid}/change-requests/${cr.body.id}`).expect(200)).body;
    expect(crNow).toMatchObject({ status: 'implemented', linkedBaselineId: b2.body.id });
  });
});
