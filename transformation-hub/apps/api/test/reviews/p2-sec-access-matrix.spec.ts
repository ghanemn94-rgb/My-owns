import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { closeApp, closePools, getApp, owner } from '../helpers';
import { PolicyService } from '../../src/platform/policy.service';
import type { RequestContext } from '../../src/platform/context';
import { setupProject, setupGovernance, gateByKey, gateDecision, Personas, Gov } from '../gates/gate-test-kit';
import { createWithVersion, getBinary, login as docLogin, DocClient } from '../documents/doc-helpers';

/**
 * access-matrix §2.2 / §2.2.1 — P2 security review §3, option B (docs/reviews/P2-security-review.md), applied by the lead.
 *
 * A workstream-scoped grant covers only records of its workstreams (§2.2), EXCEPT the four project-level reads of §2.2.1
 * (`gates.gate.read`, `documents.document.read`, `documents.document.download`, `portfolio.project.read`), which also cover
 * the project's records of that type with no workstream and no room. Everything else stays strict: finance, governance
 * decisions, planning aggregates. Lists and search agree with the single-record answer (SEC-P2-08).
 *
 * The principal under test: tech.lead holding ONLY `workstream_lead` on the project's first workstream (gate-test-kit).
 * Every project and record is created by the test (synthetic data only).
 */
let projectId: string;
let p: Personas;
let gov: Gov;
let lead: DocClient; // tech.lead as a documents client (binary downloads)

const G = (pid: string) => `/api/v1/projects/${pid}`;
const TAG = 'SECP22X'; // search token in the document titles of this spec

beforeAll(async () => {
  ({ projectId, p } = await setupProject('SECP2-AM'));
  gov = await setupGovernance(projectId, p);
  lead = await docLogin('tech.lead');
  const scope = await owner().query(`select role, workstream_id from project_membership where project_id = $1 and user_id = $2 and revoked_at is null`, [projectId, lead.userId]);
  expect(scope.rows).toHaveLength(1); // workstream-only principal: one workstream_lead assignment, no project-wide role
  expect(scope.rows[0]).toMatchObject({ role: 'workstream_lead' });
  expect(scope.rows[0].workstream_id).not.toBeNull();
}, 600_000);
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('§2.2.1 gate register and project header — readable by a workstream-only principal; decisions stay governed by their own permission', () => {
  let decisionId: string;
  let decisionTitle: string;
  let g1Id: string;

  beforeAll(async () => {
    const g1 = await gateByKey(p.pm, projectId, 'G1');
    g1Id = g1.id;
    // The workstream lead owns G1 (through its workstream): it starts the cycle and links a (tabled) governance decision.
    const start = await p.techLead.post(`${G(projectId)}/gates/${g1.id}/assessment/start`, { expectedVersion: g1.assessment.version });
    expect(start.status, JSON.stringify(start.body)).toBe(201);
    const d = await gateDecision(projectId, p, gov, 'G1', { vote: false });
    decisionId = d.id;
    const link = await p.techLead.post(`${G(projectId)}/gates/${g1.id}/assessment/link-decision`, { expectedVersion: start.body.version, decisionId });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    decisionTitle = (await p.pm.get(`${G(projectId)}/decisions/${decisionId}`).expect(200)).body.title;
  }, 300_000);

  it('GET /gates, /gates/:id and /gate-waivers answer 200 (were 403)', async () => {
    const list = await p.techLead.get(`${G(projectId)}/gates`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect((list.body.items as { key: string }[]).map((g) => g.key)).toEqual(expect.arrayContaining(['G0', 'G1', 'G7']));
    const one = await p.techLead.get(`${G(projectId)}/gates/${g1Id}`);
    expect(one.status).toBe(200);
    expect(one.body.criteria.length).toBeGreaterThan(0);
    expect(one.body.assessment.decisionId).toBe(decisionId); // the gate's own record (id only)
    expect((await p.techLead.get(`${G(projectId)}/gate-waivers`)).status).toBe(200);
  });

  it('the linked governance decision (title, status) is shown to project-wide decision readers only; GET /decisions/:id stays 403', async () => {
    const pmView = (await p.pm.get(`${G(projectId)}/gates/${g1Id}`).expect(200)).body as { decision: { id: string; title: string } | null; decisions: { id: string }[] };
    expect(pmView.decision).toMatchObject({ id: decisionId, title: decisionTitle }); // control: the PM reads decisions
    const leadView = (await p.techLead.get(`${G(projectId)}/gates/${g1Id}`).expect(200)).body as { decision: unknown; decisions: unknown[] };
    expect(leadView.decision).toBeNull();
    expect(leadView.decisions).toEqual([]);
    const leadList = (await p.techLead.get(`${G(projectId)}/gates`).expect(200)).body.items as { id: string; decision: unknown }[];
    expect(leadList.find((g) => g.id === g1Id)!.decision).toBeNull();
    expect(JSON.stringify(leadList)).not.toContain(decisionTitle);
    const dec = await p.techLead.get(`${G(projectId)}/decisions/${decisionId}`);
    expect(dec.status).toBe(403); // decisions stay strict (not in §2.2.1)
  });

  it('governance lists (fixed, regression): a workstream-only reader is never listed a decision (or committee / meeting / action) the detail refuses', async () => {
    // Fixed by the lead after this change: the governance lists apply grantSql (strict §2.2) in addition to classification.
    const list = await p.techLead.get(`${G(projectId)}/decisions?pageSize=100`);
    expect(list.status).toBe(200);
    expect((list.body.items as { id: string }[]).map((d) => d.id)).not.toContain(decisionId);
    expect(list.body.total).toBe(0);
    for (const path of ['committees', 'meetings', 'actions', 'escalations', 'agenda-requests']) {
      const r = await p.techLead.get(`${G(projectId)}/${path}?pageSize=100`);
      expect(r.status, path).toBe(200);
      expect(r.body.total, path).toBe(0);
    }
  });

  it('project header: GET /projects/:id and /status-dimensions answer 200 (portfolio.project.read); planning aggregates stay 403', async () => {
    const pr = await p.techLead.get(`${G(projectId)}`);
    expect(pr.status, JSON.stringify(pr.body)).toBe(200);
    expect(pr.body.id).toBe(projectId);
    expect(pr.body.overdueActions).toBeNull(); // governance counts keep their own (project-wide) reach
    expect((await p.techLead.get(`${G(projectId)}/status-dimensions`)).status).toBe(200);
    expect((await p.techLead.get(`${G(projectId)}/schedule`)).status).toBe(403);
    expect((await p.techLead.get(`${G(projectId)}/baselines`)).status).toBe(403);
  });
});

describe('§2.2.1 documents + SEC-P2-08 — a workstream-only principal never lists or finds a title it cannot open', () => {
  let internal: string;
  let internalVersion: string;
  let restricted: string;
  let inRoom: string;
  let roomId: string;

  beforeAll(async () => {
    const pmDocs = await docLogin('pm');
    const bytes = Buffer.from(`synthetic,${TAG}\n`, 'utf8');
    const a = await createWithVersion(pmDocs, projectId, { title: `Internal project memo ${TAG} (synthetic)`, classification: 'internal' }, { bytes, name: 'memo.csv' });
    expect(a.upload.status, JSON.stringify(a.upload.body)).toBe(201);
    internal = a.id;
    internalVersion = a.upload.body.versionId;
    const sponsorDocs = await docLogin('sponsor');
    const r = await createWithVersion(sponsorDocs, projectId, { title: `Restricted memo ${TAG} (synthetic)`, classification: 'restricted' }, { bytes, name: 'restricted.csv' });
    expect(r.upload.status, JSON.stringify(r.upload.body)).toBe(201);
    restricted = r.id;
    // A room-bound document: Legal creates an internal room (and receives its manage grant) and a document in it.
    const legalDocs = await docLogin('legal');
    const room = await legalDocs.post(`${G(projectId)}/partner-rooms`, { name: `Internal working room ${TAG} (synthetic)`, type: 'internal', classification: 'internal' });
    expect(room.status, JSON.stringify(room.body)).toBe(201);
    roomId = room.body.id;
    const inR = await createWithVersion(legalDocs, projectId, { title: `Room memo ${TAG} (synthetic)`, classification: 'internal', roomId }, { bytes, name: 'room.csv' });
    expect(inR.upload.status, JSON.stringify(inR.upload.body)).toBe(201);
    inRoom = inR.id;
  }, 300_000);

  const listed = async () => ((await lead.get(`${G(projectId)}/documents?pageSize=100`).expect(200)).body as { items: { id: string }[]; total: number });
  const found = async () => ((await lead.get(`${G(projectId)}/documents/search?q=${TAG}`).expect(200)).body as { items: { documentId: string }[]; total: number });

  it('an internal project-level document: listed, found, opened and downloaded (200)', async () => {
    const l = await listed();
    expect(l.items.map((i) => i.id)).toContain(internal);
    expect(l.total).toBe(l.items.length);
    const s = await found();
    expect(s.items.map((i) => i.documentId)).toEqual([internal]);
    expect(s.total).toBe(1);
    expect((await lead.get(`${G(projectId)}/documents/${internal}`)).status).toBe(200);
    const dl = await getBinary(lead, `${G(projectId)}/documents/${internal}/versions/${internalVersion}/download`);
    expect(dl.status).toBe(200);
    expect((dl.body as Buffer).toString('utf8')).toBe(`synthetic,${TAG}\n`);
  });

  it('a restricted document (above the clearance) and a room document (no grant) stay 404 and are never listed or found', async () => {
    for (const id of [restricted, inRoom]) expect((await lead.get(`${G(projectId)}/documents/${id}`)).status, id).toBe(404);
    const l = (await listed()).items.map((i) => i.id);
    expect(l).not.toContain(restricted);
    expect(l).not.toContain(inRoom);
    expect((await found()).items.map((i) => i.documentId)).toEqual([internal]);
    // Controls: the sponsor sees the restricted document; Legal (project-wide + room manage grant) sees the room document.
    const sponsorDocs = await docLogin('sponsor');
    expect((await sponsorDocs.get(`${G(projectId)}/documents?pageSize=100`).expect(200)).body.items.map((i: { id: string }) => i.id)).toContain(restricted);
    const legalDocs = await docLogin('legal');
    expect((await legalDocs.get(`${G(projectId)}/documents?pageSize=100`).expect(200)).body.items.map((i: { id: string }) => i.id)).toContain(inRoom);
  });

  it('with a room grant but no room-scoped role, the room document is visible but not covered: 403 on open, and still never listed or found', async () => {
    const legalDocs = await docLogin('legal');
    const g = await legalDocs.post(`${G(projectId)}/partner-rooms/${roomId}/access-grants`, { userId: lead.userId, accessLevel: 'read', reason: 'SEC-P2-08 regression: workstream lead with a room grant (synthetic)' });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    const lead2 = await docLogin('tech.lead'); // fresh session: scopes are resolved per request, the grant applies at once
    expect((await lead2.get(`${G(projectId)}/documents/${inRoom}`)).status).toBe(403); // §2.2.1 never covers room-bound records
    const l = (await lead2.get(`${G(projectId)}/documents?pageSize=100`).expect(200)).body as { items: { id: string }[]; total: number };
    expect(l.items.map((i) => i.id)).not.toContain(inRoom);
    expect(l.total).toBe(l.items.length);
    const s = (await lead2.get(`${G(projectId)}/documents/search?q=${TAG}`).expect(200)).body as { items: { documentId: string }[] };
    expect(s.items.map((i) => i.documentId)).toEqual([internal]);
  });
});

describe('§2.2 strict rule — project-level finance records stay hidden from a workstream-only finance reader', () => {
  it('a project-level budget line (no workstream) is 404 and not listed; a line of the lead\'s workstream is readable (control)', async () => {
    const ws = (await p.pm.get(`${G(projectId)}/workstreams`).expect(200)).body.items as { id: string }[];
    const projectLine = await p.finance.post(`${G(projectId)}/budget-lines`, { name: `Programme-wide cost ${TAG} (synthetic)`, category: 'one_off_separation', currency: 'SAR', unitScale: 1 });
    expect(projectLine.status, JSON.stringify(projectLine.body)).toBe(201);
    const wsLine = await p.finance.post(`${G(projectId)}/budget-lines`, { name: `Workstream cost ${TAG} (synthetic)`, category: 'opex', currency: 'SAR', unitScale: 1, workstreamId: ws[0]!.id });
    expect(wsLine.status, JSON.stringify(wsLine.body)).toBe(201);
    expect((await p.techLead.get(`${G(projectId)}/budget-lines/${projectLine.body.id}`)).status).toBe(404);
    expect((await p.techLead.get(`${G(projectId)}/budget-lines/${wsLine.body.id}`)).status).toBe(200);
    const lines = (await p.techLead.get(`${G(projectId)}/budget-lines?pageSize=100`).expect(200)).body as { items: { id: string }[]; total: number };
    expect(lines.items.map((x) => x.id)).toEqual([wsLine.body.id]);
    expect(lines.total).toBe(1);
    expect((await p.techLead.get(`${G(projectId)}/intercompany-reconciliations`).expect(200)).body.total).toBe(0);
  });
});

describe('PolicyService — the §2.2.1 exception in check, permissionReach, reachSql and grantSql (synthetic principals, no I/O)', () => {
  const PID = '0192f0c0-0000-7000-8000-0000000000a1';
  const WS = '0192f0c0-0000-7000-8000-0000000000b1';
  const OTHER_WS = '0192f0c0-0000-7000-8000-0000000000b2';
  const ROOM = '0192f0c0-0000-7000-8000-0000000000c1';
  const principal = (scope: { roles?: string[]; workstreamRoles?: { workstreamId: string; role: string }[]; roomIds?: string[]; roomRoles?: { roomId: string; role: string }[] }) =>
    ({
      correlationId: 'c',
      sessionId: null,
      ip: null,
      authMethod: 'test',
      locale: 'en',
      projectIds: [PID],
      principal: {
        kind: 'user',
        userId: '0192f0c0-0000-7000-8000-0000000000d1',
        orgId: '0192f0c0-0000-7000-8000-0000000000e1',
        displayName: 'probe',
        email: null,
        clearance: 'confidential',
        isDemo: true,
        orgRoles: new Set(),
        projects: new Map([
          [PID, { projectId: PID, roles: new Set(scope.roles ?? []), workstreamRoles: scope.workstreamRoles ?? [], roomIds: new Set(scope.roomIds ?? []), cleanTeamRoomIds: new Set(), roomRoles: scope.roomRoles ?? [] }],
        ]),
      },
    }) as unknown as RequestContext;
  const text = (s: SQL) => new PgDialect().sqlToQuery(s).sql;

  it('a workstream-scoped grant reaches project-level records only for the four flagged reads; never other workstreams, rooms or other reads', async () => {
    const policy = (await getApp()).get(PolicyService);
    const lead = principal({ workstreamRoles: [{ workstreamId: WS, role: 'workstream_lead' }] });
    // reach: the flag is present only for §2.2.1 permissions; `all` stays false (not a project-wide grant)
    expect(policy.permissionReach(lead, 'gates.gate.read', PID)).toEqual({ all: false, workstreamIds: [WS], projectLevel: true });
    expect(policy.permissionReach(lead, 'planning.plan.read', PID)).toEqual({ all: false, workstreamIds: [WS] });
    expect(policy.permissionReach(lead, 'finance.record.read', PID)).toEqual({ all: false, workstreamIds: [WS] });
    // check: project-level (no workstream, no room) → covered only for flagged reads
    for (const perm of ['gates.gate.read', 'documents.document.read', 'documents.document.download', 'portfolio.project.read']) {
      expect(policy.can(lead, perm, { projectId: PID, classification: 'internal' }), perm).toBe(true);
      expect(policy.can(lead, perm, { projectId: PID, classification: 'internal', workstreamId: OTHER_WS }), `${perm} other workstream`).toBe(false);
    }
    for (const perm of ['planning.plan.read', 'finance.record.read', 'governance.decision.read', 'carveout.register.read', 'readiness.register.read', 'newco.register.read', 'documents.document.upload', 'documents.evidence.link', 'gates.evidence.attach']) {
      expect(policy.can(lead, perm, { projectId: PID, classification: 'internal' }), perm).toBe(false);
    }
    expect(policy.can(lead, 'planning.plan.read', { projectId: PID, workstreamId: WS })).toBe(true); // own workstream (unchanged)
    // clearance still binds (restricted > confidential → hidden, 404)
    expect(() => policy.assert(lead, 'documents.document.read', { projectId: PID, classification: 'restricted' })).toThrow(expect.objectContaining({ kind: 'not_found' }));
    // a room-bound record is never covered through §2.2.1 — even with a room grant (visible → 403, not 200)
    const withRoomGrant = principal({ workstreamRoles: [{ workstreamId: WS, role: 'workstream_lead' }], roomIds: [ROOM] });
    expect(() => policy.assert(withRoomGrant, 'documents.document.read', { projectId: PID, classification: 'internal', roomId: ROOM })).toThrow(expect.objectContaining({ kind: 'forbidden' }));
    expect(() => policy.assert(lead, 'documents.document.read', { projectId: PID, classification: 'internal', roomId: ROOM })).toThrow(expect.objectContaining({ kind: 'not_found' }));
  });

  it('SQL: reachSql adds "or col is null" only for flagged reads; grantSql mirrors check (workstream, project-level, room role, project-wide)', async () => {
    const policy = (await getApp()).get(PolicyService);
    const lead = principal({ workstreamRoles: [{ workstreamId: WS, role: 'workstream_lead' }] });
    const col = sql.raw('t.workstream_id');
    expect(text(policy.reachSql(lead, 'gates.gate.read', PID, col))).toBe('(t.workstream_id in ($1::uuid) or t.workstream_id is null)');
    expect(text(policy.reachSql(lead, 'planning.plan.read', PID, col))).toBe('t.workstream_id in ($1::uuid)');
    const room = sql.raw('d.room_id');
    expect(text(policy.grantSql(lead, 'documents.document.read', PID, { room }))).toBe('((true and d.room_id is null))');
    expect(text(policy.grantSql(lead, 'documents.document.read', PID, { workstream: col, room }))).toBe('(t.workstream_id in ($1::uuid) or (t.workstream_id is null and d.room_id is null))');
    expect(text(policy.grantSql(lead, 'governance.decision.read', PID, {}))).toBe('false'); // not flagged, no workstream column
    expect(text(policy.grantSql(lead, 'planning.plan.read', PID, { workstream: col }))).toBe('(t.workstream_id in ($1::uuid))');
    const cleanTeam = principal({ roomIds: [ROOM], roomRoles: [{ roomId: ROOM, role: 'clean_team' }] });
    expect(text(policy.grantSql(cleanTeam, 'documents.document.read', PID, { room }))).toBe('(d.room_id in ($1::uuid))');
    const pm = principal({ roles: ['project_manager'] });
    expect(text(policy.grantSql(pm, 'documents.document.read', PID, { room }))).toBe('true');
    expect(text(policy.grantSql(pm, 'documents.document.read', '0192f0c0-0000-7000-8000-0000000000ff', { room }))).toBe('false'); // not a member
  });
});
