import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { closeApp, closePools, loginAs, owner, projectIdByCode, runtimePool, Client, GEN } from '../helpers';
import { insertDecisionRow } from '../gates/gate-test-kit';
import { syntheticUser } from '../jv/jv-kit';
import { P, completePlan, createCheck, grantWorkstreamRole, insertSite, orgOf, plusDays, setupProject, workstreamId, Personas, drainWorker } from './readiness-kit';

/**
 * Project isolation and scoped reads for readiness / cutover / TSA (AT-03, ARCH-02/14): other-project users get 404,
 * submitted foreign ids are never trusted (404 + composite FKs), lists and counts apply visibility and workstream reach
 * in SQL, and PostgreSQL RLS hides the rows even from a direct runtime-role query.
 */
let projectId: string;
let genId: string;
let orgId: string;
let p: Personas;
let pmB: Client;
let ws07: string;
let ws01: string;
let checkWs07: string;
let checkWs01: string;
let planId: string;
let tsaId: string;

async function asRuntime<T>(projects: string[], fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await runtimePool().connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.org_id',$1,true), set_config('app.project_ids',$2,true), set_config('app.full_project_ids',$2,true)`, [orgId, projects.join(',')]);
    return await fn(c);
  } finally {
    await c.query('rollback').catch(() => undefined);
    c.release();
  }
}

beforeAll(async () => {
  ({ projectId, p } = await setupProject('RD-ISO'));
  genId = await projectIdByCode(GEN);
  orgId = await orgOf(projectId);
  pmB = await loginAs('pm.b');
  ws07 = await workstreamId(p.pm, projectId, 'WS07');
  ws01 = await workstreamId(p.pm, projectId, 'WS01');
  checkWs07 = await createCheck(p.pm, projectId, { area: 'operations', title: 'WS07 operations check (test)', workstreamId: ws07, signoffRole: 'functional_approver' });
  checkWs01 = await createCheck(p.pm, projectId, { area: 'billing', title: 'WS01 billing check (test)', workstreamId: ws01, signoffRole: 'functional_approver' });
  planId = await completePlan(p.pm, projectId, { accountableUserId: p.pm.userId });
  const t = await p.pm.post(`${P(projectId)}/tsa-services`, { name: 'Isolation test TSA (synthetic)', endDate: plusDays(40), startDate: plusDays(-5) });
  expect(t.status, JSON.stringify(t.body)).toBe(201);
  tsaId = t.body.id;
  // A workstream-only principal: Technology lead with a WS07 lead role and NO project role. The shared gates test kit
  // also makes tech.lead lead of the first workstream — revoke that here so WS07 is its ONLY grant in this project.
  await owner().query(
    `update project_membership set revoked_at = now(), revoked_by = granted_by where project_id = $1 and user_id = (select id from app_user where email = $2) and revoked_at is null`,
    [projectId, 'demo.tech.lead@demo.invalid'],
  );
  await grantWorkstreamRole(projectId, 'tech.lead', 'workstream_lead', ws07);
});
afterAll(async () => {
  await drainWorker(); // leave no queued job of this spec behind (full handler registry)
  await closeApp();
  await closePools();
});

describe('Readiness isolation — other projects, foreign ids, workstream reach, RLS [AT-03, REQ-RDY-001, REQ-TSA-001]', () => {
  it('a Project-B user gets 404 on every readiness read and command of Project A (existence not leaked)', async () => {
    const gets = [
      `${P(projectId)}/readiness/summary`,
      `${P(projectId)}/readiness-checks`,
      `${P(projectId)}/readiness-checks/${checkWs07}`,
      `${P(projectId)}/readiness-waivers`,
      `${P(projectId)}/cutover-plans`,
      `${P(projectId)}/cutover-plans/${planId}`,
      `${P(projectId)}/tsa-services`,
      `${P(projectId)}/tsa-services/${tsaId}`,
    ];
    for (const g of gets) expect((await pmB.get(g)).status, g).toBe(404);
    const posts: [string, Record<string, unknown>][] = [
      [`${P(projectId)}/readiness-checks`, { area: 'power', title: 'x' }],
      [`${P(projectId)}/readiness-checks/${checkWs07}/test-runs`, { expectedVersion: 1, result: 'failed' }],
      [`${P(projectId)}/cutover-plans/${planId}/go-no-go`, { expectedVersion: 1, outcome: 'no_go', rationale: 'x' }],
      [`${P(projectId)}/tsa-services/${tsaId}/transition`, { expectedVersion: 1, command: 'start_negotiation' }],
    ];
    for (const [path, body] of posts) expect((await pmB.post(path, body)).status, path).toBe(404);
    // …and the same ids under Project B's own path are unknown there too.
    expect((await pmB.get(`${P(genId)}/readiness-checks/${checkWs07}`)).status).toBe(404);
    expect((await pmB.get(`${P(genId)}/tsa-services/${tsaId}`)).status).toBe(404);
  });

  it('room-only principals (partner / clean team) see nothing', async () => {
    for (const persona of ['partner.alpha', 'cleanteam']) {
      const c = await loginAs(persona);
      expect((await c.get(`${P(projectId)}/readiness-checks`)).status, persona).toBe(404);
    }
  });

  it('foreign ids submitted by a Project-A user are rejected (404) — sites, workstreams, plans, decisions', async () => {
    const siteB = await insertSite(genId, 'S-ISO-B');
    const wsB = (await owner().query(`select id from workstream where project_id = $1 limit 1`, [genId])).rows[0].id as string;
    const planB = (await owner().query(`insert into cutover_plan (id, org_id, project_id, code, title) values (gen_random_uuid(), $1, $2, 'CO-ISO-B', 'Project B plan (synthetic)') returning id`, [orgId, genId])).rows[0].id as string;
    for (const body of [{ siteId: siteB }, { workstreamId: wsB }, { cutoverPlanId: planB }]) {
      const r = await p.pm.post(`${P(projectId)}/readiness-checks`, { area: 'power', title: 'Foreign reference (test)', ...body });
      expect(r.status, JSON.stringify(body)).toBe(404);
    }
    const decisionB = await insertDecisionRow(orgId, genId, { code: 'DEC-ISO-B', status: 'approved', authorityOutcome: 'within_mandate' });
    await owner().query(`update decision set decision_type_key = 'day1_go_no_go' where id = $1`, [decisionB]);
    const v = (await p.pm.get(`${P(projectId)}/cutover-plans/${planId}`).expect(200)).body.version;
    expect((await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/go-decision`, { expectedVersion: v, decisionId: decisionB })).status).toBe(404);
    const t = (await p.pm.get(`${P(projectId)}/tsa-services/${tsaId}`).expect(200)).body;
    expect((await p.pm.post(`${P(projectId)}/tsa-services/${tsaId}/request-extension`, { expectedVersion: t.version, decisionId: decisionB, proposedEndDate: plusDays(80), continuityPlan: 'x' })).status).toBe(404);
    // The database refuses the same cross-project links even when the API is bypassed (composite FKs).
    await expect(owner().query(`update readiness_check set cutover_plan_id = $1 where id = $2`, [planB, checkWs07])).rejects.toThrow(/foreign key/);
    await expect(owner().query(`update cutover_plan set go_decision_id = $1 where id = $2`, [decisionB, planId])).rejects.toThrow(/foreign key/);
    await expect(owner().query(`update tsa_service set extension_decision_id = $1 where id = $2`, [decisionB, tsaId])).rejects.toThrow(/foreign key/);
  });

  it('PostgreSQL RLS hides Project-A readiness rows from a Project-B runtime context', async () => {
    const n = await asRuntime([genId], async (c) => {
      const r = await c.query(`select (select count(*) from readiness_check where project_id = $1)::int a, (select count(*) from tsa_service where project_id = $1)::int b, (select count(*) from cutover_plan where project_id = $1)::int c, (select count(*) from cutover_decision_record where project_id = $1)::int d`, [projectId]);
      return r.rows[0];
    });
    expect(n).toEqual({ a: 0, b: 0, c: 0, d: 0 });
    const own = await asRuntime([projectId], async (c) => (await c.query(`select count(*)::int n from readiness_check where project_id = $1`, [projectId])).rows[0].n);
    expect(own).toBeGreaterThan(0);
  });

  it('a workstream-only principal sees and counts only its workstream (reach in SQL); other rows are 404', async () => {
    const lead = await loginAs('tech.lead');
    const list = (await lead.get(`${P(projectId)}/readiness-checks?pageSize=100`).expect(200)).body;
    expect(list.items.map((c: { id: string }) => c.id), JSON.stringify(list.items.map((c: { id: string; title: string; workstreamId: string | null }) => [c.title, c.workstreamId]))).toEqual([checkWs07]);
    expect(list.total).toBe(1);
    expect((await lead.get(`${P(projectId)}/readiness-checks/${checkWs07}`)).status).toBe(200);
    expect((await lead.get(`${P(projectId)}/readiness-checks/${checkWs01}`)).status).toBe(404);
    expect((await lead.get(`${P(projectId)}/tsa-services/${tsaId}`)).status).toBe(404); // no workstream → outside reach
    const summary = (await lead.get(`${P(projectId)}/readiness/summary`).expect(200)).body;
    expect(summary.checks.total).toBe(1);
    expect(summary.tsas.total).toBe(0);
    // Manage only inside the workstream.
    expect((await lead.post(`${P(projectId)}/readiness-checks`, { area: 'billing', title: 'Outside my workstream (test)', workstreamId: ws01 })).status).toBe(403);
    const ok = await lead.post(`${P(projectId)}/readiness-checks`, { area: 'noc', title: 'Inside my workstream (test)', workstreamId: ws07 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    // The project manager sees everything.
    const all = (await p.pm.get(`${P(projectId)}/readiness-checks?pageSize=100`).expect(200)).body;
    expect(all.total).toBeGreaterThan(3);
  });

  it('classification applies in SQL: a TSA raised above the caller’s clearance disappears from their list and count', async () => {
    const t = (await p.pm.get(`${P(projectId)}/tsa-services/${tsaId}`).expect(200)).body;
    // SEC-P34-08 (access-matrix §2.4): the PM (clearance confidential) may not raise the TSA above its own clearance …
    const refused = await p.pm.patch(`${P(projectId)}/tsa-services/${tsaId}`, { expectedVersion: t.version, classification: 'restricted' });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('readiness.classification_above_clearance');
    // … a TSA manager cleared `restricted` does (synthetic project manager, granted through the portfolio API).
    const cleared = await syntheticUser(orgId, 'rd-iso.pm.restricted', 'internal', 'restricted');
    const admin = await loginAs('portfolio.admin');
    const grant = await admin.post(`${P(projectId)}/members`, { userId: cleared.userId, role: 'project_manager', reason: 'Readiness isolation test (TSA manager cleared restricted, synthetic)' });
    expect(grant.status, JSON.stringify(grant.body)).toBe(201);
    const r = await cleared.patch(`${P(projectId)}/tsa-services/${tsaId}`, { expectedVersion: t.version, classification: 'restricted' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const pmList = (await p.pm.get(`${P(projectId)}/tsa-services`).expect(200)).body;
    expect(pmList.items.map((x: { id: string }) => x.id)).not.toContain(tsaId);
    expect(pmList.total).toBe(0);
    expect((await p.pm.get(`${P(projectId)}/tsa-services/${tsaId}`)).status).toBe(404);
    const sponsorList = (await p.sponsor.get(`${P(projectId)}/tsa-services`).expect(200)).body;
    expect(sponsorList.items.map((x: { id: string }) => x.id)).toContain(tsaId);
    // Lowering it again is a declassification, not an edit.
    const down = await p.sponsor.patch(`${P(projectId)}/tsa-services/${tsaId}`, { expectedVersion: r.body.version, classification: 'internal' });
    expect(down.status).toBe(403); // the sponsor holds no readiness.tsa.manage
    expect((await admin.post(`${P(projectId)}/members/${grant.body.id}/revoke`, { reason: 'Readiness isolation test done' })).status).toBe(201);
  });

  it('search terms are literal (LIKE wildcards escaped)', async () => {
    const pct = (await p.pm.get(`${P(projectId)}/readiness-checks?q=${encodeURIComponent('%')}`).expect(200)).body;
    expect(pct.total).toBe(0);
    const hit = (await p.pm.get(`${P(projectId)}/readiness-checks?q=${encodeURIComponent('WS07 operations')}`).expect(200)).body;
    expect(hit.items.map((c: { id: string }) => c.id)).toEqual([checkWs07]);
  });
});
