// The demo dataset's record counts and checksum (ADR-0050 §4; REQ-S18-001 "running the reset twice yields identical
// record counts and checksums"; T-DG5-BE-S).
//
// Record counts: {<table>: count(*)} for every base table of schema `public` except `demo_dataset_run`, by name.
//
// Checksum: SHA-256 over
//   - one line `<table>\t<record_id>\t<row>` per registered `demo_seed_record` row, sorted by (record_type, record_id);
//   - then one line `demo_seed_record\t<record_type>\t<record_id>\t<fixture_key>` per registry row, in the same order.
// `<row>` is `to_jsonb(row)` minus every column whose default reads the transaction clock (`now()`,
// `CURRENT_TIMESTAMP`, `CURRENT_DATE`, `transaction_timestamp()`; read from information_schema at run time, so the rule
// follows the schema as it grows), in PostgreSQL's jsonb text output (deterministic for equal values). The session's
// TimeZone, IntervalStyle and extra_float_digits are pinned for the statement so the text never depends on the
// connection's settings. Sorting is by code point (JavaScript string order over ASCII names and canonical uuids).
// Lines end with "\n". Everything is read in the caller's transaction (the seed transaction), so it sees the seed.
import { createHash } from "node:crypto";
import { sql } from "kysely";
import type { DbOrTx } from "../pool.ts";

/** The tables whose rows are counted (every public base table but the run table itself), by name. */
async function countedTables(db: DbOrTx): Promise<string[]> {
  const r = await sql<{ table_name: string }>`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'demo_dataset_run'
     ORDER BY table_name COLLATE "C"`.execute(db);
  return r.rows.map((x) => x.table_name);
}

/** {table: count(*)} for every counted table, keys in name order (ADR-0050 §4). */
export async function recordCounts(db: DbOrTx): Promise<Record<string, number>> {
  const tables = await countedTables(db);
  const out: Record<string, number> = {};
  if (tables.length === 0) return out;
  const parts = tables.map((t) => sql`SELECT ${t}::text AS t, count(*)::bigint AS n FROM ${sql.table(t)}`);
  const r = await sql<{ t: string; n: string }>`${sql.join(parts, sql` UNION ALL `)}`.execute(db);
  const byName = new Map(r.rows.map((x) => [x.t, Number(x.n)]));
  for (const t of tables) out[t] = byName.get(t) ?? 0;
  return out;
}

/** The columns of `table` whose default reads the transaction clock (excluded from `<row>`). */
async function clockDefaultedColumns(db: DbOrTx): Promise<Map<string, string[]>> {
  const r = await sql<{ table_name: string; column_name: string }>`
    SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public'
       AND column_default ~* '(now\\(\\)|current_timestamp|current_date|transaction_timestamp\\(\\))'
     ORDER BY table_name, column_name`.execute(db);
  const out = new Map<string, string[]>();
  for (const row of r.rows) {
    const list = out.get(row.table_name) ?? [];
    list.push(row.column_name);
    out.set(row.table_name, list);
  }
  return out;
}

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The checksum lines in order (exported for tests; the checksum is their SHA-256). */
export async function checksumLines(db: DbOrTx): Promise<string[]> {
  // Pinned for the rest of the caller's transaction (SET LOCAL): the jsonb text of timestamptz, interval and float
  // values depends on these session settings.
  await sql`SELECT set_config('TimeZone', 'UTC', true), set_config('IntervalStyle', 'postgres', true),
                   set_config('extra_float_digits', '1', true)`.execute(db);
  const registry = await sql<{ record_type: string; record_id: string; fixture_key: string }>`
    SELECT record_type, record_id::text AS record_id, fixture_key FROM demo_seed_record`.execute(db);
  const rows = [...registry.rows].sort(
    (a, b) => byCodePoint(a.record_type, b.record_type) || byCodePoint(a.record_id, b.record_id),
  );
  const excluded = await clockDefaultedColumns(db);
  const rowText = new Map<string, string>();
  for (const table of [...new Set(rows.map((r) => r.record_type))]) {
    const drop = excluded.get(table) ?? [];
    const r = await sql<{ id: string; row: string }>`
      SELECT t.id::text AS id, (to_jsonb(t) - ${sql.val(drop)}::text[])::text AS row
        FROM ${sql.table(table)} t
        JOIN demo_seed_record d ON d.record_type = ${table} AND d.record_id = t.id`.execute(db);
    for (const x of r.rows) rowText.set(`${table}\t${x.id}`, x.row);
  }
  const lines: string[] = [];
  for (const r of rows)
    lines.push(`${r.record_type}\t${r.record_id}\t${rowText.get(`${r.record_type}\t${r.record_id}`)}`);
  for (const r of rows) lines.push(`demo_seed_record\t${r.record_type}\t${r.record_id}\t${r.fixture_key}`);
  return lines;
}

/** SHA-256 (lower-case hex) over the checksum lines, each ending with "\n" (ADR-0050 §4). */
export async function datasetChecksum(db: DbOrTx): Promise<string> {
  const hash = createHash("sha256");
  for (const line of await checksumLines(db)) hash.update(`${line}\n`, "utf8");
  return hash.digest("hex");
}
