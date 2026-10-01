import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, loginAs, owner, projectIdByCode, runtimePool, type Client } from '../helpers';
import { createProject, grant } from '../planning/fixtures';
import { generate, loginUserId, reportUser, RP } from './report-kit';

/**
 * REQ-RPT-011: read-only BI views (schema `bi`) for a restricted BI database role (`hub_bi`, post-migrate §25,
 * docs/architecture/bi-views.md). The role is created by the DBA scripts (scripts/dev/pg-init-roles.sh locally,
 * scripts/ops/db-init-roles.sh with HUB_BI_DB_PASSWORD elsewhere); the connection tests need it.
 */
const BI_URL = process.env.TEST_BI_DATABASE_URL ?? (process.env.DATABASE_URL ?? '').replace('//hub_app:', '//hub_bi:');
let bi: Pool | null = null;
let biAvailable = false;

let pm: Client;
let sponsor: Client;
let project: string;
let dc: string;

beforeAll(async () => {
  dc = await projectIdByCode(DC);
  pm = await loginAs('pm');
  sponsor = await loginAs('sponsor');
  const admin = await loginAs('portfolio.admin');
  const code = `BI-${Date.now().toString(36).toUpperCase()}`;
  project = await createProject(admin, pm, code); // non-demo, internal classification
  await grant(admin, project, sponsor, 'sponsor');
  biAvailable = (await owner().query(`select 1 from pg_roles where rolname = 'hub_bi'`)).rowCount === 1;
  if (biAvailable) bi = new Pool({ connectionString: BI_URL, max: 1 });
});
afterAll(async () => {
  await bi?.end();
  await closeApp();
  await closePools();
});

const count = async (sql: string, params: unknown[] = []) => Number((await bi!.query<{ n: string }>(sql, params)).rows[0]!.n);

describe('REQ-RPT-011 BI-ready views for a restricted service account', () => {
  it('the views exist as security-invoker views and the application role cannot read them', async () => {
    const views = (await owner().query<{ relname: string; reloptions: string[] | null }>(`select c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'bi' and c.relkind = 'v' order by 1`)).rows;
    expect(views.map((v) => v.relname)).toEqual(['decisions', 'milestones', 'projects', 'report_snapshots', 'risks', 'status_dimensions', 'tasks']);
    for (const v of views) expect(v.reloptions ?? [], v.relname).toContain('security_invoker=true');
    await expect(runtimePool().query('select * from bi.projects')).rejects.toThrow(/permission denied/);
  });

  it('only the project sponsor lists a project for BI, never above their own clearance; the platform never claims a BI connection', async () => {
    const r = (await sponsor.get(RP(project, '/bi-access')).expect(200)).body;
    expect(r).toMatchObject({ projectIsDemo: false, exposed: false, connection: 'not_verified', grants: [] });
    expect((await pm.get(RP(project, '/bi-access'))).status).toBe(403);
    expect((await pm.post(RP(project, '/bi-access'), { maxClassification: 'internal', reason: 'PM is not the sponsor' })).status).toBe(403);
    const lowClient = await loginUserId(await reportUser('bi-sponsor-internal', 'internal', [{ role: 'sponsor' }]));
    const above = await lowClient.post(RP(dc, '/bi-access'), { maxClassification: 'confidential', reason: 'above own clearance' });
    expect([404, 422]).toContain(above.status); // an internal-cleared sponsor cannot even open the confidential demo project
  });

  it('IT: BI service account cannot read restricted or demo rows', async (t) => {
    // Without the hub_bi role (not provisioned in this environment) the connection checks are reported as SKIPPED.
    if (!biAvailable) t.skip();
    // A report snapshot of the non-demo project (internal) and a RESTRICTED one inserted by the owner.
    const s = await generate(pm, project, { kind: 'executive_summary' });
    const restrictedId = (await owner().query<{ id: string }>(
      `insert into report_snapshot (org_id, project_id, kind, title, as_of, as_of_local_date, scope, classification, payload, content_hash, schema_version)
       select org_id, id, 'executive_summary', 'Restricted probe', now(), current_date, '{}'::jsonb, 'restricted', '{}'::jsonb, repeat('a', 64), 'hub.report/1' from project where id = $1 returning id`,
      [project],
    )).rows[0]!.id;

    // No grant yet: nothing at all.
    expect(await count(`select count(*) as n from bi.projects`)).toBe(0);
    expect(await count(`select count(*) as n from bi.milestones`)).toBe(0);

    // The sponsor lists the project (internal) — and also lists the DEMO project, which must stay invisible.
    const g = (await sponsor.post(RP(project, '/bi-access'), { maxClassification: 'internal', reason: 'PMO dashboard pilot' }).expect(201)).body;
    const demoGrant = (await sponsor.post(RP(dc, '/bi-access'), { maxClassification: 'confidential', reason: 'demo project probe' }).expect(201)).body;
    expect((await sponsor.get(RP(dc, '/bi-access')).expect(200)).body).toMatchObject({ projectIsDemo: true, exposed: false });

    expect((await bi!.query(`select project_id from bi.projects`)).rows.map((r) => r.project_id)).toEqual([project]);
    const ms = await count(`select count(*) as n from bi.milestones where project_id = $1`, [project]);
    expect(ms).toBe((await owner().query<{ n: number }>(`select count(*)::int as n from milestone where project_id = $1 and not is_demo`, [project])).rows[0]!.n);
    expect(ms).toBeGreaterThan(0);
    expect(await count(`select count(*) as n from bi.milestones where project_id = $1`, [dc])).toBe(0);
    expect(await count(`select count(*) as n from bi.decisions where project_id = $1`, [dc])).toBe(0);
    const snaps = (await bi!.query(`select snapshot_id from bi.report_snapshots`)).rows.map((r) => r.snapshot_id);
    expect(snaps).toContain(s.id);
    expect(snaps).not.toContain(restrictedId);

    // No table outside the listed columns; a session setting the application's policies trust widens nothing.
    await expect(bi!.query(`select * from decision`)).rejects.toThrow(/permission denied/);
    await expect(bi!.query(`select * from app_user`)).rejects.toThrow(/permission denied/);
    await expect(bi!.query(`select payload from report_snapshot`)).rejects.toThrow(/permission denied/);
    const client = await bi!.connect();
    try {
      const org = (await owner().query<{ org_id: string }>(`select org_id from project where id = $1`, [dc])).rows[0]!.org_id;
      await client.query(`select set_config('app.org_id', $1, false), set_config('app.project_ids', $2, false), set_config('app.full_project_ids', $2, false)`, [org, dc]);
      expect(Number((await client.query(`select count(*) as n from bi.milestones where project_id = $1`, [dc])).rows[0].n)).toBe(0);
      expect(Number((await client.query(`select count(*) as n from milestone where project_id = $1`, [dc])).rows[0].n)).toBe(0);
      expect(Number((await client.query(`select count(*) as n from bi.report_snapshots where snapshot_id = $1`, [restrictedId])).rows[0].n)).toBe(0);
    } finally {
      client.release(true);
    }

    // Revoked: gone from the next query on.
    await sponsor.post(RP(project, `/bi-access/${g.id}/revoke`), { expectedVersion: g.version, reason: 'pilot ended' }).expect(201);
    await sponsor.post(RP(dc, `/bi-access/${demoGrant.id}/revoke`), { expectedVersion: demoGrant.version, reason: 'probe done' }).expect(201);
    expect(await count(`select count(*) as n from bi.projects`)).toBe(0);
    expect(await count(`select count(*) as n from bi.milestones`)).toBe(0);
    const audit = (await owner().query<{ action: string }>(`select action from audit_event where entity_id = any($1::uuid[]) order by seq`, [[g.id, demoGrant.id]])).rows.map((r) => r.action);
    expect(audit).toEqual(expect.arrayContaining(['reports.bi_access.grant', 'reports.bi_access.revoke']));
  });
});
