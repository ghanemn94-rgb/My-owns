import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { Pool } from 'pg';
import { runMigrations } from '@hub/db';
import { TEST_ENV } from './test-env';

/**
 * Resets the TEST database (never dev/prod), applies migrations + post-migrate SQL, then seeds the demo sandbox
 * through the real services (compiled CLI, run as a child process with the test environment).
 * Guarded: only databases named hub_test* on localhost are touched.
 */
export default async function setup() {
  const owner = TEST_ENV.DATABASE_MIGRATION_URL!;
  const u = new URL(owner);
  if (!/^hub_test/.test(u.pathname.slice(1)) || !['127.0.0.1', 'localhost'].includes(u.hostname)) {
    throw new Error(`Refusing to reset non-test database ${u.hostname}${u.pathname}`);
  }
  const pool = new Pool({ connectionString: owner, max: 1 });
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await pool.end();
  await runMigrations(owner, () => undefined);
  execFileSync('node', [join(__dirname, '..', 'dist', 'cli', 'seed-demo.js')], { env: { ...process.env, ...TEST_ENV }, stdio: 'pipe' });
}
