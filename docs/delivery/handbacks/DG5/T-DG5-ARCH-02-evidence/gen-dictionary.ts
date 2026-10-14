// T-DG5-ARCH-02: generates the "P5 tables, slices B and C" section of docs/architecture/data-dictionary.md from the
// catalogue of a freshly migrated DISPOSABLE database, so the dictionary matches the migrations exactly (the
// T-DG5-ARCH-01 generator with the slice B/C table list).
//   QA_PG_PORT=<23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG5/T-DG5-ARCH-02-evidence/gen-dictionary.ts > <out.md>
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
const M8 = "0068_p5_form_schemas_framework.sql";
const M9 = "0069_p5_procedures.sql";
const M10 = "0070_p5_forms_procedures_permissions_coverage.sql";
const T: Record<string, Meta> = {
  form_record_type: { migration: M8, module: "forms", purpose: "The native forms (ADR-0041 §1): 15 templates (T10 is the dashboard read model), 3 source deliverables, the 12 M0149 extension record types (extension badge) and 3 product records, with the typed table, write permission, extension-field and bulk-edit flags and feature status (REQ-S05-001, REQ-S05-006).", writers: "migrations only", lifecycle: "seeded catalogue" },
  form_source_field: { migration: M8, module: "forms", purpose: "The protected source columns (REQ-S05-002): one row per minimum field of M0129–M0144, verbatim English label, provisional Arabic label, fixed Studio field type and storage reference (ADR-0041 §2).", writers: "migrations only", lifecycle: "seeded catalogue" },
  form_custom_value: { migration: M8, module: "forms", purpose: "The extension-field values of one record, validated against the form_schema version the transformation is pinned to (REQ-S16-010, REQ-S06-005; ADR-0041 §4); decimals as strings, percentages as fractions, currency as amount + code.", writers: "the record type's write permission (`form_record_type.write_permission_code`)", lifecycle: "one row per record; versioned" },
  form_draft: { migration: M8, module: "forms", purpose: "A saved, not yet submitted form of one user (REQ-S05-001 draft saving; ADR-0041 §5).", writers: "the record type's write permission (owner only)", lifecycle: "open → closed (saved | discarded); versioned" },
  form_record_comment: { migration: M8, module: "forms", purpose: "Comments on a record, one reply level (REQ-S05-001; ADR-0041 §5).", writers: "`form_record.comment`", lifecycle: "append-only" },
  form_record_attachment: { migration: M8, module: "forms", purpose: "Evidence attached to a record of a type the DG2 evidence_link does not cover (REQ-S05-001; ADR-0041 §5); one attachment place per record type.", writers: "the record type's write permission", lifecycle: "active → removed; versioned" },
  procedure_definition: { migration: M9, module: "procedures", purpose: "One procedure in one version of the 'procedures' configuration with every M0152 part (REQ-S06-001, REQ-S16-015; ADR-0042 §1); the ten seeded procedures are product defaults (REQ-S06-003).", writers: "`methodology.configure` (drafts only); seeds by migration", lifecycle: "written only while its version is a draft being edited; frozen with the version; versioned" },
  procedure_step_definition: { migration: M9, module: "procedures", purpose: "One step of a definition: ordered by ordinal, parallel by shared ordinal and group, conditional on an input, task or approval, with SLA, inputs, evidence and output (ADR-0042 §2).", writers: "`methodology.configure` (drafts only); seeds by migration", lifecycle: "as procedure_definition; versioned" },
  procedure_instance: { migration: M9, module: "procedures", purpose: "A launched procedure pinned to the exact published definition row (REQ-S06-002, REQ-S16-015; ADR-0042 §3).", writers: "`procedure.launch` (create), `procedure.act` (inputs), `procedure.manage` (cancel); completion by the step flow", lifecycle: "active → completed | cancelled; versioned" },
  procedure_step_instance: { migration: M9, module: "procedures", purpose: "One step of an instance, copied from the pinned definition at launch: status, assignee, due date, completion, skip, approval (ADR-0042 §3-§4).", writers: "`procedure.act`, `procedure.manage`; the canonical approval decision for approval steps", lifecycle: "pending → active | not_applicable | cancelled; active → completed | skipped | cancelled; versioned" },
  procedure_instance_link: { migration: M9, module: "procedures", purpose: "The real records an instance produced (output) or used (evidence) (REQ-S06-002 'outputs are real linked records'; ADR-0042 §3).", writers: "`procedure.act` (through the output adapters and evidence linking)", lifecycle: "append-only" },
  methodology_coverage_link: { migration: M10, module: "procedures", purpose: "Which native forms and procedures implement each counted source element (REQ-S01-003; ADR-0042 §6).", writers: "migrations only", lifecycle: "seeded catalogue" },
};
const ORDER = Object.keys(T);
async function main(): Promise<void> {
  const c0 = new pg.Client({ connectionString: admin });
  await c0.connect();
  await c0.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
  await c0.query(`CREATE DATABASE dict_p5bc OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  await c0.end();
  const u = new URL(admin);
  u.pathname = "/dict_p5bc";
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
