import { Pool, PoolConfig } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export type HubSchema = typeof schema;
export type HubDb = NodePgDatabase<HubSchema>;

export function createPool(url: string, extra: Partial<PoolConfig> = {}): Pool {
  return new Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000, ...extra });
}

export function createDb(pool: Pool): HubDb {
  return drizzle(pool, { schema });
}

export { schema };
