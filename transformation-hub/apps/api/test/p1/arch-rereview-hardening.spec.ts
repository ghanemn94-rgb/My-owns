import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { PoolClient } from 'pg';
import { closeApp, closePools, DC, GEN, getApp, loginAs, owner, projectIdByCode, runtimePool, demoUserId } from '../helpers';
import { DbService } from '../../src/platform/db.service';
import { PolicyService } from '../../src/platform/policy.service';
import { JobRegistry } from '../../src/platform/jobs/job-registry';
import { registerPlatformJobs, PLATFORM_SCHEDULES } from '../../src/platform/jobs/platform.jobs';
import { extraKeys } from '../../src/platform/response.interceptor';
import { scanUsable } from '../../src/modules/documents/documents.service';
import type { RequestContext } from '../../src/platform/context';

/**
 * Regression tests for the P0 architecture RE-review conditions (docs/reviews/P0-architecture-review.md, "Re-review at
 * 824bed9"): ARCH-05 residual, ARCH-07, ARCH-10, ARCH-14, ARCH-16, ARCH-18, ARCH-19, ARCH-21, ARCH-22, ARCH-23.
 */
let dcId: string;
let genId: string;
let orgId: string;

async function ownerTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await owner().connect();
  try {
    await c.query('begin');
    return await fn(c);
  } finally {
    await c.query('rollback').catch(() => undefined);
    c.release();
  }
}

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

async function newDoc(c: PoolClient, projectId: string, title: string, user: string) {
  const d = await c.query(`insert into document (org_id, project_id, title, kind) values ($1,$2,$3,'evidence') returning id`, [orgId, projectId, title]);
  const v = await c.query(
    `insert into document_version (org_id, project_id, document_id, version_no, storage_key, filename, mime_type, size_bytes, sha256, uploaded_by)
     values ($1,$2,$3,1,'k-' || gen_random_uuid(),'f.txt','text/plain',1,repeat('c',64),$4) returning id`,
    [orgId, projectId, d.rows[0].id, user],
  );
  return { docId: d.rows[0].id as string, versionId: v.rows[0].id as string };
}

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

describe('ARCH-23 — project_id / org_id are immutable', () => {
  it('rejects moving a task to another project (even for the owner role)', async () => {
    const task = (await owner().query('select id from task where project_id = $1 limit 1', [dcId])).rows[0].id;
    await expect(owner().query('update task set project_id = $2, workstream_id = null where id = $1', [task, genId])).rejects.toThrow(/immutable_scope/);
    await expect(owner().query('update project set org_id = gen_random_uuid() where id = $1', [dcId])).rejects.toThrow(/immutable_scope/);
    // other columns are still updatable
    await ownerTx(async (c) => {
      await c.query(`update task set title = title where id = $1`, [task]);
    });
  });
});

describe('ARCH-21 / ARCH-15b — references are constrained to the same organization / project', () => {
  it('user references must be users of the same organization', async () => {
    const taskA = (await owner().query('select id from task where project_id = $1 limit 1', [dcId])).rows[0].id;
    await ownerTx(async (c) => {
      const org2 = await c.query(`insert into organization (id, name, slug) values (gen_random_uuid(), 'Other org (test)', 'other-' || substr(md5(random()::text), 1, 8)) returning id`);
      const u2 = await c.query(`insert into app_user (id, org_id, email, display_name) values (gen_random_uuid(), $1, 'x@other.invalid', 'Other') returning id`, [org2.rows[0].id]);
      await c.query('savepoint s1');
      await expect(
        c.query(`insert into evidence_link (org_id, project_id, target_type, target_id, added_by) values ($1,$2,'task',$3,$4)`, [orgId, dcId, taskA, u2.rows[0].id]),
      ).rejects.toMatchObject({ code: '23503' });
      await c.query('rollback to savepoint s1');
      await expect(
        c.query(`insert into evidence_link (org_id, project_id, target_type, target_id, added_by) values ($1,$2,'task',$3,gen_random_uuid())`, [orgId, dcId, taskA]),
      ).rejects.toMatchObject({ code: '23503' });
    });
  });

  it('a project row cannot claim another organization for its project (org, project) binding', async () => {
    await ownerTx(async (c) => {
      const org2 = await c.query(`insert into organization (id, name, slug) values (gen_random_uuid(), 'Other org (test)', 'other-' || substr(md5(random()::text), 1, 8)) returning id`);
      await expect(c.query(`insert into assumption (org_id, project_id, code, title) values ($1, $2, 'A-X', 'probe')`, [org2.rows[0].id, dcId])).rejects.toMatchObject({ code: '23503' });
    });
  });

  it('document.current_version_id must be a version of the same document — checked at commit (probe P8c)', async () => {
    await ownerTx(async (c) => {
      const a = await newDoc(c, dcId, 'doc A', pmId);
      await c.query('savepoint s1');
      // Project-B document pointing at a Project-A version
      await expect(
        (async () => {
          await c.query(`insert into document (org_id, project_id, title, kind, current_version_id) values ($1,$2,'B points to A','evidence',$3)`, [orgId, genId, a.versionId]);
          await c.query('set constraints all immediate');
        })(),
      ).rejects.toThrow(/cross_project_reference/);
      await c.query('rollback to savepoint s1');
      // Valid: set the current version of the same document
      await c.query(`update document set current_version_id = $2 where id = $1`, [a.docId, a.versionId]);
      await c.query('set constraints all immediate');
    });
  });

  it('a document and its first version can be written in either order inside one transaction (deferred check)', async () => {
    const c = await owner().connect();
    try {
      await c.query('begin');
      const docId = (await c.query('select gen_random_uuid() id')).rows[0].id;
      const verId = (await c.query('select gen_random_uuid() id')).rows[0].id;
      await c.query(`insert into document (id, org_id, project_id, title, kind, current_version_id) values ($1,$2,$3,'order probe','evidence',$4)`, [docId, orgId, dcId, verId]);
      await c.query(
        `insert into document_version (id, org_id, project_id, document_id, version_no, storage_key, filename, mime_type, size_bytes, sha256, uploaded_by)
         values ($1,$2,$3,$4,1,'k-order','f.txt','text/plain',1,repeat('d',64),$5)`,
        [verId, orgId, dcId, docId, pmId],
      );
      await c.query('set constraints all immediate'); // the deferred check passes
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  it('DD request evidence lists may only name documents of the same project (probe P8d)', async () => {
    await ownerTx(async (c) => {
      const a = await newDoc(c, dcId, 'evidence A', pmId);
      await c.query('savepoint s1');
      await expect(
        c.query(`insert into diligence_request (org_id, project_id, number, question, domain, evidence_document_ids) values ($1,$2,901,'q','legal',$3::jsonb)`, [orgId, genId, JSON.stringify([a.docId])]),
      ).rejects.toThrow(/cross_project_reference/);
      await c.query('rollback to savepoint s1');
      const ok = await c.query(`insert into diligence_request (org_id, project_id, number, question, domain, evidence_document_ids) values ($1,$2,902,'q','legal',$3::jsonb) returning id`, [
        orgId,
        dcId,
        JSON.stringify([a.docId]),
      ]);
      expect(ok.rows[0].id).toBeTruthy();
    });
  });

  it('AT-05 integrity: a vote must be cast by the member (user) of the deciding committee', async () => {
    const sponsorId = await demoUserId('sponsor');
    await ownerTx(async (c) => {
      const cm = await c.query(`insert into committee (org_id, project_id, kind, name) values ($1,$2,'program_steering','Vote probe committee') returning id`, [orgId, dcId]);
      const mk = async (user: string, role: string) =>
        (
          await c.query(
            `insert into committee_membership (org_id, project_id, committee_id, user_id, role_label, member_role, valid_from) values ($1,$2,$3,$4,'probe',$5,current_date) returning id`,
            [orgId, dcId, cm.rows[0].id, user, role],
          )
        ).rows[0].id as string;
      const mPm = await mk(pmId, 'voting_member');
      await mk(sponsorId, 'chair');
      const d = await c.query(`insert into decision (org_id, project_id, committee_id, code, title) values ($1,$2,$3,'D-PROBE','probe') returning id`, [orgId, dcId, cm.rows[0].id]);
      await c.query('savepoint s1');
      await expect(
        c.query(`insert into vote (org_id, project_id, decision_id, user_id, membership_id, member_role_at_vote, choice) values ($1,$2,$3,$4,$5,'voting_member','approve')`, [orgId, dcId, d.rows[0].id, sponsorId, mPm]),
      ).rejects.toThrow(/vote_membership_mismatch/);
      await c.query('rollback to savepoint s1');
      await c.query(`insert into vote (org_id, project_id, decision_id, user_id, membership_id, member_role_at_vote, choice) values ($1,$2,$3,$4,$5,'voting_member','approve')`, [orgId, dcId, d.rows[0].id, pmId, mPm]);
    });
  });
});

describe('ARCH-22 — room-only principals at the database layer', () => {
  it('a partner sees only its own membership rows and cannot write room grants', async () => {
    const partner = await demoUserId('partner.alpha');
    const pid = dcId;
    const room = (await owner().query(`insert into partner_room (org_id, project_id, name, is_clean_team) values ($1,$2,'ARCH-22 probe room (test)',false) returning id`, [orgId, dcId])).rows[0].id;
    const grant = await owner().query(`insert into room_grant (org_id, project_id, room_id, user_id, role, reason, granted_by) values ($1,$2,$3,$4,'external_partner_limited','test',$4) returning id`, [orgId, dcId, room, partner]);
    onTestFinished(async () => {
      await owner().query(`update room_grant set revoked_at = now(), revoked_by = granted_by where id = $1`, [grant.rows[0].id]);
    });
    await asRuntime({ org: orgId, user: partner, projects: [pid], full: [], rooms: [room] }, async (c) => {
      const m = await c.query('select user_id from project_membership');
      expect(m.rows.every((r) => r.user_id === partner)).toBe(true);
      const g = await c.query('select user_id from room_grant');
      expect(g.rows.every((r) => r.user_id === partner)).toBe(true);
      await expect(c.query(`insert into room_grant (org_id, project_id, room_id, user_id, role) values ($1,$2,$3,$4,'external_partner_limited')`, [orgId, pid, room, partner])).rejects.toThrow(
        /row-level security/,
      );
    });
  });
});

describe('Clean team / partner rooms — document versions and evidence follow the document room', () => {
  it('room-only principals see versions and evidence of their room only; moving the document cascades', async () => {
    const cleanteam = await demoUserId('cleanteam');
    const room = (await owner().query(`insert into partner_room (org_id, project_id, name, is_clean_team) values ($1,$2,'Clean team probe room (test)',true) returning id`, [orgId, dcId])).rows[0].id;
    const grant = await owner().query(`insert into room_grant (org_id, project_id, room_id, user_id, role, reason, granted_by) values ($1,$2,$3,$4,'clean_team','test',$5) returning id`, [orgId, dcId, room, cleanteam, pmId]);
    onTestFinished(async () => {
      await owner().query(`update room_grant set revoked_at = now(), revoked_by = granted_by where id = $1`, [grant.rows[0].id]);
    });
    const c = await owner().connect();
    let inRoom: { docId: string; versionId: string };
    let outside: { docId: string; versionId: string };
    try {
      await c.query('begin');
      inRoom = await newDoc(c, dcId, 'in-room doc (test)', pmId);
      outside = await newDoc(c, dcId, 'outside doc (test)', pmId);
      await c.query('update document set room_id = $2 where id = $1', [inRoom.docId, room]);
      await c.query('commit');
    } finally {
      c.release();
    }
    const v = await owner().query('select id, room_id from document_version where id = any($1)', [[inRoom.versionId, outside.versionId]]);
    expect(Object.fromEntries(v.rows.map((r) => [r.id, r.room_id]))).toEqual({ [inRoom.versionId]: room, [outside.versionId]: null });

    const taskA = (await owner().query('select id from task where project_id = $1 limit 1', [dcId])).rows[0].id;
    const ev = await owner().query(`insert into evidence_link (org_id, project_id, target_type, target_id, document_id, added_by) values ($1,$2,'task',$3,$4,$5) returning room_id`, [orgId, dcId, taskA, inRoom.docId, pmId]);
    expect(ev.rows[0].room_id).toBe(room);
    // a client-supplied room_id is ignored (derived from the document)
    const forged = await owner().query(`insert into evidence_link (org_id, project_id, target_type, target_id, document_id, room_id, added_by) values ($1,$2,'task',$3,$4,$5,$6) returning room_id`, [orgId, dcId, taskA, outside.docId, room, pmId]);
    expect(forged.rows[0].room_id).toBeNull();

    await asRuntime({ org: orgId, user: cleanteam, projects: [dcId], full: [], rooms: [room] }, async (rc) => {
      const versions = await rc.query('select id from document_version where id = any($1)', [[inRoom.versionId, outside.versionId]]);
      expect(versions.rows.map((r) => r.id)).toEqual([inRoom.versionId]);
      const links = await rc.query('select document_id from evidence_link where document_id = any($1)', [[inRoom.docId, outside.docId]]);
      expect(links.rows.every((r) => r.document_id === inRoom.docId)).toBe(true);
    });

    // moving the document out of the room cascades to its versions and evidence
    await owner().query('update document set room_id = null where id = $1', [inRoom.docId]);
    const after = await owner().query('select room_id from document_version where id = $1', [inRoom.versionId]);
    expect(after.rows[0].room_id).toBeNull();
    const evAfter = await owner().query('select count(*)::int n from evidence_link where document_id = $1 and room_id is not null', [inRoom.docId]);
    expect(evAfter.rows[0].n).toBe(0);
  });
});

describe('ARCH-05 residual / ARCH-16 — audit checkpoints', () => {
  it('the runtime role cannot forge checkpoints or checkpoint another organization', async () => {
    await asRuntime({ org: orgId, user: pmId, projects: [dcId], full: [dcId], rooms: [] }, async (c) => {
      await c.query('savepoint s1');
      await expect(c.query(`insert into audit_checkpoint (id, org_id, chain_pos, hash, row_count) values (gen_random_uuid(), $1, 1, repeat('f',64), 1)`, [orgId])).rejects.toThrow(/permission denied/);
      await c.query('rollback to savepoint s1');
      await expect(c.query('select hub_audit_checkpoint(gen_random_uuid())')).rejects.toThrow(/audit_checkpoint_forbidden/);
    });
  });

  it('service/system audit rows cannot name a human actor', async () => {
    await asRuntime({ org: orgId, projects: [dcId], full: [dcId], rooms: [] }, async (c) => {
      await expect(c.query(`insert into audit_event (org_id, actor_user_id, actor_kind, action) values ($1,$2,'service','forged')`, [orgId, pmId])).rejects.toThrow(/audit_actor_mismatch/);
    });
  });

  it('the worker job platform.audit.checkpoint records the chain head; schedules exist for the organization', async () => {
    const app = await getApp();
    const registry = app.get(JobRegistry);
    if (!registry.handler('platform.audit.checkpoint')) registerPlatformJobs(app);
    const before = Number((await owner().query('select count(*)::int n from audit_checkpoint where org_id = $1', [orgId])).rows[0].n);
    const result = await registry.handler('platform.audit.checkpoint')!({ id: 'job-test', org_id: orgId, project_id: null, kind: 'platform.audit.checkpoint', payload: {}, attempts: 1 } as never);
    expect((result as { chainPos: number }).chainPos).toBeGreaterThan(0);
    const after = Number((await owner().query('select count(*)::int n from audit_checkpoint where org_id = $1', [orgId])).rows[0].n);
    expect(after).toBe(before + 1);
    const schedules = await owner().query(`select kind from scheduled_job where org_id = $1 and project_id is null and enabled`, [orgId]);
    expect(schedules.rows.map((r) => r.kind).sort()).toEqual(PLATFORM_SCHEDULES.map((s) => s.kind).sort());
  });
});

describe('ARCH-07 / ARCH-10 / ARCH-14 / ARCH-18 / ARCH-19 — platform patterns', () => {
  it('a transaction handle captured inside run() fails loudly once the transaction has finished', async () => {
    const app = await getApp();
    const db = app.get(DbService);
    const ctx = { correlationId: 'c', sessionId: null, ip: null, authMethod: 'test', locale: 'en' as const, projectIds: [], principal: { kind: 'service' as const, userId: null, orgId, displayName: 's', email: null, clearance: 'internal' as const, isDemo: false, orgRoles: new Set<never>(), projects: new Map(), serviceIdentity: 'svc-test' } };
    const captured = await db.run(ctx, async () => db.tx());
    expect(() => captured.select()).toThrow(/Transaction already finished/);
  });

  it('permission reach: a workstream-only grant reaches only its workstreams (counts use it)', async () => {
    const app = await getApp();
    const policy = app.get(PolicyService);
    const ctx = {
      correlationId: 'c',
      sessionId: null,
      ip: null,
      authMethod: 'test',
      locale: 'en',
      projectIds: [dcId],
      principal: {
        kind: 'user',
        userId: pmId,
        orgId,
        displayName: 'probe',
        email: null,
        clearance: 'confidential',
        isDemo: true,
        orgRoles: new Set(),
        projects: new Map([[dcId, { projectId: dcId, roles: new Set(), workstreamRoles: [{ workstreamId: 'ws-1', role: 'workstream_lead' }], roomIds: new Set(), cleanTeamRoomIds: new Set(), roomRoles: [] }]]),
      },
    } as unknown as RequestContext;
    expect(policy.permissionReach(ctx, 'planning.plan.read', dcId)).toEqual({ all: false, workstreamIds: ['ws-1'] });
    expect(policy.permissionReach(ctx, 'governance.decision.read', dcId).all).toBe(false);
  });

  it('ADR-0010: not_scanned files are usable only when the deployment allows unscanned files (default off in production)', () => {
    expect(scanUsable('not_scanned', false)).toBe(false);
    expect(scanUsable('not_scanned', true)).toBe(true);
    for (const s of ['quarantined', 'rejected', 'pending']) expect(scanUsable(s, true)).toBe(false);
    expect(scanUsable('clean', false)).toBe(true);
  });

  it('response contract: undeclared fields are detected (and stripped)', () => {
    expect(extraKeys({ a: 1, leaked: 'x', nested: [{ ok: 1, secret: 2 }] }, { a: 1, nested: [{ ok: 1 }] })).toEqual(['leaked', 'nested[0].secret']);
    expect(extraKeys({ a: 1, b: undefined }, { a: 1 })).toEqual([]);
  });

  it('a workstream lead must be an active project member', async () => {
    const pm = await loginAs('pm');
    const ws = await pm.get(`/api/v1/projects/${dcId}/workstreams`).expect(200);
    const w = ws.body.items[0];
    const outsider = await demoUserId('pm.b'); // member of the other demo project only
    const r = await pm.post(`/api/v1/projects/${dcId}/workstreams/${w.id}/lead`, { userId: outsider, expectedVersion: w.version });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('workstream.lead_not_member');
  });

  it('deactivating a user revokes sessions and emits permission.changed in the same transaction', async () => {
    const admin = await loginAs('platform.admin');
    const created = await admin.post('/api/v1/admin/users', { email: `deact-${Date.now()}@example.invalid`, displayName: 'Deactivation probe' }).expect(201);
    await admin.post(`/api/v1/admin/users/${created.body.id}/deactivate`, { reason: 'probe' }).expect(201);
    const ev = await owner().query(`select count(*)::int n from outbox_event where type = 'permission.changed' and aggregate_id = $1`, [created.body.id]);
    expect(ev.rows[0].n).toBe(1);
    // idempotent: a second deactivation changes nothing and emits nothing
    await admin.post(`/api/v1/admin/users/${created.body.id}/deactivate`, { reason: 'again' }).expect(201);
    const ev2 = await owner().query(`select count(*)::int n from outbox_event where type = 'permission.changed' and aggregate_id = $1`, [created.body.id]);
    expect(ev2.rows[0].n).toBe(1);
  });
});
