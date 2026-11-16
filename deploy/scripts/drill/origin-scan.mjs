#!/usr/bin/env node
// deploy/scripts/drill/origin-scan.mjs: step D10 of the transfer drill (ADR-0069 §1 item 3, §4; p7-work-split §B.2;
// test T-B3; T-DG7-DO-D). REQ-S01-006 "a clean environment with a different base URL starts from the package".
//
//   node deploy/scripts/drill/origin-scan.mjs --database-url <url> --origin <source origin> --out <origin-scan.json>
//
// Scans every `text`, `character varying` and `jsonb` column of every base table of the `public` schema for the
// SOURCE origin string (a plain substring test, `strpos(col::text, origin) > 0`, so `%` and `_` are not wildcards).
// A hit in `audit_event` is listed and accepted: audit rows are imported verbatim, and a row that recorded the old
// origin is history (ADR-0064 §6, ADR-0004). A hit in any other table fails the scan with the B.5 line.
//
// It reads through `psql` (from PGBIN, else PATH) with ON_ERROR_STOP; use a URL that sees every row (the drill passes
// its cluster's superuser URL, so no row-level policy hides a hit). Read only: it writes nothing to the database.
// Exit codes (p7-work-split §2 rule 4): 0 PASS, 1 FAIL (an origin hit outside audit_event), 2 BLOCKED (usage,
// unreadable database), 3 BLOCKED (psql not found).
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const ACCEPTED_TABLE = "audit_event";
export const hitLine = (origin, h) =>
  `transfer-drill: the source origin ${origin} was found in ${h.table}.${h.column} (${h.rows} rows)`;

const psqlBin = () => (process.env.PGBIN ? `${process.env.PGBIN}/psql` : "psql");

function psql(url, sql, vars = {}) {
  const args = ["-X", "-q", "-A", "-t", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-d", url];
  for (const [k, v] of Object.entries(vars)) args.push("-v", `${k}=${v}`);
  args.push("-f", "-");
  return spawnSync(psqlBin(), args, { input: sql, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

const ident = (s) => `"${s.replaceAll('"', '""')}"`;

/** The scan. Returns { columnsScanned, tables, hits, error? }. */
export function scan(url, origin) {
  const cols = psql(
    url,
    `SELECT c.table_name, c.column_name FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND c.data_type IN ('text', 'character varying', 'jsonb')
      ORDER BY 1, 2;`,
  );
  if (cols.error) return { error: `psql: ${cols.error.code ?? cols.error.message}`, blocked: 3 };
  if (cols.status !== 0) return { error: (cols.stderr || "").trim().split("\n")[0] || `psql exit ${cols.status}` };
  const list = cols.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\t"));
  const hits = [];
  // One statement per 200 columns keeps each query small; each part counts the rows that contain the origin.
  for (let i = 0; i < list.length; i += 200) {
    const part = list.slice(i, i + 200);
    const sql =
      part
        .map(
          ([t, c]) =>
            `SELECT ${`'${t.replaceAll("'", "''")}'`}, ${`'${c.replaceAll("'", "''")}'`}, count(*) FROM public.${ident(t)} WHERE strpos(${ident(c)}::text, :'origin') > 0`,
        )
        .join("\nUNION ALL\n") + ";";
    const r = psql(url, sql, { origin });
    if (r.status !== 0) return { error: (r.stderr || "").trim().split("\n")[0] || `psql exit ${r.status}` };
    for (const l of r.stdout.split("\n").filter(Boolean)) {
      const [table, column, n] = l.split("\t");
      if (Number(n) > 0) hits.push({ table, column, rows: Number(n), accepted: table === ACCEPTED_TABLE });
    }
  }
  return { columnsScanned: list.length, tables: new Set(list.map(([t]) => t)).size, hits };
}

function main() {
  let v;
  try {
    ({ values: v } = parseArgs({
      args: process.argv.slice(2),
      options: { "database-url": { type: "string" }, origin: { type: "string" }, out: { type: "string" } },
      strict: true,
    }));
  } catch {
    v = {};
  }
  if (!v["database-url"] || !v.origin || !v.out || !/^https?:\/\/[^/]+$/.test(v.origin)) {
    console.error("BLOCKED: usage: origin-scan.mjs --database-url <url> --origin <scheme://host[:port]> --out <file>");
    process.exit(2);
  }
  const r = scan(v["database-url"], v.origin);
  if (r.error) {
    console.error(`BLOCKED: origin-scan: ${r.error}`);
    process.exit(r.blocked ?? 2);
  }
  const failing = r.hits.filter((h) => !h.accepted);
  const doc = {
    schemaVersion: "mth-origin-scan/1",
    origin: v.origin,
    scope: "every text, varchar and jsonb column of every public base table",
    columnsScanned: r.columnsScanned,
    tablesScanned: r.tables,
    hits: r.hits,
    acceptedTable: ACCEPTED_TABLE,
    result: failing.length === 0 ? "PASS" : "FAIL",
  };
  writeFileSync(v.out, JSON.stringify(doc, null, 2) + "\n");
  for (const h of failing) console.error(hitLine(v.origin, h));
  const listed = r.hits.filter((h) => h.accepted).reduce((n, h) => n + h.rows, 0);
  console.log(
    `origin-scan: ${r.columnsScanned} columns of ${r.tables} tables scanned; ${failing.length} failing hits; ${listed} audit_event rows listed`,
  );
  process.exit(failing.length === 0 ? 0 : 1);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
