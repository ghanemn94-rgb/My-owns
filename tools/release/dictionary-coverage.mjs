#!/usr/bin/env node
// Data-dictionary coverage against a migrated database (ADR-0070 §1, §1.1; REQ-S19-005 "the data dictionary covers
// every table and column in the final schema"; p7-work-split §F.1, T-F1…T-F3, T-F8).
//
//   node tools/release/dictionary-coverage.mjs --database-url <url> [--out <file>]
//        [--dictionary <file> ...] [--erd <file>] [--migrations-dir <dir>]
//   node tools/release/dictionary-coverage.mjs --database-url <url> --write-pgboss <file>
//
// Read-only: every query is a catalogue SELECT inside a READ ONLY transaction. Defaults: the dictionaries
// docs/architecture/data-dictionary.md and docs/handover/data/pgboss.md, the ERD docs/architecture/erd.md and the
// migrations packages/db/migrations/.
//
// Rules (ADR-0070 §1):
//  - schema side: every base table ('r'), partitioned table ('p') and view ('v') of the schemas public and pgboss
//    (partitions of a partitioned table are covered by their parent and are not listed), every column with
//    attnum > 0 and not dropped, its format_type() and its nullability;
//  - dictionary side: a table is documented by a heading line `## <table>` (public) or `## pgboss.<table>`; the first
//    word of the heading is the table name (backticks stripped), and anything after a space is a comment (for
//    example `## delegation (P1 table; logic P2/P4)`). A heading whose first word is not a lower-case identifier
//    (`## Global rules`, `## Views (read models)`) documents no table. Its columns are the rows of the first Markdown
//    table after the heading, before the next `#`/`##` heading, whose header starts `| Column | Type |`; a column is
//    documented when the first cell equals its name and the second its format_type(). Where that table has a `Null`
//    column, its value (`NOT NULL` / `NULL`) must match; otherwise nullability is reported, not failed;
//  - ERD: the physical sections (`## 1…`, before `## 2.`) of erd.md; each entity named in an `erDiagram` block must be
//    a public table or view. Public tables in no ERD section are reported, not failed;
//  - indexes, constraints and triggers that a section does not name are counted and reported, never failed.
//
// Exit codes (p7-work-split §2 rule 4): 0 PASS, 1 FAIL (gaps listed), 2 BLOCKED (cannot connect, not fully migrated,
// usage), 3 BLOCKED (the `pg` client is not installed: no installed workspace). Dependency-free apart from the
// workspace's `pg` 8.16.3, resolved through createRequire (ADR-0070 "Version evidence").
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, "..", "..");
export const SCHEMA_VERSION = "mth-dictionary-coverage/1";
export const DEFAULT_DICTIONARIES = Object.freeze([
  "docs/architecture/data-dictionary.md",
  "docs/handover/data/pgboss.md",
]);
export const DEFAULT_ERD = "docs/architecture/erd.md";
export const DEFAULT_MIGRATIONS = "packages/db/migrations";
const MIGRATION_TABLE = "schema_migration";
const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/;
const IDENT = /^(pgboss\.)?[a-z_][a-z0-9_]*$/;

export class Blocked extends Error {
  constructor(message, code = 2) {
    super(message);
    this.code = code;
  }
}

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const rel = (p) => relative(REPO, resolve(p)).split("\\").join("/");

// ------------------------------------------------------------------------------------------------- markdown parse --

/** Splits a Markdown table row into trimmed cells; `\|` is a literal pipe. */
export function cells(line) {
  const t = line.trim();
  if (!t.startsWith("|")) return null;
  const out = [];
  let cur = "";
  for (let i = 1; i < t.length; i++) {
    const ch = t[i];
    if (ch === "\\" && t[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "|") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim() !== "") out.push(cur.trim());
  return out;
}

const unquote = (s) => s.replace(/^`+|`+$/g, "").trim();
const norm = (s) => unquote(s).replace(/\s+/g, " ").toLowerCase();

/**
 * Parses one dictionary file. Returns { sections: Map<key, {file, line, columns|null, hasNull, text}>, duplicates }.
 * `key` is `<table>` for public and `pgboss.<table>` for the queue schema.
 */
export function parseDictionary(text, file, into = { sections: new Map(), duplicates: [] }) {
  const lines = text.split(/\r?\n/);
  let inFence = false;
  const headings = [];
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) inFence = !inFence;
    if (inFence) return;
    const m = /^(#{1,6})\s+(.*)$/.exec(l);
    if (m) headings.push({ level: m[1].length, text: m[2], line: i });
  });
  headings.forEach((h, idx) => {
    if (h.level !== 2) return;
    const first = unquote(h.text.split(/\s+/)[0] ?? "");
    if (!IDENT.test(first)) return;
    // The section runs to the next heading of level 1 or 2.
    const end = headings.slice(idx + 1).find((n) => n.level <= 2)?.line ?? lines.length;
    // The column table may sit before the next heading of any level (a ### sub-heading ends the search).
    const stop = headings.slice(idx + 1).find(() => true)?.line ?? lines.length;
    const body = lines.slice(h.line + 1, end);
    let columns = null;
    let hasNull = false;
    for (let i = h.line + 1; i < stop; i++) {
      const c = cells(lines[i]);
      if (!c || c.length < 2 || c[0] !== "Column" || c[1] !== "Type") continue;
      hasNull = c.includes("Null");
      const nullIdx = c.indexOf("Null");
      columns = new Map();
      for (let j = i + 2; j < lines.length; j++) {
        const r = cells(lines[j]);
        if (!r) break;
        const name = unquote(r[0] ?? "");
        if (name === "") continue;
        columns.set(name, { type: r[1] ?? "", nullable: hasNull ? (r[nullIdx] ?? "") : null, line: j + 1 });
      }
      break;
    }
    const entry = { file, line: h.line + 1, columns, hasNull, text: body.join("\n") };
    if (into.sections.has(first)) into.duplicates.push({ key: first, file, line: h.line + 1 });
    else into.sections.set(first, entry);
  });
  return into;
}

/** Entity names of the physical ERD sections (`## 1…` up to `## 2.`), with the section heading of each. */
export function parseErd(text) {
  const lines = text.split(/\r?\n/);
  const names = new Map();
  let physical = false;
  let section = "";
  let inDiagram = false;
  let inEntity = false;
  for (const l of lines) {
    const h = /^##\s+(.*)$/.exec(l);
    if (h && !inDiagram) {
      physical = /^1[a-z]*\./.test(h[1]);
      section = h[1].split(/\s+/)[0];
      continue;
    }
    if (/^\s*```mermaid/.test(l)) {
      inDiagram = "pending";
      continue;
    }
    if (inDiagram === "pending") {
      inDiagram = /^\s*erDiagram\b/.test(l) ? "er" : "other";
      continue;
    }
    if (inDiagram && /^\s*```/.test(l)) {
      inDiagram = false;
      inEntity = false;
      continue;
    }
    if (inDiagram !== "er" || !physical) continue;
    if (inEntity) {
      if (/^\s*\}/.test(l)) inEntity = false;
      continue;
    }
    const ent = /^\s*([A-Za-z_][\w]*)\s*(\["[^"]*"\])?\s*\{\s*$/.exec(l);
    if (ent) {
      add(ent[1]);
      inEntity = true;
      continue;
    }
    const relm = /^\s*([A-Za-z_]\w*)\s+[|}{o.\-]{4,}\s+([A-Za-z_]\w*)\s*:/.exec(l);
    if (relm) {
      add(relm[1]);
      add(relm[2]);
    }
  }
  function add(n) {
    if (!names.has(n)) names.set(n, section);
  }
  return names;
}

// ------------------------------------------------------------------------------------------------------- database --

function loadPg() {
  try {
    return createRequire(join(REPO, "packages", "db", "package.json"))("pg");
  } catch {
    throw new Blocked("the pg client is not installed (run pnpm install --offline)", 3);
  }
}

export function migrationFiles(dir) {
  if (!existsSync(dir)) throw new Blocked(`migrations directory ${dir} not found`);
  return readdirSync(dir)
    .filter((n) => n.endsWith(".sql"))
    .sort()
    .map((name) => {
      if (!MIGRATION_FILE.test(name)) throw new Blocked(`migration file name ${name} does not match NNNN_name.sql`);
      return { name, sha256: sha256(readFileSync(join(dir, name), "utf8")) };
    });
}

const CATALOGUE_TABLES = `
  SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind, c.oid::int8 AS oid
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('public', 'pgboss') AND c.relkind IN ('r', 'p', 'v') AND NOT c.relispartition
   ORDER BY 1, 2`;
const CATALOGUE_COLUMNS = `
  SELECT a.attrelid::int8 AS oid, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
         a.attnotnull AS notnull, a.attnum AS num
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('public', 'pgboss') AND c.relkind IN ('r', 'p', 'v') AND NOT c.relispartition
     AND a.attnum > 0 AND NOT a.attisdropped
   ORDER BY 1, a.attnum`;
const CATALOGUE_INDEXES = `
  SELECT i.indrelid::int8 AS oid, ic.relname AS name FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid`;
const CATALOGUE_CONSTRAINTS = `
  SELECT conrelid::int8 AS oid, conname AS name FROM pg_constraint WHERE conrelid <> 0 AND contype <> 'n'`;
const CATALOGUE_TRIGGERS = `SELECT tgrelid::int8 AS oid, tgname AS name FROM pg_trigger WHERE NOT tgisinternal`;

/** Reads the catalogue. Throws Blocked (2) when the database cannot be reached or is not fully migrated. */
export async function readCatalogue(databaseUrl, migrationsDir) {
  const pg = loadPg();
  const files = migrationFiles(migrationsDir);
  const client = new pg.Client({ connectionString: databaseUrl, application_name: "mth dictionary-coverage" });
  client.on("error", () => {});
  try {
    await client.connect();
  } catch {
    throw new Blocked("cannot connect to the database");
  }
  try {
    await client.query("BEGIN READ ONLY");
    const exists = (await client.query(`SELECT to_regclass('public.${MIGRATION_TABLE}') IS NOT NULL AS e`)).rows[0].e;
    const applied = exists
      ? (await client.query(`SELECT id, name, sha256 FROM ${MIGRATION_TABLE} ORDER BY id`)).rows
      : [];
    const byName = new Map(applied.map((a) => [a.name, a]));
    const shipped = new Set(files.map((f) => f.name));
    const pending = files.filter((f) => !byName.has(f.name)).map((f) => f.name);
    const changed = files.filter((f) => byName.has(f.name) && byName.get(f.name).sha256.trim() !== f.sha256);
    const unknown = applied.filter((a) => !shipped.has(a.name));
    if (pending.length > 0 || changed.length > 0 || unknown.length > 0) {
      const detail = [
        ...pending.map((p) => `pending ${p}`),
        ...changed.map((c) => `changed ${c.name}`),
        ...unknown.map((u) => `unknown ${u.name}`),
      ];
      const e = new Blocked(`the database is not fully migrated (${pending.length} pending)`);
      e.detail = detail;
      throw e;
    }
    const q = async (sql) => (await client.query(sql)).rows;
    const [tables, columns, indexes, constraints, triggers] = [
      await q(CATALOGUE_TABLES),
      await q(CATALOGUE_COLUMNS),
      await q(CATALOGUE_INDEXES),
      await q(CATALOGUE_CONSTRAINTS),
      await q(CATALOGUE_TRIGGERS),
    ];
    await client.query("ROLLBACK");
    const last = applied.at(-1);
    return {
      migration: { applied: applied.length, highest: last ? last.name : null },
      tables,
      columns,
      indexes,
      constraints,
      triggers,
    };
  } catch (e) {
    if (e instanceof Blocked) throw e;
    throw new Blocked(`cannot read the catalogue: ${e.message}`);
  } finally {
    await client.end().catch(() => {});
  }
}

// ------------------------------------------------------------------------------------------------------- compare --

const keyOf = (t) => (t.schema === "public" ? t.name : `${t.schema}.${t.name}`);

/** Pure comparison of a catalogue (readCatalogue's shape) with parsed dictionaries and ERD names. */
export function compare(catalogue, dict, erdNames) {
  const gaps = [];
  const byOid = new Map();
  for (const t of catalogue.tables) byOid.set(String(t.oid), { ...t, key: keyOf(t), columns: [] });
  for (const c of catalogue.columns) byOid.get(String(c.oid))?.columns.push(c);
  const tables = [...byOid.values()].sort((a, b) => a.key.localeCompare(b.key));
  const keys = new Set(tables.map((t) => t.key));
  const named = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const k = String(r.oid);
      if (!byOid.has(k)) continue;
      m.set(k, [...(m.get(k) ?? []), r.name]);
    }
    return m;
  };
  const idx = named(catalogue.indexes);
  const con = named(catalogue.constraints);
  const trg = named(catalogue.triggers);
  const reported = { indexes: 0, constraints: 0, triggers: 0, nullabilityNotCompared: 0 };
  const reportedByTable = [];
  let columnCount = 0;

  for (const d of dict.duplicates) gaps.push(`duplicate heading ${d.key}`);
  for (const t of tables) {
    columnCount += t.columns.length;
    const s = dict.sections.get(t.key);
    if (!s) {
      gaps.push(`missing table ${t.schema}.${t.name}`);
      continue;
    }
    const documented = s.columns ?? new Map();
    for (const c of t.columns) {
      const d = documented.get(c.name);
      if (!d) {
        gaps.push(`missing column ${t.key}.${c.name} (${c.type})`);
        continue;
      }
      if (norm(d.type) !== norm(c.type)) {
        gaps.push(`type mismatch ${t.key}.${c.name}: documented ${unquote(d.type)}, database ${c.type}`);
        continue;
      }
      if (s.hasNull) {
        const want = c.notnull ? "not null" : "null";
        const got = norm(d.nullable ?? "");
        if (got !== want)
          gaps.push(
            `type mismatch ${t.key}.${c.name}: documented ${unquote(d.type)} ${d.nullable || "(no Null value)"}, database ${c.type} ${c.notnull ? "NOT NULL" : "NULL"}`,
          );
      } else reported.nullabilityNotCompared++;
    }
    const live = new Set(t.columns.map((c) => c.name));
    for (const name of documented.keys())
      if (!live.has(name)) gaps.push(`stale ${t.key}.${name}: documented but not in the database`);
    const missing = (list) => (list ?? []).filter((n) => !s.text.includes(n));
    const mi = missing(idx.get(String(t.oid)));
    const mc = missing(con.get(String(t.oid)));
    const mt = missing(trg.get(String(t.oid)));
    reported.indexes += mi.length;
    reported.constraints += mc.length;
    reported.triggers += mt.length;
    if (mi.length + mc.length + mt.length > 0)
      reportedByTable.push({ table: t.key, indexes: mi.sort(), constraints: mc.sort(), triggers: mt.sort() });
  }
  for (const k of [...dict.sections.keys()].sort())
    if (!keys.has(k)) gaps.push(`stale ${k}: documented but not in the database`);

  const publicNames = new Set(tables.filter((t) => t.schema === "public").map((t) => t.name));
  for (const [n] of [...erdNames.entries()].sort((a, b) => a[0].localeCompare(b[0])))
    if (!publicNames.has(n)) gaps.push(`ERD names a table that does not exist: ${n}`);
  const erdMissing = tables
    .filter((t) => t.schema === "public" && t.kind !== "v" && !erdNames.has(t.name))
    .map((t) => t.name);

  return {
    tables: tables.length,
    columns: columnCount,
    schemas: [...new Set(tables.map((t) => t.schema))].sort(),
    gaps,
    reported,
    reportedByTable,
    erdTablesInNoSection: erdMissing,
  };
}

// ---------------------------------------------------------------------------------------------------------- pgboss --

/** docs/handover/data/pgboss.md generated from the catalogue (ADR-0070 §1.3). */
export function renderPgboss(catalogue) {
  const byOid = new Map();
  for (const t of catalogue.tables.filter((x) => x.schema === "pgboss")) byOid.set(String(t.oid), { ...t, columns: [] });
  for (const c of catalogue.columns) byOid.get(String(c.oid))?.columns.push(c);
  const out = [
    "# pg-boss queue schema (`pgboss.*`)",
    "",
    "<!-- Generated by `node tools/release/dictionary-coverage.mjs --database-url <url> --write-pgboss docs/handover/data/pgboss.md` from a database migrated with every shipped migration. Do not edit by hand. -->",
    "",
    "The `pgboss` schema is owned by pg-boss 11.0.0. Its tables are created by `packages/db/migrations/0006_pgboss_schema_v25.sql`, which was generated from pg-boss's own schema (version 25), and a pg-boss upgrade that changes them ships as a new hub migration (forward-only, ADR-0003). Jobs are sent and worked through the pg-boss API (ADR-0008); a few worker queries also read or update these tables directly (`apps/worker/src/queues/platform.ts`, `apps/worker/src/automation/starters.ts`).",
    "",
    "Each table below lists its columns as `format_type()` prints them, with their nullability. Indexes, constraints and triggers are pg-boss's and are not repeated here.",
    "",
  ];
  for (const t of [...byOid.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    out.push(`## pgboss.${t.name}`, "", `${t.kind === "v" ? "View" : t.kind === "p" ? "Partitioned table" : "Table"}.`, "");
    out.push("| Column | Type | Null |", "|---|---|---|");
    for (const c of t.columns.sort((a, b) => a.num - b.num))
      out.push(`| ${c.name} | ${c.type.replace(/\|/g, "\\|")} | ${c.notnull ? "NOT NULL" : "NULL"} |`);
    out.push("");
  }
  if (byOid.size === 0) out.push("The database has no table in schema `pgboss`.", "");
  return out.join("\n");
}

// ------------------------------------------------------------------------------------------------------------- run --

export async function run({ databaseUrl, dictionaries, erd, migrationsDir }) {
  const catalogue = await readCatalogue(databaseUrl, migrationsDir);
  const dict = { sections: new Map(), duplicates: [] };
  const read = [];
  for (const f of dictionaries) {
    if (!existsSync(f)) throw new Blocked(`dictionary file ${rel(f)} not found`);
    const text = readFileSync(f, "utf8");
    read.push({ path: rel(f), sha256: sha256(text) });
    parseDictionary(text, rel(f), dict);
  }
  if (!existsSync(erd)) throw new Blocked(`ERD file ${rel(erd)} not found`);
  const erdText = readFileSync(erd, "utf8");
  const result = compare(catalogue, dict, parseErd(erdText));
  return {
    schemaVersion: SCHEMA_VERSION,
    result: result.gaps.length === 0 ? "PASS" : "FAIL",
    migration: catalogue.migration,
    schemas: result.schemas,
    tables: result.tables,
    columns: result.columns,
    gaps: result.gaps,
    reportedOnly: {
      indexesNotNamed: result.reported.indexes,
      constraintsNotNamed: result.reported.constraints,
      triggersNotNamed: result.reported.triggers,
      columnsWithoutNullColumn: result.reported.nullabilityNotCompared,
      erdTablesInNoSection: result.erdTablesInNoSection.length,
      erdTablesInNoSectionList: result.erdTablesInNoSection,
      byTable: result.reportedByTable,
    },
    sources: { dictionaries: read, erd: { path: rel(erd), sha256: sha256(erdText) } },
  };
}

export function summary(r) {
  const ro = r.reportedOnly;
  if (r.result === "PASS")
    return [
      `dictionary-coverage: PASS: ${r.tables} tables and ${r.columns} columns documented (${r.schemas.length} schemas); reported only: ${ro.indexesNotNamed} indexes, ${ro.constraintsNotNamed} constraints, ${ro.triggersNotNamed} triggers not named; ERD: ${ro.erdTablesInNoSection} tables in no section`,
    ];
  return [`dictionary-coverage: FAIL: ${r.gaps.length} gaps`, ...r.gaps];
}

async function main(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        "database-url": { type: "string" },
        out: { type: "string" },
        dictionary: { type: "string", multiple: true },
        erd: { type: "string" },
        "migrations-dir": { type: "string" },
        "write-pgboss": { type: "string" },
      },
    }));
  } catch (e) {
    console.log(`dictionary-coverage: BLOCKED: usage: ${e.message}`);
    return 2;
  }
  const url = values["database-url"] ?? process.env.MTH_COVERAGE_DATABASE_URL;
  if (!url) {
    console.log("dictionary-coverage: BLOCKED: usage: --database-url <url> is required");
    return 2;
  }
  const migrationsDir = resolve(values["migrations-dir"] ?? join(REPO, DEFAULT_MIGRATIONS));
  try {
    if (values["write-pgboss"]) {
      const cat = await readCatalogue(url, migrationsDir);
      const target = resolve(values["write-pgboss"]);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, renderPgboss(cat));
      console.log(`dictionary-coverage: wrote ${rel(target)}`);
      return 0;
    }
    const r = await run({
      databaseUrl: url,
      dictionaries: (values.dictionary ?? DEFAULT_DICTIONARIES.map((d) => join(REPO, d))).map((d) => resolve(d)),
      erd: resolve(values.erd ?? join(REPO, DEFAULT_ERD)),
      migrationsDir,
    });
    if (values.out) {
      mkdirSync(dirname(resolve(values.out)), { recursive: true });
      writeFileSync(resolve(values.out), `${JSON.stringify(r, null, 2)}\n`);
    }
    for (const l of summary(r)) console.log(l);
    return r.result === "PASS" ? 0 : 1;
  } catch (e) {
    if (!(e instanceof Blocked)) throw e;
    console.log(`dictionary-coverage: BLOCKED: ${e.message}`);
    for (const d of e.detail ?? []) console.log(`  ${d}`);
    return e.code;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main(process.argv.slice(2));
