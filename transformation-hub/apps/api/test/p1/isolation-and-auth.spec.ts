import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonymous, closeApp, closePools, DC, GEN, loginAs, owner, projectIdByCode, runtimePool, Client } from '../helpers';

let dcId: string;
let genId: string;
let pm: Client;
let pmB: Client;

beforeAll(async () => {
  dcId = await projectIdByCode(DC);
  genId = await projectIdByCode(GEN);
  pm = await loginAs('pm');
  pmB = await loginAs('pm.b');
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('AT-03 — cross-project isolation (API layer) [REQ-SEC-007, REQ-ENT]', () => {
  it('lists only authorized projects', async () => {
    // (Other test files may add projects for the PM; assert inclusion/exclusion rather than exact lists.)
    const a = await pm.get('/api/v1/projects').expect(200);
    const aCodes = a.body.items.map((p: { code: string }) => p.code);
    expect(aCodes).toContain(DC);
    expect(aCodes).not.toContain(GEN);
    expect(a.body.total).toBe(aCodes.length);
    const b = await pmB.get('/api/v1/projects').expect(200);
    expect(b.body.items.map((p: { code: string }) => p.code)).toEqual([GEN]);
  });

  it('returns 404 (not 403) for another project and leaks no title', async () => {
    for (const path of ['', '/workstreams', '/members', '/activity']) {
      const r = await pmB.get(`/api/v1/projects/${dcId}${path}`);
      expect(r.status).toBe(404);
      expect(JSON.stringify(r.body)).not.toMatch(/Carve-out|DEMO-DC|WS0/);
    }
  });

  it('a non-existent project and an unauthorized project are indistinguishable', async () => {
    const unknown = await pmB.get('/api/v1/projects/00000000-0000-7000-8000-000000000000');
    const other = await pmB.get(`/api/v1/projects/${dcId}`);
    expect(unknown.status).toBe(other.status);
    expect(unknown.body.code).toBe(other.body.code);
  });

  it('mutations against another project are rejected and audited as denied', async () => {
    const before = await owner().query(`select count(*)::int n from audit_event where outcome = 'denied' and actor_user_id = $1`, [pmB.userId]);
    const r = await pmB.patch(`/api/v1/projects/${dcId}`, { expectedVersion: 1, name: 'hijack' });
    expect(r.status).toBe(404);
    const after = await owner().query(`select count(*)::int n from audit_event where outcome = 'denied' and actor_user_id = $1`, [pmB.userId]);
    expect(after.rows[0].n).toBe(before.rows[0].n + 1);
    const name = await owner().query('select name from project where id = $1', [dcId]);
    expect(name.rows[0].name).not.toBe('hijack');
  });
});

describe('AT-03 — database row-level security as defense in depth [REQ-SEC-007]', () => {
  it('runtime role sees nothing without a context', async () => {
    const r = await runtimePool().query('select count(*)::int n from task');
    expect(r.rows[0].n).toBe(0);
    const p = await runtimePool().query('select count(*)::int n from project');
    expect(p.rows[0].n).toBe(0);
  });

  it('runtime role scoped to project B cannot read or write project A rows', async () => {
    const c = await runtimePool().connect();
    try {
      await c.query('begin');
      const org = await owner().query('select org_id from project where id = $1', [genId]);
      // Full member of project B only (app.full_project_ids carries full-membership scope; see ADR-0003 room model).
      await c.query(`select set_config('app.org_id', $1, true), set_config('app.project_ids', $2, true), set_config('app.full_project_ids', $2, true)`, [org.rows[0].org_id, genId]);
      const seen = await c.query('select distinct project_id from task');
      expect(seen.rows.map((r) => r.project_id)).toEqual([genId]);
      const leak = await c.query('select count(*)::int n from task where project_id = $1', [dcId]);
      expect(leak.rows[0].n).toBe(0);
      await expect(
        c.query(`insert into risk (org_id, project_id, code, title, probability, impact) values ($1, $2, 'X-1', 'x', 1, 1)`, [org.rows[0].org_id, dcId]),
      ).rejects.toThrow(/row-level security/);
      await c.query('rollback');
    } finally {
      c.release();
    }
  });

  it('composite FKs prevent linking a record to another project\'s workstream', async () => {
    const ws = await owner().query('select id from workstream where project_id = $1 limit 1', [dcId]);
    const org = await owner().query('select org_id from project where id = $1', [genId]);
    await expect(
      owner().query(`insert into risk (org_id, project_id, workstream_id, code, title, probability, impact) values ($1, $2, $3, 'X-2', 'x', 1, 1)`, [
        org.rows[0].org_id,
        genId,
        ws.rows[0].id,
      ]),
    ).rejects.toThrow(/foreign key/);
  });
});

describe('Authentication, CSRF, sessions [REQ-SEC]', () => {
  it('requires authentication', async () => {
    const a = await anonymous();
    const r = await a.get('/api/v1/projects');
    expect(r.status).toBe(401);
    expect(r.headers['content-type']).toMatch(/problem\+json/);
  });

  it('rejects state-changing requests without the CSRF header', async () => {
    const r = await pm.agent.post('/api/v1/me/locale').send({ locale: 'ar' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('auth.csrf');
  });

  it('logout revokes the session server-side', async () => {
    const c = await loginAs('contributor');
    await c.get('/api/v1/me').expect(200);
    await c.post('/api/v1/auth/logout').expect(201);
    await c.get('/api/v1/me').expect(401);
  });

  it('deactivating a user revokes their sessions immediately', async () => {
    const victim = await loginAs('contributor.b');
    await victim.get('/api/v1/me').expect(200);
    const admin = await loginAs('platform.admin');
    await admin.post(`/api/v1/admin/users/${victim.userId}/deactivate`, { reason: 'test' }).expect(201);
    await victim.get('/api/v1/me').expect(401);
    await owner().query('update app_user set is_active = true, deactivated_at = null where id = $1', [victim.userId]);
  });

  it('platform admin has account administration but no project content', async () => {
    const admin = await loginAs('platform.admin');
    await admin.get('/api/v1/admin/users').expect(200);
    const projects = await admin.get('/api/v1/projects').expect(200);
    expect(projects.body.total).toBe(0);
    await admin.get(`/api/v1/projects/${dcId}`).expect(404);
  });

  it('validation errors are 400 problem+json', async () => {
    const r = await pm.patch(`/api/v1/projects/${dcId}`, { expectedVersion: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('validation_failed');
  });
});

describe('Membership changes take effect immediately (AT-19 precondition) [REQ-SEC]', () => {
  it('revoking a role removes access on the next request', async () => {
    const admin = await loginAs('portfolio.admin');
    // pm.b is cleared to 'confidential' (the DC project's classification) but has no DC role yet.
    const c = pmB;
    await c.get(`/api/v1/projects/${dcId}`).expect(404);
    const grant = await admin.post(`/api/v1/projects/${dcId}/members`, { userId: c.userId, role: 'contributor', reason: 'temporary test access' }).expect(201);
    await c.get(`/api/v1/projects/${dcId}`).expect(200);
    await admin.post(`/api/v1/projects/${dcId}/members/${grant.body.id}/revoke`, { reason: 'test done' }).expect(201);
    await c.get(`/api/v1/projects/${dcId}`).expect(404);
  });

  it('a member whose clearance is below the project classification cannot open it', async () => {
    const admin = await loginAs('portfolio.admin');
    const low = await loginAs('platform.admin'); // clearance 'internal'
    const g = await admin.post(`/api/v1/projects/${dcId}/members`, { userId: low.userId, role: 'contributor', reason: 'clearance test' }).expect(201);
    await low.get(`/api/v1/projects/${dcId}`).expect(404);
    await admin.post(`/api/v1/projects/${dcId}/members/${g.body.id}/revoke`, { reason: 'done' }).expect(201);
  });

  it('a project manager cannot grant themselves or higher-authority roles', async () => {
    const self = await pm.post(`/api/v1/projects/${dcId}/members`, { userId: pm.userId, role: 'legal_restricted', reason: 'self grant' });
    expect(self.status).toBe(403);
    const sponsor = await pm.post(`/api/v1/projects/${dcId}/members`, { userId: pmB.userId, role: 'sponsor', reason: 'escalation attempt' });
    expect(sponsor.status).toBe(403);
    const roomRole = await pm.post(`/api/v1/projects/${dcId}/members`, { userId: pmB.userId, role: 'clean_team', reason: 'wrong scope' });
    expect(roomRole.status).toBe(422);
  });
});
