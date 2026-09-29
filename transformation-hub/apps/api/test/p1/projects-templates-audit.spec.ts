import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, loginAs, owner, projectIdByCode, Client } from '../helpers';

let admin: Client;
let pm: Client;

beforeAll(async () => {
  admin = await loginAs('portfolio.admin');
  pm = await loginAs('pm');
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('AT-02 — projects from different templates without code changes [REQ-ENT]', () => {
  it('creates a DC carve-out project and a general transformation project through the API', async () => {
    const templates = (await admin.get('/api/v1/templates').expect(200)).body.items as { id: string; templateKey: string; counts: Record<string, number> }[];
    const dc = templates.find((t) => t.templateKey === 'dc-carveout')!;
    const gen = templates.find((t) => t.templateKey === 'general-transformation')!;
    expect(dc.counts.gates).toBe(8);
    expect(gen.counts.gates).toBe(4);

    const pmId = pm.userId;
    const a = await admin.post('/api/v1/projects', { templateVersionId: dc.id, code: 'AT02-DC', name: 'AT-02 DC project', projectManagerUserId: pmId, newco: { mode: 'new', name: 'Test NewCo', incorporationStatus: 'unconfirmed' } }).expect(201);
    const b = await admin.post('/api/v1/projects', { templateVersionId: gen.id, code: 'AT02-GEN', name: 'AT-02 general project', projectManagerUserId: pmId }).expect(201);
    expect(a.body.created).toMatchObject({ workstreams: 12, gates: 8, statusDimensions: 4 });
    expect(a.body.created.tasks + a.body.created.milestones).toBeGreaterThanOrEqual(80);
    expect(b.body.created).toMatchObject({ workstreams: 4, gates: 4, statusDimensions: 0 });

    // The PM (assigned at creation) now sees both, each with its own phases/gates
    const dcDetail = (await pm.get(`/api/v1/projects/${a.body.id}`).expect(200)).body;
    const genDetail = (await pm.get(`/api/v1/projects/${b.body.id}`).expect(200)).body;
    expect(dcDetail.templateKey).toBe('dc-carveout');
    expect(genDetail.templateKey).toBe('general-transformation');
    expect(dcDetail.dimensions.map((d: { key: string }) => d.key).sort()).toEqual(['incorporation', 'jv_transaction', 'operational_readiness', 'perimeter_transfer']);
    expect(genDetail.dimensions).toEqual([]);
    expect(dcDetail.phases.length).toBeGreaterThan(0);

    // Generated activities are Draft/Unverified (spec §6) and no dates are invented
    const tasks = await owner().query(`select status, verification_status, planned_start, planned_finish from task where project_id = $1`, [a.body.id]);
    expect(new Set(tasks.rows.map((t) => t.status))).toEqual(new Set(['draft']));
    expect(new Set(tasks.rows.map((t) => t.verification_status))).toEqual(new Set(['proposed']));
    expect(tasks.rows.every((t) => t.planned_start === null && t.planned_finish === null)).toBe(true);
    // AI starts OFF for every new project
    const ai = await owner().query(`select mode from ai_project_settings where project_id = $1`, [a.body.id]);
    expect(ai.rows[0].mode).toBe('off');
    // NewCo incorporation self-declared at setup stays unverified
    const ent = await owner().query(`select e.incorporation_status, e.incorporation_verification from legal_entity e join project_entity pe on pe.legal_entity_id = e.id where pe.project_id = $1`, [a.body.id]);
    expect(ent.rows[0]).toMatchObject({ incorporation_status: 'unconfirmed', incorporation_verification: 'unknown' });
  });

  it('only authorized roles can create projects', async () => {
    const templates = (await pm.get('/api/v1/templates').expect(200)).body.items;
    const r = await pm.post('/api/v1/projects', { templateVersionId: templates[0].id, code: 'NOPE-1', name: 'x', projectManagerUserId: pm.userId });
    expect(r.status).toBe(403);
  });

  it('duplicate project codes are rejected', async () => {
    const templates = (await admin.get('/api/v1/templates').expect(200)).body.items;
    const r = await admin.post('/api/v1/projects', { templateVersionId: templates[0].id, code: DC, name: 'dup', projectManagerUserId: pm.userId });
    expect(r.status).toBe(409);
  });
});

describe('AT-16 — optimistic concurrency prevents lost updates [REQ-DAT]', () => {
  it('second writer with a stale version gets 409 and must reload', async () => {
    const id = await projectIdByCode(DC);
    const p = (await pm.get(`/api/v1/projects/${id}`).expect(200)).body;
    const first = await pm.patch(`/api/v1/projects/${id}`, { expectedVersion: p.version, objective: 'first writer' }).expect(200);
    expect(first.body.version).toBe(p.version + 1);
    const second = await pm.patch(`/api/v1/projects/${id}`, { expectedVersion: p.version, objective: 'second writer (stale)' });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('concurrency.version_mismatch');
    const now = (await pm.get(`/api/v1/projects/${id}`).expect(200)).body;
    expect(now.objective).toBe('first writer');
  });
});

describe('Audit trail — append-only and tamper-evident [REQ-DAT, ADR-0014]', () => {
  it('records mutations with actor, before/after and correlation id', async () => {
    const id = await projectIdByCode(DC);
    const r = await owner().query(
      `select actor_user_id, before, after, correlation_id, hash, prev_hash from audit_event where project_id = $1 and action = 'portfolio.project.update' order by chain_pos desc limit 1`,
      [id],
    );
    expect(r.rows[0].actor_user_id).toBe(pm.userId);
    expect(r.rows[0].after).toMatchObject({ objective: 'first writer' });
    expect(r.rows[0].correlation_id).toBeTruthy();
    expect(r.rows[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects UPDATE and DELETE even for the owner role (trigger)', async () => {
    await expect(owner().query(`update audit_event set reason = 'tampered' where seq = (select min(seq) from audit_event)`)).rejects.toThrow(/append_only_violation/);
    await expect(owner().query(`delete from audit_event where seq = (select min(seq) from audit_event)`)).rejects.toThrow(/append_only_violation/);
  });

  it('the hash chain verifies intact', async () => {
    const org = await owner().query(`select id from organization limit 1`);
    const v = await owner().query(`select * from hub_audit_verify($1)`, [org.rows[0].id]);
    expect(v.rows).toEqual([]);
  });

  it('activity feed exposes history without before/after payloads', async () => {
    const id = await projectIdByCode(DC);
    const feed = await pm.get(`/api/v1/projects/${id}/activity?entityType=project&entityId=${id}`).expect(200);
    expect(feed.body.items.length).toBeGreaterThan(0);
    expect(feed.body.items[0]).not.toHaveProperty('before');
    expect(feed.body.items[0]).not.toHaveProperty('after');
  });
});

describe('AT-27 (DB level) — documents under legal hold / retention cannot be deleted [REQ-DAT-010]', () => {
  it('hard delete and soft delete under hold are rejected', async () => {
    const id = await projectIdByCode(DC);
    const org = await owner().query('select org_id from project where id = $1', [id]);
    const doc = await owner().query(
      `insert into document (org_id, project_id, title, kind, legal_hold, legal_hold_reason) values ($1, $2, 'Held evidence', 'evidence', true, 'test hold') returning id`,
      [org.rows[0].org_id, id],
    );
    await expect(owner().query('update document set deleted_at = now() where id = $1', [doc.rows[0].id])).rejects.toThrow(/legal_hold_violation/);
    await expect(owner().query('delete from document where id = $1', [doc.rows[0].id])).rejects.toThrow(/retention_violation/);
  });
});
