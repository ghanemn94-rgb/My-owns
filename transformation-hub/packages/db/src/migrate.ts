import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

/** Resolve the package root whether running from src (tsx) or dist (node). */
function packageRoot(): string {
  return join(__dirname, '..');
}

/**
 * Applies SQL migrations with the OWNER role, then the idempotent post-migrate SQL (RLS, grants, triggers,
 * audit chain, auth functions). Never run with the runtime role.
 */
export async function runMigrations(ownerUrl: string, log: (m: string) => void = console.log): Promise<void> {
  const pool = new Pool({ connectionString: ownerUrl, max: 1 });
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: join(packageRoot(), 'migrations') });
    log('migrations applied');
    const post = readFileSync(join(packageRoot(), 'sql', 'post-migrate.sql'), 'utf8');
    await pool.query(post);
    log('post-migrate SQL applied (RLS, grants, triggers, audit chain)');
  } finally {
    await pool.end();
  }
}
