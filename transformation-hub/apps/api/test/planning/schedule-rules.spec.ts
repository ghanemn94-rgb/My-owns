import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, GEN, loginAs, owner, projectIdByCode, Client } from '../helpers';
import { auditCount, createProject, dep, grant, milestone, task, workstreams } from './fixtures';

let admin: Client;
let pm: Client;
let pid: string;
let ws: Map<string, { id: string; version: number }>;
const n = {} as Record<'A' | 'B' | 'C' | 'M', string>;

beforeAll(async () => {
  admin = await loginAs('portfolio.admin');
  pm = await loginAs('pm');
  pid = await createProject(admin, pm, 'SCHED-P');
  ws = await workstreams(pm, pid);
  const w = ws.get('WS02')!.id;
  n.A = await task(pm, pid, w, 'Sched A', { durationDays: 2 });
  n.B = await task(pm, pid, w, 'Sched B', { durationDays: 3 });
  n.C = await task(pm, pid, w, 'Sched C', { durationDays: 1 });
  n.M = await milestone(pm, pid, w, 'Sched M');
  expect((await dep(pm, pid, { id: n.A }, { id: n.B })).status).toBe(201);
  expect((await dep(pm, pid, { id: n.B }, { id: n.C })).status).toBe(201);
  expect((await dep(pm, pid, { id: n.C }, { id: n.M, type: 'milestone' }, { lagDays: 2 })).status).toBe(201);
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('Dependency graph rules [REQ-PLN-005, REQ-PLN-007]', () => {
  it('rejects a direct or transitive cycle with 422 and stores nothing', async () => {
    const before = await owner().query('select count(*)::int n from dependency where project_id = $1', [pid]);
    const direct = await dep(pm, pid, { id: n.B }, { id: n.A });
    expect(direct.status).toBe(422);
    expect(direct.body.code).toBe('dependency.cycle');
    const transitive = await dep(pm, pid, { id: n.M, type: 'milestone' }, { id: n.A });
    expect(transitive.status).toBe(422);
    expect(transitive.body.code).toBe('dependency.cycle');
    const self = await dep(pm, pid, { id: n.A }, { id: n.A });
    expect(self.status).toBe(422);
    const after = await owner().query('select count(*)::int n from dependency where project_id = $1', [pid]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    expect(await auditCount(pm.userId, 'rejected', 'planning.createDependency')).toBeGreaterThanOrEqual(3);
  });

  it('rejects SS, FF and SF as "not yet supported" (only FS is exposed until tested)', async () => {
    for (const type of ['SS', 'FF', 'SF']) {
      const r = await dep(pm, pid, { id: n.A }, { id: n.C }, { type });
      expect(r.status).toBe(422);
      expect(r.body.code).toBe('dependency.type_not_supported');
      expect(r.body.detail).toMatch(/not yet supported/);
    }
  });

  it('rejects duplicates and lists the graph with labels', async () => {
    expect((await dep(pm, pid, { id: n.A }, { id: n.B })).status).toBe(422);
    const g = (await pm.get(`/api/v1/projects/${pid}/dependencies?nodeId=${n.B}`).expect(200)).body.items;
    expect(g).toHaveLength(2);
    expect(g.every((d: { type: string }) => d.type === 'FS')).toBe(true);
    expect(g.map((d: { predecessorTitle: string }) => d.predecessorTitle)).toContain('Sched A');
  });

  it('never links records of another project (404 without leaking existence)', async () => {
    const genId = await projectIdByCode(GEN);
    const foreign = await owner().query('select id from task where project_id = $1 limit 1', [genId]);
    const r = await dep(pm, pid, { id: foreign.rows[0].id }, { id: n.A });
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toMatch(/Project B|DEMO-TRANSFORM/);
    const r2 = await pm.post(`/api/v1/projects/${pid}/schedule/delay-impact`, { nodeId: foreign.rows[0].id, delayWorkingDays: 1 });
    expect(r2.status).toBe(404);
  });

  it('a workstream lead may only add dependencies whose successor is in their own workstream', async () => {
    const lead = await loginAs('ops.lead');
    await pm.post(`/api/v1/projects/${pid}/members`, { userId: lead.userId, role: 'workstream_lead', workstreamId: ws.get('WS07')!.id, reason: 'test' }).expect(201);
    const own = await task(pm, pid, ws.get('WS07')!.id, 'WS07 task', { durationDays: 1 });
    expect((await dep(lead, pid, { id: n.C }, { id: own })).status).toBe(201);
    const other = await dep(lead, pid, { id: own }, { id: n.M, type: 'milestone' });
    expect(other.status).toBe(403);
  });
});

describe('Schedule completeness [REQ-PLN-008, REQ-PLN-009]', () => {
  it('lag is applied in working days on the FS link', async () => {
    const s = (await pm.get(`/api/v1/projects/${pid}/schedule?targetNodeId=${n.M}`).expect(200)).body;
    expect(s.status).toBe('complete');
    // A Sun 4–Mon 5, B Tue 6–Thu 8, C Sun 11; +2 working-day lag (Mon 12, Tue 13) → the milestone can start Wed 14.
    const m = s.nodes.find((x: { id: string }) => x.id === n.M);
    expect(s.nodes.find((x: { id: string }) => x.id === n.C).earlyFinish).toBe('2026-10-11');
    expect(m.earlyStart).toBe('2026-10-14');
  });

  it('a missing duration yields an Incomplete schedule listing the gap and no critical path', async () => {
    const d = await task(pm, pid, ws.get('WS02')!.id, 'Sched D — no duration');
    expect((await dep(pm, pid, { id: d }, { id: n.M, type: 'milestone' })).status).toBe(201);
    const s = (await pm.get(`/api/v1/projects/${pid}/schedule?targetNodeId=${n.M}`).expect(200)).body;
    expect(s.status).toBe('incomplete');
    expect(s.criticalPath).toBeNull();
    expect(s.projectFinish).toBeNull();
    const gap = s.issues.find((i: { code: string }) => i.code === 'missing_duration');
    expect(gap.nodeIds).toEqual([d]);
    expect(s.nodes.every((x: { earlyStart: string | null; critical: boolean | null }) => x.earlyStart === null && x.critical === null)).toBe(true);
    const di = (await pm.post(`/api/v1/projects/${pid}/schedule/delay-impact`, { nodeId: n.A, delayWorkingDays: 1, targetNodeId: n.M }).expect(201)).body;
    expect(di.status).toBe('incomplete');
    expect(di.projectSlipWorkingDays).toBeNull();
  });

  it('the whole template plan is Incomplete while TBD durations remain (no false precision)', async () => {
    const s = (await pm.get(`/api/v1/projects/${pid}/schedule`).expect(200)).body;
    expect(s.status).toBe('incomplete');
    expect(s.scope.kind).toBe('project');
    expect(s.issues.filter((i: { code: string }) => i.code === 'missing_duration').length).toBeGreaterThan(5);
    expect(s.nodes.some((x: { proposed: boolean }) => x.proposed)).toBe(true);
    expect(s.assumptions.join(' ')).toMatch(/Draft \(proposed/);
  });

  it('a project without a planned start cannot produce a schedule', async () => {
    const pid2 = await createProject(admin, pm, 'SCHED-NOSTART', null);
    const w = (await workstreams(pm, pid2)).get('WS01')!.id;
    const t = await task(pm, pid2, w, 'Lonely task', { durationDays: 3 });
    const s = (await pm.get(`/api/v1/projects/${pid2}/schedule?targetNodeId=${t}`).expect(200)).body;
    expect(s.status).toBe('incomplete');
    expect(s.issues[0].code).toBe('missing_project_start');
  });

  it('removing a dependency is audited and restores completeness', async () => {
    const g = (await pm.get(`/api/v1/projects/${pid}/dependencies?nodeId=${n.M}`).expect(200)).body.items as { id: string; predecessorTitle: string }[];
    const bad = g.find((x) => x.predecessorTitle === 'Sched D — no duration')!;
    await pm.post(`/api/v1/projects/${pid}/dependencies/${bad.id}/remove`, { reason: 'test' }).expect(201);
    expect((await pm.get(`/api/v1/projects/${pid}/schedule?targetNodeId=${n.M}`).expect(200)).body.status).toBe('complete');
    const a = await owner().query(`select count(*)::int n from audit_event where entity_id = $1 and action = 'planning.dependency.remove'`, [bad.id]);
    expect(a.rows[0].n).toBe(1);
  });

  it('a contributor without dependency rights cannot change the graph', async () => {
    const c = await loginAs('contributor');
    await grant(pm, pid, c, 'contributor');
    expect((await dep(c, pid, { id: n.A }, { id: n.C })).status).toBe(403);
  });
});
