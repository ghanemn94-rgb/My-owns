// T-DG7-ARCH-03: generates the "P7 tables, slice E" section of docs/architecture/data-dictionary.md from the catalogue
// of a freshly migrated DISPOSABLE database, so the dictionary matches the migrations exactly (the T-DG7-ARCH-02
// generator with the slice E table list).
//   QA_PG_PORT=<port> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG7/T-DG7-ARCH-03-evidence/gen-dictionary.ts > <out.md>
import { createRequire } from "node:module";
import { migrate } from "../../../../../packages/db/src/migrate.ts";

const pg = createRequire(new URL("../../../../../packages/db/package.json", import.meta.url))("pg");
const admin = process.env.TEST_DATABASE_ADMIN_URL!;
const migrationsDir = new URL("../../../../../packages/db/migrations", import.meta.url).pathname;

interface Meta {
  migration: string;
  purpose: string;
  module: string;
  writers: string;
  lifecycle: string;
}
const R = "0143_p7_retention_classes.sql";
const RR = "0144_p7_retention_runs.sql";
const B = "0145_p7_backup_sets.sql";
const T: Record<string, Meta> = {
  retention_class: { migration: R, module: "retention (classes)", purpose: "One record class with its category, action (retain, archive, archive_then_purge), period (NULL: not set, IT to agree) and the IT approval reference text, which records an approval given outside the platform and approves nothing (REQ-S16-024; ADR-0067 §1-§2; D-243 Q3). 12 classes are seeded, all 'retain'.", writers: "migrations (the classes); `retention.configure` (ADM_TECH) through updateRetentionClass (lock 730410). Column-level UPDATE of action, period_days, it_approval_reference and the version columns only", lifecycle: "never deleted; only operational classes not managed by an existing job may leave 'retain' (CHECK); 'archive' needs an age column on every table, 'archive_then_purge' every table purge-eligible (trigger); versioned and audited" },
  retention_table_class: { migration: R, module: "retention (classes)", purpose: "One row per public base table: its retention class, its primary key columns (the archived record's key), its age column (NULL: never selected) and whether a purge is allowed (ADR-0067 §1, §3). Generated from the catalogue by 0143; explicit rows for audit, snapshot, system, derived and operational tables.", writers: "migrations only (`mth_app` reads); every migration that creates a table adds its row", lifecycle: "append-only; the catalogue test fails when a public base table has no row" },
  retention_run: { migration: RR, module: "retention (runs)", purpose: "One retention run or dry run of the retention.archive job: as-of time, counts and the archive set's key and SHA-256 (REQ-S16-024; ADR-0067 §4).", writers: "`retention.run` (ADM_TECH) through createRetentionRun / createRetentionDryRun (lock 730410); the worker job `retention.archive`; the disabled schedule (requested_via schedule). Column-level UPDATE of the status, results and version columns only", lifecycle: "queued -> running | failed; running -> succeeded | failed; terminal states immutable; at most one queued or running; a dry run never has an archive set; versioned and audited" },
  retention_archived_record: { migration: RR, module: "retention (runs)", purpose: "One archived live row: table, primary key as a text-valued object, the run and archive set holding its copy, its age, and when it was purged (NULL: kept, read-only) (ADR-0067 §5).", writers: "the job `retention.archive` (INSERT; the trigger re-checks the class, the key and that the row is past retention); `retention_purge_record()` sets the purge marker", lifecycle: "one row per record, ever; only purged_at and purge_run_id are set, once; never deleted" },
  retention_run_action: { migration: RR, module: "retention (runs)", purpose: "The per-record action log of a run: would_archive, would_purge (dry run), archived, purged, skipped_referenced, with the class, period applied and the record's age (REQ-S16-024 'logs each action'; ADR-0067 §6).", writers: "the job `retention.archive`", lifecycle: "append-only; unique per (run, table, key, action); every archived, purged and skipped_referenced row needs its audit event in the same transaction" },
  backup_set: { migration: B, module: "retention (backups)", purpose: "One backup set the backup job produced or failed to produce: timings, migration level, PostgreSQL major, dump, evidence, configuration-bundle and manifest checksums and counts (REQ-S19-012; ADR-0066 §6). No content, no credential.", writers: "`backup_set_record(jsonb)` only, called by `deploy/scripts/backup.sh` as mth_owner (`mth_app` reads)", lifecycle: "append-only; audited (backup.recorded, written by the function)" },
};
const ORDER = Object.keys(T);
async function main(): Promise<void> {
  const c0 = new pg.Client({ connectionString: admin });
  await c0.connect();
  await c0.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
  await c0.query(`CREATE DATABASE dict_p7e OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  await c0.end();
  const u = new URL(admin);
  u.pathname = "/dict_p7e";
  u.searchParams.set("options", "-c role=mth_owner");
  await migrate(u.toString(), { dir: migrationsDir });
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  const out: string[] = [];
  for (const t of ORDER) {
    const m = T[t]!;
    const priv = await c.query(
      `SELECT string_agg(privilege_type, ', ' ORDER BY privilege_type) AS p FROM information_schema.role_table_grants
       WHERE grantee = 'mth_app' AND table_schema = 'public' AND table_name = $1`, [t]);
    out.push(`## ${t}`, "");
    out.push(`- **Purpose:** ${m.purpose}`);
    out.push(`- **Migration:** \`${m.migration}\`. **API module:** \`${m.module}\`. **Who writes:** ${m.writers}. **Lifecycle:** ${m.lifecycle}.`);
    out.push(`- **\`mth_app\` privileges:** ${priv.rows[0].p ?? "none"}.`, "");
    const cols = await c.query(
      `SELECT a.attnum, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS nn, pg_get_expr(d.adbin, d.adrelid) AS def
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [t]);
    const cons = await c.query(
      `SELECT conname, contype, conkey, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY conname`, [t]);
    const colCons = new Map<number, string[]>();
    const tableCons: string[] = [];
    const kind: Record<string, string> = { c: "CHECK", u: "UNIQUE", f: "FK", p: "PK", x: "EXCLUDE" };
    for (const k of cons.rows) {
      if (k.contype === "t") continue; // constraint triggers are listed under Triggers
      k.def = k.def.replaceAll("::text", "");
      const single = k.conkey && k.conkey.length === 1;
      let text: string | null = null;
      if (single && k.contype === "p") text = "PK";
      else if (single && k.contype === "f") {
        const m2 = /REFERENCES (\w+)\((\w+)\)/.exec(k.def);
        text = m2 ? `FK → ${m2[1]}(${m2[2]})` : null;
      } else if (single && k.contype === "c" && k.conname.endsWith("_check")) text = `\`${k.def}\``;
      if (text) {
        const arr = colCons.get(k.conkey[0]) ?? [];
        arr.push(text);
        colCons.set(k.conkey[0], arr);
      } else tableCons.push(`- \`${k.conname}\` (${kind[k.contype] ?? k.contype}): \`${k.def}\``);
    }
    out.push("| Column | Type | Null | Default | Column constraints |", "|---|---|---|---|---|");
    for (const col of cols.rows)
      out.push(`| ${col.name} | ${col.type} | ${col.nn ? "NOT NULL" : "NULL"} | ${col.def ? `\`${String(col.def).replaceAll("::text", "")}\`` : ""} | ${(colCons.get(col.attnum) ?? []).join("; ")} |`);
    out.push("");
    if (tableCons.length) out.push("**Table constraints:**", "", ...tableCons, "");
    const idx = await c.query(
      `SELECT i.relname AS name, pg_get_indexdef(x.indexrelid) AS def FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
       WHERE x.indrelid = $1::regclass AND NOT x.indisprimary
         AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = x.indexrelid) ORDER BY 1`, [t]);
    if (idx.rowCount) {
      out.push("**Indexes:**", "");
      for (const r of idx.rows) {
        const uniq = /CREATE UNIQUE INDEX/.test(r.def) ? "UNIQUE " : "";
        out.push(`- \`${r.name}\`: \`${uniq}${r.def.replace(/^CREATE (UNIQUE )?INDEX \S+ ON \S+ USING btree /, "").replaceAll("::text", "")}\``);
      }
      out.push("");
    }
    const trg = await c.query(
      `SELECT tgname, pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgrelid = $1::regclass AND NOT tgisinternal ORDER BY tgname`, [t]);
    if (trg.rowCount) {
      out.push("**Triggers:**", "");
      for (const r of trg.rows) {
        const d = r.def
          .replace(/^CREATE (CONSTRAINT )?TRIGGER \S+ /, (_m: string, ct: string | undefined) => (ct ? "CONSTRAINT " : ""))
          .replace(/ ON public\.\S+/, "")
          .replace(/ EXECUTE FUNCTION (\S+)$/, " → `$1`");
        out.push(`- \`${r.tgname}\`: ${d}`);
      }
      out.push("");
    }
  }
  console.log(out.join("\n"));
  await c.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
