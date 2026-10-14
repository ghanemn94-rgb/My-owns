// T-DG5-ARCH-01: generates the "P5 tables, slice A" section of docs/architecture/data-dictionary.md from the catalogue
// of a freshly migrated DISPOSABLE database, so the dictionary matches the migrations exactly (the T-DG4-ARCH-08
// generator with the slice A table list).
//   QA_PG_PORT=<23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG5/T-DG5-ARCH-01-evidence/gen-dictionary.ts > <out.md>
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
const M1 = "0062_p5_config_versions.sql";
const M2 = "0063_p5_pins_methodology_migrations.sql";
const T: Record<string, Meta> = {
  methodology_version: { migration: `0011 (DG2) + ${M1}`, module: "methodology", purpose: "The version header of every Studio configuration kind (ADR-0039 §1): kind, key, version number, status, draft stage, origin and lineage, content hash; published versions are immutable (REQ-S06-007, REQ-S06-009, REQ-S16-012). Platform-wide (no organization).", writers: "`methodology.configure` (drafts), `methodology.publish` (publish, rollback); seeds by migration only", lifecycle: "status draft → published → retired; draft stage editing → preview → review → approved (or discarded); versioned" },
  methodology_element: { migration: M1, module: "methodology", purpose: "Version-scoped attributes of one stable element (D-142 Q1; ADR-0039 §2): a row exists where a version differs from or adds to the DG2 catalogue; phases, gates and TOM dimensions are never added or removed (REQ-S06-006).", writers: "`methodology.configure` (drafts only)", lifecycle: "written only while its version is a draft being edited; frozen with the version; versioned" },
  source_element: { migration: `${M1} (table), 0064 (seed)`, module: "methodology", purpose: "The source inventory of REQ-S02-001: 80 counted source elements with verbatim English labels, provisional Arabic labels, block references and implementing feature (ADR-0039 §6).", writers: "migrations only (feature_status moved by the shipping task's migration)", lifecycle: "seeded catalogue" },
  config_check_run: { migration: M1, module: "methodology", purpose: "One preview/test, compatibility, source-coverage or invariant run over exactly one content hash of a version (ADR-0039 §5, §6).", writers: "`methodology.publish`, `source_coverage.run`", lifecycle: "append-only" },
  config_review_policy: { migration: M1, module: "methodology", purpose: "Whether a configuration kind needs review before publish and by which role (REQ-S06-007 \"Review where configured\"); the benefit_formula row names the reviewer of S12-018 formula-revision tasks.", writers: "`config_review_policy.configure` (TO)", lifecycle: "seeded one row per kind; versioned" },
  revision_proposal: { migration: M1, module: "methodology", purpose: "The S12-018 starter's record: validation, impact (affected transformations, records, benefits) and review routing of a proposed methodology or formula revision, exactly once per subject and content (ADR-0039 §8).", writers: "the API in the submit-review or formula-version transaction", lifecycle: "append-only" },
  config_review_request: { migration: M1, module: "methodology", purpose: "The configured review of exactly one content hash of a draft; the reviewer is never the requester or the author (ADR-0039 §5).", writers: "`methodology.publish` (request, withdraw), `methodology.review` (decide)", lifecycle: "pending → approved | changes_requested | withdrawn; versioned" },
  transformation_config_pin: { migration: `0011 (DG2) + ${M2}`, module: "methodology", purpose: "The configuration version a transformation is pinned to, per kind (ADR-0039 §3); moves only through an approved methodology migration (REQ-S06-008).", writers: "instantiation (DG2, KBE-A's 0065), `methodology_migration.execute`", lifecycle: "one per transformation and kind; versioned" },
  methodology_migration: { migration: M2, module: "methodology", purpose: "The deliberate, approved move of one pin with its plan (REQ-S06-008; ADR-0040 §1).", writers: "`methodology_migration.plan`, `.approve` (business approval, via the canonical approval), `.execute`", lifecycle: "draft → submitted → approved → executed (or rejected, changes_requested, withdrawn); versioned" },
  methodology_migration_item: { migration: M2, module: "methodology", purpose: "One finding of a plan revision: mapping, new required field, invalidated calculation, re-approval, removed element, unchanged history (ADR-0040 §2).", writers: "`methodology_migration.plan`", lifecycle: "append-only per plan revision" },
  transformation_config_pin_history: { migration: M2, module: "methodology", purpose: "Every move of a pin, with its migration; required at COMMIT for each pin version change (ADR-0040 §1).", writers: "`methodology_migration.execute`", lifecycle: "append-only" },
  gate_reapproval: { migration: M2, module: "workflows", purpose: "A product gate that needs business re-approval after a migration; the approved decision stays in history (D-142 Q9; ADR-0040 §3).", writers: "`methodology_migration.execute` (create), the gate decision (satisfy), a later migration (supersede)", lifecycle: "required → satisfied | superseded; versioned" },
};
const ORDER = Object.keys(T);
async function main(): Promise<void> {
  const c0 = new pg.Client({ connectionString: admin });
  await c0.connect();
  await c0.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
  await c0.query(`CREATE DATABASE dict_p5a OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  await c0.end();
  const u = new URL(admin);
  u.pathname = "/dict_p5a";
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
