import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PoolClient } from 'pg';
import { createApp } from '../../src/bootstrap';
import { closeApp, closePools, DC, getApp, loginAs, owner, projectIdByCode, runtimePool, demoUserId } from '../helpers';
import { DbService } from '../../src/platform/db.service';
import { parseTrustProxy } from '../../src/platform/config';

/**
 * Regression tests for the P1 security review (docs/reviews/P1-security-review.md). SEC-P1-01 (OIDC link-by-email) is
 * covered in oidc-sso.spec.ts; SEC-P1-05 (open redirect) in the web client (apps/web/src/lib/safe-next.ts).
 */
let dcId: string;
let orgId: string;

async function asRuntime<T>(ctx: { org: string; user?: string; projects: string[]; full: string[]; rooms: string[]; roomOnly?: boolean }, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await runtimePool().connect();
  try {
    await c.query('begin');
    await c.query(
      `select set_config('app.org_id',$1,true), set_config('app.user_id',$2,true), set_config('app.project_ids',$3,true),
              set_config('app.full_project_ids',$4,true), set_config('app.room_ids',$5,true), set_config('app.room_only',$6,true)`,
      [ctx.org, ctx.user ?? '', ctx.projects.join(','), ctx.full.join(','), ctx.rooms.join(','), ctx.roomOnly ? 'true' : 'false'],
    );
    return await fn(c);
  } finally {
    await c.query('rollback').catch(() => undefined);
    c.release();
  }
}

beforeAll(async () => {
  dcId = await projectIdByCode(DC);
  orgId = (await owner().query('select org_id from project where id = $1', [dcId])).rows[0].org_id;
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('P1 security review regressions', () => {
  it('SEC-P1-02: a demo session stops working when the deployment is no longer in demo mode', async () => {
    const pm = await loginAs('pm');
    const cookie = (await pm.agent.get('/api/v1/me').expect(200)).request.cookies;
    void cookie;
    const saved = process.env.HUB_MODE;
    process.env.HUB_MODE = 'standard';
    const standard = (await createApp({ logger: false })).app;
    try {
      const jar = await pm.agent.jar.getCookies({ domain: '127.0.0.1', path: '/', secure: false, script: false });
      const header = jar.map((c) => `${c.name}=${c.value}`).join('; ');
      await request(standard.getHttpServer()).get('/api/v1/me').set('Cookie', header).expect(401);
      // demo login itself is unavailable in standard mode
      await request(standard.getHttpServer()).get('/api/v1/auth/demo-users').expect(404);
    } finally {
      process.env.HUB_MODE = saved;
      await standard.close();
    }
    // the same session is still fine in demo mode
    await pm.get('/api/v1/me').expect(200);
  });

  it('SEC-P1-03: activity events about records the caller cannot see (room / clearance) are hidden, for auditors too', async () => {
    const auditor = await loginAs('auditor');
    const room = (await owner().query(`insert into partner_room (org_id, project_id, name, is_clean_team) values ($1,$2,'SEC-P1-03 hidden room (test)',true) returning id`, [orgId, dcId])).rows[0].id;
    const hidden = (await owner().query(`insert into document (org_id, project_id, title, kind, room_id) values ($1,$2,'hidden (test)','evidence',$3) returning id`, [orgId, dcId, room])).rows[0].id;
    const visible = (await owner().query(`insert into document (org_id, project_id, title, kind, classification) values ($1,$2,'visible (test)','evidence','internal') returning id`, [orgId, dcId])).rows[0].id;
    for (const id of [hidden, visible]) {
      await owner().query(`insert into audit_event (org_id, project_id, actor_kind, action, entity_type, entity_id, reason) values ($1,$2,'system','documents.document.create','document',$3,'probe (test)')`, [orgId, dcId, id]);
    }
    const h = await auditor.get(`/api/v1/projects/${dcId}/activity?entityType=document&entityId=${hidden}`).expect(200);
    expect(h.body.total).toBe(0); // same answer as for a record that does not exist — no oracle
    const v = await auditor.get(`/api/v1/projects/${dcId}/activity?entityType=document&entityId=${visible}`).expect(200);
    expect(v.body.total).toBe(1);
    const all = await auditor.get(`/api/v1/projects/${dcId}/activity?pageSize=100`).expect(200);
    expect(all.body.items.some((i: { entityId: string }) => i.entityId === hidden)).toBe(false);
  });

  it('SEC-P1-04: HUB_TRUST_PROXY never means "trust everyone"', () => {
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('true')).toBe(1);
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('10.0.0.0/8, 127.0.0.1')).toBe('10.0.0.0/8, 127.0.0.1');
  });

  it('SEC-P1-06: memberships and room grants cannot name a user of another organization', async () => {
    const c = await owner().connect();
    try {
      await c.query('begin');
      const org2 = await c.query(`insert into organization (id, name, slug) values (gen_random_uuid(), 'Other org (test)', 'other-' || substr(md5(random()::text), 1, 8)) returning id`);
      const u2 = await c.query(`insert into app_user (id, org_id, email, display_name) values (gen_random_uuid(), $1, 'x2@other.invalid', 'Other') returning id`, [org2.rows[0].id]);
      await c.query('savepoint s');
      await expect(
        c.query(`insert into project_membership (org_id, project_id, user_id, role, granted_by, reason) values ($1,$2,$3,'contributor',$4,'probe')`, [orgId, dcId, u2.rows[0].id, await demoUserId('pm')]),
      ).rejects.toMatchObject({ code: '23503' });
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  it('SEC-P1-07: public POST routes accept JSON only (no cross-site form login)', async () => {
    const app = await getApp();
    const pmId = await demoUserId('pm');
    const r = await request(app.getHttpServer()).post('/api/v1/auth/demo-login').type('form').send(`userId=${pmId}`);
    expect(r.status).toBe(400);
    expect(String(r.headers['set-cookie'] ?? '')).not.toMatch(/hub_session=[^;]/);
  });

  it('SEC-P1-08: API responses are not cacheable', async () => {
    const pm = await loginAs('pm');
    const r = await pm.get(`/api/v1/projects/${dcId}`).expect(200);
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('SEC-P1-09: raw queries after the transaction has finished fail instead of running without RLS context', async () => {
    const app = await getApp();
    const db = app.get(DbService);
    const ctx = { correlationId: 'c', sessionId: null, ip: null, authMethod: 'test', locale: 'en' as const, projectIds: [], principal: { kind: 'service' as const, userId: null, orgId, displayName: 's', email: null, clearance: 'internal' as const, isDemo: false, orgRoles: new Set<never>(), projects: new Map(), serviceIdentity: 'svc-test' } };
    // A continuation scheduled inside the request (keeps its async context) that runs after the commit.
    let outcome: Promise<unknown> | null = null;
    let fire!: () => void;
    const fired = new Promise<void>((r) => (fire = r));
    await db.run(ctx, async () => {
      setTimeout(() => {
        outcome = db.query('select count(*) from session');
        fire();
      }, 20);
    });
    await fired;
    await expect(outcome!).rejects.toThrow(/Transaction already finished/);
  });

  it('SEC-P1-11: CSRF denials are audited as security events and carry a correlation id', async () => {
    const pm = await loginAs('pm');
    const before = Number((await owner().query(`select count(*)::int n from audit_event where action = 'auth.csrf' and actor_user_id = $1`, [pm.userId])).rows[0].n);
    const r = await pm.agent.post(`/api/v1/projects/${dcId}/raid/risks`).send({ title: 'x', probability: 1, impact: 1 }); // no CSRF header
    expect(r.status).toBe(403);
    expect(r.body.correlationId).toBeTruthy();
    const after = Number((await owner().query(`select count(*)::int n from audit_event where action = 'auth.csrf' and actor_user_id = $1 and outcome = 'denied'`, [pm.userId])).rows[0].n);
    expect(after).toBe(before + 1);
  });

  it('SEC-P1-12: a room-only principal reads neither organization-level audit rows nor the user directory', async () => {
    const partner = await demoUserId('partner.alpha');
    await asRuntime({ org: orgId, user: partner, projects: [dcId], full: [], rooms: [], roomOnly: true }, async (c) => {
      const users = await c.query('select id from app_user');
      expect(users.rows.map((r) => r.id)).toEqual([partner]);
      const audit = await c.query('select count(*)::int n from audit_event where project_id is null');
      expect(audit.rows[0].n).toBe(0);
      const roles = await c.query('select count(*)::int n from org_role_assignment');
      expect(roles.rows[0].n).toBe(0);
    });
    // a normal (full) principal still sees the directory
    await asRuntime({ org: orgId, user: await demoUserId('pm'), projects: [dcId], full: [dcId], rooms: [] }, async (c) => {
      const users = await c.query('select count(*)::int n from app_user');
      expect(users.rows[0].n).toBeGreaterThan(1);
    });
  });
});
