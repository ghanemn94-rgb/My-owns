import 'reflect-metadata';
import { Pool } from 'pg';
import { loadTemplates, runMigrations } from '@hub/db';
import { ensurePlatformSchedules } from '../platform/jobs/platform.jobs';

/**
 * PRODUCTION BOOTSTRAP (spec §21 "Production bootstrap"): no invented people, partners, values or accomplishments; no
 * default passwords or backdoor accounts.
 *   1. apply migrations + post-migrate SQL (owner role)
 *   2. create the organization (name/slug from env)
 *   3. publish project templates (definitions only)
 *   4. optionally provision the FIRST administrator as a user record bound to an IdP identity (email and/or OIDC
 *      issuer+subject) with the platform_admin and portfolio_admin roles. Authentication happens at the IdP (MFA there);
 *      no password exists. Everything else (users, committees, delegation, perimeter…) is configured through the UI with
 *      audit.
 *
 * Env: DATABASE_MIGRATION_URL (owner), HUB_ORG_NAME, HUB_ORG_SLUG, HUB_BOOTSTRAP_ADMIN_EMAIL, HUB_BOOTSTRAP_ADMIN_NAME,
 *      optional HUB_BOOTSTRAP_ADMIN_OIDC_ISSUER + HUB_BOOTSTRAP_ADMIN_OIDC_SUBJECT.
 */
export async function bootstrap(env = process.env, log: (m: string) => void = console.log) {
  const ownerUrl = env.DATABASE_MIGRATION_URL;
  if (!ownerUrl) throw new Error('DATABASE_MIGRATION_URL (owner role) is required');
  const orgName = env.HUB_ORG_NAME?.trim();
  const slug = env.HUB_ORG_SLUG?.trim();
  if (!orgName || !slug) throw new Error('HUB_ORG_NAME and HUB_ORG_SLUG are required');
  if (env.HUB_MODE === 'demo') throw new Error('Production bootstrap must not run with HUB_MODE=demo');

  await runMigrations(ownerUrl, log);
  const pool = new Pool({ connectionString: ownerUrl, max: 1 });
  try {
    // Refuse BEFORE writing anything: a refused bootstrap must not rename or otherwise touch a demo organization.
    const demoUsers = await pool.query<{ n: number }>(
      `select count(*)::int n from app_user u join organization o on o.id = u.org_id where o.slug = $1 and u.is_demo`,
      [slug],
    );
    if (demoUsers.rows[0]!.n > 0) throw new Error('Demo users exist in this organization — refusing to bootstrap production over a demo database');
    const org = await pool.query<{ id: string }>(
      `insert into organization (id, name, slug) values (gen_random_uuid(), $1, $2)
       on conflict (slug) do update set name = excluded.name returning id`,
      [orgName, slug],
    );
    const orgId = org.rows[0]!.id;
    log(`organization ${slug} ready`);
    const demo = await pool.query(`select count(*)::int n from app_user where org_id = $1 and is_demo`, [orgId]);
    if (demo.rows[0].n > 0) throw new Error('Demo users exist in this organization — refusing to bootstrap production over a demo database');

    const t = await loadTemplates(pool, orgId, undefined, log);
    log(`templates: ${t.map((x) => `${x.key}@v${x.version}:${x.action}`).join(', ')}`);
    log(`platform maintenance schedules created: ${await ensurePlatformSchedules(pool, orgId)}`);

    const email = env.HUB_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
    if (email) {
      const name = env.HUB_BOOTSTRAP_ADMIN_NAME?.trim() || email;
      const u = await pool.query<{ id: string }>(
        `insert into app_user (id, org_id, email, display_name, clearance, oidc_issuer, oidc_subject, is_demo)
         values (gen_random_uuid(), $1, $2, $3, 'internal', $4, $5, false)
         on conflict (org_id, email) do update set display_name = excluded.display_name returning id`,
        [orgId, email, name, env.HUB_BOOTSTRAP_ADMIN_OIDC_ISSUER ?? null, env.HUB_BOOTSTRAP_ADMIN_OIDC_SUBJECT ?? null],
      );
      for (const role of ['platform_admin', 'portfolio_admin']) {
        await pool.query(
          `insert into org_role_assignment (id, org_id, user_id, role, scope_type, reason)
           select gen_random_uuid(), $1, $2, $3, 'organization', 'Initial administrator (bootstrap)'
           where not exists (select 1 from org_role_assignment where user_id = $2 and role = $3 and scope_type = 'organization' and revoked_at is null)`,
          [orgId, u.rows[0]!.id, role],
        );
      }
      log(`first administrator provisioned for ${email} (authenticates at the IdP; no password stored)`);
    } else {
      log('no HUB_BOOTSTRAP_ADMIN_EMAIL given — provision the first administrator later');
    }
    return { orgId };
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  bootstrap().catch((e) => {
    console.error('bootstrap failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
