// T-DG4-ARCH-03: prints the Kysely interfaces, Database entries, Row aliases and SCHEMA_COLUMNS entries of the slice B
// tables from a freshly migrated DISPOSABLE database (provenance for packages/db/src/schema.ts). Run with with-pg.sh.
import { createRequire } from "node:module";
import { migrate } from "../../../../../packages/db/src/migrate.ts";

const pg = createRequire(new URL("../../../../../packages/db/package.json", import.meta.url))("pg");
const admin = process.env.TEST_DATABASE_ADMIN_URL!;
const TABLES = ["benefit_lifecycle_step_definition", "benefit_valuation_method", "benefit_group", "benefit", "benefit_enabler", "benefit_lifecycle_event", "benefit_allocation", "benefit_scenario", "benefit_scenario_value", "benefit_plan_value", "benefit_measurement", "benefit_measurement_input", "benefit_evidence", "finance_validation", "benefit_overlap"];
const VIEWS = ["benefit_counting", "benefit_value_line"];
const pascal = (t: string) => t.split("_").map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
const iface = (t: string) => pascal(t) + (VIEWS.includes(t) ? "View" : "Table");
async function main() {
  const a = new pg.Client({ connectionString: admin });
  await a.connect();
  await a.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
  await a.query(`CREATE DATABASE gen_schema OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  await a.end();
  const u = new URL(admin);
  u.pathname = "/gen_schema";
  const url = new URL(u.toString());
  url.searchParams.set("options", "-c role=mth_owner");
  await migrate(url.toString(), { dir: new URL("../../../../../packages/db/migrations", import.meta.url).pathname });
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  const ifaces: string[] = [];
  const cols: string[] = [];
  for (const t of [...TABLES, ...VIEWS]) {
    const r = await c.query(
      `SELECT column_name AS n, data_type AS dt, is_nullable = 'YES' AS nul, column_default AS d, is_identity = 'YES' AS ident, is_generated = 'ALWAYS' AS gen
       FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [t]);
    const lines = r.rows.map((x: any) => {
      let ty: string;
      const hasDef = x.d !== null;
      const isView = VIEWS.includes(t);
      if (isView) {
        const base = ["integer", "smallint"].includes(x.dt) ? "number" : x.dt === "boolean" ? "boolean" : "string";
        return `  ${x.n}: ColumnType<${base} | null, never, never>;`;
      }
      if (x.ident) ty = "IdentityBigint";
      else if (x.gen) ty = "ColumnType<number, never, never>";
      else if (x.dt === "timestamp with time zone") ty = x.nul ? "NullableTimestamp" : hasDef ? "TimestampDefault" : "Timestamp";
      else if (x.dt === "jsonb") ty = x.nul ? "NullableJson" : hasDef ? "JsonDefault" : "Json";
      else {
        const base = ["integer", "smallint"].includes(x.dt) ? "number" : x.dt === "boolean" ? "boolean" : "string";
        ty = x.nul ? `${base} | null` : hasDef ? `Generated<${base}>` : base;
      }
      return `  ${x.n}: ${ty};`;
    });
    ifaces.push(`export interface ${iface(t)} {\n${lines.join("\n")}\n}\n`);
    cols.push(`  ${t}: [${r.rows.map((x: any) => JSON.stringify(x.n)).join(", ")}],`);
  }
  console.log("//// INTERFACES\n" + ifaces.join("\n"));
  console.log("//// DATABASE\n" + [...TABLES, ...VIEWS].map((t) => `  ${t}: ${iface(t)};`).join("\n"));
  console.log("//// ROWS\n" + TABLES.map((t) => `export type ${pascal(t)}Row = Selectable<${pascal(t)}Table>;`).join("\n"));
  console.log("//// COLUMNS\n" + cols.join("\n"));
  await c.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
