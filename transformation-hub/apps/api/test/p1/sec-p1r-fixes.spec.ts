import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { closeApp, closePools, DC, GEN, getApp, loginAs, owner, projectIdByCode, demoUserId, runtimePool } from '../helpers';
import { loadConfig, weakSecret, secretEntropyBits, trustsEveryone, LINK_BY_EMAIL_ACK, MIN_SECRET_BITS } from '../../src/platform/config';
import { WorkerService } from '../../src/platform/jobs/worker.service';
import { JobRegistry } from '../../src/platform/jobs/job-registry';
import { registerJobHandlers } from '../../src/jobs';
import { LEGAL_ENTITY_CHANGED_JOB } from '../../src/modules/newco/newco.jobs';

/**
 * Regression tests for the fixes of the P1 security RE-REVIEW (docs/reviews/P1-security-rereview.md): SEC-P1R-01…06 beyond
 * the reviewer's own assertions (apps/api/test/reviews/sec-p1-rereview.spec.ts), and the Info items I-R1…I-R5.
 * Fixtures are created through the owner role and removed / neutralised in `finally` blocks.
 */
let dcId: string;
let genId: string;
let orgId: string;
let pmId: string;

beforeAll(async () => {
  dcId = await projectIdByCode(DC);
  genId = await projectIdByCode(GEN);
  orgId = (await owner().query('select org_id from project where id = $1', [dcId])).rows[0].org_id;
  pmId = await demoUserId('pm');
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

const P = (pid: string, path = '') => `/api/v1/projects/${pid}${path}`;

async function drainWorker() {
  const app = await getApp();
  if (!app.get(JobRegistry).handler(LEGAL_ENTITY_CHANGED_JOB)) registerJobHandlers(app);
  const worker = app.get(WorkerService);
  for (let i = 0; i < 20; i++) {
    const d = await worker.dispatchOutbox(500);
    const e = await worker.runJobs(50);
    if (d === 0 && e === 0) break;
  }
}

/** A synthetic demo user holding ONLY a workstream-scoped role in the DC project (no project-wide role). */
async function workstreamOnlyUser(workstreamCode: string) {
  const ws = (await owner().query(`select id from workstream where project_id = $1 and code = $2`, [dcId, workstreamCode])).rows[0].id as string;
  const userId = (
    await owner().query(`insert into app_user (org_id, email, display_name, is_demo, clearance) values ($1, $2, 'SEC-P1R workstream-only (synthetic)', true, 'confidential') returning id`, [
      orgId,
      `secp1r.ws.${randomUUID()}@demo.invalid`,
    ])
  ).rows[0].id as string;
  const membership = (
    await owner().query(`insert into project_membership (org_id, project_id, user_id, role, workstream_id, granted_by, reason) values ($1,$2,$3,'workstream_lead',$4,$5,'SEC-P1R test (synthetic)') returning id`, [orgId, dcId, userId, ws, pmId])
  ).rows[0].id as string;
  const agent = request.agent((await getApp()).getHttpServer());
  await agent.post('/api/v1/auth/demo-login').send({ userId }).expect(201);
  return {
    agent,
    userId,
    workstreamId: ws,
    cleanup: async () => {
      await owner().query(`update project_membership set revoked_at = now() where id = $1`, [membership]);
      await owner().query(`update app_user set is_active = false where id = $1`, [userId]);
    },
  };
}

async function asRuntime<T>(ctx: { user: string; projects: string[]; full: string[] }, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await runtimePool().connect();
  try {
    await c.query('begin');
    await c.query(
      `select set_config('app.org_id',$1,true), set_config('app.user_id',$2,true), set_config('app.project_ids',$3,true),
              set_config('app.full_project_ids',$4,true), set_config('app.room_ids','',true), set_config('app.room_only','false',true)`,
      [orgId, ctx.user, ctx.projects.join(','), ctx.full.join(',')],
    );
    return await fn(c);
  } finally {
    await c.query('rollback').catch(() => undefined);
    c.release();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P1R-01 — CSRF denials: rate limit first, then a coalesced security event', () => {
  it('SEC-P1R-01: one audit row for the first denial of the minute (with its correlation id), then at 10 and 100; 429 after the budget', async () => {
    const pm = await loginAs('pm');
    const maxSeq = Number((await owner().query(`select coalesce(max(seq), 0)::bigint n from audit_event`)).rows[0].n);
    const statuses: number[] = [];
    let firstCorrelation = '';
    for (let i = 0; i < 125; i++) {
      const r = await pm.agent.post('/api/v1/me/locale').send({ locale: 'en' });
      statuses.push(r.status);
      if (i === 0) firstCorrelation = r.body.correlationId;
    }
    expect(statuses.slice(0, 120).every((s) => s === 403)).toBe(true);
    expect(statuses.slice(120).every((s) => s === 429)).toBe(true);
    const rows = (await owner().query(`select after, correlation_id, reason from audit_event where action = 'auth.csrf' and actor_user_id = $1 and seq > $2 order by seq`, [pm.userId, maxSeq])).rows;
    expect(rows.map((r) => r.after.deniedInCurrentMinute)).toEqual([1, 10, 100]);
    expect(rows[0].correlation_id).toBe(firstCorrelation);
    expect(rows[0].reason).toMatch(/CSRF token missing or invalid on POST/);
    // the security signal survives: a legitimate request of another session is unaffected
    const other = await loginAs('pm');
    expect((await other.post('/api/v1/me/locale', { locale: 'en' })).status).toBeLessThan(300);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P1R-02 — activity feed: inherited visibility and workstream reach, inside SQL', () => {
  const cases: { type: string; parent: string; find: string }[] = [
    { type: 'agenda_item', parent: 'committee', find: `select x.id, c.id parent_id, c.classification from agenda_item x join committee c on c.id = x.committee_id where x.project_id = $1 and c.classification in ('public','internal','confidential') order by x.created_at limit 1` },
    { type: 'committee_membership', parent: 'committee', find: `select x.id, c.id parent_id, c.classification from committee_membership x join committee c on c.id = x.committee_id where x.project_id = $1 and c.classification in ('public','internal','confidential') order by x.created_at limit 1` },
    { type: 'authority_matrix_version', parent: 'committee', find: `select x.id, c.id parent_id, c.classification from authority_matrix_version x join committee c on c.id = x.committee_id where x.project_id = $1 and c.classification in ('public','internal','confidential') order by x.created_at limit 1` },
    { type: 'action_item', parent: 'decision', find: `select x.id, d.id parent_id, d.classification from action_item x join decision d on d.id = x.decision_id where x.project_id = $1 and d.classification in ('public','internal','confidential') order by x.created_at limit 1` },
    { type: 'escalation', parent: 'decision', find: `select x.id, d.id parent_id, d.classification from escalation x join decision d on d.id = x.source_id where x.project_id = $1 and x.source_type = 'decision' and d.classification in ('public','internal','confidential') order by x.created_at limit 1` },
    { type: 'source_claim', parent: 'source_record', find: `select x.id, s.id parent_id, s.classification from source_claim x join source_record s on s.id = x.source_id where x.project_id = $1 and s.classification in ('public','internal','confidential') order by x.created_at limit 1` },
    { type: 'document_version', parent: 'document', find: `select x.id, d.id parent_id, d.classification from document_version x join document d on d.id = x.document_id where x.project_id = $1 and d.room_id is null and d.deleted_at is null and d.classification in ('public','internal','confidential') order by x.created_at limit 1` },
    // P4 JV: partner children inherit the partner's classification (JV seed: one contact and one conflict per demo partner)
    { type: 'partner_contact', parent: 'partner', find: `select x.id, p.id parent_id, p.classification from partner_contact x join partner p on p.id = x.partner_id where x.project_id = $1 and p.classification in ('public','internal','confidential') order by x.created_at limit 1` },
    { type: 'partner_conflict', parent: 'partner', find: `select x.id, p.id parent_id, p.classification from partner_conflict x join partner p on p.id = x.partner_id where x.project_id = $1 and p.classification in ('public','internal','confidential') order by x.created_at limit 1` },
    { type: 'evidence_link', parent: 'document', find: `select x.id, d.id parent_id, d.classification from evidence_link x join document d on d.id = x.document_id where x.project_id = $1 and d.room_id is null and d.deleted_at is null and x.target_type in ('gate_criterion','task','milestone','deliverable','legal_entity') and d.classification in ('public','internal','confidential') order by x.created_at limit 1` },
  ];

  for (const c of cases) {
    it(`SEC-P1R-02: events of a ${c.type} disappear when its ${c.parent} becomes restricted (auditor, list and total)`, async () => {
      const auditor = await loginAs('auditor'); // clearance: confidential
      const [row] = (await owner().query(c.find, [dcId])).rows;
      expect(row, `demo data provides a ${c.type} with a visible ${c.parent}`).toBeTruthy();
      await owner().query(`insert into audit_event (org_id, project_id, actor_kind, action, entity_type, entity_id, outcome) values ($1,$2,'service','test.sec_p1r_02',$3,$4,'success')`, [orgId, dcId, c.type, row.id]);
      const url = P(dcId, `/activity?entityType=${c.type}&entityId=${row.id}`);
      expect((await auditor.get(url).expect(200)).body.total, `${c.type} is visible while its ${c.parent} is`).toBeGreaterThan(0);
      await owner().query(`update ${c.parent} set classification = 'restricted' where id = $1`, [row.parent_id]);
      try {
        const hidden = (await auditor.get(url).expect(200)).body;
        expect(hidden.total).toBe(0);
        expect(hidden.items).toEqual([]);
        const feed = (await auditor.get(P(dcId, `/activity?entityType=${c.type}&pageSize=100`)).expect(200)).body;
        expect(feed.items.some((i: { entityId: string }) => i.entityId === row.id)).toBe(false);
      } finally {
        await owner().query(`update ${c.parent} set classification = $2 where id = $1`, [row.parent_id, row.classification]);
      }
    });
  }

  it('SEC-P1R-02: a workstream-only reader sees task events of its own workstream only (reach of planning.plan.read)', async () => {
    const u = await workstreamOnlyUser('WS06');
    try {
      const mine = (await owner().query(`select id from task where project_id = $1 and workstream_id = $2 order by created_at limit 1`, [dcId, u.workstreamId])).rows[0].id;
      const other = (await owner().query(`select id from task where project_id = $1 and workstream_id <> $2 order by created_at limit 1`, [dcId, u.workstreamId])).rows[0].id;
      for (const id of [mine, other]) await owner().query(`insert into audit_event (org_id, project_id, actor_kind, action, entity_type, entity_id, outcome) values ($1,$2,'service','test.sec_p1r_02','task',$3,'success')`, [orgId, dcId, id]);
      expect((await u.agent.get(P(dcId, `/activity?entityType=task&entityId=${mine}`)).expect(200)).body.total).toBeGreaterThan(0);
      expect((await u.agent.get(P(dcId, `/activity?entityType=task&entityId=${other}`)).expect(200)).body.total).toBe(0);
    } finally {
      await u.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P1R-03 — a shared legal entity has ONE owning project; linked projects are read-only', () => {
  it('SEC-P1R-03: the linked project gets 403 newco.legal_entity.not_owner on every change; the owner changes it and the linked project is told', async () => {
    const [le] = (await owner().query(`select le.id, le.name, le.version, le.owner_project_id from project_entity pe join legal_entity le on le.id = pe.legal_entity_id where pe.project_id = $1 and pe.role = 'newco'`, [dcId])).rows;
    expect(le.owner_project_id).toBe(dcId);
    const link = (await owner().query(`insert into project_entity (org_id, project_id, legal_entity_id, role) values ($1,$2,$3,'other') returning id`, [orgId, genId, le.id])).rows[0].id;
    const pm = await loginAs('pm');
    const pmB = await loginAs('pm.b');
    try {
      // read-only in the linked project, with the flag the UI needs
      const inB = (await pmB.get(P(genId, `/legal-entities/${le.id}`)).expect(200)).body;
      expect(inB.ownedByThisProject).toBe(false);
      expect((await pm.get(P(dcId, `/legal-entities/${le.id}`)).expect(200)).body.ownedByThisProject).toBe(true);
      for (const r of [
        await pmB.patch(P(genId, `/legal-entities/${le.id}`), { expectedVersion: le.version, jurisdiction: 'changed from B' }),
        await pmB.post(P(genId, `/legal-entities/${le.id}/incorporation`), { expectedVersion: le.version, status: 'unconfirmed', note: 'from B (test)' }),
      ]) {
        expect(r.status).toBe(403);
        expect(r.body.code).toBe('newco.legal_entity.not_owner');
        expect(JSON.stringify(r.body)).not.toContain(dcId); // the owning project is never named
      }
      const unchanged = (await owner().query(`select name, version, incorporation_status from legal_entity where id = $1`, [le.id])).rows[0];
      expect(unchanged).toMatchObject({ name: le.name, version: le.version });
      // the owning project changes it → one outbox event per OTHER linked project → activity trace in B
      const renamed = await pm.patch(P(dcId, `/legal-entities/${le.id}`), { expectedVersion: le.version, name: `${le.name} (SEC-P1R-03 rename)` });
      expect(renamed.status).toBe(200);
      const ev = (await owner().query(`select project_id, payload from outbox_event where type = 'legal_entity.changed' and aggregate_id = $1 order by created_at desc limit 1`, [le.id])).rows[0];
      expect(ev.project_id).toBe(genId);
      expect(ev.payload).toMatchObject({ legalEntityId: le.id, change: 'update', versionNo: renamed.body.version });
      await drainWorker();
      const actB = (await pmB.get(P(genId, `/activity?entityType=legal_entity&entityId=${le.id}`)).expect(200)).body;
      expect(actB.items.map((i: { action: string }) => i.action)).toContain('newco.legal_entity.changed_in_owning_project');
      expect((await pmB.get(P(genId, `/legal-entities/${le.id}`)).expect(200)).body.name).toBe(`${le.name} (SEC-P1R-03 rename)`);
      // restore the name through the owner
      await pm.patch(P(dcId, `/legal-entities/${le.id}`), { expectedVersion: renamed.body.version, name: le.name }).expect(200);
    } finally {
      await owner().query(`update legal_entity set name = $2 where id = $1`, [le.id, le.name]);
      await owner().query(`delete from project_entity where id = $1`, [link]);
    }
  });

  it('SEC-P1R-03: database — only full members of the owner update it, the owner is immutable, and the link fan-out needs the owner', async () => {
    const [le] = (await owner().query(`select le.id from project_entity pe join legal_entity le on le.id = pe.legal_entity_id where pe.project_id = $1 and pe.role = 'newco'`, [dcId])).rows;
    const pmB = await demoUserId('pm.b');
    const link = (await owner().query(`insert into project_entity (org_id, project_id, legal_entity_id, role) values ($1,$2,$3,'other') returning id`, [orgId, genId, le.id])).rows[0].id;
    try {
      await asRuntime({ user: pmB, projects: [genId], full: [genId] }, async (c) => {
        const r = await c.query(`update legal_entity set jurisdiction = 'from B' where id = $1`, [le.id]);
        expect(r.rowCount).toBe(0); // restrictive RLS: not a member of the owning project
        expect((await c.query(`select * from hub_legal_entity_linked_projects($1)`, [le.id])).rowCount).toBe(0);
      });
      await asRuntime({ user: pmId, projects: [dcId], full: [dcId] }, async (c) => {
        expect((await c.query(`select project_id from hub_legal_entity_linked_projects($1) as t(project_id)`, [le.id])).rows).toEqual([{ project_id: genId }]);
        await expect(c.query(`update legal_entity set owner_project_id = $2 where id = $1`, [le.id, genId])).rejects.toThrow();
      });
      await expect(owner().query(`update legal_entity set owner_project_id = $2 where id = $1`, [le.id, genId])).rejects.toThrow(/immutable_owner/);
    } finally {
      await owner().query(`delete from project_entity where id = $1`, [link]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P1R-04 / SEC-P1R-05 — evidence follows the TARGET read rules; counters follow the list', () => {
  it('SEC-P1R-04: evidence of a restricted decision and link commands on an unreadable target are 404', async () => {
    const [d] = (await owner().query(`select id, classification from decision where project_id = $1 and classification in ('internal','confidential') order by created_at limit 1`, [dcId])).rows;
    const contributor = await loginAs('contributor');
    const url = P(dcId, `/evidence?targetType=decision&targetId=${d.id}`);
    expect((await contributor.get(url)).status).toBe(200);
    await owner().query(`update decision set classification = 'restricted' where id = $1`, [d.id]);
    try {
      expect((await contributor.get(url)).status).toBe(404);
    } finally {
      await owner().query(`update decision set classification = $2 where id = $1`, [d.id, d.classification]);
    }
    // a functional approver (documents.evidence.verify, no jv.deal.read) cannot act on a link to a JV closing condition
    const cc = (await owner().query(`insert into closing_condition (org_id, project_id, reference, title) values ($1,$2,'SECRR-CP-2','Closing condition (SEC-P1R-04 fix test, synthetic)') returning id`, [orgId, dcId])).rows[0].id;
    const linkId = (await owner().query(`insert into evidence_link (org_id, project_id, target_type, target_id, note, status, added_by, purpose) values ($1,$2,'closing_condition',$3,'note (synthetic)','active',$4,'test') returning id`, [orgId, dcId, cc, await demoUserId('legal')])).rows[0].id;
    try {
      const approver = await loginAs('approver');
      const r = await approver.post(P(dcId, `/evidence/${linkId}/verify`), { expectedVersion: 1, decision: 'reject', note: 'probe' });
      expect(r.status).toBe(404);
      expect((await owner().query(`select status from evidence_link where id = $1`, [linkId])).rows[0].status).toBe('active');
      const legal = await loginAs('legal'); // holds jv.deal.read → the list is readable
      expect((await legal.get(P(dcId, `/evidence?targetType=closing_condition&targetId=${cc}`)).expect(200)).body.total).toBe(1);
    } finally {
      await owner().query(`update evidence_link set status = 'rejected' where id = $1`, [linkId]);
    }
  });

  it('SEC-P1R-04: a workstream-only reader cannot list evidence of another workstream\'s task (404), but can for its own', async () => {
    const u = await workstreamOnlyUser('WS06');
    try {
      const mine = (await owner().query(`select id from task where project_id = $1 and workstream_id = $2 order by created_at limit 1`, [dcId, u.workstreamId])).rows[0].id;
      const other = (await owner().query(`select id from task where project_id = $1 and workstream_id <> $2 order by created_at limit 1`, [dcId, u.workstreamId])).rows[0].id;
      expect((await u.agent.get(P(dcId, `/evidence?targetType=task&targetId=${mine}`))).status).toBe(200);
      expect((await u.agent.get(P(dcId, `/evidence?targetType=task&targetId=${other}`))).status).toBe(404);
    } finally {
      await u.cleanup();
    }
  });

  it('SEC-P1R-05: task counters and document counters count only evidence the caller could list', async () => {
    const contributor = await loginAs('contributor'); // confidential clearance, no jv.deal.read
    const task = (await owner().query(`select id from task where project_id = $1 order by created_at limit 1`, [dcId])).rows[0].id;
    const restricted = (await owner().query(`insert into document (org_id, project_id, title, kind, classification) values ($1,$2,'Restricted evidence (SEC-P1R-05 fix test, synthetic)','evidence','restricted') returning id`, [orgId, dcId])).rows[0].id;
    const internal = (await owner().query(`insert into document (org_id, project_id, title, kind, classification) values ($1,$2,'Internal evidence (SEC-P1R-05 fix test, synthetic)','evidence','internal') returning id`, [orgId, dcId])).rows[0].id;
    const cc = (await owner().query(`insert into closing_condition (org_id, project_id, reference, title) values ($1,$2,'SECRR-CP-3','Closing condition (SEC-P1R-05 fix test, synthetic)') returning id`, [orgId, dcId])).rows[0].id;
    const sponsor = await demoUserId('sponsor');
    const links = [
      [task, 'task', restricted],
      [task, 'task', internal],
      [cc, 'closing_condition', internal],
    ].map(([t, type, doc]) => [t, type, doc]);
    const ids: string[] = [];
    try {
      for (const [t, type, doc] of links) {
        ids.push((await owner().query(`insert into evidence_link (org_id, project_id, target_type, target_id, document_id, status, added_by, purpose) values ($1,$2,$3,$4,$5,'active',$6,'test') returning id`, [orgId, dcId, type, t, doc, sponsor])).rows[0].id);
      }
      const list = (await contributor.get(P(dcId, `/evidence?targetType=task&targetId=${task}`)).expect(200)).body;
      const tasks = (await contributor.get(P(dcId, `/tasks?pageSize=100`)).expect(200)).body;
      let row = tasks.items.find((x: { id: string }) => x.id === task);
      if (!row) row = (await contributor.get(P(dcId, `/tasks/${task}`)).expect(200)).body;
      expect(row.evidenceCount).toBe(list.items.filter((i: { status: string }) => i.status === 'active').length);
      expect(list.items.some((i: { documentId: string }) => i.documentId === restricted)).toBe(false);
      // document detail: the internal document is linked to a task (readable) and a JV closing condition (not readable)
      expect((await contributor.get(P(dcId, `/documents/${internal}`)).expect(200)).body.evidence.active).toBe(1);
      const pm = await loginAs('pm'); // holds jv.deal.read
      expect((await pm.get(P(dcId, `/documents/${internal}`)).expect(200)).body.evidence.active).toBe(2);
    } finally {
      for (const id of ids) await owner().query(`update evidence_link set status = 'rejected' where id = $1`, [id]);
      await owner().query(`update document set deleted_at = now() where id = any($1)`, [[restricted, internal]]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P1R-06 — denied mutations keep the attempted ids (ids only)', () => {
  it('SEC-P1R-06: an out-of-scope PATCH records the attempted project and target ids as plain values, no body content', async () => {
    const pmB = await loginAs('pm.b');
    const le = (await owner().query(`select legal_entity_id from project_entity where project_id = $1 and role = 'newco'`, [dcId])).rows[0].legal_entity_id;
    const secret = `SEC-P1R-06 body text ${randomUUID()}`;
    const r = await pmB.patch(P(dcId, `/legal-entities/${le}`), { expectedVersion: 1, name: secret });
    expect(r.status).toBe(404);
    const [row] = (await owner().query(`select project_id, after, reason from audit_event where actor_user_id = $1 and outcome = 'denied' order by seq desc limit 1`, [pmB.userId])).rows;
    expect(row.project_id).toBeNull(); // out of scope: never written as the row's project (RLS)
    expect(row.after).toEqual({ attempted: { projectId: dcId, entityId: le } });
    expect(JSON.stringify(row)).not.toContain(secret);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('I-R1 — an account holding internal roles cannot become external', () => {
  it('I-R1: flipping account_type to external is refused while an internal grant is active, allowed after revocation', async () => {
    const c = await owner().connect();
    try {
      await c.query('begin');
      const u = (await c.query(`insert into app_user (org_id, email, display_name) values ($1, $2, 'I-R1 probe (synthetic)') returning id`, [orgId, `ir1.${randomUUID()}@example.invalid`])).rows[0].id;
      const m = (await c.query(`insert into project_membership (org_id, project_id, user_id, role, granted_by, reason) values ($1,$2,$3,'contributor',$4,'I-R1 probe') returning id`, [orgId, dcId, u, pmId])).rows[0].id;
      await c.query('savepoint s');
      await expect(c.query(`update app_user set account_type = 'external' where id = $1`, [u])).rejects.toThrow(/external_account_role/);
      await c.query('rollback to savepoint s');
      await c.query(`update project_membership set revoked_at = now() where id = $1`, [m]);
      await c.query(`update app_user set account_type = 'external' where id = $1`, [u]);
      expect((await c.query(`select account_type from app_user where id = $1`, [u])).rows[0].account_type).toBe('external');
      // the existing guard still refuses a new internal grant for the now external account
      await c.query('savepoint t');
      await expect(c.query(`insert into project_membership (org_id, project_id, user_id, role, granted_by, reason) values ($1,$2,$3,'contributor',$4,'I-R1 probe 2')`, [orgId, dcId, u, pmId])).rejects.toThrow(/external_account_role/);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('I-R2 / I-R4 — production configuration', () => {
  const prod = {
    NODE_ENV: 'production',
    HUB_MODE: 'standard',
    DATABASE_URL: `postgres://hub_app:${randomBytes(18).toString('hex')}@db:5432/hub?sslmode=verify-full`,
    HUB_COOKIE_SECURE: 'true',
    HUB_STORAGE_DRIVER: 's3',
    HUB_S3_ENDPOINT: 'https://objects.example.invalid',
    HUB_S3_BUCKET: 'hub-objects',
    HUB_S3_ACCESS_KEY_ID: 'hub-app',
    HUB_S3_SECRET_ACCESS_KEY: randomBytes(24).toString('base64url'),
    HUB_S3_SSE: 'AES256',
    HUB_EGRESS_ALLOWLIST: 'objects.example.invalid',
    HUB_OIDC_ISSUER: 'https://idp.example.invalid',
    HUB_OIDC_CLIENT_ID: 'hub',
    HUB_OIDC_REDIRECT_URI: 'https://hub.example.invalid/api/v1/auth/oidc/callback',
    HUB_COOKIE_SECRET: randomBytes(48).toString('base64'), // SEC-P1S-05: generated at run time
    HUB_AI_ALLOW_MOCK: 'false',
  };

  it('I-R2: trust-everyone proxy ranges are refused; hop counts and proxy addresses are accepted', () => {
    expect(() => loadConfig(prod)).not.toThrow();
    for (const v of ['0.0.0.0/0', '::/0', '0/0', '::ffff:0:0/96', '0.0.0.0/1,128.0.0.0/1', '10.0.0.0/8, 0.0.0.0/0', '1.0.0.0/7', '2000::/3']) {
      expect(() => loadConfig({ ...prod, HUB_TRUST_PROXY: v }), v).toThrow(/HUB_TRUST_PROXY trusts \(almost\) every address/);
    }
    for (const v of ['true', '1', '2', 'false', '10.0.0.0/8, 127.0.0.1', '10.42.0.0/16', 'fd00::/16', '::ffff:10.0.0.0/104']) {
      expect(() => loadConfig({ ...prod, HUB_TRUST_PROXY: v }), v).not.toThrow();
    }
    expect(trustsEveryone('192.168.1.10')).toBe(false);
  });

  it('I-R2: link-by-email must be explicitly acknowledged in production (and is reported as a startup warning)', () => {
    expect(() => loadConfig({ ...prod, HUB_OIDC_LINK_BY_EMAIL: 'true' })).toThrow(/HUB_OIDC_LINK_BY_EMAIL_ACK/);
    expect(() => loadConfig({ ...prod, HUB_OIDC_LINK_BY_EMAIL: 'true', HUB_OIDC_LINK_BY_EMAIL_ACK: 'yes' })).toThrow(/HUB_OIDC_LINK_BY_EMAIL_ACK/);
    const ok = loadConfig({ ...prod, HUB_OIDC_LINK_BY_EMAIL: 'true', HUB_OIDC_LINK_BY_EMAIL_ACK: LINK_BY_EMAIL_ACK });
    expect(ok.oidc.linkByEmail).toBe(true);
    expect(ok.warnings.join(' ')).toMatch(/link-by-email is enabled/);
  });

  it('I-R2: weak-but-varied cookie secrets are refused by the entropy estimate; random secrets pass', () => {
    for (const s of ['abcdefghijkl'.repeat(3), 'Password123!'.repeat(3), '0123456789abcdef'.repeat(2), 'abcdefghijklmnopqrstuvwxyz0123456789', 'zyxwvutsrqponmlkjihgfedcba9876543210']) {
      expect(weakSecret(s), s).toBe(true);
      expect(() => loadConfig({ ...prod, HUB_COOKIE_SECRET: s }), s).toThrow(/too weak/);
    }
    // 2 000 random secrets of the documented forms (openssl rand -base64 48 / -hex 16 / -hex 32) are never refused
    for (let i = 0; i < 500; i++) {
      for (const s of [randomBytes(48).toString('base64'), randomBytes(16).toString('hex'), randomBytes(32).toString('hex'), randomBytes(24).toString('base64url')]) {
        expect(weakSecret(s), s).toBe(false);
        expect(secretEntropyBits(s)).toBeGreaterThanOrEqual(MIN_SECRET_BITS);
      }
    }
  });

  it('I-R2: default MinIO / documentation S3 credentials are refused', () => {
    expect(() => loadConfig({ ...prod, HUB_S3_ACCESS_KEY_ID: 'minioadmin', HUB_S3_SECRET_ACCESS_KEY: 'minioadmin' })).toThrow(/default or example credentials/);
    expect(() => loadConfig({ ...prod, HUB_S3_SECRET_ACCESS_KEY: 'minio123' })).toThrow(/default or example credentials/);
  });

  it('I-R4: S3 objects must be encrypted server-side in production unless the bucket default encryption is assured', () => {
    expect(() => loadConfig({ ...prod, HUB_S3_SSE: 'none' })).toThrow(/HUB_S3_SSE must be AES256 or aws:kms/);
    const assured = loadConfig({ ...prod, HUB_S3_SSE: 'none', HUB_S3_BUCKET_DEFAULT_ENCRYPTION: 'assured' });
    expect(assured.storage.s3?.sse).toBe('none');
    expect(assured.warnings.join(' ')).toMatch(/without per-object server-side encryption/);
    expect(loadConfig({ ...prod, HUB_S3_SSE: 'aws:kms', HUB_S3_KMS_KEY_ID: 'arn:aws:kms:me-central-1:000000000000:key/example-key' }).storage.s3?.sse).toBe('aws:kms');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('I-R3 — separation of duties fails CLOSED when the requester is unknown', () => {
  it('I-R3: approving a deliverable weight whose setter is unknown is refused with 403 policy.sod_subject_unknown (and audited)', async () => {
    const [d] = (await owner().query(`select id, version, weight_approved, weight_set_by, weight_approved_by, weight_approved_at from deliverable where project_id = $1 and status <> 'cancelled' order by created_at limit 1`, [dcId])).rows;
    await owner().query(`update deliverable set weight_approved = false, weight_set_by = null, weight_approved_by = null, weight_approved_at = null where id = $1`, [d.id]);
    try {
      const sponsor = await loginAs('sponsor'); // holds planning.baseline.approve
      const r = await sponsor.post(P(dcId, '/deliverables/weights/approve'), { items: [{ id: d.id, expectedVersion: d.version }] });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('policy.sod_subject_unknown');
      expect((await owner().query(`select weight_approved from deliverable where id = $1`, [d.id])).rows[0].weight_approved).toBe(false);
      const [a] = (await owner().query(`select outcome, reason from audit_event where actor_user_id = $1 and action = 'planning.approveDeliverableWeights' order by seq desc limit 1`, [sponsor.userId])).rows;
      expect(a).toMatchObject({ outcome: 'denied' });
      expect(a.reason).toMatch(/^policy\.sod_subject_unknown/);
      // positive control: with a known setter (someone else) the same approval succeeds
      await owner().query(`update deliverable set weight_set_by = $2 where id = $1`, [d.id, pmId]);
      const ok = await sponsor.post(P(dcId, '/deliverables/weights/approve'), { items: [{ id: d.id, expectedVersion: d.version }] });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(ok.body.approved).toBe(1);
    } finally {
      await owner().query(`update deliverable set weight_approved = $2, weight_set_by = $3, weight_approved_by = $4, weight_approved_at = $5 where id = $1`, [d.id, d.weight_approved, d.weight_set_by, d.weight_approved_by, d.weight_approved_at]);
    }
  });
});
