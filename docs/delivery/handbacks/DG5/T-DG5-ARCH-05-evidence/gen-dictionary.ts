// T-DG5-ARCH-05: generates the "P5 tables, slices G and H" section of docs/architecture/data-dictionary.md from the
// catalogue of a freshly migrated DISPOSABLE database, so the dictionary matches the migrations exactly (the
// T-DG5-ARCH-04 generator with the slice G/H table list).
//   QA_PG_PORT=<23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG5/T-DG5-ARCH-05-evidence/gen-dictionary.ts > <out.md>
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
const G = "0085_p5_kpi_restatements_financial_metrics.sql";
const H = "0086_p5_launch_plans_health_checks.sql";
const T: Record<string, Meta> = {
  kpi_restatement: { migration: G, module: "kpi", purpose: "A retrospective restatement of selected closed periods of a KPI with an approved version, a reason, the decision and its recorded authority (REQ-S07-016, M0163; ADR-0047 §2).", writers: "`kpi_restatement.request` (create, submit, withdraw), `kpi_restatement.approve` (decide; never the requester), the worker (applied)", lifecycle: "draft → submitted | withdrawn; submitted → approved | rejected | withdrawn; approved → applied; one in progress per KPI; versioned" },
  kpi_restatement_period: { migration: G, module: "kpi", purpose: "The explicitly selected closed reporting periods of a restatement (REQ-S07-016 'explicit period selection'; ADR-0047 §2).", writers: "the restatement's create transaction (draft only)", lifecycle: "append-only (covered by the kpi_restatement audit event)" },
  kpi_restatement_reconciliation: { migration: G, module: "kpi", purpose: "The retained reconciliation: per period, scope and basis the value, status, RAG, target and version before and after, and the difference (M0163 'a retained reconciliation'; ADR-0047 §2).", writers: "the submitting transaction only", lifecycle: "append-only (covered by kpi_restatement.submit)" },
  kpi_restatement_reissue_offer: { migration: G, module: "kpi", purpose: "An issued report snapshot that showed the restated KPI for a restated period, offered for reissue once (REQ-S07-016 automation; ADR-0047 §3).", writers: "the worker after approval", lifecycle: "append-only; one per restatement and snapshot" },
  financial_metric_setting: { migration: G, module: "benefits", purpose: "The organization's optional NPV/ROI/payback extension: on/off (off by default) and the explicit methodology, timing, period-basis and discount-rate assumptions (REQ-S08-019, M0174; ADR-0047 §5).", writers: "`financial_metrics.enable` (on/off), `financial_metrics.define` (assumptions)", lifecycle: "one row per organization, created on first write; versioned" },
  financial_cash_flow_set: { migration: G, module: "benefits", purpose: "The cash-flow set of one business case that NPV, ROI and payback are computed from; replaced as a whole by a new revision (ADR-0047 §5).", writers: "`financial_metrics.define`", lifecycle: "revision 1, 2, …; versioned" },
  financial_cash_flow: { migration: G, module: "benefits", purpose: "Outflow and inflow per period index of one revision of a cash-flow set (ADR-0047 §5).", writers: "the set's create/replace transaction", lifecycle: "append-only (earlier revisions kept as history)" },
  launch_window: { migration: H, module: "launch", purpose: "The three B0134 windows with objective, actions and outputs verbatim and their day ranges (REQ-PB-086; ADR-0048 §1).", writers: "migrations only", lifecycle: "seeded catalogue (3 rows)" },
  launch_template_item: { migration: H, module: "launch", purpose: "The B0134 actions and outputs (split at ';', verbatim) and the Day-90 test, each with its window, day offsets and required output record type (REQ-PB-086; ADR-0048 §1).", writers: "migrations only", lifecycle: "seeded catalogue (33 rows)" },
  day_ninety_question: { migration: H, module: "launch", purpose: "The six Day-90 leadership test questions verbatim (B0136-B0141) and the record types used to pre-fill evidence (REQ-PB-087; ADR-0048 §4).", writers: "migrations only", lifecycle: "seeded catalogue (6 rows)" },
  launch_plan: { migration: H, module: "launch", purpose: "The 90-day launch plan of a transformation, generated once from a start date (REQ-PB-086, REQ-S14-004; ADR-0048 §1-§2).", writers: "`launch_plan.edit` (generate, change the start date), the S12-004 port", lifecycle: "one per transformation; start-date shifts recorded; versioned" },
  launch_task: { migration: H, module: "launch", purpose: "One editable scheduled task of a plan with owner, dates, status and required output record (REQ-S14-004; ADR-0048 §2).", writers: "`launch_plan.edit`", lifecycle: "not_started → in_progress | completed | cancelled; in_progress → not_started | completed | cancelled; completed → in_progress; completed dates fixed; versioned" },
  launch_task_predecessor: { migration: H, module: "launch", purpose: "A predecessor link between two tasks of the same plan; 'blocked by' is derived from it (REQ-S14-004; ADR-0048 §3).", writers: "`launch_plan.edit`", lifecycle: "active → removed (stamped, never deleted); no cycles; versioned" },
  day_ninety_test: { migration: H, module: "launch", purpose: "The Day-90 leadership test of a plan, scheduled on day 90 (REQ-PB-087; ADR-0048 §4).", writers: "the plan's generation, `day_ninety_test.respond` (complete)", lifecycle: "open → completed (all six answered); versioned" },
  day_ninety_response: { migration: H, module: "launch", purpose: "A leader's response (yes/no) to one Day-90 question, with comment and evidence (REQ-PB-087; ADR-0048 §4).", writers: "`day_ninety_test.respond`", lifecycle: "written while the test is open; versioned" },
  health_assessment: { migration: H, module: "health", purpose: "HealthAssessment (REQ-S16-021): one 25-question Transformation Health Check under a fixed scoring scheme version, with score, band and reassessment chain (REQ-PB-091, REQ-PB-092, REQ-S14-001..003; ADR-0048 §5).", writers: "`health_check.assess`", lifecycle: "draft → submitted (final; score and band recomputed and checked by the database); one draft per transformation; versioned" },
  health_assessment_answer: { migration: H, module: "health", purpose: "The response, evidence, owner and action of one question of an assessment (M0262; ADR-0048 §5).", writers: "`health_check.assess`", lifecycle: "written while the assessment is a draft; versioned" },
  health_assessment_action: { migration: H, module: "health", purpose: "The top 3 improvement actions of an assessment (B0150, M0288; ADR-0048 §5).", writers: "`health_check.assess`", lifecycle: "ranks 1-3; written while the assessment is a draft; versioned" },
};
const ORDER = Object.keys(T);
async function main(): Promise<void> {
  const c0 = new pg.Client({ connectionString: admin });
  await c0.connect();
  await c0.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
  await c0.query(`CREATE DATABASE dict_p5gh OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  await c0.end();
  const u = new URL(admin);
  u.pathname = "/dict_p5gh";
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
