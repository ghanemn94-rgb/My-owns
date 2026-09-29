import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PoolClient } from 'pg';
import { closeApp, closePools, DC, GEN, getApp, loginAs, owner, projectIdByCode, runtimePool, demoUserId } from '../helpers';
import { DbService } from '../../src/platform/db.service';
import { JobQueue } from '../../src/platform/jobs/job-queue.service';
import { DeliveryService } from '../../src/platform/delivery.service';
import { RateLimiter } from '../../src/platform/rate-limiter';

let dcId: string;
let genId: string;
let orgId: string;

async function asRuntime<T>(ctx: { org: string; user?: string; projects: string[]; full: string[]; rooms: string[] }, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await runtimePool().connect();
  try {
    await c.query('begin');
    await c.query(
      `select set_config('app.org_id',$1,true), set_config('app.user_id',$2,true), set_config('app.project_ids',$3,true),
              set_config('app.full_project_ids',$4,true), set_config('app.room_ids',$5,true)`,
      [ctx.org, ctx.user ?? '', ctx.projects.join(','), ctx.full.join(','), ctx.rooms.join(',')],
    );
    return await fn(c);
  } finally {
    await c.query('rollback').catch(() => undefined);
    c.release();
  }
}

beforeAll(async () => {
  dcId = await projectIdByCode(DC);
  genId = await projectIdByCode(GEN);
  orgId = (await owner().query('select org_id from project where id = $1', [dcId])).rows[0].org_id;
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('ARCH-01 / REQ-DAT-002 — cross-project links are rejected by the database', () => {
  it('rejects a Project-B evidence link that targets a Project-A task (reviewer probe 8)', async () => {
    const taskA = (await owner().query('select id from task where project_id = $1 limit 1', [dcId])).rows[0].id;
    await expect(
      owner().query(`insert into evidence_link (org_id, project_id, target_type, target_id, note, added_by) values ($1, $2, 'task', $3, 'probe', gen_random_uuid())`, [orgId, genId, taskA]),
    ).rejects.toThrow(/cross_project_reference/);
    // the same link inside Project A is accepted
    const ok = await owner().query(`insert into evidence_link (org_id, project_id, target_type, target_id, note, added_by) values ($1, $2, 'task', $3, 'ok', gen_random_uuid()) returning id`, [orgId, dcId, taskA]);
    expect(ok.rows[0].id).toBeTruthy();
  });

  it('rejects unsupported polymorphic target types and cross-project schedule dependencies', async () => {
    const taskA = (await owner().query('select id from task where project_id = $1 limit 1', [dcId])).rows[0].id;
    const taskB = (await owner().query('select id from task where project_id = $1 limit 1', [genId])).rows[0].id;
    await expect(owner().query(`insert into evidence_link (org_id, project_id, target_type, target_id, added_by) values ($1, $2, 'banana', $3, gen_random_uuid())`, [orgId, dcId, taskA])).rejects.toThrow(/invalid_target_type/);
    await expect(
      owner().query(`insert into dependency (org_id, project_id, predecessor_type, predecessor_id, successor_type, successor_id) values ($1, $2, 'task', $3, 'task', $4)`, [orgId, dcId, taskA, taskB]),
    ).rejects.toThrow(/cross_project_reference/);
  });

  it('document_chunk ACL attributes are derived from the document, not the caller', async () => {
    const doc = await owner().query(`insert into document (org_id, project_id, title, kind, classification) values ($1, $2, 'ACL probe', 'evidence', 'restricted') returning id`, [orgId, dcId]);
    const ver = await owner().query(
      `insert into document_version (org_id, project_id, document_id, version_no, storage_key, filename, mime_type, size_bytes, sha256, uploaded_by) values ($1,$2,$3,1,'k','f.txt','text/plain',1,repeat('a',64),gen_random_uuid()) returning id`,
      [orgId, dcId, doc.rows[0].id],
    );
    const ch = await owner().query(
      `insert into document_chunk (org_id, project_id, document_id, document_version_id, classification, ordinal, text) values ($1,$2,$3,$4,'public',0,'x') returning classification, room_id`,
      [orgId, dcId, doc.rows[0].id, ver.rows[0].id],
    );
    expect(ch.rows[0]).toEqual({ classification: 'restricted', room_id: null });
    await owner().query(`update document set classification = 'strictly_confidential' where id = $1`, [doc.rows[0].id]);
    const after = await owner().query(`select classification from document_chunk where document_id = $1`, [doc.rows[0].id]);
    expect(after.rows[0].classification).toBe('strictly_confidential');
  });
});

describe('ARCH-02 — room-only principals (external partner / clean team) see only their rooms', () => {
  let roomId: string;
  let otherRoomId: string;
  let partnerId: string;

  beforeAll(async () => {
    partnerId = await demoUserId('partner.alpha');
    roomId = (await owner().query(`insert into partner_room (org_id, project_id, name, is_clean_team) values ($1,$2,'Demo room Alpha (test)',false) returning id`, [orgId, dcId])).rows[0].id;
    otherRoomId = (await owner().query(`insert into partner_room (org_id, project_id, name, is_clean_team) values ($1,$2,'Other room (test)',false) returning id`, [orgId, dcId])).rows[0].id;
    await owner().query(`insert into room_grant (org_id, project_id, room_id, user_id, role, reason, granted_by) values ($1,$2,$3,$4,'external_partner_limited','test',$4)`, [orgId, dcId, roomId, partnerId]);
    await owner().query(`insert into document (org_id, project_id, title, kind, classification, room_id) values ($1,$2,'In-room doc','dd_material','confidential',$3)`, [orgId, dcId, roomId]);
    await owner().query(`insert into document (org_id, project_id, title, kind, classification, room_id) values ($1,$2,'Other-room doc','dd_material','confidential',$3)`, [orgId, dcId, otherRoomId]);
  });

  it('RLS: no plan/governance rows, only in-room documents and the granted room', async () => {
    await asRuntime({ org: orgId, user: partnerId, projects: [dcId], full: [], rooms: [roomId] }, async (c) => {
      expect((await c.query('select count(*)::int n from task')).rows[0].n).toBe(0);
      expect((await c.query('select count(*)::int n from workstream')).rows[0].n).toBe(0);
      const docs = await c.query('select title from document order by title');
      expect(docs.rows.map((r) => r.title)).toEqual(['In-room doc']);
      const rooms = await c.query('select name from partner_room');
      expect(rooms.rows.map((r) => r.name)).toEqual(['Demo room Alpha (test)']);
    });
  });

  it('API: the partner cannot read the project workspace or lists', async () => {
    const partner = await loginAs('partner.alpha');
    const list = await partner.get('/api/v1/projects').expect(200);
    expect(list.body.total).toBe(0);
    for (const path of ['', '/workstreams', '/members', '/activity']) {
      const r = await partner.get(`/api/v1/projects/${dcId}${path}`);
      expect([403, 404]).toContain(r.status);
    }
  });
});

describe('ARCH-03 / ARCH-05 / ARCH-06 — database hardening', () => {
  it('runtime role cannot create temporary objects (no pg_temp shadowing of SECURITY DEFINER functions)', async () => {
    await expect(runtimePool().query('create temp table organization (id uuid, slug text)')).rejects.toThrow(/permission denied/);
  });

  it('TRUNCATE of the audit log is rejected', async () => {
    await expect(owner().query('truncate audit_event')).rejects.toThrow(/append_only_violation/);
  });

  it('audit rows must carry the session user as actor', async () => {
    const pm = await demoUserId('pm');
    const other = await demoUserId('sponsor');
    await asRuntime({ org: orgId, user: pm, projects: [dcId], full: [dcId], rooms: [] }, async (c) => {
      await expect(c.query(`insert into audit_event (org_id, actor_user_id, actor_kind, action) values ($1, $2, 'user', 'forged')`, [orgId, other])).rejects.toThrow(/audit_actor_mismatch/);
    });
  });

  it('checkpoints make tail truncation detectable (tamper simulated inside a rolled-back transaction)', async () => {
    await owner().query('select hub_audit_checkpoint($1)', [orgId]);
    const c = await owner().connect();
    try {
      await c.query('begin');
      await c.query('alter table audit_event disable trigger hub_append_only');
      await c.query('delete from audit_event where chain_pos = (select max(chain_pos) from audit_event where org_id = $1)', [orgId]);
      const v = await c.query('select * from hub_audit_verify($1)', [orgId]);
      expect(v.rows.length).toBe(1);
      expect(v.rows[0].actual).toMatch(/checkpoint mismatch/);
    } finally {
      await c.query('rollback');
      c.release();
    }
    const intact = await owner().query('select * from hub_audit_verify($1)', [orgId]);
    expect(intact.rows).toEqual([]);
  });

  it('recusals are append-only and document versions keep their storage identity', async () => {
    const d = await owner().query(`insert into document (org_id, project_id, title, kind) values ($1,$2,'immutable probe','evidence') returning id`, [orgId, dcId]);
    const v = await owner().query(
      `insert into document_version (org_id, project_id, document_id, version_no, storage_key, filename, mime_type, size_bytes, sha256, uploaded_by) values ($1,$2,$3,1,'k1','f.txt','text/plain',1,repeat('b',64),gen_random_uuid()) returning id`,
      [orgId, dcId, d.rows[0].id],
    );
    await expect(owner().query(`update document_version set storage_key = 'swapped' where id = $1`, [v.rows[0].id])).rejects.toThrow(/append_only_violation/);
    await owner().query(`update document_version set scan_status = 'clean' where id = $1`, [v.rows[0].id]);
    await expect(owner().query(`delete from document_version where id = $1`, [v.rows[0].id])).rejects.toThrow(/retention_violation/);
  });
});

describe('ARCH-07 / ARCH-08 / AT-20 — transaction context, job fencing, delivery ledger', () => {
  it('a nested run() with a different principal is refused', async () => {
    const app = await getApp();
    const db = app.get(DbService);
    const base = { correlationId: 'c', sessionId: null, ip: null, authMethod: 'test', locale: 'en' as const };
    const ctxA = { ...base, projectIds: [dcId], principal: { kind: 'service' as const, userId: null, orgId, displayName: 'a', email: null, clearance: 'internal' as const, isDemo: false, orgRoles: new Set<never>(), projects: new Map(), serviceIdentity: 'svc-a' } };
    const ctxB = { ...base, projectIds: [genId], principal: { ...ctxA.principal, serviceIdentity: 'svc-b' } };
    await expect(db.run(ctxA, () => db.run(ctxB, async () => 1))).rejects.toThrow(/Nested DbService.run/);
  });

  it('a worker that lost its lease cannot complete the job; poison jobs are dead-lettered', async () => {
    const app = await getApp();
    const q = app.get(JobQueue);
    const key = `test:fencing:${Date.now()}`;
    await q.enqueueDirect({ kind: 'system.noop', orgId, projectId: null, payload: {}, idempotencyKey: key, maxAttempts: 2 });
    const [a] = (await q.claim('worker-A', 50, 1)).filter((j) => j.idempotency_key === key);
    expect(a).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    const [b] = (await q.claim('worker-B', 50, 60_000)).filter((j) => j.idempotency_key === key);
    expect(b).toBeTruthy();
    expect(await q.complete(a!, { from: 'A' })).toBe(false); // fenced
    expect(await q.complete(b!, { from: 'B' })).toBe(true);
    const row = await owner().query('select status, result from job where idempotency_key = $1', [key]);
    expect(row.rows[0]).toMatchObject({ status: 'succeeded', result: { from: 'B' } });

    const poison = `test:poison:${Date.now()}`;
    await q.enqueueDirect({ kind: 'system.noop', orgId, projectId: null, payload: {}, idempotencyKey: poison, maxAttempts: 1 });
    await q.claim('worker-C', 50, 1);
    await new Promise((r) => setTimeout(r, 20));
    await q.claim('worker-D', 50, 60_000);
    const p = await owner().query('select status from job where idempotency_key = $1', [poison]);
    expect(p.rows[0].status).toBe('dead');
  });

  it('AT-20: a delivery is started at most once and a crash leaves it "uncertain", never re-sent', async () => {
    const app = await getApp();
    const d = app.get(DeliveryService);
    const key = `test:delivery:${Date.now()}`;
    const first = await d.begin({ orgId, projectId: null, idempotencyKey: key, channel: 'email', payload: { x: 1 } });
    expect(first.proceed).toBe(true);
    const retry = await d.begin({ orgId, projectId: null, idempotencyKey: key, channel: 'email', payload: { x: 1 } });
    expect(retry).toMatchObject({ proceed: false, existingStatus: 'sending' });
    await owner().query(`update delivery_record set updated_at = now() - interval '1 hour' where idempotency_key = $1`, [key]);
    expect(await d.reconcileStale(10)).toBeGreaterThanOrEqual(1);
    const r = await owner().query('select status from delivery_record where idempotency_key = $1', [key]);
    expect(r.rows[0].status).toBe('uncertain');
  });

  it('rate limiter enforces per-minute windows', async () => {
    const app = await getApp();
    const rl = app.get(RateLimiter);
    const t0 = 1_000_000;
    let allowed = 0;
    for (let i = 0; i < 200; i++) if (rl.hit('probe-session', 'mutation', t0)) allowed++;
    expect(allowed).toBe(120);
    expect(rl.hit('probe-session', 'mutation', t0 + 61_000)).toBe(true);
  });
});

describe('ARCH-10 / ARCH-12 — reference flow fixes', () => {
  it('a project manager cannot revoke a role it could not grant (e.g. sponsor)', async () => {
    const pm = await loginAs('pm');
    const sponsorMembership = await owner().query(`select m.id from project_membership m join app_user u on u.id = m.user_id where m.project_id = $1 and m.role = 'sponsor' and m.revoked_at is null limit 1`, [dcId]);
    const r = await pm.post(`/api/v1/projects/${dcId}/members/${sponsorMembership.rows[0].id}/revoke`, { reason: 'attempt' });
    expect(r.status).toBe(403);
  });

  it('activity feed is allowlisted and hides free-text reasons from non-auditors', async () => {
    const c = await loginAs('contributor');
    const feed = await c.get(`/api/v1/projects/${dcId}/activity`).expect(200);
    for (const item of feed.body.items) expect(item.reason).toBeNull();
    const r = await c.get(`/api/v1/projects/${dcId}/activity?entityType=request`);
    expect(r.status).toBe(404);
  });
});
