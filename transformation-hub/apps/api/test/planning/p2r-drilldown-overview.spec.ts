import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, Client, DC, loginAs, owner, projectIdByCode } from '../helpers';
import { createProject, grant, task, workstreams } from './fixtures';
import { P, approvedNonDemoMatrix, paper, plusDays, uniq } from '../governance/gov-fixtures';

/**
 * P2 residuals — the API pieces behind the web screens (docs/phases/P2-P4-requirement-disposition.md, "Update at the P2
 * gate"):
 *  - REQ-UX-024: every metric tile opens a filtered list whose total equals the tile's number, computed in the caller's
 *    scope — the project counts (open risks, overdue committee actions) use the same scope as the list they open, and the
 *    escalation list has the `unresolved` filter the Committee Hub tile counts and opens;
 *  - REQ-UX-006: the approved baseline names its approver and the project roles the approver held AT the approval time.
 * All data is synthetic.
 */
let dc: string;
let admin: Client;
let pm: Client;
let secretary: Client;
let sponsor: Client;
let chair: Client;
let contributor: Client;

beforeAll(async () => {
  dc = await projectIdByCode(DC);
  admin = await loginAs('portfolio.admin');
  pm = await loginAs('pm');
  secretary = await loginAs('secretary');
  sponsor = await loginAs('sponsor');
  chair = await loginAs('chair');
  contributor = await loginAs('contributor');
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

async function total(c: Client, path: string): Promise<number> {
  const r = await c.get(path);
  expect(r.status, `${path} → ${JSON.stringify(r.body)}`).toBe(200);
  return r.body.total as number;
}

async function projectCounts(c: Client, pid: string): Promise<{ openRisks: number | null; overdueActions: number | null }> {
  const r = await c.get(`/api/v1/projects/${pid}`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return { openRisks: r.body.openRisks, overdueActions: r.body.overdueActions };
}

describe('Metric drill-down: a count equals the total of the list it opens, in the caller scope [REQ-UX-024]', () => {
  it('overdue committee actions: the project count equals the actions list overdue=true; an action of a restricted decision counts only for a reader cleared for it', async () => {
    const committees = (await secretary.get(`${P(dc)}/committees?pageSize=100`).expect(200)).body.items as { id: string; kind: string; status: string }[];
    const steering = committees.find((c) => c.kind === 'program_steering' && c.status === 'active')!;
    // A restricted paper (the PM and the contributor are cleared for confidential only) with an overdue action linked.
    const hidden = (await secretary.post(`${P(dc)}/decisions`, { ...paper(steering.id), classification: 'restricted' }).expect(201)).body;
    const hiddenAction = (await secretary.post(`${P(dc)}/actions`, { title: uniq('Overdue action of a restricted paper (test)'), decisionId: hidden.id, ownerUserId: secretary.userId, dueDate: plusDays(-3) }).expect(201)).body;
    // An overdue action visible to every governance reader.
    const open = (await secretary.post(`${P(dc)}/actions`, { title: uniq('Overdue unlinked action (test)'), ownerUserId: pm.userId, dueDate: plusDays(-2) }).expect(201)).body;

    for (const c of [pm, secretary, sponsor, contributor]) {
      const counts = await projectCounts(c, dc);
      const listed = await total(c, `${P(dc)}/actions?overdue=true&pageSize=1`);
      expect(counts.overdueActions, `${c.persona}: project count = list total`).toBe(listed);
      // The portfolio list (Portfolio Home) carries the same number.
      const card = ((await c.get('/api/v1/projects?pageSize=100').expect(200)).body.items as { id: string; overdueActions: number | null }[]).find((p) => p.id === dc)!;
      expect(card.overdueActions, `${c.persona}: portfolio card = list total`).toBe(listed);
    }
    // The restricted paper's action is counted for the secretary (restricted clearance) and not for the PM.
    const pmIds = ((await pm.get(`${P(dc)}/actions?overdue=true&pageSize=100`).expect(200)).body.items as { id: string }[]).map((x) => x.id);
    const secIds = ((await secretary.get(`${P(dc)}/actions?overdue=true&pageSize=100`).expect(200)).body.items as { id: string }[]).map((x) => x.id);
    expect(pmIds).toContain(open.id);
    expect(pmIds).not.toContain(hiddenAction.id);
    expect(secIds).toContain(hiddenAction.id);
    const before = (await projectCounts(pm, dc)).overdueActions!;
    expect((await projectCounts(secretary, dc)).overdueActions).toBe(before + (secIds.length - pmIds.length));
  });

  it('open risks: the project count equals the RAID register status=open,monitoring,escalated for a project-wide and a workstream-only reader', async () => {
    const pid = await createProject(admin, pm, `P2RW-DR-${Date.now().toString(36).toUpperCase()}`.slice(0, 31));
    const ws = await workstreams(pm, pid);
    const ws1 = ws.get('WS01')!.id;
    const ws2 = ws.get('WS02')!.id;
    const risk = async (workstreamId: string, title: string) => (await pm.post(`${P(pid)}/raid/risks`, { workstreamId, title, probability: 3, impact: 3 }).expect(201)).body.id as string;
    await risk(ws1, 'WS01 open risk (test)');
    await risk(ws2, 'WS02 open risk (test)');
    const closed = await risk(ws1, 'WS01 risk closed next (test)');
    const got = (await pm.get(`${P(pid)}/raid/risks/${closed}`).expect(200)).body;
    await pm.post(`${P(pid)}/raid/risks/${closed}/close`, { expectedVersion: got.version, reason: 'Closed for the drill-down test' }).expect(201);
    // A reader whose only role is workstream-scoped (WS01).
    const wsOnly = await loginAs('contributor.b');
    await grant(admin, pid, wsOnly, 'workstream_lead', ws1);

    const path = `${P(pid)}/raid/risks?status=open,monitoring,escalated&pageSize=1`;
    const pmCount = (await projectCounts(pm, pid)).openRisks;
    expect(pmCount).toBe(await total(pm, path));
    expect(pmCount).toBe(2);
    const wsCount = (await projectCounts(wsOnly, pid)).openRisks;
    expect(wsCount).toBe(await total(wsOnly, path));
    expect(wsCount, 'the WS02 risk is outside the workstream reader scope').toBe(1);
  });

  it('unresolved escalations: unresolved=true lists exactly the open and decision-requested ones, false the rest; any other value is 400', async () => {
    const e = (await pm.post(`${P(dc)}/escalations`, { title: uniq('Drill-down escalation (test)'), sourceType: 'other', requestedAction: 'Decide', decisionDeadline: plusDays(5), options: [{ title: 'A' }] }).expect(201)).body;
    const resolved = (await pm.post(`${P(dc)}/escalations`, { title: uniq('Resolved escalation (test)'), sourceType: 'other', requestedAction: 'Decide', decisionDeadline: plusDays(5), options: [{ title: 'A' }] }).expect(201)).body;
    const v = (await chair.get(`${P(dc)}/escalations/${resolved.id}`).expect(200)).body.version;
    await chair.post(`${P(dc)}/escalations/${resolved.id}/resolve`, { expectedVersion: v, note: 'Resolved for the drill-down test' }).expect(201);

    for (const c of [pm, contributor]) {
      const all = (await c.get(`${P(dc)}/escalations?pageSize=100`).expect(200)).body;
      const un = (await c.get(`${P(dc)}/escalations?unresolved=true&pageSize=100`).expect(200)).body;
      const done = (await c.get(`${P(dc)}/escalations?unresolved=false&pageSize=100`).expect(200)).body;
      const expected = (all.items as { status: string }[]).filter((x) => x.status === 'open' || x.status === 'decision_requested').length;
      expect(all.total).toBeLessThanOrEqual(100);
      expect(un.total, `${c.persona}: unresolved total`).toBe(expected);
      expect((un.items as { status: string }[]).every((x) => ['open', 'decision_requested'].includes(x.status))).toBe(true);
      expect((done.items as { status: string }[]).every((x) => ['resolved', 'withdrawn'].includes(x.status))).toBe(true);
      expect(un.total + done.total).toBe(all.total);
      expect((un.items as { id: string }[]).map((x) => x.id)).toContain(e.id);
      expect((done.items as { id: string }[]).map((x) => x.id)).toContain(resolved.id);
    }
    expect((await pm.get(`${P(dc)}/escalations?unresolved=yes`)).status).toBe(400);
  });
});

describe('Program Overview & Charter: the approved baseline names its approver and the roles held at approval [REQ-UX-006]', () => {
  it('a proposal has no approver; the approved version names the approver and the sponsor role held then — a role granted or revoked later does not change it', async () => {
    const legal = await loginAs('legal');
    const pid = await createProject(admin, pm, `P2RW-BL-${Date.now().toString(36).toUpperCase()}`.slice(0, 31));
    const sponsorGrant = (await admin.post(`/api/v1/projects/${pid}/members`, { userId: sponsor.userId, role: 'sponsor', reason: 'overview test fixture' }).expect(201)).body.id as string;
    await grant(admin, pid, secretary, 'secretary_cpmo');
    await grant(admin, pid, legal, 'legal_restricted');
    await approvedNonDemoMatrix(pid, { secretary, sponsor, legal });
    const ws1 = (await workstreams(pm, pid)).get('WS01')!.id;
    await task(pm, pid, ws1, 'Overview test dated task', { durationDays: 5, plannedStart: '2026-10-04', plannedFinish: '2026-10-08' });
    await pm.post(`${P(pid)}/workstreams/${ws1}/tasks/activate`, { note: 'test' }).expect(201);

    const b = (await pm.post(`${P(pid)}/baselines`, { note: 'Overview test v1' }).expect(201)).body;
    const proposed = ((await pm.get(`${P(pid)}/baselines`).expect(200)).body.items as Record<string, unknown>[]).find((x) => x.id === b.id)!;
    expect(proposed).toMatchObject({ status: 'proposed', approvedBy: null, approvedByName: null, approverRoles: [], approvedAt: null });

    const ap = await sponsor.post(`${P(pid)}/baselines/${b.id}/approve`, { expectedVersion: b.version, note: 'Approved (test)' });
    expect(ap.status, JSON.stringify(ap.body)).toBe(201);
    const current = (await pm.get(`${P(pid)}/baselines/current`).expect(200)).body.baseline;
    expect(current).toMatchObject({ id: b.id, status: 'approved', approvedBy: sponsor.userId, approvedByName: 'Demo Sponsor', approverRoles: ['sponsor'] });
    expect(current.approvedAt).toEqual(expect.any(String));

    // Later role changes do not rewrite who approved in which capacity.
    const later = (await admin.post(`/api/v1/projects/${pid}/members`, { userId: sponsor.userId, role: 'functional_approver', reason: 'granted after the approval (test)' }).expect(201)).body.id as string;
    await admin.post(`/api/v1/projects/${pid}/members/${sponsorGrant}/revoke`, { reason: 'revoked after the approval (test)' }).expect(201);
    const after = ((await pm.get(`${P(pid)}/baselines`).expect(200)).body.items as Record<string, unknown>[]).find((x) => x.id === b.id)!;
    expect(after).toMatchObject({ approvedByName: 'Demo Sponsor', approverRoles: ['sponsor'] });
    // Cross-check with the membership table (owner connection, bypassing the API).
    const m = await owner().query(`select role from project_membership where id = any($1::uuid[]) order by role`, [[sponsorGrant, later]]);
    expect(m.rows.map((r) => r.role as string).sort()).toEqual(['functional_approver', 'sponsor']);
  });
});
