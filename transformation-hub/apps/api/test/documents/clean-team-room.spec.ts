import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, demoUserId, owner, projectIdByCode, runtimePool } from '../helpers';
import { createWithVersion, docsPath, drainWorker, getBinary, login, orgOf, DocClient } from './doc-helpers';

let dcId: string;
let orgId: string;
let roomId: string;
let otherRoomId: string;
let cleanteam: DocClient;
let cleanteamUserId: string;
let otherRoomDocId: string;

beforeAll(async () => {
  dcId = await projectIdByCode(DC);
  orgId = await orgOf(dcId);
  cleanteamUserId = await demoUserId('cleanteam');
  const pmId = await demoUserId('pm');
  const secretaryId = await demoUserId('secretary');
  // Fixtures (the JV module owns room administration): one clean-team room granted to the clean-team persona with the
  // room-scoped clean_team role, and another clean-team room it has no grant for.
  roomId = (await owner().query(`insert into partner_room (org_id, project_id, name, is_clean_team, classification) values ($1,$2,'CT room A (synthetic)',true,'strictly_confidential') returning id`, [orgId, dcId])).rows[0].id;
  otherRoomId = (await owner().query(`insert into partner_room (org_id, project_id, name, is_clean_team, classification) values ($1,$2,'CT room B (synthetic)',true,'strictly_confidential') returning id`, [orgId, dcId])).rows[0].id;
  await owner().query(`insert into room_grant (org_id, project_id, room_id, user_id, role, reason, granted_by) values ($1,$2,$3,$4,'clean_team','fixture',$5)`, [orgId, dcId, roomId, cleanteamUserId, pmId]);
  await owner().query(`insert into room_grant (org_id, project_id, room_id, user_id, reason, granted_by) values ($1,$2,$3,$4,'fixture',$5)`, [orgId, dcId, otherRoomId, secretaryId, pmId]);
  const secretary = await login('secretary');
  const other = await createWithVersion(secretary, dcId, { title: 'CT room B analysis (synthetic)', roomId: otherRoomId }, { bytes: Buffer.from('Synthetic room B analysis.'), name: 'b.txt' });
  expect(other.upload.status).toBe(201);
  otherRoomDocId = other.id;
  cleanteam = await login('cleanteam');
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('Room-only principals (clean team) work with the versions of their own room only [REQ-ENT-012, REQ-SEC-007, REQ-SEC-013]', () => {
  let docId: string;
  let versionId: string;
  const bytes = Buffer.from('Synthetic clean-team working paper (demo).');

  it('a clean-team member uploads a version into the granted room and downloads it', async () => {
    const created = await createWithVersion(cleanteam, dcId, { title: 'CT room A working paper (synthetic)', classification: 'internal', roomId }, { bytes, name: 'ct-paper.txt' });
    expect(created.upload.status, JSON.stringify(created.upload.body)).toBe(201);
    docId = created.id;
    versionId = created.upload.body.versionId;
    const v = (await owner().query('select room_id, uploaded_by from document_version where id = $1', [versionId])).rows[0];
    expect(v).toEqual({ room_id: roomId, uploaded_by: cleanteamUserId }); // room derived from the document
    const dl = await getBinary(cleanteam, `${docsPath(dcId)}/${docId}/versions/${versionId}/download`);
    expect(dl.status).toBe(200);
    expect(Buffer.from(dl.body as Buffer).equals(bytes)).toBe(true);
    const second = await cleanteam.upload(`${docsPath(dcId)}/${docId}/versions`, Buffer.from('Second synthetic draft.'), 'ct-paper-v2.txt');
    expect(second.status).toBe(201);
    expect(second.body.versionNo).toBe(2);
    const detail = await cleanteam.get(`${docsPath(dcId)}/${docId}`).expect(200);
    expect(detail.body.versions.map((x: { versionNo: number }) => x.versionNo)).toEqual([2, 1]);
  });

  it('sees nothing outside the room: other documents, versions and rooms are 404 and absent from lists', async () => {
    const list = await cleanteam.get(`${docsPath(dcId)}?pageSize=100`).expect(200);
    expect(list.body.items.length).toBeGreaterThan(0);
    expect(list.body.items.every((d: { roomId: string | null }) => d.roomId === roomId)).toBe(true);
    const expected = await owner().query('select count(*)::int n from document where project_id = $1 and room_id = $2 and deleted_at is null', [dcId, roomId]);
    expect(list.body.total).toBe(expected.rows[0].n);
    const charter = (await owner().query(`select id, current_version_id from document where project_id = $1 and title = 'Demo — charter excerpt'`, [dcId])).rows[0];
    expect((await cleanteam.get(`${docsPath(dcId)}/${charter.id}`)).status).toBe(404);
    expect((await cleanteam.get(`${docsPath(dcId)}/${charter.id}/versions/${charter.current_version_id}/download`)).status).toBe(404);
    const otherVersion = (await owner().query('select current_version_id from document where id = $1', [otherRoomDocId])).rows[0].current_version_id;
    expect((await cleanteam.get(`${docsPath(dcId)}/${otherRoomDocId}`)).status).toBe(404);
    expect((await cleanteam.get(`${docsPath(dcId)}/${otherRoomDocId}/versions/${otherVersion}/download`)).status).toBe(404);
    const search = await cleanteam.get(`${docsPath(dcId)}/search?q=${encodeURIComponent('charter excerpt')}`).expect(200);
    expect(search.body.total).toBe(0);
    // Documents outside any room cannot be created by a room-only principal.
    expect((await cleanteam.post(docsPath(dcId), { title: 'outside', kind: 'evidence', classification: 'internal' })).status).toBe(404);
    expect((await cleanteam.post(docsPath(dcId), { title: 'other room', kind: 'evidence', classification: 'internal', roomId: otherRoomId })).status).toBe(404);
  });

  it('database: a room-only session reads only its room\'s documents, versions and evidence; the room is not indexed', async () => {
    const criterion = (await owner().query('select id from gate_criterion where project_id = $1 limit 1', [dcId])).rows[0].id;
    const pmId = await demoUserId('pm');
    await owner().query(`insert into evidence_link (org_id, project_id, target_type, target_id, document_id, document_version_id, added_by, note) values ($1,$2,'gate_criterion',$3,$4,$5,$6,'fixture')`, [orgId, dcId, criterion, docId, versionId, pmId]);
    const c = await runtimePool().connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('app.org_id',$1,true), set_config('app.user_id',$2,true), set_config('app.project_ids',$3,true), set_config('app.full_project_ids','',true), set_config('app.room_ids',$4,true)`, [orgId, cleanteamUserId, dcId, roomId]);
      for (const t of ['document', 'document_version', 'evidence_link']) {
        const r = await c.query(`select distinct room_id from ${t} where project_id = $1`, [dcId]);
        expect(r.rows.map((x) => x.room_id), t).toEqual([roomId]);
      }
      const versions = await c.query('select count(*)::int n from document_version where project_id = $1', [dcId]);
      const expected = await owner().query('select count(*)::int n from document_version where project_id = $1 and room_id = $2', [dcId, roomId]);
      expect(versions.rows[0].n).toBe(expected.rows[0].n);
      await c.query('rollback');
    } finally {
      c.release();
    }
    await drainWorker();
    expect((await owner().query('select count(*)::int n from document_chunk where document_id = $1', [docId])).rows[0].n).toBe(0);
  });
});
