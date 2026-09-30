import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { closeApp, closePools, owner, runtimePool } from '../helpers';
import { P, auditRows, doc, getBinary, grant, in30, login, ok, partnerAt, room, setupJvProject, syntheticUser, DocClient, JvProject } from './jv-kit';

/**
 * AT-03 (partner rooms) — partner A's room is invisible to partner B's users in lists, counts, search, AI and downloads,
 * inside SQL and under RLS; an executed NDA alone grants no document access; clean-team rooms are for clean-team
 * members only; a revoked grant blocks further downloads while the history is retained (AT-19, JV part).
 */
let j: JvProject;
let pid: string;
let A: string; // partner A
let B: string; // partner B
let roomA: string;
let roomB: string;
let extA: DocClient;
let extB: DocClient;
let docA: { id: string; versionId: string };
let discA: string;
let discB: string;
const bytesA = 'Synthetic data-room content for partner A (test).';

async function asRuntime<T>(ctx: { org: string; user: string; projects: string[]; full: string[]; rooms: string[]; roomOnly: boolean }, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await runtimePool().connect();
  try {
    await c.query('begin');
    await c.query(
      `select set_config('app.org_id',$1,true), set_config('app.user_id',$2,true), set_config('app.project_ids',$3,true),
              set_config('app.full_project_ids',$4,true), set_config('app.room_ids',$5,true), set_config('app.room_only',$6,true)`,
      [ctx.org, ctx.user, ctx.projects.join(','), ctx.full.join(','), ctx.rooms.join(','), ctx.roomOnly ? 'true' : 'false'],
    );
    return await fn(c);
  } finally {
    await c.query('rollback').catch(() => undefined);
    c.release();
  }
}

async function releasedDoc(roomId: string, title: string, text: string) {
  const d = await doc(j.p.pm, pid, title, { roomId, text });
  const r = await ok(await j.p.pm.post(`${P(pid)}/partner-rooms/${roomId}/disclosures`, { documentId: d.id, note: 'test' }));
  const rel = await ok(await j.p.legal.post(`${P(pid)}/partner-rooms/${roomId}/disclosures/${r.id}/release`, { expectedVersion: r.version, outcome: 'release' }));
  expect(rel.status).toBe('released');
  return { ...d, disclosureId: r.id as string };
}

beforeAll(async () => {
  j = await setupJvProject('JV-AT03');
  pid = j.projectId;
  const { p } = j;
  A = await partnerAt(j, 'Test Partner A (fictional)');
  B = await partnerAt(j, 'Test Partner B (fictional)');
  extA = await syntheticUser(j.orgId, 'jv.at03.ext.a', 'external');
  extB = await syntheticUser(j.orgId, 'jv.at03.ext.b', 'external');
  await ok(await p.legal.post(`${P(pid)}/partners/${A}/contacts`, { userId: extA.userId }));
  await ok(await p.legal.post(`${P(pid)}/partners/${B}/contacts`, { userId: extB.userId }));
  roomA = (await room(p.pm, pid, { name: 'Room A (test)', type: 'partner', partnerId: A })).id;
  roomB = (await room(p.pm, pid, { name: 'Room B (test)', type: 'partner', partnerId: B })).id;
  for (const r of [roomA, roomB]) {
    await ok(await grant(p.legal, pid, r, { userId: p.sponsor.userId, accessLevel: 'manage' }));
    await ok(await grant(p.sponsor, pid, r, { userId: p.legal.userId, accessLevel: 'manage' }));
  }
  await ok(await grant(p.legal, pid, roomA, { userId: extA.userId, role: 'external_partner_limited', accessLevel: 'contribute', expiresAt: in30() }));
  await ok(await grant(p.legal, pid, roomB, { userId: extB.userId, role: 'external_partner_limited', accessLevel: 'contribute', expiresAt: in30() }));
  const a = await releasedDoc(roomA, 'Partner A data pack (synthetic)', bytesA);
  docA = a;
  discA = a.disclosureId;
  discB = (await releasedDoc(roomB, 'Partner B data pack (synthetic)', 'Synthetic content for partner B (test).')).disclosureId;
  await ok(await extA.post(`${P(pid)}/partner-access/rooms/${roomA}/dd-requests`, { question: 'Partner A question (synthetic)', domain: 'legal' }));
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('AT-03 — partner A vs partner B isolation [AT-03, REQ-JV-001, REQ-ENT-012, REQ-SET-003]', () => {
  it("partner B's user sees only its own room, disclosures and DD requests — A's are 404 (never 403), counts exclude them", async () => {
    const rooms = (await extB.get(`${P(pid)}/partner-access/rooms`).expect(200)).body;
    expect(rooms.items.map((r: { id: string }) => r.id)).toEqual([roomB]);
    const own = (await extB.get(`${P(pid)}/partner-access/rooms/${roomB}/disclosures`).expect(200)).body;
    expect(own.items.map((d: { id: string }) => d.id)).toEqual([discB]);
    expect(JSON.stringify(own)).not.toContain('Partner A');
    for (const path of [`/partner-access/rooms/${roomA}/disclosures`, `/partner-access/rooms/${roomA}/dd-requests`, `/partner-access/rooms/${roomA}/disclosures/${discA}/download`, `/partner-access/rooms/${roomB}/disclosures/${discA}/download`]) {
      const r = await extB.get(`${P(pid)}${path}`);
      expect(r.status, path).toBe(404);
      expect(JSON.stringify(r.body)).not.toContain('Partner A');
    }
    const q = await extB.post(`${P(pid)}/partner-access/rooms/${roomA}/dd-requests`, { question: 'probe', domain: 'legal' });
    expect(q.status).toBe(404);
    const dd = (await extB.get(`${P(pid)}/partner-access/rooms/${roomB}/dd-requests`).expect(200)).body;
    expect(dd.items).toEqual([]);
    // The counterparty lists are session-level routes: the service asserts the external permission, so an internal member
    // (no jv.disclosure.view / jv.dd_request.read_external) is refused: 403 (the PM holds the room's manage grant, so the
    // room's existence is no secret to them), and the finance lead without any grant on room A gets 404.
    expect((await j.p.pm.get(`${P(pid)}/partner-access/rooms`)).status).toBe(403);
    expect((await j.p.pm.get(`${P(pid)}/partner-access/rooms/${roomA}/disclosures`)).status).toBe(403);
    expect((await j.p.pm.get(`${P(pid)}/partner-access/rooms/${roomA}/dd-requests`)).status).toBe(403);
    expect((await j.p.finance.get(`${P(pid)}/partner-access/rooms/${roomA}/disclosures`)).status).toBe(404);
    expect((await j.p.finance.get(`${P(pid)}/partner-access/rooms/${roomA}/dd-requests`)).status).toBe(404);
  });

  it('a Project-B user gets 404 for every JV record of this project (no title, no count)', async () => {
    const pmB = await login('pm.b');
    for (const path of ['/partners', `/partners/${A}`, '/partner-rooms', `/partner-rooms/${roomA}`, `/partner-access/rooms/${roomA}/disclosures`, '/diligence-requests', '/closings', '/deal-scenarios']) {
      const r = await pmB.get(`${P(pid)}${path}`);
      expect(r.status, path).toBe(404);
      expect(JSON.stringify(r.body)).not.toMatch(/Partner A|Room A/);
    }
  });

  it('external accounts have no internal projection: registers, documents, search and AI are refused', async () => {
    for (const path of ['/partners', '/partner-rooms', `/partner-rooms/${roomA}`, '/diligence-requests', '/diligence-findings', '/documents', '/documents/search?q=Partner', '/closings', '/closing-conditions', '/ai/runs']) {
      const r = await extB.get(`${P(pid)}${path}`);
      expect([403, 404], path).toContain(r.status);
      expect(JSON.stringify(r.body)).not.toContain('Partner A');
    }
    const ai = await extB.post(`${P(pid)}/ai/ask`, { question: 'What is in partner A room?' });
    expect([403, 404]).toContain(ai.status);
  });

  it("RLS (defence in depth): partner B's database context holds no row of room A", async () => {
    await asRuntime({ org: j.orgId, user: extB.userId, projects: [pid], full: [], rooms: [roomB], roomOnly: true }, async (c) => {
      expect((await c.query('select id from partner_room')).rows.map((r) => r.id)).toEqual([roomB]);
      expect((await c.query('select room_id from room_disclosure')).rows.every((r) => r.room_id === roomB)).toBe(true);
      expect((await c.query('select count(*)::int n from document where room_id = $1', [roomA])).rows[0].n).toBe(0);
      expect((await c.query('select count(*)::int n from diligence_request where room_id = $1', [roomA])).rows[0].n).toBe(0);
      expect((await c.query('select count(*)::int n from room_access_event where room_id = $1', [roomA])).rows[0].n).toBe(0);
      expect((await c.query('select count(*)::int n from partner')).rows[0].n).toBe(0);
      expect((await c.query('select count(*)::int n from partner_contact')).rows[0].n).toBe(0);
      expect((await c.query('select user_id from room_grant')).rows.map((r) => r.user_id)).toEqual([extB.userId]);
    });
  });

  it('a project member without a grant cannot open a room nor count its content; an administrator sees metadata only', async () => {
    const list = (await j.p.contributor.get(`${P(pid)}/partner-rooms`).expect(200)).body;
    expect(list.total).toBe(0);
    for (const path of [`/partner-rooms/${roomA}`, `/partner-rooms/${roomA}/index`]) expect((await j.p.contributor.get(`${P(pid)}${path}`)).status, path).toBe(404);
    const docs = (await j.p.contributor.get(`${P(pid)}/documents?pageSize=100`).expect(200)).body;
    expect(docs.items.some((d: { roomId: string | null }) => d.roomId === roomA || d.roomId === roomB)).toBe(false);
    // Finance holds jv.room.read (no grant, not an administrator): nothing.
    expect((await j.p.finance.get(`${P(pid)}/partner-rooms`).expect(200)).body.total).toBe(0);
    // The PM administers rooms: metadata of both, openable only where granted (creator grant).
    const pmList = (await j.p.pm.get(`${P(pid)}/partner-rooms`).expect(200)).body;
    expect(pmList.items.map((r: { id: string; canOpen: boolean }) => [r.id, r.canOpen]).sort()).toEqual([[roomA, true], [roomB, true]].sort());
    const opened = (await j.p.pm.get(`${P(pid)}/partner-rooms/${roomA}`).expect(200)).body;
    expect(opened.counts).toMatchObject({ documents: 1, disclosuresReleased: 1, ddRequests: 1 });
    expect((await auditRows(pid, 'jv.room.read', roomA)).length).toBeGreaterThan(0); // audited read
  });
});

describe('REQ-JV-005 — an executed NDA alone grants no document access', () => {
  let C: string;
  let extC: DocClient;
  let roomC: string;
  beforeAll(async () => {
    C = await partnerAt(j, 'Test Partner C (fictional)', 'nda');
    extC = await syntheticUser(j.orgId, 'jv.at03.ext.c', 'external');
    await ok(await j.p.legal.post(`${P(pid)}/partners/${C}/contacts`, { userId: extC.userId }));
    roomC = (await room(j.p.pm, pid, { name: 'Room C (test)', type: 'partner', partnerId: C })).id;
  });

  it('IT: partner with an executed NDA but no grant cannot list room documents', async () => {
    const p = (await j.p.pm.get(`${P(pid)}/partners/${C}`).expect(200)).body;
    expect(p.stage).toBe('nda');
    expect(p.nda.status).toBe('executed');
    // No grant → the project is not even in the external account's scope.
    expect((await extC.get(`${P(pid)}/partner-access/rooms`)).status).toBe(404);
    expect((await extC.get(`${P(pid)}/partner-access/rooms/${roomC}/disclosures`)).status).toBe(404);
  });

  it('a grant is refused while the partner is only at NDA (Materials access is a separate step)', async () => {
    const r = await grant(j.p.legal, pid, roomC, { userId: extC.userId, role: 'external_partner_limited', expiresAt: in30() });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('jv.room.materials_access_required');
    const v = (await j.p.pm.get(`${P(pid)}/partners/${C}`).expect(200)).body.version;
    await ok(await j.p.pm.post(`${P(pid)}/partners/${C}/advance`, { expectedVersion: v, toStage: 'materials_access' }));
    // Materials access alone still opens nothing: only the explicit grant does.
    expect((await extC.get(`${P(pid)}/partner-access/rooms`)).status).toBe(404);
    await ok(await grant(j.p.legal, pid, roomC, { userId: extC.userId, role: 'external_partner_limited', expiresAt: in30() }));
    expect((await extC.get(`${P(pid)}/partner-access/rooms`).expect(200)).body.items.map((x: { id: string }) => x.id)).toEqual([roomC]);
  });

  it("partner B's account can never be granted into partner A's room; internal accounts never hold the external role", async () => {
    const cross = await grant(j.p.legal, pid, roomA, { userId: extB.userId, role: 'external_partner_limited', expiresAt: in30() });
    expect(cross.status).toBe(422);
    expect(cross.body.code).toBe('jv.room.counterparty_mismatch');
    const noRole = await grant(j.p.legal, pid, roomA, { userId: extB.userId });
    expect(noRole.status).toBe(422);
    expect(noRole.body.code).toBe('jv.room.external_role_required');
    const internalExt = await grant(j.p.legal, pid, roomA, { userId: j.p.contributor.userId, role: 'external_partner_limited', expiresAt: in30() });
    expect(internalExt.status).toBe(422);
    expect(internalExt.body.code).toBe('jv.room.external_role_internal_account');
    const self = await grant(j.p.legal, pid, roomB, { userId: j.p.legal.userId });
    expect(self.status).toBe(403);
    // Database guard: even a direct insert cannot give an internal account the external role.
    await expect(
      owner().query(`insert into room_grant (org_id, project_id, room_id, user_id, role, reason, granted_by) values ($1,$2,$3,$4,'external_partner_limited','probe',$5)`, [j.orgId, pid, roomA, j.p.contributor.userId, j.p.legal.userId]),
    ).rejects.toThrow(/external_account_role/);
  });
});

describe('AT-19 (JV) — a revoked grant blocks further downloads; the history is retained [REQ-JV-009]', () => {
  it('download → revoke → 404, and the access/disclosure history keeps every event', async () => {
    const dl = await getBinary(extA, `${P(pid)}/partner-access/rooms/${roomA}/disclosures/${discA}/download`);
    expect(dl.status).toBe(200);
    expect(Buffer.from(dl.body as Buffer).toString()).toBe(bytesA);
    expect((await auditRows(pid, 'jv.disclosure.download', discA)).map((r) => r.outcome)).toEqual(['success']);
    const grants = (await j.p.legal.get(`${P(pid)}/partner-rooms/${roomA}/access-grants`).expect(200)).body.items as { id: string; userId: string; active: boolean }[];
    const g = grants.find((x) => x.userId === extA.userId)!;
    await ok(await j.p.pm.post(`${P(pid)}/partner-rooms/${roomA}/access-grants/${g.id}/revoke`, { reason: 'Test revocation (synthetic)' }));
    const after = await getBinary(extA, `${P(pid)}/partner-access/rooms/${roomA}/disclosures/${discA}/download`);
    expect(after.status).toBe(404);
    const again = (await j.p.legal.get(`${P(pid)}/partner-rooms/${roomA}/access-grants`).expect(200)).body.items as { id: string; active: boolean; revokedAt: string | null }[];
    expect(again.find((x) => x.id === g.id)).toMatchObject({ active: false });
    expect(again.find((x) => x.id === g.id)!.revokedAt).not.toBeNull();
    const log = (await j.p.legal.get(`${P(pid)}/partner-rooms/${roomA}/access-log?pageSize=100`).expect(200)).body;
    const kinds = (log.items as { kind: string; subjectUserId: string | null }[]).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['grant', 'disclosure_requested', 'disclosure_released', 'download', 'grant_revoked']));
    expect(log.items.filter((e: { kind: string; subjectUserId: string | null }) => e.kind === 'download' && e.subjectUserId === extA.userId)).toHaveLength(1);
    const disclosures = (await j.p.legal.get(`${P(pid)}/partner-rooms/${roomA}/disclosures`).expect(200)).body;
    expect(disclosures.items[0]).toMatchObject({ id: discA, status: 'released', documentId: docA.id });
    // History is append-only.
    await expect(owner().query(`delete from room_access_event where room_id = $1`, [roomA])).rejects.toThrow(/append_only_violation/);
    await expect(owner().query(`update room_grant set revoked_at = null where id = $1`, [g.id])).rejects.toThrow(/append_only_violation/);
  });

  it('withdrawing a disclosure stops downloads of it; locking a room suspends every grant immediately', async () => {
    const b = (await extB.get(`${P(pid)}/partner-access/rooms/${roomB}/disclosures`).expect(200)).body.items;
    expect(b).toHaveLength(1);
    const discs = (await j.p.sponsor.get(`${P(pid)}/partner-rooms/${roomB}/disclosures`).expect(200)).body.items as { id: string; version: number }[];
    const rv = await ok(await j.p.sponsor.post(`${P(pid)}/partner-rooms/${roomB}/disclosures/${discB}/revoke`, { expectedVersion: discs.find((d) => d.id === discB)!.version, reason: 'Withdrawn (test)' }));
    expect(rv.status).toBe('revoked');
    expect((await extB.get(`${P(pid)}/partner-access/rooms/${roomB}/disclosures`).expect(200)).body.items).toEqual([]);
    expect((await getBinary(extB, `${P(pid)}/partner-access/rooms/${roomB}/disclosures/${discB}/download`)).status).toBe(404);
    const meta = (await j.p.sponsor.get(`${P(pid)}/partner-rooms?pageSize=100`).expect(200)).body.items.find((r: { id: string }) => r.id === roomB);
    const locked = await ok(await j.p.sponsor.post(`${P(pid)}/partner-rooms/${roomB}/lock`, { expectedVersion: meta.version, reason: 'Containment test (synthetic)' }));
    expect((await extB.get(`${P(pid)}/partner-access/rooms`)).status).toBe(404);
    expect((await j.p.legal.get(`${P(pid)}/partner-rooms/${roomB}`)).status).toBe(404); // internal grants are suspended too
    await ok(await j.p.sponsor.post(`${P(pid)}/partner-rooms/${roomB}/unlock`, { expectedVersion: locked.version, reason: 'Lifted (test)' }));
    expect((await extB.get(`${P(pid)}/partner-access/rooms`).expect(200)).body.items.map((r: { id: string }) => r.id)).toEqual([roomB]);
  });
});

describe('REQ-ENT-012 — clean-team rooms are for clean-team members only', () => {
  let ct: DocClient;
  let ctRoom: string;
  beforeAll(async () => {
    ct = await syntheticUser(j.orgId, 'jv.at03.ct', 'internal', 'strictly_confidential');
    ctRoom = (await room(j.p.legal, pid, { name: 'Clean team room (test)', type: 'clean_team' })).id;
  });

  it('only Legal assigns clean-team membership, with the clean_team role and an attestation', async () => {
    const bySponsor = await grant(j.p.sponsor, pid, ctRoom, { userId: ct.userId, role: 'clean_team', attestationRef: 'CT-TEST-1' });
    expect(bySponsor.status).toBe(403);
    expect(bySponsor.body.code).toBe('jv.room.clean_team_legal_only');
    const noAttest = await grant(j.p.legal, pid, ctRoom, { userId: ct.userId, role: 'clean_team' });
    expect(noAttest.body.code).toBe('jv.room.attestation_required');
    const plain = await grant(j.p.legal, pid, ctRoom, { userId: j.p.pm.userId });
    expect(plain.body.code).toBe('jv.room.clean_team_role_required');
    await ok(await grant(j.p.legal, pid, ctRoom, { userId: ct.userId, role: 'clean_team', accessLevel: 'contribute', attestationRef: 'CT-TEST-1 (synthetic)' }));
    await expect(owner().query(`insert into room_grant (org_id, project_id, room_id, user_id, role, reason, granted_by) values ($1,$2,$3,$4,'clean_team','probe',$5)`, [j.orgId, pid, roomA, ct.userId, j.p.legal.userId])).rejects.toThrow(/clean_team_room_only/);
  });

  it("clean-team findings are visible to the clean team only (room derived, SQL-filtered); the room's creator has no content access", async () => {
    const list = (await ct.get(`${P(pid)}/partner-rooms`).expect(200)).body;
    expect(list.items.map((r: { id: string }) => r.id)).toEqual([ctRoom]);
    const f = await ok(await ct.post(`${P(pid)}/diligence-findings`, { title: 'Clean-team finding (synthetic)', materiality: 'low', roomId: ctRoom, classification: 'confidential' }));
    expect((await owner().query('select room_id from diligence_finding where id = $1', [f.id])).rows[0].room_id).toBe(ctRoom);
    expect((await ct.get(`${P(pid)}/diligence-findings`).expect(200)).body.items.map((x: { id: string }) => x.id)).toEqual([f.id]);
    for (const c of [j.p.pm, j.p.legal, j.p.sponsor]) {
      const r = (await c.get(`${P(pid)}/diligence-findings?pageSize=100`).expect(200)).body;
      expect(r.items.some((x: { id: string }) => x.id === f.id), c.persona).toBe(false);
      expect((await c.get(`${P(pid)}/diligence-findings/${f.id}`)).status, c.persona).toBe(404);
      expect((await c.get(`${P(pid)}/partner-rooms/${ctRoom}`)).status, c.persona).toBe(404);
    }
    // The clean-team member sees nothing outside the room.
    for (const path of ['/partners', `/partner-rooms/${roomA}`, '/closings']) expect([403, 404], path).toContain((await ct.get(`${P(pid)}${path}`)).status);
  });
});
