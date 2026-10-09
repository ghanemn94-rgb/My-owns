// T-DG4-ARCH-08: generates the "P4 tables, slices J and K" section of docs/architecture/data-dictionary.md from the
// catalogue of a freshly migrated DISPOSABLE database, so the dictionary matches the migrations exactly (the
// T-DG4-ARCH-07 generator with the slices J and K table list).
//   QA_PG_PORT=<23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG4/T-DG4-ARCH-08-evidence/gen-dictionary.ts > <out.md>
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
const M1 = "0055_p4_traceability_modular_structure.sql";
const M2 = "0056_p4_dashboards_t10.sql";
const T: Record<string, Meta> = {
  portfolio: { migration: M1, module: "portfolio", purpose: "An organization-level grouping of transformations (REQ-S03-001; ADR-0038 §9). Code unique per organization.", writers: "`portfolio.manage` (TO)", lifecycle: "active → archived (final); versioned" },
  portfolio_transformation: { migration: M1, module: "portfolio", purpose: "A transformation's place in a portfolio; at most one active portfolio per transformation; the portfolio is of the transformation's organization (REQ-S03-001; ADR-0038 §9).", writers: "`portfolio.manage` (TO)", lifecycle: "active → removed (final, with reason); never deleted" },
  workstream: { migration: M1, module: "portfolio", purpose: "A workstream grouping initiatives of one transformation, code WS-nn; the scope of the workstream dashboard (REQ-S03-001, REQ-S13-001; ADR-0038 §9).", writers: "`workstream.manage` (TL, TO)", lifecycle: "active → archived (final); versioned" },
  workstream_initiative: { migration: M1, module: "portfolio", purpose: "An initiative's membership of a workstream; at most one active workstream per initiative, same transformation (REQ-S03-001; ADR-0038 §9).", writers: "`workstream.manage` (TL, TO)", lifecycle: "active → removed (final, with reason); never deleted" },
  trace_link: { migration: M1, module: "reporting", purpose: "A chain link that no typed table records (issue → gap, deliverable → capability change, capability change → KPI movement, KPI movement → benefit) with its contribution statement and, into a KPI or benefit, an optional share; the shares into one target total at most 1 (REQ-S03-006, REQ-PB-044; ADR-0038 §2, §3).", writers: "`traceability.link` (TL, BO, WL, TO)", lifecycle: "active → removed (final, with reason); never deleted" },
  inherited_record: { migration: M1, module: "reporting", purpose: "Inherited evidence or an inherited baseline of a Modular entry, labelled inherited with its provenance; references the canonical row, never copies it; prior approvals stay gate_dispensation rows (REQ-S03-005, REQ-PB-005; ADR-0038 §7).", writers: "`inherited_record.record` (TL, TO); Modular transformations only", lifecycle: "active → withdrawn (final, with reason); provenance immutable" },
  t10_area_definition: { migration: M2, module: "reporting", purpose: "The six Template 10 areas: area, what to show and RAG logic verbatim from B0095, required presentation and status basis verbatim from M0247-M0252, provisional Arabic (REQ-PB-062; ADR-0037 §2).", writers: "none (seed, read-only)", lifecycle: "seed" },
  dashboard_rag_policy: { migration: M2, module: "reporting", purpose: "The T10 RAG thresholds of one organization; NULL = the documented ADR-0037 §3 default; no value is seeded (REQ-PB-063; ADR-0037 §3).", writers: "`dashboard.configure` (TO, KDS)", lifecycle: "one row per organization; versioned" },
};
const ORDER = Object.keys(T);

async function main(): Promise<void> {
  const c0 = new pg.Client({ connectionString: admin });
  await c0.connect();
  await c0.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
  await c0.query(`CREATE DATABASE dict_jk OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  await c0.end();
  const u = new URL(admin);
  u.pathname = "/dict_jk";
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
