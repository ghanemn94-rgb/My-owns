import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PoolClient } from 'pg';
import type { ArgumentsHost, INestApplication, LoggerService } from '@nestjs/common';
import { VERIFICATION_STATUSES } from '@hub/domain';
import { createApp } from '../../src/bootstrap';
import { loadConfig } from '../../src/platform/config';
import { Clock } from '../../src/platform/clock';
import { ProblemFilter } from '../../src/platform/errors';
import type { AuditService } from '../../src/platform/audit.service';
import { anonymous, closeApp, closePools, demoUserId, getApp, loginAs, owner, runtimePool, Client } from '../helpers';
import { setupProject, Personas } from '../gates/gate-test-kit';
import { login as docLogin, DocClient, docsPath, getBinary, createWithVersion } from '../documents/doc-helpers';
import { cookieValue, jsonStrings, projectTableCounts } from './closure-kit';

/**
 * P1 closure — automated evidence for the P1 `must` requirements listed under "Work to close before the P1 gate" in
 * docs/phases/P1-must-disposition.md (qa-test-engineer items + DAT-017 / ENT-002). Every test runs against the real API
 * and PostgreSQL; this file creates its own project (setupProject) and never relies on another spec's records.
 */
let pid: string;
let orgId: string;
let p: Personas;
let pmDoc: DocClient;

const P = (path = '') => `/api/v1/projects/${pid}${path}`;

beforeAll(async () => {
  const s = await setupProject('P1C-CLOSURE');
  pid = s.projectId;
  orgId = s.orgId;
  p = s.p;
  pmDoc = await docLogin('pm');
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

async function asRuntime<T>(ctx: { org: string; user?: string; projects: string[] }, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await runtimePool().connect();
  try {
    await c.query('begin');
    await c.query(
      `select set_config('app.org_id',$1,true), set_config('app.user_id',$2,true), set_config('app.project_ids',$3,true),
              set_config('app.full_project_ids',$3,true), set_config('app.room_ids','',true), set_config('app.room_only','false',true)`,
      [ctx.org, ctx.user ?? '', ctx.projects.join(',')],
    );
    return await fn(c);
  } finally {
    await c.query('rollback').catch(() => undefined);
    c.release();
  }
}

async function newSource(c: Client, filename: string): Promise<string> {
  const r = await c.post(P('/sources'), { sourceType: 'excel', filename, ownerLabel: 'P1 closure (synthetic)', extractionStatus: 'partial' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}

async function claimCount(sourceId: string): Promise<number> {
  return (await owner().query<{ n: number }>('select count(*)::int n from source_claim where source_id = $1', [sourceId])).rows[0]!.n;
}

// ------------------------------------------------------------------------------------------------------------------
describe('P1 closure — SRC-004: a claim with no or unclear status stays Unknown [REQ-SRC-004, AT-01]', () => {
  it('a claim created without a verification status (also at low confidence) is stored as unknown, never a guessed value', async () => {
    const sourceId = await newSource(p.pm, 'p1c-src004-unclear.xlsx');
    const noStatus = await p.pm.post(P(`/sources/${sourceId}/claims`), {
      location: 'Sheet "Sites" row 4 (synthetic)',
      subject: 'Site name — partly illegible in the extract',
      extractedValue: 'Site R?y?dh-0?',
    });
    expect(noStatus.status, JSON.stringify(noStatus.body)).toBe(201);
    const lowConfidence = await p.pm.post(P(`/sources/${sourceId}/claims`), {
      location: 'Sheet "Sites" row 5 (synthetic)',
      subject: 'Go-live date — handwritten, unclear',
      extractedValue: '1?/0?/2026',
      confidence: '0.1',
    });
    expect(lowConfidence.status, JSON.stringify(lowConfidence.body)).toBe(201);

    // API view: both Unknown, nothing confirmed or applied.
    const detail = (await p.pm.get(P(`/sources/${sourceId}`)).expect(200)).body as { claims: { id: string; verificationStatus: string; confirmedValue: string | null; appliedToRecord: boolean; confidence: string | null }[] };
    for (const id of [noStatus.body.id, lowConfidence.body.id]) {
      expect(detail.claims.find((c) => c.id === id)).toMatchObject({ verificationStatus: 'unknown', confirmedValue: null, appliedToRecord: false });
    }
    // Database: the stored value is 'unknown' (not a default of proposed/assumed/confirmed), and the audit row says so.
    const rows = await owner().query<{ id: string; verification_status: string; confidence: string | null; reviewer_user_id: string | null }>(
      'select id, verification_status::text, confidence::text, reviewer_user_id from source_claim where source_id = $1 order by created_at',
      [sourceId],
    );
    expect(rows.rows.map((r) => r.verification_status)).toEqual(['unknown', 'unknown']);
    expect(rows.rows[1]!.confidence).toBe('0.100');
    expect(rows.rows.every((r) => r.reviewer_user_id === null)).toBe(true);
    const audit = await owner().query<{ after: { verificationStatus: string } }>(
      `select after from audit_event where action = 'documents.claim.create' and entity_id = any($1::uuid[]) and outcome = 'success'`,
      [[noStatus.body.id, lowConfidence.body.id]],
    );
    expect(audit.rows.map((r) => r.after.verificationStatus)).toEqual(['unknown', 'unknown']);
  });

  it('the database default for a claim written without a status is unknown', async () => {
    const sourceId = await newSource(p.pm, 'p1c-src004-dbdefault.xlsx');
    const c = await owner().connect();
    try {
      await c.query('begin');
      const r = await c.query<{ verification_status: string }>(
        `insert into source_claim (org_id, project_id, source_id, location, subject, extracted_value)
         values ($1, $2, $3, 'row 9 (synthetic)', 'Unclear partner name', 'P?rtner') returning verification_status::text`,
        [orgId, pid, sourceId],
      );
      expect(r.rows[0]!.verification_status).toBe('unknown');
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});

// ------------------------------------------------------------------------------------------------------------------
describe('P1 closure — SRC-008: the verification status vocabulary is enforced by the API contract and the database [REQ-SRC-008]', () => {
  it('API: an out-of-vocabulary status is refused with 400 on create and on review, and nothing is stored', async () => {
    const sourceId = await newSource(p.pm, 'p1c-src008-vocab.xlsx');
    const base = { location: 'row 2 (synthetic)', subject: 'Workstream status as reported', extractedValue: 'Completed' };
    for (const bad of ['verified', 'Confirmed', 'completed', 'on_track', '', 'unknown ']) {
      const r = await p.pm.post(P(`/sources/${sourceId}/claims`), { ...base, verificationStatus: bad });
      expect(r.status, `status "${bad}"`).toBe(400);
      expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(r.body.code).toBe('validation_failed');
      expect(r.body.details.issues.map((i: { path: string }) => i.path)).toContain('verificationStatus');
    }
    expect(await claimCount(sourceId)).toBe(0);

    // A valid claim, then a review with an invented status: refused by the contract, the claim is unchanged.
    const ok = await p.pm.post(P(`/sources/${sourceId}/claims`), base).expect(201);
    const before = (await owner().query('select verification_status::text, version, reviewer_user_id from source_claim where id = $1', [ok.body.id])).rows[0];
    const review = await p.finance.post(P(`/claims/${ok.body.id}/review`), { expectedVersion: 1, verificationStatus: 'approved', note: 'probe' });
    expect(review.status).toBe(400);
    expect(review.body.code).toBe('validation_failed');
    expect((await owner().query('select verification_status::text, version, reviewer_user_id from source_claim where id = $1', [ok.body.id])).rows[0]).toEqual(before);
  });

  it('DB: the column is the verification_status enum with exactly the six values; other values are rejected even for the owner role', async () => {
    const labels = await owner().query<{ v: string }>(`select unnest(enum_range(null::verification_status))::text v`);
    expect(labels.rows.map((r) => r.v)).toEqual([...VERIFICATION_STATUSES]);
    expect([...VERIFICATION_STATUSES].sort()).toEqual(['assumed', 'confirmed', 'conflicting', 'historical_unverified', 'proposed', 'unknown']);
    // Every column that holds a verification status uses the enum type (no free-text status column).
    const cols = await owner().query<{ table_name: string; column_name: string; udt_name: string }>(
      `select table_name, column_name, udt_name from information_schema.columns
        where table_schema = 'public' and (column_name = 'verification_status' or column_name like '%\\_verification')`,
    );
    expect(cols.rows.length).toBeGreaterThan(0);
    for (const c of cols.rows) expect(c.udt_name, `${c.table_name}.${c.column_name}`).toBe('verification_status');

    const sourceId = await newSource(p.pm, 'p1c-src008-db.xlsx');
    const claim = await p.pm.post(P(`/sources/${sourceId}/claims`), { location: 'row 3 (synthetic)', subject: 'probe', extractedValue: 'x' }).expect(201);
    const c = await owner().connect();
    try {
      await c.query('begin');
      await c.query('savepoint s');
      await expect(
        c.query(`insert into source_claim (org_id, project_id, source_id, location, subject, extracted_value, verification_status) values ($1,$2,$3,'r','s','v','verified')`, [orgId, pid, sourceId]),
      ).rejects.toMatchObject({ code: '22P02', message: expect.stringMatching(/invalid input value for enum verification_status/) });
      await c.query('rollback to savepoint s');
      await expect(c.query(`update source_claim set verification_status = 'on_track' where id = $1`, [claim.body.id])).rejects.toMatchObject({ code: '22P02' });
      await c.query('rollback to savepoint s');
    } finally {
      await c.query('rollback');
      c.release();
    }
    // The runtime role (what the API uses) is refused the same way.
    await asRuntime({ org: orgId, user: p.pm.userId, projects: [pid] }, async (rc) => {
      await expect(rc.query(`update source_claim set verification_status = 'Confirmed' where id = $1`, [claim.body.id])).rejects.toMatchObject({ code: '22P02' });
    });
    expect((await owner().query('select verification_status::text v from source_claim where id = $1', [claim.body.id])).rows[0].v).toBe('unknown');
  });
});

// ------------------------------------------------------------------------------------------------------------------
describe('P1 closure — ARC-014: mandatory mutation flow — 401 without a session; a failed business rule leaves no business change and no outbox row [REQ-ARC-014]', () => {
  it('a mutation without a session (or with a forged/expired cookie) returns 401 problem+json and changes nothing', async () => {
    const before = await projectTableCounts(pid);
    const outboxBefore = (await owner().query<{ n: number }>('select count(*)::int n from outbox_event where project_id = $1', [pid])).rows[0]!.n;
    const anon = await anonymous();
    // Built lazily and sent one at a time (supertest binds the server per request).
    const attempts = [
      () => anon.post(P('/raid/risks')).send({ title: 'anonymous risk', probability: 3, impact: 3 }),
      () => anon.post(P('/raid/risks')).set('x-csrf-token', 'x'.repeat(32)).send({ title: 'anonymous risk', probability: 3, impact: 3 }),
      () => anon.post(P('/raid/risks')).set('Cookie', `hub_session=${'f'.repeat(43)}; hub_csrf=abc`).set('x-csrf-token', 'abc').send({ title: 'forged cookie', probability: 3, impact: 3 }),
      () => anon.patch(P()).send({ expectedVersion: 1, objective: 'anonymous edit' }),
      () => anon.post('/api/v1/projects').send({ code: 'P1C-ANON', name: 'anonymous project' }),
    ];
    for (const a of attempts) {
      const r = await a();
      expect(r.status).toBe(401);
      expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(r.body).toMatchObject({ status: 401, code: 'auth.required' });
      expect(r.body.correlationId).toBeTruthy();
    }
    expect(await projectTableCounts(pid)).toEqual(before);
    expect((await owner().query<{ n: number }>('select count(*)::int n from outbox_event where project_id = $1', [pid])).rows[0]!.n).toBe(outboxBefore);
    expect((await owner().query(`select count(*)::int n from project where code = 'P1C-ANON'`)).rows[0].n).toBe(0);
    // Order of the flow: authentication precedes CSRF — a session with a missing CSRF header gets 403 instead
    // (covered in isolation-and-auth.spec.ts "rejects state-changing requests without the CSRF header" and
    // security-p1-fixes.spec.ts "SEC-P1-11: CSRF denials are audited as security events").
    const noCsrf = await p.pm.agent.post(P('/raid/risks')).send({ title: 'no csrf', probability: 3, impact: 3 });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.code).toBe('auth.csrf');
  });

  it('a rejected business rule (422) writes no outbox row and no business change, and is audited with outcome rejected', async () => {
    const sourceId = await newSource(p.pm, 'p1c-arc014-historical.xlsx');
    const task = (await owner().query<{ id: string }>('select id from task where project_id = $1 order by wbs_code limit 1', [pid])).rows[0]!;
    const claim = await p.pm
      .post(P(`/sources/${sourceId}/claims`), {
        location: 'row 7 (synthetic)',
        subject: 'Historical task status',
        targetType: 'task',
        targetId: task.id,
        field: 'status',
        extractedValue: 'Completed',
        sourceReportedValue: 'Completed',
        verificationStatus: 'historical_unverified',
      })
      .expect(201);

    // Business state = every project-scoped table except the audit log (rejected attempts ARE audited — recorded variance).
    const business = async () => {
      const { audit_event: _audit, ...rest } = await projectTableCounts(pid);
      return rest;
    };
    const counts = await business();
    const auditBefore = (await owner().query<{ n: number }>('select count(*)::int n from audit_event where project_id = $1', [pid])).rows[0]!.n;
    const outbox = await owner().query('select id, dispatched_at from outbox_event where project_id = $1 order by id', [pid]);
    const jobs = (await owner().query<{ n: number }>('select count(*)::int n from job where project_id = $1', [pid])).rows[0]!.n;
    const claimRow = (await owner().query('select * from source_claim where id = $1', [claim.body.id])).rows[0];
    const taskRow = (await owner().query('select * from task where id = $1', [task.id])).rows[0];

    const correlationId = `p1c-arc014-${Date.now()}`;
    const res = await p.pm.post(P(`/claims/${claim.body.id}/propose-change`), { expectedVersion: 1 }).set('x-correlation-id', correlationId);
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.code).toBe('claims.historical_not_applicable');
    expect(res.body.correlationId).toBe(correlationId);

    // No business change, no outbox row, no job.
    expect(await business()).toEqual(counts);
    expect((await owner().query('select id, dispatched_at from outbox_event where project_id = $1 order by id', [pid])).rows).toEqual(outbox.rows);
    expect((await owner().query<{ n: number }>('select count(*)::int n from job where project_id = $1', [pid])).rows[0]!.n).toBe(jobs);
    expect((await owner().query('select * from source_claim where id = $1', [claim.body.id])).rows[0]).toEqual(claimRow);
    expect((await owner().query('select * from task where id = $1', [task.id])).rows[0]).toEqual(taskRow);
    expect((await owner().query(`select count(*)::int n from approval_request where payload->>'claimId' = $1`, [claim.body.id])).rows[0].n).toBe(0);

    // Audited (recorded variance: rejected attempts ARE audited) — only with outcome rejected, never success.
    const audit = await owner().query<{ outcome: string; action: string; actor_user_id: string; reason: string }>(
      'select outcome::text, action, actor_user_id, reason from audit_event where correlation_id = $1 order by chain_pos',
      [correlationId],
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
    expect(audit.rows.every((a) => a.outcome === 'rejected' && a.actor_user_id === p.pm.userId)).toBe(true);
    // …and those rejected rows are the only audit rows the attempt added to the project.
    const auditAfter = (await owner().query<{ n: number }>('select count(*)::int n from audit_event where project_id = $1', [pid])).rows[0]!.n;
    expect(auditAfter - auditBefore).toBe(audit.rows.length);
    expect(audit.rows.map((a) => a.reason).join(' ')).toMatch(/claims\.historical_not_applicable/);
  });

  it('a command that fails after its first writes leaves nothing behind (change, audit and outbox share one transaction)', async () => {
    // createProject inserts the project, instantiates the template (workstreams, tasks, gates…) and the PM membership
    // BEFORE it validates the NewCo reference; the failure must roll all of that back, and no outbox row may survive.
    const admin = await loginAs('portfolio.admin');
    const templates = (await admin.get('/api/v1/templates').expect(200)).body.items as { id: string; templateKey: string }[];
    const dc = templates.find((t) => t.templateKey === 'dc-carveout')!;
    const code = 'P1C-ROLLBACK';
    const outboxBefore = (await owner().query<{ n: number }>('select count(*)::int n from outbox_event where org_id = $1', [orgId])).rows[0]!.n;
    const r = await admin.post('/api/v1/projects', {
      templateVersionId: dc.id,
      code,
      name: 'P1 closure rollback probe (synthetic)',
      projectManagerUserId: await demoUserId('pm'),
      newco: { mode: 'existing', legalEntityId: '00000000-0000-4000-8000-000000000000', incorporationStatus: 'unconfirmed' },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.code).toBe('portfolio.newco_entity_invalid');
    expect((await owner().query('select count(*)::int n from project where code = $1', [code])).rows[0].n).toBe(0);
    expect((await owner().query(`select count(*)::int n from audit_event where action = 'portfolio.project.create' and after->>'code' = $1`, [code])).rows[0].n).toBe(0);
    expect((await owner().query<{ n: number }>('select count(*)::int n from outbox_event where org_id = $1', [orgId])).rows[0]!.n).toBe(outboxBefore);
    // No orphan rows of a half-created project anywhere (every project-scoped table joins to an existing project).
    const orphans = await owner().query<{ n: number }>(`select count(*)::int n from workstream w where not exists (select 1 from project p where p.id = w.project_id)`);
    expect(orphans.rows[0]!.n).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------------------------
describe('P1 closure — DAT-008: the audit hash-chain verifier detects a MODIFIED row [REQ-DAT-008, ADR-0014]', () => {
  it('a modified audit row is reported at its chain position; a re-hashed forgery breaks the next link; a re-hashed tail is caught by the checkpoint', async () => {
    // Tamper is simulated as the OWNER with the append-only trigger disabled, inside a transaction that is rolled back,
    // on a throwaway organization's chain (the demo organization's chain is not touched).
    const c = await owner().connect();
    const rehash = (reason: string) => `hash = encode(digest(concat_ws('|',
        prev_hash, chain_pos::text, id::text, org_id::text, coalesce(project_id::text, ''), coalesce(actor_user_id::text, ''),
        actor_kind::text, action, coalesce(entity_type, ''), coalesce(entity_id::text, ''), outcome, ${reason}, coalesce(before::text, ''),
        coalesce(after::text, ''), coalesce(correlation_id, ''), to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')), 'sha256'), 'hex')`;
    try {
      await c.query('begin');
      const org = (await c.query<{ id: string }>(`insert into organization (id, name, slug) values (gen_random_uuid(), 'P1 closure tamper probe (test)', 'p1c-tamper-' || substr(md5(random()::text), 1, 8)) returning id`)).rows[0]!.id;
      const outcomes = ['success', 'denied', 'success', 'success'];
      for (let i = 0; i < outcomes.length; i++) {
        await c.query(`insert into audit_event (org_id, actor_kind, action, entity_type, outcome, reason) values ($1, 'system', 'p1c.tamper_probe', 'probe', $2, $3)`, [org, outcomes[i], `probe row ${i + 1}`]);
      }
      const verify = async () => (await c.query<{ broken_at: string; expected: string; actual: string }>('select * from hub_audit_verify($1)', [org])).rows;
      expect(await verify()).toEqual([]);
      const pos = (await c.query<{ chain_pos: string; hash: string }>('select chain_pos::text, hash from audit_event where org_id = $1 order by chain_pos', [org])).rows;
      expect(pos.map((x) => Number(x.chain_pos))).toEqual([1, 2, 3, 4]);

      await c.query('alter table audit_event disable trigger hub_append_only');
      await c.query('savepoint tamper');

      // (1) Hide a denial: row 2 outcome denied → success (stored hash left as is).
      await c.query(`update audit_event set outcome = 'success' where org_id = $1 and chain_pos = 2`, [org]);
      let v = await verify();
      expect(v).toHaveLength(1);
      expect(Number(v[0]!.broken_at)).toBe(2);
      expect(v[0]!.actual).toBe(pos[1]!.hash);
      expect(v[0]!.expected).not.toBe(v[0]!.actual);
      await c.query('rollback to savepoint tamper');
      expect(await verify()).toEqual([]);

      // (2) Rewrite row 2 AND recompute its own hash: the next row's prev_hash no longer matches → reported at 3.
      await c.query(`update audit_event set reason = 'rewritten', ${rehash(`'rewritten'`)} where org_id = $1 and chain_pos = 2`, [org]);
      v = await verify();
      expect(v).toHaveLength(1);
      expect(Number(v[0]!.broken_at)).toBe(3);
      await c.query('rollback to savepoint tamper');

      // (3) Rewrite the LAST row with a recomputed hash: no successor, so only the checkpoint reveals it.
      await c.query(`update audit_event set reason = 'rewritten tail', ${rehash(`'rewritten tail'`)} where org_id = $1 and chain_pos = 4`, [org]);
      expect(await verify()).toEqual([]); // honest limit (ADR-0014): without a checkpoint a re-hashed tail is not detectable
      await c.query('rollback to savepoint tamper');
      await c.query('select hub_audit_checkpoint($1)', [org]);
      await c.query(`update audit_event set reason = 'rewritten tail', ${rehash(`'rewritten tail'`)} where org_id = $1 and chain_pos = 4`, [org]);
      v = await verify();
      expect(v).toHaveLength(1);
      expect(Number(v[0]!.broken_at)).toBe(4);
      expect(v[0]!.actual).toMatch(/checkpoint mismatch/);
    } finally {
      await c.query('rollback');
      c.release();
    }
    // Nothing persisted: the trigger is enabled again and the real organization chain still verifies.
    const trig = await owner().query<{ tgenabled: string }>(`select tgenabled from pg_trigger where tgname = 'hub_append_only' and tgrelid = 'audit_event'::regclass`);
    expect(trig.rows[0]!.tgenabled).toBe('O');
    expect((await owner().query('select * from hub_audit_verify($1)', [orgId])).rows).toEqual([]);
    expect((await owner().query(`select count(*)::int n from organization where slug like 'p1c-tamper-%'`)).rows[0].n).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------------------------
describe('P1 closure — DAT-012: downloads need a valid session; no public or presigned links [REQ-DAT-012, REQ-SEC-019]', () => {
  it('a download is refused (401) without a session, with a forged cookie, after logout (revoked) and after idle expiry; the owner session still works', async () => {
    const doc = await createWithVersion(pmDoc, pid, { title: 'P1C download probe (synthetic)' }, { bytes: Buffer.from('P1 closure synthetic download probe.'), name: 'p1c-download.txt' });
    expect(doc.upload.status, JSON.stringify(doc.upload.body)).toBe(201);
    const versionId = (doc.upload.body.versionId ?? doc.upload.body.id) as string;
    const url = `${docsPath(pid)}/${doc.id}/versions/${versionId}/download`;

    // A dedicated session (so the shared pm client is not logged out).
    const s = await docLogin('pm');
    const ok = await getBinary(s, url);
    expect(ok.status).toBe(200);
    expect(ok.body.toString('utf8')).toContain('P1 closure synthetic download probe.');
    const token = await cookieValue(s.agent, 'hub_session');
    const app = await getApp();
    const raw = () => request(app.getHttpServer()).get(url);

    // Anonymous and forged
    expect((await raw()).status).toBe(401);
    expect((await raw().set('Cookie', `hub_session=${'A'.repeat(43)}`)).status).toBe(401);
    expect((await raw().set('Cookie', `hub_session=${token}`)).status).toBe(200); // replaying the real token works while valid

    // Idle expiry: move the injected clock past the idle timeout (60 min default), then back.
    const clock = app.get(Clock);
    try {
      clock.setFixed(new Date(Date.now() + 2 * 60 * 60_000));
      const expired = await raw().set('Cookie', `hub_session=${token}`);
      expect(expired.status).toBe(401);
      expect(expired.body.code).toBe('auth.required');
    } finally {
      clock.setFixed(null);
    }
    expect((await raw().set('Cookie', `hub_session=${token}`)).status).toBe(200);

    // Revoked: logout revokes server-side; the same cookie can no longer download.
    await s.post('/api/v1/auth/logout').expect(201);
    const revoked = await raw().set('Cookie', `hub_session=${token}`);
    expect(revoked.status).toBe(401);
    expect(revoked.headers['content-type']).toMatch(/problem\+json/);
    expect(revoked.body).not.toHaveProperty('stack');
    const sess = await owner().query<{ revoked_at: Date | null }>(`select revoked_at from session where user_id = $1 and revoked_reason = 'logout' order by revoked_at desc limit 1`, [s.userId]);
    expect(sess.rows[0]!.revoked_at).not.toBeNull();

    // Only the one successful download per valid request was audited; refused attempts produced no download audit.
    const downloads = await owner().query<{ n: number }>(`select count(*)::int n from audit_event where action = 'documents.document.download' and entity_id = $1 and outcome = 'success'`, [versionId]);
    expect(downloads.rows[0]!.n).toBe(3);
  });

  it('document list, detail and upload responses contain no URL, storage key or presigned parameter', async () => {
    const doc = await createWithVersion(pmDoc, pid, { title: 'P1C link scan (synthetic)' }, { bytes: Buffer.from('P1 closure link scan.'), name: 'p1c-links.txt' });
    const bodies = [doc.upload.body, (await pmDoc.get(docsPath(pid)).expect(200)).body, (await pmDoc.get(`${docsPath(pid)}/${doc.id}`).expect(200)).body];
    const strings = bodies.flatMap((b) => jsonStrings(b));
    expect(strings.length).toBeGreaterThan(10);
    const offending = strings.filter((s) => /https?:\/\/|X-Amz-|Signature=|Expires=|presign|signedUrl|storageKey|storage_key|\.data\/|objects\/|file:\/\//i.test(s));
    expect(offending).toEqual([]);
    // The stored object key exists server-side but is never serialised.
    const key = (await owner().query<{ storage_key: string }>('select storage_key from document_version where document_id = $1', [doc.id])).rows[0]!.storage_key;
    expect(key.length).toBeGreaterThan(0);
    expect(JSON.stringify(bodies)).not.toContain(key);
  });
});

// ------------------------------------------------------------------------------------------------------------------
describe('P1 closure — SEC-024: development login is unavailable outside demo mode [REQ-SEC-024]', () => {
  it('POST /api/v1/auth/demo-login returns 404 in standard mode and creates no session; production refuses demo mode', async () => {
    const pmId = await demoUserId('pm');
    const sessionsBefore = (await owner().query<{ n: number }>('select count(*)::int n from session where user_id = $1', [pmId])).rows[0]!.n;
    const saved = process.env.HUB_MODE;
    process.env.HUB_MODE = 'standard';
    const standard = (await createApp({ logger: false })).app;
    try {
      const r = await request(standard.getHttpServer()).post('/api/v1/auth/demo-login').send({ userId: pmId });
      expect(r.status).toBe(404);
      expect(r.headers['content-type']).toMatch(/problem\+json/);
      expect(String(r.headers['set-cookie'] ?? '')).not.toMatch(/hub_session=[^;]/);
      expect(r.body).not.toHaveProperty('csrfToken');
      await request(standard.getHttpServer()).get('/api/v1/auth/demo-users').expect(404);
      const cfg = await request(standard.getHttpServer()).get('/api/v1/auth/config');
      if (cfg.status === 200) expect(cfg.body.demoLogin).toBe(false);
    } finally {
      process.env.HUB_MODE = saved;
      await standard.close();
    }
    expect((await owner().query<{ n: number }>('select count(*)::int n from session where user_id = $1', [pmId])).rows[0]!.n).toBe(sessionsBefore);
    // Production configuration can never enable demo mode (the dev login route would otherwise answer).
    expect(() => loadConfig({ ...process.env, NODE_ENV: 'production', HUB_MODE: 'demo' })).toThrow(/HUB_MODE=demo is not allowed in production/);
    // No password column exists anywhere and user accounts hold no credential of any kind (credential-less demo login and
    // IdP-bound accounts; ADR-0005). Sessions store only SHA-256 hashes of their tokens.
    const pw = await owner().query(`select table_name, column_name from information_schema.columns where table_schema = 'public' and column_name ~* '(password|passwd|pwd)'`);
    expect(pw.rows).toEqual([]);
    const userCred = await owner().query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'app_user' and column_name ~* '(secret|credential|token|hash|otp)'`);
    expect(userCred.rows).toEqual([]);
    const sessionCols = (await owner().query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'session' and column_name ~* 'token|csrf'`)).rows.map((r) => r.column_name).sort();
    expect(sessionCols).toEqual(['csrf_hash', 'token_hash']);
  });
});

// ------------------------------------------------------------------------------------------------------------------
describe('P1 closure — ENT-002: a project cannot reference a program (or a program a portfolio) of another organization [REQ-ENT-002]', () => {
  let foreignOrg: string;
  let foreignPortfolio: string;
  let foreignProgram: string;
  let ownProgram: string;
  let templateVersionId: string;

  beforeAll(async () => {
    const o = owner();
    foreignOrg = (await o.query<{ id: string }>(`insert into organization (id, name, slug) values (gen_random_uuid(), 'P1 closure foreign org (test)', 'p1c-foreign-' || substr(md5(random()::text), 1, 8)) returning id`)).rows[0]!.id;
    foreignPortfolio = (await o.query<{ id: string }>(`insert into portfolio (org_id, name) values ($1, 'Foreign portfolio (test)') returning id`, [foreignOrg])).rows[0]!.id;
    foreignProgram = (await o.query<{ id: string }>(`insert into program (org_id, portfolio_id, code, name) values ($1, $2, 'P1C-FOREIGN', 'Foreign program (test)') returning id`, [foreignOrg, foreignPortfolio])).rows[0]!.id;
    ownProgram = (await o.query<{ id: string }>(`select id from program where org_id = $1 order by code limit 1`, [orgId])).rows[0]!.id;
    templateVersionId = (await o.query<{ template_version_id: string }>('select template_version_id from project where id = $1', [pid])).rows[0]!.template_version_id;
  });
  afterAll(async () => {
    const o = owner();
    await o.query('delete from program where org_id = $1', [foreignOrg]);
    await o.query('delete from portfolio where org_id = $1', [foreignOrg]);
    await o.query('delete from organization where id = $1', [foreignOrg]);
  });

  it('API: creating a project under a program of another organization is refused and nothing is created', async () => {
    const admin = await loginAs('portfolio.admin');
    const code = 'P1C-XORG';
    const r = await admin.post('/api/v1/projects', {
      templateVersionId,
      programId: foreignProgram,
      code,
      name: 'Cross-organization program probe (test)',
      projectManagerUserId: await demoUserId('pm'),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.code).toBe('portfolio.program_not_found');
    expect(JSON.stringify(r.body)).not.toContain('Foreign program');
    expect((await owner().query('select count(*)::int n from project where code = $1', [code])).rows[0].n).toBe(0);
    // The program list never shows the other organization's programs.
    const programs = (await admin.get('/api/v1/programs').expect(200)).body.items as { id: string }[];
    expect(programs.some((x) => x.id === foreignProgram)).toBe(false);
    expect(programs.some((x) => x.id === ownProgram)).toBe(true);
  });

  it('DB: the runtime role cannot link a project to a foreign program or a program to a foreign portfolio (referential integrity is org-scoped)', async () => {
    const admin = await demoUserId('portfolio.admin');
    const pmId = await demoUserId('pm');
    // Positive control: the same insert with the organization's own program succeeds.
    await asRuntime({ org: orgId, user: admin, projects: ['00000000-0000-4000-8000-0000000000c1'] }, async (c) => {
      await c.query(
        `insert into project (id, org_id, program_id, template_version_id, code, name, created_by) values ('00000000-0000-4000-8000-0000000000c1', $1, $2, $3, 'P1C-DB-OWN', 'own program (test)', $4)`,
        [orgId, ownProgram, templateVersionId, admin],
      );
    });
    await asRuntime({ org: orgId, user: admin, projects: ['00000000-0000-4000-8000-0000000000c2'] }, async (c) => {
      await expect(
        c.query(
          `insert into project (id, org_id, program_id, template_version_id, code, name, created_by) values ('00000000-0000-4000-8000-0000000000c2', $1, $2, $3, 'P1C-DB-XORG', 'foreign program (test)', $4)`,
          [orgId, foreignProgram, templateVersionId, admin],
        ),
      ).rejects.toMatchObject({ code: '23503' });
    });
    await asRuntime({ org: orgId, user: admin, projects: [] }, async (c) => {
      await expect(c.query(`insert into program (org_id, portfolio_id, code, name, created_by) values ($1, $2, 'P1C-DB-XPF', 'foreign portfolio (test)', $3)`, [orgId, foreignPortfolio, pmId])).rejects.toMatchObject({
        code: '23503',
      });
    });
    // An existing project cannot be moved under a foreign program either.
    await asRuntime({ org: orgId, user: admin, projects: [pid] }, async (c) => {
      await expect(c.query('update project set program_id = $2 where id = $1', [pid, foreignProgram])).rejects.toMatchObject({ code: '23503' });
    });
    expect((await owner().query(`select count(*)::int n from project where program_id = $1`, [foreignProgram])).rows[0].n).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------------------------
describe('P1 closure — DAT-017: problem responses carry no stack trace, SQL or internal paths; logs never contain the session cookie or CSRF token [REQ-DAT-017]', () => {
  const LEAK = /\bat [\w.<>]+ \(|\n\s+at |stack|Failed query|select |insert into|update .* set|params:|\/home\/|\/apps\/api|node_modules|\.ts:\d+|\.js:\d+|postgres:\/\/|hub_dev_only/i;

  function fakeHost(req: object, res: { statusCode?: number; body?: string; headers?: Record<string, string> }) {
    res.headers = {};
    const r = {
      headersSent: false,
      getHeader: (k: string) => res.headers![k.toLowerCase()],
      setHeader: (k: string, v: string) => {
        res.headers![k.toLowerCase()] = v;
      },
      status(s: number) {
        res.statusCode = s;
        return r;
      },
      type() {
        return r;
      },
      send(b: string) {
        res.body = b;
        return r;
      },
    };
    return { switchToHttp: () => ({ getRequest: () => req, getResponse: () => r }) } as unknown as ArgumentsHost;
  }

  it('unit: the problem filter turns an unexpected error (stack, SQL, parameters, paths) and a driver constraint error into generic problem bodies', async () => {
    const logged: string[] = [];
    const filter = new ProblemFilter({ recordDetached: async () => undefined } as unknown as AuditService);
    (filter as unknown as { log: { error: (m: string) => void } }).log = { error: (m: string) => logged.push(m) };
    const req = { method: 'GET', headers: { 'x-correlation-id': 'p1c-dat017-unit' }, params: {}, path: '/x' };

    const boom = new Error('Failed query: select token_hash from session where user_id = $1\nparams: 0199aaaa-secret-param');
    boom.stack = `${boom.message}\n    at SessionService.resolve (/home/user/hub/apps/api/src/platform/auth/session.service.ts:37:5)`;
    const res1: { statusCode?: number; body?: string } = {};
    await filter.catch(boom, fakeHost(req, res1));
    expect(res1.statusCode).toBe(500);
    const b1 = JSON.parse(res1.body!);
    expect(b1).toEqual({ type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', detail: 'An unexpected error occurred.', correlationId: 'p1c-dat017-unit' });
    expect(res1.body).not.toMatch(LEAK);
    // The server log keeps the class/message for operators, with the SQL and bound parameters redacted.
    expect(logged.join('\n')).toMatch(/Failed query: \[redacted\]/);
    expect(logged.join('\n')).not.toMatch(/0199aaaa-secret-param|token_hash/);

    const pg = Object.assign(new Error('duplicate key value violates unique constraint "app_user_org_email_uq"'), {
      code: '23505',
      detail: 'Key (org_id, email)=(x, someone@example.invalid) already exists.',
      constraint: 'app_user_org_email_uq',
      table: 'app_user',
    });
    const res2: { statusCode?: number; body?: string } = {};
    await filter.catch(new Error('Failed query: insert into app_user ...', { cause: pg }), fakeHost({ ...req, method: 'POST' }, res2));
    expect(res2.statusCode).toBe(409);
    expect(JSON.parse(res2.body!)).toMatchObject({ status: 409, code: 'db.unique_violation' });
    expect(res2.body).not.toMatch(/app_user|someone@example\.invalid|constraint|Key \(/);
  });

  describe('through the real API with the logger enabled', () => {
    let app: INestApplication;
    const lines: string[] = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);

    beforeAll(async () => {
      app = (await createApp()).app; // logger on (error/warn/log), exactly as main.ts
      const cap = (level: string) => (message: unknown, ...rest: unknown[]) => lines.push(`${level} ${String(message)} ${rest.map(String).join(' ')}`);
      const logger: LoggerService = { log: cap('log'), error: cap('error'), warn: cap('warn'), debug: cap('debug'), verbose: cap('verbose'), fatal: cap('fatal') };
      app.useLogger(logger);
      const tap = (orig: typeof process.stdout.write) =>
        ((chunk: unknown, ...args: unknown[]) => {
          lines.push(`raw ${String(chunk)}`);
          return (orig as (...a: unknown[]) => boolean)(chunk, ...args);
        }) as typeof process.stdout.write;
      process.stdout.write = tap(origOut);
      process.stderr.write = tap(origErr);
    });
    afterAll(async () => {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
      await app?.close();
    });

    it('4xx and 5xx problem bodies hold no internals, and the cookie / CSRF values never reach logs or audit rows', async () => {
      const pmId = await demoUserId('pm');
      const agent = request.agent(app.getHttpServer());
      const login = await agent.post('/api/v1/auth/demo-login').send({ userId: pmId }).expect(201);
      const csrf = login.body.csrfToken as string;
      const session = await cookieValue(agent, 'hub_session');
      expect(session.length).toBeGreaterThan(20);
      const wrongCsrf = `p1c-wrong-csrf-${'z'.repeat(24)}`;

      const responses: { label: string; status: number; body: unknown; text: string; headers: Record<string, string> }[] = [];
      const record = (label: string, r: request.Response) => responses.push({ label, status: r.status, body: r.body, text: r.text, headers: r.headers as Record<string, string> });
      record('ok read', await agent.get(P()));
      record('validation 400', await agent.patch(P()).set('x-csrf-token', csrf).send({ expectedVersion: 'x' }));
      record('unknown 404', await agent.get(P('/documents/00000000-0000-4000-8000-000000000000')));
      record('wrong csrf 403', await agent.post(P('/raid/risks')).set('x-csrf-token', wrongCsrf).send({ title: 'p1c', probability: 1, impact: 1 }));
      record('malformed json 400', await agent.post(P('/raid/risks')).set('x-csrf-token', csrf).set('content-type', 'application/json').send('{"title": "p1c",'));
      record('unknown route 404', await agent.get('/api/v1/p1c-no-such-route'));
      // NUL bytes pass the text schema but PostgreSQL refuses them: an unexpected driver error path.
      const nul = await agent.post(P('/raid/risks')).set('x-csrf-token', csrf).send({ title: `p1c nul \u0000 ${session.slice(0, 6)}`, probability: 1, impact: 1 });
      record('driver error', nul);

      for (const r of responses.filter((x) => x.status >= 400)) {
        const b = r.body as Record<string, unknown>;
        expect(b.type, r.label).toBe('about:blank');
        expect(typeof b.code, r.label).toBe('string');
        expect(b.correlationId, r.label).toBeTruthy();
        expect(r.headers['x-correlation-id'], r.label).toBe(b.correlationId);
        expect(b, r.label).not.toHaveProperty('stack');
        expect(r.text, r.label).not.toMatch(LEAK);
        expect(r.text, r.label).not.toContain(session);
        expect(r.text, r.label).not.toContain(csrf);
      }
      expect(responses.find((r) => r.label === 'validation 400')!.status).toBe(400);
      expect(responses.find((r) => r.label === 'wrong csrf 403')!.status).toBe(403);
      expect(responses.find((r) => r.label === 'malformed json 400')!.status).toBe(400);
      expect(responses.find((r) => r.label === 'unknown route 404')!.status).toBe(404);
      expect([400, 422, 500]).toContain(nul.status);
      if (nul.status === 500) {
        expect(nul.body).toMatchObject({ code: 'internal_error', detail: 'An unexpected error occurred.' });
        // The operator log line exists (capture works) and has the SQL/parameters redacted.
        const line = lines.find((l) => l.includes(nul.body.correlationId));
        expect(line, lines.join('\n')).toBeTruthy();
        expect(line).not.toMatch(/insert into|params:/i);
      }

      const all = lines.join('\n');
      expect(all).not.toContain(session);
      expect(all).not.toContain(csrf);
      expect(all).not.toContain(wrongCsrf);
      expect(all).not.toMatch(/hub_session=|hub_csrf=|x-csrf-token:/i);
      // Audit rows of the denied/rejected attempts do not store the tokens either.
      const audit = await owner().query<{ t: string }>(`select concat_ws(' ', reason, before::text, after::text) t from audit_event where actor_user_id = $1 and created_at > now() - interval '5 minutes'`, [await demoUserId('pm')]);
      const auditText = audit.rows.map((r) => r.t).join('\n');
      expect(auditText).toMatch(/auth\.csrf|CSRF/);
      expect(auditText).not.toContain(session);
      expect(auditText).not.toContain(csrf);
      expect(auditText).not.toContain(wrongCsrf);
    });
  });
});
