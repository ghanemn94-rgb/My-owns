import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { Pool } from 'pg';
import { runMigrations } from '@hub/db';
import { TEST_ENV } from '../test-env';
import { allTableCounts, allTableFingerprints, jsonStrings } from './closure-kit';

/**
 * P1 closure — production bootstrap and demo seed, each run against an EMPTY throwaway database (never the shared test
 * database), through the real compiled CLIs (dist/cli/bootstrap.js, dist/cli/seed-demo.js).
 *
 * Throwaway database `<test db>_boot` (hub_test_boot in CI, hub_test_<you>_boot locally), guarded to hub_test* on localhost:
 *   - with an admin connection (TEST_DATABASE_ADMIN_URL, else the CI service container's PGADMIN_URL) it is created
 *     fresh and dropped at the end;
 *   - otherwise the owner role creates it if it has CREATEDB (and drops it at the end);
 *   - otherwise it must be pre-provisioned (HUB_DATABASES="hub_test_<you> hub_test_<you>_boot" bash scripts/dev/pg-init-roles.sh);
 *     its schema is reset to empty before each use and left empty afterwards.
 */
const API_ROOT = join(__dirname, '..', '..');
const OWNER_URL = new URL(TEST_ENV.DATABASE_MIGRATION_URL!);
const APP_URL = new URL(TEST_ENV.DATABASE_URL!);
const BOOT_DB = `${OWNER_URL.pathname.slice(1)}_boot`;
if (!/^hub_test\w*_boot$/.test(BOOT_DB) || !['127.0.0.1', 'localhost'].includes(OWNER_URL.hostname)) throw new Error(`Refusing to use ${OWNER_URL.hostname}/${BOOT_DB} as a throwaway database`);
const withDb = (u: URL, db: string) => {
  const x = new URL(u.toString());
  x.pathname = `/${db}`;
  return x.toString();
};
const BOOT_OWNER_URL = withDb(OWNER_URL, BOOT_DB);
const BOOT_APP_URL = withDb(APP_URL, BOOT_DB);

type Mode = 'admin' | 'owner-createdb' | 'preprovisioned';
let mode: Mode;

function adminUrl(): string | null {
  const u = process.env.TEST_DATABASE_ADMIN_URL ?? process.env.PGADMIN_URL;
  if (!u) return null;
  return ['127.0.0.1', 'localhost'].includes(new URL(u).hostname) ? u : null;
}

async function onPool<T>(url: string, fn: (p: Pool) => Promise<T>): Promise<T> {
  const p = new Pool({ connectionString: url, max: 1 });
  try {
    return await fn(p);
  } finally {
    await p.end();
  }
}

/** A brand-new, empty database: dropped/created (admin or CREATEDB owner) or schema-reset (pre-provisioned). */
async function freshBootDb(): Promise<void> {
  const admin = adminUrl();
  if (admin) {
    mode = 'admin';
    await onPool(admin, async (p) => {
      await p.query(`drop database if exists "${BOOT_DB}"`);
      await p.query(`create database "${BOOT_DB}" owner hub_owner`);
      await p.query(`grant connect on database "${BOOT_DB}" to hub_app`);
    });
    await onPool(withDb(new URL(admin), BOOT_DB), (p) => p.query('create extension if not exists pgcrypto'));
    return;
  }
  const maint = withDb(OWNER_URL, 'postgres');
  const created = await onPool(maint, async (p) => {
    const exists = (await p.query('select 1 from pg_database where datname = $1', [BOOT_DB])).rowCount === 1;
    if (exists && mode === 'owner-createdb') await p.query(`drop database "${BOOT_DB}"`);
    else if (exists) return false;
    try {
      await p.query(`create database "${BOOT_DB}"`);
      await p.query(`grant connect on database "${BOOT_DB}" to hub_app`);
      return true;
    } catch (e) {
      if ((e as { code?: string }).code === '42501') {
        throw new Error(
          `Cannot create the throwaway database ${BOOT_DB}: hub_owner lacks CREATEDB and no admin URL is set. ` +
            `Provision it with: HUB_DATABASES="${OWNER_URL.pathname.slice(1)} ${BOOT_DB}" bash scripts/dev/pg-init-roles.sh, or set TEST_DATABASE_ADMIN_URL.`,
        );
      }
      throw e;
    }
  });
  if (created) {
    mode = 'owner-createdb';
    await onPool(BOOT_OWNER_URL, (p) => p.query('create extension if not exists pgcrypto'));
    return;
  }
  mode = 'preprovisioned';
  await onPool(BOOT_OWNER_URL, (p) => p.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public; CREATE EXTENSION IF NOT EXISTS pgcrypto;'));
}

async function removeBootDb(): Promise<void> {
  const admin = adminUrl();
  if (mode === 'admin' && admin) await onPool(admin, (p) => p.query(`drop database if exists "${BOOT_DB}"`));
  else if (mode === 'owner-createdb') await onPool(withDb(OWNER_URL, 'postgres'), (p) => p.query(`drop database if exists "${BOOT_DB}"`));
  else if (mode === 'preprovisioned') await onPool(BOOT_OWNER_URL, (p) => p.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;'));
}

/** Run a compiled CLI with an explicit environment (nothing inherited from the demo-mode test environment). */
function cli(script: string, env: Record<string, string>) {
  const r = spawnSync(process.execPath, [join(API_ROOT, 'dist', 'cli', script)], {
    cwd: API_ROOT,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
    encoding: 'utf8',
    timeout: 240_000,
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const BOOT_ENV = {
  NODE_ENV: 'production',
  HUB_MODE: 'standard',
  DATABASE_MIGRATION_URL: BOOT_OWNER_URL,
  HUB_ORG_NAME: 'Organization — To be confirmed',
  HUB_ORG_SLUG: 'p1c-bootstrap',
  HUB_BOOTSTRAP_ADMIN_EMAIL: 'First.Admin@Example.INVALID',
  HUB_BOOTSTRAP_ADMIN_NAME: 'Role — To be confirmed',
  HUB_BOOTSTRAP_ADMIN_OIDC_ISSUER: 'https://idp.example.invalid/realms/p1c',
  HUB_BOOTSTRAP_ADMIN_OIDC_SUBJECT: 'p1c-first-admin-subject',
};

/** Tables that production bootstrap may populate — everything else must stay empty. */
const BOOTSTRAP_TABLES = ['app_user', 'org_role_assignment', 'organization', 'project_template', 'project_template_version', 'scheduled_job'];

let ownerPool: Pool | null = null;
const bootOwner = () => (ownerPool ??= new Pool({ connectionString: BOOT_OWNER_URL, max: 2 }));
async function closeBootOwner() {
  await ownerPool?.end();
  ownerPool = null;
}

async function tablesWithIsDemo(p: Pool): Promise<string[]> {
  return (await p.query<{ table_name: string }>(`select c.table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name) where c.table_schema = 'public' and c.column_name = 'is_demo' and t.table_type = 'BASE TABLE' order by 1`)).rows.map((r) => r.table_name);
}

beforeAll(async () => {
  await freshBootDb();
});
afterAll(async () => {
  await closeBootOwner();
  await removeBootDb();
});

describe('P1 closure — PLT-004 / SET-006 / SET-008: production bootstrap on an EMPTY database creates only the organization, templates and ONE IdP-bound administrator; it is idempotent [REQ-PLT-004, REQ-SET-006, REQ-SET-008]', () => {
  it('refuses to run in demo mode (nothing is created)', async () => {
    const r = cli('bootstrap.js', { ...BOOT_ENV, HUB_MODE: 'demo' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/must not run with HUB_MODE=demo/);
    const tables = await onPool(BOOT_OWNER_URL, (p) => p.query<{ n: number }>(`select count(*)::int n from information_schema.tables where table_schema = 'public'`));
    expect(tables.rows[0]!.n).toBe(0);
  });

  it('bootstrap on an empty database: one organization, templates, platform schedules and ONE IdP-bound first administrator — no password, no demo or fictional data; a second run changes nothing', { timeout: 240_000 }, async () => {
    const empty = await onPool(BOOT_OWNER_URL, (p) => p.query<{ n: number }>(`select count(*)::int n from information_schema.tables where table_schema = 'public'`));
    expect(empty.rows[0]!.n).toBe(0);

    const first = cli('bootstrap.js', BOOT_ENV);
    expect(first.code, first.out).toBe(0);
    expect(first.out).toMatch(/first administrator provisioned .*no password stored/);
    const p = bootOwner();

    // Only the expected tables hold rows.
    const counts = await allTableCounts(p);
    const populated = Object.entries(counts).filter(([, n]) => n > 0).map(([t]) => t).sort();
    expect(populated).toEqual(BOOTSTRAP_TABLES);
    expect(counts.organization).toBe(1);
    expect(counts.app_user).toBe(1);
    expect(counts.org_role_assignment).toBe(2);
    expect(counts.project).toBe(0);
    expect(counts.session).toBe(0);

    const org = (await p.query('select name, slug from organization')).rows[0];
    expect(org).toEqual({ name: 'Organization — To be confirmed', slug: 'p1c-bootstrap' });
    // ONE administrator, bound to the IdP identity (issuer + subject), not demo, no credential of any kind.
    const users = (await p.query('select * from app_user')).rows;
    expect(users).toHaveLength(1);
    const admin = users[0];
    expect(admin).toMatchObject({
      email: 'first.admin@example.invalid',
      display_name: 'Role — To be confirmed',
      oidc_issuer: 'https://idp.example.invalid/realms/p1c',
      oidc_subject: 'p1c-first-admin-subject',
      is_demo: false,
      is_active: true,
    });
    expect(Object.keys(admin).filter((k) => /pass|pwd|secret|credential|token|hash|otp/i.test(k))).toEqual([]);
    const roles = (await p.query<{ role: string; scope_type: string; user_id: string }>('select role::text, scope_type::text, user_id from org_role_assignment order by role')).rows;
    expect(roles).toEqual([
      { role: 'platform_admin', scope_type: 'organization', user_id: admin.id },
      { role: 'portfolio_admin', scope_type: 'organization', user_id: admin.id },
    ]);
    // No demo rows anywhere.
    for (const t of await tablesWithIsDemo(p)) {
      expect((await p.query<{ n: number }>(`select count(*)::int n from "${t}" where is_demo`)).rows[0]!.n, `${t}.is_demo`).toBe(0);
    }
    // Templates are definitions only: bilingual structure, no dates/years, amounts, percentages, e-mail addresses or names.
    const tpl = (await p.query<{ definition: unknown; status: string }>('select definition, status::text from project_template_version')).rows;
    expect(tpl.map((t) => t.status)).toEqual(['published', 'published']);
    const strings = tpl.flatMap((t) => jsonStrings(t.definition));
    expect(strings.length).toBeGreaterThan(500);
    const offending = strings.filter((s) => /\b(19|20)\d{2}\b|\bSAR\s*\d|\d\s*(SAR|USD|EUR)\b|%|@|\b(Mr|Mrs|Ms|Dr|Eng)\.\s/.test(s));
    expect(offending).toEqual([]);

    // Idempotent: a second run leaves every table byte-for-byte identical.
    const before = await allTableFingerprints(p);
    const second = cli('bootstrap.js', BOOT_ENV);
    expect(second.code, second.out).toBe(0);
    expect(await allTableFingerprints(p)).toEqual(before);
    expect(await allTableCounts(p)).toEqual(counts);

    // The runtime role (what the API uses) is not the owner and cannot write the audit log out of band.
    await onPool(BOOT_APP_URL, async (rt) => {
      const r = (await rt.query<{ rolsuper: boolean; rolbypassrls: boolean }>('select rolsuper, rolbypassrls from pg_roles where rolname = current_user')).rows[0]!;
      expect(r).toEqual({ rolsuper: false, rolbypassrls: false });
    });
  });
});

describe('P1 closure — SET-001: the demo seed is idempotent and every seeded record is flagged is_demo [REQ-SET-001, REQ-SET-005, REQ-UX-028]', () => {
  it('seeding an empty database twice gives identical row counts (no duplicates); every row with an is_demo flag is true and every project-scoped row belongs to a demo project', { timeout: 420_000 }, async () => {
    await closeBootOwner();
    await freshBootDb();
    await runMigrations(BOOT_OWNER_URL, () => undefined);
    const seedEnv = { ...TEST_ENV, DATABASE_URL: BOOT_APP_URL, DATABASE_MIGRATION_URL: BOOT_OWNER_URL };

    const first = cli('seed-demo.js', seedEnv);
    expect(first.code, first.out).toBe(0);
    const p = bootOwner();
    const counts1 = await allTableCounts(p);
    expect(counts1.project).toBe(2);
    expect(counts1.app_user).toBeGreaterThanOrEqual(10);

    const second = cli('seed-demo.js', seedEnv);
    expect(second.code, second.out).toBe(0);
    const counts2 = await allTableCounts(p);
    const changed = Object.keys(counts1).filter((t) => counts1[t] !== counts2[t]).map((t) => `${t}: ${counts1[t]} → ${counts2[t]}`);
    expect(changed).toEqual([]);

    // Every record that carries the flag is demo.
    const notDemo: string[] = [];
    for (const t of await tablesWithIsDemo(p)) {
      const n = (await p.query<{ n: number }>(`select count(*)::int n from "${t}" where not is_demo`)).rows[0]!.n;
      if (n > 0) notDemo.push(`${t}: ${n}`);
    }
    expect(notDemo).toEqual([]);
    // Project-scoped tables without their own flag: every row belongs to a demo project.
    const projectTables = (await p.query<{ table_name: string }>(`select c.table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name) where c.table_schema = 'public' and c.column_name = 'project_id' and t.table_type = 'BASE TABLE' order by 1`)).rows.map((r) => r.table_name);
    const outside: string[] = [];
    for (const t of projectTables) {
      const n = (await p.query<{ n: number }>(`select count(*)::int n from "${t}" x where x.project_id is not null and not exists (select 1 from project pr where pr.id = x.project_id and pr.is_demo)`)).rows[0]!.n;
      if (n > 0) outside.push(`${t}: ${n}`);
    }
    expect(outside).toEqual([]);
    // Personas are synthetic (reserved .invalid domain) and the organization is the labelled demo organization.
    const users = (await p.query<{ email: string; is_demo: boolean }>('select email, is_demo from app_user')).rows;
    expect(users.every((u) => u.is_demo && u.email.endsWith('@demo.invalid'))).toBe(true);
    expect((await p.query('select name from organization')).rows).toEqual([{ name: 'Demo Sandbox Organization (synthetic)' }]);

    // A production bootstrap refuses to run over the demo database — and the refusal changes nothing.
    const beforeBoot = await allTableFingerprints(p);
    const boot = cli('bootstrap.js', { ...BOOT_ENV, HUB_ORG_SLUG: TEST_ENV.HUB_ORG_SLUG! });
    expect(boot.code).toBe(1);
    expect(boot.out).toMatch(/Demo users exist in this organization/);
    const afterBoot = await allTableFingerprints(p);
    expect(Object.keys(afterBoot).filter((t) => afterBoot[t] !== beforeBoot[t])).toEqual([]);
  });
});
