import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, loginAs, owner, projectIdByCode, Client } from '../helpers';
import { createProject, dep, milestone, task, workstreams } from './fixtures';

/**
 * AT-15 — a critical-path predecessor is delayed: reproducible, calendar-based impact with explicit assumptions and no
 * invented probability. Chain on a Sunday–Thursday calendar starting Sun 2026-10-04:
 *   A (5d) ─┐
 *           ├─► C (4d) ─► M (milestone)        critical path A → C → M, B has 2 days of float
 *   B (3d) ─┘
 */
let admin: Client;
let pm: Client;
let pid: string;
const ids: Record<string, string> = {};

function allKeys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (out.add(k), allKeys(x, out));
  return out;
}

beforeAll(async () => {
  admin = await loginAs('portfolio.admin');
  pm = await loginAs('pm');
  pid = await createProject(admin, pm, 'AT15-P');
  const ws = (await workstreams(pm, pid)).get('WS01')!.id;
  ids.A = await task(pm, pid, ws, 'AT-15 A — perimeter definition', { durationDays: 5 });
  ids.B = await task(pm, pid, ws, 'AT-15 B — legal assessment', { durationDays: 3 });
  ids.C = await task(pm, pid, ws, 'AT-15 C — agreements drafting', { durationDays: 4, gateKey: 'G3' });
  ids.M = await milestone(pm, pid, ws, 'AT-15 M — gate milestone', { gateKey: 'G3', isCritical: true });
  for (const [p, s] of [
    [{ id: ids.A }, { id: ids.C }],
    [{ id: ids.B }, { id: ids.C }],
    [{ id: ids.C }, { id: ids.M, type: 'milestone' as const }],
  ] as const) {
    const r = await dep(pm, pid, p, s);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  }
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('AT-15 — delay of a critical-path predecessor [REQ-PLN-024, REQ-PLN-023, REQ-PLN-008, REQ-PLN-010]', () => {
  it('computes critical path, float and finish on the working calendar (schedule-based forecast)', async () => {
    const s = (await pm.get(`/api/v1/projects/${pid}/schedule?targetNodeId=${ids.M}`).expect(200)).body;
    expect(s.label).toBe('Schedule-based forecast');
    expect(s.status).toBe('complete');
    expect(s.scope).toMatchObject({ kind: 'driving_network', nodeCount: 4 });
    expect(s.projectFinish).toBe('2026-10-14');
    expect(s.criticalPath.map((n: { id: string }) => n.id)).toEqual([ids.A, ids.C, ids.M]);
    const node = (id: string) => s.nodes.find((n: { id: string }) => n.id === id);
    expect(node(ids.A)).toMatchObject({ earlyStart: '2026-10-04', earlyFinish: '2026-10-08', totalFloatDays: 0, critical: true });
    expect(node(ids.B)).toMatchObject({ earlyFinish: '2026-10-06', totalFloatDays: 2, critical: false });
    expect(node(ids.C)).toMatchObject({ earlyStart: '2026-10-11', earlyFinish: '2026-10-14', critical: true });
    expect(s.assumptions.join(' ')).toMatch(/working days/);
  });

  it('delaying the critical predecessor A by 3 working days slips C, M and the finish by 3 working days', async () => {
    const body = { nodeId: ids.A, delayWorkingDays: 3, targetNodeId: ids.M };
    const r1 = await pm.post(`/api/v1/projects/${pid}/schedule/delay-impact`, body);
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    const d = r1.body;
    expect(d.label).toBe('Schedule-based forecast');
    expect(d.status).toBe('computed');
    expect(d.finishBeforeDelay).toBe('2026-10-14');
    // A: Sun 4 … Tue 13 Oct; C: Wed 14, Thu 15, Sun 18, Mon 19 → finish Mon 19 Oct (Fri/Sat are non-working).
    expect(d.forecastFinish).toBe('2026-10-19');
    expect(d.projectSlipWorkingDays).toBe(3);
    expect(d.affected.map((a: { id: string }) => a.id).sort()).toEqual([ids.A, ids.C, ids.M].sort());
    expect(d.affected.find((a: { id: string }) => a.id === ids.M)).toMatchObject({ earlyFinishBefore: '2026-10-14', earlyFinishAfter: '2026-10-19', slipWorkingDays: 3, critical: true });
    expect(d.affectedGateKeys).toEqual(['G3']);
    expect(d.assumptions.join(' ')).toMatch(/Delay applied as \+3 working day/);
    expect(d.assumptions.join(' ')).toMatch(/Deterministic/);
    // No invented probability / likelihood / confidence fields anywhere in the payload.
    expect([...allKeys(d)].filter((k) => /prob|likel|confid|chance|percent/i.test(k))).toEqual([]);

    // Reproducible: identical inputs → identical output.
    const r2 = await pm.post(`/api/v1/projects/${pid}/schedule/delay-impact`, body).expect(201);
    expect(r2.body).toEqual(d);
    // What-if only: nothing in the plan changed.
    const s = (await pm.get(`/api/v1/projects/${pid}/schedule?targetNodeId=${ids.M}`).expect(200)).body;
    expect(s.projectFinish).toBe('2026-10-14');
  });

  it('a delay within the float of a non-critical activity does not move the finish', async () => {
    const d = (await pm.post(`/api/v1/projects/${pid}/schedule/delay-impact`, { nodeId: ids.B, delayWorkingDays: 2, targetNodeId: ids.M }).expect(201)).body;
    expect(d.projectSlipWorkingDays).toBe(0);
    expect(d.forecastFinish).toBe('2026-10-14');
    expect(d.affected.map((a: { id: string }) => a.id)).toEqual([ids.B]);
  });

  it('corporate holidays on the project calendar shift the forecast (Asia/Riyadh Sun–Thu calendar)', async () => {
    const h = await pm.post(`/api/v1/projects/${pid}/calendar/holidays`, { date: '2026-10-12', name: 'Test holiday (synthetic)' });
    expect(h.status, JSON.stringify(h.body)).toBe(201);
    const s = (await pm.get(`/api/v1/projects/${pid}/schedule?targetNodeId=${ids.M}`).expect(200)).body;
    expect(s.calendar).toMatchObject({ timezone: 'Asia/Riyadh', workingDays: [0, 1, 2, 3, 4], holidays: 1 });
    expect(s.projectFinish).toBe('2026-10-15');
    await pm.post(`/api/v1/projects/${pid}/calendar/holidays/${h.body.id}/remove`, { reason: 'test cleanup' }).expect(201);
    expect((await pm.get(`/api/v1/projects/${pid}/schedule?targetNodeId=${ids.M}`).expect(200)).body.projectFinish).toBe('2026-10-14');
  });

  it('an owner-entered forecast finish on a critical task extends the schedule-based forecast', async () => {
    const t = (await pm.get(`/api/v1/projects/${pid}/tasks/${ids.C}`).expect(200)).body;
    await pm.post(`/api/v1/projects/${pid}/tasks/${ids.C}/progress`, { expectedVersion: t.version, reportedProgress: 10, forecastFinish: '2026-10-20' }).expect(201);
    const s = (await pm.get(`/api/v1/projects/${pid}/schedule?targetNodeId=${ids.M}`).expect(200)).body;
    expect(s.projectFinish).toBe('2026-10-20');
    const t2 = (await pm.get(`/api/v1/projects/${pid}/tasks/${ids.C}`).expect(200)).body;
    await pm.post(`/api/v1/projects/${pid}/tasks/${ids.C}/progress`, { expectedVersion: t2.version, reportedProgress: 10, forecastFinish: null }).expect(201);
  });

  it('the demo scenario shows the seeded forecast slip against baseline v1 on the WS02 driving network', async () => {
    const dcId = await projectIdByCode(DC);
    const m = await owner().query(`select id from milestone where project_id = $1 and code = 'WS02-A08'`, [dcId]);
    const s = (await pm.get(`/api/v1/projects/${dcId}/schedule?targetNodeId=${m.rows[0].id}`).expect(200)).body;
    expect(s.status).toBe('complete');
    const target = s.nodes.find((n: { id: string }) => n.id === m.rows[0].id);
    expect(target.baselineFinish).toBeTruthy();
    expect(target.earlyFinish > target.baselineFinish).toBe(true); // forecast later than baseline
    const slipTask = s.nodes.find((n: { code: string }) => n.code === 'WS02-A03');
    expect(slipTask.critical).toBe(true);
    const d = (await pm.post(`/api/v1/projects/${dcId}/schedule/delay-impact`, { nodeId: slipTask.id, delayWorkingDays: 5, targetNodeId: m.rows[0].id }).expect(201)).body;
    expect(d.status).toBe('computed');
    expect(d.projectSlipWorkingDays).toBe(5);
  });

  it('rejects delay analysis for activities of another project (404, no leak)', async () => {
    const dcId = await projectIdByCode(DC);
    const other = await owner().query(`select id from task where project_id = $1 limit 1`, [dcId]);
    const r = await pm.post(`/api/v1/projects/${pid}/schedule/delay-impact`, { nodeId: other.rows[0].id, delayWorkingDays: 2 });
    expect(r.status).toBe(404);
    const pmB = await loginAs('pm.b');
    expect((await pmB.post(`/api/v1/projects/${pid}/schedule/delay-impact`, { nodeId: ids.A, delayWorkingDays: 2 })).status).toBe(404);
  });
});
