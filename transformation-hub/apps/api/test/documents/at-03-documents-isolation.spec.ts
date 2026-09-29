import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, GEN, owner, projectIdByCode, runtimePool } from '../helpers';
import { createWithVersion, docsPath, drainWorker, getBinary, login, orgOf, DocClient } from './doc-helpers';

let dcId: string;
let genId: string;
let orgId: string;
let pm: DocClient;
let pmB: DocClient;
let contributor: DocClient;
let secretary: DocClient;
let restrictedId: string;
let restrictedVersionId: string;
let roomId: string;
let roomDocId: string;

const RESTRICTED_TITLE = 'Demo — restricted finance note';
const ROOM_TITLE = 'AT-03 room-only memo (synthetic)';

beforeAll(async () => {
  dcId = await projectIdByCode(DC);
  genId = await projectIdByCode(GEN);
  orgId = await orgOf(dcId);
  pm = await login('pm');
  pmB = await login('pm.b');
  contributor = await login('contributor');
  secretary = await login('secretary');
  const r = await owner().query('select id, current_version_id from document where project_id = $1 and title = $2', [dcId, RESTRICTED_TITLE]);
  restrictedId = r.rows[0].id;
  restrictedVersionId = r.rows[0].current_version_id;
  // A partner room with a grant for the secretary only (fixture — the JV module owns room management).
  roomId = (await owner().query(`insert into partner_room (org_id, project_id, name, is_clean_team, classification) values ($1,$2,'AT-03 demo room (synthetic)',false,'confidential') returning id`, [orgId, dcId])).rows[0].id;
  await owner().query(`insert into room_grant (org_id, project_id, room_id, user_id, reason, granted_by) values ($1,$2,$3,$4,'AT-03 fixture',$4)`, [orgId, dcId, roomId, secretary.userId]);
  secretary = await login('secretary'); // fresh session → scope now includes the room
  const room = await createWithVersion(secretary, dcId, { title: ROOM_TITLE, kind: 'dd_material', roomId }, { bytes: Buffer.from('Synthetic room memo: quokka valuation workshop notes.'), name: 'room-memo.txt' });
  expect(room.upload.status).toBe(201);
  roomDocId = room.id;
  await drainWorker(); // build the chunk index so content search is exercised too
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('AT-03 — another project\'s documents are invisible and indistinguishable from non-existent ones [REQ-SEC-006, REQ-SEC-007, REQ-ENT-013]', () => {
  it('every documents/evidence/source route of project A returns 404 to a project-B user, without titles', async () => {
    const someDoc = (await owner().query('select id, current_version_id from document where project_id = $1 and current_version_id is not null limit 1', [dcId])).rows[0];
    const task = (await owner().query('select id from task where project_id = $1 limit 1', [dcId])).rows[0].id;
    const src = (await owner().query('select id from source_record where project_id = $1 limit 1', [dcId])).rows[0].id;
    const paths = [
      docsPath(dcId),
      `${docsPath(dcId)}/search?q=Demo`,
      `${docsPath(dcId)}/${someDoc.id}`,
      `${docsPath(dcId)}/${someDoc.id}/versions/${someDoc.current_version_id}/download`,
      `/api/v1/projects/${dcId}/evidence?targetType=task&targetId=${task}`,
      `/api/v1/projects/${dcId}/sources`,
      `/api/v1/projects/${dcId}/sources/${src}`,
      `/api/v1/projects/${dcId}/sources/${src}/compare`,
    ];
    for (const p of paths) {
      const r = await pmB.get(p);
      expect(r.status, p).toBe(404);
      expect(JSON.stringify(r.body), p).not.toMatch(/Demo —|charter|finance note|IMG_B65D/i);
    }
    const unknown = await pmB.get(`${docsPath('00000000-0000-7000-8000-000000000000')}`);
    const other = await pmB.get(docsPath(dcId));
    expect(unknown.status).toBe(other.status);
    expect(unknown.body.code).toBe(other.body.code);
  });

  it('writes into project A by a project-B user are rejected (404) and audited as denied; nothing is created', async () => {
    const before = await owner().query('select count(*)::int n from document where project_id = $1', [dcId]);
    const r = await pmB.post(docsPath(dcId), { title: 'hijack', kind: 'evidence' });
    expect(r.status).toBe(404);
    const up = await pmB.upload(`${docsPath(dcId)}/${restrictedId}/versions`, Buffer.from('x'), 'x.txt');
    expect(up.status).toBe(404);
    const after = await owner().query('select count(*)::int n from document where project_id = $1', [dcId]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const denied = await owner().query(`select count(*)::int n from audit_event where actor_user_id = $1 and outcome = 'denied' and action in ('documents.createDocument','documents.uploadVersion')`, [pmB.userId]);
    expect(denied.rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it('the database itself hides project A documents and chunks from a project-B scoped session (RLS)', async () => {
    const c = await runtimePool().connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('app.org_id',$1,true), set_config('app.project_ids',$2,true), set_config('app.full_project_ids',$2,true)`, [orgId, genId]);
      for (const t of ['document', 'document_version', 'document_chunk', 'evidence_link', 'source_record', 'source_claim']) {
        const n = await c.query(`select count(*)::int n from ${t} where project_id = $1`, [dcId]);
        expect(n.rows[0].n, t).toBe(0);
      }
      await c.query('rollback');
    } finally {
      c.release();
    }
  });
});

describe('AT-03 — classification and room ACL inside SQL: lists, counts, search, evidence, download [REQ-ENT-012, REQ-ENT-013, REQ-SEC-007, REQ-AI-006]', () => {
  it('list totals equal the count of rows the caller may see — restricted and room documents are neither listed nor counted', async () => {
    const all = await contributor.get(`${docsPath(dcId)}?pageSize=100`).expect(200);
    const titles = all.body.items.map((d: { title: string }) => d.title);
    expect(titles).not.toContain(RESTRICTED_TITLE);
    expect(titles).not.toContain(ROOM_TITLE);
    const expected = await owner().query(
      `select count(*)::int n from document where project_id = $1 and deleted_at is null and room_id is null and classification in ('public','internal','confidential')`,
      [dcId],
    );
    expect(all.body.total).toBe(expected.rows[0].n);
    const sec = await secretary.get(`${docsPath(dcId)}?pageSize=100`).expect(200);
    const secTitles = sec.body.items.map((d: { title: string }) => d.title);
    expect(secTitles).toEqual(expect.arrayContaining([RESTRICTED_TITLE, ROOM_TITLE]));
    const secExpected = await owner().query(
      `select count(*)::int n from document where project_id = $1 and deleted_at is null and (room_id is null or room_id = $2) and classification <> 'strictly_confidential'`,
      [dcId, roomId],
    );
    expect(sec.body.total).toBe(secExpected.rows[0].n);
    // A filter on the hidden classification returns nothing (not a smaller "restricted" count).
    const filtered = await contributor.get(`${docsPath(dcId)}?classification=restricted`).expect(200);
    expect(filtered.body).toMatchObject({ total: 0, items: [] });
  });

  it('title and content search never return hidden titles or snippets', async () => {
    for (const q of ['finance note', 'classification filtering', 'quokka', 'room-only memo']) {
      const r = await contributor.get(`${docsPath(dcId)}/search?q=${encodeURIComponent(q)}`).expect(200);
      expect(JSON.stringify(r.body), q).not.toMatch(/restricted finance note|quokka|room-only memo/i);
      expect(r.body.items.every((h: { documentId: string }) => h.documentId !== restrictedId && h.documentId !== roomDocId), q).toBe(true);
    }
    const secHit = await secretary.get(`${docsPath(dcId)}/search?q=quokka`).expect(200);
    expect(secHit.body.items.map((h: { documentId: string; matchedIn: string }) => [h.documentId, h.matchedIn])).toContainEqual([roomDocId, 'content']);
    const secTitle = await secretary.get(`${docsPath(dcId)}/search?q=${encodeURIComponent('finance note')}`).expect(200);
    expect(secTitle.body.items.map((h: { documentId: string }) => h.documentId)).toContain(restrictedId);
    // Filters narrow the visible set only (same predicate as the list); totals follow the filter.
    const filtered = await secretary.get(`${docsPath(dcId)}/search?q=${encodeURIComponent('finance note')}&classification=confidential`).expect(200);
    expect(filtered.body.items.map((h: { documentId: string }) => h.documentId)).not.toContain(restrictedId);
    expect(filtered.body.total).toBe(filtered.body.items.length);
    const byKind = await secretary.get(`${docsPath(dcId)}/search?q=${encodeURIComponent('finance note')}&kind=financial_model&classification=restricted`).expect(200);
    expect(byKind.body.items.map((h: { documentId: string }) => h.documentId)).toEqual([restrictedId]);
  });

  it('direct reads and downloads of hidden documents are 404 (existence not revealed)', async () => {
    for (const [client, id] of [
      [contributor, restrictedId],
      [pm, restrictedId],
      [pm, roomDocId],
    ] as [DocClient, string][]) {
      expect((await client.get(`${docsPath(dcId)}/${id}`)).status).toBe(404);
    }
    const dl = await contributor.get(`${docsPath(dcId)}/${restrictedId}/versions/${restrictedVersionId}/download`);
    expect(dl.status).toBe(404);
    const ok = await getBinary(secretary, `${docsPath(dcId)}/${restrictedId}/versions/${restrictedVersionId}/download`);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('a user without the room grant cannot place documents in (or discover) that room', async () => {
    const r = await pm.post(docsPath(dcId), { title: 'probe', kind: 'evidence', roomId });
    expect(r.status).toBe(404);
    const above = await contributor.post(docsPath(dcId), { title: 'probe', kind: 'evidence', classification: 'restricted' });
    expect(above.status).toBe(422);
    expect(above.body.code).toBe('documents.classification_above_clearance');
  });

  it('evidence lists omit links to documents the caller cannot read — including from the total', async () => {
    const criterion = (await owner().query('select id from gate_criterion where project_id = $1 order by sort_order limit 1', [dcId])).rows[0].id;
    await owner().query(
      `insert into evidence_link (org_id, project_id, target_type, target_id, document_id, document_version_id, added_by, purpose) values ($1,$2,'gate_criterion',$3,$4,$5,$6,'AT-03 fixture')`,
      [orgId, dcId, criterion, restrictedId, restrictedVersionId, secretary.userId],
    );
    const path = `/api/v1/projects/${dcId}/evidence?targetType=gate_criterion&targetId=${criterion}`;
    const c = await contributor.get(path).expect(200);
    expect(c.body.items.every((l: { documentId: string | null }) => l.documentId !== restrictedId)).toBe(true);
    expect(c.body.total).toBe(c.body.items.length);
    expect(JSON.stringify(c.body)).not.toMatch(/restricted finance note/i);
    const s = await secretary.get(path).expect(200);
    expect(s.body.items.map((l: { documentId: string | null }) => l.documentId)).toContain(restrictedId);
    expect(s.body.total).toBe(c.body.total + 1);
  });

  it('the chunk index carries the parent document ACL and is filtered by it', async () => {
    const chunks = await owner().query('select classification, room_id from document_chunk where document_id = $1', [roomDocId]);
    expect(chunks.rows.length).toBeGreaterThan(0);
    for (const ch of chunks.rows) expect(ch).toEqual({ classification: 'confidential', room_id: roomId });
  });
});

describe('ACL changes invalidate the index and follow separation of duties [REQ-AI-008, REQ-DAT-014, REQ-ENT-012]', () => {
  it('title search in the list endpoint is scoped and literal', async () => {
    const r = await pm.get(`${docsPath(dcId)}?q=${encodeURIComponent('charter excerpt')}`).expect(200);
    expect(r.body.items.map((d: { title: string }) => d.title)).toContain('Demo — charter excerpt');
    expect(r.body.total).toBe(r.body.items.length);
    const wild = await pm.get(`${docsPath(dcId)}?q=${encodeURIComponent('%')}`).expect(200);
    expect(wild.body.total).toBe(0); // "%" is matched literally, not as a wildcard
  });

  it('declassification: never by the document owner; otherwise audited with permission.changed and index invalidation', async () => {
    const legal = await login('legal');
    const own = await createWithVersion(legal, dcId, { title: 'ACL legal-owned (synthetic)' }, { bytes: Buffer.from('Synthetic legal-owned text.'), name: 'l.txt' });
    const d1 = (await owner().query('select version from document where id = $1', [own.id])).rows[0];
    const self = await legal.post(`${docsPath(dcId)}/${own.id}/declassify`, { expectedVersion: d1.version, classification: 'internal', reason: 'Demo' });
    expect(self.status).toBe(403);
    const other = await createWithVersion(pm, dcId, { title: 'ACL pm-owned (synthetic)' }, { bytes: Buffer.from('Synthetic pm-owned text.'), name: 'p.txt' });
    await drainWorker();
    expect((await owner().query('select count(*)::int n from document_chunk where document_id = $1', [other.id])).rows[0].n).toBe(1);
    const d2 = (await owner().query('select version from document where id = $1', [other.id])).rows[0];
    const up = await legal.post(`${docsPath(dcId)}/${other.id}/classify`, { expectedVersion: d2.version, classification: 'internal', reason: 'x' });
    expect(up.status).toBe(422);
    expect(up.body.code).toBe('documents.use_declassify');
    await legal.post(`${docsPath(dcId)}/${other.id}/declassify`, { expectedVersion: d2.version, classification: 'internal', reason: 'Demo: public-facing summary' }).expect(201);
    expect((await owner().query('select count(*)::int n from document_chunk where document_id = $1', [other.id])).rows[0].n).toBe(0);
    const ev = await owner().query(`select payload from outbox_event where type = 'permission.changed' and aggregate_id = $1`, [other.id]);
    expect(ev.rows[0].payload).toMatchObject({ change: 'classification', from: 'confidential', to: 'internal' });
  });

  it('room moves: out of a partner room is audited and re-exposes the document; clean-team material cannot leave and is never indexed', async () => {
    const d = (await owner().query('select version from document where id = $1', [roomDocId])).rows[0];
    await secretary.post(`${docsPath(dcId)}/${roomDocId}/move-room`, { expectedVersion: d.version, roomId: null, reason: 'Demo: released to the project team' }).expect(201);
    expect((await pm.get(`${docsPath(dcId)}/${roomDocId}`)).status).toBe(200);
    const ct = (await owner().query(`insert into partner_room (org_id, project_id, name, is_clean_team) values ($1,$2,'AT-03 clean team room (synthetic)',true) returning id`, [orgId, dcId])).rows[0].id;
    await owner().query(`insert into room_grant (org_id, project_id, room_id, user_id, reason, granted_by) values ($1,$2,$3,$4,'AT-03 fixture',$4)`, [orgId, dcId, ct, secretary.userId]);
    const sec = await login('secretary');
    const ctDoc = await createWithVersion(sec, dcId, { title: 'AT-03 clean-team analysis (synthetic)', roomId: ct }, { bytes: Buffer.from('Synthetic clean-team analysis.'), name: 'ct.txt' });
    expect(ctDoc.upload.status).toBe(201);
    await drainWorker();
    expect((await owner().query('select count(*)::int n from document_chunk where document_id = $1', [ctDoc.id])).rows[0].n).toBe(0);
    const v = (await owner().query('select version from document where id = $1', [ctDoc.id])).rows[0];
    const out = await sec.post(`${docsPath(dcId)}/${ctDoc.id}/move-room`, { expectedVersion: v.version, roomId: null, reason: 'x' });
    expect(out.status).toBe(422);
    expect(out.body.code).toBe('documents.clean_team_release_required');
    const into = await pm.post(`${docsPath(dcId)}/${restrictedId}/move-room`, { expectedVersion: 1, roomId: ct, reason: 'x' });
    expect(into.status).toBe(404); // PM can neither see the restricted document nor the room
  });
});

