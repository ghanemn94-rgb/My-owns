import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { POLICY_MATRIX, clearanceAllows, RoleKey, Classification } from '@hub/domain';
import { loadTemplates } from '@hub/db';
import { AppModule } from '../app.module';
import { loadConfig } from '../platform/config';
import { PortfolioService } from '../modules/portfolio/portfolio.service';
import { asUser } from './seed-context';
import { DEMO_MODULE_SEEDS } from './seed-modules';

/**
 * DEMO SANDBOX SEED (spec §21). Synthetic, clearly labelled data only:
 *  - users are role personas with `@demo.invalid` addresses (reserved TLD — cannot be real mailboxes)
 *  - every record is flagged is_demo = true and shown with a "Demo" badge; excluded from actual reporting
 *  - no real people, partners, figures, dates or statuses are used
 * Refuses to run in production or outside HUB_MODE=demo.
 */

interface DemoUser {
  key: string;
  displayName: string;
  title: string;
  orgRoles?: RoleKey[];
  dc?: RoleKey[];
  dcWorkstream?: { code: string; role: RoleKey }[];
  gen?: RoleKey[];
}

export const DEMO_USERS: DemoUser[] = [
  { key: 'portfolio.admin', displayName: 'Demo Portfolio Admin', title: 'Portfolio administration (synthetic persona)', orgRoles: ['portfolio_admin'] },
  { key: 'platform.admin', displayName: 'Demo Platform Admin', title: 'Platform / account administration (synthetic persona)', orgRoles: ['platform_admin'] },
  { key: 'auditor', displayName: 'Demo Auditor', title: 'Internal audit, read-only (synthetic persona)', orgRoles: ['auditor'] },
  { key: 'sponsor', displayName: 'Demo Sponsor', title: 'Programme sponsor (synthetic persona)', dc: ['sponsor'] },
  { key: 'chair', displayName: 'Demo Committee Chair', title: 'Committee chair — role to be confirmed (synthetic persona)', dc: ['committee_chair'] },
  { key: 'secretary', displayName: 'Demo Secretary / CPMO', title: 'Committee secretary / CPMO (synthetic persona)', dc: ['secretary_cpmo'] },
  { key: 'pm', displayName: 'Demo Project Manager', title: 'DC carve-out project manager (synthetic persona)', dc: ['project_manager'] },
  { key: 'finance', displayName: 'Demo Finance Member', title: 'Finance representative (synthetic persona)', dc: ['finance_restricted', 'functional_approver'] },
  { key: 'legal', displayName: 'Demo Legal Member', title: 'Legal representative (synthetic persona)', dc: ['legal_restricted', 'functional_approver'] },
  { key: 'tech.lead', displayName: 'Demo Technology Lead', title: 'Workstream lead — Technology, Data & Cybersecurity (synthetic persona)', dcWorkstream: [{ code: 'WS06', role: 'workstream_lead' }], dc: ['contributor'] },
  { key: 'ops.lead', displayName: 'Demo Operations Lead', title: 'Workstream lead — Operations, Continuity & TSA (synthetic persona)', dcWorkstream: [{ code: 'WS07', role: 'workstream_lead' }], dc: ['contributor'] },
  { key: 'contributor', displayName: 'Demo Contributor', title: 'Workstream contributor (synthetic persona)', dc: ['contributor'] },
  { key: 'approver', displayName: 'Demo Functional Approver', title: 'Functional approver — Operations (synthetic persona)', dc: ['functional_approver'] },
  { key: 'cleanteam', displayName: 'Demo Clean Team Member', title: 'Clean team (synthetic persona) — room access granted by the JV seed', dc: [] },
  { key: 'partner.alpha', displayName: 'Demo Partner Alpha User', title: 'External partner — fictional "Partner Alpha" (synthetic persona) — room access granted by the JV seed', dc: [] },
  { key: 'pm.b', displayName: 'Demo PM — Project B', title: 'Project manager of the second (transformation) project only (synthetic persona)', gen: ['project_manager'] },
  { key: 'contributor.b', displayName: 'Demo Contributor — Project B', title: 'Contributor on Project B only (synthetic persona)', gen: ['contributor'] },
];

export const demoEmail = (key: string) => `demo.${key}@demo.invalid`;
export const DEMO_DC_CODE = 'DEMO-DC';
export const DEMO_GEN_CODE = 'DEMO-TRANSFORM';

function clearanceFor(u: DemoUser): Classification {
  const roles = [...(u.orgRoles ?? []), ...(u.dc ?? []), ...(u.gen ?? []), ...(u.dcWorkstream ?? []).map((w) => w.role)];
  // Demo project members are cleared to the demo projects' classification (confidential); higher clearances come
  // from role defaults. In production, clearance is granted explicitly (admin.clearance.grant).
  const isProjectMember = (u.dc?.length ?? 0) + (u.gen?.length ?? 0) + (u.dcWorkstream?.length ?? 0) > 0;
  let best: Classification = isProjectMember ? 'confidential' : 'internal';
  for (const r of roles) {
    const c = POLICY_MATRIX.roles[r].defaultClearance;
    if (clearanceAllows(c, best)) best = c;
  }
  return best;
}

export async function seedDemo(opts: { ownerUrl: string; log?: (m: string) => void }) {
  const log = opts.log ?? ((m: string) => console.log(m));
  const config = loadConfig();
  if (config.nodeEnv === 'production') throw new Error('Refusing to seed demo data in production');
  if (!config.demoMode && config.nodeEnv !== 'test') throw new Error('Demo seed requires HUB_MODE=demo');

  // 1. Organization, templates, users, org roles (owner connection — org-level setup)
  const owner = new Pool({ connectionString: opts.ownerUrl, max: 2 });
  let orgId: string;
  try {
    const org = await owner.query<{ id: string }>(
      `insert into organization (id, name, slug) values (gen_random_uuid(), $1, $2)
       on conflict (slug) do update set name = organization.name returning id`,
      ['Demo Sandbox Organization (synthetic)', config.orgSlug],
    );
    orgId = org.rows[0]!.id;
    await loadTemplates(owner, orgId, undefined, log);
    for (const u of DEMO_USERS) {
      const r = await owner.query<{ id: string }>(
        `insert into app_user (id, org_id, email, display_name, title, clearance, is_demo, locale)
         values (gen_random_uuid(), $1, $2, $3, $4, $5, true, 'en')
         on conflict (org_id, email) do update set display_name = excluded.display_name, title = excluded.title, clearance = excluded.clearance
         returning id`,
        [orgId, demoEmail(u.key), u.displayName, u.title, clearanceFor(u)],
      );
      const userId = r.rows[0]!.id;
      for (const role of u.orgRoles ?? []) {
        await owner.query(
          `insert into org_role_assignment (id, org_id, user_id, role, scope_type, reason)
           select gen_random_uuid(), $1, $2, $3, 'organization', 'Demo sandbox persona'
           where not exists (select 1 from org_role_assignment where user_id = $2 and role = $3 and scope_type = 'organization' and revoked_at is null)`,
          [orgId, userId, role],
        );
      }
    }
    const pf = await owner.query<{ id: string }>(
      `insert into portfolio (id, org_id, name, description, is_demo)
       select gen_random_uuid(), $1, 'Demo Transformation Portfolio', 'Synthetic portfolio for the demo sandbox', true
       where not exists (select 1 from portfolio where org_id = $1 and name = 'Demo Transformation Portfolio') returning id`,
      [orgId],
    );
    const portfolioId = pf.rows[0]?.id ?? (await owner.query<{ id: string }>(`select id from portfolio where org_id = $1 and name = 'Demo Transformation Portfolio'`, [orgId])).rows[0]!.id;
    await owner.query(
      `insert into program (id, org_id, portfolio_id, code, name, objective, is_demo)
       select gen_random_uuid(), $1, $2, 'DEMO-N4', 'Demo programme: DC Carve-out → Standalone NewCo → JV', 'Synthetic programme mirroring the first template (no real data)', true
       where not exists (select 1 from program where org_id = $1 and code = 'DEMO-N4')`,
      [orgId, portfolioId],
    );
  } finally {
    await owner.end();
  }

  // 2. Projects and memberships through the real services
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const portfolio = app.get(PortfolioService);
    const admin = demoEmail('portfolio.admin');
    // Existence check with the owner role: the portfolio admin may lack clearance to *see* confidential projects.
    const ownerPool = new Pool({ connectionString: opts.ownerUrl, max: 1 });
    const existing = await ownerPool.query<{ id: string; code: string }>(`select id, code from project where org_id = $1`, [orgId]);
    await ownerPool.end();
    const byCode = new Map(existing.rows.map((p) => [p.code, p.id]));
    const templates = await asUser(app, admin, async (ctx) => portfolio.listTemplates(ctx));
    const dcTpl = templates.items.find((t) => t.templateKey === 'dc-carveout');
    const genTpl = templates.items.find((t) => t.templateKey === 'general-transformation');
    if (!dcTpl || !genTpl) throw new Error('templates not loaded');
    const programs = await asUser(app, admin, async (ctx) => portfolio.listPrograms(ctx));
    const programId = programs.items.find((p) => p.code === 'DEMO-N4')?.id;
    const userId = async (key: string) => (await asUser(app, admin, async (ctx) => portfolio.directory(ctx, demoEmail(key)))).items[0]!.id;

    const pmId = await userId('pm');
    const pmBId = await userId('pm.b');
    if (!byCode.has(DEMO_DC_CODE)) {
      const r = await asUser(app, admin, (ctx) =>
        portfolio.createProject(
          ctx,
          {
            templateVersionId: dcTpl.id,
            programId,
            code: DEMO_DC_CODE,
            name: 'Demo DC Carve-out → NewCo → JV',
            description: 'SYNTHETIC DEMO PROJECT. Mirrors the structure of the first template; contains no real Mobily data, people, partners, figures or dates.',
            objective: 'Demonstrate carve-out, committee, readiness, TSA and JV management with fictional data.',
            classification: 'confidential',
            plannedStart: '2026-10-04',
            projectManagerUserId: pmId,
            newco: { mode: 'new', name: 'Demo NewCo (fictional entity)', incorporationStatus: 'incorporation_in_progress' },
          },
          { isDemo: true },
        ),
      );
      byCode.set(DEMO_DC_CODE, r.id);
      log(`created ${DEMO_DC_CODE}: ${JSON.stringify(r.created)}`);
    }
    if (!byCode.has(DEMO_GEN_CODE)) {
      const r = await asUser(app, admin, (ctx) =>
        portfolio.createProject(
          ctx,
          {
            templateVersionId: genTpl.id,
            code: DEMO_GEN_CODE,
            name: 'Demo General Transformation (Project B)',
            description: 'SYNTHETIC DEMO PROJECT used to demonstrate multi-project extensibility and isolation.',
            classification: 'confidential',
            plannedStart: '2026-10-04',
            projectManagerUserId: pmBId,
            newco: { mode: 'none', incorporationStatus: 'not_applicable' },
          },
          { isDemo: true },
        ),
      );
      byCode.set(DEMO_GEN_CODE, r.id);
      log(`created ${DEMO_GEN_CODE}: ${JSON.stringify(r.created)}`);
    }

    // Memberships (granted by the portfolio admin through the audited service)
    const dcId = byCode.get(DEMO_DC_CODE)!;
    const genId = byCode.get(DEMO_GEN_CODE)!;
    const members = await asUser(app, admin, (ctx) => portfolio.listMembers(ctx, dcId));
    const membersB = await asUser(app, admin, (ctx) => portfolio.listMembers(ctx, genId));
    const has = (list: typeof members, uid: string, role: string, ws: string | null) => list.items.some((m) => m.userId === uid && m.role === role && (m.workstreamId ?? null) === ws);
    const workstreams = await asUser(app, admin, (ctx) => portfolio.listWorkstreams(ctx, dcId));
    const wsId = (code: string) => workstreams.items.find((w) => w.code === code)!.id;
    for (const u of DEMO_USERS) {
      const uid = await userId(u.key);
      for (const role of u.dc ?? []) {
        if (role === 'project_manager' || has(members, uid, role, null)) continue;
        await asUser(app, admin, (ctx) => portfolio.grantMembership(ctx, dcId, { userId: uid, role, reason: 'Demo sandbox persona' }));
      }
      for (const w of u.dcWorkstream ?? []) {
        if (has(members, uid, w.role, wsId(w.code))) continue;
        await asUser(app, admin, (ctx) => portfolio.grantMembership(ctx, dcId, { userId: uid, role: w.role, workstreamId: wsId(w.code), reason: 'Demo sandbox persona' }));
      }
      for (const role of u.gen ?? []) {
        if (role === 'project_manager' || has(membersB, uid, role, null)) continue;
        await asUser(app, admin, (ctx) => portfolio.grantMembership(ctx, genId, { userId: uid, role, reason: 'Demo sandbox persona' }));
      }
    }

    // 3. Module scenario seeds (committee, perimeter, TSA, CPs, …) registered by each module
    for (const s of DEMO_MODULE_SEEDS) {
      log(`seeding module scenario: ${s.name}`);
      await s.run({ app, dcProjectId: dcId, genProjectId: genId, asUser: (key, fn) => asUser(app, demoEmail(key), fn), userId, log });
    }
    log('demo seed complete');
    return { orgId, dcProjectId: dcId, genProjectId: genId };
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  seedDemo({ ownerUrl: process.env.DATABASE_MIGRATION_URL ?? 'postgres://hub_owner:hub_dev_only@127.0.0.1:5432/hub_dev' }).catch((e) => {
    const c = (e as { cause?: { message?: string; code?: string; detail?: string; constraint?: string } }).cause;
    console.error('demo seed failed:', c ? `${c.code} ${c.message} ${c.detail ?? ''} ${c.constraint ?? ''}` : e instanceof Error ? e.message.slice(0, 500) : e);
    process.exit(1);
  });
}
