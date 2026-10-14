// T-DG5-ARCH-06: generates the "P5 tables, slices I and J" section of docs/architecture/data-dictionary.md from the
// catalogue of a freshly migrated DISPOSABLE database, so the dictionary matches the migrations exactly (the
// T-DG5-ARCH-05 generator with the slice I/J table list).
//   QA_PG_PORT=<23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG5/T-DG5-ARCH-06-evidence/gen-dictionary.ts > <out.md>
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
const I = "0089_p5_reader_provenance_branding.sql";
const J = "0090_p5_demo_environment_walkthrough.sql";
const T: Record<string, Meta> = {
  guiding_question: { migration: I, module: "methodology", purpose: "The four B0016 guiding questions, English verbatim, Arabic provisional (REQ-PB-011; ADR-0049 §2).", writers: "migrations only", lifecycle: "seeded catalogue (4 rows); append-only" },
  playbook_block: { migration: I, module: "methodology", purpose: "The 165 blocks of the playbook v1.0 (B0001-B0165): English verbatim from docs/source/playbook.md, provisional Arabic, section and phase, and the stored English and Arabic full-text vectors (REQ-S03-010, REQ-PB-001; ADR-0049 §1, §3).", writers: "migrations only (BE-Q's 0092 seed; later Arabic corrections)", lifecycle: "seeded catalogue (165 rows); verbatim text, position and section immutable; only text_ar/ar_provisional correctable; never deleted" },
  playbook_block_link: { migration: I, module: "methodology", purpose: "A seeded link of a block to the template (form), procedure or requirement ID that implements it (REQ-S02-004; ADR-0049 §4).", writers: "migrations only (BE-Q's 0092 seed); version additions/removals are Studio methodology_text elements", lifecycle: "seeded catalogue; append-only" },
  source_foundation: { migration: I, module: "methodology", purpose: "The B0156 source-foundations table (Source / Used for), verbatim, shown read-only in the reader (REQ-PB-001; ADR-0049 §5).", writers: "migrations only", lifecycle: "seeded catalogue (3 rows); append-only" },
  methodology_element_profile: { migration: I, module: "methodology", purpose: "The default provenance (custom_extension per B0158-B0162, foundation_inspired per B0156) and, for templates, the one guiding-question tag of every seeded methodology element (REQ-PB-002, REQ-PB-011; ADR-0049 §2).", writers: "migrations only; version overrides are Studio methodology_text elements 'profile.<element_ref>'", lifecycle: "seeded catalogue (56 rows); append-only" },
  branding_version: { migration: I, module: "admin", purpose: "One immutable branding version of an organization: product name (en, ar), primary and secondary colours with their provisional flag and approval reference, bundled fonts, PNG logo, report header and footer (REQ-S15-004, REQ-S01-002; ADR-0049 §8).", writers: "`branding.configure` (ADM_TECH) through putBrandingSettings", lifecycle: "append-only; numbered 1, 2, … per organization under lock 730270" },
  branding_setting: { migration: I, module: "admin", purpose: "The organization's branding head row naming its current (latest) branding version; its version is the If-Match of putBrandingSettings (ADR-0049 §8).", writers: "`branding.configure`", lifecycle: "one per organization, created on the first save; current_version_no = version = the latest branding version; versioned" },
  deployment_environment: { migration: J, module: "admin", purpose: "The environment marker of this database: production (bootstrap) or demo (seed-demo, with dataset, version and synthetic clock) (REQ-S18-001, REQ-S18-003; ADR-0050 §1).", writers: "the initializing CLI command (owner) only", lifecycle: "at most one row, written once; append-only (a production database never becomes a demo database)" },
  demo_seed_record: { migration: J, module: "admin (demo)", purpose: "Every record the demo seed created, with its stable fixture key; read by the coverage check and the checksum (REQ-S18-001, REQ-S18-002; ADR-0050 §2, §4).", writers: "the demo seed (owner) only; refused outside a demo database", lifecycle: "append-only; empty in production" },
  demo_dataset_run: { migration: J, module: "admin (demo)", purpose: "The outcome of a demo seed or reset: record counts per table, the SHA-256 checksum, the seed coverage and who requested it (REQ-S18-001, REQ-S18-002; ADR-0050 §4-§6).", writers: "the demo seed/reset (owner) only; only in a demo database", lifecycle: "append-only; numbered 1, 2, …" },
  walkthrough_step: { migration: J, module: "admin (demo)", purpose: "The twelve M0349 steps of the guided walkthrough, verbatim titles, provisional Arabic, area and completion rule (REQ-S18-004; ADR-0050 §7).", writers: "migrations only", lifecycle: "seeded catalogue (12 rows); append-only" },
};
const ORDER = Object.keys(T);
async function main(): Promise<void> {
  const c0 = new pg.Client({ connectionString: admin });
  await c0.connect();
  await c0.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
  await c0.query(`CREATE DATABASE dict_p5ij OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  await c0.end();
  const u = new URL(admin);
  u.pathname = "/dict_p5ij";
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
