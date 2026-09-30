import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, GEN, owner, projectIdByCode } from '../helpers';
import { createWithVersion, login, orgOf, DocClient } from './doc-helpers';

let dcId: string;
let genId: string;
let pm: DocClient;
let finance: DocClient;
let taskId: string;
let docA: string;
let docB: string;

const evidencePath = (pid: string) => `/api/v1/projects/${pid}/evidence`;
const link = (id: string) => owner().query('select * from evidence_link where id = $1', [id]).then((r) => r.rows[0]);

beforeAll(async () => {
  dcId = await projectIdByCode(DC);
  genId = await projectIdByCode(GEN);
  pm = await login('pm');
  finance = await login('finance');
  taskId = (await owner().query(`select id from task where project_id = $1 order by wbs_code desc limit 1`, [dcId])).rows[0].id;
  docA = (await createWithVersion(pm, dcId, { title: 'AT-14 evidence A (synthetic)' }, { bytes: Buffer.from('Synthetic evidence A: acceptance test passed (demo).'), name: 'a.txt' })).id;
  docB = (await createWithVersion(pm, dcId, { title: 'AT-14 evidence B (synthetic)' }, { bytes: Buffer.from('Synthetic evidence B: acceptance test failed (demo).'), name: 'b.txt' })).id;
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('AT-14 — new evidence conflicting with evidence previously relied upon [REQ-LCY-015, REQ-DAT-014, REQ-SRC-007]', () => {
  let linkA: string;
  let linkB: string;

  it('links evidence to a record of the same project and verifies it with separation of duties', async () => {
    const r = await pm.post(evidencePath(dcId), { targetType: 'task', targetId: taskId, documentId: docA, purpose: 'Acceptance evidence (demo)' }).expect(201);
    expect(r.body.status).toBe('active');
    linkA = r.body.id;
    const self = await pm.post(`${evidencePath(dcId)}/${linkA}/verify`, { expectedVersion: 1, decision: 'accept' });
    expect(self.status).toBe(403); // PM lacks evidence.verify; the linker may never verify
    const v = await finance.post(`${evidencePath(dcId)}/${linkA}/verify`, { expectedVersion: 1, decision: 'accept', note: 'Relied upon (demo)' }).expect(201);
    expect(v.body.status).toBe('active');
    const row = await link(linkA);
    expect(row.reviewed_by).toBe(finance.userId);
  });

  it('the finance reviewer cannot verify evidence they linked themselves (not_self)', async () => {
    // A criterion owned by finance_restricted: only the criterion's owner role or a PM may link evidence to it (SEC-P2-05).
    const criterion = (await owner().query(`select id from gate_criterion where project_id = $1 and owner_role = 'finance_restricted' order by sort_order desc, id limit 1`, [dcId])).rows[0].id;
    const own = await finance.post(evidencePath(dcId), { targetType: 'gate_criterion', targetId: criterion, note: 'Finance note-only evidence (demo)' }).expect(201);
    const r = await finance.post(`${evidencePath(dcId)}/${own.body.id}/verify`, { expectedVersion: 1, decision: 'accept' });
    expect(r.status).toBe(403);
    expect(r.body.detail).toMatch(/Separation of duties/);
    const audit = await owner().query(`select count(*)::int n from audit_event where actor_user_id = $1 and outcome = 'denied' and action = 'documents.verifyEvidence'`, [finance.userId]);
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it('a contradicting link flags BOTH links as conflicting, preserves them and the earlier review, and emits evidence.changed', async () => {
    const before = await owner().query(`select count(*)::int n from outbox_event where type = 'evidence.changed' and aggregate_id = $1 and (payload->>'conflict')::boolean`, [taskId]);
    const r = await pm.post(evidencePath(dcId), { targetType: 'task', targetId: taskId, documentId: docB, conflictsWithLinkId: linkA, conflictNote: 'B reports the opposite result (demo)' }).expect(201);
    expect(r.body.status).toBe('conflicting');
    linkB = r.body.id;
    const a = await link(linkA);
    const b = await link(linkB);
    expect(a).toMatchObject({ status: 'conflicting', conflict_with_link_id: linkB, reviewed_by: finance.userId, document_id: docA });
    expect(b).toMatchObject({ status: 'conflicting', conflict_with_link_id: linkA, document_id: docB });
    const ev = await owner().query(`select payload from outbox_event where type = 'evidence.changed' and aggregate_id = $1 and (payload->>'conflict')::boolean order by created_at`, [taskId]);
    expect(ev.rows.length).toBe(before.rows[0].n + 1);
    expect(ev.rows.at(-1)!.payload).toMatchObject({ targetType: 'task', targetId: taskId, conflict: true });
    const counts = await owner().query(`select count(*) filter (where status = 'active')::int active, count(*) filter (where status = 'conflicting')::int conflicting from evidence_link where target_id = $1 and document_id in ($2, $3)`, [taskId, docA, docB]);
    expect(counts.rows[0]).toEqual({ active: 0, conflicting: 2 });
    const list = await pm.get(`${evidencePath(dcId)}?targetType=task&targetId=${taskId}`).expect(200);
    const statuses = Object.fromEntries(list.body.items.map((l: { id: string; status: string }) => [l.id, l.status]));
    expect(statuses[linkA]).toBe('conflicting');
    expect(statuses[linkB]).toBe('conflicting');
  });

  it('re-verification is blocked until the conflict is resolved explicitly; resolution is recorded', async () => {
    const a = await link(linkA);
    const blocked = await finance.post(`${evidencePath(dcId)}/${linkA}/verify`, { expectedVersion: a.version, decision: 'accept' });
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe('evidence.conflict_unresolved');
    const b = await link(linkB);
    await pm.post(`${evidencePath(dcId)}/${linkB}/supersede`, { expectedVersion: b.version, note: 'B was a draft test report (demo)' }).expect(201);
    const ok = await finance.post(`${evidencePath(dcId)}/${linkA}/verify`, { expectedVersion: a.version, decision: 'accept', note: 'Re-verified after resolution' }).expect(201);
    expect(ok.body.status).toBe('active');
    expect((await link(linkB)).status).toBe('superseded'); // kept, not deleted
    const changes = await owner().query(`select payload->>'change' c from outbox_event where type = 'evidence.changed' and aggregate_id = $1 order by created_at`, [taskId]);
    expect(changes.rows.map((r) => r.c)).toEqual(expect.arrayContaining(['linked', 'verified', 'conflict', 'superseded']));
  });

  it('flag-conflict requires two relied-upon links on the SAME record; stale versions are 409', async () => {
    const other = (await owner().query(`select id from task where project_id = $1 and id <> $2 limit 1`, [dcId, taskId])).rows[0].id;
    const l1 = await pm.post(evidencePath(dcId), { targetType: 'task', targetId: other, documentId: docA }).expect(201);
    const l2 = await pm.post(evidencePath(dcId), { targetType: 'task', targetId: taskId, documentId: docB }).expect(201);
    const diff = await pm.post(`${evidencePath(dcId)}/${l1.body.id}/flag-conflict`, { expectedVersion: 1, withLinkId: l2.body.id, note: 'x' });
    expect(diff.status).toBe(422);
    expect(diff.body.code).toBe('evidence.conflict_different_target');
    const stale = await pm.post(`${evidencePath(dcId)}/${l2.body.id}/flag-conflict`, { expectedVersion: 7, withLinkId: linkA, note: 'x' });
    expect(stale.status).toBe(409);
    const ok = await pm.post(`${evidencePath(dcId)}/${l2.body.id}/flag-conflict`, { expectedVersion: 1, withLinkId: linkA, note: 'Second contradiction (demo)' }).expect(201);
    expect(ok.body.status).toBe('conflicting');
    expect((await link(linkA)).status).toBe('conflicting');
  });

  it('evidence can never be linked to another project\'s record (API 404 + database trigger)', async () => {
    const foreignTask = (await owner().query('select id from task where project_id = $1 limit 1', [genId])).rows[0].id;
    const before = await owner().query('select count(*)::int n from evidence_link where target_id = $1', [foreignTask]);
    const r = await pm.post(evidencePath(dcId), { targetType: 'task', targetId: foreignTask, documentId: docA });
    expect(r.status).toBe(404);
    const bogus = await pm.post(evidencePath(dcId), { targetType: 'task', targetId: '00000000-0000-7000-8000-000000000001', note: 'x' });
    expect(bogus.status).toBe(404);
    const orgId = await orgOf(dcId);
    await expect(
      owner().query(`insert into evidence_link (org_id, project_id, target_type, target_id, note, added_by) values ($1,$2,'task',$3,'bypass',$4)`, [orgId, dcId, foreignTask, pm.userId]),
    ).rejects.toThrow(/cross_project_reference/);
    const after = await owner().query('select count(*)::int n from evidence_link where target_id = $1', [foreignTask]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('linking also requires the permission to work on the target record', async () => {
    const approver = await login('approver'); // functional approver: no documents.evidence.link
    const r = await approver.post(evidencePath(dcId), { targetType: 'task', targetId: taskId, note: 'x' });
    expect(r.status).toBe(403);
    const secretary = await login('secretary'); // may link evidence, but lacks the gate permission gates.evidence.attach
    const criterion = (await owner().query('select id from gate_criterion where project_id = $1 limit 1', [dcId])).rows[0].id;
    const g = await secretary.post(evidencePath(dcId), { targetType: 'gate_criterion', targetId: criterion, note: 'x' });
    expect(g.status).toBe(403);
    expect(g.body.code).toBe('evidence.target_permission');
  });
});
