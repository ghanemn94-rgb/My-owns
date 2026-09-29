import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, GEN, loginAs, owner, projectIdByCode, Client } from '../helpers';
import { addEvidence, auditCount } from './fixtures';

/** Evidence-verified progress, separation of duties, own-workstream scope and project isolation on the demo project. */
let dcId: string;
let genId: string;
let pm: Client;
let techLead: Client;
let opsLead: Client;
let approver: Client;

const taskOf = async (wbs: string) => (await owner().query(`select id, version from task where project_id = $1 and wbs_code = $2`, [dcId, wbs])).rows[0] as { id: string; version: number };
const getTask = async (c: Client, id: string) => (await c.get(`/api/v1/projects/${dcId}/tasks/${id}`).expect(200)).body;

beforeAll(async () => {
  dcId = await projectIdByCode(DC);
  genId = await projectIdByCode(GEN);
  pm = await loginAs('pm');
  techLead = await loginAs('tech.lead');
  opsLead = await loginAs('ops.lead');
  approver = await loginAs('approver');
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('Reported vs evidence-verified progress; acceptance separation of duties [REQ-PLN-011, REQ-PLN-003]', () => {
  let t: { id: string };

  it('the demo plan has activated tasks with a single accountable owner', async () => {
    const list = (await pm.get(`/api/v1/projects/${dcId}/tasks?workstreamId=${(await getTask(pm, (await taskOf('WS06-A01')).id)).workstreamId}&pageSize=50`).expect(200)).body;
    expect(list.total).toBeGreaterThan(0);
    expect(list.items.every((x: { status: string; accountableUserId: string | null }) => x.status !== 'draft' && x.accountableUserId === techLead.userId)).toBe(true);
  });

  it('the submitter cannot accept their own task (not_self) and the attempt is audited as denied', async () => {
    t = await taskOf('WS06-A03');
    await techLead.post(`/api/v1/projects/${dcId}/tasks/${t.id}/start`, { expectedVersion: (await getTask(techLead, t.id)).version }).expect(201);
    await techLead.post(`/api/v1/projects/${dcId}/tasks/${t.id}/progress`, { expectedVersion: (await getTask(techLead, t.id)).version, reportedProgress: 80 }).expect(201);
    const mid = await getTask(techLead, t.id);
    expect(mid).toMatchObject({ reportedProgress: 80, verifiedProgress: 0 });
    // Completing directly is refused because this task type requires acceptance.
    const direct = await techLead.post(`/api/v1/projects/${dcId}/tasks/${t.id}/complete`, { expectedVersion: mid.version });
    expect(direct.status).toBe(422);
    expect(direct.body.code).toBe('task.acceptance_required');
    await techLead.post(`/api/v1/projects/${dcId}/tasks/${t.id}/submit-for-acceptance`, { expectedVersion: mid.version }).expect(201);

    const before = await auditCount(techLead.userId, 'denied', 'planning.acceptTask');
    const self = await techLead.post(`/api/v1/projects/${dcId}/tasks/${t.id}/accept`, { expectedVersion: mid.version + 1 });
    expect(self.status).toBe(403);
    expect(self.body.detail).toMatch(/Separation of duties/);
    expect(await auditCount(techLead.userId, 'denied', 'planning.acceptTask')).toBe(before + 1);
    expect((await getTask(pm, t.id)).status).toBe('submitted_for_acceptance');
  });

  it('the approver sees it in My Work; acceptance needs active evidence; then verified progress is 100', async () => {
    const inbox = (await approver.get('/api/v1/me/work').expect(200)).body;
    expect(inbox.items.some((i: { type: string; entityId: string }) => i.type === 'task_acceptance' && i.entityId === t.id)).toBe(true);
    const own = (await techLead.get('/api/v1/me/work').expect(200)).body;
    expect(own.items.some((i: { type: string; entityId: string }) => i.type === 'task_acceptance' && i.entityId === t.id)).toBe(false);
    expect(own.items.some((i: { type: string }) => i.type === 'task_accountable')).toBe(true);

    const v = (await getTask(pm, t.id)).version;
    const noEv = await approver.post(`/api/v1/projects/${dcId}/tasks/${t.id}/accept`, { expectedVersion: v });
    expect(noEv.status).toBe(422);
    expect(noEv.body.code).toBe('task.evidence_required');
    expect(await auditCount(approver.userId, 'rejected', 'planning.acceptTask')).toBeGreaterThanOrEqual(1);
    await addEvidence(dcId, 'task', t.id, techLead.userId);
    await approver.post(`/api/v1/projects/${dcId}/tasks/${t.id}/accept`, { expectedVersion: v, note: 'evidence reviewed (test)' }).expect(201);
    const done = await getTask(pm, t.id);
    expect(done).toMatchObject({ status: 'accepted', verifiedProgress: 100, acceptedBy: approver.userId, evidenceCount: 1 });
  });

  it('a task that does not require acceptance can be completed — but is not evidence-verified', async () => {
    const w = (await getTask(pm, t.id)).workstreamId;
    const c = await pm.post(`/api/v1/projects/${dcId}/tasks`, { workstreamId: w, title: 'Housekeeping (test)', requiresAcceptance: false, accountableUserId: techLead.userId });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    await techLead.post(`/api/v1/projects/${dcId}/tasks/${c.body.id}/start`, { expectedVersion: 1 }).expect(201);
    expect((await techLead.post(`/api/v1/projects/${dcId}/tasks/${c.body.id}/submit-for-acceptance`, { expectedVersion: 2 })).status).toBe(422);
    await techLead.post(`/api/v1/projects/${dcId}/tasks/${c.body.id}/complete`, { expectedVersion: 2 }).expect(201);
    expect(await getTask(pm, c.body.id)).toMatchObject({ status: 'done', reportedProgress: 100, verifiedProgress: 0 });
  });

  it('milestone achievement is verified only with evidence and by someone other than the reporter', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
    const w1 = (await owner().query(`select id from workstream where project_id = $1 and code = 'WS01'`, [dcId])).rows[0].id;
    const created = await pm.post(`/api/v1/projects/${dcId}/milestones`, { workstreamId: w1, title: 'Test milestone (acceptance spec)', plannedDate: today, isCritical: false });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const m = created.body.id as string;
    const cur = (await pm.get(`/api/v1/projects/${dcId}/milestones/${m}`).expect(200)).body;
    await pm.post(`/api/v1/projects/${dcId}/milestones/${m}/report-achieved`, { expectedVersion: cur.version, actualDate: today }).expect(201);
    const noEv = await approver.post(`/api/v1/projects/${dcId}/milestones/${m}/verify-achieved`, { expectedVersion: cur.version + 1 });
    expect(noEv.status).toBe(422);
    expect(noEv.body.code).toBe('milestone.evidence_required');
    await addEvidence(dcId, 'milestone', m, pm.userId);
    await approver.post(`/api/v1/projects/${dcId}/milestones/${m}/verify-achieved`, { expectedVersion: cur.version + 1 }).expect(201);
    expect((await pm.get(`/api/v1/projects/${dcId}/milestones/${m}`).expect(200)).body).toMatchObject({ status: 'achieved_verified', verificationStatus: 'confirmed', verifiedBy: approver.userId });
  });
});

describe('Workstream scope and ownership [REQ-PLN-003, REQ-SEC]', () => {
  it("a workstream lead cannot edit another workstream's task (own_workstream) but can edit their own", async () => {
    const other = await taskOf('WS07-A01');
    const r = await techLead.patch(`/api/v1/projects/${dcId}/tasks/${other.id}`, { expectedVersion: other.version, title: 'hijacked' });
    expect(r.status).toBe(403);
    expect((await taskOf('WS07-A01')).version).toBe(other.version);
    const t = (await owner().query(`select title from task where id = $1`, [other.id])).rows[0].title;
    expect(t).not.toBe('hijacked');
    const own = await taskOf('WS06-A01');
    await techLead.patch(`/api/v1/projects/${dcId}/tasks/${own.id}`, { expectedVersion: own.version, description: 'Updated by the WS06 lead (test)' }).expect(200);
  });

  it('progress updates are limited to the owner / assignee / manager of the task', async () => {
    const other = await taskOf('WS07-A02');
    const r = await techLead.post(`/api/v1/projects/${dcId}/tasks/${other.id}/progress`, { expectedVersion: other.version, reportedProgress: 50 });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('planning.not_assigned');
    await opsLead.post(`/api/v1/projects/${dcId}/tasks/${other.id}/progress`, { expectedVersion: other.version, reportedProgress: 10 }).expect(201);
  });

  it('RACI: accountability is only through the single owner; R assignees may report progress', async () => {
    const t = await taskOf('WS07-A05');
    const a = await pm.post(`/api/v1/projects/${dcId}/raci`, { entityType: 'task', entityId: t.id, userId: techLead.userId, raci: 'A' });
    expect(a.status).toBe(422);
    expect(a.body.code).toBe('raci.accountable_via_owner');
    await pm.post(`/api/v1/projects/${dcId}/raci`, { entityType: 'task', entityId: t.id, userId: techLead.userId, raci: 'R' }).expect(201);
    const raci = (await pm.get(`/api/v1/projects/${dcId}/raci?entityType=task&entityId=${t.id}`).expect(200)).body.items;
    expect(raci.filter((x: { raci: string }) => x.raci === 'A')).toHaveLength(1);
    expect(raci.find((x: { raci: string }) => x.raci === 'A')).toMatchObject({ userId: opsLead.userId, derived: true });
    const v = (await taskOf('WS07-A05')).version;
    await techLead.post(`/api/v1/projects/${dcId}/tasks/${t.id}/progress`, { expectedVersion: v, reportedProgress: 5 }).expect(201);
  });

  it('changing an existing accountable owner requires ownership.reassign (a contributor cannot)', async () => {
    const contributor = await loginAs('contributor');
    const t = await taskOf('WS02-A01');
    expect((await contributor.post(`/api/v1/projects/${dcId}/tasks/${t.id}/owner`, { expectedVersion: t.version, userId: pm.userId })).status).toBe(403);
    const r = await pm.post(`/api/v1/projects/${dcId}/tasks/${t.id}/owner`, { expectedVersion: t.version, userId: pm.userId, reason: 'rebalancing (test)' });
    expect(r.status).toBe(201);
    const ev = await owner().query(`select before, after from audit_event where entity_id = $1 and action = 'planning.ownership.reassign' order by chain_pos desc limit 1`, [t.id]);
    expect(ev.rows[0].after).toEqual({ owner: pm.userId });
    // Outsiders cannot be made owners.
    const pmB = await loginAs('pm.b');
    const t2 = await taskOf('WS02-A01');
    expect((await pm.post(`/api/v1/projects/${dcId}/tasks/${t.id}/owner`, { expectedVersion: t2.version, userId: pmB.userId })).status).toBe(400);
  });
});

describe('Project isolation of planning records (AT-03) [REQ-SEC-007]', () => {
  it('ids of another project are 404 in every position (path, body, query) with no title leakage', async () => {
    const pmB = await loginAs('pm.b');
    const dcTask = await taskOf('WS01-A01');
    const r1 = await pmB.get(`/api/v1/projects/${dcId}/tasks/${dcTask.id}`);
    expect(r1.status).toBe(404);
    expect(JSON.stringify(r1.body)).not.toMatch(/charter|WS01/i);
    const genTask = (await owner().query(`select id, version, title from task where project_id = $1 limit 1`, [genId])).rows[0];
    expect((await pm.get(`/api/v1/projects/${dcId}/tasks/${genTask.id}`)).status).toBe(404);
    expect((await pm.patch(`/api/v1/projects/${dcId}/tasks/${genTask.id}`, { expectedVersion: genTask.version, title: 'x' })).status).toBe(404);
    expect((await owner().query(`select title from task where id = $1`, [genTask.id])).rows[0].title).toBe(genTask.title);
    const cr = await pm.post(`/api/v1/projects/${dcId}/change-requests`, { title: 'x', rationale: 'y', subjectType: 'task', subjectId: genTask.id });
    expect(cr.status).toBe(404);
    const raci = await pm.post(`/api/v1/projects/${dcId}/raci`, { entityType: 'task', entityId: genTask.id, userId: pm.userId, raci: 'R' });
    expect(raci.status).toBe(404);
    expect((await pm.get(`/api/v1/projects/${dcId}/raci?entityType=task&entityId=${genTask.id}`)).status).toBe(404);
    const genWs = (await owner().query(`select id from workstream where project_id = $1 limit 1`, [genId])).rows[0].id;
    expect((await pm.post(`/api/v1/projects/${dcId}/tasks`, { workstreamId: genWs, title: 'smuggled' })).status).toBe(404);
    expect((await pm.post(`/api/v1/projects/${dcId}/rag-overrides`, { entityType: 'workstream', entityId: genWs, overrideStatus: 'green', reason: 'x', expiresOn: '2099-01-01' })).status).toBe(404);
    // Lists and inbox totals come only from the caller's projects.
    const pmBInbox = (await pmB.get('/api/v1/me/work').expect(200)).body;
    expect(pmBInbox.items.every((i: { projectId: string }) => i.projectId === genId)).toBe(true);
  });
});

describe('My Work / Inbox [REQ-PLN-015, REQ-PLN-021]', () => {
  it('reviewers see pending updates and overrides; the requester does not see their own override to review', async () => {
    const sec = await loginAs('secretary');
    const inbox = (await sec.get('/api/v1/me/work').expect(200)).body;
    const types = new Set(inbox.items.map((i: { type: string }) => i.type));
    expect(types.has('status_update_review')).toBe(true);
    expect(types.has('rag_override_review')).toBe(true);
    const item = inbox.items.find((i: { type: string }) => i.type === 'rag_override_review');
    expect(item).toMatchObject({ projectCode: DC, isDemo: true });
    expect(item.linkPath).toMatch(new RegExp(`^/projects/${dcId}/`));
    const requester = (await techLead.get('/api/v1/me/work').expect(200)).body;
    expect(requester.items.some((i: { type: string }) => i.type === 'rag_override_review')).toBe(false);
    expect(Object.values(inbox.counts as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(inbox.items.length);
  });
});
