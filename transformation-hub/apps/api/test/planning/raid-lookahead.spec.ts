import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, loginAs, owner, projectIdByCode, Client } from '../helpers';
import { addDays, createProject, grant, riyadhToday, task, workstreams } from './fixtures';

let admin: Client;
let pm: Client;
let contributor: Client;
let pid: string;
let ws: Map<string, { id: string; version: number }>;
const today = riyadhToday();

beforeAll(async () => {
  admin = await loginAs('portfolio.admin');
  pm = await loginAs('pm');
  contributor = await loginAs('contributor');
  pid = await createProject(admin, pm, 'RAID-P');
  await grant(pm, pid, contributor, 'contributor');
  ws = await workstreams(pm, pid);
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('RAID register [REQ-PLN-012]', () => {
  let riskId: string;

  it('scores exposure (probability × impact), keeps optional money exposure exact, and filters', async () => {
    const r = await contributor.post(`/api/v1/projects/${pid}/raid/risks`, {
      workstreamId: ws.get('WS06')!.id,
      title: 'Cut-over window too short (test)',
      probability: 4,
      impact: 5,
      trigger: 'Rehearsal overruns',
      response: 'Add a second rehearsal',
      responseStrategy: 'mitigate',
      exposure: { amount: '1250000.5', currency: 'SAR', unitScale: 1 },
      ownerUserId: contributor.userId,
      dueDate: addDays(today, -1),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    riskId = r.body.id;
    await contributor.post(`/api/v1/projects/${pid}/raid/risks`, { title: 'Low risk (test)', probability: 1, impact: 2 }).expect(201);
    const got = (await pm.get(`/api/v1/projects/${pid}/raid/risks/${riskId}`).expect(200)).body;
    expect(got).toMatchObject({ kind: 'risk', score: 20, rating: 'high', overdue: true, exposure: { amount: '1250000.5', currency: 'SAR', unitScale: 1 } });
    const high = (await pm.get(`/api/v1/projects/${pid}/raid/risks?minScore=15&sort=-score`).expect(200)).body;
    expect(high.items.map((x: { id: string }) => x.id)).toEqual([riskId]);
    expect(high.total).toBe(1);
    const overdue = (await pm.get(`/api/v1/projects/${pid}/raid/risks?overdue=true`).expect(200)).body;
    expect(overdue.items.map((x: { id: string }) => x.id)).toEqual([riskId]);
    expect((await pm.get(`/api/v1/projects/${pid}/raid/issues?minScore=5`)).status).toBe(400);
  });

  it('escalation must raise the level; closing needs a reason; closed items reopen with a reason', async () => {
    await pm.post(`/api/v1/projects/${pid}/raid/risks/${riskId}/escalate`, { expectedVersion: 1, level: 1, reason: 'PMO attention' }).expect(201);
    const same = await pm.post(`/api/v1/projects/${pid}/raid/risks/${riskId}/escalate`, { expectedVersion: 2, level: 1, reason: 'again' });
    expect(same.status).toBe(422);
    expect(same.body.code).toBe('raid.escalation_level');
    await pm.post(`/api/v1/projects/${pid}/raid/risks/${riskId}/escalate`, { expectedVersion: 2, level: 2, reason: 'Steering committee' }).expect(201);
    expect((await pm.post(`/api/v1/projects/${pid}/raid/risks/${riskId}/close`, { expectedVersion: 3 })).status).toBe(400);
    // A status change can never be smuggled through the descriptive PATCH.
    expect((await pm.patch(`/api/v1/projects/${pid}/raid/risks/${riskId}`, { expectedVersion: 3, status: 'closed' })).status).toBe(400);
    const issue = await pm.post(`/api/v1/projects/${pid}/raid/risks/${riskId}/raise-issue`, { expectedVersion: 3, severity: 5 });
    expect(issue.status, JSON.stringify(issue.body)).toBe(201);
    const iss = (await pm.get(`/api/v1/projects/${pid}/raid/issues/${issue.body.id}`).expect(200)).body;
    expect(iss).toMatchObject({ kind: 'issue', raisedFromRiskId: riskId, severity: 5, blocking: true, workstreamCode: 'WS06' });
    expect((await pm.post(`/api/v1/projects/${pid}/raid/issues/${issue.body.id}/mitigate`, { expectedVersion: 1 })).status).toBe(422);
    await pm.post(`/api/v1/projects/${pid}/raid/risks/${riskId}/close`, { expectedVersion: 3, reason: 'Risk materialised as issue' }).expect(201);
    expect((await pm.patch(`/api/v1/projects/${pid}/raid/risks/${riskId}`, { expectedVersion: 4, title: 'x' })).status).toBe(422);
    await pm.post(`/api/v1/projects/${pid}/raid/risks/${riskId}/reopen`, { expectedVersion: 4, reason: 'Re-assess' }).expect(201);
    const trail = await owner().query(`select action from audit_event where entity_id = $1 and outcome = 'success' order by chain_pos`, [riskId]);
    expect(trail.rows.map((r) => r.action)).toEqual(['planning.raid.create', 'planning.raid.escalate', 'planning.raid.escalate', 'planning.raid.close', 'planning.raid.reopen']);
  });

  it('assumptions and RAID dependencies are tracked with the same lifecycle; the open blocking issue turns the workstream red', async () => {
    await contributor.post(`/api/v1/projects/${pid}/raid/assumptions`, { title: 'Durations are template assumptions (test)', basis: 'Template v1' }).expect(201);
    const d = await contributor.post(`/api/v1/projects/${pid}/raid/dependencies`, { title: 'Needs committee decision (test)', dependsOn: 'Committee decision — to be scheduled', neededBy: addDays(today, -2) });
    expect(d.status).toBe(201);
    const deps = (await pm.get(`/api/v1/projects/${pid}/raid/dependencies?overdue=true`).expect(200)).body;
    expect(deps.items[0]).toMatchObject({ kind: 'dependency', overdue: true, dependsOn: 'Committee decision — to be scheduled' });
    const p = (await pm.get(`/api/v1/projects/${pid}/progress`).expect(200)).body;
    const w6 = p.workstreams.find((w: { code: string }) => w.code === 'WS06');
    expect(w6.rag.calculated.status).toBe('red');
    expect(w6.openBlockers[0].type).toBe('issue');
  });
});

describe('Look-ahead and responsibility matrix [REQ-PLN-014, REQ-PLN-010]', () => {
  it('lists what starts / is due in the window and what is overdue, on local business dates', async () => {
    const w = ws.get('WS03')!.id;
    const soon = await task(pm, pid, w, 'Due soon (test)', { durationDays: 2, plannedStart: today, plannedFinish: addDays(today, 3), accountableUserId: contributor.userId });
    const late = await task(pm, pid, w, 'Overdue (test)', { durationDays: 2, plannedStart: addDays(today, -10), plannedFinish: addDays(today, -3), accountableUserId: contributor.userId });
    const far = await task(pm, pid, w, 'Far away (test)', { durationDays: 2, plannedStart: addDays(today, 40), plannedFinish: addDays(today, 42) });
    const la = (await pm.get(`/api/v1/projects/${pid}/look-ahead?weeks=2`).expect(200)).body;
    expect(la.today).toBe(today);
    expect(la.window).toEqual({ from: today, to: addDays(today, 13), weeks: 2 });
    expect(la.starting.map((x: { id: string }) => x.id)).toContain(soon);
    expect(la.due.map((x: { id: string }) => x.id)).toContain(soon);
    expect(la.overdue.map((x: { id: string }) => x.id)).toContain(late);
    expect([...la.starting, ...la.due].map((x: { id: string }) => x.id)).not.toContain(far);
    const la8 = (await pm.get(`/api/v1/projects/${pid}/look-ahead?weeks=8`).expect(200)).body;
    expect(la8.due.map((x: { id: string }) => x.id)).toContain(far);
    expect((await pm.get(`/api/v1/projects/${pid}/look-ahead?weeks=3`)).status).toBe(400);
    const overdueList = (await pm.get(`/api/v1/projects/${pid}/tasks?overdue=true`).expect(200)).body;
    expect(overdueList.items.map((x: { id: string }) => x.id)).toEqual([late]);
    expect(overdueList.total).toBe(1);
  });

  it('shows owner load and conflicts without claiming resource optimisation', async () => {
    const r = (await pm.get(`/api/v1/projects/${pid}/responsibility`).expect(200)).body;
    const c = r.owners.find((o: { userId: string }) => o.userId === contributor.userId);
    expect(c).toMatchObject({ accountableOpenTasks: 2, overdueTasks: 1, hasProjectRole: true });
    expect(r.conflicts.some((x: { kind: string }) => x.kind === 'missing_owner')).toBe(true);
    expect(r.explanation).toMatch(/not resource levelling/);
  });

  it('task lists filter, sort and paginate inside the caller scope', async () => {
    const dcId = await projectIdByCode(DC);
    const pageA = (await pm.get(`/api/v1/projects/${dcId}/tasks?status=not_started,in_progress&pageSize=5&page=1&sort=wbs`).expect(200)).body;
    const pageB = (await pm.get(`/api/v1/projects/${dcId}/tasks?status=not_started,in_progress&pageSize=5&page=2&sort=wbs`).expect(200)).body;
    expect(pageA.items).toHaveLength(5);
    expect(pageA.total).toBe(pageB.total);
    expect(pageA.items.map((x: { id: string }) => x.id)).not.toEqual(pageB.items.map((x: { id: string }) => x.id));
    const mine = (await contributor.get(`/api/v1/projects/${dcId}/tasks?ownerUserId=me&pageSize=100`).expect(200)).body;
    expect(mine.items.every((x: { accountableUserId: string }) => x.accountableUserId === contributor.userId)).toBe(true);
    const q = (await pm.get(`/api/v1/projects/${dcId}/tasks?q=charter`).expect(200)).body;
    expect(q.items.every((x: { title: string; wbsCode: string }) => /charter/i.test(x.title) || /charter/i.test(x.wbsCode))).toBe(true);
    expect((await pm.get(`/api/v1/projects/${dcId}/tasks?status=bogus`)).status).toBe(400);
  });
});
