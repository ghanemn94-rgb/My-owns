// T-DG5-ARCH-04: generates the "P5 tables, slice F" section of docs/architecture/data-dictionary.md from the
// catalogue of a freshly migrated DISPOSABLE database, so the dictionary matches the migrations exactly (the
// T-DG5-ARCH-03 generator with the slice F table list).
//   QA_PG_PORT=<23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG5/T-DG5-ARCH-04-evidence/gen-dictionary.ts > <out.md>
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
const M0 = "0080_p5_reports_snapshots_updates.sql";
const M1 = "0081_p5_export_jobs.sql";
const T: Record<string, Meta> = {
  report_definition: { migration: M0, module: "reporting", purpose: "The generated outputs (REQ-S13-004): the ten M0253 outputs, the executive pack (M0185) and the meeting pack (M0212), with subject type, period need, export formats and playbook template (ADR-0045 §1).", writers: "migrations only", lifecycle: "seeded catalogue (12 rows)" },
  report_snapshot: { migration: M0, module: "reporting", purpose: "One assembled output with its as-of time, reporting period, content, methodology version, approval state and provisional/unknown counts; issue, reissue as a new version, discard (REQ-S13-007, REQ-S13-008; ADR-0045 §2-§5).", writers: "`report.generate` (generate, reissue's assembly), `report.issue` (issue, reissue, discard)", lifecycle: "generated → issued | discarded; issued → superseded by a reissue; content immutable after INSERT; never deleted; versioned" },
  report_snapshot_source: { migration: M0, module: "reporting", purpose: "The revision, approval state and validation state of each source record a snapshot used (REQ-S13-007 'source record revisions'; ADR-0045 §3).", writers: "the snapshot's creating transaction only", lifecycle: "append-only (no audit event of its own; covered by report_snapshot.generate)" },
  report_snapshot_version: { migration: M0, module: "reporting", purpose: "The methodology, configuration and calculation versions a snapshot used (REQ-S13-007; ADR-0045 §3).", writers: "the snapshot's creating transaction only", lifecycle: "append-only (covered by report_snapshot.generate)" },
  report_snapshot_evidence: { migration: M0, module: "reporting", purpose: "The evidence a snapshot cites with the content revision, SHA-256 and review status at the as-of time (REQ-S13-010 report linkage; ADR-0045 §8).", writers: "the snapshot's creating transaction only", lifecycle: "append-only (covered by report_snapshot.generate)" },
  owner_update: { migration: M0, module: "portfolio", purpose: "The structured owner update of one subject (transformation or workstream) for one reporting period: the eight M0185 fields (REQ-S09-011; ADR-0045 §6).", writers: "`owner_update.submit` and the subject owner (workstream lead; TL for the transformation)", lifecycle: "draft → submitted → draft (reopen with reason); written only while the period is open; versioned" },
  owner_update_revision: { migration: M0, module: "portfolio", purpose: "The eight fields of each submitted revision of an owner update; the executive pack cites them (REQ-S09-011; ADR-0045 §6).", writers: "the submit transaction of owner_update", lifecycle: "append-only (covered by owner_update.submit)" },
  export_job: { migration: M1, module: "reporting", purpose: "One export of one snapshot in one format and language, rendered by the worker, with the stored file's name, type, size and SHA-256 (REQ-S13-005, REQ-S13-009; ADR-0046 §5).", writers: "`export.create` (create), the requester (cancel), the worker (start, retry, finish)", lifecycle: "queued → running → succeeded | failed | queued (retry) | cancelled; request immutable; versioned" },
  export_job_progress: { migration: M1, module: "reporting", purpose: "The progress of an export job: stage, percent and sections (REQ-S13-005 'async job with progress'; ADR-0046 §5).", writers: "the API (created with the job), the worker (forward only)", lifecycle: "queued → loading → rendering → storing → done; forward only; versioned; no audit event" },
};
const ORDER = Object.keys(T);
async function main(): Promise<void> {
  const c0 = new pg.Client({ connectionString: admin });
  await c0.connect();
  await c0.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
  await c0.query(`CREATE DATABASE dict_p5f OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  await c0.end();
  const u = new URL(admin);
  u.pathname = "/dict_p5f";
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
