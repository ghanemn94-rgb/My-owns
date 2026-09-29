import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonymous, closeApp, closePools, DC, owner, projectIdByCode, runtimePool } from '../helpers';
import { createWithVersion, docsPath, drainWorker, getBinary, login, orgOf, DocClient } from './doc-helpers';

let dcId: string;
let orgId: string;
let pm: DocClient;
let legal: DocClient;

const doc = (id: string) => owner().query('select * from document where id = $1', [id]).then((r) => r.rows[0]);
const rejectedAudits = (id: string, action: string) =>
  owner()
    .query(`select count(*)::int n from audit_event where entity_id = $1 and action = $2 and outcome = 'rejected'`, [id, action])
    .then((r) => r.rows[0].n as number);

beforeAll(async () => {
  dcId = await projectIdByCode(DC);
  orgId = await orgOf(dcId);
  pm = await login('pm');
  legal = await login('legal');
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('AT-27 — deletion/change under legal hold or retention is rejected and audited [REQ-DAT-009, REQ-DAT-010, REQ-DAT-011]', () => {
  let heldId: string;
  let requestId: string;

  it('the demo seed placed a legal hold (placed by Legal, audited)', async () => {
    const r = await owner().query(`select id, legal_hold, legal_hold_reason from document where project_id = $1 and title = 'Demo — minutes extract (legal hold)'`, [dcId]);
    expect(r.rows[0]).toMatchObject({ legal_hold: true });
    const a = await owner().query(`select count(*)::int n from audit_event where entity_id = $1 and action = 'documents.legal_hold.place' and outcome = 'success'`, [r.rows[0].id]);
    expect(a.rows[0].n).toBe(1);
  });

  it('disposal requested before a hold is refused once the hold is placed — 422 + audited, the document is untouched', async () => {
    heldId = (await createWithVersion(pm, dcId, { title: 'AT-27 hold probe (synthetic)' }, { bytes: Buffer.from('Synthetic hold probe.'), name: 'hold.txt' })).id;
    let d = await doc(heldId);
    const req = await pm.post(`${docsPath(dcId)}/${heldId}/disposal-requests`, { expectedVersion: d.version, reason: 'Demo: no longer needed' }).expect(201);
    requestId = req.body.requestId;
    const pmHold = await pm.post(`${docsPath(dcId)}/${heldId}/legal-hold`, { expectedVersion: d.version, hold: true, reason: 'x' });
    expect(pmHold.status).toBe(403); // only Legal manages holds
    await legal.post(`${docsPath(dcId)}/${heldId}/legal-hold`, { expectedVersion: d.version, hold: true, reason: 'Demo investigation hold' }).expect(201);
    d = await doc(heldId);
    const r = await legal.post(`${docsPath(dcId)}/${heldId}/dispose`, { expectedVersion: d.version, requestId, reason: 'Demo disposal' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('documents.legal_hold_active');
    expect(await rejectedAudits(heldId, 'documents.document.dispose')).toBe(1);
    const after = await doc(heldId);
    expect(after.deleted_at).toBeNull();
    expect((await owner().query('select status from approval_request where id = $1', [requestId])).rows[0].status).toBe('pending');
  });

  it('new disposal requests and new versions are refused while the hold is active', async () => {
    const d = await doc(heldId);
    const r = await pm.post(`${docsPath(dcId)}/${heldId}/disposal-requests`, { expectedVersion: d.version, reason: 'again' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('documents.legal_hold_active');
    expect(await rejectedAudits(heldId, 'documents.disposal.request')).toBe(1);
    const seeded = (await owner().query(`select id, version from document where project_id = $1 and title = 'Demo — minutes extract (legal hold)'`, [dcId])).rows[0];
    const r2 = await pm.post(`${docsPath(dcId)}/${seeded.id}/disposal-requests`, { expectedVersion: seeded.version, reason: 'Demo' });
    expect(r2.status).toBe(422);
    expect(r2.body.code).toBe('documents.legal_hold_active');
    expect(await rejectedAudits(seeded.id, 'documents.disposal.request')).toBe(1);
    const up = await pm.upload(`${docsPath(dcId)}/${seeded.id}/versions`, Buffer.from('replacement'), 'minutes.txt');
    expect(up.status).toBe(422);
    expect(up.body.code).toBe('documents.legal_hold_active');
  });

  it('the database refuses soft deletion under hold or retention even when the API is bypassed (hub_app role)', async () => {
    const retained = (await createWithVersion(pm, dcId, { title: 'AT-27 retention probe (synthetic)', retentionUntil: '2099-12-31' }, { bytes: Buffer.from('Synthetic retention probe.'), name: 'retain.txt' })).id;
    const c = await runtimePool().connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('app.org_id',$1,true), set_config('app.project_ids',$2,true), set_config('app.full_project_ids',$2,true)`, [orgId, dcId]);
      await c.query('savepoint s1');
      await expect(c.query('update document set deleted_at = now() where id = $1', [heldId])).rejects.toThrow(/legal_hold_violation/);
      await c.query('rollback to savepoint s1');
      await expect(c.query('update document set deleted_at = now() where id = $1', [retained])).rejects.toThrow(/retention_violation/);
      await c.query('rollback to savepoint s1');
      await expect(c.query('delete from document where id = $1', [retained])).rejects.toThrow(/permission denied|retention_violation/);
      await c.query('rollback');
    } finally {
      c.release();
    }
    const d = await doc(retained);
    const r = await pm.post(`${docsPath(dcId)}/${retained}/disposal-requests`, { expectedVersion: d.version, reason: 'Demo' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('documents.retention_active');
    expect(await rejectedAudits(retained, 'documents.disposal.request')).toBe(1);
  });

  it('after release, disposal needs a fresh request by someone else, not the owner; it is soft, audited and invalidates the index', async () => {
    let d = await doc(heldId);
    await legal.post(`${docsPath(dcId)}/${heldId}/legal-hold`, { expectedVersion: d.version, hold: false, reason: 'Demo investigation closed' }).expect(201);
    d = await doc(heldId);
    const stale = await legal.post(`${docsPath(dcId)}/${heldId}/dispose`, { expectedVersion: d.version, requestId, reason: 'Demo disposal' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('documents.disposal_request_stale');
    const task = (await owner().query('select id from task where project_id = $1 limit 1', [dcId])).rows[0].id;
    const ev = await pm.post(`/api/v1/projects/${dcId}/evidence`, { targetType: 'task', targetId: task, documentId: heldId }).expect(201);
    await drainWorker();
    expect((await owner().query('select count(*)::int n from document_chunk where document_id = $1', [heldId])).rows[0].n).toBeGreaterThan(0);
    const fresh = await pm.post(`${docsPath(dcId)}/${heldId}/disposal-requests`, { expectedVersion: d.version, reason: 'Demo: superseded by a newer record' }).expect(201);
    expect((await owner().query('select status from approval_request where id = $1', [requestId])).rows[0].status).toBe('invalidated');
    const byPm = await pm.post(`${docsPath(dcId)}/${heldId}/dispose`, { expectedVersion: d.version, requestId: fresh.body.requestId, reason: 'x' });
    expect(byPm.status).toBe(403); // PM has no dispose permission
    const ok = await legal.post(`${docsPath(dcId)}/${heldId}/dispose`, { expectedVersion: d.version, requestId: fresh.body.requestId, reason: 'Demo authorised disposal' }).expect(201);
    expect(ok.body.id).toBe(heldId);
    const gone = await doc(heldId);
    expect(gone.deleted_at).not.toBeNull();
    expect(gone.deleted_by).toBe(legal.userId);
    expect((await owner().query('select count(*)::int n from document_version where document_id = $1', [heldId])).rows[0].n).toBe(1); // soft: versions kept
    expect((await pm.get(`${docsPath(dcId)}/${heldId}`)).status).toBe(404);
    const v = gone.current_version_id;
    expect((await pm.get(`${docsPath(dcId)}/${heldId}/versions/${v}/download`)).status).toBe(404);
    expect((await owner().query('select count(*)::int n from document_chunk where document_id = $1', [heldId])).rows[0].n).toBe(0);
    const rec = await owner().query('select approver_user_id, authority_basis from approval_record where approval_request_id = $1', [fresh.body.requestId]);
    expect(rec.rows[0].approver_user_id).toBe(legal.userId);
    expect(rec.rows[0].authority_basis).toMatch(/Demo/);
    expect((await owner().query('select status from evidence_link where id = $1', [ev.body.id])).rows[0].status).toBe('superseded');
    const audit = await owner().query(`select actor_user_id from audit_event where entity_id = $1 and action = 'documents.document.dispose' and outcome = 'success'`, [heldId]);
    expect(audit.rows.map((r) => r.actor_user_id)).toEqual([legal.userId]);
  });

  it('separation of duties: the document owner cannot dispose of it', async () => {
    const own = (await createWithVersion(legal, dcId, { title: 'AT-27 legal-owned probe (synthetic)' }, { bytes: Buffer.from('Synthetic legal-owned probe.'), name: 'legal.txt' })).id;
    const d = await doc(own);
    const req = await pm.post(`${docsPath(dcId)}/${own}/disposal-requests`, { expectedVersion: d.version, reason: 'Demo' }).expect(201);
    const r = await legal.post(`${docsPath(dcId)}/${own}/dispose`, { expectedVersion: d.version, requestId: req.body.requestId, reason: 'x' });
    expect(r.status).toBe(403);
    expect(r.body.detail).toMatch(/Separation of duties/);
    expect((await doc(own)).deleted_at).toBeNull();
  });
});

describe('Sensitive-access logging of downloads [REQ-SEC-019, REQ-DAT-012]', () => {
  it('every successful download is audited with the actor, version and checksum; there is no public URL', async () => {
    const d = (await owner().query(`select id, current_version_id from document where project_id = $1 and title = 'Demo — charter excerpt'`, [dcId])).rows[0];
    const r = await getBinary(pm, `${docsPath(dcId)}/${d.id}/versions/${d.current_version_id}/download`);
    expect(r.status).toBe(200);
    expect(r.body.toString('utf8')).toContain('DEMO — SYNTHETIC CONTENT');
    const a = await owner().query(
      `select actor_user_id, outcome, after from audit_event where entity_id = $1 and action = 'documents.document.download' order by seq desc limit 1`,
      [d.current_version_id],
    );
    expect(a.rows[0]).toMatchObject({ actor_user_id: pm.userId, outcome: 'success' });
    expect(a.rows[0].after.sha256).toMatch(/^[0-9a-f]{64}$/);
    const detail = await pm.get(`${docsPath(dcId)}/${d.id}`).expect(200);
    expect(JSON.stringify(detail.body)).not.toMatch(/storage|\.data|objects\//i);
    const anon = await anonymous();
    expect((await anon.get(`${docsPath(dcId)}/${d.id}/versions/${d.current_version_id}/download`)).status).toBe(401);
  });
});
