// T-DG4-ARCH-03: generates the "P4 tables, slice B" section of docs/architecture/data-dictionary.md from the
// catalogue of a freshly migrated DISPOSABLE database, so the dictionary matches the migrations exactly (the
// T-DG4-ARCH-02 generator with the slice B table list).
//   QA_PG_PORT=<23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG4/T-DG4-ARCH-03-evidence/gen-dictionary.ts > <out.md>
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
const M7 = "0037_p4_benefit_register.sql";
const M8 = "0038_p4_benefit_measurement_validation.sql";
const M9 = "0039_p4_benefit_value_views.sql";
const T: Record<string, Meta> = {
  benefit_lifecycle_step_definition: { migration: M7, module: "benefits", purpose: "The six B0121 lifecycle steps with their question and output, seeded verbatim in English; Arabic provisional (REQ-PB-074; ADR-0029 §2).", writers: "seed only (read-only for the application)", lifecycle: "reference data" },
  benefit_valuation_method: { migration: M7, module: "benefits", purpose: "A method that values a non-financial benefit in SAR (REQ-S08-010; ADR-0029 §8). Only an approved method lets a non-financial benefit carry an amount.", writers: "`benefit.edit` proposes (TL, BO); `finance.validate` (FIN) decides, never the proposer", lifecycle: "proposed → approved | rejected; approved → retired" },
  benefit_group: { migration: M7, module: "benefits", purpose: "A shared-benefit group (REQ-PB-058, M0173): exactly the named counted member is counted; while none is named no member is counted (ADR-0029 §6).", writers: "`benefit_group.manage` (TL, BO)", lifecycle: "active → archived" },
  benefit: { migration: M7, module: "benefits", purpose: "Benefit (REQ-S16-017): one canonical T14 register row with the REQ-S08-003 profile, one owner, one value class and currency, and the six-step lifecycle whose source outputs are preconditions (REQ-PB-058, REQ-PB-074, REQ-PB-075, REQ-PB-076; ADR-0029 §1-§2).", writers: "`benefit.edit` (TL, BO); `benefit.advance` (BO) for the step; `benefit.allocate` (TL, BO) for allocation_set_no; `finance.validate` (FIN) for the baseline validation", lifecycle: "identify → plan → enable → measure ⇄ correct; measure → sustain; active → archived" },
  benefit_enabler: { migration: M7, module: "benefits", purpose: "The Enable output: the initiative (and optionally its deliverable or a capability) a benefit depends on; delivered when the deliverable is accepted or the initiative completed; never realized value (REQ-S08-002; ADR-0029 §3).", writers: "`benefit.edit` (TL, BO)", lifecycle: "active → removed (final)" },
  benefit_lifecycle_event: { migration: M7, module: "benefits", purpose: "Append-only history of a benefit's lifecycle steps, written only by the trigger benefit_lifecycle_history (ADR-0029 §2).", writers: "trigger on benefit (actor = benefit.updated_by)", lifecycle: "append-only" },
  benefit_allocation: { migration: M7, module: "benefits", purpose: "BenefitAllocation (REQ-S16-017): contribution shares of one canonical benefit to initiatives, per allocation set; at most 1 (100 %) in total under lock 730232; the rest is unallocated (REQ-S08-013; ADR-0029 §5). Totals never sum allocations.", writers: "`benefit.allocate` (TL, BO), with the benefit's set number step", lifecycle: "append-only; the set in force is benefit.allocation_set_no" },
  benefit_scenario: { migration: M7, module: "benefits", purpose: "Scenario (REQ-S16-017, REQ-S08-018): base, upside or downside of one transformation; one active per kind (ADR-0029 §10).", writers: "`benefit_scenario.edit` (TL, FIN)", lifecycle: "active → archived" },
  benefit_scenario_value: { migration: M7, module: "benefits", purpose: "A scenario value of one benefit and period; never read by an actual, realized or validated total (REQ-S08-018).", writers: "`benefit_scenario.edit` (TL, FIN)", lifecycle: "mutable (versioned)" },
  benefit_plan_value: { migration: M8, module: "benefits", purpose: "The planned and forecast value series of a benefit per period (REQ-S08-001; ADR-0030 §1).", writers: "`benefit.edit` (TL, BO)", lifecycle: "mutable (versioned)" },
  benefit_measurement: { migration: M8, module: "benefits", purpose: "BenefitMeasurement (REQ-S16-017): one measured value of a benefit for one period with its lineage, or a Finance amendment or reversal linked to the original validated value (REQ-S08-016, REQ-S08-017; ADR-0030 §2, §4). Validated only with the matching Finance decision (deferred check).", writers: "`benefit.measure` (BO, WL, KDS); the worker (`kpi_recalculation`, submitted_by NULL); `finance.validate` (FIN) decides and records corrections", lifecycle: "draft → submitted → validated | rejected | superseded (final)" },
  benefit_measurement_input: { migration: M8, module: "benefits", purpose: "Calculation lineage: each formula variable bound to a KPI actual value version, with the value used; same period as the measurement (REQ-S08-006, REQ-S08-008; ADR-0030 §5).", writers: "in the measurement's transaction (API or worker)", lifecycle: "append-only" },
  benefit_evidence: { migration: M8, module: "benefits", purpose: "Evidence linked to a benefit (T14 Evidence) or to one of its draft or submitted measurements (ADR-0030 §3).", writers: "`benefit.edit` (benefit links), `benefit.measure` (measurement links)", lifecycle: "append-only" },
  finance_validation: { migration: M8, module: "benefits (worker `benefits.finance_queue`)", purpose: "FinanceValidation (REQ-S16-017): the Finance queue item of one submitted measurement (exactly one, REQ-S12-014) and its decision on the six REQ-S08-015 items, or a Finance amendment or reversal linked to the original (ADR-0030 §3-§4).", writers: "the worker creates queue items (service actor); `finance.validate` (FIN) decides, never the submitter, and records corrections", lifecycle: "queued → approved | rejected | withdrawn (final); corrections are created approved" },
  benefit_overlap: { migration: M8, module: "benefits", purpose: "An overlap warning between two benefits (same driver, population or period); both are excluded from validated totals until Finance resolves it (REQ-S08-014; ADR-0029 §7).", writers: "the overlap rule (lock 730234) or `benefit.edit` raises; `finance.validate` (FIN) resolves, not the owner of either benefit", lifecycle: "open → resolved (final)" },
  benefit_counting: { migration: M9, module: "benefits (read model)", purpose: "View: whether each benefit's values may enter a total (counted), why not (exclusion_reason) and whether an overlap warning is open (ADR-0029 §6, ADR-0030 §7).", writers: "none (view)", lifecycle: "view" },
  benefit_value_line: { migration: M9, module: "benefits (read model)", purpose: "View: every stored benefit value tagged with exactly one state: planned, forecast, measured, submitted, validated, sustained or rejected (REQ-S08-001; ADR-0030 §6). Scenario values are not included.", writers: "none (view)", lifecycle: "view" },
};
const ORDER = Object.keys(T);

async function main(): Promise<void> {
  const c0 = new pg.Client({ connectionString: admin });
  await c0.connect();
  await c0.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
  await c0.query(`CREATE DATABASE dict_b OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  await c0.end();
  const u = new URL(admin);
  u.pathname = "/dict_b";
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
