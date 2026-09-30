import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, loginAs, owner, Client } from '../helpers';
import { createProject, grant, milestone, task, workstreams } from './fixtures';

/**
 * DOM-P2-17 — cross-project dependencies with minimum disclosure (spec §5, REQ-ENT-010): a dependency on another project's
 * item is visible only to users who can read BOTH ends; everyone else sees nothing (not listed, not counted, 404).
 * DOM-P2-18 — dependencies linking decisions, gates, agreements, approvals and evidence (spec §9, REQ-PLN-006): an
 * unsatisfied prerequisite blocks starting the task ("task blocked by pending agreement dependency"). Synthetic projects.
 */
let admin: Client;
let pm: Client; // PM of both projects
let finance: Client; // project A only
let legal: Client; // project B only
let opsLead: Client; // project manager of A only
let A: string;
let B: string;
let taskA: string;
let msB: string;

const X = (p: string) => `/api/v1/projects/${p}/cross-project-dependencies`;
const PR = (p: string) => `/api/v1/projects/${p}/prerequisites`;

beforeAll(async () => {
  admin = await loginAs('portfolio.admin');
  pm = await loginAs('pm');
  finance = await loginAs('finance');
  legal = await loginAs('legal');
  opsLead = await loginAs('ops.lead');
  A = await createProject(admin, pm, 'XP-A-P2FX');
  B = await createProject(admin, pm, 'XP-B-P2FX');
  await grant(admin, A, finance, 'finance_restricted');
  await grant(admin, B, legal, 'legal_restricted');
  await grant(admin, A, opsLead, 'project_manager');
  taskA = await task(pm, A, (await workstreams(pm, A)).get('WS02')!.id, 'Dependent task in A (synthetic)', { durationDays: 3 });
  msB = await milestone(pm, B, (await workstreams(pm, B)).get('WS01')!.id, 'Milestone in B that A waits for (synthetic)', { plannedDate: '2026-12-15' });
}, 300_000);
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('DOM-P2-17 — cross-project dependencies are visible only to readers of both projects [REQ-ENT-010, AT-03]', () => {
  let depId: string;

  it('a PM of both projects records that a task of A waits for a milestone of B', async () => {
    const r = await pm.post(X(A), { otherProjectId: B, otherItemType: 'milestone', otherItemId: msB, localItemType: 'task', localItemId: taskA, description: 'A needs B’s milestone (synthetic)', neededBy: '2026-12-01' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    depId = r.body.id;
    const audit = await owner().query(`select project_id from audit_event where action = 'planning.cross_project_dependency.create' and entity_id = $1`, [depId]);
    expect(audit.rows.map((x) => x.project_id)).toEqual([A]); // audited in the dependent project only
  });

  it('the PM sees it as outgoing in A (with the schedule-based risk) and as incoming in B', async () => {
    const out = (await pm.get(X(A)).expect(200)).body;
    expect(out.total).toBe(1);
    expect(out.items[0]).toMatchObject({ id: depId, direction: 'outgoing', otherProjectId: B, other: { type: 'milestone', id: msB, finish: '2026-12-15' }, local: { type: 'task', id: taskA }, neededBy: '2026-12-01', atRisk: true, status: 'open' });
    const inc = (await pm.get(X(B)).expect(200)).body;
    expect(inc.items.map((i: { id: string; direction: string }) => [i.id, i.direction])).toEqual([[depId, 'incoming']]);
  });

  it('a reader of only one of the two projects sees nothing — not listed, not counted, and its id answers 404', async () => {
    for (const [who, pid] of [[finance, A], [legal, B], [opsLead, A]] as const) {
      const r = (await who.get(X(pid)).expect(200)).body;
      expect(r).toMatchObject({ items: [], total: 0 });
    }
    const close = await opsLead.post(`${X(A)}/${depId}/close`, { expectedVersion: 1, reason: 'probe' });
    expect(close.status).toBe(404);
  });

  it('a manager who cannot read the other project cannot point at its items (404); the same project is refused', async () => {
    const r = await opsLead.post(X(A), { otherProjectId: B, otherItemType: 'milestone', otherItemId: msB, description: 'probe' });
    expect(r.status).toBe(404);
    const same = await pm.post(X(A), { otherProjectId: A, otherItemType: 'task', otherItemId: taskA, description: 'probe' });
    expect(same.status).toBe(422);
    expect(same.body.code).toBe('xproj.same_project');
    // An item id of another project than the one named is not found either.
    const wrong = await pm.post(X(A), { otherProjectId: B, otherItemType: 'task', otherItemId: taskA, description: 'probe' });
    expect(wrong.status).toBe(404);
  });

  it('closing needs a reason and the current version; the dependency stays in history', async () => {
    const r = await pm.post(`${X(A)}/${depId}/close`, { expectedVersion: 1, reason: 'B milestone re-planned; dependency no longer needed (synthetic)' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await pm.post(`${X(A)}/${depId}/close`, { expectedVersion: r.body.version, reason: 'again' })).status).toBe(422);
    const row = (await owner().query(`select status, closed_by, closed_reason from cross_project_dependency where id = $1`, [depId])).rows[0];
    expect(row).toMatchObject({ status: 'closed', closed_by: pm.userId });
    expect((await pm.get(`${X(A)}?status=closed`).expect(200)).body.items[0]).toMatchObject({ id: depId, status: 'closed', atRisk: false });
  });
});

describe('DOM-P2-18 — tasks wait for decisions, gates, agreements, approvals and evidence [REQ-PLN-006]', () => {
  it('a task is blocked by a pending agreement dependency (422, audited) and the prerequisite is listed as unsatisfied', async () => {
    const t = await task(pm, A, (await workstreams(pm, A)).get('WS03')!.id, 'Task waiting for the ATA (synthetic)', { durationDays: 2 });
    const agr = await pm.post(`/api/v1/projects/${A}/agreements`, { kindLabel: 'ATA', title: 'Asset transfer agreement (synthetic)', ownerUserId: pm.userId });
    expect(agr.status, JSON.stringify(agr.body)).toBe(201);
    const pre = await pm.post(PR(A), { successorType: 'task', successorId: t, predecessorType: 'agreement', predecessorId: agr.body.id, note: 'Cannot start before the ATA is signed' });
    expect(pre.status, JSON.stringify(pre.body)).toBe(201);
    const list = (await pm.get(`${PR(A)}?successorId=${t}`).expect(200)).body.items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ predecessorType: 'agreement', predecessorId: agr.body.id, satisfied: false });
    const start = await pm.post(`/api/v1/projects/${A}/tasks/${t}/start`, { expectedVersion: 1 });
    expect(start.status).toBe(422);
    expect(start.body.code).toBe('planning.prerequisite_pending');
    expect((await owner().query(`select status from task where id = $1`, [t])).rows[0].status).toBe('not_started');
    // Duplicates and records of another project are refused.
    expect((await pm.post(PR(A), { successorType: 'task', successorId: t, predecessorType: 'agreement', predecessorId: agr.body.id })).status).toBe(409);
    const gateB = (await pm.get(`/api/v1/projects/${B}/gates`).expect(200)).body.items[0].id as string;
    expect((await pm.post(PR(A), { successorType: 'task', successorId: t, predecessorType: 'gate', predecessorId: gateB })).status).toBe(404);
  });

  it('evidence as a prerequisite: blocked until verified by someone else, then the task starts', async () => {
    const t = await task(pm, A, (await workstreams(pm, A)).get('WS04')!.id, 'Task waiting for verified evidence (synthetic)', { durationDays: 2 });
    const ev = await pm.post(`/api/v1/projects/${A}/evidence`, { targetType: 'task', targetId: taskA, note: 'Signed site survey (synthetic)' });
    expect(ev.status, JSON.stringify(ev.body)).toBe(201);
    await pm.post(PR(A), { successorType: 'task', successorId: t, predecessorType: 'evidence_link', predecessorId: ev.body.id }).expect(201);
    expect((await pm.post(`/api/v1/projects/${A}/tasks/${t}/start`, { expectedVersion: 1 })).status).toBe(422);
    await finance.post(`/api/v1/projects/${A}/evidence/${ev.body.id}/verify`, { expectedVersion: 1, decision: 'accept', note: 'Checked (synthetic)' }).expect(201);
    expect((await pm.get(`${PR(A)}?successorId=${t}`).expect(200)).body.items[0].satisfied).toBe(true);
    await pm.post(`/api/v1/projects/${A}/tasks/${t}/start`, { expectedVersion: 1 }).expect(201);
  });

  it('a gate prerequisite is unsatisfied until the gate is approved; removal needs the manage permission and is audited', async () => {
    const t = await task(pm, A, (await workstreams(pm, A)).get('WS05')!.id, 'Task after G1 (synthetic)', { durationDays: 2 });
    const g1 = ((await pm.get(`/api/v1/projects/${A}/gates`).expect(200)).body.items as { id: string; key: string }[]).find((g) => g.key === 'G1')!.id;
    const pre = await pm.post(PR(A), { successorType: 'task', successorId: t, predecessorType: 'gate', predecessorId: g1 }).expect(201);
    expect((await pm.get(`${PR(A)}?successorId=${t}`).expect(200)).body.items[0]).toMatchObject({ predecessorType: 'gate', satisfied: false });
    expect((await finance.post(`${PR(A)}/${pre.body.id}/remove`, { reason: 'probe' })).status).toBe(403);
    await pm.post(`${PR(A)}/${pre.body.id}/remove`, { reason: 'Re-planned (synthetic)' }).expect(201);
    await pm.post(`/api/v1/projects/${A}/tasks/${t}/start`, { expectedVersion: 1 }).expect(201);
    const audit = await owner().query(`select count(*)::int n from audit_event where project_id = $1 and action like 'planning.prerequisite.%'`, [A]);
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(4);
  });
});

describe('DOM-P2-17/18 — database guards and history [REQ-ENT-010, REQ-PLN-006]', () => {
  it('DB: a prerequisite successor and a local item are records of the owning project; the other project is of the same organization', async () => {
    const c = await owner().connect();
    try {
      await c.query('begin');
      const orgId = (await c.query<{ org_id: string }>('select org_id from project where id = $1', [A])).rows[0]!.org_id;
      const tv = (await c.query<{ template_version_id: string }>('select template_version_id from project where id = $1', [A])).rows[0]!.template_version_id;
      const refused = async (q: string, params: unknown[], match: RegExp | { code: string }) => {
        await c.query('savepoint probe');
        const r = c.query(q, params);
        if (match instanceof RegExp) await expect(r).rejects.toThrow(match);
        else await expect(r).rejects.toMatchObject(match);
        await c.query('rollback to savepoint probe');
      };
      // record_dependency: the successor milestone belongs to B, the row to A → same-project trigger.
      await refused(
        `insert into record_dependency (id, org_id, project_id, successor_type, successor_id, predecessor_type, predecessor_id) values (gen_random_uuid(), $1, $2, 'milestone', $3, 'decision', gen_random_uuid())`,
        [orgId, A, msB],
        /cross_project_reference/,
      );
      // cross_project_dependency: the LOCAL item must be of the owning project.
      await refused(
        `insert into cross_project_dependency (id, org_id, project_id, other_project_id, local_item_type, local_item_id, other_item_type, other_item_id, description) values (gen_random_uuid(), $1, $2, $3, 'milestone', $4, 'milestone', $4, 'probe (test)')`,
        [orgId, A, B, msB],
        /cross_project_reference/,
      );
      // The other project must be of the same organization (composite FK) — a project of another organization is refused.
      const org2 = (await c.query<{ id: string }>(`insert into organization (id, name, slug) values (gen_random_uuid(), 'XP foreign org (test)', 'xp-foreign-' || substr(md5(random()::text), 1, 8)) returning id`)).rows[0]!.id;
      const pf2 = (await c.query<{ id: string }>(`insert into portfolio (org_id, name) values ($1, 'XP foreign portfolio (test)') returning id`, [org2])).rows[0]!.id;
      const pg2 = (await c.query<{ id: string }>(`insert into program (org_id, portfolio_id, code, name) values ($1, $2, 'XP-FOREIGN', 'XP foreign program (test)') returning id`, [org2, pf2])).rows[0]!.id;
      const p2 = (await c.query<{ id: string }>(`insert into project (id, org_id, program_id, template_version_id, code, name) values (gen_random_uuid(), $1, $2, $3, 'XP-FOREIGN', 'XP foreign project (test)') returning id`, [org2, pg2, tv])).rows[0]!.id;
      await refused(
        `insert into cross_project_dependency (id, org_id, project_id, other_project_id, other_item_type, other_item_id, description) values (gen_random_uuid(), $1, $2, $3, 'milestone', gen_random_uuid(), 'probe (test)')`,
        [orgId, A, p2],
        { code: '23503' },
      );
      // Positive control: the same row pointing at B (same organization) is accepted.
      await c.query(
        `insert into cross_project_dependency (id, org_id, project_id, other_project_id, other_item_type, other_item_id, description) values (gen_random_uuid(), $1, $2, $3, 'milestone', $4, 'control (test)')`,
        [orgId, A, B, msB],
      );
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  it('history: prerequisites appear in the activity feed of plan readers; cross-project dependencies only to audit readers', async () => {
    const feed = (await pm.get(`/api/v1/projects/${A}/activity?entityType=record_dependency&pageSize=100`).expect(200)).body;
    expect(feed.items.some((i: { action: string }) => i.action.startsWith('planning.prerequisite.'))).toBe(true);
    // Minimum disclosure: the single-project feed cannot check the other end, so it never lists these (404 for the type).
    expect((await pm.get(`/api/v1/projects/${A}/activity?entityType=cross_project_dependency`)).status).toBe(404);
    const all = (await pm.get(`/api/v1/projects/${A}/activity?pageSize=100`).expect(200)).body.items as { entityType: string }[];
    expect(all.some((i) => i.entityType === 'cross_project_dependency')).toBe(false);
  });
});
