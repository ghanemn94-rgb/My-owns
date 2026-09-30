import type request from 'supertest';
import { Pool } from 'pg';
import { owner } from '../helpers';

/**
 * Shared helpers for the P1 closure specs (docs/phases/P1-must-disposition.md "Work to close before the P1 gate").
 * Every spec creates its own records; nothing here depends on another spec's data or on test order.
 */

/** Raw cookie values held by a supertest agent (e.g. the hub_session token, to replay it after logout/restart). */
export async function cookieValue(agent: request.Agent, name: string): Promise<string> {
  const jar = (agent as unknown as { jar: { getCookies(a: object): { name: string; value: string }[] } }).jar;
  const c = jar.getCookies({ domain: '127.0.0.1', path: '/', secure: false, script: false }).find((x) => x.name === name);
  if (!c) throw new Error(`cookie ${name} not found in the agent jar`);
  return c.value;
}

/** Row counts of every table that carries project_id, restricted to one project (owner role, RLS bypassed). */
export async function projectTableCounts(projectId: string, pool: Pool = owner()): Promise<Record<string, number>> {
  const tables = await pool.query<{ table_name: string }>(
    `select c.table_name from information_schema.columns c
       join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.column_name = 'project_id' order by 1`,
  );
  const out: Record<string, number> = {};
  for (const { table_name } of tables.rows) {
    const r = await pool.query<{ n: number }>(`select count(*)::int n from "${table_name}" where project_id = $1`, [projectId]);
    out[table_name] = r.rows[0]!.n;
  }
  return out;
}

/** Row counts of every base table in the public schema of the database behind `pool`. */
export async function allTableCounts(pool: Pool): Promise<Record<string, number>> {
  const tables = await pool.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`);
  const out: Record<string, number> = {};
  for (const { table_name } of tables.rows) {
    const r = await pool.query<{ n: number }>(`select count(*)::int n from "${table_name}"`);
    out[table_name] = r.rows[0]!.n;
  }
  return out;
}

/** Content fingerprint of every base table (md5 over the ordered row images) — detects in-place updates, not only inserts. */
export async function allTableFingerprints(pool: Pool): Promise<Record<string, string>> {
  const tables = await pool.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`);
  const out: Record<string, string> = {};
  for (const { table_name } of tables.rows) {
    const r = await pool.query<{ h: string | null }>(`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) h from "${table_name}" t`);
    out[table_name] = r.rows[0]!.h ?? '';
  }
  return out;
}

/** Recursively collect every string value of a JSON document (for "no public / presigned link" scans). */
export function jsonStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) jsonStrings(x, out);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
    out.push(k);
    jsonStrings(x, out);
  }
  return out;
}
