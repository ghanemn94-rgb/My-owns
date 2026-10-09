// T-DG4-ARCH-02: generates the "P4 tables, slice A" section of docs/architecture/data-dictionary.md from the
// catalogue of a freshly migrated DISPOSABLE database, so the dictionary matches the migrations exactly.
//   QA_PG_PORT=<23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG4/T-DG4-ARCH-02-evidence/gen-dictionary.ts > <out.md>
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
const M3 = "0033_p4_kpi_dictionary_versions.sql";
const M4 = "0034_p4_kpi_trajectories_actuals.sql";
const M5 = "0035_p4_kpi_calculation_runs_quality.sql";
const T: Record<string, Meta> = {
  reporting_period: { migration: M3, module: "kpi", purpose: "An observation period of one organization and frequency (REQ-S07-003, REQ-S12-005; ADR-0027 §3). Periods of one frequency never overlap (lock 730230). basis 'weeks' marks a week-based period whose week count decides comparability (REQ-S07-005).", writers: "`reporting_period.manage` (TO); the `kpi.reporting_period_open` job opens due periods", lifecycle: "scheduled → open → closed (final in P4)" },
  kpi_version: { migration: M3, module: "kpi", purpose: "KPIVersion (REQ-S16-014): the versioned P4 measurement definition of a KPI; with the DG2 kpi_definition it holds every REQ-S07-001 field (measure type, value nature, numerator/denominator, calculation, baseline, target, aggregation rule, data-quality rule, submission route and approval policy; ADR-0027 §1-§2). An aggregation rule is required to activate (D-089 Q1).", writers: "`kpi_version.edit` (TL, KDS); `kpi_version.activate` (TL, KDS), after a business approval when definition_approval = business_approval", lifecycle: "draft → active | withdrawn; active → superseded" },
  kpi_formula_input: { migration: M3, module: "kpi", purpose: "A formula variable of a KPI version bound to another KPI of the transformation; the edges of the cycle check (REQ-S07-011; ADR-0027 §4).", writers: "`kpi_version.edit` (with its draft version)", lifecycle: "append-only; inserted only while the version is a draft" },
  kpi_rag_threshold: { migration: M3, module: "kpi", purpose: "A versioned set of RAG thresholds of a KPI (REQ-S07-007; ADR-0028 §5). A new version supersedes the active one and triggers a calculation run.", writers: "`kpi_threshold.configure` (TL, KDS)", lifecycle: "active → superseded" },
  target_trajectory: { migration: M4, module: "kpi", purpose: "TargetTrajectory (REQ-S16-014): the expected path of a KPI for one scope; RAG uses the approved one (REQ-S07-007; ADR-0027 §5). DG2 outcome_kpi trajectories are copied once by 0036 (source outcome_kpi_backfill).", writers: "`target_trajectory.edit` (TL, KDS); approval `kpi_target.approve` (SP, BO; not the creator)", lifecycle: "draft → approved | withdrawn; approved → superseded" },
  target_trajectory_point: { migration: M4, module: "kpi", purpose: "One expected value at a date of a trajectory (ADR-0027 §5).", writers: "`target_trajectory.edit` (with its draft trajectory)", lifecycle: "append-only; inserted only while the trajectory is a draft" },
  kpi_actual: { migration: M4, module: "kpi", purpose: "KPIActual (REQ-S16-014): the actual SLOT of one KPI, scope and reporting period (REQ-S07-003). A second actual is a new value version of the same slot. The only audited row of an entry: one audit event per save, submit, accept or reject (REQ-S07-013).", writers: "`kpi_actual.submit` (KDS, BO; owner, steward or update assignee); `kpi_actual.accept` (SP, TL, BO; the configured reviewer, not the submitter)", lifecycle: "draft → submitted → accepted | rejected; direct-accept route: draft → accepted; a new value reopens to draft/submitted" },
  kpi_actual_value: { migration: M4, module: "kpi", purpose: "Every entered value version of a slot: value, numerator/denominator, milestone flag, or an explicit missing_reason (Unknown, never 0); currency, data-as-of, entry instant and business date (REQ-S07-003, REQ-S07-005, REQ-S15-008).", writers: "`kpi_actual.submit` (in the slot's transaction)", lifecycle: "append-only" },
  kpi_actual_review: { migration: M4, module: "kpi", purpose: "The decision on one value version: accept, reject (with reason) or direct_accept (REQ-S07-012).", writers: "`kpi_actual.accept` (reviewer); the direct-accept route (submitter)", lifecycle: "append-only; one per value version" },
  kpi_actual_evidence: { migration: M4, module: "kpi", purpose: "Evidence linked to a value version (REQ-S07-017).", writers: "`kpi_actual.submit`", lifecycle: "append-only" },
  calculation_run: { migration: M5, module: "kpi (worker `kpi.recalculate`)", purpose: "CalculationRun (REQ-S16-014): one run per trigger (accepted value, threshold version, approved trajectory, activated version); unique per trigger so a retry or restart never writes a second (REQ-S07-013, REQ-S12-006; ADR-0027 §7-§8). Lineage; no audit event.", writers: "the worker (service actor)", lifecycle: "append-only; completed | failed" },
  kpi_evaluation: { migration: M5, module: "kpi (worker)", purpose: "One evaluated KPI value per run, KPI, scope, period and basis: value and status, expected-to-date, final target, variance, trend, freshness, calculated RAG and the rule explanation (REQ-S07-004..-008; ADR-0028 §6). Lineage; no audit event.", writers: "the worker (service actor)", lifecycle: "append-only" },
  data_quality_finding: { migration: M5, module: "kpi", purpose: "DataQualityFinding (REQ-S16-014): a data-quality exception found by a run (missing, stale, out of range, evidence missing, zero denominator, not comparable, negative baseline, scope missing; ADR-0027 §9).", writers: "the worker inserts (lineage); `data_quality.manage` (TL, KDS) resolves or dismisses (audited)", lifecycle: "open → resolved | dismissed (final)" },
  rag_override: { migration: M5, module: "kpi", purpose: "A manual RAG for one KPI, scope and period with reason, evidence and expiry; the calculated RAG is preserved (REQ-S07-009; ADR-0027 §10). In force while active and before expires_at.", writers: "`rag.override` (TL, BO)", lifecycle: "active → revoked (final); expiry ends it without a write" },
};
const ORDER = Object.keys(T);

async function main(): Promise<void> {
  const c0 = new pg.Client({ connectionString: admin });
  await c0.connect();
  await c0.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
  await c0.query(`CREATE DATABASE dict_a OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  await c0.end();
  const u = new URL(admin);
  u.pathname = "/dict_a";
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
